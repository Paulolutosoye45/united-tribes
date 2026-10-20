-- Phase 7: the supply-and-demand board, suggestions of leaders for a gap, and offers. This adds one table and eight functions (seven the
-- website calls, one internal). It changes no existing function, table or default.
--
-- The board:    for every goal, how many members are waiting, how many seats are open, how many leaders are interested (first choice and
--               backup) and the gap. Waiting, seats and the gap come from goal_demand_rows(), the one function the compatibility test's
--               Need part also reads, so the two can never disagree.
-- Suggestions:  for a goal with a gap, up to three leaders, scored fresh by the same engine (leader_fit_options) from their saved
--               answers. Never read from old stored runs. A suggestion is a proposal and never a rejection of anyone else.
-- Offers:       the office offers a leader a goal. The message goes by email through the outbox, once, with a count and no member. The
--               leader answers on their Lead page. Accepting starts their Tribe Card with the goal and community locked and the three
--               Success Picture lines filled from the signed-off card, exactly as an appointment does.
-- Who:          the board, suggestions and the list: admin, director, pastor, data lead. Sending and withdrawing: pastor, director,
--               admin. Answering: the leader the offer is for, and nobody else.
-- The template `leader_offer` is in src/lib/messaging/templates.ts. Ship that code before this file: the sender refuses a template it
-- does not know.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table public.leader_offers (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.season_goals (id),
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'withdrawn', 'expired')),
  -- Empty when the owner made the offer: the office is never shown a name that must stay hidden.
  offered_by uuid references public.people (id) on delete set null,
  offered_at timestamptz not null default now(),
  -- When the leader said yes or no
  answered_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  -- How many members were waiting when the offer was made (the count the message states)
  waiting_at_offer integer not null check (waiting_at_offer >= 1),
  -- The Tribe Card an accepted offer started
  tribe_id uuid references public.tribes (id) on delete set null,
  check ((status in ('accepted', 'declined')) = (answered_at is not null))
);
-- One open offer per leader at a time
create unique index leader_offers_one_open on public.leader_offers (person_id) where status = 'offered';
create index leader_offers_goal_idx on public.leader_offers (goal_id, status);
create index leader_offers_season_idx on public.leader_offers (season_id, offered_at desc);
alter table public.leader_offers enable row level security;
revoke all on table public.leader_offers from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

-- An offer that has passed its date is marked expired the next time anything that changes offers runs. Reads work it out for themselves.
create function public.leader_offers_expire()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.leader_offers set status = 'expired' where status = 'offered' and expires_at <= now();
$$;

-- Leaders interested in each goal, as the board shows it: the goal a leader chose in their latest run (first choice), or named as a backup.
-- Quiet runs and appointments have no choice and are not counted. A leader already leading a tribe on that goal this season is not counted.
-- Only people who hold the leader role are counted, because only they can be offered anything.
create function public.leader_interest_rows(p_season uuid)
returns table (goal_id uuid, first_choice integer, backup integer)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (r.person_id) r.person_id, r.chosen_goal_id, r.backup_goal_ids, r.source
      from public.leader_fit_runs r
     order by r.person_id, r.seq desc),
  picks as (
    select l.person_id, l.chosen_goal_id as gid, 'first'::text as kind
      from latest l where l.chosen_goal_id is not null and l.source <> 'appointment'
    union all
    select l.person_id, b, 'backup'::text
      from latest l, unnest(l.backup_goal_ids) as b where l.source <> 'appointment'),
  live as (
    select p.*
      from picks p
     where exists (select 1 from public.person_roles pr where pr.person_id = p.person_id and pr.role = 'leader')
       and not exists (select 1 from public.people x where x.id = p.person_id and x.hidden)
       and not exists (
         select 1 from public.tribes c
          where c.leader_id = p.person_id and c.season_goal_id = p.gid and c.season_id is not distinct from p_season and c.status <> 'closed'))
  select l.gid, (count(*) filter (where l.kind = 'first'))::integer, (count(*) filter (where l.kind = 'backup'))::integer
    from live l group by l.gid;
$$;

-- ---------------------------------------------------------------------------
-- The board
-- ---------------------------------------------------------------------------
create function public.leader_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  m public.leader_fit_models := public.leader_fit_cfg();
  v_cards integer;
  v_missing text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  select count(*) into v_cards
    from public.tribe_card_templates t
    join public.season_goals g on g.id = t.season_goal_id and g.active
    join public.communities c on c.id = t.community_id and c.active
   where t.status = 'signed_off';
  v_missing := case
    when v_season is null then 'No season is open for Tribe Cards yet, so nothing can be offered. Open one under Seasons.'
    when m.version is null then 'The pastorate has not approved a fit model yet, so leaders cannot be suggested. The numbers below are still true.'
    when v_cards = 0 then 'No tribe card is signed off yet, so there is nothing to offer. The numbers below are still true.'
  end;
  return jsonb_build_object(
    'season', (select jsonb_build_object('id', s.id, 'name', s.name) from public.seasons s where s.id = v_season),
    'model', m.version,
    'cards_signed', v_cards,
    'missing', v_missing,
    'goals', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.gap desc, x.waiting desc, x.title)
        from (
          select g.id as goal_id, g.slug, g.title, c.id as community_id, c.slug as community_slug, c.name as community_name,
                 d.waiting, d.seats_open, d.gap,
                 coalesce(i.first_choice, 0) as interested_first, coalesce(i.backup, 0) as interested_backup,
                 t.status as card, coalesce(t.status = 'signed_off', false) as ready,
                 (select count(*)::integer from public.leader_offers f
                   where f.goal_id = g.id and f.status = 'offered' and f.expires_at > now()) as open_offers
            from public.season_goals g
            join public.communities c on c.id = g.community_id and c.active
            join public.goal_demand_rows(v_season) d on d.goal_id = g.id
            left join public.leader_interest_rows(v_season) i on i.goal_id = g.id
            left join public.tribe_card_templates t on t.season_goal_id = g.id
           where g.active) x), '[]'::jsonb),
    'few_options', coalesce((
      select jsonb_agg(to_jsonb(y) order by y.ran_at desc)
        from (
          select l.person_id, public.person_display_name(l.person_id) as name, l.shown::integer as shown, l.source, l.ran_at
            from (select distinct on (r.person_id) r.person_id, r.shown, r.source, r.ran_at
                    from public.leader_fit_runs r where r.source <> 'appointment' order by r.person_id, r.seq desc) l
           where l.shown < 3
             and exists (select 1 from public.person_roles pr where pr.person_id = l.person_id and pr.role in ('leader', 'assistant_leader'))
             and not exists (select 1 from public.people p where p.id = l.person_id and p.hidden)
           order by l.ran_at desc
           limit 50) y), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Suggestions of leaders for a gap
-- ---------------------------------------------------------------------------
-- Who can be suggested: a person holding the leader role, with an approved application on file (their saved answers are the input), who
-- leads no tribe and has no open offer. A leader with no application has no inputs and is not suggested. Only options that pass the
-- engine's filter and the care gate and reach the model's minimum degree are suggested.
-- Order: degree, then first choice before backup before neither, then inside the card's stage before next to it, then the earliest
-- application, then the person's id.
create function public.leader_suggest(p_goal uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  m public.leader_fit_models := public.leader_fit_cfg();
  g public.season_goals;
  d record;
  v_card boolean;
  v_list jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  select * into g from public.season_goals x where x.id = p_goal and x.active;
  if not found then
    raise exception 'No such goal' using errcode = 'P0002';
  end if;
  if v_season is null then
    return jsonb_build_object('status', 'no_season', 'message', 'No season is open for Tribe Cards yet.', 'suggestions', '[]'::jsonb);
  end if;
  if m.version is null then
    return jsonb_build_object('status', 'no_model', 'message', 'The pastorate has not approved a fit model yet.', 'suggestions', '[]'::jsonb);
  end if;
  select exists (select 1 from public.tribe_card_templates t where t.season_goal_id = p_goal and t.status = 'signed_off') into v_card;
  if not v_card then
    return jsonb_build_object('status', 'no_card', 'message', 'This goal’s card is not signed off, so it cannot be offered.', 'suggestions', '[]'::jsonb);
  end if;
  select * into d from public.goal_demand_rows(v_season) x where x.goal_id = p_goal;
  if coalesce(d.gap, 0) <= 0 then
    return jsonb_build_object('status', 'no_gap', 'message', 'Nobody is waiting beyond the seats already open, so there is nothing to fill.',
                              'waiting', d.waiting, 'seats_open', d.seats_open, 'gap', d.gap, 'model', m.version, 'suggestions', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(z) order by z.degree desc, z.choice_rank, z.next_to, z.since, z.person_id), '[]'::jsonb) into v_list
    from (
      select s.*
        from (
          with cand as (
            select p.id as person_id, a.answers, coalesce(a.submitted_at, a.created_at) as since
              from public.people p
              join lateral (select x.* from public.leader_applications x
                             where x.person_id = p.id and x.status = 'approved_leader'
                             order by x.decided_at desc nulls last, x.created_at desc limit 1) a on true
             where not p.hidden
               and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'leader')
               and not exists (select 1 from public.tribes t where t.leader_id = p.id and t.status <> 'closed')
               and not exists (select 1 from public.leader_offers f where f.person_id = p.id and f.status = 'offered' and f.expires_at > now())),
          inp as (
            select c.person_id, c.since, public.leader_fit_inputs(c.answers) as i from cand c),
          ok as (
            select * from inp where i ->> 'track' is not null and i ->> 'lead_best' is not null and i ->> 'judgement' is not null),
          last_run as (
            select distinct on (r.person_id) r.person_id, r.chosen_goal_id, r.backup_goal_ids
              from public.leader_fit_runs r where r.source <> 'appointment' order by r.person_id, r.seq desc)
          select ok.person_id,
                 public.person_display_name(ok.person_id) as name,
                 o.degree, o.label, o.next_to, ok.since,
                 case when lr.chosen_goal_id = p_goal then 'first'
                      when p_goal = any (coalesce(lr.backup_goal_ids, '{}'::uuid[])) then 'backup' end as choice,
                 case when lr.chosen_goal_id = p_goal then 0 when p_goal = any (coalesce(lr.backup_goal_ids, '{}'::uuid[])) then 1 else 2 end as choice_rank,
                 coalesce((public.leader_fit_reasons(o, ok.i ->> 'relation'))[1], 'Their answers fit this tribe.') as reason
            from ok
            cross join lateral public.leader_fit_options(ok.i) o
            left join last_run lr on lr.person_id = ok.person_id
           where o.goal_id = p_goal and o.recommended
           order by o.degree desc, 8, o.next_to, ok.since, ok.person_id
           limit 3) s) z;

  return jsonb_build_object(
    'status', 'ok',
    'model', m.version,
    'goal', jsonb_build_object('id', g.id, 'title', g.title),
    'waiting', d.waiting, 'seats_open', d.seats_open, 'gap', d.gap,
    'suggestions', v_list);
end;
$$;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------

-- The office offers a leader a goal. The message states the count and nothing about any member.
create function public.leader_offer_send(p_goal uuid, p_person uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_season uuid := public.leader_fit_season();
  g public.season_goals;
  p public.people;
  d record;
  v_id uuid := gen_random_uuid();
  v_hidden boolean;
  v_community text;
  v_msg uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can make an offer' using errcode = '42501';
  end if;
  perform public.leader_offers_expire();

  select * into g from public.season_goals x where x.id = p_goal and x.active;
  if not found then
    raise exception 'No such goal' using errcode = 'P0002';
  end if;
  select c.name into v_community from public.communities c where c.id = g.community_id and c.active;
  if v_community is null then
    raise exception 'That goal’s community is switched off' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = p_goal and t.status = 'signed_off') then
    raise exception 'That goal’s card is not signed off yet, so it cannot be offered' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet. Open one first' using errcode = '22023';
  end if;

  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader')
     or not exists (select 1 from public.leader_applications a where a.person_id = p_person and a.status = 'approved_leader') then
    raise exception 'Offers go to approved leaders' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    raise exception 'They already have a Tribe Card or lead a tribe' using errcode = '22023';
  end if;
  if exists (select 1 from public.leader_offers f where f.person_id = p_person and f.status = 'offered') then
    raise exception 'They already have an open offer' using errcode = '22023';
  end if;

  select * into d from public.goal_demand_rows(v_season) x where x.goal_id = p_goal;
  if coalesce(d.waiting, 0) < 1 then
    raise exception 'Nobody is waiting for that goal, so there is nothing to offer' using errcode = '22023';
  end if;

  select coalesce(x.hidden, false) into v_hidden from public.people x where x.id = me;
  insert into public.leader_offers (id, goal_id, person_id, season_id, offered_by, waiting_at_offer)
  values (v_id, p_goal, p_person, v_season, case when v_hidden then null else me end, d.waiting);

  -- Once per offer, whatever happens: the key is the offer itself. Only a count and the goal go in; never a member.
  v_msg := public.enqueue_message(
    p_person, 'leader_offer',
    jsonb_build_object('goal', g.title, 'community', v_community, 'waiting', d.waiting,
                       'expires_on', to_char((now() + interval '14 days') at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY')),
    null, 'leader_offer:' || v_id::text);

  perform public.write_event(me, 'leader.offer_sent', 'leader_offer', v_id::text,
    jsonb_build_object('person', p_person, 'goal', p_goal, 'waiting', d.waiting));
  return jsonb_build_object('ok', true, 'offer', v_id, 'queued', v_msg is not null, 'waiting', d.waiting);
end;
$$;

create function public.leader_offer_withdraw(p_offer uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.leader_offers;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can withdraw an offer' using errcode = '42501';
  end if;
  perform public.leader_offers_expire();
  select * into o from public.leader_offers x where x.id = p_offer for update;
  if not found then
    raise exception 'No such offer' using errcode = 'P0002';
  end if;
  if o.status <> 'offered' then
    raise exception 'That offer is no longer open' using errcode = '22023';
  end if;
  update public.leader_offers set status = 'withdrawn' where id = p_offer;
  perform public.write_event(me, 'leader.offer_withdrawn', 'leader_offer', p_offer::text, jsonb_build_object('person', o.person_id, 'goal', o.goal_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Open offers and the last 90 days, newest first.
create function public.leader_offers_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.offered_at desc)
      from (
        select f.id, f.person_id, public.person_display_name(f.person_id) as name, f.goal_id, g.title as goal, c.name as community,
               case when f.status = 'offered' and f.expires_at <= now() then 'expired' else f.status end as status,
               f.offered_at, f.expires_at, f.answered_at, f.waiting_at_offer, f.tribe_id,
               case when f.offered_by is null then null else public.person_display_name(f.offered_by) end as offered_by
          from public.leader_offers f
          join public.season_goals g on g.id = f.goal_id
          join public.communities c on c.id = g.community_id
         where f.status = 'offered' or f.offered_at > now() - interval '90 days'
         order by f.offered_at desc
         limit 200) x), '[]'::jsonb);
end;
$$;

-- The leader's own open offer, with how many are waiting now.
create function public.my_leader_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_role('leader') then
    return null;
  end if;
  return (
    select jsonb_build_object('offer_id', f.id, 'goal_id', g.id, 'goal', g.title, 'community', c.name,
                              'waiting', d.waiting, 'waiting_at_offer', f.waiting_at_offer,
                              'offered_at', f.offered_at, 'expires_at', f.expires_at)
      from public.leader_offers f
      join public.season_goals g on g.id = f.goal_id and g.active
      join public.communities c on c.id = g.community_id and c.active
      cross join lateral public.goal_demand_rows(f.season_id) d
     where f.person_id = me and f.status = 'offered' and f.expires_at > now() and d.goal_id = g.id
       and exists (select 1 from public.tribe_card_templates t where t.season_goal_id = g.id and t.status = 'signed_off')
     order by f.offered_at desc
     limit 1);
end;
$$;

-- The leader answers. Declining marks it declined. Accepting starts the Tribe Card the way an appointment does, and a second
-- accept changes nothing.
create function public.leader_offer_respond(p_offer uuid, p_accept boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o public.leader_offers;
  g public.season_goals;
  p public.people;
  v_answers jsonb;
  v_track uuid;
  v_name text;
  v_first text;
  v_tribe uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception 'Say yes or no' using errcode = '22023';
  end if;
  if not public.has_role('leader') then
    raise exception 'Offers are for approved leaders' using errcode = '42501';
  end if;
  perform public.leader_offers_expire();
  select * into o from public.leader_offers x where x.id = p_offer for update;
  if not found or not coalesce(o.person_id = me, false) then
    raise exception 'No such offer' using errcode = 'P0002';
  end if;
  if o.status = 'accepted' and p_accept then
    return jsonb_build_object('ok', true, 'tribe', o.tribe_id, 'already', true);
  end if;
  if o.status = 'declined' and not p_accept then
    return jsonb_build_object('ok', true, 'declined', true, 'already', true);
  end if;
  if o.status <> 'offered' then
    raise exception 'That offer is no longer open' using errcode = '22023';
  end if;

  if not p_accept then
    update public.leader_offers set status = 'declined', answered_at = now() where id = p_offer;
    perform public.write_event(me, 'leader.offer_declined', 'leader_offer', p_offer::text, jsonb_build_object('goal', o.goal_id));
    return jsonb_build_object('ok', true, 'declined', true);
  end if;

  -- Accepting: check again that it is still true
  select * into g from public.season_goals x where x.id = o.goal_id and x.active;
  if not found
     or not exists (select 1 from public.communities c where c.id = g.community_id and c.active)
     or not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = o.goal_id and t.status = 'signed_off') then
    raise exception 'This offer is no longer available' using errcode = '22023';
  end if;
  if public.leader_fit_season() is null then
    raise exception 'No season is open for Tribe Cards yet. The office will open one' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = me and t.status <> 'closed') then
    raise exception 'You already have a Tribe Card' using errcode = '22023';
  end if;
  select * into p from public.people x where x.id = me;

  select a.answers into v_answers from public.leader_applications a
   where a.person_id = me and a.status = 'approved_leader' order by a.decided_at desc nulls last, a.created_at desc limit 1;
  select t.id into v_track from public.tracks t where t.slug = v_answers #>> '{calling,track}' and t.active;

  v_first := coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1));
  select c.name into v_name from public.communities c where c.id = g.community_id;
  v_name := case when coalesce(v_first, '') <> '' and v_name is not null and char_length(v_first || '’s ' || v_name || ' tribe') <= 48
                 then v_first || '’s ' || v_name || ' tribe' end;

  -- The same season, name, track and locked fields as start_tribe_card gives a card that comes from an application, with this goal
  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed)
  values (o.season_id, me, v_name, v_track, g.community_id, g.id,
          case when v_track is not null then array['track', 'community', 'goal'] else array['community', 'goal'] end)
  returning id into v_tribe;
  perform public.write_event(me, 'tribe.started', 'tribe', v_tribe::text, '{}'::jsonb);
  -- The three Success Picture lines start from the signed-off card, into empty lines only
  perform public.card_template_fill(v_tribe);

  update public.leader_offers set status = 'accepted', answered_at = now(), tribe_id = v_tribe where id = p_offer;
  perform public.write_event(me, 'leader.offer_accepted', 'leader_offer', p_offer::text, jsonb_build_object('goal', o.goal_id, 'tribe', v_tribe));
  return jsonb_build_object('ok', true, 'tribe', v_tribe);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.leader_offers_expire(), public.leader_interest_rows(uuid) from public, anon, authenticated;
revoke execute on function
  public.leader_board(), public.leader_suggest(uuid), public.leader_offer_send(uuid, uuid), public.leader_offer_withdraw(uuid),
  public.leader_offers_list(), public.my_leader_offers(), public.leader_offer_respond(uuid, boolean)
  from public, anon;
grant execute on function
  public.leader_board(), public.leader_suggest(uuid), public.leader_offer_send(uuid, uuid), public.leader_offer_withdraw(uuid),
  public.leader_offers_list(), public.my_leader_offers(), public.leader_offer_respond(uuid, boolean)
  to authenticated;

-- =============================================================================
-- United Tribes: the Leader Desk, Phase 2b-1 (recommend a leader, with backups; the member's one-tap answer; the shared appointment step; the tribe card
-- started from the draft; "Your group has a leader")
--
-- What this adds:
--
--   Leader offer      "Recommend a leader" on a draft group: one member (and up to two backups, in order) is offered the chance to lead that group. The email names
--                     the community, goal, meeting time, format, size so far and, if an interest check ran, how many have said yes. It names nobody. One private page
--                     takes the answer: Yes, I will lead (after confirming they are 21 or older and answering two short questions) / Not this season (reasons are kept
--                     private) / Call me / Remind me tomorrow / Never ask me to lead / Stop these. 72 hours to answer, reminders 24 and 12 hours before the window
--                     closes. If the first declines or the window lapses, the next backup is offered automatically, unless the owner has paused that on the draft.
--   Shared step       The leader role is given in one place only: leader_appoint_core, which god_appoint_leader now calls too. The Desk adds a yes (the member
--                     answers; nobody is appointed unasked) and a confirmed age of 21 or more. An accepted offer is recorded as an appointment, so the Leader cards
--                     board, coach assignment and card reminders work unchanged. Below the fit model's minimum the owner decides before the tribe card is made.
--   Tribe card        Started from the draft: track, community, goal, meeting slot, format, circle kind and seats (and the area, for an in-person group) are locked,
--                     so a later edit cannot move the tribe away from the people it was formed for. The leader confirms the name, the day and time inside the slot,
--                     and a general place note. A pastor still approves the card and the Academy still certifies the leader.
--   Leader found      When the leader says yes the members of the draft who have not said no get "Your group has a leader": a plain email that promises no seat,
--                     with Yes / Not for me on the private page. The place itself is confirmed by the normal "Your tribe" email when the tribe opens.
--
-- Safety rules, all kept here and not on the screen:
--   * the gates: 21 or older (confirmed by the member at yes), a member who said yes or maybe to serving, established or leading in faith, not already leading, no
--     open offer, no hold, no open care follow-up, no deletion request, a reachable email, a gender that fits a women's or men's group, meeting times that include
--     the group's slot, a goal that is not a sensitive subject, "Not this season" and "Never ask me to lead" honoured, and nobody who pressed "Stop these"
--   * offers go to members only: a leader who already holds the role is offered through the existing leader board, which this does not touch
--   * the Master pause stops every send; Rehearsal writes the offers down and sends nothing; nothing is sent on WhatsApp; no phone number is in an email, a row, an
--     event or a log; a reason chip is kept but shown to nobody by name
--   * the Desk never approves a card, never certifies a leader and never places a member
--
-- This replaces six functions and changes three tables (and widens two checks on the Desk's own sent list) (see the rollback file, which puts every one back as it was):
--   god_appoint_leader  becomes a thin wrapper over leader_appoint_core (same checks, same rows, same event)
--   save_tribe_card     keeps the slot, format, area, circle kind and seats of a Desk tribe fixed
--   desk_mail_send, worker_desk_info, worker_desk_answer, desk_tick (from 2a) learn the third kind of email, "found"
--   tribes.fixed        may also hold slot, mode, zone, kind and capacity
--   desk_proposals      may also hold the kind "found"
-- It adds tables for offers, their private links and the "never ask me to lead" list; columns for the group's leader and tribe; settings for the offer window,
-- backups and pipeline limits. Run it as the database owner, after Phase 2a (20270117000100) is applied.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.desk_need()') is null or to_regprocedure('public.desk_mail_send(text, uuid, uuid, uuid, integer, jsonb, uuid)') is null
     or to_regprocedure('public.worker_desk_answer(text, text, text, text[])') is null then
    raise exception 'The Leader Desk, Phase 2a (20270117000100_desk_proposals) must be applied first';
  end if;
  if to_regprocedure('public.god_appoint_leader(uuid, jsonb, uuid, text)') is null or to_regprocedure('public.leader_welcome_queue(uuid, text, boolean)') is null
     or to_regprocedure('public.save_tribe_card(uuid, jsonb)') is null or to_regprocedure('public.leader_fit_options(jsonb)') is null then
    raise exception 'The leader appointment, leader welcome and tribe card migrations must be applied first';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------
alter table public.desk_settings
  add column offer_hours integer not null default 72 check (offer_hours between 24 and 240),
  add column backups integer not null default 2 check (backups between 0 and 2),
  add column said_yes_days integer not null default 2 check (said_yes_days between 1 and 14),
  add column card_days integer not null default 3 check (card_days between 1 and 14);

alter table public.desk_groups
  add column leader_id uuid references public.people (id) on delete set null,
  add column tribe_id uuid references public.tribes (id) on delete set null,
  add column leader_found_at timestamptz,
  add column backups_paused boolean not null default false;
create unique index desk_groups_one_tribe on public.desk_groups (tribe_id) where tribe_id is not null;

alter table public.desk_proposals drop constraint desk_proposals_kind_check;
alter table public.desk_proposals add constraint desk_proposals_kind_check check (kind in ('tribe', 'interest', 'found'));
alter table public.desk_proposals drop constraint desk_proposals_check;
alter table public.desk_proposals add constraint desk_proposals_check
  check ((kind = 'tribe' and tribe_id is not null) or (kind in ('interest', 'found') and group_id is not null) or status in ('expired', 'cancelled', 'answered'));

-- Anyone who answered "Never ask me to lead". It ends leader offers only; "Stop these" (desk_stops) ends every Desk email.
create table public.desk_lead_stops (
  person_id uuid primary key references public.people (id) on delete cascade,
  at timestamptz not null default now()
);

-- One row for each person offered one group, in the order they are offered. Several rounds can follow each other on one group (a round is one recommendation
-- with its backups). Status: would_send (Rehearsal), queued (a backup, waiting its turn), open (the one being asked now), review (said yes, below the fit model's
-- minimum: the owner decides), accepted, declined, expired, cancelled, skipped (a backup that no longer passed the gates).
create table public.desk_offers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.desk_groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  round integer not null check (round >= 1),
  seq integer not null check (seq between 1 and 3),
  status text not null check (status in ('would_send', 'queued', 'open', 'review', 'accepted', 'declined', 'expired', 'cancelled', 'skipped')),
  rehearsal boolean not null default false,
  sent_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  window_ends_at timestamptz,
  reminded_24 timestamptz,
  reminded_12 timestamptz,
  remind_at timestamptz,
  reminded_tomorrow timestamptz,
  call_me boolean not null default false,
  answer text check (answer in ('lead', 'not_season', 'never', 'stop', 'owner')),
  reasons text[] not null default '{}' check (reasons <@ array['busy', 'family', 'not_ready', 'other_goal', 'other']::text[]),
  lead_best text check (lead_best in ('structure', 'connection', 'teaching', 'doing')),
  relation text check (relation in ('achieved', 'pursuing')),
  age_confirmed_at timestamptz,
  fit_degree integer check (fit_degree between 0 and 100),
  answered_at timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  appointment_id uuid references public.leader_appointments (id) on delete set null,
  tribe_id uuid references public.tribes (id) on delete set null,
  unique (group_id, round, seq)
);
create index desk_offers_group_idx on public.desk_offers (group_id, round, seq);
create index desk_offers_person_idx on public.desk_offers (person_id, status);
create index desk_offers_open_idx on public.desk_offers (status, window_ends_at) where status in ('open', 'review');
-- One live offer for a person at a time (Rehearsal rows are only written down and never count)
create unique index desk_offers_one_live_per_person on public.desk_offers (person_id) where status in ('open', 'review') and not rehearsal;
-- One leader for a group
create unique index desk_offers_one_accepted on public.desk_offers (group_id) where status = 'accepted';

-- The private link an offer's email carries. A reminder mints another; the raw secret is never stored.
create table public.desk_offer_links (
  token_hash text primary key,
  offer_id uuid not null references public.desk_offers (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  expires_at timestamptz not null,
  clicks integer not null default 0,
  created_at timestamptz not null default now()
);
create index desk_offer_links_offer_idx on public.desk_offer_links (offer_id);

alter table public.desk_lead_stops enable row level security;
alter table public.desk_offers enable row level security;
alter table public.desk_offer_links enable row level security;
revoke all on table public.desk_lead_stops, public.desk_offers, public.desk_offer_links from public, anon, authenticated;

-- A tribe formed from a draft may also lock its meeting slot, format, area, circle kind and seats
alter table public.tribes drop constraint tribes_fixed_check;
alter table public.tribes add constraint tribes_fixed_check
  check (fixed <@ array['track', 'community', 'goal', 'slot', 'mode', 'zone', 'kind', 'capacity']::text[]);

update public.feature_registry
   set blurb = 'An owner-only page in God Mode for members who finished the form and still have no tribe. It shows who is waiting and why, a masked phone number (opened one at a time, in calling hours), draft groups scored like tribe cards, and each member''s leadership signal. It can email a waiting member one open tribe that fits, ask the members of a draft whether it would suit them, and offer a draft group to a member to lead (with up to two backups, 72 hours to answer, started from a private page, a confirmed age of 21 or more, and the tribe card started from the draft for a pastor to approve). Rehearsal writes down what would be sent and sends nothing. It never places anyone, approves a card or certifies a leader.'
 where key = 'leader_desk';

-- ---------------------------------------------------------------------------
-- The shared appointment step
-- ---------------------------------------------------------------------------
-- The body of god_appoint_leader, moved here so the owner's appointment and the Desk's accepted offer use one code path. It does not check who is asking (each caller
-- does) and it takes the person who is acting as an argument (the signed-in owner for an appointment; the owner who made the offer, for the Desk). With a group it also
-- starts the tribe card from the draft. Not callable by anyone.
create function public.leader_appoint_core(p_person uuid, p_form jsonb, p_goal uuid, p_note text, p_actor uuid, p_group uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := p_actor;
  v_g public.desk_groups%rowtype;
  v_fixed text[] := array['track', 'community', 'goal'];
  i jsonb;
  m public.leader_fit_models := public.leader_fit_cfg();
  v_season uuid := public.leader_fit_season();
  o public.leader_fit_option;
  p public.people;
  v_track uuid;
  v_community uuid;
  v_name text;
  v_first text;
  v_tribe uuid;
  v_run uuid;
  v_id uuid := gen_random_uuid();
  v_had boolean;
  v_hidden boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if m.version is null then
    raise exception 'The pastorate needs to approve a fit model first' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023';
  end if;
  i := public.god_appointment_inputs(p_form);

  if exists (select 1 from public.leader_appointments a where a.person_id = p_person and a.status = 'active') then
    raise exception 'They are already appointed. Step them down first to appoint them to a different tribe' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    raise exception 'They already lead a tribe' using errcode = '22023';
  end if;

  select * into o from public.leader_fit_options(i) x where x.goal_id = p_goal;
  if o.goal_id is null then
    raise exception 'That tribe is not one of the options for this person' using errcode = '22023';
  end if;
  if o.care_flag then
    raise exception 'That tribe is about a sensitive subject. Say a pastor has cleared this person for it, or choose another tribe' using errcode = '22023';
  end if;

  select t.id into v_track from public.tracks t where t.slug = i ->> 'track';
  select g.community_id into v_community from public.season_goals g where g.id = p_goal;

  -- The engine run that explains the choice, and the choice itself
  v_run := public.leader_fit_record(p_person, null, i, 'appointment');
  perform public.leader_fit_apply_choice(v_run, p_goal, '{}'::uuid[], true);

  -- The leader role, only if they do not hold it already
  select exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader') into v_had;
  select coalesce(x.hidden, false) into v_hidden from public.people x where x.id = me;
  if not v_had then
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (p_person, 'leader', p.centre_id, case when v_hidden then null else me end)
    on conflict do nothing;
  end if;

  -- Their Tribe Card, started the way start_tribe_card starts one from an approved application: the track, community and goal are
  -- locked, and the three Success Picture lines come from the signed-off card where they are still empty.
  v_first := coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1));
  select c.name into v_name from public.communities c where c.id = v_community;
  v_name := case when coalesce(v_first, '') <> '' and v_name is not null and char_length(v_first || '’s ' || v_name || ' tribe') <= 48
                 then v_first || '’s ' || v_name || ' tribe' end;
  if p_group is not null then
    -- A tribe formed from a draft group: its slot, format, circle kind and seats (and the area, when the group is in person) are fixed from the start
    select * into v_g from public.desk_groups x where x.id = p_group;
    if not found then
      raise exception 'No such group' using errcode = 'P0002';
    end if;
    v_fixed := v_fixed || array['slot', 'mode', 'kind', 'capacity'] || case when v_g.zone is not null then array['zone'] else array[]::text[] end;
  end if;
  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed, slot, meeting_mode, zone, tribe_type, capacity)
  values (v_season, p_person, v_name, v_track, v_community, p_goal, v_fixed, v_g.slot, v_g.meeting_mode, v_g.zone, coalesce(v_g.tribe_type, 'mixed'), coalesce(v_g.capacity, 12))
  returning id into v_tribe;
  perform public.card_template_fill(v_tribe);

  insert into public.leader_appointments (id, person_id, appointed_by, season_id, tribe_id, season_goal_id, run_id, form, care_cleared, granted_role, note)
  values (v_id, p_person, me, v_season, v_tribe, p_goal, v_run, p_form, coalesce((p_form ->> 'care_cleared')::boolean, false), not v_had, v_note);

  perform public.write_event(me, 'leader.appointed', 'leader_appointment', v_id::text,
    jsonb_build_object('person', p_person, 'goal', p_goal, 'tribe', v_tribe, 'degree', o.degree)
      || case when p_group is null then '{}'::jsonb else jsonb_build_object('via', 'desk') end);
  return jsonb_build_object('ok', true, 'appointment', v_id, 'tribe', v_tribe, 'run', v_run, 'degree', o.degree, 'label', o.label);
end;
$$;

-- The owner's appointment: the same checks, rows and event as before, through the shared step.
create or replace function public.god_appoint_leader(p_person uuid, p_form jsonb, p_goal uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return public.leader_appoint_core(p_person, p_form, p_goal, p_note, auth.uid(), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- The tribe card keeps what a Desk tribe was formed with
-- ---------------------------------------------------------------------------
-- As before, with one change: a field the tribe locked (its slot, format, area, circle kind or seats) is ignored when the leader's form sends it, the way the track,
-- community and goal already are, and a day and time outside a locked slot is refused with the slot named.
CREATE OR REPLACE FUNCTION public.save_tribe_card(p_id uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v text;
  n integer;
  slug_id uuid;
  new_day smallint;
  new_time time;
  new_slot text;
  v_slot text;
begin
  select * into c from public.tribes where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Tribe Card not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'changes_requested') then
    raise exception 'This card has been sent. It can be edited again if the pastorate asks for changes' using errcode = '22023';
  end if;
  v_slot := c.slot;

  if f ? 'name' then
    v := nullif(btrim(coalesce(f ->> 'name', '')), '');
    if v is not null and char_length(v) not between 3 and 48 then
      raise exception 'Give the tribe a name of 3 to 48 characters' using errcode = '22023';
    end if;
    c.name := v;
  end if;

  if f ? 'tribe_type' and not ('kind' = any (c.fixed)) then
    if f ->> 'tribe_type' not in ('mixed', 'women', 'men') then
      raise exception 'Choose mixed, women only or men only' using errcode = '22023';
    end if;
    c.tribe_type := f ->> 'tribe_type';
  end if;

  if f ? 'story' then
    v := nullif(btrim(coalesce(f ->> 'story', '')), '');
    if v is not null and char_length(v) > 300 then
      raise exception 'Keep your story to 300 characters, about two lines' using errcode = '22023';
    end if;
    c.story := v;
  end if;

  if f ? 'track' and not ('track' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'track', '')), '');
    if v is null then
      c.track_id := null;
    else
      select id into slug_id from public.tracks where slug = v and active;
      if slug_id is null then raise exception 'Choose a life-stage track from the list' using errcode = '22023'; end if;
      c.track_id := slug_id;
    end if;
  end if;

  if f ? 'community' and not ('community' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'community', '')), '');
    if v is null then
      c.community_id := null;
      c.season_goal_id := null;
    else
      select id into slug_id from public.communities where slug = v and active;
      if slug_id is null then raise exception 'Choose a community from the list' using errcode = '22023'; end if;
      if slug_id is distinct from c.community_id then
        c.season_goal_id := null;
      end if;
      c.community_id := slug_id;
    end if;
  end if;

  if f ? 'goal' and not ('goal' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'goal', '')), '');
    if v is null then
      c.season_goal_id := null;
    else
      select id into slug_id from public.season_goals where slug = v and active and community_id = c.community_id;
      if slug_id is null then raise exception 'Choose a Season Goal from your community''s list' using errcode = '22023'; end if;
      c.season_goal_id := slug_id;
    end if;
  end if;

  if f ? 'meeting_day' then
    if f -> 'meeting_day' = 'null'::jsonb or btrim(coalesce(f ->> 'meeting_day', '')) = '' then
      c.meeting_day := null;
    else
      begin
        n := (f ->> 'meeting_day')::integer;
      exception when others then
        raise exception 'Choose the day of the week' using errcode = '22023';
      end;
      if n not between 0 and 6 then raise exception 'Choose the day of the week' using errcode = '22023'; end if;
      c.meeting_day := n;
    end if;
  end if;
  if f ? 'meeting_time' then
    v := nullif(btrim(coalesce(f ->> 'meeting_time', '')), '');
    if v is null then
      c.meeting_time := null;
    else
      begin
        c.meeting_time := v::time;
      exception when others then
        raise exception 'Choose a valid time' using errcode = '22023';
      end;
    end if;
  end if;
  new_day := c.meeting_day;
  new_time := c.meeting_time;
  if new_day is not null and new_time is not null then
    new_slot := public.tribe_slot_for(new_day, new_time);
    if new_slot is null then
      raise exception 'Choose a time members can make: weeknights from 7:30pm, Saturday morning, or Sunday afternoon or evening' using errcode = '22023';
    end if;
    if 'slot' = any (c.fixed) and v_slot is not null and new_slot is distinct from v_slot then
      raise exception 'This tribe was formed for % meetings. Choose a day and time inside that slot', replace(v_slot, '-', ' ') using errcode = '22023';
    end if;
    c.slot := new_slot;
  elsif 'slot' = any (c.fixed) and v_slot is not null then
    -- A tribe formed from a draft keeps its slot until the leader picks the day and time inside it
    c.slot := v_slot;
  else
    c.slot := null;
  end if;

  if f ? 'mode' and not ('mode' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'mode', '')), '');
    if v is not null and v not in ('online', 'in_person') then
      raise exception 'Choose online or in person' using errcode = '22023';
    end if;
    c.meeting_mode := v;
  end if;
  if f ? 'zone' and not ('zone' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'zone', '')), '');
    if v is not null and v not in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad') then
      raise exception 'Choose a zone from the list' using errcode = '22023';
    end if;
    c.zone := v;
  end if;
  if f ? 'place_note' then
    v := nullif(btrim(coalesce(f ->> 'place_note', '')), '');
    if v is not null and char_length(v) > 120 then
      raise exception 'Keep the area note under 120 characters' using errcode = '22023';
    end if;
    c.place_note := v;
  end if;
  if f ? 'capacity' and not ('capacity' = any (c.fixed)) then
    begin
      n := (f ->> 'capacity')::integer;
    exception when others then
      raise exception 'Seats can be 4 to 12' using errcode = '22023';
    end;
    if n not between 4 and 12 then raise exception 'Seats can be 4 to 12' using errcode = '22023'; end if;
    c.capacity := n;
  end if;

  if f ? 'god' then
    v := nullif(btrim(coalesce(f ->> 'god', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_god := v;
  end if;
  if f ? 'others' then
    v := nullif(btrim(coalesce(f ->> 'others', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_others := v;
  end if;
  if f ? 'life' then
    v := nullif(btrim(coalesce(f ->> 'life', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_life := v;
  end if;

  update public.tribes
     set name = c.name, tribe_type = c.tribe_type, story = c.story,
         track_id = c.track_id, community_id = c.community_id, season_goal_id = c.season_goal_id,
         meeting_day = c.meeting_day, meeting_time = c.meeting_time, slot = c.slot,
         meeting_mode = c.meeting_mode, zone = c.zone, place_note = c.place_note, capacity = c.capacity,
         loving_god = c.loving_god, loving_others = c.loving_others, loving_life = c.loving_life
   where id = p_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Rules for offering a group to lead (helpers, closed to every signed-in person)
-- ---------------------------------------------------------------------------
-- The words for a reason a member cannot be offered a group. The reasons the Desk's email rules give (under 18, bounced and so on) come from desk_mail_words.
create function public.desk_offer_words(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'group' then 'That group is not open for offers.'
    when 'not_candidate' then 'They are not on the Desk''s list of members who could lead: they may be under 18, already lead, or not be a member this season.'
    when 'never' then 'They asked never to be asked to lead.'
    when 'not_season' then 'They said not this season.'
    when 'serving' then 'They have not said they are open to serving.'
    when 'faith' then 'To lead a group, a member needs to be established or already leading in faith.'
    when 'open_offer' then 'They already have an offer open.'
    when 'held' then 'The church has a hold on them.'
    when 'seated' then 'They already have a place in a tribe.'
    when 'gender' then 'They do not fit a women-only or men-only group.'
    when 'time' then 'The group meets at a time they said they cannot make.'
    else public.desk_mail_words(p_code) end;
$$;

-- Why a member cannot be offered this group, or null when they can. The members the Desk lists as possible leaders are checked by the caller; p_ignore is an offer
-- of this member's own that is not to count against them (the one they are answering).
create function public.desk_offer_gate_core(p_person uuid, p_group uuid, p_ignore uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  mp public.member_profiles%rowtype;
  v text;
  v_season uuid := public.placement_season();
begin
  select * into g from public.desk_groups x where x.id = p_group;
  if not found or g.status <> 'draft' then
    return 'group';
  end if;
  select * into mp from public.member_profiles x where x.person_id = p_person;
  if not found then
    return 'not_candidate';
  end if;
  v := public.desk_mail_block(p_person);
  if v is not null then
    return v;
  end if;
  if exists (select 1 from public.desk_lead_stops s where s.person_id = p_person) then
    return 'never';
  end if;
  if exists (select 1 from public.desk_offers o where o.person_id = p_person and o.season_id = v_season and o.answer = 'not_season' and not o.rehearsal) then
    return 'not_season';
  end if;
  if mp.open_to_serving::text not in ('yes', 'maybe') then
    return 'serving';
  end if;
  if mp.faith_journey::text not in ('established', 'leading') then
    return 'faith';
  end if;
  if exists (select 1 from public.desk_offers o where o.person_id = p_person and o.status in ('open', 'review') and not o.rehearsal and o.id is distinct from p_ignore) then
    return 'open_offer';
  end if;
  if exists (select 1 from public.placement_holds h where h.person_id = p_person and (h.until is null or h.until > now())) then
    return 'held';
  end if;
  if exists (select 1 from public.tribe_members m where m.person_id = p_person and m.season_id = v_season and m.status = 'active') then
    return 'seated';
  end if;
  if (g.tribe_type = 'women' and mp.gender::text <> 'female') or (g.tribe_type = 'men' and mp.gender::text <> 'male') then
    return 'gender';
  end if;
  if cardinality(mp.meeting_times) > 0 and not (g.slot = any (mp.meeting_times)) then
    return 'time';
  end if;
  if exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader'))
     or exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    return 'not_candidate';
  end if;
  return null;
end;
$$;

-- Whether a person is one the Desk may offer anything to this season: a member (never a leader, an assistant or the owner), 18 or older, with a profile for this
-- season, no open deletion request, no active seat, no hold. This is the same list the Desk's pages build with desk_base, but asked about one person and without
-- needing a signed-in user, because the private page and the heartbeat have none.
create function public.desk_offer_member_ok(p_person uuid, p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.member_profiles mp
      join public.people p on p.id = mp.person_id
      join public.age_ranges ar on ar.id = mp.age_range_id
     where mp.person_id = p_person
       and (mp.season_id is null or mp.season_id = p_season)
       and not p.hidden
       and (ar.max_age is null or ar.max_age >= 18)
       and exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'member')
       and not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader'))
       and not exists (select 1 from public.platform_owner o where o.person_id = p_person)
       and not exists (select 1 from public.erasure_requests e where e.person_id = p_person and e.status = 'open')
       and not exists (select 1 from public.tribe_members m where m.person_id = p_person and m.season_id = p_season and m.status = 'active')
       and not exists (select 1 from public.placement_holds h where h.person_id = p_person and (h.until is null or h.until > now())));
$$;

-- The full check: a member the Desk may offer things to, and past every gate. Null when they can be offered the group.
create function public.desk_offer_gate(p_person uuid, p_group uuid, p_ignore uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.desk_offer_member_ok(p_person, public.placement_season()) then 'not_candidate'
              else public.desk_offer_gate_core(p_person, p_group, p_ignore) end;
$$;

-- What stops a leader being offered this group at all, in words, or null. (Who is offered is checked apart, one person at a time.)
create function public.desk_offer_problem(p_group uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
begin
  select * into g from public.desk_groups x where x.id = p_group;
  if not found or g.status <> 'draft' then
    return public.desk_offer_words('group');
  end if;
  if g.leader_id is not null then
    return 'This group already has a leader.';
  end if;
  if g.community_id is null or g.season_goal_id is null then
    return 'Choose the community and the goal of this group first. A leader is offered a named goal.';
  end if;
  if not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = g.season_goal_id and t.status = 'signed_off') then
    return 'That goal''s tribe card is not signed off yet, so a leader cannot be offered it.';
  end if;
  if exists (select 1 from public.tribe_card_templates t where t.season_goal_id = g.season_goal_id and t.status = 'signed_off' and t.sensitive) then
    return 'That goal is about a sensitive subject. Appoint a leader for it from Appointments, where you can record a pastor''s clearance.';
  end if;
  if exists (select 1 from public.desk_offers o where o.group_id = p_group and not o.rehearsal and o.status in ('open', 'queued', 'review')) then
    return 'An offer is already out for this group. Withdraw it first.';
  end if;
  return null;
end;
$$;

-- What the leader offer and its page carry. Names nobody: only the group and a count of how many have said yes, when an interest check ran.
create function public.desk_offer_params(p_group uuid, p_person uuid, p_ends timestamptz, p_reminder text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'offer',
    'first', public.first_name_of(p_person),
    'community', (select c.name from public.communities c where c.id = g.community_id),
    'goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
    'slot', g.slot,
    'mode', g.meeting_mode,
    'zone', g.zone,
    'capacity', g.capacity,
    'members', (select count(*)::integer from public.desk_group_members m where m.group_id = g.id and m.person_id <> p_person),
    'asked', exists (select 1 from public.desk_proposals x where x.group_id = g.id and x.kind = 'interest' and not x.rehearsal and x.status <> 'cancelled'),
    'yes', (select count(*)::integer from public.desk_group_members m
             where m.group_id = g.id and m.person_id <> p_person
               and exists (select 1 from public.desk_proposals x where x.group_id = g.id and x.person_id = m.person_id and x.kind = 'interest' and x.answer = 'yes')),
    'hours', (select s.offer_hours from public.desk_settings s where s.id),
    'ends', to_char(p_ends at time zone 'Africa/Lagos', 'FMDay FMDD FMMonth "at" FMHH12:MI am'),
    'reminder', p_reminder)
    from public.desk_groups g where g.id = p_group;
$$;

create function public.desk_offer_link_mint(p_offer uuid, p_person uuid, p_until timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.desk_offer_links (token_hash, offer_id, person_id, expires_at)
  values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), p_offer, p_person, p_until);
  return v_raw;
end;
$$;

create function public.desk_offer_link_offer(p_link text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select k.offer_id from public.desk_offer_links k
   where p_link ~ '^[a-f0-9]{64}$' and k.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex') and k.expires_at > now();
$$;

-- Starts the window for an offer that is next in line, and emails it. The window runs from the moment the email can go (9 am if it is asked for out of hours).
create function public.desk_offer_open(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
  s public.desk_settings%rowtype;
  v_at timestamptz := public.desk_send_at();
  v_ends timestamptz;
  v_link text;
  v_msg uuid;
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  select * into s from public.desk_settings x where x.id;
  v_ends := v_at + make_interval(hours => s.offer_hours);
  update public.desk_offers set status = 'open', opened_at = v_at, window_ends_at = v_ends where id = p_offer;
  -- The link outlives the window by a week, so "Stop these" and "Never ask me to lead" keep working
  v_link := public.desk_offer_link_mint(p_offer, o.person_id, v_ends + interval '7 days');
  v_msg := public.enqueue_message(o.person_id, 'desk_offer', public.desk_offer_params(o.group_id, o.person_id, v_ends, null) || jsonb_build_object('stop', true),
                                  null, 'desk-offer:' || p_offer::text, v_at, 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
    update public.desk_offers set message_id = v_msg where id = p_offer;
  end if;
end;
$$;

-- Ends an offer that is no longer wanted: its links stop working and an email still waiting to go is not sent.
create function public.desk_offer_close(p_offer uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  update public.desk_offers set status = p_status where id = p_offer;
  if p_status in ('cancelled', 'expired', 'skipped') then
    delete from public.desk_offer_links where offer_id = p_offer;
  end if;
  update public.messages set status = 'skipped', error = 'The offer ended', reply_token = null
   where status = 'queued' and template = 'desk_offer' and dedupe_key like 'desk-offer:' || p_offer::text || '%';
end;
$$;

-- The next backup, when the one before it said no, did not answer in time or was withdrawn. Does nothing when the owner has paused backups, when the group has a
-- leader or has been archived, or when an offer is already out. A backup who no longer passes the gates is skipped, and the next one is tried.
create function public.desk_offer_advance(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  o public.desk_offers%rowtype;
  v_code text;
begin
  select * into g from public.desk_groups x where x.id = p_group for update;
  if not found or g.status <> 'draft' or g.leader_id is not null or g.backups_paused then
    return;
  end if;
  loop
    if exists (select 1 from public.desk_offers x where x.group_id = p_group and not x.rehearsal and x.status in ('open', 'review')) then
      return;
    end if;
    select * into o from public.desk_offers x
     where x.group_id = p_group and not x.rehearsal and x.status = 'queued'
       and x.round = (select max(y.round) from public.desk_offers y where y.group_id = p_group and not y.rehearsal)
     order by x.seq limit 1;
    if not found then
      return;
    end if;
    v_code := public.desk_offer_gate(o.person_id, p_group);
    if v_code is not null or public.desk_mail_state(o.person_id) <> 'on' then
      perform public.desk_offer_close(o.id, 'skipped');
      continue;
    end if;
    perform public.desk_offer_open(o.id);
    return;
  end loop;
end;
$$;

-- What "Your group has a leader" and its page carry. The leader's first name, never anything else about them.
create function public.desk_found_params(p_group uuid, p_person uuid, p_leader uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'found',
    'first', public.first_name_of(p_person),
    'community', (select c.name from public.communities c where c.id = g.community_id),
    'goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
    'slot', g.slot,
    'mode', g.meeting_mode,
    'zone', g.zone,
    'capacity', g.capacity,
    'leader_first', public.first_name_of(p_leader))
    from public.desk_groups g where g.id = p_group;
$$;

-- The leader has said yes and the tribe card has been started: tell the draft's members, queue the leader's welcome, and close the other offers. One place, used by
-- the member's own yes and by the owner approving a yes that came in below the fit model's minimum.
create function public.desk_offer_complete(p_offer uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
  g public.desk_groups%rowtype;
  v_form jsonb;
  v_res jsonb;
  v_tribe uuid;
  v_appt uuid;
  m record;
  v_ver text;
  v_welcome jsonb := jsonb_build_object('queued', false, 'reason', 'not_approved');
  v_found integer := 0;
  v_name text;
  v_season uuid := public.placement_season();
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  select * into g from public.desk_groups x where x.id = o.group_id for update;
  if o.status not in ('open', 'review') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if g.status <> 'draft' or g.leader_id is not null then
    perform public.desk_offer_close(p_offer, 'cancelled');
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  v_form := jsonb_build_object(
    'track', (select t.slug from public.tracks t where t.id = g.track_id),
    'lead_best', o.lead_best,
    'community', (select c.slug from public.communities c where c.id = g.community_id),
    'goal', (select sg.slug from public.season_goals sg where sg.id = g.season_goal_id),
    'relation', o.relation);
  v_res := public.leader_appoint_core(o.person_id, v_form, g.season_goal_id, null, p_actor, g.id);
  v_tribe := (v_res ->> 'tribe')::uuid;
  v_appt := (v_res ->> 'appointment')::uuid;

  update public.desk_offers set status = 'accepted', answer = 'lead', answered_at = coalesce(answered_at, now()), tribe_id = v_tribe, appointment_id = v_appt where id = p_offer;
  update public.desk_groups set leader_id = o.person_id, tribe_id = v_tribe, leader_found_at = now() where id = g.id;
  -- The backups are not needed now
  for m in select x.id from public.desk_offers x where x.group_id = g.id and x.id <> p_offer and x.status in ('queued', 'open', 'review') loop
    perform public.desk_offer_close(m.id, 'cancelled');
  end loop;
  delete from public.desk_group_members where group_id = g.id and person_id = o.person_id;

  -- The leader's welcome: the one the church already approved, else the short note a bulk appointment sends
  select s.approved_version into v_ver from public.leader_welcome_settings s where s.id;
  if v_ver is not null then
    v_welcome := public.leader_welcome_queue(v_tribe, v_ver);
  end if;
  if not coalesce((v_welcome ->> 'queued')::boolean, false) and coalesce(v_welcome ->> 'reason', '') <> 'already_sent' then
    select t.name into v_name from public.tribes t where t.id = v_tribe;
    perform public.enqueue_message(o.person_id, 'placement_leader_appointed',
      jsonb_build_object('goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
                         'community', (select c.name from public.communities c where c.id = g.community_id), 'tribe', v_name,
                         'fit', public.leader_fit_word(coalesce(o.fit_degree, 100))),
      v_tribe, 'leader-appointed:' || v_tribe, p_force => 'email');
  end if;

  -- "Your group has a leader", to each member of the draft still waiting who has not said no and whom the Desk may write to
  for m in select d.person_id from public.desk_group_members d where d.group_id = g.id and d.person_id <> o.person_id order by d.added_at, d.person_id loop
    if public.desk_mail_state(m.person_id) not in ('on', 'rehearsal') or public.desk_mail_block(m.person_id) is not null then
      continue;
    end if;
    if v_season is null or not public.desk_offer_member_ok(m.person_id, v_season) then
      continue;
    end if;
    perform public.desk_mail_send('found', m.person_id, null, g.id, null, public.desk_found_params(g.id, m.person_id, o.person_id), p_actor);
    v_found := v_found + 1;
  end loop;

  perform public.write_event(p_actor, 'desk.offer_accepted', 'desk_group', g.id::text, jsonb_build_object('members_told', v_found));
  return jsonb_build_object('ok', true, 'tribe', v_tribe, 'told', v_found, 'welcome', v_welcome ->> 'reason');
end;
$$;

-- A yes arrives: below the fit model's minimum (or for a goal the fit engine does not list for them) the owner decides; otherwise the appointment goes ahead.
create function public.desk_offer_accept(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
  g public.desk_groups%rowtype;
  m public.leader_fit_models := public.leader_fit_cfg();
  v_in jsonb;
  opt public.leader_fit_option;
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  select * into g from public.desk_groups x where x.id = o.group_id;
  v_in := public.god_appointment_inputs(jsonb_build_object(
    'track', (select t.slug from public.tracks t where t.id = g.track_id),
    'lead_best', o.lead_best,
    'community', (select c.slug from public.communities c where c.id = g.community_id),
    'goal', (select sg.slug from public.season_goals sg where sg.id = g.season_goal_id),
    'relation', o.relation));
  select * into opt from public.leader_fit_options(v_in) x where x.goal_id = g.season_goal_id;
  update public.desk_offers set fit_degree = opt.degree where id = p_offer;
  if opt.goal_id is null or opt.care_flag or m.version is null or opt.degree < m.min_degree then
    update public.desk_offers set status = 'review', answer = 'lead', answered_at = now() where id = p_offer;
    perform public.write_event(null, 'desk.offer_review', 'desk_group', g.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'answer', 'lead', 'review', true);
  end if;
  return public.desk_offer_complete(p_offer, o.sent_by) || jsonb_build_object('answer', 'lead');
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's side
-- ---------------------------------------------------------------------------
-- The members the Desk would offer this group to, best first: the three pools by signal, each already past every gate. A reason the group cannot be offered a leader
-- at all comes back as "problem", and the list is empty.
create function public.desk_offer_candidates(p_group uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_season uuid := public.placement_season();
  v_problem text;
  v_rows jsonb;
begin
  perform public.desk_need();
  if not exists (select 1 from public.desk_groups x where x.id = p_group) then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  v_problem := public.desk_offer_problem(p_group);
  if v_problem is not null or v_season is null then
    return jsonb_build_object('problem', coalesce(v_problem, 'No season is open'), 'rows', '[]'::jsonb);
  end if;
  with lead as materialized (select * from public.desk_lead_base(v_season) b)
  select coalesce(jsonb_agg(y.j order by y.rank, y.score desc, y.person_id), '[]'::jsonb)
    into v_rows
    from (
      select case l.pool when 'ready' then 1 when 'almost' then 2 else 3 end as rank, l.score, l.person_id,
             jsonb_build_object(
               'person_id', l.person_id,
               'name', public.person_display_name(l.person_id),
               'score', l.score,
               'pool', l.pool,
               'notes', public.desk_lead_notes(l.serving, l.faith, l.weeks_seen, l.weeks_present, l.steps_seen, l.steps_done, l.named_n),
               'in_group', exists (select 1 from public.desk_group_members m where m.group_id = p_group and m.person_id = l.person_id),
               'phone', public.placed_desk_mask(public.placed_held_number(l.person_id)),
               'has_number', public.placed_held_number(l.person_id) is not null) as j
        from lead l
       where public.desk_offer_gate_core(l.person_id, p_group) is null
       order by 1, l.score desc, l.person_id
       limit v_limit) y;
  return jsonb_build_object('problem', null, 'rows', v_rows);
end;
$$;

-- Offers the group to up to three members, in the order given: the first is asked now, the others wait their turn. In Rehearsal it is only written down.
create function public.desk_offer_send(p_group uuid, p_people uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.desk_settings%rowtype;
  g public.desk_groups%rowtype;
  v_people uuid[];
  v_n integer;
  v_problem text;
  v_code text;
  v_p uuid;
  v_i integer := 0;
  v_state text;
  v_rehearsal boolean;
  v_round integer;
  v_id uuid;
  v_first uuid;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group for update;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  select * into s from public.desk_settings x where x.id;
  select coalesce(array_agg(d.x order by d.o), '{}') into v_people
    from (select distinct on (u.x) u.x, u.o from unnest(coalesce(p_people, '{}')) with ordinality as u(x, o) where u.x is not null order by u.x, u.o) d;
  v_n := cardinality(v_people);
  if v_n < 1 or v_n > 1 + s.backups then
    raise exception 'Choose 1 to % people: one to ask now and up to % to ask in turn if they say no', 1 + s.backups, s.backups using errcode = '22023';
  end if;
  v_problem := public.desk_offer_problem(p_group);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  foreach v_p in array v_people loop
    v_code := public.desk_offer_gate(v_p, p_group);
    if v_code is not null then
      raise exception '%: %', public.person_display_name(v_p), public.desk_offer_words(v_code) using errcode = '22023';
    end if;
  end loop;
  v_first := v_people[1];
  v_state := public.desk_mail_state(v_first);
  if v_state not in ('on', 'rehearsal') then
    raise exception '%', public.desk_mail_words('off') using errcode = '22023';
  end if;
  v_rehearsal := v_state = 'rehearsal';
  -- The Desk's limit of emails a day is shared with its other emails
  if (select count(*) from public.desk_proposals x where x.rehearsal = v_rehearsal and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos())
   + (select count(*) from public.desk_offers x where x.rehearsal = v_rehearsal and x.status <> 'queued' and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos())
     >= s.daily_cap then
    raise exception '%', public.desk_mail_words('day') using errcode = '22023';
  end if;
  select coalesce(max(x.round), 0) + 1 into v_round from public.desk_offers x where x.group_id = p_group;
  foreach v_p in array v_people loop
    v_i := v_i + 1;
    insert into public.desk_offers (group_id, person_id, season_id, round, seq, status, rehearsal, sent_by)
    values (p_group, v_p, g.season_id, v_round, v_i, case when v_rehearsal then 'would_send' else 'queued' end, v_rehearsal, me)
    returning id into v_id;
    if v_i = 1 and not v_rehearsal then
      perform public.desk_offer_open(v_id);
    end if;
  end loop;
  update public.desk_groups set backups_paused = false where id = p_group;
  perform public.write_event(me, 'desk.offer_sent', 'desk_group', p_group::text, jsonb_build_object('people', v_n, 'mode', v_state));
  return jsonb_build_object('ok', true, 'status', case when v_rehearsal then 'would_send' else 'open' end, 'people', v_n, 'round', v_round);
end;
$$;

-- Withdraws one offer that has not been answered. With p_all, every offer still out for that group goes with it. Otherwise the next backup is asked, unless backups
-- are paused.
create function public.desk_offer_cancel(p_offer uuid, p_all boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
  x record;
begin
  perform public.desk_need();
  select * into o from public.desk_offers y where y.id = p_offer for update;
  if not found then
    raise exception 'No such offer' using errcode = 'P0002';
  end if;
  if o.status not in ('would_send', 'queued', 'open') then
    raise exception 'That offer has already been answered or has ended' using errcode = '22023';
  end if;
  if coalesce(p_all, false) then
    for x in select y.id from public.desk_offers y where y.group_id = o.group_id and y.round = o.round and y.status in ('would_send', 'queued', 'open') loop
      perform public.desk_offer_close(x.id, 'cancelled');
    end loop;
  else
    perform public.desk_offer_close(o.id, 'cancelled');
    if o.status = 'open' then
      perform public.desk_offer_advance(o.group_id);
    end if;
  end if;
  perform public.write_event(auth.uid(), 'desk.offer_cancelled', 'desk_group', o.group_id::text, jsonb_build_object('all', coalesce(p_all, false)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Stops (or restarts) the automatic asking of backups on one group.
create function public.desk_offers_pause(p_group uuid, p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.desk_need();
  if p_paused is null then
    raise exception 'Say whether to pause or resume' using errcode = '22023';
  end if;
  update public.desk_groups set backups_paused = p_paused where id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if not p_paused then
    perform public.desk_offer_advance(p_group);
  end if;
  perform public.write_event(auth.uid(), 'desk.offers_paused', 'desk_group', p_group::text, jsonb_build_object('paused', p_paused));
  return jsonb_build_object('ok', true, 'paused', p_paused);
end;
$$;

-- A member said yes below the fit model's minimum (or for a goal the fit engine does not list for them): the owner appoints them, or declines for them.
create function public.desk_offer_review(p_offer uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.desk_offers%rowtype;
begin
  perform public.desk_need();
  if p_approve is null then
    raise exception 'Say whether to appoint them or not' using errcode = '22023';
  end if;
  select * into o from public.desk_offers y where y.id = p_offer for update;
  if not found then
    raise exception 'No such offer' using errcode = 'P0002';
  end if;
  if o.status <> 'review' then
    raise exception 'That offer is not waiting for your decision' using errcode = '22023';
  end if;
  if p_approve then
    return public.desk_offer_complete(p_offer, auth.uid());
  end if;
  update public.desk_offers set status = 'declined', answer = 'owner', answered_at = now() where id = p_offer;
  delete from public.desk_offer_links where offer_id = p_offer;
  perform public.desk_offer_advance(o.group_id);
  perform public.write_event(auth.uid(), 'desk.offer_review', 'desk_group', o.group_id::text, jsonb_build_object('approved', false));
  return jsonb_build_object('ok', true, 'approved', false);
end;
$$;

-- Where one draft stands on its leader: whether one can be offered, the offers so far, the leader if there is one, and whether the owner has to decide what to do.
create function public.desk_group_leader(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  v_last integer;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  select max(x.round) into v_last from public.desk_offers x where x.group_id = p_group and not x.rehearsal;
  return jsonb_build_object(
    'problem', public.desk_offer_problem(p_group),
    'paused', g.backups_paused,
    'leader', case when g.leader_id is null then null else jsonb_build_object(
        'person_id', g.leader_id, 'name', public.person_display_name(g.leader_id), 'found_at', g.leader_found_at, 'tribe_id', g.tribe_id,
        'tribe_status', (select t.status::text from public.tribes t where t.id = g.tribe_id),
        'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = g.leader_id)) end,
    'needs_decision', g.leader_id is null and g.status = 'draft' and v_last is not null
        and not exists (select 1 from public.desk_offers x where x.group_id = p_group and x.round = v_last and not x.rehearsal and x.status in ('queued', 'open', 'review', 'accepted')),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'round', x.round, 'seq', x.seq, 'person_id', x.person_id, 'name', public.person_display_name(x.person_id), 'status', x.status,
               'rehearsal', x.rehearsal, 'opened_at', x.opened_at, 'window_ends_at', x.window_ends_at, 'call_me', x.call_me, 'answer', x.answer,
               'fit', x.fit_degree,
               'phone', public.placed_desk_mask(public.placed_held_number(x.person_id)), 'has_number', public.placed_held_number(x.person_id) is not null)
             order by x.round desc, x.seq)
        from (select * from public.desk_offers y where y.group_id = p_group order by y.round desc, y.seq limit 12) x), '[]'::jsonb));
end;
$$;

-- Every offer, newest first, with counts. Reasons are only ever counted; nobody's own reason is shown.
create function public.desk_offers_list(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.desk_need();
  return jsonb_build_object(
    'total', (select count(*)::integer from public.desk_offers),
    'counts', jsonb_build_object(
      'open', (select count(*)::integer from public.desk_offers x where x.status = 'open'),
      'review', (select count(*)::integer from public.desk_offers x where x.status = 'review'),
      'accepted', (select count(*)::integer from public.desk_offers x where x.status = 'accepted'),
      'declined', (select count(*)::integer from public.desk_offers x where x.status = 'declined'),
      'expired', (select count(*)::integer from public.desk_offers x where x.status = 'expired'),
      'would_send', (select count(*)::integer from public.desk_offers x where x.status = 'would_send'),
      'call_me', (select count(*)::integer from public.desk_offers x where x.status = 'open' and x.call_me)),
    'reasons', jsonb_build_object(
      'busy', (select count(*)::integer from public.desk_offers x where 'busy' = any (x.reasons)),
      'family', (select count(*)::integer from public.desk_offers x where 'family' = any (x.reasons)),
      'not_ready', (select count(*)::integer from public.desk_offers x where 'not_ready' = any (x.reasons)),
      'other_goal', (select count(*)::integer from public.desk_offers x where 'other_goal' = any (x.reasons)),
      'other', (select count(*)::integer from public.desk_offers x where 'other' = any (x.reasons))),
    'rows', coalesce((
      select jsonb_agg(j.o order by j.at desc, j.id)
        from (
          select x.created_at as at, x.id,
                 jsonb_build_object(
                   'id', x.id, 'group_id', x.group_id, 'group', g.name, 'person_id', x.person_id, 'name', public.person_display_name(x.person_id),
                   'seq', x.seq, 'status', x.status, 'rehearsal', x.rehearsal, 'answer', x.answer, 'call_me', x.call_me, 'fit', x.fit_degree,
                   'at', x.created_at, 'window_ends_at', x.window_ends_at,
                   'phone', public.placed_desk_mask(public.placed_held_number(x.person_id)),
                   'has_number', public.placed_held_number(x.person_id) is not null) as o
            from public.desk_offers x join public.desk_groups g on g.id = x.group_id
           order by x.created_at desc, x.id
           limit v_limit offset v_offset) j), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The heartbeat's step for offers
-- ---------------------------------------------------------------------------
-- Offers for a group that has been archived or found its leader end. An offer whose window ran out is marked expired and the next backup is asked. An offer still
-- open gets a reminder 24 and 12 hours before its window closes (and one the next day, if the member asked for it).
create function public.desk_offer_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_ended integer := 0;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_links integer;
  v_kind text;
  v_link text;
  v_msg uuid;
  v_at timestamptz;
begin
  for r in select o.id from public.desk_offers o join public.desk_groups g on g.id = o.group_id
            where o.status in ('queued', 'open', 'review') and not o.rehearsal and (g.status <> 'draft' or g.leader_id is not null) loop
    perform public.desk_offer_close(r.id, 'cancelled');
    v_ended := v_ended + 1;
  end loop;
  for r in select o.id, o.group_id from public.desk_offers o where o.status = 'open' and o.window_ends_at < now() loop
    perform public.desk_offer_close(r.id, 'expired');
    perform public.write_event(null, 'desk.offer_expired', 'desk_group', r.group_id::text, '{}'::jsonb);
    perform public.desk_offer_advance(r.group_id);
    v_expired := v_expired + 1;
  end loop;
  for r in
    select o.*, case when o.reminded_24 is null and now() >= o.window_ends_at - interval '24 hours' and now() < o.window_ends_at - interval '12 hours'
                          and o.opened_at < o.window_ends_at - interval '25 hours' then '24'
                     when o.reminded_12 is null and now() >= o.window_ends_at - interval '12 hours' and now() < o.window_ends_at - interval '1 hour'
                          and o.opened_at < o.window_ends_at - interval '13 hours' then '12'
                     when o.remind_at is not null and o.reminded_tomorrow is null and o.remind_at <= now() and o.window_ends_at > now() + interval '1 hour' then 'tomorrow'
                end as due
      from public.desk_offers o
     where o.status = 'open' and not o.rehearsal and o.window_ends_at > now()
  loop
    v_kind := r.due;
    if v_kind is null or public.desk_mail_state(r.person_id) <> 'on' or public.desk_mail_block(r.person_id) is not null then
      continue;
    end if;
    v_at := public.desk_send_at();
    v_link := public.desk_offer_link_mint(r.id, r.person_id, r.window_ends_at + interval '7 days');
    v_msg := public.enqueue_message(r.person_id, 'desk_offer', public.desk_offer_params(r.group_id, r.person_id, r.window_ends_at, v_kind) || jsonb_build_object('stop', true),
                                    null, 'desk-offer:' || r.id::text || ':r' || v_kind, v_at, 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
    end if;
    update public.desk_offers set reminded_24 = case when v_kind = '24' then now() else reminded_24 end,
                                  reminded_12 = case when v_kind = '12' then now() else reminded_12 end,
                                  reminded_tomorrow = case when v_kind = 'tomorrow' then now() else reminded_tomorrow end
     where id = r.id;
    v_reminded := v_reminded + 1;
  end loop;
  delete from public.desk_offer_links where expires_at < now();
  get diagnostics v_links = row_count;
  return jsonb_build_object('offers_ended', v_ended, 'offers_expired', v_expired, 'offers_reminded', v_reminded, 'offer_links', v_links);
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced from Phase 2a: the third kind of email, "found"
-- ---------------------------------------------------------------------------
create or replace function public.desk_mail_send(p_kind text, p_person uuid, p_tribe uuid, p_group uuid, p_degree integer, p_params jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.desk_settings%rowtype;
  v_state text := public.desk_mail_state(p_person);
  v_id uuid;
  v_msg uuid;
  v_link text;
  v_expires timestamptz;
  v_status text;
begin
  if v_state not in ('on', 'rehearsal') then
    raise exception '%', public.desk_mail_words('off') using errcode = '22023';
  end if;
  select * into s from public.desk_settings x where x.id;
  v_expires := now() + case p_kind when 'interest' then make_interval(hours => s.interest_hours) else interval '7 days' end;
  v_status := case when v_state = 'rehearsal' then 'would_send' else 'sent' end;
  insert into public.desk_proposals (kind, person_id, season_id, tribe_id, group_id, rehearsal, status, degree, created_by, expires_at)
  values (p_kind, p_person, public.placement_season(), p_tribe, p_group, v_state = 'rehearsal', v_status, p_degree, p_actor, v_expires)
  returning id into v_id;
  if v_state = 'on' then
    -- The link outlives the question by 30 days, so "Stop these" keeps working
    v_link := public.desk_link_mint(v_id, p_person, 30 + 7);
    v_msg := public.enqueue_message(p_person, case p_kind when 'interest' then 'desk_interest' when 'found' then 'desk_found' else 'desk_proposal' end,
      p_params || jsonb_build_object('stop', true), p_tribe, 'desk:' || v_id::text, public.desk_send_at(), 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
      update public.desk_proposals set message_id = v_msg where id = v_id;
    end if;
  end if;
  perform public.write_event(p_actor, 'desk.proposal', 'person', p_person::text, jsonb_build_object('kind', p_kind, 'mode', v_state));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

create or replace function public.worker_desk_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  x public.desk_proposals%rowtype;
  v_open boolean;
  v_params jsonb;
  v_block text;
begin
  perform public.worker_ok(p_token);
  v_id := public.desk_link_proposal(p_link);
  if v_id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into x from public.desk_proposals y where y.id = v_id;
  update public.desk_links set clicks = clicks + 1 where token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  v_block := public.desk_mail_block(x.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('found', false);
  end if;
  v_open := x.status = 'sent' and now() < x.expires_at and public.desk_mail_state(x.person_id) = 'on';
  v_params := case when not v_open then null
                   when x.kind = 'tribe' then public.desk_tribe_params(x.person_id, x.tribe_id)
                   when x.kind = 'found' then (select public.desk_found_params(x.group_id, x.person_id, g.leader_id)
                                                 from public.desk_groups g
                                                where g.id = x.group_id and g.leader_id is not null
                                                  and exists (select 1 from public.desk_group_members m where m.group_id = g.id and m.person_id = x.person_id))
                   else public.desk_interest_params(x.group_id, x.person_id) end;
  if v_open and v_params is null then
    v_open := false;
  end if;
  return jsonb_build_object('found', true, 'kind', x.kind, 'open', v_open, 'first', public.first_name_of(x.person_id),
    'answered', x.status = 'answered', 'answer', x.answer, 'slots', to_jsonb(x.slots), 'stopped', coalesce(v_block = 'stopped', false),
    'expires_at', x.expires_at, 'details', coalesce(v_params, '{}'::jsonb));
end;
$$;

create or replace function public.worker_desk_answer(p_token text, p_link text, p_answer text, p_slots text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  x public.desk_proposals%rowtype;
  v_slots text[] := coalesce(p_slots, '{}');
  v_block text;
  r record;
begin
  perform public.worker_ok(p_token);
  if p_answer is null or p_answer not in ('yes', 'no', 'other_time', 'stop')
     or not (v_slots <@ array['sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning'])
     or cardinality(v_slots) > 4
     or (p_answer = 'other_time' and cardinality(v_slots) = 0)
     or (p_answer <> 'other_time' and cardinality(v_slots) > 0) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_id := public.desk_link_proposal(p_link);
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into x from public.desk_proposals y where y.id = v_id for update;
  v_block := public.desk_mail_block(x.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if p_answer = 'stop' then
    insert into public.desk_stops (person_id) values (x.person_id) on conflict do nothing;
    update public.desk_proposals set status = case when status in ('sent', 'would_send') then 'answered' else status end,
           answer = case when status in ('sent', 'would_send') then 'stop' else answer end,
           answered_at = case when status in ('sent', 'would_send') then now() else answered_at end
     where id = x.id;
    -- Anything else the Desk has open for this member ends too
    update public.desk_proposals set status = 'cancelled' where person_id = x.person_id and status in ('sent', 'would_send') and id <> x.id;
    update public.messages set status = 'skipped', error = 'Stopped by the member', reply_token = null
     where person_id = x.person_id and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer') and status = 'queued';
    -- A leader offer to this member ends too, and the next backup, if there is one, is asked
    for r in select o.id, o.group_id, o.status from public.desk_offers o where o.person_id = x.person_id and o.status in ('queued', 'open', 'review') loop
      perform public.desk_offer_close(r.id, 'cancelled');
      if r.status in ('open', 'review') then
        perform public.desk_offer_advance(r.group_id);
      end if;
    end loop;
    perform public.write_event(null, 'desk.stop', 'person', x.person_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'answer', 'stop');
  end if;

  if x.status = 'answered' then
    return jsonb_build_object('ok', true, 'answer', x.answer, 'again', true);
  end if;
  if x.status <> 'sent' or now() >= x.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if public.desk_mail_state(x.person_id) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if (x.kind = 'tribe' and p_answer <> 'no') or (x.kind = 'found' and p_answer not in ('yes', 'no')) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;

  update public.desk_proposals set status = 'answered', answer = p_answer, slots = v_slots, answered_at = now() where id = x.id;
  if x.kind in ('interest', 'found') and p_answer in ('no', 'other_time') then
    delete from public.desk_group_members where group_id = x.group_id and person_id = x.person_id;
  end if;
  perform public.write_event(null, 'desk.answer', 'person', x.person_id::text, jsonb_build_object('kind', x.kind, 'answer', p_answer));
  return jsonb_build_object('ok', true, 'answer', p_answer);
end;
$$;

create or replace function public.desk_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_links integer;
  v_cleared integer;
  v_offers jsonb;
begin
  v_offers := public.desk_offer_tick();
  update public.desk_proposals set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_expired = row_count;
  delete from public.desk_links where expires_at < now();
  get diagnostics v_links = row_count;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('expired', v_expired, 'links', v_links, 'cleared', v_cleared) || v_offers;
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's side of a leader offer: the private page, with no sign-in. Each call needs the sending token and the link's secret.
-- ---------------------------------------------------------------------------
-- What the page shows. Opening the page saves nothing except that the link was opened.
create function public.worker_desk_offer_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  o public.desk_offers%rowtype;
  v_open boolean;
  v_block text;
begin
  perform public.worker_ok(p_token);
  v_id := public.desk_offer_link_offer(p_link);
  if v_id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into o from public.desk_offers y where y.id = v_id;
  update public.desk_offer_links set clicks = clicks + 1 where token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  v_block := public.desk_mail_block(o.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('found', false);
  end if;
  v_open := o.status = 'open' and now() < o.window_ends_at and public.desk_mail_state(o.person_id) = 'on';
  return jsonb_build_object('found', true, 'open', v_open, 'status', o.status, 'first', public.first_name_of(o.person_id), 'answer', o.answer,
    'call_me', o.call_me, 'reminder_set', o.remind_at is not null, 'stopped', coalesce(v_block = 'stopped', false), 'ends', o.window_ends_at,
    'details', case when v_open then public.desk_offer_params(o.group_id, o.person_id, o.window_ends_at, null) else '{}'::jsonb end);
end;
$$;

-- One answer from the page:
--   lead        Yes, I will lead: needs 21 or older confirmed, how they lead best and whether they have achieved or are pursuing the goal
--   not_season  Not this season (reasons are kept, shown to nobody by name)
--   call        Call me: the owner sees it on the offer
--   tomorrow    Remind me tomorrow, if the window is still open then
--   never       Never ask me to lead: no more leader offers, ever
--   stop        Stop these: ends every Desk email, and this offer
create function public.worker_desk_offer_answer(p_token text, p_link text, p_answer text, p_age boolean default false, p_lead text default null,
                                                p_relation text default null, p_reasons text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  o public.desk_offers%rowtype;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_block text;
  v_code text;
  r record;
begin
  perform public.worker_ok(p_token);
  if p_answer is null or p_answer not in ('lead', 'not_season', 'call', 'tomorrow', 'never', 'stop')
     or not (v_reasons <@ array['busy', 'family', 'not_ready', 'other_goal', 'other']) or cardinality(v_reasons) > 5
     or (p_answer <> 'not_season' and cardinality(v_reasons) > 0)
     or (p_answer = 'lead' and (coalesce(p_age, false) is not true or p_lead is null or p_lead not in ('structure', 'connection', 'teaching', 'doing')
                               or p_relation is null or p_relation not in ('achieved', 'pursuing')))
     or (p_answer <> 'lead' and (p_lead is not null or p_relation is not null or coalesce(p_age, false))) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_id := public.desk_offer_link_offer(p_link);
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into o from public.desk_offers y where y.id = v_id for update;
  v_block := public.desk_mail_block(o.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if p_answer = 'stop' then
    insert into public.desk_stops (person_id) values (o.person_id) on conflict do nothing;
    update public.desk_proposals set status = 'cancelled' where person_id = o.person_id and status in ('sent', 'would_send');
    update public.messages set status = 'skipped', error = 'Stopped by the member', reply_token = null
     where person_id = o.person_id and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer') and status = 'queued';
    for r in select y.id, y.group_id, y.status from public.desk_offers y where y.person_id = o.person_id and y.status in ('queued', 'open', 'review') loop
      perform public.desk_offer_close(r.id, 'cancelled');
      if r.status in ('open', 'review') then
        perform public.desk_offer_advance(r.group_id);
      end if;
    end loop;
    update public.desk_offers set answer = 'stop', answered_at = now() where id = o.id and answer is null;
    perform public.write_event(null, 'desk.stop', 'person', o.person_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'answer', 'stop');
  end if;

  if o.status in ('accepted', 'review') and p_answer = 'lead' then
    return jsonb_build_object('ok', true, 'answer', 'lead', 'again', true, 'review', o.status = 'review');
  end if;
  if o.status = 'declined' and o.answer is not null and p_answer in ('not_season', 'never') then
    return jsonb_build_object('ok', true, 'answer', o.answer, 'again', true);
  end if;
  if o.status <> 'open' or now() >= o.window_ends_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if public.desk_mail_state(o.person_id) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;

  if p_answer = 'call' then
    update public.desk_offers set call_me = true where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'call'));
    return jsonb_build_object('ok', true, 'answer', 'call');
  end if;
  if p_answer = 'tomorrow' then
    if now() + interval '1 day' < o.window_ends_at - interval '1 hour' then
      update public.desk_offers set remind_at = now() + interval '1 day', reminded_tomorrow = null where id = o.id;
      return jsonb_build_object('ok', true, 'answer', 'tomorrow', 'later', true);
    end if;
    return jsonb_build_object('ok', true, 'answer', 'tomorrow', 'later', false);
  end if;
  if p_answer = 'not_season' then
    update public.desk_offers set status = 'declined', answer = 'not_season', reasons = v_reasons, answered_at = now() where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'not_season'));
    perform public.desk_offer_advance(o.group_id);
    return jsonb_build_object('ok', true, 'answer', 'not_season');
  end if;
  if p_answer = 'never' then
    insert into public.desk_lead_stops (person_id) values (o.person_id) on conflict do nothing;
    update public.desk_offers set status = 'declined', answer = 'never', answered_at = now() where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'never'));
    perform public.desk_offer_advance(o.group_id);
    return jsonb_build_object('ok', true, 'answer', 'never');
  end if;

  -- Yes, I will lead: the gates are checked again at this moment
  v_code := public.desk_offer_gate(o.person_id, o.group_id, o.id);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_available', 'code', v_code);
  end if;
  update public.desk_offers set lead_best = p_lead, relation = p_relation, age_confirmed_at = now() where id = o.id;
  return public.desk_offer_accept(o.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function
  public.leader_appoint_core(uuid, jsonb, uuid, text, uuid, uuid), public.desk_offer_words(text), public.desk_offer_gate_core(uuid, uuid, uuid),
  public.desk_offer_member_ok(uuid, uuid), public.desk_offer_gate(uuid, uuid, uuid), public.desk_offer_problem(uuid), public.desk_offer_params(uuid, uuid, timestamptz, text),
  public.desk_offer_link_mint(uuid, uuid, timestamptz), public.desk_offer_link_offer(text), public.desk_offer_open(uuid), public.desk_offer_close(uuid, text),
  public.desk_offer_advance(uuid), public.desk_found_params(uuid, uuid, uuid), public.desk_offer_complete(uuid, uuid), public.desk_offer_accept(uuid),
  public.desk_offer_tick()
  from public, anon, authenticated;

revoke all on function
  public.desk_offer_candidates(uuid, integer), public.desk_offer_send(uuid, uuid[]), public.desk_offer_cancel(uuid, boolean), public.desk_offers_pause(uuid, boolean),
  public.desk_offer_review(uuid, boolean), public.desk_group_leader(uuid), public.desk_offers_list(integer, integer)
  from public, anon;
grant execute on function
  public.desk_offer_candidates(uuid, integer), public.desk_offer_send(uuid, uuid[]), public.desk_offer_cancel(uuid, boolean), public.desk_offers_pause(uuid, boolean),
  public.desk_offer_review(uuid, boolean), public.desk_group_leader(uuid), public.desk_offers_list(integer, integer)
  to authenticated;

revoke all on function public.worker_desk_offer_info(text, text), public.worker_desk_offer_answer(text, text, text, boolean, text, text, text[]) from public, anon, authenticated;
grant execute on function public.worker_desk_offer_info(text, text), public.worker_desk_offer_answer(text, text, text, boolean, text, text, text[]) to anon;

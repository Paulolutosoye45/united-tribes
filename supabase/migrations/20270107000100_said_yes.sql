-- =============================================================================
-- United Tribes: count only members who said yes, and keep the WhatsApp group closed until they do (fixes 1 and 2 of the review)
--
-- Fix 1. A seat is in one of three states, worked out from columns that already exist:
--   said yes         the member chose the seat themselves, or pressed "Yes, I'm in" (confirmed_at is set)
--   placed, waiting  placed by the church; no answer yet
--   gone             declined, moved or released (status is not active)
-- "Matched", "members" and every rate on the headline, church, insight and community dashboards now mean "said yes". The people still waiting are
-- their own figure beside it (headline, church, insight, each tribe). A waiting seat still counts against the tribe's capacity, so a tribe
-- cannot be overbooked while an answer is awaited. No seat changes and nothing is sent.
--
-- Fix 2. The leader's view of a number, and the tribe's WhatsApp group link, open on a yes and on nothing else. They no longer open because a
-- day has passed, or because the member ticked "agreed to share" on the form. God Mode's Open now / Open all still override, as the pastor's call.
-- A member who pressed "Don't share my details" stays private after a yes as well.
--   placement_contact       the one gate: a seat chosen by the member or answered yes is open; otherwise closed, with a new state, "unanswered",
--                           for a member whose hold has run out without a reply
--   placement_group_open    the link is shown after a yes, or when the seat was the member's own choice
--   placement_member_params the first email carries the group link only when God Mode has switched the wait off
--   tribe_group_list / tribe_group_mark   the leader's "Admit to the group" list (people who said yes, with the number) and "If they joined the
--                           group, remove them" list (people who left the tribe), each with a tick
-- The old text of every function this file replaces is in supabase/rollback/20270107000100_said_yes.down.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A seat the member has answered: chosen by them, or confirmed
-- ---------------------------------------------------------------------------
create function public.seat_said_yes(p_source text, p_confirmed timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_source = 'self' or p_confirmed is not null;
$$;
revoke execute on function public.seat_said_yes(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The leader's ticks, and the date the group closed (people who left before it may already be in a group)
-- ---------------------------------------------------------------------------
alter table public.tribe_members
  add column group_admitted_at timestamptz,
  add column group_removed_at timestamptz;
alter table public.placement_settings
  add column group_closed_from timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- The gate. One change from before: a hold that runs out, a membership form that agreed to share, and a withheld seat no longer open anything.
-- ---------------------------------------------------------------------------
create or replace function public.placement_contact(p_tm uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  pt public.placement_teams%rowtype;
  v_church boolean;
  v_status text;
  v_sent timestamptz;
  v_hold integer;
  v_at timestamptz;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  -- A seat the member chose is theirs: open, as it always was
  if not found or tm.placement_source is distinct from 'auto' or tm.placed_by_run is null then
    return jsonb_build_object('state', 'open', 'why', 'own', 'late', false);
  end if;
  if tm.contact_withheld then
    return jsonb_build_object('state', 'withheld', 'why', 'withheld', 'late', false);
  end if;
  select * into pt from public.placement_teams x where x.run_id = tm.placed_by_run and x.tribe_id = tm.tribe_id;
  v_church := found and pt.contact_opened_at is not null;
  -- A yes opens it. "late" now means only that God Mode opened the tribe, which a member can no longer take back.
  if tm.confirmed_at is not null then
    return jsonb_build_object('state', 'open', 'why', 'yes', 'late', v_church);
  end if;
  -- God Mode's Open now / Open all: the pastor's override
  if v_church then
    return jsonb_build_object('state', 'open', 'why', 'church', 'late', true);
  end if;
  select msg.status, msg.sent_at into v_status, v_sent
    from public.placement_items i join public.messages msg on msg.id = i.member_message
   where i.placement_id = tm.id order by i.id desc limit 1;
  v_hold := coalesce((select r.hold_hours::integer from public.placement_runs r where r.id = tm.placed_by_run),
                     (select s.hold_hours::integer from public.placement_settings s where s.singleton), 24);
  if v_status in ('sent', 'delivered', 'read') and v_sent is not null then
    v_at := v_sent + make_interval(hours => v_hold);
    -- While the hold runs the leader's first email waits (so a quick yes can be in it); when it has run out, nothing opens by itself
    if v_at > now() then
      return jsonb_build_object('state', 'holding', 'why', 'hold', 'opens_at', v_at, 'late', false);
    end if;
    return jsonb_build_object('state', 'unanswered', 'why', 'no_reply', 'late', false);
  end if;
  if v_status in ('queued', 'sending') then
    return jsonb_build_object('state', 'waiting', 'why', 'email', 'late', false);
  end if;
  return jsonb_build_object('state', 'not_reached', 'why', 'email', 'late', false);
end;
$$;

-- The member sees the group link after a yes, or when the seat was their own choice. God Mode can still switch the wait off for everyone.
create or replace function public.placement_group_open(p_tm uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found or tm.placement_source is distinct from 'auto' then
    return true;
  end if;
  if not coalesce((select s.hold_group_link from public.placement_settings s where s.singleton), true) then
    return true;
  end if;
  return tm.confirmed_at is not null or (public.placement_contact(tm.id) ->> 'state') = 'open';
end;
$$;

-- The first email carries the group link only when God Mode has switched the wait off. Everyone else gets it on the tribe page after a yes.
create or replace function public.placement_member_params(p_tribe uuid, p_person uuid, p_degree integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_hold integer := (select st.hold_hours::integer from public.placement_settings st where st.singleton);
  v_open boolean := not coalesce((select st.hold_group_link from public.placement_settings st where st.singleton), true);
begin
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.seasons x where x.id = t.season_id;
  return jsonb_build_object(
    'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
    'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
    'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
    'place_note', t.place_note,
    'group_url', case when v_open then t.whatsapp_group_url end,
    'group_held', not v_open and t.whatsapp_group_url is not null,
    'first_meeting_by', public.placement_first_meeting_by(s.starts_on), 'first_meeting_on', t.first_meeting_on,
    'season', s.name, 'starts_on', s.starts_on, 'in_season', s.starts_on <= public.today_lagos(), 'week', public.placement_week(s.id),
    'change_until', s.starts_on + (public.reminder_cfg()).joining_closes_days,
    'fit', case when p_degree is null then null else public.degree_label(p_degree) end,
    'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life,
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(p_person, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = p_person), false),
    'agreed_to_share', public.consent_granted(p_person, 'team_contact'),
    'hold_hours', v_hold);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader's two lists
-- ---------------------------------------------------------------------------
create function public.tribe_group_list(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  v_from timestamptz := coalesce((select s.group_closed_from from public.placement_settings s where s.singleton), now());
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false)) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'has_link', c.whatsapp_group_url is not null,
    -- Members who said yes (or chose the seat), with the number only where they allow it. A tick says the leader has let them in.
    'admit', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'whatsapp', case when (k.c ->> 'state') = 'open' and not m.contact_withheld and public.consent_granted(m.person_id, 'whatsapp') then mp.whatsapp end,
               'private', m.contact_withheld,
               'admitted', m.group_admitted_at is not null)
             order by (m.group_admitted_at is not null), public.person_display_name(m.person_id), m.id)
        from public.tribe_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
        cross join lateral (select public.placement_contact(m.id) as c) k
       where m.tribe_id = c.id and m.status = 'active' and public.seat_said_yes(m.placement_source, m.confirmed_at)), '[]'::jsonb),
    -- Placed by the church and not yet answered: a name and nothing else
    'waiting', coalesce((
      select jsonb_agg(public.person_display_name(m.person_id) order by public.person_display_name(m.person_id), m.id)
        from public.tribe_members m
       where m.tribe_id = c.id and m.status = 'active' and not public.seat_said_yes(m.placement_source, m.confirmed_at)), '[]'::jsonb),
    -- People who have left the tribe in the last 60 days and may already be in its group. Never the reason they left.
    'remove', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', g.person_id, 'name', public.person_display_name(g.person_id), 'removed', g.group_removed_at is not null)
             order by (g.group_removed_at is not null), public.person_display_name(g.person_id), g.id)
        from (select distinct on (m.person_id) m.* from public.tribe_members m
               where m.tribe_id = c.id and m.status <> 'active' and m.released_at > now() - interval '60 days'
                 and (m.confirmed_at is not null or m.group_admitted_at is not null or m.placement_source = 'self' or m.joined_at < v_from)
                 and not exists (select 1 from public.tribe_members a where a.tribe_id = c.id and a.person_id = m.person_id and a.status = 'active')
               order by m.person_id, m.released_at desc) g), '[]'::jsonb));
end;
$$;

create function public.tribe_group_mark(p_tribe uuid, p_person uuid, p_kind text, p_done boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  m public.tribe_members%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false)) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  if p_kind not in ('admitted', 'removed') then
    raise exception 'Choose admitted or removed' using errcode = '22023';
  end if;
  if p_kind = 'admitted' then
    select * into m from public.tribe_members x where x.tribe_id = p_tribe and x.person_id = p_person and x.status = 'active' for update;
    if not found then
      raise exception 'That person is not in your tribe' using errcode = '22023';
    end if;
    if not public.seat_said_yes(m.placement_source, m.confirmed_at) then
      raise exception 'Wait until they have said yes' using errcode = '22023';
    end if;
    update public.tribe_members set group_admitted_at = case when coalesce(p_done, true) then coalesce(group_admitted_at, now()) end where id = m.id;
  else
    select * into m from public.tribe_members x where x.tribe_id = p_tribe and x.person_id = p_person and x.status <> 'active'
     order by x.released_at desc nulls last limit 1 for update;
    if not found then
      raise exception 'That person has not left your tribe' using errcode = '22023';
    end if;
    update public.tribe_members set group_removed_at = case when coalesce(p_done, true) then coalesce(group_removed_at, now()) end where id = m.id;
  end if;
  perform public.write_event(uid, 'group.' || p_kind, 'tribe', p_tribe::text, jsonb_build_object('done', coalesce(p_done, true)));
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.tribe_group_list(uuid), public.tribe_group_mark(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.tribe_group_list(uuid), public.tribe_group_mark(uuid, uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The counts: the same functions as before, with the one change marked in each ("said yes", or "waiting")
-- ---------------------------------------------------------------------------
-- kpi_members
CREATE OR REPLACE FUNCTION public.kpi_members(p_season uuid)
 RETURNS TABLE(km_person uuid, km_tribe uuid, km_degree smallint, km_rank smallint, km_attended integer, km_recent integer, km_belonging integer, km_base integer, km_latest integer, km_latest_week integer, km_set integer, km_done integer, km_checked integer, km_measured boolean, km_thriving boolean, km_gain integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.seasons%rowtype;
  today date := public.today_lagos();
  cw integer;
  gone integer;
  need integer;
  floor_weeks integer := (public.kpi_targets() ->> 'min_weeks')::int;
  bmin integer := (public.kpi_targets() ->> 'belonging_min')::int;
begin
  select * into s from public.seasons where id = p_season;
  if not found then
    return;
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  -- Weeks that are over: none before the season, all of them after it
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  need := ceil(round(s.weeks * (public.kpi_targets() ->> 'attend_share')::numeric, 4))::int;

  return query
  select m.person_id, m.tribe_id, m.degree, m.chosen_rank,
         coalesce(att.n, 0)::int,
         coalesce(att.recent, 0)::int,
         pl.belonging::int,
         pb.total,
         pl.total,
         pl.week::int,
         coalesce(st.set_n, 0)::int,
         coalesce(st.done_n, 0)::int,
         coalesce(st.checked_n, 0)::int,
         gone >= floor_weeks,
         case when gone >= floor_weeks
              then (coalesce(att.n, 0) * s.weeks >= need * gone) and coalesce(pl.belonging >= bmin, false)
         end,
         case when pl.week > 1 and pb.total is not null then pl.total - pb.total end
    from public.tribe_members m
    join public.tribes c on c.id = m.tribe_id and c.season_id = p_season
    left join lateral (
      select count(distinct a.week) filter (where a.week <= gone) as n,
             count(distinct a.week) filter (where a.week <= gone and a.week > gone - 3) as recent
        from public.tribe_attendance a
        join public.tribe_logs l on l.tribe_id = a.tribe_id and l.week = a.week and l.held
       where a.person_id = m.person_id and a.status = 'present'
         and a.tribe_id in (select c2.id from public.tribes c2 where c2.season_id = p_season)) att on true
    left join lateral (
      select p.belonging, (p.god + p.others + p.life)::int as total, p.week
        from public.pulses p
       where p.person_id = m.person_id and p.tribe_id in (select c2.id from public.tribes c2 where c2.season_id = p_season)
       order by p.week desc, p.created_at desc limit 1) pl on true
    left join lateral (
      select (p.god + p.others + p.life)::int as total
        from public.pulses p
       where p.person_id = m.person_id and p.tribe_id in (select c2.id from public.tribes c2 where c2.season_id = p_season) and p.week = 1
       order by p.created_at limit 1) pb on true
    left join lateral (
      select count(distinct w.week) as set_n,
             count(distinct w.week) filter (where w.outcome = 'done') as done_n,
             count(distinct w.week) filter (where w.outcome is not null) as checked_n
        from public.week_steps w
       where w.person_id = m.person_id and w.tribe_id in (select c2.id from public.tribes c2 where c2.season_id = p_season)) st on true
   where m.status = 'active' and m.season_id = p_season and public.seat_said_yes(m.placement_source, m.confirmed_at);
end;
$function$;

-- retention_curve
CREATE OR REPLACE FUNCTION public.retention_curve(p_season uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.seasons%rowtype;
  cw integer;
  gone integer;
  cohort integer;
begin
  select * into s from public.seasons where id = p_season;
  if not found then
    return jsonb_build_object('cohort', 0, 'points', '[]'::jsonb);
  end if;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  -- a member who moved to another tribe counts once
  select count(distinct m.person_id)::int into cohort
    from public.tribe_members m
    join public.tribes c on c.id = m.tribe_id
   where m.season_id = p_season and c.status = 'approved'
     and (m.status = 'active' or m.released_at >= s.starts_on)
     and public.seat_said_yes(m.placement_source, m.confirmed_at);
  return jsonb_build_object(
    'cohort', cohort,
    'points', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', g.w, 'retained', r.n,
               'rate', case when cohort > 0 then round(r.n::numeric / cohort, 3) end) order by g.w)
        from generate_series(1, gone) as g(w)
        cross join lateral (
          select count(distinct a.person_id)::int as n
            from public.tribe_attendance a
            join public.tribe_logs l on l.tribe_id = a.tribe_id and l.week = a.week and l.held
            join public.tribe_members m on m.tribe_id = a.tribe_id and m.person_id = a.person_id and m.season_id = p_season
           where a.status = 'present' and a.week between greatest(1, g.w - 1) and g.w) r), '[]'::jsonb));
end;
$function$;

-- church_views
CREATE OR REPLACE FUNCTION public.church_views(p_season uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sid uuid := p_season;
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  cw integer;
  gone integer;
  mincell integer := (public.kpi_targets() ->> 'min_cell')::int;
  minans integer := (public.kpi_targets() ->> 'min_answers')::int;
begin
  select * into s from public.seasons where id = sid;
  if not found then
    return '{}'::jsonb;
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;

  return jsonb_build_object(
    -- Placed by the church and not yet answered: its own figure beside the people who said yes
    'waiting', (select count(distinct m.person_id)::int from public.tribe_members m where m.season_id = sid and m.status = 'active' and not public.seat_said_yes(m.placement_source, m.confirmed_at)),
    'funnel', jsonb_build_array(
      jsonb_build_object('key', 'started', 'label', 'Started the form',
        'count', (select count(*) from public.intake_drafts) + (select count(*) from public.member_profiles where season_id = sid)),
      jsonb_build_object('key', 'finished', 'label', 'Finished the form',
        'count', (select count(*) from public.member_profiles where season_id = sid)),
      jsonb_build_object('key', 'shown', 'label', 'Were shown tribes',
        'count', (select count(distinct r.person_id) from public.match_runs r where r.season_id = sid and r.shown > 0)),
      jsonb_build_object('key', 'chose', 'label', 'Said yes to a tribe',
        'count', (select count(distinct m.person_id) from public.tribe_members m where m.season_id = sid and m.status = 'active' and public.seat_said_yes(m.placement_source, m.confirmed_at))),
      jsonb_build_object('key', 'came', 'label', 'Came to a meeting',
        'count', (select count(*) from public.kpi_members(sid) where km_attended > 0)),
      jsonb_build_object('key', 'thriving', 'label', 'Thriving',
        'count', (select count(*) from public.kpi_members(sid) where km_thriving))),

    'supply', (
      with w as (
        select mp.community_id, ar.track_id, count(*)::int as n
          from public.member_profiles mp
          join public.age_ranges ar on ar.id = mp.age_range_id
         where mp.season_id = sid and mp.community_id is not null
         group by mp.community_id, ar.track_id),
      seats as (
        select c.community_id, c.track_id, sum(c.capacity)::int as seats
          from public.tribes c
         where c.season_id = sid and c.status = 'approved'
           and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
         group by c.community_id, c.track_id),
      placed as (
        select c.community_id, c.track_id, count(*) filter (where public.seat_said_yes(m.placement_source, m.confirmed_at))::int as placed, count(*) filter (where not public.seat_said_yes(m.placement_source, m.confirmed_at))::int as waiting
          from public.tribe_members m
          join public.tribes c on c.id = m.tribe_id
         where m.status = 'active' and c.season_id = sid
         group by c.community_id, c.track_id),
      cells as (
        select coalesce(w.community_id, seats.community_id, placed.community_id) as community_id,
               coalesce(w.track_id, seats.track_id, placed.track_id) as track_id,
               coalesce(w.n, 0) as wants, coalesce(seats.seats, 0) as seats, coalesce(placed.placed, 0) as placed, coalesce(placed.waiting, 0) as waiting
          from w
          full join seats on seats.community_id = w.community_id and seats.track_id = w.track_id
          full join placed on placed.community_id = coalesce(w.community_id, seats.community_id)
                          and placed.track_id = coalesce(w.track_id, seats.track_id))
      select jsonb_build_object(
        'communities', (select coalesce(jsonb_agg(t.name order by t.sort), '[]'::jsonb) from public.communities t where t.active),
        'tracks', (select coalesce(jsonb_agg(tr.name order by tr.sort), '[]'::jsonb) from public.tracks tr where tr.active),
        'cells', (select coalesce(jsonb_agg(jsonb_build_object('community', t.name, 'track', tr.name, 'wants', c.wants, 'seats', c.seats, 'placed', c.placed, 'waiting', c.waiting)), '[]'::jsonb)
                    from cells c join public.communities t on t.id = c.community_id join public.tracks tr on tr.id = c.track_id),
        'wants', (select coalesce(sum(wants), 0) from cells),
        'seats', (select coalesce(sum(seats), 0) from cells),
        'placed', (select coalesce(sum(placed), 0) from cells),
        'waiting', (select coalesce(sum(waiting), 0) from cells),
        'unmet', (select count(*) from public.match_demand d where d.season_id = sid))),

    'communities', (
      select coalesce(jsonb_agg(x order by (x ->> 'members')::int desc, x ->> 'community'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'community', t.name,
                   'members', count(*),
                   'thriving_rate', case when count(*) >= mincell and gone >= (tg ->> 'min_weeks')::int
                                         then round(count(*) filter (where k.km_thriving)::numeric / count(*), 3) end,
                   'gain_avg', case when count(k.km_gain) >= minans then round(avg(k.km_gain), 1) end) as x
            from public.kpi_members(sid) k
            join public.tribes c on c.id = k.km_tribe
            join public.communities t on t.id = c.community_id
           group by t.name) q),

    'accuracy', (
      with km as (select * from public.kpi_members(sid))
      select jsonb_build_object(
        'bands', (select jsonb_agg(b order by (b ->> 'sort')::int)
                    from (
                      select jsonb_build_object(
                               'key', v.key, 'label', v.label, 'sort', v.sort,
                               'n', count(km.km_person),
                               'thriving_rate', case when count(km.km_person) >= mincell and gone >= (tg ->> 'min_weeks')::int
                                                     then round(count(*) filter (where km.km_thriving)::numeric / count(km.km_person), 3) end,
                               'attendance_rate', case when count(km.km_person) >= mincell and gone > 0
                                                       then round(avg(km.km_attended::numeric / nullif(gone, 0)), 3) end) as b
                        from (values ('excellent', 'Excellent (85–100)', 1, 85, 100),
                                     ('strong', 'Strong (70–84)', 2, 70, 84),
                                     ('good', 'Good (60–69)', 3, 60, 69)) as v(key, label, sort, lo, hi)
                        left join km on km.km_degree between v.lo and v.hi
                       group by v.key, v.label, v.sort) q),
        'ranks', (select jsonb_agg(b order by (b ->> 'rank')::int)
                    from (
                      select jsonb_build_object(
                               'rank', v.rank, 'label', v.label,
                               'n', count(km.km_person),
                               'thriving_rate', case when count(km.km_person) >= mincell and gone >= (tg ->> 'min_weeks')::int
                                                     then round(count(*) filter (where km.km_thriving)::numeric / count(km.km_person), 3) end,
                               'attendance_rate', case when count(km.km_person) >= mincell and gone > 0
                                                       then round(avg(km.km_attended::numeric / nullif(gone, 0)), 3) end) as b
                        from (values (1, 'Their first card'), (2, 'Their second card'), (3, 'Their third card')) as v(rank, label)
                        left join km on km.km_rank = v.rank
                       group by v.rank, v.label) q),
        'average_degree', (select round(avg(km_degree)) from km),
        'completed', (select count(*) from public.tribe_members m
                       join public.tribes c on c.id = m.tribe_id
                       join public.seasons x on x.id = c.season_id
                      where m.status = 'active' and public.seat_said_yes(m.placement_source, m.confirmed_at) and public.season_week(x.starts_on, x.weeks, today) > x.weeks),
        'retrain_after', (tg ->> 'retrain_after')::int)),

    'care', (
      select jsonb_build_object(
        'open', count(*) filter (where f.status = 'open'),
        'escalated', count(*) filter (where f.status = 'escalated'),
        'oldest_open_days', (select max(today - (g.opened_at at time zone 'Africa/Lagos')::date)
                               from public.care_flags g join public.tribes gc on gc.id = g.tribe_id
                              where g.status <> 'closed' and gc.season_id = sid),
        'closed_7d', count(*) filter (where f.status = 'closed' and f.closed_at >= now() - interval '7 days'),
        'median_days_to_close', (select round(percentile_cont(0.5) within group (order by extract(epoch from (g.closed_at - g.opened_at)) / 86400)::numeric, 1)
                                   from public.care_flags g join public.tribes gc on gc.id = g.tribe_id
                                  where g.status = 'closed' and g.closed_at is not null and gc.season_id = sid))
        from public.care_flags f join public.tribes fc on fc.id = f.tribe_id
       where fc.season_id = sid),

    'testimonies', (
      select jsonb_build_object(
        'waiting', count(*) filter (where t.status = 'submitted'),
        'tribe', count(*) filter (where t.status = 'tribe_approved'),
        'church', count(*) filter (where t.status = 'church_approved'),
        'declined', count(*) filter (where t.status = 'declined'))
        from public.testimonies t join public.tribes tc on tc.id = t.tribe_id
       where tc.season_id = sid));
end;
$function$;

-- insight_data
CREATE OR REPLACE FUNCTION public.insight_data(p_season uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  cw integer;
  gone integer;
  mincell integer := (tg ->> 'min_cell')::int;
  minans integer := (tg ->> 'min_answers')::int;
  gmin integer := (tg ->> 'gain_min')::int;
  v_measured boolean;
  v_members integer;
  v_thriving integer;
  v_gain_n integer;
  v_gain_ok integer;
  v_hi_n integer; v_hi_ok integer; v_lo_n integer; v_lo_ok integer;
  v_thriving_rate numeric;
  v_gain_share numeric;
  v_gap numeric;
  v_connect_n integer; v_connect_median numeric;
  v_form_n integer; v_form_median numeric;
  v_finished integer; v_started integer; v_completion numeric;
  v_choose_n integer; v_choose_median numeric;
  v_word_n integer; v_word_keep integer; v_word_rate numeric;
  v_care_n integer; v_care_ok integer; v_care_rate numeric; v_urgent_n integer; v_urgent_ok integer;
  v_tribes_n integer; v_assist_n integer;
  v_ai jsonb;
  v_ai_low numeric; v_ai_low_field text; v_ai_fields integer;
  v_times_shown integer; v_times_kept integer;
  v_kpis jsonb;
  v_goals jsonb;
begin
  select * into s from public.seasons where id = p_season;
  if not found then
    return jsonb_build_object('state', 'none', 'targets', tg);
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  v_measured := gone >= (tg ->> 'min_weeks')::int;

  -- Belong, achieve the goal, match well
  select count(*)::int, count(*) filter (where km_thriving)::int,
         count(km_gain)::int, count(*) filter (where km_gain >= gmin)::int,
         count(*) filter (where km_degree >= 85)::int, count(*) filter (where km_degree >= 85 and km_thriving)::int,
         count(*) filter (where km_degree between 60 and 69)::int, count(*) filter (where km_degree between 60 and 69 and km_thriving)::int
    into v_members, v_thriving, v_gain_n, v_gain_ok, v_hi_n, v_hi_ok, v_lo_n, v_lo_ok
    from public.kpi_members(p_season);
  v_thriving_rate := case when v_measured and v_members > 0 then round(v_thriving::numeric / v_members, 3) end;
  v_gain_share := case when v_gain_n >= minans then round(v_gain_ok::numeric / v_gain_n, 3) end;
  v_gap := case when v_measured and v_hi_n >= mincell and v_lo_n >= mincell
                then round(v_hi_ok::numeric / v_hi_n - v_lo_ok::numeric / v_lo_n, 3) end;

  -- Connect fast: the day the form was submitted to the first held meeting they came to
  with first_meet as (
    select m.person_id, min(public.meeting_date_of(m.tribe_id, a.week)) as d
      from public.tribe_members m
      join public.tribe_attendance a on a.tribe_id = m.tribe_id and a.person_id = m.person_id and a.status = 'present'
      join public.tribe_logs l on l.tribe_id = a.tribe_id and l.week = a.week and l.held
     where m.season_id = p_season and m.status = 'active'
     group by m.person_id)
  select count(*)::int,
         percentile_cont(0.5) within group (order by greatest(0, f.d - (mp.submitted_at at time zone 'Africa/Lagos')::date))
    into v_connect_n, v_connect_median
    from first_meet f join public.member_profiles mp on mp.person_id = f.person_id;

  -- Match effortlessly: time on the form, started forms finished, and the wait from finishing to choosing
  select count(*)::int, percentile_cont(0.5) within group (order by mp.duration_seconds) / 60.0
    into v_form_n, v_form_median
    from public.member_profiles mp
   where mp.season_id = p_season and mp.duration_seconds is not null and mp.duration_seconds > 0;
  select count(*)::int into v_finished from public.member_profiles where season_id = p_season;
  v_started := v_finished + (select count(*)::int from public.intake_drafts);
  v_completion := case when v_started >= mincell then round(v_finished::numeric / v_started, 3) end;
  select count(*)::int, percentile_cont(0.5) within group (order by extract(epoch from m.joined_at - mp.submitted_at) / 86400.0)
    into v_choose_n, v_choose_median
    from public.tribe_members m
    join public.member_profiles mp on mp.person_id = m.person_id and mp.season_id = m.season_id
   where m.season_id = p_season and m.status = 'active' and m.joined_at >= mp.submitted_at and public.seat_said_yes(m.placement_source, m.confirmed_at);

  -- Grow in faith: members whose last three weekly reports average at least the minimum days in the Word
  with last3 as (
    select w.person_id, w.days, row_number() over (partition by w.person_id order by w.week desc) as rn
      from public.word_habit w join public.tribes c on c.id = w.tribe_id
     where c.season_id = p_season),
  per as (select person_id, avg(days) as a from last3 where rn <= 3 group by person_id)
  select count(*)::int, count(*) filter (where a >= (tg ->> 'word_days_min')::numeric)::int
    into v_word_n, v_word_keep from per;
  v_word_rate := case when v_word_n >= mincell then round(v_word_keep::numeric / v_word_n, 3) end;

  -- Care well: tasks old enough to judge, resolved within the target days; urgent ones on the same day
  select count(*) filter (where t.status <> 'dismissed' and t.created_at <= now() - make_interval(days => (tg ->> 'care_days')::int))::int,
         count(*) filter (where t.status = 'done' and t.created_at <= now() - make_interval(days => (tg ->> 'care_days')::int)
                            and t.closed_at <= t.created_at + make_interval(days => (tg ->> 'care_days')::int))::int,
         count(*) filter (where t.kind = 'urgent' and t.status <> 'dismissed')::int,
         count(*) filter (where t.kind = 'urgent' and t.status = 'done'
                            and (t.closed_at at time zone 'Africa/Lagos')::date = (t.created_at at time zone 'Africa/Lagos')::date)::int
    into v_care_n, v_care_ok, v_urgent_n, v_urgent_ok
    from public.care_tasks t join public.tribes c on c.id = t.tribe_id
   where c.season_id = p_season;
  v_care_rate := case when v_care_n >= minans then round(v_care_ok::numeric / v_care_n, 3) end;

  -- Multiply: tribes with a certified assistant
  select count(*)::int,
         count(*) filter (where exists (select 1 from public.leader_certifications lc
                                         where lc.person_id = c.assistant_id and lc.as_role = 'assistant_leader'))::int
    into v_tribes_n, v_assist_n
    from public.tribes c where c.season_id = p_season and c.status = 'approved';

  -- Understand people: for each field the assistant filled, how often the suggestion was kept
  select coalesce(jsonb_agg(jsonb_build_object('field', q.field, 'shown', q.n, 'kept', q.k,
                                               'rate', case when q.n >= minans then round(q.k::numeric / q.n, 3) end) order by q.field), '[]'::jsonb)
    into v_ai
    from (
      select x.field, count(*)::int as n, count(*) filter (where x.kept)::int as k
        from (
          select f.key as field,
                 case
                   when f.key in ('children', 'group_roles')
                     then coalesce(jsonb_array_length(case when jsonb_typeof(f.value -> 'kept') = 'array' then f.value -> 'kept' end), 0) > 0
                   when f.key = 'success_sentence' then (f.value ->> 'chosen') in ('kept', 'edited')
                   else (f.value ->> 'chosen') is not null and (f.value -> 'shown') ? (f.value ->> 'chosen')
                 end as kept
            from public.member_profiles mp
            cross join lateral jsonb_each(case when jsonb_typeof(mp.ai_assist) = 'object' then mp.ai_assist else '{}'::jsonb end) f
           where mp.season_id = p_season and f.key <> 'meeting_times'
             and jsonb_typeof(f.value -> 'shown') = 'array' and jsonb_array_length(f.value -> 'shown') > 0) x
       group by x.field) q;
  select (e ->> 'rate')::numeric, e ->> 'field' into v_ai_low, v_ai_low_field
    from jsonb_array_elements(v_ai) e where e ->> 'rate' is not null
   order by (e ->> 'rate')::numeric, e ->> 'field' limit 1;
  select count(*)::int into v_ai_fields from jsonb_array_elements(v_ai) e where e ->> 'rate' is not null;
  select count(*) filter (where jsonb_typeof(mp.ai_assist -> 'meeting_times' -> 'shown') = 'array'
                            and jsonb_array_length(mp.ai_assist -> 'meeting_times' -> 'shown') > 0)::int,
         count(*) filter (where jsonb_typeof(mp.ai_assist -> 'meeting_times' -> 'kept') = 'array'
                            and jsonb_array_length(mp.ai_assist -> 'meeting_times' -> 'kept') > 0)::int
    into v_times_shown, v_times_kept
    from public.member_profiles mp where mp.season_id = p_season and jsonb_typeof(mp.ai_assist) = 'object';

  v_kpis := jsonb_build_array(
    public.kpi_row('connect', 'Connect fast',
      case when v_connect_n >= minans then round(v_connect_median::numeric, 1) end,
      (tg ->> 'connect_days')::numeric, 'max', v_connect_n, 'days',
      jsonb_build_object('target_alt', (tg ->> 'connect_days_season')::numeric)),
    public.kpi_row('belong', 'Belong', v_thriving_rate, (tg ->> 'thriving_rate')::numeric, 'min', v_members, 'rate',
      jsonb_build_object('measured', v_measured)),
    public.kpi_row('word', 'Grow in faith', v_word_rate, (tg ->> 'word_habit')::numeric, 'min', v_word_n, 'rate',
      jsonb_build_object('coverage', case when v_members > 0 then round(v_word_n::numeric / v_members, 3) end,
                         'days_min', (tg ->> 'word_days_min')::int)),
    public.kpi_row('goal', 'Achieve the goal', v_gain_share, (tg ->> 'effective_gain')::numeric, 'min', v_gain_n, 'rate',
      jsonb_build_object('gain_min', gmin)),
    public.kpi_row('care', 'Care well', v_care_rate, (tg ->> 'care_resolved')::numeric, 'min', v_care_n, 'rate',
      jsonb_build_object('days', (tg ->> 'care_days')::int, 'urgent', v_urgent_n, 'urgent_same_day', v_urgent_ok)),
    public.kpi_row('multiply', 'Multiply',
      case when v_tribes_n > 0 then round(v_assist_n::numeric / v_tribes_n, 3) end,
      (tg ->> 'assistants')::numeric, 'min', v_tribes_n, 'ratio',
      jsonb_build_object('certified', v_assist_n)),
    public.kpi_row('match', 'Match well', v_gap, (tg ->> 'match_gap')::numeric, 'min', v_hi_n + v_lo_n, 'gap',
      jsonb_build_object('high_n', v_hi_n, 'low_n', v_lo_n,
                         'high_rate', case when v_measured and v_hi_n >= mincell then round(v_hi_ok::numeric / v_hi_n, 3) end,
                         'low_rate', case when v_measured and v_lo_n >= mincell then round(v_lo_ok::numeric / v_lo_n, 3) end)),
    public.kpi_row('form_time', 'Match effortlessly',
      case when v_form_n >= minans then round(v_form_median::numeric, 1) end,
      (tg ->> 'form_minutes')::numeric, 'max', v_form_n, 'minutes',
      jsonb_build_object('wait_days', case when v_choose_n >= minans then round(v_choose_median::numeric, 1) end, 'wait_n', v_choose_n)),
    public.kpi_row('form_completion', 'Match effortlessly', v_completion, (tg ->> 'form_completion')::numeric, 'min', v_started, 'rate',
      jsonb_build_object('finished', v_finished, 'started', v_started)),
    public.kpi_row('ai_keep', 'Understand people', v_ai_low, (tg ->> 'ai_keep')::numeric, 'min', v_ai_fields, 'rate',
      jsonb_build_object('lowest_field', v_ai_low_field)));

  -- Success Picture progress by goal
  select coalesce(jsonb_agg(g order by g ->> 'goal', g ->> 'community'), '[]'::jsonb) into v_goals
    from (
      select jsonb_build_object(
               'goal', sg.title, 'community', t.name, 'members', count(*)::int, 'gain_n', count(k.km_gain)::int,
               'gain_avg', case when count(k.km_gain) >= minans then round(avg(k.km_gain), 1) end,
               'gain_share', case when count(k.km_gain) >= minans
                                  then round(count(*) filter (where k.km_gain >= gmin)::numeric / count(k.km_gain), 3) end) as g
        from public.kpi_members(p_season) k
        join public.tribes c on c.id = k.km_tribe
        join public.season_goals sg on sg.id = c.season_goal_id
        left join public.communities t on t.id = c.community_id
       group by sg.id, sg.title, t.name) q;

  return jsonb_build_object(
    'state', case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end,
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on, 'weeks', s.weeks,
                                 'current_week', case when cw between 1 and s.weeks then cw end, 'weeks_over', gone),
    'measured', v_measured,
    'members', v_members,
    'waiting', (select count(distinct m.person_id)::int from public.tribe_members m where m.season_id = p_season and m.status = 'active' and not public.seat_said_yes(m.placement_source, m.confirmed_at)),
    'retention', public.retention_curve(p_season),
    'earlier', coalesce((
      select jsonb_agg(e order by e ->> 'starts_on' desc)
        from (select jsonb_build_object('season_id', x.id, 'name', x.name, 'starts_on', x.starts_on) || public.retention_curve(x.id) as e
                from public.seasons x
               where x.id <> p_season and x.starts_on < s.starts_on and x.centre_id = s.centre_id
               order by x.starts_on desc limit 3) q
       where (e ->> 'cohort')::int > 0), '[]'::jsonb),
    'kpis', v_kpis,
    'ai', jsonb_build_object('fields', v_ai, 'times_shown', v_times_shown, 'times_kept', v_times_kept),
    'goals', v_goals,
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object('taken_on', t.taken_on, 'week', t.week) || t.data order by t.taken_on)
        from (select * from public.kpi_snapshots k where k.season_id = p_season order by k.taken_on desc limit 16) t), '[]'::jsonb),
    'targets', tg);
end;
$function$;

-- dashboard_core
CREATE OR REPLACE FUNCTION public.dashboard_core(p_season uuid, p_scope uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sid uuid := p_season;
  scope uuid[] := coalesce(p_scope, '{}');
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  cw integer;
  gone integer;
  mincell integer := (public.kpi_targets() ->> 'min_cell')::int;
  minans integer := (public.kpi_targets() ->> 'min_answers')::int;
  h jsonb;
  tribes_json jsonb;
  weeks_json jsonb;
begin
  select * into s from public.seasons where id = sid;
  if not found then
    return jsonb_build_object('tribes', '[]'::jsonb, 'headline', '{}'::jsonb, 'weeks', '[]'::jsonb);
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;

  -- The tribes, with their numbers and verdict
  select coalesce(jsonb_agg(r order by
           case r ->> 'verdict' when 'at_risk' then 0 when 'not_yet' then 1 when 'close' then 2 when 'too_early' then 3 when 'before' then 4 else 5 end,
           r ->> 'name'), '[]'::jsonb)
    into tribes_json
    from (
      select jsonb_build_object(
               'tribe_id', c.id, 'name', c.name,
               'leader', public.person_display_name(c.leader_id),
               'coach', case when c.coach_id is null then null else public.person_display_name(c.coach_id) end,
               'community', t.name, 'track', tr.name,
               'members', k.kc_members, 'capacity', c.capacity,
               'waiting', (select count(*)::int from public.tribe_members w where w.tribe_id = c.id and w.status = 'active' and not public.seat_said_yes(w.placement_source, w.confirmed_at)),
               'held', k.kc_held,
               'attendance_rate', case when k.kc_possible > 0 then round(k.kc_present::numeric / k.kc_possible, 3) end,
               'thriving', case when k.kc_measured then k.kc_thriving end,
               'thriving_rate', case when k.kc_measured then round(k.kc_thriving::numeric / k.kc_members, 3) end,
               'gain_n', k.kc_gain_n,
               'gain_avg', case when k.kc_gain_n >= minans then round(k.kc_gain_avg, 1) end,
               'gain_share', case when k.kc_gain_n >= minans then round(k.kc_gain_ok::numeric / k.kc_gain_n, 3) end,
               'steps_done_rate', case when k.kc_checked > 0 then round(k.kc_done::numeric / k.kc_checked, 3) end,
               'verdict', k.kc_verdict) as r
        from public.kpi_tribes(sid) k
        join public.tribes c on c.id = k.kc_tribe
        left join public.communities t on t.id = c.community_id
        left join public.tracks tr on tr.id = c.track_id
       where c.id = any(scope)) q;

  -- The headline numbers, for the tribes in scope
  with km as (select * from public.kpi_members(sid) where km_tribe = any(scope)),
       kc as (select * from public.kpi_tribes(sid) where kc_tribe = any(scope))
  select jsonb_build_object(
           'members', (select count(*) from km),
           'waiting', (select count(*)::int from public.tribe_members w where w.tribe_id = any(scope) and w.season_id = sid and w.status = 'active' and not public.seat_said_yes(w.placement_source, w.confirmed_at)),
           'tribes', (select count(*) from kc),
           'measured', gone >= (tg ->> 'min_weeks')::int,
           'thriving', (select count(*) from km where km_thriving),
           'thriving_rate', case when gone >= (tg ->> 'min_weeks')::int and (select count(*) from km) > 0
                                 then round((select count(*) from km where km_thriving)::numeric / (select count(*) from km), 3) end,
           'attendance_rate', case when (select coalesce(sum(kc_possible), 0) from kc) > 0
                                   then round((select sum(kc_present) from kc)::numeric / (select sum(kc_possible) from kc), 3) end,
           'base_n', (select count(km_base) from km),
           'base_avg', case when (select count(km_base) from km) >= minans then round((select avg(km_base) from km), 1) end,
           'latest_avg', case when (select count(km_latest) from km) >= minans then round((select avg(km_latest) from km), 1) end,
           'gain_n', (select count(km_gain) from km),
           'gain_avg', case when (select count(km_gain) from km) >= minans then round((select avg(km_gain) from km), 1) end,
           'gain_share', case when (select count(km_gain) from km) >= minans
                              then round((select count(*) filter (where km_gain >= (tg ->> 'gain_min')::int) from km)::numeric / (select count(km_gain) from km), 3) end,
           'steps_done_rate', case when (select coalesce(sum(km_checked), 0) from km) > 0
                                   then round((select sum(km_done) from km)::numeric / (select sum(km_checked) from km), 3) end,
           'checkin_rate', case when (select coalesce(sum(km_set), 0) from km) > 0
                                then round((select sum(km_checked) from km)::numeric / (select sum(km_set) from km), 3) end,
           'ever_came', (select count(*) from km where km_attended > 0),
           'still_coming', (select count(*) from km where km_attended > 0 and km_recent > 0),
           'verdicts', jsonb_build_object(
             'effective', (select count(*) from kc where kc_verdict = 'effective'),
             'not_yet', (select count(*) from kc where kc_verdict = 'not_yet'),
             'on_course', (select count(*) from kc where kc_verdict = 'on_course'),
             'close', (select count(*) from kc where kc_verdict = 'close'),
             'at_risk', (select count(*) from kc where kc_verdict = 'at_risk')))
    into h;

  -- Week by week, for the tribes in scope
  select coalesce(jsonb_agg(w order by (w ->> 'week')::int), '[]'::jsonb) into weeks_json
    from (
      select jsonb_build_object(
               'week', g.w,
               'current', cw = g.w,
               'logged', (select count(*) from public.tribe_logs l where l.week = g.w and l.tribe_id = any(scope)),
               'met', (select count(*) from public.tribe_logs l where l.week = g.w and l.held and l.tribe_id = any(scope)),
               'present', (select count(*) from public.tribe_attendance a
                            join public.tribe_logs l on l.tribe_id = a.tribe_id and l.week = a.week and l.held
                           where a.week = g.w and a.status = 'present' and a.tribe_id = any(scope)),
               'possible', (select count(*) from public.tribe_attendance a
                             join public.tribe_logs l on l.tribe_id = a.tribe_id and l.week = a.week and l.held
                            where a.week = g.w and a.tribe_id = any(scope)),
               'steps_set', (select count(*) from public.week_steps ws where ws.week = g.w and ws.tribe_id = any(scope)),
               'steps_done', (select count(*) from public.week_steps ws where ws.week = g.w and ws.outcome = 'done' and ws.tribe_id = any(scope)),
               'steps_checked', (select count(*) from public.week_steps ws where ws.week = g.w and ws.outcome is not null and ws.tribe_id = any(scope))) as w
        from generate_series(1, case when cw = 0 then 0 else least(cw, s.weeks) end) as g(w)) q;


  return jsonb_build_object('tribes', tribes_json, 'headline', h, 'weeks', weeks_json);
end;
$function$;

-- tribe_progress
CREATE OR REPLACE FUNCTION public.tribe_progress(p_tribe uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  minans integer := (public.kpi_targets() ->> 'min_answers')::int;
  mincell integer := (public.kpi_targets() ->> 'min_cell')::int;
  cw integer;
  gone integer;
  need integer;
  state text;
  k record;
  see_rate boolean;
  members_json jsonb;
  weeks_json jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false) or office) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  need := ceil(round(s.weeks * (tg ->> 'attend_share')::numeric, 4))::int;
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  select * into k from public.kpi_tribes(c.season_id) where kc_tribe = p_tribe;
  -- A leader sees how the tribe is doing as a whole only when enough people stand behind the number
  -- for nobody's belonging answer to be guessed from it. A coach or pastor always can.
  see_rate := found and (office or coalesce(c.coach_id = uid, false) or k.kc_members >= mincell);

  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', m.person_id,
           'name', public.person_display_name(m.person_id),
           'waiting', not public.seat_said_yes(m.placement_source, m.confirmed_at),
           'attended', coalesce(km.km_attended, 0),
           'steps_set', coalesce(km.km_set, 0),
           'steps_done', coalesce(km.km_done, 0),
           -- Pace on meetings alone: belonging answers stay private
           'pace', case when not public.seat_said_yes(m.placement_source, m.confirmed_at) then null when gone >= (tg ->> 'min_weeks')::int
                        then case when coalesce(km.km_attended, 0) * s.weeks >= need * gone then 'on_pace' else 'behind' end end)
           order by public.person_display_name(m.person_id)), '[]'::jsonb)
    into members_json
    from public.tribe_members m
    left join public.kpi_members(c.season_id) km on km.km_person = m.person_id and km.km_tribe = m.tribe_id
   where m.tribe_id = p_tribe and m.status = 'active';

  select coalesce(jsonb_agg(w order by (w ->> 'week')::int), '[]'::jsonb) into weeks_json
    from (
      select jsonb_build_object(
               'week', g.w,
               'logged', exists (select 1 from public.tribe_logs l where l.tribe_id = p_tribe and l.week = g.w),
               'held', exists (select 1 from public.tribe_logs l where l.tribe_id = p_tribe and l.week = g.w and l.held),
               'present', (select count(*) from public.tribe_attendance a where a.tribe_id = p_tribe and a.week = g.w and a.status = 'present'),
               'marked', (select count(*) from public.tribe_attendance a where a.tribe_id = p_tribe and a.week = g.w),
               'steps_set', (select count(*) from public.week_steps ws where ws.tribe_id = p_tribe and ws.week = g.w),
               'steps_done', (select count(*) from public.week_steps ws where ws.tribe_id = p_tribe and ws.week = g.w and ws.outcome = 'done'),
               'steps_checked', (select count(*) from public.week_steps ws where ws.tribe_id = p_tribe and ws.week = g.w and ws.outcome is not null)) as w
        from generate_series(1, case when cw = 0 then 0 else least(cw, s.weeks) end) as g(w)) q;

  return jsonb_build_object(
    'state', state,
    'targets', tg,
    'tribe', jsonb_build_object('id', c.id, 'name', c.name, 'capacity', c.capacity),
    'season', jsonb_build_object('name', s.name, 'weeks', s.weeks, 'current_week', case when cw between 1 and s.weeks then cw end,
                                 'weeks_over', gone, 'meetings_needed', need),
    'members', coalesce(k.kc_members, 0),
    'waiting', (select count(*)::int from public.tribe_members w where w.tribe_id = p_tribe and w.status = 'active' and not public.seat_said_yes(w.placement_source, w.confirmed_at)),
    'attendance_rate', case when k.kc_possible > 0 then round(k.kc_present::numeric / k.kc_possible, 3) end,
    'held', coalesce(k.kc_held, 0),
    'steps_done_rate', case when k.kc_checked > 0 then round(k.kc_done::numeric / k.kc_checked, 3) end,
    'checkin_rate', case when k.kc_set > 0 then round(k.kc_checked::numeric / k.kc_set, 3) end,
    'can_see_rate', see_rate,
    'thriving', case when see_rate and k.kc_measured then k.kc_thriving end,
    'thriving_rate', case when see_rate and k.kc_measured then round(k.kc_thriving::numeric / k.kc_members, 3) end,
    'verdict', case when see_rate then k.kc_verdict end,
    'picture', jsonb_build_object(
      'answers', coalesce(k.kc_base_n, 0),
      'base_avg', case when k.kc_base_n >= minans then round(k.kc_base_avg, 1) end,
      'latest_avg', case when k.kc_latest_n >= minans then round(k.kc_latest_avg, 1) end,
      'gain_n', coalesce(k.kc_gain_n, 0),
      'gain_avg', case when k.kc_gain_n >= minans then round(k.kc_gain_avg, 1) end,
      'gain_share', case when k.kc_gain_n >= minans then round(k.kc_gain_ok::numeric / k.kc_gain_n, 3) end),
    'weeks', weeks_json,
    'member_rows', members_json);
end;
$function$;

-- placement_filter_members
CREATE OR REPLACE FUNCTION public.placement_filter_members(p_tribe uuid, p_members jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.tribes%rowtype;
  v_team boolean;
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    return p_members;
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  v_team := coalesce(auth.uid() = c.leader_id, false) or coalesce(auth.uid() = c.assistant_id, false);
  return coalesce((
    select jsonb_agg(
             case
               when tm.placement_source = 'auto' then
                 e.v
                 || jsonb_build_object('placement', case when tm.confirmed_at is null then 'pending' else 'confirmed' end,
                                       'contact', k.c ->> 'state', 'contact_opens_at', k.c -> 'opens_at')
                 || case when tm.contact_withheld or (v_team and (k.c ->> 'state') in ('holding', 'waiting', 'not_reached', 'unanswered'))
                         then jsonb_build_object('whatsapp', null) else '{}'::jsonb end
                 || case when tm.contact_withheld then jsonb_build_object('withheld', true) else '{}'::jsonb end
               when tm.contact_withheld then e.v || jsonb_build_object('whatsapp', null, 'withheld', true)
               else e.v
             end
             order by e.ord)
      from jsonb_array_elements(p_members) with ordinality as e(v, ord)
      left join public.tribe_members tm
        on tm.tribe_id = p_tribe and tm.person_id = (e.v ->> 'person_id')::uuid and tm.status = 'active'
      left join lateral (select public.placement_contact(tm.id) as c) k on true), '[]'::jsonb);
end;
$function$;

-- placement_run_view
CREATE OR REPLACE FUNCTION public.placement_run_view(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told,
      'created_at', r.created_at, 'planned_at', r.planned_at, 'approved_at', r.approved_at, 'placed_at', r.placed_at, 'closed_at', r.closed_at,
      'undone_at', r.undone_at, 'grace_days', r.grace_days, 'seats_free', r.seats_free, 'min_tribe', r.min_tribe, 'pace_per_hour', r.pace_per_hour,
      'send_from', r.send_from, 'send_until', r.send_until, 'hold_hours', r.hold_hours,
      'scope_community', (select c.name from public.communities c where c.id = r.scope_community), 'scope_zone', r.scope_zone,
      'season', (select s.name from public.seasons s where s.id = r.season_id)),
    'heartbeat_at', (select s.last_tick_at from public.placement_settings s where s.singleton),
    'mode', public.placement_mode(),
    'counts', coalesce((select jsonb_object_agg(z.status, z.n) from (select i.status, count(*)::integer as n from public.placement_items i where i.run_id = p_run group by i.status) z), '{}'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('status', z.status, 'reason', z.reason, 'n', z.n) order by z.n desc, z.reason)
                           from (select i.status, i.reason, count(*)::integer as n from public.placement_items i
                                  where i.run_id = p_run and i.reason is not null group by i.status, i.reason) z), '[]'::jsonb),
    'fit', coalesce((select jsonb_object_agg(z.label, z.n) from (select public.degree_label(i.degree) as label, count(*)::integer as n
                       from public.placement_items i where i.run_id = p_run and i.status in ('proposed', 'placed', 'rehearsed') group by 1) z), '{}'::jsonb),
    'days', (select ceil(count(*)::numeric / greatest(r.pace_per_hour * (r.send_until - r.send_from), 1))::integer
               from public.placement_items i where i.run_id = p_run and i.status in ('proposed', 'placed', 'rehearsed')),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tribe', t.id, 'name', t.name, 'leader_first', public.first_name_of(t.leader_id), 'capacity', t.capacity,
               'active_before', pt.active_before, 'proposed', pt.proposed, 'small', pt.small, 'decision', pt.decision,
               'mail_queued_at', pt.mail_queued_at, 'cancelled_at', pt.cancelled_at, 'contact_opened_at', pt.contact_opened_at,
               'placed', (select count(*) from public.placement_items i where i.run_id = p_run and i.tribe_id = t.id and i.status in ('placed', 'rehearsed')),
               'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.confirmed_at is not null),
               'withheld', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.contact_withheld),
               'changed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'released'),
               -- Why this tribe's leader has or has not been told: the member emails sent, still waiting and failed, how many have not answered,
               -- when the last hold ends, and one word for where it stands (the words of Check 4 in the blueprint)
               'sent', z.sent, 'waiting', z.waiting, 'failed', z.failed, 'holding', z.holding, 'unanswered', z.unanswered, 'opens_at', z.opens_at,
               'state', case
                          when r.rehearsal then 'rehearsal'
                          when pt.mail_queued_at is not null then case when pt.contact_opened_at is not null then 'opened' else 'told' end
                          when pt.cancelled_at is not null then 'cancelled'
                          when exists (select 1 from public.placement_items i where i.run_id = p_run and i.tribe_id = t.id and i.status = 'proposed') then 'placing'
                          when z.waiting > 0 then 'waiting'
                          when z.holding > 0 then 'holding'
                          when z.seated > 0 and z.sent = 0 then 'none_sent'
                          else 'due' end,
               'fit', coalesce((select jsonb_object_agg(x.label, x.n) from (
                         select public.degree_label(i.degree) as label, count(*)::integer as n from public.placement_items i
                          where i.run_id = p_run and i.tribe_id = t.id and i.status in ('proposed', 'placed', 'rehearsed') group by 1) x), '{}'::jsonb))
             order by pt.small desc, t.name)
        from public.placement_teams pt
        join public.tribes t on t.id = pt.tribe_id
        left join lateral (
          select count(*)::integer as seated,
                 count(*) filter (where msg.status in ('sent', 'delivered', 'read'))::integer as sent,
                 count(*) filter (where msg.status in ('queued', 'sending'))::integer as waiting,
                 count(*) filter (where msg.id is null or msg.status not in ('sent', 'delivered', 'read', 'queued', 'sending'))::integer as failed,
                 count(*) filter (where k.c ->> 'state' = 'holding')::integer as holding,
                 count(*) filter (where k.c ->> 'state' in ('holding', 'waiting', 'not_reached', 'unanswered'))::integer as unanswered,
                 max((k.c ->> 'opens_at')::timestamptz) filter (where k.c ->> 'state' = 'holding') as opens_at
            from public.tribe_members m
            left join public.placement_items i on i.placement_id = m.id
            left join public.messages msg on msg.id = i.member_message
            cross join lateral (select public.placement_contact(m.id) as c) k
           where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active') z on true
       where pt.run_id = p_run and (pt.proposed > 0 or pt.mail_queued_at is not null)), '[]'::jsonb),
    'results', jsonb_build_object(
      'placed', (select count(*) from public.placement_items i where i.run_id = p_run and i.status = 'placed'),
      'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'active' and m.confirmed_at is not null),
      'withheld', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'active' and m.contact_withheld),
      'changed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'released' and m.release_reason = 'Chose to look at other tribes'),
      'messages', coalesce((select jsonb_object_agg(z.status, z.n) from (
                    select msg.status, count(*)::integer as n from public.placement_items i join public.messages msg on msg.id = i.member_message
                     where i.run_id = p_run group by msg.status) z), '{}'::jsonb),
      'leaders_told', (select count(*) from public.placement_teams pt where pt.run_id = p_run and pt.mail_queued_at is not null),
      'leaders_waiting', (select count(*) from public.placement_teams pt where pt.run_id = p_run and pt.proposed > 0 and pt.mail_queued_at is null and pt.cancelled_at is null)));
end;
$function$;

-- placement_open_now
CREATE OR REPLACE FUNCTION public.placement_open_now(p_run uuid, p_tribe uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
  pt public.placement_teams;
  v_shared integer;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.rehearsal or r.status not in ('placing', 'placed') then
    raise exception 'Only a live run that has placed people can be opened' using errcode = '22023';
  end if;
  select * into pt from public.placement_teams x where x.run_id = p_run and x.tribe_id = p_tribe and x.cancelled_at is null and x.proposed > 0 for update;
  if not found then
    raise exception 'That tribe has no team in this run' using errcode = 'P0002';
  end if;
  if pt.mail_queued_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'shared', 0);
  end if;
  if exists (select 1 from public.placement_items x where x.run_id = p_run and x.tribe_id = p_tribe and x.status = 'proposed') then
    raise exception 'Some of this team has not been placed yet. Wait for the run to finish placing' using errcode = '22023';
  end if;
  select count(*)::integer into v_shared
    from public.tribe_members m cross join lateral (select public.placement_contact(m.id) as c) k
   where m.placed_by_run = p_run and m.tribe_id = p_tribe and m.status = 'active' and k.c ->> 'state' in ('holding', 'waiting', 'not_reached', 'unanswered');
  update public.placement_teams set contact_opened_at = coalesce(contact_opened_at, now()) where run_id = p_run and tribe_id = p_tribe;
  perform public.placement_team_mail_for(p_run, p_tribe);
  perform public.write_event(auth.uid(), 'placement.opened', 'tribe', p_tribe::text, jsonb_build_object('run', p_run, 'shared', v_shared));
  return jsonb_build_object('ok', true, 'shared', v_shared);
end;
$function$;

-- placement_open_all
CREATE OR REPLACE FUNCTION public.placement_open_all(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
  pt public.placement_teams;
  v_n integer;
  v_tribes integer := 0;
  v_shared integer := 0;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.rehearsal or r.status not in ('placing', 'placed') then
    raise exception 'Only a live run that has placed people can be opened' using errcode = '22023';
  end if;
  for pt in select x.* from public.placement_teams x
             where x.run_id = p_run and x.cancelled_at is null and x.proposed > 0 and x.mail_queued_at is null
               and not exists (select 1 from public.placement_items y where y.run_id = p_run and y.tribe_id = x.tribe_id and y.status = 'proposed')
             order by x.tribe_id for update loop
    select count(*)::integer into v_n
      from public.tribe_members m cross join lateral (select public.placement_contact(m.id) as c) k
     where m.placed_by_run = p_run and m.tribe_id = pt.tribe_id and m.status = 'active' and k.c ->> 'state' in ('holding', 'waiting', 'not_reached', 'unanswered');
    v_shared := v_shared + v_n;
    update public.placement_teams set contact_opened_at = coalesce(contact_opened_at, now()) where run_id = p_run and tribe_id = pt.tribe_id;
    v_tribes := v_tribes + 1;
  end loop;
  perform public.placement_team_mail(p_run);
  perform public.write_event(auth.uid(), 'placement.opened_all', 'placement_run', p_run::text, jsonb_build_object('tribes', v_tribes, 'shared', v_shared));
  return jsonb_build_object('ok', true, 'tribes', v_tribes, 'shared', v_shared);
end;
$function$;

-- contact_gap_cause_of
CREATE OR REPLACE FUNCTION public.contact_gap_cause_of(p_person uuid, p_tm uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_phone text;
  v_state text;
  v_blocker text;
begin
  if public.is_minor(p_person) then
    return null;
  end if;
  v_blocker := public.message_blocker(p_person);
  if v_blocker in ('under18', 'deletion') then
    return null;
  end if;
  if coalesce((select tm.contact_withheld from public.tribe_members tm where tm.id = p_tm), false) then
    return 'withheld';
  end if;
  v_state := public.placement_contact(p_tm) ->> 'state';
  if v_state in ('holding', 'waiting', 'not_reached', 'unanswered') then
    return 'not_open';
  end if;
  v_phone := coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = p_person),
                      (select mp.whatsapp from public.member_profiles mp where mp.person_id = p_person));
  if v_phone is null then
    return case when v_blocker in ('email_off', 'bounced') then 'unreachable' else 'no_number' end;
  end if;
  if public.number_looks_made_up(v_phone) then
    return 'made_up';
  end if;
  if not public.consent_granted(p_person, 'whatsapp') then
    return 'no_yes';
  end if;
  return null;
end;
$function$;

-- placement_state
CREATE OR REPLACE FUNCTION public.placement_state(p_tm uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_queued boolean;
  v_c jsonb;
  v_group boolean;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into t from public.tribes x where x.id = tm.tribe_id;
  select * into s from public.seasons x where x.id = tm.season_id;
  v_c := public.placement_contact(p_tm);
  v_group := public.placement_group_open(p_tm);
  select coalesce(bool_or(pt.mail_queued_at is not null), false) into v_queued
    from public.placement_teams pt where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id;
  return jsonb_build_object(
    'found', true,
    'first_name', public.first_name_of(tm.person_id),
    'active', tm.status = 'active',
    'placed_by_church', tm.placement_source = 'auto',
    'confirmed', tm.confirmed_at is not null,
    'withheld', tm.contact_withheld,
    'leader_told', v_queued,
    -- Whether the leader has this member's contact yet ('open', or 'holding' until the date, 'waiting' for the email, 'not_reached'), and the group link
    'contact', v_c ->> 'state',
    'contact_opens_at', v_c -> 'opens_at',
    'contact_late', coalesce((v_c ->> 'late')::boolean, false),
    'group_visible', v_group,
    'group_opens_at', null,
    'can_change', tm.status = 'active' and public.placement_change_open(s.starts_on),
    'in_season', s.starts_on <= public.today_lagos(),
    'change_until', s.starts_on + (public.reminder_cfg()).joining_closes_days,
    'fit', case when tm.degree is null then null else public.degree_label(tm.degree) end,
    'tribe', jsonb_build_object(
      'name', t.name, 'leader_first', public.first_name_of(t.leader_id),
      'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
      'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
      'place_note', t.place_note, 'group_url', case when v_group then t.whatsapp_group_url end, 'first_meeting_on', t.first_meeting_on,
      'first_meeting_by', tm.first_meeting_by, 'season', s.name, 'starts_on', s.starts_on,
      'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(tm.person_id, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = tm.person_id), false));
end;
$function$;

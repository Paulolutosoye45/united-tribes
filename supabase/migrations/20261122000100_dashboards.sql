-- Phase 6: dashboards and KPIs
--
-- One place decides what "thriving" means, so the church dashboard, a coach's view, a leader's
-- progress page and a member's own page can never disagree:
--
--   kpi_targets()        the numbers the programme is held to (85% thriving, 8 of 12 meetings, ...)
--   kpi_members(season)  one row per placed member: meetings, belonging, Success Picture, steps, thriving
--   kpi_circles(season)  one row per circle, with its verdict
--   dashboard(season)    the church dashboard (pastorate, directors, data lead) or a coach's circles
--   circle_progress(c)   a leader's view of their own circle
--   my_progress()        a member's view of their own season
--
-- Nothing here stores anything: every figure is worked out from the weekly rhythm (Phase 5) when read.
--
-- What the words mean
--   Thriving         came to at least two thirds of the season's meetings (8 of 12) AND the latest
--                    belonging answer is 4 or 5.
--   Success Picture  the three pulse answers (God, others, life, each 1 to 5) added up: 3 to 15.
--   Gain             the latest pulse's score minus the week-1 score.
--   Circle effective at least 80% of its members thriving AND at least 70% of those with two pulses
--                    gaining 2 or more points. Judged when the season is over; while it runs the
--                    verdict is "on course", "close" or "at risk" and uses the thriving rate alone.
--   Pace             while the season runs a member is counted by how they are doing so far:
--                    meetings so far against two thirds, and belonging. No rate is shown before
--                    three weeks have passed.

-- ---------------------------------------------------------------------------
-- The targets
-- ---------------------------------------------------------------------------

create function public.kpi_targets()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'thriving_rate', 0.85,        -- the programme's goal: share of members thriving
    'attend_share', 2.0 / 3,      -- 8 of 12
    'belonging_min', 4,
    'gain_min', 2,                -- points on the 3 to 15 Success Picture score
    'effective_thriving', 0.80,   -- a circle is effective at this share thriving ...
    'effective_gain', 0.70,       -- ... and this share of members gaining
    'min_weeks', 3,               -- no rate before three weeks have passed
    'min_cell', 5,                -- breakdowns hide a rate for fewer people than this
    'min_answers', 3,             -- an average needs this many answers
    'retrain_after', 300          -- placements to finish before the matching weights are retrained
  );
$$;

-- ---------------------------------------------------------------------------
-- One row per placed member (internal)
-- ---------------------------------------------------------------------------

create function public.kpi_members(p_season uuid)
returns table (
  km_person uuid,
  km_circle uuid,
  km_degree smallint,
  km_rank smallint,
  km_attended integer,
  km_recent integer,
  km_belonging integer,
  km_base integer,
  km_latest integer,
  km_latest_week integer,
  km_set integer,
  km_done integer,
  km_checked integer,
  km_measured boolean,
  km_thriving boolean,
  km_gain integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  select m.person_id, m.circle_id, m.degree, m.chosen_rank,
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
    from public.circle_members m
    join public.circles c on c.id = m.circle_id and c.season_id = p_season
    left join lateral (
      select count(*) filter (where a.week <= gone) as n,
             count(*) filter (where a.week <= gone and a.week > gone - 3) as recent
        from public.circle_attendance a
        join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
       where a.circle_id = m.circle_id and a.person_id = m.person_id and a.status = 'present') att on true
    left join lateral (
      select p.belonging, (p.god + p.others + p.life)::int as total, p.week
        from public.pulses p
       where p.person_id = m.person_id and p.circle_id = m.circle_id
       order by p.week desc limit 1) pl on true
    left join lateral (
      select (p.god + p.others + p.life)::int as total
        from public.pulses p
       where p.person_id = m.person_id and p.circle_id = m.circle_id and p.week = 1) pb on true
    left join lateral (
      select count(*) as set_n,
             count(*) filter (where w.outcome = 'done') as done_n,
             count(*) filter (where w.outcome is not null) as checked_n
        from public.week_steps w
       where w.person_id = m.person_id and w.circle_id = m.circle_id) st on true
   where m.status = 'active' and m.season_id = p_season;
end;
$$;

-- ---------------------------------------------------------------------------
-- One row per circle with members (internal)
-- ---------------------------------------------------------------------------

create function public.kpi_circles(p_season uuid)
returns table (
  kc_circle uuid,
  kc_members integer,
  kc_held integer,
  kc_present integer,
  kc_possible integer,
  kc_measured boolean,
  kc_thriving integer,
  kc_base_n integer,
  kc_base_avg numeric,
  kc_latest_n integer,
  kc_latest_avg numeric,
  kc_gain_n integer,
  kc_gain_avg numeric,
  kc_gain_ok integer,
  kc_set integer,
  kc_done integer,
  kc_checked integer,
  kc_ever integer,
  kc_recent integer,
  kc_verdict text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seasons%rowtype;
  today date := public.today_lagos();
  cw integer;
  gone integer;
  eff_t numeric := (public.kpi_targets() ->> 'effective_thriving')::numeric;
  eff_g numeric := (public.kpi_targets() ->> 'effective_gain')::numeric;
  gmin integer := (public.kpi_targets() ->> 'gain_min')::int;
  floor_weeks integer := (public.kpi_targets() ->> 'min_weeks')::int;
begin
  select * into s from public.seasons where id = p_season;
  if not found then
    return;
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;

  return query
  with k as (select * from public.kpi_members(p_season)),
  agg as (
    select k.km_circle as circle_id,
           count(*)::int as members,
           coalesce(sum(k.km_attended), 0)::int as present,
           count(*) filter (where k.km_thriving)::int as thriving,
           count(k.km_base)::int as base_n,
           avg(k.km_base) as base_avg,
           count(k.km_latest)::int as latest_n,
           avg(k.km_latest) as latest_avg,
           count(k.km_gain)::int as gain_n,
           avg(k.km_gain) as gain_avg,
           count(*) filter (where k.km_gain >= gmin)::int as gain_ok,
           coalesce(sum(k.km_set), 0)::int as set_n,
           coalesce(sum(k.km_done), 0)::int as done_n,
           coalesce(sum(k.km_checked), 0)::int as checked_n,
           count(*) filter (where k.km_attended > 0)::int as ever,
           count(*) filter (where k.km_attended > 0 and k.km_recent > 0)::int as recent
      from k group by k.km_circle),
  held as (
    select l.circle_id, count(*)::int as n
      from public.circle_logs l
     where l.held and l.week <= gone
     group by l.circle_id)
  select a.circle_id, a.members, coalesce(h.n, 0), a.present, a.members * coalesce(h.n, 0),
         gone >= floor_weeks,
         a.thriving, a.base_n, a.base_avg, a.latest_n, a.latest_avg, a.gain_n, a.gain_avg, a.gain_ok,
         a.set_n, a.done_n, a.checked_n, a.ever, a.recent,
         case
           when cw = 0 then 'before'
           when gone < floor_weeks then 'too_early'
           when cw <= s.weeks then
             case when a.thriving::numeric / a.members >= eff_t then 'on_course'
                  when a.thriving::numeric / a.members >= 0.6 then 'close'
                  else 'at_risk' end
           else
             case when a.thriving::numeric / a.members >= eff_t
                       and a.gain_n > 0 and a.gain_ok::numeric / a.gain_n >= eff_g
                  then 'effective' else 'not_yet' end
         end
    from agg a
    left join held h on h.circle_id = a.circle_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared by the dashboard views: the season as it stands today (internal)
-- ---------------------------------------------------------------------------

-- The season a dashboard opens on: the latest one that has started, else the next one to start.
create function public.dashboard_season(p_season uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_season,
    (select id from public.seasons where starts_on <= public.today_lagos() order by starts_on desc limit 1),
    (select id from public.seasons order by starts_on asc limit 1));
$$;

-- ---------------------------------------------------------------------------
-- The dashboard
-- ---------------------------------------------------------------------------

create function public.dashboard(p_season uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  church boolean := public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]);
  is_coach boolean := public.has_any_role(array['coach']::public.app_role[]);
  sid uuid;
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  cw integer;
  gone integer;
  need integer;
  state text;
  mincell integer := (public.kpi_targets() ->> 'min_cell')::int;
  minans integer := (public.kpi_targets() ->> 'min_answers')::int;
  scope uuid[];
  h jsonb;
  circles_json jsonb;
  weeks_json jsonb;
  seasons_json jsonb;
  result jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (church or is_coach) then
    raise exception 'Only the pastorate, directors, the data lead and coaches can see the dashboard' using errcode = '42501';
  end if;

  sid := public.dashboard_season(p_season);
  select * into s from public.seasons where id = sid;
  if not found then
    return jsonb_build_object('state', 'none', 'targets', tg);
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  need := ceil(round(s.weeks * (tg ->> 'attend_share')::numeric, 4))::int;
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  -- A coach sees only their own circles
  select coalesce(array_agg(c.id), '{}') into scope
    from public.circles c
   where c.season_id = sid and c.status = 'approved'
     and (church or c.coach_id = uid);

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'starts_on', x.starts_on, 'weeks', x.weeks) order by x.starts_on desc), '[]'::jsonb)
    into seasons_json from public.seasons x;

  -- The circles, with their numbers and verdict
  select coalesce(jsonb_agg(r order by
           case r ->> 'verdict' when 'at_risk' then 0 when 'not_yet' then 1 when 'close' then 2 when 'too_early' then 3 when 'before' then 4 else 5 end,
           r ->> 'name'), '[]'::jsonb)
    into circles_json
    from (
      select jsonb_build_object(
               'circle_id', c.id, 'name', c.name,
               'leader', public.person_display_name(c.leader_id),
               'coach', case when c.coach_id is null then null else public.person_display_name(c.coach_id) end,
               'tribe', t.name, 'track', tr.name,
               'members', k.kc_members, 'capacity', c.capacity,
               'held', k.kc_held,
               'attendance_rate', case when k.kc_possible > 0 then round(k.kc_present::numeric / k.kc_possible, 3) end,
               'thriving', case when k.kc_measured then k.kc_thriving end,
               'thriving_rate', case when k.kc_measured then round(k.kc_thriving::numeric / k.kc_members, 3) end,
               'gain_n', k.kc_gain_n,
               'gain_avg', case when k.kc_gain_n >= minans then round(k.kc_gain_avg, 1) end,
               'gain_share', case when k.kc_gain_n >= minans then round(k.kc_gain_ok::numeric / k.kc_gain_n, 3) end,
               'steps_done_rate', case when k.kc_checked > 0 then round(k.kc_done::numeric / k.kc_checked, 3) end,
               'verdict', k.kc_verdict) as r
        from public.kpi_circles(sid) k
        join public.circles c on c.id = k.kc_circle
        left join public.tribes t on t.id = c.tribe_id
        left join public.tracks tr on tr.id = c.track_id
       where c.id = any(scope)) q;

  -- The headline numbers, for the circles in scope
  with km as (select * from public.kpi_members(sid) where km_circle = any(scope)),
       kc as (select * from public.kpi_circles(sid) where kc_circle = any(scope))
  select jsonb_build_object(
           'members', (select count(*) from km),
           'circles', (select count(*) from kc),
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

  -- Week by week, for the circles in scope
  select coalesce(jsonb_agg(w order by (w ->> 'week')::int), '[]'::jsonb) into weeks_json
    from (
      select jsonb_build_object(
               'week', g.w,
               'current', cw = g.w,
               'logged', (select count(*) from public.circle_logs l where l.week = g.w and l.circle_id = any(scope)),
               'met', (select count(*) from public.circle_logs l where l.week = g.w and l.held and l.circle_id = any(scope)),
               'present', (select count(*) from public.circle_attendance a
                            join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
                           where a.week = g.w and a.status = 'present' and a.circle_id = any(scope)),
               'possible', (select count(*) from public.circle_attendance a
                             join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
                            where a.week = g.w and a.circle_id = any(scope)),
               'steps_set', (select count(*) from public.week_steps ws where ws.week = g.w and ws.circle_id = any(scope)),
               'steps_done', (select count(*) from public.week_steps ws where ws.week = g.w and ws.outcome = 'done' and ws.circle_id = any(scope)),
               'steps_checked', (select count(*) from public.week_steps ws where ws.week = g.w and ws.outcome is not null and ws.circle_id = any(scope))) as w
        from generate_series(1, case when cw = 0 then 0 else least(cw, s.weeks) end) as g(w)) q;

  result := jsonb_build_object(
    'state', state,
    'scope', case when church then 'church' else 'coach' end,
    'targets', tg,
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'weeks', s.weeks,
                                 'current_week', case when cw between 1 and s.weeks then cw end,
                                 'weeks_over', gone, 'meetings_needed', need),
    'seasons', seasons_json,
    'headline', h,
    'weeks', weeks_json,
    'circles', circles_json);

  if not church then
    return result;
  end if;

  -- ---- Church-wide views: the journey, supply and demand, the tribes, how well the matching works, care ----
  result := result || jsonb_build_object(
    'funnel', jsonb_build_array(
      jsonb_build_object('key', 'started', 'label', 'Started the form',
        'count', (select count(*) from public.intake_drafts) + (select count(*) from public.member_profiles where season_id = sid)),
      jsonb_build_object('key', 'finished', 'label', 'Finished the form',
        'count', (select count(*) from public.member_profiles where season_id = sid)),
      jsonb_build_object('key', 'shown', 'label', 'Were shown circles',
        'count', (select count(distinct r.person_id) from public.match_runs r where r.season_id = sid and r.shown > 0)),
      jsonb_build_object('key', 'chose', 'label', 'Chose a circle',
        'count', (select count(distinct m.person_id) from public.circle_members m where m.season_id = sid and m.status = 'active')),
      jsonb_build_object('key', 'came', 'label', 'Came to a meeting',
        'count', (select count(*) from public.kpi_members(sid) where km_attended > 0)),
      jsonb_build_object('key', 'thriving', 'label', 'Thriving',
        'count', (select count(*) from public.kpi_members(sid) where km_thriving))),

    'supply', (
      with w as (
        select mp.tribe_id, ar.track_id, count(*)::int as n
          from public.member_profiles mp
          join public.age_ranges ar on ar.id = mp.age_range_id
         where mp.season_id = sid and mp.tribe_id is not null
         group by mp.tribe_id, ar.track_id),
      seats as (
        select c.tribe_id, c.track_id, sum(c.capacity)::int as seats
          from public.circles c
         where c.season_id = sid and c.status = 'approved'
           and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
         group by c.tribe_id, c.track_id),
      placed as (
        select c.tribe_id, c.track_id, count(*)::int as placed
          from public.circle_members m
          join public.circles c on c.id = m.circle_id
         where m.status = 'active' and c.season_id = sid
         group by c.tribe_id, c.track_id),
      cells as (
        select coalesce(w.tribe_id, seats.tribe_id, placed.tribe_id) as tribe_id,
               coalesce(w.track_id, seats.track_id, placed.track_id) as track_id,
               coalesce(w.n, 0) as wants, coalesce(seats.seats, 0) as seats, coalesce(placed.placed, 0) as placed
          from w
          full join seats on seats.tribe_id = w.tribe_id and seats.track_id = w.track_id
          full join placed on placed.tribe_id = coalesce(w.tribe_id, seats.tribe_id)
                          and placed.track_id = coalesce(w.track_id, seats.track_id))
      select jsonb_build_object(
        'tribes', (select coalesce(jsonb_agg(t.name order by t.sort), '[]'::jsonb) from public.tribes t where t.active),
        'tracks', (select coalesce(jsonb_agg(tr.name order by tr.sort), '[]'::jsonb) from public.tracks tr where tr.active),
        'cells', (select coalesce(jsonb_agg(jsonb_build_object('tribe', t.name, 'track', tr.name, 'wants', c.wants, 'seats', c.seats, 'placed', c.placed)), '[]'::jsonb)
                    from cells c join public.tribes t on t.id = c.tribe_id join public.tracks tr on tr.id = c.track_id),
        'wants', (select coalesce(sum(wants), 0) from cells),
        'seats', (select coalesce(sum(seats), 0) from cells),
        'placed', (select coalesce(sum(placed), 0) from cells),
        'unmet', (select count(*) from public.match_demand d where d.season_id = sid))),

    'tribes', (
      select coalesce(jsonb_agg(x order by (x ->> 'members')::int desc, x ->> 'tribe'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'tribe', t.name,
                   'members', count(*),
                   'thriving_rate', case when count(*) >= mincell and gone >= (tg ->> 'min_weeks')::int
                                         then round(count(*) filter (where k.km_thriving)::numeric / count(*), 3) end,
                   'gain_avg', case when count(k.km_gain) >= minans then round(avg(k.km_gain), 1) end) as x
            from public.kpi_members(sid) k
            join public.circles c on c.id = k.km_circle
            join public.tribes t on t.id = c.tribe_id
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
        'completed', (select count(*) from public.circle_members m
                       join public.circles c on c.id = m.circle_id
                       join public.seasons x on x.id = c.season_id
                      where m.status = 'active' and public.season_week(x.starts_on, x.weeks, today) > x.weeks),
        'retrain_after', (tg ->> 'retrain_after')::int)),

    'care', (
      select jsonb_build_object(
        'open', count(*) filter (where f.status = 'open'),
        'escalated', count(*) filter (where f.status = 'escalated'),
        'oldest_open_days', (select max(today - (g.opened_at at time zone 'Africa/Lagos')::date)
                               from public.care_flags g join public.circles gc on gc.id = g.circle_id
                              where g.status <> 'closed' and gc.season_id = sid),
        'closed_7d', count(*) filter (where f.status = 'closed' and f.closed_at >= now() - interval '7 days'),
        'median_days_to_close', (select round(percentile_cont(0.5) within group (order by extract(epoch from (g.closed_at - g.opened_at)) / 86400)::numeric, 1)
                                   from public.care_flags g join public.circles gc on gc.id = g.circle_id
                                  where g.status = 'closed' and g.closed_at is not null and gc.season_id = sid))
        from public.care_flags f join public.circles fc on fc.id = f.circle_id
       where fc.season_id = sid),

    'testimonies', (
      select jsonb_build_object(
        'waiting', count(*) filter (where t.status = 'submitted'),
        'circle', count(*) filter (where t.status = 'circle_approved'),
        'church', count(*) filter (where t.status = 'church_approved'),
        'declined', count(*) filter (where t.status = 'declined'))
        from public.testimonies t join public.circles tc on tc.id = t.circle_id
       where tc.season_id = sid));

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- A leader's view of their own circle
-- ---------------------------------------------------------------------------

create function public.circle_progress(p_circle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
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
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false) or office) then
    raise exception 'You do not run this circle' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  need := ceil(round(s.weeks * (tg ->> 'attend_share')::numeric, 4))::int;
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  select * into k from public.kpi_circles(c.season_id) where kc_circle = p_circle;
  -- A leader sees how the circle is doing as a whole only when enough people stand behind the number
  -- for nobody's belonging answer to be guessed from it. A coach or pastor always can.
  see_rate := found and (office or coalesce(c.coach_id = uid, false) or k.kc_members >= mincell);

  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', m.person_id,
           'name', public.person_display_name(m.person_id),
           'attended', coalesce(km.km_attended, 0),
           'steps_set', coalesce(km.km_set, 0),
           'steps_done', coalesce(km.km_done, 0),
           -- Pace on meetings alone: belonging answers stay private
           'pace', case when gone >= (tg ->> 'min_weeks')::int
                        then case when coalesce(km.km_attended, 0) * s.weeks >= need * gone then 'on_pace' else 'behind' end end)
           order by public.person_display_name(m.person_id)), '[]'::jsonb)
    into members_json
    from public.circle_members m
    left join public.kpi_members(c.season_id) km on km.km_person = m.person_id and km.km_circle = m.circle_id
   where m.circle_id = p_circle and m.status = 'active';

  select coalesce(jsonb_agg(w order by (w ->> 'week')::int), '[]'::jsonb) into weeks_json
    from (
      select jsonb_build_object(
               'week', g.w,
               'logged', exists (select 1 from public.circle_logs l where l.circle_id = p_circle and l.week = g.w),
               'held', exists (select 1 from public.circle_logs l where l.circle_id = p_circle and l.week = g.w and l.held),
               'present', (select count(*) from public.circle_attendance a where a.circle_id = p_circle and a.week = g.w and a.status = 'present'),
               'marked', (select count(*) from public.circle_attendance a where a.circle_id = p_circle and a.week = g.w),
               'steps_set', (select count(*) from public.week_steps ws where ws.circle_id = p_circle and ws.week = g.w),
               'steps_done', (select count(*) from public.week_steps ws where ws.circle_id = p_circle and ws.week = g.w and ws.outcome = 'done'),
               'steps_checked', (select count(*) from public.week_steps ws where ws.circle_id = p_circle and ws.week = g.w and ws.outcome is not null)) as w
        from generate_series(1, case when cw = 0 then 0 else least(cw, s.weeks) end) as g(w)) q;

  return jsonb_build_object(
    'state', state,
    'targets', tg,
    'circle', jsonb_build_object('id', c.id, 'name', c.name, 'capacity', c.capacity),
    'season', jsonb_build_object('name', s.name, 'weeks', s.weeks, 'current_week', case when cw between 1 and s.weeks then cw end,
                                 'weeks_over', gone, 'meetings_needed', need),
    'members', coalesce(k.kc_members, 0),
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
$$;

-- ---------------------------------------------------------------------------
-- A member's view of their own season
-- ---------------------------------------------------------------------------

create function public.my_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  today date := public.today_lagos();
  tg jsonb := public.kpi_targets();
  cw integer;
  gone integer;
  need integer;
  state text;
  k record;
  held integer;
  standing text;
  pulses_json jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid) limit 1;
  if not found then
    return jsonb_build_object('placed', false);
  end if;
  select * into s from public.seasons where id = pm.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  gone := case when cw = 0 then 0 when cw > s.weeks then s.weeks else cw - 1 end;
  need := ceil(round(s.weeks * (tg ->> 'attend_share')::numeric, 4))::int;
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  select * into k from public.kpi_members(pm.season_id) where km_person = uid and km_circle = pm.circle_id;
  select count(*) into held from public.circle_logs l where l.circle_id = pm.circle_id and l.held and l.week <= gone;

  -- Where they stand, in words the app can show: never a score out of context
  standing := case
    when state = 'before' then 'before'
    when not coalesce(k.km_measured, false) then 'too_early'
    when state = 'complete' then case when k.km_thriving then 'thriving' else 'not_yet' end
    else case when k.km_thriving then 'on_pace' else 'catching_up' end
  end;

  select coalesce(jsonb_agg(jsonb_build_object('week', p.week, 'belonging', p.belonging, 'god', p.god, 'others', p.others, 'life', p.life,
                                               'total', (p.god + p.others + p.life)) order by p.week), '[]'::jsonb)
    into pulses_json
    from public.pulses p where p.person_id = uid and p.circle_id = pm.circle_id;

  return jsonb_build_object(
    'placed', true,
    'state', state,
    'status', standing,
    'targets', tg,
    'season', jsonb_build_object('weeks', s.weeks, 'current_week', case when cw between 1 and s.weeks then cw end,
                                 'weeks_over', gone, 'meetings_needed', need),
    'attended', coalesce(k.km_attended, 0),
    'held', held,
    'steps', jsonb_build_object(
      'set', coalesce(k.km_set, 0), 'done', coalesce(k.km_done, 0),
      'partly', (select count(*) from public.week_steps w where w.person_id = uid and w.circle_id = pm.circle_id and w.outcome = 'partly'),
      'not_yet', (select count(*) from public.week_steps w where w.person_id = uid and w.circle_id = pm.circle_id and w.outcome = 'not_yet')),
    'pulses', pulses_json,
    'gain', k.km_gain);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.kpi_targets(),
  public.kpi_members(uuid),
  public.kpi_circles(uuid),
  public.dashboard_season(uuid),
  public.dashboard(uuid),
  public.circle_progress(uuid),
  public.my_progress()
  from public, anon, authenticated;

grant execute on function
  public.dashboard(uuid),
  public.circle_progress(uuid),
  public.my_progress()
  to authenticated;

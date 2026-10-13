-- United Tribes, Stage 6b: learning and scaling (blueprint R6).
--
--   1. The matching model learns        retrain_preview(), retrain_model(), activate_model(), list_models()
--   2. Circle swaps                     request_swap(), swap_queue(), offer_swap(), answer_swap() and the rest
--   3. The multiplication planner       multiplication_board(), plan_multiplication()
--   4. The teen track                   guardian consent (request, answer by link, withdraw), the two-adult rule
--
-- Same rules as the rest: every table has row level security and no grants; people reach data only through the
-- functions below, which check who is asking.

-- ===========================================================================
-- 1. The matching model learns
-- ===========================================================================
--
-- After a season the system checks which parts of the Degree of Compatibility really went with a member
-- thriving, and proposes new weights. A proposal never changes anything: an admin or director makes it a new
-- version (kept beside the old ones, so every earlier recommendation stays explainable) and later switches
-- it on. Season 2 launches on the version they choose.

alter table public.match_models
  add column parent_version text references public.match_models (version),
  add column trained jsonb,
  add column created_by uuid references public.people (id) on delete set null,
  add column activated_at timestamptz,
  add column activated_by uuid references public.people (id) on delete set null;
update public.match_models set activated_at = created_at where active;

-- Every placement in a finished season that has a result, with what the engine saw when it was chosen.
-- A member who moved circle has no recommendation for the new circle and is left out; so is anyone released.
create function public.model_sample()
returns table (ms_person uuid, ms_season uuid, ms_version text, ms_thriving boolean, ms_degree smallint, ms_components jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
begin
  for s in select x.id from public.seasons x where x.ends_on < public.today_lagos() order by x.starts_on loop
    return query
    select k.km_person, s.id, cm.model_version, k.km_thriving, cm.degree, r.components
      from public.kpi_members(s.id) k
      join public.circle_members cm
        on cm.person_id = k.km_person and cm.season_id = s.id and cm.status = 'active' and cm.run_id is not null
      join public.match_recommendations r on r.run_id = cm.run_id and r.circle_id = cm.circle_id
     where k.km_thriving is not null;
  end loop;
end;
$$;

-- What the data suggests. Rules, in code rather than in a prompt:
--   - a part of the score that is the same for every candidate (the life-stage match is, by design) keeps its weight;
--   - the others move a little toward how much higher they were for members who thrived than for those who did not;
--   - no weight moves more than 5 points in one retraining, none goes below 3, and the weights add up to 100.
create function public.model_proposal(p_base text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base public.match_models%rowtype;
  v_keys text[] := array['goal', 'stage', 'tribe', 'place', 'style', 'rhythm', 'faith'];
  v_n integer;
  v_t integer;
  v_o integer;
  v_seasons integer;
  v_needed integer := (public.kpi_targets() ->> 'retrain_after')::int;
  v_enough boolean;
  v_ready boolean;
  v_stats jsonb;
  v_old numeric[] := '{}';
  v_new numeric[] := '{}';
  v_sig numeric[] := '{}';
  v_var boolean[] := '{}';
  v_free numeric := 0;
  v_sigsum numeric := 0;
  v_sd numeric;
  v_lift numeric;
  v_target numeric;
  v_raw numeric;
  v_varsum numeric := 0;
  v_scale numeric;
  v_diff numeric;
  v_big integer;
  v_prop jsonb := '{}'::jsonb;
  v_comp jsonb := '[]'::jsonb;
  v_now numeric;
  v_next numeric;
  i integer;
begin
  if p_base is null then
    select * into v_base from public.match_models where active;
  else
    select * into v_base from public.match_models where version = p_base;
  end if;
  if not found then
    raise exception 'We could not find that model' using errcode = 'P0002';
  end if;

  select count(*)::int, count(*) filter (where ms_thriving)::int, count(distinct ms_season)::int
    into v_n, v_t, v_seasons from public.model_sample();
  v_o := v_n - v_t;
  v_enough := v_t >= 5 and v_o >= 5;
  v_ready := v_n >= v_needed and v_t >= 20 and v_o >= 20;

  select coalesce(jsonb_object_agg(x.k, jsonb_build_object('thriving', x.a_t, 'other', x.a_f, 'spread', x.sd)), '{}'::jsonb)
    into v_stats
    from (select e.key as k,
                 avg(e.value::numeric) filter (where s.ms_thriving) as a_t,
                 avg(e.value::numeric) filter (where not s.ms_thriving) as a_f,
                 stddev_pop(e.value::numeric) as sd
            from public.model_sample() s, jsonb_each_text(s.ms_components) e
           group by e.key) x;

  -- first pass: which parts vary, and how much weight is free to move
  for i in 1 .. 7 loop
    v_old[i] := (v_base.weights ->> v_keys[i])::numeric;
    v_sd := coalesce((v_stats -> v_keys[i] ->> 'spread')::numeric, 0);
    v_lift := coalesce((v_stats -> v_keys[i] ->> 'thriving')::numeric - (v_stats -> v_keys[i] ->> 'other')::numeric, 0);
    v_var[i] := v_enough and v_sd >= 0.02;
    v_sig[i] := case when v_var[i] then greatest(v_lift, 0) else 0 end;
    if v_var[i] then
      v_free := v_free + v_old[i];
      v_sigsum := v_sigsum + v_sig[i];
    end if;
  end loop;

  -- second pass: a cautious step toward the signal
  for i in 1 .. 7 loop
    if v_var[i] and v_sigsum > 0 then
      v_target := v_free * v_sig[i] / v_sigsum;
      v_raw := 0.7 * v_old[i] + 0.3 * v_target;
      v_new[i] := greatest(3, least(v_old[i] + 5, greatest(v_old[i] - 5, v_raw)));
      v_varsum := v_varsum + v_new[i];
    else
      v_new[i] := v_old[i];
    end if;
  end loop;
  if v_varsum > 0 then
    v_scale := v_free / v_varsum;
    for i in 1 .. 7 loop
      if v_var[i] and v_sigsum > 0 then
        v_new[i] := v_new[i] * v_scale;
      end if;
    end loop;
  end if;
  for i in 1 .. 7 loop
    v_new[i] := round(v_new[i]);
  end loop;
  -- the rounding left a point or two over or short: give it to the largest weight that is free to move
  v_diff := 100 - (v_new[1] + v_new[2] + v_new[3] + v_new[4] + v_new[5] + v_new[6] + v_new[7]);
  if v_diff <> 0 then
    v_big := null;
    for i in 1 .. 7 loop
      if v_var[i] and v_sigsum > 0 and (v_big is null or v_new[i] > v_new[v_big]) then
        v_big := i;
      end if;
    end loop;
    if v_big is null then
      for i in 1 .. 7 loop
        if v_big is null or v_new[i] > v_new[v_big] then
          v_big := i;
        end if;
      end loop;
    end if;
    v_new[v_big] := v_new[v_big] + v_diff;
  end if;

  for i in 1 .. 7 loop
    v_prop := v_prop || jsonb_build_object(v_keys[i], v_new[i]);
    v_comp := v_comp || jsonb_build_array(jsonb_build_object(
      'key', v_keys[i],
      'weight', v_old[i],
      'thriving_avg', case when v_enough then round((v_stats -> v_keys[i] ->> 'thriving')::numeric, 3) end,
      'other_avg', case when v_enough then round((v_stats -> v_keys[i] ->> 'other')::numeric, 3) end,
      'lift', case when v_enough then round((v_stats -> v_keys[i] ->> 'thriving')::numeric - (v_stats -> v_keys[i] ->> 'other')::numeric, 3) end,
      'varies', v_var[i] or (v_enough and coalesce((v_stats -> v_keys[i] ->> 'spread')::numeric, 0) >= 0.02),
      'proposed', v_new[i]));
  end loop;

  -- does the proposal order members better than the weights in use? (on the same sample: a sanity check, not proof)
  if v_enough then
    select round(corr(x.s_old, x.thr)::numeric, 3), round(corr(x.s_new, x.thr)::numeric, 3)
      into v_now, v_next
      from (select case when s.ms_thriving then 1 else 0 end as thr,
                   (select sum((v_base.weights ->> e.key)::numeric * e.value::numeric) from jsonb_each_text(s.ms_components) e) as s_old,
                   (select sum((v_prop ->> e.key)::numeric * e.value::numeric) from jsonb_each_text(s.ms_components) e) as s_new
              from public.model_sample() s) x;
  end if;

  return jsonb_build_object(
    'base', v_base.version,
    'base_weights', v_base.weights,
    'sample', jsonb_build_object('n', v_n, 'thriving', v_t, 'other', v_o, 'seasons', v_seasons),
    'needed', v_needed,
    'enough', v_enough,
    'ready', v_ready,
    'components', v_comp,
    'proposed', v_prop,
    'changed', v_prop is distinct from v_base.weights,
    'backtest', jsonb_build_object('now', v_now, 'proposed', v_next));
end;
$$;

create function public.retrain_preview()
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
  if not public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]) then
    raise exception 'Only the admin, directors and the data lead can see what the matching would learn' using errcode = '42501';
  end if;
  return public.model_proposal(null);
end;
$$;

create function public.list_models()
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
    raise exception 'Only the office can see the matching models' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'version', m.version, 'active', m.active, 'weights', m.weights, 'min_degree', m.min_degree,
             'parent', m.parent_version, 'notes', m.notes, 'created_at', m.created_at, 'activated_at', m.activated_at,
             'created_by', public.person_display_name(m.created_by),
             'trained', m.trained,
             'placements', (select count(*) from public.circle_members cm where cm.model_version = m.version),
             'results', (select jsonb_build_object('n', count(*), 'thriving', count(*) filter (where s.ms_thriving))
                           from public.model_sample() s where s.ms_version = m.version),
             'used', exists (select 1 from public.match_runs r where r.model_version = m.version))
           order by m.created_at desc, m.version desc)
      from public.match_models m), '[]'::jsonb);
end;
$$;

-- Makes the proposal a new, inactive version. The earlier versions are never changed.
create function public.retrain_model(p_notes text default null, p_allow_small boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_prop jsonb;
  v_base public.match_models%rowtype;
  v_next integer;
  v_version text;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can make a new matching model' using errcode = '42501';
  end if;
  if v_notes is not null and char_length(v_notes) > 400 then
    raise exception 'Keep the note to 400 characters or fewer' using errcode = '22023';
  end if;
  v_prop := public.model_proposal(null);
  if not (v_prop ->> 'enough')::boolean then
    raise exception 'There are not enough finished placements with a result to learn from yet' using errcode = '22023';
  end if;
  if not (v_prop ->> 'ready')::boolean and p_allow_small is distinct from true then
    raise exception 'Only % placements have a result so far, and the weights are retrained after %. Retrain early only if you accept a rougher guess.',
      v_prop -> 'sample' ->> 'n', v_prop ->> 'needed' using errcode = '22023';
  end if;
  if not (v_prop ->> 'changed')::boolean then
    raise exception 'The results do not suggest any change to the weights yet' using errcode = '22023';
  end if;

  select * into v_base from public.match_models where version = v_prop ->> 'base';
  select coalesce(max(substring(m.version from '^v([0-9]+)$')::int), 1) + 1 into v_next from public.match_models m;
  v_version := 'v' || v_next;
  insert into public.match_models (version, weights, min_degree, active, notes, parent_version, trained, created_by)
  values (v_version, v_prop -> 'proposed', v_base.min_degree, false,
          coalesce(v_notes, 'Learned from ' || (v_prop -> 'sample' ->> 'n') || ' placements.'),
          v_base.version,
          jsonb_build_object('sample', v_prop -> 'sample', 'components', v_prop -> 'components',
                             'backtest', v_prop -> 'backtest', 'small', not (v_prop ->> 'ready')::boolean),
          uid);
  perform public.write_event(uid, 'model.created', 'model', v_version,
    jsonb_build_object('from', v_base.version, 'n', v_prop -> 'sample' ->> 'n', 'small', not (v_prop ->> 'ready')::boolean));
  return public.list_models();
end;
$$;

create function public.activate_model(p_version text, p_confirm_small boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.match_models%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can switch the matching model' using errcode = '42501';
  end if;
  select * into m from public.match_models where version = p_version for update;
  if not found then
    raise exception 'We could not find that model' using errcode = 'P0002';
  end if;
  if m.active then
    raise exception 'That model is already in use' using errcode = '22023';
  end if;
  if coalesce((m.trained ->> 'small')::boolean, false) and p_confirm_small is distinct from true then
    raise exception 'This model was learned from a small sample. Confirm to switch it on anyway.' using errcode = '22023';
  end if;
  update public.match_models set active = false where active;
  update public.match_models set active = true, activated_at = now(), activated_by = uid where version = p_version;
  perform public.write_event(uid, 'model.activated', 'model', p_version, '{}'::jsonb);
  return public.list_models();
end;
$$;

-- A version nobody has used can be thrown away.
create function public.discard_model(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.match_models%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can remove a matching model' using errcode = '42501';
  end if;
  select * into m from public.match_models where version = p_version for update;
  if not found then
    raise exception 'We could not find that model' using errcode = 'P0002';
  end if;
  if m.active then
    raise exception 'The model in use cannot be removed' using errcode = '22023';
  end if;
  if exists (select 1 from public.match_runs r where r.model_version = p_version)
     or exists (select 1 from public.circle_members cm where cm.model_version = p_version) then
    raise exception 'This model has been used to match members, so it is kept for the record' using errcode = '22023';
  end if;
  delete from public.match_models where version = p_version;
  perform public.write_event(uid, 'model.discarded', 'model', p_version, '{}'::jsonb);
  return public.list_models();
end;
$$;

-- ===========================================================================
-- 2. Circle swaps
-- ===========================================================================
--
-- A member who is not at home in their circle can ask to move in the first weeks of a season (swap_weeks,
-- 4 by default). The reason goes to the coach and the Care Lead, never to the circle's leader. A coach picks
-- from the circles that still fit the member's hard rules (the same ones matching uses), the member agrees to
-- the new circle's Success Picture and Covenant, and only then is the move made. Everything the member has
-- done this season follows them: meetings, pulses and steps count across both circles.

-- A member's season is one record, even if it was spent in two circles.
create or replace function public.kpi_members(p_season uuid)
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
      select count(distinct a.week) filter (where a.week <= gone) as n,
             count(distinct a.week) filter (where a.week <= gone and a.week > gone - 3) as recent
        from public.circle_attendance a
        join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
       where a.person_id = m.person_id and a.status = 'present'
         and a.circle_id in (select c2.id from public.circles c2 where c2.season_id = p_season)) att on true
    left join lateral (
      select p.belonging, (p.god + p.others + p.life)::int as total, p.week
        from public.pulses p
       where p.person_id = m.person_id and p.circle_id in (select c2.id from public.circles c2 where c2.season_id = p_season)
       order by p.week desc, p.created_at desc limit 1) pl on true
    left join lateral (
      select (p.god + p.others + p.life)::int as total
        from public.pulses p
       where p.person_id = m.person_id and p.circle_id in (select c2.id from public.circles c2 where c2.season_id = p_season) and p.week = 1
       order by p.created_at limit 1) pb on true
    left join lateral (
      select count(distinct w.week) as set_n,
             count(distinct w.week) filter (where w.outcome = 'done') as done_n,
             count(distinct w.week) filter (where w.outcome is not null) as checked_n
        from public.week_steps w
       where w.person_id = m.person_id and w.circle_id in (select c2.id from public.circles c2 where c2.season_id = p_season)) st on true
   where m.status = 'active' and m.season_id = p_season;
end;
$$;


create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  from_circle uuid not null references public.circles (id),
  status text not null default 'requested'
    check (status in ('requested', 'offered', 'moved', 'declined', 'withdrawn', 'member_declined')),
  reason text not null check (reason in ('time', 'place', 'fit', 'conflict', 'other')),
  note text check (char_length(note) <= 300),
  -- the member, or the coach who asked on their behalf
  asked_by uuid references public.people (id) on delete set null,
  wants_circle uuid references public.circles (id) on delete set null,
  offered_circle uuid references public.circles (id) on delete set null,
  offered_degree smallint check (offered_degree between 0 and 100),
  offered_by uuid references public.people (id) on delete set null,
  offered_at timestamptz,
  decided_by uuid references public.people (id) on delete set null,
  decision_note text check (char_length(decision_note) <= 300),
  decided_at timestamptz,
  moved_to uuid references public.circles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index swap_requests_one_open on public.swap_requests (person_id) where status in ('requested', 'offered');
create index swap_requests_circle_idx on public.swap_requests (from_circle, status);
alter table public.swap_requests enable row level security;
-- No grants: only the functions touch this table.

create trigger swap_requests_touch before update on public.swap_requests
  for each row execute function public.touch_updated_at();

-- May the signed-in person act on swaps out of this circle? The coach of the circle, the Care Lead, directors and the admin.
create function public.swap_staff(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circles c
    join public.seasons s on s.id = c.season_id
     where c.id = p_circle
       and s.centre_id = public.my_centre()
       and (public.has_any_role(array['admin', 'director', 'care_lead']::public.app_role[])
            or (c.coach_id = auth.uid() and public.has_any_role(array['coach']::public.app_role[]))));
$$;

-- What a member sees: whether they can ask, and where a request stands.
create function public.my_swap()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  place public.circle_members%rowtype;
  s public.seasons%rowtype;
  r public.swap_requests%rowtype;
  v_weeks integer := (public.kpi_targets() ->> 'swap_weeks')::int;
  cw integer;
  v_open boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select m.* into place from public.circle_members m where m.person_id = uid and m.status = 'active' order by m.joined_at desc limit 1;
  if not found then
    return jsonb_build_object('in_circle', false);
  end if;
  select * into s from public.seasons where id = place.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  v_open := cw between 1 and least(v_weeks, s.weeks);

  select * into r from public.swap_requests q
   where q.person_id = uid and (q.status in ('requested', 'offered') or q.updated_at > now() - interval '14 days')
   order by (q.status in ('requested', 'offered')) desc, q.updated_at desc limit 1;

  return jsonb_build_object(
    'in_circle', true,
    'circle', jsonb_build_object('id', place.circle_id, 'name', (select c.name from public.circles c where c.id = place.circle_id)),
    'season_started', cw >= 1,
    'week', case when cw between 1 and s.weeks then cw end,
    'window', jsonb_build_object('open', v_open, 'weeks', v_weeks),
    'request', case when r.id is null then null else jsonb_build_object(
        'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'created_at', r.created_at,
        'by_coach', r.asked_by is distinct from r.person_id,
        'decision_note', r.decision_note,
        'offered', case when r.status = 'offered' then public.match_card(r.offered_circle) end,
        'offered_degree', case when r.status = 'offered' then r.offered_degree end,
        'offered_label', case when r.status = 'offered' then public.degree_label(r.offered_degree) end) end);
end;
$$;

create function public.swap_notify_staff(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.swap_requests%rowtype;
  c public.circles%rowtype;
  v_to uuid;
begin
  select * into r from public.swap_requests where id = p_request;
  select * into c from public.circles where id = r.from_circle;
  if c.coach_id is not null then
    perform public.enqueue_message(c.coach_id, 'swap_requested',
      jsonb_build_object('person_first', public.first_name_of(r.person_id), 'circle', c.name, 'by_coach', r.asked_by is distinct from r.person_id),
      c.id, 'swap:' || r.id || ':requested:' || c.coach_id);
  else
    for v_to in select * from public.care_team() loop
      perform public.enqueue_message(v_to, 'swap_requested',
        jsonb_build_object('person_first', public.first_name_of(r.person_id), 'circle', c.name, 'by_coach', false),
        c.id, 'swap:' || r.id || ':requested:' || v_to);
    end loop;
  end if;
end;
$$;

create function public.request_swap(p_reason text, p_note text default null, p_wants uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  place public.circle_members%rowtype;
  s public.seasons%rowtype;
  v_weeks integer := (public.kpi_targets() ->> 'swap_weeks')::int;
  cw integer;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select m.* into place from public.circle_members m where m.person_id = uid and m.status = 'active' for update;
  if not found then
    raise exception 'You are not in a circle' using errcode = '22023';
  end if;
  select * into s from public.seasons where id = place.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  if cw = 0 then
    raise exception 'The season has not started. Until it does, you can give up your seat and choose another circle.' using errcode = '22023';
  end if;
  if cw > least(v_weeks, s.weeks) then
    raise exception 'The first % weeks are for changing circle. After that, talk to your coach.', v_weeks using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('time', 'place', 'fit', 'conflict', 'other') then
    raise exception 'Choose what the main reason is' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.swap_requests q where q.person_id = uid and q.status in ('requested', 'offered')) then
    raise exception 'You have already asked to change circle' using errcode = '22023';
  end if;
  if p_wants is not null and not exists (
       select 1 from public.circles c where c.id = p_wants and c.season_id = place.season_id and c.id <> place.circle_id and c.status = 'approved') then
    raise exception 'That circle is not open to move to' using errcode = '22023';
  end if;

  insert into public.swap_requests (person_id, season_id, from_circle, reason, note, asked_by, wants_circle)
  values (uid, place.season_id, place.circle_id, p_reason, v_note, uid, p_wants)
  returning id into v_id;
  perform public.swap_notify_staff(v_id);
  perform public.write_event(uid, 'swap.requested', 'swap', v_id::text, jsonb_build_object('reason', p_reason));
  return public.my_swap();
end;
$$;

-- A coach (or the Care Lead) asks for a move on a member's behalf: after the first weeks, or when the member cannot.
create function public.start_swap_for(p_person uuid, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  place public.circle_members%rowtype;
  s public.seasons%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select m.* into place from public.circle_members m where m.person_id = p_person and m.status = 'active' for update;
  if not found or not public.swap_staff(place.circle_id) then
    raise exception 'We could not find that member in one of your circles' using errcode = 'P0002';
  end if;
  select * into s from public.seasons where id = place.season_id;
  if public.season_week(s.starts_on, s.weeks, public.today_lagos()) not between 1 and s.weeks then
    raise exception 'A circle can be changed while the season is running' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('time', 'place', 'fit', 'conflict', 'other') then
    raise exception 'Choose what the main reason is' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.swap_requests q where q.person_id = p_person and q.status in ('requested', 'offered')) then
    raise exception 'There is already a request for this member' using errcode = '22023';
  end if;
  insert into public.swap_requests (person_id, season_id, from_circle, reason, note, asked_by)
  values (p_person, place.season_id, place.circle_id, p_reason, v_note, uid)
  returning id into v_id;
  perform public.write_event(uid, 'swap.started', 'swap', v_id::text, jsonb_build_object('reason', p_reason));
  return public.swap_queue();
end;
$$;

create function public.cancel_swap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.swap_requests set status = 'withdrawn', decided_at = now()
   where person_id = uid and status in ('requested', 'offered');
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'You have no request to withdraw' using errcode = '22023';
  end if;
  perform public.write_event(uid, 'swap.withdrawn', 'person', uid::text, '{}'::jsonb);
  return public.my_swap();
end;
$$;

-- The circles a member could move to: the same hard rules as matching, never the one they are in.
create function public.swap_options(p_person uuid, p_from uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'circle_id', o.r_circle, 'name', c.name, 'degree', o.r_degree, 'seats', o.r_seats,
           'leader_first_name', public.first_name_of(c.leader_id), 'meeting_day', c.meeting_day,
           'meeting_time', to_char(c.meeting_time, 'HH24:MI'), 'mode', c.meeting_mode, 'zone', c.zone,
           'tribe', t.name) order by o.r_degree desc, o.r_seats desc, c.name), '[]'::jsonb)
  from (select * from public.match_candidates(p_person) m where m.r_circle <> p_from order by m.r_degree desc limit 6) o
  join public.circles c on c.id = o.r_circle
  left join public.tribes t on t.id = c.tribe_id;
$$;

-- The coach's and the Care Lead's list: open requests, and what was decided in the last two weeks.
create function public.swap_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'care_lead', 'coach']::public.app_role[]) then
    raise exception 'Only coaches, the Care Lead and directors can see circle change requests' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'weeks', (public.kpi_targets() ->> 'swap_weeks')::int,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'status', q.status, 'reason', q.reason, 'note', q.note,
               'person', jsonb_build_object('id', q.person_id, 'name', public.person_display_name(q.person_id), 'first_name', public.first_name_of(q.person_id)),
               'from', jsonb_build_object('id', c.id, 'name', c.name, 'leader', public.person_display_name(c.leader_id), 'tribe', t.name),
               'by_coach', q.asked_by is distinct from q.person_id,
               'wants', case when q.wants_circle is null then null else jsonb_build_object('id', q.wants_circle, 'name', (select w.name from public.circles w where w.id = q.wants_circle)) end,
               'offered', case when q.offered_circle is null then null else jsonb_build_object('id', q.offered_circle, 'name', (select w.name from public.circles w where w.id = q.offered_circle), 'degree', q.offered_degree) end,
               'moved_to', case when q.moved_to is null then null else (select w.name from public.circles w where w.id = q.moved_to) end,
               'decision_note', q.decision_note,
               'created_at', q.created_at, 'decided_at', q.decided_at,
               'options', case when q.status in ('requested', 'offered') then public.swap_options(q.person_id, q.from_circle) else '[]'::jsonb end)
             order by (q.status in ('requested', 'offered')) desc, q.created_at desc)
        from public.swap_requests q
        join public.circles c on c.id = q.from_circle
        left join public.tribes t on t.id = c.tribe_id
       where public.swap_staff(q.from_circle)
         and (q.status in ('requested', 'offered') or q.updated_at > now() - interval '14 days')), '[]'::jsonb));
end;
$$;

-- Who a coach (or the Care Lead) can start a change for: members of circles they look after, in a season that is
-- running, with no request open. A coach sees their own members; the office looks someone up by name.
create function public.swap_members(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(left(btrim(coalesce(p_search, '')), 60));
  v_all boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'care_lead', 'coach']::public.app_role[]) then
    raise exception 'Only coaches, the Care Lead and directors can start a circle change' using errcode = '42501';
  end if;
  v_all := public.has_any_role(array['admin', 'director', 'care_lead']::public.app_role[]);
  if v_all and char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.name, x.circle)
      from (
        select public.person_display_name(m.person_id) as name, c.name as circle,
               jsonb_build_object('person_id', m.person_id, 'name', public.person_display_name(m.person_id), 'circle', c.name) as j
          from public.circle_members m
          join public.circles c on c.id = m.circle_id
          join public.seasons s on s.id = c.season_id
          join public.people p on p.id = m.person_id
         where m.status = 'active'
           and public.swap_staff(c.id)
           and public.season_week(s.starts_on, s.weeks, public.today_lagos()) between 1 and s.weeks
           and not exists (select 1 from public.swap_requests q where q.person_id = m.person_id and q.status in ('requested', 'offered'))
           and (v_q = '' or position(v_q in lower(coalesce(p.full_name, ''))) > 0 or position(v_q in lower(coalesce(p.preferred_name, ''))) > 0)
         order by 1, 2
         limit 40) x), '[]'::jsonb);
end;
$$;

create function public.offer_swap(p_request uuid, p_circle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.swap_requests%rowtype;
  cand record;
  c public.circles%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.swap_requests where id = p_request for update;
  if not found or not public.swap_staff(r.from_circle) then
    raise exception 'We could not find that request' using errcode = 'P0002';
  end if;
  if r.status not in ('requested', 'offered') then
    raise exception 'That request has already been closed' using errcode = '22023';
  end if;
  select * into cand from public.match_candidates(r.person_id) m where m.r_circle = p_circle and m.r_circle <> r.from_circle;
  if not found then
    raise exception 'That circle does not fit this member (it may be full, or not suit their time, format or age group)' using errcode = '22023';
  end if;
  select * into c from public.circles where id = p_circle;
  update public.swap_requests
     set status = 'offered', offered_circle = p_circle, offered_degree = cand.r_degree, offered_by = uid, offered_at = now()
   where id = p_request;
  perform public.enqueue_message(r.person_id, 'swap_offered',
    jsonb_build_object('circle', c.name, 'by_first', public.first_name_of(uid)),
    null, 'swap:' || r.id || ':offered:' || p_circle);
  perform public.write_event(uid, 'swap.offered', 'swap', p_request::text, jsonb_build_object('circle', p_circle));
  return public.swap_queue();
end;
$$;

create function public.decline_swap(p_request uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.swap_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.swap_requests where id = p_request for update;
  if not found or not public.swap_staff(r.from_circle) then
    raise exception 'We could not find that request' using errcode = 'P0002';
  end if;
  if r.status not in ('requested', 'offered') then
    raise exception 'That request has already been closed' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  update public.swap_requests set status = 'declined', decided_by = uid, decided_at = now(), decision_note = v_note where id = p_request;
  perform public.enqueue_message(r.person_id, 'swap_declined',
    jsonb_build_object('by_first', public.first_name_of(uid)), null, 'swap:' || r.id || ':declined');
  perform public.write_event(uid, 'swap.declined', 'swap', p_request::text, '{}'::jsonb);
  return public.swap_queue();
end;
$$;

-- The member's answer to an offer. Yes makes the move; the new circle's Success Picture and Covenant are agreed here.
create function public.answer_swap(p_accept boolean, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.swap_requests%rowtype;
  circ public.circles%rowtype;
  old_circ public.circles%rowtype;
  season public.seasons%rowtype;
  model public.match_models%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.swap_requests where person_id = uid and status = 'offered' for update;
  if not found then
    raise exception 'There is no offer waiting for you' using errcode = '22023';
  end if;

  if p_accept is distinct from true then
    update public.swap_requests set status = 'member_declined', decided_at = now() where id = r.id;
    perform public.write_event(uid, 'swap.member_declined', 'swap', r.id::text, '{}'::jsonb);
    return public.my_swap();
  end if;

  if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into circ from public.circles where id = r.offered_circle for update;
  if circ.status <> 'approved' or not exists (select 1 from public.leader_certifications where person_id = circ.leader_id) then
    raise exception 'That circle is no longer open. Ask your coach for another.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.match_candidates(uid) m where m.r_circle = circ.id) then
    raise exception 'That circle has just filled or changed. Ask your coach for another.' using errcode = '22023';
  end if;
  select * into old_circ from public.circles where id = r.from_circle;
  select * into season from public.seasons where id = circ.season_id;
  select * into model from public.match_models where active;

  -- Leave first: a person has one active seat in a season
  update public.circle_members set status = 'released', released_at = now(), release_reason = 'moved to another circle'
   where person_id = uid and season_id = circ.season_id and status = 'active';
  insert into public.circle_members (circle_id, person_id, season_id, chosen_rank, degree, model_version, run_id,
                                     agreement_version, covenant, first_meeting_by)
  values (circ.id, uid, circ.season_id, null, r.offered_degree, model.version, null,
          p_version, jsonb_build_object('name', circ.name, 'god', circ.loving_god, 'others', circ.loving_others, 'life', circ.loving_life),
          greatest(current_date, season.starts_on) + 7);
  update public.swap_requests set status = 'moved', moved_to = circ.id, decided_at = now() where id = r.id;

  perform public.enqueue_message(old_circ.leader_id, 'swap_moved',
    jsonb_build_object('person_first', public.first_name_of(uid), 'direction', 'out'),
    old_circ.id, 'swap:' || r.id || ':moved:out');
  perform public.enqueue_message(circ.leader_id, 'swap_moved',
    jsonb_build_object('person_first', public.first_name_of(uid), 'direction', 'in'),
    circ.id, 'swap:' || r.id || ':moved:in');
  perform public.write_event(uid, 'swap.moved', 'swap', r.id::text,
    jsonb_build_object('from', old_circ.id, 'to', circ.id, 'degree', r.offered_degree));
  return public.my_swap();
end;
$$;

-- ===========================================================================
-- 3. The multiplication planner
-- ===========================================================================
--
-- "Multiply" is a number on the dashboard: circles whose assistant is certified ready to lead. This is the place
-- where that becomes a decision. For each circle of a season the office records what happens next, and sees
-- beside it where new circles are most needed (members the matching could not place well).
-- Nothing here changes a role or sends a message: a certified assistant is invited to apply to lead by a person.

create table public.multiplication_plans (
  circle_id uuid primary key references public.circles (id) on delete cascade,
  plan text not null check (plan in ('assistant_leads', 'leader_continues', 'leader_rests', 'closes')),
  tribe_id uuid references public.tribes (id),
  note text check (char_length(note) <= 300),
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz not null default now(),
  -- a new circle needs a home in a tribe
  check (plan <> 'assistant_leads' or tribe_id is not null)
);
alter table public.multiplication_plans enable row level security;
-- No grants: only the functions touch this table.

create function public.multiplication_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['admin', 'director', 'pastor', 'coach']::public.app_role[]);
$$;

-- p_season null = the season in progress (or the next one).
create function public.multiplication_board(p_season uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_season uuid;
  s public.seasons%rowtype;
  v_all boolean;
  v_circles jsonb;
  v_total integer;
  v_with integer;
  v_ready integer;
  v_new integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.multiplication_staff() then
    raise exception 'Only a coach or the office can plan for the next season' using errcode = '42501';
  end if;
  v_season := public.dashboard_season(p_season);
  select * into s from public.seasons where id = v_season;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  -- The office sees every circle; a coach sees the circles they coach.
  v_all := public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]);

  select coalesce(jsonb_agg(x.j order by x.name), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where x.has_assistant)::int,
         count(*) filter (where x.ready)::int,
         count(*) filter (where x.plan = 'assistant_leads')::int
    into v_circles, v_total, v_with, v_ready, v_new
    from (
      select c.name,
             c.assistant_id is not null as has_assistant,
             exists (select 1 from public.leader_certifications lc where lc.person_id = c.assistant_id and lc.as_role = 'assistant_leader') as ready,
             mp.plan,
             jsonb_build_object(
               'id', c.id,
               'name', c.name,
               'leader', public.person_display_name(c.leader_id),
               'assistant', case when c.assistant_id is not null then public.person_display_name(c.assistant_id) end,
               'assistant_state', case
                  when c.assistant_id is null then 'none'
                  when exists (select 1 from public.leader_certifications lc where lc.person_id = c.assistant_id and lc.as_role = 'assistant_leader') then 'certified'
                  else 'in_training' end,
               'tribe', (select t.name from public.tribes t where t.id = c.tribe_id),
               'members', (select count(*) from public.circle_members m where m.circle_id = c.id and m.status = 'active'),
               'plan', mp.plan,
               'plan_tribe_id', mp.tribe_id,
               'plan_tribe', (select t.name from public.tribes t where t.id = mp.tribe_id),
               'note', mp.note,
               'decided_by', case when mp.decided_by is not null then public.first_name_of(mp.decided_by) end,
               'decided_at', mp.decided_at) as j
        from public.circles c
        left join public.multiplication_plans mp on mp.circle_id = c.id
       where c.season_id = v_season
         and c.status in ('approved', 'closed')
         and (v_all or c.coach_id = uid)) x;

  return jsonb_build_object(
    'state', 'ok',
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'ends_on', s.ends_on),
    'summary', jsonb_build_object('circles', v_total, 'with_assistant', v_with, 'certified', v_ready, 'new_planned', v_new),
    'circles', v_circles,
    'tribes', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort, t.name)
                          from public.tribes t where t.active), '[]'::jsonb),
    -- where members could not be placed well: the best places for a new circle
    'gaps', case when v_all then coalesce((
      select jsonb_agg(g order by (g ->> 'members')::int desc)
        from (
          select jsonb_build_object('tribe', tr.name, 'track', t.name, 'kind', d.circle_kind, 'members', count(*)) as g
            from public.match_demand d
            left join public.tracks t on t.id = d.track_id
            left join public.tribes tr on tr.id = d.tribe_id
           where d.season_id = v_season
           group by tr.name, t.name, d.circle_kind
           order by count(*) desc
           limit 8) q), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;

create function public.plan_multiplication(p_circle uuid, p_plan text, p_tribe uuid default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  s public.seasons%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.multiplication_staff() then
    raise exception 'Only a coach or the office can plan for the next season' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  select * into s from public.seasons where id = c.season_id;
  if not found or s.centre_id <> public.my_centre()
     or not (public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) or c.coach_id = uid) then
    raise exception 'We could not find that circle' using errcode = 'P0002';
  end if;
  if p_plan is null or p_plan not in ('assistant_leads', 'leader_continues', 'leader_rests', 'closes') then
    raise exception 'Choose what happens to this circle next' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  if p_plan = 'assistant_leads' then
    if c.assistant_id is null then
      raise exception 'This circle has no assistant' using errcode = '22023';
    end if;
    if not exists (select 1 from public.leader_certifications lc where lc.person_id = c.assistant_id and lc.as_role = 'assistant_leader') then
      raise exception 'The assistant has not finished their training yet' using errcode = '22023';
    end if;
    if p_tribe is null or not exists (select 1 from public.tribes t where t.id = p_tribe and t.active) then
      raise exception 'Choose the tribe the new circle will belong to' using errcode = '22023';
    end if;
  end if;

  insert into public.multiplication_plans (circle_id, plan, tribe_id, note, decided_by, decided_at)
  values (p_circle, p_plan, case when p_plan = 'assistant_leads' then p_tribe end, v_note, uid, now())
  on conflict (circle_id) do update
     set plan = excluded.plan, tribe_id = excluded.tribe_id, note = excluded.note,
         decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform public.write_event(uid, 'multiply.planned', 'circle', p_circle::text, jsonb_build_object('plan', p_plan));
  return public.multiplication_board(c.season_id);
end;
$$;

-- Take a plan back to "not decided yet"
create function public.clear_multiplication_plan(p_circle uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.multiplication_staff() then
    raise exception 'Only a coach or the office can plan for the next season' using errcode = '42501';
  end if;
  select c0.* into c from public.circles c0 join public.seasons s on s.id = c0.season_id
   where c0.id = p_circle and s.centre_id = public.my_centre()
     and (public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) or c0.coach_id = uid);
  if not found then
    raise exception 'We could not find that circle' using errcode = 'P0002';
  end if;
  delete from public.multiplication_plans where circle_id = p_circle;
  perform public.write_event(uid, 'multiply.cleared', 'circle', p_circle::text, '{}'::jsonb);
  return public.multiplication_board(c.season_id);
end;
$$;

-- ===========================================================================
-- 4. The teen track, with a parent or guardian's permission
-- ===========================================================================
--
-- Young people aged 13 to 17 can join a circle only when:
--   - the teen track has been opened on purpose (a platform switch only the database owner can flip, after the
--     church has settled its safeguarding policy: see docs/TEENS.md);
--   - a parent or guardian has said yes, from a private link sent to THEIR phone or email (the young person never
--     sees the link);
--   - a member of staff has spoken to that parent or guardian by phone to confirm it was really them;
--   - the circle is a circle for teens, led by two adults. Teens are never placed in an adult circle, and adults are
--     never placed in a teen circle, even if they said a neighbouring life stage would be fine.
-- The parent or guardian can take their permission back at any time; the young person leaves the circle then.

insert into public.platform_flags (key, enabled, note) values
  ('teen_track', false, 'Lets 13 to 17 year olds join a circle with a parent or guardian''s permission. Read docs/TEENS.md first.');

-- Is this person under 18 by the age range they chose?
create function public.is_minor(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select ar.max_age is not null and ar.max_age < 18
                     from public.member_profiles mp join public.age_ranges ar on ar.id = mp.age_range_id
                    where mp.person_id = p_person), false);
$$;

create function public.teen_track_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.platform_flag('teen_track')
     and exists (select 1 from public.tracks t where t.slug = 'teens' and t.active);
$$;

-- The track cannot be switched on by an admin screen unless the platform switch is on.
create function public.tracks_teen_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug = 'teens' and new.active and not public.platform_flag('teen_track') then
    raise exception 'The teen track cannot be opened yet. Read docs/TEENS.md.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger tracks_teen_guard before insert or update of active on public.tracks
  for each row execute function public.tracks_teen_guard();

-- A profile for a 13 to 17 year old is only accepted while the teen track is open.
create function public.profile_teen_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.age_ranges ar where ar.id = new.age_range_id and ar.max_age is not null and ar.max_age < 18)
     and not public.teen_track_open() then
    raise exception 'Circles for teens are not open yet' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger member_profiles_teen_guard before insert or update of age_range_id on public.member_profiles
  for each row execute function public.profile_teen_guard();

-- ---------------------------------------------------------------------------
-- The permission record
-- ---------------------------------------------------------------------------

create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people (id) on delete cascade,
  guardian_name text not null check (char_length(guardian_name) between 2 and 80),
  relationship text not null check (relationship in ('mother', 'father', 'guardian', 'other')),
  guardian_email text check (guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(guardian_email) <= 160),
  guardian_phone text check (guardian_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Only the fingerprint of the private link is kept
  token_hash text not null unique,
  token_expires_at timestamptz not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'withdrawn')),
  requested_at timestamptz not null default now(),
  -- The wording version the parent or guardian was shown when they agreed
  consent_version text check (consent_version ~ '^[A-Za-z0-9._-]{1,24}$'),
  answered_at timestamptz,
  answers integer not null default 0,
  guardian_note text check (char_length(guardian_note) <= 300),
  -- A person on staff phoned the parent or guardian to confirm
  verified_at timestamptz,
  verified_by uuid references public.people (id) on delete set null,
  verified_note text check (char_length(verified_note) <= 200),
  updated_at timestamptz not null default now(),
  check (guardian_email is not null or guardian_phone is not null),
  check (status <> 'approved' or (consent_version is not null and answered_at is not null)),
  check (verified_at is null or status = 'approved')
);
alter table public.guardian_consents enable row level security;
-- No grants: only the functions touch this table.
create trigger guardian_consents_touch before update on public.guardian_consents
  for each row execute function public.touch_updated_at();

-- A sent request keeps no live link in the outbox.
create function public.messages_scrub_secret()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template = 'guardian_request' then
    if new.status in ('queued', 'sending') and old.params ? 'scrubbed' then
      raise exception 'This message cannot be tried again. The young person needs to send a new request.' using errcode = '22023';
    end if;
    if new.status not in ('queued', 'sending') then
      new.params := jsonb_build_object('scrubbed', true);
    end if;
  end if;
  return new;
end;
$$;
create trigger messages_scrub_secret before update on public.messages
  for each row execute function public.messages_scrub_secret();

create function public.guardian_ready(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.guardian_consents g
                  where g.person_id = p_person and g.status = 'approved' and g.verified_at is not null);
$$;

-- Stops a young person without a confirmed permission from looking at circles or taking a seat.
create function public.guardian_gate(p_person uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_minor(p_person) and not public.guardian_ready(p_person) then
    raise exception 'Your parent or guardian needs to say yes, and we need to speak to them, before you can see circles' using errcode = '22023';
  end if;
end;
$$;

create function public.guardian_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]);
$$;

-- Hides most of an address or number: enough to tell it is the right one.
create function public.mask_contact(p_email text, p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is not null then left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
    when p_phone is not null then left(p_phone, 4) || ' ••• ••' || right(p_phone, 2)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The young person's side
-- ---------------------------------------------------------------------------

create function public.my_guardian()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.guardian_consents%rowtype;
  v_minor boolean;
  v_state text;
  v_sent integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_minor := public.is_minor(uid);
  if not v_minor then
    return jsonb_build_object('needed', false, 'state', 'not_needed', 'track_open', public.teen_track_open());
  end if;
  select * into g from public.guardian_consents where person_id = uid;
  if not found then
    v_state := 'none';
  elsif g.status = 'requested' then
    v_state := case when g.token_expires_at < now() then 'expired' else 'requested' end;
  elsif g.status = 'approved' then
    v_state := case when g.verified_at is null then 'approved' else 'ready' end;
  else
    v_state := g.status;
  end if;
  select count(*)::int into v_sent from public.messages m
   where m.template = 'guardian_request' and m.dedupe_key like 'guardian:' || coalesce(g.id::text, '-') || ':%'
     and m.created_at > now() - interval '1 day';
  return jsonb_build_object(
    'needed', true,
    'track_open', public.teen_track_open(),
    'state', v_state,
    'guardian_name', g.guardian_name,
    'relationship', g.relationship,
    'sent_to', case when g.id is not null then public.mask_contact(g.guardian_email, g.guardian_phone) end,
    'requested_at', g.requested_at,
    'answered_at', g.answered_at,
    'can_send', v_state in ('none', 'requested', 'expired') and v_sent < 3,
    'sends_left_today', greatest(0, 3 - v_sent));
end;
$$;

create function public.request_guardian_consent(
  p_name text,
  p_relationship text,
  p_email text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  g public.guardian_consents%rowtype;
  v_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash text;
  v_sent integer;
  v_id uuid;
  my_email text;
  my_phone text;
  my_whatsapp text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.is_minor(uid) then
    raise exception 'Permission from a parent or guardian is only needed for people under 18' using errcode = '22023';
  end if;
  if not public.teen_track_open() then
    raise exception 'Circles for teens are not open yet' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Give the name of your parent or guardian' using errcode = '22023';
  end if;
  if p_relationship is null or p_relationship not in ('mother', 'father', 'guardian', 'other') then
    raise exception 'Say who they are to you' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone ~ '^0[0-9]{10}$' then
    v_phone := '+234' || substr(v_phone, 2);
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Give an email address or a phone number for your parent or guardian' using errcode = '22023';
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 160) then
    raise exception 'That email address does not look right' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'That phone number does not look right. Include the whole number.' using errcode = '22023';
  end if;
  -- Their own address or number would let the young person say yes to themselves
  select p.email into my_email from public.people p where p.id = uid;
  select cp.phone into my_phone from public.contact_preferences cp where cp.person_id = uid;
  select mp.whatsapp into my_whatsapp from public.member_profiles mp where mp.person_id = uid;
  if (v_email is not null and lower(my_email) = v_email) or (v_phone is not null and v_phone in (my_phone, my_whatsapp)) then
    raise exception 'Use your parent or guardian''s own email address or phone number, not yours' using errcode = '22023';
  end if;

  select * into g from public.guardian_consents where person_id = uid for update;
  if g.id is not null then
    if g.status = 'approved' then
      raise exception 'Your parent or guardian has already said yes' using errcode = '22023';
    elsif g.status in ('declined', 'withdrawn') then
      raise exception 'Your parent or guardian said no. Talk to them first. If they change their mind they can use the link they were sent, or you can ask the Care Team for help.' using errcode = '22023';
    end if;
    select count(*)::int into v_sent from public.messages m
     where m.template = 'guardian_request' and m.dedupe_key like 'guardian:' || g.id::text || ':%' and m.created_at > now() - interval '1 day';
    if v_sent >= 3 then
      raise exception 'We have already sent this three times today. Try again tomorrow.' using errcode = '22023';
    end if;
  end if;

  v_hash := public.referee_token_hash(v_secret);
  if g.id is not null then
    -- A fresh link: the old one stops working
    update public.guardian_consents
       set guardian_name = v_name, relationship = p_relationship, guardian_email = v_email, guardian_phone = v_phone,
           token_hash = v_hash, token_expires_at = now() + interval '14 days', status = 'requested', requested_at = now()
     where id = g.id
     returning id into v_id;
  else
    insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, guardian_phone, token_hash, token_expires_at)
    values (uid, v_name, p_relationship, v_email, v_phone, v_hash, now() + interval '14 days')
    returning id into v_id;
  end if;

  perform public.enqueue_message(
    null, 'guardian_request',
    jsonb_build_object('guardian', v_name, 'teen_first', public.first_name_of(uid), 'relationship', p_relationship, 'token', v_secret),
    null, 'guardian:' || v_id::text || ':' || gen_random_uuid()::text,
    null, 'normal', null, v_email, v_phone, v_name);
  perform public.write_event(uid, 'guardian.requested', 'person', uid::text, '{}'::jsonb);
  return public.my_guardian();
end;
$$;

-- ---------------------------------------------------------------------------
-- The parent or guardian's side (no account: the private link is the key)
-- ---------------------------------------------------------------------------

create function public.get_guardian_request(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.guardian_consents%rowtype;
  v_circle public.circles%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into g from public.guardian_consents where token_hash = public.referee_token_hash(p_token);
  if not found then
    return null;
  end if;
  select c.* into v_circle
    from public.circle_members m join public.circles c on c.id = m.circle_id
   where m.person_id = g.person_id and m.status = 'active' limit 1;
  return jsonb_build_object(
    'teen_first', public.first_name_of(g.person_id),
    'guardian', g.guardian_name,
    'relationship', g.relationship,
    'status', g.status,
    'expired', g.token_expires_at < now(),
    'answered_at', g.answered_at,
    'consent_version', g.consent_version,
    -- Who the young person is meeting with, once they have a place
    'circle', case when v_circle.id is not null then jsonb_build_object(
        'name', v_circle.name,
        'leader', public.first_name_of(v_circle.leader_id),
        'assistant', case when v_circle.assistant_id is not null then public.first_name_of(v_circle.assistant_id) end,
        'day', v_circle.meeting_day, 'time', to_char(v_circle.meeting_time, 'HH24:MI'),
        'mode', v_circle.meeting_mode, 'place', v_circle.place_note) end);
end;
$$;

-- Yes or no. A "no" after a yes takes the permission back, and the young person leaves their circle.
create function public.answer_guardian_request(
  p_token text,
  p_approve boolean,
  p_agree boolean default null,
  p_version text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.guardian_consents%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_what text;
  v_to uuid;
  place public.circle_members%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_approve is null then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  select * into g from public.guardian_consents where token_hash = public.referee_token_hash(p_token) for update;
  if not found then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  if g.token_expires_at < now() then
    raise exception 'This link has expired. Ask the young person to send a new one.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;

  if p_approve then
    if g.status = 'approved' then
      return public.get_guardian_request(p_token);
    end if;
    if p_agree is distinct from true then
      raise exception 'Tick the box to confirm you have read this and agree' using errcode = '22023';
    end if;
    if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,24}$' then
      raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
    end if;
    update public.guardian_consents
       set status = 'approved', consent_version = p_version, answered_at = now(), answers = answers + 1,
           guardian_note = v_note, verified_at = null, verified_by = null, verified_note = null,
           token_expires_at = greatest(token_expires_at, now() + interval '120 days')
     where id = g.id;
    v_what := 'approved';
  else
    if g.status in ('declined', 'withdrawn') then
      return public.get_guardian_request(p_token);
    end if;
    v_what := case when g.status = 'approved' then 'withdrawn' else 'declined' end;
    update public.guardian_consents
       set status = v_what, answered_at = now(), answers = answers + 1, guardian_note = v_note,
           verified_at = null, verified_by = null, verified_note = null,
           token_expires_at = greatest(token_expires_at, now() + interval '120 days')
     where id = g.id;
    if v_what = 'withdrawn' then
      -- The permission is gone, so is the seat
      for place in select * from public.circle_members m where m.person_id = g.person_id and m.status = 'active' for update loop
        update public.circle_members
           set status = 'released', released_at = now(), release_reason = 'parent or guardian withdrew permission'
         where id = place.id;
        update public.match_recommendations set chosen = false where run_id = place.run_id and circle_id = place.circle_id;
      end loop;
      update public.swap_requests set status = 'withdrawn', decided_at = now()
       where person_id = g.person_id and status in ('requested', 'offered');
    end if;
  end if;

  -- The Care Team hears about every answer: a yes needs a call, a no may need a conversation
  for v_to in select * from public.care_team() loop
    perform public.enqueue_message(v_to, 'guardian_update',
      jsonb_build_object('teen_first', public.first_name_of(g.person_id), 'what', v_what),
      null, 'guardian:' || g.id::text || ':' || (g.answers + 1)::text || ':' || v_to::text);
  end loop;
  perform public.write_event(null, 'guardian.' || v_what, 'person', g.person_id::text, '{}'::jsonb);
  return public.get_guardian_request(p_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- The Care Team's side
-- ---------------------------------------------------------------------------

create function public.guardian_overview()
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
  if not public.guardian_staff() then
    raise exception 'Only the Care Team can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'track_open', public.teen_track_open(),
    -- The parent or guardian said yes. Someone phones them to check it was really them.
    'to_call', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', g.person_id, 'teen', public.person_display_name(g.person_id),
               'guardian', g.guardian_name, 'relationship', g.relationship,
               'email', g.guardian_email, 'phone', g.guardian_phone,
               'answered_at', g.answered_at, 'note', g.guardian_note) order by g.answered_at)
        from public.guardian_consents g join public.people p on p.id = g.person_id
       where g.status = 'approved' and g.verified_at is null and p.centre_id = public.my_centre()), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', g.person_id, 'teen', public.person_display_name(g.person_id),
               'guardian', g.guardian_name, 'relationship', g.relationship,
               'requested_at', g.requested_at, 'expired', g.token_expires_at < now()) order by g.requested_at)
        from public.guardian_consents g join public.people p on p.id = g.person_id
       where g.status = 'requested' and p.centre_id = public.my_centre()), '[]'::jsonb),
    'said_no', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', g.person_id, 'teen', public.person_display_name(g.person_id),
               'status', g.status, 'answered_at', g.answered_at) order by g.answered_at desc)
        from public.guardian_consents g join public.people p on p.id = g.person_id
       where g.status in ('declined', 'withdrawn') and p.centre_id = public.my_centre()), '[]'::jsonb),
    'ready', (select count(*) from public.guardian_consents g join public.people p on p.id = g.person_id
               where g.status = 'approved' and g.verified_at is not null and p.centre_id = public.my_centre()),
    -- A circle with young people in it must always have two adults
    'circles_short', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'members', x.n) order by c.name)
        from public.circles c
        join (select m.circle_id, count(*) as n from public.circle_members m
               where m.status = 'active' and public.is_minor(m.person_id) group by m.circle_id) x on x.circle_id = c.id
        join public.seasons s on s.id = c.season_id
       where c.assistant_id is null and s.centre_id = public.my_centre()), '[]'::jsonb));
end;
$$;

create function public.verify_guardian(p_person uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.guardian_consents%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.guardian_staff() then
    raise exception 'Only the Care Team can confirm this' using errcode = '42501';
  end if;
  select g0.* into g from public.guardian_consents g0 join public.people p on p.id = g0.person_id
   where g0.person_id = p_person and p.centre_id = public.my_centre() for update of g0;
  if not found then
    raise exception 'We could not find that request' using errcode = 'P0002';
  end if;
  if g.status <> 'approved' then
    raise exception 'Their parent or guardian has not said yes' using errcode = '22023';
  end if;
  if g.person_id = uid then
    raise exception 'You cannot confirm your own' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = '22023';
  end if;
  update public.guardian_consents set verified_at = now(), verified_by = uid, verified_note = v_note where id = g.id;
  perform public.write_event(uid, 'guardian.verified', 'person', p_person::text, '{}'::jsonb);
  return public.guardian_overview();
end;
$$;

-- After a "no" the young person cannot ask again by themselves. If the family has talked and the parent or
-- guardian wants to start again, a member of the Care Team opens it up.
create function public.reopen_guardian_request(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.guardian_staff() then
    raise exception 'Only the Care Team can do this' using errcode = '42501';
  end if;
  delete from public.guardian_consents g using public.people p
   where g.person_id = p_person and p.id = g.person_id and p.centre_id = public.my_centre() and g.status in ('declined', 'withdrawn');
  if not found then
    raise exception 'There is nothing to open again' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'guardian.reopened', 'person', p_person::text, '{}'::jsonb);
  return public.guardian_overview();
end;
$$;

-- Contact details of a parent or guardian are kept only as long as they are needed: until a season after the
-- young person's last one has ended. Called by the nightly job.
create function public.guardian_retention(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  with gone as (
    select g.id from public.guardian_consents g
     where not exists (
       select 1 from public.circle_members m join public.seasons s on s.id = m.season_id
        where m.person_id = g.person_id and (m.status = 'active' or s.ends_on > public.today_lagos() - p_days))
       and g.requested_at < now() - make_interval(days => p_days))
  delete from public.guardian_consents g using gone where g.id = gone.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Matching respects all of this
-- ---------------------------------------------------------------------------
-- (Copies of the functions as they stood, with the lines marked below added.)

create or replace function public.match_candidates(p_person uuid)
returns table (
  r_circle uuid, r_degree integer,
  r_goal numeric, r_stage numeric, r_tribe numeric, r_place numeric, r_style numeric, r_rhythm numeric, r_faith numeric,
  r_balance numeric, r_affinity numeric, r_online boolean, r_seats integer, r_published timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.member_profiles%rowtype;
  my_track uuid;
  my_sort integer;
  my_minor boolean;
  my_family uuid;
  w jsonb;
  my_est boolean;
  my_heavy boolean;
begin
  select * into me from public.member_profiles where person_id = p_person;
  if not found then
    return;
  end if;
  select ar.track_id, t.sort, (ar.max_age is not null and ar.max_age < 18) into my_track, my_sort, my_minor
    from public.age_ranges ar join public.tracks t on t.id = ar.track_id
   where ar.id = me.age_range_id;
  select sg.family_id into my_family from public.season_goals sg where sg.id = me.season_goal_id;
  select mm.weights into w from public.match_models mm where mm.active;
  my_est := me.faith_journey in ('established', 'leading');
  my_heavy := me.support_load >= 2;

  return query
  with pool as (
    select c.id, c.capacity, c.leader_id, c.tribe_id, c.track_id, c.season_goal_id, c.meeting_mode, c.zone, c.published_at,
           sg.family_id as goal_family,
           (select a.answers #>> '{style,leadBest}'
              from public.leader_applications a
             where a.person_id = c.leader_id and a.status = 'approved_leader'
             order by a.decided_at desc nulls last limit 1) as lead_style
      from public.circles c
      left join public.season_goals sg on sg.id = c.season_goal_id
     where c.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
       and (me.season_id is null or c.season_id = me.season_id)
       -- their own life stage, or the next one up or down if they said that would be fine
       and (c.track_id = my_track
            -- a neighbouring life stage is only ever for adults, and never the teen track
            or (me.open_to_adjacent and not my_minor
                and exists (select 1 from public.tracks ct
                             where ct.id = c.track_id and ct.active and ct.slug <> 'teens' and abs(ct.sort - my_sort) = 1)))
       -- young people are only placed in a circle led by two adults
       and (not my_minor or c.assistant_id is not null)
       and c.leader_id <> p_person
       and (c.assistant_id is null or c.assistant_id <> p_person)
       -- the member can make the time
       and (cardinality(me.meeting_times) = 0 or c.slot = any (me.meeting_times))
       -- the member can make the format
       and (me.meeting_mode = 'either' or me.meeting_mode::text = c.meeting_mode)
       and (c.meeting_mode = 'online' or me.zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
       -- the circle is for them
       and (case c.circle_type
              when 'mixed' then me.circle_mix <> 'same_gender'
              when 'women' then me.gender = 'female' and me.circle_mix <> 'mixed'
              when 'men'   then me.gender = 'male'   and me.circle_mix <> 'mixed'
              else false end)
  ),
  mix as (
    select p.id as cid,
           count(cm.id) as n,
           coalesce(sum(mp.style_social), 0) as soc_sum,
           count(*) filter (where mp.style_social = -1) as quiet_n,
           count(*) filter (where mp.style_social = 1) as lively_n,
           count(*) filter (where mp.faith_journey in ('established', 'leading')) as est_n,
           count(*) filter (where mp.faith_journey = me.faith_journey) as same_stage_n,
           count(*) filter (where mp.support_load >= 2) as heavy_n
      from pool p
      left join public.circle_members cm on cm.circle_id = p.id and cm.status = 'active'
      left join public.member_profiles mp on mp.person_id = cm.person_id
     group by p.id
  ),
  open_ones as (
    select p.*, x.n, x.soc_sum, x.same_stage_n
      from pool p
      join mix x on x.cid = p.id
     where p.capacity - x.n >= 1
       -- circle health: no more than two heavy-support members
       and not (my_heavy and x.heavy_n >= 2)
       -- ...at least two established believers, still reachable with the seats that are left
       and greatest(0, 2 - (x.est_n + case when my_est then 1 else 0 end)) <= p.capacity - x.n - 1
       -- ...quiet and lively members both present, still reachable
       and ((case when (x.quiet_n + (case when me.style_social = -1 then 1 else 0 end)) = 0 then 1 else 0 end)
          + (case when (x.lively_n + (case when me.style_social = 1 then 1 else 0 end)) = 0 then 1 else 0 end)) <= p.capacity - x.n - 1
  ),
  comp as (
    select o.id, o.capacity, o.n, o.published_at, (o.meeting_mode = 'online') as online,
           case when o.season_goal_id = me.season_goal_id then 1.0
                when me.season_goal_id is not null and o.goal_family = my_family then 0.6
                else 0.2 end as c_goal,
           case when o.track_id = my_track then 1.0 else 0.5 end as c_stage,
           case when me.tribe_id is not null and o.tribe_id = me.tribe_id then 1.0
                when me.second_tribe_id is not null and o.tribe_id = me.second_tribe_id then 0.7
                when my_family is not null and o.goal_family = my_family then 0.3
                else 0.1 end as c_tribe,
           case when o.meeting_mode = 'online' then 1.0
                when o.zone = me.zone then 1.0
                when (o.zone, me.zone) in (('iganmu-surulere', 'mainland'), ('mainland', 'iganmu-surulere'),
                                           ('mainland', 'island-lekki'), ('island-lekki', 'mainland'),
                                           ('iganmu-surulere', 'island-lekki'), ('island-lekki', 'iganmu-surulere')) then 0.6
                else 0.2 end as c_place,
           0.5 * (case when me.meeting_mode::text = o.meeting_mode then 1.0 else 0.8 end)
             + 0.5 * (case when cardinality(me.meeting_times) = 0 then 0.7 else 1.0 end) as c_rhythm,
           case when o.n = 0 or me.style_social = 0 then 0.6
                else greatest(0.0, least(1.0, 0.5 + 0.5 * (abs(o.soc_sum::numeric / o.n)
                                                          - abs((o.soc_sum + me.style_social)::numeric / (o.n + 1))))) end as c_social,
           -- Does this person bring a role the circle is short of? A role two others already hold counts for less.
           case when cardinality(me.group_roles) = 0 then null
                else (select avg(case when (select count(*)
                                              from public.circle_members cm2
                                              join public.member_profiles mp2 on mp2.person_id = cm2.person_id
                                             where cm2.circle_id = o.id and cm2.status = 'active' and r = any (mp2.group_roles)) < 2
                                      then 1.0 else 0.4 end)
                        from unnest(me.group_roles) as r) end as c_roles,
           public.lead_affinity(o.lead_style, me.style_social, me.style_structure, me.style_openness,
                                me.style_disclosure, me.style_learning) as c_affinity,
           case when o.n = 0 then 0.8
                when o.same_stage_n::numeric / o.n <= 0.34 then 1.0
                else 0.6 end as c_faith
      from open_ones o
  ),
  scored as (
    select k.*,
           case when k.c_roles is null then k.c_social else 0.75 * k.c_social + 0.25 * k.c_roles end as c_balance
      from comp k
  )
  select k.id,
         round(
           (w ->> 'goal')::numeric * k.c_goal + (w ->> 'stage')::numeric * k.c_stage
         + (w ->> 'tribe')::numeric * k.c_tribe + (w ->> 'place')::numeric * k.c_place
         + (w ->> 'style')::numeric * (0.5 * k.c_balance + 0.5 * k.c_affinity)
         + (w ->> 'rhythm')::numeric * k.c_rhythm + (w ->> 'faith')::numeric * k.c_faith)::integer,
         k.c_goal, k.c_stage, k.c_tribe, k.c_place, (0.5 * k.c_balance + 0.5 * k.c_affinity), k.c_rhythm, k.c_faith,
         k.c_balance, k.c_affinity, k.online, (k.capacity - k.n)::integer, k.published_at
    from scored k;
end;
$$;

create or replace function public.match_me(p_refresh boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prof public.member_profiles%rowtype;
  model public.match_models%rowtype;
  last_run public.match_runs%rowtype;
  new_run uuid := gen_random_uuid();
  total integer;
  kept integer;
  kind text;
  my_track uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into prof from public.member_profiles where person_id = uid;
  if not found then
    raise exception 'Finish the find-your-circle form first' using errcode = '22023';
  end if;
  if exists (select 1 from public.circle_members where person_id = uid and status = 'active') then
    return public.my_match();
  end if;
  -- A young person needs a parent or guardian's confirmed permission first
  perform public.guardian_gate(uid);
  select * into model from public.match_models where active;

  select r.* into last_run from public.match_runs r where r.person_id = uid order by r.ran_at desc limit 1;
  if found and not p_refresh and last_run.ran_at > now() - interval '10 minutes' then
    return public.my_match();
  end if;

  select count(*) into total from public.match_candidates(uid);

  insert into public.match_runs (id, person_id, season_id, model_version, candidates, shown)
  values (new_run, uid, prof.season_id, model.version, total, 0);

  insert into public.match_recommendations (run_id, person_id, rank, circle_id, degree, components, reasons)
  select new_run, uid, ranked.rk, ranked.r_circle, ranked.r_degree,
         jsonb_build_object('goal', ranked.r_goal, 'stage', ranked.r_stage, 'tribe', ranked.r_tribe, 'place', ranked.r_place,
                            'style', ranked.r_style, 'rhythm', ranked.r_rhythm, 'faith', ranked.r_faith),
         public.match_reasons(ranked.r_goal, ranked.r_stage, ranked.r_tribe, ranked.r_place, ranked.r_online,
                              ranked.r_rhythm, ranked.r_balance, ranked.r_affinity, ranked.r_faith, model.weights)
    from (
      select cand.*,
             (row_number() over (order by cand.r_degree desc, cand.r_goal desc, cand.r_tribe desc,
                                          cand.r_published asc nulls last, cand.r_circle))::smallint as rk
        from public.match_candidates(uid) cand
       where cand.r_degree >= model.min_degree
    ) ranked
   where ranked.rk <= 3;
  get diagnostics kept = row_count;
  update public.match_runs set shown = kept where id = new_run;

  if kept < 3 then
    select ar.track_id into my_track from public.age_ranges ar where ar.id = prof.age_range_id;
    kind := case prof.circle_mix
              when 'mixed' then 'mixed'
              when 'no_preference' then 'any'
              else case prof.gender when 'female' then 'women' when 'male' then 'men' else 'mixed' end end;
    insert into public.match_demand (person_id, season_id, track_id, tribe_id, season_goal_id, zone, meeting_mode, meeting_times, circle_kind, shown)
    values (uid, prof.season_id, my_track, prof.tribe_id, prof.season_goal_id, prof.zone, prof.meeting_mode::text, prof.meeting_times, kind, kept)
    on conflict (person_id) do update
      set season_id = excluded.season_id, track_id = excluded.track_id, tribe_id = excluded.tribe_id,
          season_goal_id = excluded.season_goal_id, zone = excluded.zone, meeting_mode = excluded.meeting_mode,
          meeting_times = excluded.meeting_times, circle_kind = excluded.circle_kind, shown = excluded.shown,
          updated_at = now();
  else
    delete from public.match_demand where person_id = uid;
  end if;

  perform public.write_event(uid, 'match.run', 'person', uid::text,
    jsonb_build_object('model', model.version, 'candidates', total, 'shown', kept));
  return public.my_match();
end;
$$;

create or replace function public.choose_circle(p_circle uuid, p_agree boolean, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  prof public.member_profiles%rowtype;
  rec public.match_recommendations%rowtype;
  run public.match_runs%rowtype;
  circ public.circles%rowtype;
  season public.seasons%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_agree is distinct from true then
    raise exception 'Tick the box to agree to the Success Picture and the Circle Covenant' using errcode = '22023';
  end if;
  if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into prof from public.member_profiles where person_id = uid;
  if not found then
    raise exception 'Finish the find-your-circle form first' using errcode = '22023';
  end if;
  if exists (select 1 from public.circle_members where person_id = uid and status = 'active') then
    raise exception 'You are already in a circle' using errcode = '22023';
  end if;
  perform public.guardian_gate(uid);

  select r.* into run from public.match_runs r where r.person_id = uid order by r.ran_at desc limit 1;
  if not found then
    raise exception 'Look at your circles first' using errcode = '22023';
  end if;
  select x.* into rec from public.match_recommendations x where x.run_id = run.id and x.circle_id = p_circle;
  if not found then
    raise exception 'Choose one of the circles you were shown' using errcode = '22023';
  end if;

  -- One person at a time per circle, so two members cannot take the last seat together.
  select * into circ from public.circles where id = p_circle for update;
  if circ.status <> 'approved' or not exists (select 1 from public.leader_certifications where person_id = circ.leader_id) then
    raise exception 'That circle is no longer open. Choose another.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.match_candidates(uid) where r_circle = p_circle) then
    raise exception 'That circle has just filled or changed. Look at your circles again.' using errcode = '22023';
  end if;

  select * into season from public.seasons where id = circ.season_id;
  insert into public.circle_members (circle_id, person_id, season_id, chosen_rank, degree, model_version, run_id,
                                     agreement_version, covenant, first_meeting_by)
  values (p_circle, uid, circ.season_id, rec.rank, rec.degree, run.model_version, run.id, p_version,
          jsonb_build_object('name', circ.name, 'god', circ.loving_god, 'others', circ.loving_others, 'life', circ.loving_life),
          greatest(current_date, season.starts_on) + 14);
  update public.match_recommendations set chosen = true where id = rec.id;
  delete from public.match_demand where person_id = uid;

  perform public.write_event(uid, 'match.chosen', 'circle', p_circle::text,
    jsonb_build_object('rank', rec.rank, 'degree', rec.degree, 'model', run.model_version));
  return public.my_match();
end;
$$;

-- ===========================================================================
-- Access
-- ===========================================================================

alter table public.multiplication_plans enable row level security;

revoke execute on function
  public.model_sample(),
  public.model_proposal(text),
  public.retrain_preview(),
  public.list_models(),
  public.retrain_model(text, boolean),
  public.activate_model(text, boolean),
  public.discard_model(text),
  public.swap_staff(uuid),
  public.my_swap(),
  public.swap_notify_staff(uuid),
  public.request_swap(text, text, uuid),
  public.start_swap_for(uuid, text, text),
  public.cancel_swap(),
  public.swap_options(uuid, uuid),
  public.swap_queue(),
  public.swap_members(text),
  public.offer_swap(uuid, uuid),
  public.decline_swap(uuid, text),
  public.answer_swap(boolean, text),
  public.multiplication_staff(),
  public.multiplication_board(uuid),
  public.plan_multiplication(uuid, text, uuid, text),
  public.clear_multiplication_plan(uuid),
  public.is_minor(uuid),
  public.teen_track_open(),
  public.tracks_teen_guard(),
  public.profile_teen_guard(),
  public.messages_scrub_secret(),
  public.guardian_ready(uuid),
  public.guardian_gate(uuid),
  public.guardian_staff(),
  public.mask_contact(text, text),
  public.my_guardian(),
  public.request_guardian_consent(text, text, text, text),
  public.get_guardian_request(text),
  public.answer_guardian_request(text, boolean, boolean, text, text),
  public.guardian_overview(),
  public.verify_guardian(uuid, text),
  public.reopen_guardian_request(uuid),
  public.guardian_retention(integer),
  public.match_candidates(uuid),
  public.match_me(boolean),
  public.choose_circle(uuid, boolean, text),
  public.kpi_members(uuid)
  from public, anon, authenticated;

-- People who are signed in
grant execute on function
  public.retrain_preview(),
  public.list_models(),
  public.retrain_model(text, boolean),
  public.activate_model(text, boolean),
  public.discard_model(text),
  public.my_swap(),
  public.request_swap(text, text, uuid),
  public.start_swap_for(uuid, text, text),
  public.cancel_swap(),
  public.swap_queue(),
  public.swap_members(text),
  public.offer_swap(uuid, uuid),
  public.decline_swap(uuid, text),
  public.answer_swap(boolean, text),
  public.multiplication_board(uuid),
  public.plan_multiplication(uuid, text, uuid, text),
  public.clear_multiplication_plan(uuid),
  public.teen_track_open(),
  public.my_guardian(),
  public.request_guardian_consent(text, text, text, text),
  public.guardian_overview(),
  public.verify_guardian(uuid, text),
  public.reopen_guardian_request(uuid),
  public.match_me(boolean),
  public.choose_circle(uuid, boolean, text)
  to authenticated;

-- A parent or guardian has no account; the private link is the key.
grant execute on function
  public.get_guardian_request(text),
  public.answer_guardian_request(text, boolean, boolean, text, text)
  to anon, authenticated;

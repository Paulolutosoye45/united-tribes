-- =============================================================================
-- Package 8: Seat autopilot (the bench, the daily plan, opening small tribes, the small-tribe watch)
-- =============================================================================
-- One new switch, Seat autopilot (seat_autopilot): Off, Rehearsal or On, for the whole church, one community or one tribe. It starts Off and it needs Seat window
-- On (the Switchboard's own "depends" does that: a tribe whose seat window is not On is not touched). It is refused On while a seat-window check is red.
--
-- What it does, once a day, between 8 am and 7 pm in Lagos while joining is open (and for a number of days after it closes, set by the owner):
--   * the bench: members with a finished form who agreed to be matched, hold no seat, are on no clock, and did not change their answers in the last 7 days
--   * a plan: every bench member goes to their best fit at the bar or above (default 70%); within 5 points the tribe with fewer members. A tribe that already has
--     the smallest size (default 5) is filled one person at a time up to its capacity less the seats kept free, at most 2 a day to one tribe. A tribe with fewer
--     is opened only when that many bench members fit it at the bar, as a team, never one person alone. At most 25 placements a day.
--   * Rehearsal writes the plan and nothing else. On: Suggest (the admin and the director get one email, one tap places it, an unapproved plan lapses at midnight)
--     or Auto (it places at the first beat after 9 am). Every person is placed through the same door as the office's own placement (placement_office_do), so the
--     same checks, the "Your tribe" email, the consent gate, the leader's email and the Undo apply to each of them, and each is logged as autopilot.
--   * the small-tribe watch: a tribe still under the smallest size ten days after it opened, with a suggested merge, or "hard to fill" with the reason in words.
--
-- It never places someone below the bar, into a full tribe, under 18, who has not agreed to matching, or who changed their answers in the last 7 days; never changes
-- a confirmed seat; never removes anyone. The figures on the Seats page (the bench against the seats open, the people held back only by the bar, the small tribes)
-- are written once, when the day's plan is made, so reading the page costs nothing.
--
-- It replaces two functions (their old text is in the rollback file): seat_morning_numbers (two more numbers for the office's 7 am email) and
-- worker_seat_window_tick (it also runs the autopilot's step). Nothing here sends or places anything until a person moves the switch.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.reach_release_seat(uuid, text)') is null
     or to_regprocedure('public.seat_pick(uuid, uuid, uuid)') is null
     or to_regprocedure('public.placement_office_do(uuid, uuid, text[], text, boolean, boolean, text, uuid, text, uuid)') is null then
    raise exception 'Apply Package 7 (20270121000100_seat_release.sql) and Package 6 (20270120000100_seat_window.sql) before this file.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------
insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('seat_autopilot', 'Seat autopilot', 'Fills tribes without anyone planning a run. Once a day it puts each waiting member (finished form, agreed to be matched, no seat) with their best fit at 70% or more, fills tribes that have 5 or more people, and opens a smaller tribe only when 5 people fit it, never one person alone. In Suggest the admin and director get one email and one tap places the day''s plan; in Auto it places at the first beat after 9 am. Every person is placed the way the office places one, so the same checks, emails and Undo apply. Needs Seat window On. Rehearsal writes the plan and places nobody. Cannot be put On while a seat-window check is red.', 8, array['seat_window'], array['off', 'rehearsal', 'on'], 'off', true, 35, false);

-- ---------------------------------------------------------------------------
-- The numbers, the plans and what each plan holds
-- ---------------------------------------------------------------------------
create table public.autopilot_settings (
  id boolean primary key default true check (id),
  -- Suggest: one tap places the day's plan. Auto: it places at the first beat after 9 am.
  mode text not null default 'suggest' check (mode in ('suggest', 'auto')),
  bar integer not null default 70 check (bar between 60 and 95),
  per_tribe_day integer not null default 2 check (per_tribe_day between 1 and 4),
  day_cap integer not null default 25 check (day_cap between 5 and 100),
  -- Days after joining closes that it keeps placing
  extra_days integer not null default 7 check (extra_days between 0 and 30),
  -- Days after a tribe opened before it is called small
  small_days integer not null default 10 check (small_days between 5 and 30),
  paused boolean not null default false,
  paused_reason text check (char_length(paused_reason) <= 300),
  paused_at timestamptz,
  paused_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.autopilot_settings (id) values (true);

create table public.autopilot_plans (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  plan_on date not null,
  -- rehearsal: only written down. planned: waiting for a tap (or about to be placed). applied: placed. lapsed: nobody tapped before midnight. empty: nobody to place.
  state text not null default 'empty' check (state in ('rehearsal', 'planned', 'applied', 'lapsed', 'empty')),
  mode text not null check (mode in ('suggest', 'auto')),
  made_at timestamptz not null default now(),
  decided_by uuid references public.people (id) on delete set null,
  applied_at timestamptz,
  n_items integer not null default 0,
  n_placed integer not null default 0,
  n_skipped integer not null default 0,
  stats jsonb not null default '{}'::jsonb check (pg_column_size(stats) < 60000),
  unique (season_id, plan_on)
);

create table public.autopilot_items (
  id bigserial primary key,
  plan_id uuid not null references public.autopilot_plans (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  degree integer not null,
  kind text not null check (kind in ('fill', 'open')),
  rehearsal boolean not null default false,
  outcome text check (char_length(outcome) <= 120)
);
create index autopilot_items_plan_idx on public.autopilot_items (plan_id, id);
create index autopilot_items_person_idx on public.autopilot_items (person_id);

alter table public.autopilot_settings enable row level security;
alter table public.autopilot_plans enable row level security;
alter table public.autopilot_items enable row level security;
revoke all on table public.autopilot_settings, public.autopilot_plans, public.autopilot_items from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The switch, as the rest of the system reads it, and the refusal to put it On while a check is red
-- ---------------------------------------------------------------------------
create function public.autopilot_any()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when not exists (select 1 from public.feature_registry f where f.key = 'seat_autopilot' and f.available) then 'off'
    when exists (select 1 from public.feature_settings s where s.feature = 'seat_autopilot' and s.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings s where s.feature = 'seat_autopilot' and s.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
$$;

create function public.autopilot_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := public.seat_health_core();
begin
  if not (h ->> 'ok')::boolean then
    raise exception 'Seat autopilot cannot be put On yet: %', (h -> 'problems' ->> 0) using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger autopilot_gate_insert
  before insert on public.feature_settings
  for each row when (new.feature = 'seat_autopilot' and new.position = 'on')
  execute function public.autopilot_gate();
create trigger autopilot_gate_update
  before update on public.feature_settings
  for each row when (new.feature = 'seat_autopilot' and new.position = 'on' and old.position is distinct from 'on')
  execute function public.autopilot_gate();

-- ---------------------------------------------------------------------------
-- One fit: the compatibility of one person with one tribe when the placement check has nothing to say about it (no blocker, and no warning but "joining has closed"), else null.
-- A person who already holds a seat is looked at as a move (p_move). A tribe the person just lost a seat in, within the days they may take it back, is not offered
-- to them again.
-- ---------------------------------------------------------------------------
create function public.autopilot_degree(p_person uuid, p_tribe uuid, p_move boolean default false)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chk jsonb;
begin
  if not coalesce(p_move, false)
     and exists (select 1 from public.seat_clocks k where k.person_id = p_person and k.tribe_id = p_tribe and k.state = 'released' and k.retake_until > now() and not k.front_of_line) then
    return null;
  end if;
  begin
    v_chk := public.placement_check_core(p_person, p_tribe, coalesce(p_move, false), 'owner', null);
  exception when others then
    return null;
  end;
  -- The one warning that is let through is "joining has closed": autopilot only works inside the days the owner allows after it closes, and says so on each placement
  if jsonb_array_length(v_chk -> 'blockers') > 0
     or exists (select 1 from jsonb_array_elements(v_chk -> 'warnings') w where w ->> 'code' <> 'after_cutoff') then
    return null;
  end if;
  return (v_chk ->> 'degree')::integer;
end;
$$;

-- The season autopilot works in: the one people are being placed into (as placement_season), and for the days the owner allows after joining closes, the one that has
-- just closed. Null when there is none.
create function public.autopilot_season(p_extra integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.seasons s
   where s.status in ('planning', 'open', 'running')
     and (s.starts_on > public.today_lagos()
          or public.today_lagos() <= s.starts_on + (public.reminder_cfg()).joining_closes_days + greatest(coalesce(p_extra, 0), 0))
   order by (s.starts_on <= public.today_lagos()) desc, s.starts_on
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- The bench: who is waiting for a seat, longest wait first (a member who just lost a seat and may take it back goes first)
-- ---------------------------------------------------------------------------
create function public.autopilot_bench(p_season uuid, p_limit integer default 60)
returns table (person_id uuid, waited_days integer, front boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cand record;
  v_n integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 500);
begin
  for cand in
    select mp.person_id as pid, greatest(0, extract(day from now() - mp.updated_at))::integer as waited,
           coalesce((select bool_or(k.front_of_line) from public.seat_clocks k where k.person_id = mp.person_id and k.state = 'released' and k.retake_until > now()), false) as is_front
      from public.member_profiles mp
     where (mp.season_id is null or mp.season_id = p_season)
       and not exists (select 1 from public.tribe_members x where x.person_id = mp.person_id and x.season_id = p_season and x.status = 'active')
       and not exists (select 1 from public.seat_clocks k where k.person_id = mp.person_id and not k.rehearsal and k.state in ('running', 'kept'))
     order by 3 desc, mp.updated_at asc, mp.person_id
     limit v_limit * 4
  loop
    exit when v_n >= v_limit;
    continue when public.placement_pool_reason(cand.pid, p_season, 7) is not null;
    person_id := cand.pid;
    waited_days := cand.waited;
    front := cand.is_front;
    v_n := v_n + 1;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The daily plan. Written once a day for the season people are being placed into; nobody is placed here.
-- ---------------------------------------------------------------------------
create function public.autopilot_plan_build(p_season uuid, p_mode text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.autopilot_settings%rowtype;
  ps public.placement_settings%rowtype;
  v_plan uuid;
  t record;
  r record;
  -- the tribes autopilot may touch today
  t_id uuid[] := '{}';
  t_name text[] := '{}';
  t_leader uuid[] := '{}';
  t_n integer[] := '{}';
  t_cap integer[] := '{}';
  t_pl integer[] := '{}';
  t_reh boolean[] := '{}';
  t_slot text[] := '{}';
  t_mode text[] := '{}';
  t_pub timestamptz[] := '{}';
  -- the bench
  b_id uuid[] := '{}';
  b_all uuid[] := '{}';
  v_total integer := 0;
  fits jsonb := '{}'::jsonb;
  chosen uuid[] := '{}';
  seen uuid[] := '{}';
  v_count integer := 0;
  v_deg integer;
  v_max integer;
  v_best integer;
  v_bestc integer;
  v_c integer;
  v_has boolean;
  v_fit boolean;
  v_blocked integer := 0;
  v_kinds jsonb;
  v_small jsonb := '[]'::jsonb;
  v_items integer;
  v_real integer;
  v_taken integer;
  v_k integer;
  v_best_u integer;
  v_best_fit integer;
  v_fit_n integer;
  v_names jsonb;
  v_mem record;
  v_why text;
  v_n_time integer;
  v_n_mode integer;
begin
  select * into a from public.autopilot_settings x where x.id;
  select * into ps from public.placement_settings x where x.singleton;
  insert into public.autopilot_plans (season_id, plan_on, state, mode) values (p_season, public.today_lagos(), 'empty', p_mode)
    on conflict (season_id, plan_on) do nothing
    returning id into v_plan;
  if v_plan is null then
    return null;
  end if;

  for t in
    select tr.id, tr.name, tr.capacity, tr.slot, tr.leader_id, tr.meeting_mode as mode, tr.published_at,
           (select count(*)::integer from public.tribe_members m where m.tribe_id = tr.id and m.status = 'active') as n,
           public.feature_state_of('seat_autopilot', tr.leader_id) as st
      from public.tribes tr
     where tr.season_id = p_season and tr.status = 'approved' and tr.leader_id is not null
     order by tr.id
     limit 80
  loop
    continue when t.st = 'off';
    t_id := t_id || t.id;
    t_name := t_name || t.name::text;
    t_leader := t_leader || t.leader_id;
    t_n := t_n || t.n;
    t_cap := t_cap || t.capacity;
    t_pl := t_pl || 0;
    t_reh := t_reh || (t.st = 'rehearsal');
    t_slot := t_slot || coalesce(t.slot, '')::text;
    t_mode := t_mode || coalesce(t.mode, '')::text;
    t_pub := t_pub || coalesce(t.published_at, now());
  end loop;

  for r in select * from public.autopilot_bench(p_season, 500) loop
    v_total := v_total + 1;
    b_all := b_all || r.person_id;
    if cardinality(b_id) < 60 then
      b_id := b_id || r.person_id;
    end if;
  end loop;

  -- How well each of the first 60 on the bench fits each tribe that has a seat for one more (a clean check only)
  for i in 1 .. cardinality(b_id) loop
    for j in 1 .. cardinality(t_id) loop
      continue when t_n[j] + 1 > t_cap[j] - ps.seats_free;
      v_deg := public.autopilot_degree(b_id[i], t_id[j], false);
      if v_deg is not null then
        fits := jsonb_set(fits, array[b_id[i]::text], coalesce(fits -> (b_id[i]::text), '{}'::jsonb) || jsonb_build_object(t_id[j]::text, v_deg), true);
      end if;
    end loop;
  end loop;

  -- A. Tribes that already have the smallest size: one person at a time, best fit at the bar, within 5 points the tribe with fewer members
  for i in 1 .. cardinality(b_id) loop
    exit when v_count >= a.day_cap;
    v_max := null;
    for j in 1 .. cardinality(t_id) loop
      continue when t_n[j] < ps.min_tribe or t_n[j] + t_pl[j] + 1 > t_cap[j] - ps.seats_free or t_pl[j] >= a.per_tribe_day;
      v_deg := (fits -> (b_id[i]::text) ->> (t_id[j]::text))::integer;
      continue when v_deg is null or v_deg < a.bar;
      if v_max is null or v_deg > v_max then
        v_max := v_deg;
      end if;
    end loop;
    continue when v_max is null;
    v_best := null;
    v_best_fit := null;
    for j in 1 .. cardinality(t_id) loop
      continue when t_n[j] < ps.min_tribe or t_n[j] + t_pl[j] + 1 > t_cap[j] - ps.seats_free or t_pl[j] >= a.per_tribe_day;
      v_deg := (fits -> (b_id[i]::text) ->> (t_id[j]::text))::integer;
      continue when v_deg is null or v_deg < a.bar or v_deg < v_max - 5;
      if v_best is null or (t_n[j] + t_pl[j]) < (t_n[v_best] + t_pl[v_best])
         or ((t_n[j] + t_pl[j]) = (t_n[v_best] + t_pl[v_best]) and v_deg > v_best_fit) then
        v_best := j;
        v_best_fit := v_deg;
      end if;
    end loop;
    insert into public.autopilot_items (plan_id, person_id, tribe_id, degree, kind, rehearsal) values (v_plan, b_id[i], t_id[v_best], v_best_fit, 'fill', t_reh[v_best]);
    t_pl[v_best] := t_pl[v_best] + 1;
    chosen := chosen || b_id[i];
    v_count := v_count + 1;
  end loop;

  -- B. Tribes below the smallest size: opened only when that many people still waiting fit it at the bar, and then as a team
  loop
    v_best := null;
    v_bestc := 0;
    for j in 1 .. cardinality(t_id) loop
      continue when t_n[j] >= ps.min_tribe or t_id[j] = any (seen);
      v_c := 0;
      for i in 1 .. cardinality(b_id) loop
        continue when b_id[i] = any (chosen);
        v_deg := (fits -> (b_id[i]::text) ->> (t_id[j]::text))::integer;
        if v_deg is not null and v_deg >= a.bar then
          v_c := v_c + 1;
        end if;
      end loop;
      if v_c >= ps.min_tribe and v_c > v_bestc then
        v_best := j;
        v_bestc := v_c;
      end if;
    end loop;
    exit when v_best is null;
    seen := seen || t_id[v_best];
    if t_cap[v_best] - ps.seats_free - t_n[v_best] >= ps.min_tribe and v_count + ps.min_tribe <= a.day_cap then
      v_taken := 0;
      for i in 1 .. cardinality(b_id) loop
        exit when v_taken >= ps.min_tribe;
        continue when b_id[i] = any (chosen);
        v_deg := (fits -> (b_id[i]::text) ->> (t_id[v_best]::text))::integer;
        continue when v_deg is null or v_deg < a.bar;
        insert into public.autopilot_items (plan_id, person_id, tribe_id, degree, kind, rehearsal) values (v_plan, b_id[i], t_id[v_best], v_deg, 'open', t_reh[v_best]);
        chosen := chosen || b_id[i];
        v_taken := v_taken + 1;
      end loop;
      t_pl[v_best] := t_pl[v_best] + v_taken;
      v_count := v_count + v_taken;
    end if;
  end loop;

  -- The people the bar alone holds back: a clean fit with a tribe that has room, but never at the bar
  for i in 1 .. cardinality(b_id) loop
    continue when b_id[i] = any (chosen);
    select count(*) > 0, coalesce(bool_or(e.v::integer >= a.bar), false) into v_has, v_fit from jsonb_each_text(coalesce(fits -> (b_id[i]::text), '{}'::jsonb)) e(k, v);
    if v_has and not v_fit then
      v_blocked := v_blocked + 1;
    end if;
  end loop;

  -- The bench against the seats open, by community and by time (a member who can meet at two times is counted under each)
  select coalesce(jsonb_agg(jsonb_build_object('community', x.community, 'slot', x.slot, 'waiting', x.waiting, 'seats', x.seats) order by x.waiting desc, x.community, x.slot), '[]'::jsonb)
    into v_kinds
    from (
      select u.community, u.slot, sum(u.waiting)::integer as waiting, sum(u.seats)::integer as seats
        from (
          select coalesce(cm.name, 'Any community')::text as community, coalesce(sl.slot, 'any') as slot, count(*)::integer as waiting, 0 as seats
            from public.member_profiles mp
            left join public.communities cm on cm.id = mp.community_id
            left join lateral unnest(case when cardinality(mp.meeting_times) = 0 then array[null]::text[] else mp.meeting_times end) as sl(slot) on true
           where mp.person_id = any (b_all)
           group by 1, 2
          union all
          select coalesce(cm.name, 'Any community')::text, tr.slot::text, 0,
                 greatest(tr.capacity - ps.seats_free - (select count(*)::integer from public.tribe_members m where m.tribe_id = tr.id and m.status = 'active'), 0)
            from public.tribes tr left join public.communities cm on cm.id = tr.community_id
           where tr.season_id = p_season and tr.status = 'approved' and tr.leader_id is not null
        ) u
       group by u.community, u.slot
       having sum(u.waiting) > 0 or sum(u.seats) > 0
    ) x;

  -- The small-tribe watch
  for j in 1 .. cardinality(t_id) loop
    continue when t_n[j] >= ps.min_tribe or t_pl[j] > 0 or t_pub[j] > now() - make_interval(days => a.small_days);
    v_fit_n := 0;
    for i in 1 .. cardinality(b_id) loop
      v_deg := (fits -> (b_id[i]::text) ->> (t_id[j]::text))::integer;
      if v_deg is not null and v_deg >= a.bar then
        v_fit_n := v_fit_n + 1;
      end if;
    end loop;
    -- Where the people could go: the tribe with room where the most of them fit at the bar
    v_best_u := null;
    v_best_fit := 0;
    v_names := '[]'::jsonb;
    if t_n[j] > 0 then
      select coalesce(jsonb_agg(public.person_display_name(m.person_id) order by m.id), '[]'::jsonb) into v_names
        from public.tribe_members m where m.tribe_id = t_id[j] and m.status = 'active';
      for k in 1 .. cardinality(t_id) loop
        continue when k = j or t_n[k] < ps.min_tribe or t_n[k] + t_n[j] > t_cap[k] - ps.seats_free;
        v_k := 0;
        for v_mem in select m.person_id from public.tribe_members m where m.tribe_id = t_id[j] and m.status = 'active' loop
          v_deg := public.autopilot_degree(v_mem.person_id, t_id[k], true);
          if v_deg is not null and v_deg >= a.bar then
            v_k := v_k + 1;
          end if;
        end loop;
        if v_k > v_best_fit or (v_k = v_best_fit and v_k > 0 and v_best_u is not null and (t_cap[k] - t_n[k]) > (t_cap[v_best_u] - t_n[v_best_u])) then
          v_best_u := k;
          v_best_fit := v_k;
        end if;
      end loop;
    end if;
    v_why := null;
    if v_fit_n = 0 then
      -- Nobody waiting fits it: say whether the time, the way of meeting or the fit is what stops them
      select count(*) filter (where cardinality(mp.meeting_times) = 0 or t_slot[j] = any (mp.meeting_times)),
             count(*) filter (where (cardinality(mp.meeting_times) = 0 or t_slot[j] = any (mp.meeting_times)) and (mp.meeting_mode::text = 'either' or mp.meeting_mode::text = t_mode[j]))
        into v_n_time, v_n_mode
        from public.member_profiles mp where mp.person_id = any (b_all);
      v_why := case when v_total = 0 then 'nobody' when v_n_time = 0 then 'time' when v_n_mode = 0 then 'format' else 'fit' end;
    end if;
    v_small := v_small || jsonb_build_array(jsonb_build_object(
      'tribe_id', t_id[j], 'name', t_name[j], 'leader', public.person_display_name(t_leader[j]), 'members', t_n[j], 'slot', t_slot[j],
      'days', greatest(0, extract(day from now() - t_pub[j]))::integer, 'waiting_fit', v_fit_n, 'hard', v_fit_n = 0 and (v_best_u is null or v_best_fit = 0), 'why', v_why,
      'merge', case when v_best_u is null or v_best_fit = 0 then null
                    else jsonb_build_object('to', t_name[v_best_u], 'fits', v_best_fit, 'of', t_n[j], 'names', v_names) end));
  end loop;

  select count(*)::integer, count(*) filter (where not i.rehearsal)::integer into v_items, v_real from public.autopilot_items i where i.plan_id = v_plan;
  update public.autopilot_plans
     set n_items = v_items,
         state = case when v_items = 0 then 'empty' when v_real = 0 then 'rehearsal' else 'planned' end,
         stats = jsonb_build_object('bench_total', v_total, 'considered', cardinality(b_id), 'blocked_by_bar', v_blocked, 'bar', a.bar, 'kinds', v_kinds, 'small', v_small)
   where id = v_plan;
  perform public.write_event(null, 'autopilot.plan', 'season', p_season::text, jsonb_build_object('plan', v_plan, 'items', v_items, 'real', v_real, 'bench', v_total));
  return v_plan;
end;
$$;

-- ---------------------------------------------------------------------------
-- Placing a plan. Everything is checked again, because time has passed since the plan was made.
-- ---------------------------------------------------------------------------
create function public.autopilot_apply_core(p_plan uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.autopilot_plans%rowtype;
  a public.autopilot_settings%rowtype;
  ps public.placement_settings%rowtype;
  it record;
  t public.tribes%rowtype;
  v_placed integer := 0;
  v_skipped integer := 0;
  v_today integer;
  v_out text;
  v_deg integer;
  v_active integer;
  v_tribe_today integer;
  v_tm uuid;
begin
  select * into pl from public.autopilot_plans x where x.id = p_plan for update;
  if not found or pl.state <> 'planned' then
    return jsonb_build_object('ok', false, 'placed', 0, 'skipped', 0);
  end if;
  select * into a from public.autopilot_settings x where x.id;
  select * into ps from public.placement_settings x where x.singleton;
  select count(*)::integer into v_today from public.autopilot_items i join public.autopilot_plans p on p.id = i.plan_id
   where i.outcome = 'placed' and p.plan_on = public.today_lagos() and p.id <> p_plan;
  for it in select * from public.autopilot_items i where i.plan_id = p_plan and not i.rehearsal and i.outcome is null order by i.id loop
    v_out := null;
    select * into t from public.tribes x where x.id = it.tribe_id;
    select count(*)::integer into v_active from public.tribe_members m where m.tribe_id = it.tribe_id and m.status = 'active';
    select count(*)::integer into v_tribe_today from public.autopilot_items i join public.autopilot_plans p on p.id = i.plan_id
     where i.tribe_id = it.tribe_id and i.outcome = 'placed' and p.plan_on = public.today_lagos() and it.kind = 'fill';
    if v_placed + v_today >= a.day_cap then
      v_out := 'skipped:day_limit';
    elsif t.status <> 'approved' then
      v_out := 'skipped:tribe_closed';
    elsif public.placement_pool_reason(it.person_id, t.season_id, 7) is not null then
      v_out := 'skipped:not_eligible';
    elsif v_active + 1 > t.capacity - ps.seats_free then
      v_out := 'skipped:full';
    elsif it.kind = 'fill' and v_tribe_today >= a.per_tribe_day then
      v_out := 'skipped:tribe_day_limit';
    else
      v_deg := public.autopilot_degree(it.person_id, it.tribe_id, false);
      if v_deg is null or v_deg < a.bar then
        v_out := 'skipped:no_longer_fits';
      end if;
    end if;
    if v_out is null then
      begin
        perform set_config('app.seat_via', 'autopilot', true);
        perform public.placement_office_do(it.person_id, it.tribe_id, array['after_cutoff']::text[], 'Placed by autopilot, plan of ' || pl.plan_on::text, false, false, 'owner', null, 'owner', null);
        v_out := 'placed';
        select m.id into v_tm from public.tribe_members m where m.person_id = it.person_id and m.tribe_id = it.tribe_id and m.status = 'active';
        perform public.write_event(p_by, 'autopilot.placed', 'person', it.person_id::text, jsonb_build_object('plan', p_plan, 'tribe', it.tribe_id, 'degree', v_deg, 'kind', it.kind));
      exception when others then
        v_out := 'failed:' || left(sqlerrm, 100);
      end;
    end if;
    update public.autopilot_items set outcome = v_out where id = it.id;
    if v_out = 'placed' then
      v_placed := v_placed + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  update public.autopilot_plans set state = 'applied', applied_at = now(), decided_by = p_by, n_placed = v_placed, n_skipped = v_skipped where id = p_plan;
  return jsonb_build_object('ok', true, 'placed', v_placed, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- The step the heartbeat runs. It does nothing unless the switch is moved, and it makes one plan a day.
-- ---------------------------------------------------------------------------
create function public.autopilot_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.autopilot_settings%rowtype;
  v_state text := public.autopilot_any();
  v_hour integer := public.lagos_hour();
  v_season uuid;
  v_plan uuid;
  v_n integer;
  v_pstate text;
  v_lapsed integer := 0;
  v_h jsonb;
  v_told integer := 0;
  v_res jsonb;
begin
  update public.autopilot_plans set state = 'lapsed' where state = 'planned' and plan_on < public.today_lagos();
  get diagnostics v_lapsed = row_count;
  if v_state = 'off' then
    return jsonb_build_object('ran', false, 'lapsed', v_lapsed);
  end if;
  select * into a from public.autopilot_settings x where x.id;
  if a.paused or coalesce((select p.paused from public.seat_window_settings p where p.id), true) then
    return jsonb_build_object('ran', false, 'why', 'paused', 'lapsed', v_lapsed);
  end if;
  v_season := public.autopilot_season(a.extra_days);
  if v_season is null then
    return jsonb_build_object('ran', false, 'why', 'closed', 'lapsed', v_lapsed);
  end if;
  if exists (select 1 from public.autopilot_plans p where p.season_id = v_season and p.plan_on = public.today_lagos()) then
    return jsonb_build_object('ran', true, 'plan', false, 'lapsed', v_lapsed);
  end if;
  if v_hour < 8 or v_hour >= 19 or (v_state = 'on' and a.mode = 'auto' and v_hour < 9) then
    return jsonb_build_object('ran', false, 'why', 'hour', 'lapsed', v_lapsed);
  end if;
  if v_state = 'on' then
    v_h := public.seat_health_core();
    if not (v_h ->> 'ok')::boolean then
      return jsonb_build_object('ran', false, 'why', 'health', 'lapsed', v_lapsed);
    end if;
  end if;
  v_plan := public.autopilot_plan_build(v_season, a.mode);
  if v_plan is null then
    return jsonb_build_object('ran', true, 'plan', false, 'lapsed', v_lapsed);
  end if;
  select p.n_items, p.state into v_n, v_pstate from public.autopilot_plans p where p.id = v_plan;
  if v_pstate = 'planned' then
    if a.mode = 'auto' then
      v_res := public.autopilot_apply_core(v_plan, null);
    else
      select coalesce(sum(public.notify_role(x.id, array['admin', 'director'], 'admin_autopilot_ready', 'autopilot:' || v_plan::text,
               jsonb_build_object('n', v_n, 'path', '/admin/seats'), 'Placements ready to approve', '/admin/seats', true, null)), 0)::integer
        into v_told from public.centres x where x.active;
    end if;
  end if;
  return jsonb_build_object('ran', true, 'plan', true, 'items', v_n, 'state', v_pstate, 'told', v_told, 'applied', v_res, 'lapsed', v_lapsed);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office: what the Seats page shows, the one tap, and stopping it
-- ---------------------------------------------------------------------------
create function public.autopilot_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.seat_need(false);
  a public.autopilot_settings%rowtype;
  v_season uuid;
  pl public.autopilot_plans%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_win jsonb;
begin
  select * into a from public.autopilot_settings x where x.id;
  v_season := coalesce(public.autopilot_season(a.extra_days), public.placement_season());
  select * into pl from public.autopilot_plans p where p.season_id = v_season order by p.plan_on desc limit 1;
  v_win := public.season_joining_window(v_season);
  if pl.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('person', public.person_display_name(i.person_id), 'tribe', t.name, 'degree', i.degree, 'kind', i.kind,
             'rehearsal', i.rehearsal, 'outcome', i.outcome) order by i.id), '[]'::jsonb)
      into v_items
      from public.autopilot_items i join public.tribes t on t.id = i.tribe_id where i.plan_id = pl.id;
  end if;
  return jsonb_build_object(
    'role', v_role, 'mode', public.autopilot_any(), 'setting', a.mode, 'paused', a.paused, 'bar', a.bar,
    'until', case when v_win is null then null else ((v_win ->> 'closes_on')::date + a.extra_days) end,
    'plan', case when pl.id is null then null
                 else jsonb_build_object('id', pl.id, 'on', pl.plan_on, 'state', pl.state, 'made_at', pl.made_at, 'items', pl.n_items, 'placed', pl.n_placed, 'skipped', pl.n_skipped,
                                         'today', pl.plan_on = public.today_lagos(), 'rows', v_items) end,
    'stats', case when pl.id is null then null else pl.stats end);
end;
$$;

create function public.autopilot_approve(p_plan uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pl public.autopilot_plans%rowtype;
  h jsonb;
  v jsonb;
begin
  perform public.seat_need(true);
  select * into pl from public.autopilot_plans x where x.id = p_plan for update;
  if not found then
    raise exception 'That plan is not available' using errcode = '22023';
  end if;
  if pl.state = 'applied' then
    raise exception 'This plan has already been placed' using errcode = '22023';
  end if;
  if pl.state = 'lapsed' or (pl.state = 'planned' and pl.plan_on < public.today_lagos()) then
    raise exception 'This plan ran out at midnight. A new one is made at 8 am' using errcode = '22023';
  end if;
  if pl.state <> 'planned' then
    raise exception 'There is nothing in this plan to place' using errcode = '22023';
  end if;
  if public.autopilot_any() <> 'on' or (select s.paused from public.autopilot_settings s where s.id) then
    raise exception 'Seat autopilot is not On, or it has been stopped' using errcode = '22023';
  end if;
  h := public.seat_health_core();
  if not (h ->> 'ok')::boolean then
    raise exception 'Cannot place yet: %', (h -> 'problems' ->> 0) using errcode = '22023';
  end if;
  v := public.autopilot_apply_core(p_plan, auth.uid());
  perform public.write_event(auth.uid(), 'autopilot.approved', 'season', pl.season_id::text, jsonb_build_object('plan', p_plan, 'placed', v -> 'placed', 'skipped', v -> 'skipped'));
  return v;
end;
$$;

create function public.autopilot_pause_set(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.seat_need(true);
  if coalesce(p_paused, false) and (v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300) then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if coalesce(p_paused, false) then
    update public.autopilot_settings set paused = true, paused_reason = v_reason, paused_at = now(), paused_by = auth.uid(), updated_at = now() where id;
  else
    update public.autopilot_settings set paused = false, paused_reason = null, paused_at = null, paused_by = null, updated_at = now() where id;
  end if;
  perform public.write_event(auth.uid(), 'autopilot.pause', 'autopilot', 'pause', jsonb_build_object('paused', coalesce(p_paused, false), 'reason', v_reason));
  return jsonb_build_object('ok', true, 'paused', coalesce(p_paused, false));
end;
$$;

create function public.god_autopilot_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.autopilot_settings%rowtype;
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select * into a from public.autopilot_settings x where x.id;
  return jsonb_build_object('mode', a.mode, 'bar', a.bar, 'per_tribe_day', a.per_tribe_day, 'day_cap', a.day_cap, 'extra_days', a.extra_days, 'small_days', a.small_days,
                            'paused', a.paused);
end;
$$;

create function public.god_autopilot_settings_set(p_mode text, p_bar integer, p_per_tribe integer, p_day_cap integer, p_extra integer, p_small integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('suggest', 'auto') then
    raise exception 'Choose Suggest or Auto' using errcode = '22023';
  end if;
  if not (coalesce(p_bar between 60 and 95, false) and coalesce(p_per_tribe between 1 and 4, false) and coalesce(p_day_cap between 5 and 100, false)
          and coalesce(p_extra between 0 and 30, false) and coalesce(p_small between 5 and 30, false)) then
    raise exception 'One of the numbers is outside its range' using errcode = '22023';
  end if;
  update public.autopilot_settings
     set mode = p_mode, bar = p_bar, per_tribe_day = p_per_tribe, day_cap = p_day_cap, extra_days = p_extra, small_days = p_small, updated_at = now()
   where id;
  perform public.write_event(auth.uid(), 'autopilot.settings', 'autopilot', 'settings',
    jsonb_build_object('mode', p_mode, 'bar', p_bar, 'per_tribe', p_per_tribe, 'day_cap', p_day_cap, 'extra', p_extra, 'small', p_small, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office's 7 am email: two more numbers (what autopilot placed yesterday, and a plan nobody approved)
-- ---------------------------------------------------------------------------
create or replace function public.seat_morning_numbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_y date := public.today_lagos() - 1;
  v_taken integer;
  v_yes integer;
  v_rel integer;
  v_left integer;
  v_refill integer;
begin
  select count(*) filter (where l.kind = 'taken' and l.reason is distinct from 'Taken back'), count(*) filter (where l.kind = 'confirmed'),
         count(*) filter (where l.kind = 'released'), count(*) filter (where l.kind = 'left'),
         count(*) filter (where l.kind = 'taken' and l.via = 'seat-window')
    into v_taken, v_yes, v_rel, v_left, v_refill
    from public.seat_ledger l where (l.at at time zone 'Africa/Lagos')::date = v_y;
  return jsonb_build_object(
    'taken', v_taken, 'yes', v_yes, 'released', v_rel, 'left', v_left, 'refilled', v_refill,
    'auto_placed', (select count(*) from public.seat_ledger l where l.kind = 'taken' and l.via = 'autopilot' and (l.at at time zone 'Africa/Lagos')::date = v_y),
    'lapsed', (select coalesce(sum(p.n_items), 0) from public.autopilot_plans p where p.state = 'lapsed' and p.plan_on = v_y),
    'not_reached', (select count(*) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by = 'not_reached'),
    'hard', (select count(*) from public.seat_clocks k where k.state = 'released' and k.hard_to_fill and k.replaced_by is null and not k.rehearsal),
    'stopped', (select count(distinct k.blocked_by) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by in ('email', 'day_cap', 'tribe_quarter')),
    'small', (select count(*) from public.tribes t where t.status = 'approved'
               and (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') between 1 and 4),
    'over', (select count(*) from public.tribes t where (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') > 12),
    'in_series', (select count(*) from public.reach_enrolments x where x.status = 'active' and not x.rehearsal));
end;
$$;

-- The heartbeat's seat-window step: the clocks, the leader's note, the office's email, and now the autopilot's step. A fault in one never stops the others.
create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.worker_ok(p_token);
  v := public.seat_clock_tick();
  -- The leader's note at 5 pm and the office's email at 7 am: each does nothing unless the seat window is On, and each fault is its own
  begin
    v := v || jsonb_build_object('notes', public.seat_notes_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'leader note: ' || sqlerrm);
  end;
  begin
    v := v || jsonb_build_object('morning', public.seat_morning_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'morning email: ' || sqlerrm);
  end;
  begin
    v := v || jsonb_build_object('autopilot', public.autopilot_tick());
  exception when others then
    perform public.notice_fault('seat_autopilot', sqlerrm);
  end;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.autopilot_any(), public.autopilot_gate(), public.autopilot_degree(uuid, uuid, boolean), public.autopilot_season(integer), public.autopilot_bench(uuid, integer), public.autopilot_plan_build(uuid, text),
  public.autopilot_apply_core(uuid, uuid), public.autopilot_tick()
  from public, anon, authenticated;
revoke execute on function
  public.autopilot_overview(), public.autopilot_approve(uuid), public.autopilot_pause_set(boolean, text), public.god_autopilot_settings(),
  public.god_autopilot_settings_set(text, integer, integer, integer, integer, integer, text)
  from public, anon;
grant execute on function
  public.autopilot_overview(), public.autopilot_approve(uuid), public.autopilot_pause_set(boolean, text), public.god_autopilot_settings(),
  public.god_autopilot_settings_set(text, integer, integer, integer, integer, integer, text)
  to authenticated;

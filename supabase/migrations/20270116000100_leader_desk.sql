-- =============================================================================
-- The Leader Desk, in God Mode. Phase 1: see. Nothing here sends anything.
--
-- A page for the owner only. It shows the members who finished the find-your-tribe form this season and still have no seat, with why no tribe has
-- fitted them, a masked phone number (shown in full only on request, in calling hours, and written down without the number), and how well they
-- would suit each draft group. It lets the owner build draft groups: the same Degree of Compatibility the members see, group health checks that
-- are the matching's own tribe rules, and a list of the groups the waiting members could already fill. It scores every member's leadership
-- signal from what the church already knows (willingness to serve, walk of faith, attendance, being named, weekly steps) and never from gender,
-- age, area, health or support needs.
--
-- Phase 1 reads and keeps drafts. It writes to no member, no seat, no tribe, no message and no notice. Emailing a proposed group, recommending a
-- leader, forming a tribe and the settings card come in Phase 2. Every existing function is left exactly as it was.
--
-- Switchboard: 'leader_desk', owner only. Off: the page is closed. Rehearsal and On: the page opens (Phase 1 sends nothing in either).
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.placed_desk_mask(text)') is null or to_regprocedure('public.placement_season()') is null then
    raise exception 'Apply Package 6b (20270114000100_placed_answers.sql) before this file.';
  end if;
end
$guard$;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('leader_desk', 'Leader Desk', 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal from willingness, walk of faith, attendance, being named and weekly steps. Sends nothing yet: emailing a proposed group, recommending a leader and forming a tribe come next.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 32, true);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- A group the owner is putting together. It is not a tribe: it has no leader, no seat and no message, and nobody is told about it.
create table public.desk_groups (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  name text not null check (char_length(btrim(name)) between 3 and 60),
  track_id uuid not null references public.tracks (id),
  community_id uuid references public.communities (id),
  season_goal_id uuid references public.season_goals (id),
  slot text not null check (slot in ('sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning')),
  meeting_mode text not null check (meeting_mode in ('online', 'in_person')),
  zone text check (zone in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad')),
  tribe_type text not null default 'mixed' check (tribe_type in ('mixed', 'women', 'men')),
  capacity smallint not null default 8 check (capacity between 4 and 12),
  note text check (char_length(note) <= 300),
  status text not null default 'draft' check (status in ('draft', 'archived')),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (meeting_mode = 'online' or zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
);
create index desk_groups_season_idx on public.desk_groups (season_id, status);
alter table public.desk_groups enable row level security;
revoke all on table public.desk_groups from public, anon, authenticated;

create table public.desk_group_members (
  group_id uuid not null references public.desk_groups (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  added_by uuid references public.people (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (group_id, person_id)
);
create index desk_group_members_person_idx on public.desk_group_members (person_id);
alter table public.desk_group_members enable row level security;
revoke all on table public.desk_group_members from public, anon, authenticated;

-- A line each time the owner opened a full number. The number itself is never written here.
create table public.desk_reveals (
  id bigint generated always as identity primary key,
  person_id uuid references public.people (id) on delete cascade,
  by_person uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index desk_reveals_by_idx on public.desk_reveals (by_person, created_at);
alter table public.desk_reveals enable row level security;
revoke all on table public.desk_reveals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Is the desk open, and is this the owner
-- ---------------------------------------------------------------------------
create function public.leader_desk_any()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when not exists (select 1 from public.feature_registry f where f.key = 'leader_desk' and f.available) then 'off'
    when exists (select 1 from public.feature_settings s where s.feature = 'leader_desk' and s.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings s where s.feature = 'leader_desk' and s.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
$$;

create function public.desk_need()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  if public.leader_desk_any() = 'off' then
    raise exception 'The Leader Desk is switched off. Turn it on in the Switchboard' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who is on the desk: one rule for every list, so the lists cannot disagree
-- ---------------------------------------------------------------------------
-- Members of this church with a finished form for the season: not under 18, not hidden, not the owner, not already leading or assisting, and not
-- asking to be deleted.
create function public.desk_base(p_season uuid)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select mp.person_id
    from public.member_profiles mp
    join public.people p on p.id = mp.person_id
    join public.age_ranges ar on ar.id = mp.age_range_id
   where (mp.season_id is null or mp.season_id = p_season)
     and p.centre_id = public.my_centre()
     and not p.hidden
     and (ar.max_age is null or ar.max_age >= 18)
     and exists (select 1 from public.person_roles r where r.person_id = mp.person_id and r.role = 'member')
     and not exists (select 1 from public.person_roles r where r.person_id = mp.person_id and r.role in ('leader', 'assistant_leader'))
     and not exists (select 1 from public.platform_owner o where o.person_id = mp.person_id)
     and not exists (select 1 from public.erasure_requests e where e.person_id = mp.person_id and e.status = 'open');
$$;

-- The tribe a member asked for, in the words the matching uses.
create function public.desk_kind(p_mix text, p_gender text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_mix when 'mixed' then 'mixed' when 'no_preference' then 'any'
           else case p_gender when 'female' then 'women' when 'male' then 'men' else 'mixed' end end;
$$;

-- Waiting: on the desk, no active seat this season, and not held back from placement. One row each, with the list they belong to.
--   none_shown: the matching found no tribe to show them. few_shown: it found one or two. not_chosen: it showed three and they have not chosen.
--   not_run: they never ran the matching. starter: they asked for a Starter tribe (it can be in addition to the list above).
create function public.desk_waiting_base(p_season uuid)
returns table (person_id uuid, chip text, starter boolean, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.person_id,
         case when d.person_id is not null and d.shown = 0 then 'none_shown'
              when d.person_id is not null then 'few_shown'
              when exists (select 1 from public.match_runs r where r.person_id = b.person_id) then 'not_chosen'
              else 'not_run' end,
         coalesce(d.wants_starter, false),
         mp.submitted_at
    from public.desk_base(p_season) b
    join public.member_profiles mp on mp.person_id = b.person_id
    left join public.match_demand d on d.person_id = b.person_id
   where not exists (select 1 from public.tribe_members m where m.person_id = b.person_id and m.season_id = p_season and m.status = 'active')
     and not exists (select 1 from public.placement_holds h where h.person_id = b.person_id and (h.until is null or h.until > now()));
$$;

-- ---------------------------------------------------------------------------
-- Why no tribe has fitted them. Null when at least one tribe would be shown to them. Otherwise the first rule, in the order the matching applies
-- them, that leaves no tribe at all.
-- ---------------------------------------------------------------------------
create function public.desk_block_reason(p_person uuid)
returns jsonb
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
  my_est boolean;
  my_heavy boolean;
  v_floor integer := public.placement_floor();
  v_any integer;
  v_ok integer;
  s record;
begin
  select * into me from public.member_profiles x where x.person_id = p_person;
  if not found then
    return null;
  end if;
  select count(*)::integer, count(*) filter (where c.r_degree >= v_floor)::integer into v_any, v_ok from public.match_candidates(p_person) c;
  if v_ok > 0 then
    return null;
  end if;
  if v_any > 0 then
    return jsonb_build_object('code', 'low_score', 'text', 'Tribes are open to them, but none scores ' || v_floor || ' or more');
  end if;
  select ar.track_id, t.sort, (ar.max_age is not null and ar.max_age < 18) into my_track, my_sort, my_minor
    from public.age_ranges ar join public.tracks t on t.id = ar.track_id where ar.id = me.age_range_id;
  my_est := me.faith_journey in ('established', 'leading');
  my_heavy := me.support_load >= 2;

  select count(*)::integer as pool,
         count(*) filter (where x.f_track)::integer as s_track,
         count(*) filter (where x.f_track and x.f_minor)::integer as s_minor,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl)::integer as s_excl,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl and x.f_time)::integer as s_time,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl and x.f_time and x.f_format)::integer as s_format,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl and x.f_time and x.f_format and x.f_area)::integer as s_area,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl and x.f_time and x.f_format and x.f_area and x.f_type)::integer as s_type,
         count(*) filter (where x.f_track and x.f_minor and x.f_excl and x.f_time and x.f_format and x.f_area and x.f_type and x.f_room)::integer as s_room
    into s
    from (
      select
        (c.track_id = my_track
          or (me.open_to_adjacent and not my_minor
              and exists (select 1 from public.tracks ct where ct.id = c.track_id and ct.active and ct.slug <> 'teens' and abs(ct.sort - my_sort) = 1))) as f_track,
        (not my_minor or c.assistant_id is not null) as f_minor,
        (c.leader_id <> p_person
          and (c.assistant_id is null or c.assistant_id <> p_person)
          and not exists (select 1 from public.removal_blocks rb where rb.person_id = p_person and rb.tribe_id = c.id and rb.lifted_at is null)) as f_excl,
        (cardinality(me.meeting_times) = 0 or c.slot = any (me.meeting_times)) as f_time,
        (me.meeting_mode = 'either' or me.meeting_mode::text = c.meeting_mode) as f_format,
        (c.meeting_mode = 'online' or me.zone in ('iganmu-surulere', 'mainland', 'island-lekki')) as f_area,
        (case c.tribe_type
           when 'mixed' then me.tribe_mix <> 'same_gender'
           when 'women' then me.gender = 'female' and me.tribe_mix <> 'mixed'
           when 'men' then me.gender = 'male' and me.tribe_mix <> 'mixed'
           else false end) as f_type,
        -- a seat is free, and seating them keeps the tribe's own balance rules
        (c.capacity - m.n >= 1
          and not (my_heavy and m.heavy_n >= 2)
          and greatest(0, 2 - (m.est_n + case when my_est then 1 else 0 end)) <= c.capacity - m.n - 1
          and ((case when (m.quiet_n + (case when me.style_social = -1 then 1 else 0 end)) = 0 then 1 else 0 end)
             + (case when (m.lively_n + (case when me.style_social = 1 then 1 else 0 end)) = 0 then 1 else 0 end)) <= c.capacity - m.n - 1) as f_room
      from public.tribes c
      cross join lateral (
        select count(cm.id)::integer as n,
               count(*) filter (where mp.style_social = -1)::integer as quiet_n,
               count(*) filter (where mp.style_social = 1)::integer as lively_n,
               count(*) filter (where mp.faith_journey in ('established', 'leading'))::integer as est_n,
               count(*) filter (where mp.support_load >= 2)::integer as heavy_n
          from public.tribe_members cm
          left join public.member_profiles mp on mp.person_id = cm.person_id
         where cm.tribe_id = c.id and cm.status = 'active') m
     where c.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
       and (me.season_id is null or c.season_id = me.season_id)
    ) x;

  if s.pool = 0 then
    return jsonb_build_object('code', 'no_tribes', 'text', 'No tribe is open this season yet');
  elsif s.s_track = 0 then
    return jsonb_build_object('code', 'track', 'text', 'No open tribe is for their life stage');
  elsif s.s_minor = 0 then
    return jsonb_build_object('code', 'minor', 'text', 'Young people are only placed in tribes with two adult leaders, and none has an assistant yet');
  elsif s.s_excl = 0 then
    return jsonb_build_object('code', 'excluded', 'text', 'The tribes that fit are ones they lead, assist, or were taken out of');
  elsif s.s_time = 0 then
    return jsonb_build_object('code', 'time', 'text', 'No tribe meets at a time they can make');
  elsif s.s_format = 0 then
    return jsonb_build_object('code', 'format', 'text', 'No tribe meets the way they can, online or in person');
  elsif s.s_area = 0 then
    return jsonb_build_object('code', 'area', 'text', 'The tribes that fit meet in person, outside the areas they can reach');
  elsif s.s_type = 0 then
    return jsonb_build_object('code', 'type', 'text', 'No tribe is the kind they asked for: mixed, women or men');
  elsif s.s_room = 0 then
    return jsonb_build_object('code', 'room', 'text', 'Every tribe that fits is full, or seating them would break its balance rules');
  end if;
  return jsonb_build_object('code', 'other', 'text', 'No tribe fits them');
end;
$$;

-- ---------------------------------------------------------------------------
-- How well one member suits a draft group. The same weights and the same rules as the matching, read over the group's own members.
-- A draft has no leader yet, so the leader-style part is the neutral half. 'blocked' lists the rules that rule the person out (the matching
-- would never show them this group); 'watch' lists the rules about the group's balance (the matching would not seat them for it).
-- ---------------------------------------------------------------------------
create function public.desk_group_fit(p_person uuid, p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.member_profiles%rowtype;
  g public.desk_groups%rowtype;
  w jsonb;
  my_track uuid;
  my_sort integer;
  my_minor boolean;
  my_family uuid;
  g_family uuid;
  my_est boolean;
  my_heavy boolean;
  n integer;
  soc_sum numeric;
  quiet_n integer;
  lively_n integer;
  est_n integer;
  same_n integer;
  heavy_n integer;
  c_goal numeric;
  c_stage numeric;
  c_community numeric;
  c_place numeric;
  c_rhythm numeric;
  c_social numeric;
  c_roles numeric;
  c_balance numeric;
  c_aff numeric;
  c_faith numeric;
  v_block jsonb := '[]'::jsonb;
  v_watch jsonb := '[]'::jsonb;
  v_degree integer;
begin
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  select * into me from public.member_profiles x where x.person_id = p_person;
  if not found then
    return null;
  end if;
  select ar.track_id, t.sort, (ar.max_age is not null and ar.max_age < 18) into my_track, my_sort, my_minor
    from public.age_ranges ar join public.tracks t on t.id = ar.track_id where ar.id = me.age_range_id;
  select sg.family_id into my_family from public.season_goals sg where sg.id = me.season_goal_id;
  select sg.family_id into g_family from public.season_goals sg where sg.id = g.season_goal_id;
  select mm.weights into w from public.match_models mm where mm.active;
  my_est := me.faith_journey in ('established', 'leading');
  my_heavy := me.support_load >= 2;

  -- The group as it stands without this person
  select count(*)::integer,
         coalesce(sum(mp.style_social), 0)::numeric,
         count(*) filter (where mp.style_social = -1)::integer,
         count(*) filter (where mp.style_social = 1)::integer,
         count(*) filter (where mp.faith_journey in ('established', 'leading'))::integer,
         count(*) filter (where mp.faith_journey = me.faith_journey)::integer,
         count(*) filter (where mp.support_load >= 2)::integer
    into n, soc_sum, quiet_n, lively_n, est_n, same_n, heavy_n
    from public.desk_group_members gm
    join public.member_profiles mp on mp.person_id = gm.person_id
   where gm.group_id = p_group and gm.person_id <> p_person;

  -- Rules that rule the person out
  if me.season_id is not null and me.season_id <> g.season_id then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'season', 'text', 'They finished the form for another season'));
  end if;
  if my_minor then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'under18', 'text', 'They are under 18. Groups for young people are never built here'));
  end if;
  if not (g.track_id = my_track
          or (me.open_to_adjacent and not my_minor
              and exists (select 1 from public.tracks ct where ct.id = g.track_id and ct.active and ct.slug <> 'teens' and abs(ct.sort - my_sort) = 1))) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'track', 'text', 'The group is not for their life stage'));
  end if;
  if cardinality(me.meeting_times) > 0 and not g.slot = any (me.meeting_times) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'time', 'text', 'They cannot make the group''s time'));
  end if;
  if me.meeting_mode <> 'either' and me.meeting_mode::text <> g.meeting_mode then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'format', 'text', 'They cannot meet the way the group does'));
  end if;
  if g.meeting_mode = 'in_person' and me.zone not in ('iganmu-surulere', 'mainland', 'island-lekki') then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'area', 'text', 'The group meets in person, outside the areas they can reach'));
  end if;
  if not (case g.tribe_type
            when 'mixed' then me.tribe_mix <> 'same_gender'
            when 'women' then me.gender = 'female' and me.tribe_mix <> 'mixed'
            when 'men' then me.gender = 'male' and me.tribe_mix <> 'mixed'
            else false end) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'type', 'text', 'The group is not the kind they asked for'));
  end if;

  -- Rules about the group's balance
  if g.capacity - n < 1 then
    v_watch := v_watch || jsonb_build_array(jsonb_build_object('code', 'full', 'text', 'The group is full'));
  end if;
  if my_heavy and heavy_n >= 2 then
    v_watch := v_watch || jsonb_build_array(jsonb_build_object('code', 'heavy', 'text', 'The group already has two members who need heavy support'));
  end if;
  if greatest(0, 2 - (est_n + case when my_est then 1 else 0 end)) > g.capacity - n - 1 then
    v_watch := v_watch || jsonb_build_array(jsonb_build_object('code', 'established', 'text', 'The group could not reach two established believers with the seats left'));
  end if;
  if ((case when (quiet_n + (case when me.style_social = -1 then 1 else 0 end)) = 0 then 1 else 0 end)
    + (case when (lively_n + (case when me.style_social = 1 then 1 else 0 end)) = 0 then 1 else 0 end)) > g.capacity - n - 1 then
    v_watch := v_watch || jsonb_build_array(jsonb_build_object('code', 'balance', 'text', 'The group could not hold both quiet and lively members with the seats left'));
  end if;

  -- The score
  c_goal := case when g.season_goal_id = me.season_goal_id then 1.0
                 when me.season_goal_id is not null and g_family = my_family then 0.6
                 else 0.2 end;
  c_stage := case when g.track_id = my_track then 1.0 else 0.5 end;
  c_community := case when me.community_id is not null and g.community_id = me.community_id then 1.0
                      when me.second_community_id is not null and g.community_id = me.second_community_id then 0.7
                      when my_family is not null and g_family = my_family then 0.3
                      else 0.1 end;
  c_place := case when g.meeting_mode = 'online' then 1.0
                  when g.zone = me.zone then 1.0
                  when (g.zone, me.zone) in (('iganmu-surulere', 'mainland'), ('mainland', 'iganmu-surulere'),
                                             ('mainland', 'island-lekki'), ('island-lekki', 'mainland'),
                                             ('iganmu-surulere', 'island-lekki'), ('island-lekki', 'iganmu-surulere')) then 0.6
                  else 0.2 end;
  c_rhythm := 0.5 * (case when me.meeting_mode::text = g.meeting_mode then 1.0 else 0.8 end)
            + 0.5 * (case when cardinality(me.meeting_times) = 0 then 0.7 else 1.0 end);
  c_social := case when n = 0 or me.style_social = 0 then 0.6
                   else greatest(0.0, least(1.0, 0.5 + 0.5 * (abs(soc_sum / n) - abs((soc_sum + me.style_social) / (n + 1))))) end;
  c_roles := case when cardinality(me.group_roles) = 0 then null
                  else (select avg(case when (select count(*)
                                                from public.desk_group_members gm2
                                                join public.member_profiles mp2 on mp2.person_id = gm2.person_id
                                               where gm2.group_id = p_group and gm2.person_id <> p_person and r = any (mp2.group_roles)) < 2
                                        then 1.0 else 0.4 end)
                          from unnest(me.group_roles) as r) end;
  c_balance := case when c_roles is null then c_social else 0.75 * c_social + 0.25 * c_roles end;
  c_aff := public.lead_affinity(null, me.style_social, me.style_structure, me.style_openness, me.style_disclosure, me.style_learning);
  c_faith := case when n = 0 then 0.8
                  when same_n::numeric / n <= 0.34 then 1.0
                  else 0.6 end;
  v_degree := round(
      (w ->> 'goal')::numeric * c_goal + (w ->> 'stage')::numeric * c_stage
    + (w ->> 'community')::numeric * c_community + (w ->> 'place')::numeric * c_place
    + (w ->> 'style')::numeric * (0.5 * c_balance + 0.5 * c_aff)
    + (w ->> 'rhythm')::numeric * c_rhythm + (w ->> 'faith')::numeric * c_faith)::integer;

  return jsonb_build_object('degree', v_degree, 'blocked', v_block, 'watch', v_watch);
end;
$$;

-- ---------------------------------------------------------------------------
-- Leadership signal. One number from what the church already knows, one source for each part. It never reads gender, age, area, health, care
-- notes or how much support someone has needed.
--   Willingness 30: said yes to serving 1, maybe 0.5, not now 0, never answered 0.25
--   Walk of faith 25: leading or established 1, growing 0.6, new 0.3, exploring 0.1
--   Reliability 20: weeks present of weeks marked present or absent (excused weeks do not count), once there are three; before that, neutral
--   Named 15: named by one person 0.6, by two or more 1 (declined and withdrawn names do not count)
--   Progress 10: weekly steps done or partly done of the steps answered, once there are three; before that, neutral
-- ---------------------------------------------------------------------------
create function public.desk_lead_base(p_season uuid)
returns table (person_id uuid, serving text, faith text, willingness numeric, walk numeric, reliability numeric, named numeric, progress numeric,
               weeks_seen integer, weeks_present integer, steps_seen integer, steps_done integer, named_n integer, score integer, pool text)
language sql
stable
security definer
set search_path = ''
as $$
  with att as (
    select a.person_id, count(*) filter (where a.status in ('present', 'absent'))::integer as seen, count(*) filter (where a.status = 'present')::integer as present
      from public.tribe_attendance a group by a.person_id),
  stp as (
    select s.person_id, count(*) filter (where s.outcome is not null)::integer as seen, count(*) filter (where s.outcome in ('done', 'partly'))::integer as done
      from public.week_steps s group by s.person_id),
  nom as (
    select r.nominee_id as person_id, count(*)::integer as n
      from public.assistant_recommendations r
     where r.nominee_id is not null and r.status not in ('withdrawn', 'declined') group by r.nominee_id),
  parts as (
    select b.person_id,
           mp.open_to_serving::text as serving,
           mp.faith_journey::text as faith,
           case mp.open_to_serving::text when 'yes' then 1.0 when 'maybe' then 0.5 when 'not_now' then 0.0 else 0.25 end as willingness,
           case mp.faith_journey::text when 'leading' then 1.0 when 'established' then 1.0 when 'growing' then 0.6 when 'new' then 0.3 else 0.1 end as walk,
           case when coalesce(att.seen, 0) >= 3 then att.present::numeric / att.seen else 0.5 end as reliability,
           case coalesce(nom.n, 0) when 0 then 0.0 when 1 then 0.6 else 1.0 end as named,
           case when coalesce(stp.seen, 0) >= 3 then stp.done::numeric / stp.seen else 0.5 end as progress,
           coalesce(att.seen, 0) as weeks_seen, coalesce(att.present, 0) as weeks_present,
           coalesce(stp.seen, 0) as steps_seen, coalesce(stp.done, 0) as steps_done, coalesce(nom.n, 0) as named_n
      from public.desk_base(p_season) b
      join public.member_profiles mp on mp.person_id = b.person_id
      left join att on att.person_id = b.person_id
      left join stp on stp.person_id = b.person_id
      left join nom on nom.person_id = b.person_id),
  scored as (
    select p.*, round(30 * p.willingness + 25 * p.walk + 20 * p.reliability + 15 * p.named + 10 * p.progress)::integer as score from parts p)
  select s.person_id, s.serving, s.faith, s.willingness, s.walk, s.reliability, s.named, s.progress,
         s.weeks_seen, s.weeks_present, s.steps_seen, s.steps_done, s.named_n, s.score,
         case when s.serving in ('yes', 'maybe') and s.faith in ('established', 'leading') and s.score >= 70 then 'ready'
              when s.serving in ('yes', 'maybe') and s.score >= 50 then 'almost'
              else 'members' end
    from scored s;
$$;

-- The same signal in words, for one row
create function public.desk_lead_notes(p_serving text, p_faith text, p_weeks_seen integer, p_weeks_present integer, p_steps_seen integer, p_steps_done integer, p_named integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    case p_serving when 'yes' then 'Said yes to serving' when 'maybe' then 'Said maybe to serving' when 'not_now' then 'Said not now to serving' else 'Has not said whether they would serve' end,
    case p_faith when 'leading' then 'Already leads others in faith' when 'established' then 'Established in faith' when 'growing' then 'Growing in faith' when 'new' then 'New to faith' else 'Exploring faith' end,
    case when p_weeks_seen >= 3 then 'Present in ' || p_weeks_present || ' of ' || p_weeks_seen || ' weeks' else 'Too few weeks to judge attendance' end,
    case when p_named >= 2 then 'Named by ' || p_named || ' people' when p_named = 1 then 'Named by one person' else 'Not named yet' end,
    case when p_steps_seen >= 3 then 'Finished ' || p_steps_done || ' of ' || p_steps_seen || ' weekly steps' else 'Too few weekly steps to judge' end);
$$;

-- ---------------------------------------------------------------------------
-- Pages
-- ---------------------------------------------------------------------------
-- The numbers at the top of the desk
create function public.desk_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  s public.seasons%rowtype;
  v_waiting jsonb;
  v_lead jsonb;
begin
  perform public.desk_need();
  select * into s from public.seasons x where x.id = v_season;
  if not found then
    return jsonb_build_object('mode', public.leader_desk_any(), 'season', null);
  end if;
  select jsonb_build_object('all', count(*), 'none_shown', count(*) filter (where chip = 'none_shown'), 'few_shown', count(*) filter (where chip = 'few_shown'),
                            'not_chosen', count(*) filter (where chip = 'not_chosen'), 'not_run', count(*) filter (where chip = 'not_run'),
                            'starter', count(*) filter (where starter))
    into v_waiting from public.desk_waiting_base(v_season);
  select jsonb_build_object('ready', count(*) filter (where pool = 'ready'), 'almost', count(*) filter (where pool = 'almost'),
                            'members', count(*) filter (where pool = 'members'))
    into v_lead from public.desk_lead_base(v_season);
  return jsonb_build_object(
    'mode', public.leader_desk_any(),
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'weeks', s.weeks, 'week', public.placement_week(s.id)),
    'waiting', v_waiting,
    'leaders', v_lead,
    'drafts', (select count(*) from public.desk_groups g where g.season_id = v_season and g.status = 'draft'),
    'held_back', (select count(*) from public.desk_base(v_season) b
                   where exists (select 1 from public.placement_holds h where h.person_id = b.person_id and (h.until is null or h.until > now()))),
    'min_tribe', coalesce((select ps.min_tribe from public.placement_settings ps limit 1), 5),
    'floor', public.placement_floor(),
    'calls_open', public.placed_calls_ok());
end;
$$;

-- Members who finished the form and still have no seat. A list can be asked for: none_shown, few_shown, not_chosen, not_run or starter.
create function public.desk_waiting(p_chip text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_floor integer := public.placement_floor();
  v_chip text := nullif(btrim(coalesce(p_chip, '')), '');
  v_total integer;
  v_rows jsonb;
begin
  perform public.desk_need();
  if v_chip is not null and v_chip not in ('none_shown', 'few_shown', 'not_chosen', 'not_run', 'starter') then
    raise exception 'That is not a list on the desk' using errcode = '22023';
  end if;
  if v_season is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  end if;
  select count(*)::integer into v_total from public.desk_waiting_base(v_season) w
   where v_chip is null or w.chip = v_chip or (v_chip = 'starter' and w.starter);

  with lead as materialized (select * from public.desk_lead_base(v_season))
  select coalesce(jsonb_agg(x.j order by x.since, x.person_id), '[]'::jsonb) into v_rows
    from (
      select w.since, w.person_id,
             jsonb_build_object(
               'person_id', w.person_id,
               'name', public.person_display_name(w.person_id),
               'chip', w.chip,
               'starter', w.starter,
               'days', greatest(0, public.today_lagos() - (w.since at time zone 'Africa/Lagos')::date),
               'community', (select c.name from public.communities c where c.id = mp.community_id),
               'goal', (select sg.title from public.season_goals sg where sg.id = mp.season_goal_id),
               'zone', mp.zone,
               'mode', mp.meeting_mode,
               'times', to_jsonb(mp.meeting_times),
               'kind', public.desk_kind(mp.tribe_mix::text, mp.gender::text),
               'phone', public.placed_desk_mask(public.placed_held_number(w.person_id)),
               'has_number', public.placed_held_number(w.person_id) is not null,
               'options', mc.ok,
               'best', mc.best,
               'best_tribe', mc.best_name,
               'block', case when mc.ok = 0 then public.desk_block_reason(w.person_id) end,
               'drafts', coalesce((select jsonb_agg(jsonb_build_object('group_id', dg.id, 'name', dg.name, 'degree', (f.v ->> 'degree')::integer,
                                                                        'fits', jsonb_array_length(f.v -> 'blocked') = 0)
                                                    order by (f.v ->> 'degree')::integer desc, dg.name)
                                     from public.desk_groups dg
                                    cross join lateral (select public.desk_group_fit(w.person_id, dg.id) as v) f
                                    where dg.season_id = v_season and dg.status = 'draft' and f.v is not null), '[]'::jsonb),
               'in_draft', (select dg.name from public.desk_group_members gm join public.desk_groups dg on dg.id = gm.group_id
                             where gm.person_id = w.person_id and dg.status = 'draft' order by gm.added_at limit 1),
               'lead', (select jsonb_build_object('score', l.score, 'pool', l.pool) from lead l where l.person_id = w.person_id)
             ) as j
        from public.desk_waiting_base(v_season) w
        join public.member_profiles mp on mp.person_id = w.person_id
        left join lateral (
          select count(*) filter (where c.r_degree >= v_floor)::integer as ok, max(c.r_degree) as best,
                 (select t.name from public.tribes t
                   where t.id = (array_agg(c.r_tribe order by c.r_degree desc, c.r_seats desc, c.r_tribe))[1]) as best_name
            from public.match_candidates(w.person_id) c) mc on true
       where v_chip is null or w.chip = v_chip or (v_chip = 'starter' and w.starter)
       order by w.since, w.person_id
       limit v_limit offset v_offset
    ) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- Members by leadership signal. Pools: ready (said yes or maybe, established or leading in faith, a signal of 70 or more), almost (said yes or maybe,
-- 50 or more), members (everyone else). No date is promised for anyone: the pool is the whole answer.
create function public.desk_leaders(p_pool text default 'ready', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_pool text := coalesce(nullif(btrim(coalesce(p_pool, '')), ''), 'ready');
  v_total integer;
  v_rows jsonb;
begin
  perform public.desk_need();
  if v_pool not in ('ready', 'almost', 'members') then
    raise exception 'That is not a pool on the desk' using errcode = '22023';
  end if;
  if v_season is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb);
  end if;
  with lead as materialized (select * from public.desk_lead_base(v_season))
  select (select count(*)::integer from lead l where l.pool = v_pool),
         coalesce((select jsonb_agg(y.j order by y.score desc, y.person_id)
                     from (
                       select l.score, l.person_id,
                              jsonb_build_object(
                                'person_id', l.person_id,
                                'name', public.person_display_name(l.person_id),
                                'score', l.score,
                                'pool', l.pool,
                                'serving', l.serving,
                                'faith', l.faith,
                                'parts', jsonb_build_object('willingness', round(l.willingness * 30), 'walk', round(l.walk * 25), 'reliability', round(l.reliability * 20),
                                                            'named', round(l.named * 15), 'progress', round(l.progress * 10)),
                                'notes', public.desk_lead_notes(l.serving, l.faith, l.weeks_seen, l.weeks_present, l.steps_seen, l.steps_done, l.named_n),
                                'tribe', (select t.name from public.tribe_members m join public.tribes t on t.id = m.tribe_id
                                           where m.person_id = l.person_id and m.season_id = v_season and m.status = 'active' limit 1),
                                'community', (select c.name from public.member_profiles mp join public.communities c on c.id = mp.community_id where mp.person_id = l.person_id),
                                'phone', public.placed_desk_mask(public.placed_held_number(l.person_id)),
                                'has_number', public.placed_held_number(l.person_id) is not null
                              ) as j
                         from lead l
                        where l.pool = v_pool
                        order by l.score desc, l.person_id
                        limit v_limit offset v_offset) y), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- The leadership signal for one member, with every part
create function public.desk_lead_signal(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  l record;
begin
  perform public.desk_need();
  select * into l from public.desk_lead_base(v_season) x where x.person_id = p_person;
  if not found then
    return null;
  end if;
  return jsonb_build_object('person_id', l.person_id, 'score', l.score, 'pool', l.pool,
    'parts', jsonb_build_object('willingness', round(l.willingness * 30), 'walk', round(l.walk * 25), 'reliability', round(l.reliability * 20),
                                'named', round(l.named * 15), 'progress', round(l.progress * 10)),
    'notes', public.desk_lead_notes(l.serving, l.faith, l.weeks_seen, l.weeks_present, l.steps_seen, l.steps_done, l.named_n));
end;
$$;

-- ---------------------------------------------------------------------------
-- A full phone number, one at a time. Calling hours only (8 am to 8 pm, Lagos), at most 60 an hour, and each opening is written down without the number.
-- ---------------------------------------------------------------------------
create function public.desk_phone_reveal(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_number text;
begin
  perform public.desk_need();
  if not exists (select 1 from public.desk_base(v_season) b where b.person_id = p_person) then
    raise exception 'That member is not on the desk' using errcode = 'P0002';
  end if;
  if not public.placed_calls_ok() then
    raise exception 'Calls are made between 8 am and 8 pm, Lagos time' using errcode = '22023';
  end if;
  if (select count(*) from public.desk_reveals r where r.by_person = auth.uid() and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That is a lot of numbers in an hour. Please wait a little' using errcode = '22023';
  end if;
  v_number := public.placed_held_number(p_person);
  if v_number is null then
    return jsonb_build_object('ok', true, 'number', null);
  end if;
  insert into public.desk_reveals (person_id, by_person) values (p_person, auth.uid());
  perform public.write_event(auth.uid(), 'leader_desk.reveal', 'person', p_person::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'number', v_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Draft groups
-- ---------------------------------------------------------------------------
-- One draft with its members, their scores and the checks. The checks are the matching's own tribe rules over the group's members.
create function public.desk_group_view(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  v_min integer := coalesce((select ps.min_tribe from public.placement_settings ps limit 1), 5);
  v_floor integer := public.placement_floor();
  v_size integer;
  v_avg numeric;
  v_est integer;
  v_quiet integer;
  v_lively integer;
  v_heavy integer;
  v_unfit integer;
  v_nonum integer;
  v_members jsonb;
  v_checks jsonb;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  with m as (
    select gm.person_id, gm.added_at, mp.faith_journey::text as faith, mp.style_social, mp.support_load,
           public.desk_group_fit(gm.person_id, p_group) as fit,
           public.placed_held_number(gm.person_id) as num
      from public.desk_group_members gm
      join public.member_profiles mp on mp.person_id = gm.person_id
     where gm.group_id = p_group)
  select count(*)::integer,
         avg((m.fit ->> 'degree')::numeric),
         count(*) filter (where m.faith in ('established', 'leading'))::integer,
         count(*) filter (where m.style_social = -1)::integer,
         count(*) filter (where m.style_social = 1)::integer,
         count(*) filter (where m.support_load >= 2)::integer,
         count(*) filter (where jsonb_array_length(m.fit -> 'blocked') > 0)::integer,
         count(*) filter (where m.num is null)::integer,
         coalesce(jsonb_agg(jsonb_build_object('person_id', m.person_id, 'name', public.person_display_name(m.person_id), 'degree', (m.fit ->> 'degree')::integer,
                                               'blocked', m.fit -> 'blocked', 'phone', public.placed_desk_mask(m.num), 'has_number', m.num is not null)
                            order by m.added_at, m.person_id), '[]'::jsonb)
    into v_size, v_avg, v_est, v_quiet, v_lively, v_heavy, v_unfit, v_nonum, v_members
    from m;

  v_checks := jsonb_build_array(
    jsonb_build_object('code', 'size',
      'state', case when v_size >= v_min then 'ok' else 'wait' end,
      'text', case when v_size >= v_min then v_size || ' people, room for ' || g.capacity
                   else v_size || ' of at least ' || v_min || ' people so far' end),
    jsonb_build_object('code', 'fit',
      'state', case when v_size = 0 then 'wait' when v_unfit = 0 then 'ok' else 'fix' end,
      'text', case when v_size = 0 then 'Nobody added yet'
                   when v_unfit = 0 then 'Everyone can make the time, the format and the area'
                   else v_unfit || ' can''t make the time, the format or the area, or are not the kind this group is for' end),
    jsonb_build_object('code', 'score',
      'state', case when v_size = 0 then 'wait' when v_avg >= v_floor then 'ok' else 'fix' end,
      'text', case when v_size = 0 then 'No score yet'
                   when v_avg >= v_floor then 'Average score ' || round(v_avg) || ', above the ' || v_floor || ' bar'
                   else 'Average score ' || round(v_avg) || ', below the ' || v_floor || ' bar' end),
    jsonb_build_object('code', 'heavy',
      'state', case when v_heavy <= 2 then 'ok' else 'fix' end,
      'text', case when v_heavy <= 2 then 'No more than two members who need heavy support'
                   else v_heavy || ' members need heavy support, and a tribe can hold two' end),
    jsonb_build_object('code', 'established',
      'state', case when v_size < v_min then 'wait' when v_est >= 2 then 'ok' else 'fix' end,
      'text', case when v_size < v_min then 'Checked once the group has ' || v_min || ' people'
                   when v_est >= 2 then v_est || ' established believers'
                   else 'Needs at least two established believers, has ' || v_est end),
    jsonb_build_object('code', 'balance',
      'state', case when v_size < v_min then 'wait' when v_quiet >= 1 and v_lively >= 1 then 'ok' else 'fix' end,
      'text', case when v_size < v_min then 'Checked once the group has ' || v_min || ' people'
                   when v_quiet >= 1 and v_lively >= 1 then 'Both quiet and lively voices'
                   else 'Needs both a quiet and a lively voice' end),
    jsonb_build_object('code', 'numbers',
      'state', case when v_size = 0 then 'wait' when v_nonum = 0 then 'ok' else 'wait' end,
      'text', case when v_size = 0 then 'No numbers yet'
                   when v_nonum = 0 then 'Everyone has a phone number on file'
                   else v_nonum || ' have no phone number on file. They can still be emailed' end));

  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'status', g.status, 'note', g.note,
    'track_id', g.track_id, 'track', (select t.name from public.tracks t where t.id = g.track_id),
    'community_id', g.community_id, 'community', (select c.name from public.communities c where c.id = g.community_id),
    'goal_id', g.season_goal_id, 'goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
    'slot', g.slot, 'mode', g.meeting_mode, 'zone', g.zone, 'type', g.tribe_type, 'capacity', g.capacity,
    'size', v_size, 'average', round(v_avg), 'members', v_members, 'checks', v_checks,
    'ready', not exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'state' <> 'ok' and c ->> 'code' <> 'numbers'),
    'created_at', g.created_at);
end;
$$;

create function public.desk_groups_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
begin
  perform public.desk_need();
  return coalesce((select jsonb_agg(public.desk_group_view(g.id) order by g.created_at desc, g.id)
                     from public.desk_groups g where g.season_id = v_season and g.status = 'draft'), '[]'::jsonb);
end;
$$;

-- Make a draft group, or change one that is still a draft
create function public.desk_group_save(p_id uuid, p_name text, p_track uuid, p_community uuid, p_goal uuid, p_slot text, p_mode text, p_zone text,
                                       p_type text, p_capacity integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_zone text := nullif(btrim(coalesce(p_zone, '')), '');
  v_season uuid := public.placement_season();
  g public.desk_groups%rowtype;
  v_id uuid := p_id;
begin
  perform public.desk_need();
  if char_length(v_name) < 3 or char_length(v_name) > 60 then
    raise exception 'Give the group a name of 3 to 60 characters' using errcode = '22023';
  end if;
  if p_track is null or not exists (select 1 from public.tracks t where t.id = p_track and t.active) then
    raise exception 'Choose the life stage the group is for' using errcode = '22023';
  end if;
  if p_community is not null and not exists (select 1 from public.communities c where c.id = p_community) then
    raise exception 'That community does not exist' using errcode = '22023';
  end if;
  if p_goal is not null and not exists (select 1 from public.season_goals sg where sg.id = p_goal) then
    raise exception 'That goal does not exist' using errcode = '22023';
  end if;
  if p_slot is null or p_slot not in ('sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning') then
    raise exception 'Choose when the group meets' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('online', 'in_person') then
    raise exception 'Choose whether the group meets online or in person' using errcode = '22023';
  end if;
  if p_mode = 'in_person' and (v_zone is null or v_zone not in ('iganmu-surulere', 'mainland', 'island-lekki')) then
    raise exception 'A group that meets in person needs an area in Lagos' using errcode = '22023';
  end if;
  if p_mode = 'online' then
    v_zone := null;
  end if;
  if p_type is null or p_type not in ('mixed', 'women', 'men') then
    raise exception 'Choose whether the group is mixed, women or men' using errcode = '22023';
  end if;
  if p_capacity is null or p_capacity < 4 or p_capacity > 12 then
    raise exception 'A group holds 4 to 12 people' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'The note can be up to 300 characters' using errcode = '22023';
  end if;

  if v_id is null then
    if v_season is null then
      raise exception 'There is no season open for placement' using errcode = '22023';
    end if;
    if (select count(*) from public.desk_groups x where x.season_id = v_season and x.status = 'draft') >= 40 then
      raise exception 'There are 40 draft groups already. Archive one first' using errcode = '22023';
    end if;
    insert into public.desk_groups (season_id, name, track_id, community_id, season_goal_id, slot, meeting_mode, zone, tribe_type, capacity, note, created_by)
    values (v_season, v_name, p_track, p_community, p_goal, p_slot, p_mode, v_zone, p_type, p_capacity, v_note, auth.uid())
    returning id into v_id;
    perform public.write_event(auth.uid(), 'leader_desk.group_made', 'desk_group', v_id::text, jsonb_build_object('name', v_name));
  else
    select * into g from public.desk_groups x where x.id = v_id for update;
    if not found then
      raise exception 'No such group' using errcode = 'P0002';
    end if;
    if g.status <> 'draft' then
      raise exception 'That group has been archived' using errcode = '22023';
    end if;
    if p_capacity < (select count(*) from public.desk_group_members gm where gm.group_id = v_id) then
      raise exception 'The group already has more people than that' using errcode = '22023';
    end if;
    update public.desk_groups
       set name = v_name, track_id = p_track, community_id = p_community, season_goal_id = p_goal, slot = p_slot, meeting_mode = p_mode, zone = v_zone,
           tribe_type = p_type, capacity = p_capacity, note = v_note, updated_at = now()
     where id = v_id;
    perform public.write_event(auth.uid(), 'leader_desk.group_changed', 'desk_group', v_id::text, jsonb_build_object('name', v_name));
  end if;
  return public.desk_group_view(v_id);
end;
$$;

create function public.desk_group_archive(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group for update;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if g.status = 'draft' then
    update public.desk_groups set status = 'archived', updated_at = now() where id = p_group;
    perform public.write_event(auth.uid(), 'leader_desk.group_archived', 'desk_group', p_group::text, jsonb_build_object('name', g.name));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.desk_group_member_add(p_group uuid, p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  v_fit jsonb;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group for update;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if g.status <> 'draft' then
    raise exception 'That group has been archived' using errcode = '22023';
  end if;
  if not exists (select 1 from public.desk_waiting_base(g.season_id) w where w.person_id = p_person) then
    raise exception 'Only members who are still waiting for a tribe can be added' using errcode = '22023';
  end if;
  if exists (select 1 from public.desk_group_members gm join public.desk_groups dg on dg.id = gm.group_id
              where gm.person_id = p_person and dg.status = 'draft' and gm.group_id <> p_group) then
    raise exception 'They are in another draft group. Take them out of it first' using errcode = '22023';
  end if;
  if exists (select 1 from public.desk_group_members gm where gm.group_id = p_group and gm.person_id = p_person) then
    return public.desk_group_view(p_group);
  end if;
  if (select count(*) from public.desk_group_members gm where gm.group_id = p_group) >= g.capacity then
    raise exception 'The group is full' using errcode = '22023';
  end if;
  v_fit := public.desk_group_fit(p_person, p_group);
  if v_fit is not null and jsonb_array_length(v_fit -> 'blocked') > 0 then
    raise exception '%', (v_fit -> 'blocked' -> 0 ->> 'text') using errcode = '22023';
  end if;
  insert into public.desk_group_members (group_id, person_id, added_by) values (p_group, p_person, auth.uid());
  perform public.write_event(auth.uid(), 'leader_desk.member_added', 'desk_group', p_group::text, jsonb_build_object('person', p_person));
  return public.desk_group_view(p_group);
end;
$$;

create function public.desk_group_member_remove(p_group uuid, p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.desk_need();
  if not exists (select 1 from public.desk_groups x where x.id = p_group) then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.desk_groups x where x.id = p_group and x.status = 'archived') then
    raise exception 'That group has been archived' using errcode = '22023';
  end if;
  delete from public.desk_group_members where group_id = p_group and person_id = p_person;
  if found then
    perform public.write_event(auth.uid(), 'leader_desk.member_removed', 'desk_group', p_group::text, jsonb_build_object('person', p_person));
  end if;
  return public.desk_group_view(p_group);
end;
$$;

-- The waiting members who would suit this group best, best first. Only people the group's own rules allow.
create function public.desk_group_suggest(p_group uuid, p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 40);
  v_rows jsonb;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(x.j order by x.deg desc, x.since, x.person_id), '[]'::jsonb) into v_rows
    from (
      select w.since, w.person_id, (f.v ->> 'degree')::integer as deg,
             jsonb_build_object('person_id', w.person_id, 'name', public.person_display_name(w.person_id), 'degree', (f.v ->> 'degree')::integer,
                                'watch', f.v -> 'watch',
                                'days', greatest(0, public.today_lagos() - (w.since at time zone 'Africa/Lagos')::date),
                                'phone', public.placed_desk_mask(public.placed_held_number(w.person_id)),
                                'has_number', public.placed_held_number(w.person_id) is not null) as j
        from public.desk_waiting_base(g.season_id) w
        join public.member_profiles mp on mp.person_id = w.person_id
        join public.age_ranges ar on ar.id = mp.age_range_id
       cross join lateral (select public.desk_group_fit(w.person_id, p_group) as v) f
       where (ar.track_id = g.track_id or mp.open_to_adjacent)
         and f.v is not null and jsonb_array_length(f.v -> 'blocked') = 0
         and not exists (select 1 from public.desk_group_members gm where gm.group_id = p_group and gm.person_id = w.person_id)
         and not exists (select 1 from public.desk_group_members gm join public.desk_groups dg on dg.id = gm.group_id
                          where gm.person_id = w.person_id and dg.status = 'draft')
       order by (f.v ->> 'degree')::integer desc, w.since
       limit v_limit) x;
  return v_rows;
end;
$$;

-- The groups the waiting members could already fill: people who could make the same time, in the same way, in the same kind of group, at the
-- same life stage, in at least as many as the smallest tribe a placement run will fill. Members already in a draft are left out.
create function public.desk_clusters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_min integer := coalesce((select ps.min_tribe from public.placement_settings ps limit 1), 5);
begin
  perform public.desk_need();
  if v_season is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('track_id', r.track_id, 'track', r.track_name, 'slot', r.slot, 'mode', r.mode, 'type', r.tribe_type, 'size', r.n)
                     order by r.n desc, r.track_name, r.slot, r.mode, r.tribe_type)
      from (
        select ar.track_id, t.name as track_name, s.slot, m.mode, ty.tribe_type, count(*)::integer as n
          from public.desk_waiting_base(v_season) w
          join public.member_profiles mp on mp.person_id = w.person_id
          join public.age_ranges ar on ar.id = mp.age_range_id
          join public.tracks t on t.id = ar.track_id
         cross join unnest(array['sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning']) as s(slot)
         cross join (values ('online'), ('in_person')) as m(mode)
         cross join (values ('mixed'), ('women'), ('men')) as ty(tribe_type)
         where (cardinality(mp.meeting_times) = 0 or s.slot = any (mp.meeting_times))
           and (mp.meeting_mode = 'either' or mp.meeting_mode::text = m.mode)
           and (m.mode = 'online' or mp.zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
           and (case ty.tribe_type
                  when 'mixed' then mp.tribe_mix <> 'same_gender'
                  when 'women' then mp.gender = 'female' and mp.tribe_mix <> 'mixed'
                  when 'men' then mp.gender = 'male' and mp.tribe_mix <> 'mixed'
                  else false end)
           and not exists (select 1 from public.desk_group_members gm join public.desk_groups dg on dg.id = gm.group_id
                            where gm.person_id = w.person_id and dg.status = 'draft')
         group by ar.track_id, t.name, s.slot, m.mode, ty.tribe_type
        having count(*) >= v_min) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Every function checks the owner again inside; the helpers are closed to every client.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.leader_desk_any(),
  public.desk_need(),
  public.desk_base(uuid),
  public.desk_kind(text, text),
  public.desk_waiting_base(uuid),
  public.desk_lead_base(uuid),
  public.desk_lead_notes(text, text, integer, integer, integer, integer, integer),
  public.desk_group_fit(uuid, uuid),
  public.desk_block_reason(uuid)
  from public, anon, authenticated;

revoke execute on function
  public.desk_overview(),
  public.desk_waiting(text, integer, integer),
  public.desk_leaders(text, integer, integer),
  public.desk_lead_signal(uuid),
  public.desk_phone_reveal(uuid),
  public.desk_group_view(uuid),
  public.desk_groups_list(),
  public.desk_group_save(uuid, text, uuid, uuid, uuid, text, text, text, text, integer, text),
  public.desk_group_archive(uuid),
  public.desk_group_member_add(uuid, uuid),
  public.desk_group_member_remove(uuid, uuid),
  public.desk_group_suggest(uuid, integer),
  public.desk_clusters()
  from public, anon;

grant execute on function
  public.desk_overview(),
  public.desk_waiting(text, integer, integer),
  public.desk_leaders(text, integer, integer),
  public.desk_lead_signal(uuid),
  public.desk_phone_reveal(uuid),
  public.desk_group_view(uuid),
  public.desk_groups_list(),
  public.desk_group_save(uuid, text, uuid, uuid, uuid, text, text, text, text, integer, text),
  public.desk_group_archive(uuid),
  public.desk_group_member_add(uuid, uuid),
  public.desk_group_member_remove(uuid, uuid),
  public.desk_group_suggest(uuid, integer),
  public.desk_clusters()
  to authenticated;

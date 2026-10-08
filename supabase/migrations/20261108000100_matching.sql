-- United Tribes, Phase 4: matching, choosing, and joining a circle.
--
-- The engine lives in the database so a member's answers never leave it:
--   1. filter  (hard rules: track, meeting slot, format, circle type, seats, circle health)
--   2. score   (seven weighted components, each 0 to 1; weights are versioned in match_models)
--   3. show    (the top three at 60% or more, each with its own Degree of Compatibility)
--   4. commit  (the member agrees to the Success Picture and the Circle Covenant; the seat is locked)
-- Every run is stored with its component scores and model version, so Phase 6 can learn which
-- matches thrive. Every table here has row level security and no grants: people reach the data
-- only through the functions below, which check who is asking.

-- ---------------------------------------------------------------------------
-- The model (versioned weights)
-- ---------------------------------------------------------------------------

create table public.match_models (
  version text primary key check (version ~ '^[A-Za-z0-9._-]{1,24}$'),
  weights jsonb not null,
  min_degree smallint not null default 60 check (min_degree between 1 and 100),
  active boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  check (weights ?& array['goal', 'stage', 'tribe', 'place', 'style', 'rhythm', 'faith']),
  check ((weights ->> 'goal')::numeric + (weights ->> 'stage')::numeric + (weights ->> 'tribe')::numeric
       + (weights ->> 'place')::numeric + (weights ->> 'style')::numeric + (weights ->> 'rhythm')::numeric
       + (weights ->> 'faith')::numeric = 100)
);
create unique index match_models_one_active on public.match_models ((true)) where active;

insert into public.match_models (version, weights, min_degree, active, notes)
values ('v1',
        '{"goal":30,"stage":20,"tribe":15,"place":10,"style":10,"rhythm":10,"faith":5}'::jsonb,
        60, true,
        'Set by judgement. Retrain only after about 300 completed placements, and keep the old version so runs stay explainable.');

-- ---------------------------------------------------------------------------
-- Placements: who is in which circle
-- ---------------------------------------------------------------------------

create type public.placement_status as enum ('active', 'released');

alter table public.circles
  add column whatsapp_group_url text
    check (whatsapp_group_url ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]{8,64}$'),
  add column first_meeting_on date;

create table public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  status public.placement_status not null default 'active',
  -- Which card the member picked (1, 2 or 3) and what it scored: shows whether the ranking works
  chosen_rank smallint check (chosen_rank between 1 and 3),
  degree smallint check (degree between 0 and 100),
  model_version text references public.match_models (version),
  run_id uuid,
  -- What they agreed to, word for word as it stood
  agreement_version text not null check (agreement_version ~ '^[A-Za-z0-9._-]{1,24}$'),
  agreed_at timestamptz not null default now(),
  covenant jsonb not null check (octet_length(covenant::text) <= 4000),
  -- Onboarding: the first meeting should happen within 14 days
  first_meeting_by date not null,
  called_at timestamptz,
  called_by uuid references public.people (id) on delete set null,
  joined_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (char_length(release_reason) <= 300)
);
create unique index circle_members_one_active on public.circle_members (person_id, season_id) where status = 'active';
create index circle_members_circle_idx on public.circle_members (circle_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- What was shown, and what was missing
-- ---------------------------------------------------------------------------

create table public.match_runs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  model_version text not null references public.match_models (version),
  ran_at timestamptz not null default now(),
  candidates integer not null check (candidates >= 0),
  shown integer not null check (shown between 0 and 3)
);
create index match_runs_person_idx on public.match_runs (person_id, ran_at desc);

create table public.match_recommendations (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.match_runs (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  circle_id uuid not null references public.circles (id) on delete cascade,
  degree smallint not null check (degree between 0 and 100),
  -- goal, stage, tribe, place, style, rhythm, faith: each 0 to 1
  components jsonb not null,
  -- Keys, not sentences: the wording lives in the app so it can improve without a migration
  reasons text[] not null,
  chosen boolean not null default false,
  unique (run_id, rank),
  unique (run_id, circle_id)
);
create index match_recommendations_person_idx on public.match_recommendations (person_id);

-- Members who could not be shown three good circles: the team recruits leaders for these gaps.
create table public.match_demand (
  person_id uuid primary key references public.people (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  track_id uuid references public.tracks (id),
  tribe_id uuid references public.tribes (id),
  season_goal_id uuid references public.season_goals (id),
  zone text,
  meeting_mode text,
  meeting_times text[] not null default '{}',
  circle_kind text not null check (circle_kind in ('mixed', 'women', 'men', 'any')),
  shown smallint not null check (shown between 0 and 2),
  wants_starter boolean not null default false,
  updated_at timestamptz not null default now()
);
create index match_demand_gap_idx on public.match_demand (season_id, track_id, tribe_id);

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

create function public.first_name_of(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(p.preferred_name), ''),
    nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
    split_part(p.email, '@', 1))
  from public.people p where p.id = p_person;
$$;

create function public.degree_label(p_degree integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_degree >= 85 then 'excellent' when p_degree >= 70 then 'strong' when p_degree >= 60 then 'good' else 'low' end;
$$;

-- How well a member's own ways of working suit the way the leader leads. 0 to 1.
-- A matching aid only: it is never shown to anyone as a personality result.
create function public.lead_affinity(
  p_style text, p_social integer, p_structure integer, p_openness integer, p_disclosure integer, p_learning integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(0.1, least(1.0, case p_style
    when 'structure'  then 0.5 + 0.5  * coalesce(p_structure, 0)
    when 'connection' then 0.5 + 0.25 * (coalesce(p_social, 0) + coalesce(p_disclosure, 0))
    when 'teaching'   then 0.5 + 0.5  * coalesce(p_learning, 0)
    when 'doing'      then 0.5 + 0.25 * (coalesce(p_openness, 0) - coalesce(p_learning, 0))
    else 0.5 end));
$$;

-- Up to three reasons, as keys, from the components that contributed most.
create function public.match_reasons(
  p_goal numeric, p_stage numeric, p_tribe numeric, p_place numeric, p_online boolean,
  p_rhythm numeric, p_balance numeric, p_affinity numeric, p_faith numeric, p_weights jsonb
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t.key order by t.strength desc, t.key), '{}'::text[])
  from (
    select k.key, k.strength
      from (values
        (case when p_goal >= 1 then 'goal_same' when p_goal >= 0.6 then 'goal_family' end,
           p_goal * (p_weights ->> 'goal')::numeric),
        ('stage_same', p_stage * (p_weights ->> 'stage')::numeric),
        (case when p_tribe >= 1 then 'tribe_same' when p_tribe >= 0.3 then 'tribe_related' end,
           p_tribe * (p_weights ->> 'tribe')::numeric),
        (case when p_place >= 1 and p_online then 'place_online' when p_place >= 1 then 'place_same'
              when p_place >= 0.6 then 'place_near' end,
           p_place * (p_weights ->> 'place')::numeric),
        ('rhythm_fit', p_rhythm * (p_weights ->> 'rhythm')::numeric),
        (case when p_affinity >= 0.7 then 'style_leader' end, p_affinity * (p_weights ->> 'style')::numeric * 0.5),
        (case when p_balance >= 0.65 then 'style_balance' end, p_balance * (p_weights ->> 'style')::numeric * 0.5),
        (case when p_faith >= 1 then 'faith_needed' end, p_faith * (p_weights ->> 'faith')::numeric),
        -- Always last, so there are always three
        ('seats_open', 0.01::numeric)
      ) as k (key, strength)
     where k.key is not null
     order by k.strength desc, k.key
     limit 3
  ) t;
$$;

-- Every open circle that passes the hard rules for this member, scored. Not limited to three.
-- Open means: approved Circle Card, certified leader, seats left, and adding this person keeps the circle healthy.
create function public.match_candidates(p_person uuid)
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
  my_family uuid;
  w jsonb;
  my_est boolean;
  my_heavy boolean;
begin
  select * into me from public.member_profiles where person_id = p_person;
  if not found then
    return;
  end if;
  select ar.track_id into my_track from public.age_ranges ar where ar.id = me.age_range_id;
  select sg.family_id into my_family from public.season_goals sg where sg.id = me.season_goal_id;
  select mm.weights into w from public.match_models mm where mm.active;
  my_est := me.faith_journey in ('established', 'leading');
  my_heavy := me.support_needs is not null and char_length(btrim(me.support_needs)) >= 3;

  return query
  with pool as (
    select c.id, c.capacity, c.leader_id, c.tribe_id, c.season_goal_id, c.meeting_mode, c.zone, c.published_at,
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
       and c.track_id = my_track
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
           count(*) filter (where mp.support_needs is not null and char_length(btrim(mp.support_needs)) >= 3) as heavy_n
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
           1.0 as c_stage,
           case when me.tribe_id is not null and o.tribe_id = me.tribe_id then 1.0
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
                                                          - abs((o.soc_sum + me.style_social)::numeric / (o.n + 1))))) end as c_balance,
           public.lead_affinity(o.lead_style, me.style_social, me.style_structure, me.style_openness,
                                me.style_disclosure, me.style_learning) as c_affinity,
           case when o.n = 0 then 0.8
                when o.same_stage_n::numeric / o.n <= 0.34 then 1.0
                else 0.6 end as c_faith
      from open_ones o
  )
  select k.id,
         round(
           (w ->> 'goal')::numeric * k.c_goal + (w ->> 'stage')::numeric * k.c_stage
         + (w ->> 'tribe')::numeric * k.c_tribe + (w ->> 'place')::numeric * k.c_place
         + (w ->> 'style')::numeric * (0.5 * k.c_balance + 0.5 * k.c_affinity)
         + (w ->> 'rhythm')::numeric * k.c_rhythm + (w ->> 'faith')::numeric * k.c_faith)::integer,
         k.c_goal, k.c_stage, k.c_tribe, k.c_place, (0.5 * k.c_balance + 0.5 * k.c_affinity), k.c_rhythm, k.c_faith,
         k.c_balance, k.c_affinity, k.online, (k.capacity - k.n)::integer, k.published_at
    from comp k;
end;
$$;

-- What a member is allowed to see of a circle before and after joining. A leader's first name only.
create function public.match_card(p_circle uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'tribe', tr.name,
    'track', t.name,
    'goal', g.title,
    'circle_type', c.circle_type,
    'story', c.story,
    'leader_first_name', public.first_name_of(c.leader_id),
    'meeting_day', c.meeting_day,
    'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
    'duration_minutes', c.duration_minutes,
    'mode', c.meeting_mode,
    'zone', c.zone,
    'place_note', c.place_note,
    'capacity', c.capacity,
    'seats_left', c.capacity - (select count(*) from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active'),
    'open', c.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id),
    'god', c.loving_god,
    'others', c.loving_others,
    'life', c.loving_life,
    'season_starts_on', s.starts_on
  )
  from public.circles c
  join public.seasons s on s.id = c.season_id
  left join public.tracks t on t.id = c.track_id
  left join public.tribes tr on tr.id = c.tribe_id
  left join public.season_goals g on g.id = c.season_goal_id
  where c.id = p_circle;
$$;

-- ---------------------------------------------------------------------------
-- The member's view: shown circles, and the placement if they have joined
-- ---------------------------------------------------------------------------

create function public.my_match()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  has_profile boolean;
  run public.match_runs%rowtype;
  place public.circle_members%rowtype;
  placement jsonb := null;
  shown jsonb := '[]'::jsonb;
  on_list boolean := false;
  season jsonb := null;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select exists (select 1 from public.member_profiles where person_id = uid) into has_profile;

  select s.* into place
    from public.circle_members s
   where s.person_id = uid and s.status = 'active'
   order by s.joined_at desc limit 1;
  if found then
    select jsonb_build_object(
      'circle', public.match_card(place.circle_id),
      'rank', place.chosen_rank,
      'degree', place.degree,
      'label', public.degree_label(place.degree),
      'joined_at', place.joined_at,
      'agreed_at', place.agreed_at,
      'covenant', place.covenant,
      'first_meeting_by', place.first_meeting_by,
      'first_meeting_on', c.first_meeting_on,
      'group_url', c.whatsapp_group_url,
      'called', place.called_at is not null,
      'assistant_first_name', case when c.assistant_id is null then null else public.first_name_of(c.assistant_id) end,
      'can_release', s.starts_on > current_date,
      'season_name', s.name,
      'season_starts_on', s.starts_on)
      into placement
      from public.circles c
      join public.seasons s on s.id = c.season_id
     where c.id = place.circle_id;
  end if;

  select r.* into run from public.match_runs r where r.person_id = uid order by r.ran_at desc limit 1;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', x.rank,
             'degree', x.degree,
             'label', public.degree_label(x.degree),
             'reasons', to_jsonb(x.reasons),
             'chosen', x.chosen,
             'circle', public.match_card(x.circle_id)) order by x.rank), '[]'::jsonb)
      into shown
      from public.match_recommendations x
     where x.run_id = run.id;
  end if;

  select d.wants_starter into on_list from public.match_demand d where d.person_id = uid;

  select jsonb_build_object('name', s.name, 'starts_on', s.starts_on) into season
    from public.member_profiles mp join public.seasons s on s.id = mp.season_id
   where mp.person_id = uid;

  return jsonb_build_object(
    'profile', has_profile,
    'season', season,
    'ran', run.id is not null,
    'ran_at', run.ran_at,
    'model', run.model_version,
    'candidates', run.candidates,
    'circles', shown,
    'short', run.id is not null and run.shown < 3,
    'on_starter_list', coalesce(on_list, false),
    'placement', placement);
end;
$$;

-- Runs the engine for the signed-in member and stores what it shows. A run less than ten minutes old is reused
-- unless the member asks for a fresh one, so refreshing the page is cheap and the stored history stays meaningful.
create function public.match_me(p_refresh boolean default false)
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

-- Someone who could not be shown three good circles can ask for a Starter Circle place while a leader is found.
create function public.join_starter_list(p_join boolean)
returns void
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
  update public.match_demand set wants_starter = coalesce(p_join, false), updated_at = now() where person_id = uid;
  if not found then
    raise exception 'There is nothing to join yet. Look at your circles first.' using errcode = '22023';
  end if;
  perform public.write_event(uid, case when p_join then 'match.starter_joined' else 'match.starter_left' end, 'person', uid::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Choose and commit: the seat is locked in one step
-- ---------------------------------------------------------------------------

create function public.choose_circle(p_circle uuid, p_agree boolean, p_version text)
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

-- A member can change their mind until the season starts. After that, a coach moves them.
create function public.release_my_seat(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  place public.circle_members%rowtype;
  starts date;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select s.* into place from public.circle_members s where s.person_id = uid and s.status = 'active' for update;
  if not found then
    raise exception 'You are not in a circle' using errcode = '22023';
  end if;
  select se.starts_on into starts from public.seasons se where se.id = place.season_id;
  if starts <= current_date then
    raise exception 'The season has started. Ask your leader or coach to help you change circles.' using errcode = '22023';
  end if;
  if why is not null and char_length(why) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  update public.circle_members set status = 'released', released_at = now(), release_reason = why where id = place.id;
  update public.match_recommendations set chosen = false where run_id = place.run_id and circle_id = place.circle_id;
  perform public.write_event(uid, 'match.released', 'circle', place.circle_id::text, '{}'::jsonb);
  return public.my_match();
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding: the leader's side
-- ---------------------------------------------------------------------------

create function public.can_lead_circle(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.circles c
     where c.id = p_circle
       and (c.leader_id = (select auth.uid()) or c.assistant_id = (select auth.uid())));
$$;

-- The roster, for the people who run the circle. A member shares a name and, only if they said yes to WhatsApp, a number.
create function public.circle_roster(p_circle uuid)
returns jsonb
language plpgsql
stable
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
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false)
          or public.has_any_role(array['pastor', 'director']::public.app_role[])) then
    raise exception 'You do not run this circle' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'circle', jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity,
      'group_url', c.whatsapp_group_url, 'first_meeting_on', c.first_meeting_on,
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
      'season_starts_on', (select s.starts_on from public.seasons s where s.id = c.season_id),
      'can_edit', c.leader_id = uid or coalesce(c.assistant_id = uid, false)),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'first_name', public.first_name_of(m.person_id),
               'whatsapp', mp.whatsapp,
               'joined_at', m.joined_at,
               'first_meeting_by', m.first_meeting_by,
               'called', m.called_at is not null,
               'called_at', m.called_at) order by m.joined_at)
        from public.circle_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
       where m.circle_id = c.id and m.status = 'active'), '[]'::jsonb));
end;
$$;

create function public.save_circle_onboarding(p_circle uuid, p_group_url text, p_first_meeting date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  url text := nullif(btrim(coalesce(p_group_url, '')), '');
  starts date;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle for update;
  if not found or not (c.leader_id = uid or coalesce(c.assistant_id = uid, false)) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  if c.status <> 'approved' then
    raise exception 'Your circle opens once its card is approved' using errcode = '22023';
  end if;
  if url is not null and url !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]{8,64}$' then
    raise exception 'Paste the invite link from WhatsApp. It starts with https://chat.whatsapp.com/' using errcode = '22023';
  end if;
  select s.starts_on into starts from public.seasons s where s.id = c.season_id;
  if p_first_meeting is not null and (p_first_meeting < current_date or p_first_meeting > greatest(current_date, starts) + 60) then
    raise exception 'Choose a first meeting date between today and the first two months of the season' using errcode = '22023';
  end if;
  update public.circles set whatsapp_group_url = url, first_meeting_on = p_first_meeting where id = p_circle;
  perform public.write_event(uid, 'circle.onboarding_saved', 'circle', p_circle::text,
    jsonb_build_object('group_link', url is not null, 'first_meeting', p_first_meeting is not null));
end;
$$;

create function public.mark_member_called(p_circle uuid, p_person uuid, p_called boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.can_lead_circle(p_circle) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  update public.circle_members
     set called_at = case when p_called then now() else null end,
         called_by = case when p_called then uid else null end
   where circle_id = p_circle and person_id = p_person and status = 'active';
  if not found then
    raise exception 'That person is not in your circle' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A published circle with members cannot be pulled back to draft
-- ---------------------------------------------------------------------------

create function public.guard_circle_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and new.status in ('changes_requested', 'draft', 'submitted')
     and exists (select 1 from public.circle_members where circle_id = old.id and status = 'active') then
    raise exception 'Members have already joined this circle. Talk to the leader instead of taking the card back.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger circles_guard_status before update of status on public.circles
  for each row execute function public.guard_circle_status();

-- ---------------------------------------------------------------------------
-- Withdrawing matching consent also erases what the engine kept about the person
-- ---------------------------------------------------------------------------

create or replace function public.apply_consent_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.granted then
    return new;
  end if;
  if new.purpose = 'matching' then
    delete from public.member_profiles where person_id = new.person_id;
    delete from public.intake_drafts where person_id = new.person_id;
    delete from public.match_runs where person_id = new.person_id;
    delete from public.match_demand where person_id = new.person_id;
  elsif new.purpose = 'whatsapp' then
    update public.member_profiles set whatsapp = null where person_id = new.person_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.apply_consent_withdrawal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Totals for the office
-- ---------------------------------------------------------------------------

create function public.match_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see matching totals' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'profiled', (select count(*) from public.member_profiles),
    'placed', (select count(distinct person_id) from public.circle_members where status = 'active'),
    'waiting', (select count(*) from public.member_profiles mp
                 where not exists (select 1 from public.circle_members m where m.person_id = mp.person_id and m.status = 'active')),
    'circles_open', (select count(*) from public.circles c
                      where c.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)),
    'seats_total', (select coalesce(sum(c.capacity), 0) from public.circles c
                     where c.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)),
    'seats_taken', (select count(*) from public.circle_members m join public.circles c on c.id = m.circle_id
                     where m.status = 'active' and c.status = 'approved'),
    'ran', (select count(distinct person_id) from public.match_runs),
    'by_rank', jsonb_build_object(
      'first', (select count(*) from public.circle_members where status = 'active' and chosen_rank = 1),
      'second', (select count(*) from public.circle_members where status = 'active' and chosen_rank = 2),
      'third', (select count(*) from public.circle_members where status = 'active' and chosen_rank = 3)),
    'bands', jsonb_build_object(
      'excellent', (select count(*) from public.circle_members where status = 'active' and degree >= 85),
      'strong', (select count(*) from public.circle_members where status = 'active' and degree between 70 and 84),
      'good', (select count(*) from public.circle_members where status = 'active' and degree between 60 and 69)),
    'average_degree', (select round(avg(degree)) from public.circle_members where status = 'active'),
    'starter_list', (select count(*) from public.match_demand where wants_starter),
    'unmet', (select count(*) from public.match_demand),
    'gaps', coalesce((
      select jsonb_agg(g order by (g ->> 'members')::int desc)
        from (
          select jsonb_build_object(
                   'track', t.name, 'tribe', tr.name, 'goal', sg.title,
                   'kind', d.circle_kind, 'members', count(*)) as g
            from public.match_demand d
            left join public.tracks t on t.id = d.track_id
            left join public.tribes tr on tr.id = d.tribe_id
            left join public.season_goals sg on sg.id = d.season_goal_id
           group by t.name, tr.name, sg.title, d.circle_kind
           order by count(*) desc
           limit 10) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.match_models enable row level security;
alter table public.circle_members enable row level security;
alter table public.match_runs enable row level security;
alter table public.match_recommendations enable row level security;
alter table public.match_demand enable row level security;
-- No grants: only the functions touch these tables.

revoke execute on function
  public.first_name_of(uuid),
  public.degree_label(integer),
  public.lead_affinity(text, integer, integer, integer, integer, integer),
  public.match_reasons(numeric, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, jsonb),
  public.match_candidates(uuid),
  public.match_card(uuid),
  public.can_lead_circle(uuid),
  public.guard_circle_status(),
  public.my_match(),
  public.match_me(boolean),
  public.join_starter_list(boolean),
  public.choose_circle(uuid, boolean, text),
  public.release_my_seat(text),
  public.circle_roster(uuid),
  public.save_circle_onboarding(uuid, text, date),
  public.mark_member_called(uuid, uuid, boolean),
  public.match_stats()
  from public, anon, authenticated;

grant execute on function
  public.my_match(),
  public.match_me(boolean),
  public.join_starter_list(boolean),
  public.choose_circle(uuid, boolean, text),
  public.release_my_seat(text),
  public.circle_roster(uuid),
  public.save_circle_onboarding(uuid, text, date),
  public.mark_member_called(uuid, uuid, boolean),
  public.match_stats()
  to authenticated;

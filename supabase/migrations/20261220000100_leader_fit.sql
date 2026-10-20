-- Phase 5 (database): the compatibility engine for leaders.
--
-- It filters the real options (cards a pastor or director has signed off), scores each one on five parts, applies a care gate to
-- sensitive subjects, stores every run, and keeps all of it away from the applicant. It is built like the member matching engine
-- (match_models, match_runs, match_recommendations) so the platform has one way of matching, not two.
--
-- New objects only. No existing table gains a column and no existing function is revised. The application form does not use any
-- of this until Find your tribe is switched on (the next migration wires the screen and the send check).
--
-- Every table has row level security on and no client policy: only the functions below can touch them.

-- ---------------------------------------------------------------------------
-- The model: the weights the pastorate approves
-- ---------------------------------------------------------------------------

-- Seven whole numbers: the five parts (which must add to 100) and two settings that sit beside them. Written as a case so that
-- no cast runs before the shape has been checked.
create function public.leader_fit_weights_ok(w jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when w is null or jsonb_typeof(w) <> 'object' then false
    when exists (select 1 from jsonb_object_keys(w) k
                  where k not in ('calling', 'judgement', 'style', 'need', 'stage', 'care_bar', 'unassessed_judgement')) then false
    when (select count(*) from jsonb_each(w) e
           where jsonb_typeof(e.value) = 'number' and (e.value #>> '{}') ~ '^[0-9]{1,3}$') <> 7 then false
    else (w ->> 'calling')::int + (w ->> 'judgement')::int + (w ->> 'style')::int + (w ->> 'need')::int + (w ->> 'stage')::int = 100
         and (w ->> 'care_bar')::int <= 100
         and (w ->> 'unassessed_judgement')::int <= 100
  end;
$$;

create table public.leader_fit_models (
  version text primary key check (version ~ '^[A-Za-z0-9._-]{1,24}$'),
  weights jsonb not null check (public.leader_fit_weights_ok(weights)),
  min_degree smallint not null default 60 check (min_degree between 1 and 100),
  active boolean not null default false,
  notes text check (char_length(notes) <= 400),
  parent_version text references public.leader_fit_models (version),
  created_by uuid references public.people (id) on delete set null,
  approved_by uuid references public.people (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (not active or approved_at is not null)
);
-- One active model, ever.
create unique index leader_fit_models_one_active on public.leader_fit_models ((active)) where active;
alter table public.leader_fit_models enable row level security;
revoke all on table public.leader_fit_models from public, anon, authenticated;

-- A version is a record. Its weights never change after it is saved: a change is a new version. Only the approval can be set.
create function public.leader_fit_models_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A model version is kept for the record' using errcode = '22023';
  end if;
  if new.version is distinct from old.version or new.weights is distinct from old.weights
     or new.min_degree is distinct from old.min_degree or new.parent_version is distinct from old.parent_version
     or new.created_at is distinct from old.created_at then
    raise exception 'A model version cannot be changed. Save a new version instead' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger leader_fit_models_guard before update or delete on public.leader_fit_models
  for each row execute function public.leader_fit_models_guard();

-- The first proposal. It is not active: the pastorate approves it before anything uses it.
insert into public.leader_fit_models (version, weights, min_degree, active, notes)
values ('lf-1',
        '{"calling": 35, "judgement": 20, "style": 20, "need": 15, "stage": 10, "care_bar": 70, "unassessed_judgement": 60}'::jsonb,
        60, false,
        'First proposal. Calling 35, judgement 20, style 20, need 15, stage 10. Sensitive subjects need a care result of 70 or more to be recommended. The pastorate approves it before it is used.');

-- ---------------------------------------------------------------------------
-- Runs and recommendations
-- ---------------------------------------------------------------------------

create table public.leader_fit_runs (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  person_id uuid not null references public.people (id) on delete cascade,
  application_id uuid references public.leader_applications (id) on delete set null,
  season_id uuid references public.seasons (id) on delete set null,
  model_version text not null references public.leader_fit_models (version),
  inputs jsonb not null,
  inputs_hash text not null,
  source text not null check (source in ('application', 'quiet', 'rerun', 'appointment')),
  ran_at timestamptz not null default clock_timestamp(),
  candidates smallint not null check (candidates >= 0),
  shown smallint not null check (shown between 0 and 3),
  -- The goal they named before they saw any result. Written once for an application and carried to every later run of it.
  first_goal_id uuid references public.season_goals (id) on delete set null,
  judgement_pct numeric(5, 2),
  care_pct numeric(5, 2),
  -- Everything the engine worked out for this run, so an audit can explain it afterwards.
  options jsonb not null,
  chosen_goal_id uuid references public.season_goals (id) on delete set null,
  chosen_degree smallint,
  chosen_components jsonb,
  chosen_flags text[] not null default '{}',
  backup_goal_ids uuid[] not null default '{}',
  choices smallint not null default 0,
  chosen_at timestamptz,
  check (cardinality(backup_goal_ids) <= 2),
  check (chosen_goal_id is not null or (chosen_at is null and cardinality(backup_goal_ids) = 0))
);
create index leader_fit_runs_app_idx on public.leader_fit_runs (application_id, seq desc);
create index leader_fit_runs_person_idx on public.leader_fit_runs (person_id, seq desc);
alter table public.leader_fit_runs enable row level security;
revoke all on table public.leader_fit_runs from public, anon, authenticated;

create table public.leader_fit_recommendations (
  run_id uuid not null references public.leader_fit_runs (id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  goal_id uuid not null references public.season_goals (id) on delete cascade,
  degree smallint not null check (degree between 0 and 100),
  components jsonb not null,
  reasons jsonb not null,
  flags text[] not null default '{}',
  primary key (run_id, rank)
);
alter table public.leader_fit_recommendations enable row level security;
revoke all on table public.leader_fit_recommendations from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small internal helpers
-- ---------------------------------------------------------------------------

-- The model in force, or a row of empty values when none is approved yet (check the version).
create function public.leader_fit_cfg()
returns public.leader_fit_models
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.leader_fit_models where active limit 1;
$$;

-- The season Tribe Cards are started in: the earliest in planning or open (the same rule start_tribe_card uses).
create function public.leader_fit_season()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.seasons where status in ('planning', 'open') order by starts_on limit 1;
$$;

-- The scenario rule of submit_leader_application, written once more as a helper (that function is not revised a third time).
-- Each situation gives (best rating - worst rating + 3) / 6; the result is the average as a percentage, to two places.
-- p_only limits it to some situations (the three care situations). Returns null when an answer is missing or not valid.
-- tests/db/leader-fit.test.ts proves it gives the same percentage as leader_assessments.scenario_pct for every sample.
create function public.leader_scenario_score(p_answers jsonb, p_only text[] default null)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s jsonb := coalesce(p_answers -> 'scenarios', '{}'::jsonb);
  sid text;
  best text;
  worst text;
  best_rating integer;
  worst_rating integer;
  total numeric := 0;
  n integer := 0;
begin
  if jsonb_typeof(s) <> 'object' then
    return null;
  end if;
  for sid in select distinct k.scenario_id from public.scenario_keys k where p_only is null or k.scenario_id = any (p_only) order by 1 loop
    best := s -> sid ->> 'best';
    worst := s -> sid ->> 'worst';
    if best is null or worst is null or best = worst then
      return null;
    end if;
    select rating into best_rating from public.scenario_keys where scenario_id = sid and option_id = best;
    select rating into worst_rating from public.scenario_keys where scenario_id = sid and option_id = worst;
    if best_rating is null or worst_rating is null then
      return null;
    end if;
    total := total + (best_rating - worst_rating + 3) / 6.0;
    n := n + 1;
  end loop;
  if n = 0 then
    return null;
  end if;
  return round(total / n * 100, 2);
end;
$$;

-- What the engine needs from saved answers. Nothing new is asked of the leader. Judgement is the average of all six situations;
-- care is the average of the three care situations: a quiet member (s2), words that worry you (s3), a request for money (s6).
create function public.leader_fit_inputs(p_answers jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a jsonb := case when jsonb_typeof(p_answers) = 'object' then p_answers else '{}'::jsonb end;
  v_rel text := nullif(a #>> '{calling,goalRelation}', '');
  v_lead text := nullif(a #>> '{style,leadBest}', '');
begin
  return jsonb_build_object(
    'track', nullif(a #>> '{calling,track}', ''),
    'community', nullif(a #>> '{calling,community}', ''),
    'goal', nullif(a #>> '{calling,goal}', ''),
    'relation', case when v_rel in ('achieved', 'pursuing') then v_rel end,
    'lead_best', case when v_lead in ('structure', 'connection', 'teaching', 'doing') then v_lead end,
    'judgement', public.leader_scenario_score(a, null),
    'care', public.leader_scenario_score(a, array['s2', 's3', 's6']));
end;
$$;

-- ---------------------------------------------------------------------------
-- One "members waiting" figure
-- ---------------------------------------------------------------------------

-- For every goal: members waiting, seats open, leaders interested and the gap. The engine's Need part and the supply board
-- (a later phase) both read this one function, so what the office sees and what leaders are steered toward can never disagree.
--   waiting    rows in match_demand for the goal and season whose person has no active tribe place (placed people are ignored)
--   seats_open capacity less active members in approved tribes with a certified leader, never below zero, counted per tribe
--   interested people whose latest run chose the goal or listed it as a backup (quiet runs choose nothing, and an appointment is not
--              interest), not counting
--              people who already lead a tribe on the goal this season
--   gap        waiting less seats open (negative when leaders outnumber members)
create function public.goal_demand_rows(p_season uuid)
returns table (goal_id uuid, waiting integer, seats_open integer, interested integer, gap integer)
language sql
stable
security definer
set search_path = ''
as $$
  with w as (
    select d.season_goal_id as gid, count(*)::integer as n
      from public.match_demand d
     where p_season is not null and d.season_id = p_season and d.season_goal_id is not null
       and not exists (select 1 from public.tribe_members m where m.person_id = d.person_id and m.status = 'active')
     group by d.season_goal_id),
  s as (
    select c.season_goal_id as gid,
           sum(greatest(c.capacity - (select count(*) from public.tribe_members m where m.tribe_id = c.id and m.status = 'active'), 0))::integer as n
      from public.tribes c
     where p_season is not null and c.season_id = p_season and c.status = 'approved' and c.season_goal_id is not null
       and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
     group by c.season_goal_id),
  latest as (
    select distinct on (r.person_id) r.person_id, r.chosen_goal_id, r.backup_goal_ids, r.source
      from public.leader_fit_runs r
     order by r.person_id, r.seq desc),
  picks as (
    select l.person_id, l.chosen_goal_id as gid from latest l where l.chosen_goal_id is not null and l.source <> 'appointment'
    union
    select l.person_id, b from latest l, unnest(l.backup_goal_ids) as b where l.source <> 'appointment'),
  i as (
    select p.gid, count(distinct p.person_id)::integer as n
      from picks p
     where not exists (
       select 1 from public.tribes c
        where c.leader_id = p.person_id and c.season_goal_id = p.gid and c.season_id is not distinct from p_season and c.status <> 'closed')
     group by p.gid)
  select g.id,
         coalesce(w.n, 0),
         coalesce(s.n, 0),
         coalesce(i.n, 0),
         coalesce(w.n, 0) - coalesce(s.n, 0)
    from public.season_goals g
    left join w on w.gid = g.id
    left join s on s.gid = g.id
    left join i on i.gid = g.id;
$$;

-- ---------------------------------------------------------------------------
-- The filter, then the score
-- ---------------------------------------------------------------------------

create type public.leader_fit_option as (
  goal_id uuid,
  slug text,
  title text,
  community_id uuid,
  community_slug text,
  community_name text,
  community_sort integer,
  family_id uuid,
  card_version integer,
  sensitive boolean,
  closeness integer,
  calling integer,
  judgement integer,
  style integer,
  need integer,
  stage integer,
  degree integer,
  label text,
  next_to boolean,
  care_flag boolean,
  recommended boolean,
  gap integer,
  ord integer,
  rec_rank integer
);

-- Every option for a leader, scored. Takes the inputs, not an application, and has no side effects, so it serves a leader who has
-- no application as well (one appointed from the owner's console).
--
-- Only real options: the card is signed off, its goal and community are on, and the leader's life stage is one the card suits or the
-- stage next to it (next to counts as outside their stage and scores lower on Stage). Five parts, each 0 to 100, as whole numbers:
--   calling    closeness (the same goal 100, else the same goal family 60, else the same community 40, else 10) times the relation
--              (reached it 1.0, working on it 0.8). A write-in goal counts as no goal: the community 40, else 10.
--   judgement  the leader's judgement percentage, the same for every option (the model's unassessed value when none is known)
--   style      100 x the card's demand for the leader's strongest way / the card's largest demand
--   need       100 x the gap / 12, held between 0 and 100 (a tribe holds up to 12)
--   stage      100 when the stage is one the card suits, 60 when next to it
-- The degree is the weighted total using the weights in the active model, rounded half up.
-- Order: highest degree, then calling, then need, then the goal id. No random number and no clock enters the score.
create function public.leader_fit_options(p_inputs jsonb)
returns setof public.leader_fit_option
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.leader_fit_models;
  v_track text := nullif(p_inputs ->> 'track', '');
  v_comm text := nullif(p_inputs ->> 'community', '');
  v_goal text := nullif(p_inputs ->> 'goal', '');
  v_rel text := nullif(p_inputs ->> 'relation', '');
  v_lead text := nullif(p_inputs ->> 'lead_best', '');
  v_judg numeric := nullif(p_inputs ->> 'judgement', '')::numeric;
  v_care numeric := nullif(p_inputs ->> 'care', '')::numeric;
  v_rank integer;
  v_comm_id uuid;
  v_goal_id uuid;
  v_goal_family uuid;
  v_goal_comm uuid;
  v_season uuid := public.leader_fit_season();
  w_cal integer;
  w_jud integer;
  w_sty integer;
  w_nee integer;
  w_sta integer;
  v_bar integer;
  v_judg_part integer;
  v_rel_pct integer;
begin
  select * into m from public.leader_fit_models x where x.active;
  if not found then
    return;
  end if;
  if v_track is null or v_lead is null or v_lead not in ('structure', 'connection', 'teaching', 'doing') then
    return;
  end if;
  select x.rk into v_rank
    from (select t.slug, dense_rank() over (order by t.sort)::integer as rk from public.tracks t where t.active) x
   where x.slug = v_track;
  if v_rank is null then
    return;
  end if;
  if v_comm is not null then
    select id into v_comm_id from public.communities where slug = v_comm;
  end if;
  if v_goal is not null then
    select g.id, g.family_id, g.community_id into v_goal_id, v_goal_family, v_goal_comm from public.season_goals g where g.slug = v_goal;
    if v_goal_id is not null and v_comm_id is not null and v_goal_comm <> v_comm_id then
      -- A goal left over from another community is not a goal they named in this one.
      v_goal_id := null;
      v_goal_family := null;
    elsif v_goal_id is not null and v_comm_id is null then
      v_comm_id := v_goal_comm;
    end if;
  end if;

  w_cal := (m.weights ->> 'calling')::integer;
  w_jud := (m.weights ->> 'judgement')::integer;
  w_sty := (m.weights ->> 'style')::integer;
  w_nee := (m.weights ->> 'need')::integer;
  w_sta := (m.weights ->> 'stage')::integer;
  v_bar := (m.weights ->> 'care_bar')::integer;
  v_judg_part := case when v_judg is null then (m.weights ->> 'unassessed_judgement')::integer
                      else least(100, greatest(0, round(v_judg)::integer)) end;
  v_rel_pct := case when v_rel = 'achieved' then 100 else 80 end;

  return query
  with dem as (
    select d.goal_id as gid, d.gap as gp from public.goal_demand_rows(v_season) d),
  tr as (
    select t.slug, dense_rank() over (order by t.sort)::integer as rk from public.tracks t where t.active),
  base as (
    select g.id as gid, t.slug as cslug, t.title as ctitle, c.id as cid, c.slug as comm_slug, c.name as comm_name, c.sort as comm_sort,
           g.family_id as fid, t.version as ver, t.sensitive as sens,
           case when v_goal_id is not null and g.id = v_goal_id then 100
                when v_goal_id is not null and g.family_id = v_goal_family then 60
                when v_comm_id is not null and g.community_id = v_comm_id then 40
                else 10 end as closeness,
           case v_lead when 'structure' then t.demand_structure when 'connection' then t.demand_connection
                       when 'teaching' then t.demand_teaching else t.demand_doing end as dem_lead,
           greatest(t.demand_structure, t.demand_connection, t.demand_teaching, t.demand_doing) as dem_max,
           (select min(abs(x.rk - v_rank)) from tr x where x.slug = any (t.track_slugs)) as dist,
           coalesce(dm.gp, 0) as gp
      from public.tribe_card_templates t
      join public.season_goals g on g.id = t.season_goal_id and g.active
      join public.communities c on c.id = t.community_id and c.active
      left join dem dm on dm.gid = g.id
     where t.status = 'signed_off'),
  scored as (
    select b.*,
           (b.closeness * v_rel_pct / 100) as p_cal,
           v_judg_part as p_jud,
           ((200 * b.dem_lead + b.dem_max) / (2 * b.dem_max)) as p_sty,
           ((200 * least(12, greatest(0, b.gp)) + 12) / 24) as p_nee,
           case when b.dist = 0 then 100 else 60 end as p_sta
      from base b
     where b.dist is not null and b.dist <= 1),
  final as (
    select s.*,
           ((w_cal * s.p_cal + w_jud * s.p_jud + w_sty * s.p_sty + w_nee * s.p_nee + w_sta * s.p_sta + 50) / 100) as deg,
           (s.sens and (v_care is null or v_care < v_bar)) as cflag
      from scored s)
  select f.gid, f.cslug, f.ctitle, f.cid, f.comm_slug, f.comm_name, f.comm_sort, f.fid, f.ver, f.sens, f.closeness,
         f.p_cal, f.p_jud, f.p_sty, f.p_nee, f.p_sta, f.deg, public.degree_label(f.deg), (f.dist = 1), f.cflag,
         (f.deg >= m.min_degree and not f.cflag), f.gp,
         (row_number() over (order by f.deg desc, f.p_cal desc, f.p_nee desc, f.gid))::integer,
         case when f.deg >= m.min_degree and not f.cflag
              then (row_number() over (partition by (f.deg >= m.min_degree and not f.cflag) order by f.deg desc, f.p_cal desc, f.p_nee desc, f.gid))::integer
         end
    from final f
   order by 23;
end;
$$;

-- At most three plain sentences, picked from the parts that scored best. A reason never mentions judgement, care, sensitivity or
-- any score.
create function public.leader_fit_reasons(o public.leader_fit_option, p_relation text)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  r text[];
begin
  select coalesce(array_agg(x.txt order by x.score desc, x.ord), '{}') into r
    from (
      select v.txt, v.score, v.ord
        from (values
          (case when o.closeness = 100 and p_relation = 'achieved' then 'You have walked this road' end, o.calling, 1),
          (case when o.closeness = 100 and coalesce(p_relation, '') <> 'achieved' then 'You are walking this road now' end, o.calling, 1),
          (case when o.closeness in (60, 40) then 'A close neighbour of the goal you named' end, o.calling, 2),
          (case when o.style >= 75 then 'Your way of leading suits this group' end, o.style, 3),
          (case when o.stage = 100 then 'It suits your stage of life' end, o.stage, 4),
          (case when o.need >= 25 then 'Members are waiting for a leader here' end, o.need, 5)
        ) as v (txt, score, ord)
       where v.txt is not null
       order by v.score desc, v.ord
       limit 3) x;
  return r;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storing a run
-- ---------------------------------------------------------------------------

-- The word the leader sees for a degree. Below the minimum it is "stretch", never "low".
create function public.leader_fit_word(p_degree integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_degree >= 85 then 'excellent' when p_degree >= 70 then 'strong' when p_degree >= 60 then 'good' else 'stretch' end;
$$;

-- What the engine worked out, as one JSON list (the "options" of a run), top of the order first. Only the database reads it back.
create function public.leader_fit_snapshot(p_inputs jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'goal_id', o.goal_id, 'slug', o.slug, 'title', o.title,
           'community_id', o.community_id, 'community_slug', o.community_slug, 'community', o.community_name, 'community_sort', o.community_sort,
           'card_version', o.card_version, 'sensitive', o.sensitive,
           'parts', jsonb_build_object('calling', o.calling, 'judgement', o.judgement, 'style', o.style, 'need', o.need, 'stage', o.stage),
           'closeness', o.closeness, 'degree', o.degree, 'label', public.leader_fit_word(o.degree), 'next_to', o.next_to,
           'care_flag', o.care_flag, 'recommended', o.recommended, 'gap', o.gap, 'ord', o.ord, 'rank', o.rec_rank,
           'reasons', case when o.rec_rank <= 6 then to_jsonb(public.leader_fit_reasons(o, p_inputs ->> 'relation')) else '[]'::jsonb end)
         order by o.ord), '[]'::jsonb)
    from public.leader_fit_options(p_inputs) o;
$$;

-- Records a choice (and up to two backups) on a run, from the options stored with the run. The one place a choice is written.
-- Returns the flags that apply to it, as codes the pastor's panel puts into words.
create function public.leader_fit_apply_choice(p_run uuid, p_goal uuid, p_backups uuid[], p_count boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_fit_runs;
  o jsonb;
  v_flags text[] := '{}';
  v_backups uuid[] := '{}';
  b uuid;
  v_changed boolean;
begin
  select * into r from public.leader_fit_runs x where x.id = p_run for update;
  select e into o from jsonb_array_elements(r.options) e where (e ->> 'goal_id')::uuid = p_goal;
  if o is null then
    raise exception 'That tribe is not one of your options' using errcode = '22023';
  end if;
  foreach b in array coalesce(p_backups, '{}') loop
    if b = p_goal or b = any (v_backups) or not exists (select 1 from jsonb_array_elements(r.options) e where (e ->> 'goal_id')::uuid = b) then
      raise exception 'Choose two different backups from your options' using errcode = '22023';
    end if;
    v_backups := array_append(v_backups, b);
  end loop;
  if cardinality(v_backups) > 2 then
    raise exception 'You can add up to two backups' using errcode = '22023';
  end if;

  if (o ->> 'care_flag')::boolean then v_flags := array_append(v_flags, 'sensitive_below_bar'); end if;
  if (o #>> '{parts,need}')::integer = 0
     and (select count(*) from jsonb_array_elements(r.options) e where (e ->> 'gap')::integer > 0) >= 3 then
    v_flags := array_append(v_flags, 'no_need_while_needed');
  end if;
  if (o ->> 'next_to')::boolean then v_flags := array_append(v_flags, 'outside_stage'); end if;
  if r.first_goal_id is not null and r.first_goal_id <> p_goal then v_flags := array_append(v_flags, 'changed_after_results'); end if;
  if r.shown < 3 then v_flags := array_append(v_flags, 'few_good_options'); end if;

  v_changed := r.chosen_goal_id is distinct from p_goal;
  update public.leader_fit_runs set
    chosen_goal_id = p_goal,
    chosen_degree = (o ->> 'degree')::integer,
    chosen_components = o -> 'parts',
    chosen_flags = v_flags,
    backup_goal_ids = v_backups,
    choices = case when p_count and v_changed then choices + 1 else choices end,
    chosen_at = case when p_count or chosen_at is null then now() else chosen_at end
   where id = p_run;
end;
$$;

-- Makes (or reuses) a run for one set of inputs. Reuses the latest run of the same application when the inputs, the model and the
-- demand are unchanged. A new run carries over the first thought and, when it is still an option, the leader's choice.
create function public.leader_fit_record(p_person uuid, p_app uuid, p_inputs jsonb, p_source text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.leader_fit_models := public.leader_fit_cfg();
  v_season uuid := public.leader_fit_season();
  v_options jsonb;
  v_hash text;
  prev public.leader_fit_runs;
  v_first uuid;
  v_new uuid;
  v_candidates integer;
  v_shown integer;
  v_cur uuid;
  v_backups uuid[];
begin
  if m.version is null then
    raise exception 'No fit model has been approved yet' using errcode = '22023';
  end if;
  v_options := public.leader_fit_snapshot(p_inputs);
  v_candidates := jsonb_array_length(v_options);
  v_shown := (select count(*) from jsonb_array_elements(v_options) e where (e ->> 'rank') is not null and (e ->> 'rank')::integer <= 3);
  v_hash := md5(jsonb_build_object(
      'i', p_inputs, 'm', m.version, 's', v_season,
      'o', (select coalesce(jsonb_agg(jsonb_build_array(e ->> 'goal_id', e -> 'degree', e -> 'gap', e -> 'card_version', e -> 'recommended') order by (e ->> 'ord')::integer), '[]'::jsonb)
              from jsonb_array_elements(v_options) e))::text);

  if p_app is not null then
    select * into prev from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
    if found and prev.inputs_hash = v_hash and prev.model_version = m.version then
      return prev.id;
    end if;
    -- The first thought belongs to the application: the goal named before any result was seen.
    select x.first_goal_id into v_first from public.leader_fit_runs x where x.application_id = p_app order by x.seq asc limit 1;
    if not found then
      select g.id into v_first from public.season_goals g
        join public.communities c on c.id = g.community_id
       where g.slug = p_inputs ->> 'goal' and (p_inputs ->> 'community' is null or c.slug = p_inputs ->> 'community');
    end if;
  end if;

  insert into public.leader_fit_runs (person_id, application_id, season_id, model_version, inputs, inputs_hash, source, candidates, shown,
                                      first_goal_id, judgement_pct, care_pct, options)
  values (p_person, p_app, v_season, m.version, p_inputs, v_hash, p_source, v_candidates, v_shown, v_first,
          nullif(p_inputs ->> 'judgement', '')::numeric, nullif(p_inputs ->> 'care', '')::numeric, v_options)
  returning id into v_new;

  insert into public.leader_fit_recommendations (run_id, rank, goal_id, degree, components, reasons, flags)
  select v_new, (e ->> 'rank')::integer, (e ->> 'goal_id')::uuid, (e ->> 'degree')::integer, e -> 'parts', e -> 'reasons', '{}'
    from jsonb_array_elements(v_options) e
   where (e ->> 'rank') is not null and (e ->> 'rank')::integer <= 3;

  -- A choice made on an earlier run stays while it is still the goal saved in the answers (the form writes the chosen goal there) and
  -- is still an option now. A leader who goes back and names a different goal has moved on: they choose again.
  if prev.id is not null and prev.chosen_goal_id is not null
     and exists (select 1 from jsonb_array_elements(v_options) e where (e ->> 'goal_id')::uuid = prev.chosen_goal_id)
     and exists (
       select 1 from public.leader_applications a
         join public.season_goals g on g.slug = a.answers #>> '{calling,goal}'
         join public.communities c on c.id = g.community_id and c.slug = a.answers #>> '{calling,community}'
        where a.id = p_app and g.id = prev.chosen_goal_id) then
    select coalesce(array_agg(b), '{}') into v_backups
      from unnest(prev.backup_goal_ids) b
     where exists (select 1 from jsonb_array_elements(v_options) e where (e ->> 'goal_id')::uuid = b);
    perform public.leader_fit_apply_choice(v_new, prev.chosen_goal_id, v_backups, false);
    update public.leader_fit_runs set choices = prev.choices, chosen_at = prev.chosen_at where id = v_new;
  end if;

  if v_shown < 3 then
    perform public.write_event(p_person, 'leader_fit.few_options', 'leader_fit_run', v_new::text,
      jsonb_build_object('shown', v_shown, 'options', v_candidates, 'source', p_source));
  end if;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- What each audience is allowed to see
-- ---------------------------------------------------------------------------

-- The inputs for a draft: what the engine reads from the saved answers. Once the leader has chosen, the form writes the chosen
-- goal into their answers; that echo is not a new thought, so while the saved goal is still the chosen one the goal they named
-- (the run's own inputs) is used, and the run is reused when you come back to the screen.
create function public.leader_fit_inputs_for(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  i jsonb;
  r public.leader_fit_runs;
  cur uuid;
begin
  select * into a from public.leader_applications x where x.id = p_app;
  if not found then
    return null;
  end if;
  i := public.leader_fit_inputs(a.answers);
  select * into r from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
  if found and r.chosen_goal_id is not null then
    select g.id into cur
      from public.season_goals g
      join public.communities c on c.id = g.community_id
     where g.slug = i ->> 'goal' and c.slug = i ->> 'community';
    if cur is not null and cur = r.chosen_goal_id then
      i := i || jsonb_build_object('goal', r.inputs -> 'goal', 'community', r.inputs -> 'community');
    end if;
  end if;
  return i;
end;
$$;

-- A small description of one goal, for the screens.
create function public.leader_fit_pick(r public.leader_fit_runs, p_goal uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_goal is null then null else
    (select jsonb_build_object('goal_id', e ->> 'goal_id', 'title', e ->> 'title', 'community', e ->> 'community')
       from jsonb_array_elements(r.options) e where (e ->> 'goal_id')::uuid = p_goal) end;
$$;

-- What the applicant sees. Labelled, reasoned options and their own choice, and nothing else: no judgement, no care result, no
-- parts, no sensitive flag, no model, no weights.
create function public.leader_fit_applicant_view(p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.leader_fit_runs;
  v_mine text;
begin
  select * into r from public.leader_fit_runs x where x.id = p_run;
  v_mine := r.inputs ->> 'community';
  return jsonb_build_object(
    'status', 'ok',
    'run', r.id,
    'options', r.candidates,
    'shown', r.shown,
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'goal_id', e ->> 'goal_id', 'title', e ->> 'title', 'community', e ->> 'community',
               'label', e ->> 'label', 'degree', (e ->> 'degree')::integer, 'reasons', e -> 'reasons')
             order by (e ->> 'rank')::integer)
        from jsonb_array_elements(r.options) e
       where (e ->> 'rank') is not null and (e ->> 'rank')::integer <= 3), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'community_id', x.cid, 'slug', x.cslug, 'community', x.cname, 'mine', x.cslug is not distinct from v_mine, 'options', x.opts)
             order by (x.cslug is not distinct from v_mine) desc, x.csort, x.cname)
        from (
          select e ->> 'community_id' as cid, e ->> 'community_slug' as cslug, e ->> 'community' as cname,
                 (e ->> 'community_sort')::integer as csort,
                 jsonb_agg(
                   jsonb_build_object('goal_id', e ->> 'goal_id', 'title', e ->> 'title', 'label', e ->> 'label')
                   || case when (e ->> 'label') <> 'stretch' then jsonb_build_object('degree', (e ->> 'degree')::integer) else '{}'::jsonb end
                   || case when (e ->> 'care_flag')::boolean then jsonb_build_object('note', 'A pastor will talk with you about this one') else '{}'::jsonb end
                   order by (e ->> 'degree')::integer desc, e ->> 'title') as opts
            from jsonb_array_elements(r.options) e
           where not ((e ->> 'rank') is not null and (e ->> 'rank')::integer <= 3)
           group by 1, 2, 3, 4) x), '[]'::jsonb),
    'choice', case when r.chosen_goal_id is null then null else
      public.leader_fit_pick(r, r.chosen_goal_id) || jsonb_build_object('backups', coalesce((
        select jsonb_agg(public.leader_fit_pick(r, b)) from unnest(r.backup_goal_ids) b), '[]'::jsonb)) end);
end;
$$;

-- The words for a flag. The pastor's panel shows these; the codes are what the database stores.
create function public.leader_fit_flag_text(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'sensitive_below_bar' then 'Chose a sensitive tribe below the care bar'
    when 'no_need_while_needed' then 'Chose a tribe nobody needs while three were needed'
    when 'outside_stage' then 'Chose a tribe outside their stage of life'
    when 'changed_after_results' then 'Changed their pick after seeing the results'
    when 'few_good_options' then 'Fewer than three good options were available'
    else p_code end;
$$;

-- ---------------------------------------------------------------------------
-- The applicant
-- ---------------------------------------------------------------------------

-- Runs the comparison for a draft and returns the screen's data: the best three with their reasons, and every other option by
-- community. If something the engine needs is missing it says what and makes no run. It reuses the last run when the inputs, the
-- model and the demand are the same. It does nothing while Find your tribe is switched off.
create function public.leader_fit_run(p_app uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.leader_applications;
  cfg public.leader_pipeline_settings := public.leader_pipeline_cfg();
  i jsonb;
  miss text[] := '{}';
  v_run uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into a from public.leader_applications x where x.id = p_app;
  if not found or a.person_id <> me then
    raise exception 'We could not find your application' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'Your application has been sent, so it can no longer be changed' using errcode = '22023';
  end if;
  if cfg.tribe_fit is distinct from 'on' then
    raise exception 'Find your tribe is not switched on' using errcode = '22023';
  end if;
  if (public.leader_fit_cfg()).version is null then
    return jsonb_build_object('status', 'no_model');
  end if;

  i := public.leader_fit_inputs_for(p_app);
  if i ->> 'track' is null then miss := array_append(miss, 'track'); end if;
  if i ->> 'community' is null then miss := array_append(miss, 'community'); end if;
  if i ->> 'goal' is null and nullif(btrim(coalesce(a.answers #>> '{calling,goalOther}', '')), '') is null then miss := array_append(miss, 'goal'); end if;
  if i ->> 'lead_best' is null then miss := array_append(miss, 'lead-best'); end if;
  if i ->> 'judgement' is null then miss := array_append(miss, 'scenarios'); end if;
  if cardinality(miss) > 0 then
    return jsonb_build_object('status', 'missing', 'missing', to_jsonb(miss));
  end if;

  v_run := public.leader_fit_record(me, p_app, i, 'application');
  return public.leader_fit_applicant_view(v_run);
end;
$$;

-- Records the choice: one tribe and up to two backups, all from the options of the latest run. Writes the chosen community and goal
-- into the draft's answers and clears a written-in goal. The first thought on the run is never touched. A second, different pick
-- adds one to the count of picks. Returns the saved values so the form can put them in its own state before it saves again.
create function public.leader_fit_choose(p_app uuid, p_goal uuid, p_backups uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.leader_applications;
  cfg public.leader_pipeline_settings := public.leader_pipeline_cfg();
  r public.leader_fit_runs;
  v_goal_slug text;
  v_comm_slug text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into a from public.leader_applications x where x.id = p_app;
  if not found or a.person_id <> me then
    raise exception 'We could not find your application' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'Your application has been sent, so it can no longer be changed' using errcode = '22023';
  end if;
  if cfg.tribe_fit is distinct from 'on' then
    raise exception 'Find your tribe is not switched on' using errcode = '22023';
  end if;
  select * into r from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
  if not found then
    raise exception 'Look at your options first, then choose' using errcode = '22023';
  end if;

  perform public.leader_fit_apply_choice(r.id, p_goal, coalesce(p_backups, '{}'), true);

  select g.slug, c.slug into v_goal_slug, v_comm_slug
    from public.season_goals g join public.communities c on c.id = g.community_id where g.id = p_goal;
  update public.leader_applications
     set answers = jsonb_set(
           coalesce(answers, '{}'::jsonb), '{calling}',
           (coalesce(answers -> 'calling', '{}'::jsonb) - 'goalOther') || jsonb_build_object('community', v_comm_slug, 'goal', v_goal_slug), true)
   where id = p_app;
  perform public.write_event(me, 'leader_fit.chosen', 'leader_application', p_app::text, jsonb_build_object('goal', p_goal));

  return jsonb_build_object('ok', true, 'calling', jsonb_build_object('community', v_comm_slug, 'goal', v_goal_slug),
                            'view', public.leader_fit_applicant_view(r.id));
end;
$$;

-- Their own choice and backups, so the form can pick up where they left off.
create function public.leader_fit_state(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.leader_applications;
  r public.leader_fit_runs;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into a from public.leader_applications x where x.id = p_app;
  if not found or a.person_id <> me then
    raise exception 'We could not find your application' using errcode = 'P0002';
  end if;
  select * into r from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
  if not found then
    return jsonb_build_object('run', null, 'choice', null);
  end if;
  return jsonb_build_object('run', r.id, 'choice', public.leader_fit_applicant_view(r.id) -> 'choice');
end;
$$;

-- ---------------------------------------------------------------------------
-- The pastor's Tribe fit panel
-- ---------------------------------------------------------------------------

-- Shown after the reviewer has scored, so it cannot steer the score. It copies the guard of the first-check scorecard
-- (leader_ai_scorecard): a pastor or director, who decide, always see it; anyone else on the panel only after saving their own
-- review of this application. Read-only: it never changes a score or a decision.
create function public.leader_fit_panel(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  decider boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  can_see boolean;
  r public.leader_fit_runs;
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;
  select * into a from public.leader_applications x where x.id = p_app;
  if not found or a.status in ('draft', 'ineligible') or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  can_see := decider or exists (
    select 1 from public.leader_reviews v where v.application_id = p_app and v.reviewer_id = me and v.stage = 'calling');
  if not can_see then
    return jsonb_build_object('visible', false);
  end if;
  -- The latest run that has a choice; failing that the latest run.
  select * into r from public.leader_fit_runs x where x.application_id = p_app and x.chosen_goal_id is not null order by x.seq desc limit 1;
  if not found then
    select * into r from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
  end if;
  if not found then
    return jsonb_build_object('visible', true, 'run', null);
  end if;
  return jsonb_build_object('visible', true, 'run', jsonb_build_object(
    'run', r.id,
    'first', public.leader_fit_pick(r, r.first_goal_id),
    'wrote_own', r.first_goal_id is null,
    'chosen', public.leader_fit_pick(r, r.chosen_goal_id),
    'degree', r.chosen_degree,
    'label', case when r.chosen_degree is null then null else public.leader_fit_word(r.chosen_degree) end,
    'parts', r.chosen_components,
    'flags', coalesce((select jsonb_agg(jsonb_build_object('code', f, 'text', public.leader_fit_flag_text(f))) from unnest(r.chosen_flags) f), '[]'::jsonb),
    'backups', coalesce((select jsonb_agg(public.leader_fit_pick(r, b)) from unnest(r.backup_goal_ids) b), '[]'::jsonb),
    'others', coalesce((
      select jsonb_agg(jsonb_build_object('title', e ->> 'title', 'community', e ->> 'community', 'degree', (e ->> 'degree')::integer,
                                          'label', e ->> 'label') order by (e ->> 'rank')::integer)
        from jsonb_array_elements(r.options) e
       where (e ->> 'rank') is not null and (e ->> 'rank')::integer <= 3 and (e ->> 'goal_id')::uuid is distinct from r.chosen_goal_id), '[]'::jsonb),
    'picks', r.choices,
    'shown', r.shown,
    'options', r.candidates,
    'model', r.model_version,
    'at', r.ran_at));
end;
$$;

-- ---------------------------------------------------------------------------
-- The model: list, save a new version, approve one
-- ---------------------------------------------------------------------------

create function public.leader_fit_models_list()
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
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see the fit model' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'version', m.version, 'weights', m.weights, 'min_degree', m.min_degree, 'active', m.active, 'notes', m.notes,
             'parent', m.parent_version, 'created_at', m.created_at, 'approved_at', m.approved_at,
             -- A hidden owner's name is never shown
             'approved_by', (select public.person_display_name(p.id) from public.people p where p.id = m.approved_by and not p.hidden))
           order by m.created_at, m.version)
      from public.leader_fit_models m), '[]'::jsonb);
end;
$$;

-- Saving never edits a version: it makes a new, inactive one that points to its parent. Any of the seven numbers may be given;
-- the rest are taken from the parent. The five parts must be whole numbers that add to 100.
create function public.leader_fit_model_save(p_weights jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  parent public.leader_fit_models;
  v_weights jsonb;
  v_next integer;
  v_version text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can change the fit model' using errcode = '42501';
  end if;
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' or p_weights = '{}'::jsonb then
    raise exception 'There is nothing to save' using errcode = '22023';
  end if;
  select * into parent from public.leader_fit_models x order by x.active desc, x.created_at desc, x.version desc limit 1;
  v_weights := parent.weights || p_weights;
  if not public.leader_fit_weights_ok(v_weights) then
    raise exception 'The five parts must be whole numbers that add to 100, and the care bar and the unassessed value whole numbers up to 100' using errcode = '22023';
  end if;
  if char_length(coalesce(p_notes, '')) > 400 then
    raise exception 'The note can be up to 400 characters' using errcode = '22023';
  end if;
  select coalesce(max((substring(version from '^lf-([0-9]+)$'))::integer), 0) + 1 into v_next from public.leader_fit_models;
  v_version := 'lf-' || v_next;
  insert into public.leader_fit_models (version, weights, min_degree, active, notes, parent_version, created_by)
  values (v_version, v_weights, parent.min_degree, false, nullif(btrim(coalesce(p_notes, '')), ''), parent.version, uid);
  perform public.write_event(uid, 'leader_fit.model_saved', 'leader_fit_model', v_version, jsonb_build_object('parent', parent.version));
  return jsonb_build_object('version', v_version, 'active', false);
end;
$$;

-- Makes one version the only active one and records who approved it and when. The previous version is kept.
create function public.leader_fit_model_activate(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.leader_fit_models;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['pastor']::public.app_role[]) then
    raise exception 'Only the pastor can approve the fit model' using errcode = '42501';
  end if;
  select * into m from public.leader_fit_models x where x.version = p_version for update;
  if not found then
    raise exception 'We could not find that version' using errcode = 'P0002';
  end if;
  if m.active then
    return jsonb_build_object('version', m.version, 'active', true, 'already', true);
  end if;
  update public.leader_fit_models set active = false where active;
  update public.leader_fit_models set active = true, approved_by = uid, approved_at = now() where version = p_version;
  perform public.write_event(uid, 'leader_fit.model_approved', 'leader_fit_model', p_version, '{}'::jsonb);
  return jsonb_build_object('version', p_version, 'active', true, 'already', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leaders we already have: a quiet run
-- ---------------------------------------------------------------------------

-- Runs the engine for everyone who holds the leader or assistant leader role, from the answers saved on their approved application,
-- once per model version, and stores the runs as "quiet". No choice is made and nobody's tribe, role or answers are touched.
create function public.leader_fit_quiet_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.leader_fit_models := public.leader_fit_cfg();
  r record;
  i jsonb;
  v_ran integer := 0;
  v_already integer := 0;
  v_no_inputs integer := 0;
  v_no_app integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can run this' using errcode = '42501';
  end if;
  if m.version is null then
    raise exception 'The pastorate needs to approve a fit model first' using errcode = '22023';
  end if;
  for r in
    select p.id as person_id,
           (select a.id from public.leader_applications a
             where a.person_id = p.id and a.status in ('approved_leader', 'approved_assistant')
             order by a.decided_at desc nulls last, a.created_at desc limit 1) as app_id
      from public.people p
     where exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
       and not p.hidden
     order by p.id
  loop
    if r.app_id is null then
      v_no_app := v_no_app + 1;
      continue;
    end if;
    if exists (select 1 from public.leader_fit_runs x where x.person_id = r.person_id and x.source = 'quiet' and x.model_version = m.version) then
      v_already := v_already + 1;
      continue;
    end if;
    i := public.leader_fit_inputs((select a.answers from public.leader_applications a where a.id = r.app_id));
    if i ->> 'track' is null or i ->> 'lead_best' is null or i ->> 'judgement' is null then
      v_no_inputs := v_no_inputs + 1;
      continue;
    end if;
    -- No application is passed: a quiet run belongs to the person, is never reused from an earlier application run, and carries no choice
    perform public.leader_fit_record(r.person_id, null, i, 'quiet');
    v_ran := v_ran + 1;
  end loop;
  perform public.write_event(uid, 'leader_fit.quiet_run', 'leader_fit_model', m.version,
    jsonb_build_object('ran', v_ran, 'already', v_already, 'no_inputs', v_no_inputs, 'no_application', v_no_app));
  return jsonb_build_object('model', m.version, 'ran', v_ran, 'already', v_already, 'no_inputs', v_no_inputs, 'no_application', v_no_app);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Everything above is internal except the eight names the app calls. Internal functions are closed to every client role.
revoke execute on function
  public.leader_fit_weights_ok(jsonb), public.leader_fit_models_guard(), public.leader_fit_cfg(), public.leader_fit_season(),
  public.leader_scenario_score(jsonb, text[]), public.leader_fit_inputs(jsonb), public.goal_demand_rows(uuid),
  public.leader_fit_options(jsonb), public.leader_fit_reasons(public.leader_fit_option, text), public.leader_fit_word(integer),
  public.leader_fit_snapshot(jsonb), public.leader_fit_apply_choice(uuid, uuid, uuid[], boolean),
  public.leader_fit_record(uuid, uuid, jsonb, text), public.leader_fit_inputs_for(uuid),
  public.leader_fit_pick(public.leader_fit_runs, uuid), public.leader_fit_applicant_view(uuid), public.leader_fit_flag_text(text)
  from public, anon, authenticated;
revoke execute on function
  public.leader_fit_run(uuid), public.leader_fit_choose(uuid, uuid, uuid[]), public.leader_fit_state(uuid), public.leader_fit_panel(uuid),
  public.leader_fit_models_list(), public.leader_fit_model_save(jsonb, text), public.leader_fit_model_activate(text),
  public.leader_fit_quiet_all()
  from public, anon;
grant execute on function
  public.leader_fit_run(uuid), public.leader_fit_choose(uuid, uuid, uuid[]), public.leader_fit_state(uuid), public.leader_fit_panel(uuid),
  public.leader_fit_models_list(), public.leader_fit_model_save(jsonb, text), public.leader_fit_model_activate(text),
  public.leader_fit_quiet_all()
  to authenticated;

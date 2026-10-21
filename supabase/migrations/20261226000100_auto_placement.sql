-- =============================================================================
-- United Tribes: automatic tribe placement and bulk leaders (God Mode only)
--
-- Some members never open the platform to choose a tribe. This lets the platform owner place them automatically, in bulk, by the
-- Degree of Compatibility the app already calculates, and tell the leader who is on their team. It also appoints many leaders in one
-- run. It changes no existing function, table or default: new functions call or sit beside the old ones, and four columns are added to
-- tribe_members (all with a default, so every existing row means what it did before).
--
--   placement_settings      one switch (Off, Rehearsal, On) and the church's choices: grace days, seats kept free, smallest tribe, sending pace
--   placement_runs          one row for each run: who was in the pool, the settings it used, where it has got to
--   placement_items         one row for each member in a run: what the plan proposed, what happened, and the message that went to them
--   placement_teams         one row for each tribe in a run: the hold-off before its leader is told, and whether it is too small
--   placement_tokens        the hash of the private link in a member's email. The link itself is never kept
--   placement_holds         members God Mode has put on hold. A hold stays until it is lifted
--   placement_leader_runs   one row for each bulk-leader run
--   placement_leader_items  one row for each person in a bulk-leader run: the tribe proposed for them and what happened
--
-- The rules every function below follows:
--   * every function the console calls begins god_only(), which also needs the owner to be unlocked on this sign-in
--   * the switch starts Off. A switch that cannot be read counts as Off: the strictest answer
--   * nobody under 18 is ever in a pool, and nothing from here is sent to anyone under 18
--   * a member who chose a tribe themselves is never moved; a member who withdrew consent, or asked to be deleted, is left out
--     again at the very moment of placing
--   * the Degree of Compatibility is not recalculated here: placement_candidates reads the same parts, in the same order, as
--     match_candidates, and a database test fails if the two ever differ
--   * the standard welcome and "someone joined" emails the join trigger writes are withdrawn in the same transaction, and replaced
--     by the messages in 20261226000100 (placement_your_tribe, placement_your_team)
--   * the owner is never named: messages come from the church office, and the office sees "placed by the church"
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.placement_settings (
  singleton boolean primary key default true check (singleton),
  -- off: nothing works. rehearsal: plans are built and the messages that would go are written to the log, nobody is placed, nothing is
  -- sent. on: runs place people and send.
  mode text not null default 'off' check (mode in ('off', 'rehearsal', 'on')),
  -- Days since a member last ran the matching or changed their answers before they can be placed
  grace_days smallint not null default 7 check (grace_days between 0 and 30),
  -- Seats kept free in every tribe for members who still choose for themselves
  seats_free smallint not null default 1 check (seats_free between 0 and 2),
  -- The smallest tribe a run will fill
  min_tribe smallint not null default 5 check (min_tribe between 4 and 8),
  -- Member emails go out no faster than this, inside the window (hours in Lagos). The platform already sends nothing from 10 pm to 6 am.
  pace_per_hour integer not null default 100 check (pace_per_hour between 1 and 1000),
  send_from smallint not null default 9 check (send_from between 6 and 20),
  send_until smallint not null default 19 check (send_until between 7 and 21),
  -- How long a member has to say "don't share my details" before their leader is told who is on the team
  hold_hours smallint not null default 24 check (hold_hours between 0 and 72),
  -- One reminder, this many days after the first message, to a member who has not confirmed
  reminder_days smallint not null default 5 check (reminder_days between 1 and 14),
  updated_at timestamptz not null default now(),
  check (send_until > send_from)
);
insert into public.placement_settings (singleton) values (true);

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
create table public.placement_runs (
  id uuid primary key default gen_random_uuid(),
  seq integer generated always as identity,
  season_id uuid not null references public.seasons (id),
  -- planning: the pool is being scored. planned: ready to read and adjust. approved: frozen. placing: batches are going in.
  -- placed: everyone is in. closed: every leader has been told. undone / cancelled: final.
  status text not null default 'planning' check (status in ('planning', 'planned', 'approved', 'placing', 'placed', 'closed', 'undone', 'cancelled')),
  phase text not null default 'count' check (phase in ('count', 'assign', 'check', 'ready')),
  -- A rehearsal builds a plan and writes the messages to the log. It places nobody and sends nothing.
  rehearsal boolean not null default false,
  scope_community uuid references public.communities (id),
  scope_zone text check (scope_zone in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad')),
  -- The settings this run used, copied so a later change does not rewrite history
  grace_days smallint not null,
  seats_free smallint not null,
  min_tribe smallint not null,
  pace_per_hour integer not null,
  send_from smallint not null,
  send_until smallint not null,
  hold_hours smallint not null,
  model_version text references public.match_models (version),
  -- Tribes the plan has been told not to try (God Mode chose "try their next-best tribes" for a tribe that was too small)
  excluded_tribes uuid[] not null default '{}',
  pool integer not null default 0,
  -- How many member messages have been queued: the counter the sending pace is worked out from
  told integer not null default 0,
  created_at timestamptz not null default now(),
  planned_at timestamptz,
  approved_at timestamptz,
  placed_at timestamptz,
  closed_at timestamptz,
  undone_at timestamptz,
  check ((status = 'undone') = (undone_at is not null))
);
-- One run at a time that is not finished: two cannot compete for the same seats
create unique index placement_runs_one_open on public.placement_runs ((true))
  where status in ('planning', 'planned', 'approved', 'placing');

-- A run moves through fixed states. A retried batch, a double press and a reload change nothing.
create function public.placement_run_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not ((old.status, new.status) in (
       ('planning', 'planned'), ('planning', 'cancelled'),
       ('planned', 'approved'), ('planned', 'cancelled'),
       ('approved', 'placing'), ('approved', 'placed'), ('approved', 'cancelled'),
       ('placing', 'placed'),
       ('placed', 'closed'), ('placed', 'undone'))) then
    raise exception 'A run cannot go from % to %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger placement_runs_guard before update on public.placement_runs for each row execute function public.placement_run_guard();

create table public.placement_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.placement_runs (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- pooled: in the pool, not yet scored. counted: scored once, waiting to be assigned. proposed: the plan puts them in tribe_id.
  -- unplaced: left out (reason says why). held / removed: God Mode took them out of this run. placed: in the tribe. rehearsed: a
  -- rehearsal wrote the message and placed nobody. skipped: the plan said yes but something changed before the moment of placing.
  -- undone: the run was undone and they were released.
  status text not null default 'pooled' check (status in ('pooled', 'counted', 'proposed', 'unplaced', 'held', 'removed', 'placed', 'rehearsed', 'skipped', 'undone')),
  reason text check (reason ~ '^[a-z0-9_]{2,40}$'),
  tribe_id uuid references public.tribes (id) on delete set null,
  degree smallint check (degree between 0 and 100),
  -- How many tribes suited them at 60 or more on the first pass, and the best of them: the plan goes hardest first
  cand_count integer,
  best_degree smallint,
  form_at timestamptz,
  -- The order the plan assigned people in
  seq integer,
  -- The next-best tribes, so God Mode can move someone with the degree in front of them
  alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(alternatives) = 'array'),
  moved boolean not null default false,
  placement_id uuid references public.tribe_members (id) on delete set null,
  placed_at timestamptz,
  member_message uuid references public.messages (id) on delete set null,
  slot_at timestamptz,
  -- What a rehearsal would have sent, so it can be read
  rehearsal jsonb,
  unique (run_id, person_id)
);
create index placement_items_status_idx on public.placement_items (run_id, status);
create index placement_items_tribe_idx on public.placement_items (run_id, tribe_id) where status in ('proposed', 'placed', 'rehearsed');
create index placement_items_person_idx on public.placement_items (person_id);

create table public.placement_teams (
  run_id uuid not null references public.placement_runs (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  -- Members in the tribe when the plan was made, and how many the plan proposed
  active_before integer not null default 0,
  proposed integer not null default 0,
  -- The tribe would end with fewer than the smallest tribe a run will fill. God Mode decides: keep, hold, or retry.
  small boolean not null default false,
  decision text check (decision in ('keep', 'hold', 'retry')),
  -- The leader's email: queued once, when every member has been told and the hold-off has passed
  mail_queued_at timestamptz,
  cancelled_at timestamptz,
  primary key (run_id, tribe_id)
);

create table public.placement_tokens (
  token_hash text primary key,
  placement_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  expires_at timestamptz not null,
  clicks integer not null default 0,
  created_at timestamptz not null default now()
);
create index placement_tokens_placement_idx on public.placement_tokens (placement_id);

create table public.placement_holds (
  person_id uuid primary key references public.people (id) on delete cascade,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bulk leaders
-- ---------------------------------------------------------------------------
create table public.placement_leader_runs (
  id uuid primary key default gen_random_uuid(),
  seq integer generated always as identity,
  season_id uuid not null references public.seasons (id),
  status text not null default 'planned' check (status in ('planned', 'approved', 'applying', 'done', 'cancelled')),
  -- People who could not be paired, with the reason in words: not on the platform, no goal needs them, and so on
  left_over jsonb not null default '[]'::jsonb check (jsonb_typeof(left_over) = 'array'),
  -- Goals that still have no leader after the plan
  open_goals jsonb not null default '[]'::jsonb check (jsonb_typeof(open_goals) = 'array'),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  done_at timestamptz
);
create unique index placement_leader_runs_one_open on public.placement_leader_runs ((true)) where status in ('planned', 'approved', 'applying');

create table public.placement_leader_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.placement_leader_runs (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- approved: an approved leader with no tribe, using their saved application. sheet: someone the church knows, with a short form.
  source text not null check (source in ('approved', 'sheet')),
  form jsonb check (form is null or jsonb_typeof(form) = 'object'),
  goal_id uuid references public.season_goals (id),
  degree smallint check (degree between 0 and 100),
  label text,
  status text not null default 'proposed' check (status in ('proposed', 'removed', 'applied', 'failed')),
  reason text check (char_length(reason) <= 300),
  tribe_id uuid references public.tribes (id) on delete set null,
  applied_at timestamptz,
  unique (run_id, person_id)
);
create index placement_leader_items_run_idx on public.placement_leader_items (run_id, status);

-- ---------------------------------------------------------------------------
-- What a placed member's row carries (all four with a default, so every existing row keeps its meaning)
-- ---------------------------------------------------------------------------
alter table public.tribe_members
  add column placed_by_run uuid references public.placement_runs (id) on delete set null,
  add column placement_source text not null default 'self' check (placement_source in ('self', 'auto')),
  add column confirmed_at timestamptz,
  add column contact_withheld boolean not null default false;
create index tribe_members_placed_idx on public.tribe_members (placed_by_run) where placed_by_run is not null;

alter table public.placement_settings enable row level security;
alter table public.placement_runs enable row level security;
alter table public.placement_items enable row level security;
alter table public.placement_teams enable row level security;
alter table public.placement_tokens enable row level security;
alter table public.placement_holds enable row level security;
alter table public.placement_leader_runs enable row level security;
alter table public.placement_leader_items enable row level security;
-- No grants: only the functions touch these tables.

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

-- The switch. A value that cannot be read counts as Off: the strictest answer.
create function public.placement_mode()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select s.mode into v from public.placement_settings s where s.singleton;
  return case when v in ('off', 'rehearsal', 'on') then v else 'off' end;
exception when others then
  return 'off';
end;
$$;

-- The lowest Degree of Compatibility the app shows a member: the active model's own floor (60 today). Nothing here changes it.
create function public.placement_floor()
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select m.min_degree from public.match_models m where m.active), 60) $$;

-- Why a member is not in the pool: null means they are. Reasons are plain codes the screens put into words.
--   leader         holds the leader or assistant leader role, so runs a tribe rather than joining one
--   held           God Mode has put them on hold
--   needs_form     has not finished the Find my tribe form, so there is nothing to score
--   no_consent     has not agreed to matching, or has withdrawn it
--   under18        is under 18: tribes for young people are never filled by a run
--   deletion_open  has asked to be deleted
--   cannot_email   their address bounces or they asked us to stop emailing: they could not be told
--   other_season   filled the form for another season
--   in_grace       ran the matching or changed their answers inside the grace period
create function public.placement_pool_reason(p_person uuid, p_season uuid, p_grace integer default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  mp public.member_profiles%rowtype;
  v_block text;
  v_grace integer := coalesce(p_grace, (select s.grace_days from public.placement_settings s where s.singleton), 7);
  v_last timestamptz;
begin
  if exists (select 1 from public.person_roles x where x.person_id = p_person and x.role in ('leader', 'assistant_leader')) then
    return 'leader';
  end if;
  if exists (select 1 from public.placement_holds h where h.person_id = p_person) then
    return 'held';
  end if;
  select * into mp from public.member_profiles x where x.person_id = p_person;
  if not found then
    return 'needs_form';
  end if;
  if not public.consent_granted(p_person, 'matching') then
    return 'no_consent';
  end if;
  if public.is_minor(p_person) then
    return 'under18';
  end if;
  v_block := public.message_blocker(p_person);
  if v_block = 'deletion' then
    return 'deletion_open';
  elsif v_block = 'under18' then
    return 'under18';
  elsif v_block is not null then
    return 'cannot_email';
  end if;
  if p_season is not null and mp.season_id is not null and mp.season_id <> p_season then
    return 'other_season';
  end if;
  -- The member's own activity: when they last changed their answers or ran the matching. The run a church placement writes does not count
  -- once that placement has been undone: the member never chose anything, and the next run may consider them straight away.
  v_last := greatest(mp.updated_at, coalesce((select max(r.ran_at) from public.match_runs r where r.person_id = p_person
                                               and not exists (select 1 from public.tribe_members tm where tm.run_id = r.id and tm.release_reason = 'Placement undone by the church')),
                                              mp.updated_at));
  if v_grace > 0 and v_last > now() - make_interval(days => v_grace) then
    return 'in_grace';
  end if;
  return null;
end;
$$;

-- When the k-th message of a run (counting from 0) is due, so a run never sends faster than the church's pace. Time counts only inside
-- the sending window each day (hours in Lagos); what does not fit today rolls to the start of the window tomorrow.
create function public.placement_slot(p_anchor timestamptz, p_pace integer, p_from integer, p_until integer, p_k integer)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_len numeric := (p_until - p_from) * 3600;
  v_local timestamp := p_anchor at time zone 'Africa/Lagos';
  v_day timestamp := date_trunc('day', v_local);
  v_sec numeric := extract(epoch from (v_local - v_day));
  v_a numeric := least(greatest(v_sec - p_from * 3600, 0), v_len);
  v_total numeric := v_a + p_k * (3600.0 / greatest(p_pace, 1));
  v_days integer := floor(v_total / v_len);
  v_in numeric := v_total - v_days * v_len;
begin
  return (v_day + make_interval(days => v_days) + make_interval(secs => (p_from * 3600 + v_in)::double precision)) at time zone 'Africa/Lagos';
end;
$$;

-- ---------------------------------------------------------------------------
-- The scorer. This is match_candidates, part for part (the same rules, the same seven weighted parts, the same order), with three
-- differences that only apply inside a run (p_run is not null):
--   1. the people already proposed for a tribe earlier in the run count as members of it, for capacity and for the health rules, so
--      a run plans every tribe as it will look at the end, not one person at a time;
--   2. the seats the run keeps free for members who still choose for themselves are not offered;
--   3. a tribe built on a sensitive ready-made card is offered only to a member who chose that very goal, and a tribe God Mode told
--      the plan not to try is left out.
-- With p_run null it is exactly match_candidates, and tests/db/placement-scorer.test.ts fails if the two ever give a different degree.
-- ---------------------------------------------------------------------------
create function public.placement_candidates(p_person uuid, p_run uuid default null)
returns table (
  r_tribe uuid, r_degree integer, r_goal numeric, r_stage numeric, r_community numeric, r_place numeric, r_style numeric,
  r_rhythm numeric, r_faith numeric, r_balance numeric, r_affinity numeric, r_online boolean, r_seats integer, r_published timestamptz)
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
  v_free integer := 0;
  v_skip uuid[] := '{}';
begin
  if p_run is not null then
    select r.seats_free, r.excluded_tribes into v_free, v_skip from public.placement_runs r where r.id = p_run;
    v_free := coalesce(v_free, 0);
    v_skip := coalesce(v_skip, '{}');
  end if;
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
    select c.id, c.capacity, c.leader_id, c.community_id, c.track_id, c.season_goal_id, c.meeting_mode, c.zone, c.published_at,
           sg.family_id as goal_family,
           (select a.answers #>> '{style,leadBest}'
              from public.leader_applications a
             where a.person_id = c.leader_id and a.status = 'approved_leader'
             order by a.decided_at desc nulls last limit 1) as lead_style
      from public.tribes c
      left join public.season_goals sg on sg.id = c.season_goal_id
     where c.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
       and (me.season_id is null or c.season_id = me.season_id)
       and (c.track_id = my_track
            or (me.open_to_adjacent and not my_minor
                and exists (select 1 from public.tracks ct
                             where ct.id = c.track_id and ct.active and ct.slug <> 'teens' and abs(ct.sort - my_sort) = 1)))
       and (not my_minor or c.assistant_id is not null)
       and c.leader_id <> p_person
       and (c.assistant_id is null or c.assistant_id <> p_person)
       and (cardinality(me.meeting_times) = 0 or c.slot = any (me.meeting_times))
       and (me.meeting_mode = 'either' or me.meeting_mode::text = c.meeting_mode)
       and (c.meeting_mode = 'online' or me.zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
       and (case c.tribe_type
              when 'mixed' then me.tribe_mix <> 'same_gender'
              when 'women' then me.gender = 'female' and me.tribe_mix <> 'mixed'
              when 'men'   then me.gender = 'male'   and me.tribe_mix <> 'mixed'
              else false end)
       -- inside a run only: a sensitive tribe is for those who chose that goal; a tribe the plan was told not to try is left out
       and (p_run is null
            or me.season_goal_id is not distinct from c.season_goal_id
            or not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = c.season_goal_id and t.sensitive))
       and not (c.id = any (v_skip))
  ),
  -- Who is in each tribe: the members it has, and (inside a run) the people proposed for it earlier in this run
  roster as (
    select cm.tribe_id, cm.person_id
      from public.tribe_members cm
     where cm.status = 'active' and cm.tribe_id in (select x.id from pool x)
    union all
    select i.tribe_id, i.person_id
      from public.placement_items i
     where p_run is not null and i.run_id = p_run and i.status = 'proposed' and i.person_id <> p_person
       and i.tribe_id in (select x.id from pool x)
  ),
  mix as (
    select p.id as cid,
           count(ro.person_id) as n,
           coalesce(sum(mp.style_social), 0) as soc_sum,
           count(*) filter (where mp.style_social = -1) as quiet_n,
           count(*) filter (where mp.style_social = 1) as lively_n,
           count(*) filter (where mp.faith_journey in ('established', 'leading')) as est_n,
           count(*) filter (where mp.faith_journey = me.faith_journey) as same_stage_n,
           count(*) filter (where mp.support_load >= 2) as heavy_n
      from pool p
      left join roster ro on ro.tribe_id = p.id
      left join public.member_profiles mp on mp.person_id = ro.person_id
     group by p.id
  ),
  open_ones as (
    select p.*, x.n, x.soc_sum, x.same_stage_n
      from pool p
      join mix x on x.cid = p.id
     where p.capacity - x.n >= 1 + v_free
       and not (my_heavy and x.heavy_n >= 2)
       and greatest(0, 2 - (x.est_n + case when my_est then 1 else 0 end)) <= p.capacity - x.n - 1
       and ((case when (x.quiet_n + (case when me.style_social = -1 then 1 else 0 end)) = 0 then 1 else 0 end)
          + (case when (x.lively_n + (case when me.style_social = 1 then 1 else 0 end)) = 0 then 1 else 0 end)) <= p.capacity - x.n - 1
  ),
  comp as (
    select o.id, o.capacity, o.n, o.published_at, (o.meeting_mode = 'online') as online,
           case when o.season_goal_id = me.season_goal_id then 1.0
                when me.season_goal_id is not null and o.goal_family = my_family then 0.6
                else 0.2 end as c_goal,
           case when o.track_id = my_track then 1.0 else 0.5 end as c_stage,
           case when me.community_id is not null and o.community_id = me.community_id then 1.0
                when me.second_community_id is not null and o.community_id = me.second_community_id then 0.7
                when my_family is not null and o.goal_family = my_family then 0.3
                else 0.1 end as c_community,
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
           case when cardinality(me.group_roles) = 0 then null
                else (select avg(case when (select count(*)
                                              from roster ro2
                                              join public.member_profiles mp2 on mp2.person_id = ro2.person_id
                                             where ro2.tribe_id = o.id and r = any (mp2.group_roles)) < 2
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
         + (w ->> 'community')::numeric * k.c_community + (w ->> 'place')::numeric * k.c_place
         + (w ->> 'style')::numeric * (0.5 * k.c_balance + 0.5 * k.c_affinity)
         + (w ->> 'rhythm')::numeric * k.c_rhythm + (w ->> 'faith')::numeric * k.c_faith)::integer,
         k.c_goal, k.c_stage, k.c_community, k.c_place, (0.5 * k.c_balance + 0.5 * k.c_affinity), k.c_rhythm, k.c_faith,
         k.c_balance, k.c_affinity, k.online, (k.capacity - k.n)::integer, k.published_at
    from scored k;
end;
$$;

-- ---------------------------------------------------------------------------
-- Planning, one batch at a time. A run for thousands of members is split so no single call is long: the pool is scored 200 people a
-- call, then assigned 200 a call, then checked. Everything here is internal; the console reaches it through placement_run_step.
-- ---------------------------------------------------------------------------

-- Keeps the per-tribe rows in step with what the plan now proposes. A tribe is "small" when it would end with fewer members than the
-- run is willing to fill (or than its own capacity, if that is lower than the run's smallest tribe).
create function public.placement_teams_refresh(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
begin
  select * into r from public.placement_runs x where x.id = p_run;
  if not found then
    return;
  end if;
  insert into public.placement_teams (run_id, tribe_id, active_before, proposed)
  select p_run, i.tribe_id,
         (select count(*)::integer from public.tribe_members m where m.tribe_id = i.tribe_id and m.status = 'active'),
         count(*)::integer
    from public.placement_items i
   where i.run_id = p_run and i.status = 'proposed' and i.tribe_id is not null
   group by i.tribe_id
  on conflict (run_id, tribe_id) do update set active_before = excluded.active_before, proposed = excluded.proposed;

  update public.placement_teams t set proposed = 0
   where t.run_id = p_run
     and not exists (select 1 from public.placement_items i where i.run_id = p_run and i.tribe_id = t.tribe_id and i.status = 'proposed');

  update public.placement_teams t
     set small = (t.proposed > 0 and t.active_before + t.proposed < least(r.min_tribe, tr.capacity))
    from public.tribes tr
   where tr.id = t.tribe_id and t.run_id = p_run;

  -- A decision to keep a small tribe only stands while the tribe is still small. "Hold" and "retry" are a record of what was chosen.
  update public.placement_teams t set decision = null where t.run_id = p_run and not t.small and t.decision = 'keep';
  update public.placement_teams t set decision = null where t.run_id = p_run and t.small and t.decision in ('hold', 'retry');
end;
$$;

-- The first pass: for each person, why they are out of the pool (if they are) or how many tribes suit them at the floor or better.
create function public.placement_count_batch(p_run uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  v_floor integer := public.placement_floor();
  v_reason text;
  n integer;
  best integer;
  v_any boolean;
  done integer := 0;
  v_start timestamptz := clock_timestamp();
begin
  select * into r from public.placement_runs x where x.id = p_run;
  for i in
    select x.* from public.placement_items x where x.run_id = p_run and x.status = 'pooled' order by x.id limit greatest(p_limit, 1) for update
  loop
    -- A step is kept short: after about four seconds it stops, and the page asks for the next one
    exit when done > 0 and clock_timestamp() - v_start > interval '4 seconds';
    v_reason := public.placement_pool_reason(i.person_id, r.season_id, r.grace_days);
    if v_reason is not null then
      update public.placement_items set status = 'unplaced', reason = v_reason where id = i.id;
    else
      select count(*) filter (where c.r_degree >= v_floor)::integer, max(c.r_degree) filter (where c.r_degree >= v_floor), count(*) > 0
        into n, best, v_any
        from public.placement_candidates(i.person_id, p_run) c;
      update public.placement_items
         set cand_count = n, best_degree = best,
             form_at = (select mp.submitted_at from public.member_profiles mp where mp.person_id = i.person_id),
             status = case when n = 0 then 'unplaced' else 'counted' end,
             reason = case when n = 0 then (case when v_any then 'below_bar' else 'no_tribe' end) end
       where id = i.id;
    end if;
    done := done + 1;
  end loop;
  return done;
end;
$$;

-- The second pass: hardest first (the fewest suitable tribes, then the earliest form), each person takes the tribe the app would have
-- shown them as card number one, counting the people already proposed for it. Below the floor they are left out. Two runs on the same
-- data give the same plan: every tie ends at the person's or the tribe's id.
create function public.placement_assign_batch(p_run uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.placement_items;
  v_tribe uuid;
  v_degree integer;
  v_floor integer := public.placement_floor();
  v_seq integer := coalesce((select max(x.seq) from public.placement_items x where x.run_id = p_run), 0);
  v_alt jsonb;
  done integer := 0;
  v_start timestamptz := clock_timestamp();
begin
  for i in
    select x.* from public.placement_items x where x.run_id = p_run and x.status = 'counted'
     order by x.cand_count, x.form_at nulls last, x.person_id limit greatest(p_limit, 1) for update
  loop
    -- A step is kept short: after about four seconds it stops, and the page asks for the next one
    exit when done > 0 and clock_timestamp() - v_start > interval '4 seconds';
    -- One look at the tribes: the first is the one they take, the next three are kept as the other choices
    select (array_agg(z.r_tribe order by z.n) filter (where z.n = 1))[1],
           (array_agg(z.r_degree order by z.n) filter (where z.n = 1))[1],
           coalesce(jsonb_agg(jsonb_build_object('tribe', z.r_tribe, 'degree', z.r_degree) order by z.n) filter (where z.n between 2 and 4), '[]'::jsonb)
      into v_tribe, v_degree, v_alt
      from (select k.r_tribe, k.r_degree,
                   row_number() over (order by k.r_degree desc, k.r_goal desc, k.r_community desc, k.r_published asc nulls last, k.r_tribe) as n
              from public.placement_candidates(i.person_id, p_run) k
             where k.r_degree >= v_floor) z;
    if v_tribe is null then
      update public.placement_items set status = 'unplaced', reason = 'full' where id = i.id;
    else
      v_seq := v_seq + 1;
      update public.placement_items
         set status = 'proposed', tribe_id = v_tribe, degree = v_degree, seq = v_seq, alternatives = v_alt
       where id = i.id;
    end if;
    done := done + 1;
  end loop;
  return done;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the console calls (each begins god_only())
-- ---------------------------------------------------------------------------

-- The settings, as the Placement page shows them
create function public.placement_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.placement_settings;
begin
  perform public.god_only();
  select * into s from public.placement_settings x where x.singleton;
  return jsonb_build_object(
    'mode', public.placement_mode(), 'grace_days', s.grace_days, 'seats_free', s.seats_free, 'min_tribe', s.min_tribe,
    'pace_per_hour', s.pace_per_hour, 'send_from', s.send_from, 'send_until', s.send_until, 'hold_hours', s.hold_hours,
    'reminder_days', s.reminder_days, 'floor', public.placement_floor());
end;
$$;

-- Changes the switch and the church's choices. Only the fields named are changed; each is checked, and the change is written to the
-- owner's own record.
create function public.placement_settings_save(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  s public.placement_settings;
  v_mode text;
  v_int integer;
begin
  perform public.god_only();
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Say what to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('mode', 'grace_days', 'seats_free', 'min_tribe', 'pace_per_hour', 'send_from', 'send_until', 'hold_hours', 'reminder_days') then
      raise exception 'That setting does not exist' using errcode = '22023';
    end if;
  end loop;
  select * into s from public.placement_settings x where x.singleton for update;
  if p_changes ? 'mode' then
    v_mode := p_changes ->> 'mode';
    if v_mode is null or v_mode not in ('off', 'rehearsal', 'on') then
      raise exception 'Choose Off, Rehearsal or On' using errcode = '22023';
    end if;
    s.mode := v_mode;
  end if;
  foreach k in array array['grace_days', 'seats_free', 'min_tribe', 'pace_per_hour', 'send_from', 'send_until', 'hold_hours', 'reminder_days'] loop
    continue when not (p_changes ? k);
    if jsonb_typeof(p_changes -> k) is distinct from 'number' or (p_changes ->> k) !~ '^[0-9]{1,4}$' then
      raise exception 'Use a whole number for %', replace(k, '_', ' ') using errcode = '22023';
    end if;
    v_int := (p_changes ->> k)::integer;
    case k
      when 'grace_days' then s.grace_days := v_int;
      when 'seats_free' then s.seats_free := v_int;
      when 'min_tribe' then s.min_tribe := v_int;
      when 'pace_per_hour' then s.pace_per_hour := v_int;
      when 'send_from' then s.send_from := v_int;
      when 'send_until' then s.send_until := v_int;
      when 'hold_hours' then s.hold_hours := v_int;
      when 'reminder_days' then s.reminder_days := v_int;
    end case;
  end loop;
  begin
    update public.placement_settings
       set mode = s.mode, grace_days = s.grace_days, seats_free = s.seats_free, min_tribe = s.min_tribe, pace_per_hour = s.pace_per_hour,
           send_from = s.send_from, send_until = s.send_until, hold_hours = s.hold_hours, reminder_days = s.reminder_days, updated_at = now()
     where singleton;
  exception when check_violation then
    raise exception 'One of those numbers is outside what is allowed. Grace 0 to 30 days, seats kept free 0 to 2, smallest tribe 4 to 8, pace 1 to 1000 an hour, sending between 6 am and 9 pm' using errcode = '22023';
  end;
  perform public.write_event(auth.uid(), 'placement.settings', 'placement', 'settings', p_changes);
  return public.placement_settings_get();
end;
$$;

-- Starts a run: the pool is the members of the church who hold no seat this season, optionally for one community or zone (a pilot).
-- Nothing is placed. The people are listed, and the next calls (placement_run_step) score them, assign them and check the tribes.
create function public.placement_run_new(p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placement_settings;
  k text;
  v_season uuid;
  v_community uuid;
  v_zone text;
  v_model text;
  v_run uuid := gen_random_uuid();
  v_pool integer;
  v_centre uuid;
  o jsonb := coalesce(p_options, '{}'::jsonb);
begin
  perform public.god_only();
  if public.placement_mode() = 'off' then
    raise exception 'Placement is switched Off. Switch it to Rehearsal or On first' using errcode = '22023';
  end if;
  if jsonb_typeof(o) is distinct from 'object' then
    raise exception 'Say what to plan' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(o) loop
    if k not in ('season', 'community', 'zone', 'grace_days', 'seats_free', 'min_tribe', 'pace_per_hour') then
      raise exception 'That choice does not exist' using errcode = '22023';
    end if;
  end loop;
  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  if v_model is null then
    raise exception 'There is no active matching model, so nobody can be scored' using errcode = '22023';
  end if;
  v_season := coalesce(nullif(o ->> 'season', '')::uuid, public.leader_fit_season());
  select se.centre_id into v_centre from public.seasons se
   where se.id = v_season and se.status in ('planning', 'open') and se.starts_on > public.today_lagos();
  if v_centre is null then
    raise exception 'Choose a season that has not started' using errcode = '22023';
  end if;
  v_community := nullif(o ->> 'community', '')::uuid;
  if v_community is not null and not exists (select 1 from public.communities c where c.id = v_community) then
    raise exception 'That community does not exist' using errcode = '22023';
  end if;
  v_zone := nullif(o ->> 'zone', '');
  if v_zone is not null and v_zone not in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad') then
    raise exception 'That area does not exist' using errcode = '22023';
  end if;

  begin
    insert into public.placement_runs (id, season_id, rehearsal, scope_community, scope_zone, grace_days, seats_free, min_tribe, pace_per_hour,
                                       send_from, send_until, hold_hours, model_version)
    values (v_run, v_season, public.placement_mode() = 'rehearsal', v_community, v_zone,
            coalesce((o ->> 'grace_days')::integer, s.grace_days), coalesce((o ->> 'seats_free')::integer, s.seats_free),
            coalesce((o ->> 'min_tribe')::integer, s.min_tribe), coalesce((o ->> 'pace_per_hour')::integer, s.pace_per_hour),
            s.send_from, s.send_until, s.hold_hours, v_model);
  exception
    when unique_violation then
      raise exception 'A run is already in progress. Finish it or cancel it first' using errcode = '22023';
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'One of those numbers is outside what is allowed' using errcode = '22023';
  end;

  -- The pool: members of this church with no seat this season, who do not lead a tribe. Who is out, and why, is worked out batch by batch.
  insert into public.placement_items (run_id, person_id)
  select v_run, p.id
    from public.people p
   where p.centre_id = v_centre and not p.hidden
     and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
     and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
     and not exists (select 1 from public.platform_owner w where w.person_id = p.id)
     and not exists (select 1 from public.tribe_members m where m.person_id = p.id and m.season_id = v_season and m.status = 'active')
     and (v_community is null or exists (select 1 from public.member_profiles mp where mp.person_id = p.id and mp.community_id = v_community))
     and (v_zone is null or exists (select 1 from public.member_profiles mp where mp.person_id = p.id and mp.zone = v_zone));
  get diagnostics v_pool = row_count;
  update public.placement_runs set pool = v_pool where id = v_run;

  perform public.write_event(auth.uid(), 'placement.run_new', 'placement_run', v_run::text,
    jsonb_build_object('pool', v_pool, 'rehearsal', public.placement_mode() = 'rehearsal'));
  return jsonb_build_object('run', v_run, 'pool', v_pool);
end;
$$;

-- Takes the next step of planning: one batch. The console calls it again until it says the plan is ready. Calling it on a plan that is
-- ready (or on a run that has moved on) changes nothing.
create function public.placement_run_step(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  v_done integer;
  v_scored integer;
  v_assigned integer;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status = 'planning' then
    if r.phase = 'count' then
      v_done := public.placement_count_batch(p_run, 200);
      if v_done = 0 then
        update public.placement_runs set phase = 'assign' where id = p_run;
      end if;
    elsif r.phase = 'assign' then
      v_done := public.placement_assign_batch(p_run, 200);
      if v_done = 0 then
        update public.placement_runs set phase = 'check' where id = p_run;
      end if;
    elsif r.phase = 'check' then
      perform public.placement_teams_refresh(p_run);
      update public.placement_runs set status = 'planned', phase = 'ready', planned_at = now() where id = p_run;
      perform public.write_event(auth.uid(), 'placement.planned', 'placement_run', p_run::text,
        jsonb_build_object('proposed', (select count(*) from public.placement_items i where i.run_id = p_run and i.status = 'proposed')));
    end if;
    select * into r from public.placement_runs x where x.id = p_run;
  end if;
  select count(*) filter (where i.status <> 'pooled'), count(*) filter (where i.status not in ('pooled', 'counted'))
    into v_scored, v_assigned from public.placement_items i where i.run_id = p_run;
  return jsonb_build_object('status', r.status, 'phase', r.phase, 'pool', r.pool, 'scored', v_scored, 'assigned', v_assigned);
end;
$$;

-- The tribes a member could be moved to in the plan, best first, with the degree. Below the floor is shown, and flagged.
create function public.placement_options(p_run uuid, p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_floor integer := public.placement_floor();
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tribe', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id), 'degree', k.r_degree,
             'label', public.degree_label(k.r_degree), 'below_floor', k.r_degree < v_floor, 'seats', k.r_seats)
           order by k.r_degree desc, k.r_goal desc, k.r_community desc, k.r_published asc nulls last, k.r_tribe)
      from public.placement_candidates(p_person, p_run) k
      join public.tribes t on t.id = k.r_tribe), '[]'::jsonb);
end;
$$;

-- Moves a member to another tribe in the plan, takes them out of the run, or puts them on hold. Only while the plan is open to change.
create function public.placement_adjust(p_run uuid, p_person uuid, p_action text, p_tribe uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  c record;
  v_old uuid;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status <> 'planned' then
    raise exception 'The plan can only be changed before it is approved' using errcode = '22023';
  end if;
  select * into i from public.placement_items x where x.run_id = p_run and x.person_id = p_person for update;
  if not found or i.status <> 'proposed' then
    raise exception 'That person is not in the plan' using errcode = '22023';
  end if;
  v_old := i.tribe_id;
  if p_action = 'move' then
    select k.* into c from public.placement_candidates(p_person, p_run) k where k.r_tribe = p_tribe;
    if not found then
      raise exception 'That tribe does not fit their stage, time or format, or has no room' using errcode = '22023';
    end if;
    update public.placement_items set tribe_id = p_tribe, degree = c.r_degree, moved = true where id = i.id;
  elsif p_action = 'remove' then
    update public.placement_items set status = 'removed', reason = 'removed', tribe_id = null, degree = null where id = i.id;
  elsif p_action = 'hold' then
    insert into public.placement_holds (person_id) values (p_person) on conflict do nothing;
    update public.placement_items set status = 'held', reason = 'held', tribe_id = null, degree = null where id = i.id;
  else
    raise exception 'Choose move, remove or hold' using errcode = '22023';
  end if;
  perform public.placement_teams_refresh(p_run);
  perform public.write_event(auth.uid(), 'placement.adjust', 'placement_run', p_run::text,
    jsonb_build_object('action', p_action, 'person', p_person, 'from', v_old, 'to', p_tribe));
  return jsonb_build_object('ok', true);
end;
$$;

-- Takes a member off hold, so the next run can consider them
create function public.placement_hold_clear(p_person uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  delete from public.placement_holds where person_id = p_person;
  perform public.write_event(auth.uid(), 'placement.hold_cleared', 'person', p_person::text, '{}'::jsonb);
end;
$$;

-- A tribe the plan would leave too small: keep it, hold its members back from this run, or let the plan try their next-best tribes.
create function public.placement_resolve_small(p_run uuid, p_tribe uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  c record;
  v_floor integer := public.placement_floor();
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status <> 'planned' then
    raise exception 'The plan can only be changed before it is approved' using errcode = '22023';
  end if;
  if not exists (select 1 from public.placement_teams t where t.run_id = p_run and t.tribe_id = p_tribe and t.small) then
    raise exception 'That tribe is not too small' using errcode = '22023';
  end if;
  if p_action = 'keep' then
    update public.placement_teams set decision = 'keep' where run_id = p_run and tribe_id = p_tribe;
  elsif p_action = 'hold' then
    update public.placement_items set status = 'held', reason = 'too_small', tribe_id = null, degree = null
     where run_id = p_run and tribe_id = p_tribe and status = 'proposed';
    perform public.placement_teams_refresh(p_run);
    update public.placement_teams set decision = 'hold' where run_id = p_run and tribe_id = p_tribe;
  elsif p_action = 'retry' then
    update public.placement_runs set excluded_tribes = array_append(excluded_tribes, p_tribe) where id = p_run;
    -- Their places in the tribe are cleared first, so each of them is judged against the plan as it now stands
    update public.placement_items set status = 'counted', tribe_id = null, degree = null
     where run_id = p_run and tribe_id = p_tribe and status = 'proposed';
    for i in select x.* from public.placement_items x where x.run_id = p_run and x.status = 'counted' and x.tribe_id is null
              order by x.seq, x.person_id loop
      select k.* into c from public.placement_candidates(i.person_id, p_run) k
       where k.r_degree >= v_floor
       order by k.r_degree desc, k.r_goal desc, k.r_community desc, k.r_published asc nulls last, k.r_tribe limit 1;
      if found then
        update public.placement_items set status = 'proposed', tribe_id = c.r_tribe, degree = c.r_degree where id = i.id;
      else
        update public.placement_items set status = 'unplaced', reason = 'too_small' where id = i.id;
      end if;
    end loop;
    perform public.placement_teams_refresh(p_run);
    update public.placement_teams set decision = 'retry' where run_id = p_run and tribe_id = p_tribe;
  else
    raise exception 'Choose keep, hold or retry' using errcode = '22023';
  end if;
  perform public.write_event(auth.uid(), 'placement.small', 'placement_run', p_run::text, jsonb_build_object('tribe', p_tribe, 'action', p_action));
  return jsonb_build_object('ok', true);
end;
$$;

-- Stops a run that has not placed anyone
create function public.placement_run_cancel(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status not in ('planning', 'planned', 'approved') or exists (select 1 from public.placement_items i where i.run_id = p_run and i.status in ('placed', 'rehearsed')) then
    raise exception 'This run has started placing people. Use Undo instead' using errcode = '22023';
  end if;
  update public.placement_runs set status = 'cancelled' where id = p_run;
  perform public.write_event(auth.uid(), 'placement.cancelled', 'placement_run', p_run::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Approving and placing
-- ---------------------------------------------------------------------------

-- A member who ticked "no" on the Find my tribe form's contact line has said so in writing. A member who never saw that line has said
-- nothing: they get the 24 hours to hold back instead.
create function public.placement_contact_refused(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not c.granted from public.consents c
                    where c.person_id = p_person and c.purpose = 'team_contact' order by c.id desc limit 1), false);
$$;

-- A private link for a placed member. The database makes it; only its hash is kept. The link itself goes into the message's reply
-- token, which the heartbeat scrubs once the message is finished with.
create function public.placement_token_mint(p_placement uuid, p_person uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.placement_tokens (token_hash, placement_id, person_id, expires_at)
  values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), p_placement, p_person, now() + make_interval(days => greatest(p_days, 1)));
  return v_raw;
end;
$$;

-- What the "Your tribe" email carries. Never their answers, faith journey, needs, any number, or who else is in the tribe.
create function public.placement_member_params(p_tribe uuid, p_person uuid, p_degree integer)
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
begin
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.seasons x where x.id = t.season_id;
  return jsonb_build_object(
    'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
    'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
    'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
    'place_note', t.place_note, 'group_url', t.whatsapp_group_url,
    'first_meeting_by', greatest(current_date, s.starts_on) + 14, 'first_meeting_on', t.first_meeting_on,
    'season', s.name, 'starts_on', s.starts_on, 'fit', public.degree_label(p_degree),
    'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life,
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(p_person, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = p_person), false),
    'agreed_to_share', public.consent_granted(p_person, 'team_contact'),
    'hold_hours', v_hold);
end;
$$;

-- Places one member of a run, or says why not. Everything is checked again here, at the moment of placing: the plan may be days old.
-- Returns null when the person was placed (or, in a rehearsal, would have been) and a code when they were left out.
create function public.placement_place_item(p_run uuid, p_item bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  t public.tribes;
  se public.seasons;
  m public.match_models;
  c record;
  tm public.tribe_members;
  v_reason text;
  v_floor integer := public.placement_floor();
  v_run uuid := gen_random_uuid();
  v_total integer;
  v_kept integer;
  v_at timestamptz;
  v_msg uuid;
  v_tok text;
  v_params jsonb;
  v_degree integer;
  v_days integer := (select s.reminder_days::integer from public.placement_settings s where s.singleton);
begin
  select * into r from public.placement_runs x where x.id = p_run;
  select * into i from public.placement_items x where x.id = p_item and x.run_id = p_run for update;
  if not found or i.status <> 'proposed' then
    return null;
  end if;

  -- A member who has taken a seat for themselves since the plan was made is left alone: this is the first thing looked at
  if exists (select 1 from public.tribe_members x where x.person_id = i.person_id and x.season_id = r.season_id and x.status = 'active') then
    v_reason := 'chose_own';
  else
    v_reason := public.placement_pool_reason(i.person_id, r.season_id, r.grace_days);
  end if;
  if v_reason is null then
    select * into t from public.tribes x where x.id = i.tribe_id for update;
    if not found or t.season_id <> r.season_id or t.status <> 'approved'
       or not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
      v_reason := 'tribe_closed';
    elsif (select count(*) from public.tribe_members x where x.tribe_id = t.id and x.status = 'active') + 1 + r.seats_free > t.capacity then
      v_reason := 'tribe_full';
    end if;
  end if;
  if v_reason is null and not r.rehearsal then
    select k.* into c from public.match_candidates(i.person_id) k where k.r_tribe = i.tribe_id;
    if not found then
      v_reason := 'tribe_changed';
    elsif not i.moved and c.r_degree < v_floor then
      v_reason := 'below_bar';
    else
      v_degree := c.r_degree;
    end if;
  end if;
  if v_reason is not null then
    update public.placement_items set status = 'skipped', reason = v_reason where id = i.id;
    return v_reason;
  end if;

  v_degree := coalesce(v_degree, i.degree);
  v_at := greatest(public.placement_slot(r.approved_at, r.pace_per_hour, r.send_from, r.send_until, r.told), now());
  v_params := public.placement_member_params(t.id, i.person_id, v_degree);

  if r.rehearsal then
    -- A rehearsal writes what would have gone to the message log as a skipped row, and places nobody.
    insert into public.messages (centre_id, person_id, tribe_id, template, params, force_channel, dedupe_key, scheduled_for, status, channel, error)
    select p.centre_id, i.person_id, t.id, 'placement_your_tribe', v_params, 'email', 'placement-rehearsal:' || p_run || ':' || i.person_id, v_at, 'skipped', 'email', 'Rehearsal: written to the log, not sent'
      from public.people p where p.id = i.person_id
    on conflict (dedupe_key) do nothing;
    update public.placement_items
       set status = 'rehearsed', slot_at = v_at, placed_at = now(),
           rehearsal = jsonb_build_object('tribe', t.name, 'degree', v_degree, 'send_at', v_at)
     where id = i.id;
    update public.placement_runs set told = told + 1 where id = p_run;
    return null;
  end if;

  select * into m from public.match_models x where x.active;
  select * into se from public.seasons x where x.id = t.season_id;
  select count(*)::integer into v_total from public.match_candidates(i.person_id);
  -- The same record a member's own run leaves behind, so their tribe page reads the same. The church's pick is shown first.
  insert into public.match_runs (id, person_id, season_id, model_version, candidates, shown) values (v_run, i.person_id, r.season_id, m.version, v_total, 0);
  insert into public.match_recommendations (run_id, person_id, rank, tribe_id, degree, components, reasons)
  select v_run, i.person_id, ranked.rk, ranked.r_tribe, ranked.r_degree,
         jsonb_build_object('goal', ranked.r_goal, 'stage', ranked.r_stage, 'community', ranked.r_community, 'place', ranked.r_place,
                            'style', ranked.r_style, 'rhythm', ranked.r_rhythm, 'faith', ranked.r_faith),
         public.match_reasons(ranked.r_goal, ranked.r_stage, ranked.r_community, ranked.r_place, ranked.r_online,
                              ranked.r_rhythm, ranked.r_balance, ranked.r_affinity, ranked.r_faith, m.weights)
    from (select cand.*,
                 (row_number() over (order by (cand.r_tribe = i.tribe_id) desc, cand.r_degree desc, cand.r_goal desc, cand.r_community desc,
                                              cand.r_published asc nulls last, cand.r_tribe))::smallint as rk
            from public.match_candidates(i.person_id) cand
           where cand.r_degree >= m.min_degree or cand.r_tribe = i.tribe_id) ranked
   where ranked.rk <= 3;
  get diagnostics v_kept = row_count;
  update public.match_runs set shown = v_kept where id = v_run;
  update public.match_recommendations set chosen = true where run_id = v_run and tribe_id = i.tribe_id;

  insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, model_version, run_id, agreement_version, covenant,
                                    first_meeting_by, placed_by_run, placement_source, contact_withheld)
  values (t.id, i.person_id, t.season_id, 1, v_degree, m.version, v_run, 'auto-pending',
          jsonb_build_object('name', t.name, 'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
          greatest(current_date, se.starts_on) + 14, p_run, 'auto', public.placement_contact_refused(i.person_id))
  returning * into tm;
  delete from public.match_demand where person_id = i.person_id;

  -- The join trigger has just written the standard welcome email and the "someone joined" email for the leader. This run sends its own,
  -- so the two standard ones are withdrawn in the same transaction, before anything can claim them.
  delete from public.messages x
   where x.status = 'queued' and (x.dedupe_key = 'welcome:' || tm.id or x.dedupe_key like 'newmember:' || tm.id || ':%');

  v_msg := public.enqueue_message(i.person_id, 'placement_your_tribe', v_params, t.id, 'placement:' || tm.id, v_at, p_force => 'email');
  v_tok := public.placement_token_mint(tm.id, i.person_id, 60);
  update public.messages set reply_token = v_tok where id = v_msg;
  v_tok := public.placement_token_mint(tm.id, i.person_id, 60);
  v_msg := public.enqueue_message(i.person_id, 'placement_reminder', v_params, t.id, 'placement-reminder:' || tm.id, v_at + make_interval(days => v_days), p_force => 'email');
  update public.messages set reply_token = v_tok where id = v_msg;

  update public.placement_items
     set status = 'placed', degree = v_degree, placement_id = tm.id, placed_at = now(), slot_at = v_at,
         member_message = (select x.id from public.messages x where x.dedupe_key = 'placement:' || tm.id)
   where id = i.id;
  update public.placement_runs set told = told + 1 where id = p_run;
  perform public.write_event(auth.uid(), 'placement.placed', 'tribe', t.id::text, jsonb_build_object('run', p_run, 'degree', v_degree));
  return null;
end;
$$;

-- Places the next batch of an approved run. Safe to call again and again: a person who is already placed is not placed twice, a run
-- that is finished says so, and the run row is held for the whole batch so two callers take turns.
create function public.placement_place_batch(p_run uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  v_done integer := 0;
  v_skipped integer := 0;
  v_left integer;
  v_res text;
  v_start timestamptz := clock_timestamp();
begin
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found or r.status not in ('approved', 'placing') then
    return jsonb_build_object('status', coalesce(r.status, 'none'), 'done', 0, 'left', 0);
  end if;
  if r.status = 'approved' then
    update public.placement_runs set status = 'placing' where id = p_run;
  end if;
  for i in select x.* from public.placement_items x where x.run_id = p_run and x.status = 'proposed' order by x.seq, x.id limit greatest(p_limit, 1) loop
    -- A step is kept short: after about four seconds it stops, and the page asks for the next one
    exit when v_done > 0 and clock_timestamp() - v_start > interval '4 seconds';
    v_res := public.placement_place_item(p_run, i.id);
    v_done := v_done + 1;
    if v_res is not null then
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  select count(*)::integer into v_left from public.placement_items x where x.run_id = p_run and x.status = 'proposed';
  if v_left = 0 then
    update public.placement_runs set status = 'placed', placed_at = now() where id = p_run;
    if r.rehearsal then
      perform public.placement_rehearse_teams(p_run);
      update public.placement_runs set status = 'closed', closed_at = now() where id = p_run;
    end if;
  end if;
  return jsonb_build_object('status', (select x.status from public.placement_runs x where x.id = p_run), 'done', v_done, 'skipped', v_skipped, 'left', v_left);
end;
$$;

-- What a rehearsal would have told each leader: one skipped row in the message log for each team, with first names only.
create function public.placement_rehearse_teams(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm record;
  t public.tribes%rowtype;
  who uuid;
begin
  for tm in select x.tribe_id, count(*)::integer as n, jsonb_agg(jsonb_build_object('name', public.first_name_of(x.person_id), 'withheld', public.placement_contact_refused(x.person_id)) order by x.id) as members
              from public.placement_items x where x.run_id = p_run and x.status = 'rehearsed' group by x.tribe_id loop
    select * into t from public.tribes x where x.id = tm.tribe_id;
    for who in select * from public.tribe_team(t.id) loop
      insert into public.messages (centre_id, person_id, tribe_id, template, params, force_channel, dedupe_key, status, channel, error)
      select p.centre_id, who, t.id, 'placement_your_team',
             jsonb_build_object('tribe', t.name, 'rehearsal', true, 'count', tm.n, 'members', tm.members), 'email', 'placement-rehearsal-team:' || p_run || ':' || t.id || ':' || who, 'skipped', 'email', 'Rehearsal: written to the log, not sent'
        from public.people p where p.id = who
      on conflict (dedupe_key) do nothing;
    end loop;
    update public.placement_teams set mail_queued_at = now() where run_id = p_run and tribe_id = t.id;
  end loop;
end;
$$;

-- Approve: freezes the plan. Nobody is placed by this call; placing is the next press (and the heartbeat carries on if the page is closed).
-- p_expected is the number of members the screen said would be placed: if the plan changed underneath the page, nothing happens.
create function public.placement_run_approve(p_run uuid, p_expected integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  v_n integer;
  v_open integer;
  v_mode text := public.placement_mode();
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status in ('approved', 'placing', 'placed', 'closed') then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;
  if r.status <> 'planned' then
    raise exception 'This plan cannot be approved' using errcode = '22023';
  end if;
  if v_mode = 'off' then
    raise exception 'Placement is switched Off' using errcode = '22023';
  end if;
  if r.rehearsal is distinct from (v_mode = 'rehearsal') then
    raise exception 'The switch has changed since this plan was made. Make a new plan' using errcode = '22023';
  end if;
  select count(*)::integer into v_n from public.placement_items i where i.run_id = p_run and i.status = 'proposed';
  if v_n = 0 then
    raise exception 'The plan places nobody' using errcode = '22023';
  end if;
  if p_expected is not null and p_expected <> v_n then
    raise exception 'The plan has changed. Reload the page and look again' using errcode = '22023';
  end if;
  select count(*)::integer into v_open from public.placement_teams t where t.run_id = p_run and t.small and t.decision is null;
  if v_open > 0 then
    raise exception 'Decide what to do about the % tribe(s) that would be too small first', v_open using errcode = '22023';
  end if;

  -- Members the plan could not place for want of a suitable tribe are demand: the leader board counts them as waiting. A row the
  -- member's own run already wrote is left alone.
  if not r.rehearsal then
    insert into public.match_demand (person_id, season_id, track_id, community_id, season_goal_id, zone, meeting_mode, meeting_times, tribe_kind, shown)
    select i.person_id, mp.season_id, ar.track_id, mp.community_id, mp.season_goal_id, mp.zone, mp.meeting_mode::text, mp.meeting_times,
           case mp.tribe_mix when 'mixed' then 'mixed' when 'no_preference' then 'any'
                else case mp.gender when 'female' then 'women' when 'male' then 'men' else 'mixed' end end, 0
      from public.placement_items i
      join public.member_profiles mp on mp.person_id = i.person_id
      left join public.age_ranges ar on ar.id = mp.age_range_id
     where i.run_id = p_run and i.status = 'unplaced' and i.reason in ('no_tribe', 'below_bar', 'full', 'too_small')
    on conflict (person_id) do nothing;
  end if;

  update public.placement_runs set status = 'approved', approved_at = now() where id = p_run;
  perform public.write_event(auth.uid(), 'placement.approved', 'placement_run', p_run::text,
    jsonb_build_object('members', v_n, 'rehearsal', r.rehearsal));
  return jsonb_build_object('status', 'approved', 'members', v_n);
end;
$$;

-- The console's "place the next batch" press. It returns what is left, so the page can keep going until the run is placed.
create function public.placement_run_place(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  v jsonb;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if public.placement_mode() = 'off' then
    raise exception 'Placement is switched Off' using errcode = '22023';
  end if;
  if r.rehearsal is distinct from (public.placement_mode() = 'rehearsal') then
    raise exception 'The switch no longer matches this run' using errcode = '22023';
  end if;
  v := public.placement_place_batch(p_run, 50);
  perform public.placement_team_mail(p_run);
  return v;
end;
$$;

-- Each team's "Your team" email. Queued once, when every member of the team who is still in it has been told, and 24 hours have passed
-- since the last of them was (unless every one of them agreed to share on the form). A member whose email never went out is not on the
-- list: they have not had their chance to hold back. Returns how many teams were queued.
create function public.placement_team_mail(p_run uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  tm public.placement_teams;
  t public.tribes%rowtype;
  v_pending integer;
  v_last timestamptz;
  v_all_agreed boolean;
  v_members jsonb;
  v_count integer;
  v_first date;
  v_queued integer := 0;
  who uuid;
begin
  select * into r from public.placement_runs x where x.id = p_run;
  if not found or r.rehearsal or r.status not in ('placing', 'placed', 'undone') or public.placement_mode() <> 'on' then
    return 0;
  end if;
  for tm in select x.* from public.placement_teams x where x.run_id = p_run and x.mail_queued_at is null and x.cancelled_at is null and x.proposed > 0
            order by x.tribe_id for update loop
    select * into t from public.tribes x where x.id = tm.tribe_id;
    continue when exists (select 1 from public.placement_items x where x.run_id = p_run and x.tribe_id = tm.tribe_id and x.status = 'proposed');
    -- Members still in this tribe from this run, and how their first email went
    select count(*) filter (where msg.status in ('queued', 'sending') or msg.id is null)::integer,
           max(msg.sent_at) filter (where msg.status in ('sent', 'delivered', 'read')),
           coalesce(bool_and(public.consent_granted(x.person_id, 'team_contact')) filter (where msg.status in ('sent', 'delivered', 'read')), true)
      into v_pending, v_last, v_all_agreed
      from public.tribe_members x
      left join public.placement_items i on i.placement_id = x.id
      left join public.messages msg on msg.id = i.member_message
     where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active';
    continue when v_pending > 0;
    continue when v_last is not null and not v_all_agreed and now() < v_last + make_interval(hours => r.hold_hours);

    select coalesce(jsonb_agg(jsonb_build_object(
             'name', public.person_display_name(x.person_id),
             'email', case when x.contact_withheld then null else pe.email end,
             'whatsapp', case when x.contact_withheld then null
                              else (case when public.consent_granted(x.person_id, 'whatsapp') then mp.whatsapp end) end,
             'withheld', x.contact_withheld) order by public.person_display_name(x.person_id), x.id), '[]'::jsonb),
           count(*)::integer, min(x.first_meeting_by)
      into v_members, v_count, v_first
      from public.tribe_members x
      join public.people pe on pe.id = x.person_id
      left join public.member_profiles mp on mp.person_id = x.person_id
      join public.placement_items i on i.placement_id = x.id
      join public.messages msg on msg.id = i.member_message and msg.status in ('sent', 'delivered', 'read')
     where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active'
       and coalesce(public.message_blocker(x.person_id), '') not in ('deletion', 'under18');

    if v_count > 0 then
      for who in select * from public.tribe_team(t.id) loop
        perform public.enqueue_message(who, 'placement_your_team',
          jsonb_build_object('tribe', t.name, 'first_meeting_by', v_first,
                             'call_by', ((now() + interval '72 hours') at time zone 'Africa/Lagos')::date, 'members', v_members),
          t.id, 'placement-team:' || p_run || ':' || t.id || ':' || who, p_force => 'email');
      end loop;
    end if;
    update public.placement_teams set mail_queued_at = now() where run_id = p_run and tribe_id = tm.tribe_id;
    v_queued := v_queued + 1;
  end loop;
  -- Every team dealt with: the run is closed
  if r.status = 'placed' and not exists (select 1 from public.placement_teams x where x.run_id = p_run and x.proposed > 0 and x.mail_queued_at is null and x.cancelled_at is null) then
    update public.placement_runs set status = 'closed', closed_at = now() where id = p_run;
  end if;
  return v_queued;
end;
$$;

-- Undo, until a tribe's leader has been told. Members who have not confirmed or answered in any way are released and the leader's email for
-- their tribe is cancelled. Members who confirmed stay, and so does every tribe whose leader has already been emailed: from there a coach
-- moves people one at a time, as before. Emails already sent cannot be recalled.
create function public.placement_undo(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  tm public.tribe_members;
  v_released integer := 0;
  v_confirmed integer := 0;
  v_told integer := 0;
  v_left integer;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status in ('undone', 'cancelled', 'planning', 'planned') then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;
  if r.rehearsal then
    raise exception 'A rehearsal placed nobody, so there is nothing to undo' using errcode = '22023';
  end if;
  if r.status not in ('approved', 'placing', 'placed', 'closed') then
    raise exception 'This run cannot be undone' using errcode = '22023';
  end if;
  if r.status = 'closed' or (r.status in ('placing', 'placed') and not exists (
       select 1 from public.placement_teams x where x.run_id = p_run and x.proposed > 0 and x.mail_queued_at is null and x.cancelled_at is null)
       and exists (select 1 from public.placement_items y where y.run_id = p_run and y.status = 'placed')) then
    raise exception 'Every leader has been told, so this run can no longer be undone' using errcode = '22023';
  end if;

  if r.status = 'approved' then
    update public.placement_runs set status = 'cancelled' where id = p_run;
    perform public.write_event(auth.uid(), 'placement.cancelled', 'placement_run', p_run::text, '{}'::jsonb);
    return jsonb_build_object('status', 'cancelled', 'released', 0);
  end if;
  -- Stop the batches: whoever is still waiting is left out
  update public.placement_items set status = 'skipped', reason = 'run_undone' where run_id = p_run and status = 'proposed';
  if r.status = 'placing' then
    update public.placement_runs set status = 'placed', placed_at = now() where id = p_run;
  end if;

  for i in select x.* from public.placement_items x where x.run_id = p_run and x.status = 'placed' order by x.id for update loop
    select * into tm from public.tribe_members x where x.id = i.placement_id for update;
    if not found or tm.status <> 'active' then
      continue;
    end if;
    if exists (select 1 from public.placement_teams x where x.run_id = p_run and x.tribe_id = tm.tribe_id and x.mail_queued_at is not null) then
      v_told := v_told + 1;
    elsif tm.confirmed_at is not null or tm.contact_withheld then
      v_confirmed := v_confirmed + 1;
    else
      update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Placement undone by the church' where id = tm.id;
      update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
      update public.messages set status = 'skipped', error = 'undone', reply_token = null
       where status = 'queued' and (dedupe_key = 'placement:' || tm.id or dedupe_key = 'placement-reminder:' || tm.id);
      delete from public.placement_tokens where placement_id = tm.id;
      update public.placement_items set status = 'undone' where id = i.id;
      v_released := v_released + 1;
    end if;
  end loop;
  -- A tribe's leader is not told about a team that has been undone
  update public.placement_teams t set cancelled_at = now()
   where t.run_id = p_run and t.mail_queued_at is null
     and not exists (select 1 from public.tribe_members x where x.tribe_id = t.tribe_id and x.placed_by_run = p_run and x.status = 'active');
  update public.messages set status = 'skipped', error = 'undone'
   where status = 'queued' and template = 'placement_your_team' and dedupe_key like 'placement-team:' || p_run || ':%';

  select count(*)::integer into v_left from public.placement_items x where x.run_id = p_run and x.status = 'placed';
  update public.placement_runs set status = 'undone', undone_at = now() where id = p_run;
  perform public.write_event(auth.uid(), 'placement.undone', 'placement_run', p_run::text,
    jsonb_build_object('released', v_released, 'kept_confirmed', v_confirmed, 'kept_leader_told', v_told));
  return jsonb_build_object('status', 'undone', 'released', v_released, 'kept_confirmed', v_confirmed, 'kept_leader_told', v_told);
end;
$$;

-- ---------------------------------------------------------------------------
-- What leaders see of a placed member, and what a placed member can do
-- ---------------------------------------------------------------------------

-- Takes a leader's list of members and applies two rules. A member the church placed is not shown to their tribe's leader or assistant
-- until the "Your team" email for that tribe has been queued: the member is told first, and has had their chance to hold back. A member
-- who held back is shown without a WhatsApp number. The other members of the list are left exactly as they were.
create function public.placement_filter_members(p_tribe uuid, p_members jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
               when tm.contact_withheld then e.v || jsonb_build_object('whatsapp', null, 'withheld', true)
               else e.v
             end
             || case when tm.placement_source = 'auto'
                     then jsonb_build_object('placement', case when tm.confirmed_at is null then 'pending' else 'confirmed' end)
                     else '{}'::jsonb end
             order by e.ord)
      from jsonb_array_elements(p_members) with ordinality as e(v, ord)
      left join public.tribe_members tm
        on tm.tribe_id = p_tribe and tm.person_id = (e.v ->> 'person_id')::uuid and tm.status = 'active'
     where not coalesce(v_team and tm.placement_source = 'auto' and exists (
             select 1 from public.placement_teams pt join public.placement_runs pr on pr.id = pt.run_id
              where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id and pt.mail_queued_at is null and pt.cancelled_at is null
                and pr.status in ('placing', 'placed', 'undone')), false)), '[]'::jsonb);
end;
$$;

-- The leader's list, as tribe_roster gives it, with the two rules above and a mark on members the church placed
create function public.tribe_roster_marked(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.tribe_roster(p_tribe);
begin
  return jsonb_set(v, '{members}', public.placement_filter_members(p_tribe, v -> 'members'));
end;
$$;

-- The weekly log's list of members, with the same two rules
create function public.tribe_week_marked(p_tribe uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.tribe_week(p_tribe, p_week);
begin
  if v is null or not (v ? 'members') then
    return v;
  end if;
  return jsonb_set(v, '{members}', public.placement_filter_members(p_tribe, v -> 'members'));
end;
$$;

-- What a placed member sees on the link page and at the top of their tribe page. Never anyone else in the tribe.
create function public.placement_state(p_tm uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_queued boolean;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into t from public.tribes x where x.id = tm.tribe_id;
  select * into s from public.seasons x where x.id = tm.season_id;
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
    'can_change', tm.status = 'active' and s.starts_on > public.today_lagos(),
    'fit', public.degree_label(tm.degree),
    'tribe', jsonb_build_object(
      'name', t.name, 'leader_first', public.first_name_of(t.leader_id),
      'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
      'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
      'place_note', t.place_note, 'group_url', t.whatsapp_group_url, 'first_meeting_on', t.first_meeting_on,
      'first_meeting_by', tm.first_meeting_by, 'season', s.name, 'starts_on', s.starts_on,
      'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(tm.person_id, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = tm.person_id), false));
end;
$$;

-- The tribe seat a private link opens: the link is hashed and looked up, it must not have expired, and the seat must have been placed by
-- the church. Null for anything else, and the page cannot tell which. Opening a link changes nothing but a counter (mail scanners open
-- links too); the member presses a button to do anything.
create function public.placement_link_seat(p_link text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  update public.placement_tokens k set clicks = k.clicks + 1
   where k.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex') and k.expires_at > now()
  returning k.placement_id into v_tm;
  if v_tm is null then
    return null;
  end if;
  if not exists (select 1 from public.tribe_members x where x.id = v_tm and x.placement_source = 'auto') then
    return null;
  end if;
  return v_tm;
end;
$$;

-- "Yes, I'm in": records the member's agreement to the Success Picture and the Tribe Covenant, with the wording version, exactly as for a
-- member who chose the tribe themselves.
create function public.placement_do_confirm(p_tm uuid, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
begin
  if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  if tm.confirmed_at is null then
    update public.tribe_members set confirmed_at = now(), agreement_version = p_version, agreed_at = now() where id = tm.id;
    update public.messages set status = 'skipped', error = 'confirmed', reply_token = null
     where status = 'queued' and dedupe_key = 'placement-reminder:' || tm.id;
    perform public.write_event(tm.person_id, 'placement.confirmed', 'tribe', tm.tribe_id::text, jsonb_build_object('version', p_version));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Don't share my details": the leader will not be given this member's email or WhatsApp number. If the leader has already been told,
-- the answer says so, and nothing is changed for them.
create function public.placement_do_withhold(p_tm uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  v_queued boolean;
  v_params jsonb;
begin
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select coalesce(bool_or(pt.mail_queued_at is not null), false) into v_queued
    from public.placement_teams pt where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id;
  if v_queued then
    return jsonb_build_object('ok', true, 'late', true);
  end if;
  if not tm.contact_withheld then
    update public.tribe_members set contact_withheld = true where id = tm.id;
    -- A refusal outlasts this seat: if they are placed again, their details are withheld from the start
    insert into public.consents (person_id, purpose, granted, version) values (tm.person_id, 'team_contact', false, 'placement-link');
    -- Their tribe's details come to them instead, with a line asking them to reach out
    v_params := public.placement_member_params(tm.tribe_id, tm.person_id, tm.degree);
    perform public.enqueue_message(tm.person_id, 'placement_withheld', v_params, tm.tribe_id, 'placement-withheld:' || tm.id, p_force => 'email');
    perform public.write_event(tm.person_id, 'placement.withheld', 'tribe', tm.tribe_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'late', false);
end;
$$;

-- "Show me other tribes": gives up the seat, as a member may until the season starts, and sends them to look again.
create function public.placement_do_change(p_tm uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.seasons%rowtype;
begin
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select * into s from public.seasons x where x.id = tm.season_id;
  if s.starts_on <= public.today_lagos() then
    return jsonb_build_object('ok', false, 'reason', 'started');
  end if;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Chose to look at other tribes' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  update public.messages set status = 'skipped', error = 'changed', reply_token = null
   where status = 'queued' and dedupe_key in ('placement:' || tm.id, 'placement-reminder:' || tm.id, 'placement-withheld:' || tm.id);
  perform public.write_event(tm.person_id, 'placement.changed', 'tribe', tm.tribe_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---- the link page (no sign-in; the sending service's token is the credential, as for the Friday check-in link) ----
create function public.worker_placed_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('found', false);
  end if;
  return public.placement_state(v_tm);
end;
$$;

create function public.worker_placed_confirm(p_token text, p_link text, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.placement_do_confirm(v_tm, p_version);
end;
$$;

create function public.worker_placed_withhold(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.placement_do_withhold(v_tm);
end;
$$;

create function public.worker_placed_change(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.placement_do_change(v_tm);
end;
$$;

-- ---- the same choice, for a placed member who is signed in ----
create function public.my_placement()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select x.id into v_tm from public.tribe_members x
   where x.person_id = auth.uid() and x.status = 'active' and x.placement_source = 'auto' order by x.joined_at desc limit 1;
  if v_tm is null then
    return null;
  end if;
  return public.placement_state(v_tm);
end;
$$;

create function public.placement_my_confirm(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select x.id into v_tm from public.tribe_members x
   where x.person_id = auth.uid() and x.status = 'active' and x.placement_source = 'auto' order by x.joined_at desc limit 1;
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  return public.placement_do_confirm(v_tm, p_version);
end;
$$;

create function public.placement_my_withhold()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select x.id into v_tm from public.tribe_members x
   where x.person_id = auth.uid() and x.status = 'active' and x.placement_source = 'auto' order by x.joined_at desc limit 1;
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  return public.placement_do_withhold(v_tm);
end;
$$;

-- ---- a placed member who gives up the seat by the ordinary route (the button on the tribe page) ----
-- release_my_seat is the member's own button and is left exactly as it was. When it frees a seat the church placed, whatever email about
-- that seat is still waiting (the reminder, the "details kept private" note) is stopped, and the private link stops opening.
create function public.placement_seat_released()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'released' and old.status = 'active' and new.placement_source = 'auto' then
    update public.messages set status = 'skipped', error = 'released', reply_token = null
     where status = 'queued' and dedupe_key in ('placement:' || new.id, 'placement-reminder:' || new.id, 'placement-withheld:' || new.id);
    delete from public.placement_tokens where placement_id = new.id;
  end if;
  return new;
end;
$$;

create trigger tribe_members_placement_released
  after update of status on public.tribe_members
  for each row
  when (old.status is distinct from new.status)
  execute function public.placement_seat_released();

-- ---------------------------------------------------------------------------
-- The heartbeat
-- ---------------------------------------------------------------------------

-- Finishes the batches of a run whose page was closed, queues each tribe's "Your team" email when it is due, and tidies the private
-- links: a link is cleared from a message once the message has gone (or failed), and an expired link is deleted. With the switch Off it
-- does nothing at all. It spends about twenty seconds on batches and then stops.
create function public.placement_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := public.placement_mode();
  r public.placement_runs;
  v_started timestamptz := clock_timestamp();
  v_batches integer := 0;
  v_teams integer := 0;
  v_cleared integer := 0;
  v jsonb;
begin
  if v_mode = 'off' then
    return jsonb_build_object('mode', 'off');
  end if;
  loop
    select * into r from public.placement_runs x
     where x.status in ('approved', 'placing') and x.rehearsal = (v_mode = 'rehearsal') order by x.seq limit 1;
    exit when not found or clock_timestamp() - v_started > interval '20 seconds';
    v := public.placement_place_batch(r.id, 50);
    v_batches := v_batches + 1;
    exit when (v ->> 'left')::integer = 0 and (v ->> 'done')::integer = 0;
  end loop;
  for r in select x.* from public.placement_runs x where x.status in ('placing', 'placed', 'undone') and not x.rehearsal order by x.seq loop
    v_teams := v_teams + public.placement_team_mail(r.id);
  end loop;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('placement_your_tribe', 'placement_reminder', 'placement_withheld')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  delete from public.placement_tokens where expires_at < now();
  return jsonb_build_object('mode', v_mode, 'batches', v_batches, 'teams', v_teams, 'cleared', v_cleared);
end;
$$;

create function public.worker_placement_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.placement_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Bulk leaders: many leaders appointed in one run, through the same doors as the one-at-a-time appointment
-- ---------------------------------------------------------------------------

-- The fit inputs for a person in a bulk run: from their saved application (approved leaders) or from the short form God Mode pasted.
create function public.placement_leader_inputs(p_source text, p_person uuid, p_form jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications%rowtype;
begin
  if p_source = 'sheet' then
    return public.god_appointment_inputs(p_form);
  end if;
  select x.* into a from public.leader_applications x
   where x.person_id = p_person and x.status = 'approved_leader' order by x.decided_at desc nulls last, x.created_at desc limit 1;
  if not found then
    return null;
  end if;
  return public.leader_fit_inputs(a.answers);
end;
$$;

-- Starts a Tribe Card for an approved leader who has no tribe, the way accepting an offer does, so the pastor's review page sees an
-- application behind the card. It approves nothing, certifies nobody, and tells nobody (the bulk run sends its own email).
create function public.god_start_leader_card(p_person uuid, p_goal uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.season_goals;
  p public.people;
  d record;
  v_season uuid := public.leader_fit_season();
  v_answers jsonb;
  v_track uuid;
  v_name text;
  v_first text;
  v_tribe uuid;
  v_hidden boolean;
begin
  perform public.god_only();
  select * into g from public.season_goals x where x.id = p_goal and x.active;
  if not found
     or not exists (select 1 from public.communities c where c.id = g.community_id and c.active)
     or not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = p_goal and t.status = 'signed_off') then
    raise exception 'That goal is not available' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet' using errcode = '22023';
  end if;
  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  select a.answers into v_answers from public.leader_applications a
   where a.person_id = p_person and a.status = 'approved_leader' order by a.decided_at desc nulls last, a.created_at desc limit 1;
  if v_answers is null or not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader') then
    raise exception 'They are not an approved leader' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    raise exception 'They already have a Tribe Card or lead a tribe' using errcode = '22023';
  end if;
  update public.leader_offers set status = 'withdrawn' where person_id = p_person and status = 'offered';

  select t.id into v_track from public.tracks t where t.slug = v_answers #>> '{calling,track}' and t.active;
  v_first := coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1));
  select c.name into v_name from public.communities c where c.id = g.community_id;
  v_name := case when coalesce(v_first, '') <> '' and v_name is not null and char_length(v_first || '’s ' || v_name || ' tribe') <= 48
                 then v_first || '’s ' || v_name || ' tribe' end;
  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed)
  values (v_season, p_person, v_name, v_track, g.community_id, g.id,
          case when v_track is not null then array['track', 'community', 'goal'] else array['community', 'goal'] end)
  returning id into v_tribe;
  perform public.card_template_fill(v_tribe);

  -- The record an accepted offer leaves, so the leader board and the leader's own page read the same
  select coalesce(x.hidden, false) into v_hidden from public.people x where x.id = me;
  select * into d from public.goal_demand_rows(v_season) x where x.goal_id = p_goal;
  insert into public.leader_offers (goal_id, person_id, season_id, status, offered_by, answered_at, waiting_at_offer, tribe_id)
  values (p_goal, p_person, v_season, 'accepted', case when v_hidden then null else me end, now(), greatest(coalesce(d.waiting, 1), 1), v_tribe);
  perform public.write_event(me, 'tribe.started', 'tribe', v_tribe::text, jsonb_build_object('bulk', true));
  return jsonb_build_object('ok', true, 'tribe', v_tribe);
end;
$$;

-- Plans a run. The people are the approved leaders who have no tribe and no open offer (their saved application is the input) and the
-- people on the pasted sheet (one row each: email and a short form). The goals with a gap come first, biggest first; a gap of 24 is two
-- tribes, since a tribe takes up to 12. Each goes to the best-fitting person not yet used. Nothing is changed by planning.
create function public.placement_leaders_plan(p_sheet jsonb default '[]'::jsonb, p_include_approved boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  m public.leader_fit_models := public.leader_fit_cfg();
  v_run uuid := gen_random_uuid();
  row_ jsonb;
  c record;
  g record;
  pick record;
  v_person uuid;
  v_i jsonb;
  v_form jsonb;
  v_left jsonb := '[]'::jsonb;
  v_open jsonb := '[]'::jsonb;
  v_need integer;
  v_got integer;
  v_paired integer := 0;
  v_name text;
begin
  perform public.god_only();
  if m.version is null then
    raise exception 'The pastorate needs to approve a fit model first' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_sheet, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_sheet, '[]'::jsonb)) > 300 then
    raise exception 'Paste up to 300 rows' using errcode = '22023';
  end if;
  begin
    insert into public.placement_leader_runs (id, season_id) values (v_run, v_season);
  exception when unique_violation then
    raise exception 'A bulk run is already open. Finish it or cancel it first' using errcode = '22023';
  end;

  drop table if exists pg_temp.pl_cand;
  create temp table pl_cand (person_id uuid primary key, source text not null, form jsonb, i jsonb not null, since timestamptz, used boolean not null default false) on commit drop;

  if p_include_approved then
    for c in
      select p.id as person_id, public.leader_fit_inputs(a.answers) as i, coalesce(a.submitted_at, a.created_at) as since
        from public.people p
        join lateral (select x.* from public.leader_applications x where x.person_id = p.id and x.status = 'approved_leader'
                       order by x.decided_at desc nulls last, x.created_at desc limit 1) a on true
       where not p.hidden
         and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'leader')
         and not exists (select 1 from public.tribes t where t.leader_id = p.id and t.status <> 'closed')
         and not exists (select 1 from public.leader_offers f where f.person_id = p.id and f.status = 'offered' and f.expires_at > now())
         and not exists (select 1 from public.platform_owner w where w.person_id = p.id)
    loop
      if c.i ->> 'track' is null or c.i ->> 'lead_best' is null or c.i ->> 'judgement' is null then
        v_left := v_left || jsonb_build_array(jsonb_build_object('person', c.person_id, 'name', public.person_display_name(c.person_id), 'reason', 'Their application is not complete enough to score'));
      else
        insert into pg_temp.pl_cand (person_id, source, i, since) values (c.person_id, 'approved', c.i, c.since);
      end if;
    end loop;
  end if;

  for row_ in select * from jsonb_array_elements(coalesce(p_sheet, '[]'::jsonb)) loop
    if jsonb_typeof(row_) <> 'object' then
      v_left := v_left || jsonb_build_array(jsonb_build_object('reason', 'A row on the sheet could not be read'));
      continue;
    end if;
    v_name := lower(btrim(coalesce(row_ ->> 'email', '')));
    v_person := null;
    select p.id into v_person from public.people p where lower(p.email) = v_name and not p.hidden
       and not exists (select 1 from public.platform_owner w where w.person_id = p.id);
    if v_person is null then
      v_left := v_left || jsonb_build_array(jsonb_build_object('email', left(v_name, 120), 'reason', 'Not on the platform yet. They need to sign in once first'));
      continue;
    end if;
    if exists (select 1 from pg_temp.pl_cand x where x.person_id = v_person) then
      v_left := v_left || jsonb_build_array(jsonb_build_object('person', v_person, 'name', public.person_display_name(v_person), 'reason', 'On the list twice, or already counted as an approved leader'));
      continue;
    end if;
    if exists (select 1 from public.leader_appointments a where a.person_id = v_person and a.status = 'active')
       or exists (select 1 from public.tribes t where t.leader_id = v_person and t.status <> 'closed') then
      v_left := v_left || jsonb_build_array(jsonb_build_object('person', v_person, 'name', public.person_display_name(v_person), 'reason', 'Already appointed or already leads a tribe'));
      continue;
    end if;
    v_form := row_ - 'email';
    begin
      v_i := public.god_appointment_inputs(v_form);
    exception when others then
      v_left := v_left || jsonb_build_array(jsonb_build_object('person', v_person, 'name', public.person_display_name(v_person), 'reason', sqlerrm));
      continue;
    end;
    insert into pg_temp.pl_cand (person_id, source, form, i, since) values (v_person, 'sheet', v_form, v_i, now());
  end loop;

  -- The goals with a gap, biggest first
  for g in
    select d.goal_id, d.gap, sg.title, cm.name as community
      from public.goal_demand_rows(v_season) d
      join public.season_goals sg on sg.id = d.goal_id and sg.active
      join public.communities cm on cm.id = sg.community_id and cm.active
     where d.gap > 0 and exists (select 1 from public.tribe_card_templates t where t.season_goal_id = d.goal_id and t.status = 'signed_off')
     order by d.gap desc, d.goal_id
  loop
    v_need := ceil(g.gap / 12.0)::integer;
    v_got := 0;
    while v_got < v_need loop
      select c2.person_id, c2.source, c2.form, o.degree, o.label into pick
        from pg_temp.pl_cand c2
        cross join lateral public.leader_fit_options(c2.i) o
       where not c2.used and o.goal_id = g.goal_id and o.recommended and not o.care_flag
       order by o.degree desc,
                coalesce((select case when r.chosen_goal_id = g.goal_id then 0 when g.goal_id = any (coalesce(r.backup_goal_ids, '{}'::uuid[])) then 1 else 2 end
                            from public.leader_fit_runs r where r.person_id = c2.person_id and r.source <> 'appointment' order by r.seq desc limit 1), 2),
                o.next_to, c2.since, c2.person_id
       limit 1;
      exit when not found;
      update pg_temp.pl_cand set used = true where person_id = pick.person_id;
      insert into public.placement_leader_items (run_id, person_id, source, form, goal_id, degree, label)
      values (v_run, pick.person_id, pick.source, pick.form, g.goal_id, pick.degree, pick.label);
      v_got := v_got + 1;
      v_paired := v_paired + 1;
    end loop;
    if v_got < v_need then
      v_open := v_open || jsonb_build_array(jsonb_build_object('goal', g.goal_id, 'title', g.title, 'community', g.community, 'tribes_short', v_need - v_got, 'gap', g.gap));
    end if;
  end loop;

  for c in select x.person_id, x.source from pg_temp.pl_cand x where not x.used loop
    v_left := v_left || jsonb_build_array(jsonb_build_object('person', c.person_id, 'name', public.person_display_name(c.person_id),
      'reason', 'No goal needs them right now, or none of the goals that do suits them'));
  end loop;
  drop table if exists pg_temp.pl_cand;
  update public.placement_leader_runs set left_over = v_left, open_goals = v_open where id = v_run;
  perform public.write_event(auth.uid(), 'placement.leaders_planned', 'placement_leader_run', v_run::text,
    jsonb_build_object('paired', v_paired, 'left_over', jsonb_array_length(v_left), 'open_goals', jsonb_array_length(v_open)));
  return jsonb_build_object('run', v_run, 'paired', v_paired, 'left_over', jsonb_array_length(v_left), 'open_goals', jsonb_array_length(v_open));
end;
$$;

-- The goals a person in the plan could take instead, best first
create function public.placement_leaders_options(p_run uuid, p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
  it public.placement_leader_items;
  v_i jsonb;
begin
  perform public.god_only();
  select * into r from public.placement_leader_runs x where x.id = p_run;
  select * into it from public.placement_leader_items x where x.run_id = p_run and x.person_id = p_person;
  if r.id is null or it.id is null then
    raise exception 'That person is not in the plan' using errcode = '22023';
  end if;
  v_i := public.placement_leader_inputs(it.source, it.person_id, it.form);
  return coalesce((
    select jsonb_agg(jsonb_build_object('goal', o.goal_id, 'title', o.title, 'community', o.community_name, 'degree', o.degree, 'label', o.label,
                                         'gap', coalesce(d.gap, 0)) order by o.degree desc, o.goal_id)
      from public.leader_fit_options(v_i) o
      left join public.goal_demand_rows(r.season_id) d on d.goal_id = o.goal_id
     where o.recommended and not o.care_flag
       and exists (select 1 from public.tribe_card_templates t where t.season_goal_id = o.goal_id and t.status = 'signed_off')), '[]'::jsonb);
end;
$$;

-- Swap a pair to another goal, or take a person out of the run
create function public.placement_leaders_adjust(p_run uuid, p_person uuid, p_action text, p_goal uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
  it public.placement_leader_items;
  o public.leader_fit_option;
  v_i jsonb;
begin
  perform public.god_only();
  select * into r from public.placement_leader_runs x where x.id = p_run for update;
  if not found or r.status <> 'planned' then
    raise exception 'The plan can only be changed before it is approved' using errcode = '22023';
  end if;
  select * into it from public.placement_leader_items x where x.run_id = p_run and x.person_id = p_person for update;
  if not found or it.status <> 'proposed' then
    raise exception 'That person is not in the plan' using errcode = '22023';
  end if;
  if p_action = 'remove' then
    update public.placement_leader_items set status = 'removed', reason = 'Taken out by God Mode' where id = it.id;
  elsif p_action = 'move' then
    v_i := public.placement_leader_inputs(it.source, it.person_id, it.form);
    select * into o from public.leader_fit_options(v_i) x where x.goal_id = p_goal;
    if o.goal_id is null or o.care_flag
       or not exists (select 1 from public.tribe_card_templates t where t.season_goal_id = p_goal and t.status = 'signed_off') then
      raise exception 'That tribe is not one of the options for this person' using errcode = '22023';
    end if;
    update public.placement_leader_items set goal_id = p_goal, degree = o.degree, label = o.label where id = it.id;
  else
    raise exception 'Choose move or remove' using errcode = '22023';
  end if;
  perform public.write_event(auth.uid(), 'placement.leaders_adjust', 'placement_leader_run', p_run::text,
    jsonb_build_object('action', p_action, 'person', p_person, 'goal', p_goal));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.placement_leaders_approve(p_run uuid, p_expected integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
  v_n integer;
begin
  perform public.god_only();
  select * into r from public.placement_leader_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status in ('approved', 'applying', 'done') then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;
  if r.status <> 'planned' then
    raise exception 'This plan cannot be approved' using errcode = '22023';
  end if;
  select count(*)::integer into v_n from public.placement_leader_items x where x.run_id = p_run and x.status = 'proposed';
  if v_n = 0 then
    raise exception 'The plan appoints nobody' using errcode = '22023';
  end if;
  if p_expected is not null and p_expected <> v_n then
    raise exception 'The plan has changed. Reload the page and look again' using errcode = '22023';
  end if;
  update public.placement_leader_runs set status = 'approved', approved_at = now() where id = p_run;
  perform public.write_event(auth.uid(), 'placement.leaders_approved', 'placement_leader_run', p_run::text, jsonb_build_object('leaders', v_n));
  return jsonb_build_object('status', 'approved', 'leaders', v_n);
end;
$$;

create function public.placement_leaders_cancel(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
begin
  perform public.god_only();
  select * into r from public.placement_leader_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status not in ('planned', 'approved') or exists (select 1 from public.placement_leader_items i where i.run_id = p_run and i.status = 'applied') then
    raise exception 'This run has started appointing people' using errcode = '22023';
  end if;
  update public.placement_leader_runs set status = 'cancelled' where id = p_run;
  perform public.write_event(auth.uid(), 'placement.leaders_cancelled', 'placement_leader_run', p_run::text, '{}'::jsonb);
end;
$$;

-- Appoints the next 25. Each person is its own small step: one who cannot be appointed is marked with the reason and the others carry
-- on. Each appointed leader is sent "You have been appointed". Press it again until the run says it is done.
create function public.placement_leaders_apply(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
  it public.placement_leader_items;
  res jsonb;
  v_tribe uuid;
  g public.season_goals;
  v_done integer := 0;
  v_failed integer := 0;
  v_left integer;
  v_name text;
  v_community text;
begin
  perform public.god_only();
  select * into r from public.placement_leader_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if r.status not in ('approved', 'applying') then
    return jsonb_build_object('status', r.status, 'done', 0, 'left', 0);
  end if;
  if r.status = 'approved' then
    update public.placement_leader_runs set status = 'applying' where id = p_run;
  end if;
  for it in select x.* from public.placement_leader_items x where x.run_id = p_run and x.status = 'proposed' order by x.id limit 25 loop
    begin
      if it.source = 'sheet' then
        res := public.god_appoint_leader(it.person_id, it.form, it.goal_id, null);
      else
        res := public.god_start_leader_card(it.person_id, it.goal_id);
      end if;
      v_tribe := (res ->> 'tribe')::uuid;
      select * into g from public.season_goals x where x.id = it.goal_id;
      select c.name into v_community from public.communities c where c.id = g.community_id;
      select t.name into v_name from public.tribes t where t.id = v_tribe;
      update public.placement_leader_items set status = 'applied', tribe_id = v_tribe, applied_at = now() where id = it.id;
      perform public.enqueue_message(it.person_id, 'placement_leader_appointed',
        jsonb_build_object('goal', g.title, 'community', v_community, 'tribe', v_name, 'fit', it.label),
        v_tribe, 'leader-appointed:' || v_tribe, p_force => 'email');
      v_done := v_done + 1;
    exception when others then
      update public.placement_leader_items set status = 'failed', reason = left(sqlerrm, 300) where id = it.id;
      v_failed := v_failed + 1;
    end;
  end loop;
  select count(*)::integer into v_left from public.placement_leader_items x where x.run_id = p_run and x.status = 'proposed';
  if v_left = 0 then
    update public.placement_leader_runs set status = 'done', done_at = now() where id = p_run;
  end if;
  return jsonb_build_object('status', (select x.status from public.placement_leader_runs x where x.id = p_run), 'done', v_done, 'failed', v_failed, 'left', v_left);
end;
$$;

-- The run on the Bulk tab: the open one, or the latest, or the one named
create function public.placement_leaders_view(p_run uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.placement_leader_runs;
begin
  perform public.god_only();
  if p_run is not null then
    select * into r from public.placement_leader_runs x where x.id = p_run;
  else
    select * into r from public.placement_leader_runs x order by (x.status in ('planned', 'approved', 'applying')) desc, x.seq desc limit 1;
  end if;
  if r.id is null then
    return jsonb_build_object('run', null);
  end if;
  return jsonb_build_object(
    'run', jsonb_build_object('id', r.id, 'seq', r.seq, 'status', r.status, 'created_at', r.created_at, 'approved_at', r.approved_at, 'done_at', r.done_at),
    'left_over', r.left_over, 'open_goals', r.open_goals,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person', i.person_id, 'name', public.person_display_name(i.person_id), 'source', i.source,
               'goal', i.goal_id, 'title', g.title, 'community', c.name, 'degree', i.degree, 'label', i.label,
               'status', i.status, 'reason', i.reason, 'tribe', i.tribe_id) order by g.title, i.degree desc, i.id)
        from public.placement_leader_items i
        join public.season_goals g on g.id = i.goal_id
        join public.communities c on c.id = g.community_id
       where i.run_id = r.id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- What the Placement pages read (all begin god_only())
-- ---------------------------------------------------------------------------

-- The Overview: the switch and the church's choices, the run in progress, past runs, and what there is to place and to place into
create function public.placement_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.status in ('planning', 'planned', 'approved', 'placing') order by x.seq desc limit 1;
  return jsonb_build_object(
    'settings', public.placement_settings_get(),
    'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on) from public.seasons s where s.id = v_season),
    'open_run', case when r.id is null then null else jsonb_build_object(
        'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told) end,
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'seq', x.seq, 'status', x.status, 'rehearsal', x.rehearsal, 'created_at', x.created_at, 'pool', x.pool,
               'placed', (select count(*) from public.placement_items i where i.run_id = x.id and i.status = 'placed'),
               'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = x.id and m.status = 'active' and m.confirmed_at is not null))
             order by x.seq desc)
        from (select * from public.placement_runs order by seq desc limit 8) x), '[]'::jsonb),
    'supply', jsonb_build_object(
      'tribes_open', (select count(*) from public.tribes t where t.season_id = v_season and t.status = 'approved'
                        and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)),
      'seats_open', coalesce((select sum(greatest(t.capacity - (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active'), 0))
                                from public.tribes t where t.season_id = v_season and t.status = 'approved'
                                 and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)), 0),
      'members_with_form', (select count(*) from public.people p join public.member_profiles mp on mp.person_id = p.id
                             where not p.hidden and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
                               and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
                               and not exists (select 1 from public.tribe_members m where m.person_id = p.id and m.season_id = v_season and m.status = 'active')),
      'members_without_form', (select count(*) from public.people p
                                where not p.hidden and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
                                  and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
                                  and not exists (select 1 from public.member_profiles mp where mp.person_id = p.id)),
      'on_hold', (select count(*) from public.placement_holds)));
end;
$$;

-- One run: the counts, why people were left out, every tribe with the plan for it, and what has happened since
create function public.placement_run_view(p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
               'mail_queued_at', pt.mail_queued_at, 'cancelled_at', pt.cancelled_at,
               'placed', (select count(*) from public.placement_items i where i.run_id = p_run and i.tribe_id = t.id and i.status in ('placed', 'rehearsed')),
               'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.confirmed_at is not null),
               'withheld', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.contact_withheld),
               'changed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'released'),
               'fit', coalesce((select jsonb_object_agg(z.label, z.n) from (
                         select public.degree_label(i.degree) as label, count(*)::integer as n from public.placement_items i
                          where i.run_id = p_run and i.tribe_id = t.id and i.status in ('proposed', 'placed', 'rehearsed') group by 1) z), '{}'::jsonb))
             order by pt.small desc, t.name)
        from public.placement_teams pt join public.tribes t on t.id = pt.tribe_id where pt.run_id = p_run and (pt.proposed > 0 or pt.mail_queued_at is not null)), '[]'::jsonb),
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
$$;

-- The people in a run, a page at a time, filtered by what happened to them
create function public.placement_run_items(p_run uuid, p_status text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
begin
  perform public.god_only();
  if not exists (select 1 from public.placement_runs x where x.id = p_run) then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  select count(*)::integer into v_total from public.placement_items i where i.run_id = p_run and (p_status is null or i.status = p_status);
  return jsonb_build_object('total', v_total, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'person', z.person_id, 'name', public.person_display_name(z.person_id), 'status', z.status, 'reason', z.reason,
             'tribe', z.tribe_id, 'tribe_name', t.name, 'degree', z.degree, 'fit', public.degree_label(z.degree), 'cand_count', z.cand_count,
             'best_degree', z.best_degree, 'moved', z.moved, 'message', msg.status,
             'confirmed', m.confirmed_at is not null, 'withheld', coalesce(m.contact_withheld, false), 'seat', m.status) order by z.seq nulls last, z.id)
      from (select * from public.placement_items i where i.run_id = p_run and (p_status is null or i.status = p_status)
             order by i.seq nulls last, i.id limit v_limit offset v_off) z
      left join public.tribes t on t.id = z.tribe_id
      left join public.messages msg on msg.id = z.member_message
      left join public.tribe_members m on m.id = z.placement_id), '[]'::jsonb));
end;
$$;

-- Members God Mode has put on hold, so they can be lifted
create function public.placement_holds_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((select jsonb_agg(jsonb_build_object('person', h.person_id, 'name', public.person_display_name(h.person_id), 'since', h.created_at) order by h.created_at desc)
                     from public.placement_holds h), '[]'::jsonb);
end;
$$;

-- Puts a member on hold without going through a run
create function public.placement_hold_set(p_person uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  if not exists (select 1 from public.people p where p.id = p_person and not p.hidden) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = '22023';
  end if;
  insert into public.placement_holds (person_id, note) values (p_person, nullif(btrim(p_note), '')) on conflict (person_id) do update set note = excluded.note;
  perform public.write_event(auth.uid(), 'placement.hold_set', 'person', p_person::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Nothing here is open to the public: every function starts with no access, then gets exactly the access below.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.god_start_leader_card(p_person uuid, p_goal uuid),
  public.my_placement(),
  public.placement_adjust(p_run uuid, p_person uuid, p_action text, p_tribe uuid),
  public.placement_assign_batch(p_run uuid, p_limit integer),
  public.placement_candidates(p_person uuid, p_run uuid),
  public.placement_contact_refused(p_person uuid),
  public.placement_count_batch(p_run uuid, p_limit integer),
  public.placement_do_change(p_tm uuid),
  public.placement_do_confirm(p_tm uuid, p_version text),
  public.placement_do_withhold(p_tm uuid),
  public.placement_filter_members(p_tribe uuid, p_members jsonb),
  public.placement_floor(),
  public.placement_hold_clear(p_person uuid),
  public.placement_hold_set(p_person uuid, p_note text),
  public.placement_holds_list(),
  public.placement_leader_inputs(p_source text, p_person uuid, p_form jsonb),
  public.placement_leaders_adjust(p_run uuid, p_person uuid, p_action text, p_goal uuid),
  public.placement_leaders_apply(p_run uuid),
  public.placement_leaders_approve(p_run uuid, p_expected integer),
  public.placement_leaders_cancel(p_run uuid),
  public.placement_leaders_options(p_run uuid, p_person uuid),
  public.placement_leaders_plan(p_sheet jsonb, p_include_approved boolean),
  public.placement_leaders_view(p_run uuid),
  public.placement_link_seat(p_link text),
  public.placement_member_params(p_tribe uuid, p_person uuid, p_degree integer),
  public.placement_mode(),
  public.placement_my_confirm(p_version text),
  public.placement_my_withhold(),
  public.placement_options(p_run uuid, p_person uuid),
  public.placement_overview(),
  public.placement_place_batch(p_run uuid, p_limit integer),
  public.placement_place_item(p_run uuid, p_item bigint),
  public.placement_pool_reason(p_person uuid, p_season uuid, p_grace integer),
  public.placement_rehearse_teams(p_run uuid),
  public.placement_resolve_small(p_run uuid, p_tribe uuid, p_action text),
  public.placement_run_approve(p_run uuid, p_expected integer),
  public.placement_run_cancel(p_run uuid),
  public.placement_run_guard(),
  public.placement_run_items(p_run uuid, p_status text, p_limit integer, p_offset integer),
  public.placement_run_new(p_options jsonb),
  public.placement_run_place(p_run uuid),
  public.placement_run_step(p_run uuid),
  public.placement_run_view(p_run uuid),
  public.placement_seat_released(),
  public.placement_settings_get(),
  public.placement_settings_save(p_changes jsonb),
  public.placement_slot(p_anchor timestamp with time zone, p_pace integer, p_from integer, p_until integer, p_k integer),
  public.placement_state(p_tm uuid),
  public.placement_team_mail(p_run uuid),
  public.placement_teams_refresh(p_run uuid),
  public.placement_tick(),
  public.placement_token_mint(p_placement uuid, p_person uuid, p_days integer),
  public.placement_undo(p_run uuid),
  public.tribe_roster_marked(p_tribe uuid),
  public.tribe_week_marked(p_tribe uuid, p_week integer),
  public.worker_placed_change(p_token text, p_link text),
  public.worker_placed_confirm(p_token text, p_link text, p_version text),
  public.worker_placed_info(p_token text, p_link text),
  public.worker_placed_withhold(p_token text, p_link text),
  public.worker_placement_tick(p_token text)
  from public, anon, authenticated;
-- The console (each of these begins god_only(), which also needs the owner to be unlocked on this sign-in)
grant execute on function
  public.god_start_leader_card(p_person uuid, p_goal uuid),
  public.placement_adjust(p_run uuid, p_person uuid, p_action text, p_tribe uuid),
  public.placement_hold_clear(p_person uuid),
  public.placement_hold_set(p_person uuid, p_note text),
  public.placement_holds_list(),
  public.placement_leaders_adjust(p_run uuid, p_person uuid, p_action text, p_goal uuid),
  public.placement_leaders_apply(p_run uuid),
  public.placement_leaders_approve(p_run uuid, p_expected integer),
  public.placement_leaders_cancel(p_run uuid),
  public.placement_leaders_options(p_run uuid, p_person uuid),
  public.placement_leaders_plan(p_sheet jsonb, p_include_approved boolean),
  public.placement_leaders_view(p_run uuid),
  public.placement_options(p_run uuid, p_person uuid),
  public.placement_overview(),
  public.placement_resolve_small(p_run uuid, p_tribe uuid, p_action text),
  public.placement_run_approve(p_run uuid, p_expected integer),
  public.placement_run_cancel(p_run uuid),
  public.placement_run_items(p_run uuid, p_status text, p_limit integer, p_offset integer),
  public.placement_run_new(p_options jsonb),
  public.placement_run_place(p_run uuid),
  public.placement_run_step(p_run uuid),
  public.placement_run_view(p_run uuid),
  public.placement_settings_get(),
  public.placement_settings_save(p_changes jsonb),
  public.placement_undo(p_run uuid)
  to authenticated;
-- A signed-in leader's filtered lists, and a placed member's own choice
grant execute on function
  public.my_placement(),
  public.placement_my_confirm(p_version text),
  public.placement_my_withhold(),
  public.tribe_roster_marked(p_tribe uuid),
  public.tribe_week_marked(p_tribe uuid, p_week integer)
  to authenticated;
-- The sending service and the private link page have no account; the token is the credential.
grant execute on function
  public.worker_placed_change(p_token text, p_link text),
  public.worker_placed_confirm(p_token text, p_link text, p_version text),
  public.worker_placed_info(p_token text, p_link text),
  public.worker_placed_withhold(p_token text, p_link text),
  public.worker_placement_tick(p_token text)
  to anon;
-- Everything else (25 functions: the scorer, the batches, the checks) is internal and callable by nothing but the functions above.

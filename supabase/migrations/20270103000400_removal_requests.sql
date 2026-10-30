-- =============================================================================
-- United Tribes: WhatsApp that cannot fail quietly, stage 4 (leader removal requests)
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), "Leader removal requests", which starts Off and has a
-- Rehearsal position between Off and On. When it is On, the leader of a tribe (not the assistant) can ask the church to change a member's place in the
-- tribe. The leader never removes anyone: a person with the right to decides, and silence never removes anybody.
--
--   The ask         a leader gives one of five reasons (safety or conduct, repeated absence, conflict in the tribe, not a fit, other), writes 20 to 500
--                   characters, and says they have spoken to the person. At most two requests open at a time. An urgent mark also raises the existing
--                   urgent care alert.
--   Who decides     the tribe's coach first, and the Care Lead, a director or an admin always. A request about someone under 18, about safety or conduct, or
--                   about a member with an open care flag is decided only by the Care Lead, a director or an admin. A pastor reads them all. Nobody decides
--                   a request of their own or about themselves.
--   The answer      approve, decline, or ask the leader a question, always with a note. The leader is told each time.
--   Approved        the member's seat in that tribe is released (their attendance, testimonies and consents are untouched) and they go back to "no tribe yet";
--                   the matching offers other tribes, never that one again; they are told kindly, with a named person to talk to. The leader's note and
--                   the reason are never shown to the member. A declined request tells the member nothing.
--   Waiting         a reminder at day 3, and at day 7 the Care Lead and the directors are told. Nothing happens by itself after that.
--   Appeal          the member has 14 days to ask the Care Lead to look again; the Care Lead, a director, an admin or the person who approved can reinstate
--                   the seat if the tribe has room and the person is not seated elsewhere.
--   Kept            the leader's note and the replies are cleared after 12 months; the fact and the dates stay.
--
-- Off: nothing here is reachable and nothing changes. Rehearsal: the whole road can be walked, with every request marked as practice: nothing is released and
-- no member or leader is written to. Every message here is email only; none goes to Meta.
--
-- Replaced, because each must now leave out a tribe the church has taken a member out of (the old text is in the rollback file): match_candidates, and
-- placement_candidates (the placement scorer is match_candidates part for part; both change by the same one line, marked in the text).
-- Needs stages 1 to 3 in place first (the Switchboard's whole-church-only functions).
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('removal_requests', 'Leader removal requests', 'Lets the leader of a tribe ask the church to change a member''s place in it, with a reason and a note. A person with the right to decides; a leader never removes anyone, and silence never does. Rehearsal walks the whole road as practice with nothing changed. For the whole church only.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 25, true);

-- ---------------------------------------------------------------------------
-- The requests
-- ---------------------------------------------------------------------------
create table public.removal_requests (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  seat_id uuid not null references public.tribe_members (id) on delete cascade,
  member_id uuid not null references public.people (id) on delete cascade,
  asked_by uuid not null references public.people (id) on delete cascade,
  reason text not null check (reason in ('safety_or_conduct', 'repeated_absence', 'conflict', 'not_a_fit', 'other')),
  -- The leader's words. Cleared after 12 months (note_cleared_at says when); the fact of the request stays.
  note text check (note is null or char_length(note) between 20 and 500),
  note_cleared_at timestamptz,
  spoken boolean not null check (spoken),
  urgent boolean not null default false,
  -- Only the Care Lead, a director or an admin may decide it
  restricted boolean not null default false,
  -- Filed while the switch was on Rehearsal: practice, nothing is released and no one is written to
  rehearsal boolean not null default false,
  status text not null default 'open' check (status in ('open', 'approved', 'declined', 'withdrawn')),
  waiting_on text not null default 'approver' check (waiting_on in ('approver', 'leader')),
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  reminded_at timestamptz,
  escalated_at timestamptz,
  appealed_at timestamptz,
  appeal_note text check (appeal_note is null or char_length(appeal_note) <= 500),
  appeal_status text check (appeal_status in ('open', 'upheld', 'reinstated')),
  appeal_decided_by uuid references public.people (id) on delete set null,
  appeal_decided_at timestamptz,
  appeal_decision_note text check (appeal_decision_note is null or char_length(appeal_decision_note) <= 500),
  reinstated_at timestamptz,
  reinstated_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
-- One open request for a seat at a time (a practice one and a real one do not collide)
create unique index removal_requests_one_open on public.removal_requests (seat_id, rehearsal) where status = 'open';
create index removal_requests_leader_idx on public.removal_requests (asked_by, status);
create index removal_requests_tribe_idx on public.removal_requests (tribe_id, status);
create index removal_requests_member_idx on public.removal_requests (member_id, status);
create index removal_requests_open_idx on public.removal_requests (created_at) where status = 'open';

-- The questions and answers between the person deciding and the leader
create table public.removal_thread (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.removal_requests (id) on delete cascade,
  by_person uuid references public.people (id) on delete set null,
  side text not null check (side in ('approver', 'leader')),
  body text check (body is null or char_length(body) between 1 and 500),
  at timestamptz not null default now()
);
create index removal_thread_request_idx on public.removal_thread (request_id, id);

-- A tribe the church has taken a member out of: the matching never offers it to them again, unless the seat is reinstated
create table public.removal_blocks (
  request_id uuid primary key references public.removal_requests (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  created_at timestamptz not null default now(),
  lifted_at timestamptz
);
create index removal_blocks_lookup_idx on public.removal_blocks (person_id, tribe_id) where lifted_at is null;

alter table public.removal_requests enable row level security;
alter table public.removal_thread enable row level security;
alter table public.removal_blocks enable row level security;
revoke all on table public.removal_requests, public.removal_thread, public.removal_blocks from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------
create function public.removal_state()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.feature_platform_state('removal_requests');
$$;

create function public.removal_has_role(p_person uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.person_roles r join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
                  where r.person_id = p_person and r.role::text = any (p_roles));
$$;

-- Who may decide a request: never the leader who asked or the person it is about. An ordinary request: the tribe's coach, the Care Lead, a director or an
-- admin. A restricted one: only the Care Lead, a director or an admin.
create function public.removal_can_decide(p_req uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_person is not null
     and exists (select 1 from public.removal_requests q join public.tribes t on t.id = q.tribe_id
                  where q.id = p_req
                    and p_person not in (q.asked_by, q.member_id)
                    and (public.removal_has_role(p_person, array['care_lead', 'director', 'admin'])
                         or (not q.restricted and t.coach_id = p_person)));
$$;

-- Who may read a request: those who may decide it, the tribe's coach, every pastor, and the leader who asked. Never the person it is about.
create function public.removal_can_read(p_req uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_person is not null
     and exists (select 1 from public.removal_requests q join public.tribes t on t.id = q.tribe_id
                  where q.id = p_req
                    and p_person <> q.member_id
                    and (q.asked_by = p_person
                         or t.coach_id = p_person
                         or public.removal_has_role(p_person, array['care_lead', 'director', 'admin', 'pastor'])));
$$;

-- A request goes to the narrow list when it is about safety or conduct, about someone under 18, or about a member with an open care flag or care task
-- in that tribe.
create function public.removal_is_restricted(p_member uuid, p_tribe uuid, p_reason text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_reason = 'safety_or_conduct'
      or public.is_minor(p_member)
      or exists (select 1 from public.care_flags f where f.person_id = p_member and f.tribe_id = p_tribe and f.status <> 'closed')
      or exists (select 1 from public.care_tasks k where k.person_id = p_member and k.tribe_id = p_tribe and k.status = 'open');
$$;

-- The person a member is told to talk to: the first name of someone on the care team
create function public.removal_contact_first()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select public.first_name_of(t) from public.care_team() as t order by t limit 1), 'Our care team');
$$;

-- Takes the member's seat out of the tribe and sends them back to "no tribe yet". Nothing they wrote or did in the tribe is touched.
create function public.removal_release(p_req uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.removal_requests%rowtype;
begin
  select * into q from public.removal_requests where id = p_req;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Place changed by the church'
   where id = q.seat_id and status = 'active';
  insert into public.removal_blocks (request_id, person_id, tribe_id, season_id)
  select q.id, q.member_id, q.tribe_id, m.season_id from public.tribe_members m where m.id = q.seat_id
  on conflict (request_id) do update set lifted_at = null;
  -- Their tribes are looked at afresh the next time they open the page, without the one they were taken out of
  update public.match_recommendations set chosen = false where person_id = q.member_id and tribe_id = q.tribe_id;
  delete from public.match_runs where person_id = q.member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The matching leaves out a tribe the church has taken a member out of. match_candidates and placement_candidates are copied exactly as they stood, with
-- one line added to the tribes each looks at (marked in the text). Nothing else in either function changes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_candidates(p_person uuid)
 RETURNS TABLE(r_tribe uuid, r_degree integer, r_goal numeric, r_stage numeric, r_community numeric, r_place numeric, r_style numeric, r_rhythm numeric, r_faith numeric, r_balance numeric, r_affinity numeric, r_online boolean, r_seats integer, r_published timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- their own life stage, or the next one up or down if they said that would be fine
       and (c.track_id = my_track
            -- a neighbouring life stage is only ever for adults, and never the teen track
            or (me.open_to_adjacent and not my_minor
                and exists (select 1 from public.tracks ct
                             where ct.id = c.track_id and ct.active and ct.slug <> 'teens' and abs(ct.sort - my_sort) = 1)))
       -- young people are only placed in a tribe led by two adults
       and (not my_minor or c.assistant_id is not null)
       and c.leader_id <> p_person
       -- (stage 4) a tribe the church has taken this member out of is not offered to them again, unless the seat is put back
       and not exists (select 1 from public.removal_blocks rb where rb.person_id = p_person and rb.tribe_id = c.id and rb.lifted_at is null)
       and (c.assistant_id is null or c.assistant_id <> p_person)
       -- the member can make the time
       and (cardinality(me.meeting_times) = 0 or c.slot = any (me.meeting_times))
       -- the member can make the format
       and (me.meeting_mode = 'either' or me.meeting_mode::text = c.meeting_mode)
       and (c.meeting_mode = 'online' or me.zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
       -- the tribe is for them
       and (case c.tribe_type
              when 'mixed' then me.tribe_mix <> 'same_gender'
              when 'women' then me.gender = 'female' and me.tribe_mix <> 'mixed'
              when 'men'   then me.gender = 'male'   and me.tribe_mix <> 'mixed'
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
      left join public.tribe_members cm on cm.tribe_id = p.id and cm.status = 'active'
      left join public.member_profiles mp on mp.person_id = cm.person_id
     group by p.id
  ),
  open_ones as (
    select p.*, x.n, x.soc_sum, x.same_stage_n
      from pool p
      join mix x on x.cid = p.id
     where p.capacity - x.n >= 1
       -- tribe health: no more than two heavy-support members
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
           -- Does this person bring a role the tribe is short of? A role two others already hold counts for less.
           case when cardinality(me.group_roles) = 0 then null
                else (select avg(case when (select count(*)
                                              from public.tribe_members cm2
                                              join public.member_profiles mp2 on mp2.person_id = cm2.person_id
                                             where cm2.tribe_id = o.id and cm2.status = 'active' and r = any (mp2.group_roles)) < 2
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
$function$
;

CREATE OR REPLACE FUNCTION public.placement_candidates(p_person uuid, p_run uuid DEFAULT NULL::uuid)
 RETURNS TABLE(r_tribe uuid, r_degree integer, r_goal numeric, r_stage numeric, r_community numeric, r_place numeric, r_style numeric, r_rhythm numeric, r_faith numeric, r_balance numeric, r_affinity numeric, r_online boolean, r_seats integer, r_published timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       -- (stage 4) a tribe the church has taken this member out of is not offered to them again, unless the seat is put back
       and not exists (select 1 from public.removal_blocks rb where rb.person_id = p_person and rb.tribe_id = c.id and rb.lifted_at is null)
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
$function$
;

-- ---------------------------------------------------------------------------
-- The leader's ask
-- ---------------------------------------------------------------------------
create function public.removal_ask(
  p_tribe uuid,
  p_member uuid,
  p_reason text,
  p_note text,
  p_spoken boolean,
  p_urgent boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_state text := public.removal_state();
  t public.tribes%rowtype;
  seat public.tribe_members%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_rehearsal boolean;
  v_restricted boolean;
  v_open integer;
  v_id uuid;
  v_centre uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_state = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into t from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if t.leader_id is distinct from uid then
    raise exception 'Only the leader of the tribe can ask this' using errcode = '42501';
  end if;
  if p_member is null or p_member = uid then
    raise exception 'Choose a member of your tribe' using errcode = '22023';
  end if;
  select * into seat from public.tribe_members where tribe_id = p_tribe and person_id = p_member and status = 'active' for update;
  if not found then
    raise exception 'That person is not a member of your tribe' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('safety_or_conduct', 'repeated_absence', 'conflict', 'not_a_fit', 'other') then
    raise exception 'Choose the reason that fits best' using errcode = '22023';
  end if;
  if char_length(v_note) < 20 or char_length(v_note) > 500 then
    raise exception 'Write between 20 and 500 characters about what has happened, so the person deciding understands' using errcode = '22023';
  end if;
  if p_spoken is distinct from true then
    raise exception 'Please speak to this person first, then tick that you have' using errcode = '22023';
  end if;
  v_rehearsal := v_state = 'rehearsal';
  select count(*)::integer into v_open from public.removal_requests where asked_by = uid and status = 'open' and rehearsal = v_rehearsal;
  if v_open >= 2 then
    raise exception 'You already have two requests waiting. Wait for an answer to one before you ask about another' using errcode = '22023';
  end if;
  if exists (select 1 from public.removal_requests where seat_id = seat.id and status = 'open' and rehearsal = v_rehearsal) then
    raise exception 'A request about this person is already waiting' using errcode = '22023';
  end if;
  v_restricted := public.removal_is_restricted(p_member, p_tribe, p_reason);

  insert into public.removal_requests (tribe_id, seat_id, member_id, asked_by, reason, note, spoken, urgent, restricted, rehearsal)
  values (p_tribe, seat.id, p_member, uid, p_reason, v_note, true, coalesce(p_urgent, false), v_restricted, v_rehearsal)
  returning id into v_id;

  -- Urgent: the existing urgent care alert (email and text to the care team at once). Never in rehearsal: practice sends nothing real.
  if coalesce(p_urgent, false) and not v_rehearsal then
    perform public.raise_care_task(p_tribe, p_member, 'urgent',
      'A leader asked the church to change this person''s place in the tribe and marked it urgent. The request is on the removal requests page.', null, uid);
  end if;

  -- The people who decide are told by the notice engine (never a name, never a reason). A fault there never stops the request.
  begin
    select p.centre_id into v_centre from public.people p where p.id = uid;
    perform public.notify_care(v_centre, 'care_removal_ask', 'removal:' || v_id, '{}'::jsonb,
      'A leader has asked for a member''s place in a tribe to change', '/growth/removals', true);
    if not v_restricted and t.coach_id is not null then
      perform public.notify_person(t.coach_id, 'coaches', 'coach_removal_ask', 'removal:' || v_id, '{}'::jsonb,
        'A leader in your care has asked for a member''s place to change', '/growth/removals', true);
    end if;
  exception when others then
    perform public.notice_fault('removal_ask', sqlerrm);
  end;

  perform public.write_event(uid, 'removal.asked', 'removal', v_id::text,
    jsonb_build_object('reason', p_reason, 'restricted', v_restricted, 'urgent', coalesce(p_urgent, false), 'rehearsal', v_rehearsal));
  return jsonb_build_object('ok', true, 'id', v_id, 'rehearsal', v_rehearsal, 'restricted', v_restricted);
end;
$$;

-- The leader answers a question put to them
create function public.removal_answer(p_req uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
  t public.tribes%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_thread bigint;
  v_centre uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req for update;
  if not found or q.asked_by <> uid then
    raise exception 'That request is not yours' using errcode = '42501';
  end if;
  if q.status <> 'open' or q.waiting_on <> 'leader' then
    raise exception 'There is no question waiting for you on this request' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'Write your answer in 500 characters or fewer' using errcode = '22023';
  end if;
  insert into public.removal_thread (request_id, by_person, side, body) values (q.id, uid, 'leader', v_body) returning id into v_thread;
  update public.removal_requests set waiting_on = 'approver' where id = q.id;
  select * into t from public.tribes where id = q.tribe_id;
  begin
    select p.centre_id into v_centre from public.people p where p.id = uid;
    perform public.notify_care(v_centre, 'care_removal_ask', 'removal:' || q.id || ':a' || v_thread, jsonb_build_object('again', true),
      'A leader has answered a question about a request', '/growth/removals', true);
    if not q.restricted and t.coach_id is not null then
      perform public.notify_person(t.coach_id, 'coaches', 'coach_removal_ask', 'removal:' || q.id || ':a' || v_thread, jsonb_build_object('again', true),
        'A leader has answered a question about a request', '/growth/removals', true);
    end if;
  exception when others then
    perform public.notice_fault('removal_answer', sqlerrm);
  end;
  perform public.write_event(uid, 'removal.answered', 'removal', q.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- The leader takes a request back
create function public.removal_withdraw(p_req uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req for update;
  if not found or q.asked_by <> uid then
    raise exception 'That request is not yours' using errcode = '42501';
  end if;
  if q.status <> 'open' then
    raise exception 'That request has been answered already' using errcode = '22023';
  end if;
  update public.removal_requests set status = 'withdrawn', decided_at = now() where id = q.id;
  perform public.write_event(uid, 'removal.withdrawn', 'removal', q.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- What the leader sees on the tribe's page: whether they can ask, how many requests they have waiting, and where each stands
create function public.removal_mine(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_state text := public.removal_state();
  t public.tribes%rowtype;
  v_rehearsal boolean := public.removal_state() = 'rehearsal';
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.tribes where id = p_tribe;
  if v_state = 'off' or not found or t.leader_id is distinct from uid then
    return jsonb_build_object('state', 'off', 'can_ask', false, 'open', 0, 'max', 2, 'requests', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'state', v_state,
    'can_ask', true,
    'open', (select count(*)::integer from public.removal_requests r where r.asked_by = uid and r.status = 'open' and r.rehearsal = v_rehearsal),
    'max', 2,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'member_id', r.member_id,
               'member_first', public.first_name_of(r.member_id),
               'status', r.status,
               'waiting_on', r.waiting_on,
               'rehearsal', r.rehearsal,
               'created_at', r.created_at,
               'decided_at', r.decided_at,
               'question', case when r.status = 'open' and r.waiting_on = 'leader'
                                then (select th.body from public.removal_thread th where th.request_id = r.id and th.side = 'approver' order by th.id desc limit 1) end,
               'decision_note', case when r.status = 'declined' then r.decision_note end) order by r.created_at desc)
        from public.removal_requests r
       where r.tribe_id = p_tribe and r.asked_by = uid
         and (r.status = 'open' or coalesce(r.decided_at, r.created_at) > now() - interval '30 days')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The people who decide
-- ---------------------------------------------------------------------------
create function public.removal_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_state text := public.removal_state();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_state = 'off' then
    return jsonb_build_object('state', 'off', 'requests', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'state', v_state,
    'requests', coalesce((
      select jsonb_agg(x.j order by x.open_first, x.urgent_first, x.at)
        from (
          select jsonb_build_object(
                   'id', q.id,
                   'tribe', t.name,
                   'member', public.person_display_name(q.member_id),
                   'member_first', public.first_name_of(q.member_id),
                   'under_18', public.is_minor(q.member_id),
                   'leader', public.person_display_name(q.asked_by),
                   'reason', q.reason,
                   'note', q.note,
                   'note_cleared', q.note_cleared_at is not null,
                   'urgent', q.urgent,
                   'restricted', q.restricted,
                   'rehearsal', q.rehearsal,
                   'status', q.status,
                   'waiting_on', q.waiting_on,
                   'created_at', q.created_at,
                   'days', greatest(0, public.today_lagos() - (q.created_at at time zone 'Africa/Lagos')::date),
                   'reminded', q.reminded_at is not null,
                   'escalated', q.escalated_at is not null,
                   'decided_at', q.decided_at,
                   'decided_by', case when q.decided_by is null then null else public.first_name_of(q.decided_by) end,
                   'decision_note', q.decision_note,
                   'can_decide', q.status = 'open' and public.removal_can_decide(q.id, uid),
                   'can_reinstate', q.status = 'approved' and not q.rehearsal and q.reinstated_at is null
                                    and uid not in (q.asked_by, q.member_id)
                                    and (q.decided_by = uid or public.removal_has_role(uid, array['care_lead', 'director', 'admin'])),
                   'can_judge_appeal', q.appeal_status = 'open' and uid not in (q.asked_by, q.member_id)
                                       and public.removal_has_role(uid, array['care_lead', 'director', 'admin']),
                   'reinstated_at', q.reinstated_at,
                   'appeal', case when q.appealed_at is null then null
                                  else jsonb_build_object('status', q.appeal_status, 'note', q.appeal_note, 'at', q.appealed_at, 'decision_note', q.appeal_decision_note) end,
                   'attendance', jsonb_build_object(
                     'present', (select count(*)::integer from public.tribe_attendance a where a.tribe_id = q.tribe_id and a.person_id = q.member_id and a.status = 'present'),
                     'absent', (select count(*)::integer from public.tribe_attendance a where a.tribe_id = q.tribe_id and a.person_id = q.member_id and a.status = 'absent'),
                     'excused', (select count(*)::integer from public.tribe_attendance a where a.tribe_id = q.tribe_id and a.person_id = q.member_id and a.status = 'excused')),
                   'thread', coalesce((select jsonb_agg(jsonb_build_object('side', th.side, 'body', th.body, 'at', th.at) order by th.id)
                                         from public.removal_thread th where th.request_id = q.id), '[]'::jsonb)) as j,
                 case when q.status = 'open' or q.appeal_status = 'open' then 0 else 1 end as open_first,
                 case when q.urgent then 0 else 1 end as urgent_first,
                 q.created_at as at
            from public.removal_requests q
            join public.tribes t on t.id = q.tribe_id
           where public.removal_can_read(q.id, uid)
             and (q.status = 'open' or q.appeal_status = 'open' or coalesce(q.decided_at, q.created_at) > now() - interval '60 days')) x), '[]'::jsonb));
end;
$$;

create function public.removal_decide(p_req uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
  t public.tribes%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_first text;
  v_thread bigint;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req for update;
  if not found then
    raise exception 'That request does not exist' using errcode = 'P0002';
  end if;
  if not public.removal_can_decide(q.id, uid) then
    raise exception 'You cannot decide this request' using errcode = '42501';
  end if;
  if q.status <> 'open' then
    raise exception 'That request has been answered already' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approve', 'decline', 'ask') then
    raise exception 'Choose approve, decline or ask the leader a question' using errcode = '22023';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception 'Write a note of 10 to 500 characters with your answer' using errcode = '22023';
  end if;
  if p_decision = 'ask' and q.waiting_on = 'leader' then
    raise exception 'You have asked the leader already. Wait for the answer, or decide now' using errcode = '22023';
  end if;
  select * into t from public.tribes where id = q.tribe_id;
  v_first := public.first_name_of(q.member_id);

  if p_decision = 'ask' then
    insert into public.removal_thread (request_id, by_person, side, body) values (q.id, uid, 'approver', v_note) returning id into v_thread;
    update public.removal_requests set waiting_on = 'leader' where id = q.id;
    if not q.rehearsal then
      perform public.enqueue_message(q.asked_by, 'removal_leader_decided',
        jsonb_build_object('decision', 'question', 'member_first', v_first, 'tribe', t.name),
        q.tribe_id, 'removal:' || q.id || ':q' || v_thread, null, 'normal', 'email');
    end if;
  elsif p_decision = 'decline' then
    update public.removal_requests set status = 'declined', waiting_on = 'approver', decided_by = uid, decided_at = now(), decision_note = v_note where id = q.id;
    -- Declined: the leader is told; the member is told nothing
    if not q.rehearsal then
      perform public.enqueue_message(q.asked_by, 'removal_leader_decided',
        jsonb_build_object('decision', 'declined', 'member_first', v_first, 'tribe', t.name),
        q.tribe_id, 'removal:' || q.id || ':leader', null, 'normal', 'email');
    end if;
  else
    update public.removal_requests set status = 'approved', waiting_on = 'approver', decided_by = uid, decided_at = now(), decision_note = v_note where id = q.id;
    if not q.rehearsal then
      perform public.removal_release(q.id);
      -- The member is told kindly, with other tribes and a person to talk to. Never the reason, never the leader's note. A young person is not
      -- written to: the Care Lead speaks to their parent or guardian.
      if not public.is_minor(q.member_id) then
        perform public.enqueue_message(q.member_id, 'removal_member_told',
          jsonb_build_object('tribe', t.name, 'contact_first', public.removal_contact_first(), 'appeal_days', 14),
          q.tribe_id, 'removal:' || q.id || ':member', null, 'normal', 'email');
      end if;
      perform public.enqueue_message(q.asked_by, 'removal_leader_decided',
        jsonb_build_object('decision', 'approved', 'member_first', v_first, 'tribe', t.name),
        q.tribe_id, 'removal:' || q.id || ':leader', null, 'normal', 'email');
    end if;
  end if;
  perform public.write_event(uid, 'removal.' || case p_decision when 'ask' then 'asked_back' when 'decline' then 'declined' else 'approved' end,
    'removal', q.id::text, jsonb_build_object('rehearsal', q.rehearsal));
  return jsonb_build_object('ok', true, 'rehearsal', q.rehearsal);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member: told kindly, and 14 days to ask the Care Lead to look again
-- ---------------------------------------------------------------------------
create function public.my_removal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' or public.is_minor(uid) then
    return null;
  end if;
  select * into q from public.removal_requests r
   where r.member_id = uid and r.rehearsal = false and r.status = 'approved' and r.decided_at > now() - interval '30 days'
   order by r.decided_at desc limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', q.id,
    'tribe', (select t.name from public.tribes t where t.id = q.tribe_id),
    'decided_on', (q.decided_at at time zone 'Africa/Lagos')::date,
    'contact_first', public.removal_contact_first(),
    'reinstated', q.reinstated_at is not null,
    'appeal', case when q.appealed_at is null then null else jsonb_build_object('status', q.appeal_status, 'at', q.appealed_at) end,
    'can_appeal', q.reinstated_at is null and q.appealed_at is null and q.decided_at > now() - interval '14 days',
    'appeal_until', ((q.decided_at + interval '14 days') at time zone 'Africa/Lagos')::date);
end;
$$;

create function public.removal_appeal(p_req uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_centre uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req and member_id = uid for update;
  if not found or q.status <> 'approved' or q.rehearsal then
    raise exception 'There is nothing here to ask about' using errcode = '22023';
  end if;
  if q.reinstated_at is not null then
    raise exception 'Your place has already been restored' using errcode = '22023';
  end if;
  if q.appealed_at is not null then
    raise exception 'You have asked already. The Care Lead will be in touch' using errcode = '22023';
  end if;
  if q.decided_at <= now() - interval '14 days' then
    raise exception 'The 14 days to ask have passed. Please talk to the Care Lead' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep it to 500 characters' using errcode = '22023';
  end if;
  update public.removal_requests set appealed_at = now(), appeal_status = 'open', appeal_note = v_note where id = q.id;
  begin
    select p.centre_id into v_centre from public.people p where p.id = uid;
    perform public.notify_care(v_centre, 'care_removal_appeal', 'removalappeal:' || q.id, '{}'::jsonb,
      'A member asked the Care Lead to look again at a change of tribe', '/growth/removals', true);
  exception when others then
    perform public.notice_fault('removal_appeal', sqlerrm);
  end;
  perform public.write_event(uid, 'removal.appealed', 'removal', q.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Puts the seat back: whoever approved it, the Care Lead, a director or an admin, if the tribe has room and the person has not joined another
create function public.removal_reinstate(p_req uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
  t public.tribes%rowtype;
  seat public.tribe_members%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req for update;
  if not found then
    raise exception 'That request does not exist' using errcode = 'P0002';
  end if;
  if uid in (q.asked_by, q.member_id) or not (q.decided_by = uid or public.removal_has_role(uid, array['care_lead', 'director', 'admin'])) then
    raise exception 'You cannot put this place back' using errcode = '42501';
  end if;
  if q.status <> 'approved' or q.rehearsal or q.reinstated_at is not null then
    raise exception 'There is no change here to undo' using errcode = '22023';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception 'Write a note of 10 to 500 characters with your answer' using errcode = '22023';
  end if;
  select * into t from public.tribes where id = q.tribe_id;
  select * into seat from public.tribe_members where id = q.seat_id for update;
  if t.status <> 'approved' then
    raise exception 'That tribe is not open any more' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribe_members m where m.person_id = q.member_id and m.season_id = seat.season_id and m.status = 'active') then
    raise exception 'That person has joined another tribe since. Their place there would have to change first' using errcode = '22023';
  end if;
  if (select count(*) from public.tribe_members m where m.tribe_id = q.tribe_id and m.status = 'active') >= t.capacity then
    raise exception 'The tribe is full. A place has to be free first' using errcode = '22023';
  end if;
  update public.tribe_members set status = 'active', released_at = null, release_reason = null where id = seat.id;
  update public.removal_blocks set lifted_at = now() where request_id = q.id;
  update public.removal_requests
     set reinstated_at = now(), reinstated_by = uid,
         appeal_status = case when appeal_status = 'open' then 'reinstated' else appeal_status end,
         appeal_decided_by = case when appeal_status = 'open' then uid else appeal_decided_by end,
         appeal_decided_at = case when appeal_status = 'open' then now() else appeal_decided_at end,
         appeal_decision_note = case when appeal_status = 'open' then v_note else appeal_decision_note end
   where id = q.id;
  if not public.is_minor(q.member_id) then
    perform public.enqueue_message(q.member_id, 'removal_member_reinstated', jsonb_build_object('tribe', t.name),
      q.tribe_id, 'removal:' || q.id || ':back:member', null, 'normal', 'email');
  end if;
  perform public.enqueue_message(q.asked_by, 'removal_leader_decided',
    jsonb_build_object('decision', 'reinstated', 'member_first', public.first_name_of(q.member_id), 'tribe', t.name),
    q.tribe_id, 'removal:' || q.id || ':back:leader', null, 'normal', 'email');
  perform public.write_event(uid, 'removal.reinstated', 'removal', q.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- The Care Lead looks again and keeps the decision
create function public.removal_appeal_uphold(p_req uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  q public.removal_requests%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.removal_state() = 'off' then
    raise exception 'Asking the church about a member''s place is not open yet' using errcode = '22023';
  end if;
  select * into q from public.removal_requests where id = p_req for update;
  if not found then
    raise exception 'That request does not exist' using errcode = 'P0002';
  end if;
  if uid in (q.asked_by, q.member_id) or not public.removal_has_role(uid, array['care_lead', 'director', 'admin']) then
    raise exception 'Only the Care Lead, a director or an admin can answer an appeal' using errcode = '42501';
  end if;
  if q.appeal_status is distinct from 'open' then
    raise exception 'There is no appeal waiting' using errcode = '22023';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 500 then
    raise exception 'Write a note of 10 to 500 characters with your answer' using errcode = '22023';
  end if;
  update public.removal_requests
     set appeal_status = 'upheld', appeal_decided_by = uid, appeal_decided_at = now(), appeal_decision_note = v_note
   where id = q.id;
  perform public.write_event(uid, 'removal.appeal_kept', 'removal', q.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The heartbeat: reminders, the day-7 escalation, and clearing the leader's words after 12 months. Silence never removes anyone: nothing here decides.
-- ---------------------------------------------------------------------------
create function public.removal_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := public.removal_state();
  r record;
  d record;
  v_reminded integer := 0;
  v_escalated integer := 0;
  v_cleared integer := 0;
begin
  -- Keeping the leader's words for 12 months is a promise, whatever the switch says
  update public.removal_requests set note = null, decision_note = null, note_cleared_at = now()
   where note_cleared_at is null and created_at < now() - interval '12 months' and (note is not null or decision_note is not null);
  get diagnostics v_cleared = row_count;
  update public.removal_thread set body = null
   where body is not null and request_id in (select q.id from public.removal_requests q where q.note_cleared_at is not null);

  if v_state = 'off' then
    return jsonb_build_object('on', false, 'cleared', v_cleared);
  end if;

  for r in
    select q.id, q.restricted, t.coach_id, p.centre_id
      from public.removal_requests q
      join public.tribes t on t.id = q.tribe_id
      join public.people p on p.id = q.asked_by
     where q.status = 'open' and q.waiting_on = 'approver' and not q.rehearsal and q.reminded_at is null and q.created_at <= now() - interval '3 days'
     order by q.created_at
  loop
    update public.removal_requests set reminded_at = now() where id = r.id;
    v_reminded := v_reminded + 1;
    begin
      perform public.notify_care(r.centre_id, 'care_removal_waiting', 'removal:' || r.id || ':remind', jsonb_build_object('level', 'reminder'),
        'A request about a member''s place has waited three days', '/growth/removals', false);
      if not r.restricted and r.coach_id is not null then
        perform public.notify_person(r.coach_id, 'coaches', 'coach_removal_waiting', 'removal:' || r.id || ':remind', jsonb_build_object('level', 'reminder'),
          'A request about a member''s place has waited three days', '/growth/removals', false);
      end if;
    exception when others then
      perform public.notice_fault('removal_tick', sqlerrm);
    end;
  end loop;

  for r in
    select q.id, p.centre_id
      from public.removal_requests q
      join public.people p on p.id = q.asked_by
     where q.status = 'open' and not q.rehearsal and q.escalated_at is null and q.created_at <= now() - interval '7 days'
     order by q.created_at
  loop
    update public.removal_requests set escalated_at = now() where id = r.id;
    v_escalated := v_escalated + 1;
    begin
      perform public.notify_care(r.centre_id, 'care_removal_waiting', 'removal:' || r.id || ':escalate', jsonb_build_object('level', 'escalated'),
        'A request about a member''s place has waited a week', '/growth/removals', true);
      for d in select distinct pr.person_id from public.person_roles pr where pr.centre_id = r.centre_id and pr.role::text = 'director' loop
        perform public.notify_person(d.person_id, 'directors', 'director_removal_escalated', 'removal:' || r.id || ':escalate', '{}'::jsonb,
          'A request about a member''s place has waited a week', '/growth/removals', true);
      end loop;
    exception when others then
      perform public.notice_fault('removal_tick', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('on', true, 'reminded', v_reminded, 'escalated', v_escalated, 'cleared', v_cleared);
end;
$$;

create function public.worker_removal_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.removal_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function
  public.removal_state(),
  public.removal_has_role(uuid, text[]),
  public.removal_can_decide(uuid, uuid),
  public.removal_can_read(uuid, uuid),
  public.removal_is_restricted(uuid, uuid, text),
  public.removal_contact_first(),
  public.removal_release(uuid),
  public.removal_tick()
  from public, anon, authenticated;

revoke execute on function
  public.removal_ask(uuid, uuid, text, text, boolean, boolean),
  public.removal_answer(uuid, text),
  public.removal_withdraw(uuid),
  public.removal_mine(uuid),
  public.removal_board(),
  public.removal_decide(uuid, text, text),
  public.my_removal(),
  public.removal_appeal(uuid, text),
  public.removal_reinstate(uuid, text),
  public.removal_appeal_uphold(uuid, text)
  from public, anon;

grant execute on function
  public.removal_ask(uuid, uuid, text, text, boolean, boolean),
  public.removal_answer(uuid, text),
  public.removal_withdraw(uuid),
  public.removal_mine(uuid),
  public.removal_board(),
  public.removal_decide(uuid, text, text),
  public.my_removal(),
  public.removal_appeal(uuid, text),
  public.removal_reinstate(uuid, text),
  public.removal_appeal_uphold(uuid, text)
  to authenticated;

-- The sending service has no account; the token is the credential.
grant execute on function public.worker_removal_tick(text) to anon, authenticated;

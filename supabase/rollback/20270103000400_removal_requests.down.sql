-- Way back from "WhatsApp that cannot fail quietly", stage 4 (leader removal requests): the matching goes back to what it was.
--
-- Puts match_candidates and placement_candidates back exactly as they were (neither leaves out a tribe the church took a member out of any more), drops the
-- functions, the three tables and the Switchboard entry (with its rule; the log of who moved a switch is kept). What this takes with it: the requests, the
-- leader's notes, the questions and answers, and the list of tribes kept from members. The fact that each request was asked and answered stays in the event
-- log, with no names or notes. To keep the requests for the record, copy them first, for instance:
--   create table public.removal_requests_kept as select * from public.removal_requests;
-- What it does not undo: a seat that was released stays released, and a seat that was put back stays back. Nothing a member wrote, attended or agreed to
-- is touched, and no message is recalled. Put the application files back before this one: the pages call these functions. Run it as the database owner.
-- Running it twice changes nothing.
begin;
drop function if exists public.worker_removal_tick(text);
drop function if exists public.removal_appeal_uphold(uuid, text);
drop function if exists public.removal_reinstate(uuid, text);
drop function if exists public.removal_appeal(uuid, text);
drop function if exists public.my_removal();
drop function if exists public.removal_decide(uuid, text, text);
drop function if exists public.removal_board();
drop function if exists public.removal_mine(uuid);
drop function if exists public.removal_withdraw(uuid);
drop function if exists public.removal_answer(uuid, text);
drop function if exists public.removal_ask(uuid, uuid, text, text, boolean, boolean);
-- The matching, as it was: no tribe is left out
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

drop function if exists public.removal_tick();
drop function if exists public.removal_release(uuid);
drop function if exists public.removal_contact_first();
drop function if exists public.removal_is_restricted(uuid, uuid, text);
drop function if exists public.removal_can_read(uuid, uuid);
drop function if exists public.removal_can_decide(uuid, uuid);
drop function if exists public.removal_has_role(uuid, text[]);
drop function if exists public.removal_state();
drop table if exists public.removal_blocks;
drop table if exists public.removal_thread;
drop table if exists public.removal_requests;
-- The Switchboard: the function and its rule
delete from public.feature_settings where feature = 'removal_requests';
delete from public.feature_registry where key = 'removal_requests';
commit;

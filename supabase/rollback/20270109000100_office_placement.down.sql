-- Way back from "Place or move one person from Admin".
--
-- Puts the four functions this change replaced back exactly as they stood (the owner alone places one person, with God Mode open; the owner alone undoes a run),
-- and drops what it added: the functions, and the table of requests to the owner. The columns it added to the runs stay where they are (the same way the earlier
-- files leave theirs): nothing reads them once this has run. No seat, member, run, message or consent is changed. A person an admin or a director placed stays
-- placed, and the owner can still undo it from the run's page until the leader is told.
-- Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;

drop function if exists public.placement_office_counts();
drop function if exists public.placement_office_tribe(uuid);
drop function if exists public.placement_office_tribes();
drop function if exists public.placement_office_person(uuid);
drop function if exists public.placement_find(text);
drop function if exists public.placement_request_withdraw(uuid);
drop function if exists public.placement_request_decide(uuid, text, text[], text);
drop function if exists public.placement_request_check(uuid);
drop function if exists public.placement_requests_list(uuid);
drop function if exists public.placement_office_ask(uuid, uuid, text[], text, boolean, boolean);
drop table if exists public.placement_requests;
drop function if exists public.placement_move_check(uuid, uuid);
drop function if exists public.placement_one_move(uuid, uuid, text[], text, boolean);

-- The functions that were replaced, as they stood
CREATE OR REPLACE FUNCTION public.placement_one_options(p_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  v_floor integer := public.placement_floor();
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tribe', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id),
             'active', a.n, 'capacity', t.capacity, 'degree', k.r_degree,
             'label', case when k.r_degree is null then null else public.degree_label(k.r_degree) end,
             'below_floor', k.r_degree is not null and k.r_degree < v_floor)
           order by k.r_degree desc nulls last, t.name, t.id)
      from public.tribes t
      cross join lateral (select count(*)::integer as n from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') a
      left join lateral (select c.r_degree from public.match_candidates(p_person) c where c.r_tribe = t.id) k on true
     where t.season_id = v_season and t.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.placement_one_check(p_person uuid, p_tribe uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hold_source text;
  v_hold_until timestamptz;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  pe public.people%rowtype;
  v_mp_season uuid;
  v_mp_age uuid;
  c record;
  v_block jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_floor integer := public.placement_floor();
  v_active integer;
  v_blocker text;
  v_profile boolean;
  v_degree integer;
  v_seat text;
  v_track uuid;
  v_win jsonb;
begin
  perform public.god_only();
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'No such tribe' using errcode = 'P0002';
  end if;
  select * into pe from public.people x where x.id = p_person;
  if not found then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  select * into se from public.seasons x where x.id = t.season_id;
  v_win := public.season_joining_window(se.id);
  select x.season_id, x.age_range_id into v_mp_season, v_mp_age from public.member_profiles x where x.person_id = p_person;
  v_profile := found;
  select count(*)::integer into v_active from public.tribe_members m where m.tribe_id = t.id and m.status = 'active';

  -- Blockers: nothing the owner ticks changes these
  if pe.hidden or not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'member')
     or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'not_member', 'text', 'This person is not a member who can join a tribe'));
  end if;
  if exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader')) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'leader', 'text', 'They lead or assist a tribe, so they cannot join one as a member'));
  end if;
  if public.is_minor(p_person) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'under18', 'text', 'They are under 18. Tribes for young people are never filled from here'));
  end if;
  v_blocker := public.message_blocker(p_person);
  if v_blocker = 'deletion' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'deletion_open', 'text', 'They have asked for their account to be deleted'));
  elsif v_blocker is not null and v_blocker <> 'under18' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'cannot_email', 'text', 'They cannot be emailed (the address bounces or they asked us to stop), so they could not be told'));
  end if;
  if se.status = 'closed' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'season_closed', 'text', 'This season is closed'));
  end if;
  if t.status <> 'approved' or not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'tribe_closed', 'text', 'This tribe is not open: it is not approved, or its leader is not certified'));
  end if;
  select tt.name into v_seat from public.tribe_members m join public.tribes tt on tt.id = m.tribe_id
   where m.person_id = p_person and m.season_id = t.season_id and m.status = 'active' limit 1;
  if v_seat is not null then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'has_seat', 'text', 'They already have a seat this season, in ' || v_seat));
  end if;

  -- Warnings: each needs a tick and a reason
  select h.source, h.until into v_hold_source, v_hold_until from public.placement_holds h
   where h.person_id = p_person and (h.until is null or h.until > now());
  if found then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'held', 'text', case v_hold_source
      when 'removal' then 'The church took them out of a tribe a short while ago, and automatic placement is leaving them alone until ' || to_char(v_hold_until at time zone 'Africa/Lagos', 'FMDD Mon') || ' so they can choose for themselves first'
      when 'care' then 'The Care Team is looking after this person after a request about their place, so automatic placement leaves them alone'
      else 'You put this person on hold' end));
  end if;
  if not v_profile then
    v_warn := v_warn || jsonb_build_array(
      jsonb_build_object('code', 'needs_form', 'text', 'They have not finished Find my tribe'),
      jsonb_build_object('code', 'no_score', 'text', 'There is no fit score, because there are no answers to score'));
  else
    if not public.consent_granted(p_person, 'matching') then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'no_consent', 'text', 'They have not agreed to matching. Place them only if they have told you they agree'));
    end if;
    if v_mp_season is not null and v_mp_season <> t.season_id then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'other_season', 'text', 'Their form was filled in for another season'));
    end if;
    select k.* into c from public.match_candidates(p_person) k where k.r_tribe = p_tribe;
    if found then
      v_degree := c.r_degree;
      if c.r_degree < v_floor then
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'below_bar',
          'text', 'Their fit with this tribe is ' || c.r_degree || ', below the bar of ' || v_floor));
      end if;
    else
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'no_score',
        'text', 'The matching does not offer them this tribe (the day, the format or the age group does not suit), so there is no fit score'));
    end if;
    select ar.track_id into v_track from public.age_ranges ar where ar.id = v_mp_age;
    if v_track is not null and t.track_id is not null and v_track <> t.track_id then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'other_track', 'text', 'This tribe is for a different age group from theirs'));
    end if;
  end if;
  if v_active >= t.capacity then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'full', 'text', 'This tribe is full (' || v_active || ' of ' || t.capacity || ')'));
  end if;
  if (v_win ->> 'started')::boolean and not (v_win ->> 'open')::boolean then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'after_cutoff',
      'text', 'Joining for this season closed on ' || to_char((v_win ->> 'closes_on')::date, 'FMDD FMMonth YYYY')));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'warnings', v_warn,
    'person', jsonb_build_object('id', pe.id, 'name', public.person_display_name(pe.id)),
    'tribe', jsonb_build_object('id', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id), 'active', v_active, 'capacity', t.capacity),
    'degree', v_degree,
    'label', case when v_degree is null then null else public.degree_label(v_degree) end,
    'window', v_win);
end;
$function$;

CREATE OR REPLACE FUNCTION public.placement_one_place(p_person uuid, p_tribe uuid, p_accept text[] DEFAULT '{}'::text[], p_reason text DEFAULT NULL::text, p_agreed boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chk jsonb;
  v_codes text[];
  v_accept text[] := coalesce(p_accept, '{}'::text[]);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  s public.placement_settings;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  v_model text;
  v_run uuid := gen_random_uuid();
  v_item bigint;
  v_res text;
  v_tm uuid;
  v_started boolean;
begin
  perform public.god_only();
  if public.placement_mode() <> 'on' then
    raise exception 'Placement is not switched On. A person is placed for real only when it is On' using errcode = '22023';
  end if;
  v_chk := public.placement_one_check(p_person, p_tribe);
  if jsonb_array_length(v_chk -> 'blockers') > 0 then
    raise exception '%', (v_chk -> 'blockers' -> 0 ->> 'text') using errcode = '22023';
  end if;
  select coalesce(array_agg(x ->> 'code'), '{}'::text[]) into v_codes from jsonb_array_elements(v_chk -> 'warnings') x;
  if exists (select 1 from unnest(v_codes) c where c <> all (v_accept)) then
    raise exception 'Read each warning and tick that you accept it' using errcode = '22023';
  end if;
  if cardinality(v_codes) > 0 and (v_reason is null or char_length(v_reason) < 5) then
    raise exception 'Say why, in a few words' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the reason under 200 characters' using errcode = '22023';
  end if;
  if 'no_consent' = any (v_codes) and not coalesce(p_agreed, false) then
    raise exception 'They have not agreed to matching. Tick that they have told you they agree, or leave them out' using errcode = '22023';
  end if;
  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  select * into t from public.tribes x where x.id = p_tribe;
  select * into se from public.seasons x where x.id = t.season_id;
  v_started := se.starts_on <= public.today_lagos();

  insert into public.placement_runs (id, season_id, status, phase, in_season, after_cutoff, single, note, rehearsal, grace_days, seats_free, min_tribe,
                                     pace_per_hour, send_from, send_until, hold_hours, model_version, pool, planned_at, approved_at, placed_at)
  values (v_run, se.id, 'placed', 'ready', v_started, 'after_cutoff' = any (v_codes), true, v_reason, false, 0, 0, s.min_tribe,
          s.pace_per_hour, s.send_from, s.send_until, s.hold_hours, v_model, 1, now(), now(), now());
  insert into public.placement_items (run_id, person_id, status, tribe_id, degree, seq, moved, override, override_reason, agreed)
  values (v_run, p_person, 'proposed', p_tribe, (v_chk ->> 'degree')::integer, 1, true, v_codes, v_reason, coalesce(p_agreed, false))
  returning id into v_item;
  insert into public.placement_teams (run_id, tribe_id, active_before, proposed)
  values (v_run, p_tribe, (select count(*)::integer from public.tribe_members m where m.tribe_id = p_tribe and m.status = 'active'), 1);

  v_res := public.placement_place_item(v_run, v_item);
  if v_res is not null then
    -- Raising rolls back the run, the item and the team row: nothing is left behind
    raise exception 'They could not be placed (%). Nothing was changed', v_res using errcode = '22023';
  end if;
  select i.placement_id into v_tm from public.placement_items i where i.id = v_item;
  perform public.write_event(auth.uid(), 'placement.single', 'placement_run', v_run::text,
    jsonb_build_object('tribe', p_tribe, 'codes', to_jsonb(v_codes), 'agreed', coalesce(p_agreed, false), 'in_season', v_started));
  return jsonb_build_object('ok', true, 'run', v_run, 'placement', v_tm);
end;
$function$;

CREATE OR REPLACE FUNCTION public.placement_undo(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

drop function if exists public.placement_office_do(uuid, uuid, text[], text, boolean, boolean, text, uuid, text, uuid);
drop function if exists public.placement_check_core(uuid, uuid, boolean, text, uuid);
drop function if exists public.placement_run_undoable(uuid);
drop function if exists public.placement_reason_words(text);
drop function if exists public.placement_gate();

commit;

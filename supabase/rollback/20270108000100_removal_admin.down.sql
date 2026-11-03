-- Way back from "Leader removal requests that an admin or director must approve".
--
-- Puts every function this change replaced back exactly as it stood (a coach can decide an ordinary request again; the heartbeat, the board, the Today
-- list and the placement hold readers go back to what they were), and drops what it added: the recommendation function, its helper, and the trigger
-- that turned the staff email groups On with the switch. The holds this change put on people who were taken out of a tribe are removed, because
-- the older code has no way to end a hold and would keep those people out of automatic placement for good. The columns it added stay where
-- they are (the same way the earlier files leave theirs): nothing reads them once this has run. No seat, member, request, answer, appeal, consent,
-- message or number is changed, and the staff email groups keep whatever mode they are in.
-- Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;
-- One of the functions below is written in SQL and reads the table of requests. If the older way back has already dropped that table (this file is run a second time
-- after it), the body cannot be checked against it, so the check is turned off for this file only.
set local check_function_bodies = off;

drop trigger if exists feature_settings_removal_notices on public.feature_settings;
drop function if exists public.removal_switch_on_notices();
drop function if exists public.removal_recommend(uuid, text, text);
drop function if exists public.removal_can_recommend(uuid, uuid);

delete from public.placement_holds where source in ('removal', 'care');

-- The functions that were replaced, as they stood
create or replace function public.removal_can_decide(p_req uuid, p_person uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_person is not null
     and exists (select 1 from public.removal_requests q join public.tribes t on t.id = q.tribe_id
                  where q.id = p_req
                    and p_person not in (q.asked_by, q.member_id)
                    and (public.removal_has_role(p_person, array['care_lead', 'director', 'admin'])
                         or (not q.restricted and t.coach_id = p_person)));
$function$;

create or replace function public.removal_ask(p_tribe uuid, p_member uuid, p_reason text, p_note text, p_spoken boolean, p_urgent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.removal_answer(p_req uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.removal_release(p_req uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.removal_reinstate(p_req uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.removal_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.removal_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.placement_hold_set(p_person uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.placement_holds_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.god_only();
  return coalesce((select jsonb_agg(jsonb_build_object('person', h.person_id, 'name', public.person_display_name(h.person_id), 'since', h.created_at) order by h.created_at desc)
                     from public.placement_holds h), '[]'::jsonb);
end;
$function$;

create or replace function public.placement_pool_reason(p_person uuid, p_season uuid, p_grace integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.placement_one_check(p_person uuid, p_tribe uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
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
  if exists (select 1 from public.placement_holds h where h.person_id = p_person) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'held', 'text', 'You put this person on hold'));
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

create or replace function public.placement_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.status in ('planning', 'planned', 'approved', 'placing') order by x.seq desc limit 1;
  return jsonb_build_object(
    'settings', public.placement_settings_get(),
    'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on) from public.seasons s where s.id = v_season),
    'window', public.season_joining_window(v_season),
    'open_run', case when r.id is null then null else jsonb_build_object(
        'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told) end,
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'seq', x.seq, 'status', x.status, 'rehearsal', x.rehearsal, 'created_at', x.created_at, 'pool', x.pool,
               'single', x.single, 'in_season', x.in_season, 'note', x.note,
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
$function$;

create or replace function public.placement_adjust(p_run uuid, p_person uuid, p_action text, p_tribe uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.admin_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  v_centre uuid := public.my_centre();
  v_today date := public.today_lagos();
  v_mine text[];
  v_rows jsonb;
  v_arr jsonb[] := '{}';
  v_waiting integer := public.notice_number('waiting_threshold');
  v_season uuid := public.leader_fit_season();
  c integer;
  o integer;
  u boolean;
  s public.seasons%rowtype;
  v_coming jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_off integer := 0;
  g text;
  v_holders integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  select coalesce(array_agg(r::text), '{}') into v_mine from unnest(public.my_roles()) r;

  -- Deletion requests (admins and directors)
  select count(*), max(v_today - public.notice_day(e.requested_at)), coalesce(bool_or(v_today - public.notice_day(e.requested_at) >= 23), false)
    into c, o, u from public.erasure_requests e where e.status = 'open' and e.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('data_requests', 'deletion request', 'deletion requests', array['admin', 'director'], v_mine, c, o, u, '/admin/privacy');

  -- Failed messages (admins, directors, the data lead)
  select count(*), max(extract(day from now() - m.created_at))::integer into c, o
    from public.messages m where m.status = 'failed' and m.centre_id = v_centre and m.created_at > now() - interval '24 hours';
  v_arr := v_arr || public.notice_row('failed_messages', 'message failed in the last day', 'messages failed in the last day', array['admin', 'director', 'data_lead'], v_mine, c, o, false, '/admin/messages');

  -- Reminder journeys that paused themselves
  select count(*), max(extract(day from now() - j.paused_at))::integer into c, o from public.journeys j where j.paused_at is not null;
  v_arr := v_arr || public.notice_row('paused_journeys', 'reminder journey paused', 'reminder journeys paused', array['admin', 'director', 'pastor', 'data_lead'], v_mine, c, o, false, '/admin/reminders');

  -- Launch steps left, from 30 days before a season opens
  select * into s from public.seasons x where x.centre_id = v_centre and x.status in ('planning', 'open') and x.starts_on >= v_today order by x.starts_on limit 1;
  if found and s.starts_on - v_today <= 30 then
    c := public.notice_launch_left(v_centre, s.id);
    v_arr := v_arr || public.notice_row('launch_steps', 'launch step left before ' || s.name || ' opens', 'launch steps left before ' || s.name || ' opens',
      array['admin', 'director', 'pastor', 'data_lead'], v_mine, c, 0, s.starts_on - v_today <= 7, '/admin/seasons');
  end if;

  -- Applications waiting for a pastor's decision, and concerns a referee raised
  select count(*), max(extract(day from now() - a.updated_at))::integer into c, o
    from public.leader_applications a join public.people p on p.id = a.person_id
   where a.status = 'interviewed' and p.centre_id = v_centre and a.person_id <> uid;
  v_arr := v_arr || public.notice_row('decisions', 'application waiting for a decision', 'applications waiting for a decision', array['pastor'], v_mine, c, o, false, '/review');
  select count(*), max(extract(day from now() - a.updated_at))::integer into c, o
    from public.leader_reference_answers ra
    join public.leader_references r on r.id = ra.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where ra.concern and ra.concern_cleared_at is null and p.centre_id = v_centre and a.person_id <> uid
     and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed');
  v_arr := v_arr || public.notice_row('referee_concerns', 'concern raised by a referee', 'concerns raised by referees', array['pastor'], v_mine, c, o, true, '/review');

  -- Tribe Cards, held references and ready-made cards
  select count(*), max(extract(day from now() - t.submitted_at))::integer into c, o
    from public.tribes t join public.people lp on lp.id = t.leader_id where t.status = 'submitted' and lp.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('cards', 'Tribe Card waiting for approval', 'Tribe Cards waiting for approval', array['pastor', 'director'], v_mine, c, o, false, '/review/cards');
  select count(*), max(extract(day from now() - g2.created_at))::integer into c, o
    from public.leader_reference_flags g2
    join public.leader_references r on r.id = g2.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where g2.severity = 'hold' and g2.cleared_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('held_references', 'reference held for a look', 'references held for a look', array['pastor', 'director'], v_mine, c, o, false, '/admin/referees');
  select count(*) into c from public.tribe_card_templates t where t.status = 'draft';
  v_arr := v_arr || public.notice_row('ready_made', 'ready-made card to sign off', 'ready-made cards to sign off', array['pastor', 'director'], v_mine, c, 0, false, '/review/templates');

  -- Interviews that ended without an outcome, offers with no answer, goals with members and no leader
  select count(*), max(extract(day from now() - s2.starts_at))::integer into c, o
    from public.interview_slots s2
    join public.leader_applications a on a.id = s2.application_id
    join public.people p on p.id = a.person_id
   where a.status = 'interview_booked' and p.centre_id = v_centre
     and s2.starts_at + make_interval(mins => s2.minutes) < now();
  v_arr := v_arr || public.notice_row('interviews_no_outcome', 'interview without an outcome', 'interviews without an outcome', array['director', 'pastor'], v_mine, c, o, false, '/review/interviews');
  select count(*), max(extract(day from now() - f.offered_at))::integer into c, o
    from public.leader_offers f join public.people p on p.id = f.person_id
   where f.status = 'offered' and f.expires_at > now() and p.centre_id = v_centre
     and f.offered_at < now() - make_interval(days => public.notice_number('offer_days'));
  v_arr := v_arr || public.notice_row('offers_unanswered', 'offer with no answer', 'offers with no answer', array['director', 'pastor', 'admin'], v_mine, c, o, false, '/admin/leader-supply');
  c := 0;
  if v_season is not null then
    select count(*) into c from public.goal_demand_rows(v_season) d where d.waiting >= v_waiting and d.seats_open = 0;
  end if;
  v_arr := v_arr || public.notice_row('leaders_needed', 'goal with members waiting and no leader', 'goals with members waiting and no leader',
    array['director', 'admin', 'pastor', 'data_lead'], v_mine, c, 0, false, '/admin/leader-supply');

  -- The reporting copy and the integrity flags (the data lead)
  select case when c2.refreshed_at is not null and c2.refreshed_at < now() - interval '36 hours' then 1 else 0 end,
         extract(day from now() - c2.refreshed_at)::integer into c, o from bi.config c2;
  v_arr := v_arr || public.notice_row('reporting_copy', 'reporting copy has not refreshed', 'reporting copy has not refreshed', array['data_lead', 'admin'], v_mine, c, o, false, '/admin/system');
  select count(*), max(extract(day from now() - g2.created_at))::integer into c, o
    from public.leader_reference_flags g2
    join public.leader_references r on r.id = g2.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where g2.cleared_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('integrity_flags', 'integrity flag open', 'integrity flags open', array['data_lead'], v_mine, c, o, false, '/admin/referees');

  -- People who asked for someone to reach out, tribe changes, parents' permissions to confirm, announcements waiting for a second person
  select count(*), max(extract(day from now() - q.created_at))::integer into c, o
    from public.journey_requests q join public.people p on p.id = q.person_id
   where q.status = 'open' and q.kind <> 'not_season' and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('asks', 'person asked for someone to reach out', 'people asked for someone to reach out', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/care/asks');
  select count(*), max(extract(day from now() - w.created_at))::integer into c, o
    from public.swap_requests w join public.people p on p.id = w.person_id where w.status = 'requested' and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('swaps', 'request to change tribe', 'requests to change tribe', array['admin', 'director'], v_mine, c, o, false, '/growth/swaps');
  select count(*), max(extract(day from now() - gc.requested_at))::integer into c, o
    from public.guardian_consents gc join public.people p on p.id = gc.person_id
   where gc.status = 'approved' and gc.verified_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('teens', 'parent''s permission waiting for its call', 'parents'' permissions waiting for their call', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/care/teens');
  select count(*), max(extract(day from now() - b.updated_at))::integer into c, o
    from public.broadcasts b where b.status = 'awaiting_approval' and b.centre_id = v_centre and b.created_by is distinct from uid;
  v_arr := v_arr || public.notice_row('approvals', 'announcement waiting for your approval', 'announcements waiting for your approval', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/admin/announcements/approvals');

  select coalesce(jsonb_agg(x order by (x ->> 'urgent')::boolean desc, (x ->> 'oldest_days')::integer desc, (x ->> 'count')::integer desc, x ->> 'key'), '[]'::jsonb)
    into v_rows from unnest(v_arr) x where x is not null;

  -- Coming up: the next three dates
  begin
    select jsonb_agg(z order by z ->> 'on') into v_coming from (
      select z from (
        select jsonb_build_object('label', x.name || ' opens', 'on', x.starts_on, 'href', '/admin/seasons') as z
          from public.seasons x where x.centre_id = v_centre and x.status in ('planning', 'open') and x.starts_on >= v_today
         order by x.starts_on limit 1) a
      union all
      select z from (
        select jsonb_build_object('label', x.name || ' ends', 'on', x.ends_on, 'href', '/admin/seasons') as z
          from public.seasons x where x.centre_id = v_centre and x.status in ('open', 'running') and x.ends_on >= v_today
         order by x.ends_on limit 1) b
      union all
      select z from (
        select jsonb_build_object('label', case x.kind::text when 'commissioning_workshop' then 'Commissioning workshop' else 'Practice workshop' end,
                                  'on', public.notice_day(x.starts_at), 'href', case when public.has_any_role(array['pastor', 'director', 'coach']::public.app_role[]) then '/review/academy' end) as z
          from public.academy_sessions x where x.starts_at > now() order by x.starts_at limit 1) c3
      union all
      select z from (
        select jsonb_build_object('label', 'A deletion request is due', 'on', public.notice_day(e.requested_at) + 30, 'href', '/admin/privacy') as z
          from public.erasure_requests e where e.status = 'open' and e.centre_id = v_centre and public.has_any_role(array['admin', 'director']::public.app_role[])
         order by e.requested_at limit 1) d
    ) all_dates;
    select coalesce(jsonb_agg(z), '[]'::jsonb) into v_coming from (select z from jsonb_array_elements(coalesce(v_coming, '[]'::jsonb)) z limit 3) t;
  exception when others then
    v_coming := '[]'::jsonb;
    perform public.notice_fault('admin_attention', 'coming up: ' || sqlerrm);
  end;

  -- Who receives the notices: an empty role, or a group still Off (only for those who can change the switches)
  if public.has_any_role(array['admin', 'director']::public.app_role[]) then
    for g in select unnest(array['pastors', 'directors', 'admin', 'coaches', 'care', 'leaders', 'champions', 'data_lead']) loop
      if public.notice_mode(g) = 'off' then
        v_off := v_off + 1;
      else
        select count(distinct pr.person_id)::integer into v_holders
          from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
         where pr.centre_id = v_centre and pr.role::text = any (public.notice_roles_in(g, v_centre)) and not p.hidden;
        if v_holders = 0 then
          v_warn := v_warn || jsonb_build_object('group', g);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'roles', to_jsonb(v_mine),
    'rows', v_rows,
    'coming', v_coming,
    'numbers', jsonb_build_object(
      'placed', (select count(distinct m.person_id) from public.tribe_members m join public.people p on p.id = m.person_id where m.status = 'active' and p.centre_id = v_centre),
      'applications_month', (select count(*) from public.leader_applications a join public.people p on p.id = a.person_id
                              where p.centre_id = v_centre and a.submitted_at >= date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'),
      'certified', (select count(*) from public.leader_certifications lc join public.people p on p.id = lc.person_id where p.centre_id = v_centre),
      'tribes_open', (select count(*) from public.tribes t join public.people lp on lp.id = t.leader_id
                       where t.status = 'approved' and lp.centre_id = v_centre and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id))),
    'notices', jsonb_build_object('off', v_off, 'empty', v_warn,
                                  'faults', (select count(*) from public.notice_faults f where f.at > now() - interval '7 days')));
end;
$function$;

commit;

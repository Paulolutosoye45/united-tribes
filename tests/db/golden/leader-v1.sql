-- Phase A golden copies: applying to become a leader
-- Copies of the live function bodies as they stood BEFORE Phase A, renamed with a _v1 suffix.
-- They exist only as test fixtures: they are installed into a test database to prove that, with every switch at today's position,
-- the revised function gives the same answer. They are never part of a migration and never reach the real database.

create or replace function public.check_leader_eligibility_v1(p_app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  keys text[] := array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality'];
  k text;
  failed text[] := '{}';
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'This application can no longer be changed' using errcode = '22023';
  end if;

  foreach k in array keys loop
    if jsonb_typeof(a.answers -> 'eligibility' -> k) is distinct from 'boolean' then
      raise exception 'Answer all seven questions' using errcode = '22023';
    end if;
    if (a.answers -> 'eligibility' ->> k)::boolean is not true then
      failed := failed || k;
    end if;
  end loop;

  if cardinality(failed) > 0 then
    update public.leader_applications set status = 'ineligible', failed_checks = failed where id = p_app;
    perform public.write_event(auth.uid(), 'leader.ineligible', 'leader_application', p_app::text,
      jsonb_build_object('failed', failed));
    return jsonb_build_object('ok', false, 'failed', to_jsonb(failed));
  end if;
  return jsonb_build_object('ok', true, 'failed', '[]'::jsonb);
end;
$function$
;

create or replace function public.submit_leader_application_v1(p_app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  c jsonb;
  s jsonb;
  sid text;
  best text;
  worst text;
  best_rating int;
  worst_rating int;
  total numeric := 0;
  detail jsonb := '[]'::jsonb;
  refs int;
  heads int;
  k text;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'This application was already submitted' using errcode = '22023';
  end if;

  -- Eligibility must be all yes
  if (select count(*) from unnest(array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality']) as chk(item)
       where a.answers -> 'eligibility' -> chk.item = 'true'::jsonb) <> 7 then
    raise exception 'Complete the eligibility questions first' using errcode = '22023';
  end if;

  -- Calling and goal fit
  c := coalesce(a.answers -> 'calling', '{}'::jsonb);
  if nullif(btrim(c ->> 'track'), '') is null or nullif(btrim(c ->> 'community'), '') is null then
    raise exception 'Choose your track and community' using errcode = '22023';
  end if;
  if nullif(btrim(c ->> 'goal'), '') is null and nullif(btrim(c ->> 'goalOther'), '') is null then
    raise exception 'Choose the Season Goal you could lead' using errcode = '22023';
  end if;
  if (c ->> 'goalRelation') not in ('achieved', 'pursuing') then
    raise exception 'Say whether you have achieved the goal or are pursuing it' using errcode = '22023';
  end if;
  foreach k in array array['goalStory', 'why', 'walked', 'walkNote', 'obstacles'] loop
    if char_length(btrim(coalesce(c ->> k, ''))) < 20 then
      raise exception 'Please answer every question in a few sentences' using errcode = '22023';
    end if;
  end loop;
  if coalesce(c ->> 'walkRating', '') !~ '^[1-5]$' then
    raise exception 'Rate your walk with God from 1 to 5' using errcode = '22023';
  end if;
  if coalesce(a.answers #>> '{contact,whatsapp}', '') !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Add a WhatsApp number so the panel can reach you' using errcode = '22023';
  end if;

  -- Style (pairing aid)
  if coalesce(a.answers #>> '{style,leadBest}', '') not in ('structure', 'connection', 'teaching', 'doing') then
    raise exception 'Say how you lead best' using errcode = '22023';
  end if;

  -- Scenarios, scored against the key: reward a best pick that is truly best
  -- and a worst pick that is truly poor. Zero to one for each situation.
  s := coalesce(a.answers -> 'scenarios', '{}'::jsonb);
  for sid in select scenario_id from public.scenario_keys group by scenario_id order by scenario_id loop
    best := s -> sid ->> 'best';
    worst := s -> sid ->> 'worst';
    if best is null or worst is null or best = worst then
      raise exception 'Choose a best and a different worst response for every situation' using errcode = '22023';
    end if;
    select rating into best_rating from public.scenario_keys where scenario_id = sid and option_id = best;
    select rating into worst_rating from public.scenario_keys where scenario_id = sid and option_id = worst;
    if best_rating is null or worst_rating is null then
      raise exception 'Choose a best and a different worst response for every situation' using errcode = '22023';
    end if;
    total := total + (best_rating - worst_rating + 3) / 6.0;
    detail := detail || jsonb_build_array(jsonb_build_object('scenario', sid, 'best', best_rating, 'worst', worst_rating));
  end loop;

  -- Two referees, at least one a pastor or unit head
  select count(*), count(*) filter (where is_pastor_or_unit_head) into refs, heads
    from public.leader_references where application_id = p_app;
  if refs <> 2 then
    raise exception 'Add both referees' using errcode = '22023';
  end if;
  if heads < 1 then
    raise exception 'One referee must be a pastor or unit head' using errcode = '22023';
  end if;

  -- The first check (new). Only when it is switched on: the written answers must be real, and have been checked.
  if cfg.mode = 'on' then
    if not public.leader_ai_consent_ok(p_app) then
      raise exception 'Please read and agree to the updated wording on the first screen before you send your application' using errcode = '22023';
    end if;
    foreach k in array array['goalStory', 'why', 'walked', 'walkNote', 'obstacles'] loop
      if public.leader_word_count(c ->> k) < cfg.min_words then
        raise exception 'Please say a little more in your written answers: at least % words each', cfg.min_words using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.leader_answer_checks x
         where x.application_id = p_app and x.field = k and x.text_hash = public.leader_text_hash(c ->> k) and x.passes) then
        raise exception 'One of your written answers has not had its quick check. Go back to the written questions and press Continue on each' using errcode = '22023';
      end if;
    end loop;
  end if;

  insert into public.leader_assessments (application_id, scenario_pct, scenario_detail)
  values (p_app, round(total / (select count(distinct scenario_id) from public.scenario_keys) * 100, 2), detail)
  on conflict (application_id) do update
    set scenario_pct = excluded.scenario_pct, scenario_detail = excluded.scenario_detail, scored_at = now();

  update public.leader_applications set status = 'submitted', step = 'done', submitted_at = now() where id = p_app;
  perform public.write_event(auth.uid(), 'leader.applied', 'leader_application', p_app::text, '{}'::jsonb);

  if cfg.mode = 'on' then
    perform public.leader_ai_set_state(p_app, 'checking', 'ai', '{}'::jsonb, auth.uid());
    perform public.leader_ai_enqueue(p_app, 'submit', false);
  elsif cfg.mode = 'shadow' then
    -- Recorded for comparison only. Whether an AI service may read the text is decided when the job is picked up.
    perform public.leader_ai_enqueue(p_app, 'submit', true);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

create or replace function public.invite_to_interview_v1(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  st public.leader_ai_state;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  ai_scored boolean;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can invite to interview' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id for update;
  if not found or a.person_id = me or a.status <> 'submitted' then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_id;
  if cfg.mode = 'on' and st.state in ('consent_needed', 'checking', 'strengthen', 'held') then
    raise exception 'The first check on this application is not finished. Look at it under Admin > Leader quality' using errcode = '22023';
  end if;
  if (select count(*) from public.leader_references where application_id = p_id and submitted_at is not null) < 2 then
    raise exception 'Both references must be in first' using errcode = '22023';
  end if;
  -- No row at all counts as "not scored by the AI": a missing row must never switch the two-reviewer rule off
  ai_scored := coalesce(st.basis = 'ai' and st.state = 'clear', false);
  if not ai_scored
     and (select count(distinct reviewer_id) from public.leader_reviews where application_id = p_id and stage = 'calling') < 2 then
    raise exception 'Two reviewers must score the application first' using errcode = '22023';
  end if;
  update public.leader_applications set status = 'interview_invited' where id = p_id;
  perform public.write_event(me, 'leader.invited', 'leader_application', p_id::text, '{}'::jsonb);
end;
$function$
;

create or replace function public.application_readiness_v1(p_app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  calling numeric;
  calling_n int;
  calling_people_n int;
  calling_source text := 'people';
  ai_pct numeric;
  st public.leader_ai_state;
  interview numeric;
  interview_n int;
  scen numeric;
  refs numeric;
  refs_n int;
  concerns int;
  has_head boolean;
  goal_ok boolean;
  readiness numeric;
  held_n int;
  unverified_n int;
begin
  select * into a from public.leader_applications where id = p_app;
  if not found then return null; end if;

  select avg(public.rating_pct(scores)), count(*) into calling, calling_n
    from public.leader_reviews where application_id = p_app and stage = 'calling';
  calling_people_n := calling_n;
  select * into st from public.leader_ai_state where application_id = p_app;
  if st.basis = 'ai' and st.state = 'clear' then
    select s.calling_pct into ai_pct from public.leader_ai_scores s
     where s.application_id = p_app and not s.shadow and s.ai_ran and s.outcome = 'clear'
     order by s.run desc limit 1;
    if ai_pct is not null then
      calling := ai_pct;
      calling_n := 2;
      calling_source := 'ai';
    end if;
  end if;
  select avg(public.rating_pct(scores)), count(*) into interview, interview_n
    from public.leader_reviews where application_id = p_app and stage = 'interview';
  select scenario_pct into scen from public.leader_assessments where application_id = p_app;

  select avg((ra.reliability + ra.warmth + ra.confidentiality + ra.maturity) / 4.0 / 5 * 100), count(*)
    into refs, refs_n
    from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
    join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and rt.verification <> 'disputed' and not public.reference_held(r.id);
  select count(*) into concerns
    from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
   where r.application_id = p_app and ra.concern and ra.concern_cleared_at is null;
  -- The system's own answer (the directory, or a pastor's confirmation), not the applicant's tick
  select coalesce(bool_or(rt.standing), false) into has_head
    from public.leader_references r join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and r.submitted_at is not null and rt.verification <> 'disputed' and not public.reference_held(r.id);
  select count(*) filter (where public.reference_held(r.id)), count(*) filter (where rt.verification = 'unverified')
    into held_n, unverified_n
    from public.leader_references r join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and r.submitted_at is not null;

  goal_ok := coalesce(nullif(btrim(a.answers #>> '{calling,goal}'), ''), nullif(btrim(a.answers #>> '{calling,goalOther}'), '')) is not null;

  if calling_n >= 2 and interview_n >= 2 and scen is not null and refs_n >= 2 then
    readiness := round(calling * 0.30 + scen * 0.25 + refs * 0.25 + interview * 0.20, 1);
  end if;

  return jsonb_build_object(
    'calling', round(calling, 1), 'calling_reviews', calling_people_n, 'calling_source', calling_source,
    'scenarios', scen,
    'references', round(refs, 1), 'references_received', refs_n,
    'interview', round(interview, 1), 'interview_reviews', interview_n,
    'readiness', readiness,
    'gates', jsonb_build_object(
      'goal_declared', goal_ok,
      'references_clean', refs_n >= 2 and concerns = 0 and has_head,
      'open_concerns', concerns,
      'pastor_or_unit_head_referee', has_head,
      'references_held', coalesce(held_n, 0), 'references_unverified', coalesce(unverified_n, 0)),
    'band', case
      when readiness is null then null
      when readiness >= 75 then 'leader'
      when readiness >= 60 then 'assistant_leader'
      else 'below' end);
end;
$function$
;

create or replace function public.decide_application_v1(p_id uuid, p_decision text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  ready jsonb;
  new_status public.application_status;
  role_to_grant public.app_role;
  centre uuid;
begin
  if not public.has_role('pastor') then
    raise exception 'Only a pastor can decide' using errcode = '42501';
  end if;
  if p_decision not in ('leader', 'assistant_leader', 'not_approved') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  select * into a from public.leader_applications where id = p_id for update;
  if not found or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
    raise exception 'This application is not open for a decision' using errcode = '22023';
  end if;

  if p_decision = 'not_approved' then
    new_status := 'not_approved';
  else
    if a.status <> 'interviewed' then
      raise exception 'Approve only after the interview has been scored' using errcode = '22023';
    end if;
    ready := public.application_readiness_v1(p_id);
    if ready ->> 'readiness' is null then
      raise exception 'The scores are not complete yet' using errcode = '22023';
    end if;
    if (ready #>> '{gates,goal_declared}')::boolean is not true then
      raise exception 'The applicant has not declared a Season Goal' using errcode = '22023';
    end if;
    if (ready #>> '{gates,references_clean}')::boolean is not true then
      raise exception 'The reference check is not clean: both referees must answer, one a pastor or unit head, with no open concern' using errcode = '22023';
    end if;
    if p_decision = 'leader' and (ready ->> 'readiness')::numeric < 75 then
      raise exception 'A leader needs a readiness score of 75 or more' using errcode = '22023';
    end if;
    if p_decision = 'assistant_leader' and (ready ->> 'readiness')::numeric < 60 then
      raise exception 'An assistant leader needs a readiness score of 60 or more' using errcode = '22023';
    end if;
    new_status := case p_decision when 'leader' then 'approved_leader' else 'approved_assistant' end;
    role_to_grant := p_decision::public.app_role;
    select centre_id into centre from public.people where id = a.person_id;
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (a.person_id, role_to_grant, centre, me)
    on conflict do nothing;
  end if;

  update public.leader_applications
     set status = new_status, decided_at = now(), decided_by = me,
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  perform public.write_event(me, 'leader.decided', 'leader_application', p_id::text,
    jsonb_build_object('decision', p_decision));
  return jsonb_build_object('ok', true, 'status', new_status);
end;
$function$
;

create or replace function public.review_queue_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.submitted_at desc nulls last)
    from (
      select a.id,
             a.status,
             public.person_display_name(a.person_id) as applicant,
             a.answers #>> '{calling,track}' as track,
             a.answers #>> '{calling,community}' as community,
             a.submitted_at,
             (select count(*) from public.leader_references r where r.application_id = a.id and r.submitted_at is not null) as references_received,
             exists (
               select 1 from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
                where r.application_id = a.id and ra.concern and ra.concern_cleared_at is null) as open_concern,
             (select count(*) from public.leader_reviews v where v.application_id = a.id and v.stage = 'calling') as calling_reviews,
             (select count(*) from public.leader_reviews v where v.application_id = a.id and v.stage = 'interview') as interview_reviews,
             exists (select 1 from public.leader_reviews v where v.application_id = a.id and v.reviewer_id = auth.uid() and v.stage = 'calling') as i_reviewed_calling,
             exists (select 1 from public.leader_reviews v where v.application_id = a.id and v.reviewer_id = auth.uid() and v.stage = 'interview') as i_reviewed_interview,
             (select s.starts_at from public.interview_slots s where s.application_id = a.id) as interview_at
        from public.leader_applications a
       where a.status not in ('draft', 'ineligible')
         and a.person_id <> auth.uid()
    ) x), '[]'::jsonb);
end;
$function$
;

create or replace function public.request_referee_send_v1(p_reference uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.leader_references;
  a public.leader_applications;
  cfg public.referee_settings := public.referee_cfg();
  ai public.leader_ai_settings := public.leader_ai_cfg();
  v_sent integer;
begin
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id and person_id = auth.uid();
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  if a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
    raise exception 'Requests go out once your application has been sent' using errcode = '22023';
  end if;
  if ai.mode = 'on' and exists (
       select 1 from public.leader_ai_state s
        where s.application_id = a.id and s.state in ('consent_needed', 'checking', 'strengthen', 'held')) then
    raise exception 'Your application is still being checked. Requests to referees go out as soon as that is done' using errcode = '22023';
  end if;
  if r.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;
  if r.contact_norm is null then
    raise exception 'We could not read this contact. Please change this person and enter a phone number or email' using errcode = '22023';
  end if;
  select count(*) into v_sent from public.messages
   where template = 'referee_request' and params ->> 'reference_id' = p_reference::text and created_at > now() - interval '1 day';
  if v_sent >= cfg.sends_per_day then
    raise exception 'We have already sent this request % times today. Please try again tomorrow, or check their number or email', cfg.sends_per_day using errcode = '22023';
  end if;

  perform public.enqueue_message(
    null, 'referee_request',
    jsonb_build_object('reference_id', r.id, 'contact', r.contact_norm),
    null, 'referee:' || r.id::text || ':' || gen_random_uuid()::text,
    null, 'normal', null,
    case when r.contact_kind = 'email' then r.contact_norm end,
    case when r.contact_kind = 'phone' then r.contact_norm end,
    r.referee_name);
  update public.leader_references
     set stage = case when stage in ('waiting', 'unreachable', 'sending') then 'sending' else stage end,
         last_request_at = now(), requests = requests + 1
   where id = r.id;
  perform public.write_event(auth.uid(), 'reference.requested', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
  return jsonb_build_object('ok', true, 'kind', r.contact_kind);
end;
$function$
;

create or replace function public.activity_leader_rows_v1(p_from date, p_to date)
 RETURNS TABLE(person_id uuid, grp text, community_id uuid, zone text, season_id uuid, stage smallint, t1 timestamp with time zone, t2 timestamp with time zone, t3 timestamp with time zone, t4 timestamp with time zone, t5 timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.person_id, ap.grp, null::uuid, null::text, null::uuid,
         (case
            when a.submitted_at is null then 1 + coalesce(st.position, 0)
            when not ai.ok then 23
            when not rf.ok then 24
            when a.status not in ('interview_invited', 'interview_booked', 'interviewed', 'approved_leader', 'approved_assistant') then 25
            when a.status not in ('approved_leader', 'approved_assistant') then 26
            when not exists (select 1 from public.person_roles r
                              where r.person_id = a.person_id and r.role in ('leader', 'assistant_leader')) then 27
            else 28
          end)::smallint,
         a.created_at, a.submitted_at, null::timestamptz, null::timestamptz, null::timestamptz
    from public.leader_applications a
    join public.activity_people ap on ap.person_id = a.person_id
    left join public.activity_steps st on st.form = 'leader' and st.step = a.step
    cross join lateral (
      select coalesce((select s.state in ('clear', 'cleared_by_person', 'not_applicable')
                         from public.leader_ai_state s where s.application_id = a.id), true) as ok) ai
    cross join lateral (
      select (select count(*) from public.leader_references r
                left join public.referee_trust t on t.reference_id = r.id
               where r.application_id = a.id
                 and (coalesce(t.verification, 'unverified') <> 'unverified' or coalesce(t.legacy, false))) >= 2 as ok) rf
   where a.created_at >= (p_from::timestamp at time zone 'Africa/Lagos')
     and a.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
$function$
;

create or replace function public.leader_ai_clear_v1(p_app uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  st public.leader_ai_state;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can do this' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_app for update;
  if not found or a.person_id = auth.uid() or a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_app for update;
  if not found or st.state not in ('consent_needed', 'checking', 'strengthen', 'held') then
    raise exception 'This application is not waiting on the first check' using errcode = '22023';
  end if;
  update public.leader_ai_state set cleared_by = auth.uid() where application_id = p_app;
  perform public.leader_ai_set_state(p_app, 'cleared_by_person', 'person', null, auth.uid());
  update public.leader_ai_jobs set status = 'done', finished_at = now(), locked_until = null, last_error = 'a person cleared it'
   where application_id = p_app and status = 'queued';
  -- The applicant was told we would message them when their referees' links open: this is that message.
  perform public.enqueue_message(a.person_id, 'leader_check_clear',
    jsonb_build_object('first_name', public.first_name_of(a.person_id)), null, 'person:' || p_app || ':clear');
  perform public.write_event(auth.uid(), 'leader.ai_cleared', 'leader_application', p_app::text,
    jsonb_build_object('note', left(nullif(btrim(coalesce(p_note, '')), ''), 500)));
end;
$function$
;

create or replace function public.review_application_v1(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  is_pastor boolean := public.has_role('pastor');
  decider boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  st text;
  mine jsonb := '{}'::jsonb;
  others jsonb := '{}'::jsonb;
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id;
  if not found or a.status in ('draft', 'ineligible') or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  foreach st in array array['calling', 'interview'] loop
    mine := mine || jsonb_build_object(st, (
      select jsonb_build_object('scores', v.scores, 'notes', v.notes)
        from public.leader_reviews v where v.application_id = a.id and v.reviewer_id = me and v.stage = st));
    -- A colleague's scores are shown only after you have submitted your own
    if exists (select 1 from public.leader_reviews v where v.application_id = a.id and v.reviewer_id = me and v.stage = st) then
      others := others || jsonb_build_object(st, coalesce((
        select jsonb_agg(jsonb_build_object(
                 'reviewer', public.person_display_name(v.reviewer_id),
                 'pct', public.rating_pct(v.scores), 'notes', v.notes) order by v.created_at)
          from public.leader_reviews v where v.application_id = a.id and v.reviewer_id is distinct from me and v.stage = st),
        '[]'::jsonb));
    else
      others := others || jsonb_build_object(st, null);
    end if;
  end loop;

  return jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'applicant', public.person_display_name(a.person_id),
    'whatsapp', a.answers #>> '{contact,whatsapp}',
    'submitted_at', a.submitted_at,
    'answers', a.answers - 'eligibility',
    'community_name', (select t.name from public.communities t where t.slug = a.answers #>> '{calling,community}'),
    'goal_title', (select g.title from public.season_goals g where g.slug = a.answers #>> '{calling,goal}'),
    'scenario', (select jsonb_build_object('pct', s.scenario_pct, 'detail', s.scenario_detail)
                   from public.leader_assessments s where s.application_id = a.id),
    'references', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'slot', r.slot, 'name', r.referee_name, 'relationship', r.relationship,
               'contact', r.contact, 'head', r.is_pastor_or_unit_head, 'answered', r.submitted_at is not null,
               'reliability', ra.reliability, 'warmth', ra.warmth, 'confidentiality', ra.confidentiality,
               'maturity', ra.maturity, 'concern', ra.concern, 'concern_note', ra.concern_note,
               'concern_cleared', ra.concern_cleared_at is not null, 'concern_cleared_note', ra.concern_cleared_note)
             order by r.slot)
        from public.leader_references r left join public.leader_reference_answers ra on ra.reference_id = r.id
       where r.application_id = a.id), '[]'::jsonb),
    'mine', mine,
    'others', others,
    'interview', (select jsonb_build_object('starts_at', s.starts_at, 'minutes', s.minutes, 'mode', s.mode, 'place', s.place)
                    from public.interview_slots s where s.application_id = a.id),
    'readiness', case when decider then public.application_readiness_v1(a.id) else null end,
    'can_decide', is_pastor and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed'),
    'can_invite', decider and a.status = 'submitted',
    'decision_note', a.decision_note,
    'decided_at', a.decided_at);
end;
$function$
;

create or replace function public.book_interview_slot_v1(p_slot uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.leader_applications;
  s public.interview_slots;
begin
  select * into a from public.leader_applications
   where person_id = auth.uid() and status = 'interview_invited' for update;
  if not found then
    raise exception 'You have not been invited to book an interview' using errcode = '22023';
  end if;
  select * into s from public.interview_slots where id = p_slot for update;
  if not found or s.application_id is not null or s.starts_at < now() + interval '24 hours' then
    raise exception 'That time is no longer available. Choose another' using errcode = '22023';
  end if;
  update public.interview_slots set application_id = a.id, booked_at = now() where id = p_slot;
  update public.leader_applications set status = 'interview_booked' where id = a.id;
  perform public.write_event(auth.uid(), 'leader.interview_booked', 'leader_application', a.id::text, '{}'::jsonb);
end;
$function$
;

-- Only the test connections use them
revoke execute on function
  public.check_leader_eligibility_v1(uuid),
  public.submit_leader_application_v1(uuid),
  public.invite_to_interview_v1(uuid),
  public.application_readiness_v1(uuid),
  public.decide_application_v1(uuid, text, text),
  public.review_queue_v1(),
  public.request_referee_send_v1(uuid),
  public.activity_leader_rows_v1(date, date),
  public.leader_ai_clear_v1(uuid, text),
  public.review_application_v1(uuid),
  public.book_interview_slot_v1(uuid)
  from public, anon;
grant execute on function
  public.check_leader_eligibility_v1(uuid),
  public.submit_leader_application_v1(uuid),
  public.invite_to_interview_v1(uuid),
  public.application_readiness_v1(uuid),
  public.decide_application_v1(uuid, text, text),
  public.review_queue_v1(),
  public.request_referee_send_v1(uuid),
  public.activity_leader_rows_v1(date, date),
  public.leader_ai_clear_v1(uuid, text),
  public.review_application_v1(uuid),
  public.book_interview_slot_v1(uuid)
  to authenticated;

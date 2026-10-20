-- Phase A, part two: carrying every switch through the application (the form, the send check, the tracker, the invitation,
-- the readiness score, the decision and the reports)
--
-- The one rule that makes a switch safe is the effective position of a step for an application:
--   * an application not yet sent counts the position now;
--   * an application that has been sent counts the more lenient of the position stored when it was sent and the position now
--     (from most lenient to least: off, optional, required). One sent before the switches existed has nothing stored and counts
--     as required at sending.
-- So turning a step off releases everyone waiting at it, and turning one on never pulls anyone back.
-- Every function and screen below asks leader_stage_modes() for it. Nothing else decides.
--
-- Every revised function is the live body plus the switches: the same arguments, the same name, the same permissions, and with every
-- switch at today's position the same answers, the same words in every message and the same changes to the data.
-- Nothing already stored is rewritten, and no stage number, step or status is added or removed.
--
-- Revised:  check_leader_eligibility, submit_leader_application, invite_to_interview, application_readiness, decide_application,
--           request_referee_send, book_interview_slot, review_queue, review_application, activity_leader_rows, on_application_stage,
--           leader_ai_clear, worker_save_leader_ai_score, journey_data
-- New:      leader_lenient, leader_stage_modes, my_application_modes, clear_referee, set_evidence_note, release_interview_slot,
--           leader_fit_gate, leader_message_flags, leader_check_template, leader_pipeline_release (and its trigger)

-- ---------------------------------------------------------------------------
-- The effective position
-- ---------------------------------------------------------------------------

-- The more lenient of two positions: off, then optional, then required. Anything not recognised counts as required.
create function public.leader_lenient(p_a text, p_b text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (case coalesce(p_a, 'required') when 'off' then 3 when 'optional' then 2 else 1 end)
      >= (case coalesce(p_b, 'required') when 'off' then 3 when 'optional' then 2 else 1 end)
      then coalesce(p_a, 'required')
    else coalesce(p_b, 'required') end;
$$;

-- If the settings cannot be read, every step counts as required: the process as it has always run.
-- The effective position of every step for one application, as JSON:
--   { "eligibility": { member6, foundation, serving, age21, time, safeguarding, confidentiality }, "references", "interview", "sent" }
create function public.leader_stage_modes(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_pipeline_settings := public.leader_pipeline_cfg();
  now_j jsonb := to_jsonb(cfg);
  v_status public.application_status;
  v_sent boolean := false;
  v_at jsonb;
  elig jsonb := '{}'::jsonb;
  k text;
begin
  select a.status into v_status from public.leader_applications a where a.id = p_app;
  v_sent := coalesce(found and v_status not in ('draft', 'ineligible'), false);
  if v_sent then
    select p.at_send into v_at from public.leader_application_policy p where p.application_id = p_app;
  end if;
  foreach k in array array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality'] loop
    elig := elig || jsonb_build_object(k,
      case when v_sent then public.leader_lenient(coalesce(v_at #>> array['eligibility', k], 'required'), now_j ->> ('elig_' || k))
           else coalesce(now_j ->> ('elig_' || k), 'required') end);
  end loop;
  return jsonb_build_object(
    'eligibility', elig,
    'references', case when v_sent then public.leader_lenient(coalesce(v_at ->> 'references', 'required'), cfg.references_mode) else coalesce(cfg.references_mode, 'required') end,
    'interview', case when v_sent then public.leader_lenient(coalesce(v_at ->> 'interview', 'required'), cfg.interview_mode) else coalesce(cfg.interview_mode, 'required') end,
    'sent', v_sent);
end;
$$;

-- The same, for the applicant's own screens: only their own application.
create function public.my_application_modes(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.leader_applications a where a.id = p_app and a.person_id = auth.uid()) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  return public.leader_stage_modes(p_app);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hooks that do nothing yet, so the functions that call them are revised once
-- ---------------------------------------------------------------------------

-- Called by submit_leader_application just before it records the sent-time positions. Does nothing until Find your tribe is built.
create function public.leader_fit_gate(p_app uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Extra words for the messages an applicant gets, only where a step does not apply to them. With every step asked, this is empty,
-- so the message is exactly what it was.
--   refs false          references are not asked
--   refs_optional true  references may be added but nothing waits for them
--   interview false     there is no interview
create function public.leader_message_flags(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m jsonb := public.leader_stage_modes(p_app);
  out jsonb := '{}'::jsonb;
begin
  if m ->> 'references' = 'off' then
    out := out || jsonb_build_object('refs', false);
  elsif m ->> 'references' = 'optional' then
    out := out || jsonb_build_object('refs_optional', true);
  end if;
  if m ->> 'interview' = 'off' then
    out := out || jsonb_build_object('interview', false);
  end if;
  return out;
end;
$$;

-- Which message tells the applicant their application has been read. With references asked it is the message it has always been.
-- Without them (or with them optional) it is one that does not tell them to send their referees a link they do not need.
create function public.leader_check_template(p_app uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case public.leader_stage_modes(p_app) ->> 'references'
           when 'off' then 'leader_check_clear_open'
           when 'optional' then 'leader_check_clear_optional'
           else 'leader_check_clear' end;
$$;

-- ---------------------------------------------------------------------------
-- New: take a slot back, take a referee off, add the pastor's reason
-- ---------------------------------------------------------------------------

-- Frees a booked interview slot. The same thing cancel_interview_booking does to the slot; the status is left to the caller.
create function public.release_interview_slot(p_app uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.interview_slots set application_id = null, booked_at = null where application_id = p_app;
$$;

-- The applicant takes off a referee they added, but only while no request has gone to that person and they have not answered.
create function public.clear_referee(p_reference uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
begin
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id and person_id = auth.uid() for update;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  if a.status not in ('draft', 'submitted', 'interview_invited') then
    raise exception 'Referees can no longer be changed' using errcode = '22023';
  end if;
  if r.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;
  if r.sent_at is not null or r.requests > 0 or r.stage <> 'waiting' then
    raise exception 'A request has already gone to this person, so they cannot be taken off. You can still change who they are' using errcode = '22023';
  end if;
  delete from public.leader_references where id = r.id;
  perform public.write_event(auth.uid(), 'reference.cleared', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
end;
$$;

-- A pastor's one-line reason for approving on thinner evidence. A blank line is allowed and clears it. Never shown to the applicant.
create function public.set_evidence_note(p_app uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 600);
begin
  if not public.has_role('pastor') then
    raise exception 'Only a pastor can add this note' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_app;
  if not found or a.person_id is not distinct from auth.uid() or a.status in ('draft', 'ineligible') then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  insert into public.leader_application_policy (application_id, evidence_note, noted_by)
  values (p_app, v_note, auth.uid())
  on conflict (application_id) do update set evidence_note = excluded.evidence_note, noted_by = excluded.noted_by;
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility: the questions that are asked
-- ---------------------------------------------------------------------------

create or replace function public.check_leader_eligibility(p_app uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  a public.leader_applications;
  keys text[] := array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality'];
  k text;
  failed text[] := '{}';
  m jsonb;
  required_n integer;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'This application can no longer be changed' using errcode = '22023';
  end if;

  m := public.leader_stage_modes(p_app);
  select count(*) into required_n from unnest(keys) as q(item) where m -> 'eligibility' ->> q.item = 'required';

  foreach k in array keys loop
    -- A question that is optional or off never stops anyone, and an optional one may be answered either way or not at all
    if m -> 'eligibility' ->> k is distinct from 'required' then
      continue;
    end if;
    if jsonb_typeof(a.answers -> 'eligibility' -> k) is distinct from 'boolean' then
      raise exception '%', case when required_n = 7 then 'Answer all seven questions' else 'Answer all the questions' end using errcode = '22023';
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
$function$;

-- ---------------------------------------------------------------------------
-- Sending the application: only the required questions and referees are checked, and the positions are remembered
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_leader_application(p_app uuid)
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
  m jsonb;
  req_n integer;
  ok_n integer;
  refs_mode text;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'This application was already submitted' using errcode = '22023';
  end if;

  -- Which steps apply to this application, read once
  m := public.leader_stage_modes(p_app);
  refs_mode := m ->> 'references';

  -- Every question that is required must be yes. A question that is optional or off is not counted.
  select count(*) filter (where m -> 'eligibility' ->> chk.item = 'required'),
         count(*) filter (where m -> 'eligibility' ->> chk.item = 'required' and a.answers -> 'eligibility' -> chk.item = 'true'::jsonb)
    into req_n, ok_n
    from unnest(array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality']) as chk(item);
  if ok_n <> req_n then
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

  -- Two referees, at least one a pastor or unit head, when references are required. Optional: none, one or two, and no pastor is needed.
  -- Off: not asked, and any referee left from before is ignored.
  if refs_mode = 'required' then
    select count(*), count(*) filter (where is_pastor_or_unit_head) into refs, heads
      from public.leader_references where application_id = p_app;
    if refs <> 2 then
      raise exception 'Add both referees' using errcode = '22023';
    end if;
    if heads < 1 then
      raise exception 'One referee must be a pastor or unit head' using errcode = '22023';
    end if;
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

  -- Find your tribe checks its own questions here when it is switched on. Until then this does nothing.
  perform public.leader_fit_gate(p_app);
  -- Remember which steps applied when it was sent, so a switch changed later can only ever make it easier
  insert into public.leader_application_policy (application_id, at_send)
  values (p_app, jsonb_build_object('eligibility', m -> 'eligibility', 'references', m ->> 'references', 'interview', m ->> 'interview'))
  on conflict (application_id) do update set at_send = excluded.at_send;

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


-- ---------------------------------------------------------------------------
-- Inviting to interview: not when there is no interview, and waiting for references only when they are required
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invite_to_interview(p_id uuid)
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
  m jsonb;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can invite to interview' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id for update;
  if not found or a.person_id = me or a.status <> 'submitted' then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  m := public.leader_stage_modes(p_id);
  if m ->> 'interview' = 'off' then
    raise exception 'Interviews are switched off, so nobody is invited. A pastor can decide from the application' using errcode = '22023';
  end if;
  select * into st from public.leader_ai_state where application_id = p_id;
  if cfg.mode = 'on' and st.state in ('consent_needed', 'checking', 'strengthen', 'held') then
    raise exception 'The first check on this application is not finished. Look at it under Admin > Leader quality' using errcode = '22023';
  end if;
  if m ->> 'references' = 'required'
     and (select count(*) from public.leader_references where application_id = p_id and submitted_at is not null) < 2 then
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


-- ---------------------------------------------------------------------------
-- The readiness score: the parts that exist, on the same bar
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.application_readiness(p_app uuid)
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
  m jsonb;
  refs_mode text;
  int_mode text;
  calling_ok boolean;
  scen_ok boolean;
  refs_ok boolean;
  int_ok boolean;
  counted jsonb := '[]'::jsonb;
  missing jsonb := '[]'::jsonb;
  total numeric;
  weight numeric;
begin
  select * into a from public.leader_applications where id = p_app;
  if not found then return null; end if;
  m := public.leader_stage_modes(p_app);
  refs_mode := m ->> 'references';
  int_mode := m ->> 'interview';

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

  -- Which of the four parts exist. Calling and the situations are always asked. The references count when both have answered if they
  -- are required, and when at least one verified answer is in if they are optional or off. The interview counts once two panel members
  -- have scored it.
  calling_ok := calling_n >= 2;
  scen_ok := scen is not null;
  refs_ok := case when refs_mode = 'required' then refs_n >= 2 else refs_n >= 1 end;
  int_ok := interview_n >= 2;

  if calling_ok then counted := counted || '"calling"'::jsonb; else missing := missing || jsonb_build_array(jsonb_build_object('part', 'calling', 'why', 'not_received')); end if;
  if scen_ok then counted := counted || '"scenarios"'::jsonb; else missing := missing || jsonb_build_array(jsonb_build_object('part', 'scenarios', 'why', 'not_received')); end if;
  if refs_ok then counted := counted || '"references"'::jsonb;
  else missing := missing || jsonb_build_array(jsonb_build_object('part', 'references', 'why', case when refs_mode = 'off' then 'not_asked' else 'not_received' end)); end if;
  if int_ok then counted := counted || '"interview"'::jsonb;
  else missing := missing || jsonb_build_array(jsonb_build_object('part', 'interview', 'why', case when int_mode = 'off' then 'not_asked' else 'not_received' end)); end if;

  -- Null when calling or the situations are missing, or when a part that is required is missing
  if calling_ok and scen_ok and (refs_mode <> 'required' or refs_ok) and (int_mode <> 'required' or int_ok) then
    if refs_ok and int_ok then
      -- All four parts: exactly the score it has always been
      readiness := round(calling * 0.30 + scen * 0.25 + refs * 0.25 + interview * 0.20, 1);
    else
      -- Fewer parts: the same bar on the evidence that exists
      total := calling * 30 + scen * 25;
      weight := 55;
      if refs_ok then total := total + refs * 25; weight := weight + 25; end if;
      if int_ok then total := total + interview * 20; weight := weight + 20; end if;
      readiness := round(total / weight, 1);
    end if;
  end if;

  return jsonb_build_object(
    'calling', round(calling, 1), 'calling_reviews', calling_people_n, 'calling_source', calling_source,
    'scenarios', scen,
    'references', round(refs, 1), 'references_received', refs_n,
    'interview', round(interview, 1), 'interview_reviews', interview_n,
    'readiness', readiness,
    'gates', jsonb_build_object(
      'goal_declared', goal_ok,
      'references_clean', case when refs_mode = 'required' then refs_n >= 2 and concerns = 0 and has_head else concerns = 0 end,
      'open_concerns', concerns,
      'pastor_or_unit_head_referee', has_head,
      'references_held', coalesce(held_n, 0), 'references_unverified', coalesce(unverified_n, 0)),
    'band', case
      when readiness is null then null
      when readiness >= 75 then 'leader'
      when readiness >= 60 then 'assistant_leader'
      else 'below' end,
    'weights', jsonb_build_object('calling', 30, 'scenarios', 25,
                                  'references', case when refs_ok then 25 else 0 end,
                                  'interview', case when int_ok then 20 else 0 end),
    'counted', counted,
    'missing', missing,
    'evidence', case when calling_ok and scen_ok and refs_ok and int_ok then 'full' else 'reduced' end,
    'modes', jsonb_build_object('references', refs_mode, 'interview', int_mode));
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The decision: the steps that apply, and what it rested on
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.decide_application(p_id uuid, p_decision text, p_note text)
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
  m jsonb;
  ev text;
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
  m := public.leader_stage_modes(p_id);

  if p_decision = 'not_approved' then
    new_status := 'not_approved';
  else
    -- Only when the interview is required does approval wait for it to be scored
    if m ->> 'interview' = 'required' and a.status <> 'interviewed' then
      raise exception 'Approve only after the interview has been scored' using errcode = '22023';
    end if;
    ready := public.application_readiness(p_id);
    if ready ->> 'readiness' is null then
      raise exception 'The scores are not complete yet' using errcode = '22023';
    end if;
    if (ready #>> '{gates,goal_declared}')::boolean is not true then
      raise exception 'The applicant has not declared a Season Goal' using errcode = '22023';
    end if;
    if (ready #>> '{gates,references_clean}')::boolean is not true then
      if m ->> 'references' = 'required' then
        raise exception 'The reference check is not clean: both referees must answer, one a pastor or unit head, with no open concern' using errcode = '22023';
      end if;
      raise exception 'A referee has raised a concern that has not been cleared yet' using errcode = '22023';
    end if;
    if p_decision = 'leader' and (ready ->> 'readiness')::numeric < 75 then
      raise exception 'A leader needs a readiness score of 75 or more' using errcode = '22023';
    end if;
    if p_decision = 'assistant_leader' and (ready ->> 'readiness')::numeric < 60 then
      raise exception 'An assistant leader needs a readiness score of 60 or more' using errcode = '22023';
    end if;
    new_status := case p_decision when 'leader' then 'approved_leader' else 'approved_assistant' end;
    role_to_grant := p_decision::public.app_role;
    ev := ready ->> 'evidence';
    select centre_id into centre from public.people where id = a.person_id;
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (a.person_id, role_to_grant, centre, me)
    on conflict do nothing;
  end if;

  -- Deciding before the interview that is no longer needed frees the slot that was booked for it
  if m ->> 'interview' <> 'required' and a.status = 'interview_booked' then
    perform public.release_interview_slot(p_id);
  end if;

  update public.leader_applications
     set status = new_status, decided_at = now(), decided_by = me,
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  if p_decision <> 'not_approved' then
    -- What the decision rested on: the steps that applied, the parts that counted and whether the evidence was full
    insert into public.leader_application_policy (application_id, at_decision, evidence, decided_at)
    values (p_id, jsonb_build_object('modes', m, 'counted', ready -> 'counted', 'weights', ready -> 'weights', 'readiness', ready -> 'readiness'), ev, now())
    on conflict (application_id) do update set at_decision = excluded.at_decision, evidence = excluded.evidence, decided_at = excluded.decided_at;
  end if;
  perform public.write_event(me, 'leader.decided', 'leader_application', p_id::text,
    case when p_decision = 'not_approved' then jsonb_build_object('decision', p_decision)
         else jsonb_build_object('decision', p_decision, 'evidence', ev) end);
  return jsonb_build_object('ok', true, 'status', new_status);
end;
$function$
;


-- ---------------------------------------------------------------------------
-- Asking a referee: not when references are not asked
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_referee_send(p_reference uuid)
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
  if public.leader_stage_modes(a.id) ->> 'references' = 'off' then
    raise exception 'References are not part of the process, so no request is needed' using errcode = '22023';
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


-- ---------------------------------------------------------------------------
-- Booking an interview: not when the interview has been switched off
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_interview_slot(p_slot uuid)
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
  if public.leader_stage_modes(a.id) ->> 'interview' = 'off' then
    raise exception 'The pastors will decide without an interview, so there is nothing to book' using errcode = '22023';
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


-- ---------------------------------------------------------------------------
-- The review queue: which steps apply to each application
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_queue()
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
             (select s.starts_at from public.interview_slots s where s.application_id = a.id) as interview_at,
             pm.m ->> 'references' as references_mode,
             pm.m ->> 'interview' as interview_mode
        from public.leader_applications a
        cross join lateral (select public.leader_stage_modes(a.id) as m) pm
       where a.status not in ('draft', 'ineligible')
         and a.person_id <> auth.uid()
    ) x), '[]'::jsonb);
end;
$function$
;


-- ---------------------------------------------------------------------------
-- Opening an application: the steps that applied, and any optional question answered no
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.review_application(p_id uuid)
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
  m jsonb;
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id;
  if not found or a.status in ('draft', 'ineligible') or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  m := public.leader_stage_modes(a.id);

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
    'readiness', case when decider then public.application_readiness(a.id) else null end,
    'can_decide', is_pastor and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed'),
    'can_invite', decider and a.status = 'submitted',
    'decision_note', a.decision_note,
    'decided_at', a.decided_at,
    'modes', m,
    -- Questions the applicant answered no that were not required, for the panel to see
    'optional_no', coalesce((
      select jsonb_agg(q.item order by q.ord)
        from unnest(array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality']) with ordinality as q(item, ord)
       where a.answers -> 'eligibility' -> q.item = 'false'::jsonb and m -> 'eligibility' ->> q.item <> 'required'), '[]'::jsonb),
    -- What the decision rests on, for those who decide only
    'evidence', case when decider then (select p.evidence from public.leader_application_policy p where p.application_id = a.id) end,
    'evidence_note', case when decider then (select p.evidence_note from public.leader_application_policy p where p.application_id = a.id) end);
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The activity funnel: a step that is not required counts as passed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activity_leader_rows(p_from date, p_to date)
 RETURNS TABLE(person_id uuid, grp text, community_id uuid, zone text, season_id uuid, stage smallint, t1 timestamp with time zone, t2 timestamp with time zone, t3 timestamp with time zone, t4 timestamp with time zone, t5 timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.person_id, ap.grp, null::uuid, null::text, null::uuid,
         (case
            when a.submitted_at is null then 1 + coalesce(st.position, 0)
            when not ai.ok then 23
            when not rf.ok and pm.m ->> 'references' = 'required' then 24
            when a.status not in ('interview_invited', 'interview_booked', 'interviewed', 'approved_leader', 'approved_assistant')
                 and pm.m ->> 'interview' = 'required' then 25
            when a.status not in ('approved_leader', 'approved_assistant') then 26
            when not exists (select 1 from public.person_roles r
                              where r.person_id = a.person_id and r.role in ('leader', 'assistant_leader')) then 27
            else 28
          end)::smallint,
         a.created_at, a.submitted_at, null::timestamptz, null::timestamptz, null::timestamptz
    from public.leader_applications a
    join public.activity_people ap on ap.person_id = a.person_id
    left join public.activity_steps st on st.form = 'leader' and st.step = a.step
    cross join lateral (select public.leader_stage_modes(a.id) as m) pm
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


-- ---------------------------------------------------------------------------
-- The messages an applicant gets: only about the steps that apply to them
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.on_application_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_template text;
  v_slot public.interview_slots%rowtype;
  v_phone text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_template := case new.status
    when 'submitted' then 'application_received'
    when 'interview_invited' then 'application_interview_invited'
    when 'interview_booked' then 'application_interview_booked'
    when 'approved_leader' then 'application_approved'
    when 'approved_assistant' then 'application_approved'
    when 'not_approved' then 'application_not_approved'
    else null end;
  if v_template is null then
    return new;
  end if;
  if new.status = 'interview_booked' then
    select * into v_slot from public.interview_slots where application_id = new.id;
  end if;
  perform public.enqueue_message(new.person_id, v_template,
    jsonb_build_object('first_name', public.first_name_of(new.person_id),
                       'role', case new.status when 'approved_leader' then 'tribe leader' when 'approved_assistant' then 'assistant leader' end,
                       'starts_at', v_slot.starts_at, 'mode', v_slot.mode, 'place', v_slot.place, 'minutes', v_slot.minutes)
      || public.leader_message_flags(new.id),
    null, 'app:' || new.id || ':' || new.status);

  -- An approved leader's number from the application becomes their contact number (they still choose the channels).
  if new.status in ('approved_leader', 'approved_assistant') then
    v_phone := regexp_replace(coalesce(new.answers #>> '{contact,whatsapp}', ''), '[\s()-]', '', 'g');
    if v_phone ~ '^\+[1-9][0-9]{7,14}$' then
      insert into public.contact_preferences (person_id, phone, preferred)
      values (new.person_id, v_phone, 'email')
      on conflict (person_id) do update set phone = coalesce(public.contact_preferences.phone, excluded.phone);
    end if;
  end if;
  return new;
end;
$function$
;


-- ---------------------------------------------------------------------------
-- A person clears the first check: the message only mentions the steps that apply
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.leader_ai_clear(p_app uuid, p_note text DEFAULT NULL::text)
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
  perform public.enqueue_message(a.person_id, public.leader_check_template(p_app),
    jsonb_build_object('first_name', public.first_name_of(a.person_id)), null, 'person:' || p_app || ':clear');
  perform public.write_event(auth.uid(), 'leader.ai_cleared', 'leader_application', p_app::text,
    jsonb_build_object('note', left(nullif(btrim(coalesce(p_note, '')), ''), 500)));
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The first check clears an application: the message only mentions the steps that apply
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.worker_save_leader_ai_score(p_token text, p_job uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  j public.leader_ai_jobs;
  a public.leader_applications;
  st public.leader_ai_state;
  has_state boolean;
  ai_ran boolean;
  sc jsonb;
  k text;
  flags text[];
  conf numeric;
  fb jsonb := '{}'::jsonb;
  outcome text;
  run_no integer;
  calling numeric;
  new_state text;
  known constant text[] := array['instruction_attempt', 'copied_or_templated', 'duplicate_of_other', 'same_in_two_answers',
    'unverified_evidence', 'forced_through', 'poor_fit', 'off_topic', 'generic_boilerplate', 'low_effort', 'gibberish'];
begin
  perform public.worker_ok(p_token);
  if jsonb_typeof(p_result) is distinct from 'object' or char_length(p_result::text) > 24000 then
    raise exception 'Bad result' using errcode = '22023';
  end if;
  select * into j from public.leader_ai_jobs where id = p_job for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if j.status <> 'running' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into a from public.leader_applications where id = j.application_id;

  ai_ran := coalesce((p_result ->> 'ai_ran')::boolean, false);
  sc := case when ai_ran then p_result -> 'scores' end;
  if sc is not null then
    if jsonb_typeof(sc) is distinct from 'object' then
      raise exception 'Scores must be an object' using errcode = '22023';
    end if;
    foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] loop
      if jsonb_typeof(sc -> k) is distinct from 'number' or (sc ->> k) !~ '^[1-5]$' then
        raise exception 'Scores run from 1 to 5' using errcode = '22023';
      end if;
    end loop;
    sc := jsonb_build_object('q1', sc -> 'q1', 'q2', sc -> 'q2', 'q3', sc -> 'q3', 'q4', sc -> 'q4', 'q5', sc -> 'q5', 'q6', sc -> 'q6');
  end if;
  flags := array(select distinct f from jsonb_array_elements_text(
             case when jsonb_typeof(p_result -> 'flags') = 'array' then p_result -> 'flags' else '[]'::jsonb end) as f
           where f = any (known));
  conf := case when (p_result ->> 'confidence') ~ '^[0-9.]+$' then least(greatest((p_result ->> 'confidence')::numeric, 0), 1) end;
  calling := case when sc is not null then public.rating_pct(sc) end;

  select * into st from public.leader_ai_state where application_id = a.id for update;
  has_state := found;
  outcome := public.leader_ai_decide(sc, flags, conf, case when has_state then st.rewrites_used else 0 end, j.origin);

  if jsonb_typeof(p_result -> 'feedback') = 'object' then
    for k in select jsonb_object_keys(p_result -> 'feedback') loop
      if k in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles')
         and jsonb_typeof(p_result -> 'feedback' -> k) = 'string'
         and char_length(btrim(p_result -> 'feedback' ->> k)) >= 10 then
        fb := fb || jsonb_build_object(k, left(btrim(p_result -> 'feedback' ->> k), 300));
      end if;
    end loop;
  end if;
  -- Asking for more with nothing to say about what is a request nobody can act on: a person looks instead.
  if outcome = 'strengthen' and fb = '{}'::jsonb then
    outcome := 'held';
  end if;
  if not j.shadow and outcome = 'unscored' then
    raise exception 'The AI did not produce a score' using errcode = '22023';
  end if;

  select coalesce(max(s.run), 0) + 1 into run_no from public.leader_ai_scores s where s.application_id = a.id;
  insert into public.leader_ai_scores
    (application_id, run, origin, shadow, ai_ran, scores, calling_pct, evidence, reasons, feedback, flags, confidence, outcome,
     provider, model, latency_ms, input_tokens, output_tokens)
  values
    (a.id, run_no, j.origin, j.shadow, ai_ran, sc, calling,
     case when jsonb_typeof(p_result -> 'evidence') = 'object' then p_result -> 'evidence' else '{}'::jsonb end,
     case when jsonb_typeof(p_result -> 'reasons') = 'object' then p_result -> 'reasons' else '{}'::jsonb end,
     fb, flags, conf, outcome,
     left(p_result ->> 'provider', 24), left(p_result ->> 'model', 64),
     case when (p_result ->> 'latency_ms') ~ '^[0-9]{1,9}$' then (p_result ->> 'latency_ms')::integer end,
     case when (p_result ->> 'input_tokens') ~ '^[0-9]{1,9}$' then (p_result ->> 'input_tokens')::integer end,
     case when (p_result ->> 'output_tokens') ~ '^[0-9]{1,9}$' then (p_result ->> 'output_tokens')::integer end);

  update public.leader_ai_jobs set status = 'done', finished_at = now(), locked_until = null, last_error = null where id = j.id;
  perform public.write_event(null, 'leader.ai_scored', 'leader_application', a.id::text,
    jsonb_build_object('run', run_no, 'outcome', outcome, 'shadow', j.shadow, 'origin', j.origin, 'calling_pct', calling));

  -- Recording only: nothing changes for the applicant.
  if j.shadow then
    return jsonb_build_object('ok', true, 'outcome', outcome, 'shadow', true);
  end if;
  -- A person stepped in while the AI was reading: the reading is kept, but the person's decision stands.
  if not has_state or st.state <> 'checking' then
    return jsonb_build_object('ok', true, 'outcome', outcome, 'state', case when has_state then st.state else 'not_applicable' end);
  end if;

  new_state := case outcome when 'clear' then 'clear' when 'strengthen' then 'strengthen' else 'held' end;
  perform public.leader_ai_set_state(a.id, new_state, 'ai', case when outcome = 'strengthen' then fb else '{}'::jsonb end, null);
  if outcome = 'clear' then
    update public.leader_ai_state set audit_sample = random() * 100 < cfg.audit_pct where application_id = a.id;
    perform public.enqueue_message(a.person_id, public.leader_check_template(a.id),
      jsonb_build_object('first_name', public.first_name_of(a.person_id)), null, 'ai:' || a.id || ':clear:' || run_no);
  elsif outcome = 'strengthen' then
    perform public.enqueue_message(a.person_id, 'leader_check_strengthen',
      jsonb_build_object('first_name', public.first_name_of(a.person_id), 'count', (select count(*) from jsonb_object_keys(fb))), null,
      'ai:' || a.id || ':strengthen:' || run_no);
  end if;
  return jsonb_build_object('ok', true, 'outcome', outcome, 'state', new_state);
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The reminder journey: how much of the form is left, and what is asked
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.journey_data(r journey_runs)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.reminder_settings := public.reminder_cfg();
  v_out jsonb := jsonb_build_object('first_name', public.first_name_of(r.person_id));
  d public.intake_drafts%rowtype;
  la public.leader_applications%rowtype;
  v_name text;
  v_leader uuid;
  v_seats integer;
  v_starts date;
  c public.tribes%rowtype;
  cm public.tribe_members%rowtype;
  se public.seasons%rowtype;
  v_today date := public.today_lagos();
  m jsonb;
begin
  if r.journey_key = 'member_form' then
    select * into d from public.intake_drafts where person_id = r.person_id;
    if found then
      v_out := v_out || jsonb_build_object('step', d.step,
        'erase_date', to_char((d.updated_at at time zone 'Africa/Lagos')::date + (public.retention_periods() ->> 'draft_days')::integer, 'FMDD FMMonth YYYY'));
    end if;

  elsif r.journey_key = 'leader_application' then
    select * into la from public.leader_applications where id = r.ref_id;
    v_out := v_out || jsonb_build_object('step', la.step,
      'close_date', case when s.applications_close_on is null then null else to_char(s.applications_close_on, 'FMDD FMMonth YYYY') end);
    -- A step switched off or made optional changes how much is left and what the reminder says about referees.
    -- With every step asked nothing is added, so the data is exactly what it was.
    m := public.leader_stage_modes(la.id);
    if m ->> 'references' <> 'required' or m ->> 'interview' <> 'required'
       or exists (select 1 from jsonb_each_text(m -> 'eligibility') e where e.value <> 'required') then
      v_out := v_out || jsonb_build_object('modes', m);
    end if;

  elsif r.journey_key = 'no_tribe' then
    select se2.starts_on into v_starts from public.member_profiles mp join public.seasons se2 on se2.id = mp.season_id where mp.person_id = r.person_id;
    select x.name, x.leader_id, x.seats into v_name, v_leader, v_seats from (
      select c2.name, c2.leader_id, c2.capacity - (select count(*) from public.tribe_members m where m.tribe_id = c2.id and m.status = 'active') as seats, mr.rank
        from public.match_recommendations mr join public.tribes c2 on c2.id = mr.tribe_id
       where mr.person_id = r.person_id
         and mr.run_id = (select mx.id from public.match_runs mx where mx.person_id = r.person_id order by mx.ran_at desc limit 1)) x
     order by (x.seats > 0) desc, x.rank limit 1;
    v_out := v_out || jsonb_build_object(
      'tribe_1', coalesce(v_name, 'your best match'), 'leader_first', coalesce(public.first_name_of(v_leader), 'your leader'),
      'seats_left', coalesce(v_seats, 0),
      'season_starts', case when v_starts is null then 'soon' else to_char(v_starts, 'FMDD FMMonth YYYY') end,
      'joining_closes', case when v_starts is null then 'the end of week 2' else to_char(v_starts + s.joining_closes_days, 'FMDD FMMonth YYYY') end);

  elsif r.journey_key = 'in_tribe' then
    select * into cm from public.tribe_members where id = r.ref_id;
    select * into c from public.tribes where id = cm.tribe_id;
    v_out := v_out || jsonb_build_object(
      'tribe', coalesce(c.name, 'your tribe'), 'leader_first', coalesce(public.first_name_of(c.leader_id), 'your leader'),
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'), 'mode', c.meeting_mode, 'place_note', c.place_note,
      'next_meeting', case when c.meeting_day is null then null
        else to_char(v_today + ((c.meeting_day - extract(dow from v_today)::integer + 7) % 7), 'FMDay FMDD FMMonth') end);
  end if;
  return v_out;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- A question switched off or made optional releases those stopped at it
-- ---------------------------------------------------------------------------

-- For every application stopped at "not yet", takes away the questions that are no longer required. If none are left, the application
-- goes back to a draft at the first screen, with its answers kept. Nothing is sent to the person; they find it open when they return.
-- A trigger rather than a change to the two setters, so every way a switch can be moved is covered, including future ones.
create function public.leader_pipeline_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  still text[];
begin
  still := array(
    select q.item
      from unnest(array['member6', 'foundation', 'serving', 'age21', 'time', 'safeguarding', 'confidentiality']) as q(item)
     where to_jsonb(new) ->> ('elig_' || q.item) = 'required');
  update public.leader_applications a
     set failed_checks = array(select f from unnest(a.failed_checks) as f where f = any (still)),
         status = case when exists (select 1 from unnest(a.failed_checks) as f where f = any (still)) then a.status else 'draft'::public.application_status end,
         step = case when exists (select 1 from unnest(a.failed_checks) as f where f = any (still)) then a.step else 'eligibility' end
   where a.status = 'ineligible'
     and exists (select 1 from unnest(a.failed_checks) as f where not (f = any (still)));
  return null;
end;
$$;

create trigger leader_pipeline_settings_release
  after update on public.leader_pipeline_settings
  for each row
  when (old.* is distinct from new.*)
  execute function public.leader_pipeline_release();

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.leader_lenient(text, text),
  public.leader_stage_modes(uuid),
  public.my_application_modes(uuid),
  public.leader_fit_gate(uuid),
  public.leader_message_flags(uuid),
  public.leader_check_template(uuid),
  public.release_interview_slot(uuid),
  public.clear_referee(uuid),
  public.set_evidence_note(uuid, text),
  public.leader_pipeline_release()
  from public, anon, authenticated;

grant execute on function
  public.my_application_modes(uuid),
  public.clear_referee(uuid),
  public.set_evidence_note(uuid, text)
  to authenticated;

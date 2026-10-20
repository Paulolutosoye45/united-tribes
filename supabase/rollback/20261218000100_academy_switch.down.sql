-- Way back from Phase 3 (the Academy and declaration switches)
--
-- Phase 3 revised twelve functions so that the Academy and the declaration can be Optional or Off.
-- Run this AFTER the Phase 6 file and BEFORE the Phase 2 file. It puts the bodies Phase 2 left back (two of them, leader_message_flags and
-- on_application_stage, are Phase 2 bodies; the Phase 2 file then puts those two back to the original).
-- No certificate is withdrawn: the table of certificates is not touched.
--
-- Puts back the body each of these functions had before the migration, with the same name, the same arguments and the same permissions:
--   academy_module, book_academy_session, certification_state, leader_message_flags, my_academy, my_tribe, on_application_stage, record_practice, refresh_certification, sign_safeguarding, submit_quiz, submit_tribe_card
-- Tables, columns, settings and every row are left exactly as they are. Nothing is deleted or changed. Press Full process on the Admin page
-- first (the first way back); this file is the second, for when a function itself misbehaves.
-- Run it as the database owner, once. Running it twice changes nothing.

begin;

CREATE OR REPLACE FUNCTION public.academy_module(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  m public.academy_modules;
  prog public.academy_progress;
begin
  if not (public.is_trainee() or public.is_review_panel() or public.has_role('admin')) then
    raise exception 'The Academy is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  select * into m from public.academy_modules where slug = p_slug and active;
  if not found then
    raise exception 'That module does not exist' using errcode = 'P0002';
  end if;
  if public.is_trainee() then
    insert into public.academy_progress (person_id, module_id) values (me, m.id) on conflict do nothing;
  end if;
  select * into prog from public.academy_progress where person_id = me and module_id = m.id;

  return jsonb_build_object(
    'module', jsonb_build_object('slug', m.slug, 'number', m.number, 'title', m.title, 'outcome', m.outcome,
                                  'format', m.format, 'minutes', m.minutes, 'lesson', m.lesson, 'practice', m.practice),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('position', q.position, 'prompt', q.prompt, 'options', q.options) order by q.position)
        from public.academy_questions q where q.module_id = m.id), '[]'::jsonb),
    'progress', jsonb_build_object('attempts', coalesce(prog.attempts, 0), 'best', prog.best_score, 'passed', prog.passed_at is not null),
    'previous', (select slug from public.academy_modules where active and number < m.number order by number desc limit 1),
    'next', (select slug from public.academy_modules where active and number > m.number order by number limit 1),
    'pass_mark', 80,
    'can_take', public.is_trainee()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.book_academy_session(p_session uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  s public.academy_sessions;
begin
  if not public.is_trainee() then
    raise exception 'Workshops are for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  select * into s from public.academy_sessions where id = p_session for update;
  if not found or s.starts_at < now() + interval '1 hour' then
    raise exception 'That workshop is no longer open for booking' using errcode = '22023';
  end if;
  if exists (select 1 from public.academy_bookings where session_id = s.id and person_id = me) then
    return;
  end if;
  if exists (
    select 1 from public.academy_bookings b join public.academy_sessions x on x.id = b.session_id
     where b.person_id = me and x.kind = s.kind and b.attended is true
  ) then
    raise exception 'You have already been to this workshop' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.academy_bookings b join public.academy_sessions x on x.id = b.session_id
     where b.person_id = me and x.kind = s.kind and x.starts_at > now()
  ) then
    raise exception 'You are already booked into this workshop on another date. Cancel that one first' using errcode = '22023';
  end if;
  if (select count(*) from public.academy_bookings where session_id = s.id) >= s.capacity then
    raise exception 'That workshop is full. Choose another date' using errcode = '22023';
  end if;
  insert into public.academy_bookings (session_id, person_id) values (s.id, me);
  perform public.write_event(me, 'academy.session_booked', 'academy_session', s.id::text, jsonb_build_object('kind', s.kind));
end;
$function$;

CREATE OR REPLACE FUNCTION public.certification_state(p_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  total integer;
  passed integer;
  is_leader boolean;
begin
  select count(*) into total from public.academy_modules where active;
  select count(*) into passed
    from public.academy_progress p
    join public.academy_modules m on m.id = p.module_id
   where p.person_id = p_person and p.passed_at is not null and m.active;
  select exists (select 1 from public.person_roles where person_id = p_person and role = 'leader') into is_leader;

  return jsonb_build_object(
    'modules_total', total,
    'modules_passed', passed,
    'modules_done', total > 0 and passed >= total,
    'declaration', exists (select 1 from public.safeguarding_declarations where person_id = p_person),
    'practice', coalesce((select ready from public.practice_assessments where person_id = p_person), false),
    'card_required', is_leader,
    'card', exists (select 1 from public.tribes where leader_id = p_person and status = 'approved'),
    'certified', exists (select 1 from public.leader_certifications where person_id = p_person)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.leader_message_flags(p_app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.my_academy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
  prac public.practice_assessments;
  decl public.safeguarding_declarations;
  cert public.leader_certifications;
begin
  if not public.is_trainee() then
    raise exception 'The Academy is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  select * into c from public.tribes where (leader_id = me or assistant_id = me) and status <> 'closed'
    order by created_at desc limit 1;
  select * into prac from public.practice_assessments where person_id = me;
  select * into decl from public.safeguarding_declarations where person_id = me order by signed_at desc limit 1;
  select * into cert from public.leader_certifications where person_id = me;

  return jsonb_build_object(
    'is_leader', public.has_role('leader'),
    'pass_mark', 80,
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', m.slug, 'number', m.number, 'title', m.title, 'outcome', m.outcome,
               'format', m.format, 'minutes', m.minutes,
               'opened', p.person_id is not null, 'attempts', coalesce(p.attempts, 0),
               'best', p.best_score, 'passed', p.passed_at is not null)
             order by m.number)
        from public.academy_modules m
        left join public.academy_progress p on p.module_id = m.id and p.person_id = me
       where m.active), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'starts_at', s.starts_at, 'minutes', s.minutes,
               'mode', s.mode, 'place', case when b.person_id is not null then s.place else null end,
               'seats_left', greatest(0, s.capacity - (select count(*) from public.academy_bookings x where x.session_id = s.id)),
               'booked', b.person_id is not null,
               'can_cancel', b.person_id is not null and s.starts_at > now() + interval '24 hours')
             order by s.starts_at)
        from public.academy_sessions s
        left join public.academy_bookings b on b.session_id = s.id and b.person_id = me
       where s.starts_at > now() - interval '3 hours'), '[]'::jsonb),
    'attended', jsonb_build_object(
      'practice_workshop', exists (select 1 from public.academy_bookings b join public.academy_sessions s on s.id = b.session_id
                                    where b.person_id = me and s.kind = 'practice_workshop' and b.attended is true),
      'commissioning_workshop', exists (select 1 from public.academy_bookings b join public.academy_sessions s on s.id = b.session_id
                                         where b.person_id = me and s.kind = 'commissioning_workshop' and b.attended is true)),
    'declaration', case when decl.id is null then null
                        else jsonb_build_object('version', decl.version, 'signed_at', decl.signed_at) end,
    'practice', case when prac.person_id is null then null
                     else jsonb_build_object('ready', prac.ready, 'format', prac.format, 'note', prac.note, 'assessed_at', prac.assessed_at) end,
    'card', case when c.id is null then null
                 else jsonb_build_object('id', c.id, 'status', c.status, 'role', case when c.leader_id = me then 'leader' else 'assistant' end) end,
    'state', public.certification_state(me),
    'certified_at', cert.certified_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_tribe()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
  card jsonb;
  missing text[] := '{}';
  module_ok boolean;
begin
  select * into c from public.tribes where (leader_id = me or assistant_id = me) and status <> 'closed'
    order by created_at desc limit 1;
  if not found then
    return null;
  end if;
  card := public.tribe_json(c.id);
  module_ok := exists (
    select 1 from public.academy_progress p join public.academy_modules m on m.id = p.module_id
     where p.person_id = c.leader_id and m.slug = 'the-success-picture' and p.passed_at is not null);

  if c.name is null then missing := array_append(missing, 'name'); end if;
  if c.track_id is null then missing := array_append(missing, 'track'); end if;
  if c.community_id is null then missing := array_append(missing, 'community'); end if;
  if c.season_goal_id is null then missing := array_append(missing, 'goal'); end if;
  if coalesce(char_length(btrim(c.story)), 0) < 40 then missing := array_append(missing, 'story'); end if;
  if c.slot is null then missing := array_append(missing, 'time'); end if;
  if c.meeting_mode is null then missing := array_append(missing, 'mode'); end if;
  if c.zone is null then missing := array_append(missing, 'zone'); end if;
  if coalesce(char_length(btrim(c.loving_god)), 0) < 15 then missing := array_append(missing, 'god'); end if;
  if coalesce(char_length(btrim(c.loving_others)), 0) < 15 then missing := array_append(missing, 'others'); end if;
  if coalesce(char_length(btrim(c.loving_life)), 0) < 15 then missing := array_append(missing, 'life'); end if;

  return card || jsonb_build_object(
    'role', case when c.leader_id = me then 'leader' else 'assistant' end,
    'missing', to_jsonb(missing),
    'module_ok', module_ok,
    'editable', c.leader_id = me and c.status in ('draft', 'changes_requested'),
    'certified', exists (select 1 from public.leader_certifications where person_id = c.leader_id),
    'meeting_link', c.meeting_link);
end;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.record_practice(p_person uuid, p_format text, p_ready boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_review_panel() then
    raise exception 'Only a coach, director or pastor can mark the practice session' using errcode = '42501';
  end if;
  if p_person = auth.uid() then
    raise exception 'You cannot mark your own practice session' using errcode = '42501';
  end if;
  if not exists (select 1 from public.person_roles where person_id = p_person and role in ('leader', 'assistant_leader')) then
    raise exception 'That person is not a leader in training' using errcode = '22023';
  end if;
  if p_format not in ('co_lead', 'recorded') then
    raise exception 'Choose how the practice session was done' using errcode = '22023';
  end if;
  if p_ready is null then
    raise exception 'Choose ready or not yet' using errcode = '22023';
  end if;
  if not p_ready and (note is null or char_length(note) < 3) then
    raise exception 'Say what to work on, so the leader knows what comes next' using errcode = '22023';
  end if;
  if note is not null and char_length(note) > 600 then
    raise exception 'Keep the note under 600 characters' using errcode = '22023';
  end if;
  insert into public.practice_assessments (person_id, format, ready, note, assessed_by)
  values (p_person, p_format, p_ready, note, auth.uid())
  on conflict (person_id) do update
     set format = excluded.format, ready = excluded.ready, note = excluded.note,
         assessed_by = excluded.assessed_by, assessed_at = now();
  perform public.write_event(auth.uid(), 'academy.practice_recorded', 'person', p_person::text, jsonb_build_object('ready', p_ready));
  perform public.refresh_certification(p_person);
end;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_certification(p_person uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s jsonb := public.certification_state(p_person);
  as_role public.app_role;
begin
  if (s ->> 'certified')::boolean then
    return true;
  end if;
  if (s ->> 'modules_done')::boolean
     and (s ->> 'declaration')::boolean
     and (s ->> 'practice')::boolean
     and (not (s ->> 'card_required')::boolean or (s ->> 'card')::boolean) then
    as_role := case when (s ->> 'card_required')::boolean then 'leader' else 'assistant_leader' end;
    insert into public.leader_certifications (person_id, as_role) values (p_person, as_role)
    on conflict do nothing;
    perform public.write_event(p_person, 'academy.certified', 'person', p_person::text,
      jsonb_build_object('as', as_role));
    return true;
  end if;
  return false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sign_safeguarding(p_version text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.is_trainee() then
    raise exception 'The declaration is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.academy_progress p join public.academy_modules m on m.id = p.module_id
     where p.person_id = me and m.slug = 'care-and-safeguarding' and p.passed_at is not null
  ) then
    raise exception 'Pass the care and safeguarding module first' using errcode = '22023';
  end if;
  if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'That declaration is out of date. Reload the page' using errcode = '22023';
  end if;
  if char_length(clean) < 3 or position(' ' in clean) = 0 then
    raise exception 'Type your first and last name to sign' using errcode = '22023';
  end if;
  insert into public.safeguarding_declarations (person_id, version, signed_name)
  values (me, p_version, left(clean, 80))
  on conflict do nothing;
  perform public.write_event(me, 'academy.declaration_signed', 'person', me::text, jsonb_build_object('version', p_version));
  perform public.refresh_certification(me);
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_quiz(p_slug text, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  m public.academy_modules;
  total integer;
  right_count integer := 0;
  score integer;
  was_passed boolean;
  passed boolean;
  results jsonb := '[]'::jsonb;
  q record;
  chosen integer;
begin
  if not public.is_trainee() then
    raise exception 'The Academy is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  select * into m from public.academy_modules where slug = p_slug and active;
  if not found then
    raise exception 'That module does not exist' using errcode = 'P0002';
  end if;
  select count(*) into total from public.academy_questions where module_id = m.id;
  if total = 0 then
    raise exception 'This module has no quiz yet' using errcode = '22023';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> total then
    raise exception 'Answer every question first' using errcode = '22023';
  end if;
  if (select count(*) from public.academy_attempts
       where person_id = me and module_id = m.id and at > now() - interval '24 hours') >= 5 then
    raise exception 'That is five tries today. Read the module again and come back tomorrow, or ask your coach' using errcode = '22023';
  end if;

  insert into public.academy_progress (person_id, module_id) values (me, m.id) on conflict do nothing;
  select passed_at is not null into was_passed from public.academy_progress where person_id = me and module_id = m.id;

  for q in select * from public.academy_questions where module_id = m.id order by position loop
    begin
      chosen := (p_answers ->> (q.position - 1))::integer;
    exception when others then
      raise exception 'Answer every question first' using errcode = '22023';
    end;
    if chosen is null or chosen < 0 or chosen >= jsonb_array_length(q.options) then
      raise exception 'Answer every question first' using errcode = '22023';
    end if;
    if chosen = q.correct then
      right_count := right_count + 1;
      results := results || jsonb_build_array(jsonb_build_object('position', q.position, 'right', true));
    else
      results := results || jsonb_build_array(jsonb_build_object('position', q.position, 'right', false, 'explanation', q.explanation));
    end if;
  end loop;

  score := round(right_count * 100.0 / total);
  passed := score >= 80;

  insert into public.academy_attempts (person_id, module_id, score, answers) values (me, m.id, score, p_answers);
  update public.academy_progress
     set attempts = attempts + 1,
         best_score = greatest(coalesce(best_score, 0), score),
         passed_at = case when passed and passed_at is null then now() else passed_at end
   where person_id = me and module_id = m.id;

  if passed and not was_passed then
    perform public.write_event(me, 'academy.module_passed', 'academy_module', m.slug, jsonb_build_object('score', score));
    perform public.refresh_certification(me);
  end if;

  return jsonb_build_object('score', score, 'passed', passed, 'right', right_count, 'total', total, 'results', results);
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_tribe_card(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
begin
  select * into c from public.tribes where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Tribe Card not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'changes_requested') then
    raise exception 'This card has already been sent' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.academy_progress p join public.academy_modules m on m.id = p.module_id
     where p.person_id = me and m.slug = 'the-success-picture' and p.passed_at is not null
  ) then
    raise exception 'Pass the module on the Success Picture first, then send your card' using errcode = '22023';
  end if;
  if c.name is null then raise exception 'Give your tribe a name' using errcode = '22023'; end if;
  if c.community_id is null then raise exception 'Choose your community' using errcode = '22023'; end if;
  if c.track_id is null then raise exception 'Choose your life-stage track' using errcode = '22023'; end if;
  if c.season_goal_id is null then raise exception 'Choose the Season Goal your tribe is built around' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.story)), 0) < 40 then
    raise exception 'Tell your story with this goal in a couple of sentences (at least 40 characters)' using errcode = '22023';
  end if;
  if c.slot is null then raise exception 'Choose the day and time your tribe meets' using errcode = '22023'; end if;
  if c.meeting_mode is null then raise exception 'Say whether you meet online or in person' using errcode = '22023'; end if;
  if c.zone is null then raise exception 'Choose the zone your tribe is in' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_god)), 0) < 15 then raise exception 'Write the Loving God line of your Success Picture' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_others)), 0) < 15 then raise exception 'Write the Loving Others line of your Success Picture' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_life)), 0) < 15 then raise exception 'Write the Loving Life line of your Success Picture' using errcode = '22023'; end if;

  update public.tribes
     set status = 'submitted', submitted_at = now(), review_note = null
   where id = p_id;
  perform public.write_event(me, 'tribe.submitted', 'tribe', p_id::text, '{}'::jsonb);
end;
$function$;

drop trigger if exists leader_roles_certify on public.person_roles;
drop trigger if exists leader_pipeline_settings_certify on public.leader_pipeline_settings;

commit;

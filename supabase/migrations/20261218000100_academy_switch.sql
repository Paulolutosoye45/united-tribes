-- Phase A, part three: the Academy and declaration switches, and what they do to certification
--
-- Two switches, both created with the settings row:
--   academy_mode      required | optional | off   the six modules and quizzes, the two workshops, and the coach's practice sign-off, together
--   declaration_mode  required | off              the signed safeguarding declaration, on its own: it protects members, so switching the
--                                                 training off is a choice about training and not about safeguarding
--
-- A person is certified when every condition the switches ask for is true. The sentence is the one it has always been, with three
-- parts that can be "not needed":
--   all modules passed      needed when the Academy is Required
--   practice marked ready   needed when the Academy is Required
--   declaration signed      needed when the declaration is Required
--   tribe card approved     needed for a leader (never for an assistant), whatever the switches say
-- Nothing here touches the pastor's decision, the approval of the Tribe Card, or the rule that members see a tribe only when its
-- leader is certified. With both switches at Required, every function below gives the answer it gave before.
--
-- No certificate is ever withdrawn. Turning something back on only applies to people who are not yet certified.
--
-- Revised (each from the live body, with everything it did before kept):
--   certification_state, refresh_certification, sign_safeguarding, submit_tribe_card, book_academy_session, record_practice,
--   submit_quiz, academy_module, my_academy, my_tribe, leader_message_flags, on_application_stage
-- New:
--   leader_certification_basis (table), leader_academy_modes, academy_switch, leader_approved_template, leader_roles_certify and its
--   trigger, leader_academy_sweep and its trigger

-- ---------------------------------------------------------------------------
-- What each certificate rested on
-- ---------------------------------------------------------------------------

-- One row per certified person: the positions in force when they were certified, and what they had actually done. A side table, so
-- the certification rows themselves stay exactly as they were. It lets the office compare tribes by training level after a season.
create table public.leader_certification_basis (
  person_id uuid primary key references public.leader_certifications (person_id) on delete cascade,
  academy text not null check (academy in ('required', 'optional', 'off')),
  declaration text not null check (declaration in ('required', 'off')),
  modules_done boolean not null,
  practice_done boolean not null,
  declaration_signed boolean not null,
  certified_at timestamptz not null
);
alter table public.leader_certification_basis enable row level security;
-- No grants and no policies: only the functions below write it.

-- Everyone certified before this existed was certified under the rules that were then in force: everything required, and done.
insert into public.leader_certification_basis (person_id, academy, declaration, modules_done, practice_done, declaration_signed, certified_at)
select c.person_id, 'required', 'required', true, true, true, c.certified_at
  from public.leader_certifications c
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Reading the two switches
-- ---------------------------------------------------------------------------

-- Every function reads the switches through this one. If the settings cannot be read, both count as required: the process as it has
-- always run.
create function public.leader_academy_modes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_pipeline_settings := public.leader_pipeline_cfg();
begin
  return jsonb_build_object(
    'academy', case when cfg.academy_mode in ('optional', 'off') then cfg.academy_mode else 'required' end,
    'declaration', case when cfg.declaration_mode = 'off' then 'off' else 'required' end);
end;
$$;

-- The same, for the screens: with the date each switch was last moved to where it is (empty if it has never been moved).
create function public.academy_switch()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select x.m || jsonb_build_object(
    'academy_since', (select max(l.at) from public.leader_pipeline_log l where l.setting = 'academy_mode' and l.new_value = x.m ->> 'academy'),
    'declaration_since', (select max(l.at) from public.leader_pipeline_log l where l.setting = 'declaration_mode' and l.new_value = x.m ->> 'declaration'))
  from (select public.leader_academy_modes() as m) x;
$$;

-- Which message tells a newly approved leader what comes next. With the Academy required it is the message it has always been. The
-- other three are their own templates, so the wording Meta approved for application_approved is never changed.
create function public.leader_approved_template(p_app uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when m ->> 'academy' = 'required' then 'application_approved'
           when m ->> 'academy' = 'optional' then 'application_approved_optional'
           when m ->> 'declaration' = 'required' then 'application_approved_declaration'
           else 'application_approved_open' end
    from (select public.leader_academy_modes() as m) x;
$$;

-- ---------------------------------------------------------------------------
-- What a person has done, and what the switches ask of them (keys are added, none changes meaning)
-- ---------------------------------------------------------------------------

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
  sw jsonb := public.leader_academy_modes();
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
    'certified', exists (select 1 from public.leader_certifications where person_id = p_person),
    -- What the switches ask for. The keys above keep their meaning: they still say what was actually done.
    'modules_needed', sw ->> 'academy' = 'required',
    'practice_needed', sw ->> 'academy' = 'required',
    'declaration_needed', sw ->> 'declaration' = 'required'
  );
end;
$function$
;


-- ---------------------------------------------------------------------------
-- Certifying: the same sentence, with three parts that can be "not needed"
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_certification(p_person uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s jsonb := public.certification_state(p_person);
  sw jsonb := public.leader_academy_modes();
  as_role public.app_role;
begin
  if (s ->> 'certified')::boolean then
    return true;
  end if;
  -- With everything required, only someone doing the training can have met the conditions. Once a switch lets a condition go, a
  -- person who holds neither role must not be certified for having nothing to do.
  if not ((s ->> 'modules_needed')::boolean and (s ->> 'practice_needed')::boolean and (s ->> 'declaration_needed')::boolean)
     and not exists (select 1 from public.person_roles where person_id = p_person and role in ('leader', 'assistant_leader')) then
    return false;
  end if;
  if (not (s ->> 'modules_needed')::boolean or (s ->> 'modules_done')::boolean)
     and (not (s ->> 'declaration_needed')::boolean or (s ->> 'declaration')::boolean)
     and (not (s ->> 'practice_needed')::boolean or (s ->> 'practice')::boolean)
     and (not (s ->> 'card_required')::boolean or (s ->> 'card')::boolean) then
    as_role := case when (s ->> 'card_required')::boolean then 'leader' else 'assistant_leader' end;
    insert into public.leader_certifications (person_id, as_role) values (p_person, as_role)
    on conflict do nothing;
    -- What the certificate rested on
    insert into public.leader_certification_basis (person_id, academy, declaration, modules_done, practice_done, declaration_signed, certified_at)
    select p_person, sw ->> 'academy', sw ->> 'declaration', (s ->> 'modules_done')::boolean, (s ->> 'practice')::boolean,
           (s ->> 'declaration')::boolean, c.certified_at
      from public.leader_certifications c where c.person_id = p_person
    on conflict do nothing;
    perform public.write_event(p_person, 'academy.certified', 'person', p_person::text,
      jsonb_build_object('as', as_role));
    return true;
  end if;
  return false;
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The declaration: refused when it is off; the module comes first only when the Academy is required
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sign_safeguarding(p_version text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  sw jsonb := public.leader_academy_modes();
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if not public.is_trainee() then
    raise exception 'The declaration is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  if sw ->> 'declaration' = 'off' then
    raise exception 'The safeguarding declaration is not being asked for right now' using errcode = '22023';
  end if;
  -- The care and safeguarding module comes first only when the Academy is required
  if sw ->> 'academy' = 'required' and not exists (
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
$function$
;


-- ---------------------------------------------------------------------------
-- The Tribe Card: the Success Picture module comes first only when the Academy is required
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_tribe_card(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
  sw jsonb := public.leader_academy_modes();
begin
  select * into c from public.tribes where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Tribe Card not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'changes_requested') then
    raise exception 'This card has already been sent' using errcode = '22023';
  end if;
  -- The module on the Success Picture comes first only when the Academy is required
  if sw ->> 'academy' = 'required' and not exists (
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
$function$
;


-- ---------------------------------------------------------------------------
-- Workshops cannot be booked while the Academy is off
-- ---------------------------------------------------------------------------

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
  if public.leader_academy_modes() ->> 'academy' = 'off' then
    raise exception 'The Academy is switched off, so workshops cannot be booked right now' using errcode = '22023';
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
$function$
;


-- ---------------------------------------------------------------------------
-- The practice sign-off is closed while the Academy is off
-- ---------------------------------------------------------------------------

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
  if public.leader_academy_modes() ->> 'academy' = 'off' then
    raise exception 'The Academy is switched off, so a practice session cannot be recorded right now' using errcode = '22023';
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
$function$
;


-- ---------------------------------------------------------------------------
-- Quizzes are closed while the Academy is off
-- ---------------------------------------------------------------------------

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
  if public.leader_academy_modes() ->> 'academy' = 'off' then
    raise exception 'The Academy is switched off, so there are no quizzes to take right now' using errcode = '22023';
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
$function$
;


-- ---------------------------------------------------------------------------
-- A module: closed to leaders while the Academy is off, still readable by the panel and administrators
-- ---------------------------------------------------------------------------

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
  sw jsonb := public.leader_academy_modes();
begin
  if not (public.is_trainee() or public.is_review_panel() or public.has_role('admin')) then
    raise exception 'The Academy is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  -- While the Academy is off the modules are closed to leaders. The panel and administrators can still read them.
  if sw ->> 'academy' = 'off' and not (public.is_review_panel() or public.has_role('admin')) then
    raise exception 'The Academy is switched off right now' using errcode = '22023';
  end if;
  select * into m from public.academy_modules where slug = p_slug and active;
  if not found then
    raise exception 'That module does not exist' using errcode = 'P0002';
  end if;
  if public.is_trainee() and sw ->> 'academy' <> 'off' then
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
    'can_take', public.is_trainee() and sw ->> 'academy' <> 'off',
    'mode', sw ->> 'academy'
  );
end;
$function$
;


-- ---------------------------------------------------------------------------
-- My Academy: the same keys, plus the switches; no modules or workshops while the Academy is off
-- ---------------------------------------------------------------------------

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
  sw jsonb := public.academy_switch();
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
    'modules', case when sw ->> 'academy' = 'off' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', m.slug, 'number', m.number, 'title', m.title, 'outcome', m.outcome,
               'format', m.format, 'minutes', m.minutes,
               'opened', p.person_id is not null, 'attempts', coalesce(p.attempts, 0),
               'best', p.best_score, 'passed', p.passed_at is not null)
             order by m.number)
        from public.academy_modules m
        left join public.academy_progress p on p.module_id = m.id and p.person_id = me
       where m.active), '[]'::jsonb) end,
    'sessions', case when sw ->> 'academy' = 'off' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'starts_at', s.starts_at, 'minutes', s.minutes,
               'mode', s.mode, 'place', case when b.person_id is not null then s.place else null end,
               'seats_left', greatest(0, s.capacity - (select count(*) from public.academy_bookings x where x.session_id = s.id)),
               'booked', b.person_id is not null,
               'can_cancel', b.person_id is not null and s.starts_at > now() + interval '24 hours')
             order by s.starts_at)
        from public.academy_sessions s
        left join public.academy_bookings b on b.session_id = s.id and b.person_id = me
       where s.starts_at > now() - interval '3 hours'), '[]'::jsonb) end,
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
    'certified_at', cert.certified_at,
    'modes', sw
  );
end;
$function$
;


-- ---------------------------------------------------------------------------
-- My Tribe Card: says whether the Success Picture module is needed before sending
-- ---------------------------------------------------------------------------

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
    'module_needed', public.leader_academy_modes() ->> 'academy' = 'required',
    'editable', c.leader_id = me and c.status in ('draft', 'changes_requested'),
    'certified', exists (select 1 from public.leader_certifications where person_id = c.leader_id),
    'meeting_link', c.meeting_link);
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The message flags now also say what comes after approval
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.leader_message_flags(p_app uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m jsonb := public.leader_stage_modes(p_app);
  sw jsonb := public.leader_academy_modes();
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
  -- The Academy and the declaration. With both required, nothing is added and the messages are as they have always been.
  if sw ->> 'academy' <> 'required' then
    out := out || jsonb_build_object('academy', sw ->> 'academy');
  end if;
  if sw ->> 'declaration' = 'off' then
    out := out || jsonb_build_object('declaration', false);
  end if;
  return out;
end;
$function$
;


-- ---------------------------------------------------------------------------
-- The approval message promises only the training that is on
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
    when 'approved_leader' then public.leader_approved_template(new.id)
    when 'approved_assistant' then public.leader_approved_template(new.id)
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
-- Certifying when nothing else would trigger the check
-- ---------------------------------------------------------------------------

-- After a leader or assistant leader role is granted, by any route, check whether the person is already certifiable. Without this, a
-- leader approved while training is off would never be certified, because nothing else raises the question. With the default
-- positions the call finds the conditions unmet and does nothing.
create function public.leader_roles_certify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_certification(new.person_id);
  return null;
end;
$$;

create trigger leader_roles_certify
  after insert on public.person_roles
  for each row
  when (new.role in ('leader', 'assistant_leader'))
  execute function public.leader_roles_certify();

-- When the Academy or the declaration becomes more lenient, everyone not yet certified is checked again. Becoming stricter does
-- nothing: no certificate is ever withdrawn.
create function public.leader_academy_sweep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
begin
  if public.leader_lenient(old.academy_mode, new.academy_mode) is not distinct from old.academy_mode
     and public.leader_lenient(old.declaration_mode, new.declaration_mode) is not distinct from old.declaration_mode then
    return null;
  end if;
  for p in
    select distinct r.person_id
      from public.person_roles r
     where r.role in ('leader', 'assistant_leader')
       and not exists (select 1 from public.leader_certifications c where c.person_id = r.person_id)
  loop
    perform public.refresh_certification(p.person_id);
  end loop;
  return null;
end;
$$;

create trigger leader_pipeline_settings_certify
  after update of academy_mode, declaration_mode on public.leader_pipeline_settings
  for each row
  execute function public.leader_academy_sweep();

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.leader_academy_modes(),
  public.leader_approved_template(uuid),
  public.leader_roles_certify(),
  public.leader_academy_sweep(),
  public.academy_switch()
  from public, anon, authenticated;

grant execute on function
  public.academy_switch()
  to authenticated;

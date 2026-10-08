-- United Tribes, Phase 3: the Leader Academy and Circle Cards.
--
-- An approved leader or assistant leader trains before anyone is matched to
-- them: six short modules each ending in a quiz, two live workshops, one
-- practice session, and a signed safeguarding declaration. A leader also
-- publishes a Circle Card, the page members choose from.
--
-- Certified when all four are true (for an assistant leader, the first three):
--   1  all six modules passed with 80% or more
--   2  the safeguarding declaration is signed
--   3  a coach has marked the practice session "ready"
--   4  the Circle Card is published and approved
--
-- What this adds
--   academy_modules, academy_questions   the course (the answer key stays here)
--   academy_progress, academy_attempts   who has done what, and every quiz attempt
--   safeguarding_declarations            the signed declaration, by version
--   academy_sessions, academy_bookings   the two live workshops, one seat per person
--   practice_assessments                 the coach's call on the practice session
--   leader_certifications                the moment someone became certified
--   circles                              the Circle Card, and later the circle itself
--
-- Rules this file enforces in the database itself:
--   * Quizzes are scored here. The answer key can be read by no one, and a
--     person gets five attempts per module per day.
--   * Certification is granted by the database the moment the conditions are
--     true. Nobody can type it in.
--   * A card cannot be submitted before the module on the Success Picture is
--     passed, and cannot reach members until a pastor or director approves it
--     and its leader is certified.
--   * A leader's life-stage track, tribe and Season Goal come from the approved
--     application and cannot be changed on the card.
--   * A meeting time must fall in a slot members can choose: weeknights from
--     7:30pm, Saturday mornings, or Sunday afternoon and evening.
--   * An assistant leader can be paired with only one circle in a season.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.circle_status as enum (
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'closed'
);

create type public.academy_session_kind as enum (
  'practice_workshop',
  'commissioning_workshop'
);

-- ---------------------------------------------------------------------------
-- The course
-- ---------------------------------------------------------------------------

create table public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  number smallint not null unique check (number between 1 and 12),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,48}$'),
  title text not null check (char_length(title) between 2 and 80),
  outcome text not null check (char_length(outcome) between 2 and 240),
  format text not null check (char_length(format) between 2 and 80),
  minutes smallint not null check (minutes between 5 and 240),
  -- Sections of reading: [{ "title": "...", "body": ["paragraph", ...], "points": ["...", ...] }]
  lesson jsonb not null default '[]'::jsonb check (jsonb_typeof(lesson) = 'array' and octet_length(lesson::text) <= 40000),
  -- A small thing to try before the next gathering
  practice text check (char_length(practice) <= 400),
  active boolean not null default true
);

create table public.academy_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  position smallint not null check (position between 1 and 20),
  prompt text not null check (char_length(prompt) between 5 and 300),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 5),
  -- Index into options, counting from zero. Never leaves the database.
  correct smallint not null check (correct between 0 and 4),
  -- Shown after a wrong answer; it says what is right and why
  explanation text not null check (char_length(explanation) between 5 and 400),
  unique (module_id, position),
  check (correct < jsonb_array_length(options))
);

create table public.academy_progress (
  person_id uuid not null references public.people (id) on delete cascade,
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  opened_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  best_score smallint check (best_score between 0 and 100),
  passed_at timestamptz,
  primary key (person_id, module_id)
);

create table public.academy_attempts (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  module_id uuid not null references public.academy_modules (id) on delete cascade,
  at timestamptz not null default now(),
  score smallint not null check (score between 0 and 100),
  answers jsonb not null check (octet_length(answers::text) <= 400)
);
create index academy_attempts_recent_idx on public.academy_attempts (person_id, module_id, at desc);

-- ---------------------------------------------------------------------------
-- Safeguarding declaration
-- ---------------------------------------------------------------------------

create table public.safeguarding_declarations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,24}$'),
  signed_name text not null check (char_length(signed_name) between 3 and 80),
  signed_at timestamptz not null default now(),
  unique (person_id, version)
);

-- ---------------------------------------------------------------------------
-- Live workshops
-- ---------------------------------------------------------------------------

create table public.academy_sessions (
  id uuid primary key default gen_random_uuid(),
  kind public.academy_session_kind not null,
  starts_at timestamptz not null,
  minutes smallint not null default 120 check (minutes between 30 and 300),
  mode text not null check (mode in ('online', 'in_person')),
  place text not null check (char_length(place) between 2 and 200),
  capacity smallint not null default 30 check (capacity between 2 and 200),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index academy_sessions_starts_idx on public.academy_sessions (starts_at);

create table public.academy_bookings (
  session_id uuid not null references public.academy_sessions (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  booked_at timestamptz not null default now(),
  -- null until a facilitator has marked the register
  attended boolean,
  marked_by uuid references public.people (id) on delete set null,
  marked_at timestamptz,
  primary key (session_id, person_id)
);
create index academy_bookings_person_idx on public.academy_bookings (person_id);

-- ---------------------------------------------------------------------------
-- Practice session and certification
-- ---------------------------------------------------------------------------

create table public.practice_assessments (
  person_id uuid primary key references public.people (id) on delete cascade,
  format text not null check (format in ('co_lead', 'recorded')),
  ready boolean not null,
  -- A short, kind note the leader can read
  note text check (char_length(note) <= 600),
  assessed_by uuid references public.people (id) on delete set null,
  assessed_at timestamptz not null default now(),
  check (ready or char_length(btrim(coalesce(note, ''))) >= 3)
);

create table public.leader_certifications (
  person_id uuid primary key references public.people (id) on delete cascade,
  as_role public.app_role not null check (as_role in ('leader', 'assistant_leader')),
  certified_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Circles: the Circle Card, and later the circle itself
-- ---------------------------------------------------------------------------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id),
  leader_id uuid not null references public.people (id) on delete cascade,
  assistant_id uuid references public.people (id) on delete set null,
  coach_id uuid references public.people (id) on delete set null,
  status public.circle_status not null default 'draft',

  -- The card
  name text check (char_length(name) between 3 and 48),
  track_id uuid references public.tracks (id),
  tribe_id uuid references public.tribes (id),
  season_goal_id uuid,
  -- Fields that came from the approved application and cannot change here
  fixed text[] not null default '{}' check (fixed <@ array['track', 'tribe', 'goal']::text[]),
  circle_type text not null default 'mixed' check (circle_type in ('mixed', 'women', 'men')),
  story text check (char_length(story) <= 300),

  -- Rhythm. Day counts from Sunday = 0. The slot is worked out from day and time.
  meeting_day smallint check (meeting_day between 0 and 6),
  meeting_time time,
  slot text check (slot in ('sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning')),
  duration_minutes smallint not null default 75 check (duration_minutes between 45 and 150),
  meeting_mode text check (meeting_mode in ('online', 'in_person')),
  zone text check (zone in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad')),
  -- General, never a home address
  place_note text check (char_length(place_note) <= 120),
  capacity smallint not null default 12 check (capacity between 4 and 12),

  -- The draft Success Picture: one line for each TCN value
  loving_god text check (char_length(loving_god) <= 200),
  loving_others text check (char_length(loving_others) <= 200),
  loving_life text check (char_length(loving_life) <= 200),

  review_note text check (char_length(review_note) <= 600),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.people (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (season_goal_id is null or tribe_id is not null),
  foreign key (season_goal_id, tribe_id) references public.season_goals (id, tribe_id),
  check (assistant_id is null or assistant_id <> leader_id),
  -- A card in front of the pastorate, or published, is complete
  check (
    status in ('draft', 'changes_requested', 'closed')
    or (
      name is not null and track_id is not null and tribe_id is not null and season_goal_id is not null
      and story is not null and meeting_day is not null and meeting_time is not null and slot is not null
      and meeting_mode is not null and zone is not null
      and loving_god is not null and loving_others is not null and loving_life is not null
    )
  )
);
create unique index circles_one_per_leader on public.circles (leader_id, season_id) where status <> 'closed';
create unique index circles_one_per_assistant on public.circles (assistant_id, season_id)
  where assistant_id is not null and status <> 'closed';
create index circles_status_idx on public.circles (status, submitted_at);
create index circles_coach_idx on public.circles (coach_id) where coach_id is not null;
create index circles_open_idx on public.circles (season_id, tribe_id) where status = 'approved';
create trigger circles_touch before update on public.circles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

create function public.is_trainee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['leader', 'assistant_leader']::public.app_role[]);
$$;

-- Which of the four slots members can choose a meeting time falls in.
-- Suggested times avoid rush hour: after 7:30pm on weeknights, Saturday morning, Sunday after service.
create function public.circle_slot_for(p_day integer, p_time time)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_day is null or p_time is null then null
    when p_day = 0 and p_time >= time '13:00' and p_time < time '18:00' then 'sunday-afternoon'
    when p_day = 0 and p_time >= time '18:00' and p_time <= time '21:30' then 'sunday-evening'
    when p_day between 1 and 5 and p_time >= time '19:30' and p_time <= time '21:30' then 'weeknight-evening'
    when p_day = 6 and p_time >= time '07:00' and p_time < time '12:00' then 'saturday-morning'
    else null
  end;
$$;

-- 0 to 1: how well two ways of leading balance each other. A structured leader
-- is best with a connecting assistant, and the reverse.
create function public.lead_complement(p_a text, p_b text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_a is null or p_b is null then 0.5
    when p_a = p_b then 0.35
    when (p_a, p_b) in (('structure', 'connection'), ('connection', 'structure'), ('teaching', 'doing'), ('doing', 'teaching')) then 1
    when (p_a, p_b) in (('structure', 'doing'), ('doing', 'structure'), ('connection', 'teaching'), ('teaching', 'connection')) then 0.75
    else 0.55
  end;
$$;

create function public.lead_label(p_style text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_style
    when 'structure' then 'structure and preparation'
    when 'connection' then 'conversation and connection'
    when 'teaching' then 'teaching and explaining'
    when 'doing' then 'doing things together'
    else null
  end;
$$;

-- Where each of the four conditions stands for one person.
create function public.certification_state(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'card', exists (select 1 from public.circles where leader_id = p_person and status = 'approved'),
    'certified', exists (select 1 from public.leader_certifications where person_id = p_person)
  );
end;
$$;

-- Certifies the person if, and only if, every condition is true. Safe to call any time.
create function public.refresh_certification(p_person uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- The Circle Card as one object, with the names a reader needs.
create function public.circle_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'name', c.name,
    'season', jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on),
    'track', case when t.id is null then null else jsonb_build_object('slug', t.slug, 'name', t.name) end,
    'tribe', case when tr.id is null then null else jsonb_build_object('slug', tr.slug, 'name', tr.name) end,
    'goal', case when g.id is null then null else jsonb_build_object('slug', g.slug, 'title', g.title) end,
    'fixed', to_jsonb(c.fixed),
    'circle_type', c.circle_type,
    'story', c.story,
    'meeting_day', c.meeting_day,
    'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
    'slot', c.slot,
    'duration_minutes', c.duration_minutes,
    'mode', c.meeting_mode,
    'zone', c.zone,
    'place_note', c.place_note,
    'capacity', c.capacity,
    'god', c.loving_god,
    'others', c.loving_others,
    'life', c.loving_life,
    'review_note', c.review_note,
    'submitted_at', c.submitted_at,
    'reviewed_at', c.reviewed_at,
    'published_at', c.published_at,
    'leader', jsonb_build_object('id', c.leader_id, 'name', public.person_display_name(c.leader_id)),
    'assistant', case when c.assistant_id is null then null
                      else jsonb_build_object('id', c.assistant_id, 'name', public.person_display_name(c.assistant_id)) end,
    'coach', case when c.coach_id is null then null
                  else jsonb_build_object('id', c.coach_id, 'name', public.person_display_name(c.coach_id)) end
  )
  from public.circles c
  join public.seasons s on s.id = c.season_id
  left join public.tracks t on t.id = c.track_id
  left join public.tribes tr on tr.id = c.tribe_id
  left join public.season_goals g on g.id = c.season_goal_id
  where c.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Training: what the person sees
-- ---------------------------------------------------------------------------

create function public.my_academy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.circles;
  prac public.practice_assessments;
  decl public.safeguarding_declarations;
  cert public.leader_certifications;
begin
  if not public.is_trainee() then
    raise exception 'The Academy is for approved leaders and assistant leaders' using errcode = '42501';
  end if;
  select * into c from public.circles where (leader_id = me or assistant_id = me) and status <> 'closed'
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
$$;

-- One module: the reading and the quiz without its key.
create function public.academy_module(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Scores a quiz here, so the score cannot be changed in the browser.
-- p_answers is a list with one chosen option (counting from zero) per question, in order.
create function public.submit_quiz(p_slug text, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.sign_safeguarding(p_version text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- Live workshops
-- ---------------------------------------------------------------------------

create function public.add_academy_session(
  p_kind text,
  p_starts timestamptz,
  p_minutes integer,
  p_mode text,
  p_place text,
  p_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can add workshops' using errcode = '42501';
  end if;
  if p_kind not in ('practice_workshop', 'commissioning_workshop') then
    raise exception 'Choose which workshop this is' using errcode = '22023';
  end if;
  if p_starts is null or p_starts < now() + interval '1 hour' then
    raise exception 'Choose a time in the future' using errcode = '22023';
  end if;
  if coalesce(p_minutes, 120) not between 30 and 300 then
    raise exception 'A workshop runs 30 minutes to 5 hours' using errcode = '22023';
  end if;
  if p_mode not in ('online', 'in_person') then
    raise exception 'Choose online or in person' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_place, ''))) < 2 or char_length(btrim(p_place)) > 200 then
    raise exception 'Say where it is, or add the meeting link' using errcode = '22023';
  end if;
  if coalesce(p_capacity, 30) not between 2 and 200 then
    raise exception 'Seats can be 2 to 200' using errcode = '22023';
  end if;
  insert into public.academy_sessions (kind, starts_at, minutes, mode, place, capacity, created_by)
  values (p_kind::public.academy_session_kind, p_starts, coalesce(p_minutes, 120), p_mode, btrim(p_place), coalesce(p_capacity, 30), auth.uid())
  returning id into sid;
  return sid;
end;
$$;

create function public.remove_academy_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can remove workshops' using errcode = '42501';
  end if;
  if exists (select 1 from public.academy_bookings where session_id = p_session) then
    raise exception 'People have booked this workshop. Ask them to cancel first' using errcode = '22023';
  end if;
  delete from public.academy_sessions where id = p_session;
  if not found then
    raise exception 'That workshop no longer exists' using errcode = '22023';
  end if;
end;
$$;

create function public.book_academy_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.cancel_academy_booking(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.academy_sessions;
begin
  select * into s from public.academy_sessions where id = p_session for update;
  if not found or not exists (select 1 from public.academy_bookings where session_id = p_session and person_id = me) then
    raise exception 'You have no booking for that workshop' using errcode = '22023';
  end if;
  if s.starts_at < now() + interval '24 hours' then
    raise exception 'Too close to the workshop to cancel here. Message the office' using errcode = '22023';
  end if;
  delete from public.academy_bookings where session_id = p_session and person_id = me;
end;
$$;

-- The register. A facilitator marks who came, once the workshop has started.
create function public.mark_attendance(p_session uuid, p_person uuid, p_attended boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.academy_sessions;
begin
  if not public.is_review_panel() then
    raise exception 'Only a coach, director or pastor can mark the register' using errcode = '42501';
  end if;
  select * into s from public.academy_sessions where id = p_session;
  if not found then
    raise exception 'That workshop no longer exists' using errcode = '22023';
  end if;
  if s.starts_at > now() then
    raise exception 'The register opens when the workshop starts' using errcode = '22023';
  end if;
  update public.academy_bookings
     set attended = p_attended, marked_by = auth.uid(), marked_at = now()
   where session_id = p_session and person_id = p_person;
  if not found then
    raise exception 'That person did not book this workshop' using errcode = '22023';
  end if;
  perform public.write_event(auth.uid(), 'academy.attendance_marked', 'academy_session', p_session::text,
    jsonb_build_object('person', p_person, 'attended', p_attended));
end;
$$;

-- Workshops for the office. Names and registers go to the panel only.
create function public.academy_sessions_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  is_panel boolean := public.is_review_panel();
begin
  if not (is_panel or public.has_any_role(array['admin']::public.app_role[])) then
    raise exception 'Only the office and the review panel can see workshops' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'kind', s.kind, 'starts_at', s.starts_at, 'minutes', s.minutes,
             'mode', s.mode, 'place', s.place, 'capacity', s.capacity,
             'booked', (select count(*) from public.academy_bookings b where b.session_id = s.id),
             'started', s.starts_at <= now(),
             'roster', case when is_panel then coalesce((
                 select jsonb_agg(jsonb_build_object('person_id', b.person_id, 'name', public.person_display_name(b.person_id),
                                                     'attended', b.attended) order by public.person_display_name(b.person_id))
                   from public.academy_bookings b where b.session_id = s.id), '[]'::jsonb)
               else '[]'::jsonb end)
           order by s.starts_at)
    from public.academy_sessions s
    where s.starts_at > now() - interval '60 days'), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The practice session and the cohort view
-- ---------------------------------------------------------------------------

create function public.record_practice(p_person uuid, p_format text, p_ready boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.academy_cohort()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see the cohort' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json_obj.obj order by row_to_json_obj.sort_name)
      from (
        select public.person_display_name(r.person_id) as sort_name,
               jsonb_build_object(
                 'person_id', r.person_id,
                 'name', public.person_display_name(r.person_id),
                 'role', case when bool_or(r.role = 'leader') then 'leader' else 'assistant_leader' end,
                 'state', public.certification_state(r.person_id),
                 'practice', (select jsonb_build_object('ready', pa.ready, 'format', pa.format, 'note', pa.note, 'assessed_at', pa.assessed_at)
                                from public.practice_assessments pa where pa.person_id = r.person_id),
                 'card', (select jsonb_build_object('id', c.id, 'status', c.status)
                            from public.circles c where c.leader_id = r.person_id and c.status <> 'closed'
                            order by c.created_at desc limit 1),
                 'workshops', jsonb_build_object(
                   'practice_workshop', (select case
                        when bool_or(b.attended is true) then 'attended'
                        when bool_or(s.starts_at > now()) then 'booked'
                        when bool_or(b.attended is false) then 'missed'
                        when count(*) > 0 then 'to_mark'
                        else null end
                      from public.academy_bookings b join public.academy_sessions s on s.id = b.session_id
                     where b.person_id = r.person_id and s.kind = 'practice_workshop'),
                   'commissioning_workshop', (select case
                        when bool_or(b.attended is true) then 'attended'
                        when bool_or(s.starts_at > now()) then 'booked'
                        when bool_or(b.attended is false) then 'missed'
                        when count(*) > 0 then 'to_mark'
                        else null end
                      from public.academy_bookings b join public.academy_sessions s on s.id = b.session_id
                     where b.person_id = r.person_id and s.kind = 'commissioning_workshop'))
               ) as obj
          from public.person_roles r
         where r.role in ('leader', 'assistant_leader')
         group by r.person_id
      ) row_to_json_obj), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The Circle Card: the leader's side
-- ---------------------------------------------------------------------------

-- Starts the card for the next season, with track, tribe and goal taken from the
-- approved application. Returns the card already in progress if there is one.
create function public.start_circle_card()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  season uuid;
  app jsonb;
  t_id uuid;
  tr_id uuid;
  g_id uuid;
  locked_fields text[] := '{}';
  first_name text;
  suggested text;
  tribe_name text;
  new_id uuid;
begin
  if not public.has_role('leader') then
    raise exception 'Circle Cards are for approved circle leaders' using errcode = '42501';
  end if;
  select id into existing from public.circles where leader_id = me and status <> 'closed' order by created_at desc limit 1;
  if existing is not null then
    return existing;
  end if;
  select id into season from public.seasons where status in ('planning', 'open') order by starts_on limit 1;
  if season is null then
    raise exception 'No season is open for Circle Cards yet. The office will open one' using errcode = '22023';
  end if;

  select a.answers into app from public.leader_applications a
   where a.person_id = me and a.status = 'approved_leader' order by a.decided_at desc nulls last limit 1;
  if app is not null then
    select id into t_id from public.tracks where slug = app #>> '{calling,track}' and active;
    select id, name into tr_id, tribe_name from public.tribes where slug = app #>> '{calling,tribe}' and active;
    if tr_id is not null then
      select id into g_id from public.season_goals where slug = app #>> '{calling,goal}' and tribe_id = tr_id and active;
    end if;
    if t_id is not null then locked_fields := array_append(locked_fields, 'track'); end if;
    if tr_id is not null then locked_fields := array_append(locked_fields, 'tribe'); end if;
    if g_id is not null then locked_fields := array_append(locked_fields, 'goal'); end if;
  end if;

  select coalesce(nullif(btrim(preferred_name), ''), split_part(btrim(coalesce(full_name, '')), ' ', 1)) into first_name
    from public.people where id = me;
  if first_name is not null and first_name <> '' and tribe_name is not null then
    suggested := first_name || '’s ' || tribe_name || ' circle';
    if char_length(suggested) > 48 then suggested := null; end if;
  end if;

  insert into public.circles (season_id, leader_id, name, track_id, tribe_id, season_goal_id, fixed)
  values (season, me, suggested, t_id, tr_id, g_id, locked_fields)
  returning id into new_id;
  perform public.write_event(me, 'circle.started', 'circle', new_id::text, '{}'::jsonb);
  return new_id;
end;
$$;

-- The leader's own card (or the assistant's circle), with what is still missing.
create function public.my_circle()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.circles;
  card jsonb;
  missing text[] := '{}';
  module_ok boolean;
begin
  select * into c from public.circles where (leader_id = me or assistant_id = me) and status <> 'closed'
    order by created_at desc limit 1;
  if not found then
    return null;
  end if;
  card := public.circle_json(c.id);
  module_ok := exists (
    select 1 from public.academy_progress p join public.academy_modules m on m.id = p.module_id
     where p.person_id = c.leader_id and m.slug = 'the-success-picture' and p.passed_at is not null);

  if c.name is null then missing := array_append(missing, 'name'); end if;
  if c.track_id is null then missing := array_append(missing, 'track'); end if;
  if c.tribe_id is null then missing := array_append(missing, 'tribe'); end if;
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
    'certified', exists (select 1 from public.leader_certifications where person_id = c.leader_id));
end;
$$;

-- Saves whichever fields are sent. Locked fields (from the application) are left alone.
create function public.save_circle_card(p_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.circles;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v text;
  n integer;
  slug_id uuid;
  new_day smallint;
  new_time time;
  new_slot text;
begin
  select * into c from public.circles where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Circle Card not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'changes_requested') then
    raise exception 'This card has been sent. It can be edited again if the pastorate asks for changes' using errcode = '22023';
  end if;

  if f ? 'name' then
    v := nullif(btrim(coalesce(f ->> 'name', '')), '');
    if v is not null and char_length(v) not between 3 and 48 then
      raise exception 'Give the circle a name of 3 to 48 characters' using errcode = '22023';
    end if;
    c.name := v;
  end if;

  if f ? 'circle_type' then
    if f ->> 'circle_type' not in ('mixed', 'women', 'men') then
      raise exception 'Choose mixed, women only or men only' using errcode = '22023';
    end if;
    c.circle_type := f ->> 'circle_type';
  end if;

  if f ? 'story' then
    v := nullif(btrim(coalesce(f ->> 'story', '')), '');
    if v is not null and char_length(v) > 300 then
      raise exception 'Keep your story to 300 characters, about two lines' using errcode = '22023';
    end if;
    c.story := v;
  end if;

  if f ? 'track' and not ('track' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'track', '')), '');
    if v is null then
      c.track_id := null;
    else
      select id into slug_id from public.tracks where slug = v and active;
      if slug_id is null then raise exception 'Choose a life-stage track from the list' using errcode = '22023'; end if;
      c.track_id := slug_id;
    end if;
  end if;

  if f ? 'tribe' and not ('tribe' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'tribe', '')), '');
    if v is null then
      c.tribe_id := null;
      c.season_goal_id := null;
    else
      select id into slug_id from public.tribes where slug = v and active;
      if slug_id is null then raise exception 'Choose a tribe from the list' using errcode = '22023'; end if;
      if slug_id is distinct from c.tribe_id then
        c.season_goal_id := null;
      end if;
      c.tribe_id := slug_id;
    end if;
  end if;

  if f ? 'goal' and not ('goal' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'goal', '')), '');
    if v is null then
      c.season_goal_id := null;
    else
      select id into slug_id from public.season_goals where slug = v and active and tribe_id = c.tribe_id;
      if slug_id is null then raise exception 'Choose a Season Goal from your tribe''s list' using errcode = '22023'; end if;
      c.season_goal_id := slug_id;
    end if;
  end if;

  if f ? 'meeting_day' then
    if f -> 'meeting_day' = 'null'::jsonb or btrim(coalesce(f ->> 'meeting_day', '')) = '' then
      c.meeting_day := null;
    else
      begin
        n := (f ->> 'meeting_day')::integer;
      exception when others then
        raise exception 'Choose the day of the week' using errcode = '22023';
      end;
      if n not between 0 and 6 then raise exception 'Choose the day of the week' using errcode = '22023'; end if;
      c.meeting_day := n;
    end if;
  end if;
  if f ? 'meeting_time' then
    v := nullif(btrim(coalesce(f ->> 'meeting_time', '')), '');
    if v is null then
      c.meeting_time := null;
    else
      begin
        c.meeting_time := v::time;
      exception when others then
        raise exception 'Choose a valid time' using errcode = '22023';
      end;
    end if;
  end if;
  new_day := c.meeting_day;
  new_time := c.meeting_time;
  if new_day is not null and new_time is not null then
    new_slot := public.circle_slot_for(new_day, new_time);
    if new_slot is null then
      raise exception 'Choose a time members can make: weeknights from 7:30pm, Saturday morning, or Sunday afternoon or evening' using errcode = '22023';
    end if;
    c.slot := new_slot;
  else
    c.slot := null;
  end if;

  if f ? 'mode' then
    v := nullif(btrim(coalesce(f ->> 'mode', '')), '');
    if v is not null and v not in ('online', 'in_person') then
      raise exception 'Choose online or in person' using errcode = '22023';
    end if;
    c.meeting_mode := v;
  end if;
  if f ? 'zone' then
    v := nullif(btrim(coalesce(f ->> 'zone', '')), '');
    if v is not null and v not in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad') then
      raise exception 'Choose a zone from the list' using errcode = '22023';
    end if;
    c.zone := v;
  end if;
  if f ? 'place_note' then
    v := nullif(btrim(coalesce(f ->> 'place_note', '')), '');
    if v is not null and char_length(v) > 120 then
      raise exception 'Keep the area note under 120 characters' using errcode = '22023';
    end if;
    c.place_note := v;
  end if;
  if f ? 'capacity' then
    begin
      n := (f ->> 'capacity')::integer;
    exception when others then
      raise exception 'Seats can be 4 to 12' using errcode = '22023';
    end;
    if n not between 4 and 12 then raise exception 'Seats can be 4 to 12' using errcode = '22023'; end if;
    c.capacity := n;
  end if;

  if f ? 'god' then
    v := nullif(btrim(coalesce(f ->> 'god', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_god := v;
  end if;
  if f ? 'others' then
    v := nullif(btrim(coalesce(f ->> 'others', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_others := v;
  end if;
  if f ? 'life' then
    v := nullif(btrim(coalesce(f ->> 'life', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_life := v;
  end if;

  update public.circles
     set name = c.name, circle_type = c.circle_type, story = c.story,
         track_id = c.track_id, tribe_id = c.tribe_id, season_goal_id = c.season_goal_id,
         meeting_day = c.meeting_day, meeting_time = c.meeting_time, slot = c.slot,
         meeting_mode = c.meeting_mode, zone = c.zone, place_note = c.place_note, capacity = c.capacity,
         loving_god = c.loving_god, loving_others = c.loving_others, loving_life = c.loving_life
   where id = p_id;
end;
$$;

create function public.submit_circle_card(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.circles;
begin
  select * into c from public.circles where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Circle Card not found' using errcode = 'P0002';
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
  if c.name is null then raise exception 'Give your circle a name' using errcode = '22023'; end if;
  if c.tribe_id is null then raise exception 'Choose your tribe' using errcode = '22023'; end if;
  if c.track_id is null then raise exception 'Choose your life-stage track' using errcode = '22023'; end if;
  if c.season_goal_id is null then raise exception 'Choose the Season Goal your circle is built around' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.story)), 0) < 40 then
    raise exception 'Tell your story with this goal in a couple of sentences (at least 40 characters)' using errcode = '22023';
  end if;
  if c.slot is null then raise exception 'Choose the day and time your circle meets' using errcode = '22023'; end if;
  if c.meeting_mode is null then raise exception 'Say whether you meet online or in person' using errcode = '22023'; end if;
  if c.zone is null then raise exception 'Choose the zone your circle is in' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_god)), 0) < 15 then raise exception 'Write the Loving God line of your Success Picture' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_others)), 0) < 15 then raise exception 'Write the Loving Others line of your Success Picture' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(c.loving_life)), 0) < 15 then raise exception 'Write the Loving Life line of your Success Picture' using errcode = '22023'; end if;

  update public.circles
     set status = 'submitted', submitted_at = now(), review_note = null
   where id = p_id;
  perform public.write_event(me, 'circle.submitted', 'circle', p_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The Circle Card: the pastorate's side
-- ---------------------------------------------------------------------------

-- Who may look at a circle: pastor and director see all; a coach sees their own.
create function public.can_oversee_circle(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['pastor', 'director']::public.app_role[])
      or exists (select 1 from public.circles c where c.id = p_circle and c.coach_id = auth.uid());
$$;

create function public.circle_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see Circle Cards' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'status', c.status, 'name', c.name,
             'leader', public.person_display_name(c.leader_id),
             'assistant', case when c.assistant_id is null then null else public.person_display_name(c.assistant_id) end,
             'coach', case when c.coach_id is null then null else public.person_display_name(c.coach_id) end,
             'tribe', tr.name, 'track', t.name, 'goal', g.title,
             'submitted_at', c.submitted_at, 'published_at', c.published_at,
             'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id))
           order by case c.status when 'submitted' then 0 when 'changes_requested' then 1 when 'approved' then 2 else 3 end,
                    c.submitted_at nulls last, c.created_at)
      from public.circles c
      left join public.tribes tr on tr.id = c.tribe_id
      left join public.tracks t on t.id = c.track_id
      left join public.season_goals g on g.id = c.season_goal_id
     where c.status in ('submitted', 'changes_requested', 'approved')
       and public.can_oversee_circle(c.id)), '[]'::jsonb);
end;
$$;

-- Ranks the assistant leaders who could be paired with this circle's leader.
create function public.suggest_assistants(p_circle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.circles;
  leader_style text;
  leader_goal_family uuid;
begin
  if not public.is_review_panel() or not public.can_oversee_circle(p_circle) then
    raise exception 'Only the panel overseeing this circle can pair an assistant' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'Circle not found' using errcode = 'P0002';
  end if;
  select a.answers #>> '{style,leadBest}' into leader_style from public.leader_applications a
   where a.person_id = c.leader_id and a.status = 'approved_leader' order by a.decided_at desc nulls last limit 1;
  select family_id into leader_goal_family from public.season_goals where id = c.season_goal_id;

  return coalesce((
    select jsonb_agg(x.obj order by x.pct desc, x.name)
      from (
        select public.person_display_name(r.person_id) as name,
               round(100 * (0.70 * public.lead_complement(leader_style, a.style)
                          + 0.15 * (case when a.track = (select slug from public.tracks where id = c.track_id) then 1 else 0.3 end)
                          + 0.15 * (case when a.tribe = (select slug from public.tribes where id = c.tribe_id) then 1
                                         when a.family = leader_goal_family then 0.6 else 0.2 end))) as pct,
               jsonb_build_object(
                 'person_id', r.person_id,
                 'name', public.person_display_name(r.person_id),
                 'style', a.style,
                 'style_label', public.lead_label(a.style),
                 'fit', round(100 * (0.70 * public.lead_complement(leader_style, a.style)
                                   + 0.15 * (case when a.track = (select slug from public.tracks where id = c.track_id) then 1 else 0.3 end)
                                   + 0.15 * (case when a.tribe = (select slug from public.tribes where id = c.tribe_id) then 1
                                                  when a.family = leader_goal_family then 0.6 else 0.2 end))),
                 'reason', case
                   when a.style is null or leader_style is null then 'Leading styles are not on file for one of you.'
                   when a.style = leader_style then 'Shares your strength in ' || public.lead_label(a.style) || ', so the circle may need variety elsewhere.'
                   else 'Brings ' || public.lead_label(a.style) || ' to your ' || public.lead_label(leader_style) || '.' end,
                 'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = r.person_id),
                 'paired_here', c.assistant_id = r.person_id) as obj
          from public.person_roles r
          left join lateral (
            select app.answers #>> '{style,leadBest}' as style,
                   app.answers #>> '{calling,track}' as track,
                   app.answers #>> '{calling,tribe}' as tribe,
                   (select sg.family_id from public.season_goals sg where sg.slug = app.answers #>> '{calling,goal}') as family
              from public.leader_applications app
             where app.person_id = r.person_id and app.status = 'approved_assistant'
             order by app.decided_at desc nulls last limit 1) a on true
         where r.role = 'assistant_leader'
           and r.person_id <> c.leader_id
           and (c.assistant_id = r.person_id
                or not exists (select 1 from public.circles o
                                where o.assistant_id = r.person_id and o.season_id = c.season_id and o.status <> 'closed'))
      ) x), '[]'::jsonb);
end;
$$;

create function public.review_circle(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.circles;
begin
  if not public.is_review_panel() or not public.can_oversee_circle(p_id) then
    raise exception 'Circle Card not found' using errcode = 'P0002';
  end if;
  select * into c from public.circles where id = p_id;
  if not found then
    raise exception 'Circle Card not found' using errcode = 'P0002';
  end if;
  return public.circle_json(p_id) || jsonb_build_object(
    'leader_state', public.certification_state(c.leader_id),
    'can_decide', public.has_any_role(array['pastor', 'director']::public.app_role[]),
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.person_id, 'name', public.person_display_name(r.person_id),
               'circles', (select count(*) from public.circles k where k.coach_id = r.person_id and k.status <> 'closed'))
             order by public.person_display_name(r.person_id))
        from public.person_roles r where r.role = 'coach'), '[]'::jsonb));
end;
$$;

create function public.decide_circle_card(p_id uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can approve a Circle Card' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'changes') then
    raise exception 'Choose approve or ask for changes' using errcode = '22023';
  end if;
  select * into c from public.circles where id = p_id for update;
  if not found or c.leader_id = auth.uid() then
    raise exception 'Circle Card not found' using errcode = 'P0002';
  end if;
  if note is not null and char_length(note) > 600 then
    raise exception 'Keep the note under 600 characters' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    if c.status <> 'submitted' then
      raise exception 'Only a card that has been sent can be approved' using errcode = '22023';
    end if;
    update public.circles
       set status = 'approved', review_note = note, reviewed_at = now(), reviewed_by = auth.uid(), published_at = now()
     where id = p_id;
    perform public.write_event(auth.uid(), 'circle.approved', 'circle', p_id::text, '{}'::jsonb);
    perform public.refresh_certification(c.leader_id);
  else
    if c.status not in ('submitted', 'approved') then
      raise exception 'There is nothing to send back' using errcode = '22023';
    end if;
    if note is null or char_length(note) < 3 then
      raise exception 'Say what to change, so the leader knows what to do' using errcode = '22023';
    end if;
    update public.circles
       set status = 'changes_requested', review_note = note, reviewed_at = now(), reviewed_by = auth.uid(), published_at = null
     where id = p_id;
    perform public.write_event(auth.uid(), 'circle.changes_requested', 'circle', p_id::text, '{}'::jsonb);
  end if;
end;
$$;

create function public.pair_assistant(p_circle uuid, p_assistant uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles;
begin
  if not public.is_review_panel() or not public.can_oversee_circle(p_circle) then
    raise exception 'Only the panel overseeing this circle can pair an assistant' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle for update;
  if not found or c.status = 'closed' then
    raise exception 'Circle not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.person_roles where person_id = p_assistant and role = 'assistant_leader') then
    raise exception 'That person is not an approved assistant leader' using errcode = '22023';
  end if;
  if p_assistant = c.leader_id then
    raise exception 'A leader cannot be their own assistant' using errcode = '22023';
  end if;
  if exists (select 1 from public.circles o
              where o.assistant_id = p_assistant and o.season_id = c.season_id and o.status <> 'closed' and o.id <> c.id) then
    raise exception 'That assistant is already paired with another circle this season' using errcode = '22023';
  end if;
  update public.circles set assistant_id = p_assistant where id = p_circle;
  perform public.write_event(auth.uid(), 'circle.assistant_paired', 'circle', p_circle::text, jsonb_build_object('assistant', p_assistant));
end;
$$;

create function public.unpair_assistant(p_circle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_review_panel() or not public.can_oversee_circle(p_circle) then
    raise exception 'Only the panel overseeing this circle can change its assistant' using errcode = '42501';
  end if;
  update public.circles set assistant_id = null where id = p_circle;
  perform public.write_event(auth.uid(), 'circle.assistant_unpaired', 'circle', p_circle::text, '{}'::jsonb);
end;
$$;

create function public.assign_coach(p_circle uuid, p_coach uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can assign a coach' using errcode = '42501';
  end if;
  if p_coach is not null and not exists (select 1 from public.person_roles where person_id = p_coach and role = 'coach') then
    raise exception 'That person is not a coach' using errcode = '22023';
  end if;
  update public.circles set coach_id = p_coach where id = p_circle and status <> 'closed';
  if not found then
    raise exception 'Circle not found' using errcode = 'P0002';
  end if;
  perform public.write_event(auth.uid(), 'circle.coach_assigned', 'circle', p_circle::text, jsonb_build_object('coach', p_coach));
end;
$$;

-- ---------------------------------------------------------------------------
-- Totals for the office (no personal details)
-- ---------------------------------------------------------------------------

create function public.academy_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see Academy totals' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'trainees', (select count(distinct person_id) from public.person_roles where role in ('leader', 'assistant_leader')),
    'leaders', (select count(*) from public.person_roles where role = 'leader'),
    'assistants', (select count(*) from public.person_roles where role = 'assistant_leader'),
    'certified', (select count(*) from public.leader_certifications),
    'certified_leaders', (select count(*) from public.leader_certifications where as_role = 'leader'),
    'certified_assistants', (select count(*) from public.leader_certifications where as_role = 'assistant_leader'),
    'practice_ready', (select count(*) from public.practice_assessments where ready),
    'declarations', (select count(distinct person_id) from public.safeguarding_declarations),
    'cards_submitted', (select count(*) from public.circles where status = 'submitted'),
    'cards_approved', (select count(*) from public.circles where status = 'approved'),
    'cards_paired', (select count(*) from public.circles where status = 'approved' and assistant_id is not null),
    'upcoming_workshops', (select count(*) from public.academy_sessions where starts_at > now()),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'number', m.number, 'title', m.title,
               'opened', (select count(*) from public.academy_progress p where p.module_id = m.id),
               'passed', (select count(*) from public.academy_progress p where p.module_id = m.id and p.passed_at is not null))
             order by m.number)
        from public.academy_modules m where m.active), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.academy_modules enable row level security;
alter table public.academy_questions enable row level security;
alter table public.academy_progress enable row level security;
alter table public.academy_attempts enable row level security;
alter table public.safeguarding_declarations enable row level security;
alter table public.academy_sessions enable row level security;
alter table public.academy_bookings enable row level security;
alter table public.practice_assessments enable row level security;
alter table public.leader_certifications enable row level security;
alter table public.circles enable row level security;

-- No grants at all on the Academy tables: only the functions touch them, so the
-- answer key, other people's scores and the registers stay closed.
-- A Circle Card is read by its leader, its assistant, its coach and the pastorate.
-- Writing goes through the functions above, which check the rules.
grant select on public.circles to authenticated;

create policy "circles: read mine and oversight" on public.circles
  for select to authenticated
  using (
    leader_id = (select auth.uid())
    or assistant_id = (select auth.uid())
    or coach_id = (select auth.uid())
    or public.has_any_role(array['pastor', 'director']::public.app_role[])
  );

-- Functions: closed by default, then opened to the people who need them.
revoke execute on function
  public.is_trainee(),
  public.circle_slot_for(integer, time),
  public.lead_complement(text, text),
  public.lead_label(text),
  public.certification_state(uuid),
  public.refresh_certification(uuid),
  public.circle_json(uuid),
  public.can_oversee_circle(uuid),
  public.my_academy(),
  public.academy_module(text),
  public.submit_quiz(text, jsonb),
  public.sign_safeguarding(text, text),
  public.add_academy_session(text, timestamptz, integer, text, text, integer),
  public.remove_academy_session(uuid),
  public.book_academy_session(uuid),
  public.cancel_academy_booking(uuid),
  public.mark_attendance(uuid, uuid, boolean),
  public.academy_sessions_admin(),
  public.record_practice(uuid, text, boolean, text),
  public.academy_cohort(),
  public.start_circle_card(),
  public.my_circle(),
  public.save_circle_card(uuid, jsonb),
  public.submit_circle_card(uuid),
  public.circle_queue(),
  public.suggest_assistants(uuid),
  public.review_circle(uuid),
  public.decide_circle_card(uuid, text, text),
  public.pair_assistant(uuid, uuid),
  public.unpair_assistant(uuid),
  public.assign_coach(uuid, uuid),
  public.academy_stats()
  from public, anon, authenticated;

grant execute on function
  public.my_academy(),
  public.academy_module(text),
  public.submit_quiz(text, jsonb),
  public.sign_safeguarding(text, text),
  public.add_academy_session(text, timestamptz, integer, text, text, integer),
  public.remove_academy_session(uuid),
  public.book_academy_session(uuid),
  public.cancel_academy_booking(uuid),
  public.mark_attendance(uuid, uuid, boolean),
  public.academy_sessions_admin(),
  public.record_practice(uuid, text, boolean, text),
  public.academy_cohort(),
  public.start_circle_card(),
  public.my_circle(),
  public.save_circle_card(uuid, jsonb),
  public.submit_circle_card(uuid),
  public.circle_queue(),
  public.suggest_assistants(uuid),
  public.review_circle(uuid),
  public.decide_circle_card(uuid, text, text),
  public.pair_assistant(uuid, uuid),
  public.unpair_assistant(uuid),
  public.assign_coach(uuid, uuid),
  public.academy_stats()
  to authenticated;

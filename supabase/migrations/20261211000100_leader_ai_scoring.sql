-- United Tribes, Round 2, Phase 1: a first score that gibberish cannot pass.
--
-- The problem. A written answer on the leader application counted once it had 20 characters of anything, and
-- two people then scored a rubric. Applicants put random words in the boxes and the system scored them anyway.
--
-- What this adds, all of it inert until a pastor or the director switches it on (Admin > Leader quality):
--
--   leader_ai_settings       the switch (off, shadow, on) and the thresholds, in one row
--   leader_ai_state          where each application stands in the first check (never readable by the applicant)
--   leader_answer_checks     what the quick check said about each version of each written answer
--   leader_answer_prints     a fingerprint of each answer, to spot the same words used twice or by two people
--   leader_ai_scores         the AI's score for the six pastorate questions, with the applicant's own words as proof
--   leader_ai_jobs           the queue the heartbeat works through
--
-- The three modes
--   off      nothing here runs and nothing changes. Every function below behaves exactly as before.
--   shadow   answers are checked and scored and everything is recorded, but nobody is held up and nobody sees it.
--   on       an answer must pass its quick check before the application can be sent; the AI's score replaces
--            the first human calling pass at the same 30% weight; referee links and interview invitations wait
--            for a clear first check.
--
-- Rules this file enforces in the database itself (the app cannot skip them by calling the API directly):
--   * In "on" mode an application cannot be sent unless each written answer has a passing check for the exact text
--     being sent. Checks are written only by the server, with the sending service's token.
--   * The AI never makes the final "no". It scores, asks for more, or holds an application for a person. Only a
--     pastor decides, as before.
--   * A person's score is never replaced by the AI's: an application a reviewer has already scored stays on people.
--   * The applicant never sees a score, a flag or the quoted evidence, only a kind note on what to add.
--   * An application whose consent pre-dates the AI wording is not sent to an AI service until the applicant
--     agrees to the new sentence (or the settings say the old wording covers it).
--   * Nothing here is ever deleted; old migrations are untouched and no existing row is changed.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.leader_ai_settings (
  id boolean primary key default true check (id),
  mode text not null default 'off' check (mode in ('off', 'shadow', 'on')),
  -- Clear needs the mean of the six scores to reach this (1 to 5)
  clear_min_score numeric(3, 1) not null default 2.5 check (clear_min_score between 1 and 5),
  -- ...and none of the five written questions to score below this
  min_question_score smallint not null default 2 check (min_question_score between 1 and 4),
  -- Below this confidence the AI's own score is not trusted and a person looks
  min_confidence numeric(3, 2) not null default 0.60 check (min_confidence between 0.30 and 0.95),
  -- Words, not characters. The app counts the same way.
  min_words smallint not null default 8 check (min_words between 5 and 40),
  -- Tries per written answer before it is let through and marked for a person
  max_step_tries smallint not null default 3 check (max_step_tries between 1 and 6),
  -- Rewrites after the application is sent, and the wait between them
  max_rewrites smallint not null default 2 check (max_rewrites between 0 and 5),
  rewrite_gap_hours smallint not null default 24 check (rewrite_gap_hours between 0 and 168),
  -- Share of clear applications a person also scores, to check the AI is behaving
  audit_pct smallint not null default 10 check (audit_pct between 0 and 100),
  -- The wording an applicant agrees to. Anything older than this has not agreed to an AI service reading the answers.
  consent_version text not null default '2026-12-l2' check (consent_version ~ '^[A-Za-z0-9._-]{1,24}$'),
  -- Set to true only once a lawyer confirms the earlier wording already covers an AI service reading the answers
  ai_consent_covers_old boolean not null default false,
  activated_at timestamptz,
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.leader_ai_settings default values;

-- ---------------------------------------------------------------------------
-- Where each application stands in the first check
-- ---------------------------------------------------------------------------

create table public.leader_ai_state (
  application_id uuid primary key references public.leader_applications (id) on delete cascade,
  -- not_applicable   the first check does not apply (people scored it, or it predates the switch)
  -- consent_needed   waiting for the applicant to agree to the new wording
  -- checking         the AI is reading it (or will be soon)
  -- clear            passed; referees and the interview can go ahead
  -- strengthen       the applicant has been asked to add more to specific answers
  -- held             a person decides what happens next
  -- cleared_by_person a pastor has looked and let it through; people score it
  state text not null default 'not_applicable'
    check (state in ('not_applicable', 'consent_needed', 'checking', 'clear', 'strengthen', 'held', 'cleared_by_person')),
  -- Who gives the calling score: the AI, or reviewers
  basis text not null default 'person' check (basis in ('person', 'ai')),
  -- A clear application a person also scores, so the AI's behaviour can be compared with theirs
  audit_sample boolean not null default false,
  rewrites_used smallint not null default 0 check (rewrites_used between 0 and 10),
  last_rewrite_at timestamptz,
  asked_person_at timestamptz,
  -- What the applicant is asked to add, per written answer
  feedback jsonb not null default '{}'::jsonb check (jsonb_typeof(feedback) = 'object'),
  cleared_by uuid references public.people (id) on delete set null,
  state_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index leader_ai_state_state_idx on public.leader_ai_state (state, state_at);

-- ---------------------------------------------------------------------------
-- What the quick check said about each version of each written answer
-- ---------------------------------------------------------------------------

create table public.leader_answer_checks (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  field text not null check (field in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles')),
  -- Hash of the text with spaces and capitals ignored. The text itself is not kept here.
  text_hash text not null check (char_length(text_hash) = 64),
  words smallint not null,
  -- Which rewrite round this was in (0 is the first time through)
  round smallint not null default 0,
  attempt smallint not null,
  -- Instant checks: length, mashing, repeats, no vowels, copied question, same text twice, same as someone else
  instant_ok boolean not null,
  reasons text[] not null default '{}',
  -- Does it answer the question that was asked? skipped when the AI was not used
  relevance text not null check (relevance in ('pass', 'fail', 'skipped')),
  -- The kind note shown to the applicant
  note text check (char_length(note) <= 300),
  ai_checked boolean not null default false,
  -- Let through only because the tries ran out; a person will read it
  forced boolean not null default false,
  -- May the applicant go on with this text?
  passes boolean not null,
  provider text check (char_length(provider) <= 24),
  model text check (char_length(model) <= 64),
  latency_ms integer check (latency_ms >= 0),
  at timestamptz not null default now(),
  unique (application_id, field, text_hash)
);
create index leader_answer_checks_recent_idx on public.leader_answer_checks (application_id, at desc);

-- ---------------------------------------------------------------------------
-- Fingerprints, to spot the same words used twice or by two people
-- ---------------------------------------------------------------------------

create table public.leader_answer_prints (
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  field text not null check (field in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles')),
  norm_hash text not null check (char_length(norm_hash) = 64),
  simhash bigint not null,
  words smallint not null,
  at timestamptz not null default now(),
  primary key (application_id, field)
);
create index leader_answer_prints_hash_idx on public.leader_answer_prints (norm_hash);

-- ---------------------------------------------------------------------------
-- The AI's scores
-- ---------------------------------------------------------------------------

create table public.leader_ai_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  run smallint not null,
  origin text not null check (origin in ('submit', 'rewrite', 'batch')),
  -- Recorded for comparison only; it changed nothing for the applicant
  shadow boolean not null,
  -- False when only the instant checks could run (no AI service, or the applicant has not agreed to it yet)
  ai_ran boolean not null,
  -- q1 to q6 of the pastorate's calling rubric, each 1 to 5
  scores jsonb check (scores is null or jsonb_typeof(scores) = 'object'),
  calling_pct numeric(5, 2),
  -- For each question, the applicant's own words that justify the score. The app has checked each quote is really in the answer.
  evidence jsonb not null default '{}'::jsonb,
  -- A short reason per question, for the panel only
  reasons jsonb not null default '{}'::jsonb,
  -- What the applicant is told to add, per written answer (only used when the outcome is strengthen)
  feedback jsonb not null default '{}'::jsonb,
  flags text[] not null default '{}',
  confidence numeric(3, 2),
  outcome text not null check (outcome in ('clear', 'strengthen', 'held', 'unscored')),
  provider text check (char_length(provider) <= 24),
  model text check (char_length(model) <= 64),
  latency_ms integer check (latency_ms >= 0),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  unique (application_id, run)
);

-- ---------------------------------------------------------------------------
-- The queue the heartbeat works through
-- ---------------------------------------------------------------------------

create table public.leader_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  origin text not null check (origin in ('submit', 'rewrite', 'batch')),
  shadow boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts smallint not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text check (char_length(last_error) <= 200),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One open job per application, however many times it is asked for
create unique index leader_ai_jobs_one_open on public.leader_ai_jobs (application_id) where status in ('queued', 'running');
create index leader_ai_jobs_due_idx on public.leader_ai_jobs (run_after) where status = 'queued';

alter table public.leader_ai_settings enable row level security;
alter table public.leader_ai_state enable row level security;
alter table public.leader_answer_checks enable row level security;
alter table public.leader_answer_prints enable row level security;
alter table public.leader_ai_scores enable row level security;
alter table public.leader_ai_jobs enable row level security;
-- No grants and no policies: only the functions below touch these tables.

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

create function public.leader_ai_cfg()
returns public.leader_ai_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.leader_ai_settings where id is true;
$$;

-- The same text with spaces and capitals ignored.
create function public.leader_text_hash(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')), 'utf8')), 'hex');
$$;

-- Words, not characters: a run of letters counts, a run of symbols does not. Yoruba, Igbo and Hausa letters count.
create function public.leader_word_count(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
    from regexp_split_to_table(btrim(coalesce(p_text, '')), '\s+') as w
   where w ~ '[A-Za-z]' or w ~ '[À-ɏḀ-ỿ]';
$$;

-- Has this applicant agreed to the wording that says an AI service reads the answers?
create function public.leader_ai_consent_ok(p_app uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.ai_consent_covers_old or a.consent_version >= c.consent_version
      from public.leader_applications a cross join public.leader_ai_settings c
     where a.id = p_app and c.id is true), false);
$$;

-- Moves an application to a new state in the first check, and says so in the log.
create function public.leader_ai_set_state(
  p_app uuid,
  p_state text,
  p_basis text default null,
  p_feedback jsonb default null,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_state text;
begin
  select state into old_state from public.leader_ai_state where application_id = p_app;
  insert into public.leader_ai_state (application_id, state, basis, feedback)
  values (p_app, p_state, coalesce(p_basis, 'person'), coalesce(p_feedback, '{}'::jsonb))
  on conflict (application_id) do update
    set state = excluded.state,
        basis = coalesce(p_basis, public.leader_ai_state.basis),
        feedback = case when p_feedback is not null then p_feedback
                        when excluded.state in ('strengthen') then public.leader_ai_state.feedback
                        else '{}'::jsonb end,
        state_at = case when public.leader_ai_state.state is distinct from excluded.state then now() else public.leader_ai_state.state_at end;
  if old_state is distinct from p_state then
    perform public.write_event(p_actor, 'leader.ai_state', 'leader_application', p_app::text,
      jsonb_build_object('from', coalesce(old_state, 'none'), 'to', p_state));
  end if;
end;
$$;

-- Queues the AI's reading of an application, unless one is already waiting.
create function public.leader_ai_enqueue(p_app uuid, p_origin text, p_shadow boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.leader_ai_jobs (application_id, origin, shadow)
  values (p_app, p_origin, p_shadow)
  -- A real request upgrades a waiting recording-only one, never the other way round.
  on conflict (application_id) where status in ('queued', 'running')
    do update set shadow = public.leader_ai_jobs.shadow and excluded.shadow;
$$;

-- What the scores and flags add up to. The AI proposes; this decides, from the thresholds in the settings.
--   held        a person decides (an integrity flag, low confidence, a poor fit, or nothing left to try)
--   strengthen  the applicant is asked to add more, while rewrites remain
--   clear       goes on to referees and the interview
--   unscored    the AI could not run
create function public.leader_ai_decide(p_scores jsonb, p_flags text[], p_confidence numeric, p_rewrites integer, p_origin text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  held_flags constant text[] := array['instruction_attempt', 'copied_or_templated', 'duplicate_of_other', 'same_in_two_answers',
                                      'unverified_evidence', 'forced_through', 'poor_fit'];
  weak_flags constant text[] := array['off_topic', 'generic_boilerplate', 'low_effort'];
  can_rewrite boolean := p_rewrites < cfg.max_rewrites;
  k text;
  q numeric;
  total numeric := 0;
  low boolean := false;
begin
  if p_flags && held_flags then
    return 'held';
  end if;
  if 'gibberish' = any (p_flags) then
    -- Someone already in the live batch gets a kind request to update their answers, not a hold.
    return case when p_origin = 'batch' and can_rewrite then 'strengthen' else 'held' end;
  end if;
  if p_scores is null then
    return 'unscored';
  end if;
  if coalesce(p_confidence, 0) < cfg.min_confidence then
    return 'held';
  end if;
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] loop
    q := (p_scores ->> k)::numeric;
    if q is null then
      return 'held';
    end if;
    total := total + q;
    if k <> 'q6' and q < cfg.min_question_score then
      low := true;
    end if;
  end loop;
  -- Whether the track, community and goal belong together is for a person to judge, not a reason to ask for a rewrite.
  if (p_scores ->> 'q6')::numeric < 2 then
    return 'held';
  end if;
  if total / 6 < cfg.clear_min_score or p_flags && weak_flags then
    low := true;
  end if;
  if low then
    return case when can_rewrite then 'strengthen' else 'held' end;
  end if;
  return 'clear';
end;
$$;

-- ---------------------------------------------------------------------------
-- Applicant: sending the application (extended)
-- ---------------------------------------------------------------------------
-- Everything before the new block is the same as before. In "on" mode each written answer must have a passing quick
-- check for the exact text being sent, and the application goes to the AI before it goes to anyone else.

create or replace function public.submit_leader_application(p_app uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- Earlier versions of an answer that was rewritten
-- ---------------------------------------------------------------------------

create table public.leader_answer_versions (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  field text not null check (field in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles')),
  -- 0 is the answer as first sent; 1 is the answer before the second rewrite, and so on
  round smallint not null,
  body text not null check (char_length(body) <= 5000),
  at timestamptz not null default now()
);
create index leader_answer_versions_app_idx on public.leader_answer_versions (application_id, field, round);
alter table public.leader_answer_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Readiness, interview invitation and referee links (extended)
-- ---------------------------------------------------------------------------

-- Same as before, except that when the AI gave the first calling score and a person has not taken over, that score
-- stands in for the first human pass at the same 30% weight. Two new keys say where the score came from.
create or replace function public.application_readiness(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
   where r.application_id = p_app;
  select count(*) into concerns
    from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
   where r.application_id = p_app and ra.concern and ra.concern_cleared_at is null;
  select coalesce(bool_or(is_pastor_or_unit_head), false) into has_head
    from public.leader_references where application_id = p_app and submitted_at is not null;

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
      'pastor_or_unit_head_referee', has_head),
    'band', case
      when readiness is null then null
      when readiness >= 75 then 'leader'
      when readiness >= 60 then 'assistant_leader'
      else 'below' end);
end;
$$;

-- Same as before, plus: when the first check is on, an application still being checked, waiting for the applicant,
-- or held for a person cannot be invited. A first check the AI passed stands in for the two reviewers' calling scores.
create or replace function public.invite_to_interview(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Same as before, plus: referee links open once the first check is clear, so referees are not asked to vouch for an
-- application that is not real.
create or replace function public.renew_referee_link(p_reference uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  secret text;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
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
    raise exception 'Links are made once the application is submitted' using errcode = '22023';
  end if;
  if cfg.mode = 'on' and exists (
       select 1 from public.leader_ai_state s
        where s.application_id = a.id and s.state in ('consent_needed', 'checking', 'strengthen', 'held')) then
    raise exception 'Your application is still being checked. Referee links open as soon as that is done' using errcode = '22023';
  end if;
  if r.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;

  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.leader_references
     set token_hash = public.referee_token_hash(secret), token_expires_at = now() + interval '30 days'
   where id = r.id;
  return secret;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal: giving up on a job, and switching the first check on for people already waiting
-- ---------------------------------------------------------------------------

-- After too many failures a person decides. The AI never leaves an application waiting forever, and never passes it.
create function public.leader_ai_job_give_up(p_job uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.leader_ai_jobs;
  st public.leader_ai_state;
begin
  select * into j from public.leader_ai_jobs where id = p_job for update;
  if not found then return; end if;
  update public.leader_ai_jobs
     set status = 'failed', last_error = left(coalesce(p_error, 'gave up'), 200), finished_at = now(), locked_until = null
   where id = p_job;
  if not j.shadow then
    select * into st from public.leader_ai_state where application_id = j.application_id;
    if st.state = 'checking' then
      perform public.leader_ai_set_state(j.application_id, 'held', 'ai', null, null);
    end if;
  end if;
end;
$$;

-- Switching on: people already waiting, with no human score yet, join the first check. Switching to shadow: every
-- application still in play is recorded once, so the thresholds can be judged on real answers before anyone is held.
create function public.leader_ai_backfill(p_mode text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  n integer := 0;
begin
  if p_mode = 'on' then
    for a in
      select x.id, x.person_id
        from public.leader_applications x
       where x.status = 'submitted'
         and not exists (select 1 from public.leader_ai_state s where s.application_id = x.id and s.state <> 'not_applicable')
         and not exists (select 1 from public.leader_reviews v where v.application_id = x.id and v.stage = 'calling')
    loop
      if public.leader_ai_consent_ok(a.id) then
        perform public.leader_ai_set_state(a.id, 'checking', 'ai', '{}'::jsonb, null);
        perform public.leader_ai_enqueue(a.id, 'batch', false);
      else
        perform public.leader_ai_set_state(a.id, 'consent_needed', 'ai', '{}'::jsonb, null);
        perform public.enqueue_message(a.person_id, 'leader_check_consent',
          jsonb_build_object('first_name', public.first_name_of(a.person_id)), null, 'ai:' || a.id || ':consent');
      end if;
      n := n + 1;
    end loop;
  elsif p_mode = 'shadow' then
    for a in
      select x.id
        from public.leader_applications x
       where x.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
         and not exists (select 1 from public.leader_ai_scores s where s.application_id = x.id)
    loop
      perform public.leader_ai_enqueue(a.id, 'batch', true);
      n := n + 1;
    end loop;
  end if;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Applicant
-- ---------------------------------------------------------------------------

-- The few settings the application screens need. Thresholds stay private.
create function public.leader_ai_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mode', cfg.mode, 'min_words', cfg.min_words, 'max_step_tries', cfg.max_step_tries,
    'max_rewrites', cfg.max_rewrites, 'rewrite_gap_hours', cfg.rewrite_gap_hours, 'consent_version', cfg.consent_version);
end;
$$;

-- What the applicant is told about the first check. Never a score, a flag or a quote.
--   none | consent_needed | checking | strengthen | with_people | clear
create function public.leader_ai_status(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  st public.leader_ai_state;
  has_state boolean;
  wait_until timestamptz;
  shown text;
  blocked boolean;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid();
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_app;
  has_state := found;
  if st.last_rewrite_at is not null then
    wait_until := st.last_rewrite_at + make_interval(hours => cfg.rewrite_gap_hours);
  end if;
  shown := case
    when not has_state or st.state = 'not_applicable' then 'none'
    when st.state = 'held' then 'with_people'
    when st.state in ('clear', 'cleared_by_person') then 'clear'
    else st.state end;
  blocked := cfg.mode = 'on' and has_state and st.state in ('consent_needed', 'checking', 'strengthen', 'held');
  return jsonb_build_object(
    'mode', cfg.mode,
    'state', shown,
    'consent_ok', public.leader_ai_consent_ok(p_app),
    'consent_version', cfg.consent_version,
    'notes', case when st.state = 'strengthen' then st.feedback else '{}'::jsonb end,
    'rewrites_left', case when has_state then greatest(cfg.max_rewrites - st.rewrites_used, 0) else 0 end,
    'can_rewrite_now', has_state and st.state = 'strengthen' and st.rewrites_used < cfg.max_rewrites
                       and (wait_until is null or wait_until <= now()),
    'next_rewrite_at', case when wait_until > now() then wait_until else null end,
    'referees_open', not blocked,
    'min_words', cfg.min_words);
end;
$$;

-- The applicant agrees to the wording that says an AI service reads the answers. Drafts and sent applications alike.
create function public.accept_leader_ai_consent(p_app uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  st public.leader_ai_state;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status in ('ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
    raise exception 'This application is closed' using errcode = '22023';
  end if;
  if a.consent_version < cfg.consent_version then
    update public.leader_applications set consent_version = cfg.consent_version where id = p_app;
    perform public.write_event(auth.uid(), 'leader.ai_consent', 'leader_application', p_app::text,
      jsonb_build_object('from', a.consent_version, 'to', cfg.consent_version));
  end if;
  select * into st from public.leader_ai_state where application_id = p_app for update;
  if found and st.state = 'consent_needed' then
    perform public.leader_ai_set_state(p_app, 'checking', 'ai', '{}'::jsonb, auth.uid());
    perform public.leader_ai_enqueue(p_app, 'batch', false);
  end if;
end;
$$;

-- After sending: replace the answers the applicant was asked to add to. Each new text must have passed its quick check.
create function public.resubmit_leader_answers(p_app uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  st public.leader_ai_state;
  k text;
  fresh text;
  old text;
  round_no integer;
  updated jsonb;
  names text[] := '{}';
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_app for update;
  if not found or st.state <> 'strengthen' then
    raise exception 'There is nothing to update right now' using errcode = '22023';
  end if;
  if st.rewrites_used >= cfg.max_rewrites then
    raise exception 'You have used your updates. A person will read your application' using errcode = '22023';
  end if;
  if st.last_rewrite_at is not null and st.last_rewrite_at + make_interval(hours => cfg.rewrite_gap_hours) > now() then
    raise exception 'Please wait a little before the next update. It opens at %',
      to_char(st.last_rewrite_at + make_interval(hours => cfg.rewrite_gap_hours), 'DD Mon HH24:MI') using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or p_answers = '{}'::jsonb then
    raise exception 'Change at least one answer' using errcode = '22023';
  end if;

  round_no := st.rewrites_used + 1;
  updated := a.answers;
  for k in select jsonb_object_keys(p_answers) loop
    if not (st.feedback ? k) then
      raise exception 'That answer was not one you were asked to add to' using errcode = '22023';
    end if;
    if jsonb_typeof(p_answers -> k) is distinct from 'string' then
      raise exception 'Answers are text' using errcode = '22023';
    end if;
    fresh := btrim(p_answers ->> k);
    old := a.answers #>> array['calling', k];
    if public.leader_text_hash(fresh) = public.leader_text_hash(old) then
      raise exception 'That answer has not changed. Add what the note asked for' using errcode = '22023';
    end if;
    if public.leader_word_count(fresh) < cfg.min_words then
      raise exception 'Please say a little more: at least % words', cfg.min_words using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.leader_answer_checks x
       where x.application_id = p_app and x.field = k and x.text_hash = public.leader_text_hash(fresh) and x.passes) then
      raise exception 'One of your answers has not had its quick check. Press Continue on each' using errcode = '22023';
    end if;
    insert into public.leader_answer_versions (application_id, field, round, body)
    values (p_app, k, round_no - 1, coalesce(old, ''));
    updated := jsonb_set(updated, array['calling', k], to_jsonb(fresh));
    names := names || k;
  end loop;

  update public.leader_applications set answers = updated where id = p_app;
  update public.leader_ai_state set rewrites_used = round_no, last_rewrite_at = now() where application_id = p_app;
  perform public.leader_ai_set_state(p_app, 'checking', 'ai', '{}'::jsonb, auth.uid());
  perform public.leader_ai_enqueue(p_app, 'rewrite', false);
  perform public.write_event(auth.uid(), 'leader.ai_rewrite', 'leader_application', p_app::text,
    jsonb_build_object('round', round_no, 'fields', to_jsonb(names)));
  return jsonb_build_object('ok', true, 'round', round_no);
end;
$$;

-- "I would like a person to read it." Always allowed while the AI is asking for more.
create function public.ask_leader_person_look(p_app uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  st public.leader_ai_state;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_app for update;
  if not found or st.state <> 'strengthen' then
    raise exception 'There is nothing to hand to a person right now' using errcode = '22023';
  end if;
  update public.leader_ai_state set asked_person_at = now() where application_id = p_app;
  perform public.leader_ai_set_state(p_app, 'held', null, null, auth.uid());
  perform public.write_event(auth.uid(), 'leader.ai_asked_person', 'leader_application', p_app::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Review panel and pastors
-- ---------------------------------------------------------------------------

-- Everything the first check knows about one application, for the review page.
-- Scores, quotes and flags are shown to the pastor and director at once. A coach sees them only after giving their own
-- calling score, so the AI's number cannot steer a person who has not yet formed a view.
create function public.leader_ai_scorecard(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  decider boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  can_see boolean;
  st public.leader_ai_state;
  has_state boolean;
  latest public.leader_ai_scores;
  has_run boolean;
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id;
  if not found or a.status in ('draft', 'ineligible') or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  can_see := decider or exists (
    select 1 from public.leader_reviews v where v.application_id = p_id and v.reviewer_id = me and v.stage = 'calling');
  select * into st from public.leader_ai_state where application_id = p_id;
  has_state := found;
  select * into latest from public.leader_ai_scores where application_id = p_id order by run desc limit 1;
  has_run := found;

  return jsonb_build_object(
    'mode', cfg.mode,
    'state', case when has_state then st.state else 'not_applicable' end,
    'basis', case when has_state then st.basis else 'person' end,
    'audit_sample', has_state and st.audit_sample,
    'asked_person', has_state and st.asked_person_at is not null,
    'rewrites_used', case when has_state then st.rewrites_used else 0 end,
    'visible', can_see,
    'can_clear', decider and has_state and st.state in ('consent_needed', 'checking', 'strengthen', 'held'),
    'can_send_back', decider and has_state and st.state in ('held', 'strengthen'),
    'run', case when has_run and can_see then jsonb_build_object(
        'run', latest.run, 'origin', latest.origin, 'shadow', latest.shadow, 'ai_ran', latest.ai_ran,
        'scores', latest.scores, 'calling_pct', latest.calling_pct, 'evidence', latest.evidence,
        'reasons', latest.reasons - 'duplicate_of', 'flags', to_jsonb(latest.flags), 'confidence', latest.confidence,
        'outcome', latest.outcome, 'model', latest.model, 'at', latest.created_at) end,
    'runs', case when decider then coalesce((
        select jsonb_agg(jsonb_build_object('run', s.run, 'origin', s.origin, 'shadow', s.shadow, 'outcome', s.outcome,
                                            'calling_pct', s.calling_pct, 'at', s.created_at) order by s.run)
          from public.leader_ai_scores s where s.application_id = p_id), '[]'::jsonb) end,
    'forced_fields', case when can_see then coalesce((
        select jsonb_agg(distinct x.field) from public.leader_answer_checks x where x.application_id = p_id and x.forced), '[]'::jsonb) end,
    'versions', case when can_see then coalesce((
        select jsonb_agg(jsonb_build_object('field', v.field, 'round', v.round, 'body', v.body, 'at', v.at) order by v.field, v.round)
          from public.leader_answer_versions v where v.application_id = p_id), '[]'::jsonb) end,
    'duplicates', case when decider and has_run then coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'applicant', public.person_display_name(o.person_id)))
          from public.leader_applications o
         where o.id::text in (select jsonb_array_elements_text(coalesce(latest.reasons -> 'duplicate_of', '[]'::jsonb)))), '[]'::jsonb) end);
end;
$$;

-- One small badge per application for the review queue.
create function public.leader_ai_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see applications' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.application_id, 'state', s.state, 'basis', s.basis, 'audit', s.audit_sample))
      from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
     where s.state <> 'not_applicable' and a.person_id <> auth.uid() and a.status not in ('draft', 'ineligible')), '[]'::jsonb);
end;
$$;

-- The held list and its siblings, paged and searchable. Pastors and the director only.
--   p_filter: held | strengthen | checking | consent_needed | clear | all
create function public.leader_ai_list(p_filter text default 'held', p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  want text[];
  f text := coalesce(p_filter, 'held');
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 50);
  off integer := greatest(coalesce(p_offset, 0), 0);
  pattern text := nullif(btrim(coalesce(p_search, '')), '');
  total integer;
  rows jsonb;
  counts jsonb;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can see this list' using errcode = '42501';
  end if;
  want := case f
    when 'held' then array['held']
    when 'strengthen' then array['strengthen']
    when 'checking' then array['checking']
    when 'consent_needed' then array['consent_needed']
    when 'clear' then array['clear', 'cleared_by_person']
    when 'all' then array['held', 'strengthen', 'checking', 'consent_needed', 'clear', 'cleared_by_person']
    else null end;
  if want is null then
    raise exception 'Unknown list' using errcode = '22023';
  end if;
  if pattern is not null then
    pattern := '%' || replace(replace(replace(pattern, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select jsonb_object_agg(k, n) into counts from (
    select case when s.state = 'cleared_by_person' then 'clear' else s.state end as k, count(*) as n
      from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
     where s.state <> 'not_applicable' and a.status not in ('draft', 'ineligible') group by 1) c;

  select count(*) into total
    from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
   where s.state = any (want) and a.status not in ('draft', 'ineligible')
     and (pattern is null or public.person_display_name(a.person_id) ilike pattern);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into rows from (
    select a.id, public.person_display_name(a.person_id) as applicant,
           a.answers #>> '{calling,track}' as track, a.answers #>> '{calling,community}' as community,
           a.status, a.submitted_at, s.state, s.basis, s.state_at, s.asked_person_at, s.rewrites_used,
           floor(extract(epoch from (now() - s.state_at)) / 86400)::integer as waiting_days,
           l.flags, l.confidence, l.calling_pct, l.outcome, l.shadow
      from public.leader_ai_state s
      join public.leader_applications a on a.id = s.application_id
      left join lateral (select z.flags, z.confidence, z.calling_pct, z.outcome, z.shadow
                           from public.leader_ai_scores z where z.application_id = a.id order by z.run desc limit 1) l on true
     where s.state = any (want) and a.status not in ('draft', 'ineligible')
       and (pattern is null or public.person_display_name(a.person_id) ilike pattern)
     order by (f = 'held' and s.asked_person_at is not null) desc,
              case when f = 'held' then extract(epoch from s.state_at) else -extract(epoch from s.state_at) end,
              a.id
     limit lim offset off) x;

  return jsonb_build_object('total', total, 'counts', coalesce(counts, '{}'::jsonb), 'rows', rows);
end;
$$;

-- The numbers behind the switch: where everyone stands, what the shadow run found, how the AI compares with people.
create function public.leader_ai_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  counts jsonb;
  shadow jsonb;
  audit jsonb;
  queue jsonb;
  usage jsonb;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can see this' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) into counts from (
    select case when s.state = 'cleared_by_person' then 'clear' else s.state end as k, count(*) as n
      from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
     where s.state <> 'not_applicable' and a.status not in ('draft', 'ineligible') group by 1) c;

  -- The newest recording-only run per application, judged against today's thresholds
  select jsonb_build_object(
           'applications', count(*),
           'would_clear', count(*) filter (where d.outcome = 'clear'),
           'would_strengthen', count(*) filter (where d.outcome = 'strengthen'),
           'would_hold', count(*) filter (where d.outcome = 'held'),
           'instant_only', count(*) filter (where not d.ai_ran))
    into shadow
    from (select distinct on (z.application_id) z.application_id, z.outcome, z.ai_ran
            from public.leader_ai_scores z where z.shadow order by z.application_id, z.run desc) d;

  -- Applications the AI cleared that a person also scored: how far apart are they?
  select jsonb_build_object('pairs', count(*), 'mean_gap', round(avg(abs(p.ai - p.people)), 1))
    into audit
    from (select (select s.calling_pct from public.leader_ai_scores s
                   where s.application_id = x.application_id and not s.shadow and s.ai_ran and s.outcome = 'clear'
                   order by s.run desc limit 1) as ai,
                 (select avg(public.rating_pct(v.scores)) from public.leader_reviews v
                   where v.application_id = x.application_id and v.stage = 'calling') as people
            from public.leader_ai_state x where x.basis = 'ai' and x.state = 'clear') p
   where p.ai is not null and p.people is not null;

  select jsonb_build_object(
           'queued', count(*) filter (where j.status = 'queued'),
           'running', count(*) filter (where j.status = 'running'),
           'failed_24h', count(*) filter (where j.status = 'failed' and j.finished_at > now() - interval '24 hours'),
           'oldest_minutes', floor(extract(epoch from (now() - min(j.created_at) filter (where j.status in ('queued', 'running') and not j.shadow))) / 60))
    into queue
    from public.leader_ai_jobs j;

  select jsonb_build_object(
           'runs_30d', count(*), 'ai_runs_30d', count(*) filter (where s.ai_ran),
           'avg_latency_ms', round(avg(s.latency_ms) filter (where s.ai_ran)),
           'input_tokens', coalesce(sum(s.input_tokens), 0), 'output_tokens', coalesce(sum(s.output_tokens), 0))
    into usage
    from public.leader_ai_scores s where s.created_at > now() - interval '30 days';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'mode', cfg.mode, 'clear_min_score', cfg.clear_min_score, 'min_question_score', cfg.min_question_score,
      'min_confidence', cfg.min_confidence, 'min_words', cfg.min_words, 'max_step_tries', cfg.max_step_tries,
      'max_rewrites', cfg.max_rewrites, 'rewrite_gap_hours', cfg.rewrite_gap_hours, 'audit_pct', cfg.audit_pct,
      'consent_version', cfg.consent_version, 'ai_consent_covers_old', cfg.ai_consent_covers_old,
      'activated_at', cfg.activated_at, 'updated_at', cfg.updated_at),
    'counts', counts, 'shadow', shadow, 'audit', audit, 'queue', queue, 'usage', usage);
end;
$$;

-- The thresholds. Pastors and the director may change them; only the director may change the consent wording settings.
create function public.leader_ai_set_settings(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can change these' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('clear_min_score', 'min_question_score', 'min_confidence', 'min_words', 'max_step_tries', 'max_rewrites',
                 'rewrite_gap_hours', 'audit_pct', 'consent_version', 'ai_consent_covers_old') then
      raise exception 'Unknown setting' using errcode = '22023';
    end if;
  end loop;
  if (p_changes ? 'consent_version' or p_changes ? 'ai_consent_covers_old')
     and not public.has_any_role(array['director']::public.app_role[]) then
    raise exception 'Only the director can change the consent wording settings' using errcode = '42501';
  end if;

  begin
    update public.leader_ai_settings set
      clear_min_score = coalesce((p_changes ->> 'clear_min_score')::numeric, clear_min_score),
      min_question_score = coalesce((p_changes ->> 'min_question_score')::smallint, min_question_score),
      min_confidence = coalesce((p_changes ->> 'min_confidence')::numeric, min_confidence),
      min_words = coalesce((p_changes ->> 'min_words')::smallint, min_words),
      max_step_tries = coalesce((p_changes ->> 'max_step_tries')::smallint, max_step_tries),
      max_rewrites = coalesce((p_changes ->> 'max_rewrites')::smallint, max_rewrites),
      rewrite_gap_hours = coalesce((p_changes ->> 'rewrite_gap_hours')::smallint, rewrite_gap_hours),
      audit_pct = coalesce((p_changes ->> 'audit_pct')::smallint, audit_pct),
      consent_version = coalesce(p_changes ->> 'consent_version', consent_version),
      ai_consent_covers_old = coalesce((p_changes ->> 'ai_consent_covers_old')::boolean, ai_consent_covers_old),
      updated_by = auth.uid(),
      updated_at = now()
    where id is true;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'One of those values is outside the allowed range' using errcode = '22023';
  end;
  perform public.write_event(auth.uid(), 'leader.ai_settings', 'leader_ai', 'settings', p_changes);
end;
$$;

-- off, shadow or on. Switching on lets everyone already waiting (with no human score yet) join the first check.
create function public.leader_ai_set_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  queued integer := 0;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can change this' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('off', 'shadow', 'on') then
    raise exception 'Choose off, shadow or on' using errcode = '22023';
  end if;
  if p_mode = cfg.mode then
    return jsonb_build_object('mode', p_mode, 'queued', 0);
  end if;
  update public.leader_ai_settings
     set mode = p_mode, updated_by = auth.uid(), updated_at = now(),
         activated_at = case when p_mode = 'on' and activated_at is null then now() else activated_at end
   where id is true;
  perform public.write_event(auth.uid(), 'leader.ai_mode', 'leader_ai', 'settings',
    jsonb_build_object('from', cfg.mode, 'to', p_mode));
  if p_mode in ('on', 'shadow') then
    queued := public.leader_ai_backfill(p_mode);
  end if;
  return jsonb_build_object('mode', p_mode, 'queued', queued);
end;
$$;

-- A pastor has read it and lets it through. From here people score it, as before.
create function public.leader_ai_clear(p_app uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- A pastor asks the applicant to add to specific answers, in the pastor's own words. Gives one more update.
create function public.leader_ai_send_back(p_app uuid, p_fields text[], p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  st public.leader_ai_state;
  note text := btrim(coalesce(p_note, ''));
  fb jsonb := '{}'::jsonb;
  f text;
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can do this' using errcode = '42501';
  end if;
  if cfg.max_rewrites = 0 then
    raise exception 'Updates are switched off in the settings' using errcode = '22023';
  end if;
  if char_length(note) < 10 then
    raise exception 'Say what you would like them to add, in a sentence or two' using errcode = '22023';
  end if;
  if p_fields is null or cardinality(p_fields) = 0 then
    raise exception 'Choose at least one answer' using errcode = '22023';
  end if;
  foreach f in array p_fields loop
    if f not in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles') then
      raise exception 'Unknown answer' using errcode = '22023';
    end if;
    fb := fb || jsonb_build_object(f, left(note, 300));
  end loop;
  select * into a from public.leader_applications where id = p_app for update;
  if not found or a.person_id = auth.uid() or a.status <> 'submitted' then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into st from public.leader_ai_state where application_id = p_app for update;
  if not found or st.state not in ('held', 'strengthen') then
    raise exception 'This application is not on hold' using errcode = '22023';
  end if;
  update public.leader_ai_state
     set rewrites_used = least(rewrites_used, cfg.max_rewrites - 1), last_rewrite_at = null, asked_person_at = null
   where application_id = p_app;
  perform public.leader_ai_set_state(p_app, 'strengthen', 'ai', fb, auth.uid());
  perform public.enqueue_message(a.person_id, 'leader_check_strengthen',
    jsonb_build_object('first_name', public.first_name_of(a.person_id), 'count', cardinality(p_fields)), null,
    'ai:' || p_app || ':sendback:' || floor(extract(epoch from now()))::text);
  perform public.write_event(auth.uid(), 'leader.ai_sent_back', 'leader_application', p_app::text,
    jsonb_build_object('fields', to_jsonb(p_fields)));
end;
$$;

-- ---------------------------------------------------------------------------
-- The sending service (the heartbeat and the apply screens' server side)
-- Every function here checks the worker token first. None can be used by an applicant, who cannot write their own
-- passing check or score.
-- ---------------------------------------------------------------------------

-- What the server needs to know before it checks one written answer, and the earlier result for the same text.
create function public.worker_leader_check_state(p_token text, p_app uuid, p_field text, p_text text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  a public.leader_applications;
  st public.leader_ai_state;
  has_state boolean;
  round_no integer;
  cached public.leader_answer_checks;
  has_cached boolean;
  tries integer;
  recent integer;
begin
  perform public.worker_ok(p_token);
  if p_field is null or p_field not in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles') then
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  select * into a from public.leader_applications where id = p_app;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if cfg.mode <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select * into st from public.leader_ai_state where application_id = p_app;
  has_state := found;
  if a.status = 'draft' then
    round_no := 0;
  elsif has_state and st.state = 'strengthen' then
    if not (st.feedback ? p_field) then
      return jsonb_build_object('ok', false, 'reason', 'not_asked');
    end if;
    round_no := st.rewrites_used + 1;
  else
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if not public.leader_ai_consent_ok(p_app) then
    return jsonb_build_object('ok', false, 'reason', 'consent');
  end if;

  select * into cached from public.leader_answer_checks
   where application_id = p_app and field = p_field and text_hash = public.leader_text_hash(p_text);
  has_cached := found;
  select count(*) into tries from public.leader_answer_checks where application_id = p_app and field = p_field and round = round_no;
  select count(*) into recent from public.leader_answer_checks where application_id = p_app and at > now() - interval '24 hours';

  return jsonb_build_object(
    'ok', true, 'round', round_no, 'attempt', tries + 1, 'max_tries', cfg.max_step_tries, 'min_words', cfg.min_words,
    -- Forty different versions in a day is someone probing, not writing
    'rate_limited', recent >= 40 and not has_cached,
    'cached', case when has_cached then jsonb_build_object(
      'passes', cached.passes, 'forced', cached.forced, 'note', cached.note, 'reasons', to_jsonb(cached.reasons),
      'attempt', cached.attempt, 'tries_left', greatest(cfg.max_step_tries - cached.attempt, 0)) end);
end;
$$;

-- Records the quick check of one version of one answer, and decides whether the applicant may go on with it.
-- The same text is only ever recorded once; asking again returns the first result.
create function public.worker_record_answer_check(
  p_token text,
  p_app uuid,
  p_field text,
  p_text text,
  p_instant_ok boolean,
  p_reasons text[],
  p_relevance text,
  p_note text,
  p_ai_checked boolean,
  p_provider text,
  p_model text,
  p_latency integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  a public.leader_applications;
  st public.leader_ai_state;
  round_no integer;
  hash text := public.leader_text_hash(p_text);
  n_words integer := public.leader_word_count(p_text);
  existing public.leader_answer_checks;
  attempt_no integer;
  ok boolean := coalesce(p_instant_ok, false);
  reasons text[];
  passes boolean;
  forced boolean := false;
begin
  perform public.worker_ok(p_token);
  if p_field is null or p_field not in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles') then
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  if p_relevance is null or p_relevance not in ('pass', 'fail', 'skipped') then
    raise exception 'Unknown relevance result' using errcode = '22023';
  end if;
  select * into a from public.leader_applications where id = p_app;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status = 'draft' then
    round_no := 0;
  else
    select * into st from public.leader_ai_state where application_id = p_app;
    if not found or st.state <> 'strengthen' then
      raise exception 'This application is not open for changes' using errcode = '22023';
    end if;
    round_no := st.rewrites_used + 1;
  end if;

  select * into existing from public.leader_answer_checks where application_id = p_app and field = p_field and text_hash = hash;
  if found then
    return jsonb_build_object('passes', existing.passes, 'forced', existing.forced, 'attempt', existing.attempt,
      'tries_left', greatest(cfg.max_step_tries - existing.attempt, 0), 'note', existing.note);
  end if;

  reasons := array(select left(r, 40) from unnest(coalesce(p_reasons, '{}'::text[])) as r limit 12);
  if n_words < cfg.min_words then
    ok := false;
    if not ('too_short' = any (reasons)) then
      reasons := array_append(reasons, 'too_short');
    end if;
  end if;
  select count(*) + 1 into attempt_no from public.leader_answer_checks
   where application_id = p_app and field = p_field and round = round_no;

  if n_words < cfg.min_words then
    passes := false;
  elsif ok and p_relevance <> 'fail' then
    passes := true;
  elsif attempt_no >= cfg.max_step_tries then
    -- Fairness valve: a real answer our checks cannot read (Pidgin, Yoruba, a short testimony) is let through after a few
    -- tries. It is marked, and a person reads it before anything else happens.
    passes := true;
    forced := true;
  else
    passes := false;
  end if;

  insert into public.leader_answer_checks
    (application_id, field, text_hash, words, round, attempt, instant_ok, reasons, relevance, note, ai_checked, forced, passes,
     provider, model, latency_ms)
  values
    (p_app, p_field, hash, least(n_words, 32000), round_no, attempt_no, ok, reasons, p_relevance, left(p_note, 300),
     coalesce(p_ai_checked, false), forced, passes, left(p_provider, 24), left(p_model, 64), greatest(p_latency, 0));

  return jsonb_build_object('passes', passes, 'forced', forced, 'attempt', attempt_no,
    'tries_left', greatest(cfg.max_step_tries - attempt_no, 0), 'note', left(p_note, 300));
end;
$$;

-- Stores the fingerprint of one answer and says whether the same words appear in another answer here, or from someone else.
create function public.worker_leader_print(p_token text, p_app uuid, p_field text, p_norm_hash text, p_simhash bigint, p_words integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  same_own text[];
  others uuid[];
begin
  perform public.worker_ok(p_token);
  if p_field is null or p_field not in ('goalStory', 'why', 'walked', 'walkNote', 'obstacles') then
    raise exception 'Unknown answer' using errcode = '22023';
  end if;
  if p_norm_hash is null or char_length(p_norm_hash) <> 64 then
    raise exception 'Bad fingerprint' using errcode = '22023';
  end if;
  select person_id into owner from public.leader_applications where id = p_app;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  insert into public.leader_answer_prints (application_id, field, norm_hash, simhash, words)
  values (p_app, p_field, p_norm_hash, p_simhash, least(greatest(p_words, 0), 32000))
  on conflict (application_id, field) do update
    set norm_hash = excluded.norm_hash, simhash = excluded.simhash, words = excluded.words, at = now();

  select array_agg(distinct x.field) into same_own
    from public.leader_answer_prints x
   where x.application_id = p_app and x.field <> p_field and x.norm_hash = p_norm_hash and p_words >= 8;

  -- The same words, or nearly (a few words swapped), in someone else's application. Short answers (under 12 words) never count.
  -- Two unrelated texts differ in about 32 of the 64 bits; twelve or fewer is a copy with a few words changed.
  select array_agg(distinct o.application_id) into others
    from public.leader_answer_prints o join public.leader_applications oa on oa.id = o.application_id
   where o.application_id <> p_app and oa.person_id <> owner and p_words >= 12 and o.words >= 12
     and (o.norm_hash = p_norm_hash or bit_count((o.simhash # p_simhash)::bit(64)) <= 12);

  return jsonb_build_object('same_in_own', coalesce(to_jsonb(same_own), '[]'::jsonb),
                            'other_apps', coalesce(to_jsonb(others[1:5]), '[]'::jsonb));
end;
$$;

-- Hands the heartbeat the applications waiting for the AI's reading, oldest first. Nothing is handed out while the switch is off.
create function public.worker_pending_leader_jobs(p_token text, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.leader_ai_settings := public.leader_ai_cfg();
  j public.leader_ai_jobs;
  a public.leader_applications;
  st public.leader_ai_state;
  out jsonb := '[]'::jsonb;
begin
  perform public.worker_ok(p_token);
  if cfg.mode = 'off' then
    return out;
  end if;
  for j in
    select * from public.leader_ai_jobs x
     where (x.status = 'queued' and x.run_after <= now()) or (x.status = 'running' and x.locked_until < now())
     order by x.shadow, x.run_after
     limit least(greatest(coalesce(p_limit, 5), 1), 20)
     for update skip locked
  loop
    if j.attempts >= 10 then
      perform public.leader_ai_job_give_up(j.id, 'gave up after repeated failures');
      continue;
    end if;
    select * into a from public.leader_applications where id = j.application_id;
    if not found or a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
      update public.leader_ai_jobs set status = 'done', finished_at = now(), locked_until = null, last_error = 'application closed' where id = j.id;
      continue;
    end if;
    select * into st from public.leader_ai_state where application_id = a.id;
    update public.leader_ai_jobs set status = 'running', attempts = attempts + 1, locked_until = now() + interval '4 minutes' where id = j.id;
    out := out || jsonb_build_object(
      'job', j.id, 'application', a.id, 'origin', j.origin, 'shadow', j.shadow, 'attempts', j.attempts + 1,
      'ai_allowed', public.leader_ai_consent_ok(a.id),
      'min_words', cfg.min_words,
      -- Answers that were let through after the last try, for the text as it stands now
      'forced_fields', coalesce((
        select jsonb_agg(distinct x.field) from public.leader_answer_checks x
         where x.application_id = a.id and x.forced and x.text_hash = public.leader_text_hash(a.answers #>> array['calling', x.field])), '[]'::jsonb),
      'rewrites_used', coalesce(st.rewrites_used, 0),
      'run', coalesce((select max(s.run) from public.leader_ai_scores s where s.application_id = a.id), 0) + 1,
      'track', a.answers #>> '{calling,track}',
      'track_name', (select t.name from public.tracks t where t.slug = a.answers #>> '{calling,track}'),
      'community_name', (select c.name from public.communities c where c.slug = a.answers #>> '{calling,community}'),
      'goal_title', coalesce((select g.title from public.season_goals g where g.slug = a.answers #>> '{calling,goal}'),
                             nullif(btrim(a.answers #>> '{calling,goalOther}'), '')),
      'goal_relation', a.answers #>> '{calling,goalRelation}',
      'walk_rating', a.answers #>> '{calling,walkRating}',
      'answers', jsonb_build_object(
        'goalStory', a.answers #>> '{calling,goalStory}', 'why', a.answers #>> '{calling,why}',
        'walked', a.answers #>> '{calling,walked}', 'walkNote', a.answers #>> '{calling,walkNote}',
        'obstacles', a.answers #>> '{calling,obstacles}'));
  end loop;
  return out;
end;
$$;

-- Saves the AI's reading of one application, works out what it means from the thresholds, and moves the application on.
-- p_result: { ai_ran, scores {q1..q6}, evidence, reasons, feedback {field: note}, flags [], confidence, provider, model,
--             latency_ms, input_tokens, output_tokens }
create function public.worker_save_leader_ai_score(p_token text, p_job uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    perform public.enqueue_message(a.person_id, 'leader_check_clear',
      jsonb_build_object('first_name', public.first_name_of(a.person_id)), null, 'ai:' || a.id || ':clear:' || run_no);
  elsif outcome = 'strengthen' then
    perform public.enqueue_message(a.person_id, 'leader_check_strengthen',
      jsonb_build_object('first_name', public.first_name_of(a.person_id), 'count', (select count(*) from jsonb_object_keys(fb))), null,
      'ai:' || a.id || ':strengthen:' || run_no);
  end if;
  return jsonb_build_object('ok', true, 'outcome', outcome, 'state', new_state);
end;
$$;

-- The AI could not be reached or gave an unusable answer: try again later, and after enough tries a person decides.
create function public.worker_fail_leader_job(p_token text, p_job uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.leader_ai_jobs;
begin
  perform public.worker_ok(p_token);
  select * into j from public.leader_ai_jobs where id = p_job for update;
  if not found or j.status not in ('queued', 'running') then
    return;
  end if;
  if j.attempts >= 10 then
    perform public.leader_ai_job_give_up(j.id, p_error);
    return;
  end if;
  update public.leader_ai_jobs
     set status = 'queued', locked_until = null, last_error = left(coalesce(p_error, 'failed'), 200),
         run_after = now() + make_interval(mins => least(j.attempts * 5, 60))
   where id = j.id;
end;
$$;

-- Applications that have waited too long for a reading, so whoever watches the heartbeat hears of it.
create function public.worker_leader_ai_alerts(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return (select jsonb_build_object(
    'stuck', count(*) filter (where not j.shadow and j.status in ('queued', 'running') and j.created_at < now() - interval '1 hour'),
    'failed_24h', count(*) filter (where not j.shadow and j.status = 'failed' and j.finished_at > now() - interval '24 hours'))
    from public.leader_ai_jobs j);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

alter table public.leader_answer_versions enable row level security;

revoke execute on function
  public.leader_ai_cfg(),
  public.leader_text_hash(text),
  public.leader_word_count(text),
  public.leader_ai_consent_ok(uuid),
  public.leader_ai_set_state(uuid, text, text, jsonb, uuid),
  public.leader_ai_enqueue(uuid, text, boolean),
  public.leader_ai_decide(jsonb, text[], numeric, integer, text),
  public.leader_ai_job_give_up(uuid, text),
  public.leader_ai_backfill(text),
  public.leader_ai_public_config(),
  public.leader_ai_status(uuid),
  public.accept_leader_ai_consent(uuid),
  public.resubmit_leader_answers(uuid, jsonb),
  public.ask_leader_person_look(uuid),
  public.leader_ai_scorecard(uuid),
  public.leader_ai_queue(),
  public.leader_ai_list(text, text, integer, integer),
  public.leader_ai_overview(),
  public.leader_ai_set_settings(jsonb),
  public.leader_ai_set_mode(text),
  public.leader_ai_clear(uuid, text),
  public.leader_ai_send_back(uuid, text[], text),
  public.worker_leader_check_state(text, uuid, text, text),
  public.worker_record_answer_check(text, uuid, text, text, boolean, text[], text, text, boolean, text, text, integer),
  public.worker_leader_print(text, uuid, text, text, bigint, integer),
  public.worker_pending_leader_jobs(text, integer),
  public.worker_save_leader_ai_score(text, uuid, jsonb),
  public.worker_fail_leader_job(text, uuid, text),
  public.worker_leader_ai_alerts(text)
  from public, anon, authenticated;

grant execute on function
  public.leader_ai_public_config(),
  public.leader_ai_status(uuid),
  public.accept_leader_ai_consent(uuid),
  public.resubmit_leader_answers(uuid, jsonb),
  public.ask_leader_person_look(uuid),
  public.leader_ai_scorecard(uuid),
  public.leader_ai_queue(),
  public.leader_ai_list(text, text, integer, integer),
  public.leader_ai_overview(),
  public.leader_ai_set_settings(jsonb),
  public.leader_ai_set_mode(text),
  public.leader_ai_clear(uuid, text),
  public.leader_ai_send_back(uuid, text[], text)
  to authenticated;

-- The sending service signs in with the public key and proves itself with the token, as the other worker functions do.
grant execute on function
  public.worker_leader_check_state(text, uuid, text, text),
  public.worker_record_answer_check(text, uuid, text, text, boolean, text[], text, text, boolean, text, text, integer),
  public.worker_leader_print(text, uuid, text, text, bigint, integer),
  public.worker_pending_leader_jobs(text, integer),
  public.worker_save_leader_ai_score(text, uuid, jsonb),
  public.worker_fail_leader_job(text, uuid, text),
  public.worker_leader_ai_alerts(text)
  to anon, authenticated;

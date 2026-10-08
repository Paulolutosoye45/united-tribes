-- United Tribes, Phase 2: the Leader Portal.
--
-- Leaders are chosen on character, reliability and a lived connection to a
-- Season Goal. Six stages, most scored by the system, people deciding only at
-- the interview and the final approval:
--   1 Eligibility   seven yes/no checks, instant
--   2 Calling       six written questions, scored by two reviewers on a rubric
--   3 Scenarios     six situations, best and worst response, scored against a key
--   4 Style         the member style pairs plus how the person leads (pairing aid)
--   5 References    two referees, answering by private link, no sign-in
--   6 Interview     twenty minutes, two panelists, five set questions
--
-- What this adds
--   leader_applications        one open application per person (the applicant sees their own)
--   leader_references          who the two referees are, and whether they have answered
--   leader_reference_answers   what referees said (the panel only, never the applicant)
--   leader_assessments         the scenario score, computed in the database
--   leader_reviews             rubric scores by reviewers and interview panelists
--   scenario_keys              the answer key, readable by no one except the functions below
--   interview_slots            interview times, booked one applicant at a time
--
-- Rules this file enforces in the database itself:
--   * An applicant sees only their own application. They never see scores,
--     referee ratings, reviewer notes or the answer key.
--   * Scores are computed here, not in the browser, so they cannot be edited.
--   * Reviewers (pastor, director, coach) read applications only through
--     functions, never their own, and see a colleague's scores only after
--     submitting their own for that stage.
--   * Only a pastor decides. A leader needs a readiness score of 75 or more,
--     an assistant leader 60 or more, and both need a declared Season Goal and
--     a clean reference check. Approval grants the role in the same step.
--   * Referee links hold a random secret; only its hash is stored, and each
--     link works once.
--   * An interview seat can be booked by only one person.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.application_status as enum (
  'draft',
  'ineligible',
  'submitted',
  'interview_invited',
  'interview_booked',
  'interviewed',
  'approved_leader',
  'approved_assistant',
  'not_approved'
);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

create table public.leader_applications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  status public.application_status not null default 'draft',
  -- Where to resume
  step text not null default 'welcome' check (step ~ '^[a-z0-9-]{1,24}$'),
  -- Everything the applicant typed or tapped, validated again on submit
  answers jsonb not null default '{}'::jsonb check (octet_length(answers::text) <= 40000),
  -- Eligibility checks answered "no", so the applicant can be pointed elsewhere
  failed_checks text[] not null default '{}',
  consent_version text not null check (consent_version ~ '^[A-Za-z0-9._-]{1,24}$'),
  consented_at timestamptz not null default now(),
  -- A short, kind note the applicant can read with the decision
  decision_note text check (char_length(decision_note) <= 600),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leader_applications_one_open on public.leader_applications (person_id)
  where status in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed');
create index leader_applications_status_idx on public.leader_applications (status, submitted_at);
create trigger leader_applications_touch before update on public.leader_applications
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Referees
-- ---------------------------------------------------------------------------

create table public.leader_references (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  referee_name text not null check (char_length(referee_name) between 2 and 80),
  relationship text not null check (char_length(relationship) between 2 and 80),
  contact text not null check (char_length(contact) between 5 and 120),
  is_pastor_or_unit_head boolean not null default false,
  -- Only the hash of the link's secret is kept. A link no one has seen is not guessable.
  token_hash text not null unique,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (application_id, slot)
);

create table public.leader_reference_answers (
  reference_id uuid primary key references public.leader_references (id) on delete cascade,
  reliability smallint not null check (reliability between 1 and 5),
  warmth smallint not null check (warmth between 1 and 5),
  confidentiality smallint not null check (confidentiality between 1 and 5),
  maturity smallint not null check (maturity between 1 and 5),
  concern boolean not null,
  concern_note text check (char_length(concern_note) <= 600),
  -- A pastor who has followed up a concern can clear it, with a note
  concern_cleared_by uuid references public.people (id) on delete set null,
  concern_cleared_at timestamptz,
  concern_cleared_note text check (char_length(concern_cleared_note) <= 600),
  check (not concern or char_length(btrim(coalesce(concern_note, ''))) >= 3)
);

-- ---------------------------------------------------------------------------
-- Scores and reviews
-- ---------------------------------------------------------------------------

create table public.leader_assessments (
  application_id uuid primary key references public.leader_applications (id) on delete cascade,
  scenario_pct numeric(5, 2) not null check (scenario_pct between 0 and 100),
  scenario_detail jsonb not null default '[]'::jsonb,
  scored_at timestamptz not null default now()
);

create table public.leader_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  reviewer_id uuid references public.people (id) on delete set null,
  stage text not null check (stage in ('calling', 'interview')),
  -- Question id to a 1 to 5 rating
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index leader_reviews_one on public.leader_reviews (application_id, reviewer_id, stage);
create trigger leader_reviews_touch before update on public.leader_reviews
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The scenario answer key
-- ---------------------------------------------------------------------------
-- How effective each response is, from 1 (harmful) to 4 (what a wise leader
-- does). The pastorate signs this off before it is used with real applicants.
-- The scenario wording lives in the app; only the key lives here, and no one
-- can read it through the API.

create table public.scenario_keys (
  scenario_id text not null check (scenario_id ~ '^s[0-9]{1,2}$'),
  option_id text not null check (option_id ~ '^[a-d]$'),
  rating smallint not null check (rating between 1 and 4),
  primary key (scenario_id, option_id)
);

insert into public.scenario_keys (scenario_id, option_id, rating) values
  ('s1', 'a', 2), ('s1', 'b', 4), ('s1', 'c', 3), ('s1', 'd', 1),
  ('s2', 'a', 2), ('s2', 'b', 4), ('s2', 'c', 1), ('s2', 'd', 3),
  ('s3', 'a', 4), ('s3', 'b', 2), ('s3', 'c', 3), ('s3', 'd', 1),
  ('s4', 'a', 4), ('s4', 'b', 2), ('s4', 'c', 1), ('s4', 'd', 3),
  ('s5', 'a', 4), ('s5', 'b', 1), ('s5', 'c', 3), ('s5', 'd', 2),
  ('s6', 'a', 4), ('s6', 'b', 2), ('s6', 'c', 1), ('s6', 'd', 2);

-- ---------------------------------------------------------------------------
-- Interview times
-- ---------------------------------------------------------------------------

create table public.interview_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  minutes smallint not null default 20 check (minutes between 10 and 120),
  mode text not null check (mode in ('online', 'in_person')),
  place text not null check (char_length(place) between 2 and 200),
  panel text check (char_length(panel) <= 200),
  created_by uuid references public.people (id) on delete set null,
  -- A seat has at most one applicant. Deleting an application frees its seat.
  application_id uuid unique references public.leader_applications (id) on delete set null,
  booked_at timestamptz,
  created_at timestamptz not null default now()
);
create index interview_slots_start_idx on public.interview_slots (starts_at);

-- ---------------------------------------------------------------------------
-- Helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

create function public.is_review_panel()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['pastor', 'director', 'coach']::public.app_role[]);
$$;

create function public.referee_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
$$;

create function public.person_display_name(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- The panel needs the full name: a first name alone is ambiguous in a congregation of thousands.
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), split_part(p.email, '@', 1))
  from public.people p where p.id = p_person;
$$;

-- Mean of the ratings in a scores object, as a percentage of the top score.
create function public.rating_pct(p_scores jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when count(*) = 0 then null else round(avg(value::numeric) / 5 * 100, 2) end
  from jsonb_each_text(p_scores);
$$;

-- The Leader Readiness Score and the gates, for one application.
-- Calling and interview need two reviewers each; references need both referees.
create function public.application_readiness(p_app uuid)
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
    'calling', round(calling, 1), 'calling_reviews', calling_n,
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

-- ---------------------------------------------------------------------------
-- Applicant: eligibility, referees, submit
-- ---------------------------------------------------------------------------

create function public.check_leader_eligibility(p_app uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Adds or replaces one of the two referees. The link itself is made later.
create function public.set_referee(
  p_app uuid,
  p_slot integer,
  p_name text,
  p_relationship text,
  p_contact text,
  p_head boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  existing public.leader_references;
  rid uuid;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status not in ('draft', 'submitted', 'interview_invited') then
    raise exception 'Referees can no longer be changed' using errcode = '22023';
  end if;
  if p_slot not in (1, 2) then
    raise exception 'A referee is slot 1 or 2' using errcode = '22023';
  end if;

  select * into existing from public.leader_references where application_id = p_app and slot = p_slot;
  if found and existing.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;

  if found then
    update public.leader_references
       set referee_name = btrim(p_name), relationship = btrim(p_relationship), contact = btrim(p_contact),
           is_pastor_or_unit_head = coalesce(p_head, false),
           -- Changing who the referee is makes any old link useless
           token_hash = public.referee_token_hash(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
           token_expires_at = now() + interval '30 days'
     where id = existing.id
     returning id into rid;
  else
    insert into public.leader_references
      (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at)
    values
      (p_app, p_slot, btrim(p_name), btrim(p_relationship), btrim(p_contact), coalesce(p_head, false),
       public.referee_token_hash(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
       now() + interval '30 days')
    returning id into rid;
  end if;
  return rid;
end;
$$;

-- Makes a fresh private link for a referee who has not answered. The secret
-- is returned once and never stored, so a lost link is replaced, not recovered.
create function public.renew_referee_link(p_reference uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  secret text;
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

create function public.submit_leader_application(p_app uuid)
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
  if nullif(btrim(c ->> 'track'), '') is null or nullif(btrim(c ->> 'tribe'), '') is null then
    raise exception 'Choose your track and tribe' using errcode = '22023';
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

  insert into public.leader_assessments (application_id, scenario_pct, scenario_detail)
  values (p_app, round(total / (select count(distinct scenario_id) from public.scenario_keys) * 100, 2), detail)
  on conflict (application_id) do update
    set scenario_pct = excluded.scenario_pct, scenario_detail = excluded.scenario_detail, scored_at = now();

  update public.leader_applications set status = 'submitted', step = 'done', submitted_at = now() where id = p_app;
  perform public.write_event(auth.uid(), 'leader.applied', 'leader_application', p_app::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Referees answer by link (no sign-in)
-- ---------------------------------------------------------------------------

create function public.get_reference_request(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
begin
  select * into r from public.leader_references where token_hash = public.referee_token_hash(p_token);
  if not found then return null; end if;
  select * into a from public.leader_applications where id = r.application_id;
  return jsonb_build_object(
    'applicant', public.person_display_name(a.person_id),
    'referee', r.referee_name,
    'relationship', r.relationship,
    'answered', r.submitted_at is not null,
    'expired', r.token_expires_at < now(),
    'closed', a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved'));
end;
$$;

create function public.submit_reference(
  p_token text,
  p_reliability integer,
  p_warmth integer,
  p_confidentiality integer,
  p_maturity integer,
  p_concern boolean,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
begin
  select * into r from public.leader_references
   where token_hash = public.referee_token_hash(p_token) for update;
  if not found then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  if r.submitted_at is not null then
    raise exception 'This reference was already sent' using errcode = '22023';
  end if;
  if r.token_expires_at < now() then
    raise exception 'This link has expired. Ask the applicant for a new one' using errcode = '22023';
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  if a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
    raise exception 'This reference is no longer needed' using errcode = '22023';
  end if;

  insert into public.leader_reference_answers
    (reference_id, reliability, warmth, confidentiality, maturity, concern, concern_note)
  values
    (r.id, p_reliability, p_warmth, p_confidentiality, p_maturity, coalesce(p_concern, false),
     nullif(btrim(coalesce(p_note, '')), ''));
  -- Answering spends the link: it is refused once submitted_at is set
  update public.leader_references set submitted_at = now() where id = r.id;
  perform public.write_event(null, 'leader.reference_received', 'leader_application', r.application_id::text,
    jsonb_build_object('concern', coalesce(p_concern, false)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewers
-- ---------------------------------------------------------------------------

create function public.review_queue()
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
    select jsonb_agg(row_to_json(x)::jsonb order by x.submitted_at desc nulls last)
    from (
      select a.id,
             a.status,
             public.person_display_name(a.person_id) as applicant,
             a.answers #>> '{calling,track}' as track,
             a.answers #>> '{calling,tribe}' as tribe,
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
$$;

create function public.review_application(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'tribe_name', (select t.name from public.tribes t where t.slug = a.answers #>> '{calling,tribe}'),
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
    'decided_at', a.decided_at);
end;
$$;

-- Rubric scores for one stage. Calling uses q1 to q6, interview q1 to q5.
create function public.save_review(p_id uuid, p_stage text, p_scores jsonb, p_notes text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  me uuid := auth.uid();
  expected text[];
  k text;
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can score applications' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id for update;
  if not found or a.person_id = me then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;

  if p_stage = 'calling' then
    expected := array['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];
    if a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
      raise exception 'This application is not open for scoring' using errcode = '22023';
    end if;
  elsif p_stage = 'interview' then
    expected := array['q1', 'q2', 'q3', 'q4', 'q5'];
    if a.status not in ('interview_booked', 'interviewed') then
      raise exception 'The interview is scored once it is booked' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown stage' using errcode = '22023';
  end if;

  if jsonb_typeof(p_scores) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_scores)) <> cardinality(expected) then
    raise exception 'Score every question' using errcode = '22023';
  end if;
  foreach k in array expected loop
    if jsonb_typeof(p_scores -> k) is distinct from 'number' or (p_scores ->> k) !~ '^[1-5]$' then
      raise exception 'Scores run from 1 to 5' using errcode = '22023';
    end if;
  end loop;

  insert into public.leader_reviews (application_id, reviewer_id, stage, scores, notes)
  values (p_id, me, p_stage, p_scores, nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (application_id, reviewer_id, stage)
  do update set scores = excluded.scores, notes = excluded.notes;

  if p_stage = 'interview' and a.status = 'interview_booked' then
    update public.leader_applications set status = 'interviewed' where id = p_id;
  end if;
  perform public.write_event(me, 'leader.reviewed', 'leader_application', p_id::text, jsonb_build_object('stage', p_stage));
end;
$$;

create function public.invite_to_interview(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  me uuid := auth.uid();
begin
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only a pastor or director can invite to interview' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_id for update;
  if not found or a.person_id = me or a.status <> 'submitted' then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.leader_references where application_id = p_id and submitted_at is not null) < 2 then
    raise exception 'Both references must be in first' using errcode = '22023';
  end if;
  if (select count(distinct reviewer_id) from public.leader_reviews where application_id = p_id and stage = 'calling') < 2 then
    raise exception 'Two reviewers must score the application first' using errcode = '22023';
  end if;
  update public.leader_applications set status = 'interview_invited' where id = p_id;
  perform public.write_event(me, 'leader.invited', 'leader_application', p_id::text, '{}'::jsonb);
end;
$$;

-- A pastor clears a referee's concern after following it up.
create function public.clear_reference_concern(p_reference uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
begin
  if not public.has_role('pastor') then
    raise exception 'Only a pastor can clear a concern' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'Say what you did to follow it up' using errcode = '22023';
  end if;
  select * into r from public.leader_references where id = p_reference;
  if not found or exists (select 1 from public.leader_applications where id = r.application_id and person_id = auth.uid()) then
    raise exception 'Reference not found' using errcode = 'P0002';
  end if;
  update public.leader_reference_answers
     set concern_cleared_by = auth.uid(), concern_cleared_at = now(), concern_cleared_note = btrim(p_note)
   where reference_id = p_reference and concern and concern_cleared_at is null;
  perform public.write_event(auth.uid(), 'leader.concern_cleared', 'leader_application', r.application_id::text, '{}'::jsonb);
end;
$$;

-- The final decision. Only a pastor, never on their own application.
create function public.decide_application(p_id uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    ready := public.application_readiness(p_id);
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
$$;

-- ---------------------------------------------------------------------------
-- Interviews
-- ---------------------------------------------------------------------------

create function public.add_interview_slot(
  p_starts timestamptz,
  p_minutes integer,
  p_mode text,
  p_place text,
  p_panel text
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
    raise exception 'Only the office can add interview times' using errcode = '42501';
  end if;
  if p_starts < now() + interval '1 hour' then
    raise exception 'Choose a time in the future' using errcode = '22023';
  end if;
  insert into public.interview_slots (starts_at, minutes, mode, place, panel, created_by)
  values (p_starts, coalesce(p_minutes, 20), p_mode, btrim(p_place), nullif(btrim(coalesce(p_panel, '')), ''), auth.uid())
  returning id into sid;
  return sid;
end;
$$;

create function public.remove_interview_slot(p_slot uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can remove interview times' using errcode = '42501';
  end if;
  delete from public.interview_slots where id = p_slot and application_id is null;
  if not found then
    raise exception 'That time is booked or no longer exists' using errcode = '22023';
  end if;
end;
$$;

-- Everyone who runs interviews sees the times. Names appear for the panel only.
create function public.review_interviews()
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
    raise exception 'Only the office and the review panel can see interview times' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'mode', s.mode, 'place', s.place,
             'panel', s.panel, 'booked', s.application_id is not null,
             'application_id', case when is_panel then s.application_id else null end,
             'applicant', case when is_panel and s.application_id is not null
                               then public.person_display_name((select person_id from public.leader_applications where id = s.application_id))
                               else null end)
           order by s.starts_at)
    from public.interview_slots s where s.starts_at > now() - interval '1 day'), '[]'::jsonb);
end;
$$;

create function public.my_interview_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
begin
  select * into a from public.leader_applications
   where person_id = auth.uid() and status in ('interview_invited', 'interview_booked', 'interviewed');
  if not found then return null; end if;
  return jsonb_build_object(
    'status', a.status,
    'booked', (select jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'mode', s.mode, 'place', s.place,
                                         'can_cancel', s.starts_at > now() + interval '24 hours')
                 from public.interview_slots s where s.application_id = a.id),
    'open', case when a.status = 'interview_invited' then coalesce((
              select jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'minutes', s.minutes, 'mode', s.mode, 'place', s.place)
                               order by s.starts_at)
                from (select * from public.interview_slots
                       where application_id is null and starts_at > now() + interval '24 hours'
                       order by starts_at limit 40) s), '[]'::jsonb)
            else '[]'::jsonb end);
end;
$$;

create function public.book_interview_slot(p_slot uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create function public.cancel_interview_booking()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  s public.interview_slots;
begin
  select * into a from public.leader_applications
   where person_id = auth.uid() and status = 'interview_booked' for update;
  if not found then
    raise exception 'You have no interview booked' using errcode = '22023';
  end if;
  select * into s from public.interview_slots where application_id = a.id for update;
  if found and s.starts_at < now() + interval '24 hours' then
    raise exception 'Too close to the interview to cancel here. Message the office' using errcode = '22023';
  end if;
  update public.interview_slots set application_id = null, booked_at = null where application_id = a.id;
  update public.leader_applications set status = 'interview_invited' where id = a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Totals for the office (no personal details)
-- ---------------------------------------------------------------------------

create function public.leader_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_review_panel() or public.has_any_role(array['admin', 'data_lead']::public.app_role[])) then
    raise exception 'Only the office can see leader totals' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'started', (select count(*) from public.leader_applications),
    'ineligible', (select count(*) from public.leader_applications where status = 'ineligible'),
    'submitted', (select count(*) from public.leader_applications where submitted_at is not null),
    'in_review', (select count(*) from public.leader_applications where status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')),
    'interviews_booked', (select count(*) from public.leader_applications where status = 'interview_booked'),
    'approved_leaders', (select count(*) from public.leader_applications where status = 'approved_leader'),
    'approved_assistants', (select count(*) from public.leader_applications where status = 'approved_assistant'),
    'not_approved', (select count(*) from public.leader_applications where status = 'not_approved'),
    'open_slots', (select count(*) from public.interview_slots where application_id is null and starts_at > now()),
    'median_days_to_decision', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from decided_at - submitted_at) / 86400)::numeric, 1)
        from public.leader_applications where decided_at is not null and submitted_at is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.leader_applications enable row level security;
alter table public.leader_references enable row level security;
alter table public.leader_reference_answers enable row level security;
alter table public.leader_assessments enable row level security;
alter table public.leader_reviews enable row level security;
alter table public.scenario_keys enable row level security;
alter table public.interview_slots enable row level security;

-- Applicants read their own application and referee list, and write only the
-- draft's answers and the step they are on. Everything else goes through the
-- functions above, which check who is asking.
grant select on public.leader_applications to authenticated;
grant insert (person_id, step, answers, consent_version) on public.leader_applications to authenticated;
grant update (answers, step) on public.leader_applications to authenticated;
grant delete on public.leader_applications to authenticated;
grant select on public.leader_references to authenticated;
-- No grants at all on leader_reference_answers, leader_assessments, leader_reviews,
-- scenario_keys or interview_slots: only the functions touch them.

create policy "leader_applications: read own" on public.leader_applications
  for select to authenticated using (person_id = (select auth.uid()));
create policy "leader_applications: start own" on public.leader_applications
  for insert to authenticated
  with check (person_id = (select auth.uid()) and status = 'draft');
create policy "leader_applications: edit own draft" on public.leader_applications
  for update to authenticated
  using (person_id = (select auth.uid()) and status = 'draft')
  with check (person_id = (select auth.uid()) and status = 'draft');
-- Erasure: an applicant can withdraw and delete until they are approved.
-- After approval the record stays for safeguarding; the data lead handles requests.
create policy "leader_applications: delete own" on public.leader_applications
  for delete to authenticated
  using (person_id = (select auth.uid()) and status not in ('approved_leader', 'approved_assistant'));

create policy "leader_references: read own" on public.leader_references
  for select to authenticated
  using (exists (
    select 1 from public.leader_applications a
     where a.id = application_id and a.person_id = (select auth.uid())));

-- Functions: closed by default, then opened to the people who need them.
revoke execute on function
  public.is_review_panel(),
  public.referee_token_hash(text),
  public.person_display_name(uuid),
  public.rating_pct(jsonb),
  public.application_readiness(uuid),
  public.check_leader_eligibility(uuid),
  public.set_referee(uuid, integer, text, text, text, boolean),
  public.renew_referee_link(uuid),
  public.submit_leader_application(uuid),
  public.get_reference_request(text),
  public.submit_reference(text, integer, integer, integer, integer, boolean, text),
  public.review_queue(),
  public.review_application(uuid),
  public.save_review(uuid, text, jsonb, text),
  public.invite_to_interview(uuid),
  public.clear_reference_concern(uuid, text),
  public.decide_application(uuid, text, text),
  public.add_interview_slot(timestamptz, integer, text, text, text),
  public.remove_interview_slot(uuid),
  public.review_interviews(),
  public.my_interview_options(),
  public.book_interview_slot(uuid),
  public.cancel_interview_booking(),
  public.leader_stats()
  from public, anon, authenticated;

grant execute on function
  public.check_leader_eligibility(uuid),
  public.set_referee(uuid, integer, text, text, text, boolean),
  public.renew_referee_link(uuid),
  public.submit_leader_application(uuid),
  public.review_queue(),
  public.review_application(uuid),
  public.save_review(uuid, text, jsonb, text),
  public.invite_to_interview(uuid),
  public.clear_reference_concern(uuid, text),
  public.decide_application(uuid, text, text),
  public.add_interview_slot(timestamptz, integer, text, text, text),
  public.remove_interview_slot(uuid),
  public.review_interviews(),
  public.my_interview_options(),
  public.book_interview_slot(uuid),
  public.cancel_interview_booking(),
  public.leader_stats()
  to authenticated;

-- The only two things a visitor who is not signed in can do: open a referee
-- link and answer it. Both need the secret in the link.
grant execute on function
  public.get_reference_request(text),
  public.submit_reference(text, integer, integer, integer, integer, boolean, text)
  to anon, authenticated;

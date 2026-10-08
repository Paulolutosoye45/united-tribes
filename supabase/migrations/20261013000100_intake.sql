-- United Tribes, Phase 1: the intake form.
--
-- What this adds
--   consents         an append-only ledger of what each person agreed to
--   intake_drafts    save and resume: one in-progress form per person
--   member_profiles  the finished answers, one row per person
--   ai_calls         one row per assistant request (no text), for limits and quality
--   has_consent()    used by the access rules below
--   intake_stats()   totals for the office, with no personal details
--
-- Access rule for all of it: a person sees and changes only their own rows.
-- Nobody else can read a member's answers in this phase, admins included.
-- Leaders will see only what their circle members share, added with circles.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.gender_kind as enum ('female', 'male', 'undisclosed');
create type public.circle_mix as enum ('mixed', 'same_gender', 'no_preference');
create type public.faith_journey_kind as enum ('exploring', 'new', 'growing', 'established', 'leading');
create type public.meeting_mode as enum ('online', 'in_person', 'either');
create type public.serving_interest as enum ('yes', 'maybe', 'not_now');
create type public.consent_purpose as enum ('matching', 'ai_assist', 'whatsapp');

-- A goal must belong to the tribe it is stored with.
alter table public.season_goals add constraint season_goals_id_tribe_key unique (id, tribe_id);

-- ---------------------------------------------------------------------------
-- Consent ledger
-- ---------------------------------------------------------------------------

create table public.consents (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  purpose public.consent_purpose not null,
  granted boolean not null,
  -- Which wording the person saw, e.g. 2026-10-v1
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,24}$'),
  created_at timestamptz not null default now()
);
create index consents_person_idx on public.consents (person_id, purpose, id desc);

-- The latest answer for a purpose decides. No row means no consent.
create function public.has_consent(p_purpose public.consent_purpose)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select c.granted
       from public.consents c
      where c.person_id = (select auth.uid()) and c.purpose = p_purpose
      order by c.id desc
      limit 1),
    false);
$$;

-- ---------------------------------------------------------------------------
-- Drafts: save and resume
-- ---------------------------------------------------------------------------

create table public.intake_drafts (
  person_id uuid primary key references public.people (id) on delete cascade,
  step text not null check (step ~ '^[a-z-]{1,24}$'),
  answers jsonb not null default '{}'::jsonb check (octet_length(answers::text) <= 20000),
  -- Time actually spent answering, in seconds (breaks are not counted)
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger intake_drafts_touch before update on public.intake_drafts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Finished answers
-- ---------------------------------------------------------------------------

create table public.member_profiles (
  person_id uuid primary key references public.people (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,

  -- You
  age_range_id uuid not null references public.age_ranges (id),
  birthday_day smallint check (birthday_day between 1 and 31),
  birthday_month smallint check (birthday_month between 1 and 12),
  gender public.gender_kind not null,
  circle_mix public.circle_mix not null,
  zone text not null check (zone in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad')),
  area_note text check (char_length(area_note) <= 80),

  -- Your season
  story text check (char_length(story) <= 1500),
  tribe_id uuid references public.tribes (id),
  tribe_other text check (char_length(tribe_other) <= 120),
  faith_journey public.faith_journey_kind not null,

  -- Your goal
  season_goal_id uuid,
  goal_other text check (char_length(goal_other) <= 160),
  success_statement text check (char_length(success_statement) <= 240),
  goal_baseline smallint not null check (goal_baseline between 1 and 5),

  -- Your rhythm
  meeting_mode public.meeting_mode not null,
  meeting_times text[] not null default '{}'
    check (meeting_times <@ array['sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning']::text[]),
  -- Six this-or-that taps. -1 and 1 are the two sides, 0 is "either / skipped".
  -- A matching aid, never shown to other members.
  style_social smallint not null default 0 check (style_social between -1 and 1),       -- quiet one-to-one | lively group chat
  style_structure smallint not null default 0 check (style_structure between -1 and 1), -- see where it goes | clear plan
  style_openness smallint not null default 0 check (style_openness between -1 and 1),   -- stick with what works | try something new
  style_directness smallint not null default 0 check (style_directness between -1 and 1), -- keep the peace | say what I think
  style_disclosure smallint not null default 0 check (style_disclosure between -1 and 1), -- open up once I trust | open up quickly
  style_learning smallint not null default 0 check (style_learning between -1 and 1),   -- learn by doing | learn by talking
  open_to_serving public.serving_interest,

  -- Care. Never sent to the assistant.
  support_needs text check (char_length(support_needs) <= 600),
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),

  -- What the assistant proposed and what the person chose (ids only, no text)
  ai_assist jsonb not null default '{}'::jsonb check (octet_length(ai_assist::text) <= 4000),

  duration_seconds integer check (duration_seconds between 0 and 7200),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((birthday_day is null) = (birthday_month is null)),
  check (
    birthday_day is null
    or birthday_day <= case birthday_month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
  ),
  check (tribe_id is not null or tribe_other is not null),
  check (season_goal_id is not null or goal_other is not null),
  check (season_goal_id is null or tribe_id is not null),
  foreign key (season_goal_id, tribe_id) references public.season_goals (id, tribe_id)
);
create index member_profiles_season_idx on public.member_profiles (season_id);
create index member_profiles_tribe_idx on public.member_profiles (tribe_id);
create trigger member_profiles_touch before update on public.member_profiles
  for each row execute function public.touch_updated_at();

-- Withdrawing a consent has an effect, not just a record.
create function public.apply_consent_withdrawal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.granted then
    return new;
  end if;
  if new.purpose = 'matching' then
    delete from public.member_profiles where person_id = new.person_id;
    delete from public.intake_drafts where person_id = new.person_id;
  elsif new.purpose = 'whatsapp' then
    update public.member_profiles set whatsapp = null where person_id = new.person_id;
  end if;
  return new;
end;
$$;
create trigger consents_apply_withdrawal after insert on public.consents
  for each row execute function public.apply_consent_withdrawal();

-- ---------------------------------------------------------------------------
-- Assistant usage: counts and timings only, never the text
-- ---------------------------------------------------------------------------

create table public.ai_calls (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  at timestamptz not null default now(),
  field text not null check (field ~ '^[a-z_]{1,32}$'),
  provider text not null check (char_length(provider) <= 24),
  model text not null check (char_length(model) <= 64),
  latency_ms integer not null check (latency_ms >= 0),
  fallback boolean not null,
  reason text check (char_length(reason) <= 24),
  suggested smallint not null default 0 check (suggested between 0 and 10),
  dropped smallint not null default 0 check (dropped between 0 and 100)
);
create index ai_calls_person_idx on public.ai_calls (person_id, at desc);
create index ai_calls_at_idx on public.ai_calls (at desc);

-- ---------------------------------------------------------------------------
-- Totals for the office (no personal details)
-- ---------------------------------------------------------------------------

create function public.intake_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see intake totals' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'members', (select count(*) from public.people),
    'started', (select count(*) from public.intake_drafts) + (select count(*) from public.member_profiles),
    'completed', (select count(*) from public.member_profiles),
    'median_seconds', (
      select round(percentile_cont(0.5) within group (order by duration_seconds))
      from public.member_profiles where duration_seconds is not null),
    'within_six_minutes', (select count(*) from public.member_profiles where duration_seconds <= 360),
    'by_track', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.name, 'count', x.n) order by t.sort)
      from (
        select ar.track_id, count(*) as n
        from public.member_profiles mp join public.age_ranges ar on ar.id = mp.age_range_id
        group by ar.track_id) x
      join public.tracks t on t.id = x.track_id), '[]'::jsonb),
    'by_tribe', coalesce((
      select jsonb_agg(jsonb_build_object('label', tr.name, 'count', x.n) order by x.n desc, tr.name)
      from (
        select tribe_id, count(*) as n from public.member_profiles
        where tribe_id is not null group by tribe_id) x
      join public.tribes tr on tr.id = x.tribe_id), '[]'::jsonb),
    'assistant', jsonb_build_object(
      'calls', (select count(*) from public.ai_calls),
      'fallbacks', (select count(*) from public.ai_calls where fallback),
      'p95_ms', (select round(percentile_cont(0.95) within group (order by latency_ms)) from public.ai_calls where not fallback))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.consents enable row level security;
alter table public.intake_drafts enable row level security;
alter table public.member_profiles enable row level security;
alter table public.ai_calls enable row level security;

-- The ledger can be read and added to, never edited or erased.
grant select, insert on public.consents to authenticated;
grant select, insert, update, delete on public.intake_drafts to authenticated;
grant select, insert, update, delete on public.member_profiles to authenticated;
grant select, insert on public.ai_calls to authenticated;

create policy "consents: read own" on public.consents
  for select to authenticated using (person_id = (select auth.uid()));
create policy "consents: add own" on public.consents
  for insert to authenticated with check (person_id = (select auth.uid()));

create policy "intake_drafts: own" on public.intake_drafts
  for select to authenticated using (person_id = (select auth.uid()));
create policy "intake_drafts: add own" on public.intake_drafts
  for insert to authenticated
  with check (person_id = (select auth.uid()) and public.has_consent('matching'));
create policy "intake_drafts: change own" on public.intake_drafts
  for update to authenticated
  using (person_id = (select auth.uid()))
  with check (person_id = (select auth.uid()) and public.has_consent('matching'));
create policy "intake_drafts: delete own" on public.intake_drafts
  for delete to authenticated using (person_id = (select auth.uid()));

create policy "member_profiles: read own" on public.member_profiles
  for select to authenticated using (person_id = (select auth.uid()));
create policy "member_profiles: add own" on public.member_profiles
  for insert to authenticated
  with check (person_id = (select auth.uid()) and public.has_consent('matching'));
create policy "member_profiles: change own" on public.member_profiles
  for update to authenticated
  using (person_id = (select auth.uid()))
  with check (person_id = (select auth.uid()) and public.has_consent('matching'));
create policy "member_profiles: delete own" on public.member_profiles
  for delete to authenticated using (person_id = (select auth.uid()));

create policy "ai_calls: read own" on public.ai_calls
  for select to authenticated using (person_id = (select auth.uid()));
create policy "ai_calls: office read" on public.ai_calls
  for select to authenticated
  using (public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]));
create policy "ai_calls: add own" on public.ai_calls
  for insert to authenticated with check (person_id = (select auth.uid()));

-- Functions: closed by default, then opened to the people who need them.
revoke execute on function
  public.has_consent(public.consent_purpose),
  public.apply_consent_withdrawal(),
  public.intake_stats()
  from public, anon, authenticated;

grant execute on function
  public.has_consent(public.consent_purpose),
  public.intake_stats()
  to authenticated;

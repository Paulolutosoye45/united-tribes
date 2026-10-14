-- =============================================================================
-- United Tribes: Messages & Reminders
--
--   Part A  announcements   the office writes to a group of people worked out from live records, never from a list
--   Part B  four journeys   short, kind email series for people who started something and have not finished it
--   Both    one set of safeguards: switches a person controls, weekly caps, sending hours, condition re-checks,
--           a self-pausing breaker, one-click unsubscribe, and a record of every change.
--
-- Everything goes out through the outbox that already exists (consent, quiet hours, retries, delivery reports and the
-- message log apply unchanged). This file adds the rules for WHO, WHEN and HOW OFTEN; the wording of the announcement
-- and of the sixteen reminder emails lives here too, so the office can change it without a developer.
--
-- Nobody reads or writes these tables directly. People use the functions below; the sending service and the public
-- email pages use the worker_* functions with the sending token.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings: one row, kept small and in words the office understands
-- ---------------------------------------------------------------------------

create table public.reminder_settings (
  id boolean primary key default true check (id),
  -- One switch for all four journeys. Each journey also has its own.
  master_on boolean not null default true,
  -- The share of people (chosen at random, by a fixed rule) who get no reminders, so the office can see what reminders change.
  holdout_pct smallint not null default 10 check (holdout_pct between 0 and 50),
  -- Set by the office. Without it the leader journey's last email goes on day 20.
  applications_close_on date,
  -- Joining a tribe closes this many days after the season starts.
  joining_closes_days smallint not null default 14 check (joining_closes_days between 7 and 42),
  -- Lagos wall-clock hours: reminders start (inclusive) and stop (exclusive); on Sundays they start later.
  reminder_start_hour smallint not null default 9 check (reminder_start_hour between 6 and 20),
  reminder_end_hour smallint not null default 19 check (reminder_end_hour between 7 and 21),
  sunday_start_hour smallint not null default 14 check (sunday_start_hour between 6 and 20),
  bulk_start_hour smallint not null default 8 check (bulk_start_hour between 6 and 20),
  bulk_end_hour smallint not null default 20 check (bulk_end_hour between 7 and 21),
  -- The least gap between two reminders, the most reminders in a week, and the most non-essential emails in a week.
  cap_gap_days smallint not null default 2 check (cap_gap_days between 0 and 7),
  cap_reminders_week smallint not null default 2 check (cap_reminders_week between 1 and 7),
  cap_nonessential_week smallint not null default 3 check (cap_nonessential_week between 1 and 14),
  -- Announcements: spread out, and a second person approves a large one.
  bulk_per_minute smallint not null default 300 check (bulk_per_minute between 10 and 1000),
  approval_threshold integer not null default 200 check (approval_threshold between 1 and 100000),
  -- Printed at the foot of every email.
  church_name text not null default 'The Covenant Nation' check (char_length(btrim(church_name)) between 2 and 80),
  church_address text not null default 'Iganmu, Lagos, Nigeria' check (char_length(btrim(church_address)) between 2 and 160),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (reminder_start_hour < reminder_end_hour),
  check (bulk_start_hour < bulk_end_hour)
);
insert into public.reminder_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- The four journeys and their sixteen emails
-- ---------------------------------------------------------------------------

create table public.journeys (
  key text primary key check (key in ('member_form', 'leader_application', 'no_tribe', 'in_tribe')),
  position smallint not null unique,
  title text not null,
  -- off: does nothing. rehearsal: writes what it would send to the log and sends nothing. on: sends.
  mode text not null default 'rehearsal' check (mode in ('off', 'rehearsal', 'on')),
  -- The day each of the four emails goes, counted from the moment the journey starts for a person.
  day_offsets integer[] not null check (cardinality(day_offsets) = 4),
  -- Set when the journey stopped itself, so the office sees why.
  paused_reason text check (char_length(paused_reason) <= 240),
  paused_at timestamptz,
  -- The line typed ahead of "Message on WhatsApp": a person, not a robot, sends it.
  chat_text text not null check (char_length(btrim(chat_text)) between 10 and 300),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.journey_emails (
  id uuid primary key default gen_random_uuid(),
  journey_key text not null references public.journeys (key) on delete cascade,
  step smallint not null check (step between 1 and 4),
  tone text not null check (tone in ('warm', 'practical', 'encouraging', 'honest')),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  paragraphs text[] not null check (cardinality(paragraphs) between 1 and 4),
  button_label text check (char_length(btrim(button_label)) between 2 and 40),
  -- Fixed by the design, not by the wording: where the main button goes, and which one-tap answers sit beside it.
  target text check (target in ('/join', '/lead/apply', '/tribe', '/rhythm', '/home', '/profile')),
  actions text[] not null default '{}'
    check (actions <@ array['help_finish', 'not_season', 'talk_pastor', 'none_fit', 'in_the_way', 'step_back']::text[]),
  version integer not null default 1,
  -- An edit waits here until a pastor approves it; until then the live wording stays as it is.
  pending jsonb check (pending is null or octet_length(pending::text) <= 6000),
  approved_by uuid references public.people (id) on delete set null,
  approved_at timestamptz,
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (journey_key, step)
);

create table public.journey_email_versions (
  id bigint generated always as identity primary key,
  email_id uuid not null references public.journey_emails (id) on delete cascade,
  version integer not null,
  subject text not null,
  paragraphs text[] not null,
  button_label text,
  edited_by uuid references public.people (id) on delete set null,
  approved_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index journey_email_versions_email_idx on public.journey_email_versions (email_id, version desc);

-- One row for each person in a journey.
create table public.journey_runs (
  id uuid primary key default gen_random_uuid(),
  journey_key text not null references public.journeys (key) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'acted', 'completed', 'stopped', 'declined')),
  end_reason text check (char_length(end_reason) <= 40),
  -- The moment the day counts start from, and the last sign of life seen when the run began (a changed draft ends it).
  base_at timestamptz not null,
  seen_at timestamptz,
  -- What the run is about: the leader application, or the person's place in a tribe.
  ref_id uuid,
  step_done smallint not null default 0 check (step_done between 0 and 4),
  last_sent_at timestamptz,
  expires_at timestamptz not null,
  -- A rehearsal run only logs. A hold-out run is watched but never written to.
  rehearsal boolean not null default false,
  holdout boolean not null default false,
  run_no smallint not null default 1,
  started_at timestamptz not null default now(),
  acted_at timestamptz,
  ended_at timestamptz
);
create unique index journey_runs_one_active on public.journey_runs (person_id) where status = 'active';
create index journey_runs_journey_idx on public.journey_runs (journey_key, status);
create index journey_runs_person_idx on public.journey_runs (person_id, journey_key);

create table public.journey_sends (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.journey_runs (id) on delete cascade,
  step smallint not null check (step between 1 and 4),
  -- sent: queued to the outbox. rehearsal: would have been sent. skipped: left out, with the reason.
  kind text not null check (kind in ('sent', 'rehearsal', 'skipped')),
  reason text check (char_length(reason) <= 60),
  message_id uuid references public.messages (id) on delete set null,
  at timestamptz not null default now(),
  unique (run_id, step)
);
create index journey_sends_at_idx on public.journey_sends (at desc);

-- What people answered with one tap at the foot of an email. Counted so the office learns why people stop.
create table public.journey_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  journey_key text not null references public.journeys (key) on delete cascade,
  kind text not null check (kind in ('help_finish', 'not_season', 'talk_pastor', 'none_fit', 'in_the_way', 'step_back')),
  -- A choice from a short, neutral list. Never free text, and never anything about health.
  reason text check (reason in ('timing', 'travel', 'other_group', 'not_sure', 'other')),
  status text not null default 'open' check (status in ('open', 'closed')),
  handled_by uuid references public.people (id) on delete set null,
  handled_at timestamptz,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index journey_requests_open_idx on public.journey_requests (created_at) where status = 'open';
create index journey_requests_person_idx on public.journey_requests (person_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

create table public.saved_audiences (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  -- The rule, never the people.
  spec jsonb not null check (octet_length(spec::text) <= 2000),
  label text not null check (char_length(label) <= 160),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 80),
  audience jsonb not null check (octet_length(audience::text) <= 2000),
  audience_label text not null default '' check (char_length(audience_label) <= 160),
  subject text not null default '' check (char_length(subject) <= 120),
  paragraphs text[] not null default '{}' check (cardinality(paragraphs) <= 6),
  button_label text check (char_length(btrim(button_label)) between 2 and 40),
  button_target text check (button_target in ('/join', '/lead/apply', '/tribe', '/rhythm', '/home', '/profile')),
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_approval', 'scheduled', 'sending', 'paused', 'sent', 'cancelled', 'rejected')),
  needs_approval boolean not null default false,
  created_by uuid references public.people (id) on delete set null,
  approved_by uuid references public.people (id) on delete set null,
  approved_at timestamptz,
  reject_note text check (char_length(reject_note) <= 300),
  scheduled_for timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  -- How many people matched when it was sent for approval, and how many were frozen when it was approved.
  snapshot_count integer,
  recipient_count integer,
  last_release_at timestamptz,
  stopped_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index broadcasts_status_idx on public.broadcasts (status, scheduled_for);
create trigger broadcasts_touch before update on public.broadcasts
  for each row execute function public.touch_updated_at();

create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- pending: frozen, not yet released. queued: handed to the outbox. skipped: left out, with the reason.
  status text not null default 'pending' check (status in ('pending', 'queued', 'skipped', 'cancelled')),
  reason text check (char_length(reason) <= 40),
  message_id uuid references public.messages (id) on delete set null,
  released_at timestamptz,
  primary key (broadcast_id, person_id)
);
create index broadcast_recipients_pending_idx on public.broadcast_recipients (broadcast_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Signed links inside emails. Only a hash is kept, so a link nobody has seen cannot be guessed or read back.
-- ---------------------------------------------------------------------------

create table public.email_links (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- go: the button (an internal page). stop: stop these emails. prefs: the three switches. ask: a one-tap answer.
  kind text not null check (kind in ('go', 'stop', 'prefs', 'ask')),
  -- go: the page. stop: reminders or announcements. ask: the answer.
  scope text not null check (char_length(scope) <= 40),
  run_id uuid references public.journey_runs (id) on delete set null,
  broadcast_id uuid references public.broadcasts (id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  clicks integer not null default 0,
  first_clicked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_links_person_idx on public.email_links (person_id, created_at desc);
create index email_links_broadcast_idx on public.email_links (broadcast_id) where broadcast_id is not null;

-- Bounces, complaints and unsubscribes, to keep a bad address out and to let a journey stop itself.
create table public.email_signals (
  id bigint generated always as identity primary key,
  person_id uuid references public.people (id) on delete cascade,
  kind text not null check (kind in ('hard_bounce', 'complaint', 'unsubscribe')),
  journey_key text references public.journeys (key) on delete set null,
  broadcast_id uuid references public.broadcasts (id) on delete set null,
  created_at timestamptz not null default now()
);
create index email_signals_person_idx on public.email_signals (person_id, kind);
create index email_signals_day_idx on public.email_signals (created_at desc, kind);

-- "Message on WhatsApp": a staff member opened a chat with one person. Who, to whom, when; never the words.
create table public.chat_opens (
  id bigint generated always as identity primary key,
  opened_by uuid references public.people (id) on delete set null,
  person_id uuid references public.people (id) on delete set null,
  context text not null check (context ~ '^[a-z_]{2,32}$'),
  created_at timestamptz not null default now()
);
create index chat_opens_actor_idx on public.chat_opens (opened_by, created_at desc);

alter table public.reminder_settings enable row level security;
alter table public.journeys enable row level security;
alter table public.journey_emails enable row level security;
alter table public.journey_email_versions enable row level security;
alter table public.journey_runs enable row level security;
alter table public.journey_sends enable row level security;
alter table public.journey_requests enable row level security;
alter table public.email_links enable row level security;
alter table public.email_signals enable row level security;
alter table public.saved_audiences enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.chat_opens enable row level security;
-- No grants: only the functions below touch these tables.

-- A kind of care follow-up for someone who has not done a first thing in their tribe, on the leader's "call first" list.
alter table public.care_flags drop constraint if exists care_flags_kind_check;
alter table public.care_flags
  add constraint care_flags_kind_check
  check (kind in ('missed_twice', 'not_yet_twice', 'low_belonging', 'leader_concern', 'quiet_start'));

-- ---------------------------------------------------------------------------
-- Journeys as shipped. Each starts in rehearsal: it logs what it would send and sends nothing.
-- ---------------------------------------------------------------------------

insert into public.journeys (key, position, title, day_offsets, chat_text) values
  ('member_form', 1, 'Started the form, not finished', array[1, 3, 7, 21],
   'Hi, it''s from The Covenant Nation. I saw you started your United Tribes form. I''m glad you did. Can I help you finish it?'),
  ('leader_application', 2, 'Started a leader application, not finished', array[2, 5, 10, 20],
   'Hi, it''s from The Covenant Nation. Thank you for starting to apply to lead a tribe. Is there anything I can help you with?'),
  ('no_tribe', 3, 'Finished the form, not in a tribe', array[2, 6, 12, 20],
   'Hi, it''s from The Covenant Nation. Your tribes are ready on United Tribes. Would you like help choosing one?'),
  ('in_tribe', 4, 'In a tribe, nothing done yet', array[3, 6, 10, 14],
   'Hi, it''s from The Covenant Nation. Your tribe has begun and we''d love to see you. Is anything in the way?');

-- ---------------------------------------------------------------------------
-- The sixteen emails, as drafted for the pastorate. Four tones, in the same order in every journey:
-- warm, practical, encouraging, and an honest last call that ends the series and offers a way out.
-- Words in braces are filled in for each person from a fixed list.
-- ---------------------------------------------------------------------------

insert into public.journey_emails (journey_key, step, tone, subject, paragraphs, button_label, target, actions, approved_at) values
  ('member_form', 1, 'warm',
   'You’re part-way to your tribe, {first_name}',
   array['You started telling us about your season, and your answers are saved just as you left them.',
         'About five more minutes and you’ll see three tribes that fit you.'],
   'Carry on where I stopped', '/join', '{}', now()),
  ('member_form', 2, 'practical',
   'Five minutes, and your tribe is waiting',
   array['Nothing you wrote is lost. You can finish on your phone in about five minutes.',
         'If a question is unclear, reply to this email and someone on the team will help.'],
   'Finish my form', '/join', '{}', now()),
  ('member_form', 3, 'encouraging',
   'There’s a seat with your name on it',
   array['United Tribes exists so that nobody at The Covenant Nation walks through a season alone.',
         'In a tribe of twelve there is someone working on the same thing you are. Finish your form and we’ll introduce you.'],
   'Find my tribe', '/join', '{}', now()),
  ('member_form', 4, 'honest',
   'Your answers will be cleared on {erase_date}',
   array['This is our last reminder.',
         'To protect your privacy, an unfinished form is cleared after 30 days, so your answers will be removed on {erase_date}.',
         'If now isn’t the right time, that’s fine: tell us with one tap and we won’t remind you again.'],
   'Finish my form', '/join', array['help_finish', 'not_season'], now()),

  ('leader_application', 1, 'warm',
   'Thank you for thinking about leading a tribe',
   array['You’ve started an application to lead a tribe, and it’s saved exactly as you left it.',
         'Being willing to walk with others through a season is a gift to this church.'],
   'Continue my application', '/lead/apply', '{}', now()),
  ('leader_application', 2, 'practical',
   'What’s left on your leader application',
   array['You have {parts_left} parts left, about {minutes_left} minutes.',
         'Have your two referees’ names and numbers ready: each gets a private link once you send it.',
         'You can speak your answers instead of typing them.'],
   'Continue', '/lead/apply', '{}', now()),
  ('leader_application', 3, 'encouraging',
   'Every tribe starts with one person willing to go first',
   array['You don’t need to have it all figured out.',
         'The Leader Academy trains every leader, and a coach walks with you, before a single member arrives.'],
   'Finish my application', '/lead/apply', '{}', now()),
  ('leader_application', 4, 'honest',
   'Last reminder about your leader application',
   array['This is the last time we’ll remind you. {close_line}',
         'If this isn’t your season to lead, that’s alright, and there are other ways to serve. Tell us with one tap and we won’t ask again.'],
   'Finish my application', '/lead/apply', array['talk_pastor', 'not_season'], now()),

  ('no_tribe', 1, 'warm',
   'Your three tribes are ready, {first_name}',
   array['Thank you for finishing your form.',
         'We found three tribes that fit your season, each with how well it matches you and why. Have a look and choose the one you’d love to walk with.'],
   'See my tribes', '/tribe', '{}', now()),
  ('no_tribe', 2, 'practical',
   'Choosing a tribe takes two minutes',
   array['Open a tribe to see who leads it, when and where it meets, and what it hopes for by week 12.',
         'A tribe holds twelve, so your favourite may fill. You can change your mind any time before the season starts on {season_starts}.'],
   'Choose my tribe', '/tribe', '{}', now()),
  ('no_tribe', 3, 'encouraging',
   '{tribe_1} still has a seat for you',
   array['Your best match, {tribe_1}, led by {leader_first}, has {seats_left} seats left.',
         'Joining before the first meeting means you start the season together.'],
   'Choose my tribe', '/tribe', '{}', now()),
  ('no_tribe', 4, 'honest',
   'Last call to join a tribe this season',
   array['Joining closes on {joining_closes}; after that the next chance is next season.',
         'If none of your three tribes feels right, tell us and we’ll look again. If this isn’t your season, that’s fine too.'],
   'Choose my tribe', '/tribe', array['none_fit', 'not_season'], now()),

  ('in_tribe', 1, 'warm',
   'Your season has begun, {first_name}',
   array['{tribe} has started its twelve weeks, and you’re part of it.',
         'This week’s guide is ready, and your first small step is waiting to be chosen.'],
   'Open this week', '/rhythm', '{}', now()),
  ('in_tribe', 2, 'practical',
   'Your first step, in one sentence',
   array['Each week you choose one small step: “When ___, I will ___.” It takes a minute.',
         'Only you see what you write; your leader sees only whether it’s done. Your tribe meets {meets}.'],
   'Choose my step', '/rhythm', '{}', now()),
  ('in_tribe', 3, 'encouraging',
   'Your tribe saved you a seat',
   array['Twelve weeks go quickly, and the people in {tribe} are working on the same goal as you.',
         'Come to the next meeting on {next_meeting}, even if you haven’t done anything else yet. {leader_first} will give you a call this week too.'],
   'See my tribe', '/tribe', '{}', now()),
  ('in_tribe', 4, 'honest',
   'We’ve missed you in {tribe}',
   array['This is our last email about getting started; from here {leader_first} will stay in touch personally.',
         'If something is in the way, whether the time, the place or something harder, tap below and someone from the care team will reach out.',
         'If you need to step back this season, you can tell us that too.'],
   null, null, array['in_the_way', 'step_back'], now());

insert into public.journey_email_versions (email_id, version, subject, paragraphs, button_label)
select e.id, 1, e.subject, e.paragraphs, e.button_label from public.journey_emails e;

-- =============================================================================
-- Small helpers (internal: not callable through the API)
-- =============================================================================

-- The day of the week in Lagos right now (0 = Sunday). A function of its own so a test can stand in for the clock.
create function public.lagos_dow()
returns integer
language sql
stable
set search_path = ''
as $$
  select extract(dow from (now() at time zone 'Africa/Lagos'))::integer;
$$;

create function public.reminder_cfg()
returns public.reminder_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.reminder_settings s where s.id;
$$;

-- Whether it is a good hour to write to people. Reminders keep to the day and wait on Sunday mornings;
-- announcements have a wider window. The outbox's own quiet hours (10 pm to 6 am) still apply on top.
create function public.send_window_ok(p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  h integer := public.lagos_hour();
begin
  if p_kind = 'bulk' then
    return h >= s.bulk_start_hour and h < s.bulk_end_hour;
  end if;
  if public.lagos_dow() = 0 and h < s.sunday_start_hour then
    return false;
  end if;
  return h >= s.reminder_start_hour and h < s.reminder_end_hour;
end;
$$;

-- Said no to this kind of email (the latest answer decides; no answer means yes, as with email).
create function public.reminder_stopped(p_person uuid, p_purpose public.consent_purpose)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not c.granted from public.consents c
                    where c.person_id = p_person and c.purpose = p_purpose
                    order by c.id desc limit 1), false);
$$;

-- Why this person must not be written to by a reminder or an announcement, or null when they may be.
-- The 13 to 17 track goes through the parents' rules, a deletion in progress means no more mail,
-- and two hard bounces mean the address is bad and would hurt delivery for everyone.
create function public.message_blocker(p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.erasure_requests e where e.person_id = p_person and e.status = 'open') then
    return 'deletion';
  end if;
  if exists (select 1 from public.member_profiles mp join public.age_ranges ar on ar.id = mp.age_range_id
              where mp.person_id = p_person and ar.slug = '13-17')
     or exists (select 1 from public.intake_drafts d where d.person_id = p_person and d.answers ->> 'ageRange' = '13-17') then
    return 'under18';
  end if;
  if (select count(*) from public.email_signals s where s.person_id = p_person and s.kind = 'hard_bounce') >= 2 then
    return 'bounced';
  end if;
  if public.email_opted_out(p_person) then
    return 'email_off';
  end if;
  return null;
end;
$$;

-- The same people are held out every time: a fixed rule on the person and the journey, not a coin toss.
create function public.is_holdout(p_person uuid, p_journey text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (abs(hashtext(p_person::text || ':' || p_journey)::bigint) % 100) < (select s.holdout_pct from public.reminder_settings s where s.id);
$$;

-- The weekly caps. p_kind 'reminder' also keeps a gap between two reminders; 'announcement' only meets the total.
create function public.person_cap_ok(p_person uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
begin
  if (select count(*) from public.messages m
       where m.person_id = p_person and m.template in ('reminder_email', 'office_message') and not (m.params ? 'test')
         and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_nonessential_week then
    return false;
  end if;
  if p_kind = 'reminder' then
    if (select count(*) from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_reminders_week then
      return false;
    end if;
    if s.cap_gap_days > 0 and exists (select 1 from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - make_interval(days => s.cap_gap_days) + interval '1 hour') then
      return false;
    end if;
  end if;
  return true;
end;
$$;

-- Fixed list of name fields. A misspelt one cannot be saved. Links belong in the button only.
create function public.wording_problem(p_text text, p_allowed text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text;
  v_rest text := coalesce(p_text, '');
begin
  for f in select m[1] from regexp_matches(v_rest, '\{([^{}]*)\}', 'g') as m loop
    if f <> all (p_allowed) then
      return format('“{%s}” is not a name field. You can use: %s.', f, (select string_agg('{' || a || '}', ', ' order by a) from unnest(p_allowed) a));
    end if;
  end loop;
  v_rest := regexp_replace(v_rest, '\{[^{}]*\}', '', 'g');
  if v_rest ~ '[{}]' then
    return 'A curly bracket is left open. Name fields look like {first_name}.';
  end if;
  if v_rest ~* '(https?://|www\.)' then
    return 'Leave web addresses out. Put one link in the button, and it will take people to a page inside United Tribes.';
  end if;
  return null;
end;
$$;

-- Checks the subject, paragraphs and button of a piece of wording, in words a person can act on.
create function public.wording_check(p_subject text, p_paragraphs text[], p_button text, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_problem text;
  p text;
begin
  if char_length(btrim(coalesce(p_subject, ''))) < 3 or char_length(p_subject) > 120 or p_subject ~ '[\r\n]' then
    raise exception 'Give the email a subject of 3 to 120 characters, on one line' using errcode = '22023';
  end if;
  if p_paragraphs is null or cardinality(p_paragraphs) < 1 or cardinality(p_paragraphs) > 6 then
    raise exception 'Write between 1 and 6 short paragraphs' using errcode = '22023';
  end if;
  foreach p in array p_paragraphs loop
    if char_length(btrim(p)) < 2 or char_length(p) > 700 then
      raise exception 'Each paragraph needs 2 to 700 characters' using errcode = '22023';
    end if;
    v_problem := public.wording_problem(p, p_allowed);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end loop;
  v_problem := public.wording_problem(p_subject, p_allowed);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if p_button is not null then
    if char_length(btrim(p_button)) < 2 or char_length(p_button) > 40 then
      raise exception 'The button needs 2 to 40 characters' using errcode = '22023';
    end if;
    v_problem := public.wording_problem(p_button, p_allowed);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
  end if;
end;
$$;

-- =============================================================================
-- Who a message is for: worked out from live records, never from a list
-- =============================================================================

-- Checks a rule and returns it in its plain, safe form. Anything unknown is refused.
create function public.audience_clean(p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
  v jsonb;
  v_out jsonb;
  v_idle integer;
  v_nofit text;
  v_comm uuid;
  v_stages text[];
  v_roles text[];
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff') then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  v_out := jsonb_build_object('kind', k);

  if p_spec ? 'community' and nullif(p_spec ->> 'community', '') is not null then
    begin
      v_comm := (p_spec ->> 'community')::uuid;
    exception when others then
      raise exception 'That community does not exist' using errcode = '22023';
    end;
    if not exists (select 1 from public.communities t where t.id = v_comm) then
      raise exception 'That community does not exist' using errcode = '22023';
    end if;
    if k in ('leader_applicants', 'leaders', 'staff') then
      raise exception 'A community can only narrow members' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('community', v_comm);
  end if;

  if k = 'started' and p_spec ? 'idle_days' then
    v_idle := coalesce(nullif(p_spec ->> 'idle_days', '')::integer, 0);
    if v_idle < 0 or v_idle > 60 then
      raise exception 'Days since they last did anything must be 0 to 60' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('idle_days', v_idle);
  end if;

  if k = 'finished_no_tribe' and p_spec ? 'no_fit' then
    v_nofit := p_spec ->> 'no_fit';
    if v_nofit not in ('include', 'exclude', 'only') then
      raise exception 'Choose whether to include the people with no tribe that fits yet' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('no_fit', v_nofit);
  end if;

  if k = 'leader_applicants' then
    v := coalesce(p_spec -> 'stages', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the stages' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_stages from jsonb_array_elements_text(v) s;
    if exists (select 1 from unnest(v_stages) s where s not in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed', 'approved_leader', 'approved_assistant', 'not_approved')) then
      raise exception 'Choose from the stages shown' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('stages', to_jsonb(v_stages));
  end if;

  if k = 'staff' then
    v := coalesce(p_spec -> 'roles', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the roles' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_roles from jsonb_array_elements_text(v) s;
    if cardinality(v_roles) = 0 or exists (select 1 from unnest(v_roles) s where s not in ('coach', 'care_lead', 'community_champion', 'data_lead', 'director', 'pastor', 'admin')) then
      raise exception 'Choose at least one role from the list' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('roles', to_jsonb(v_roles));
  end if;
  return v_out;
end;
$$;

-- Everyone a rule matches, before anyone is left out.
create function public.audience_base(p_spec jsonb, p_centre uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
begin
  if k = 'everyone' then
    return query select p.id from public.people p where p.centre_id = p_centre;
  elsif k = 'started' then
    return query
      select d.person_id from public.intake_drafts d join public.people p on p.id = d.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.member_profiles mp where mp.person_id = d.person_id)
         and d.updated_at <= now() - make_interval(days => coalesce((p_spec ->> 'idle_days')::integer, 0));
  elsif k = 'finished_no_tribe' then
    return query
      select mp.person_id from public.member_profiles mp join public.people p on p.id = mp.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.tribe_members cm join public.seasons s on s.id = cm.season_id
                          where cm.person_id = mp.person_id and cm.status = 'active' and s.status <> 'closed')
         and case coalesce(p_spec ->> 'no_fit', 'include')
               when 'only' then exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               when 'exclude' then not exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               else true end;
  elsif k = 'in_tribe' then
    return query
      select distinct cm.person_id from public.tribe_members cm
        join public.seasons s on s.id = cm.season_id join public.people p on p.id = cm.person_id
       where p.centre_id = p_centre and cm.status = 'active' and s.status in ('planning', 'open', 'running');
  elsif k = 'leader_applicants' then
    return query
      select la.person_id from public.leader_applications la join public.people p on p.id = la.person_id
       where p.centre_id = p_centre
         and la.status::text = any (coalesce(
               (select array_agg(x) from jsonb_array_elements_text(p_spec -> 'stages') x),
               array['draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed']));
  elsif k = 'leaders' then
    return query
      select distinct x.pid from (
        select c.leader_id as pid from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed'
        union
        select c.assistant_id from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed' and c.assistant_id is not null
        union
        select r.person_id from public.person_roles r where r.role in ('leader', 'assistant_leader')) x
        join public.people p on p.id = x.pid
       where p.centre_id = p_centre;
  elsif k = 'staff' then
    return query
      select distinct r.person_id from public.person_roles r join public.people p on p.id = r.person_id
       where p.centre_id = p_centre
         and r.role::text = any (coalesce((select array_agg(x) from jsonb_array_elements_text(p_spec -> 'roles') x), '{}'));
  end if;
end;
$$;

-- Each person a rule matches, and the reason they will be left out (null when they will be written to).
create function public.audience_members(p_spec jsonb, p_centre uuid)
returns table (person_id uuid, blocker text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.pid,
         coalesce(public.message_blocker(b.pid),
                  case when public.reminder_stopped(b.pid, 'announcements') then 'announcements_off' end)
    from (select distinct t.pid from public.audience_base(p_spec, p_centre) as t(pid)) b
   where (p_spec ->> 'community' is null
          or exists (select 1 from public.member_profiles mp where mp.person_id = b.pid and mp.community_id = (p_spec ->> 'community')::uuid));
$$;

-- Who may write announcements: the office, and a community champion for their own community.
create function public.broadcast_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    return 'office';
  end if;
  if public.has_role('community_champion') then
    return 'champion';
  end if;
  return null;
end;
$$;

-- A champion writes only to members of a community they champion.
create function public.audience_for_caller(p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.broadcast_role();
  v_clean jsonb;
begin
  if v_role is null then
    raise exception 'Only the office or a community champion can write announcements' using errcode = '42501';
  end if;
  v_clean := public.audience_clean(p_spec);
  if v_role = 'champion' then
    if (v_clean ->> 'kind') not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe')
       or v_clean ->> 'community' is null
       or not exists (select 1 from public.community_champions tc
                       where tc.person_id = auth.uid() and tc.community_id = (v_clean ->> 'community')::uuid) then
      raise exception 'A champion can write to the members of their own community' using errcode = '42501';
    end if;
  end if;
  return v_clean;
end;
$$;

-- Counts for the screen: how many will get it, and how many are left out and why. Never names.
create function public.audience_preview(p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_spec jsonb := public.audience_for_caller(p_spec);
  v_total integer;
  v_send integer;
  v_skipped jsonb;
begin
  select count(*), count(*) filter (where m.blocker is null) into v_total, v_send
    from public.audience_members(v_spec, public.my_centre()) m;
  select coalesce(jsonb_object_agg(x.blocker, x.n), '{}'::jsonb) into v_skipped
    from (select m.blocker, count(*) as n from public.audience_members(v_spec, public.my_centre()) m
           where m.blocker is not null group by m.blocker) x;
  return jsonb_build_object('spec', v_spec, 'total', v_total, 'will_send', v_send, 'skipped', v_skipped,
    'needs_approval', v_send >= (select s.approval_threshold from public.reminder_settings s where s.id) or public.broadcast_role() = 'champion');
end;
$$;

-- One person from the group, to read the email as they will: their first name and their tribe. The nth, in a stable order.
create function public.audience_sample(p_spec jsonb, p_n integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_spec jsonb := public.audience_for_caller(p_spec);
  v_ids uuid[];
  v_pick uuid;
begin
  select coalesce(array_agg(m.person_id order by md5(m.person_id::text)), '{}') into v_ids
    from public.audience_members(v_spec, public.my_centre()) m where m.blocker is null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('found', false);
  end if;
  v_pick := v_ids[1 + (greatest(coalesce(p_n, 0), 0) % cardinality(v_ids))];
  return jsonb_build_object('found', true, 'of', cardinality(v_ids), 'vars', public.broadcast_vars(v_pick));
end;
$$;

-- The name fields of an announcement for one person.
create function public.broadcast_vars(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tribe text;
  v_starts date;
begin
  select c.name into v_tribe from public.current_placement(p_person) pm join public.tribes c on c.id = pm.tribe_id;
  select s.starts_on into v_starts from public.seasons s
   where s.status in ('planning', 'open') and s.centre_id = (select p.centre_id from public.people p where p.id = p_person)
   order by s.starts_on limit 1;
  return jsonb_build_object(
    'first_name', public.first_name_of(p_person),
    'tribe', coalesce(v_tribe, 'your tribe'),
    'season_starts', case when v_starts is null then 'soon' else to_char(v_starts, 'FMDD FMMonth YYYY') end,
    'my_page', '/home');
end;
$$;

-- =============================================================================
-- Announcements: write, send for approval, approve, pause, cancel
-- =============================================================================

create function public.broadcast_mine_or_office(p_row public.broadcasts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_row.centre_id = public.my_centre()
     and (p_row.created_by = auth.uid()
          or public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]));
$$;

-- Starts or changes a draft. Wording is checked as it is saved: the name fields, and no links outside the button.
create function public.broadcast_save(p_id uuid, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.broadcasts%rowtype;
  v_spec jsonb;
  v_title text;
  v_subject text;
  v_paras text[];
  v_button text;
  v_target text;
  v_label text;
  v_allowed text[] := array['first_name', 'tribe', 'season_starts', 'my_page'];
  v_id uuid := p_id;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.broadcast_role() is null then
    raise exception 'Only the office or a community champion can write announcements' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into b from public.broadcasts where id = p_id for update;
    if not found or not public.broadcast_mine_or_office(b) then
      raise exception 'We could not find that announcement' using errcode = 'P0002';
    end if;
    if b.status not in ('draft', 'rejected') then
      raise exception 'This announcement has already gone for approval or been sent, so its words can no longer change' using errcode = '22023';
    end if;
  end if;

  v_title := btrim(coalesce(p_fields ->> 'title', b.title, ''));
  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    raise exception 'Give the announcement a short name only you will see, 2 to 80 characters' using errcode = '22023';
  end if;
  v_spec := public.audience_for_caller(coalesce(p_fields -> 'audience', b.audience));
  v_label := left(btrim(coalesce(p_fields ->> 'audience_label', b.audience_label, '')), 160);
  v_subject := btrim(coalesce(p_fields ->> 'subject', b.subject, ''));
  if p_fields ? 'paragraphs' then
    if jsonb_typeof(p_fields -> 'paragraphs') <> 'array' then
      raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
    end if;
    select coalesce(array_agg(btrim(x) order by ord), '{}') into v_paras
      from jsonb_array_elements_text(p_fields -> 'paragraphs') with ordinality as t(x, ord) where btrim(x) <> '';
  else
    v_paras := coalesce(b.paragraphs, '{}');
  end if;
  v_button := nullif(btrim(coalesce(p_fields ->> 'button_label', b.button_label, '')), '');
  v_target := nullif(btrim(coalesce(p_fields ->> 'button_target', b.button_target, '')), '');
  if (v_button is null) <> (v_target is null) then
    raise exception 'A button needs both its words and the page it opens' using errcode = '22023';
  end if;
  if v_target is not null and v_target not in ('/join', '/lead/apply', '/tribe', '/rhythm', '/home', '/profile') then
    raise exception 'The button can only open a page inside United Tribes' using errcode = '22023';
  end if;
  -- A draft may be half written; it is checked in full when it is sent.
  if v_subject <> '' then
    if public.wording_problem(v_subject, v_allowed) is not null then
      raise exception '%', public.wording_problem(v_subject, v_allowed) using errcode = '22023';
    end if;
  end if;
  if cardinality(v_paras) > 0 then
    perform public.wording_check(case when v_subject = '' then 'Draft' else v_subject end, v_paras, v_button, v_allowed);
  end if;

  if p_id is null then
    insert into public.broadcasts (centre_id, title, audience, audience_label, subject, paragraphs, button_label, button_target, created_by)
    values (public.my_centre(), v_title, v_spec, v_label, v_subject, v_paras, v_button, v_target, uid)
    returning id into v_id;
    perform public.write_event(uid, 'broadcast.created', 'broadcast', v_id::text, '{}'::jsonb);
  else
    update public.broadcasts
       set title = v_title, audience = v_spec, audience_label = v_label, subject = v_subject, paragraphs = v_paras,
           button_label = v_button, button_target = v_target,
           status = 'draft', reject_note = null
     where id = p_id;
  end if;
  return v_id;
end;
$$;

create function public.broadcast_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', b.id, 'title', b.title, 'audience', b.audience, 'audience_label', b.audience_label, 'subject', b.subject,
    'paragraphs', to_jsonb(b.paragraphs), 'button_label', b.button_label, 'button_target', b.button_target,
    'status', b.status, 'needs_approval', b.needs_approval, 'reject_note', b.reject_note,
    'scheduled_for', b.scheduled_for, 'snapshot_count', b.snapshot_count, 'recipient_count', b.recipient_count,
    'created_by_me', b.created_by = auth.uid(), 'created_by', public.person_display_name(b.created_by),
    'approved_by', public.person_display_name(b.approved_by), 'approved_at', b.approved_at,
    'started_at', b.started_at, 'finished_at', b.finished_at, 'created_at', b.created_at);
end;
$$;

-- Freezes who gets the announcement, at the moment it is approved: people who join or leave later are not added or dropped.
create function public.broadcast_freeze(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
  n integer;
begin
  select * into b from public.broadcasts where id = p_id;
  delete from public.broadcast_recipients where broadcast_id = p_id;
  insert into public.broadcast_recipients (broadcast_id, person_id)
  select p_id, m.person_id from public.audience_members(b.audience, b.centre_id) m where m.blocker is null;
  get diagnostics n = row_count;
  update public.broadcasts set recipient_count = n where id = p_id;
  return n;
end;
$$;

-- Sends it on its way: straight to the schedule when it is small and written by the office, otherwise to a second person.
create function public.broadcast_submit(p_id uuid, p_send_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.broadcasts%rowtype;
  s public.reminder_settings := public.reminder_cfg();
  v_role text := public.broadcast_role();
  v_count integer;
  v_needs boolean;
  v_at timestamptz := coalesce(p_send_at, now());
  v_hour integer;
begin
  if uid is null or v_role is null then
    raise exception 'Only the office or a community champion can send announcements' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id for update;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  if b.status not in ('draft', 'rejected') then
    raise exception 'This announcement has already been sent for approval or sent' using errcode = '22023';
  end if;
  perform public.wording_check(b.subject, b.paragraphs, b.button_label, array['first_name', 'tribe', 'season_starts', 'my_page']);
  perform public.audience_for_caller(b.audience);

  if p_send_at is not null then
    if p_send_at < now() - interval '2 minutes' then
      raise exception 'Choose a time that has not passed' using errcode = '22023';
    end if;
    if p_send_at > now() + interval '90 days' then
      raise exception 'Choose a time within the next 90 days' using errcode = '22023';
    end if;
    v_hour := extract(hour from (p_send_at at time zone 'Africa/Lagos'))::integer;
    if v_hour < s.bulk_start_hour or v_hour >= s.bulk_end_hour then
      raise exception 'Announcements go out between % and % Lagos time. Choose a time in that window.',
        to_char(make_time(s.bulk_start_hour, 0, 0), 'FMHH12 am'), to_char(make_time(s.bulk_end_hour, 0, 0), 'FMHH12 pm') using errcode = '22023';
    end if;
  end if;

  select count(*) into v_count from public.audience_members(b.audience, b.centre_id) m where m.blocker is null;
  if v_count = 0 then
    raise exception 'No one matches this group right now, so there is nobody to send it to' using errcode = '22023';
  end if;
  v_needs := v_count >= s.approval_threshold or v_role = 'champion';

  if v_needs then
    update public.broadcasts
       set status = 'awaiting_approval', needs_approval = true, scheduled_for = v_at, snapshot_count = v_count,
           reject_note = null
     where id = p_id;
    perform public.write_event(uid, 'broadcast.submitted', 'broadcast', p_id::text, jsonb_build_object('count', v_count));
    -- Approvers hear about it.
    perform public.enqueue_message(r.person_id, 'broadcast_waiting', jsonb_build_object('count', v_count, 'title', b.title),
      null, 'bcw:' || p_id::text || ':' || r.person_id::text, null, 'normal', 'email')
      from (select distinct pr.person_id from public.person_roles pr
             join public.people pe on pe.id = pr.person_id
            where pr.role in ('admin', 'director', 'pastor') and pe.centre_id = b.centre_id and pr.person_id <> uid) r;
    return jsonb_build_object('status', 'awaiting_approval', 'count', v_count);
  end if;

  update public.broadcasts
     set status = 'scheduled', needs_approval = false, scheduled_for = v_at, snapshot_count = v_count,
         approved_by = uid, approved_at = now(), reject_note = null
   where id = p_id;
  perform public.broadcast_freeze(p_id);
  perform public.write_event(uid, 'broadcast.scheduled', 'broadcast', p_id::text, jsonb_build_object('count', v_count));
  return jsonb_build_object('status', 'scheduled', 'count', v_count);
end;
$$;

create function public.broadcast_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.broadcasts%rowtype;
  n integer;
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can approve an announcement' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id and centre_id = public.my_centre() for update;
  if not found then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  if b.status <> 'awaiting_approval' then
    raise exception 'This announcement is not waiting for approval' using errcode = '22023';
  end if;
  if b.created_by = uid then
    raise exception 'A different person has to approve your announcement. Ask a colleague.' using errcode = '42501';
  end if;
  update public.broadcasts
     set status = 'scheduled', approved_by = uid, approved_at = now(),
         scheduled_for = greatest(coalesce(scheduled_for, now()), now())
   where id = p_id;
  n := public.broadcast_freeze(p_id);
  if n = 0 then
    update public.broadcasts set status = 'cancelled', finished_at = now() where id = p_id;
    raise exception 'No one matches this group any more, so it was not sent' using errcode = '22023';
  end if;
  perform public.write_event(uid, 'broadcast.approved', 'broadcast', p_id::text, jsonb_build_object('count', n));
  return jsonb_build_object('status', 'scheduled', 'count', n);
end;
$$;

create function public.broadcast_reject(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can send an announcement back' using errcode = '42501';
  end if;
  if v_note is null or char_length(v_note) > 300 then
    raise exception 'Say in a sentence what to change (up to 300 characters)' using errcode = '22023';
  end if;
  update public.broadcasts set status = 'rejected', reject_note = v_note
   where id = p_id and centre_id = public.my_centre() and status = 'awaiting_approval';
  if not found then
    raise exception 'This announcement is not waiting for approval' using errcode = '22023';
  end if;
  perform public.write_event(uid, 'broadcast.rejected', 'broadcast', p_id::text, '{}'::jsonb);
end;
$$;

-- Pause stops releasing; resume carries on; cancel leaves out everyone not yet sent.
create function public.broadcast_control(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.broadcasts%rowtype;
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can pause or cancel an announcement' using errcode = '42501';
  end if;
  if p_action not in ('pause', 'resume', 'cancel') then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into b from public.broadcasts where id = p_id and centre_id = public.my_centre() for update;
  if not found then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;

  if p_action = 'pause' then
    if b.status not in ('scheduled', 'sending') then
      raise exception 'Only an announcement that is scheduled or going out can be paused' using errcode = '22023';
    end if;
    update public.broadcasts set status = 'paused', stopped_by = uid where id = p_id;
  elsif p_action = 'resume' then
    if b.status <> 'paused' then
      raise exception 'This announcement is not paused' using errcode = '22023';
    end if;
    update public.broadcasts set status = case when started_at is null then 'scheduled' else 'sending' end, stopped_by = null where id = p_id;
  else
    if b.status not in ('awaiting_approval', 'scheduled', 'sending', 'paused', 'draft', 'rejected') then
      raise exception 'This announcement has finished, so there is nothing to cancel' using errcode = '22023';
    end if;
    update public.broadcasts set status = 'cancelled', stopped_by = uid, finished_at = now() where id = p_id;
    update public.broadcast_recipients set status = 'cancelled', reason = 'cancelled' where broadcast_id = p_id and status = 'pending';
    update public.messages m set status = 'skipped', error = 'announcement cancelled'
      from public.broadcast_recipients r
     where r.broadcast_id = p_id and r.message_id = m.id and m.status = 'queued';
  end if;
  perform public.write_event(uid, 'broadcast.' || p_action, 'broadcast', p_id::text, '{}'::jsonb);
end;
$$;

-- A test to the person writing it. It carries "test" in the subject and counts toward nothing.
create function public.broadcast_test_send(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  b public.broadcasts%rowtype;
  v_n integer;
begin
  if uid is null or public.broadcast_role() is null then
    raise exception 'Only the office or a community champion can send a test' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  perform public.wording_check(b.subject, b.paragraphs, b.button_label, array['first_name', 'tribe', 'season_starts', 'my_page']);
  select count(*) into v_n from public.messages m
   where m.person_id = uid and m.template = 'office_message' and m.params ? 'test' and m.created_at > now() - interval '1 hour';
  if v_n >= 5 then
    raise exception 'That is 5 tests in the last hour. Give it a little while.' using errcode = '22023';
  end if;
  perform public.enqueue_message(uid, 'office_message',
    jsonb_build_object('test', true, 'broadcast_id', p_id), null, null, null, 'normal', 'email');
end;
$$;

-- All announcements, newest first, with their results so far.
create function public.broadcast_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (public.broadcast_role() is not null or public.has_role('data_lead')) then
    raise exception 'Only the office can see announcements' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by (row ->> 'created_at') desc) from (
      select jsonb_build_object(
        'id', b.id, 'title', b.title, 'subject', b.subject, 'audience_label', b.audience_label, 'status', b.status,
        'needs_approval', b.needs_approval, 'scheduled_for', b.scheduled_for, 'started_at', b.started_at,
        'finished_at', b.finished_at, 'snapshot_count', b.snapshot_count, 'recipient_count', b.recipient_count,
        'created_by', public.person_display_name(b.created_by), 'created_by_me', b.created_by = auth.uid(),
        'created_at', b.created_at,
        'sent', (select count(*) from public.broadcast_recipients r join public.messages m on m.id = r.message_id
                  where r.broadcast_id = b.id and m.status in ('sent', 'delivered', 'read')),
        'queued', (select count(*) from public.broadcast_recipients r where r.broadcast_id = b.id and r.status in ('pending', 'queued'))) as row
        from public.broadcasts b
       where b.centre_id = public.my_centre()
         and (public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) or b.created_by = auth.uid())
       order by b.created_at desc
       limit 100) x), '[]'::jsonb);
end;
$$;

-- Results of one announcement. "Final" seven days after it finishes: people act later than they open.
create function public.broadcast_results(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
  r jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'frozen', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id),
    'waiting', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id and x.status in ('pending', 'queued')
                   and not exists (select 1 from public.messages m where m.id = x.message_id and m.status in ('sent', 'delivered', 'read', 'failed', 'skipped'))),
    'sent', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
              where x.broadcast_id = p_id and m.status in ('sent', 'delivered', 'read')),
    'delivered', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                   where x.broadcast_id = p_id and m.status in ('delivered', 'read')),
    'bounced', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                 where x.broadcast_id = p_id and m.status = 'failed'),
    'left_out', coalesce((select jsonb_object_agg(z.reason, z.n) from (
                  select coalesce(x.reason, 'other') as reason, count(*) as n from public.broadcast_recipients x
                   where x.broadcast_id = p_id and x.status in ('skipped', 'cancelled') group by 1) z), '{}'::jsonb),
    'unsubscribed', (select count(*) from public.email_signals e where e.broadcast_id = p_id and e.kind = 'unsubscribe'),
    'tapped', (select count(distinct l.person_id) from public.email_links l where l.broadcast_id = p_id and l.kind = 'go' and l.clicks > 0),
    'final_at', b.finished_at + interval '7 days') into r;
  return r;
end;
$$;

-- Announcements waiting for a second person: the group, the count and the wording exactly as it will go.
create function public.broadcast_approvals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can see announcements waiting for approval' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'subject', b.subject, 'paragraphs', to_jsonb(b.paragraphs),
      'button_label', b.button_label, 'button_target', b.button_target, 'audience_label', b.audience_label,
      'count', b.snapshot_count, 'scheduled_for', b.scheduled_for, 'created_by', public.person_display_name(b.created_by),
      'mine', b.created_by = auth.uid(), 'created_at', b.created_at,
      'sample', public.broadcast_vars((select m.person_id from public.audience_members(b.audience, b.centre_id) m where m.blocker is null order by md5(m.person_id::text) limit 1))
    ) order by b.created_at)
      from public.broadcasts b where b.centre_id = public.my_centre() and b.status = 'awaiting_approval'), '[]'::jsonb);
end;
$$;

-- Audience rules the office reuses. The rule, never the people.
create function public.audiences_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.broadcast_role() <> 'office' then
    raise exception 'Only the office keeps saved groups' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'spec', a.spec, 'label', a.label) order by a.name)
                     from public.saved_audiences a where a.centre_id = public.my_centre()), '[]'::jsonb);
end;
$$;

create function public.audience_save(p_name text, p_spec jsonb, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if uid is null or public.broadcast_role() <> 'office' then
    raise exception 'Only the office keeps saved groups' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Give the group a name of 2 to 60 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.saved_audiences a where a.centre_id = public.my_centre()) >= 40 then
    raise exception 'You have 40 saved groups. Remove one you no longer use.' using errcode = '22023';
  end if;
  insert into public.saved_audiences (centre_id, name, spec, label, created_by)
  values (public.my_centre(), v_name, public.audience_clean(p_spec), left(coalesce(p_label, ''), 160), uid)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.audience_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.broadcast_role() <> 'office' then
    raise exception 'Only the office keeps saved groups' using errcode = '42501';
  end if;
  delete from public.saved_audiences where id = p_id and centre_id = public.my_centre();
end;
$$;

-- =============================================================================
-- Links inside emails
-- =============================================================================

-- Makes a link and keeps only its hash. The plain link exists for as long as it takes to write the email.
create function public.make_email_link(
  p_person uuid, p_kind text, p_scope text, p_run uuid default null, p_broadcast uuid default null, p_days integer default 45)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.email_links (person_id, kind, scope, run_id, broadcast_id, token_hash, expires_at)
  values (p_person, p_kind, p_scope, p_run, p_broadcast, public.referee_token_hash(v_token), now() + make_interval(days => p_days));
  return v_token;
end;
$$;

-- =============================================================================
-- Journeys: who is in one, what is true of them now, and when each email is due
-- =============================================================================

-- Where the person stands now: 'ok' (still the right moment), 'acted' (they did the thing), or 'ended:<why>'.
create function public.journey_state(r public.journey_runs)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  v_block text;
  v_today date := public.today_lagos();
  la public.leader_applications%rowtype;
  cm public.tribe_members%rowtype;
  se public.seasons%rowtype;
  v_updated timestamptz;
begin
  v_block := public.message_blocker(r.person_id);
  if v_block is not null then
    return 'ended:' || v_block;
  end if;
  if public.reminder_stopped(r.person_id, 'reminders') then
    return 'ended:opted_out';
  end if;

  if r.journey_key = 'member_form' then
    if exists (select 1 from public.member_profiles mp where mp.person_id = r.person_id) then
      return 'acted';
    end if;
    select d.updated_at into v_updated from public.intake_drafts d where d.person_id = r.person_id;
    if not found then
      return 'ended:draft_gone';
    end if;
    -- They came back and did something: they are not lost, so the reminders stop. If they go quiet again a new run can begin.
    if r.seen_at is not null and v_updated > r.seen_at then
      return 'ended:returned';
    end if;

  elsif r.journey_key = 'leader_application' then
    select * into la from public.leader_applications where id = r.ref_id;
    if not found then
      return 'ended:withdrawn';
    end if;
    if la.status = 'ineligible' then
      return 'ended:ineligible';
    elsif la.status <> 'draft' then
      return 'acted';
    end if;
    if r.seen_at is not null and la.updated_at > r.seen_at then
      return 'ended:returned';
    end if;
    if s.applications_close_on is not null and s.applications_close_on < v_today then
      return 'ended:closed';
    end if;

  elsif r.journey_key = 'no_tribe' then
    if exists (select 1 from public.tribe_members c join public.seasons x on x.id = c.season_id
                where c.person_id = r.person_id and c.status = 'active' and x.status <> 'closed') then
      return 'acted';
    end if;
    select x.* into se from public.member_profiles mp join public.seasons x on x.id = mp.season_id where mp.person_id = r.person_id;
    if not found then
      return 'ended:draft_gone';
    end if;
    if exists (select 1 from public.match_demand md where md.person_id = r.person_id) then
      return 'ended:no_fit';
    end if;
    if se.status = 'closed' or v_today > se.starts_on + s.joining_closes_days then
      return 'ended:closed';
    end if;

  elsif r.journey_key = 'in_tribe' then
    select * into cm from public.tribe_members where id = r.ref_id;
    if not found or cm.status <> 'active' then
      return 'ended:left';
    end if;
    select * into se from public.seasons where id = cm.season_id;
    if se.status = 'closed' then
      return 'ended:over';
    end if;
    if exists (select 1 from public.week_steps w where w.person_id = r.person_id and w.tribe_id = cm.tribe_id)
       or exists (select 1 from public.tribe_attendance a where a.person_id = r.person_id and a.tribe_id = cm.tribe_id and a.status = 'present') then
      return 'acted';
    end if;
  end if;
  return 'ok';
end;
$$;

-- Records what became of a run once its state is known.
create function public.journey_apply_state(p_run uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state = 'acted' then
    update public.journey_runs set status = 'acted', acted_at = now(), ended_at = now() where id = p_run and status = 'active';
  elsif p_state like 'ended:%' then
    update public.journey_runs set status = 'stopped', end_reason = substr(p_state, 7), ended_at = now() where id = p_run and status = 'active';
  end if;
end;
$$;

-- When email n of a run is due. The last email of two journeys can move earlier so it lands three days before a deadline.
create function public.journey_due_at(r public.journey_runs, n integer)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j public.journeys%rowtype;
  s public.reminder_settings := public.reminder_cfg();
  v_due timestamptz;
  v_close date;
  v_floor timestamptz;
begin
  select * into j from public.journeys where key = r.journey_key;
  v_due := r.base_at + make_interval(days => j.day_offsets[n]);
  if n = 4 then
    if r.journey_key = 'leader_application' then
      v_close := s.applications_close_on;
    elsif r.journey_key = 'no_tribe' then
      select se.starts_on + s.joining_closes_days into v_close
        from public.member_profiles mp join public.seasons se on se.id = mp.season_id where mp.person_id = r.person_id;
    end if;
    if v_close is not null then
      v_floor := r.base_at + make_interval(days => j.day_offsets[3]) + interval '1 day';
      v_due := greatest(least(v_due, (v_close::timestamp at time zone 'Africa/Lagos') - interval '3 days'), v_floor);
    end if;
  end if;
  return v_due;
end;
$$;

-- The facts an email needs, as plain values. The words around them are put together by the app.
create function public.journey_data(r public.journey_runs)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- Everything the sending service needs to write an email, worked out at the moment it is claimed:
-- the live wording, the facts, and fresh links. Also the last check: if the moment has passed, the email is not sent.
create function public.claim_prepare(m public.messages)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  r public.journey_runs;
  b public.broadcasts;
  e public.journey_emails;
  v_state text;
  v_step integer;
  v_data jsonb;
  v_copy jsonb;
  v_links jsonb := '{}'::jsonb;
  v_action text;
  v_blocker text;
begin
  if m.person_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no person');
  end if;

  if m.template = 'reminder_email' then
    select * into r from public.journey_runs where id = nullif(m.params ->> 'run_id', '')::uuid;
    if not found or r.status <> 'active' then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    v_state := public.journey_state(r);
    if v_state <> 'ok' then
      perform public.journey_apply_state(r.id, v_state);
      update public.journey_sends set kind = 'skipped', reason = left(coalesce(substr(v_state, 7), 'acted'), 60) where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'condition changed: ' || v_state);
    end if;
    if not public.send_window_ok('reminder') then
      return jsonb_build_object('ok', false, 'defer', true);
    end if;
    v_step := nullif(m.params ->> 'step', '')::integer;
    select * into e from public.journey_emails x where x.journey_key = r.journey_key and x.step = v_step;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no wording');
    end if;
    v_data := public.journey_data(r);
    if r.journey_key = 'no_tribe' and v_step = 3 and coalesce((v_data ->> 'seats_left')::integer, 0) <= 0 then
      update public.journey_sends set kind = 'skipped', reason = 'no seats left' where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'the best match has no seats left');
    end if;
    v_copy := jsonb_build_object('subject', e.subject, 'paragraphs', to_jsonb(e.paragraphs), 'button_label', e.button_label,
      'actions', to_jsonb(e.actions), 'tone', e.tone, 'step', v_step, 'journey', r.journey_key);
    if e.target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', e.target, r.id, null, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'reminders', r.id, null, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', r.id, null, 400));
    foreach v_action in array e.actions loop
      v_links := v_links || jsonb_build_object(v_action, public.make_email_link(m.person_id, 'ask', v_action, r.id, null, 90));
    end loop;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'reminder', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));

  elsif m.template = 'office_message' then
    select * into b from public.broadcasts where id = nullif(m.params ->> 'broadcast_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'announcement is gone');
    end if;
    if not (m.params ? 'test') then
      if b.status = 'paused' then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
      if b.status not in ('scheduled', 'sending', 'sent') then
        update public.broadcast_recipients set status = 'skipped', reason = 'cancelled' where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', 'announcement ' || b.status);
      end if;
      v_blocker := coalesce(public.message_blocker(m.person_id), case when public.reminder_stopped(m.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', v_blocker);
      end if;
      if not public.send_window_ok('bulk') then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
    end if;
    v_data := public.broadcast_vars(m.person_id);
    v_copy := jsonb_build_object('subject', (case when m.params ? 'test' then '[Test] ' else '' end) || b.subject,
      'paragraphs', to_jsonb(b.paragraphs), 'button_label', b.button_label, 'actions', '[]'::jsonb, 'tone', 'office', 'step', 0);
    if b.button_target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', b.button_target, null, case when m.params ? 'test' then null else b.id end, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'announcements', null, case when m.params ? 'test' then null else b.id end, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', null, null, 400));
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'announcement', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));
  end if;
  return jsonb_build_object('ok', true, 'params', '{}'::jsonb);
end;
$$;

-- =============================================================================
-- The sending service's claim, with one addition: reminders and announcements are prepared and re-checked here
-- =============================================================================

create or replace function public.worker_claim(p_token text, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_hour integer := public.lagos_hour();
  v_channels text[];
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_first text;
  v_prep jsonb;
  v_extra jsonb;
begin
  perform public.worker_ok(p_token);

  for m in
    select * from public.messages x
     where ((x.status = 'queued' and x.scheduled_for <= now())
         or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'))
       -- quiet hours: nothing but urgent messages between 22:00 and 06:00 in Lagos
       and (x.urgency = 'urgent' or v_hour between 6 and 21)
     order by (x.urgency = 'urgent') desc, x.scheduled_for
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  loop
    v_extra := null;
    if m.template in ('reminder_email', 'office_message') then
      v_prep := public.claim_prepare(m);
      if (v_prep ->> 'ok')::boolean is not true then
        if (v_prep ->> 'defer')::boolean is true then
          update public.messages set status = 'queued', claimed_at = null, scheduled_for = now() + interval '15 minutes' where id = m.id;
        else
          update public.messages set status = 'skipped', error = left(coalesce(v_prep ->> 'reason', 'left out'), 300), channel = null where id = m.id;
        end if;
        continue;
      end if;
      v_extra := v_prep -> 'params';
    end if;

    v_channels := public.message_channels(m.id);
    if cardinality(v_channels) = 0 then
      update public.messages
         set status = case when m.urgency = 'urgent' then 'failed' else 'skipped' end,
             error = coalesce(nullif(m.error, ''), 'no channel the person has agreed to'),
             channel = null
       where id = m.id;
      continue;
    end if;

    update public.messages
       set status = 'sending', channel = v_channels[1], claimed_at = now(), attempts = m.attempts + 1
     where id = m.id;

    if m.person_id is not null then
      select p.email, public.person_display_name(p.id), public.first_name_of(p.id), cp.phone
        into v_email, v_name, v_first, v_phone
        from public.people p
        left join public.contact_preferences cp on cp.person_id = p.id
       where p.id = m.person_id;
    else
      v_email := m.to_email;
      v_phone := m.to_phone;
      v_name := m.to_name;
      v_first := split_part(coalesce(m.to_name, ''), ' ', 1);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', m.id,
      'template', m.template,
      'channel', v_channels[1],
      'params', m.params || coalesce(v_extra, '{}'::jsonb),
      'urgency', m.urgency,
      'attempts', m.attempts + 1,
      'reply_token', m.reply_token,
      'to', jsonb_build_object('email', v_email, 'phone', v_phone, 'name', v_name, 'first_name', nullif(v_first, ''))));
  end loop;
  return v_out;
end;
$$;

-- =============================================================================
-- The heartbeat: bring people into journeys, move them along, release announcements
-- =============================================================================

-- Whether a person may begin a journey now: not in another, not left out, not told to stop, and not run through it too often.
create function public.journey_may_enter(p_person uuid, p_key text, p_rehearsal boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.journey_runs r where r.person_id = p_person and r.status = 'active')
     and not exists (select 1 from public.journey_runs r where r.person_id = p_person and r.journey_key = p_key and r.status = 'declined' and not r.rehearsal)
     and (select count(*) from public.journey_runs r where r.person_id = p_person and r.journey_key = p_key and r.rehearsal = p_rehearsal) < 2
     and public.message_blocker(p_person) is null
     and not public.reminder_stopped(p_person, 'reminders');
$$;

create function public.journeys_enter()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.journeys%rowtype;
  s public.reminder_settings := public.reminder_cfg();
  v_rehearsal boolean;
  v_today date := public.today_lagos();
  v_n integer;
  v_total integer := 0;
begin
  -- Switching a journey on ends its rehearsal runs first, so those people can start for real in the same pass.
  update public.journey_runs r set status = 'stopped', end_reason = 'rehearsal_ended', ended_at = now()
   where r.rehearsal and r.status = 'active'
     and exists (select 1 from public.journeys jj where jj.key = r.journey_key and jj.mode = 'on');
  for j in select * from public.journeys where mode in ('rehearsal', 'on') order by position loop
    v_rehearsal := j.mode = 'rehearsal';
    v_n := 0;

    if j.key = 'member_form' then
      insert into public.journey_runs (journey_key, person_id, base_at, seen_at, expires_at, rehearsal, holdout, run_no)
      select j.key, d.person_id,
             greatest(d.updated_at, now() - make_interval(days => j.day_offsets[1])), d.updated_at,
             greatest(d.updated_at, now() - make_interval(days => j.day_offsets[1])) + make_interval(days => j.day_offsets[4] + 7),
             v_rehearsal, (not v_rehearsal) and public.is_holdout(d.person_id, j.key),
             1 + (select count(*) from public.journey_runs o where o.person_id = d.person_id and o.journey_key = j.key and o.rehearsal = v_rehearsal)::smallint
        from public.intake_drafts d
       where d.updated_at <= now() - make_interval(days => j.day_offsets[1])
         and not exists (select 1 from public.member_profiles mp where mp.person_id = d.person_id)
         and public.journey_may_enter(d.person_id, j.key, v_rehearsal)
       limit 500
      on conflict do nothing;

    elsif j.key = 'leader_application' then
      if s.applications_close_on is null or s.applications_close_on >= v_today then
        insert into public.journey_runs (journey_key, person_id, base_at, seen_at, ref_id, expires_at, rehearsal, holdout, run_no)
        select j.key, la.person_id,
               greatest(la.updated_at, now() - make_interval(days => j.day_offsets[1])), la.updated_at, la.id,
               greatest(la.updated_at, now() - make_interval(days => j.day_offsets[1])) + make_interval(days => j.day_offsets[4] + 7),
               v_rehearsal, (not v_rehearsal) and public.is_holdout(la.person_id, j.key),
               1 + (select count(*) from public.journey_runs o where o.person_id = la.person_id and o.journey_key = j.key and o.rehearsal = v_rehearsal)::smallint
          from public.leader_applications la
         where la.status = 'draft'
           and la.updated_at <= now() - make_interval(days => j.day_offsets[1])
           and public.journey_may_enter(la.person_id, j.key, v_rehearsal)
         limit 500
        on conflict do nothing;
      end if;

    elsif j.key = 'no_tribe' then
      insert into public.journey_runs (journey_key, person_id, base_at, expires_at, rehearsal, holdout, run_no)
      select j.key, mp.person_id,
             greatest(mp.submitted_at, now() - make_interval(days => j.day_offsets[1])),
             greatest(mp.submitted_at, now() - make_interval(days => j.day_offsets[1])) + make_interval(days => j.day_offsets[4] + 7),
             v_rehearsal, (not v_rehearsal) and public.is_holdout(mp.person_id, j.key),
             1 + (select count(*) from public.journey_runs o where o.person_id = mp.person_id and o.journey_key = j.key and o.rehearsal = v_rehearsal)::smallint
        from public.member_profiles mp join public.seasons se on se.id = mp.season_id
       where mp.submitted_at <= now() - make_interval(days => j.day_offsets[1])
         and se.status in ('planning', 'open', 'running')
         and v_today <= se.starts_on + s.joining_closes_days
         and exists (select 1 from public.match_recommendations mr where mr.person_id = mp.person_id)
         and not exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
         and not exists (select 1 from public.tribe_members cm join public.seasons x on x.id = cm.season_id
                          where cm.person_id = mp.person_id and cm.status = 'active' and x.status <> 'closed')
         and public.journey_may_enter(mp.person_id, j.key, v_rehearsal)
       limit 500
      on conflict do nothing;

    elsif j.key = 'in_tribe' then
      insert into public.journey_runs (journey_key, person_id, base_at, ref_id, expires_at, rehearsal, holdout, run_no)
      select j.key, cm.person_id,
             greatest((se.starts_on::timestamp at time zone 'Africa/Lagos'), now() - make_interval(days => j.day_offsets[1])), cm.id,
             least(greatest((se.starts_on::timestamp at time zone 'Africa/Lagos'), now() - make_interval(days => j.day_offsets[1])) + make_interval(days => j.day_offsets[4] + 7),
                   (se.starts_on::timestamp at time zone 'Africa/Lagos') + interval '17 days'),
             v_rehearsal, (not v_rehearsal) and public.is_holdout(cm.person_id, j.key),
             1 + (select count(*) from public.journey_runs o where o.person_id = cm.person_id and o.journey_key = j.key and o.rehearsal = v_rehearsal)::smallint
        from public.tribe_members cm join public.seasons se on se.id = cm.season_id
       where cm.status = 'active' and se.status in ('open', 'running')
         and now() >= (se.starts_on::timestamp at time zone 'Africa/Lagos') + make_interval(days => j.day_offsets[1])
         and now() < (se.starts_on::timestamp at time zone 'Africa/Lagos') + make_interval(days => j.day_offsets[4])
         and not exists (select 1 from public.week_steps w where w.person_id = cm.person_id and w.tribe_id = cm.tribe_id)
         and not exists (select 1 from public.tribe_attendance a where a.person_id = cm.person_id and a.tribe_id = cm.tribe_id and a.status = 'present')
         and public.journey_may_enter(cm.person_id, j.key, v_rehearsal)
       limit 500
      on conflict do nothing;
    end if;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

-- Moves every active run on: stops it if the person has acted or must be left alone, otherwise sends or rehearses the next email when due.
create function public.journeys_advance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.journey_runs;
  j public.journeys%rowtype;
  v_state text;
  v_n integer;
  v_due timestamptz;
  v_msg uuid;
  v_sent integer := 0;
  v_rehearsed integer := 0;
  v_skipped integer := 0;
  v_ended integer := 0;
  v_window boolean := public.send_window_ok('reminder');
  v_cid uuid;
begin
  for r in select * from public.journey_runs where status = 'active' order by started_at limit 3000 for update skip locked loop
    select * into j from public.journeys where key = r.journey_key;
    if j.mode = 'off' then
      continue;
    end if;
    if r.rehearsal and j.mode = 'on' then
      update public.journey_runs set status = 'stopped', end_reason = 'rehearsal_ended', ended_at = now() where id = r.id;
      v_ended := v_ended + 1;
      continue;
    end if;
    if not r.rehearsal and j.mode = 'rehearsal' then
      continue;
    end if;

    v_state := public.journey_state(r);
    if v_state <> 'ok' then
      perform public.journey_apply_state(r.id, v_state);
      v_ended := v_ended + 1;
      continue;
    end if;

    if r.expires_at < now() then
      update public.journey_runs
         set status = case when step_done >= 4 or holdout then 'completed' else 'stopped' end,
             end_reason = case when holdout then 'holdout' when step_done >= 4 then null else 'expired' end, ended_at = now()
       where id = r.id;
      v_ended := v_ended + 1;
      continue;
    end if;

    if r.holdout then
      continue;
    end if;
    v_n := r.step_done + 1;
    if v_n > 4 then
      continue;
    end if;
    v_due := public.journey_due_at(r, v_n);
    if now() < v_due or not v_window then
      continue;
    end if;
    -- Missed its moment by days (the window or a cap kept it back): leave this one out rather than send it late.
    if v_due < now() - interval '3 days' then
      insert into public.journey_sends (run_id, step, kind, reason) values (r.id, v_n, 'skipped', 'too late') on conflict do nothing;
      update public.journey_runs set step_done = v_n where id = r.id;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if r.rehearsal then
      insert into public.journey_sends (run_id, step, kind) values (r.id, v_n, 'rehearsal') on conflict do nothing;
      update public.journey_runs set step_done = v_n, last_sent_at = now() where id = r.id;
      v_rehearsed := v_rehearsed + 1;
      continue;
    end if;

    if not public.person_cap_ok(r.person_id, 'reminder') then
      continue;
    end if;

    v_msg := public.enqueue_message(r.person_id, 'reminder_email',
      jsonb_build_object('run_id', r.id, 'step', v_n, 'journey', r.journey_key), null,
      'jr:' || r.id::text || ':' || v_n::text, now(), 'normal', 'email');
    insert into public.journey_sends (run_id, step, kind, message_id) values (r.id, v_n, 'sent', v_msg) on conflict do nothing;
    update public.journey_runs set step_done = v_n, last_sent_at = now() where id = r.id;
    v_sent := v_sent + 1;

    -- The third email of the last journey also puts the person on their leader's "call first" list.
    if r.journey_key = 'in_tribe' and v_n = 3 then
      select cm.tribe_id into v_cid from public.tribe_members cm where cm.id = r.ref_id;
      if v_cid is not null then
        insert into public.care_flags (tribe_id, person_id, kind, week) values (v_cid, r.person_id, 'quiet_start', 1)
        on conflict (person_id, tribe_id, kind) where status <> 'closed' do nothing;
      end if;
    end if;
  end loop;

  -- Runs whose last email went more than a week ago have had their time to work.
  update public.journey_runs set status = 'completed', ended_at = now()
   where status = 'active' and step_done >= 4 and not holdout and last_sent_at < now() - interval '7 days';

  return jsonb_build_object('sent', v_sent, 'rehearsed', v_rehearsed, 'skipped', v_skipped, 'ended', v_ended);
end;
$$;

-- A journey pauses itself when more than 1 in 100 people unsubscribe, or 1 in 1,000 complain, on the same day.
-- It tells the director. (Tiny numbers are ignored: three people do not make a trend.)
create function public.journeys_self_check()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.journeys%rowtype;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos';
  v_sent integer;
  v_unsub integer;
  v_comp integer;
  v_why text;
  n integer := 0;
begin
  for j in select * from public.journeys where mode = 'on' loop
    select count(*) into v_sent from public.journey_sends js join public.journey_runs r on r.id = js.run_id
     where r.journey_key = j.key and js.kind = 'sent' and js.at >= v_day;
    if v_sent < 50 then
      continue;
    end if;
    select count(*) filter (where kind = 'unsubscribe'), count(*) filter (where kind = 'complaint') into v_unsub, v_comp
      from public.email_signals where journey_key = j.key and created_at >= v_day;
    v_why := null;
    if v_unsub * 100.0 / v_sent > 1 then
      v_why := format('%s people stopped these emails out of %s sent today (more than 1 in 100).', v_unsub, v_sent);
    elsif v_comp * 1000.0 / v_sent > 1 then
      v_why := format('%s people marked these emails as spam out of %s sent today (more than 1 in 1,000).', v_comp, v_sent);
    end if;
    if v_why is not null then
      update public.journeys set mode = 'off', paused_reason = v_why, paused_at = now(), updated_at = now() where key = j.key;
      perform public.write_event(null, 'journey.self_paused', 'journey', j.key, jsonb_build_object('unsubscribed', v_unsub, 'complaints', v_comp, 'sent', v_sent));
      perform public.signin_alert_staff('reminder_paused', jsonb_build_object('journey', j.title, 'why', v_why),
        'rp:' || j.key || ':' || (v_day)::date::text, array['director']::public.app_role[]);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Hands announcements to the outbox, a little at a time, so a send of thousands never floods the email provider.
create function public.broadcasts_release()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  b public.broadcasts%rowtype;
  rec record;
  v_quota integer;
  v_blocker text;
  v_msg uuid;
  v_total integer := 0;
  v_left integer;
begin
  if not public.send_window_ok('bulk') then
    return 0;
  end if;
  for b in select * from public.broadcasts x where x.status in ('scheduled', 'sending') and x.scheduled_for <= now() order by x.scheduled_for for update skip locked loop
    if b.status = 'scheduled' then
      update public.broadcasts set status = 'sending', started_at = now(), last_release_at = now() - interval '1 minute' where id = b.id;
      b.last_release_at := now() - interval '1 minute';
    end if;
    v_quota := least(3000, greatest(1, floor(extract(epoch from now() - coalesce(b.last_release_at, now() - interval '1 minute')) / 60.0 * s.bulk_per_minute)::integer));
    for rec in select r.person_id from public.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'pending' order by r.person_id limit v_quota for update skip locked loop
      v_blocker := coalesce(public.message_blocker(rec.person_id),
                            case when public.reminder_stopped(rec.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is null and not public.person_cap_ok(rec.person_id, 'announcement') then
        v_blocker := 'weekly_cap';
      end if;
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
      else
        v_msg := public.enqueue_message(rec.person_id, 'office_message', jsonb_build_object('broadcast_id', b.id), null,
          'bc:' || b.id::text || ':' || rec.person_id::text, now(), 'normal', 'email');
        update public.broadcast_recipients set status = 'queued', message_id = v_msg, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
        v_total := v_total + 1;
      end if;
    end loop;
    update public.broadcasts set last_release_at = now() where id = b.id;
    select count(*) into v_left from public.broadcast_recipients where broadcast_id = b.id and status = 'pending';
    if v_left = 0 then
      update public.broadcasts set status = 'sent', finished_at = now() where id = b.id;
      perform public.write_event(null, 'broadcast.finished', 'broadcast', b.id::text, '{}'::jsonb);
    end if;
  end loop;
  return v_total;
end;
$$;

create function public.worker_reminders_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings;
  v_paused integer;
  v_entered integer;
  v_adv jsonb;
  v_released integer;
begin
  perform public.worker_ok(p_token);
  s := public.reminder_cfg();
  v_paused := public.journeys_self_check();
  v_released := public.broadcasts_release();
  if not s.master_on then
    return jsonb_build_object('master_on', false, 'paused', v_paused, 'released', v_released);
  end if;
  v_entered := public.journeys_enter();
  v_adv := public.journeys_advance();
  return jsonb_build_object('master_on', true, 'paused', v_paused, 'entered', v_entered, 'released', v_released) || v_adv;
end;
$$;

-- =============================================================================
-- What happens when someone taps a link in an email (the public pages; the website proves itself with the sending token)
-- =============================================================================

-- Says no to one kind of email, in the ledger and in the record the journeys watch. Safe to do twice.
create function public.apply_unsubscribe(p_person uuid, p_scope text, p_run uuid, p_broadcast uuid, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journey text;
begin
  if p_scope in ('reminders', 'all') and not public.reminder_stopped(p_person, 'reminders') then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'reminders', false, p_version);
  end if;
  if p_scope in ('announcements', 'all') and not public.reminder_stopped(p_person, 'announcements') then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'announcements', false, p_version);
  end if;
  select r.journey_key into v_journey from public.journey_runs r where r.id = p_run;
  insert into public.email_signals (person_id, kind, journey_key, broadcast_id) values (p_person, 'unsubscribe', v_journey, p_broadcast);
  update public.journey_runs set status = 'stopped', end_reason = 'opted_out', ended_at = now()
   where person_id = p_person and status = 'active' and p_scope in ('reminders', 'all');
end;
$$;

-- Opens a link: what it is for, whom, and where they had got to. Counts the tap (the page, not the answer).
create function public.worker_link_open(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.email_links%rowtype;
  v_email text;
  v_journey text;
  v_step text;
  v_title text;
begin
  perform public.worker_ok(p_token);
  select * into l from public.email_links where token_hash = public.referee_token_hash(p_link) for update;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  update public.email_links set clicks = clicks + 1, first_clicked_at = coalesce(first_clicked_at, now()) where id = l.id;
  select p.email into v_email from public.people p where p.id = l.person_id;
  select r.journey_key into v_journey from public.journey_runs r where r.id = l.run_id;
  if v_journey is null and l.kind = 'ask' then
    select r.journey_key into v_journey from public.journey_runs r where r.person_id = l.person_id order by r.started_at desc limit 1;
  end if;
  if v_journey = 'member_form' then
    select d.step into v_step from public.intake_drafts d where d.person_id = l.person_id;
  elsif v_journey = 'leader_application' then
    select a.step into v_step from public.leader_applications a where a.person_id = l.person_id and a.status = 'draft' order by a.updated_at desc limit 1;
  end if;
  select j.title into v_title from public.journeys j where j.key = v_journey;
  return jsonb_build_object(
    'found', true, 'kind', l.kind, 'scope', l.scope,
    'expired', l.expires_at < now(), 'used', l.used_at is not null,
    'first_name', public.first_name_of(l.person_id),
    -- Enough to recognise their own address, not enough to read it from a forwarded email.
    'email_hint', left(split_part(v_email, '@', 1), 1) || '•••@' || split_part(v_email, '@', 2),
    'journey', v_journey, 'journey_title', v_title, 'step', v_step,
    'switches', jsonb_build_object(
      'reminders', not public.reminder_stopped(l.person_id, 'reminders'),
      'announcements', not public.reminder_stopped(l.person_id, 'announcements'),
      'tribe', not public.email_opted_out(l.person_id)));
end;
$$;

-- Confirms a "stop these emails" or a one-tap answer. Nothing is counted until the person has confirmed on the page.
create function public.worker_link_confirm(p_token text, p_link text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.email_links%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_journey text;
  v_req uuid;
  v_title text;
  v_who text;
  v_to uuid;
begin
  perform public.worker_ok(p_token);
  select * into l from public.email_links where token_hash = public.referee_token_hash(p_link) for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if l.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_reason is not null and v_reason not in ('timing', 'travel', 'other_group', 'not_sure', 'other') then
    v_reason := null;
  end if;

  if l.kind = 'stop' then
    perform public.apply_unsubscribe(l.person_id, l.scope, l.run_id, l.broadcast_id, 'unsub-link');
    update public.email_links set used_at = coalesce(used_at, now()) where id = l.id;
    perform public.write_event(l.person_id, 'email.unsubscribed', 'person', l.person_id::text, jsonb_build_object('scope', l.scope));
    return jsonb_build_object('ok', true, 'kind', 'stop', 'scope', l.scope);
  end if;

  if l.kind = 'ask' then
    select r.journey_key into v_journey from public.journey_runs r where r.id = l.run_id;
    if v_journey is null then
      select r.journey_key into v_journey from public.journey_runs r where r.person_id = l.person_id order by r.started_at desc limit 1;
    end if;
    if v_journey is null then
      return jsonb_build_object('ok', false, 'reason', 'unknown');
    end if;
    -- Pressing twice is the same as pressing once.
    select q.id into v_req from public.journey_requests q
     where q.person_id = l.person_id and q.kind = l.scope and q.created_at > now() - interval '30 days' limit 1;
    if v_req is null then
      insert into public.journey_requests (person_id, journey_key, kind, reason)
      values (l.person_id, v_journey, l.scope, case when l.scope = 'not_season' then v_reason end)
      returning id into v_req;
      if l.scope <> 'not_season' then
        select j.title into v_title from public.journeys j where j.key = v_journey;
        v_who := public.person_display_name(l.person_id);
        for v_to in select public.care_team() loop
          perform public.enqueue_message(v_to, 'journey_ask', jsonb_build_object('kind', l.scope, 'who', v_who, 'journey', v_title),
            null, 'ja:' || v_req::text || ':' || v_to::text, null, 'normal', 'email');
        end loop;
      end if;
    elsif l.scope = 'not_season' and v_reason is not null then
      update public.journey_requests set reason = v_reason where id = v_req and reason is null;
    end if;
    update public.journey_runs
       set status = case when l.scope = 'not_season' then 'declined' else 'stopped' end,
           end_reason = case l.scope when 'not_season' then 'not_season' when 'help_finish' then 'asked_help' else l.scope end,
           ended_at = now()
     where person_id = l.person_id and status = 'active';
    update public.email_links set used_at = coalesce(used_at, now()) where id = l.id;
    perform public.write_event(l.person_id, 'journey.answered', 'person', l.person_id::text, jsonb_build_object('answer', l.scope, 'journey', v_journey));
    return jsonb_build_object('ok', true, 'kind', 'ask', 'scope', l.scope);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'nothing to confirm');
end;
$$;

-- A mail program's own "unsubscribe" button (RFC 8058): one call, no page, no questions.
create function public.worker_unsubscribe_oneclick(p_token text, p_link text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.email_links%rowtype;
begin
  perform public.worker_ok(p_token);
  select * into l from public.email_links where token_hash = public.referee_token_hash(p_link) and kind = 'stop';
  if not found or l.expires_at < now() then
    return false;
  end if;
  perform public.apply_unsubscribe(l.person_id, l.scope, l.run_id, l.broadcast_id, 'unsub-oneclick');
  update public.email_links set used_at = coalesce(used_at, now()), clicks = clicks + 1, first_clicked_at = coalesce(first_clicked_at, now()) where id = l.id;
  perform public.write_event(l.person_id, 'email.unsubscribed', 'person', l.person_id::text, jsonb_build_object('scope', l.scope, 'oneclick', true));
  return true;
end;
$$;

-- The three switches, from the preferences page an email links to.
create function public.worker_prefs_save(p_token text, p_link text, p_reminders boolean, p_announcements boolean, p_tribe boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.email_links%rowtype;
begin
  perform public.worker_ok(p_token);
  select * into l from public.email_links where token_hash = public.referee_token_hash(p_link) and kind = 'prefs';
  if not found or l.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  perform public.set_email_switches(l.person_id, p_reminders, p_announcements, p_tribe, 'prefs-link');
  update public.email_links set used_at = now() where id = l.id;
  return jsonb_build_object('ok', true,
    'switches', jsonb_build_object(
      'reminders', not public.reminder_stopped(l.person_id, 'reminders'),
      'announcements', not public.reminder_stopped(l.person_id, 'announcements'),
      'tribe', not public.email_opted_out(l.person_id)));
end;
$$;

-- Bounces and complaints from the email provider, matched by its message id.
create function public.worker_email_signal(p_token text, p_provider_id text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_journey text;
  v_broadcast uuid;
begin
  perform public.worker_ok(p_token);
  if p_kind not in ('hard_bounce', 'complaint') or p_provider_id is null then
    return;
  end if;
  select * into m from public.messages where provider_id = p_provider_id order by created_at desc limit 1;
  if not found or m.person_id is null then
    return;
  end if;
  if m.template = 'reminder_email' then
    select r.journey_key into v_journey from public.journey_runs r where r.id = nullif(m.params ->> 'run_id', '')::uuid;
  elsif m.template = 'office_message' then
    v_broadcast := nullif(m.params ->> 'broadcast_id', '')::uuid;
    if not exists (select 1 from public.broadcasts b where b.id = v_broadcast) then
      v_broadcast := null;
    end if;
  end if;
  insert into public.email_signals (person_id, kind, journey_key, broadcast_id) values (m.person_id, p_kind, v_journey, v_broadcast);
  if p_kind = 'complaint' then
    perform public.apply_unsubscribe(m.person_id, 'all', null, null, 'complaint');
    -- the signal above already counts; the unsubscribe record would count twice
    delete from public.email_signals where id = (select max(id) from public.email_signals where person_id = m.person_id and kind = 'unsubscribe');
  end if;
end;
$$;

-- =============================================================================
-- A person's own switches (Profile, and the page an email links to)
-- =============================================================================

create function public.set_email_switches(p_person uuid, p_reminders boolean, p_announcements boolean, p_tribe boolean, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_reminders, true) is distinct from (not public.reminder_stopped(p_person, 'reminders')) then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'reminders', coalesce(p_reminders, true), p_version);
    if not coalesce(p_reminders, true) then
      update public.journey_runs set status = 'stopped', end_reason = 'opted_out', ended_at = now() where person_id = p_person and status = 'active';
    end if;
  end if;
  if coalesce(p_announcements, true) is distinct from (not public.reminder_stopped(p_person, 'announcements')) then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'announcements', coalesce(p_announcements, true), p_version);
  end if;
  if coalesce(p_tribe, true) is distinct from (not public.email_opted_out(p_person)) then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'email', coalesce(p_tribe, true), p_version);
  end if;
  perform public.write_event(p_person, 'email.switches', 'person', p_person::text,
    jsonb_build_object('reminders', coalesce(p_reminders, true), 'announcements', coalesce(p_announcements, true), 'tribe', coalesce(p_tribe, true)));
end;
$$;

create function public.my_email_switches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'reminders', not public.reminder_stopped(uid, 'reminders'),
    'announcements', not public.reminder_stopped(uid, 'announcements'),
    'tribe', not public.email_opted_out(uid));
end;
$$;

create function public.save_email_switches(p_reminders boolean, p_announcements boolean, p_tribe boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  perform public.set_email_switches(uid, p_reminders, p_announcements, p_tribe, 'switches-v1');
  return public.my_email_switches();
end;
$$;

-- =============================================================================
-- The office: journeys, their emails, their numbers
-- =============================================================================

create function public.reminders_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]);
$$;

-- The numbers on the Reminders page. Never names.
create function public.reminders_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  v_day timestamptz := (date_trunc('day', now() at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos';
begin
  if not public.reminders_viewer() then
    raise exception 'Only the office can see reminders' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', jsonb_build_object(
      'master_on', s.master_on, 'holdout_pct', s.holdout_pct, 'applications_close_on', s.applications_close_on,
      'joining_closes_days', s.joining_closes_days, 'cap_gap_days', s.cap_gap_days, 'cap_reminders_week', s.cap_reminders_week,
      'cap_nonessential_week', s.cap_nonessential_week, 'reminder_start_hour', s.reminder_start_hour, 'reminder_end_hour', s.reminder_end_hour,
      'sunday_start_hour', s.sunday_start_hour, 'bulk_start_hour', s.bulk_start_hour, 'bulk_end_hour', s.bulk_end_hour,
      'bulk_per_minute', s.bulk_per_minute, 'approval_threshold', s.approval_threshold,
      'church_name', s.church_name, 'church_address', s.church_address),
    'can_change', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'can_edit_words', public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]),
    'can_approve_words', public.has_role('pastor'),
    'can_see_people', public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]),
    'today', jsonb_build_object(
      'sent', (select count(*) from public.journey_sends where kind = 'sent' and at >= v_day),
      'rehearsed', (select count(*) from public.journey_sends where kind = 'rehearsal' and at >= v_day),
      'skipped', (select count(*) from public.journey_sends where kind = 'skipped' and at >= v_day)),
    'asks_open', (select count(*) from public.journey_requests where status = 'open'),
    'journeys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', j.key, 'title', j.title, 'mode', j.mode, 'day_offsets', to_jsonb(j.day_offsets),
        'paused_reason', j.paused_reason, 'paused_at', j.paused_at, 'position', j.position,
        'active', (select count(*) from public.journey_runs r where r.journey_key = j.key and r.status = 'active' and r.rehearsal = (j.mode = 'rehearsal')),
        'entered_30d', (select count(*) from public.journey_runs r where r.journey_key = j.key and not r.rehearsal and r.started_at > now() - interval '30 days'),
        'acted_30d', (select count(*) from public.journey_runs r where r.journey_key = j.key and not r.rehearsal and r.status = 'acted' and r.ended_at > now() - interval '30 days'),
        'unsub_30d', (select count(*) from public.email_signals e where e.journey_key = j.key and e.kind = 'unsubscribe' and e.created_at > now() - interval '30 days'),
        'complaints_30d', (select count(*) from public.email_signals e where e.journey_key = j.key and e.kind = 'complaint' and e.created_at > now() - interval '30 days'),
        'not_season_30d', (select count(*) from public.journey_requests q where q.journey_key = j.key and q.kind = 'not_season' and q.created_at > now() - interval '30 days'),
        'reasons', coalesce((select jsonb_object_agg(x.reason, x.n) from (
            select coalesce(q.reason, 'not_given') as reason, count(*) as n from public.journey_requests q
             where q.journey_key = j.key and q.kind = 'not_season' group by 1) x), '{}'::jsonb),
        'helped', (select count(*) from public.journey_requests q where q.journey_key = j.key and q.kind <> 'not_season'),
        'rehearsal_would_send', (select count(*) from public.journey_sends js join public.journey_runs r on r.id = js.run_id where r.journey_key = j.key and js.kind = 'rehearsal'),
        -- Did the reminders change anything? Of the people left alone and those written to, how many acted within 14 days.
        'treated', (select jsonb_build_object('people', count(*), 'acted', count(*) filter (where r.acted_at <= r.started_at + interval '14 days'))
                      from public.journey_runs r where r.journey_key = j.key and not r.rehearsal and not r.holdout and r.started_at < now() - interval '14 days'),
        'holdout', (select jsonb_build_object('people', count(*), 'acted', count(*) filter (where r.acted_at <= r.started_at + interval '14 days'))
                      from public.journey_runs r where r.journey_key = j.key and not r.rehearsal and r.holdout and r.started_at < now() - interval '14 days'),
        'emails', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'step', e.step, 'tone', e.tone, 'subject', e.subject, 'paragraphs', to_jsonb(e.paragraphs),
            'button_label', e.button_label, 'actions', to_jsonb(e.actions), 'version', e.version, 'pending', e.pending,
            'approved_at', e.approved_at, 'approved_by', public.person_display_name(e.approved_by),
            'sent', (select count(*) from public.journey_sends js join public.journey_runs r on r.id = js.run_id
                      where r.journey_key = j.key and js.step = e.step and js.kind = 'sent'),
            'acted_7d', (select count(*) from public.journey_runs r
                          where r.journey_key = j.key and r.status = 'acted' and not r.rehearsal and r.acted_at is not null
                            and (select js.step from public.journey_sends js
                                  where js.run_id = r.id and js.kind = 'sent' and js.at <= r.acted_at
                                  order by js.at desc limit 1) = e.step
                            and r.acted_at <= (select js.at from public.journey_sends js where js.run_id = r.id and js.kind = 'sent' and js.at <= r.acted_at order by js.at desc limit 1) + interval '7 days'),
            'unsub', (select count(*) from public.email_signals g join public.journey_runs r on r.journey_key = g.journey_key
                       where g.journey_key = j.key and g.kind = 'unsubscribe' and r.step_done = e.step and r.person_id = g.person_id and r.status = 'stopped' and r.end_reason = 'opted_out')
          ) order by e.step) from public.journey_emails e where e.journey_key = j.key), '[]'::jsonb)
      ) order by j.position) from public.journeys j), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by (x ->> 'at') desc) from (
        select jsonb_build_object('at', js.at, 'kind', js.kind, 'step', js.step, 'journey', r.journey_key, 'reason', js.reason,
                                  'who', public.first_name_of(r.person_id)) as x
          from public.journey_sends js join public.journey_runs r on r.id = js.run_id
         order by js.at desc limit 25) y), '[]'::jsonb));
end;
$$;

create function public.journey_set_mode(p_key text, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can switch a journey' using errcode = '42501';
  end if;
  if p_mode not in ('off', 'rehearsal', 'on') then
    raise exception 'Choose Off, Rehearsal or On' using errcode = '22023';
  end if;
  update public.journeys set mode = p_mode, paused_reason = null, paused_at = null, updated_by = uid, updated_at = now() where key = p_key;
  if not found then
    raise exception 'We could not find that journey' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'journey.mode', 'journey', p_key, jsonb_build_object('mode', p_mode));
end;
$$;

create function public.reminders_master(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can use the master switch' using errcode = '42501';
  end if;
  update public.reminder_settings set master_on = coalesce(p_on, true), updated_by = uid, updated_at = now() where id;
  perform public.write_event(uid, 'reminders.master', 'platform', 'reminders', jsonb_build_object('on', coalesce(p_on, true)));
end;
$$;

create function public.journey_set_days(p_key text, p_days integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can change the days' using errcode = '42501';
  end if;
  if p_days is null or cardinality(p_days) <> 4 or p_days[1] < 1 or p_days[1] >= p_days[2] or p_days[2] >= p_days[3] or p_days[3] >= p_days[4] or p_days[4] > 40 then
    raise exception 'Give four days, each later than the one before, the last no later than day 40' using errcode = '22023';
  end if;
  -- An unfinished member form is cleared on day 30, and the last email says so.
  if p_key = 'member_form' and p_days[4] > 28 then
    raise exception 'The last email must go before the form is cleared, so no later than day 28' using errcode = '22023';
  end if;
  if p_key = 'in_tribe' and p_days[4] > 14 then
    raise exception 'This journey ends after the second week, so the last email goes no later than day 14' using errcode = '22023';
  end if;
  update public.journeys set day_offsets = p_days, updated_by = uid, updated_at = now() where key = p_key;
  if not found then
    raise exception 'We could not find that journey' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'journey.days', 'journey', p_key, jsonb_build_object('days', to_jsonb(p_days)));
end;
$$;

create function public.reminder_settings_save(p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.reminder_settings := public.reminder_cfg();
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can change these settings' using errcode = '42501';
  end if;
  begin
    update public.reminder_settings set
      holdout_pct = coalesce((p_fields ->> 'holdout_pct')::smallint, holdout_pct),
      joining_closes_days = coalesce((p_fields ->> 'joining_closes_days')::smallint, joining_closes_days),
      applications_close_on = case when p_fields ? 'applications_close_on' then nullif(p_fields ->> 'applications_close_on', '')::date else applications_close_on end,
      cap_gap_days = coalesce((p_fields ->> 'cap_gap_days')::smallint, cap_gap_days),
      cap_reminders_week = coalesce((p_fields ->> 'cap_reminders_week')::smallint, cap_reminders_week),
      cap_nonessential_week = coalesce((p_fields ->> 'cap_nonessential_week')::smallint, cap_nonessential_week),
      approval_threshold = coalesce((p_fields ->> 'approval_threshold')::integer, approval_threshold),
      bulk_per_minute = coalesce((p_fields ->> 'bulk_per_minute')::smallint, bulk_per_minute),
      church_name = coalesce(nullif(btrim(p_fields ->> 'church_name'), ''), church_name),
      church_address = coalesce(nullif(btrim(p_fields ->> 'church_address'), ''), church_address),
      updated_by = uid, updated_at = now()
     where id;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then
    raise exception 'One of those values is out of range. Check the numbers and try again.' using errcode = '22023';
  end;
  perform public.write_event(uid, 'reminders.settings', 'platform', 'reminders', '{}'::jsonb);
end;
$$;

-- Editing the wording. A pastor's edit is live at once (the pastor is the approver); anyone else's waits for a pastor.
create function public.journey_email_edit(p_id uuid, p_subject text, p_paragraphs text[], p_button text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.journey_emails%rowtype;
  v_button text := nullif(btrim(coalesce(p_button, '')), '');
  v_paras text[];
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can edit the reminder wording' using errcode = '42501';
  end if;
  select * into e from public.journey_emails where id = p_id for update;
  if not found then
    raise exception 'We could not find that email' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(btrim(x) order by ord), '{}') into v_paras from unnest(coalesce(p_paragraphs, '{}')) with ordinality as t(x, ord) where btrim(x) <> '';
  if cardinality(v_paras) > 4 then
    raise exception 'Keep it to 4 short paragraphs' using errcode = '22023';
  end if;
  if e.target is null and v_button is not null then
    v_button := null;
  end if;
  if e.target is not null and v_button is null then
    raise exception 'This email has a button, so it needs words' using errcode = '22023';
  end if;
  perform public.wording_check(btrim(coalesce(p_subject, '')), v_paras, v_button,
    array['first_name', 'tribe', 'tribe_1', 'leader_first', 'seats_left', 'season_starts', 'joining_closes', 'meets', 'next_meeting',
          'erase_date', 'parts_left', 'minutes_left', 'close_line', 'my_page']);

  if public.has_role('pastor') then
    insert into public.journey_email_versions (email_id, version, subject, paragraphs, button_label, edited_by, approved_by)
    values (e.id, e.version + 1, btrim(p_subject), v_paras, v_button, uid, uid);
    update public.journey_emails
       set subject = btrim(p_subject), paragraphs = v_paras, button_label = v_button, version = version + 1, pending = null,
           approved_by = uid, approved_at = now(), updated_by = uid, updated_at = now()
     where id = p_id;
    perform public.write_event(uid, 'journey.email_changed', 'journey_email', p_id::text, jsonb_build_object('version', e.version + 1));
    return 'live';
  end if;
  update public.journey_emails
     set pending = jsonb_build_object('subject', btrim(p_subject), 'paragraphs', to_jsonb(v_paras), 'button_label', v_button,
                                      'edited_by', uid, 'edited_by_name', public.person_display_name(uid), 'edited_at', now()),
         updated_at = now()
   where id = p_id;
  perform public.write_event(uid, 'journey.email_proposed', 'journey_email', p_id::text, '{}'::jsonb);
  return 'waiting';
end;
$$;

create function public.journey_email_approve(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.journey_emails%rowtype;
  v_paras text[];
  v_editor uuid;
begin
  if uid is null or not public.has_role('pastor') then
    raise exception 'Only a pastor can approve the reminder wording' using errcode = '42501';
  end if;
  select * into e from public.journey_emails where id = p_id for update;
  if not found or e.pending is null then
    raise exception 'There is no change waiting for approval' using errcode = '22023';
  end if;
  select coalesce(array_agg(x order by ord), '{}') into v_paras from jsonb_array_elements_text(e.pending -> 'paragraphs') with ordinality as t(x, ord);
  v_editor := nullif(e.pending ->> 'edited_by', '')::uuid;
  insert into public.journey_email_versions (email_id, version, subject, paragraphs, button_label, edited_by, approved_by)
  values (e.id, e.version + 1, e.pending ->> 'subject', v_paras, e.pending ->> 'button_label', v_editor, uid);
  update public.journey_emails
     set subject = e.pending ->> 'subject', paragraphs = v_paras, button_label = e.pending ->> 'button_label',
         version = version + 1, pending = null, approved_by = uid, approved_at = now(), updated_by = coalesce(v_editor, uid), updated_at = now()
   where id = p_id;
  perform public.write_event(uid, 'journey.email_approved', 'journey_email', p_id::text, jsonb_build_object('version', e.version + 1));
end;
$$;

create function public.journey_email_discard(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, director or pastor can discard a change' using errcode = '42501';
  end if;
  update public.journey_emails set pending = null, updated_at = now() where id = p_id and pending is not null;
  perform public.write_event(uid, 'journey.email_discarded', 'journey_email', p_id::text, '{}'::jsonb);
end;
$$;

create function public.journey_email_history(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.reminders_viewer() then
    raise exception 'Only the office can see reminders' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('version', v.version, 'subject', v.subject, 'paragraphs', to_jsonb(v.paragraphs),
             'button_label', v.button_label, 'edited_by', public.person_display_name(v.edited_by),
             'approved_by', public.person_display_name(v.approved_by), 'at', v.created_at) order by v.version desc)
      from public.journey_email_versions v where v.email_id = p_id), '[]'::jsonb);
end;
$$;

-- =============================================================================
-- Message on WhatsApp: one person at a time, from a staff member's own phone
-- =============================================================================

-- The number to open a chat on, only when this staff member may and the person said yes to WhatsApp.
create function public.chat_phone(p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_ok boolean;
begin
  if uid is null then
    return null;
  end if;
  v_ok := public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[])
       or exists (select 1 from public.tribe_members cm join public.tribes c on c.id = cm.tribe_id
                   where cm.person_id = p_person and cm.status = 'active' and uid in (c.leader_id, c.assistant_id, c.coach_id));
  if not v_ok or not exists (select 1 from public.people p where p.id = p_person and p.centre_id = public.my_centre()) then
    return null;
  end if;
  if not public.consent_granted(p_person, 'whatsapp') then
    return null;
  end if;
  return coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = p_person),
                  (select mp.whatsapp from public.member_profiles mp where mp.person_id = p_person));
end;
$$;

create function public.chat_open(p_person uuid, p_context text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_phone text;
  v_text text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_context is null or p_context !~ '^[a-z_]{2,32}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_opens c where c.opened_by = uid and c.created_at > now() - interval '1 day') >= 300 then
    raise exception 'That is 300 chats opened today. Try again tomorrow.' using errcode = '22023';
  end if;
  v_phone := public.chat_phone(p_person);
  if v_phone is null then
    raise exception 'This person has not said yes to WhatsApp, or you are not their contact' using errcode = '42501';
  end if;
  select j.chat_text into v_text from public.journeys j where j.key = p_context;
  insert into public.chat_opens (opened_by, person_id, context) values (uid, p_person, p_context);
  return jsonb_build_object('phone', v_phone, 'first_name', public.first_name_of(p_person), 'text', v_text);
end;
$$;

-- The people in a journey, for the office to reach one at a time. Names, never numbers or addresses.
create function public.journey_people(p_key text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]) then
    raise exception 'Only the office and the care lead can see who is in a journey' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'started_at') desc) from (
      select jsonb_build_object(
        'person_id', r.person_id, 'name', public.person_display_name(r.person_id), 'step_done', r.step_done,
        'started_at', r.started_at, 'rehearsal', r.rehearsal, 'holdout', r.holdout,
        'next_due', case when r.step_done < 4 and not r.holdout then public.journey_due_at(r, r.step_done + 1) end,
        'can_chat', public.chat_phone(r.person_id) is not null) as x
        from public.journey_runs r join public.people p on p.id = r.person_id
       where r.journey_key = p_key and r.status = 'active' and p.centre_id = public.my_centre()
       order by r.started_at desc
       limit least(greatest(coalesce(p_limit, 100), 1), 200)) y), '[]'::jsonb);
end;
$$;

-- People who tapped "Help me finish", "Something's in the way" and the like: a task for the care team.
create function public.asks_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]) then
    raise exception 'Only the office and the care lead can see these' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'person_id', q.person_id, 'name', public.person_display_name(q.person_id), 'kind', q.kind, 'journey', q.journey_key,
      'status', q.status, 'created_at', q.created_at, 'handled_by', public.person_display_name(q.handled_by), 'handled_at', q.handled_at,
      'can_chat', public.chat_phone(q.person_id) is not null) order by (q.status = 'open') desc, q.created_at desc)
      from public.journey_requests q join public.people p on p.id = q.person_id
     where p.centre_id = public.my_centre() and q.kind <> 'not_season'
       and (q.status = 'open' or q.handled_at > now() - interval '14 days')), '[]'::jsonb);
end;
$$;

create function public.ask_close(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]) then
    raise exception 'Only the office and the care lead can close these' using errcode = '42501';
  end if;
  update public.journey_requests set status = 'closed', handled_by = uid, handled_at = now()
   where id = p_id and status = 'open' and person_id in (select p.id from public.people p where p.centre_id = public.my_centre());
  if not found then
    raise exception 'That one is already closed' using errcode = '22023';
  end if;
  perform public.write_event(uid, 'journey.ask_closed', 'journey_request', p_id::text, '{}'::jsonb);
end;
$$;

-- =============================================================================
-- Who can call what
-- =============================================================================

revoke execute on function
  public.lagos_dow(),
  public.reminder_cfg(),
  public.send_window_ok(text),
  public.reminder_stopped(uuid, public.consent_purpose),
  public.message_blocker(uuid),
  public.is_holdout(uuid, text),
  public.person_cap_ok(uuid, text),
  public.wording_problem(text, text[]),
  public.wording_check(text, text[], text, text[]),
  public.audience_clean(jsonb),
  public.audience_base(jsonb, uuid),
  public.audience_members(jsonb, uuid),
  public.broadcast_role(),
  public.audience_for_caller(jsonb),
  public.audience_preview(jsonb),
  public.audience_sample(jsonb, integer),
  public.broadcast_vars(uuid),
  public.broadcast_mine_or_office(public.broadcasts),
  public.broadcast_save(uuid, jsonb),
  public.broadcast_get(uuid),
  public.broadcast_freeze(uuid),
  public.broadcast_submit(uuid, timestamptz),
  public.broadcast_approve(uuid),
  public.broadcast_reject(uuid, text),
  public.broadcast_control(uuid, text),
  public.broadcast_test_send(uuid),
  public.broadcast_list(),
  public.broadcast_results(uuid),
  public.broadcast_approvals(),
  public.audiences_list(),
  public.audience_save(text, jsonb, text),
  public.audience_delete(uuid),
  public.make_email_link(uuid, text, text, uuid, uuid, integer),
  public.journey_state(public.journey_runs),
  public.journey_apply_state(uuid, text),
  public.journey_due_at(public.journey_runs, integer),
  public.journey_data(public.journey_runs),
  public.claim_prepare(public.messages),
  public.worker_claim(text, integer),
  public.journey_may_enter(uuid, text, boolean),
  public.journeys_enter(),
  public.journeys_advance(),
  public.journeys_self_check(),
  public.broadcasts_release(),
  public.worker_reminders_tick(text),
  public.apply_unsubscribe(uuid, text, uuid, uuid, text),
  public.worker_link_open(text, text),
  public.worker_link_confirm(text, text, text),
  public.worker_unsubscribe_oneclick(text, text),
  public.worker_prefs_save(text, text, boolean, boolean, boolean),
  public.worker_email_signal(text, text, text),
  public.set_email_switches(uuid, boolean, boolean, boolean, text),
  public.my_email_switches(),
  public.save_email_switches(boolean, boolean, boolean),
  public.reminders_viewer(),
  public.reminders_overview(),
  public.journey_set_mode(text, text),
  public.reminders_master(boolean),
  public.journey_set_days(text, integer[]),
  public.reminder_settings_save(jsonb),
  public.journey_email_edit(uuid, text, text[], text),
  public.journey_email_approve(uuid),
  public.journey_email_discard(uuid),
  public.journey_email_history(uuid),
  public.chat_phone(uuid),
  public.chat_open(uuid, text),
  public.journey_people(text, integer),
  public.asks_queue(),
  public.ask_close(uuid)
  from public, anon, authenticated;

-- People who are signed in. Each function checks the role itself.
grant execute on function
  public.audience_preview(jsonb),
  public.audience_sample(jsonb, integer),
  public.broadcast_save(uuid, jsonb),
  public.broadcast_get(uuid),
  public.broadcast_submit(uuid, timestamptz),
  public.broadcast_approve(uuid),
  public.broadcast_reject(uuid, text),
  public.broadcast_control(uuid, text),
  public.broadcast_test_send(uuid),
  public.broadcast_list(),
  public.broadcast_results(uuid),
  public.broadcast_approvals(),
  public.audiences_list(),
  public.audience_save(text, jsonb, text),
  public.audience_delete(uuid),
  public.my_email_switches(),
  public.save_email_switches(boolean, boolean, boolean),
  public.reminders_overview(),
  public.journey_set_mode(text, text),
  public.reminders_master(boolean),
  public.journey_set_days(text, integer[]),
  public.reminder_settings_save(jsonb),
  public.journey_email_edit(uuid, text, text[], text),
  public.journey_email_approve(uuid),
  public.journey_email_discard(uuid),
  public.journey_email_history(uuid),
  public.chat_open(uuid, text),
  public.journey_people(text, integer),
  public.asks_queue(),
  public.ask_close(uuid)
  to authenticated;

-- The sending service and the public email pages have no account: the token is the credential.
grant execute on function
  public.worker_claim(text, integer),
  public.worker_reminders_tick(text),
  public.worker_link_open(text, text),
  public.worker_link_confirm(text, text, text),
  public.worker_unsubscribe_oneclick(text, text),
  public.worker_prefs_save(text, text, boolean, boolean, boolean),
  public.worker_email_signal(text, text, text)
  to anon, authenticated;

-- United Tribes, Round 2, Phase 5: the activity log and decision dashboard, for the platform owner only.
--
-- What this adds: the events the platform did not record (a visit began, a person signed in, which screen was open,
-- how far someone got in a form), a private store for them, daily and hourly summaries, and the owner-only functions that
-- turn all of it into answers. The page that shows it lives inside the owner's console, /god/activity.
--
-- Who may see it: the owner, unlocked, and nobody else. Three layers hold, so a mistake in one is not enough:
--
--   1. PRIVATE BY CONSTRUCTION. Every table here has row level security on, no policy and no grant. A direct query from
--      any signed-in account, admin and director included, is refused. The new events are NOT written to event_log, which
--      the office can read, so nothing about how people use the platform, or that this page exists, reaches them.
--   2. OWNER-ONLY FUNCTIONS. Every report starts with god_only(): the same plain refusal as any other owner page.
--      The internal writers (activity_note, activity_refresh and the rest) are not granted to anyone at all.
--   3. ONE NARROW DOOR FOR WRITING. activity_track() is the only function a signed-in person can call. It records three
--      kinds of event (visit, screen, signin), accepts only named screens and device classes, ignores the owner, and
--      refuses everything else. It returns nothing, so a caller learns nothing from it.
--
-- What is recorded: what, when and who. Never content. activity_note() refuses an event that is not in the catalogue,
-- a field the catalogue does not list for it, and any value that is not a short identifier, a number or a yes/no, so
-- no answer, story, prayer request or message can enter even by mistake.
--
-- Small groups: any breakdown cell with fewer than 5 people is returned as the text "<5". Young members are counted in
-- totals and never named in a list. Kept for 13 months by default (the owner can shorten it); the daily counts stay.
--
-- Additive only: no existing function, table, policy or event is changed. See docs/ACTIVITY.md.

-- ---------------------------------------------------------------------------
-- Small constants
-- ---------------------------------------------------------------------------

-- The smallest group the dashboard will show a number for. It is a rule, not a setting: nobody can lower it.
create function public.activity_min_group()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;

create function public.activity_lagos_day(p_at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$ select (p_at at time zone 'Africa/Lagos')::date $$;

-- A people-count for a chart cell: 1 to 4 reads "<5", anything else is the number.
create function public.activity_c(p_n numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_n between 1 and (public.activity_min_group() - 1) then to_jsonb('<5'::text) else to_jsonb(p_n) end
$$;

-- ---------------------------------------------------------------------------
-- The catalogue: every kind of event, what it may carry, how long it is kept
-- ---------------------------------------------------------------------------

create table public.activity_catalogue (
  kind text primary key check (kind ~ '^[a-z_]+(\.[a-z_]+)?$'),
  label text not null,
  area text not null check (area in ('sign-in', 'screen', 'form', 'directory')),
  concerns text not null default 'person' check (concerns in ('person')),
  -- The only fields the event may carry. Values must be short identifiers, numbers or yes/no (see activity_note).
  meta_keys text[] not null default '{}',
  keep_months smallint not null default 13 check (keep_months between 3 and 60),
  -- Written by a later phase (the directory, the answer-change log) through activity_note; nothing writes them yet.
  reserved boolean not null default false,
  active boolean not null default true
);
alter table public.activity_catalogue enable row level security;
revoke all on table public.activity_catalogue from public, anon, authenticated;

insert into public.activity_catalogue (kind, label, area, meta_keys, reserved) values
  ('visit',                'A visit began',                       'sign-in',  array['device'], false),
  ('signin',               'Signed in',                           'sign-in',  array['method'], false),
  ('screen',               'Opened a screen',                     'screen',   array['screen', 'device', 'speed'], false),
  ('form.started',         'Started a form',                      'form',     array['form'], false),
  ('form.step',            'Moved to a form step',                'form',     array['form', 'step'], false),
  ('form.submitted',       'Submitted a form',                    'form',     array['form'], false),
  ('form.profile_changed', 'Changed their profile',               'form',     array['form'], false),
  ('form.answer_changed',  'Changed an answer already given',     'form',     array['form', 'field'], true),
  ('directory.opened',     'Opened the member directory',         'directory', array[]::text[], true),
  ('directory.exported',   'Exported from the member directory',  'directory', array['rows'], true);

-- The screens the door accepts. The website maps a page address to one of these names; an address that is not here
-- is never sent.
create table public.activity_screens (
  screen text primary key check (screen ~ '^[a-z_]{2,24}$'),
  label text not null,
  area text not null,
  active boolean not null default true
);
alter table public.activity_screens enable row level security;
revoke all on table public.activity_screens from public, anon, authenticated;

insert into public.activity_screens (screen, label, area) values
  ('home',          'Home',                          'member'),
  ('join',          'Member form',                   'member'),
  ('tribe',         'My tribe',                      'member'),
  ('tribe_choose',  'Choosing a tribe',              'member'),
  ('testimony',     'Sharing a testimony',           'member'),
  ('testimonies',   'Testimonies',                   'member'),
  ('profile',       'Profile and my data',           'member'),
  ('community',     'Community',                     'member'),
  ('lead_apply',    'Leader application',            'leader'),
  ('lead_home',     'Leader home',                   'leader'),
  ('lead_week',     'Weekly guide',                  'leader'),
  ('lead_tribe',    'Tribe page',                    'leader'),
  ('lead_update',   'Weekly report',                 'leader'),
  ('lead_progress', 'Leader progress',               'leader'),
  ('lead_academy',  'Academy',                       'leader'),
  ('review',        'Leader review',                 'office'),
  ('care',          'Care',                          'office'),
  ('dashboard',     'Dashboard',                     'office'),
  ('reports',       'Reports',                       'office'),
  ('growth',        'Growth',                        'office'),
  ('admin',         'Admin',                         'office'),
  ('admin_people',  'Admin people',                  'office'),
  ('admin_messages','Admin messages',                'office'),
  ('admin_signin',  'Admin sign-in',                 'office');

-- The steps of the two forms, in order, so the funnels can tell how far someone got. The website's step lists
-- (src/lib/intake/steps.ts and src/lib/leaders/steps.ts) must match; a unit test checks that they do.
create table public.activity_steps (
  form text not null check (form in ('member', 'leader')),
  position smallint not null,
  step text not null,
  label text not null,
  primary key (form, position),
  unique (form, step)
);
alter table public.activity_steps enable row level security;
revoke all on table public.activity_steps from public, anon, authenticated;

insert into public.activity_steps (form, position, step, label) values
  ('member', 1, 'age', 'Age'), ('member', 2, 'name', 'Name'), ('member', 3, 'gender', 'Gender'), ('member', 4, 'where', 'Where you live'),
  ('member', 5, 'story', 'Your story'), ('member', 6, 'heard', 'How you heard'), ('member', 7, 'community', 'Community'),
  ('member', 8, 'faith', 'Faith journey'), ('member', 9, 'goal', 'Goal'), ('member', 10, 'success', 'What success looks like'),
  ('member', 11, 'rhythm', 'Rhythm'), ('member', 12, 'style', 'Style'), ('member', 13, 'care', 'Care'),
  ('member', 14, 'contact', 'Contact'), ('member', 15, 'review', 'Review'),
  ('leader', 1, 'eligibility', 'Eligibility'), ('leader', 2, 'contact', 'Contact'), ('leader', 3, 'track', 'Track'),
  ('leader', 4, 'community', 'Community'), ('leader', 5, 'goal', 'Goal'), ('leader', 6, 'goal-story', 'Goal story'),
  ('leader', 7, 'why', 'Why lead'), ('leader', 8, 'walked', 'Walked with others'), ('leader', 9, 'walk', 'Your walk'),
  ('leader', 10, 'obstacles', 'Obstacles'), ('leader', 11, 's1', 'Scenario 1'), ('leader', 12, 's2', 'Scenario 2'),
  ('leader', 13, 's3', 'Scenario 3'), ('leader', 14, 's4', 'Scenario 4'), ('leader', 15, 's5', 'Scenario 5'),
  ('leader', 16, 's6', 'Scenario 6'), ('leader', 17, 'style', 'Style'), ('leader', 18, 'lead-best', 'Leading at your best'),
  ('leader', 19, 'ref1', 'First referee'), ('leader', 20, 'ref2', 'Second referee'), ('leader', 21, 'review', 'Review');

-- What a prefix in the office's event log means, so the audit trail can be filtered by kind of action.
create table public.activity_action_groups (
  prefix text primary key check (prefix ~ '^[a-z_]+$'),
  label text not null
);
alter table public.activity_action_groups enable row level security;
revoke all on table public.activity_action_groups from public, anon, authenticated;

insert into public.activity_action_groups (prefix, label) values
  ('academy', 'Academy'), ('bi', 'Platform'), ('broadcast', 'Messages'), ('care', 'Care'), ('centre', 'Platform'),
  ('champion', 'Community champions'), ('checkin', 'Check-ins'), ('circle', 'Tribes'), ('tribe', 'Tribes'),
  ('contact', 'Contact details'), ('email', 'Messages'), ('erasure', 'Data rights'), ('goal', 'Goals'),
  ('goal_family', 'Goals'), ('guardian', 'Young members'), ('guide', 'Weekly guide'), ('invitation', 'People and roles'),
  ('journey', 'Messages'), ('kpi', 'Targets'), ('leader', 'Leader applications'), ('match', 'Matching'),
  ('message', 'Messages'), ('model', 'Matching'), ('multiply', 'Growth'), ('person', 'People and roles'),
  ('photo', 'Profile'), ('prayer', 'Care'), ('referee', 'Referees'), ('reference', 'Referees'), ('reminders', 'Messages'),
  ('report', 'Reports'), ('retention', 'Platform'), ('role', 'People and roles'), ('season', 'Seasons'),
  ('settings', 'Platform'), ('swap', 'Growth'), ('testimony', 'Testimonies'), ('worker_token', 'Platform');

-- ---------------------------------------------------------------------------
-- Settings and thresholds
-- ---------------------------------------------------------------------------

create table public.activity_settings (
  id boolean primary key default true check (id),
  recording boolean not null default true,
  retention_months smallint not null default 13 check (retention_months between 3 and 36),
  last_refresh timestamptz,
  last_backfill timestamptz,
  last_prune date,
  updated_at timestamptz not null default now()
);
alter table public.activity_settings enable row level security;
revoke all on table public.activity_settings from public, anon, authenticated;
insert into public.activity_settings (id) values (true);

-- What "too long" means for each flag on the Pulse tab. Only the owner edits these.
create table public.activity_thresholds (
  key text primary key check (key ~ '^[a-z_0-9]{3,40}$'),
  label text not null,
  value numeric not null check (value > 0 and value <= 365),
  unit text not null check (unit in ('days', 'hours', 'count', 'percent')),
  action text not null,
  href text not null check (href like '/%'),
  sort smallint not null,
  updated_at timestamptz not null default now()
);
alter table public.activity_thresholds enable row level security;
revoke all on table public.activity_thresholds from public, anon, authenticated;

insert into public.activity_thresholds (key, label, value, unit, action, href, sort) values
  ('member_wait_days',       'Members waiting more than {value} days for a tribe',           14, 'days',    'Open the people list, find who is waiting, and place or call them.', '/god/people', 1),
  ('application_held_hours', 'Leader applications held more than {value} hours',             48, 'hours',   'Open the leader quality screen and clear or send back each held application.', '/admin/leader-quality', 2),
  ('referee_unverified_days','Referees not verified after {value} days',                      5, 'days',    'Open the referees screen and chase them, or ask the care team to call.', '/admin/referees', 3),
  ('failed_messages_7d',     '{value} or more messages failed in the last 7 days',            5, 'count',   'Open Messages and look at the failures before more go out.', '/admin/messages', 4),
  ('care_overdue_days',      'Care tasks more than {value} days overdue',                     2, 'days',    'Open Care and make sure each overdue task has someone on it.', '/care', 5),
  ('signin_fail_pct',        'Sign-in codes failing for {value} percent or more',            25, 'percent', 'Open the sign-in screen and check the channel and the breaker.', '/admin/signin', 6),
  ('quiet_days',             'Members in a tribe quiet for more than {value} days',          21, 'days',    'Open the people list and ask each tribe leader to reach out.', '/god/people', 7);

-- ---------------------------------------------------------------------------
-- The private events
-- ---------------------------------------------------------------------------

create table public.activity_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The Lagos calendar day of `at`, so the summaries and the retention rules agree with how the church counts days.
  day date not null,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null references public.activity_catalogue (kind),
  -- The sign-in session as a one-way hash. Never the token, never an address.
  session_hash text check (session_hash ~ '^[0-9a-f]{64}$'),
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) < 512)
);
create index activity_events_at_idx on public.activity_events (at);
create index activity_events_person_idx on public.activity_events (person_id, at desc);
create index activity_events_kind_idx on public.activity_events (kind, at desc);
create index activity_events_day_idx on public.activity_events (day);
create unique index activity_events_signin_once on public.activity_events (session_hash) where kind = 'signin';
alter table public.activity_events enable row level security;
revoke all on table public.activity_events from public, anon, authenticated;

-- Everyone who is counted, with the group they are counted in and the few things a chart splits by. Rebuilt on every
-- refresh. Never lists the owner or anyone marked hidden.
create table public.activity_people (
  person_id uuid primary key references public.people (id) on delete cascade,
  -- young: the teen track. They are counted in totals and never named. The rest, by the highest part they play.
  grp text not null check (grp in ('young', 'pastoral', 'team', 'leader', 'member')),
  joined_day date not null,
  community_id uuid,
  zone text,
  season_id uuid
);
create index activity_people_grp_idx on public.activity_people (grp);
alter table public.activity_people enable row level security;
revoke all on table public.activity_people from public, anon, authenticated;

create table public.activity_person_day (
  person_id uuid not null references public.people (id) on delete cascade,
  day date not null,
  events integer not null default 0,
  visits smallint not null default 0,
  screens integer not null default 0,
  -- The Lagos hours of the day the person did something, one bit per hour.
  hours integer not null default 0,
  first_at timestamptz,
  last_at timestamptz,
  primary key (person_id, day)
);
create index activity_person_day_day_idx on public.activity_person_day (day);
alter table public.activity_person_day enable row level security;
revoke all on table public.activity_person_day from public, anon, authenticated;

create table public.activity_daily (
  day date not null,
  metric text not null,
  grp text not null,
  n bigint not null,
  people bigint not null,
  primary key (day, metric, grp)
);
alter table public.activity_daily enable row level security;
revoke all on table public.activity_daily from public, anon, authenticated;

create table public.activity_hourly (
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  grp text not null,
  events bigint not null,
  people bigint not null,
  primary key (day, hour, grp)
);
alter table public.activity_hourly enable row level security;
revoke all on table public.activity_hourly from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writing: the internal writer, and the one narrow door
-- ---------------------------------------------------------------------------

-- Records one event. Used by the triggers below, by the door, and (later) by the directory and the answer-change log.
-- Refuses anything the catalogue does not list. Quietly records nothing for the owner, for a hidden account, or while
-- recording is switched off. Granted to no one.
create function public.activity_note(
  p_person uuid,
  p_kind text,
  p_meta jsonb default '{}'::jsonb,
  p_at timestamptz default now(),
  p_session text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.activity_catalogue%rowtype;
  k text;
  v jsonb;
begin
  select * into c from public.activity_catalogue x where x.kind = p_kind and x.active;
  if not found then
    raise exception 'That kind of event is not in the activity catalogue' using errcode = '22023';
  end if;
  p_meta := coalesce(p_meta, '{}'::jsonb);
  if jsonb_typeof(p_meta) <> 'object' then
    raise exception 'An event carries a few named fields and nothing else' using errcode = '22023';
  end if;
  for k, v in select e.key, e.value from jsonb_each(p_meta) e loop
    if not (k = any (c.meta_keys)) then
      raise exception 'The field "%" is not allowed on "%"', k, p_kind using errcode = '22023';
    end if;
    if jsonb_typeof(v) = 'string' then
      if (v #>> '{}') !~ '^[a-z0-9_.-]{1,24}$' then
        raise exception 'Only short identifiers may be recorded, never wording' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v) not in ('number', 'boolean') then
      raise exception 'Only a short identifier, a number or yes/no may be recorded' using errcode = '22023';
    end if;
  end loop;

  if p_person is null
     or exists (select 1 from public.platform_owner o where o.person_id = p_person)
     or not exists (select 1 from public.people p where p.id = p_person and not p.hidden)
     or not (select s.recording from public.activity_settings s) then
    return;
  end if;

  insert into public.activity_events (at, day, person_id, kind, session_hash, meta)
  values (p_at, public.activity_lagos_day(p_at), p_person, p_kind, p_session, p_meta);
end;
$$;

-- The only door a signed-in person can use to write here. Three kinds, named screens, three device classes, and nothing
-- is returned, so a caller learns nothing, including whether they are the owner (who is ignored without a word).
create function public.activity_track(
  p_kind text,
  p_screen text default null,
  p_device text default null,
  p_method text default null,
  p_speed text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_now timestamptz := now();
  v_session text;
  v_last timestamptz;
  v_day date := public.activity_lagos_day(now());
  v_visit boolean;
begin
  if uid is null then
    return;
  end if;
  if p_kind not in ('visit', 'screen', 'signin') then
    raise exception 'Not an event the screens may send' using errcode = '22023';
  end if;
  if p_kind = 'screen' and not exists (select 1 from public.activity_screens s where s.screen = p_screen and s.active) then
    raise exception 'Not a screen that is recorded' using errcode = '22023';
  end if;
  if p_device is not null and p_device not in ('phone', 'tablet', 'desktop') then
    raise exception 'Not a device class' using errcode = '22023';
  end if;
  if p_method is not null and p_method not in ('email', 'whatsapp', 'google', 'link') then
    raise exception 'Not a sign-in method' using errcode = '22023';
  end if;
  if p_speed is not null and p_speed not in ('fast', 'ok', 'slow') then
    raise exception 'Not a speed band' using errcode = '22023';
  end if;

  -- Nothing is recorded for the owner, for a hidden account, for a stranger to the people list, or while off.
  if exists (select 1 from public.platform_owner o where o.person_id = uid)
     or not exists (select 1 from public.people p where p.id = uid and not p.hidden)
     or not (select s.recording from public.activity_settings s) then
    return;
  end if;

  v_session := encode(extensions.digest(coalesce(public.jwt_session()::text, 'none') || '|' || uid::text, 'sha256'), 'hex');

  -- A person cannot fill the log: 1,500 events a day at most.
  if (select count(*) from public.activity_events e where e.person_id = uid and e.day = v_day) >= 1500 then
    return;
  end if;

  select max(e.at) into v_last from public.activity_events e where e.person_id = uid;
  -- A new visit begins after 30 minutes with nothing recorded.
  v_visit := v_last is null or v_last < v_now - interval '30 minutes';

  if p_kind = 'signin' then
    if exists (select 1 from public.activity_events e where e.kind = 'signin' and e.session_hash = v_session) then
      return;
    end if;
    begin
      perform public.activity_note(uid, 'signin', jsonb_strip_nulls(jsonb_build_object('method', p_method)), v_now, v_session);
    exception when unique_violation then
      return;
    end;
  elsif p_kind = 'screen' then
    -- The same screen again within 20 seconds is the same look.
    if exists (select 1 from public.activity_events e
                where e.person_id = uid and e.kind = 'screen' and e.at > v_now - interval '20 seconds'
                  and e.meta ->> 'screen' = p_screen) then
      return;
    end if;
    if v_visit then
      perform public.activity_note(uid, 'visit', jsonb_strip_nulls(jsonb_build_object('device', p_device)), v_now, v_session);
    end if;
    perform public.activity_note(uid, 'screen',
      jsonb_strip_nulls(jsonb_build_object('screen', p_screen, 'device', p_device, 'speed', p_speed)), v_now, v_session);
    return;
  end if;

  if v_visit then
    perform public.activity_note(uid, 'visit', jsonb_strip_nulls(jsonb_build_object('device', p_device)), v_now, v_session);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Form progress, written by triggers that touch nothing that already exists
-- ---------------------------------------------------------------------------

-- Each trigger function swallows its own errors: a fault here must never stop someone saving their form.

create function public.activity_trg_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.activity_note(new.person_id, 'form.started', jsonb_build_object('form', 'member'));
      perform public.activity_note(new.person_id, 'form.step', jsonb_build_object('form', 'member', 'step', new.step));
    elsif new.step is distinct from old.step then
      perform public.activity_note(new.person_id, 'form.step', jsonb_build_object('form', 'member', 'step', new.step));
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger activity_draft
  after insert or update of step on public.intake_drafts
  for each row execute function public.activity_trg_draft();

create function public.activity_trg_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.submitted_at is not null then
        perform public.activity_note(new.person_id, 'form.submitted', jsonb_build_object('form', 'member'));
      end if;
    elsif old.submitted_at is null and new.submitted_at is not null then
      perform public.activity_note(new.person_id, 'form.submitted', jsonb_build_object('form', 'member'));
    elsif new.submitted_at is not null
          and (to_jsonb(new) - 'updated_at' - 'ai_assist') is distinct from (to_jsonb(old) - 'updated_at' - 'ai_assist') then
      perform public.activity_note(new.person_id, 'form.profile_changed', jsonb_build_object('form', 'member'));
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger activity_profile
  after insert or update on public.member_profiles
  for each row execute function public.activity_trg_profile();

create function public.activity_trg_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.activity_note(new.person_id, 'form.started', jsonb_build_object('form', 'leader'));
      if new.step is not null then
        perform public.activity_note(new.person_id, 'form.step', jsonb_build_object('form', 'leader', 'step', new.step));
      end if;
    else
      if new.step is not null and new.step is distinct from old.step then
        perform public.activity_note(new.person_id, 'form.step', jsonb_build_object('form', 'leader', 'step', new.step));
      end if;
      if old.submitted_at is null and new.submitted_at is not null then
        perform public.activity_note(new.person_id, 'form.submitted', jsonb_build_object('form', 'leader'));
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

create trigger activity_application
  after insert or update on public.leader_applications
  for each row execute function public.activity_trg_application();

-- ---------------------------------------------------------------------------
-- The summaries: rebuilt on the five-minute heartbeat, and once, back-dated, when this file is applied
-- ---------------------------------------------------------------------------

-- Who is counted, and in which group.
create function public.activity_build_people()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activity_people (person_id, grp, joined_day, community_id, zone, season_id)
  select p.id,
         case
           when coalesce(mp.max_age < 18, false) then 'young'
           when exists (select 1 from public.person_roles r where r.person_id = p.id and r.role in ('pastor', 'director')) then 'pastoral'
           when exists (select 1 from public.person_roles r where r.person_id = p.id
                         and r.role in ('admin', 'data_lead', 'care_lead', 'coach', 'community_champion')) then 'team'
           when exists (select 1 from public.person_roles r where r.person_id = p.id and r.role in ('leader', 'assistant_leader')) then 'leader'
           else 'member'
         end,
         public.activity_lagos_day(p.created_at),
         mp.community_id, mp.zone, mp.season_id
    from public.people p
    left join lateral (
      select m.community_id, m.zone, m.season_id, ar.max_age
        from public.member_profiles m
        left join public.age_ranges ar on ar.id = m.age_range_id
       where m.person_id = p.id
       limit 1) mp on true
   where not p.hidden
     and not exists (select 1 from public.platform_owner o where o.person_id = p.id)
  on conflict (person_id) do update
     set grp = excluded.grp, community_id = excluded.community_id, zone = excluded.zone, season_id = excluded.season_id;

  delete from public.activity_people a
   where not exists (select 1 from public.people p where p.id = a.person_id and not p.hidden)
      or exists (select 1 from public.platform_owner o where o.person_id = a.person_id);
end;
$$;

-- One row per person per Lagos day on which they did anything we can see: a visit or screen, an action in the office's
-- log, or (for the days before this phase) the moment recorded in the table where the thing already lives.
create function public.activity_build_days(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Africa/Lagos';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Lagos';
begin
  delete from public.activity_person_day d where d.day between p_from and p_to;

  insert into public.activity_person_day (person_id, day, events, visits, screens, hours, first_at, last_at)
  select s.person_id, s.day, count(*), count(*) filter (where s.kind = 'visit'), count(*) filter (where s.kind = 'screen'),
         bit_or(1 << s.hour), min(s.at), max(s.at)
    from (
      select e.person_id, e.day, e.kind, e.at, extract(hour from e.at at time zone 'Africa/Lagos')::int as hour
        from public.activity_events e where e.at >= t0 and e.at < t1
      union all
      select l.actor_id, public.activity_lagos_day(l.at), 'action', l.at, extract(hour from l.at at time zone 'Africa/Lagos')::int
        from public.event_log l where l.actor_id is not null and l.at >= t0 and l.at < t1
      union all
      select p.id, public.activity_lagos_day(p.created_at), 'registered', p.created_at, extract(hour from p.created_at at time zone 'Africa/Lagos')::int
        from public.people p where p.created_at >= t0 and p.created_at < t1
      union all
      select d.person_id, public.activity_lagos_day(d.updated_at), 'form', d.updated_at, extract(hour from d.updated_at at time zone 'Africa/Lagos')::int
        from public.intake_drafts d where d.updated_at >= t0 and d.updated_at < t1
      union all
      select m.person_id, public.activity_lagos_day(m.submitted_at), 'form', m.submitted_at, extract(hour from m.submitted_at at time zone 'Africa/Lagos')::int
        from public.member_profiles m where m.submitted_at >= t0 and m.submitted_at < t1
      union all
      select a.person_id, public.activity_lagos_day(a.updated_at), 'form', a.updated_at, extract(hour from a.updated_at at time zone 'Africa/Lagos')::int
        from public.leader_applications a where a.updated_at >= t0 and a.updated_at < t1
      union all
      select u.person_id, public.activity_lagos_day(u.created_at), 'checkin', u.created_at, extract(hour from u.created_at at time zone 'Africa/Lagos')::int
        from public.pulses u where u.created_at >= t0 and u.created_at < t1
      union all
      select g.logged_by, public.activity_lagos_day(g.logged_at), 'report', g.logged_at, extract(hour from g.logged_at at time zone 'Africa/Lagos')::int
        from public.tribe_logs g where g.logged_by is not null and g.logged_at >= t0 and g.logged_at < t1
      union all
      select y.person_id, public.activity_lagos_day(y.created_at), 'testimony', y.created_at, extract(hour from y.created_at at time zone 'Africa/Lagos')::int
        from public.testimonies y where y.created_at >= t0 and y.created_at < t1
      union all
      select q.person_id, public.activity_lagos_day(q.at), 'academy', q.at, extract(hour from q.at at time zone 'Africa/Lagos')::int
        from public.academy_attempts q where q.at >= t0 and q.at < t1
      union all
      select tm.person_id, public.activity_lagos_day(tm.agreed_at), 'agreed', tm.agreed_at, extract(hour from tm.agreed_at at time zone 'Africa/Lagos')::int
        from public.tribe_members tm where tm.agreed_at >= t0 and tm.agreed_at < t1
    ) s
    join public.activity_people ap on ap.person_id = s.person_id
   group by s.person_id, s.day;
end;
$$;

-- Counts per day, per metric, per group (and "all"), for the tiles, the trend lines and the weekly brief.
create function public.activity_build_daily(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Africa/Lagos';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Lagos';
begin
  delete from public.activity_daily d where d.day between p_from and p_to;

  insert into public.activity_daily (day, metric, grp, n, people)
  select m.day, m.metric,
         case when grouping(a.grp) = 1 then 'all' else coalesce(a.grp, 'other') end,
         count(*), count(distinct m.person_id)
    from (
      select d.day, 'active'::text as metric, d.person_id from public.activity_person_day d where d.day between p_from and p_to
      union all
      select e.day, case e.kind when 'visit' then 'visits' when 'signin' then 'signins' end, e.person_id
        from public.activity_events e where e.at >= t0 and e.at < t1 and e.kind in ('visit', 'signin')
      union all
      select public.activity_lagos_day(p.created_at), 'registered', p.id
        from public.people p where not p.hidden and p.created_at >= t0 and p.created_at < t1
      union all
      select public.activity_lagos_day(mp.submitted_at), 'form_submitted', mp.person_id
        from public.member_profiles mp where mp.submitted_at >= t0 and mp.submitted_at < t1
      union all
      select public.activity_lagos_day(r.ran_at), 'matched', r.person_id
        from public.match_runs r where r.ran_at >= t0 and r.ran_at < t1
      union all
      select public.activity_lagos_day(tm.agreed_at), 'accepted', tm.person_id
        from public.tribe_members tm where tm.agreed_at >= t0 and tm.agreed_at < t1
      union all
      select public.activity_lagos_day(tm.joined_at), 'placed', tm.person_id
        from public.tribe_members tm where tm.joined_at >= t0 and tm.joined_at < t1
      union all
      select public.activity_lagos_day(u.created_at), 'checkins', u.person_id
        from public.pulses u where u.created_at >= t0 and u.created_at < t1
      union all
      select public.activity_lagos_day(g.logged_at), 'reports', g.logged_by
        from public.tribe_logs g where g.logged_at >= t0 and g.logged_at < t1
      union all
      select public.activity_lagos_day(y.created_at), 'testimonies', y.person_id
        from public.testimonies y where y.created_at >= t0 and y.created_at < t1
      union all
      select public.activity_lagos_day(a.created_at), 'leader_started', a.person_id
        from public.leader_applications a where a.created_at >= t0 and a.created_at < t1
      union all
      select public.activity_lagos_day(a.submitted_at), 'leader_submitted', a.person_id
        from public.leader_applications a where a.submitted_at >= t0 and a.submitted_at < t1
      union all
      select public.activity_lagos_day(c.created_at), 'care_opened', c.person_id
        from public.care_tasks c where c.created_at >= t0 and c.created_at < t1
      union all
      select public.activity_lagos_day(c.closed_at), 'care_closed', c.person_id
        from public.care_tasks c where c.closed_at >= t0 and c.closed_at < t1
      union all
      select public.activity_lagos_day(x.sent_at), 'messages_sent', x.person_id
        from public.messages x where x.sent_at >= t0 and x.sent_at < t1
      union all
      select public.activity_lagos_day(x.created_at), 'messages_failed', x.person_id
        from public.messages x where x.status = 'failed' and x.created_at >= t0 and x.created_at < t1
    ) m
    left join public.activity_people a on a.person_id = m.person_id
   where m.metric is not null and (m.person_id is null or a.person_id is not null)
   group by grouping sets ((m.day, m.metric, a.grp), (m.day, m.metric));
end;
$$;

-- When people are active, by hour of the Lagos day, for each group and for all.
create function public.activity_build_hourly(p_from date, p_to date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'Africa/Lagos';
  t1 timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Lagos';
begin
  delete from public.activity_hourly h where h.day between p_from and p_to;

  insert into public.activity_hourly (day, hour, grp, events, people)
  select s.day, s.hour::smallint, case when grouping(a.grp) = 1 then 'all' else a.grp end, count(*), count(distinct s.person_id)
    from (
      select e.person_id, e.day, extract(hour from e.at at time zone 'Africa/Lagos')::int as hour
        from public.activity_events e where e.at >= t0 and e.at < t1
      union all
      select l.actor_id, public.activity_lagos_day(l.at), extract(hour from l.at at time zone 'Africa/Lagos')::int
        from public.event_log l where l.actor_id is not null and l.at >= t0 and l.at < t1
    ) s
    join public.activity_people a on a.person_id = s.person_id
   group by grouping sets ((s.day, s.hour, a.grp), (s.day, s.hour));
end;
$$;

-- Detailed events are kept for the months set in the catalogue (13 by default), then only the daily counts remain.
create function public.activity_prune(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  m integer;
  v_months integer := (select s.retention_months from public.activity_settings s);
begin
  delete from public.activity_events e
   using public.activity_catalogue c
   where c.kind = e.kind and e.at < p_now - make_interval(months => least(c.keep_months, v_months));
  get diagnostics n = row_count;
  delete from public.activity_person_day d where d.day < public.activity_lagos_day(p_now - make_interval(months => v_months));
  get diagnostics m = row_count;
  return n + m;
end;
$$;

-- The refresh. By default it rebuilds the last three Lagos days (late data, a day that just ended). `p_full` rebuilds
-- everything from the earliest thing recorded, which is the one-time back-dated fill.
create function public.activity_refresh(p_now timestamptz default now(), p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(p_now);
  v_from date;
  v_first date;
  v_set public.activity_settings%rowtype;
  v_pruned integer := 0;
begin
  select * into v_set from public.activity_settings;
  perform public.activity_build_people();

  if p_full or v_set.last_backfill is null or v_set.last_refresh is null or v_set.last_refresh < p_now - interval '3 days' then
    select least(
             coalesce((select min(e.day) from public.activity_events e), v_today),
             coalesce((select public.activity_lagos_day(min(p.created_at)) from public.people p), v_today),
             coalesce((select public.activity_lagos_day(min(l.at)) from public.event_log l), v_today))
      into v_first;
    -- Never earlier than the retention window.
    v_from := greatest(v_first, public.activity_lagos_day(p_now - make_interval(months => v_set.retention_months)));
    p_full := true;
  else
    v_from := v_today - 2;
  end if;

  perform public.activity_build_days(v_from, v_today);
  perform public.activity_build_daily(v_from, v_today);
  perform public.activity_build_hourly(v_from, v_today);

  if v_set.last_prune is null or v_set.last_prune < v_today then
    v_pruned := public.activity_prune(p_now);
    update public.activity_settings set last_prune = v_today;
  end if;

  update public.activity_settings
     set last_refresh = p_now, last_backfill = case when p_full then p_now else last_backfill end;
  return jsonb_build_object('activity_days', v_today - v_from + 1, 'activity_full', p_full, 'activity_pruned', v_pruned);
end;
$$;

-- Called from the five-minute heartbeat by the sending service's token (the same token worker_tick uses). It does not
-- change worker_tick, so a later migration that redefines worker_tick cannot drop it.
create function public.worker_activity_refresh(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.activity_refresh(now(), false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's reports. Each one starts with god_only(): anyone else gets the same refusal as a page that does not exist.
-- ---------------------------------------------------------------------------

create function public.activity_pct(p_n numeric, p_d numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$ select case when coalesce(p_d, 0) = 0 then null else round(100.0 * p_n / p_d, 1) end $$;

-- A named number for a stakeholder panel.
create function public.activity_m(
  p_key text,
  p_label text,
  p_value jsonb,
  p_prev jsonb default null,
  p_unit text default 'count',
  p_note text default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'value', p_value, 'prev', p_prev, 'unit', p_unit, 'note', p_note)
$$;

-- The "Needs a decision" items: every flag whose number passes the threshold the owner set. Internal: used by the Pulse
-- tab and the weekly brief, which both start with god_only().
create function public.activity_decisions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.activity_thresholds%rowtype;
  v numeric;
  flagged boolean;
  items jsonb := '[]'::jsonb;
  v_today date := public.activity_lagos_day(now());
begin
  for r in select * from public.activity_thresholds t order by t.sort loop
    v := null;
    flagged := false;
    if r.key = 'member_wait_days' then
      select count(*) into v
        from public.member_profiles mp
       where mp.submitted_at < now() - make_interval(days => r.value::int)
         and exists (select 1 from public.seasons s where s.id = mp.season_id and s.status in ('open', 'running'))
         and not exists (select 1 from public.tribe_members tm
                          where tm.person_id = mp.person_id and tm.season_id = mp.season_id and tm.status = 'active')
         and exists (select 1 from public.activity_people ap where ap.person_id = mp.person_id);
      flagged := v > 0;
    elsif r.key = 'application_held_hours' then
      select count(*) into v from public.leader_ai_state s
       where s.state = 'held' and s.state_at < now() - make_interval(hours => r.value::int);
      flagged := v > 0;
    elsif r.key = 'referee_unverified_days' then
      select count(*) into v
        from public.leader_references lr
        join public.leader_applications a on a.id = lr.application_id
        left join public.referee_trust t on t.reference_id = lr.id
       where lr.sent_at is not null and lr.sent_at < now() - make_interval(days => r.value::int)
         and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
         and lr.stage <> 'unreachable'
         and coalesce(t.verification, 'unverified') = 'unverified' and not coalesce(t.legacy, false);
      flagged := v > 0;
    elsif r.key = 'failed_messages_7d' then
      select count(*) into v from public.messages m where m.status = 'failed' and m.created_at > now() - interval '7 days';
      flagged := v >= r.value;
    elsif r.key = 'care_overdue_days' then
      select count(*) into v from public.care_tasks c
       where c.status = 'open' and c.due_on < v_today - r.value::int;
      flagged := v > 0;
    elsif r.key = 'signin_fail_pct' then
      select case when count(*) filter (where a.outcome in ('sent', 'delivered', 'failed', 'rejected')) >= 20
                  then round(100.0 * count(*) filter (where a.outcome in ('failed', 'rejected'))
                             / count(*) filter (where a.outcome in ('sent', 'delivered', 'failed', 'rejected')), 1) end
        into v
        from public.signin_attempts a where a.at > now() - interval '7 days' and a.counted;
      flagged := v is not null and v >= r.value;
    elsif r.key = 'quiet_days' then
      select count(*) into v
        from public.tribe_members tm
        join public.activity_people ap on ap.person_id = tm.person_id
       where tm.status = 'active'
         and coalesce((select max(d.day) from public.activity_person_day d where d.person_id = tm.person_id), date '1970-01-01')
             < v_today - r.value::int;
      flagged := v > 0;
    end if;
    if flagged then
      items := items || jsonb_build_array(jsonb_build_object(
        'key', r.key,
        'label', replace(r.label, '{value}', trim_scale(r.value)::text),
        'value', v, 'threshold', r.value, 'unit', r.unit, 'action', r.action, 'href', r.href));
    end if;
  end loop;
  return items;
end;
$$;

-- Tab 1. How are we doing this week, and what needs a decision now?
create function public.activity_pulse()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_active jsonb;
  v_groups jsonb;
  v_tiles jsonb;
  v_trend jsonb;
  v_status jsonb;
begin
  perform public.god_only();

  select jsonb_build_object(
           'today', count(distinct d.person_id) filter (where d.day = v_today),
           'd7',    count(distinct d.person_id) filter (where d.day > v_today - 7),
           'p7',    count(distinct d.person_id) filter (where d.day between v_today - 13 and v_today - 7),
           'd30',   count(distinct d.person_id) filter (where d.day > v_today - 30),
           'p30',   count(distinct d.person_id) filter (where d.day between v_today - 59 and v_today - 30))
    into v_active
    from public.activity_person_day d where d.day > v_today - 60;

  select coalesce(jsonb_object_agg(g.grp, jsonb_build_object('d7', public.activity_c(g.d7), 'd30', public.activity_c(g.d30))), '{}'::jsonb)
    into v_groups
    from (select ap.grp,
                 count(distinct d.person_id) filter (where d.day > v_today - 7) as d7,
                 count(distinct d.person_id) as d30
            from public.activity_person_day d
            join public.activity_people ap on ap.person_id = d.person_id
           where d.day > v_today - 30
           group by ap.grp) g;

  select coalesce(jsonb_object_agg(x.metric, jsonb_build_object('today', x.d1, 'd7', x.d7, 'p7', x.p7, 'd30', x.d30, 'p30', x.p30)), '{}'::jsonb)
    into v_tiles
    from (select d.metric,
                 coalesce(sum(d.n) filter (where d.day = v_today), 0) as d1,
                 coalesce(sum(d.n) filter (where d.day > v_today - 7), 0) as d7,
                 coalesce(sum(d.n) filter (where d.day between v_today - 13 and v_today - 7), 0) as p7,
                 coalesce(sum(d.n) filter (where d.day > v_today - 30), 0) as d30,
                 coalesce(sum(d.n) filter (where d.day between v_today - 59 and v_today - 30), 0) as p30
            from public.activity_daily d
           where d.grp = 'all' and d.day > v_today - 60
           group by d.metric) x;

  select jsonb_build_object(
           'days', (select jsonb_agg((v_today - i)::text order by i desc) from generate_series(0, 29) i),
           'series', coalesce(jsonb_object_agg(m.metric, jsonb_build_object('now', m.now_arr, 'prev', m.prev_arr)), '{}'::jsonb))
    into v_trend
    from (select k.metric,
                 (select jsonb_agg(coalesce(d.n, 0) order by i desc)
                    from generate_series(0, 29) i
                    left join public.activity_daily d on d.metric = k.metric and d.grp = 'all' and d.day = v_today - i) as now_arr,
                 (select jsonb_agg(coalesce(d.n, 0) order by i desc)
                    from generate_series(0, 29) i
                    left join public.activity_daily d on d.metric = k.metric and d.grp = 'all' and d.day = v_today - i - 30) as prev_arr
            from (values ('active'), ('registered'), ('form_submitted'), ('placed'), ('visits')) k(metric)) m;

  select jsonb_build_object(
           'recording', s.recording,
           'retention_months', s.retention_months,
           'last_refresh', s.last_refresh,
           'last_backfill', s.last_backfill,
           'recording_since', (select min(e.at) from public.activity_events e where e.kind in ('visit', 'signin', 'screen')))
    into v_status
    from public.activity_settings s;

  return jsonb_build_object(
    'today', v_today,
    'active', v_active,
    'groups', v_groups,
    'metrics', v_tiles,
    'trend', v_trend,
    'decisions', public.activity_decisions(),
    'status', v_status);
end;
$$;

-- The weekly brief: the last whole week (Monday to Sunday), five numbers against the week before, and up to three things
-- that need a decision. Counts only; the words are put together by fixed rules on the website. Never sent anywhere.
create function public.activity_brief()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_mon date := (date_trunc('week', v_today::timestamp)::date) - 7;
  v_prev date := v_mon - 7;
  v_numbers jsonb;
  v_active jsonb;
begin
  perform public.god_only();

  select jsonb_build_object(
           'now',  count(distinct d.person_id) filter (where d.day between v_mon and v_mon + 6),
           'prev', count(distinct d.person_id) filter (where d.day between v_prev and v_prev + 6))
    into v_active
    from public.activity_person_day d where d.day between v_prev and v_mon + 6;

  select coalesce(jsonb_object_agg(x.metric, jsonb_build_object('now', x.now, 'prev', x.prev)), '{}'::jsonb)
    into v_numbers
    from (select d.metric,
                 coalesce(sum(d.n) filter (where d.day between v_mon and v_mon + 6), 0) as now,
                 coalesce(sum(d.n) filter (where d.day between v_prev and v_prev + 6), 0) as prev
            from public.activity_daily d
           where d.grp = 'all' and d.day between v_prev and v_mon + 6
             and d.metric in ('registered', 'form_submitted', 'placed', 'messages_failed')
           group by d.metric) x;

  return jsonb_build_object(
    'week_start', v_mon,
    'week_end', v_mon + 6,
    'active', v_active,
    'numbers', v_numbers,
    'decisions', coalesce((select jsonb_agg(i) from (select i from jsonb_array_elements(public.activity_decisions()) i limit 3) t), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Tab 2. Where do people stop? The funnels, and the people behind each bar.
-- ---------------------------------------------------------------------------

-- Where each person who registered in the period got to on the member journey. `stage` is the furthest step reached, in
-- order: 1 registered, 2 form saved, 3 submitted, 4 matched, 5 accepted a place, 6 week 1, 7 week 4, 8 week 12.
-- Internal: the reports below call it after god_only().
create function public.activity_member_rows(p_from date, p_to date)
returns table (
  person_id uuid, grp text, community_id uuid, zone text, season_id uuid, stage smallint,
  t1 timestamptz, t2 timestamptz, t3 timestamptz, t4 timestamptz, t5 timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.person_id, c.grp, c.community_id, c.zone, c.season_id,
         (case
            when d.person_id is null and ev.t_started is null and mp.submitted_at is null then 1
            when mp.submitted_at is null then 2
            when mr.t_match is null then 3
            when tm.t_acc is null then 4
            when coalesce(att.maxw, 0) < 1 then 5
            when att.maxw < 4 then 6
            when att.maxw < 12 then 7
            else 8
          end)::smallint,
         c.t_reg, coalesce(d.started_at, ev.t_started, mp.submitted_at), mp.submitted_at, mr.t_match, tm.t_acc
    from (select ap.person_id, ap.grp, ap.community_id, ap.zone, ap.season_id, p.created_at as t_reg
            from public.activity_people ap
            join public.people p on p.id = ap.person_id
           where ap.grp in ('member', 'young', 'leader')
             and p.created_at >= (p_from::timestamp at time zone 'Africa/Lagos')
             and p.created_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')) c
    left join public.intake_drafts d on d.person_id = c.person_id
    left join (select e.person_id, min(e.at) as t_started
                 from public.activity_events e
                where e.kind = 'form.started' and e.meta ->> 'form' = 'member'
                group by e.person_id) ev on ev.person_id = c.person_id
    left join public.member_profiles mp on mp.person_id = c.person_id
    left join (select x.person_id, min(x.at) as t_match
                 from (select r.person_id, r.ran_at as at from public.match_runs r
                       union all
                       select m.person_id, coalesce(m.joined_at, m.agreed_at, m.called_at, now()) from public.tribe_members m) x
                group by x.person_id) mr on mr.person_id = c.person_id
    left join (select m.person_id, min(m.agreed_at) as t_acc
                 from public.tribe_members m where m.agreed_at is not null group by m.person_id) tm on tm.person_id = c.person_id
    left join (select a.person_id, max(a.week) filter (where a.status = 'present') as maxw
                 from public.tribe_attendance a group by a.person_id) att on att.person_id = c.person_id
$$;

-- Where each leader application that was started in the period got to. `stage` runs 1 started, 2 to 22 each step of the
-- application (the step it is on, or has passed), 23 submitted, 24 the first score was clear, 25 both referees verified,
-- 26 interview, 27 approved, 28 leading.
create function public.activity_leader_rows(p_from date, p_to date)
returns table (
  person_id uuid, grp text, community_id uuid, zone text, season_id uuid, stage smallint,
  t1 timestamptz, t2 timestamptz, t3 timestamptz, t4 timestamptz, t5 timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

create function public.activity_funnels(
  p_which text default 'member',
  p_from date default null,
  p_to date default null,
  p_split text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, public.activity_lagos_day(now()));
  v_from date := coalesce(p_from, coalesce(p_to, public.activity_lagos_day(now())) - 89);
  v_stages jsonb;
  v_total bigint;
  v_split jsonb := null;
  v_finish jsonb := null;
begin
  perform public.god_only();
  if p_which not in ('member', 'leader') then
    raise exception 'Unknown funnel' using errcode = '22023';
  end if;
  if p_split is not null and (p_which <> 'member' or p_split not in ('community', 'zone', 'season')) then
    raise exception 'Unknown split' using errcode = '22023';
  end if;
  if v_from > v_to then
    raise exception 'The start is after the end' using errcode = '22023';
  end if;

  with stg(k, key, label) as (
    select v.k, v.key, v.label
      from (values (1, 'registered', 'Registered'), (2, 'form_saved', 'Form saved'), (3, 'submitted', 'Form submitted'),
                   (4, 'matched', 'Matched'), (5, 'accepted', 'Accepted a place'), (6, 'week1', 'Week 1'),
                   (7, 'week4', 'Week 4'), (8, 'week12', 'Week 12')) v(k, key, label)
     where p_which = 'member'
    union all
    select 1, 'started', 'Started' where p_which = 'leader'
    union all
    select 1 + s.position, 'step_' || s.step, s.label from public.activity_steps s where s.form = 'leader' and p_which = 'leader'
    union all
    select v.k, v.key, v.label
      from (values (23, 'submitted', 'Submitted'), (24, 'ai_clear', 'First score clear'), (25, 'referees', 'Referees verified'),
                   (26, 'interview', 'Interview'), (27, 'approved', 'Approved'), (28, 'leading', 'Leading')) v(k, key, label)
     where p_which = 'leader'
  ),
  r as (
    select * from public.activity_member_rows(v_from, v_to) where p_which = 'member'
    union all
    select * from public.activity_leader_rows(v_from, v_to) where p_which = 'leader'
  ),
  cnt as (
    select s.k, x.reached, x.stopped
      from stg s
      cross join lateral (select count(*) filter (where r.stage >= s.k) as reached,
                                 count(*) filter (where r.stage = s.k) as stopped
                            from r) x
  ),
  med as (
    select percentile_cont(0.5) within group (order by extract(epoch from greatest(r.t2 - r.t1, interval '0')))
             filter (where r.t1 is not null and r.t2 is not null) / 3600 as m2,
           percentile_cont(0.5) within group (order by extract(epoch from greatest(r.t3 - r.t2, interval '0')))
             filter (where r.t2 is not null and r.t3 is not null) / 3600 as m3,
           percentile_cont(0.5) within group (order by extract(epoch from greatest(r.t4 - r.t3, interval '0')))
             filter (where r.t3 is not null and r.t4 is not null) / 3600 as m4,
           percentile_cont(0.5) within group (order by extract(epoch from greatest(r.t5 - r.t4, interval '0')))
             filter (where r.t4 is not null and r.t5 is not null) / 3600 as m5
      from r
  )
  select jsonb_agg(jsonb_build_object(
           'k', s.k, 'key', s.key, 'label', s.label,
           'reached', public.activity_c(c.reached),
           'stopped', public.activity_c(c.stopped),
           'pct_start', case when c.reached >= public.activity_min_group() then public.activity_pct(c.reached, f0.reached) end,
           'pct_prev', case when c.reached >= public.activity_min_group() and pv.reached >= public.activity_min_group()
                            then public.activity_pct(c.reached, pv.reached) end,
           'median_hours', case
             when p_which = 'member' and s.k = 2 then round(med.m2::numeric, 1)
             when p_which = 'member' and s.k = 3 then round(med.m3::numeric, 1)
             when p_which = 'member' and s.k = 4 then round(med.m4::numeric, 1)
             when p_which = 'member' and s.k = 5 then round(med.m5::numeric, 1)
             when p_which = 'leader' and s.k = 23 then round(med.m2::numeric, 1)
           end) order by s.k),
         max(c.reached) filter (where s.k = 1)
    into v_stages, v_total
    from stg s
    join cnt c on c.k = s.k
    left join cnt pv on pv.k = s.k - 1
    cross join (select x.reached from cnt x where x.k = 1) f0
    cross join med;

  if p_split is not null then
    with r as (select * from public.activity_member_rows(v_from, v_to)),
    keyed as (
      select r.*,
             case p_split
               when 'community' then coalesce((select c.name from public.communities c where c.id = r.community_id), 'Not given')
               when 'zone' then coalesce(nullif(btrim(r.zone), ''), 'Not given')
               else coalesce((select s.name from public.seasons s where s.id = r.season_id), 'Not given')
             end as label
        from r),
    g as (select k.label, count(*) as total from keyed k group by k.label),
    gk as (select k.label, kk, count(*) filter (where k.stage >= kk) as reached
             from keyed k cross join generate_series(1, 8) kk group by k.label, kk)
    select jsonb_agg(jsonb_build_object(
             'value', g.label,
             'total', public.activity_c(g.total),
             'reached', (select jsonb_agg(public.activity_c(gk.reached) order by gk.kk) from gk where gk.label = g.label))
             order by g.total desc, g.label)
      into v_split
      from g;
  end if;

  if p_which = 'member' then
    select jsonb_build_object(
             'n', count(*),
             'p25', case when count(*) >= public.activity_min_group() then round(percentile_cont(0.25) within group (order by mp.duration_seconds)::numeric) end,
             'p50', case when count(*) >= public.activity_min_group() then round(percentile_cont(0.5) within group (order by mp.duration_seconds)::numeric) end,
             'p75', case when count(*) >= public.activity_min_group() then round(percentile_cont(0.75) within group (order by mp.duration_seconds)::numeric) end,
             'p90', case when count(*) >= public.activity_min_group() then round(percentile_cont(0.9) within group (order by mp.duration_seconds)::numeric) end,
             'bins', jsonb_build_array(
               jsonb_build_object('label', 'Under 2 min', 'n', public.activity_c(count(*) filter (where mp.duration_seconds < 120))),
               jsonb_build_object('label', '2 to 4 min', 'n', public.activity_c(count(*) filter (where mp.duration_seconds >= 120 and mp.duration_seconds < 240))),
               jsonb_build_object('label', '4 to 6 min', 'n', public.activity_c(count(*) filter (where mp.duration_seconds >= 240 and mp.duration_seconds < 360))),
               jsonb_build_object('label', '6 to 8 min', 'n', public.activity_c(count(*) filter (where mp.duration_seconds >= 360 and mp.duration_seconds < 480))),
               jsonb_build_object('label', '8 to 12 min', 'n', public.activity_c(count(*) filter (where mp.duration_seconds >= 480 and mp.duration_seconds < 720))),
               jsonb_build_object('label', '12 min or more', 'n', public.activity_c(count(*) filter (where mp.duration_seconds >= 720)))))
      into v_finish
      from public.member_profiles mp
      join public.activity_people ap on ap.person_id = mp.person_id
     where mp.duration_seconds is not null
       and mp.submitted_at >= (v_from::timestamp at time zone 'Africa/Lagos')
       and mp.submitted_at < ((v_to + 1)::timestamp at time zone 'Africa/Lagos');
  end if;

  return jsonb_build_object(
    'which', p_which, 'from', v_from, 'to', v_to,
    'total', coalesce(v_total, 0),
    'stages', coalesce(v_stages, '[]'::jsonb),
    'split', v_split,
    'finish', v_finish);
end;
$$;

-- The people behind one bar of a funnel: those who stopped at that step ('stopped') or got at least as far ('reached').
-- A bar with fewer than 5 people returns nobody, and a young member is counted but never named.
create function public.activity_funnel_people(
  p_which text,
  p_stage integer,
  p_mode text default 'stopped',
  p_from date default null,
  p_to date default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, public.activity_lagos_day(now()));
  v_from date := coalesce(p_from, coalesce(p_to, public.activity_lagos_day(now())) - 89);
  v_total bigint;
  v_young bigint;
  v_people jsonb := '[]'::jsonb;
begin
  perform public.god_only();
  if p_which not in ('member', 'leader') or p_mode not in ('stopped', 'reached') or p_stage is null or p_stage < 1 then
    raise exception 'Unknown bar' using errcode = '22023';
  end if;

  with r as (
    select * from public.activity_member_rows(v_from, v_to) where p_which = 'member'
    union all
    select * from public.activity_leader_rows(v_from, v_to) where p_which = 'leader'
  )
  select count(*), count(*) filter (where r.grp = 'young') into v_total, v_young
    from r where case p_mode when 'reached' then r.stage >= p_stage else r.stage = p_stage end;

  if v_total >= public.activity_min_group() then
    with r as (
      select * from public.activity_member_rows(v_from, v_to) where p_which = 'member'
      union all
      select * from public.activity_leader_rows(v_from, v_to) where p_which = 'leader'
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), p.email),
             'group', x.grp, 'since', p.created_at) order by p.created_at desc), '[]'::jsonb)
      into v_people
      from (select r.person_id, r.grp from r
             where r.grp <> 'young' and case p_mode when 'reached' then r.stage >= p_stage else r.stage = p_stage end
             order by r.person_id limit least(greatest(coalesce(p_limit, 100), 1), 200)) x
      join public.people p on p.id = x.person_id;
  end if;

  return jsonb_build_object('total', public.activity_c(v_total), 'young', public.activity_c(v_young),
                            'hidden', v_total < public.activity_min_group(), 'people', v_people);
end;
$$;

-- Compare communities, zones or tribes side by side. A group with fewer than 5 people shows "<5" and no percentages.
create function public.activity_compare(p_by text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_rows jsonb;
begin
  perform public.god_only();
  if p_by not in ('community', 'zone', 'tribe') then
    raise exception 'Unknown comparison' using errcode = '22023';
  end if;

  if p_by in ('community', 'zone') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'label', g.label,
             'members', public.activity_c(g.n),
             'submitted_pct', case when g.n >= public.activity_min_group() then public.activity_pct(g.submitted, g.n) end,
             'placed_pct', case when g.n >= public.activity_min_group() then public.activity_pct(g.placed, g.n) end,
             'active_pct', case when g.n >= public.activity_min_group() then public.activity_pct(g.active, g.n) end)
             order by g.n desc, g.label), '[]'::jsonb)
      into v_rows
      from (select case p_by when 'community' then coalesce(cm.name, 'Not given') else coalesce(nullif(btrim(ap.zone), ''), 'Not given') end as label,
                   count(*) as n,
                   count(*) filter (where mp.submitted_at is not null) as submitted,
                   count(*) filter (where exists (select 1 from public.tribe_members tm where tm.person_id = ap.person_id and tm.status = 'active')) as placed,
                   count(*) filter (where exists (select 1 from public.activity_person_day d
                                                   where d.person_id = ap.person_id and d.day > v_today - 30)) as active
              from public.activity_people ap
              left join public.member_profiles mp on mp.person_id = ap.person_id
              left join public.communities cm on cm.id = ap.community_id
             where ap.grp in ('member', 'young', 'leader')
             group by 1) g;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'label', g.name,
             'members', public.activity_c(g.n),
             'active_pct', case when g.n >= public.activity_min_group() then public.activity_pct(g.active, g.n) end,
             'attendance_pct', case when g.n >= public.activity_min_group() then g.attendance end)
             order by g.n desc, g.name), '[]'::jsonb)
      into v_rows
      from (select t.name, count(*) as n,
                   count(*) filter (where exists (select 1 from public.activity_person_day d
                                                   where d.person_id = tm.person_id and d.day > v_today - 30)) as active,
                   (select public.activity_pct(count(*) filter (where a.status = 'present'), count(*))
                      from public.tribe_attendance a where a.tribe_id = t.id) as attendance
              from public.tribes t
              join public.tribe_members tm on tm.tribe_id = t.id and tm.status = 'active'
             group by t.id, t.name
             order by count(*) desc, t.name
             limit 40) g;
  end if;
  return jsonb_build_object('by', p_by, 'rows', v_rows);
end;
$$;

-- A weekly retention grid by start week: of the people who registered in a week, how many were active in that week, the
-- next, and so on. A cell with fewer than 5 people reads "<5"; a week nobody joined has no cells (null).
create function public.activity_retention(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 2), 26);
  v_start date;
  v_rows jsonb;
begin
  perform public.god_only();
  v_start := (date_trunc('week', v_today::timestamp)::date) - 7 * (v_weeks - 1);

  with coh as materialized (
    select ap.person_id, date_trunc('week', ap.joined_day::timestamp)::date as w0
      from public.activity_people ap
     where ap.grp <> 'pastoral' and ap.joined_day >= v_start
  ),
  sizes as materialized (select c.w0, count(*) as size from coh c group by c.w0),
  act as materialized (
    select d.person_id, date_trunc('week', d.day::timestamp)::date as w
      from public.activity_person_day d where d.day >= v_start group by 1, 2
  ),
  cells as materialized (
    select c.w0, ((a.w - c.w0) / 7) as k, count(*) as n
      from coh c join act a on a.person_id = c.person_id and a.w >= c.w0
     group by 1, 2
  ),
  wk as (select (v_start + 7 * i) as w0 from generate_series(0, v_weeks - 1) i)
  select jsonb_agg(jsonb_build_object(
           'start', wk.w0,
           'size', public.activity_c(coalesce(s.size, 0)),
           'cells', (select jsonb_agg(
                       case when coalesce(s.size, 0) = 0 then 'null'::jsonb
                            when coalesce(s.size, 0) < public.activity_min_group() then to_jsonb('<5'::text)
                            when coalesce(c.n, 0) between 1 and public.activity_min_group() - 1 then to_jsonb('<5'::text)
                            else to_jsonb(round(100.0 * coalesce(c.n, 0) / s.size)) end order by kk)
                       from generate_series(0, ((v_today - wk.w0) / 7)) kk
                       left join cells c on c.w0 = wk.w0 and c.k = kk)) order by wk.w0)
    into v_rows
    from wk left join sizes s on s.w0 = wk.w0;

  return jsonb_build_object('weeks', coalesce(v_rows, '[]'::jsonb));
end;
$$;

-- When people are active: a weekday-by-hour grid for the last N days (counted exactly, so a cell with fewer than 5
-- different people reads "<5"), and for each large enough group the share of its activity by hour.
create function public.activity_heatmap(p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_days integer := least(greatest(coalesce(p_days, 28), 7), 90);
  t0 timestamptz;
  v_cells jsonb;
  v_groups jsonb;
begin
  perform public.god_only();
  t0 := (v_today - v_days + 1)::timestamp at time zone 'Africa/Lagos';

  select coalesce(jsonb_agg(jsonb_build_object('dow', c.dow, 'hour', c.hour, 'people', public.activity_c(c.n), 'events', c.e)), '[]'::jsonb)
    into v_cells
    from (select extract(isodow from s.at at time zone 'Africa/Lagos')::int as dow,
                 extract(hour from s.at at time zone 'Africa/Lagos')::int as hour,
                 count(distinct s.person_id) as n, count(*) as e
            from (select e.person_id, e.at from public.activity_events e where e.at >= t0
                  union all
                  select l.actor_id, l.at from public.event_log l where l.actor_id is not null and l.at >= t0) s
            join public.activity_people ap on ap.person_id = s.person_id
           group by 1, 2) c;

  select coalesce(jsonb_object_agg(g.grp, g.hours), '{}'::jsonb)
    into v_groups
    from (select h.grp,
                 (select jsonb_agg(coalesce(x.e, 0) order by hh)
                    from generate_series(0, 23) hh
                    left join (select hr.hour, sum(hr.events) as e from public.activity_hourly hr
                                where hr.grp = h.grp and hr.day > v_today - v_days group by hr.hour) x on x.hour = hh) as hours
            from (select distinct hr.grp from public.activity_hourly hr where hr.grp <> 'all' and hr.day > v_today - v_days) h
           where (select count(distinct d.person_id) from public.activity_person_day d
                    join public.activity_people ap on ap.person_id = d.person_id
                   where ap.grp = h.grp and d.day > v_today - v_days) >= public.activity_min_group()) g;

  return jsonb_build_object('days', v_days, 'cells', v_cells, 'groups', v_groups);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tab 3. What is each group actually doing?
-- ---------------------------------------------------------------------------

create function public.activity_stakeholders()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_panels jsonb := '[]'::jsonb;
  v_min integer := public.activity_min_group();
  m jsonb;
  a numeric;
  b numeric;
  x text;
begin
  perform public.god_only();

  -- ------------------------------------------------------------------ Members
  select jsonb_build_array(
    public.activity_m('active', 'Active in the last 30 days',
      public.activity_c((select count(distinct d.person_id) from public.activity_person_day d join public.activity_people ap on ap.person_id = d.person_id
                          where ap.grp in ('member', 'young') and d.day > v_today - 30)),
      public.activity_c((select count(distinct d.person_id) from public.activity_person_day d join public.activity_people ap on ap.person_id = d.person_id
                          where ap.grp in ('member', 'young') and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('signed_in', 'Signed in at least once (30 days)',
      public.activity_c((select count(distinct e.person_id) from public.activity_events e join public.activity_people ap on ap.person_id = e.person_id
                          where e.kind = 'signin' and ap.grp in ('member', 'young') and e.day > v_today - 30)),
      public.activity_c((select count(distinct e.person_id) from public.activity_events e join public.activity_people ap on ap.person_id = e.person_id
                          where e.kind = 'signin' and ap.grp in ('member', 'young') and e.day between v_today - 59 and v_today - 30))),
    public.activity_m('submitted', 'Forms submitted (30 days)',
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'form_submitted' and d.grp in ('member', 'young', 'leader') and d.day > v_today - 30)),
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'form_submitted' and d.grp in ('member', 'young', 'leader') and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('checkins', 'Check-ins (30 days)',
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'checkins' and d.grp = 'all' and d.day > v_today - 30)),
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'checkins' and d.grp = 'all' and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('testimonies', 'Testimonies shared (30 days)',
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'testimonies' and d.grp = 'all' and d.day > v_today - 30)),
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'testimonies' and d.grp = 'all' and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('profile_changes', 'Profile changes (30 days)',
      public.activity_c((select count(*) from public.activity_events e where e.kind = 'form.profile_changed' and e.day > v_today - 30)),
      public.activity_c((select count(*) from public.activity_events e where e.kind = 'form.profile_changed' and e.day between v_today - 59 and v_today - 30))),
    public.activity_m('finish_minutes', 'Median time to finish the form',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by mp.duration_seconds) / 60)::numeric, 1)) end
         from public.member_profiles mp where mp.duration_seconds is not null and mp.submitted_at > now() - interval '90 days'),
      null, 'minutes'),
    public.activity_m('peak_hour', 'Busiest hour of the day (Lagos)',
      (select case when (select count(distinct d.person_id) from public.activity_person_day d join public.activity_people ap on ap.person_id = d.person_id
                          where ap.grp = 'member' and d.day > v_today - 30) >= v_min
                   then (select to_jsonb(h.hour) from public.activity_hourly h where h.grp = 'member' and h.day > v_today - 30
                          group by h.hour order by sum(h.events) desc, h.hour limit 1) end),
      null, 'hour')
  ) into m;
  select s.step || '|' || s.label || '|' || s.n into x
    from (select st.step, st.label, count(*) as n
            from public.intake_drafts d join public.activity_steps st on st.form = 'member' and st.step = d.step
           where d.updated_at < now() - interval '3 days'
           group by st.step, st.label order by count(*) desc, st.step limit 1) s;
  if x is not null then
    m := m || jsonb_build_array(public.activity_m('stuck_step', 'Where unfinished forms are sitting',
           public.activity_c(split_part(x, '|', 3)::bigint), null, 'count',
           case when split_part(x, '|', 3)::bigint >= v_min then split_part(x, '|', 2) end));
  end if;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'members', 'title', 'Members',
    'informs', 'Where the form loses people, when to send reminders, who is drifting away', 'metrics', m));

  -- ---------------------------------------------------------- Leader applicants
  select jsonb_build_array(
    public.activity_m('started', 'Applications started (30 days)',
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'leader_started' and d.grp = 'all' and d.day > v_today - 30)),
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'leader_started' and d.grp = 'all' and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('submitted', 'Applications submitted (30 days)',
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'leader_submitted' and d.grp = 'all' and d.day > v_today - 30)),
      public.activity_c((select coalesce(sum(d.n), 0) from public.activity_daily d where d.metric = 'leader_submitted' and d.grp = 'all' and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('days_to_submit', 'Median days from start to submit',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by extract(epoch from (a.submitted_at - a.created_at)) / 86400))::numeric, 1)) end
         from public.leader_applications a where a.submitted_at > now() - interval '90 days'),
      null, 'days'),
    public.activity_m('rewrites', 'Rewrites after feedback (90 days)',
      (select to_jsonb(coalesce(sum(s.rewrites_used), 0)) from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
        where a.created_at > now() - interval '90 days')),
    public.activity_m('ai_clear', 'First score clear (90 days)',
      public.activity_c((select count(*) from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
                          where a.created_at > now() - interval '90 days' and s.state = 'clear'))),
    public.activity_m('ai_strengthen', 'Asked to strengthen (90 days)',
      public.activity_c((select count(*) from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
                          where a.created_at > now() - interval '90 days' and s.state = 'strengthen'))),
    public.activity_m('ai_held', 'Held for a person (90 days)',
      public.activity_c((select count(*) from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
                          where a.created_at > now() - interval '90 days' and s.state = 'held'))),
    public.activity_m('appeals_upheld', 'Held cases a person cleared (90 days)',
      public.activity_c((select count(*) from public.leader_ai_state s join public.leader_applications a on a.id = s.application_id
                          where a.created_at > now() - interval '90 days' and s.state = 'cleared_by_person')))
  ) into m;
  select s.step || '|' || s.label || '|' || s.n into x
    from (select st.step, st.label, count(*) as n
            from public.leader_applications la join public.activity_steps st on st.form = 'leader' and st.step = la.step
           where la.submitted_at is null and la.status = 'draft' and la.updated_at < now() - interval '3 days'
           group by st.step, st.label order by count(*) desc, st.step limit 1) s;
  if x is not null then
    m := m || jsonb_build_array(public.activity_m('stuck_step', 'Where unfinished applications are sitting',
           public.activity_c(split_part(x, '|', 3)::bigint), null, 'count',
           case when split_part(x, '|', 3)::bigint >= v_min then split_part(x, '|', 2) end));
  end if;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'applicants', 'title', 'Leader applicants',
    'informs', 'Which question confuses people, and whether the AI is too strict or too lenient', 'metrics', m));

  -- ------------------------------------------------------------------- Referees
  select jsonb_build_array(
    public.activity_m('sent', 'Links sent (30 days)',
      (select to_jsonb(count(*)) from public.leader_references r where r.sent_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.leader_references r where r.sent_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('opened', 'Opened (30 days)',
      (select to_jsonb(count(*)) from public.referee_trust t where t.opened_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.referee_trust t where t.opened_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('verified', 'Verified (30 days)',
      (select to_jsonb(count(*)) from public.referee_trust t where t.verified_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.referee_trust t where t.verified_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('answered', 'Answered (30 days)',
      (select to_jsonb(count(*)) from public.leader_references r where r.submitted_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.leader_references r where r.submitted_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('hours_to_respond', 'Median hours from link to answer',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by extract(epoch from (r.submitted_at - r.sent_at)) / 3600))::numeric, 1)) end
         from public.leader_references r where r.submitted_at > now() - interval '90 days' and r.sent_at is not null),
      null, 'hours'),
    public.activity_m('flags_open', 'Flags waiting to be looked at',
      (select to_jsonb(count(*)) from public.leader_reference_flags f where f.cleared_at is null))
  ) into m;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'referees', 'title', 'Referees',
    'informs', 'Which referees to chase, and whether the process is too slow', 'metrics', m));

  -- ------------------------------------------------------------ Leaders in post
  select jsonb_build_array(
    public.activity_m('active', 'Leaders active (30 days)',
      public.activity_c((select count(distinct d.person_id) from public.activity_person_day d join public.activity_people ap on ap.person_id = d.person_id
                          where ap.grp = 'leader' and d.day > v_today - 30)),
      public.activity_c((select count(distinct d.person_id) from public.activity_person_day d join public.activity_people ap on ap.person_id = d.person_id
                          where ap.grp = 'leader' and d.day between v_today - 59 and v_today - 30))),
    public.activity_m('reports', 'Weekly reports recorded (30 days)',
      (select to_jsonb(count(*)) from public.tribe_logs g where g.logged_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.tribe_logs g where g.logged_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('quiet_tribes', 'Tribes with no report in 14 days',
      (select to_jsonb(count(*)) from public.tribes t
        where t.status = 'approved' and t.first_meeting_on < v_today - 14
          and not exists (select 1 from public.tribe_logs g where g.tribe_id = t.id and g.logged_at > now() - interval '14 days'))),
    public.activity_m('care_raised', 'Care tasks raised by leaders (30 days)',
      (select to_jsonb(count(*)) from public.care_tasks c join public.activity_people ap on ap.person_id = c.raised_by
        where ap.grp = 'leader' and c.created_at > now() - interval '30 days')),
    public.activity_m('coach_help', 'Asks for a coach (30 days)',
      (select to_jsonb(count(*)) from public.care_tasks c where c.kind = 'coach_help' and c.created_at > now() - interval '30 days'))
  ) into m;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'leaders', 'title', 'Leaders in post',
    'informs', 'Who needs support, and which tribes are at risk', 'metrics', m));

  -- ------------------------------------------------------ Admin and care team
  select jsonb_build_array(
    public.activity_m('actions', 'Actions recorded (30 days)',
      (select to_jsonb(count(*)) from public.event_log l join public.activity_people ap on ap.person_id = l.actor_id
        where ap.grp = 'team' and l.at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.event_log l join public.activity_people ap on ap.person_id = l.actor_id
        where ap.grp = 'team' and l.at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('care_on_time', 'Care tasks closed on time (90 days)',
      (select case when count(*) >= v_min then to_jsonb(public.activity_pct(count(*) filter (where public.activity_lagos_day(c.closed_at) <= c.due_on), count(*))) end
         from public.care_tasks c where c.status = 'done' and c.closed_at > now() - interval '90 days'),
      null, 'percent'),
    public.activity_m('care_response_hours', 'Median hours to close a care task',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by extract(epoch from (c.closed_at - c.created_at)) / 3600))::numeric, 1)) end
         from public.care_tasks c where c.status = 'done' and c.closed_at > now() - interval '90 days'),
      null, 'hours'),
    public.activity_m('overrides', 'AI results overridden by the team (30 days)',
      (select to_jsonb(count(*)) from public.event_log l join public.activity_people ap on ap.person_id = l.actor_id
        where ap.grp in ('team', 'pastoral') and l.action in ('leader.ai_cleared', 'leader.ai_sent_back') and l.at > now() - interval '30 days'))
  ) into m;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'team', 'title', 'Admin and care team',
    'informs', 'Workload and fairness, and where training is needed', 'metrics', m,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'actions', t.n) order by t.n desc, t.name)
        from (select p.id, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), p.email) as name, count(*) as n
                from public.event_log l
                join public.activity_people ap on ap.person_id = l.actor_id and ap.grp = 'team'
                join public.people p on p.id = l.actor_id
               where l.at > now() - interval '30 days'
               group by p.id, 2 order by count(*) desc limit 10) t), '[]'::jsonb)));

  -- --------------------------------------------------------- Pastors and director
  select jsonb_build_array(
    public.activity_m('decisions', 'Applications decided (30 days)',
      (select to_jsonb(count(*)) from public.event_log l where l.action = 'leader.decided' and l.at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.event_log l where l.action = 'leader.decided' and l.at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('turnaround_days', 'Median days from submitted to decided',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by extract(epoch from (a.decided_at - a.submitted_at)) / 86400))::numeric, 1)) end
         from public.leader_applications a where a.decided_at > now() - interval '90 days' and a.submitted_at is not null),
      null, 'days'),
    public.activity_m('ai_overridden', 'AI results cleared by a pastor or director (30 days)',
      (select to_jsonb(count(*)) from public.event_log l join public.activity_people ap on ap.person_id = l.actor_id
        where ap.grp = 'pastoral' and l.action in ('leader.ai_cleared', 'leader.ai_sent_back') and l.at > now() - interval '30 days')),
    public.activity_m('waiting', 'Applications waiting for a decision',
      (select to_jsonb(count(*)) from public.leader_applications a where a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')))
  ) into m;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'pastoral', 'title', 'Pastors and director',
    'informs', 'Backlog, and whether to trust the AI scoring more or less', 'metrics', m));

  -- --------------------------------------------------------------- The platform
  select jsonb_build_array(
    public.activity_m('signin_success', 'Sign-in codes delivered (30 days)',
      (select case when count(*) filter (where a.outcome in ('sent', 'delivered', 'failed', 'rejected')) >= 20
                   then to_jsonb(public.activity_pct(count(*) filter (where a.outcome in ('sent', 'delivered')),
                                                     count(*) filter (where a.outcome in ('sent', 'delivered', 'failed', 'rejected')))) end
         from public.signin_attempts a where a.counted and a.at > now() - interval '30 days'),
      null, 'percent'),
    public.activity_m('send_seconds', 'Median seconds to send a code',
      (select case when count(*) >= v_min then to_jsonb(round((percentile_cont(0.5) within group (order by extract(epoch from (a.decided_at - a.at))))::numeric, 1)) end
         from public.signin_attempts a where a.counted and a.decided_at is not null and a.at > now() - interval '30 days'),
      null, 'seconds'),
    public.activity_m('message_delivery', 'Messages delivered (30 days)',
      (select case when count(*) >= 20
                   then to_jsonb(public.activity_pct(count(*) filter (where x.status in ('sent', 'delivered', 'read')), count(*))) end
         from public.messages x where x.status in ('sent', 'delivered', 'read', 'failed') and x.created_at > now() - interval '30 days'),
      null, 'percent'),
    public.activity_m('messages_failed', 'Messages that failed (30 days)',
      (select to_jsonb(count(*)) from public.messages x where x.status = 'failed' and x.created_at > now() - interval '30 days'),
      (select to_jsonb(count(*)) from public.messages x where x.status = 'failed' and x.created_at between now() - interval '60 days' and now() - interval '30 days')),
    public.activity_m('assistant_fallback', 'Assistant calls that fell back (30 days)',
      (select case when count(*) >= 20 then to_jsonb(public.activity_pct(count(*) filter (where c.fallback), count(*))) end
         from public.ai_calls c where c.at > now() - interval '30 days'),
      null, 'percent'),
    public.activity_m('assistant_slow_ms', 'Slowest assistant calls (95th percentile)',
      (select case when count(*) >= 20 then to_jsonb(round((percentile_cont(0.95) within group (order by c.latency_ms))::numeric)) end
         from public.ai_calls c where c.at > now() - interval '30 days' and c.latency_ms is not null),
      null, 'ms'),
    public.activity_m('slow_screens', 'Screens that loaded slowly (30 days)',
      (select case when count(*) >= 50 then to_jsonb(public.activity_pct(count(*) filter (where e.meta ->> 'speed' = 'slow'), count(*))) end
         from public.activity_events e where e.kind = 'screen' and e.meta ? 'speed' and e.day > v_today - 30),
      null, 'percent'),
    public.activity_m('screens_recorded', 'Screens recorded (30 days)',
      (select to_jsonb(count(*)) from public.activity_events e where e.kind = 'screen' and e.day > v_today - 30))
  ) into m;
  v_panels := v_panels || jsonb_build_array(jsonb_build_object(
    'id', 'platform', 'title', 'The platform itself',
    'informs', 'Whether a technical fault is the reason people stop', 'metrics', m));

  return jsonb_build_object('window_days', 30, 'panels', v_panels);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tab 4. Is anyone gaming the system?
-- ---------------------------------------------------------------------------

create function public.activity_integrity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_min integer := public.activity_min_group();
  v_hold integer := (select t.value::int from public.activity_thresholds t where t.key = 'application_held_hours');
  v_checks jsonb;
  v_fields jsonb;
  v_audit jsonb;
  v_states jsonb;
  v_flags jsonb;
  v_callbacks jsonb;
  v_changes jsonb;
  v_signins jsonb;
  v_cases jsonb;
begin
  perform public.god_only();

  select jsonb_build_object(
           'checked', count(*),
           'failed', count(*) filter (where not c.passes),
           'forced_through', count(*) filter (where c.forced),
           'ai_checked', count(*) filter (where c.ai_checked))
    into v_checks
    from public.leader_answer_checks c where c.at > now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object('field', f.field, 'n', f.n) order by f.n desc, f.field), '[]'::jsonb)
    into v_fields
    from (select c.field, count(*) as n from public.leader_answer_checks c
           where c.at > now() - interval '30 days' and not c.passes
           group by c.field order by count(*) desc, c.field limit 6) f;

  select jsonb_build_object(
           'pairs', count(*),
           'mean_gap', case when count(*) >= v_min then round(avg(abs(p.ai - p.people)), 1) end,
           'ai_kinder', count(*) filter (where p.ai - p.people > 10),
           'ai_stricter', count(*) filter (where p.people - p.ai > 10))
    into v_audit
    from (select (select s.calling_pct from public.leader_ai_scores s
                   where s.application_id = x.application_id and not s.shadow and s.ai_ran and s.outcome = 'clear'
                   order by s.run desc limit 1) as ai,
                 (select avg(public.rating_pct(v.scores)) from public.leader_reviews v
                   where v.application_id = x.application_id and v.stage = 'calling') as people
            from public.leader_ai_state x where x.basis = 'ai' and x.state = 'clear' and x.audit_sample) p
   where p.ai is not null and p.people is not null;

  select coalesce(jsonb_object_agg(s.state, public.activity_c(s.n)), '{}'::jsonb)
    into v_states
    from (select st.state, count(*) as n from public.leader_ai_state st
            join public.leader_applications a on a.id = st.application_id
           where a.created_at > now() - interval '90 days' group by st.state) s;

  select coalesce(jsonb_object_agg(f.kind, jsonb_build_object('open', f.open, 'last_30d', f.recent)), '{}'::jsonb)
    into v_flags
    from (select fl.kind, count(*) filter (where fl.cleared_at is null) as open,
                 count(*) filter (where fl.created_at > now() - interval '30 days') as recent
            from public.leader_reference_flags fl group by fl.kind) f;

  select jsonb_build_object(
           'open', count(*) filter (where cb.status = 'open'),
           'overdue', count(*) filter (where cb.status = 'open' and cb.due_on < v_today),
           'confirmed', count(*) filter (where cb.outcome = 'confirmed' and cb.closed_at > now() - interval '30 days'),
           'not_reached', count(*) filter (where cb.outcome = 'not_reached' and cb.closed_at > now() - interval '30 days'),
           'not_them', count(*) filter (where cb.outcome = 'not_them' and cb.closed_at > now() - interval '30 days'))
    into v_callbacks
    from public.referee_callbacks cb;

  select jsonb_build_object(
           'referee_changes_30d', (select count(*) from public.referee_changes rc where rc.at > now() - interval '30 days'),
           'after_a_request_30d', (select count(*) from public.referee_changes rc where rc.at > now() - interval '30 days' and rc.after_request),
           'changed_three_times_or_more', (select count(*) from public.leader_references lr where lr.changes >= 3),
           'answer_changes_30d', (select count(*) from public.activity_events e where e.kind = 'form.answer_changed' and e.day > v_today - 30),
           'repeat_answer_changers', public.activity_c((select count(*) from (
               select e.person_id from public.activity_events e
                where e.kind = 'form.answer_changed' and e.day > v_today - 30
                group by e.person_id having count(*) >= 3) z)))
    into v_changes;

  select jsonb_build_object(
           'declined_7d', coalesce((select jsonb_object_agg(z.outcome, z.n)
                                      from (select a.outcome, count(*) as n from public.signin_attempts a
                                             where a.at > now() - interval '7 days' and a.outcome like 'declined\_%'
                                             group by a.outcome) z), '{}'::jsonb),
           'numbers_hit_the_limit_24h', (select count(*) from (
               select a.number_hash from public.signin_attempts a
                where a.at > now() - interval '24 hours' and a.outcome like 'declined\_%' and a.number_hash is not null
                group by a.number_hash having count(*) >= 5) z),
           'failed_or_rejected_7d', (select count(*) from public.signin_attempts a
                                      where a.at > now() - interval '7 days' and a.outcome in ('failed', 'rejected')))
    into v_signins;

  -- A short list of cases that need a person. No names: an id fragment and the page to open.
  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'label', c.label, 'ref', c.ref, 'at', c.at, 'href', c.href) order by c.at), '[]'::jsonb)
    into v_cases
    from (
      select * from (
        select 'flag'::text as kind, 'Referee flag: ' || replace(fl.kind, '_', ' ') as label, left(fl.reference_id::text, 8) as ref,
               fl.created_at as at, '/admin/referees'::text as href
          from public.leader_reference_flags fl where fl.cleared_at is null
        union all
        select 'callback', 'Referee call-back overdue', left(cb.reference_id::text, 8), cb.created_at, '/care/referees'
          from public.referee_callbacks cb where cb.status = 'open' and cb.due_on < v_today
        union all
        select 'held', 'Application held for more than ' || v_hold || ' hours', left(s.application_id::text, 8), s.state_at, '/admin/leader-quality'
          from public.leader_ai_state s where s.state = 'held' and s.state_at < now() - make_interval(hours => v_hold)
        union all
        select 'changes', 'Referee changed three times or more', left(lr.id::text, 8), lr.created_at, '/admin/referees'
          from public.leader_references lr where lr.changes >= 3
      ) u order by u.at limit 15) c;

  return jsonb_build_object(
    'answer_checks', v_checks, 'failing_fields', v_fields, 'ai_vs_people', v_audit, 'ai_states', v_states,
    'referee_flags', v_flags, 'callbacks', v_callbacks, 'changes', v_changes, 'signins', v_signins, 'cases', v_cases);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tab 5. Are people getting through the door?
-- ---------------------------------------------------------------------------

create function public.activity_messages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.activity_lagos_day(now());
  v_channels jsonb;
  v_codes jsonb;
  v_days jsonb;
  v_methods jsonb;
  v_breaker jsonb;
  v_optouts jsonb;
begin
  perform public.god_only();

  select coalesce(jsonb_agg(jsonb_build_object(
           'channel', c.channel, 'queued', c.queued, 'sent', c.sent, 'delivered', c.delivered, 'read', c.read,
           'failed', c.failed, 'skipped', c.skipped, 'total', c.total) order by c.total desc, c.channel), '[]'::jsonb)
    into v_channels
    from (select coalesce(m.channel, 'not yet chosen') as channel,
                 count(*) filter (where m.status in ('queued', 'sending')) as queued,
                 count(*) filter (where m.status = 'sent') as sent,
                 count(*) filter (where m.status = 'delivered') as delivered,
                 count(*) filter (where m.status = 'read') as read,
                 count(*) filter (where m.status = 'failed') as failed,
                 count(*) filter (where m.status = 'skipped') as skipped,
                 count(*) as total
            from public.messages m where m.created_at > now() - interval '30 days'
           group by 1) c;

  select jsonb_build_object(
           'asked', count(*),
           'sent', count(*) filter (where a.outcome in ('sent', 'delivered')),
           'failed', count(*) filter (where a.outcome in ('failed', 'rejected')),
           'declined', count(*) filter (where a.outcome like 'declined\_%'),
           'unmatched', count(*) filter (where a.outcome = 'unmatched'),
           'median_send_seconds', case when count(*) filter (where a.decided_at is not null) >= public.activity_min_group()
                                       then round((percentile_cont(0.5) within group (order by extract(epoch from (a.decided_at - a.at)))
                                                   filter (where a.decided_at is not null))::numeric, 1) end)
    into v_codes
    from public.signin_attempts a where a.at > now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object('day', g.d, 'asked', coalesce(x.asked, 0), 'sent', coalesce(x.sent, 0), 'failed', coalesce(x.failed, 0)) order by g.d), '[]'::jsonb)
    into v_days
    from (select (v_today - i) as d from generate_series(0, 13) i) g
    left join (select public.activity_lagos_day(a.at) as d, count(*) as asked,
                      count(*) filter (where a.outcome in ('sent', 'delivered')) as sent,
                      count(*) filter (where a.outcome in ('failed', 'rejected')) as failed
                 from public.signin_attempts a where a.at > now() - interval '15 days' group by 1) x on x.d = g.d;

  select coalesce(jsonb_object_agg(z.method, z.n), '{}'::jsonb)
    into v_methods
    from (select coalesce(e.meta ->> 'method', 'unknown') as method, count(*) as n
            from public.activity_events e where e.kind = 'signin' and e.day > v_today - 30 group by 1) z;

  select jsonb_build_object(
           'whatsapp_on', s.whatsapp_on, 'mode', s.mode, 'state', s.breaker_state, 'reason', s.breaker_reason,
           'tripped_at', s.breaker_tripped_at, 'cleared_at', s.breaker_cleared_at, 'sender_signal', s.sender_signal,
           'trips_30d', (select count(*) from public.signin_events ev where ev.kind = 'tripped' and ev.at > now() - interval '30 days'))
    into v_breaker
    from public.signin_settings s;

  select jsonb_build_object(
           'opted_out_30d', (select count(*) from public.event_log l where l.action in ('contact.opt_out', 'email.unsubscribed') and l.at > now() - interval '30 days'),
           'stop_or_not_me_30d', (select count(*) from public.signin_blocks b where b.blocked_at > now() - interval '30 days'),
           'email_signals_30d', coalesce((select jsonb_object_agg(z.kind, z.n)
                                            from (select s.kind, count(*) as n from public.email_signals s
                                                   where s.created_at > now() - interval '30 days' group by s.kind) z), '{}'::jsonb))
    into v_optouts;

  return jsonb_build_object('channels', v_channels, 'codes', v_codes, 'code_days', v_days, 'signins_by_method', v_methods,
                            'breaker', v_breaker, 'opt_outs', v_optouts);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tab 6. Who did what, and when?
-- ---------------------------------------------------------------------------

-- A searchable list of when, who (by role), what and which record. It never returns what someone wrote: no `meta`, no
-- notes, no message text. A young member is shown as "Young member", with no name and no way to filter to them. The
-- owner's own actions appear too, marked "You". `p_group` is one of member, young, leader, team, pastoral, system, you.
create function public.activity_audit(
  p_group text default null,
  p_area text default null,
  p_person uuid default null,
  p_from date default null,
  p_to date default null,
  p_before timestamptz default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 5000);
  v_t0 timestamptz := case when p_from is null then null else p_from::timestamp at time zone 'Africa/Lagos' end;
  v_t1 timestamptz := case when p_to is null then null else (p_to + 1)::timestamp at time zone 'Africa/Lagos' end;
  v_rows jsonb;
  v_next timestamptz;
begin
  perform public.god_only();
  if p_group is not null and p_group not in ('member', 'young', 'leader', 'team', 'pastoral', 'system', 'you') then
    raise exception 'Unknown group' using errcode = '22023';
  end if;
  -- Nobody can look up a young member by id.
  if p_person is not null and exists (select 1 from public.activity_people ap where ap.person_id = p_person and ap.grp = 'young') then
    return jsonb_build_object('rows', '[]'::jsonb, 'next_before', null, 'young_hidden', true);
  end if;

  with u as (
    select * from (
      select e.at, e.actor_id, e.action, e.entity, e.entity_id,
             (e.actor_id is null and exists (select 1 from public.god_log g where g.kind = 'action' and g.at = e.at and g.action = e.action)) as you,
             ap.grp as actor_grp
        from public.event_log e
        left join public.activity_people ap on ap.person_id = e.actor_id
       where (p_before is null or e.at < p_before)
         and (v_t0 is null or e.at >= v_t0)
         and (v_t1 is null or e.at < v_t1)
         and (p_area is null or split_part(e.action, '.', 1) = p_area)
         and (p_person is null or e.actor_id = p_person)
    ) ev
    where (p_group is null
           or case when ev.you then 'you' when ev.actor_id is null then 'system' else coalesce(ev.actor_grp, 'member') end = p_group)
    union all
    select g.at, null::uuid, 'activity.' || g.kind, case when g.kind = 'activity_setting' then 'setting' else 'tab' end, g.action, true, null::text
      from public.god_log g
     where g.kind in ('viewed', 'exported', 'activity_setting')
       and p_person is null and p_area is null and (p_group is null or p_group = 'you')
       and (p_before is null or g.at < p_before)
       and (v_t0 is null or g.at >= v_t0)
       and (v_t1 is null or g.at < v_t1)
  ),
  page as (select * from u order by u.at desc limit v_limit)
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', x.at,
           'who', case when x.you then 'You'
                       when x.actor_id is null then 'The system'
                       when x.actor_grp = 'young' then 'Young member'
                       else coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), 'Someone') end,
           'group', case when x.you then 'you' when x.actor_id is null then 'system' else coalesce(x.actor_grp, 'member') end,
           'person_id', case when x.you or x.actor_id is null or x.actor_grp = 'young' then null else x.actor_id end,
           'action', x.action,
           'area', coalesce(ag.label, initcap(split_part(x.action, '.', 1))),
           'entity', x.entity,
           'ref', case when x.actor_grp = 'young' then null else left(x.entity_id, 8) end) order by x.at desc), '[]'::jsonb),
         case when count(*) >= v_limit then min(x.at) end
    into v_rows, v_next
    from page x
    left join public.people p on p.id = x.actor_id and x.actor_grp is distinct from 'young'
    left join public.activity_action_groups ag on ag.prefix = split_part(x.action, '.', 1);

  return jsonb_build_object('rows', v_rows, 'next_before', v_next, 'young_hidden', false);
end;
$$;

-- The areas the audit trail can be filtered by.
create function public.activity_audit_areas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object('prefix', z.prefix, 'label', z.label) order by z.label, z.prefix)
      from (select distinct split_part(e.action, '.', 1) as prefix,
                   coalesce(ag.label, initcap(split_part(e.action, '.', 1))) as label
              from (select distinct action from public.event_log) e
              left join public.activity_action_groups ag on ag.prefix = split_part(e.action, '.', 1)) z), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's settings, and the record of looking
-- ---------------------------------------------------------------------------

create function public.activity_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return jsonb_build_object(
    'recording', (select s.recording from public.activity_settings s),
    'retention_months', (select s.retention_months from public.activity_settings s),
    'last_refresh', (select s.last_refresh from public.activity_settings s),
    'last_backfill', (select s.last_backfill from public.activity_settings s),
    'min_group', public.activity_min_group(),
    'thresholds', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', t.key, 'label', replace(t.label, '{value}', trim_scale(t.value)::text), 'template', t.label,
                     'value', t.value, 'unit', t.unit, 'action', t.action, 'href', t.href) order by t.sort)
                     from public.activity_thresholds t), '[]'::jsonb),
    'catalogue', coalesce((select jsonb_agg(jsonb_build_object(
                     'kind', c.kind, 'label', c.label, 'area', c.area, 'fields', c.meta_keys,
                     'keep_months', least(c.keep_months, (select s.retention_months from public.activity_settings s)),
                     'reserved', c.reserved) order by c.area, c.kind)
                     from public.activity_catalogue c where c.active), '[]'::jsonb));
end;
$$;

create function public.activity_threshold_set(p_key text, p_value numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric;
begin
  perform public.god_only();
  select t.value into v_old from public.activity_thresholds t where t.key = p_key;
  if not found then
    raise exception 'No such flag' using errcode = 'P0002';
  end if;
  if p_value is null or p_value <= 0 or p_value > 365 then
    raise exception 'Choose a number between 1 and 365' using errcode = '22023';
  end if;
  update public.activity_thresholds set value = p_value, updated_at = now() where key = p_key;
  insert into public.god_log (kind, action, entity, entity_id, detail)
  values ('activity_setting', p_key, 'threshold', p_key, jsonb_build_object('from', v_old, 'to', p_value));
  return jsonb_build_object('ok', true);
end;
$$;

-- Switch recording on or off, and choose how many months detailed events are kept (3 to 36). Shortening it deletes the
-- older detail at the next refresh; the daily counts stay.
create function public.activity_settings_set(p_recording boolean default null, p_retention integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.activity_settings%rowtype;
begin
  perform public.god_only();
  select * into s from public.activity_settings;
  if p_retention is not null and (p_retention < 3 or p_retention > 36) then
    raise exception 'Choose between 3 and 36 months' using errcode = '22023';
  end if;
  if p_recording is not null and p_recording is distinct from s.recording then
    update public.activity_settings set recording = p_recording, updated_at = now();
    insert into public.god_log (kind, action, entity, entity_id, detail)
    values ('activity_setting', 'recording', 'setting', 'recording', jsonb_build_object('from', s.recording, 'to', p_recording));
  end if;
  if p_retention is not null and p_retention <> s.retention_months then
    update public.activity_settings set retention_months = p_retention, updated_at = now();
    update public.activity_catalogue set keep_months = least(keep_months, p_retention::smallint);
    insert into public.god_log (kind, action, entity, entity_id, detail)
    values ('activity_setting', 'retention', 'setting', 'retention', jsonb_build_object('from', s.retention_months, 'to', p_retention));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Each time the owner opens a tab or exports, it is written to the owner's own record (god_log) and nowhere else, once a
-- minute at most for the same tab.
create function public.activity_viewed(p_tab text, p_what text default 'viewed')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  if p_tab not in ('pulse', 'funnels', 'stakeholders', 'integrity', 'messages', 'audit', 'settings') or p_what not in ('viewed', 'exported') then
    raise exception 'Unknown tab' using errcode = '22023';
  end if;
  if exists (select 1 from public.god_log g
              where g.kind = p_what and g.action = p_tab and g.at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.god_log (kind, action, entity, entity_id, detail) values (p_what, p_tab, 'activity', p_tab, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

-- Internal: the writers, the builders, the helpers and the trigger functions. Nobody calls these over the API.
revoke execute on function
  public.activity_min_group(),
  public.activity_lagos_day(timestamptz),
  public.activity_c(numeric),
  public.activity_pct(numeric, numeric),
  public.activity_m(text, text, jsonb, jsonb, text, text),
  public.activity_note(uuid, text, jsonb, timestamptz, text),
  public.activity_trg_draft(),
  public.activity_trg_profile(),
  public.activity_trg_application(),
  public.activity_build_people(),
  public.activity_build_days(date, date),
  public.activity_build_daily(date, date),
  public.activity_build_hourly(date, date),
  public.activity_prune(timestamptz),
  public.activity_refresh(timestamptz, boolean),
  public.activity_decisions(),
  public.activity_member_rows(date, date),
  public.activity_leader_rows(date, date)
  from public, anon, authenticated;

-- The one door a signed-in person can write through. A visitor who is not signed in cannot call it at all.
revoke execute on function public.activity_track(text, text, text, text, text) from public, anon;
grant execute on function public.activity_track(text, text, text, text, text) to authenticated;

-- The heartbeat, with the sending service's token (as worker_tick).
revoke execute on function public.worker_activity_refresh(text) from public;
grant execute on function public.worker_activity_refresh(text) to anon, authenticated;

-- The owner's reports. Each checks on its first line that the caller is the owner and unlocked; to anyone else they refuse
-- in the same words as a page that does not exist.
revoke execute on function
  public.activity_pulse(),
  public.activity_brief(),
  public.activity_funnels(text, date, date, text),
  public.activity_funnel_people(text, integer, text, date, date, integer),
  public.activity_compare(text),
  public.activity_retention(integer),
  public.activity_heatmap(integer),
  public.activity_stakeholders(),
  public.activity_integrity(),
  public.activity_messages(),
  public.activity_audit(text, text, uuid, date, date, timestamptz, integer),
  public.activity_audit_areas(),
  public.activity_settings_get(),
  public.activity_threshold_set(text, numeric),
  public.activity_settings_set(boolean, integer),
  public.activity_viewed(text, text)
  from public, anon;

grant execute on function
  public.activity_pulse(),
  public.activity_brief(),
  public.activity_funnels(text, date, date, text),
  public.activity_funnel_people(text, integer, text, date, date, integer),
  public.activity_compare(text),
  public.activity_retention(integer),
  public.activity_heatmap(integer),
  public.activity_stakeholders(),
  public.activity_integrity(),
  public.activity_messages(),
  public.activity_audit(text, text, uuid, date, date, timestamptz, integer),
  public.activity_audit_areas(),
  public.activity_settings_get(),
  public.activity_threshold_set(text, numeric),
  public.activity_settings_set(boolean, integer),
  public.activity_viewed(text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- History on day one: fill the summaries once, back-dated, from the tables where the things already live.
-- Sign-ins and screen use have no history, so they start counting from today.
-- ---------------------------------------------------------------------------

select public.activity_refresh(now(), true);

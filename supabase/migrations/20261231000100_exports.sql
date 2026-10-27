-- =============================================================================
-- United Tribes: Exports and Reports (release one: Excel files, print-view PDFs, the feeds, and the leaders' files)
--
-- One way to make a file, and one switchboard in front of it. Everything ships Off.
--
--   export_packs         what can be exported (14 packs): its lane, who may make it, its formats, whether this release has it
--   export_settings      one row: Pause all exports, Stop all People files, the unusual-use number, which formats, deliveries and doors
--                        are on, and the day the data protection impact assessment was signed
--   export_switches      the position of each pack: Off, Rehearsal, Limited or On, and who it is limited to
--   export_switch_log    every change to a pack or a setting: who, when, from, to, and why
--   export_testers       the people who may make a file while a pack is in Rehearsal
--   export_log           one row for each file: who, which pack, which choices, how many rows, why. Never a name from the file or its contents
--   export_links         the fingerprint of each private link: one account, 24 hours, withdrawn at once by "Delete now"
--   export_feed_links    the fingerprint of each standing feed link: one coded table, read only, 90 days, renewable
--
-- The two lanes:
--   insight  coded or counted figures with no names of members. May feed other platforms.
--   people   named people. Church use only. Never feeds another platform in this release.
--
-- Who can move any switch: ONLY the platform owner, in God Mode. Every function that changes a position, a setting or a tester begins
-- god_only(), which also needs the owner to be unlocked on this sign-in. Nobody else, not the admin, a director or a pastor, can move
-- one, and none of them can read the switchboard either.
--
-- The rules that cannot be switched:
--   * a switch only narrows: nothing here lets a role see more than the screens already show it
--   * a position that cannot be read counts as Off
--   * a People pack cannot go to Limited or On until it has been in Rehearsal and the impact assessment has been recorded as signed
--   * members under 18 are counted, never listed, and are left out of every coded table that is sent out, as they are from every People file
--   * a link works for one account for 24 hours, is checked again every time it is opened, and stops the moment its pack is switched off
--   * no file is stored: it is made when the link is opened. The log keeps facts about the file for two years, never its contents
--   * the owner is never named in a file
--
-- This migration changes no function that already existed. The daily clean-up of the export log has its own door, worker_export_sweep(),
-- which the heartbeat calls once a day with the sending token (as it does for the notices and the activity summaries).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.export_packs (
  id text primary key check (id ~ '^[a-z_]{3,40}$'),
  name text not null,
  lane text not null check (lane in ('insight', 'people')),
  -- Who may make this pack. The role table is the ceiling: a switch can narrow it and never widen it.
  roles public.app_role[] not null,
  -- What the pack is about: one tribe, the tribes a coach coaches, one community, the whole church, or the member themselves
  scope text not null check (scope in ('tribe', 'tribes', 'community', 'church', 'self')),
  formats text[] not null check (cardinality(formats) >= 1 and formats <@ array['xlsx', 'csv', 'pdf']),
  -- False for what arrives in the second release. A pack that is not released cannot leave Off.
  released boolean not null,
  sort smallint not null
);

insert into public.export_packs (id, name, lane, roles, scope, formats, released, sort) values
  ('tribe_sheet',         'Tribe sheet',           'people',  array['leader', 'assistant_leader']::public.app_role[],     'tribe',     array['xlsx'],        true,  1),
  ('know_your_tribe',     'Know your tribe',       'people',  array['leader', 'assistant_leader']::public.app_role[],     'tribe',     array['pdf'],         false, 2),
  ('attendance_register', 'Attendance register',   'people',  array['leader', 'assistant_leader']::public.app_role[],     'tribe',     array['xlsx', 'pdf'], true,  3),
  ('my_tribes_glance',    'My tribes at a glance', 'insight', array['coach']::public.app_role[],                          'tribes',    array['xlsx', 'pdf'], true,  4),
  ('community_report',    'Community report',      'insight', array['community_champion']::public.app_role[],              'community', array['pdf', 'xlsx'], true,  5),
  ('pastorate_one_pager', 'Pastorate one-pager',   'insight', array['pastor']::public.app_role[],                          'church',    array['pdf'],         true,  6),
  ('leaders_roster',      'Leaders roster',        'people',  array['pastor', 'director']::public.app_role[],              'church',    array['xlsx'],        true,  7),
  ('programme_report',    'Programme report',      'insight', array['director']::public.app_role[],                        'church',    array['pdf', 'xlsx'], true,  8),
  ('tribes_health',       'Tribes health sheet',   'insight', array['director', 'admin', 'pastor']::public.app_role[],     'church',    array['xlsx'],        true,  9),
  ('supply_demand',       'Supply and demand',     'insight', array['director', 'pastor']::public.app_role[],              'church',    array['xlsx'],        true,  10),
  ('people_roles',        'People and roles',      'people',  array['admin']::public.app_role[],                           'church',    array['xlsx'],        true,  11),
  ('message_volumes',     'Message volumes',       'insight', array['admin']::public.app_role[],                           'church',    array['xlsx'],        true,  12),
  ('insight_feeds',       'Insight feeds',         'insight', array['data_lead', 'director', 'admin']::public.app_role[],  'church',    array['csv'],         true,  13),
  ('my_data_pack',        'My data pack',          'people',  array['member']::public.app_role[],                          'self',      array['xlsx', 'pdf'], false, 14);

create table public.export_settings (
  singleton boolean primary key default true check (singleton),
  -- Pause all exports: every file, at once
  paused boolean not null default false,
  -- Stop all People files: every named file; the coded reports keep running
  people_stopped boolean not null default false,
  -- More than this many People files from one person in an hour sends the data lead a notice
  unusual_per_hour smallint not null default 5 check (unusual_per_hour between 1 and 100),
  -- What is switched on. Everything starts Off, so each of these starts empty.
  formats text[] not null default '{}' check (formats <@ array['xlsx', 'csv', 'pdf']),
  deliveries text[] not null default '{}' check (deliveries <@ array['download']),
  doors text[] not null default '{}' check (doors <@ array['open_data_pack', 'standing_link']),
  -- The day the data protection impact assessment was signed. No People pack can leave Rehearsal before this is set.
  people_cleared_on date,
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.export_settings (singleton) values (true);

create table public.export_switches (
  pack text primary key references public.export_packs (id),
  position text not null default 'off' check (position in ('off', 'rehearsal', 'limited', 'on')),
  limited_roles public.app_role[] not null default '{}',
  limited_communities uuid[] not null default '{}',
  limited_tribes uuid[] not null default '{}',
  -- The first time this pack was put in Rehearsal. A People pack cannot go further without it.
  rehearsed_at timestamptz,
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (char_length(reason) <= 300)
);
insert into public.export_switches (pack) select id from public.export_packs;

create table public.export_switch_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_person uuid references public.people (id) on delete set null,
  -- "pack:tribe_sheet", "setting:paused", "tester:<person>"
  what text not null check (char_length(what) <= 80),
  was text check (char_length(was) <= 300),
  now_is text check (char_length(now_is) <= 300),
  reason text check (char_length(reason) <= 300)
);
create index export_switch_log_at_idx on public.export_switch_log (at desc);

create table public.export_testers (
  person_id uuid primary key references public.people (id) on delete cascade,
  added_at timestamptz not null default now()
);

create table public.export_log (
  -- This is the export id printed in the file's About sheet and footer
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  person_id uuid references public.people (id) on delete set null,
  centre_id uuid references public.centres (id) on delete set null,
  -- The role the person made it as
  role text not null,
  pack text not null references public.export_packs (id),
  lane text not null check (lane in ('insight', 'people')),
  format text not null check (format in ('xlsx', 'csv', 'pdf')),
  -- The pack's position when the file was made
  position text not null check (position in ('rehearsal', 'limited', 'on')),
  rehearsal boolean not null default false,
  purpose text check (purpose in ('pastoral_care', 'planning', 'reporting')),
  -- The choices made (which tribe, season, report): ids and switches only
  filters jsonb not null default '{}'::jsonb,
  row_count integer check (row_count >= 0),
  status text not null default 'prepared' check (status in ('prepared', 'delivered', 'withdrawn', 'failed')),
  flagged text check (flagged in ('unusual')),
  delivered_at timestamptz,
  withdrawn_at timestamptz,
  note text check (char_length(note) <= 160)
);
create index export_log_person_idx on public.export_log (person_id, at desc);
create index export_log_at_idx on public.export_log (at desc);
create index export_log_pack_idx on public.export_log (pack, at desc);

create table public.export_links (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.export_log (id) on delete cascade,
  -- Only the fingerprint is kept. The link itself is shown once and stored nowhere.
  token_hash text not null unique,
  person_id uuid not null references public.people (id) on delete cascade,
  expires_at timestamptz not null,
  withdrawn_at timestamptz,
  opens integer not null default 0,
  last_opened_at timestamptz
);
create index export_links_export_idx on public.export_links (export_id);

create table public.export_feed_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  -- One coded table per link
  tbl text not null check (tbl in ('members', 'tribes', 'weekly', 'care_weekly', 'messages_daily', 'ai_fields', 'kpi_daily')),
  label text not null check (char_length(label) between 1 and 60),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_read_at timestamptz,
  reads integer not null default 0
);

alter table public.export_packs enable row level security;
alter table public.export_settings enable row level security;
alter table public.export_switches enable row level security;
alter table public.export_switch_log enable row level security;
alter table public.export_testers enable row level security;
alter table public.export_log enable row level security;
alter table public.export_links enable row level security;
alter table public.export_feed_links enable row level security;
-- No grants: only the functions touch these tables.

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

-- The fingerprint of a link
create function public.export_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

-- What a pack's position is for everyone right now. Anything that cannot be read counts as Off, and so does a pack that this release does
-- not have, a paused church, and (for a People pack) a stopped one.
create function public.export_position(p_pack text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.export_settings;
  v_lane text;
  v text;
begin
  select * into s from public.export_settings x where x.singleton;
  if not found or s.paused then
    return 'off';
  end if;
  select p.lane into v_lane from public.export_packs p where p.id = p_pack and p.released;
  if v_lane is null then
    return 'off';
  end if;
  if v_lane = 'people' and s.people_stopped then
    return 'off';
  end if;
  select w.position into v from public.export_switches w where w.pack = p_pack;
  return case when v in ('off', 'rehearsal', 'limited', 'on') then v else 'off' end;
exception when others then
  return 'off';
end;
$$;

-- Does this person hold one of these roles, here? The owner holds none (and so is never counted as a role holder).
create function public.export_holds(p_person uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.person_roles r
      join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
     where r.person_id = p_person and r.role = any (p_roles));
$$;

-- Why this person cannot make this pack right now, in words they can read, or null when they can. This is the one rule: the Studio, the
-- link and every source function ask it. p_tribe and p_community say what the file is about when the pack is about one.
create function public.export_refusal(p_pack text, p_person uuid, p_tribe uuid default null, p_community uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.export_packs;
  w public.export_switches;
  v_pos text;
  v_ok boolean := true;
begin
  select * into k from public.export_packs p where p.id = p_pack;
  if not found then
    return 'We could not find that file';
  end if;
  if not k.released then
    return 'This file arrives in a later release';
  end if;
  v_pos := public.export_position(p_pack);
  if v_pos = 'off' then
    return 'This file is switched off right now';
  end if;
  if p_person is null or not public.export_holds(p_person, k.roles) then
    return 'Your role does not include this file';
  end if;

  -- What the file is about must be something this person has
  if k.scope = 'tribe' then
    if p_tribe is null or not exists (select 1 from public.tribes t where t.id = p_tribe and (t.leader_id = p_person or t.assistant_id = p_person)) then
      return 'You can make this file for the tribe you lead or assist';
    end if;
  elsif k.scope = 'community' then
    if p_community is null or not exists (select 1 from public.community_champions c where c.person_id = p_person and c.community_id = p_community) then
      return 'You can make this file for the community you champion';
    end if;
  elsif k.scope = 'tribes' then
    if not exists (select 1 from public.tribes t where t.coach_id = p_person) then
      return 'You have no tribes to coach yet';
    end if;
  end if;

  select * into w from public.export_switches s where s.pack = p_pack;
  if v_pos = 'rehearsal' then
    if not (exists (select 1 from public.export_testers t where t.person_id = p_person)
            or (p_person = auth.uid() and public.is_god())) then
      return 'This file is being tried out with a few people first';
    end if;
  elsif v_pos = 'limited' then
    if cardinality(w.limited_roles) = 0 and cardinality(w.limited_tribes) = 0 and cardinality(w.limited_communities) = 0 then
      return 'This file is switched off right now';
    end if;
    if cardinality(w.limited_roles) > 0 and not public.export_holds(p_person, w.limited_roles) then
      v_ok := false;
    end if;
    if v_ok and cardinality(w.limited_tribes) > 0 then
      v_ok := case k.scope
        when 'tribe' then p_tribe = any (w.limited_tribes)
        when 'tribes' then exists (select 1 from public.tribes t where t.coach_id = p_person and t.id = any (w.limited_tribes))
        else false end;
    end if;
    if v_ok and cardinality(w.limited_communities) > 0 then
      v_ok := case k.scope
        when 'community' then p_community = any (w.limited_communities)
        when 'tribe' then coalesce((select t.community_id from public.tribes t where t.id = p_tribe) = any (w.limited_communities), false)
        when 'tribes' then exists (select 1 from public.tribes t where t.coach_id = p_person and t.community_id = any (w.limited_communities))
        else false end;
    end if;
    if not v_ok then
      return 'This file is open to a few people so far';
    end if;
  end if;
  return null;
end;
$$;

-- The same rule as a stop: raises when the person may not make the pack. Every source function starts with it.
create function public.export_require(p_pack text, p_tribe uuid default null, p_community uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_why text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_why := public.export_refusal(p_pack, auth.uid(), p_tribe, p_community);
  if v_why is not null then
    raise exception '%', v_why using errcode = '42501';
  end if;
end;
$$;

-- A uuid from the choices a person made, or null if there was none. Anything else is refused, so nothing odd is stored.
create function public.export_choice_uuid(p_filters jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := p_filters ->> p_key;
begin
  if v is null or v = '' then
    return null;
  end if;
  if v !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'One of the choices is not valid' using errcode = '22023';
  end if;
  return v::uuid;
end;
$$;

-- A person is young when a parent's consent is held for them or their age range ends before 18 (the same rule the notices use)
create function public.export_is_young(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.notice_is_young(p_person) $$;

-- Records a change in the switchboard's own log and in the owner's record
create function public.export_note(p_what text, p_was text, p_now text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.export_switch_log (by_person, what, was, now_is, reason)
  values (auth.uid(), left(p_what, 80), left(p_was, 300), left(p_now, 300), nullif(left(btrim(coalesce(p_reason, '')), 300), ''));
  perform public.write_event(auth.uid(), 'export.switch', 'export', left(p_what, 80),
    jsonb_build_object('was', left(p_was, 120), 'now', left(p_now, 120)));
end;
$$;

-- ---------------------------------------------------------------------------
-- What the Studio shows a person
-- ---------------------------------------------------------------------------

-- The packs this person can make right now, with the tribes or community each is for. A pack that is Off, or not theirs, is not listed
-- at all: the Studio hides it.
create function public.export_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.export_settings;
  k public.export_packs;
  v_arr jsonb := '[]'::jsonb;
  v_targets jsonb;
  v_formats text[];
  v_ok boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into s from public.export_settings x where x.singleton;
  if not found or s.paused then
    return jsonb_build_object('open', false, 'packs', '[]'::jsonb, 'formats', '[]'::jsonb, 'purposes', '[]'::jsonb, 'seasons', '[]'::jsonb);
  end if;
  for k in select * from public.export_packs p where p.released order by p.sort loop
    v_targets := null;
    v_formats := array(select f from unnest(k.formats) f where f = any (s.formats));
    if cardinality(v_formats) = 0 then
      continue;
    end if;
    if k.scope = 'tribe' then
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', coalesce(t.name, 'Your tribe'), 'community', c.name) order by t.name), '[]'::jsonb)
        into v_targets
        from public.tribes t
        left join public.communities c on c.id = t.community_id
       where (t.leader_id = uid or t.assistant_id = uid) and public.export_refusal(k.id, uid, t.id) is null;
      v_ok := jsonb_array_length(v_targets) > 0;
    elsif k.scope = 'community' then
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
        into v_targets
        from public.communities c
       where exists (select 1 from public.community_champions h where h.person_id = uid and h.community_id = c.id)
         and public.export_refusal(k.id, uid, null, c.id) is null;
      v_ok := jsonb_array_length(v_targets) > 0;
    else
      v_ok := public.export_refusal(k.id, uid) is null;
    end if;
    if not v_ok then
      continue;
    end if;
    v_arr := v_arr || jsonb_build_object(
      'id', k.id, 'name', k.name, 'lane', k.lane, 'scope', k.scope, 'formats', to_jsonb(v_formats),
      'rehearsal', public.export_position(k.id) = 'rehearsal',
      'targets', v_targets);
  end loop;
  return jsonb_build_object(
    'open', jsonb_array_length(v_arr) > 0 and 'download' = any (s.deliveries),
    'packs', v_arr,
    'formats', to_jsonb(s.formats),
    'purposes', jsonb_build_array(
      jsonb_build_object('key', 'pastoral_care', 'label', 'Pastoral care'),
      jsonb_build_object('key', 'planning', 'label', 'Planning'),
      jsonb_build_object('key', 'reporting', 'label', 'Reporting')),
    'seasons', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'starts_on', x.starts_on) order by x.starts_on desc)
                           from (select * from public.seasons z where z.centre_id = public.my_centre() order by z.starts_on desc limit 8) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Making a file: prepare, open, done, withdraw
-- ---------------------------------------------------------------------------

-- Checks everything, writes the log line, and gives back the private link (shown once; only its fingerprint is kept).
create function public.export_prepare(p_pack text, p_format text, p_purpose text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.export_settings;
  k public.export_packs;
  v_tribe uuid;
  v_community uuid;
  v_why text;
  v_role text;
  v_pos text;
  v_filters jsonb;
  v_id uuid;
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz := now() + interval '24 hours';
  v_n integer;
  v_flag text;
  v_centre uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into k from public.export_packs p where p.id = p_pack;
  if not found then
    raise exception 'We could not find that file' using errcode = 'P0002';
  end if;
  select * into s from public.export_settings x where x.singleton;
  if s.singleton is null then
    raise exception 'Exports are not available right now' using errcode = '42501';
  end if;
  if p_format is null or not (p_format = any (k.formats)) then
    raise exception 'That pack is not made in that format' using errcode = '22023';
  end if;
  if not (p_format = any (s.formats)) then
    raise exception 'That format is switched off right now' using errcode = '42501';
  end if;
  if not ('download' = any (s.deliveries)) then
    raise exception 'Downloads are switched off right now' using errcode = '42501';
  end if;

  v_tribe := public.export_choice_uuid(coalesce(p_filters, '{}'::jsonb), 'tribe');
  v_community := public.export_choice_uuid(coalesce(p_filters, '{}'::jsonb), 'community');
  v_why := public.export_refusal(p_pack, uid, v_tribe, v_community);
  if v_why is not null then
    raise exception '%', v_why using errcode = '42501';
  end if;
  if k.lane = 'people' and (p_purpose is null or p_purpose not in ('pastoral_care', 'planning', 'reporting')) then
    raise exception 'Choose why you need this file' using errcode = '22023';
  end if;
  if k.lane = 'insight' and p_purpose is not null and p_purpose not in ('pastoral_care', 'planning', 'reporting') then
    raise exception 'Choose why you need this file' using errcode = '22023';
  end if;

  v_pos := public.export_position(p_pack);
  select r.role::text into v_role
    from public.person_roles r join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
   where r.person_id = uid and r.role = any (k.roles)
   order by array_position(k.roles, r.role) limit 1;
  select p.centre_id into v_centre from public.people p where p.id = uid;

  -- Only the choices this release knows, and only in the shape expected
  v_filters := jsonb_strip_nulls(jsonb_build_object(
    'tribe', v_tribe, 'community', v_community,
    'season', public.export_choice_uuid(coalesce(p_filters, '{}'::jsonb), 'season'),
    'report', public.export_choice_uuid(coalesce(p_filters, '{}'::jsonb), 'report'),
    'success', case when coalesce(p_filters ->> 'success', '') = 'true' then true end));

  -- More than the set number of named files in an hour from one person is noted, and the data lead is told
  if k.lane = 'people' then
    select count(*)::int into v_n from public.export_log l
     where l.person_id = uid and l.lane = 'people' and l.at >= now() - interval '1 hour';
    if v_n + 1 > s.unusual_per_hour then
      v_flag := 'unusual';
    end if;
  end if;

  insert into public.export_log (person_id, centre_id, role, pack, lane, format, position, rehearsal, purpose, filters, flagged)
  values (uid, v_centre, coalesce(v_role, 'unknown'), p_pack, k.lane, p_format, v_pos, v_pos = 'rehearsal', p_purpose, v_filters, v_flag)
  returning id into v_id;

  insert into public.export_links (export_id, token_hash, person_id, expires_at)
  values (v_id, public.export_hash(v_raw), uid, v_expires);

  perform public.write_event(uid, 'export.prepared', 'export', v_id::text,
    jsonb_build_object('pack', p_pack, 'format', p_format, 'lane', k.lane));

  if v_flag is not null and v_centre is not null then
    begin
      perform public.notify_role(v_centre, array['data_lead'], 'data_unusual_export',
        'export-unusual:' || uid::text || ':' || to_char(date_trunc('hour', now() at time zone 'Africa/Lagos'), 'YYYYMMDDHH24'),
        jsonb_build_object('count', v_n + 1, 'per_hour', s.unusual_per_hour, 'pack', k.name, 'role', replace(coalesce(v_role, 'someone'), '_', ' ')),
        'An unusual number of named files in an hour', '/admin');
    exception when others then
      null; -- a notice that cannot be queued never stops a file
    end;
  end if;

  return jsonb_build_object('export_id', v_id, 'token', v_raw, 'expires_at', v_expires, 'rehearsal', v_pos = 'rehearsal');
end;
$$;

-- Opens a link, as the one account it belongs to. Everything is checked again now: the link, the person's role and the pack's position.
create function public.export_open(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l public.export_links;
  g public.export_log;
  k public.export_packs;
  v_why text;
  v_pos text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'We could not find that file' using errcode = 'P0002';
  end if;
  select * into l from public.export_links x where x.token_hash = public.export_hash(p_token);
  if not found or l.person_id is distinct from uid then
    raise exception 'We could not find that file' using errcode = 'P0002';
  end if;
  if l.withdrawn_at is not null or l.expires_at <= now() then
    raise exception 'This link has ended. Make the file again.' using errcode = 'P0002';
  end if;
  select * into g from public.export_log x where x.id = l.export_id;
  select * into k from public.export_packs p where p.id = g.pack;
  v_why := public.export_refusal(g.pack, uid,
    nullif(g.filters ->> 'tribe', '')::uuid, nullif(g.filters ->> 'community', '')::uuid);
  if v_why is not null then
    raise exception '%', v_why using errcode = '42501';
  end if;
  v_pos := public.export_position(g.pack);
  update public.export_links set opens = opens + 1, last_opened_at = now() where id = l.id;
  return jsonb_build_object(
    'export_id', g.id, 'pack', g.pack, 'pack_name', k.name, 'lane', g.lane, 'format', g.format, 'purpose', g.purpose,
    'filters', g.filters, 'role', g.role, 'rehearsal', v_pos = 'rehearsal', 'made_at', g.at, 'expires_at', l.expires_at,
    'who', public.person_display_name(uid));
end;
$$;

-- The file was made (or could not be): how many rows, once, and only by the account the link belongs to.
create function public.export_done(p_export uuid, p_rows integer, p_ok boolean default true, p_note text default null)
returns void
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
  update public.export_log
     set status = case when p_ok then 'delivered' else 'failed' end,
         row_count = case when p_ok then greatest(coalesce(p_rows, 0), 0) else row_count end,
         delivered_at = case when p_ok then coalesce(delivered_at, now()) else delivered_at end,
         note = case when p_ok then note else left(p_note, 160) end
   where id = p_export and person_id = uid and status in ('prepared', 'delivered');
end;
$$;

-- Delete now: the link stops working at once. Nothing is stored, so there is no file to remove.
create function public.export_withdraw(p_export uuid)
returns void
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
  if not exists (select 1 from public.export_log g where g.id = p_export and g.person_id = uid) then
    raise exception 'We could not find that file' using errcode = 'P0002';
  end if;
  update public.export_links set withdrawn_at = coalesce(withdrawn_at, now()) where export_id = p_export and person_id = uid;
  update public.export_log set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, now()) where id = p_export and person_id = uid;
  perform public.write_event(uid, 'export.withdrawn', 'export', p_export::text, '{}'::jsonb);
end;
$$;

-- The person's own files of the last 30 days. A link that is still good says when it ends.
create function public.my_exports()
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'at', g.at, 'pack', g.pack, 'name', k.name, 'lane', g.lane, 'format', g.format, 'purpose', g.purpose,
             'rows', g.row_count, 'status', g.status, 'rehearsal', g.rehearsal,
             'active', exists (select 1 from public.export_links l
                                where l.export_id = g.id and l.withdrawn_at is null and l.expires_at > now()
                                  and public.export_position(g.pack) <> 'off'),
             'expires_at', (select max(l.expires_at) from public.export_links l where l.export_id = g.id and l.withdrawn_at is null))
           order by g.at desc)
      from (select * from public.export_log x where x.person_id = uid and x.at >= now() - interval '30 days' order by x.at desc limit 100) g
      join public.export_packs k on k.id = g.pack), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sources for the People packs and the coded tables
-- ---------------------------------------------------------------------------
-- The packs that are the screens as a file (the dashboard, the reports, the weekly numbers, a tribe's progress) read the functions those
-- screens read, in the app. These are the ones with no screen of their own, or that need a rule the screen does not apply to a file.
-- Each one starts by asking whether this person may make this pack now, so a pack that is Off gives nothing, even to a direct call.

-- One tribe's members, as the leader's roster shows them (members the church has placed but not yet told the leader about are left out,
-- and a number the member asked to withhold is left out), minus members under 18, who are counted and never listed.
create function public.export_tribe_sheet(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  t public.tribes;
begin
  perform public.export_require('tribe_sheet', p_tribe);
  v := public.tribe_roster_marked(p_tribe);
  select * into t from public.tribes x where x.id = p_tribe;
  return jsonb_build_object(
    'tribe', jsonb_build_object(
      'id', t.id, 'name', coalesce(t.name, 'Your tribe'),
      'community', (select c.name from public.communities c where c.id = t.community_id),
      'season', (select s.name from public.seasons s where s.id = t.season_id)),
    'members', coalesce((
      -- A number is in the file only if the member agreed to WhatsApp and did not ask for it to be withheld (the roster already blanks the latter)
      select jsonb_agg((m - 'note_enc' - 'person_id')
                       || jsonb_build_object('whatsapp', case when public.consent_granted((m ->> 'person_id')::uuid, 'whatsapp') then m -> 'whatsapp' else 'null'::jsonb end)
                       order by o)
        from jsonb_array_elements(v -> 'members') with ordinality as e(m, o)
       where not public.export_is_young((m ->> 'person_id')::uuid)), '[]'::jsonb),
    'young_count', (select count(*)::int from jsonb_array_elements(v -> 'members') e(m) where public.export_is_young((m ->> 'person_id')::uuid)));
end;
$$;

-- The same names against the season's weeks, for ticking on paper or a tablet. Members under 18 are counted, never listed.
create function public.export_attendance_register(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  t public.tribes;
  s public.seasons;
begin
  perform public.export_require('attendance_register', p_tribe);
  v := public.tribe_roster_marked(p_tribe);
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.seasons x where x.id = t.season_id;
  return jsonb_build_object(
    'tribe', jsonb_build_object(
      'id', t.id, 'name', coalesce(t.name, 'Your tribe'),
      'community', (select c.name from public.communities c where c.id = t.community_id),
      'season', s.name, 'season_starts_on', s.starts_on, 'weeks', s.weeks, 'meeting_day', t.meeting_day,
      'meeting_time', to_char(t.meeting_time, 'HH24:MI')),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', m ->> 'name', 'first_name', m ->> 'first_name') order by o)
        from jsonb_array_elements(v -> 'members') with ordinality as e(m, o)
       where not public.export_is_young((m ->> 'person_id')::uuid)), '[]'::jsonb),
    'young_count', (select count(*)::int from jsonb_array_elements(v -> 'members') e(m) where public.export_is_young((m ->> 'person_id')::uuid)));
end;
$$;

-- Each tribe of a season with its leader, assistant and coach, for the pastors and directors. Adults only: a leader, an assistant and a
-- coach are all adults, and the owner never leads, assists or coaches.
create function public.export_leaders_roster(p_season uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid;
begin
  perform public.export_require('leaders_roster');
  v_season := public.dashboard_season(p_season);
  return jsonb_build_object(
    'season', (select s.name from public.seasons s where s.id = v_season),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'leader', public.person_display_name(t.leader_id),
               'assistant', case when t.assistant_id is null then null else public.person_display_name(t.assistant_id) end,
               'tribe', coalesce(t.name, 'Unnamed tribe'),
               'community', c.name, 'track', tr.name,
               'coach', case when t.coach_id is null then null else public.person_display_name(t.coach_id) end,
               'leader_certified', exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id),
               'assistant_certified', case when t.assistant_id is null then null
                                           else exists (select 1 from public.leader_certifications lc where lc.person_id = t.assistant_id) end,
               'status', t.status::text,
               'members', (select count(*)::int from public.tribe_members m where m.tribe_id = t.id and m.status = 'active'))
             order by c.name, t.name)
        from public.tribes t
        left join public.communities c on c.id = t.community_id
        left join public.tracks tr on tr.id = t.track_id
       where t.season_id = v_season and t.status = 'approved'), '[]'::jsonb));
end;
$$;

-- Each person who holds a role, the roles, and since when. Names only: no email, phone or anything else. The owner is never listed.
create function public.export_people_roles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.export_require('people_roles');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(x order by x ->> 'name')
      from (
        select jsonb_build_object(
                 'name', public.person_display_name(p.id),
                 'roles', (select string_agg(r.role::text, ', ' order by r.role::text) from public.person_roles r
                            where r.person_id = p.id and r.centre_id = p.centre_id and r.role <> 'member'),
                 'since', (select min((r.granted_at at time zone 'Africa/Lagos')::date) from public.person_roles r
                            where r.person_id = p.id and r.centre_id = p.centre_id and r.role <> 'member')) as x
          from public.people p
         where p.centre_id = public.my_centre()
           and not p.hidden
           and not public.notice_is_owner(p.id)
           and not public.export_is_young(p.id)
           and exists (select 1 from public.person_roles r where r.person_id = p.id and r.centre_id = p.centre_id and r.role <> 'member')) q), '[]'::jsonb));
end;
$$;

-- Counts of messages by day, template, channel and outcome, from the reporting copy. Never the wording.
create function public.export_message_volumes(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date := coalesce(p_to, public.today_lagos());
  v_from date := coalesce(p_from, coalesce(p_to, public.today_lagos()) - 89);
begin
  perform public.export_require('message_volumes');
  if v_from > v_to or v_to - v_from > 365 then
    raise exception 'Choose up to a year' using errcode = '22023';
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to,
    'refreshed_at', (select c.refreshed_at from bi.config c),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'template', d.template, 'channel', d.channel, 'status', d.status, 'messages', d.messages)
                       order by d.day, d.template, d.channel, d.status)
        from bi.messages_daily d where d.day between v_from and v_to), '[]'::jsonb));
end;
$$;

-- A coded table from the reporting copy, for the Open Data Pack and the standing feed link. Members under 18 are left out of the member
-- table (their key is worked out the way the copy works it out) and counted instead.
create function public.export_table_rows(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_young integer := 0;
begin
  if p_table not in ('members', 'tribes', 'weekly', 'care_weekly', 'messages_daily', 'ai_fields', 'kpi_daily') then
    raise exception 'That is not one of the tables' using errcode = '22023';
  end if;
  if p_table = 'members' then
    select count(*)::int into v_young from bi.members m
     where m.member_key in (select md5(c.salt || p.id::text) from bi.config c cross join public.people p where public.export_is_young(p.id));
    select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v from bi.members m
     where m.member_key not in (select md5(c.salt || p.id::text) from bi.config c cross join public.people p where public.export_is_young(p.id));
  else
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from bi.%I t', p_table) into v;
  end if;
  return jsonb_build_object('table', p_table, 'rows', v, 'young_not_listed', v_young,
    'refreshed_at', (select c.refreshed_at from bi.config c));
end;
$$;

-- The seven tables, for a person who may make the Insight feeds (the Open Data Pack): the door must be on as well
create function public.export_insight_table(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.export_settings;
begin
  perform public.export_require('insight_feeds');
  select * into s from public.export_settings x where x.singleton;
  if not found or not ('open_data_pack' = any (s.doors)) then
    raise exception 'The Open Data Pack is switched off right now' using errcode = '42501';
  end if;
  return public.export_table_rows(p_table);
end;
$$;

-- ---------------------------------------------------------------------------
-- Standing feed links
-- ---------------------------------------------------------------------------

-- Makes a link for a tool that fetches a web address on a schedule. One coded table, read only, 90 days. The link is shown once.
create function public.export_feed_create(p_table text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.export_settings;
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_label text := left(btrim(coalesce(p_label, '')), 60);
begin
  perform public.export_require('insight_feeds');
  select * into s from public.export_settings x where x.singleton;
  if not found or not ('standing_link' = any (s.doors)) then
    raise exception 'Standing links are switched off right now' using errcode = '42501';
  end if;
  if public.export_position('insight_feeds') not in ('limited', 'on') then
    raise exception 'Standing links start when the pack is open to people beyond the testers. Use the Open Data Pack to try the feed first.' using errcode = '42501';
  end if;
  if p_table not in ('members', 'tribes', 'weekly', 'care_weekly', 'messages_daily', 'ai_fields', 'kpi_daily') then
    raise exception 'That is not one of the tables' using errcode = '22023';
  end if;
  if v_label = '' then
    raise exception 'Say what this link is for' using errcode = '22023';
  end if;
  insert into public.export_feed_links (token_hash, tbl, label, created_by, expires_at)
  values (public.export_hash(v_raw), p_table, v_label, uid, now() + interval '90 days')
  returning id into v_id;
  perform public.write_event(uid, 'export.feed_made', 'export_feed', v_id::text, jsonb_build_object('table', p_table));
  return jsonb_build_object('id', v_id, 'token', v_raw, 'table', p_table, 'expires_at', now() + interval '90 days');
end;
$$;

-- The links that exist, never the links themselves
create function public.export_feed_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.export_require('insight_feeds');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'table', f.tbl, 'label', f.label, 'by', public.person_display_name(f.created_by), 'created_at', f.created_at,
             'expires_at', f.expires_at, 'revoked_at', f.revoked_at, 'last_read_at', f.last_read_at, 'reads', f.reads,
             'live', f.revoked_at is null and f.expires_at > now()) order by f.created_at desc)
      from public.export_feed_links f
     where f.created_at >= now() - interval '1 year'), '[]'::jsonb);
end;
$$;

create function public.export_feed_renew(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.export_require('insight_feeds');
  update public.export_feed_links set expires_at = now() + interval '90 days'
   where id = p_id and revoked_at is null;
  if not found then
    raise exception 'We could not find that link' using errcode = 'P0002';
  end if;
  perform public.write_event(auth.uid(), 'export.feed_renewed', 'export_feed', p_id::text, '{}'::jsonb);
  return public.export_feed_list();
end;
$$;

-- Revoke: the address stops working at once. Always allowed to someone who may make the pack, even when the pack is Off.
create function public.export_feed_revoke(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.export_packs;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into k from public.export_packs p where p.id = 'insight_feeds';
  if not public.export_holds(auth.uid(), k.roles) then
    raise exception 'Your role does not include this file' using errcode = '42501';
  end if;
  update public.export_feed_links set revoked_at = coalesce(revoked_at, now()) where id = p_id;
  if not found then
    raise exception 'We could not find that link' using errcode = 'P0002';
  end if;
  perform public.write_event(auth.uid(), 'export.feed_revoked', 'export_feed', p_id::text, '{}'::jsonb);
  return jsonb_build_object('revoked', true);
end;
$$;

-- What a tool gets when it fetches a standing link: the rows of the one table, if the link is good and the pack and door are still open.
-- No account: the secret is the credential. Anything wrong looks the same, so a guess learns nothing.
create function public.export_feed_read(p_token text, p_table text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.export_feed_links;
  s public.export_settings;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select * into f from public.export_feed_links x where x.token_hash = public.export_hash(p_token);
  if not found or f.revoked_at is not null or f.expires_at <= now() or f.tbl is distinct from p_table then
    return null;
  end if;
  select * into s from public.export_settings x where x.singleton;
  if not found or not ('standing_link' = any (s.doors)) or public.export_position('insight_feeds') not in ('limited', 'on') then
    return null;
  end if;
  update public.export_feed_links set reads = reads + 1, last_read_at = now() where id = f.id;
  return public.export_table_rows(f.tbl);
end;
$$;

-- ---------------------------------------------------------------------------
-- The switchboard (the platform owner only: every function begins god_only())
-- ---------------------------------------------------------------------------

create function public.export_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.export_settings;
begin
  perform public.god_only();
  select * into s from public.export_settings x where x.singleton;
  return jsonb_build_object(
    'settings', jsonb_build_object(
      'paused', s.paused, 'people_stopped', s.people_stopped, 'unusual_per_hour', s.unusual_per_hour,
      'formats', to_jsonb(s.formats), 'deliveries', to_jsonb(s.deliveries), 'doors', to_jsonb(s.doors),
      'people_cleared_on', s.people_cleared_on, 'updated_at', s.updated_at),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'name', k.name, 'lane', k.lane, 'scope', k.scope, 'roles', to_jsonb(k.roles), 'formats', to_jsonb(k.formats),
               'released', k.released, 'position', w.position, 'in_force', public.export_position(k.id),
               'limited_roles', to_jsonb(w.limited_roles), 'limited_communities', to_jsonb(w.limited_communities), 'limited_tribes', to_jsonb(w.limited_tribes),
               'rehearsed_at', w.rehearsed_at, 'changed_at', w.changed_at, 'reason', w.reason,
               'made_30d', (select count(*)::int from public.export_log g where g.pack = k.id and g.at >= now() - interval '30 days'),
               'by_role', coalesce((select jsonb_object_agg(r.role, r.n)
                                      from (select g.role, count(*)::int as n from public.export_log g
                                             where g.pack = k.id and g.at >= now() - interval '30 days' group by g.role) r), '{}'::jsonb))
             order by k.sort)
        from public.export_packs k join public.export_switches w on w.pack = k.id), '[]'::jsonb),
    'testers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', t.person_id, 'name', public.person_display_name(t.person_id),
               'roles', (select coalesce(string_agg(r.role::text, ', ' order by r.role::text), '') from public.person_roles r
                          where r.person_id = t.person_id and r.role <> 'member'),
               'added_at', t.added_at) order by t.added_at)
        from public.export_testers t), '[]'::jsonb),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.at, 'what', l.what, 'was', l.was, 'now', l.now_is, 'reason', l.reason) order by l.at desc, l.id desc)
        from (select * from public.export_switch_log x order by x.at desc, x.id desc limit 40) l), '[]'::jsonb),
    'unusual', coalesce((
      select jsonb_agg(jsonb_build_object('at', g.at, 'who', public.person_display_name(g.person_id), 'pack', g.pack, 'role', g.role) order by g.at desc)
        from (select * from public.export_log x where x.flagged = 'unusual' and x.at >= now() - interval '30 days' order by x.at desc limit 20) g), '[]'::jsonb),
    'feeds_live', (select count(*)::int from public.export_feed_links f where f.revoked_at is null and f.expires_at > now()),
    'links_live', (select count(*)::int from public.export_links l where l.withdrawn_at is null and l.expires_at > now()),
    'communities', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.communities c where c.active), '[]'::jsonb),
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', coalesce(t.name, 'Unnamed tribe'), 'community', c.name) order by c.name, t.name)
        from public.tribes t left join public.communities c on c.id = t.community_id
       where t.status = 'approved' and t.season_id = public.dashboard_season(null)), '[]'::jsonb));
end;
$$;

-- How many people a position would reach, so the owner sees the number before saving
create function public.export_pack_preview(p_pack text, p_position text, p_limits jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.export_packs;
  v_roles public.app_role[];
  v_tribes uuid[];
  v_communities uuid[];
  v_n integer;
begin
  perform public.god_only();
  select * into k from public.export_packs p where p.id = p_pack;
  if not found then
    raise exception 'We could not find that pack' using errcode = 'P0002';
  end if;
  if p_position = 'off' then
    return jsonb_build_object('people', 0);
  end if;
  if p_position = 'rehearsal' then
    return jsonb_build_object('people', (select count(*)::int from public.export_testers));
  end if;
  v_roles := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'roles', '[]'::jsonb))::public.app_role), '{}');
  v_tribes := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'tribes', '[]'::jsonb))::uuid), '{}');
  v_communities := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'communities', '[]'::jsonb))::uuid), '{}');
  select count(distinct r.person_id)::int into v_n
    from public.person_roles r
    join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
   where r.role = any (k.roles)
     and (p_position = 'on' or cardinality(v_roles) = 0 or r.role = any (v_roles))
     and (p_position = 'on' or cardinality(v_tribes) = 0
          or exists (select 1 from public.tribes t where t.id = any (v_tribes) and (t.leader_id = r.person_id or t.assistant_id = r.person_id or t.coach_id = r.person_id)))
     and (p_position = 'on' or cardinality(v_communities) = 0
          or exists (select 1 from public.tribes t where t.community_id = any (v_communities) and (t.leader_id = r.person_id or t.assistant_id = r.person_id or t.coach_id = r.person_id))
          or exists (select 1 from public.community_champions h where h.person_id = r.person_id and h.community_id = any (v_communities)));
  return jsonb_build_object('people', v_n);
end;
$$;

-- Moves one pack. A reason is needed to open it beyond the testers. A People pack must have been in Rehearsal first, and the impact
-- assessment must be recorded as signed, before it can go to Limited or On.
create function public.export_pack_set(p_pack text, p_position text, p_limits jsonb default '{}'::jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k public.export_packs;
  w public.export_switches;
  s public.export_settings;
  v_roles public.app_role[];
  v_tribes uuid[];
  v_communities uuid[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_was text;
begin
  perform public.god_only();
  select * into k from public.export_packs p where p.id = p_pack;
  if not found then
    raise exception 'We could not find that pack' using errcode = 'P0002';
  end if;
  if p_position is null or p_position not in ('off', 'rehearsal', 'limited', 'on') then
    raise exception 'Choose Off, Rehearsal, Limited or On' using errcode = '22023';
  end if;
  if not k.released and p_position <> 'off' then
    raise exception 'This pack arrives in a later release and cannot be opened yet' using errcode = '22023';
  end if;
  select * into w from public.export_switches x where x.pack = p_pack for update;
  select * into s from public.export_settings x where x.singleton;
  if p_position in ('limited', 'on') and (v_reason is null or char_length(v_reason) < 8) then
    raise exception 'Say why, in a few words, to open this beyond the testers' using errcode = '22023';
  end if;
  if k.lane = 'people' and p_position in ('limited', 'on') then
    if w.rehearsed_at is null and w.position <> 'rehearsal' then
      raise exception 'A People pack must be tried in Rehearsal first' using errcode = '22023';
    end if;
    if s.people_cleared_on is null then
      raise exception 'Record that the impact assessment is signed before a People pack leaves Rehearsal' using errcode = '22023';
    end if;
  end if;

  if p_position = 'limited' then
    v_roles := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'roles', '[]'::jsonb))::public.app_role), '{}');
    v_tribes := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'tribes', '[]'::jsonb))::uuid), '{}');
    v_communities := coalesce(array(select jsonb_array_elements_text(coalesce(p_limits -> 'communities', '[]'::jsonb))::uuid), '{}');
    if cardinality(v_roles) = 0 and cardinality(v_tribes) = 0 and cardinality(v_communities) = 0 then
      raise exception 'Choose who it is open to: some roles, communities or tribes' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_roles) r where not (r = any (k.roles))) then
      raise exception 'A role was chosen that this pack is not for' using errcode = '22023';
    end if;
    if k.scope in ('church', 'self') and (cardinality(v_tribes) > 0 or cardinality(v_communities) > 0) then
      raise exception 'This pack is not about a tribe or a community, so it can be limited by role only' using errcode = '22023';
    end if;
    if k.scope = 'community' and cardinality(v_tribes) > 0 then
      raise exception 'This pack is about a community, so it can be limited by community or role' using errcode = '22023';
    end if;
  else
    v_roles := '{}';
    v_tribes := '{}';
    v_communities := '{}';
  end if;

  v_was := w.position || case when w.position = 'limited' then ' (' || cardinality(w.limited_roles) || ' roles, ' || cardinality(w.limited_communities) || ' communities, ' || cardinality(w.limited_tribes) || ' tribes)' else '' end;
  update public.export_switches
     set position = p_position, limited_roles = v_roles, limited_communities = v_communities, limited_tribes = v_tribes,
         rehearsed_at = case when p_position = 'rehearsal' then coalesce(rehearsed_at, now()) else rehearsed_at end,
         changed_by = auth.uid(), changed_at = now(), reason = v_reason
   where pack = p_pack;
  perform public.export_note('pack:' || p_pack, v_was,
    p_position || case when p_position = 'limited' then ' (' || cardinality(v_roles) || ' roles, ' || cardinality(v_communities) || ' communities, ' || cardinality(v_tribes) || ' tribes)' else '' end,
    v_reason);
  return public.export_board();
end;
$$;

-- The church-wide settings. Only the keys named are changed.
create function public.export_settings_save(p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.export_settings;
  n public.export_settings;
  k text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_list text[];
begin
  perform public.god_only();
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Say what to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('paused', 'people_stopped', 'unusual_per_hour', 'formats', 'deliveries', 'doors', 'people_cleared_on') then
      raise exception 'That setting does not exist' using errcode = '22023';
    end if;
  end loop;
  select * into s from public.export_settings x where x.singleton for update;
  n := s;

  if p_changes ? 'paused' then
    if jsonb_typeof(p_changes -> 'paused') is distinct from 'boolean' then
      raise exception 'Pause all exports is on or off' using errcode = '22023';
    end if;
    n.paused := (p_changes ->> 'paused')::boolean;
  end if;
  if p_changes ? 'people_stopped' then
    if jsonb_typeof(p_changes -> 'people_stopped') is distinct from 'boolean' then
      raise exception 'Stop all People files is on or off' using errcode = '22023';
    end if;
    n.people_stopped := (p_changes ->> 'people_stopped')::boolean;
  end if;
  if p_changes ? 'unusual_per_hour' then
    if jsonb_typeof(p_changes -> 'unusual_per_hour') is distinct from 'number' or (p_changes ->> 'unusual_per_hour') !~ '^[0-9]{1,3}$'
       or (p_changes ->> 'unusual_per_hour')::int not between 1 and 100 then
      raise exception 'Use a whole number from 1 to 100' using errcode = '22023';
    end if;
    n.unusual_per_hour := (p_changes ->> 'unusual_per_hour')::int;
  end if;
  foreach k in array array['formats', 'deliveries', 'doors'] loop
    continue when not (p_changes ? k);
    if jsonb_typeof(p_changes -> k) is distinct from 'array' then
      raise exception 'Choose from the list' using errcode = '22023';
    end if;
    v_list := coalesce(array(select distinct x from jsonb_array_elements_text(p_changes -> k) x order by x), '{}');
    begin
      case k
        when 'formats' then n.formats := v_list;
        when 'deliveries' then n.deliveries := v_list;
        when 'doors' then n.doors := v_list;
      end case;
      -- the table's own checks say which values are allowed
      update public.export_settings set formats = n.formats, deliveries = n.deliveries, doors = n.doors where singleton;
    exception when check_violation then
      raise exception 'One of the choices for % is not available in this release', k using errcode = '22023';
    end;
  end loop;
  if p_changes ? 'people_cleared_on' then
    if jsonb_typeof(p_changes -> 'people_cleared_on') = 'null' then
      n.people_cleared_on := null;
    elsif jsonb_typeof(p_changes -> 'people_cleared_on') = 'string' and (p_changes ->> 'people_cleared_on') ~ '^\d{4}-\d{2}-\d{2}$' then
      n.people_cleared_on := (p_changes ->> 'people_cleared_on')::date;
      if n.people_cleared_on > public.today_lagos() then
        raise exception 'The day it was signed cannot be in the future' using errcode = '22023';
      end if;
    else
      raise exception 'Give the day as year, month and day' using errcode = '22023';
    end if;
    if n.people_cleared_on is not null and (v_reason is null or char_length(v_reason) < 8) then
      raise exception 'Say who signed it, in a few words' using errcode = '22023';
    end if;
  end if;

  update public.export_settings
     set paused = n.paused, people_stopped = n.people_stopped, unusual_per_hour = n.unusual_per_hour,
         formats = n.formats, deliveries = n.deliveries, doors = n.doors, people_cleared_on = n.people_cleared_on,
         updated_by = auth.uid(), updated_at = now()
   where singleton;

  if n.paused is distinct from s.paused then
    perform public.export_note('setting:paused', s.paused::text, n.paused::text, v_reason);
  end if;
  if n.people_stopped is distinct from s.people_stopped then
    perform public.export_note('setting:people_stopped', s.people_stopped::text, n.people_stopped::text, v_reason);
  end if;
  if n.unusual_per_hour is distinct from s.unusual_per_hour then
    perform public.export_note('setting:unusual_per_hour', s.unusual_per_hour::text, n.unusual_per_hour::text, v_reason);
  end if;
  if n.formats is distinct from s.formats then
    perform public.export_note('setting:formats', array_to_string(s.formats, ','), array_to_string(n.formats, ','), v_reason);
  end if;
  if n.deliveries is distinct from s.deliveries then
    perform public.export_note('setting:deliveries', array_to_string(s.deliveries, ','), array_to_string(n.deliveries, ','), v_reason);
  end if;
  if n.doors is distinct from s.doors then
    perform public.export_note('setting:doors', array_to_string(s.doors, ','), array_to_string(n.doors, ','), v_reason);
  end if;
  if n.people_cleared_on is distinct from s.people_cleared_on then
    perform public.export_note('setting:people_cleared_on', s.people_cleared_on::text, n.people_cleared_on::text, v_reason);
  end if;
  return public.export_board();
end;
$$;

-- Adds or removes someone who may make a file while a pack is in Rehearsal
create function public.export_tester_set(p_person uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  if p_person is null or not exists (select 1 from public.people p where p.id = p_person and not p.hidden) then
    raise exception 'We could not find that person' using errcode = 'P0002';
  end if;
  if public.notice_is_owner(p_person) then
    raise exception 'The owner does not need to be a tester' using errcode = '22023';
  end if;
  if p_on then
    insert into public.export_testers (person_id) values (p_person) on conflict do nothing;
  else
    delete from public.export_testers where person_id = p_person;
  end if;
  perform public.export_note('tester:' || p_person::text, case when p_on then 'not a tester' else 'tester' end,
    case when p_on then 'tester' else 'not a tester' end, null);
  return public.export_board();
end;
$$;

-- The export log, newest first, for the owner. Names the person who made each file, never what was in it.
create function public.export_log_list(p_limit integer default 60, p_before timestamptz default null, p_pack text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'at', g.at, 'who', public.person_display_name(g.person_id), 'role', g.role, 'pack', g.pack, 'name', k.name,
             'lane', g.lane, 'format', g.format, 'position', g.position, 'rehearsal', g.rehearsal, 'purpose', g.purpose,
             'rows', g.row_count, 'status', g.status, 'flagged', g.flagged, 'filters', g.filters) order by g.at desc)
      from (select * from public.export_log x
             where (p_before is null or x.at < p_before) and (p_pack is null or x.pack = p_pack)
             order by x.at desc limit greatest(1, least(coalesce(p_limit, 60), 200))) g
      join public.export_packs k on k.id = g.pack), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Keeping the log for two years, and no longer (the daily clean-up)
-- ---------------------------------------------------------------------------

create function public.export_retention(p_now timestamptz, p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  m integer;
begin
  delete from public.export_log g where g.at < p_now - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.export_switch_log l where l.at < p_now - make_interval(days => p_days);
  get diagnostics m = row_count;
  -- A feed link that ended (revoked or expired) a month ago has nothing left to say
  delete from public.export_feed_links f
   where (f.revoked_at is not null and f.revoked_at < p_now - interval '30 days')
      or f.expires_at < p_now - interval '30 days';
  return n + m;
end;
$$;

-- The daily clean-up of this feature has its own door, like the activity summaries and the notices: the heartbeat calls it once a day with
-- the sending token. It is not folded into the platform's own clean-up, so that one is left exactly as it was.
create function public.worker_export_sweep(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'export-retention:' || (now() at time zone 'Africa/Lagos')::date::text;
  n integer;
begin
  perform public.worker_ok(p_token);
  if exists (select 1 from public.calendar_runs c where c.key = v_key) then
    return jsonb_build_object('export_retention_ran', false);
  end if;
  n := public.export_retention(now(), 730); -- two years: the log says who made which file and why, never what was in it
  insert into public.calendar_runs (key) values (v_key) on conflict do nothing;
  perform public.write_event(null, 'retention.export_log', 'platform', 'export_log', jsonb_build_object('removed', n));
  return jsonb_build_object('export_retention_ran', true, 'export_log_removed', n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. Every function starts with no access, then gets exactly the access below.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.export_hash(p_token text),
  public.export_position(p_pack text),
  public.export_holds(p_person uuid, p_roles public.app_role[]),
  public.export_refusal(p_pack text, p_person uuid, p_tribe uuid, p_community uuid),
  public.export_require(p_pack text, p_tribe uuid, p_community uuid),
  public.export_choice_uuid(p_filters jsonb, p_key text),
  public.export_is_young(p_person uuid),
  public.export_note(p_what text, p_was text, p_now text, p_reason text),
  public.export_options(),
  public.export_prepare(p_pack text, p_format text, p_purpose text, p_filters jsonb),
  public.export_open(p_token text),
  public.export_done(p_export uuid, p_rows integer, p_ok boolean, p_note text),
  public.export_withdraw(p_export uuid),
  public.my_exports(),
  public.export_tribe_sheet(p_tribe uuid),
  public.export_attendance_register(p_tribe uuid),
  public.export_leaders_roster(p_season uuid),
  public.export_people_roles(),
  public.export_message_volumes(p_from date, p_to date),
  public.export_table_rows(p_table text),
  public.export_insight_table(p_table text),
  public.export_feed_create(p_table text, p_label text),
  public.export_feed_list(),
  public.export_feed_renew(p_id uuid),
  public.export_feed_revoke(p_id uuid),
  public.export_feed_read(p_token text, p_table text),
  public.export_board(),
  public.export_pack_preview(p_pack text, p_position text, p_limits jsonb),
  public.export_pack_set(p_pack text, p_position text, p_limits jsonb, p_reason text),
  public.export_settings_save(p_changes jsonb, p_reason text),
  public.export_tester_set(p_person uuid, p_on boolean),
  public.export_log_list(p_limit integer, p_before timestamptz, p_pack text),
  public.export_retention(p_now timestamptz, p_days integer),
  public.worker_export_sweep(p_token text)
  from public, anon, authenticated;

-- What a signed-in person calls. Each one checks who is asking.
grant execute on function
  public.export_options(),
  public.export_prepare(p_pack text, p_format text, p_purpose text, p_filters jsonb),
  public.export_open(p_token text),
  public.export_done(p_export uuid, p_rows integer, p_ok boolean, p_note text),
  public.export_withdraw(p_export uuid),
  public.my_exports(),
  public.export_tribe_sheet(p_tribe uuid),
  public.export_attendance_register(p_tribe uuid),
  public.export_leaders_roster(p_season uuid),
  public.export_people_roles(),
  public.export_message_volumes(p_from date, p_to date),
  public.export_insight_table(p_table text),
  public.export_feed_create(p_table text, p_label text),
  public.export_feed_list(),
  public.export_feed_renew(p_id uuid),
  public.export_feed_revoke(p_id uuid)
  to authenticated;

-- The switchboard: each of these begins god_only(), which also needs the owner to be unlocked on this sign-in. Nobody else can move a switch.
grant execute on function
  public.export_board(),
  public.export_pack_preview(p_pack text, p_position text, p_limits jsonb),
  public.export_pack_set(p_pack text, p_position text, p_limits jsonb, p_reason text),
  public.export_settings_save(p_changes jsonb, p_reason text),
  public.export_tester_set(p_person uuid, p_on boolean),
  public.export_log_list(p_limit integer, p_before timestamptz, p_pack text)
  to authenticated;

-- A tool that fetches a standing feed link has no account. The secret in the address is the credential. A signed-in person who opens the
-- same address in a browser gets the same answer, so it is open to both.
grant execute on function public.export_feed_read(p_token text, p_table text) to anon, authenticated;

-- The sending service has no account; the token is the credential (as for the notice sweep).
grant execute on function public.worker_export_sweep(p_token text) to anon;

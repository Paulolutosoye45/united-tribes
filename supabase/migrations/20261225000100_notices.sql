-- =============================================================================
-- United Tribes: email notices for the people who run the programme (part 1: the engine)
--
-- Until now the platform wrote to members, leaders and applicants, and left the pastors, directors, admins, coaches, the care team and
-- the community champions to log in and find out that something was waiting for them. This adds the notices that tell them, and the
-- engine every notice goes through. It adds no notice by itself: the triggers that cause them are in the next file, and the wording is
-- in src/lib/messaging/templates-notices.ts.
--
--   notice_settings   one switch for each group of people: Off, Rehearsal (written to the log, not sent) or On. Everything starts Off.
--   notice_prefs      how each person on the team wants to hear: right away, in a daily digest at 7 in the morning, or in a weekly digest on Monday
--   notice_items      what has been queued for a person. One row for each thing that happened, for each person: this is what makes a notice
--                     sent once, and what a digest is built from
--   notice_pending    a change that waits a few minutes before it is announced, so five edits in a row are one email
--   notice_faults     a notice that could not be queued. It is recorded here and never stops the work that caused it
--
-- Every email still goes through enqueue_message, so the outbox, the retries, quiet hours (nothing from 10 pm to 6 am in Lagos), the message log,
-- "Try again" and the email service in use (Resend or your own SMTP server) are the ones that exist already. The 58 messages that already exist
-- are not touched and are not affected by these switches.
--
-- The rules every notice follows are in the functions below: it is never sent to the platform owner; it is sent to the people who hold the
-- role in that centre while they hold it; a person who holds two roles (an admin who is also a pastor) is told once about the same event; and a
-- group that is Off, or cannot be read, sends nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.notice_settings (
  group_key text primary key check (group_key in
    ('pastors', 'directors', 'admin', 'coaches', 'care', 'leaders', 'members', 'applicants', 'referees', 'champions', 'data_lead')),
  mode text not null default 'off' check (mode in ('off', 'rehearsal', 'on')),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.notice_settings (group_key)
values ('pastors'), ('directors'), ('admin'), ('coaches'), ('care'), ('leaders'), ('members'), ('applicants'), ('referees'), ('champions'), ('data_lead');

create table public.notice_prefs (
  person_id uuid not null references public.people (id) on delete cascade,
  group_key text not null check (group_key in ('pastors', 'directors', 'admin', 'coaches', 'care')),
  delivery text not null check (delivery in ('instant', 'daily', 'weekly')),
  updated_at timestamptz not null default now(),
  primary key (person_id, group_key)
);

create table public.notice_items (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  group_key text not null,
  kind text not null check (kind ~ '^[a-z0-9_]{2,48}$'),
  -- The thing that happened ("card:<id>:<time>"). One row per person and event, whatever the number of roles or the number of triggers.
  event text not null check (char_length(event) between 3 and 200),
  -- One short line for a digest. First names only; never a note, a score, a reason or a care word.
  label text not null check (char_length(label) between 3 and 120),
  path text not null check (path ~ '^/[A-Za-z0-9/_?=&.-]{0,120}$'),
  delivery text not null check (delivery in ('instant', 'digest')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  -- Why a waiting item was dropped instead of sent ("role removed", "switched off").
  note text check (char_length(note) <= 60),
  unique (person_id, event)
);
create index notice_items_waiting_idx on public.notice_items (person_id) where sent_at is null;
create index notice_items_kind_idx on public.notice_items (kind, created_at desc);

create table public.notice_pending (
  kind text not null check (kind ~ '^[a-z0-9_]{2,48}$'),
  ref text not null check (char_length(ref) between 1 and 80),
  due_at timestamptz not null,
  -- What it looked like before the first change in this wait, so a change that is put back is not announced.
  before text check (char_length(before) <= 80),
  primary key (kind, ref)
);

create table public.notice_faults (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (char_length(source) <= 60),
  message text not null check (char_length(message) <= 300)
);

alter table public.notice_settings enable row level security;
alter table public.notice_prefs enable row level security;
alter table public.notice_items enable row level security;
alter table public.notice_pending enable row level security;
alter table public.notice_faults enable row level security;
-- No grants: only the functions touch these tables.

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

-- The day, hour and weekday in Lagos for a moment, so every check can be run for any moment (and tested at any time of day).
create function public.notice_day(p_now timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$ select (p_now at time zone 'Africa/Lagos')::date $$;

create function public.notice_hour(p_now timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$ select extract(hour from (p_now at time zone 'Africa/Lagos'))::integer $$;

-- Monday = 1 ... Sunday = 7
create function public.notice_isodow(p_now timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$ select extract(isodow from (p_now at time zone 'Africa/Lagos'))::integer $$;

create function public.notice_week(p_now timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$ select to_char((p_now at time zone 'Africa/Lagos')::date, 'IYYY-"W"IW') $$;

-- Which group of notices a role belongs to (null: the role has no notices).
create function public.notice_group_of_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'pastor' then 'pastors'
    when 'director' then 'directors'
    when 'admin' then 'admin'
    when 'coach' then 'coaches'
    when 'care_lead' then 'care'
    when 'leader' then 'leaders'
    when 'assistant_leader' then 'leaders'
    when 'community_champion' then 'champions'
    when 'data_lead' then 'data_lead'
  end
$$;

-- The roles a person must still hold, in the centre, to be sent a group's notices. The care notices go to the care lead, or to the directors,
-- or to the admins when there is no care lead (the same order the urgent care alert uses).
create function public.notice_group_roles(p_group text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_group
    when 'pastors' then array['pastor']
    when 'directors' then array['director']
    when 'admin' then array['admin']
    when 'coaches' then array['coach']
    when 'care' then array['care_lead', 'director', 'admin']
    when 'leaders' then array['leader', 'assistant_leader']
    when 'champions' then array['community_champion']
    when 'data_lead' then array['data_lead']
    else null
  end
$$;

-- The roles that receive a group's notices in one centre. Care goes to the care lead, or the directors when there is none, or the admins.
create function public.notice_roles_in(p_group text, p_centre uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_group <> 'care' then public.notice_group_roles(p_group)
    when exists (select 1 from public.person_roles x where x.centre_id = p_centre and x.role = 'care_lead') then array['care_lead']
    when exists (select 1 from public.person_roles x where x.centre_id = p_centre and x.role = 'director') then array['director']
    else array['admin']
  end
$$;

-- Groups where a person chooses between right away and a digest. The others are always right away.
create function public.notice_digest_group(p_group text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_group in ('pastors', 'directors', 'admin', 'coaches', 'care') $$;

-- Groups whose notices are a service to the role: they send while the person holds the role. The others respect "stop emailing me".
create function public.notice_service_group(p_group text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_group in ('pastors', 'directors', 'admin', 'coaches', 'care', 'data_lead') $$;

-- The switch for a group. A group that cannot be read counts as Off: the strictest answer.
create function public.notice_mode(p_group text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select s.mode into v from public.notice_settings s where s.group_key = p_group;
  return coalesce(v, 'off');
exception when others then
  return 'off';
end;
$$;

-- The platform owner holds every role without holding a row, and is never named or written to by a notice.
create function public.notice_is_owner(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_owner o where o.person_id = p_person)
      or exists (select 1 from public.people p where p.id = p_person and p.hidden)
$$;

-- How a person wants to hear about a group of notices: instant, daily or weekly.
create function public.notice_delivery(p_person uuid, p_group text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.notice_digest_group(p_group) then 'instant'
              else coalesce((select f.delivery from public.notice_prefs f where f.person_id = p_person and f.group_key = p_group), 'daily') end
$$;

-- Someone under 18, or someone with a parent's permission on file. The notice engine never emails them: nothing it sends is written for a young member.
create function public.notice_is_young(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.guardian_consents g where g.person_id = p_person)
      or exists (select 1 from public.member_profiles mp join public.age_ranges ar on ar.id = mp.age_range_id
                  where mp.person_id = p_person and ar.max_age is not null and ar.max_age < 18)
$$;

-- Records that a notice could not be queued. Never raises.
create function public.notice_fault(p_source text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notice_faults (source, message) values (left(coalesce(p_source, 'notice'), 60), left(coalesce(p_message, 'unknown'), 300));
  -- Keep the last 200.
  delete from public.notice_faults f where f.id < (select coalesce(max(g.id), 0) - 200 from public.notice_faults g);
exception when others then
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Telling a person
-- ---------------------------------------------------------------------------

-- Tells one person about one thing that happened. Returns the item's id, or null when nothing was queued (the group is Off, the person is the
-- owner or has no usable address, they were already told about this event, or they asked not to be emailed).
--
--   p_group    the group of notices (and so the switch)
--   p_kind     the notice, which is also the name of its template
--   p_event    what happened ("card:<tribe>:<time>"). A person is told once about each event, whatever role they were told it under
--   p_params   what the wording needs. Names are first names only; never a note, a score, a reason or a care word
--   p_label    one short line for a digest
--   p_path     the page the button opens
--   p_instant  send now even if the person chose a digest (deadlines and anything that may not wait)
create function public.notify_person(
  p_person uuid,
  p_group text,
  p_kind text,
  p_event text,
  p_params jsonb,
  p_label text,
  p_path text,
  p_instant boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_email text;
  v_centre uuid;
  v_delivery text;
  v_item bigint;
  v_msg uuid;
  v_params jsonb;
  v_key text;
begin
  if p_person is null or p_group is null or p_kind is null or p_event is null then
    return null;
  end if;
  v_mode := public.notice_mode(p_group);
  if v_mode = 'off' then
    return null;
  end if;
  if public.notice_is_owner(p_person) or public.notice_is_young(p_person) then
    return null;
  end if;
  select p.email, p.centre_id into v_email, v_centre from public.people p where p.id = p_person;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  if not public.notice_service_group(p_group) and public.email_opted_out(p_person) then
    return null;
  end if;

  v_delivery := case when p_instant then 'instant' else public.notice_delivery(p_person, p_group) end;
  insert into public.notice_items (person_id, group_key, kind, event, label, path, delivery)
  values (p_person, p_group, p_kind, p_event, left(coalesce(nullif(btrim(p_label), ''), p_kind), 120), p_path,
          case when v_delivery = 'instant' then 'instant' else 'digest' end)
  on conflict (person_id, event) do nothing
  returning id into v_item;
  if v_item is null then
    return null;
  end if;
  if v_delivery <> 'instant' then
    return v_item;
  end if;

  v_params := coalesce(p_params, '{}'::jsonb) || jsonb_build_object('path', p_path, 'notice_group', p_group, 'notice_kind', p_kind);
  v_key := 'notice:' || p_kind || ':' || p_event || ':' || p_person;
  if v_mode = 'rehearsal' then
    insert into public.messages (centre_id, person_id, template, params, force_channel, dedupe_key, status, channel, error)
    values (v_centre, p_person, p_kind, v_params, 'email', v_key, 'skipped', 'email', 'Rehearsal: written to the log, not sent')
    on conflict (dedupe_key) do nothing
    returning id into v_msg;
  else
    v_msg := public.enqueue_message(p_person, p_kind, v_params, null, v_key, null, 'normal', 'email');
  end if;
  update public.notice_items set sent_at = now(), message_id = v_msg where id = v_item;
  return v_item;
end;
$$;

-- Tells everyone in a centre who holds one of the roles. p_roles is in order of priority: a person who holds two of them is told under the
-- first. p_exclude leaves out the person the notice is about. Returns how many people were queued.
create function public.notify_role(
  p_centre uuid,
  p_roles text[],
  p_kind text,
  p_event text,
  p_params jsonb,
  p_label text,
  p_path text,
  p_instant boolean default false,
  p_exclude uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select distinct on (pr.person_id) pr.person_id, pr.role::text as role
      from public.person_roles pr
     where pr.centre_id = p_centre
       and pr.role::text = any (p_roles)
       and pr.person_id is distinct from p_exclude
     order by pr.person_id, array_position(p_roles, pr.role::text)
  loop
    if public.notify_person(r.person_id, public.notice_group_of_role(r.role), p_kind, p_event, p_params, p_label, p_path, p_instant) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Tells one named person (the assigned coach, the tribe's leader) in their role, if they still hold it.
create function public.notify_named(
  p_person uuid,
  p_role text,
  p_kind text,
  p_event text,
  p_params jsonb,
  p_label text,
  p_path text,
  p_instant boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_person is null then
    return null;
  end if;
  if not exists (select 1 from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
                  where pr.person_id = p_person and pr.role::text = p_role) then
    return null;
  end if;
  return public.notify_person(p_person, public.notice_group_of_role(p_role), p_kind, p_event, p_params, p_label, p_path, p_instant);
end;
$$;

-- Tells the care team of a centre: the care lead, or the directors, or the admins when there is no care lead.
create function public.notify_care(
  p_centre uuid,
  p_kind text,
  p_event text,
  p_params jsonb,
  p_label text,
  p_path text,
  p_instant boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles text[];
  r record;
  n integer := 0;
begin
  v_roles := public.notice_roles_in('care', p_centre);
  for r in select distinct pr.person_id from public.person_roles pr where pr.centre_id = p_centre and pr.role::text = any (v_roles) loop
    if public.notify_person(r.person_id, 'care', p_kind, p_event, p_params, p_label, p_path, p_instant) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Writes to someone we know only by address (a referee): there is no account, so no digest and no preference. Returns true when queued.
create function public.notify_address(
  p_email text,
  p_name text,
  p_group text,
  p_kind text,
  p_event text,
  p_params jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := public.notice_mode(p_group);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_key text := 'notice:' || p_kind || ':' || p_event;
  v_params jsonb := coalesce(p_params, '{}'::jsonb) || jsonb_build_object('notice_group', p_group, 'notice_kind', p_kind);
  v_id uuid;
  v_centre uuid;
begin
  if v_mode = 'off' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return false;
  end if;
  -- Nobody who has asked to be left out of the platform's email, and never the owner.
  if exists (select 1 from public.people p where lower(p.email) = v_email
              and (p.hidden or public.email_opted_out(p.id) or public.notice_is_owner(p.id))) then
    return false;
  end if;
  if v_mode = 'rehearsal' then
    select c.id into v_centre from public.centres c where c.active order by c.created_at limit 1;
    insert into public.messages (centre_id, to_email, to_name, template, params, force_channel, dedupe_key, status, channel, error)
    values (v_centre, v_email, left(p_name, 120), p_kind, v_params, 'email', v_key, 'skipped', 'email', 'Rehearsal: written to the log, not sent')
    on conflict (dedupe_key) do nothing
    returning id into v_id;
  else
    v_id := public.enqueue_message(null, p_kind, v_params, null, v_key, null, 'normal', 'email', v_email, null, left(p_name, 120));
  end if;
  return v_id is not null;
end;
$$;

-- Puts a change in the waiting room: it is announced when it has been quiet for a while. Saving again restarts the wait.
create function public.notice_defer(p_kind text, p_ref text, p_minutes integer, p_before text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notice_pending (kind, ref, due_at, before) values (p_kind, p_ref, now() + make_interval(mins => p_minutes), p_before)
  on conflict (kind, ref) do update set due_at = excluded.due_at
$$;

-- ---------------------------------------------------------------------------
-- When a role is taken away, that person's notices for it stop that day
-- ---------------------------------------------------------------------------

create function public.notice_role_removed(p_person uuid, p_centre uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g text;
begin
  foreach g in array array['pastors', 'directors', 'admin', 'coaches', 'care', 'leaders', 'champions', 'data_lead'] loop
    if not exists (select 1 from public.person_roles pr
                    where pr.person_id = p_person and pr.centre_id = p_centre and pr.role::text = any (public.notice_group_roles(g))) then
      update public.notice_items set sent_at = now(), note = 'role removed'
       where person_id = p_person and group_key = g and sent_at is null;
      update public.messages
         set status = 'skipped', error = 'The role was removed before this was sent'
       where person_id = p_person and status = 'queued' and params ->> 'notice_group' = g;
    end if;
  end loop;
  -- A digest that is waiting to go out is dropped too, when no role that has a digest is left.
  if not exists (select 1 from public.person_roles pr
                  where pr.person_id = p_person and pr.centre_id = p_centre and pr.role::text in ('pastor', 'director', 'admin', 'coach', 'care_lead')) then
    update public.messages
       set status = 'skipped', error = 'The role was removed before this was sent'
     where person_id = p_person and status = 'queued' and params ->> 'notice_group' = 'digest';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Digests: one email a day or a week with everything waiting, and a part for each role the person holds
-- ---------------------------------------------------------------------------

create function public.notice_digest(p_person uuid, p_now timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_day date := public.notice_day(p_now);
  v_monday boolean := public.notice_isodow(p_now) = 1;
  v_live bigint[] := '{}';
  v_rehearse bigint[] := '{}';
  v_drop bigint[] := '{}';
  v_ids bigint[];
  v_sections jsonb;
  v_total integer;
  v_shown integer;
  v_weekly boolean;
  v_msg uuid;
  v_result uuid;
  v_key text;
  i record;
  v_params jsonb;
begin
  select p.centre_id into v_centre from public.people p where p.id = p_person;
  if v_centre is null or public.notice_is_owner(p_person) then
    return null;
  end if;

  for i in
    select n.id, n.group_key, coalesce(f.delivery, 'daily') as pref
      from public.notice_items n
      left join public.notice_prefs f on f.person_id = n.person_id and f.group_key = n.group_key
     where n.person_id = p_person and n.sent_at is null and n.delivery = 'digest'
     order by n.id
  loop
    if i.pref = 'weekly' and not v_monday then
      continue;
    end if;
    if not exists (select 1 from public.person_roles pr
                    where pr.person_id = p_person and pr.centre_id = v_centre and pr.role::text = any (public.notice_group_roles(i.group_key))) then
      v_drop := v_drop || i.id;
    elsif public.notice_mode(i.group_key) = 'on' then
      v_live := v_live || i.id;
      v_weekly := coalesce(v_weekly, false) or i.pref = 'weekly';
    elsif public.notice_mode(i.group_key) = 'rehearsal' then
      v_rehearse := v_rehearse || i.id;
    else
      v_drop := v_drop || i.id;
    end if;
  end loop;

  update public.notice_items set sent_at = now(), note = 'role removed or switched off' where id = any (v_drop);

  -- Live and rehearsal digests are built the same way; the rehearsal one is only written to the log.
  for i in select 1 as pass union all select 2 loop
    v_ids := case i.pass when 1 then v_live else v_rehearse end;
    if coalesce(cardinality(v_ids), 0) = 0 then
      continue;
    end if;
    v_key := case i.pass when 1 then 'digest:' else 'digest-rehearsal:' end || p_person || ':' || to_char(v_day, 'YYYYMMDD');
    if exists (select 1 from public.messages m where m.dedupe_key = v_key) then
      continue;
    end if;
    select count(*)::integer into v_total from public.notice_items n where n.id = any (v_ids);
    -- Urgent first, then the oldest, at most 25 lines in all (the message has room for no more).
    with ranked as (
      select n.group_key, n.label, n.path, extract(day from p_now - n.created_at)::integer as age,
             row_number() over (order by (n.kind in ('pastor_referee_concern', 'admin_data_request_due', 'admin_queue_stuck')) desc, n.created_at, n.id) as rn
        from public.notice_items n where n.id = any (v_ids)),
    shown as (select * from ranked where rn <= 25)
    select jsonb_agg(jsonb_build_object(
             'group', g.group_key,
             'title', case g.group_key when 'admin' then 'Admin' when 'pastors' then 'Pastor' when 'directors' then 'Director'
                                       when 'care' then 'Care' when 'coaches' then 'Coach' else g.group_key end,
             'items', g.items) order by g.ord),
           coalesce(sum(jsonb_array_length(g.items)), 0)::integer
      into v_sections, v_shown
      from (
        select s.group_key,
               case s.group_key when 'admin' then 1 when 'pastors' then 2 when 'directors' then 3 when 'care' then 4 when 'coaches' then 5 else 9 end as ord,
               jsonb_agg(jsonb_build_object('label', s.label, 'path', s.path, 'age', s.age) order by s.rn) as items
          from shown s group by s.group_key) g;
    v_params := jsonb_build_object('sections', v_sections, 'total', v_total, 'more', greatest(v_total - v_shown, 0),
                                   'period', case when coalesce(v_weekly, false) then 'weekly' else 'daily' end,
                                   'notice_group', 'digest', 'notice_kind', 'staff_digest');
    if i.pass = 1 then
      v_msg := public.enqueue_message(p_person, 'staff_digest', v_params, null, v_key, null, 'normal', 'email');
    else
      insert into public.messages (centre_id, person_id, template, params, force_channel, dedupe_key, status, channel, error)
      values (v_centre, p_person, 'staff_digest', v_params, 'email', v_key, 'skipped', 'email', 'Rehearsal: written to the log, not sent')
      on conflict (dedupe_key) do nothing
      returning id into v_msg;
    end if;
    if v_msg is not null then
      update public.notice_items set sent_at = now(), message_id = v_msg where id = any (v_ids);
      v_result := coalesce(v_result, v_msg);
    end if;
  end loop;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- The numbers the checks use. Changed here, in one place, by a later migration.
-- ---------------------------------------------------------------------------

create table public.notice_numbers (
  key text primary key,
  value integer not null check (value between 1 and 365),
  note text not null
);
insert into public.notice_numbers (key, value, note) values
  ('waiting_threshold', 8, 'Members waiting with no leader before the directors and a community''s champions are told (the size at which a tribe is worth starting)'),
  ('decision_days', 7, 'Days an application can wait for a decision before the pastors are told again'),
  ('decision_escalate_days', 14, 'Days an application can wait before the directors see it'),
  ('card_days', 5, 'Days a Tribe Card can wait for approval before the pastors are told again'),
  ('card_escalate_days', 10, 'Days a Tribe Card can wait before the directors see it'),
  ('offer_days', 5, 'Days an offer to a leader can go unanswered before the directors are told'),
  ('referee_days', 5, 'Days a referee can take before the applicant is told'),
  ('academy_days', 7, 'Days a leader in training can go without progress before they are reminded'),
  ('stalled_days', 14, 'Days a leader in training can go without progress before their coach is told'),
  ('still_days', 14, 'Days an application can stay at one stage before the applicant is reassured'),
  ('asks_days', 2, 'Days a request for a person to reach out can wait before the care team is told');
alter table public.notice_numbers enable row level security;

create function public.notice_number(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select n.value from public.notice_numbers n where n.key = p_key), 7) $$;

-- How many of the nine launch steps are still open for a season. The same nine facts as launch_checklist(), which needs a signed-in person.
create function public.notice_launch_left(p_centre uuid, p_season uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_left integer := 0;
  v_tribes integer;
  v_covered integer;
  v_last timestamptz;
  v_tokens integer;
begin
  if not exists (select 1 from public.seasons s where s.id = p_season) then
    return 1;
  end if;
  if exists (select 1 from unnest(array['pastor', 'care_lead', 'data_lead', 'coach']) r
              where not exists (select 1 from public.person_roles pr where pr.centre_id = p_centre and pr.role::text = r)) then
    v_left := v_left + 1;
  end if;
  if not (exists (select 1 from public.centre_settings x where x.centre_id = p_centre and x.key = 'vision')
          and exists (select 1 from public.centre_settings x where x.centre_id = p_centre and x.key = 'mission')) then
    v_left := v_left + 1;
  end if;
  if (select count(*) from public.week_guides where reviewed_at is not null) < 12 then
    v_left := v_left + 1;
  end if;
  if not exists (select 1 from public.tribes c where c.season_id = p_season and c.status = 'approved') then
    v_left := v_left + 1;
  end if;
  select count(*), max(last_used_at) into v_tokens, v_last from public.worker_tokens where revoked_at is null;
  if not (v_tokens > 0 and v_last is not null and v_last > now() - interval '2 days') then
    v_left := v_left + 1;
  end if;
  select count(*) into v_tribes from public.communities where active;
  select count(distinct c.community_id) into v_covered
    from public.community_champions c join public.communities t on t.id = c.community_id and t.active
    join public.people p on p.id = c.person_id and p.centre_id = p_centre;
  if not (v_tribes > 0 and v_covered >= v_tribes) then
    v_left := v_left + 1;
  end if;
  if not exists (select 1 from public.centre_settings x where x.centre_id = p_centre and x.key = 'testimony_form_url') then
    v_left := v_left + 1;
  end if;
  if (select c.refreshed_at from bi.config c) is null then
    v_left := v_left + 1;
  end if;
  return v_left;
end;
$$;

-- ---------------------------------------------------------------------------
-- The checks that run on the clock. Each takes the moment to check for (so a test can choose it), queues what is due, and returns how many
-- people it queued. The sweep runs each inside its own exception block, so one that fails never stops the others.
-- ---------------------------------------------------------------------------

-- Pastors: applications that have waited too long for a decision, and (to the directors) those that have waited much longer.
create function public.notice_chk_decisions(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_wk text := public.notice_week(p_now);
begin
  for r in
    select p.centre_id, count(*)::integer as c, max(extract(day from p_now - a.updated_at))::integer as oldest
      from public.leader_applications a join public.people p on p.id = a.person_id
     where a.status = 'interviewed' and a.updated_at < p_now - make_interval(days => public.notice_number('decision_days'))
     group by p.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['pastor'], 'pastor_decision_overdue', 'decisions-overdue:' || v_wk,
      jsonb_build_object('count', r.c, 'days', r.oldest),
      r.c || case when r.c = 1 then ' application has' else ' applications have' end || ' waited over ' || public.notice_number('decision_days') || ' days for a decision', '/review');
  end loop;
  for r in
    select p.centre_id, count(*)::integer as c, max(extract(day from p_now - a.updated_at))::integer as oldest
      from public.leader_applications a join public.people p on p.id = a.person_id
     where a.status = 'interviewed' and a.updated_at < p_now - make_interval(days => public.notice_number('decision_escalate_days'))
     group by p.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'staff_escalation', 'esc-decisions:' || v_wk,
      jsonb_build_object('what', 'applications waiting for a pastor''s decision', 'count', r.c, 'days', r.oldest),
      r.c || ' applications have waited over ' || public.notice_number('decision_escalate_days') || ' days for a pastor', '/review');
  end loop;
  return n;
end;
$$;

create function public.notice_chk_cards(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_wk text := public.notice_week(p_now);
begin
  for r in
    select lp.centre_id, count(*)::integer as c, max(extract(day from p_now - t.submitted_at))::integer as oldest
      from public.tribes t join public.people lp on lp.id = t.leader_id
     where t.status = 'submitted' and t.submitted_at < p_now - make_interval(days => public.notice_number('card_days'))
     group by lp.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['pastor'], 'pastor_card_overdue', 'cards-overdue:' || v_wk,
      jsonb_build_object('count', r.c, 'days', r.oldest),
      r.c || case when r.c = 1 then ' Tribe Card has' else ' Tribe Cards have' end || ' waited over ' || public.notice_number('card_days') || ' days', '/review/cards');
  end loop;
  for r in
    select lp.centre_id, count(*)::integer as c, max(extract(day from p_now - t.submitted_at))::integer as oldest
      from public.tribes t join public.people lp on lp.id = t.leader_id
     where t.status = 'submitted' and t.submitted_at < p_now - make_interval(days => public.notice_number('card_escalate_days'))
     group by lp.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'staff_escalation', 'esc-cards:' || v_wk,
      jsonb_build_object('what', 'Tribe Cards waiting for a pastor''s approval', 'count', r.c, 'days', r.oldest),
      r.c || ' Tribe Cards have waited over ' || public.notice_number('card_escalate_days') || ' days', '/review/cards');
  end loop;
  return n;
end;
$$;

-- Pastors on Monday: ready-made cards still to sign off.
create function public.notice_chk_templates(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_count integer;
  v_comms integer;
begin
  select count(*)::integer, count(distinct t.community_id)::integer into v_count, v_comms
    from public.tribe_card_templates t where t.status = 'draft';
  if v_count = 0 then
    return 0;
  end if;
  for r in select c.id from public.centres c where c.active loop
    n := n + public.notify_role(r.id, array['pastor'], 'pastor_templates_waiting', 'templates-waiting:' || public.notice_week(p_now),
      jsonb_build_object('count', v_count, 'communities', v_comms),
      v_count || ' ready-made cards wait for sign-off', '/review/templates');
  end loop;
  return n;
end;
$$;

-- Pastors: the season ends in 14 days; decisions on the next one.
create function public.notice_chk_season_review(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select s.id, s.name, s.centre_id, s.ends_on from public.seasons s
            where s.status in ('open', 'running') and s.ends_on = public.notice_day(p_now) + 14 loop
    n := n + public.notify_role(r.centre_id, array['pastor'], 'pastor_season_review', 'season-review:' || r.id,
      jsonb_build_object('season', r.name, 'ends_on', r.ends_on),
      'Season ' || r.name || ' ends in 14 days: decisions on the next one', '/growth/multiply');
  end loop;
  return n;
end;
$$;

-- Directors at 6 pm: tomorrow's interviews.
create function public.notice_chk_interviews_tomorrow(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_tomorrow date := public.notice_day(p_now) + 1;
begin
  for r in
    select p.centre_id, count(*)::integer as c
      from public.interview_slots s
      join public.leader_applications a on a.id = s.application_id
      join public.people p on p.id = a.person_id
     where public.notice_day(s.starts_at) = v_tomorrow
     group by p.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'director_interviews_tomorrow', 'interviews-tomorrow:' || v_tomorrow,
      jsonb_build_object('count', r.c, 'on', v_tomorrow),
      'Tomorrow: ' || r.c || case when r.c = 1 then ' interview' else ' interviews' end, '/review/interviews');
  end loop;
  return n;
end;
$$;

-- Directors (and whoever set the slot up): an interview ended two hours ago and nothing is recorded.
create function public.notice_chk_interview_outcome(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select s.id, s.created_by, p.centre_id, public.first_name_of(a.person_id) as first_name, s.starts_at
      from public.interview_slots s
      join public.leader_applications a on a.id = s.application_id
      join public.people p on p.id = a.person_id
     where a.status = 'interview_booked'
       and s.starts_at + make_interval(mins => s.minutes) + interval '2 hours' <= p_now
       and s.starts_at > p_now - interval '3 days'
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'director_interview_no_outcome', 'slot-outcome:' || r.id,
      jsonb_build_object('first_name', r.first_name, 'starts_at', r.starts_at),
      r.first_name || '''s interview has no outcome recorded', '/review/interviews');
    if r.created_by is not null and public.notify_named(r.created_by, 'pastor', 'director_interview_no_outcome', 'slot-outcome:' || r.id,
         jsonb_build_object('first_name', r.first_name, 'starts_at', r.starts_at),
         r.first_name || '''s interview has no outcome recorded', '/review/interviews') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Directors: more applicants invited to interview than there are open times.
create function public.notice_chk_slots_low(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.centre_id, count(*)::integer as invited
      from public.leader_applications a join public.people p on p.id = a.person_id
     where a.status = 'interview_invited'
     group by p.centre_id
  loop
    declare
      v_open integer := (select count(*)::integer from public.interview_slots s where s.application_id is null and s.starts_at > p_now);
    begin
      if r.invited > v_open then
        n := n + public.notify_role(r.centre_id, array['director'], 'director_slots_low', 'slots-low:' || public.notice_day(p_now),
          jsonb_build_object('open', v_open, 'invited', r.invited),
          'Only ' || v_open || ' interview times left for ' || r.invited || ' invited applicants', '/review/interviews');
      end if;
    end;
  end loop;
  return n;
end;
$$;

create function public.notice_chk_offers(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select o.id, p.centre_id, public.first_name_of(o.person_id) as first_name, g.title as goal
      from public.leader_offers o
      join public.people p on p.id = o.person_id
      join public.season_goals g on g.id = o.goal_id
     where o.status = 'offered' and o.expires_at > p_now
       and o.offered_at < p_now - make_interval(days => public.notice_number('offer_days'))
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'director_offer_unanswered', 'offer-open:' || r.id,
      jsonb_build_object('leader_first', r.first_name, 'goal', r.goal, 'days', public.notice_number('offer_days')),
      'An offer to ' || r.first_name || ' has had no answer for ' || public.notice_number('offer_days') || ' days', '/admin/leader-supply');
  end loop;
  return n;
end;
$$;

-- Directors on Monday: members waiting where no leader is ready; and members who finished the form a week ago and have no tribe.
create function public.notice_chk_demand(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_season uuid := public.leader_fit_season();
  v_goals integer;
  v_waiting integer;
  v_top text;
begin
  if v_season is null then
    return 0;
  end if;
  select count(*)::integer, coalesce(sum(d.waiting), 0)::integer into v_goals, v_waiting
    from public.goal_demand_rows(v_season) d
   where d.waiting >= public.notice_number('waiting_threshold') and d.seats_open = 0;
  if v_goals = 0 then
    return 0;
  end if;
  select g.title into v_top
    from public.goal_demand_rows(v_season) d join public.season_goals g on g.id = d.goal_id
   where d.waiting >= public.notice_number('waiting_threshold') and d.seats_open = 0
   order by d.waiting desc, g.title limit 1;
  for r in select c.id from public.centres c where c.active loop
    n := n + public.notify_role(r.id, array['director'], 'director_demand_gap', 'demand-gap:' || public.notice_week(p_now),
      jsonb_build_object('count', v_waiting, 'goals', v_goals, 'goal', v_top),
      v_waiting || ' members are waiting for a tribe with no leader', '/admin/leader-supply');
  end loop;
  return n;
end;
$$;

create function public.notice_chk_unplaced(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.centre_id, count(*)::integer as c
      from public.member_profiles mp join public.people p on p.id = mp.person_id
     where mp.submitted_at <= p_now - interval '7 days'
       and not exists (select 1 from public.tribe_members m where m.person_id = mp.person_id and m.status = 'active')
       and not p.hidden
     group by p.centre_id
  loop
    n := n + public.notify_role(r.centre_id, array['director'], 'director_unplaced', 'unplaced:' || public.notice_week(p_now),
      jsonb_build_object('count', r.c),
      r.c || ' members finished the form a week ago and have no tribe', '/dashboard');
  end loop;
  return n;
end;
$$;

-- Directors 14, 7 and 2 days before a season opens; admins every day in the last 14. Only while launch steps are left.
create function public.notice_chk_countdown(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_left integer;
  v_days integer;
begin
  for r in select s.id, s.name, s.centre_id, s.starts_on from public.seasons s
            where s.status = 'planning' and s.starts_on between public.notice_day(p_now) and public.notice_day(p_now) + 14 loop
    v_days := r.starts_on - public.notice_day(p_now);
    v_left := public.notice_launch_left(r.centre_id, r.id);
    continue when v_left = 0;
    if v_days in (14, 7, 2) then
      n := n + public.notify_role(r.centre_id, array['director'], 'director_season_countdown', 'countdown:' || r.id || ':' || v_days,
        jsonb_build_object('season', r.name, 'days', v_days, 'left', v_left),
        'Season ' || r.name || ' opens in ' || v_days || ' days: ' || v_left || ' launch steps left', '/admin');
    end if;
    n := n + public.notify_role(r.centre_id, array['admin'], 'admin_checklist_overdue', 'checklist:' || r.id || ':' || public.notice_day(p_now),
      jsonb_build_object('season', r.name, 'days', v_days, 'left', v_left),
      v_left || case when v_left = 1 then ' launch step is' else ' launch steps are' end || ' still open', '/admin');
  end loop;
  return n;
end;
$$;

-- Admins: a deletion request is close to its 30-day deadline.
create function public.notice_chk_erasure_due(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_age integer;
begin
  for r in select e.person_id, e.centre_id, e.requested_at from public.erasure_requests e where e.status = 'open' loop
    v_age := public.notice_day(p_now) - public.notice_day(r.requested_at);
    if v_age >= 23 then
      n := n + public.notify_role(r.centre_id, array['admin'], 'admin_data_request_due', 'erasure-due:' || r.person_id || ':7',
        jsonb_build_object('days', greatest(30 - v_age, 0)),
        'A deletion request is due in ' || greatest(30 - v_age, 0) || ' days', '/admin/privacy', true, r.person_id);
    end if;
    if v_age >= 28 then
      n := n + public.notify_role(r.centre_id, array['admin', 'director'], 'admin_data_request_due', 'erasure-due:' || r.person_id || ':2',
        jsonb_build_object('days', greatest(30 - v_age, 0)),
        'A deletion request is due in ' || greatest(30 - v_age, 0) || ' days', '/admin/privacy', true, r.person_id);
    end if;
  end loop;
  return n;
end;
$$;

-- Admins: messages are failing, or are not going out at all.
create function public.notice_chk_sending(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_failed integer;
  v_total integer;
  v_stuck integer;
  v_bucket text := public.notice_day(p_now) || ':' || (public.notice_hour(p_now) / 6);
begin
  select count(*) filter (where m.status = 'failed'), count(*)
    into v_failed, v_total
    from public.messages m where m.claimed_at > p_now - interval '1 hour' and m.claimed_at <= p_now;
  select count(*) into v_stuck
    from public.messages m
   where ((m.status = 'queued' and m.scheduled_for < p_now - interval '60 minutes' and m.scheduled_for > p_now - interval '7 days')
       or (m.status = 'sending' and m.claimed_at < p_now - interval '30 minutes'))
     and public.notice_hour(p_now) between 8 and 21;
  for r in select c.id from public.centres c where c.active loop
    if v_failed >= 10 or (v_failed >= 3 and v_failed * 20 > v_total) then
      n := n + public.notify_role(r.id, array['admin'], 'admin_messages_failing', 'failing:' || v_bucket,
        jsonb_build_object('count', v_failed),
        v_failed || ' messages failed in the last hour', '/admin/messages');
    end if;
    if v_stuck > 0 then
      n := n + public.notify_role(r.id, array['admin'], 'admin_queue_stuck', 'stuck:' || public.notice_day(p_now) || ':' || (public.notice_hour(p_now) / 3),
        jsonb_build_object('count', v_stuck),
        'Messages are not going out', '/admin/system', true);
    end if;
  end loop;
  return n;
end;
$$;

-- Admins and the data lead: the reporting copy did not refresh.
create function public.notice_chk_reporting(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_at timestamptz;
begin
  select c.refreshed_at into v_at from bi.config c;
  if v_at is null or v_at >= p_now - interval '36 hours' or public.notice_hour(p_now) < 8 then
    return 0;
  end if;
  for r in select c.id from public.centres c where c.active loop
    n := n + public.notify_role(r.id, array['admin', 'data_lead'], 'admin_reporting_failed', 'reporting:' || public.notice_day(p_now),
      '{}'::jsonb, 'The reporting copy did not refresh last night', '/admin/system');
  end loop;
  return n;
end;
$$;

-- Admins and the data lead on Monday: how the week's email went.
create function public.notice_chk_email_week(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_sent integer;
  v_failed integer;
  v_unsub integer;
begin
  select count(*) filter (where m.status in ('sent', 'delivered', 'read') and m.channel = 'email'),
         count(*) filter (where m.status = 'failed')
    into v_sent, v_failed
    from public.messages m where m.created_at > p_now - interval '7 days';
  select count(*)::integer into v_unsub from public.consents c
   where c.purpose = 'email' and not c.granted and c.created_at > p_now - interval '7 days';
  if v_sent + v_failed + v_unsub = 0 then
    return 0;
  end if;
  for r in select c.id from public.centres c where c.active loop
    n := n + public.notify_role(r.id, array['admin', 'data_lead'], 'admin_email_health', 'email-week:' || public.notice_week(p_now),
      jsonb_build_object('sent', v_sent, 'failed', v_failed, 'unsubscribed', v_unsub),
      'This week''s email: ' || v_sent || ' sent, ' || v_failed || ' failed, ' || v_unsub || ' unsubscribed', '/admin/messages');
  end loop;
  return n;
end;
$$;

-- Coaches: a leader has not moved in the Academy. The leader gets a reminder sooner.
create function public.notice_chk_academy(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_wk text := public.notice_week(p_now);
  v_step text;
begin
  if public.leader_academy_modes() ->> 'academy' = 'off' then
    return 0;
  end if;
  for r in
    select pr.person_id, max(pr.granted_at) as since,
           greatest(max(pr.granted_at),
                    (select max(greatest(g.opened_at, coalesce(g.passed_at, g.opened_at))) from public.academy_progress g where g.person_id = pr.person_id)) as last_move
      from public.person_roles pr
     where pr.role in ('leader', 'assistant_leader')
       and not exists (select 1 from public.leader_certifications c where c.person_id = pr.person_id)
       and not exists (select 1 from public.people x where x.id = pr.person_id and x.hidden)
     group by pr.person_id
  loop
    if r.last_move < p_now - make_interval(days => public.notice_number('academy_days')) then
      select m.title into v_step
        from public.academy_modules m
       where m.active and not exists (select 1 from public.academy_progress g where g.person_id = r.person_id and g.module_id = m.id and g.passed_at is not null)
       order by m.number limit 1;
      v_step := coalesce(v_step, 'the practice session');
      if public.notify_person(r.person_id, 'leaders', 'leader_academy_next', 'academy-next:' || r.person_id || ':' || v_wk,
           jsonb_build_object('step', v_step), 'Your next Academy step: ' || v_step, '/lead/academy') is not null then
        n := n + 1;
      end if;
    end if;
    if r.last_move < p_now - make_interval(days => public.notice_number('stalled_days')) then
      declare
        v_coach uuid := (select t.coach_id from public.tribes t
                          where (t.leader_id = r.person_id or t.assistant_id = r.person_id) and t.status <> 'closed' and t.coach_id is not null limit 1);
      begin
        if public.notify_named(v_coach, 'coach', 'coach_leader_stalled', 'stalled:' || r.person_id || ':' || v_wk,
             jsonb_build_object('leader_first', public.first_name_of(r.person_id), 'days', public.notice_number('stalled_days')),
             public.first_name_of(r.person_id) || ' has not moved in the Academy for ' || public.notice_number('stalled_days') || ' days', '/review/academy') is not null then
          n := n + 1;
        end if;
      end;
    end if;
  end loop;
  return n;
end;
$$;

-- The care team: referee call-backs due this week (Monday), and people who asked for someone to reach out and have waited (daily).
create function public.notice_chk_care(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_due integer;
begin
  select count(*)::integer into v_due from public.referee_callbacks c
   where c.status = 'open' and c.due_on <= public.notice_day(p_now) + 7;
  if v_due > 0 and public.notice_isodow(p_now) = 1 then
    for r in select c.id from public.centres c where c.active loop
      n := n + public.notify_care(r.id, 'care_callbacks_due', 'callbacks-due:' || public.notice_week(p_now),
        jsonb_build_object('count', v_due), v_due || ' referee call-backs are due this week', '/care/referees');
    end loop;
  end if;
  for r in
    select p.centre_id, count(*)::integer as c
      from public.journey_requests q join public.people p on p.id = q.person_id
     where q.status = 'open' and q.kind <> 'not_season'
       and q.created_at < p_now - make_interval(days => public.notice_number('asks_days'))
     group by p.centre_id
  loop
    n := n + public.notify_care(r.centre_id, 'care_asks_waiting', 'asks-waiting:' || public.notice_day(p_now),
      jsonb_build_object('count', r.c), r.c || case when r.c = 1 then ' person asked' else ' people asked' end || ' for someone to reach out', '/care/asks');
  end loop;
  return n;
end;
$$;

-- Leaders: a booked workshop is tomorrow (6 pm), and next season's question (21 days before the season ends).
create function public.notice_chk_leaders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  if public.notice_hour(p_now) between 18 and 21 then
    for r in
      select s.id as session_id, s.kind::text as kind, s.starts_at, b.person_id
        from public.academy_sessions s join public.academy_bookings b on b.session_id = s.id
       where public.notice_day(s.starts_at) = public.notice_day(p_now) + 1 and b.attended is null
    loop
      if public.notify_person(r.person_id, 'leaders', 'leader_workshop_tomorrow', 'workshop:' || r.session_id || ':' || r.person_id,
           jsonb_build_object('workshop', case r.kind when 'commissioning_workshop' then 'the commissioning workshop' else 'the practice workshop' end, 'starts_at', r.starts_at),
           'Tomorrow: ' || case r.kind when 'commissioning_workshop' then 'the commissioning workshop' else 'the practice workshop' end, '/lead/academy') is not null then
        n := n + 1;
      end if;
    end loop;
  end if;
  if public.notice_hour(p_now) between 7 and 20 then
    for r in
      select t.id as tribe_id, t.name, x.person_id, s.name as season
        from public.seasons s
        join public.tribes t on t.season_id = s.id and t.status = 'approved'
        cross join lateral (values (t.leader_id), (t.assistant_id)) x(person_id)
       where s.status = 'running' and s.ends_on = public.notice_day(p_now) + 21 and x.person_id is not null
    loop
      if public.notify_person(r.person_id, 'leaders', 'leader_next_season', 'next-season:' || r.tribe_id || ':' || r.person_id,
           jsonb_build_object('season', r.season), 'Next season: continue, multiply or rest?', '/lead') is not null then
        n := n + 1;
      end if;
    end loop;
  end if;
  return n;
end;
$$;

-- Applicants: a referee has not answered (5 days), and the application has stayed at one stage (14 days).
create function public.notice_chk_applicants(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select f.id, a.person_id, split_part(f.referee_name, ' ', 1) as referee_first
      from public.leader_references f join public.leader_applications a on a.id = f.application_id
     where f.submitted_at is null and f.created_at < p_now - make_interval(days => public.notice_number('referee_days'))
       and f.token_expires_at > p_now
       and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
  loop
    if public.notify_person(r.person_id, 'applicants', 'applicant_referee_slow', 'referee-slow:' || r.id,
         jsonb_build_object('referee_first', r.referee_first), r.referee_first || ' has not answered yet', '/lead/apply') is not null then
      n := n + 1;
    end if;
  end loop;
  for r in
    select a.id, a.person_id, a.status::text as status
      from public.leader_applications a
     where a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
       and a.updated_at < p_now - make_interval(days => public.notice_number('still_days'))
  loop
    if public.notify_person(r.person_id, 'applicants', 'applicant_still_with_us', 'still:' || r.id || ':' || r.status,
         '{}'::jsonb, 'Your application is still with us', '/lead/apply') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Referees: a reminder 3 days and 1 day before their link stops working, if they have not answered. The reminder never holds the link
-- (only its fingerprint is kept); it points back to the first email.
create function public.notice_chk_referees(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_step integer;
begin
  for r in
    select f.id, f.contact, f.referee_name, f.token_expires_at, public.first_name_of(a.person_id) as applicant_first
      from public.leader_references f join public.leader_applications a on a.id = f.application_id
     where f.submitted_at is null and f.token_expires_at > p_now and f.token_expires_at <= p_now + interval '3 days'
       and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
       and f.contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       and not exists (select 1 from public.leader_reference_flags g where g.reference_id = f.id and g.kind = 'disowned' and g.cleared_at is null)
  loop
    v_step := case when r.token_expires_at <= p_now + interval '1 day' then 1 else 3 end;
    if public.notify_address(r.contact, r.referee_name, 'referees', 'referee_reminder', 'ref-remind:' || r.id || ':' || v_step,
         jsonb_build_object('applicant_first', r.applicant_first, 'expires_at', r.token_expires_at, 'days', v_step)) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Community champions: their community's month (the 1st), and members waiting there (Monday).
create function public.notice_chk_champions(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_monday boolean := public.notice_isodow(p_now) = 1;
  v_first boolean := extract(day from public.notice_day(p_now)) = 1;
  v_month text := to_char(public.notice_day(p_now), 'YYYYMM');
begin
  for r in
    select ch.person_id, c.id as community_id, c.name,
           (select count(*)::integer from public.tribes t where t.community_id = c.id and t.status = 'approved') as tribes,
           (select count(distinct m.person_id)::integer from public.tribe_members m join public.tribes t on t.id = m.tribe_id
             where t.community_id = c.id and m.status = 'active') as members,
           (select count(*)::integer from public.member_profiles mp
             where mp.community_id = c.id
               and not exists (select 1 from public.tribe_members m where m.person_id = mp.person_id and m.status = 'active')) as waiting
      from public.community_champions ch join public.communities c on c.id = ch.community_id and c.active
  loop
    if v_first then
      if public.notify_named(r.person_id, 'community_champion', 'champion_month', 'champion-month:' || r.community_id || ':' || v_month,
           jsonb_build_object('community', r.name, 'tribes', r.tribes, 'members', r.members, 'waiting', r.waiting),
           r.name || ' this month', '/community') is not null then
        n := n + 1;
      end if;
    end if;
    if v_monday and r.waiting >= public.notice_number('waiting_threshold') then
      if public.notify_named(r.person_id, 'community_champion', 'champion_waiting', 'champion-waiting:' || r.community_id || ':' || public.notice_week(p_now),
           jsonb_build_object('community', r.name, 'count', r.waiting),
           r.waiting || ' people are waiting for a tribe in ' || r.name, '/community') is not null then
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

-- The data lead on Monday: integrity flags and held references of the week.
create function public.notice_chk_integrity(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_flags integer;
  v_holds integer;
begin
  select count(*)::integer, count(*) filter (where g.severity = 'hold')::integer into v_flags, v_holds
    from public.leader_reference_flags g where g.created_at > p_now - interval '7 days';
  if v_flags = 0 then
    return 0;
  end if;
  for r in select c.id from public.centres c where c.active loop
    n := n + public.notify_role(r.id, array['data_lead'], 'data_integrity_week', 'integrity:' || public.notice_week(p_now),
      jsonb_build_object('flags', v_flags, 'holds', v_holds),
      v_flags || ' integrity flags and ' || v_holds || ' held references this week', '/admin/referees');
  end loop;
  return n;
end;
$$;

-- Members: a meeting that changed and then stayed quiet for a while. The wording is read from the tribe as it is now.
create function public.notice_chk_meetings(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  m record;
  n integer := 0;
  v_state text;
begin
  for r in select x.ref, x.before from public.notice_pending x where x.kind = 'meeting_changed' and x.due_at <= p_now loop
    delete from public.notice_pending where kind = 'meeting_changed' and ref = r.ref;
    for m in
      select t.id, t.name, t.meeting_day, t.meeting_time, t.meeting_mode, t.place_note, t.meeting_link
        from public.tribes t where t.id::text = r.ref and t.status = 'approved'
    loop
      v_state := md5(concat_ws('|', m.meeting_day, m.meeting_time, m.meeting_mode, m.place_note, m.meeting_link));
      -- Put back the way it was: nothing to announce.
      continue when v_state = r.before;
      declare
        q record;
      begin
        for q in select tm.person_id from public.tribe_members tm where tm.tribe_id = m.id and tm.status = 'active' loop
          if public.notify_person(q.person_id, 'members', 'member_meeting_changed', 'meeting:' || m.id || ':' || v_state,
               jsonb_build_object('tribe', m.name, 'meeting_day', m.meeting_day, 'meeting_time', m.meeting_time, 'mode', m.meeting_mode,
                                  'place_note', m.place_note, 'meeting_link', m.meeting_link),
               m.name || ' now meets at a new time', '/tribe') is not null then
            n := n + 1;
          end if;
        end loop;
      end;
    end loop;
  end loop;
  return n;
end;
$$;

-- After a deletion is complete, the address the last email went to is overwritten, so nothing about the person is kept.
create function public.notice_chk_scrub(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.messages
     set to_email = 'erased@erased.invalid', to_name = null, params = '{"erased": true}'::jsonb
   where template = 'member_deletion_done' and person_id is null
     and status in ('sent', 'delivered', 'read', 'failed', 'skipped')
     and to_email is distinct from 'erased@erased.invalid';
  get diagnostics n = row_count;
  return 0 * n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The sweep: the heartbeat calls this every few minutes. It runs the checks that are due, then builds the digests.
-- ---------------------------------------------------------------------------

create function public.notice_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  p record;
  n integer;
  v_queued integer := 0;
  v_digests integer := 0;
  v_problems text[] := '{}';
  v_hour integer := public.notice_hour(p_now);
  v_dow integer := public.notice_isodow(p_now);
  v_day boolean := public.notice_hour(p_now) between 7 and 20;
begin
  for c in
    select * from (values
      ('notice_chk_meetings', 'open'), ('notice_chk_interview_outcome', 'open'), ('notice_chk_sending', 'open'),
      ('notice_chk_decisions', 'daily'), ('notice_chk_cards', 'daily'), ('notice_chk_season_review', 'daily'),
      ('notice_chk_slots_low', 'daily'), ('notice_chk_offers', 'daily'), ('notice_chk_countdown', 'daily'),
      ('notice_chk_erasure_due', 'daily'), ('notice_chk_reporting', 'daily'), ('notice_chk_care', 'daily'),
      ('notice_chk_applicants', 'daily'), ('notice_chk_referees', 'daily'), ('notice_chk_academy', 'daily'),
      ('notice_chk_templates', 'monday'), ('notice_chk_demand', 'monday'), ('notice_chk_unplaced', 'monday'),
      ('notice_chk_email_week', 'monday'), ('notice_chk_integrity', 'monday'),
      ('notice_chk_champions', 'daily'),
      ('notice_chk_interviews_tomorrow', 'evening'), ('notice_chk_leaders', 'evening')
    ) as t(name, gate)
  loop
    if not (case c.gate
              when 'open' then v_hour between 7 and 21
              when 'daily' then v_day
              when 'monday' then v_day and v_dow = 1
              when 'evening' then v_hour between 17 and 21
              else false end) then
      continue;
    end if;
    begin
      execute format('select public.%I($1)', c.name) into n using p_now;
      v_queued := v_queued + coalesce(n, 0);
    exception when others then
      v_problems := v_problems || ('notices: ' || c.name || ' could not run');
      perform public.notice_fault(c.name, sqlerrm);
    end;
  end loop;

  if v_day then
    for p in select distinct i.person_id from public.notice_items i where i.sent_at is null and i.delivery = 'digest' loop
      begin
        if public.notice_digest(p.person_id, p_now) is not null then
          v_digests := v_digests + 1;
        end if;
      exception when others then
        v_problems := v_problems || 'notices: a digest could not be built';
        perform public.notice_fault('digest', sqlerrm);
      end;
    end loop;
  end if;

  begin
    perform public.notice_chk_scrub(p_now);
  exception when others then
    v_problems := v_problems || 'notices: clean-up could not run';
    perform public.notice_fault('scrub', sqlerrm);
  end;
  return jsonb_build_object('queued', v_queued, 'digests', v_digests, 'problems', to_jsonb(v_problems));
end;
$$;

-- The heartbeat's door. It needs the sending token, like the rest of the sending service.
create function public.worker_notice_sweep(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.notice_sweep(now());
end;
$$;

-- ---------------------------------------------------------------------------
-- What the Admin pages read
-- ---------------------------------------------------------------------------

-- One row of "Needs attention": null when there is nothing waiting, or when none of the roles that own the row is held by the caller.
create function public.notice_row(
  p_key text,
  p_one text,
  p_many text,
  p_owners text[],
  p_mine text[],
  p_count integer,
  p_oldest integer,
  p_urgent boolean,
  p_href text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_count, 0) <= 0 or not (p_owners && p_mine) then null
    else jsonb_build_object(
      'key', p_key, 'one', p_one, 'many', p_many,
      -- The roles the caller holds that this work belongs to, in the order Admin lists roles
      'roles', (select coalesce(jsonb_agg(r order by array_position(array['admin', 'pastor', 'director', 'data_lead', 'care_lead', 'coach'], r)), '[]'::jsonb)
                  from unnest(p_owners) r where r = any (p_mine)),
      'count', p_count, 'oldest_days', coalesce(p_oldest, 0), 'urgent', coalesce(p_urgent, false), 'href', p_href)
  end
$$;

-- What is waiting for the person signed in, built from all the roles they hold. Someone who is both an admin and a pastor gets one list: the
-- work of both roles, each kind of work once, with the roles it belongs to, and the most urgent first.
create function public.admin_attention()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_centre uuid := public.my_centre();
  v_today date := public.today_lagos();
  v_mine text[];
  v_rows jsonb;
  v_arr jsonb[] := '{}';
  v_waiting integer := public.notice_number('waiting_threshold');
  v_season uuid := public.leader_fit_season();
  c integer;
  o integer;
  u boolean;
  s public.seasons%rowtype;
  v_coming jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_off integer := 0;
  g text;
  v_holders integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  select coalesce(array_agg(r::text), '{}') into v_mine from unnest(public.my_roles()) r;

  -- Deletion requests (admins and directors)
  select count(*), max(v_today - public.notice_day(e.requested_at)), coalesce(bool_or(v_today - public.notice_day(e.requested_at) >= 23), false)
    into c, o, u from public.erasure_requests e where e.status = 'open' and e.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('data_requests', 'deletion request', 'deletion requests', array['admin', 'director'], v_mine, c, o, u, '/admin/privacy');

  -- Failed messages (admins, directors, the data lead)
  select count(*), max(extract(day from now() - m.created_at))::integer into c, o
    from public.messages m where m.status = 'failed' and m.centre_id = v_centre and m.created_at > now() - interval '24 hours';
  v_arr := v_arr || public.notice_row('failed_messages', 'message failed in the last day', 'messages failed in the last day', array['admin', 'director', 'data_lead'], v_mine, c, o, false, '/admin/messages');

  -- Reminder journeys that paused themselves
  select count(*), max(extract(day from now() - j.paused_at))::integer into c, o from public.journeys j where j.paused_at is not null;
  v_arr := v_arr || public.notice_row('paused_journeys', 'reminder journey paused', 'reminder journeys paused', array['admin', 'director', 'pastor', 'data_lead'], v_mine, c, o, false, '/admin/reminders');

  -- Launch steps left, from 30 days before a season opens
  select * into s from public.seasons x where x.centre_id = v_centre and x.status in ('planning', 'open') and x.starts_on >= v_today order by x.starts_on limit 1;
  if found and s.starts_on - v_today <= 30 then
    c := public.notice_launch_left(v_centre, s.id);
    v_arr := v_arr || public.notice_row('launch_steps', 'launch step left before ' || s.name || ' opens', 'launch steps left before ' || s.name || ' opens',
      array['admin', 'director', 'pastor', 'data_lead'], v_mine, c, 0, s.starts_on - v_today <= 7, '/admin/seasons');
  end if;

  -- Applications waiting for a pastor's decision, and concerns a referee raised
  select count(*), max(extract(day from now() - a.updated_at))::integer into c, o
    from public.leader_applications a join public.people p on p.id = a.person_id
   where a.status = 'interviewed' and p.centre_id = v_centre and a.person_id <> uid;
  v_arr := v_arr || public.notice_row('decisions', 'application waiting for a decision', 'applications waiting for a decision', array['pastor'], v_mine, c, o, false, '/review');
  select count(*), max(extract(day from now() - a.updated_at))::integer into c, o
    from public.leader_reference_answers ra
    join public.leader_references r on r.id = ra.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where ra.concern and ra.concern_cleared_at is null and p.centre_id = v_centre and a.person_id <> uid
     and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed');
  v_arr := v_arr || public.notice_row('referee_concerns', 'concern raised by a referee', 'concerns raised by referees', array['pastor'], v_mine, c, o, true, '/review');

  -- Tribe Cards, held references and ready-made cards
  select count(*), max(extract(day from now() - t.submitted_at))::integer into c, o
    from public.tribes t join public.people lp on lp.id = t.leader_id where t.status = 'submitted' and lp.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('cards', 'Tribe Card waiting for approval', 'Tribe Cards waiting for approval', array['pastor', 'director'], v_mine, c, o, false, '/review/cards');
  select count(*), max(extract(day from now() - g2.created_at))::integer into c, o
    from public.leader_reference_flags g2
    join public.leader_references r on r.id = g2.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where g2.severity = 'hold' and g2.cleared_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('held_references', 'reference held for a look', 'references held for a look', array['pastor', 'director'], v_mine, c, o, false, '/admin/referees');
  select count(*) into c from public.tribe_card_templates t where t.status = 'draft';
  v_arr := v_arr || public.notice_row('ready_made', 'ready-made card to sign off', 'ready-made cards to sign off', array['pastor', 'director'], v_mine, c, 0, false, '/review/templates');

  -- Interviews that ended without an outcome, offers with no answer, goals with members and no leader
  select count(*), max(extract(day from now() - s2.starts_at))::integer into c, o
    from public.interview_slots s2
    join public.leader_applications a on a.id = s2.application_id
    join public.people p on p.id = a.person_id
   where a.status = 'interview_booked' and p.centre_id = v_centre
     and s2.starts_at + make_interval(mins => s2.minutes) < now();
  v_arr := v_arr || public.notice_row('interviews_no_outcome', 'interview without an outcome', 'interviews without an outcome', array['director', 'pastor'], v_mine, c, o, false, '/review/interviews');
  select count(*), max(extract(day from now() - f.offered_at))::integer into c, o
    from public.leader_offers f join public.people p on p.id = f.person_id
   where f.status = 'offered' and f.expires_at > now() and p.centre_id = v_centre
     and f.offered_at < now() - make_interval(days => public.notice_number('offer_days'));
  v_arr := v_arr || public.notice_row('offers_unanswered', 'offer with no answer', 'offers with no answer', array['director', 'pastor', 'admin'], v_mine, c, o, false, '/admin/leader-supply');
  c := 0;
  if v_season is not null then
    select count(*) into c from public.goal_demand_rows(v_season) d where d.waiting >= v_waiting and d.seats_open = 0;
  end if;
  v_arr := v_arr || public.notice_row('leaders_needed', 'goal with members waiting and no leader', 'goals with members waiting and no leader',
    array['director', 'admin', 'pastor', 'data_lead'], v_mine, c, 0, false, '/admin/leader-supply');

  -- The reporting copy and the integrity flags (the data lead)
  select case when c2.refreshed_at is not null and c2.refreshed_at < now() - interval '36 hours' then 1 else 0 end,
         extract(day from now() - c2.refreshed_at)::integer into c, o from bi.config c2;
  v_arr := v_arr || public.notice_row('reporting_copy', 'reporting copy has not refreshed', 'reporting copy has not refreshed', array['data_lead', 'admin'], v_mine, c, o, false, '/admin/system');
  select count(*), max(extract(day from now() - g2.created_at))::integer into c, o
    from public.leader_reference_flags g2
    join public.leader_references r on r.id = g2.reference_id
    join public.leader_applications a on a.id = r.application_id
    join public.people p on p.id = a.person_id
   where g2.cleared_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('integrity_flags', 'integrity flag open', 'integrity flags open', array['data_lead'], v_mine, c, o, false, '/admin/referees');

  -- People who asked for someone to reach out, tribe changes, parents' permissions to confirm, announcements waiting for a second person
  select count(*), max(extract(day from now() - q.created_at))::integer into c, o
    from public.journey_requests q join public.people p on p.id = q.person_id
   where q.status = 'open' and q.kind <> 'not_season' and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('asks', 'person asked for someone to reach out', 'people asked for someone to reach out', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/care/asks');
  select count(*), max(extract(day from now() - w.created_at))::integer into c, o
    from public.swap_requests w join public.people p on p.id = w.person_id where w.status = 'requested' and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('swaps', 'request to change tribe', 'requests to change tribe', array['admin', 'director'], v_mine, c, o, false, '/growth/swaps');
  select count(*), max(extract(day from now() - gc.requested_at))::integer into c, o
    from public.guardian_consents gc join public.people p on p.id = gc.person_id
   where gc.status = 'approved' and gc.verified_at is null and p.centre_id = v_centre;
  v_arr := v_arr || public.notice_row('teens', 'parent''s permission waiting for its call', 'parents'' permissions waiting for their call', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/care/teens');
  select count(*), max(extract(day from now() - b.updated_at))::integer into c, o
    from public.broadcasts b where b.status = 'awaiting_approval' and b.centre_id = v_centre and b.created_by is distinct from uid;
  v_arr := v_arr || public.notice_row('approvals', 'announcement waiting for your approval', 'announcements waiting for your approval', array['admin', 'director', 'pastor'], v_mine, c, o, false, '/admin/announcements/approvals');

  select coalesce(jsonb_agg(x order by (x ->> 'urgent')::boolean desc, (x ->> 'oldest_days')::integer desc, (x ->> 'count')::integer desc, x ->> 'key'), '[]'::jsonb)
    into v_rows from unnest(v_arr) x where x is not null;

  -- Coming up: the next three dates
  begin
    select jsonb_agg(z order by z ->> 'on') into v_coming from (
      select z from (
        select jsonb_build_object('label', x.name || ' opens', 'on', x.starts_on, 'href', '/admin/seasons') as z
          from public.seasons x where x.centre_id = v_centre and x.status in ('planning', 'open') and x.starts_on >= v_today
         order by x.starts_on limit 1) a
      union all
      select z from (
        select jsonb_build_object('label', x.name || ' ends', 'on', x.ends_on, 'href', '/admin/seasons') as z
          from public.seasons x where x.centre_id = v_centre and x.status in ('open', 'running') and x.ends_on >= v_today
         order by x.ends_on limit 1) b
      union all
      select z from (
        select jsonb_build_object('label', case x.kind::text when 'commissioning_workshop' then 'Commissioning workshop' else 'Practice workshop' end,
                                  'on', public.notice_day(x.starts_at), 'href', case when public.has_any_role(array['pastor', 'director', 'coach']::public.app_role[]) then '/review/academy' end) as z
          from public.academy_sessions x where x.starts_at > now() order by x.starts_at limit 1) c3
      union all
      select z from (
        select jsonb_build_object('label', 'A deletion request is due', 'on', public.notice_day(e.requested_at) + 30, 'href', '/admin/privacy') as z
          from public.erasure_requests e where e.status = 'open' and e.centre_id = v_centre and public.has_any_role(array['admin', 'director']::public.app_role[])
         order by e.requested_at limit 1) d
    ) all_dates;
    select coalesce(jsonb_agg(z), '[]'::jsonb) into v_coming from (select z from jsonb_array_elements(coalesce(v_coming, '[]'::jsonb)) z limit 3) t;
  exception when others then
    v_coming := '[]'::jsonb;
    perform public.notice_fault('admin_attention', 'coming up: ' || sqlerrm);
  end;

  -- Who receives the notices: an empty role, or a group still Off (only for those who can change the switches)
  if public.has_any_role(array['admin', 'director']::public.app_role[]) then
    for g in select unnest(array['pastors', 'directors', 'admin', 'coaches', 'care', 'leaders', 'champions', 'data_lead']) loop
      if public.notice_mode(g) = 'off' then
        v_off := v_off + 1;
      else
        select count(distinct pr.person_id)::integer into v_holders
          from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
         where pr.centre_id = v_centre and pr.role::text = any (public.notice_roles_in(g, v_centre)) and not p.hidden;
        if v_holders = 0 then
          v_warn := v_warn || jsonb_build_object('group', g);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'roles', to_jsonb(v_mine),
    'rows', v_rows,
    'coming', v_coming,
    'numbers', jsonb_build_object(
      'placed', (select count(distinct m.person_id) from public.tribe_members m join public.people p on p.id = m.person_id where m.status = 'active' and p.centre_id = v_centre),
      'applications_month', (select count(*) from public.leader_applications a join public.people p on p.id = a.person_id
                              where p.centre_id = v_centre and a.submitted_at >= date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos'),
      'certified', (select count(*) from public.leader_certifications lc join public.people p on p.id = lc.person_id where p.centre_id = v_centre),
      'tribes_open', (select count(*) from public.tribes t join public.people lp on lp.id = t.leader_id
                       where t.status = 'approved' and lp.centre_id = v_centre and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id))),
    'notices', jsonb_build_object('off', v_off, 'empty', v_warn,
                                  'faults', (select count(*) from public.notice_faults f where f.at > now() - interval '7 days')));
end;
$$;

-- The Notifications page: the switches, who receives each group, the numbers the checks use, and recent faults.
create function public.notice_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_centre uuid := public.my_centre();
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'groups', (
      select jsonb_agg(jsonb_build_object(
        'key', s.group_key, 'mode', s.mode, 'updated_at', s.updated_at,
        'people', case when public.notice_group_roles(s.group_key) is null then null else coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', h.person_id, 'name', public.person_display_name(h.person_id), 'role', h.role,
                   'can_be_told', h.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$',
                   'delivery', public.notice_delivery(h.person_id, s.group_key)) order by public.person_display_name(h.person_id))
            from (
              select distinct on (pr.person_id) pr.person_id, pr.role::text as role, p.email
                from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
               where pr.centre_id = v_centre and not p.hidden and not public.notice_is_owner(pr.person_id)
                 and pr.role::text = any (public.notice_roles_in(s.group_key, v_centre))
               order by pr.person_id) h), '[]'::jsonb) end)
        order by array_position(array['admin', 'pastors', 'directors', 'care', 'coaches', 'leaders', 'champions', 'data_lead', 'members', 'applicants', 'referees'], s.group_key))
      from public.notice_settings s),
    'numbers', (select jsonb_agg(jsonb_build_object('key', n.key, 'value', n.value, 'note', n.note) order by n.key) from public.notice_numbers n),
    'faults', coalesce((select jsonb_agg(jsonb_build_object('at', f.at, 'source', f.source, 'message', f.message) order by f.id desc)
                          from (select * from public.notice_faults order by id desc limit 20) f), '[]'::jsonb));
end;
$$;

-- Admins and directors switch a group Off, to Rehearsal, or On.
create function public.notice_set_mode(p_group text, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_was text;
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can change this' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('off', 'rehearsal', 'on') then
    raise exception 'Choose Off, Rehearsal or On' using errcode = '22023';
  end if;
  select s.mode into v_was from public.notice_settings s where s.group_key = p_group for update;
  if not found then
    raise exception 'No such group of notices' using errcode = 'P0002';
  end if;
  if v_was = p_mode then
    return;
  end if;
  update public.notice_settings set mode = p_mode, updated_by = uid, updated_at = now() where group_key = p_group;
  perform public.write_event(uid, 'notices.mode_changed', 'notice_group', p_group, jsonb_build_object('from', v_was, 'to', p_mode));
end;
$$;

-- The last notices written to the log, newest first.
create function public.notice_log(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'template', x.template, 'group', x.params ->> 'notice_group', 'status', x.status, 'error', x.error,
             'at', x.created_at, 'sent_at', x.sent_at,
             'to', coalesce(public.first_name_of(x.person_id), split_part(coalesce(x.to_name, ''), ' ', 1)),
             'rehearsal', x.status = 'skipped' and x.error like 'Rehearsal:%') order by x.created_at desc)
      from (select * from public.messages m
             where m.params ? 'notice_group' and (m.centre_id is null or m.centre_id = public.my_centre())
             order by m.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb);
end;
$$;

-- A team member's own choices: for each group of notices they receive, right away, a daily digest or a weekly digest.
create function public.my_notice_prefs()
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
    select jsonb_agg(jsonb_build_object('group', g.k, 'delivery', public.notice_delivery(uid, g.k), 'mode', public.notice_mode(g.k)) order by g.ord)
      from (values ('admin', 1), ('pastors', 2), ('directors', 3), ('care', 4), ('coaches', 5)) g(k, ord)
     where not public.notice_is_owner(uid)
       and exists (select 1 from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
                    where pr.person_id = uid and pr.role::text = any (public.notice_roles_in(g.k, pr.centre_id)))), '[]'::jsonb);
end;
$$;

create function public.save_notice_pref(p_group text, p_delivery text)
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
  if p_group is null or not public.notice_digest_group(p_group) then
    raise exception 'That group has no choice to make' using errcode = '22023';
  end if;
  if p_delivery is null or p_delivery not in ('instant', 'daily', 'weekly') then
    raise exception 'Choose right away, daily or weekly' using errcode = '22023';
  end if;
  if public.notice_is_owner(uid) or not exists (
       select 1 from public.person_roles pr join public.people p on p.id = pr.person_id and p.centre_id = pr.centre_id
        where pr.person_id = uid and pr.role::text = any (public.notice_roles_in(p_group, pr.centre_id))) then
    raise exception 'You do not receive these notices' using errcode = '42501';
  end if;
  insert into public.notice_prefs (person_id, group_key, delivery) values (uid, p_group, p_delivery)
  on conflict (person_id, group_key) do update set delivery = excluded.delivery, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what. The engine is internal; only the Admin pages' functions and the heartbeat are reachable.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.notice_day(timestamptz), public.notice_hour(timestamptz), public.notice_isodow(timestamptz), public.notice_week(timestamptz),
  public.notice_group_of_role(text), public.notice_group_roles(text), public.notice_roles_in(text, uuid), public.notice_digest_group(text), public.notice_service_group(text),
  public.notice_mode(text), public.notice_is_owner(uuid), public.notice_is_young(uuid), public.notice_delivery(uuid, text), public.notice_fault(text, text),
  public.notify_person(uuid, text, text, text, jsonb, text, text, boolean),
  public.notify_role(uuid, text[], text, text, jsonb, text, text, boolean, uuid),
  public.notify_named(uuid, text, text, text, jsonb, text, text, boolean),
  public.notify_care(uuid, text, text, jsonb, text, text, boolean),
  public.notify_address(text, text, text, text, text, jsonb),
  public.notice_defer(text, text, integer, text),
  public.notice_role_removed(uuid, uuid),
  public.notice_digest(uuid, timestamptz),
  public.notice_number(text),
  public.notice_launch_left(uuid, uuid),
  public.notice_chk_decisions(timestamptz), public.notice_chk_cards(timestamptz), public.notice_chk_templates(timestamptz),
  public.notice_chk_season_review(timestamptz), public.notice_chk_interviews_tomorrow(timestamptz), public.notice_chk_interview_outcome(timestamptz),
  public.notice_chk_slots_low(timestamptz), public.notice_chk_offers(timestamptz), public.notice_chk_demand(timestamptz),
  public.notice_chk_unplaced(timestamptz), public.notice_chk_countdown(timestamptz), public.notice_chk_erasure_due(timestamptz),
  public.notice_chk_sending(timestamptz), public.notice_chk_reporting(timestamptz), public.notice_chk_email_week(timestamptz),
  public.notice_chk_academy(timestamptz), public.notice_chk_care(timestamptz), public.notice_chk_leaders(timestamptz),
  public.notice_chk_applicants(timestamptz), public.notice_chk_referees(timestamptz), public.notice_chk_champions(timestamptz),
  public.notice_chk_integrity(timestamptz), public.notice_chk_meetings(timestamptz), public.notice_chk_scrub(timestamptz),
  public.notice_sweep(timestamptz),
  public.notice_row(text, text, text, text[], text[], integer, integer, boolean, text),
  public.admin_attention(), public.notice_overview(), public.notice_set_mode(text, text), public.notice_log(integer),
  public.my_notice_prefs(), public.save_notice_pref(text, text),
  public.worker_notice_sweep(text)
  from public, anon, authenticated;

-- The Admin pages
grant execute on function
  public.admin_attention(), public.notice_overview(), public.notice_set_mode(text, text), public.notice_log(integer),
  public.my_notice_prefs(), public.save_notice_pref(text, text)
  to authenticated;

-- The sending service has no account; the token is the credential.
grant execute on function public.worker_notice_sweep(text) to anon;

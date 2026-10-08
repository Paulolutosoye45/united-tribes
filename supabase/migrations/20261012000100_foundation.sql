-- United Tribes, Phase 0: foundation.
--
-- People, roles, invitations, catalogues (tribes, tracks, goals, seasons),
-- the event log, and the access rules that protect them.
--
-- Rules this file enforces in the database itself, not in app code:
--   * Nobody signs themselves into a role. Roles come from invitations
--     (claimed only by a verified email) or from an admin/director.
--   * A member can only see their own record.
--   * The last admin can never be removed.
--   * Every sensitive change is written to the event log.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum (
  'member',
  'leader',
  'assistant_leader',
  'coach',
  'tribe_champion',
  'care_lead',
  'data_lead',
  'director',
  'pastor',
  'admin'
);

create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.season_status as enum ('planning', 'open', 'running', 'closed');

-- ---------------------------------------------------------------------------
-- Centres (one today; the model supports more from Phase 7)
-- ---------------------------------------------------------------------------

create table public.centres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The trigger below needs one active centre to exist, so it is created here.
insert into public.centres (slug, name)
values ('tcn-iganmu', 'The Covenant Nation, Iganmu');

-- ---------------------------------------------------------------------------
-- Catalogues: the shared vocabulary for leaders and members
-- ---------------------------------------------------------------------------

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  min_age int not null check (min_age >= 0),
  max_age int,
  description text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  check (max_age is null or max_age >= min_age)
);

-- The age ranges members pick from, each mapped to one life-stage track.
create table public.age_ranges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  label text not null,
  min_age int not null check (min_age >= 0),
  max_age int,
  track_id uuid not null references public.tracks (id),
  sort int not null default 0,
  check (max_age is null or max_age >= min_age)
);

create table public.tribes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null default '',
  sort int not null default 0,
  active boolean not null default true
);

create table public.goal_families (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  sort int not null default 0
);

create table public.season_goals (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes (id),
  family_id uuid not null references public.goal_families (id),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  sort int not null default 0,
  active boolean not null default true
);
create index season_goals_tribe_idx on public.season_goals (tribe_id);
create index season_goals_family_idx on public.season_goals (family_id);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres (id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  weeks int not null default 12 check (weeks between 4 and 24),
  status public.season_status not null default 'planning',
  sermon_series text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index seasons_centre_idx on public.seasons (centre_id, starts_on desc);

-- ---------------------------------------------------------------------------
-- People and roles
-- ---------------------------------------------------------------------------

create table public.people (
  id uuid primary key references auth.users (id) on delete cascade,
  centre_id uuid not null references public.centres (id),
  email text not null,
  full_name text,
  preferred_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index people_email_key on public.people (lower(email));
create index people_centre_idx on public.people (centre_id);

create table public.person_roles (
  person_id uuid not null references public.people (id) on delete cascade,
  role public.app_role not null,
  centre_id uuid not null references public.centres (id),
  granted_by uuid references public.people (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (person_id, role, centre_id)
);
create index person_roles_role_idx on public.person_roles (role, centre_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role public.app_role not null check (role <> 'member'),
  centre_id uuid not null references public.centres (id),
  invited_by uuid references public.people (id) on delete set null,
  status public.invitation_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  resolved_at timestamptz,
  resolved_by uuid references public.people (id) on delete set null
);
create unique index invitations_one_pending
  on public.invitations (email, role, centre_id)
  where status = 'pending';
create index invitations_email_idx on public.invitations (email) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Event log: the raw material for funnels, retention and audits
-- ---------------------------------------------------------------------------

create table public.event_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references public.people (id) on delete set null,
  action text not null check (action ~ '^[a-z0-9_.]+$'),
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb check (pg_column_size(meta) < 4096)
);
create index event_log_at_idx on public.event_log (at desc);
create index event_log_action_idx on public.event_log (action, at desc);
create index event_log_actor_idx on public.event_log (actor_id, at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger people_touch_updated_at
  before update on public.people
  for each row execute function public.touch_updated_at();

-- Roles are read through security-definer helpers so policies never recurse.
create function public.has_any_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_roles r
    where r.person_id = auth.uid()
      and r.role = any (p_roles)
  );
$$;

create function public.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array[p_role]);
$$;

create function public.my_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.role order by r.role), '{}'::public.app_role[])
  from public.person_roles r
  where r.person_id = auth.uid();
$$;

-- Only admins may grant or revoke the roles that carry oversight.
create function public.is_oversight_role(p_role public.app_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('admin', 'director', 'pastor');
$$;

-- Writes an event as the signed-in person. Direct inserts are not allowed.
create function public.log_event(
  p_action text,
  p_entity text default null,
  p_entity_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  insert into public.event_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- Internal: log an event with an explicit actor (used by the functions below).
create function public.write_event(
  p_actor uuid,
  p_action text,
  p_entity text,
  p_entity_id text,
  p_meta jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_log (actor_id, action, entity, entity_id, meta)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: every new account gets a person record and the member role
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_name text;
  v_preferred text;
begin
  select c.id into v_centre
  from public.centres c
  where c.active
  order by c.created_at
  limit 1;

  if v_centre is null then
    raise exception 'No active centre is configured';
  end if;

  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_preferred := nullif(split_part(coalesce(v_name, ''), ' ', 1), '');

  insert into public.people (id, centre_id, email, full_name, preferred_name, avatar_url)
  values (
    new.id,
    v_centre,
    lower(new.email),
    v_name,
    v_preferred,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.person_roles (person_id, role, centre_id)
  values (new.id, 'member', v_centre)
  on conflict do nothing;

  perform public.write_event(new.id, 'person.created', 'person', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the person's email in step with their sign-in email.
create function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.people set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Invitations and roles
-- ---------------------------------------------------------------------------

-- Invite someone to a role. If they already have a verified account the role
-- is granted at once; otherwise it waits until they verify the same email.
create function public.invite_person(p_email text, p_role public.app_role)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_centre uuid;
  v_target uuid;
  v_invitation uuid;
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can invite people' using errcode = '42501';
  end if;
  if public.is_oversight_role(p_role) and not public.has_role('admin') then
    raise exception 'Only an admin can grant the % role', p_role using errcode = '42501';
  end if;
  if p_role = 'member' then
    raise exception 'Everyone is already a member' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address' using errcode = '22023';
  end if;

  select p.centre_id into v_centre from public.people p where p.id = v_actor;

  -- Already signed up with this email, and verified it?
  select p.id into v_target
  from public.people p
  join auth.users u on u.id = p.id
  where lower(p.email) = v_email
    and u.email_confirmed_at is not null
    and p.centre_id = v_centre;

  insert into public.invitations (email, role, centre_id, invited_by)
  values (v_email, p_role, v_centre, v_actor)
  on conflict (email, role, centre_id) where status = 'pending'
  do update set expires_at = now() + interval '30 days'
  returning id into v_invitation;

  if v_target is not null then
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (v_target, p_role, v_centre, v_actor)
    on conflict do nothing;

    update public.invitations
    set status = 'accepted', resolved_at = now(), resolved_by = v_target
    where id = v_invitation;

    perform public.write_event(v_actor, 'role.granted', 'person', v_target::text,
      jsonb_build_object('role', p_role, 'via', 'invite_existing'));
    return jsonb_build_object('invitation_id', v_invitation, 'status', 'accepted', 'granted_now', true);
  end if;

  perform public.write_event(v_actor, 'invitation.created', 'invitation', v_invitation::text,
    jsonb_build_object('role', p_role));
  return jsonb_build_object('invitation_id', v_invitation, 'status', 'pending', 'granted_now', false);
end;
$$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can revoke invitations' using errcode = '42501';
  end if;

  select i.role into v_role
  from public.invitations i
  where i.id = p_invitation and i.status = 'pending';

  if v_role is null then
    raise exception 'That invitation is not pending' using errcode = 'P0002';
  end if;
  if public.is_oversight_role(v_role) and not public.has_role('admin') then
    raise exception 'Only an admin can revoke the % invitation', v_role using errcode = '42501';
  end if;

  update public.invitations
  set status = 'revoked', resolved_at = now(), resolved_by = v_actor
  where id = p_invitation;

  perform public.write_event(v_actor, 'invitation.revoked', 'invitation', p_invitation::text,
    jsonb_build_object('role', v_role));
end;
$$;

-- Called right after sign-in. Grants roles from pending invitations, but only
-- when the account's email has been verified (Google, or the emailed code).
create function public.claim_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;

  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid;

  if v_email is null or v_confirmed is null then
    return 0;
  end if;

  update public.invitations
  set status = 'expired', resolved_at = now()
  where status = 'pending' and email = v_email and expires_at < now();

  for r in
    select i.id, i.role, i.centre_id, i.invited_by
    from public.invitations i
    where i.status = 'pending' and i.email = v_email and i.expires_at >= now()
    for update
  loop
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (v_uid, r.role, r.centre_id, r.invited_by)
    on conflict do nothing;

    update public.invitations
    set status = 'accepted', resolved_at = now(), resolved_by = v_uid
    where id = r.id;

    perform public.write_event(v_uid, 'role.granted', 'person', v_uid::text,
      jsonb_build_object('role', r.role, 'via', 'invitation'));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create function public.revoke_role(p_person uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_centre uuid;
  v_removed integer;
begin
  if v_actor is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can remove roles' using errcode = '42501';
  end if;
  if p_role = 'member' then
    raise exception 'The member role cannot be removed' using errcode = '22023';
  end if;
  if public.is_oversight_role(p_role) and not public.has_role('admin') then
    raise exception 'Only an admin can remove the % role', p_role using errcode = '42501';
  end if;

  select p.centre_id into v_centre from public.people p where p.id = p_person;
  if v_centre is null then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  -- Serialise admin removals so two admins cannot remove each other at once.
  if p_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('united_tribes.last_admin'));
    if (select count(*) from public.person_roles r where r.role = 'admin') <= 1 then
      raise exception 'You cannot remove the last admin' using errcode = '23514';
    end if;
  end if;

  delete from public.person_roles
  where person_id = p_person and role = p_role and centre_id = v_centre;
  get diagnostics v_removed = row_count;

  if v_removed > 0 then
    perform public.write_event(v_actor, 'role.revoked', 'person', p_person::text,
      jsonb_build_object('role', p_role));
  end if;
end;
$$;

-- One-time setup. Run it from the Supabase SQL editor (never from the app):
--   select public.bootstrap_first_admin('director@example.org');
create function public.bootstrap_first_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_centre uuid;
  v_target uuid;
begin
  if exists (select 1 from public.person_roles r where r.role = 'admin') then
    raise exception 'An admin already exists. Use the Admin page to invite more people.' using errcode = '23505';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address' using errcode = '22023';
  end if;

  select c.id into v_centre from public.centres c where c.active order by c.created_at limit 1;

  select p.id into v_target
  from public.people p
  join auth.users u on u.id = p.id
  where lower(p.email) = v_email and u.email_confirmed_at is not null;

  if v_target is not null then
    insert into public.person_roles (person_id, role, centre_id)
    values (v_target, 'admin', v_centre)
    on conflict do nothing;
    perform public.write_event(v_target, 'role.granted', 'person', v_target::text,
      jsonb_build_object('role', 'admin', 'via', 'bootstrap'));
    return 'Admin granted to the existing account.';
  end if;

  insert into public.invitations (email, role, centre_id)
  values (v_email, 'admin', v_centre)
  on conflict (email, role, centre_id) where status = 'pending'
  do update set expires_at = now() + interval '30 days';
  return 'Invitation created. Sign in with this email to become admin.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: lock everything down, then open exactly what is needed
-- ---------------------------------------------------------------------------

alter table public.centres enable row level security;
alter table public.tracks enable row level security;
alter table public.age_ranges enable row level security;
alter table public.tribes enable row level security;
alter table public.goal_families enable row level security;
alter table public.season_goals enable row level security;
alter table public.seasons enable row level security;
alter table public.people enable row level security;
alter table public.person_roles enable row level security;
alter table public.invitations enable row level security;
alter table public.event_log enable row level security;

-- Start from nothing. (Supabase grants broad defaults; take them back.)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Reading
grant select on
  public.centres, public.tracks, public.age_ranges, public.tribes,
  public.goal_families, public.season_goals, public.seasons,
  public.people, public.person_roles, public.invitations, public.event_log
  to authenticated;

-- Catalogue writes are allowed to the role, then limited by policy.
grant insert, update, delete on
  public.tracks, public.age_ranges, public.tribes,
  public.goal_families, public.season_goals, public.seasons
  to authenticated;
grant update on public.centres to authenticated;

-- A person may edit only how they are named and shown.
grant update (full_name, preferred_name, avatar_url) on public.people to authenticated;

-- Functions the app calls
grant execute on function
  public.has_role(public.app_role),
  public.has_any_role(public.app_role[]),
  public.my_roles(),
  public.log_event(text, text, text, jsonb),
  public.invite_person(text, public.app_role),
  public.revoke_invitation(uuid),
  public.revoke_role(uuid, public.app_role),
  public.claim_invitations()
  to authenticated;

-- Policies -------------------------------------------------------------------

create policy "centres: read" on public.centres
  for select to authenticated using (true);
create policy "centres: admin edits" on public.centres
  for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Catalogues: everyone signed in can read; admin and director can change.
create policy "tracks: read" on public.tracks for select to authenticated using (true);
create policy "tracks: staff write" on public.tracks for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

create policy "age_ranges: read" on public.age_ranges for select to authenticated using (true);
create policy "age_ranges: staff write" on public.age_ranges for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

create policy "tribes: read" on public.tribes for select to authenticated using (true);
create policy "tribes: staff write" on public.tribes for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

create policy "goal_families: read" on public.goal_families for select to authenticated using (true);
create policy "goal_families: staff write" on public.goal_families for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

create policy "season_goals: read" on public.season_goals for select to authenticated using (true);
create policy "season_goals: staff write" on public.season_goals for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

create policy "seasons: read" on public.seasons for select to authenticated using (true);
create policy "seasons: staff write" on public.seasons for all to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]))
  with check (public.has_any_role(array['admin', 'director']::public.app_role[]));

-- People: your own record; admin and director can see everyone in the list.
create policy "people: read own" on public.people
  for select to authenticated using (id = (select auth.uid()));
create policy "people: staff read" on public.people
  for select to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]));
create policy "people: edit own" on public.people
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Roles: you can see yours; admin and director can see all. No direct writes.
create policy "person_roles: read own" on public.person_roles
  for select to authenticated using (person_id = (select auth.uid()));
create policy "person_roles: staff read" on public.person_roles
  for select to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]));

-- Invitations: admin and director only. No direct writes.
create policy "invitations: staff read" on public.invitations
  for select to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]));

-- Event log: read-only for the people who run and measure the programme.
create policy "event_log: office read" on public.event_log
  for select to authenticated
  using (public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]));

-- New tables start locked too: a later migration must grant access on purpose
-- (and enable row level security) for anything the app touches.
-- Functions: Postgres lets everyone execute a new function by default, and a
-- schema-scoped default cannot take that away. So every later migration that
-- adds a function must end with
--   revoke execute on function ... from public, anon, authenticated;
-- followed by a grant to the roles that need it. A test in tests/db fails if
-- a function is left open.
alter default privileges in schema public revoke all on tables from anon, authenticated;

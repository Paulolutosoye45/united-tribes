-- United Tribes, Stage 9: the platform owner.
--
-- One person, set once by whoever installs the platform, who can open every page, see what everyone is doing and
-- change anything, and whom nobody below them can see, find, count, name or promote. In this file's words: the owner.
--
-- How it works, in four rules:
--
--   1. ONE ACCOUNT. `platform_owner` holds at most one row (a table that can only ever have one). It names the sign-in
--      account of the owner. No role can be granted to that account, and nobody can invite, promote or demote it.
--   2. TWO STEPS. Signing in is not enough. The owner must also give a passphrase, which is checked here against a
--      bcrypt hash and never kept anywhere in clear. Until then the account is a bare account with no powers at all.
--      A correct passphrase opens the owner's powers for four hours on that one sign-in and no other. Five wrong tries
--      lock it, and the lock grows. Every try is written down where only the owner can read it.
--   3. ABOVE EVERY CHECK. Every "may this person do that?" question in the platform is answered by has_any_role() or
--      my_roles(). While the owner is unlocked both say yes to every role, so every page, every list and every
--      office function opens without touching any of them.
--   4. INVISIBLE. The owner's row in `people` is marked hidden. The people policy hides it from everyone else, the
--      people search and the intake totals leave it out, any lookup of a name gives "The office", and what the owner
--      does is recorded in `god_log` (owner's eyes only) instead of under their name in the event log.
--
-- Where the owner is set: only from the SQL editor, by the database owner, with bootstrap_platform_owner(). No page,
-- no API, no invitation can create, change or remove it. The passphrase is chosen there and only its hash is stored.
-- See docs/GOD.md.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- The hidden mark, and the owner's record
-- ---------------------------------------------------------------------------

alter table public.people add column hidden boolean not null default false;

create table public.platform_owner (
  singleton boolean primary key default true check (singleton),
  person_id uuid not null unique references public.people (id) on delete restrict,
  phrase_hash text not null,
  failed_tries integer not null default 0 check (failed_tries >= 0),
  locked_until timestamptz,
  unlocked_session uuid,
  unlocked_until timestamptz,
  phrase_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.platform_owner enable row level security;
-- No grants and no policies: only the functions below reach this table.

-- What the owner does, and every try at the passphrase. Read only by the owner, through god_log_list().
create table public.god_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind ~ '^[a-z_]{2,30}$'),
  action text,
  entity text,
  entity_id text,
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) < 4096)
);
create index god_log_at_idx on public.god_log (at desc);
alter table public.god_log enable row level security;

-- ---------------------------------------------------------------------------
-- Is this request the owner, unlocked?
-- ---------------------------------------------------------------------------

-- The sign-in session a request belongs to. Supabase puts it in every token.
create function public.jwt_session()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid;
$$;

create function public.is_god()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.platform_owner o
     where o.person_id = auth.uid()
       and o.unlocked_session = public.jwt_session()
       and o.unlocked_until > now());
$$;

-- Used at the top of every owner-only function. The same plain refusal a visitor would get anywhere else.
create function public.god_only()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
end;
$$;

-- 'none' for everyone who is not the owner (and they cannot tell why), 'locked' for the owner before the passphrase,
-- 'open' after it.
create function public.god_state()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when public.is_god() then 'open' else 'locked' end
       from public.platform_owner o where o.person_id = auth.uid()),
    'none');
$$;

-- ---------------------------------------------------------------------------
-- Above every role check
-- ---------------------------------------------------------------------------

create or replace function public.has_any_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_god()
      or exists (
        select 1
          from public.person_roles r
          join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
         where r.person_id = auth.uid()
           and r.role = any (p_roles));
$$;

create or replace function public.my_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_god() then enum_range(null::public.app_role)
    else coalesce((
      select array_agg(r.role order by r.role)
        from public.person_roles r
        join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
       where r.person_id = auth.uid()), '{}'::public.app_role[])
  end;
$$;

-- A leader's own circle is the one place a role is not the test. The owner can act in any circle.
create or replace function public.can_lead_circle(p_circle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_god()
      or exists (
        select 1 from public.circles c
         where c.id = p_circle
           and (c.leader_id = (select auth.uid()) or c.assistant_id = (select auth.uid())));
$$;

-- The centres: the owner may work in any of them (when the church has more than one).
create or replace function public.my_centres()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_god boolean := public.is_god();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'multi', public.platform_flag('multi_centre'),
    'current', (select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                  from public.people p join public.centres c on c.id = p.centre_id where p.id = uid),
    'centres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'slug', c.slug, 'active', c.active,
               'roles', case when v_god
                          then (select jsonb_agg(e order by e) from unnest(enum_range(null::public.app_role)) e)
                          else (select jsonb_agg(r.role order by r.role) from public.person_roles r
                                 where r.person_id = uid and r.centre_id = c.id) end) order by c.name)
        from public.centres c
       where v_god
          or exists (select 1 from public.person_roles r where r.person_id = uid and r.centre_id = c.id)), '[]'::jsonb));
end;
$$;

create or replace function public.switch_centre(p_centre uuid)
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
  if not public.platform_flag('multi_centre') then
    raise exception 'Only one centre is open at the moment' using errcode = '22023';
  end if;
  if not exists (select 1 from public.centres c where c.id = p_centre and c.active)
     or not (public.is_god()
             or exists (select 1 from public.person_roles r where r.person_id = uid and r.centre_id = p_centre)) then
    raise exception 'You do not have a role in that centre' using errcode = '42501';
  end if;
  update public.people set centre_id = p_centre where id = uid and centre_id <> p_centre;
  perform public.write_event(uid, 'centre.switched', 'centre', p_centre::text, '{}'::jsonb);
  return public.my_centres();
end;
$$;

-- ---------------------------------------------------------------------------
-- Invisible to everyone below
-- ---------------------------------------------------------------------------

-- Admins and directors still see everyone else; never the owner. Everyone still sees their own row.
drop policy "people: staff read" on public.people;
create policy "people: staff read" on public.people
  for select to authenticated
  using (public.has_any_role(array['admin', 'director']::public.app_role[]) and not hidden);

-- A name is looked up for people who did something (who decided, who wrote). The owner's is always "The office".
create or replace function public.person_display_name(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- The panel needs the full name: a first name alone is ambiguous in a congregation of thousands.
  select case when p.hidden and not public.is_god() then 'The office'
              else coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), split_part(p.email, '@', 1)) end
  from public.people p where p.id = p_person;
$$;

create or replace function public.first_name_of(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.hidden and not public.is_god() then 'The office'
              else coalesce(
                nullif(btrim(p.preferred_name), ''),
                nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
                split_part(p.email, '@', 1)) end
  from public.people p where p.id = p_person;
$$;

-- The people search for the office leaves the owner out.
create or replace function public.find_people(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  q text := lower(btrim(coalesce(p_query, '')));
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can search for people' using errcode = '42501';
  end if;
  if char_length(q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'name', x.name, 'email', x.email,
             'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.person_roles r
                                 where r.person_id = x.id and r.centre_id = me), '[]'::jsonb))
           order by x.name)
      from (
        select p.id, p.email, coalesce(p.full_name, p.preferred_name, p.email) as name
          from public.people p
         where p.centre_id = me
           and not p.hidden
           and (position(q in lower(coalesce(p.full_name, ''))) > 0
                or position(q in lower(coalesce(p.preferred_name, ''))) > 0
                or position(q in lower(p.email)) > 0)
         order by coalesce(p.full_name, p.preferred_name, p.email)
         limit 8) x), '[]'::jsonb);
end;
$$;

-- The intake totals do not count the owner as a member.
create or replace function public.intake_stats()
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
    'members', (select count(*) from public.people where not hidden),
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

-- The office cannot ask for the owner to be erased (they would not even find them), and an answer cannot erase them.
create or replace function public.record_erasure_request(p_email text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_person uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_changed integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can record a request' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'Please keep the note under 600 characters' using errcode = '22023';
  end if;
  select p.id into v_person from public.people p
   where lower(p.email) = v_email and p.centre_id = public.my_centre() and not p.hidden;
  if v_person is null then
    raise exception 'No one in this centre has signed in with that email address' using errcode = 'P0002';
  end if;

  insert into public.erasure_requests as r (person_id, centre_id, note, by_office)
  values (v_person, public.my_centre(), v_note, true)
  on conflict (person_id) do update
     set status = 'open', note = excluded.note, by_office = true, requested_at = now(),
         decided_by = null, decided_at = null, decision_note = null
   where r.status = 'declined';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform public.write_event(uid, 'erasure.recorded', 'person', v_person::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.erase_person(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_request public.erasure_requests%rowtype;
  v_blockers text[];
  v_deleted integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can erase a person' using errcode = '42501';
  end if;
  if exists (select 1 from public.people x where x.id = p_person and x.hidden) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  -- Serialise, so two people cannot erase the last two admins at the same moment.
  perform pg_advisory_xact_lock(hashtext('united_tribes.last_admin'));

  select r.* into v_request from public.erasure_requests r
   where r.person_id = p_person and r.status = 'open' and r.centre_id = public.my_centre();
  if not found then
    raise exception 'There is no open request from that person. Ask them to make one from their profile, or record it first' using errcode = 'P0002';
  end if;

  v_blockers := public.erasure_blockers(p_person, uid);
  if 'is_you' = any (v_blockers) then
    raise exception 'You cannot erase your own account here. Ask another admin' using errcode = '22023';
  end if;
  if 'leads_a_circle' = any (v_blockers) then
    raise exception 'They lead a circle. Arrange another leader, or close the circle, before erasing them' using errcode = '22023';
  end if;
  if 'needs_an_admin' = any (v_blockers) then
    raise exception 'Only an admin can erase someone who holds the admin, director or pastor role' using errcode = '42501';
  end if;
  if 'last_admin' = any (v_blockers) then
    raise exception 'You cannot erase the last admin' using errcode = '23514';
  end if;

  select p.email into v_email from public.people p where p.id = p_person;

  -- What is written about the person but would otherwise stay behind with their name only removed.
  delete from public.celebrations c where c.person_id = p_person;
  delete from public.prayer_requests x where x.created_by = p_person;
  delete from public.invitations i where lower(i.email) = lower(v_email);
  delete from public.messages m where m.person_id is null and lower(m.to_email) = lower(v_email);
  -- Where they gave a reference for someone else, their name and contact go; the ratings stay with the applicant's file.
  update public.leader_references l set referee_name = 'Former referee', contact = 'erased' where lower(l.contact) = lower(v_email);

  -- The sign-in account. Everything that is about the person is deleted with it.
  delete from auth.users u where u.id = p_person;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  perform public.write_event(uid, 'person.erased', 'person', p_person::text, jsonb_build_object('asked_by_office', v_request.by_office));
  return jsonb_build_object('erased', true);
end;
$$;

-- Inviting the owner's address looks exactly like inviting an address that has not signed in yet: the invitation waits, and
-- when the owner next signs in it finds no role it is allowed to give. Nothing says the account exists.
create or replace function public.invite_person(p_email text, p_role public.app_role)
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
    and p.centre_id = v_centre
    and not p.hidden;

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

-- No role can ever be attached to the owner's account: it holds the powers by being the owner, not by a role. A role that
-- some other path tries to add (an invitation to that email address, a promotion) is quietly dropped.
create function public.keep_owner_roleless()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.platform_owner o where o.person_id = new.person_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger person_roles_keep_owner_roleless
  before insert on public.person_roles
  for each row execute function public.keep_owner_roleless();

-- ---------------------------------------------------------------------------
-- What the owner does is the owner's to read, not the office's
-- ---------------------------------------------------------------------------

-- An action by the owner is written to god_log with all the detail, and to the event log with no name, so the office's
-- own counts and reports stay right and nothing in them points at the owner.
create or replace function public.write_event(
  p_actor uuid,
  p_action text,
  p_entity text,
  p_entity_id text,
  p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hidden boolean := false;
begin
  if p_actor is not null then
    select p.hidden into v_hidden from public.people p where p.id = p_actor;
  end if;
  if coalesce(v_hidden, false) then
    insert into public.god_log (kind, action, entity, entity_id, detail)
    values ('action', p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
    insert into public.event_log (actor_id, action, entity, entity_id, meta)
    values (null, p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
  else
    insert into public.event_log (actor_id, action, entity, entity_id, meta)
    values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public.log_event(
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
  perform public.write_event(auth.uid(), p_action, p_entity, p_entity_id, p_meta);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setting the owner: from the SQL editor only
-- ---------------------------------------------------------------------------

-- The owner signs in once with the address first (so the account exists and the address is verified), then this is run
-- by whoever installs the platform. The account must be new to the programme: no role, no circle, no form.
create function public.bootstrap_platform_owner(p_email text, p_phrase text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_person uuid;
begin
  if exists (select 1 from public.platform_owner) then
    raise exception 'A platform owner is already set. Only one can exist. To replace them, run remove_platform_owner() first.' using errcode = '23505';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That does not look like an email address' using errcode = '22023';
  end if;
  if char_length(coalesce(p_phrase, '')) < 12 then
    raise exception 'The passphrase needs at least 12 characters. Four unrelated words is a good one' using errcode = '22023';
  end if;

  select p.id into v_person
    from public.people p
    join auth.users u on u.id = p.id
   where lower(p.email) = v_email and u.email_confirmed_at is not null;
  if v_person is null then
    raise exception 'Sign in once with that address first, then run this again. The account has to exist and be verified' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.person_roles r where r.person_id = v_person and r.role <> 'member')
     or exists (select 1 from public.circles c where v_person in (c.leader_id, c.assistant_id, c.coach_id))
     or exists (select 1 from public.circle_members m where m.person_id = v_person)
     or exists (select 1 from public.member_profiles mp where mp.person_id = v_person) then
    raise exception 'That account is already part of the programme (a role, a circle or a form). Use an address that is only for this' using errcode = '22023';
  end if;

  delete from public.person_roles where person_id = v_person;
  update public.people set hidden = true where id = v_person;
  -- What the account did, or what was written about it, before it became the owner leaves the shared record.
  update public.event_log set actor_id = null where actor_id = v_person;
  delete from public.event_log where entity = 'person' and entity_id = v_person::text;
  insert into public.platform_owner (person_id, phrase_hash)
  values (v_person, extensions.crypt(p_phrase, extensions.gen_salt('bf', 12)));
  insert into public.god_log (kind, detail) values ('owner_set', '{}'::jsonb);

  return 'Platform owner set. Sign in with that address; the unlock step comes next.';
end;
$$;

-- Takes the owner away (and makes the account an ordinary member again), so a different one can be set.
create function public.remove_platform_owner()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  select o.person_id into v_person from public.platform_owner o;
  if v_person is null then
    raise exception 'There is no platform owner' using errcode = 'P0002';
  end if;
  delete from public.platform_owner;
  update public.people set hidden = false where id = v_person;
  insert into public.person_roles (person_id, role, centre_id)
  select p.id, 'member', p.centre_id from public.people p where p.id = v_person
  on conflict do nothing;
  insert into public.god_log (kind, detail) values ('owner_removed', '{}'::jsonb);
  return 'Platform owner removed. That account is an ordinary member now.';
end;
$$;

-- ---------------------------------------------------------------------------
-- The unlock
-- ---------------------------------------------------------------------------

-- Gives its answer as data, not as an error, because a refusal that raised would also undo the count of wrong tries.
create function public.god_unlock(p_phrase text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sess uuid := public.jwt_session();
  o public.platform_owner%rowtype;
  v_failed integer;
  v_lock interval;
  v_wrong constant jsonb := jsonb_build_object('ok', false, 'reason', 'wrong', 'message', 'That did not work.');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select * into o from public.platform_owner where person_id = uid for update;
  if not found then
    -- Not the owner. The same answer as a wrong passphrase, and a note for the owner (at most one an hour per person).
    if not exists (select 1 from public.god_log g
                    where g.kind = 'probe' and g.detail ->> 'person' = uid::text and g.at > now() - interval '1 hour') then
      insert into public.god_log (kind, detail) values ('probe', jsonb_build_object('person', uid));
    end if;
    return v_wrong;
  end if;

  if sess is null then
    return jsonb_build_object('ok', false, 'reason', 'session', 'message', 'This sign-in cannot be unlocked. Sign out and sign in again.');
  end if;

  if o.locked_until is not null and o.locked_until > now() then
    insert into public.god_log (kind, detail) values ('refused', jsonb_build_object('locked_until', o.locked_until));
    return jsonb_build_object(
      'ok', false, 'reason', 'locked',
      'message', format('Too many tries. Wait until %s, then try again.', to_char(o.locked_until at time zone 'Africa/Lagos', 'HH24:MI')),
      'locked_until', o.locked_until);
  end if;

  if o.phrase_hash = extensions.crypt(coalesce(p_phrase, ''), o.phrase_hash) then
    update public.platform_owner
       set failed_tries = 0, locked_until = null, unlocked_session = sess, unlocked_until = now() + interval '4 hours';
    insert into public.god_log (kind, detail) values ('unlock', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'until', now() + interval '4 hours');
  end if;

  v_failed := o.failed_tries + 1;
  -- Five tries, then a quarter of an hour; every wrong try after that locks again, and the lock doubles every five tries.
  v_lock := case when v_failed >= 5
                 then least(interval '24 hours', interval '15 minutes' * power(2, (v_failed - 5) / 5)::integer)
                 else null end;
  update public.platform_owner
     set failed_tries = v_failed,
         locked_until = case when v_lock is null then null else now() + v_lock end;
  insert into public.god_log (kind, detail) values ('wrong', jsonb_build_object('tries', v_failed, 'locked', v_lock is not null));
  return v_wrong || jsonb_build_object('tries_left', greatest(0, 5 - v_failed));
end;
$$;

create function public.god_lock()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_owner o where o.person_id = auth.uid()) then
    update public.platform_owner set unlocked_session = null, unlocked_until = null;
    insert into public.god_log (kind, detail) values ('lock', '{}'::jsonb);
  end if;
end;
$$;

create function public.god_set_phrase(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.platform_owner%rowtype;
begin
  perform public.god_only();
  select * into o from public.platform_owner;
  if o.locked_until is not null and o.locked_until > now() then
    return jsonb_build_object('ok', false, 'message', 'Too many wrong tries. Wait a little, then try again.');
  end if;
  if o.phrase_hash <> extensions.crypt(coalesce(p_old, ''), o.phrase_hash) then
    -- A wrong current passphrase counts like any other wrong try, and returns, so the count is kept.
    update public.platform_owner set failed_tries = failed_tries + 1,
           locked_until = case when failed_tries + 1 >= 5 then now() + interval '15 minutes' else null end,
           unlocked_session = case when failed_tries + 1 >= 5 then null else unlocked_session end,
           unlocked_until = case when failed_tries + 1 >= 5 then null else unlocked_until end;
    insert into public.god_log (kind, detail) values ('wrong', jsonb_build_object('where', 'change'));
    return jsonb_build_object('ok', false, 'message', 'The current passphrase is not right.');
  end if;
  if char_length(coalesce(p_new, '')) < 12 then
    return jsonb_build_object('ok', false, 'message', 'The new passphrase needs at least 12 characters. Four unrelated words is a good one.');
  end if;
  if p_new = p_old then
    return jsonb_build_object('ok', false, 'message', 'The new passphrase is the same as the old one.');
  end if;
  update public.platform_owner
     set phrase_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 12)),
         phrase_changed_at = now(), failed_tries = 0, locked_until = null;
  insert into public.god_log (kind, detail) values ('phrase_changed', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The console: what everyone is doing
-- ---------------------------------------------------------------------------

create function public.god_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
begin
  perform public.god_only();
  return jsonb_build_object(
    'now', now(),
    'open_until', (select o.unlocked_until from public.platform_owner o),
    'phrase_changed_at', (select o.phrase_changed_at from public.platform_owner o),
    'people', jsonb_build_object(
      'total', (select count(*) from public.people where not hidden),
      'today', (select count(*) from public.people where not hidden and created_at >= v_today),
      'with_profile', (select count(*) from public.member_profiles),
      'drafts', (select count(*) from public.intake_drafts)),
    'circles', coalesce((select jsonb_object_agg(s.status, s.n)
                           from (select c.status::text as status, count(*) as n from public.circles c group by c.status) s), '{}'::jsonb),
    'seats', (select count(*) from public.circle_members where status = 'active'),
    'care_open', (select count(*) from public.care_tasks where status = 'open'),
    'erasure_open', (select count(*) from public.erasure_requests where status = 'open'),
    'messages', jsonb_build_object(
      'queued', (select count(*) from public.messages where status in ('queued', 'sending')),
      'sent_today', (select count(*) from public.messages where sent_at >= v_today),
      'failed_7d', (select count(*) from public.messages where status = 'failed' and created_at > now() - interval '7 days'),
      'worker_seen', (select max(last_used_at) from public.worker_tokens where revoked_at is null)),
    'assistant', jsonb_build_object(
      'calls_24h', (select count(*) from public.ai_calls where at > now() - interval '24 hours'),
      'fallbacks_24h', (select count(*) from public.ai_calls where at > now() - interval '24 hours' and fallback)),
    'activity', jsonb_build_object(
      'last_hour', (select count(*) from public.event_log where at > now() - interval '1 hour'),
      'last_day', (select count(*) from public.event_log where at > now() - interval '24 hours')),
    'attempts', jsonb_build_object(
      'wrong_7d', (select count(*) from public.god_log where kind = 'wrong' and at > now() - interval '7 days'),
      'probes_7d', (select count(*) from public.god_log where kind = 'probe' and at > now() - interval '7 days')));
end;
$$;

-- Everything that happened, newest first, with names. Page back with p_before (the id of the last one seen).
create function public.god_feed(p_limit integer default 100, p_before bigint default null, p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(btrim(coalesce(p_search, '')));
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id desc)
      from (
        select e.id, e.at, e.action, e.entity, e.entity_id, e.actor_id,
               coalesce(nullif(btrim(a.full_name), ''), nullif(btrim(a.preferred_name), ''), a.email) as actor_name,
               (select jsonb_agg(r.role order by r.role) from public.person_roles r
                 where r.person_id = e.actor_id and r.role <> 'member') as actor_roles,
               case when e.entity = 'person'
                    then (select coalesce(nullif(btrim(s.full_name), ''), nullif(btrim(s.preferred_name), ''), s.email)
                            from public.people s where s.id::text = e.entity_id and not s.hidden) end as subject_name,
               e.meta
          from public.event_log e
          left join public.people a on a.id = e.actor_id
         where (p_before is null or e.id < p_before)
           and (q = '' or position(q in lower(e.action)) > 0)
         order by e.id desc
         limit least(greatest(coalesce(p_limit, 100), 1), 300)) x), '[]'::jsonb);
end;
$$;

-- Everyone, with where they are in the programme. p_query matches a name or an email.
create function public.god_people(p_query text default null, p_limit integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := lower(btrim(coalesce(p_query, '')));
  v_total integer;
begin
  perform public.god_only();
  select count(*) into v_total from public.people p
   where not p.hidden
     and (q = '' or position(q in lower(coalesce(p.full_name, ''))) > 0
                 or position(q in lower(coalesce(p.preferred_name, ''))) > 0
                 or position(q in lower(p.email)) > 0);
  return jsonb_build_object(
    'total', v_total,
    'people', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.last_seen desc nulls last, x.name)
        from (
          select p.id, p.email, coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.preferred_name), ''), p.email) as name,
                 p.created_at,
                 (select jsonb_agg(r.role order by r.role) from public.person_roles r
                   where r.person_id = p.id and r.role <> 'member') as roles,
                 case when exists (select 1 from public.member_profiles mp where mp.person_id = p.id) then 'complete'
                      when exists (select 1 from public.intake_drafts d where d.person_id = p.id) then 'started'
                      else 'new' end as form,
                 (select c.name from public.circle_members m join public.circles c on c.id = m.circle_id
                   where m.person_id = p.id and m.status = 'active' limit 1) as circle,
                 (select max(e.at) from public.event_log e where e.actor_id = p.id) as last_seen
            from public.people p
           where not p.hidden
             and (q = '' or position(q in lower(coalesce(p.full_name, ''))) > 0
                         or position(q in lower(coalesce(p.preferred_name, ''))) > 0
                         or position(q in lower(p.email)) > 0)
           order by (select max(e.at) from public.event_log e where e.actor_id = p.id) desc nulls last, p.created_at desc
           limit least(greatest(coalesce(p_limit, 60), 1), 200)) x), '[]'::jsonb));
end;
$$;

-- One person, all of it that is not sealed: who they are, where they stand, what they have done, what has been sent them.
-- The sealed private notes stay sealed: the database never holds them open.
create function public.god_person(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.people%rowtype;
begin
  perform public.god_only();
  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'person', jsonb_build_object(
      'id', p.id, 'email', p.email, 'full_name', p.full_name, 'preferred_name', p.preferred_name, 'created_at', p.created_at,
      'centre', (select c.name from public.centres c where c.id = p.centre_id)),
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.person_roles r where r.person_id = p.id), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('purpose', l.purpose, 'granted', l.granted, 'at', l.created_at) order by l.purpose)
        from (select distinct on (c.purpose) c.purpose, c.granted, c.created_at
                from public.consents c where c.person_id = p.id order by c.purpose, c.id desc) l), '[]'::jsonb),
    'form', (select jsonb_build_object(
               'state', 'complete',
               'tribe', tr.name,
               'goal', coalesce(g.title, mp.goal_other),
               'age', ar.label,
               'track', t.name,
               'zone', mp.zone,
               'mode', mp.meeting_mode,
               'seconds', mp.duration_seconds)
               from public.member_profiles mp
               left join public.tribes tr on tr.id = mp.tribe_id
               left join public.season_goals g on g.id = mp.season_goal_id
               left join public.age_ranges ar on ar.id = mp.age_range_id
               left join public.tracks t on t.id = ar.track_id
              where mp.person_id = p.id limit 1),
    'draft', (select jsonb_build_object('state', 'started', 'step', d.step, 'updated_at', d.updated_at)
                from public.intake_drafts d where d.person_id = p.id),
    'placement', (select jsonb_build_object('circle_id', c.id, 'circle', c.name, 'status', m.status, 'joined_at', m.joined_at,
                                            'leader', public.person_display_name(c.leader_id))
                    from public.circle_members m join public.circles c on c.id = m.circle_id
                   where m.person_id = p.id order by (m.status = 'active') desc, m.joined_at desc nulls last limit 1),
    'leads', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                         'members', (select count(*) from public.circle_members m where m.circle_id = c.id and m.status = 'active')) order by c.name)
                         from public.circles c where p.id in (c.leader_id, c.assistant_id, c.coach_id)), '[]'::jsonb),
    'application', (select jsonb_build_object('status', a.status, 'submitted_at', a.submitted_at)
                      from public.leader_applications a where a.person_id = p.id),
    'attendance', (select jsonb_build_object(
                     'present', count(*) filter (where a.status = 'present'),
                     'absent', count(*) filter (where a.status = 'absent'),
                     'excused', count(*) filter (where a.status = 'excused'))
                     from public.circle_attendance a where a.person_id = p.id),
    'messages', jsonb_build_object(
      'by_status', coalesce((select jsonb_object_agg(s.status, s.n)
                               from (select m.status, count(*) as n from public.messages m where m.person_id = p.id group by m.status) s), '{}'::jsonb),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('template', m.template, 'channel', m.channel, 'status', m.status, 'at', m.created_at) order by m.created_at desc)
                            from (select * from public.messages m2 where m2.person_id = p.id order by m2.created_at desc limit 5) m), '[]'::jsonb)),
    'assistant', jsonb_build_object(
      'calls', (select count(*) from public.ai_calls a where a.person_id = p.id),
      'fallbacks', (select count(*) from public.ai_calls a where a.person_id = p.id and a.fallback)),
    'erasure', (select r.status from public.erasure_requests r where r.person_id = p.id),
    'events', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.id desc)
        from (select e.id, e.at, e.action, e.entity, e.entity_id, (e.actor_id = p.id) as by_them
                from public.event_log e
               where e.actor_id = p.id or (e.entity = 'person' and e.entity_id = p.id::text)
               order by e.id desc limit 30) x), '[]'::jsonb));
end;
$$;

create function public.god_circles(p_status text default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.name)
      from (
        select c.id, c.name, c.status, c.capacity,
               public.person_display_name(c.leader_id) as leader,
               public.person_display_name(c.assistant_id) as assistant,
               public.person_display_name(c.coach_id) as coach,
               (select t.name from public.tribes t where t.id = c.tribe_id) as tribe,
               (select s.name from public.seasons s where s.id = c.season_id) as season,
               (select count(*) from public.circle_members m where m.circle_id = c.id and m.status = 'active') as members,
               (select max(l.week) from public.circle_logs l where l.circle_id = c.id and l.held) as last_week_held
          from public.circles c
         where p_status is null or c.status::text = p_status
         order by c.name
         limit least(greatest(coalesce(p_limit, 100), 1), 300)) x), '[]'::jsonb);
end;
$$;

create function public.god_circle(p_circle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
begin
  perform public.god_only();
  select * into c from public.circles x where x.id = p_circle;
  if not found then
    raise exception 'No such circle' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'circle', jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity, 'zone', c.zone, 'mode', c.meeting_mode,
      'leader', public.person_display_name(c.leader_id), 'leader_id', c.leader_id,
      'assistant', public.person_display_name(c.assistant_id), 'coach', public.person_display_name(c.coach_id),
      'tribe', (select t.name from public.tribes t where t.id = c.tribe_id),
      'season', (select s.name from public.seasons s where s.id = c.season_id)),
    'members', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.name)
        from (
          select m.person_id as id, public.person_display_name(m.person_id) as name, m.status, m.joined_at,
                 (select count(*) from public.circle_attendance a where a.circle_id = c.id and a.person_id = m.person_id and a.status = 'present') as present,
                 (select count(*) from public.circle_attendance a where a.circle_id = c.id and a.person_id = m.person_id and a.status <> 'present') as missed
            from public.circle_members m where m.circle_id = c.id) x), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', l.week, 'held', l.held, 'energy', l.energy, 'need_coach', l.need_coach,
                                          'highlight', l.highlight, 'logged_at', l.logged_at) order by l.week)
        from public.circle_logs l where l.circle_id = c.id), '[]'::jsonb),
    'care_open', (select count(*) from public.care_tasks t where t.circle_id = c.id and t.status = 'open'));
end;
$$;

-- The owner's own record: every unlock, every wrong try, every stranger who tried, every change the owner made.
create function public.god_log_list(p_limit integer default 100, p_before bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.id desc)
      from (
        select g.id, g.at, g.kind, g.action, g.entity, g.entity_id,
               case when g.kind = 'probe'
                    then jsonb_build_object('person', (select coalesce(nullif(btrim(p.full_name), ''), p.email)
                                                         from public.people p where p.id::text = g.detail ->> 'person'))
                    else g.detail end as detail
          from public.god_log g
         where p_before is null or g.id < p_before
         order by g.id desc
         limit least(greatest(coalesce(p_limit, 100), 1), 300)) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.jwt_session(),
  public.is_god(),
  public.god_only(),
  public.keep_owner_roleless(),
  public.bootstrap_platform_owner(text, text),
  public.remove_platform_owner()
  from public, anon, authenticated;

-- The console's functions check, on their first line, that the caller is the owner and unlocked; to anyone else they
-- refuse in the same words as a page that does not exist.
revoke execute on function
  public.god_state(),
  public.god_unlock(text),
  public.god_lock(),
  public.god_set_phrase(text, text),
  public.god_overview(),
  public.god_feed(integer, bigint, text),
  public.god_people(text, integer),
  public.god_person(uuid),
  public.god_circles(text, integer),
  public.god_circle(uuid),
  public.god_log_list(integer, bigint)
  from public, anon;

grant execute on function
  public.god_state(),
  public.god_unlock(text),
  public.god_lock(),
  public.god_set_phrase(text, text),
  public.god_overview(),
  public.god_feed(integer, bigint, text),
  public.god_people(text, integer),
  public.god_person(uuid),
  public.god_circles(text, integer),
  public.god_circle(uuid),
  public.god_log_list(integer, bigint)
  to authenticated;

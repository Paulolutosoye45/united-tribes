-- United Tribes, Stage 6a: the groundwork for more than one centre.
--
-- Today there is one centre (The Covenant Nation, Iganmu). The blueprint's R6 adds more. This migration lays
-- the part of that which is safe to lay now, and holds the rest behind a switch so nobody opens a second centre
-- by accident:
--
--   platform_flags     switches only the database owner can flip (no API reaches them)
--   my_centre()        the centre a signed-in person is working in
--   has_any_role()     now counts only the roles a person holds IN THE CENTRE THEY ARE WORKING IN
--   dashboard_season() only ever picks a season of that centre
--   my_centres()       the centres a person holds a role in, and which one is current
--   switch_centre()    staff move between their centres (needs the switch on)
--   create_centre()    an admin opens a new centre (needs the switch on)
--
-- NOT done, and why the switch is off: many office queues (care, reviews, messages, the academy lists) still
-- show every centre's people. Reports, dashboards, the tribe page and tribe champions are scoped. The exact
-- list that remains is in docs/MULTI-CENTRE.md. Do not turn the switch on before that list is empty:
--
--   update public.platform_flags set enabled = true where key = 'multi_centre';

create table public.platform_flags (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.platform_flags enable row level security;
-- No grants: only the database owner and the functions below reach this table.

insert into public.platform_flags (key, enabled, note) values
  ('multi_centre', false, 'Lets an admin open a second centre and staff switch between centres. Read docs/MULTI-CENTRE.md first.');

create function public.platform_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_flags f where f.key = p_key), false);
$$;

-- The centre the signed-in person is working in; null when nobody is signed in (the sending service).
create function public.my_centre()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.centre_id from public.people p where p.id = auth.uid();
$$;

-- A role counts only in the centre the person is working in.
create or replace function public.has_any_role(p_roles public.app_role[])
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
    where r.person_id = auth.uid()
      and r.role = any (p_roles)
  );
$$;

create or replace function public.my_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.role order by r.role), '{}'::public.app_role[])
  from public.person_roles r
  join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
  where r.person_id = auth.uid();
$$;

-- A dashboard, report or tribe page only ever looks at a season of the centre the person is working in.
-- (Nobody signed in, as in the sending service, is not limited.)
create or replace function public.dashboard_season(p_season uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select public.my_centre() as c)
  select coalesce(
    (select s.id from public.seasons s, me where s.id = p_season and (me.c is null or s.centre_id = me.c)),
    case when p_season is null then
      (select s.id from public.seasons s, me
        where s.starts_on <= public.today_lagos() and (me.c is null or s.centre_id = me.c)
        order by s.starts_on desc limit 1) end,
    case when p_season is null then
      (select s.id from public.seasons s, me
        where me.c is null or s.centre_id = me.c
        order by s.starts_on asc limit 1) end);
$$;

-- ---------------------------------------------------------------------------
-- Seeing and switching centres
-- ---------------------------------------------------------------------------

create function public.my_centres()
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
    'multi', public.platform_flag('multi_centre'),
    'current', (select jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                  from public.people p join public.centres c on c.id = p.centre_id where p.id = uid),
    'centres', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'slug', c.slug, 'active', c.active,
               'roles', (select jsonb_agg(r.role order by r.role) from public.person_roles r
                          where r.person_id = uid and r.centre_id = c.id)) order by c.name)
        from public.centres c
       where exists (select 1 from public.person_roles r where r.person_id = uid and r.centre_id = c.id)), '[]'::jsonb));
end;
$$;

create function public.switch_centre(p_centre uuid)
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
     or not exists (select 1 from public.person_roles r where r.person_id = uid and r.centre_id = p_centre) then
    raise exception 'You do not have a role in that centre' using errcode = '42501';
  end if;
  update public.people set centre_id = p_centre where id = uid and centre_id <> p_centre;
  perform public.write_event(uid, 'centre.switched', 'centre', p_centre::text, '{}'::jsonb);
  return public.my_centres();
end;
$$;

create function public.create_centre(p_slug text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin']::public.app_role[]) then
    raise exception 'Only an admin can open a centre' using errcode = '42501';
  end if;
  if not public.platform_flag('multi_centre') then
    raise exception 'Only one centre is open at the moment' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'Use 3 to 40 letters, numbers or dashes for the short name' using errcode = '22023';
  end if;
  if char_length(v_name) < 3 or char_length(v_name) > 80 then
    raise exception 'Give the centre a name of 3 to 80 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.centres c where c.slug = v_slug) then
    raise exception 'There is already a centre with that short name' using errcode = '22023';
  end if;
  insert into public.centres (slug, name) values (v_slug, v_name) returning id into v_id;
  -- The person who opens it can work in it straight away
  insert into public.person_roles (person_id, role, centre_id, granted_by)
  values (uid, 'admin', v_id, uid), (uid, 'member', v_id, uid)
  on conflict do nothing;
  perform public.write_event(uid, 'centre.created', 'centre', v_id::text, jsonb_build_object('slug', v_slug));
  return public.my_centres();
end;
$$;

revoke execute on function
  public.platform_flag(text),
  public.my_centre(),
  public.my_centres(),
  public.switch_centre(uuid),
  public.create_centre(text, text)
  from public, anon, authenticated;

grant execute on function
  public.my_centres(),
  public.switch_centre(uuid),
  public.create_centre(text, text)
  to authenticated;

-- United Tribes, Stage 7: the office's own controls.
--
-- Until now the office could invite people and read numbers, but the things that make a season happen were
-- only reachable by someone who could write SQL. This migration adds the functions behind the admin screens:
--
--   seasons          create and edit a season (it must start on a Sunday, must not overlap another, cannot be
--                    re-dated once circles are approved or it has begun), and move it planning > open > running > closed
--   catalogue        tribes, goal families, Season Goals (retire and restore), the age tracks, and the goals members
--                    write in for themselves, which the team can adopt into the catalogue
--   weekly guides    edit any of the twelve guides (passage, sermon link, questions, confession, leader tip) and mark
--                    them as read and approved by the office; every circle sees an edit at once
--   tribe layer      the skill-share prompt of each tribe and the step ideas of each goal, by phase of the season
--   church settings  vision, mission and the address of the testimony form
--   launch checklist what is still missing before a season can open
--   people search    so a tribe champion can be chosen by name
--
-- It also makes "retired" mean something: a retired goal or tribe can no longer be chosen in the member form
-- (the database refuses it, not only the screen).
--
-- Everything here runs as the signed-in person, checks their role in their own centre, and writes to the event log.
-- No table is opened to the API.

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------

create function public.make_slug(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g')), 50);
$$;

-- Trims, then insists on a length. The message is what the person reads.
create function public.admin_text(p_value text, p_label text, p_min integer, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if char_length(v) > p_max or char_length(v) < p_min then
    if p_min = 0 then
      raise exception '% can be up to % characters', p_label, p_max using errcode = '22023';
    end if;
    raise exception '% needs % to % characters', p_label, p_min, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Church settings: the words the pastorate owns, and where testimonies are forwarded
-- ---------------------------------------------------------------------------

create table public.centre_settings (
  centre_id uuid not null references public.centres (id) on delete cascade,
  key text not null check (key in ('vision', 'mission', 'testimony_form_url')),
  value text not null check (char_length(btrim(value)) between 1 and 800),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (centre_id, key)
);
alter table public.centre_settings enable row level security;
-- No grants: only the functions touch this table.

create function public.church_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  office boolean := public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'vision', (select s.value from public.centre_settings s where s.centre_id = me and s.key = 'vision'),
    'mission', (select s.value from public.centre_settings s where s.centre_id = me and s.key = 'mission'),
    'testimony_form_url', case when office
      then (select s.value from public.centre_settings s where s.centre_id = me and s.key = 'testimony_form_url') end,
    'can_edit', office);
end;
$$;

create function public.save_church_settings(p_vision text, p_mission text, p_form_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me uuid := public.my_centre();
  v_vision text := nullif(btrim(coalesce(p_vision, '')), '');
  v_mission text := nullif(btrim(coalesce(p_mission, '')), '');
  v_url text := nullif(btrim(coalesce(p_form_url, '')), '');
  k text;
  v text;
  changed text[] := '{}';
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can change these' using errcode = '42501';
  end if;
  if v_vision is not null then v_vision := public.admin_text(v_vision, 'The vision', 1, 600); end if;
  if v_mission is not null then v_mission := public.admin_text(v_mission, 'The mission', 1, 600); end if;
  if v_url is not null and (char_length(v_url) > 300 or v_url !~ '^https://[^[:space:]]+$') then
    raise exception 'The testimony form address must start with https:// and have no spaces' using errcode = '22023';
  end if;

  for k, v in select * from (values ('vision', v_vision), ('mission', v_mission), ('testimony_form_url', v_url)) as t (k, v) loop
    if v is null then
      delete from public.centre_settings where centre_id = me and key = k;
      if found then changed := changed || k; end if;
    else
      insert into public.centre_settings (centre_id, key, value, updated_by)
      values (me, k, v, uid)
      on conflict (centre_id, key) do update set value = excluded.value, updated_by = uid, updated_at = now()
        where public.centre_settings.value is distinct from excluded.value;
      if found then changed := changed || k; end if;
    end if;
  end loop;

  if cardinality(changed) > 0 then
    perform public.write_event(uid, 'settings.saved', 'centre', me::text, jsonb_build_object('changed', to_jsonb(changed)));
  end if;
  return public.church_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------

create function public.admin_seasons()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  today date := public.today_lagos();
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the seasons' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', today,
    'can_edit', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'starts_on', s.starts_on, 'ends_on', s.ends_on, 'weeks', s.weeks,
               'status', s.status, 'sermon_series', s.sermon_series,
               'week', public.season_week(s.starts_on, s.weeks, today),
               'circles', (select count(*) from public.circles c where c.season_id = s.id and c.status <> 'closed'),
               'approved', (select count(*) from public.circles c where c.season_id = s.id and c.status = 'approved'),
               'members', (select count(*) from public.circle_members m where m.season_id = s.id and m.status = 'active'),
               'can_move_dates', today < s.starts_on
                 and not exists (select 1 from public.circles c where c.season_id = s.id and c.status = 'approved'))
             order by s.starts_on desc)
        from public.seasons s where s.centre_id = me), '[]'::jsonb));
end;
$$;

create function public.save_season(p_id uuid, p_name text, p_starts date, p_weeks integer, p_series text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me uuid := public.my_centre();
  today date := public.today_lagos();
  s public.seasons%rowtype;
  v_name text;
  v_series text;
  v_ends date;
  v_clash text;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change seasons' using errcode = '42501';
  end if;
  v_name := public.admin_text(p_name, 'The season name', 3, 80);
  v_series := nullif(public.admin_text(p_series, 'The sermon series', 0, 120), '');
  if p_starts is null then
    raise exception 'Choose the date the season starts' using errcode = '22023';
  end if;
  if p_weeks is null or p_weeks not between 4 and 24 then
    raise exception 'A season runs from 4 to 24 weeks' using errcode = '22023';
  end if;
  -- The weekly messages count their days from the start date, and the church week begins on Sunday.
  if extract(isodow from p_starts) <> 7 then
    raise exception 'A season starts on a Sunday. Choose a Sunday' using errcode = '22023';
  end if;
  v_ends := p_starts + p_weeks * 7 - 1;

  if p_id is null then
    if p_starts <= today then
      raise exception 'A new season must start in the future' using errcode = '22023';
    end if;
    select x.name into v_clash from public.seasons x where x.centre_id = me and x.status in ('planning', 'open') limit 1;
    if found then
      raise exception '% is still being prepared. Run it or close it before planning another', v_clash using errcode = '22023';
    end if;
  else
    select * into s from public.seasons x where x.id = p_id and x.centre_id = me for update;
    if not found then
      raise exception 'We could not find that season' using errcode = 'P0002';
    end if;
    if (p_starts <> s.starts_on or p_weeks <> s.weeks) then
      if today >= s.starts_on then
        raise exception 'The dates cannot change once the season has begun' using errcode = '22023';
      end if;
      if exists (select 1 from public.circles c where c.season_id = s.id and c.status = 'approved') then
        raise exception 'Circles are already approved for this season. Moving its dates would change their first meetings' using errcode = '22023';
      end if;
    end if;
  end if;

  select x.name into v_clash from public.seasons x
   where x.centre_id = me and x.id is distinct from p_id and x.starts_on <= v_ends and x.ends_on >= p_starts limit 1;
  if found then
    raise exception 'These dates overlap %', v_clash using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.seasons (centre_id, name, starts_on, ends_on, weeks, sermon_series, status)
    values (me, v_name, p_starts, v_ends, p_weeks, v_series, 'planning')
    returning id into v_id;
    perform public.write_event(uid, 'season.created', 'season', v_id::text,
      jsonb_build_object('starts_on', p_starts, 'weeks', p_weeks));
  else
    update public.seasons
       set name = v_name, starts_on = p_starts, ends_on = v_ends, weeks = p_weeks, sermon_series = v_series
     where id = p_id;
    v_id := p_id;
    perform public.write_event(uid, 'season.saved', 'season', v_id::text,
      jsonb_build_object('starts_on', p_starts, 'weeks', p_weeks));
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- planning (circle cards and the member form take their season from the one being prepared) > open > running > closed.
create function public.set_season_status(p_season uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me uuid := public.my_centre();
  s public.seasons%rowtype;
  order_ text[] := array['planning', 'open', 'running', 'closed'];
  v_other text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change seasons' using errcode = '42501';
  end if;
  if p_status is null or not (p_status = any (order_)) then
    raise exception 'Choose planning, open, running or closed' using errcode = '22023';
  end if;
  select * into s from public.seasons x where x.id = p_season and x.centre_id = me for update;
  if not found then
    raise exception 'We could not find that season' using errcode = 'P0002';
  end if;
  if s.status::text = p_status then
    return jsonb_build_object('id', s.id, 'status', s.status);
  end if;
  if s.status = 'closed' then
    raise exception 'A closed season stays closed. Its results are kept as they are' using errcode = '22023';
  end if;
  if array_position(order_, p_status) < array_position(order_, s.status::text)
     and not (s.status = 'open' and p_status = 'planning') then
    raise exception 'A season only moves forward' using errcode = '22023';
  end if;
  if p_status = 'running' then
    select x.name into v_other from public.seasons x where x.centre_id = me and x.status = 'running' and x.id <> s.id limit 1;
    if found then
      raise exception '% is still running. Close it first', v_other using errcode = '22023';
    end if;
  end if;
  if p_status in ('planning', 'open') then
    select x.name into v_other from public.seasons x
     where x.centre_id = me and x.status in ('planning', 'open') and x.id <> s.id limit 1;
    if found then
      raise exception '% is still being prepared. Only one season can be prepared at a time', v_other using errcode = '22023';
    end if;
  end if;

  update public.seasons set status = p_status::public.season_status where id = s.id;
  perform public.write_event(uid, 'season.status', 'season', s.id::text,
    jsonb_build_object('from', s.status, 'to', p_status));
  return jsonb_build_object('id', s.id, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

create table public.goal_write_in_dismissals (
  norm text primary key check (char_length(norm) between 1 and 200),
  dismissed_by uuid references public.people (id) on delete set null,
  dismissed_at timestamptz not null default now()
);
alter table public.goal_write_in_dismissals enable row level security;
-- No grants: only the functions touch this table.

create function public.admin_catalogue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  cur uuid := public.dashboard_season(null);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the catalogue' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'teens_allowed', public.platform_flag('teen_track'),
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'slug', t.slug, 'name', t.name, 'description', t.description, 'active', t.active,
               'goals', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', g.id, 'title', g.title, 'family_id', g.family_id, 'family', f.name, 'active', g.active,
                          'picked', (select count(*) from public.member_profiles mp
                                      join public.people pe on pe.id = mp.person_id and pe.centre_id = me
                                     where mp.season_goal_id = g.id and mp.season_id is not distinct from cur),
                          'ever', (select count(*) from public.member_profiles mp
                                    join public.people pe on pe.id = mp.person_id and pe.centre_id = me
                                   where mp.season_goal_id = g.id),
                          'circles', (select count(*) from public.circles c
                                       join public.seasons s on s.id = c.season_id and s.centre_id = me
                                      where c.season_goal_id = g.id and c.status <> 'closed'))
                        order by g.active desc, g.sort, g.title)
                   from public.season_goals g join public.goal_families f on f.id = g.family_id
                  where g.tribe_id = t.id), '[]'::jsonb))
             order by t.active desc, t.sort, t.name)
        from public.tribes t), '[]'::jsonb),
    'families', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', f.name,
               'goals', (select count(*) from public.season_goals g where g.family_id = f.id))
             order by f.sort, f.name)
        from public.goal_families f), '[]'::jsonb),
    'tracks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'slug', k.slug, 'name', k.name, 'description', k.description,
               'min_age', k.min_age, 'max_age', k.max_age, 'active', k.active,
               'ranges', coalesce((select jsonb_agg(a.label order by a.sort) from public.age_ranges a where a.track_id = k.id), '[]'::jsonb))
             order by k.sort)
        from public.tracks k), '[]'::jsonb));
end;
$$;

create function public.save_tribe(p_id uuid, p_name text, p_description text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text;
  v_desc text;
  v_base text;
  v_slug text;
  i integer := 1;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  v_name := public.admin_text(p_name, 'The tribe name', 3, 60);
  v_desc := public.admin_text(p_description, 'The description', 0, 300);
  if exists (select 1 from public.tribes t where lower(t.name) = lower(v_name) and t.id is distinct from p_id) then
    raise exception 'There is already a tribe with that name' using errcode = '22023';
  end if;

  if p_id is null then
    v_base := public.make_slug(v_name);
    if v_base = '' then v_base := 'tribe'; end if;
    v_slug := v_base;
    while exists (select 1 from public.tribes t where t.slug = v_slug) loop
      i := i + 1;
      v_slug := v_base || '-' || i;
    end loop;
    insert into public.tribes (slug, name, description, sort, active)
    values (v_slug, v_name, v_desc, coalesce((select max(sort) from public.tribes), 0) + 10, coalesce(p_active, true))
    returning id into v_id;
    perform public.write_event(uid, 'tribe.created', 'tribe', v_id::text, jsonb_build_object('name', v_name));
  else
    if coalesce(p_active, true) = false
       and (select count(*) from public.tribes t where t.active and t.id <> p_id) = 0 then
      raise exception 'At least one tribe must stay open' using errcode = '22023';
    end if;
    update public.tribes set name = v_name, description = v_desc, active = coalesce(p_active, active) where id = p_id;
    if not found then
      raise exception 'We could not find that tribe' using errcode = 'P0002';
    end if;
    v_id := p_id;
    perform public.write_event(uid, 'tribe.saved', 'tribe', v_id::text,
      jsonb_build_object('name', v_name, 'active', coalesce(p_active, true)));
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.save_goal_family(p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_name text;
  v_base text;
  v_slug text;
  i integer := 1;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  v_name := public.admin_text(p_name, 'The family name', 3, 60);
  if exists (select 1 from public.goal_families f where lower(f.name) = lower(v_name) and f.id is distinct from p_id) then
    raise exception 'There is already a family with that name' using errcode = '22023';
  end if;
  if p_id is null then
    v_base := public.make_slug(v_name);
    if v_base = '' then v_base := 'family'; end if;
    v_slug := v_base;
    while exists (select 1 from public.goal_families f where f.slug = v_slug) loop
      i := i + 1;
      v_slug := v_base || '-' || i;
    end loop;
    insert into public.goal_families (slug, name, sort)
    values (v_slug, v_name, coalesce((select max(sort) from public.goal_families), 0) + 10)
    returning id into v_id;
  else
    update public.goal_families set name = v_name where id = p_id;
    if not found then
      raise exception 'We could not find that family' using errcode = 'P0002';
    end if;
    v_id := p_id;
  end if;
  perform public.write_event(uid, 'goal_family.saved', 'goal_family', v_id::text, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id);
end;
$$;

-- Creates (p_id null) or edits a Season Goal. Used by the screen and by adopting a write-in.
create function public.save_goal(p_id uuid, p_tribe uuid, p_family uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_title text;
  v_base text;
  v_slug text;
  i integer := 1;
  v_id uuid;
  old public.season_goals%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  v_title := public.admin_text(p_title, 'The goal', 6, 100);
  if not exists (select 1 from public.tribes t where t.id = p_tribe) then
    raise exception 'Choose the tribe this goal belongs to' using errcode = '22023';
  end if;
  if not exists (select 1 from public.goal_families f where f.id = p_family) then
    raise exception 'Choose the family this goal belongs to' using errcode = '22023';
  end if;
  if exists (select 1 from public.season_goals g
              where g.tribe_id = p_tribe and lower(g.title) = lower(v_title) and g.id is distinct from p_id) then
    raise exception 'This tribe already has a goal with that title' using errcode = '22023';
  end if;

  if p_id is null then
    v_base := public.make_slug(v_title);
    if v_base = '' then v_base := 'goal'; end if;
    v_slug := v_base;
    while exists (select 1 from public.season_goals g where g.slug = v_slug) loop
      i := i + 1;
      v_slug := v_base || '-' || i;
    end loop;
    insert into public.season_goals (tribe_id, family_id, slug, title, sort, active)
    values (p_tribe, p_family, v_slug, v_title,
            coalesce((select max(sort) from public.season_goals g where g.tribe_id = p_tribe), 0) + 10, true)
    returning id into v_id;
    perform public.write_event(uid, 'goal.created', 'season_goal', v_id::text, jsonb_build_object('title', v_title));
  else
    select * into old from public.season_goals g where g.id = p_id for update;
    if not found then
      raise exception 'We could not find that goal' using errcode = 'P0002';
    end if;
    -- A goal that members or circles already rest on keeps its tribe: their records point at the pair.
    if old.tribe_id <> p_tribe and (
         exists (select 1 from public.member_profiles mp where mp.season_goal_id = p_id)
         or exists (select 1 from public.circles c where c.season_goal_id = p_id)) then
      raise exception 'Members or circles already use this goal, so it cannot move to another tribe. Retire it and add a new one' using errcode = '22023';
    end if;
    update public.season_goals set tribe_id = p_tribe, family_id = p_family, title = v_title where id = p_id;
    v_id := p_id;
    perform public.write_event(uid, 'goal.saved', 'season_goal', v_id::text, jsonb_build_object('title', v_title));
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.set_goal_active(p_id uuid, p_active boolean)
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
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  update public.season_goals set active = coalesce(p_active, true) where id = p_id;
  if not found then
    raise exception 'We could not find that goal' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, case when coalesce(p_active, true) then 'goal.restored' else 'goal.retired' end,
    'season_goal', p_id::text, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'active', coalesce(p_active, true));
end;
$$;

-- Opens or closes an age track to new sign-ups. The teen track also needs the platform switch (docs/TEENS.md).
create function public.set_track_active(p_id uuid, p_active boolean)
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
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can open or close a track' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tracks k where k.id = p_id) then
    raise exception 'We could not find that track' using errcode = 'P0002';
  end if;
  if coalesce(p_active, true) = false
     and (select count(*) from public.tracks k where k.active and k.id <> p_id) = 0 then
    raise exception 'At least one track must stay open' using errcode = '22023';
  end if;
  update public.tracks set active = coalesce(p_active, true) where id = p_id;  -- the teen guard may refuse
  perform public.write_event(uid, case when coalesce(p_active, true) then 'track.opened' else 'track.closed' end,
    'track', p_id::text, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'active', coalesce(p_active, true));
end;
$$;

-- Goals members typed in their own words. Only wording shared by at least p_min people is shown, so one person's
-- sentence is never singled out.
create function public.goal_write_ins(p_min integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  m integer := least(greatest(coalesce(p_min, 2), 1), 20);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see what members wrote in' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('text', x.text, 'tribe_id', x.tribe_id, 'tribe', x.tribe, 'count', x.n) order by x.n desc, x.text)
      from (
        select min(btrim(mp.goal_other)) as text, mp.tribe_id, t.name as tribe, count(*) as n
          from public.member_profiles mp
          join public.people pe on pe.id = mp.person_id and pe.centre_id = me
          left join public.tribes t on t.id = mp.tribe_id
         where mp.season_goal_id is null and btrim(coalesce(mp.goal_other, '')) <> ''
           and not exists (select 1 from public.goal_write_in_dismissals d where d.norm = lower(btrim(mp.goal_other)))
           and not exists (select 1 from public.season_goals g where lower(g.title) = lower(btrim(mp.goal_other)))
         group by lower(btrim(mp.goal_other)), mp.tribe_id, t.name
        having count(*) >= m
         order by count(*) desc, min(btrim(mp.goal_other))
         limit 60) x), '[]'::jsonb);
end;
$$;

-- Adds a write-in to the catalogue (with the title the team settled on) and takes it off the list.
create function public.adopt_write_in(p_text text, p_tribe uuid, p_family uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_norm text := lower(btrim(coalesce(p_text, '')));
  r jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  if v_norm = '' or char_length(v_norm) > 200 then
    raise exception 'We could not find that wording' using errcode = '22023';
  end if;
  r := public.save_goal(null, p_tribe, p_family, p_title);
  insert into public.goal_write_in_dismissals (norm, dismissed_by) values (v_norm, uid) on conflict do nothing;
  perform public.write_event(uid, 'goal.adopted', 'season_goal', r ->> 'id', '{}'::jsonb);
  return r;
end;
$$;

create function public.dismiss_write_in(p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_norm text := lower(btrim(coalesce(p_text, '')));
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin and directors can change the catalogue' using errcode = '42501';
  end if;
  if v_norm = '' or char_length(v_norm) > 200 then
    raise exception 'We could not find that wording' using errcode = '22023';
  end if;
  insert into public.goal_write_in_dismissals (norm, dismissed_by) values (v_norm, uid) on conflict do nothing;
  perform public.write_event(uid, 'goal.write_in_dismissed', 'season_goal', null, '{}'::jsonb);
end;
$$;

-- A retired goal or tribe cannot be chosen in the member form. People who chose it before keep it: saving the form
-- again (an upsert reaches this trigger as an insert) is fine as long as their goal or tribe is the one they already had.
create function public.profile_catalogue_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.season_goal_id is not null and (tg_op = 'INSERT' or new.season_goal_id is distinct from old.season_goal_id) then
    if not exists (select 1 from public.season_goals g where g.id = new.season_goal_id and g.active)
       and not exists (select 1 from public.member_profiles p where p.person_id = new.person_id and p.season_goal_id = new.season_goal_id) then
      raise exception 'That goal has been retired. Choose another' using errcode = '22023';
    end if;
  end if;
  if new.tribe_id is not null and (tg_op = 'INSERT' or new.tribe_id is distinct from old.tribe_id) then
    if not exists (select 1 from public.tribes t where t.id = new.tribe_id and t.active)
       and not exists (select 1 from public.member_profiles p where p.person_id = new.person_id and p.tribe_id = new.tribe_id) then
      raise exception 'That tribe is no longer available. Choose another' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger member_profiles_catalogue_guard before insert or update on public.member_profiles
  for each row execute function public.profile_catalogue_guard();

-- ---------------------------------------------------------------------------
-- The twelve weekly guides
-- ---------------------------------------------------------------------------

alter table public.week_guides
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.people (id) on delete set null;

create function public.admin_guides()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the guides' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]),
    'guides', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage,
               'sermon_series', g.sermon_series, 'sermon_title', g.sermon_title,
               'reviewed_at', g.reviewed_at,
               'reviewed_by', case when g.reviewed_by is null then null else public.person_display_name(g.reviewed_by) end)
             order by g.week)
        from public.week_guides g), '[]'::jsonb));
end;
$$;

create function public.admin_guide(p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.week_guides%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the guides' using errcode = '42501';
  end if;
  select * into g from public.week_guides x where x.week = p_week;
  if not found then
    raise exception 'We could not find that week' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'can_edit', public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]),
    'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage,
    'sermon_series', g.sermon_series, 'sermon_title', g.sermon_title,
    'big_idea', g.big_idea, 'opening_question', g.opening_question, 'questions', to_jsonb(g.questions),
    'practice', g.practice, 'step_hint', g.step_hint, 'prayer', g.prayer, 'confession', g.confession,
    'leader_tip', g.leader_tip, 'word_how', g.plan -> 1 ->> 'how', 'talk_how', g.plan -> 2 ->> 'how',
    'reviewed_at', g.reviewed_at,
    'reviewed_by', case when g.reviewed_by is null then null else public.person_display_name(g.reviewed_by) end);
end;
$$;

-- Saves a guide. Saving it also marks it as read and approved by the person who saved it.
-- Circles read the guide live, so every circle sees the change at once; messages already sent are not recalled.
create function public.save_week_guide(p_week integer, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.week_guides%rowtype;
  q jsonb := p_data -> 'questions';
  v_title text;
  v_passage text;
  v_series text;
  v_sermon text;
  v_idea text;
  v_open text;
  v_q text[];
  v_practice text;
  v_hint text;
  v_prayer text;
  v_confession text;
  v_tip text;
  v_word text;
  v_talk text;
  i integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can edit the guides' using errcode = '42501';
  end if;
  select * into g from public.week_guides x where x.week = p_week for update;
  if not found then
    raise exception 'We could not find that week' using errcode = 'P0002';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Nothing to save' using errcode = '22023';
  end if;

  v_title := public.admin_text(p_data ->> 'title', 'The title', 3, 120);
  v_passage := public.admin_text(p_data ->> 'passage', 'The passage', 3, 120);
  v_series := nullif(public.admin_text(p_data ->> 'sermon_series', 'The sermon series', 0, 120), '');
  v_sermon := nullif(public.admin_text(p_data ->> 'sermon_title', 'The sermon title', 0, 160), '');
  v_idea := public.admin_text(p_data ->> 'big_idea', 'The big idea', 10, 600);
  v_open := public.admin_text(p_data ->> 'opening_question', 'The opening question', 5, 200);
  if q is null or jsonb_typeof(q) <> 'array' or jsonb_array_length(q) <> 3 then
    raise exception 'There are three questions. Fill in all three' using errcode = '22023';
  end if;
  v_q := '{}';
  for i in 0 .. 2 loop
    v_q := v_q || public.admin_text(q ->> i, 'Question ' || (i + 1), 5, 300);
  end loop;
  v_practice := public.admin_text(p_data ->> 'practice', 'The practice', 5, 500);
  v_hint := public.admin_text(p_data ->> 'step_hint', 'The step example', 5, 300);
  v_prayer := public.admin_text(p_data ->> 'prayer', 'The prayer', 5, 500);
  v_confession := public.admin_text(p_data ->> 'confession', 'The confession', 10, 300);
  v_tip := public.admin_text(p_data ->> 'leader_tip', 'The leader tip', 5, 500);
  v_word := public.admin_text(p_data ->> 'word_how', 'How to lead The Word', 10, 800);
  v_talk := public.admin_text(p_data ->> 'talk_how', 'How to lead Talk it through', 10, 800);

  update public.week_guides
     set title = v_title, passage = v_passage, sermon_series = v_series, sermon_title = v_sermon,
         big_idea = v_idea, opening_question = v_open, questions = v_q, practice = v_practice,
         step_hint = v_hint, prayer = v_prayer, confession = v_confession, leader_tip = v_tip,
         plan = jsonb_set(jsonb_set(jsonb_set(plan, '{1,how}', to_jsonb(v_word)), '{2,how}', to_jsonb(v_talk)), '{4,how}', to_jsonb(v_prayer)),
         reviewed_at = now(), reviewed_by = uid
   where week = p_week;

  perform public.write_event(uid, 'guide.saved', 'week_guide', p_week::text, jsonb_build_object('week', p_week));
  return public.admin_guide(p_week);
end;
$$;

-- "I have read this week as it is, and it can go out."
create function public.mark_guide_reviewed(p_week integer)
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
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can approve the guides' using errcode = '42501';
  end if;
  update public.week_guides set reviewed_at = now(), reviewed_by = uid where week = p_week;
  if not found then
    raise exception 'We could not find that week' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'guide.reviewed', 'week_guide', p_week::text, jsonb_build_object('week', p_week));
  return public.admin_guide(p_week);
end;
$$;

-- ---------------------------------------------------------------------------
-- The tribe layer of the guides: a skill-share prompt per tribe, step ideas per goal. Phase 1 is weeks 1-4,
-- phase 2 weeks 5-8, phase 3 weeks 9-12.
-- ---------------------------------------------------------------------------

create function public.admin_layers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the guides' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_edit', public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]),
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'active', t.active,
               'prompts', (select jsonb_agg((select p.skill_share from public.tribe_prompts p where p.tribe_id = t.id and p.phase = ph) order by ph)
                             from generate_series(1, 3) ph),
               'goals', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', g.id, 'title', g.title,
                          'ideas', (select jsonb_agg((select i.idea from public.goal_ideas i where i.season_goal_id = g.id and i.phase = ph) order by ph)
                                      from generate_series(1, 3) ph))
                        order by g.sort, g.title)
                   from public.season_goals g where g.tribe_id = t.id and g.active), '[]'::jsonb))
             order by t.active desc, t.sort, t.name)
        from public.tribes t), '[]'::jsonb));
end;
$$;

create function public.save_tribe_prompt(p_tribe uuid, p_phase integer, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v text := btrim(coalesce(p_text, ''));
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can edit the guides' using errcode = '42501';
  end if;
  if p_phase is null or p_phase not between 1 and 3 then
    raise exception 'Choose phase 1, 2 or 3' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tribes t where t.id = p_tribe) then
    raise exception 'We could not find that tribe' using errcode = 'P0002';
  end if;
  if v = '' then
    delete from public.tribe_prompts where tribe_id = p_tribe and phase = p_phase;
  else
    v := public.admin_text(v, 'The skill-share prompt', 10, 300);
    insert into public.tribe_prompts (tribe_id, phase, skill_share) values (p_tribe, p_phase, v)
    on conflict (tribe_id, phase) do update set skill_share = excluded.skill_share;
  end if;
  perform public.write_event(uid, 'guide.tribe_prompt', 'tribe', p_tribe::text, jsonb_build_object('phase', p_phase));
end;
$$;

create function public.save_goal_idea(p_goal uuid, p_phase integer, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v text := btrim(coalesce(p_text, ''));
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can edit the guides' using errcode = '42501';
  end if;
  if p_phase is null or p_phase not between 1 and 3 then
    raise exception 'Choose phase 1, 2 or 3' using errcode = '22023';
  end if;
  if not exists (select 1 from public.season_goals g where g.id = p_goal) then
    raise exception 'We could not find that goal' using errcode = 'P0002';
  end if;
  if v = '' then
    delete from public.goal_ideas where season_goal_id = p_goal and phase = p_phase;
  else
    v := public.admin_text(v, 'The step idea', 10, 300);
    insert into public.goal_ideas (season_goal_id, phase, idea) values (p_goal, p_phase, v)
    on conflict (season_goal_id, phase) do update set idea = excluded.idea;
  end if;
  perform public.write_event(uid, 'guide.goal_idea', 'season_goal', p_goal::text, jsonb_build_object('phase', p_phase));
end;
$$;

-- ---------------------------------------------------------------------------
-- People search (to appoint a tribe champion by name), platform status, and the launch checklist
-- ---------------------------------------------------------------------------

create function public.find_people(p_query text)
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
           and (position(q in lower(coalesce(p.full_name, ''))) > 0
                or position(q in lower(coalesce(p.preferred_name, ''))) > 0
                or position(q in lower(p.email)) > 0)
         order by coalesce(p.full_name, p.preferred_name, p.email)
         limit 8) x), '[]'::jsonb);
end;
$$;

create function public.platform_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the platform switches' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'flags', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'enabled', f.enabled, 'note', f.note) order by f.key)
                         from public.platform_flags f), '[]'::jsonb),
    'centres', (select count(*) from public.centres c where c.active));
end;
$$;

-- What is still missing before a season can open. Facts only: the screen turns them into sentences.
create function public.launch_checklist()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.my_centre();
  today date := public.today_lagos();
  s public.seasons%rowtype;
  v_season boolean;
  v_missing jsonb;
  v_reviewed integer;
  v_circles integer := 0;
  v_tokens integer;
  v_last timestamptz;
  v_tribes integer;
  v_covered integer;
  v_bi timestamptz;
  v_vision boolean;
  v_mission boolean;
  v_form boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;

  select * into s from public.seasons x
   where x.centre_id = me and x.status in ('planning', 'open', 'running') and x.ends_on >= today
   order by x.starts_on limit 1;
  v_season := found;
  if v_season then
    select count(*) into v_circles from public.circles c where c.season_id = s.id and c.status = 'approved';
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_missing
    from unnest(array['pastor', 'care_lead', 'data_lead', 'coach']) r
   where not exists (select 1 from public.person_roles pr where pr.centre_id = me and pr.role::text = r);

  select count(*) into v_reviewed from public.week_guides where reviewed_at is not null;
  select count(*), max(last_used_at) into v_tokens, v_last from public.worker_tokens where revoked_at is null;
  select count(*) into v_tribes from public.tribes where active;
  select count(distinct c.tribe_id) into v_covered
    from public.tribe_champions c join public.tribes t on t.id = c.tribe_id and t.active
    join public.people p on p.id = c.person_id and p.centre_id = me;
  select c.refreshed_at into v_bi from bi.config c;
  select exists (select 1 from public.centre_settings x where x.centre_id = me and x.key = 'vision') into v_vision;
  select exists (select 1 from public.centre_settings x where x.centre_id = me and x.key = 'mission') into v_mission;
  select exists (select 1 from public.centre_settings x where x.centre_id = me and x.key = 'testimony_form_url') into v_form;

  return jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('key', 'season', 'ok', v_season,
        'name', case when v_season then s.name end, 'starts_on', case when v_season then s.starts_on end,
        'status', case when v_season then s.status end),
      jsonb_build_object('key', 'team', 'ok', jsonb_array_length(v_missing) = 0, 'missing', v_missing),
      jsonb_build_object('key', 'words', 'ok', v_vision and v_mission, 'vision', v_vision, 'mission', v_mission),
      jsonb_build_object('key', 'guides', 'ok', v_reviewed = 12, 'reviewed', v_reviewed, 'of', 12),
      jsonb_build_object('key', 'circles', 'ok', v_circles > 0, 'approved', v_circles),
      jsonb_build_object('key', 'messages', 'ok', v_tokens > 0 and v_last is not null and v_last > now() - interval '2 days',
        'tokens', v_tokens, 'last_used_at', v_last),
      jsonb_build_object('key', 'champions', 'ok', v_tribes > 0 and v_covered >= v_tribes, 'covered', v_covered, 'of', v_tribes),
      jsonb_build_object('key', 'testimony_form', 'ok', v_form),
      jsonb_build_object('key', 'bi', 'ok', v_bi is not null, 'refreshed_at', v_bi)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.make_slug(text),
  public.admin_text(text, text, integer, integer),
  public.church_settings(),
  public.save_church_settings(text, text, text),
  public.admin_seasons(),
  public.save_season(uuid, text, date, integer, text),
  public.set_season_status(uuid, text),
  public.admin_catalogue(),
  public.save_tribe(uuid, text, text, boolean),
  public.save_goal_family(uuid, text),
  public.save_goal(uuid, uuid, uuid, text),
  public.set_goal_active(uuid, boolean),
  public.set_track_active(uuid, boolean),
  public.goal_write_ins(integer),
  public.adopt_write_in(text, uuid, uuid, text),
  public.dismiss_write_in(text),
  public.profile_catalogue_guard(),
  public.admin_guides(),
  public.admin_guide(integer),
  public.save_week_guide(integer, jsonb),
  public.mark_guide_reviewed(integer),
  public.admin_layers(),
  public.save_tribe_prompt(uuid, integer, text),
  public.save_goal_idea(uuid, integer, text),
  public.find_people(text),
  public.platform_status(),
  public.launch_checklist()
  from public, anon, authenticated;

grant execute on function
  public.church_settings(),
  public.save_church_settings(text, text, text),
  public.admin_seasons(),
  public.save_season(uuid, text, date, integer, text),
  public.set_season_status(uuid, text),
  public.admin_catalogue(),
  public.save_tribe(uuid, text, text, boolean),
  public.save_goal_family(uuid, text),
  public.save_goal(uuid, uuid, uuid, text),
  public.set_goal_active(uuid, boolean),
  public.set_track_active(uuid, boolean),
  public.goal_write_ins(integer),
  public.adopt_write_in(text, uuid, uuid, text),
  public.dismiss_write_in(text),
  public.admin_guides(),
  public.admin_guide(integer),
  public.save_week_guide(integer, jsonb),
  public.mark_guide_reviewed(integer),
  public.admin_layers(),
  public.save_tribe_prompt(uuid, integer, text),
  public.save_goal_idea(uuid, integer, text),
  public.find_people(text),
  public.platform_status(),
  public.launch_checklist()
  to authenticated;

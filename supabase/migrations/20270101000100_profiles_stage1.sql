-- =============================================================================
-- United Tribes: Profiles and the Weekly Rhythm, stage 1 (the foundations, and the fix for appointed leaders' age and stage)
--
-- What this adds, and nothing else. Every function and table is new. No existing function body, table definition or default changes.
--
--   The Switchboard   one place, God Mode -> Features, where each new function is Off, Rehearsal, Limited or On, at five scopes
--                     (platform, centre, community, tribe, person), with a Master pause, a reason on every opening and a log.
--                     Everything starts Off. If the settings cannot be read, everything new is Off and the platform behaves as before.
--   The facts store   one dated, signed record for each personal fact the church holds that other people may type: the person
--                     owns it, the office may only propose a value, and a value counts as confirmed only when the person says so.
--   Details Check     God Mode asks a person to confirm a fact. The message carries no personal fact; it links to a private page
--                     that asks the person for a six-digit code (or one tap when they are signed in) and puts one question.
--   Stage review      a change that touches other people (a leader with members changing their stage) waits for the pastor of the
--                     person's centre. Nobody is moved automatically.
--   My page (first layer)   the leader's strip: "We have you down as 26 to 40, the Builders stage. Is that right?"
--
-- What it never does: it does not change a member's tribe, a Tribe Card's text, a Readiness Score, matching, placement, a report
-- or a reminder while its switches are Off. A test builds a cast of people, records what matching, tribe lists, reminders,
-- readiness and exports say about them, and fails if one character differs with these functions Off.
--
-- Who can use it: the platform owner (God Mode) sets every switch and runs the Details Check. A person answers about themselves. A
-- pastor, director or admin of the person's centre decides a stage review. Nobody else can do anything here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The Switchboard: what exists
-- ---------------------------------------------------------------------------
-- One row for each function the blueprint lists. `available` is true only for what this release builds; a later function is listed so
-- the page shows the whole road, and it cannot be moved from Off until its stage ships.
create table public.feature_registry (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  blurb text not null,
  stage smallint not null check (stage between 1 and 6),
  depends text[] not null default '{}',
  -- The positions the function can take. A function with an Optional or Required position is one that holds something back.
  modes text[] not null default array['off', 'rehearsal', 'on'],
  default_mode text not null default 'off',
  available boolean not null default false,
  sort smallint not null,
  check (default_mode = any (modes))
);
alter table public.feature_registry enable row level security;
revoke all on table public.feature_registry from public, anon, authenticated;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort) values
  ('my_page', 'My page (facts and role panels)', 'A page where a person sees the facts the church holds about them and confirms them. In this release: leaders only.', 1, '{}', array['off', 'rehearsal', 'on'], 'off', true, 1),
  ('details_check', 'Details Check from God Mode', 'The office asks a person to confirm a fact; the person answers. Rehearsal writes what would be sent and sends nothing.', 1, array['my_page'], array['off', 'rehearsal', 'on'], 'off', true, 2),
  ('hold_card', 'Hold the Tribe Card until the leader''s stage is confirmed', 'Optional: a pastor sees that the stage is not yet confirmed. Required: a pastor cannot approve the card until it is.', 1, array['details_check'], array['off', 'optional', 'required'], 'optional', true, 3),
  ('photos', 'Profile photos', 'An optional photo for everyone, shown only as widely as the person chooses.', 3, array['my_page'], array['off', 'rehearsal', 'on'], 'off', false, 4),
  ('visibility', 'Visibility levels', 'Five levels from Only me to Whole church. Private until the person widens it.', 3, array['photos'], array['off', 'rehearsal', 'on'], 'off', false, 5),
  ('our_tribe', 'Our Tribe page', 'Members see the cards of those in their tribe who chose to share.', 4, array['visibility'], array['off', 'rehearsal', 'on'], 'off', false, 6),
  ('encourage', 'Encourage', 'Five fixed, kind phrases; no free text.', 4, array['our_tribe'], array['off', 'rehearsal', 'on'], 'off', false, 7),
  ('week_line', 'This week''s line', 'An optional sentence a person may share with their tribe; gone after seven days.', 4, array['our_tribe'], array['off', 'rehearsal', 'on'], 'off', false, 8),
  ('directory', 'Directory', 'A church-wide search of people. Held back for at least one season.', 4, array['visibility'], array['off', 'rehearsal', 'on'], 'off', false, 9),
  ('weekly_rhythm', 'Weekly rhythm', 'The day-before cue, one tap, and twelve dots.', 5, '{}', array['off', 'rehearsal', 'on'], 'off', false, 10),
  ('thanks', 'Notes of thanks', 'A completed sentence from one tribe member to another.', 5, array['our_tribe'], array['off', 'rehearsal', 'on'], 'off', false, 11),
  ('fruit', 'Tribe Fruit', 'A shared picture that grows from acts of love; never a ranking.', 5, array['encourage', 'thanks'], array['off', 'rehearsal', 'on'], 'off', false, 12),
  ('personal_fruit', 'Personal Fruit', 'A private look at one''s own season.', 5, array['fruit'], array['off', 'rehearsal', 'on'], 'off', false, 13),
  ('pulse', 'Belonging pulse', 'One question at weeks 4 and 8; a leader sees only an average of five or more.', 5, '{}', array['off', 'rehearsal', 'on'], 'off', false, 14),
  ('shepherd_hour', 'Shepherd''s hour', 'Fifteen minutes a week for a leader, built on This week.', 6, '{}', array['off', 'rehearsal', 'on'], 'off', false, 15),
  ('coach_card', 'Coach card', 'A short card to prompt a coach''s conversation. After one season of the Shepherd''s hour.', 6, array['shepherd_hour', 'pulse'], array['off', 'rehearsal', 'on'], 'off', false, 16),
  ('rest_week', 'Rest week', 'A leader tells the tribe there is no meeting this week.', 6, '{}', array['off', 'rehearsal', 'on'], 'off', false, 17);

-- ---------------------------------------------------------------------------
-- The rules, the Master pause, the log
-- ---------------------------------------------------------------------------
create table public.feature_settings (
  id uuid primary key default gen_random_uuid(),
  feature text not null references public.feature_registry (key),
  scope text not null check (scope in ('platform', 'centre', 'community', 'tribe', 'person')),
  scope_id uuid,
  position text not null check (position in ('off', 'rehearsal', 'on', 'optional', 'required')),
  -- Empty: everyone the scope reaches. Otherwise only people who hold one of these roles ("On for leaders").
  roles text[] not null default '{}',
  -- A rule that opens a function for a community or the whole church may hold back one tribe in ten until this day (never a tribe of
  -- young people). It is Off unless the owner sets a day.
  holdout_until date,
  reason text check (char_length(reason) <= 300),
  set_by uuid references public.people (id) on delete set null,
  set_at timestamptz not null default now(),
  check ((scope = 'platform') = (scope_id is null))
);
create unique index feature_settings_one_rule on public.feature_settings (feature, scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index feature_settings_feature_idx on public.feature_settings (feature);
alter table public.feature_settings enable row level security;
revoke all on table public.feature_settings from public, anon, authenticated;

-- One row. While it says paused, every new function is Off for everyone. Nothing is deleted; pressing it again puts everything back.
create table public.feature_master (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.feature_master (id) values (true);
alter table public.feature_master enable row level security;
revoke all on table public.feature_master from public, anon, authenticated;

create table public.feature_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The platform owner. Anyone else who reads the log is told "an administrator".
  actor uuid references public.people (id) on delete set null,
  -- Null for the Master pause
  feature text,
  scope text,
  scope_id uuid,
  scope_label text,
  old_position text,
  new_position text,
  roles text[] not null default '{}',
  reason text check (char_length(reason) <= 300)
);
create index feature_log_at_idx on public.feature_log (at desc);
alter table public.feature_log enable row level security;
revoke all on table public.feature_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- How the platform decides, every time
-- ---------------------------------------------------------------------------
-- How far a position opens a function: nothing, a rehearsal (it runs and writes down what would happen), or live.
create function public.feature_rank(p_position text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_position when 'rehearsal' then 1 when 'on' then 2 when 'optional' then 2 when 'required' then 2 else 0 end;
$$;

-- The rule that applies to this person for this function: the narrowest wins (person, tribe, community, centre, platform). A rule that
-- names roles applies only to people who hold one of them. All fields are null when no rule applies. Not callable by anyone.
create function public.feature_rule_for(p_key text, p_person uuid)
returns public.feature_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.feature_settings;
  v_centre uuid;
  v_tribes uuid[];
  v_communities uuid[];
  v_roles text[];
begin
  select p.centre_id into v_centre from public.people p where p.id = p_person;
  select coalesce(array_agg(distinct t.id), '{}'), coalesce(array_agg(distinct t.community_id) filter (where t.community_id is not null), '{}')
    into v_tribes, v_communities
    from public.tribes t
   where t.status <> 'closed'
     and (t.leader_id = p_person or t.assistant_id = p_person
          or exists (select 1 from public.tribe_members m where m.tribe_id = t.id and m.person_id = p_person and m.status = 'active'));
  select coalesce(array_agg(pr.role::text), '{}') into v_roles from public.person_roles pr where pr.person_id = p_person;
  select s.* into r
    from public.feature_settings s
   where s.feature = p_key
     and (s.roles = '{}' or s.roles && v_roles)
     and ((s.scope = 'person' and s.scope_id = p_person)
       or (s.scope = 'tribe' and s.scope_id = any (v_tribes))
       or (s.scope = 'community' and s.scope_id = any (v_communities))
       or (s.scope = 'centre' and s.scope_id = v_centre)
       or s.scope = 'platform')
   order by case s.scope when 'person' then 1 when 'tribe' then 2 when 'community' then 3 when 'centre' then 4 else 5 end, s.set_at desc
   limit 1;
  return r;
end;
$$;

-- The one tribe in ten that is held back while a rule's hold-out day has not passed. A fixed rule, not a hand-picked list; never a tribe
-- of young people. True when any tribe the person belongs to or leads is held back.
create function public.feature_held_back(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tribes t
      left join public.tracks k on k.id = t.track_id
     where t.status <> 'closed'
       and (t.leader_id = p_person or t.assistant_id = p_person
            or exists (select 1 from public.tribe_members m where m.tribe_id = t.id and m.person_id = p_person and m.status = 'active'))
       and coalesce(k.min_age, 18) >= 18
       and abs(hashtextextended(t.id::text, 0)) % 10 = 0);
$$;

-- The answer to "is this function on for this person?": 'off', 'rehearsal', 'on', or for the hold function 'optional' / 'required'.
-- Master pause, then the narrowest rule, then the hold-out, then every function it depends on. Anything that goes wrong is 'off'.
-- Not callable by anyone: the screens use feature_state() and my_features(), other functions use this.
create function public.feature_state_of(p_key text, p_person uuid, p_depth integer default 0)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.feature_registry;
  r public.feature_settings;
  v_pos text;
  d text;
  v_dep text;
begin
  if p_person is null or p_depth > 4 then
    return 'off';
  end if;
  if coalesce((select m.paused from public.feature_master m where m.id), true) then
    return 'off';
  end if;
  select * into f from public.feature_registry x where x.key = p_key;
  if not found or not f.available then
    return 'off';
  end if;
  r := public.feature_rule_for(p_key, p_person);
  v_pos := coalesce(r.position, f.default_mode);
  if not (v_pos = any (f.modes)) or v_pos = 'off' then
    return 'off';
  end if;
  if r.id is not null and r.holdout_until is not null and public.today_lagos() <= r.holdout_until and public.feature_held_back(p_person) then
    return 'off';
  end if;
  foreach d in array f.depends loop
    v_dep := public.feature_state_of(d, p_person, p_depth + 1);
    if public.feature_rank(v_dep) < public.feature_rank(v_pos) then
      -- A function cannot be further open than the one it needs. A rehearsal can follow a rehearsal; anything else stops.
      if public.feature_rank(v_dep) = 1 and 'rehearsal' = any (f.modes) then
        v_pos := 'rehearsal';
      else
        return 'off';
      end if;
    end if;
  end loop;
  return v_pos;
exception when others then
  return 'off';
end;
$$;

-- What a screen asks. A person may ask only about themselves; anything else, and any fault, is 'off'.
create function public.feature_state(p_key text, p_person uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or (p_person is not null and p_person <> me) then
    return 'off';
  end if;
  return public.feature_state_of(p_key, me);
exception when others then
  return 'off';
end;
$$;

-- All the functions this release builds, for the signed-in person, in one call. A screen calls this once.
create function public.my_features()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return '{}'::jsonb;
  end if;
  return coalesce((select jsonb_object_agg(f.key, public.feature_state_of(f.key, me)) from public.feature_registry f where f.available), '{}'::jsonb);
exception when others then
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's page
-- ---------------------------------------------------------------------------
-- A name for the log and the board: the scope in words.
create function public.feature_scope_label(p_scope text, p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_scope
    when 'platform' then 'The whole church'
    when 'centre' then (select c.name from public.centres c where c.id = p_id)
    when 'community' then (select c.name from public.communities c where c.id = p_id)
    when 'tribe' then (select coalesce(t.name, 'A tribe') from public.tribes t where t.id = p_id)
    when 'person' then (select coalesce(nullif(btrim(p.full_name), ''), p.email) from public.people p where p.id = p_id)
  end;
$$;

-- How one function stands, in one word: off, rehearsal, limited (on, but for named scopes or roles only), on, or the hold function's mode.
create function public.feature_summary(p_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.feature_registry;
  v_platform public.feature_settings;
begin
  select * into f from public.feature_registry x where x.key = p_key;
  if not found then
    return 'off';
  end if;
  select * into v_platform from public.feature_settings s where s.feature = p_key and s.scope = 'platform';
  if f.key = 'hold_card' then
    if exists (select 1 from public.feature_settings s where s.feature = p_key and s.position = 'required') then
      return case when v_platform.position = 'required' and v_platform.roles = '{}' then 'required' else 'limited' end;
    end if;
    if exists (select 1 from public.feature_settings s where s.feature = p_key) then
      return (select case when bool_or(s.position = 'optional') then 'optional' else 'off' end from public.feature_settings s where s.feature = p_key);
    end if;
    -- No rule of its own: it follows what it depends on. While the Details check is Off or only in Rehearsal nothing is held, so the board says Off
    -- (the default only means something once the Details check is open).
    return case when public.feature_summary('details_check') in ('on', 'limited') then f.default_mode else 'off' end;
  end if;
  if v_platform.position = 'on' and v_platform.roles = '{}' then
    return 'on';
  end if;
  if exists (select 1 from public.feature_settings s where s.feature = p_key and s.position = 'on') then
    return 'limited';
  end if;
  if exists (select 1 from public.feature_settings s where s.feature = p_key and s.position = 'rehearsal') then
    return 'rehearsal';
  end if;
  return 'off';
end;
$$;

-- The whole Features page: the pause, each function with its rules and what it needs. Names the owner is never in it.
create function public.god_feature_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.feature_master;
begin
  perform public.god_only();
  select * into m from public.feature_master x where x.id;
  return jsonb_build_object(
    'paused', m.paused, 'pausedReason', m.reason, 'pausedAt', m.changed_at,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'name', f.name, 'blurb', f.blurb, 'stage', f.stage, 'depends', to_jsonb(f.depends), 'modes', to_jsonb(f.modes),
               'default', f.default_mode, 'available', f.available, 'summary', public.feature_summary(f.key),
               'rules', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'scope', s.scope, 'scopeId', s.scope_id, 'label', public.feature_scope_label(s.scope, s.scope_id),
                          'position', s.position, 'roles', to_jsonb(s.roles), 'reason', s.reason, 'holdoutUntil', s.holdout_until, 'at', s.set_at)
                        order by case s.scope when 'platform' then 1 when 'centre' then 2 when 'community' then 3 when 'tribe' then 4 else 5 end, s.set_at)
                         from public.feature_settings s where s.feature = f.key), '[]'::jsonb))
             order by f.sort)
        from public.feature_registry f), '[]'::jsonb));
end;
$$;

-- Finds a centre, community, tribe or person to name as a scope. Never more than eight.
create function public.god_feature_find(p_scope text, p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_q, ''));
begin
  perform public.god_only();
  if p_scope not in ('centre', 'community', 'tribe', 'person') then
    raise exception 'Choose centre, community, tribe or person' using errcode = '22023';
  end if;
  if p_scope = 'centre' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name) order by c.name) from public.centres c where c.active), '[]'::jsonb);
  end if;
  if p_scope = 'community' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name) order by c.name) from public.communities c where c.active), '[]'::jsonb);
  end if;
  if char_length(q) < 2 then
    return '[]'::jsonb;
  end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  if p_scope = 'tribe' then
    return coalesce((select jsonb_agg(x.o order by x.nm) from (
      select t.name as nm, jsonb_build_object('id', t.id, 'label', coalesce(t.name, 'A tribe') || ' (' || coalesce(nullif(btrim(l.full_name), ''), l.email) || ')') as o
        from public.tribes t join public.people l on l.id = t.leader_id
       where t.status <> 'closed' and (t.name ilike '%' || q || '%' escape '\' or l.full_name ilike '%' || q || '%' escape '\')
       order by t.name limit 8) x), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(x.o order by x.nm) from (
    select coalesce(p.full_name, p.email) as nm, jsonb_build_object('id', p.id, 'label', coalesce(nullif(btrim(p.full_name), ''), p.email)) as o
      from public.people p
     where not p.hidden and not exists (select 1 from public.platform_owner o where o.person_id = p.id)
       and (p.full_name ilike '%' || q || '%' escape '\' or p.preferred_name ilike '%' || q || '%' escape '\' or p.email ilike '%' || q || '%' escape '\')
     order by coalesce(p.full_name, p.email) limit 8) x), '[]'::jsonb);
end;
$$;

-- What one position at one scope would be, for the dependency check: the rule at that exact scope, else the one for the whole church, else
-- the function's own start. A tribe, community or centre rule is compared with the church-wide rule beneath it.
create function public.feature_position_at(p_key text, p_scope text, p_scope_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.position from public.feature_settings s where s.feature = p_key and s.scope = p_scope and s.scope_id is not distinct from p_scope_id),
    (select s.position from public.feature_settings s where s.feature = p_key and s.scope = 'platform'),
    (select f.default_mode from public.feature_registry f where f.key = p_key),
    'off');
$$;

-- Moves one function at one scope. Refuses a combination that makes no sense, and says why in words.
create function public.god_feature_set(
  p_feature text,
  p_scope text,
  p_scope_id uuid,
  p_position text,
  p_roles text[] default '{}',
  p_reason text default null,
  p_holdout_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  f public.feature_registry;
  d public.feature_registry;
  old public.feature_settings;
  v_roles text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_roles, '{}')) x where x is not null), '{}');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_rank integer;
  v_other integer;
  v_label text;
  r text;
begin
  perform public.god_only();
  select * into f from public.feature_registry x where x.key = p_feature;
  if not found then
    raise exception 'We do not have that function' using errcode = '22023';
  end if;
  if not f.available then
    raise exception '% arrives in stage %. It cannot be moved until then', f.name, f.stage using errcode = '22023';
  end if;
  if p_scope not in ('platform', 'centre', 'community', 'tribe', 'person') then
    raise exception 'Choose the whole church, a centre, a community, a tribe or a person' using errcode = '22023';
  end if;
  if (p_scope = 'platform') <> (p_scope_id is null) then
    raise exception 'Name the %', case p_scope when 'platform' then 'church by leaving the scope empty' else p_scope end using errcode = '22023';
  end if;
  v_label := public.feature_scope_label(p_scope, p_scope_id);
  if v_label is null then
    raise exception 'We could not find that %', p_scope using errcode = '22023';
  end if;
  if p_position is null or not (p_position = any (f.modes)) then
    raise exception 'That position is not one % can take. It can be: %', f.name, array_to_string(f.modes, ', ') using errcode = '22023';
  end if;
  foreach r in array v_roles loop
    if r not in ('member', 'leader', 'assistant_leader', 'coach', 'community_champion', 'care_lead', 'data_lead', 'director', 'pastor', 'admin') then
      raise exception 'That is not a role we have' using errcode = '22023';
    end if;
  end loop;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  if p_holdout_until is not null and (p_scope not in ('platform', 'community') or public.feature_rank(p_position) < 2) then
    raise exception 'Holding back a tribe in ten is only for a function opened for the whole church or a community' using errcode = '22023';
  end if;
  -- Opening a function for the whole church (beyond a rehearsal) needs a reason, so the log can say why.
  if p_scope = 'platform' and public.feature_rank(p_position) = 2 and v_roles = '{}' and (v_reason is null or char_length(v_reason) < 8) then
    raise exception 'Say why you are opening this for the whole church (at least eight characters)' using errcode = '22023';
  end if;

  v_new_rank := public.feature_rank(p_position);
  -- A function cannot be further open than the ones it needs, at the same place.
  foreach r in array f.depends loop
    select * into d from public.feature_registry x where x.key = r;
    if public.feature_rank(public.feature_position_at(r, p_scope, p_scope_id)) < v_new_rank then
      raise exception 'Open % first. % needs it, and it is not as open as this at the same place', d.name, f.name using errcode = '22023';
    end if;
  end loop;
  -- And a function cannot be closed while one that needs it is more open than it would then be.
  for d in select x.* from public.feature_registry x where f.key = any (x.depends) and x.available loop
    v_other := public.feature_rank(public.feature_position_at(d.key, p_scope, p_scope_id));
    if v_other > v_new_rank and exists (select 1 from public.feature_settings s where s.feature = d.key and s.scope = p_scope and s.scope_id is not distinct from p_scope_id) then
      raise exception 'Close % first. It needs %, and it is more open than this would leave it', d.name, f.name using errcode = '22023';
    end if;
  end loop;

  select * into old from public.feature_settings s where s.feature = p_feature and s.scope = p_scope and s.scope_id is not distinct from p_scope_id;
  if old.id is not null and old.position = p_position and old.roles = v_roles and old.holdout_until is not distinct from p_holdout_until then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  insert into public.feature_settings (feature, scope, scope_id, position, roles, holdout_until, reason, set_by)
  values (p_feature, p_scope, p_scope_id, p_position, v_roles, p_holdout_until, v_reason, me)
  on conflict (feature, scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set position = excluded.position, roles = excluded.roles, holdout_until = excluded.holdout_until, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  insert into public.feature_log (actor, feature, scope, scope_id, scope_label, old_position, new_position, roles, reason)
  values (me, p_feature, p_scope, p_scope_id, v_label, coalesce(old.position, 'off'), p_position, v_roles, v_reason);
  perform public.write_event(me, 'feature.set', 'feature', p_feature, jsonb_build_object('scope', p_scope, 'position', p_position));
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- Takes one rule away, so the function goes back to what the wider rule (or its own start) says.
create function public.god_feature_remove(p_rule uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.feature_settings;
  f public.feature_registry;
  d public.feature_registry;
  v_after integer;
  v_label text;
  v_fall text;
begin
  perform public.god_only();
  select * into s from public.feature_settings x where x.id = p_rule for update;
  if not found then
    raise exception 'We could not find that rule' using errcode = 'P0002';
  end if;
  select * into f from public.feature_registry x where x.key = s.feature;
  v_label := public.feature_scope_label(s.scope, s.scope_id);
  -- What the function would stand at once this rule is gone: the whole-church rule or its start (for a whole-church rule, its start).
  v_fall := coalesce(
    case when s.scope <> 'platform' then (select x.position from public.feature_settings x where x.feature = s.feature and x.scope = 'platform') end,
    f.default_mode);
  v_after := public.feature_rank(v_fall);
  for d in select x.* from public.feature_registry x where s.feature = any (x.depends) and x.available loop
    if public.feature_rank(public.feature_position_at(d.key, s.scope, s.scope_id)) > v_after
       and exists (select 1 from public.feature_settings y where y.feature = d.key and y.scope = s.scope and y.scope_id is not distinct from s.scope_id) then
      raise exception 'Close % first. It needs %', d.name, f.name using errcode = '22023';
    end if;
  end loop;
  delete from public.feature_settings where id = s.id;
  -- What the function became at that place once the rule was gone, not "off": taking away an Off rule can open the function
  insert into public.feature_log (actor, feature, scope, scope_id, scope_label, old_position, new_position, roles, reason)
  values (me, s.feature, s.scope, s.scope_id, v_label, s.position, v_fall, s.roles, nullif(btrim(coalesce(p_reason, '')), ''));
  perform public.write_event(me, 'feature.removed', 'feature', s.feature, jsonb_build_object('scope', s.scope));
  return jsonb_build_object('ok', true);
end;
$$;

-- The Master pause. It turns every new function Off at once, deletes nothing, and one more press puts everything back.
create function public.god_feature_master(p_paused boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  m public.feature_master;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.god_only();
  if p_paused is null then
    raise exception 'Say whether to pause' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  select * into m from public.feature_master x where x.id for update;
  if m.paused = p_paused then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.feature_master set paused = p_paused, reason = v_reason, changed_by = me, changed_at = now() where id;
  insert into public.feature_log (actor, feature, scope, scope_label, old_position, new_position, reason)
  values (me, null, 'platform', 'Every new function', case when m.paused then 'paused' else 'running' end, case when p_paused then 'paused' else 'running' end, v_reason);
  perform public.write_event(me, case when p_paused then 'feature.paused' else 'feature.resumed' end, 'feature', 'master', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

create function public.god_feature_log(p_limit integer default 60)
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
             'id', x.id, 'at', x.at, 'feature', x.feature, 'name', (select f.name from public.feature_registry f where f.key = x.feature),
             'scope', x.scope, 'label', x.scope_label, 'from', x.old_position, 'to', x.new_position, 'roles', to_jsonb(x.roles), 'reason', x.reason) order by x.id desc)
      from (select * from public.feature_log l order by l.id desc limit least(greatest(coalesce(p_limit, 60), 1), 200)) x), '[]'::jsonb);
end;
$$;

-- Pastors, directors and admins may read the page and its log, as they read the leader pipeline's. They cannot move anything, and the owner
-- is shown only as "an administrator".
create function public.features_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.feature_master;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['pastor', 'director', 'admin']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can read this' using errcode = '42501';
  end if;
  select * into m from public.feature_master x where x.id;
  return jsonb_build_object(
    'paused', m.paused,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'name', f.name, 'blurb', f.blurb, 'stage', f.stage, 'available', f.available, 'summary', public.feature_summary(f.key),
               'depends', to_jsonb(f.depends)) order by f.sort)
        from public.feature_registry f), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('at', x.at, 'by', 'an administrator', 'name', (select f.name from public.feature_registry f where f.key = x.feature),
               'label', x.scope_label, 'from', x.old_position, 'to', x.new_position, 'reason', x.reason) order by x.id desc)
        from (select * from public.feature_log l order by l.id desc limit 60) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The facts store: one fact, one owner, many readers
-- ---------------------------------------------------------------------------
-- The registry says which facts are covered, who they apply to and how a change is handled. A fact is added by adding a row. The matching
-- list in src/lib/profile/registry.ts (which also names every reader of each fact) is checked against this one by a test.
--   A. Free       saved at once; nothing else moves
--   B. Noted      saved at once; the next list of suggested tribes is worked out again; nobody is moved
--   C. Reviewed   for a person in a tribe or leading one: saved as a pending change, the old value stays in force until a pastor has looked
--   D. Special    crossing 17 and 18: the young people's rules or the office, never self-service
create table public.profile_fact_registry (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null,
  question text not null,
  layer text not null check (layer in ('facts', 'story', 'role')),
  change_class text not null check (change_class in ('A', 'B', 'C', 'D')),
  applies_to text[] not null check (applies_to <@ array['leader', 'member']),
  sort smallint not null
);
alter table public.profile_fact_registry enable row level security;
revoke all on table public.profile_fact_registry from public, anon, authenticated;
insert into public.profile_fact_registry (key, label, question, layer, change_class, applies_to, sort) values
  ('life_stage', 'Stage of life', 'We have you down as {value}. Is that right?', 'facts', 'C', array['leader'], 1),
  ('age_range', 'Age range', 'We have you down as {value}. Is that right?', 'facts', 'C', array['member'], 2);

-- What a person holds now: the value, who set it, when, and whether the person has confirmed it. A fact the person has never been asked
-- about has no row here; its proposed value is read from where it came from (see profile_fact_current).
create table public.profile_facts (
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  value text not null check (char_length(value) between 1 and 80),
  set_by_kind text not null check (set_by_kind in ('person', 'office', 'leader', 'import', 'system')),
  set_by uuid references public.people (id) on delete set null,
  set_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_via text check (confirmed_via in ('details_check', 'my_page', 'review', 'application')),
  primary key (person_id, key)
);
alter table public.profile_facts enable row level security;
revoke all on table public.profile_facts from public, anon, authenticated;

-- Every step, never rewritten. A changed fact applies from the day it was changed; the history is how an earlier season is read.
create table public.profile_fact_history (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  event text not null check (event in ('proposed', 'confirmed', 'changed', 'applied', 'pending', 'approved', 'declined', 'not_me', 'later')),
  old_value text,
  new_value text,
  by_kind text not null check (by_kind in ('person', 'office', 'pastor', 'system')),
  by_person uuid references public.people (id) on delete set null,
  via text check (via in ('details_check', 'my_page', 'review', 'appointment')),
  note text check (char_length(note) <= 300),
  at timestamptz not null default now()
);
create index profile_fact_history_idx on public.profile_fact_history (person_id, key, id desc);
alter table public.profile_fact_history enable row level security;
revoke all on table public.profile_fact_history from public, anon, authenticated;

-- A change that touches other people, waiting for the pastor of the person's centre (a tribe stage review). The old value stays in force.
create table public.profile_changes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  old_value text,
  new_value text not null,
  tribe_id uuid references public.tribes (id) on delete set null,
  centre_id uuid not null references public.centres (id),
  via text not null check (via in ('details_check', 'my_page')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  -- Five days, as for a Tribe Card
  due_on date not null,
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  check ((status = 'pending') = (decided_at is null))
);
create unique index profile_changes_one_pending on public.profile_changes (person_id, key) where status = 'pending';
create index profile_changes_centre_idx on public.profile_changes (centre_id, status, requested_at);
alter table public.profile_changes enable row level security;
revoke all on table public.profile_changes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Words and lists
-- ---------------------------------------------------------------------------
-- "26 to 40, the Builders stage"
create function public.profile_track_phrase(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when k.max_age is null then k.min_age::text || ' and over' else k.min_age::text || ' to ' || k.max_age::text end || ', the ' || k.name || ' stage'
    from public.tracks k where k.slug = p_slug;
$$;

create function public.profile_fact_label(p_key text, p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then public.profile_track_phrase(p_value)
    when 'age_range' then (select a.label from public.age_ranges a where a.slug = p_value)
  end;
$$;

-- The real choices for a person who says "No, change it". Adults only: a young person's range is never offered here.
create function public.profile_fact_options(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then coalesce((select jsonb_agg(jsonb_build_object('value', k.slug, 'label', k.name, 'detail', public.profile_track_phrase(k.slug)) order by k.sort)
                                       from public.tracks k where k.active and k.min_age >= 18), '[]'::jsonb)
    when 'age_range' then coalesce((select jsonb_agg(jsonb_build_object('value', a.slug, 'label', a.label, 'detail', k.name) order by a.sort)
                                      from public.age_ranges a join public.tracks k on k.id = a.track_id where a.min_age >= 18), '[]'::jsonb)
    else '[]'::jsonb
  end;
$$;

-- Does this fact apply to this person? A leader's stage; a member's age range.
create function public.profile_fact_applies(p_person uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader')
    when 'age_range' then exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
    else false
  end;
$$;

-- What the platform holds for this person now. 'confirmed' when the person has said so (or typed it themselves), 'unconfirmed' when someone else
-- proposed it and the person has not yet answered, 'none' when nothing is held. Where there is no row yet, the proposal is read from where
-- it came from, so the first answer needs nothing to have been written beforehand.
create function public.profile_fact_current(p_person uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.profile_facts;
  v_val text;
  v_by text;
  v_at timestamptz;
  v_src text;
begin
  select * into f from public.profile_facts x where x.person_id = p_person and x.key = p_key;
  if found then
    return jsonb_build_object('state', case when f.confirmed_at is not null then 'confirmed' else 'unconfirmed' end, 'value', f.value,
      'label', public.profile_fact_label(p_key, f.value), 'by', f.set_by_kind, 'at', coalesce(f.confirmed_at, f.set_at), 'source', 'fact');
  end if;
  if p_key = 'life_stage' then
    -- The office's suggestion at the appointment: its short form is the proposal.
    select a.form ->> 'track', a.appointed_at into v_val, v_at
      from public.leader_appointments a where a.person_id = p_person and a.status = 'active';
    if v_val is not null then
      v_by := 'office';
      v_src := 'appointment';
    else
      select k.slug, t.created_at into v_val, v_at
        from public.tribes t join public.tracks k on k.id = t.track_id
       where t.leader_id = p_person and t.status <> 'closed' order by t.created_at desc limit 1;
      if v_val is not null then
        v_src := 'tribe';
        -- A card that began from the leader's own application carries what they typed there.
        v_by := case when exists (select 1 from public.leader_applications la
                                   where la.person_id = p_person and la.status in ('approved_leader', 'approved_assistant')
                                     and la.answers #>> '{calling,track}' = v_val) then 'person' else 'office' end;
      else
        select la.answers #>> '{calling,track}', la.decided_at into v_val, v_at
          from public.leader_applications la
         where la.person_id = p_person and la.status in ('approved_leader', 'approved_assistant')
         order by la.created_at desc limit 1;
        v_by := 'person';
        v_src := 'application';
      end if;
    end if;
    if v_val is null or public.profile_track_phrase(v_val) is null then
      return jsonb_build_object('state', 'none');
    end if;
  elsif p_key = 'age_range' then
    select a.slug, mp.submitted_at into v_val, v_at
      from public.member_profiles mp join public.age_ranges a on a.id = mp.age_range_id where mp.person_id = p_person;
    v_by := 'person';
    v_src := 'answers';
    if v_val is null then
      return jsonb_build_object('state', 'none');
    end if;
  else
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object('state', case when v_by = 'person' then 'confirmed' else 'unconfirmed' end, 'value', v_val,
    'label', public.profile_fact_label(p_key, v_val), 'by', v_by, 'at', v_at, 'source', v_src);
end;
$$;

-- True when the person's stage of life is one they have confirmed (or wrote themselves). The hold on a Tribe Card reads this.
create function public.profile_stage_confirmed(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.profile_fact_current(p_person, 'life_stage') ->> 'state' = 'confirmed';
$$;

-- ---------------------------------------------------------------------------
-- An answer, and what it does
-- ---------------------------------------------------------------------------
-- The one place an answer about a fact is handled, whoever asks the person (the private link, the strip on My page). Not callable by anyone: the
-- functions below check who is asking and call this.
--
--   yes     the person says it is right. Stamped as confirmed by the person.
--   change  the person gives another value, from the list. Handled by the class of the fact and who it touches:
--             a leader whose Tribe Card is not yet approved and whose tribe has nobody in it: applied at once, the tribe's locked stage is
--               updated, and the change is logged (nobody can be affected);
--             a leader whose tribe has members or has been approved: a pending change for the pastor of the person's centre; the old
--               value stays in force and nobody is moved;
--             a member in a tribe: a pending change; a member in none: applied at once;
--             a change across 17 and 18: refused here, it goes through the young people's rules.
--   not_me  the message reached the wrong person. Changes nothing.
--   later   asks to be asked again.
create function public.profile_fact_answer(p_person uuid, p_key text, p_action text, p_value text, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.profile_fact_registry;
  cur jsonb;
  v_old text;
  v_new text := nullif(btrim(coalesce(p_value, '')), '');
  t public.tribes;
  v_members integer;
  v_centre uuid;
  v_id uuid;
  v_old_min integer;
begin
  if p_via not in ('details_check', 'my_page') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into reg from public.profile_fact_registry x where x.key = p_key;
  if not found or not public.profile_fact_applies(p_person, p_key) then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  if p_action not in ('yes', 'change', 'not_me', 'later') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  cur := public.profile_fact_current(p_person, p_key);
  if cur ->> 'state' = 'none' then
    return jsonb_build_object('ok', false, 'reason', 'nothing');
  end if;
  v_old := cur ->> 'value';
  if exists (select 1 from public.profile_changes c where c.person_id = p_person and c.key = p_key and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'waiting', 'message', 'A change is already waiting for a pastor to look at it');
  end if;

  if p_action = 'not_me' then
    insert into public.profile_fact_history (person_id, key, event, old_value, by_kind, by_person, via, note)
    values (p_person, p_key, 'not_me', v_old, 'person', null, p_via, 'The message was not for this person');
    return jsonb_build_object('ok', true, 'outcome', 'not_me');
  end if;
  if p_action = 'later' then
    insert into public.profile_fact_history (person_id, key, event, old_value, by_kind, by_person, via)
    values (p_person, p_key, 'later', v_old, 'person', p_person, p_via);
    return jsonb_build_object('ok', true, 'outcome', 'later');
  end if;

  if p_action = 'change' and (v_new is null or v_new = v_old) then
    -- Choosing what is already held is the same as saying it is right.
    if v_new is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose one from the list');
    end if;
    p_action := 'yes';
  end if;

  if p_action = 'yes' then
    insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, set_at, confirmed_at, confirmed_via)
    values (p_person, p_key, v_old, coalesce(nullif(cur ->> 'by', ''), 'office'), null, coalesce((cur ->> 'at')::timestamptz, now()), now(), p_via)
    on conflict (person_id, key) do update set confirmed_at = now(), confirmed_via = excluded.confirmed_via;
    insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via)
    values (p_person, p_key, 'confirmed', v_old, v_old, 'person', p_person, p_via);
    return jsonb_build_object('ok', true, 'outcome', 'confirmed');
  end if;

  -- change
  if not exists (select 1 from jsonb_array_elements(public.profile_fact_options(p_key)) o where o ->> 'value' = v_new) then
    return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose one from the list');
  end if;
  select p.centre_id into v_centre from public.people p where p.id = p_person;

  if p_key = 'life_stage' then
    select * into t from public.tribes x where x.leader_id = p_person and x.status <> 'closed' order by x.created_at desc limit 1;
    if not found then
      -- No tribe yet: the answer is kept, and the pastor sees it beside the card when one is started.
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'changed', v_old, v_new, 'person', p_person, p_via, 'No tribe is started yet');
      return jsonb_build_object('ok', true, 'outcome', 'recorded');
    end if;
    select count(*)::integer into v_members from public.tribe_members m where m.tribe_id = t.id and m.status = 'active';
    if t.status <> 'approved' and v_members = 0 then
      update public.tribes set track_id = (select k.id from public.tracks k where k.slug = v_new and k.active) where id = t.id;
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'applied', v_old, v_new, 'person', p_person, p_via, 'The Tribe Card was not approved and nobody had joined, so the change applied at once');
      perform public.write_event(p_person, 'profile.stage_corrected', 'tribe', t.id::text, jsonb_build_object('from', v_old, 'to', v_new));
      return jsonb_build_object('ok', true, 'outcome', 'applied_now', 'tribe', t.id);
    end if;
    insert into public.profile_changes (person_id, key, old_value, new_value, tribe_id, centre_id, via, due_on)
    values (p_person, p_key, v_old, v_new, t.id, v_centre, p_via, public.today_lagos() + 5)
    returning id into v_id;
  else
    -- A member's age range. Crossing 17 and 18 is never self-service.
    select a.min_age into v_old_min from public.age_ranges a where a.slug = v_old;
    if coalesce(v_old_min, 0) < 18 then
      return jsonb_build_object('ok', false, 'reason', 'special_route', 'message', 'A change for someone under 18 goes through the young people''s rules. Ask the church office');
    end if;
    if exists (select 1 from public.tribe_members m where m.person_id = p_person and m.status = 'active') then
      insert into public.profile_changes (person_id, key, old_value, new_value, tribe_id, centre_id, via, due_on)
      values (p_person, p_key, v_old, v_new, (select m.tribe_id from public.tribe_members m where m.person_id = p_person and m.status = 'active' order by m.joined_at desc limit 1),
              v_centre, p_via, public.today_lagos() + 5)
      returning id into v_id;
    else
      update public.member_profiles set age_range_id = (select a.id from public.age_ranges a where a.slug = v_new), updated_at = now() where person_id = p_person;
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'applied', v_old, v_new, 'person', p_person, p_via, 'Not in a tribe, so nobody is affected');
      return jsonb_build_object('ok', true, 'outcome', 'applied_now');
    end if;
  end if;

  insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
  values (p_person, p_key, 'pending', v_old, v_new, 'person', p_person, p_via, 'Waiting for the pastor of the person''s centre; the old value stays in force');
  -- The pastors hear. A fault here is recorded and never undoes the answer.
  begin
    perform public.notify_role(v_centre, array['pastor', 'director'], 'pastor_stage_review', 'stage:' || v_id,
      jsonb_build_object('leader', public.first_name_of(p_person), 'what', reg.label),
      public.first_name_of(p_person) || ' asked to change their ' || lower(reg.label), '/review/stages', false, p_person);
  exception when others then
    perform public.notice_fault('profile_review', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'outcome', 'pending_review', 'change', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- The pastor's side: stage reviews
-- ---------------------------------------------------------------------------
create function public.stage_reviews_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_centre uuid := public.my_centre();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['pastor', 'director', 'admin']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'canDecide', public.has_role('pastor'),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'status', c.status,
               'person', coalesce(nullif(btrim(p.full_name), ''), p.email), 'first', public.first_name_of(c.person_id),
               'fact', r.label, 'key', c.key, 'oldLabel', public.profile_fact_label(c.key, c.old_value), 'newLabel', public.profile_fact_label(c.key, c.new_value),
               'tribe', t.name, 'members', (select count(*) from public.tribe_members m where m.tribe_id = c.tribe_id and m.status = 'active'),
               'requestedAt', c.requested_at, 'dueOn', c.due_on, 'overdue', c.status = 'pending' and c.due_on < public.today_lagos(),
               'decidedAt', c.decided_at, 'note', c.decision_note)
             order by (c.status = 'pending') desc, c.requested_at desc)
        from public.profile_changes c
        join public.people p on p.id = c.person_id
        join public.profile_fact_registry r on r.key = c.key
        left join public.tribes t on t.id = c.tribe_id
       where c.centre_id = v_centre and (c.status = 'pending' or c.decided_at > now() - interval '30 days')), '[]'::jsonb));
end;
$$;

-- The pastor decides. Approving applies the change: for a leader, the tribe's stage is updated and nobody is moved. Declining leaves
-- everything as it was; the person is told on their page, in plain words.
create function public.stage_review_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.profile_changes;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_role('pastor') then
    raise exception 'Only a pastor decides this' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say whether to approve' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  select * into c from public.profile_changes x where x.id = p_id for update;
  if not found or c.centre_id is distinct from public.my_centre() then
    raise exception 'We could not find that review' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    raise exception 'That review has been decided already' using errcode = '22023';
  end if;

  if p_approve then
    if c.key = 'life_stage' then
      if c.tribe_id is not null then
        update public.tribes set track_id = (select k.id from public.tracks k where k.slug = c.new_value and k.active)
         where id = c.tribe_id and status <> 'closed';
      end if;
    else
      update public.member_profiles set age_range_id = (select a.id from public.age_ranges a where a.slug = c.new_value), updated_at = now()
       where person_id = c.person_id;
    end if;
    insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
    values (c.person_id, c.key, c.new_value, 'person', c.person_id, now(), 'review')
    on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = 'review';
  end if;
  update public.profile_changes set status = case when p_approve then 'approved' else 'declined' end, decided_by = me, decided_at = now(), decision_note = v_note where id = c.id;
  insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
  values (c.person_id, c.key, case when p_approve then 'approved' else 'declined' end, c.old_value, c.new_value, 'pastor', me, 'review', v_note);
  perform public.write_event(me, case when p_approve then 'profile.change_approved' else 'profile.change_declined' end, 'profile_change', c.id::text,
    jsonb_build_object('key', c.key, 'tribe', c.tribe_id));
  return jsonb_build_object('ok', true, 'approved', p_approve);
end;
$$;

-- What a pastor, director or admin sees beside a Tribe Card: whether the leader has confirmed their stage, and whether the card agrees with it.
-- Null unless the Details Check is open for that leader, so with everything Off a card looks as it always has.
create function public.tribe_stage_status(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tribes;
  cur jsonb;
  v_hold text;
  v_card text;
  v_pending public.profile_changes;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see this' using errcode = '42501';
  end if;
  select * into t from public.tribes x where x.id = p_tribe;
  if not found or public.feature_state_of('details_check', t.leader_id) <> 'on' then
    return null;
  end if;
  cur := public.profile_fact_current(t.leader_id, 'life_stage');
  if cur ->> 'state' = 'none' then
    return null;
  end if;
  v_hold := public.feature_state_of('hold_card', t.leader_id);
  select k.slug into v_card from public.tracks k where k.id = t.track_id;
  select * into v_pending from public.profile_changes c where c.person_id = t.leader_id and c.key = 'life_stage' and c.status = 'pending';
  return jsonb_build_object(
    'state', cur ->> 'state', 'leader', cur ->> 'label', 'card', public.profile_track_phrase(v_card),
    'differs', v_card is distinct from cur ->> 'value', 'hold', v_hold,
    'pending', case when v_pending.id is null then null else public.profile_fact_label('life_stage', v_pending.new_value) end);
end;
$$;

-- The hold: with "Required", a Tribe Card whose leader has not confirmed their stage cannot be approved. Every other time this does nothing,
-- so with the Details Check Off a pastor's approval is exactly what it was.
create function public.tribes_hold_for_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.feature_state_of('hold_card', new.leader_id) = 'required' and not public.profile_stage_confirmed(new.leader_id) then
    raise exception 'This leader has not confirmed their stage of life yet, so the card cannot be approved. Ask them to confirm it, or set the hold to Optional' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger tribes_hold_for_stage
  before update of status on public.tribes
  for each row when (new.status = 'approved' and old.status is distinct from new.status)
  execute function public.tribes_hold_for_stage();

-- ---------------------------------------------------------------------------
-- My page, the first layer (leaders)
-- ---------------------------------------------------------------------------
create function public.my_page_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.profile_fact_registry;
  cur jsonb;
  c public.profile_changes;
  v_last record;
  v_facts jsonb := '[]'::jsonb;
begin
  if me is null then
    return jsonb_build_object('enabled', false);
  end if;
  -- Never for someone under 18: the young people's rules, and their parent's permission, come first (a later stage decides what they see)
  if public.feature_state_of('my_page', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('enabled', false);
  end if;
  for r in select * from public.profile_fact_registry x where public.profile_fact_applies(me, x.key) order by x.sort loop
    cur := public.profile_fact_current(me, r.key);
    continue when cur ->> 'state' = 'none';
    select * into c from public.profile_changes x where x.person_id = me and x.key = r.key order by x.requested_at desc limit 1;
    select h.event, h.at, h.note into v_last from public.profile_fact_history h where h.person_id = me and h.key = r.key order by h.id desc limit 1;
    v_facts := v_facts || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'label', r.label, 'question', replace(r.question, '{value}', cur ->> 'label'), 'state', cur ->> 'state', 'value', cur ->> 'value', 'valueLabel', cur ->> 'label',
      'by', cur ->> 'by', 'at', cur ->> 'at', 'options', public.profile_fact_options(r.key),
      'change', case when c.id is null then null else jsonb_build_object('status', c.status, 'newLabel', public.profile_fact_label(r.key, c.new_value),
                  'note', c.decision_note, 'dueOn', c.due_on, 'at', coalesce(c.decided_at, c.requested_at)) end,
      'last', case when v_last.event is null then null else jsonb_build_object('event', v_last.event, 'at', v_last.at) end));
  end loop;
  return jsonb_build_object('enabled', true, 'first', public.first_name_of(me), 'facts', v_facts);
end;
$$;

-- The person answers from their own page. A leader's "not me" and "later" are for the private link; the page offers yes and change.
create function public.my_page_answer(p_key text, p_action text, p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_state_of('my_page', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if p_action not in ('yes', 'change') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  return public.profile_fact_answer(me, p_key, p_action, p_value, 'my_page');
end;
$$;

-- ---------------------------------------------------------------------------
-- Details Check: the office asks, the person answers
-- ---------------------------------------------------------------------------
--   details_checks         one run: who was chosen, which facts, Rehearsal or live, how many were asked and how many left out (counts only)
--   details_check_items    one row for each person asked: what they have answered and where it stands. The office sees the status, never the answer.
--   details_check_tokens   the private links. Only a hash is kept. A reminder makes a new link; the old one works until it expires.
--   details_check_access   the six-digit code a person types when they are not signed in, and the short sign-in it opens
create table public.details_checks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id) on delete set null,
  mode text not null check (mode in ('rehearsal', 'live')),
  facts text[] not null check (cardinality(facts) between 1 and 3),
  audience jsonb not null,
  asked integer not null default 0,
  left_out jsonb not null default '{}'::jsonb,
  closed_at timestamptz
);
alter table public.details_checks enable row level security;
revoke all on table public.details_checks from public, anon, authenticated;

create table public.details_check_items (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.details_checks (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  facts text[] not null,
  -- What each fact came to: confirmed, applied_now, recorded, pending_review, not_me, later
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('rehearsal', 'queued', 'confirmed', 'changed', 'pending_review', 'not_me', 'later', 'no_reply', 'closed')),
  message_id uuid references public.messages (id) on delete set null,
  -- Rehearsal: the words that would have gone, and the way. Never a link.
  would_send text,
  opened_at timestamptz,
  answered_at timestamptz,
  snoozed_until timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  escalate_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (check_id, person_id)
);
create index details_check_items_person_idx on public.details_check_items (person_id);
create index details_check_items_due_idx on public.details_check_items (remind_at) where status = 'queued';
alter table public.details_check_items enable row level security;
revoke all on table public.details_check_items from public, anon, authenticated;

create table public.details_check_tokens (
  token_hash text primary key,
  item_id uuid not null references public.details_check_items (id) on delete cascade,
  expires_at timestamptz not null,
  clicks integer not null default 0
);
create index details_check_tokens_item_idx on public.details_check_tokens (item_id);
alter table public.details_check_tokens enable row level security;
revoke all on table public.details_check_tokens from public, anon, authenticated;

create table public.details_check_access (
  item_id uuid primary key references public.details_check_items (id) on delete cascade,
  code_salt text,
  code_hash text,
  code_expires_at timestamptz,
  code_tries smallint not null default 0,
  locked_until timestamptz,
  codes_sent smallint not null default 0,
  codes_since timestamptz,
  session_hash text,
  session_expires_at timestamptz
);
alter table public.details_check_access enable row level security;
revoke all on table public.details_check_access from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create function public.details_hash(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex');
$$;

-- The ways to reach a person, best first, by the same rules the outbox uses to choose (without a message to choose for).
create function public.details_channels(p_person uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  cp public.contact_preferences%rowtype;
  v_order text[] := array['whatsapp', 'email', 'sms'];
  v_out text[] := '{}';
  ch text;
begin
  select p.email into v_email from public.people p where p.id = p_person;
  select * into cp from public.contact_preferences c where c.person_id = p_person;
  if cp.preferred is not null then
    v_order := array[cp.preferred] || array_remove(v_order, cp.preferred);
  end if;
  foreach ch in array v_order loop
    if ch = 'whatsapp' and cp.phone is not null and public.consent_granted(p_person, 'whatsapp') then
      v_out := v_out || ch;
    elsif ch = 'email' and v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and not public.email_opted_out(p_person) then
      v_out := v_out || ch;
    elsif ch = 'sms' and cp.phone is not null and public.consent_granted(p_person, 'sms') then
      v_out := v_out || ch;
    end if;
  end loop;
  return v_out;
end;
$$;

-- A new private link for an item: made here, only its hash kept. The link itself rides in the message's reply token, which the heartbeat
-- scrubs once the message is finished with.
create function public.details_token_mint(p_item uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.details_check_tokens (token_hash, item_id, expires_at)
  values (public.details_hash(v_raw), p_item, now() + make_interval(days => greatest(p_days, 1)));
  return v_raw;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who would be asked, and who is left out and why (never who)
-- ---------------------------------------------------------------------------
-- One row for each person the audience picks. `skip` is why a person is left out, or null when they would be asked. `facts` is what they
-- would be asked. In a rehearsal the people the Details Check is in Rehearsal for count; for a live run only those it is On for.
create function public.details_plan_rows(p_audience jsonb, p_facts text[], p_live boolean)
returns table (person_id uuid, facts text[], skip text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := p_audience ->> 'kind';
  v_ids uuid[];
  r record;
  v_facts text[];
  v_all text[];
  k text;
  v_state text;
  v_email text;
  cp public.contact_preferences%rowtype;
  v_unconf text[];
begin
  if v_kind = 'appointed' then
    select coalesce(array_agg(distinct a.person_id), '{}') into v_ids from public.leader_appointments a where a.status = 'active';
  elsif v_kind = 'leaders' then
    select coalesce(array_agg(distinct x.person_id), '{}') into v_ids from public.person_roles x where x.role = 'leader';
  elsif v_kind = 'tribe' then
    select coalesce(array_agg(distinct t.leader_id), '{}') into v_ids from public.tribes t where t.id = nullif(p_audience ->> 'tribe', '')::uuid and t.status <> 'closed';
  elsif v_kind = 'list' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_audience -> 'people', '[]'::jsonb)) x;
  elsif v_kind = 'unconfirmed' then
    -- Everyone a chosen fact applies to; the unconfirmed ones are picked below.
    select coalesce(array_agg(distinct x.person_id), '{}') into v_ids from (
      select pr.person_id from public.person_roles pr where pr.role = 'leader' and 'life_stage' = any (p_facts)
      union
      select mp.person_id from public.member_profiles mp where 'age_range' = any (p_facts)) x;
  else
    raise exception 'Choose who to ask' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 2000 then
    raise exception 'That is more than 2,000 people. Choose a smaller group' using errcode = '22023';
  end if;

  for r in
    select p.id, p.email from public.people p
     where p.id = any (v_ids) and not p.hidden and not exists (select 1 from public.platform_owner o where o.person_id = p.id)
     order by p.id
  loop
    person_id := r.id;
    -- the facts this person has, and which of them are not yet confirmed
    v_all := '{}';
    v_unconf := '{}';
    foreach k in array p_facts loop
      if public.profile_fact_applies(r.id, k) then
        declare cur jsonb := public.profile_fact_current(r.id, k);
        begin
          if cur ->> 'state' <> 'none' then
            v_all := v_all || k;
            if cur ->> 'state' = 'unconfirmed' then
              v_unconf := v_unconf || k;
            end if;
          end if;
        end;
      end if;
    end loop;
    facts := v_unconf;
    skip := null;
    if cardinality(v_all) = 0 then
      skip := 'no_fact';
    elsif cardinality(v_unconf) = 0 then
      skip := 'already_confirmed';
    elsif public.notice_is_young(r.id) then
      skip := 'under_18';
    elsif not (public.feature_state_of('details_check', r.id) = 'on' or (not p_live and public.feature_state_of('details_check', r.id) = 'rehearsal')) then
      skip := 'switch_off';
    elsif exists (select 1 from public.details_check_items i join public.details_checks c on c.id = i.check_id
                   where i.person_id = r.id and c.mode = 'live' and c.closed_at is null and i.status in ('queued', 'later', 'pending_review')
                     and i.facts && v_unconf and i.created_at > now() - interval '14 days') then
      skip := 'already_asked';
    elsif cardinality(public.details_channels(r.id)) = 0 then
      select * into cp from public.contact_preferences c where c.person_id = r.id;
      skip := case when r.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or cp.phone is not null then 'messages_off' else 'no_channel' end;
    end if;
    return next;
  end loop;
end;
$$;

create function public.details_clean_facts(p_facts text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_facts, '{}')) x where x is not null), '{}');
begin
  if cardinality(v) < 1 or cardinality(v) > 3 then
    raise exception 'Choose between one and three facts to confirm' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v) x where not exists (select 1 from public.profile_fact_registry r where r.key = x)) then
    raise exception 'That is not a fact we hold' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- The counts the owner sees before sending: how many would be asked, and how many are left out for each reason. Never who.
create function public.god_details_plan(p_audience jsonb, p_facts text[], p_mode text default 'rehearsal')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_facts text[];
  v_asked integer;
  v_out jsonb;
begin
  perform public.god_only();
  if p_mode not in ('rehearsal', 'live') then
    raise exception 'Choose Rehearsal or live' using errcode = '22023';
  end if;
  v_facts := public.details_clean_facts(p_facts);
  select coalesce(sum(s.n) filter (where s.skip is null), 0)::integer,
         coalesce(jsonb_object_agg(s.skip, s.n) filter (where s.skip is not null), '{}'::jsonb)
    into v_asked, v_out
    from (select skip, count(*)::integer n from public.details_plan_rows(p_audience, v_facts, p_mode = 'live') group by skip) s;
  return jsonb_build_object('asked', coalesce(v_asked, 0), 'leftOut', coalesce(v_out, '{}'::jsonb), 'facts', to_jsonb(v_facts));
end;
$$;

-- The words that would go, for a Rehearsal (never a link, never a fact).
create function public.details_would_send(p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ch text := (public.details_channels(p_person))[1];
begin
  return coalesce(case v_ch when 'whatsapp' then 'WhatsApp' when 'email' then 'Email' when 'sms' then 'Text message' end, 'No channel') ||
         ': "Hello ' || coalesce(public.first_name_of(p_person), 'there') || ', please check the details we hold for your tribe. It takes under a minute." with a private link';
end;
$$;

-- Sends the check, or rehearses it. Rehearsal writes what would be sent and sends nothing. Live: one private link each, one message each.
create function public.god_details_send(p_audience jsonb, p_facts text[], p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_facts text[];
  v_id uuid := gen_random_uuid();
  v_live boolean := p_mode = 'live';
  r record;
  v_item uuid;
  v_raw text;
  v_msg uuid;
  v_asked integer := 0;
  v_left jsonb;
  k text;
  v_at timestamptz;
begin
  perform public.god_only();
  if p_mode not in ('rehearsal', 'live') then
    raise exception 'Choose Rehearsal or live' using errcode = '22023';
  end if;
  v_facts := public.details_clean_facts(p_facts);
  select coalesce(jsonb_object_agg(s.skip, s.n), '{}'::jsonb) into v_left
    from (select skip, count(*)::integer n from public.details_plan_rows(p_audience, v_facts, v_live) where skip is not null group by skip) s;
  if not exists (select 1 from public.details_plan_rows(p_audience, v_facts, v_live) x where x.skip is null) then
    raise exception 'Nobody would be asked. %', case when exists (select 1 from public.feature_registry f where f.key = 'details_check') and
      coalesce((select m.paused from public.feature_master m where m.id), true) then 'The Master pause is on.' else 'Check the Details Check switch in Features, and who is chosen.' end using errcode = '22023';
  end if;
  insert into public.details_checks (id, created_by, mode, facts, audience, left_out) values (v_id, me, p_mode, v_facts, p_audience, v_left);

  for r in select * from public.details_plan_rows(p_audience, v_facts, v_live) x where x.skip is null loop
    v_item := gen_random_uuid();
    if not v_live then
      insert into public.details_check_items (id, check_id, person_id, facts, status, would_send)
      values (v_item, v_id, r.person_id, r.facts, 'rehearsal', public.details_would_send(r.person_id));
    else
      insert into public.details_check_items (id, check_id, person_id, facts, status, remind_at, escalate_at)
      values (v_item, v_id, r.person_id, r.facts, 'queued', now() + interval '3 days', now() + interval '7 days');
      v_raw := public.details_token_mint(v_item, 14);
      v_msg := public.enqueue_message(r.person_id, 'details_check_request', jsonb_build_object('facts', cardinality(r.facts)), null,
        'details-check:' || v_item || ':request');
      if v_msg is not null then
        update public.messages set reply_token = v_raw where id = v_msg;
        update public.details_check_items set message_id = v_msg where id = v_item;
      end if;
    end if;
    -- The history shows who proposed the value, from the day they did. Only a real asking writes it: a Rehearsal changes nothing a person's record shows.
    if v_live then
      foreach k in array r.facts loop
        if not exists (select 1 from public.profile_fact_history h where h.person_id = r.person_id and h.key = k and h.event = 'proposed') then
          v_at := (public.profile_fact_current(r.person_id, k) ->> 'at')::timestamptz;
          insert into public.profile_fact_history (person_id, key, event, new_value, by_kind, via, note, at)
          values (r.person_id, k, 'proposed', public.profile_fact_current(r.person_id, k) ->> 'value', 'office',
                  case when public.profile_fact_current(r.person_id, k) ->> 'source' = 'appointment' then 'appointment' end,
                  'The value came from the church office, not from the person', coalesce(v_at, now()));
        end if;
      end loop;
    end if;
    v_asked := v_asked + 1;
  end loop;
  update public.details_checks set asked = v_asked where id = v_id;
  perform public.write_event(me, case when v_live then 'details.sent' else 'details.rehearsed' end, 'details_check', v_id::text, jsonb_build_object('asked', v_asked));
  return jsonb_build_object('ok', true, 'check', v_id, 'asked', v_asked, 'mode', p_mode, 'leftOut', v_left);
end;
$$;

-- The runs, newest first, with a count for each status.
create function public.god_details_checks()
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
             'id', c.id, 'at', c.created_at, 'mode', c.mode, 'facts', to_jsonb(c.facts), 'audience', c.audience ->> 'kind', 'asked', c.asked,
             'leftOut', c.left_out, 'closed', c.closed_at is not null,
             'counts', coalesce((select jsonb_object_agg(s.status, s.n) from (select i.status, count(*)::integer n from public.details_check_items i where i.check_id = c.id group by i.status) s), '{}'::jsonb))
           order by c.created_at desc)
      from (select * from public.details_checks x order by x.created_at desc limit 30) c), '[]'::jsonb);
end;
$$;

-- One run: each person and where it stands. Status only. The answer a person gave is never here.
create function public.god_details_status(p_check uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.details_checks;
begin
  perform public.god_only();
  select * into c from public.details_checks x where x.id = p_check;
  if not found then
    raise exception 'We could not find that run' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', c.id, 'at', c.created_at, 'mode', c.mode, 'facts', to_jsonb(c.facts), 'audience', c.audience ->> 'kind', 'asked', c.asked, 'leftOut', c.left_out, 'closed', c.closed_at is not null,
    'corrected', (select count(*)::integer from public.details_check_items i where i.check_id = c.id and i.answers::text like '%applied_now%'),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'status', i.status,
               'sent', coalesce(m.status in ('sent', 'delivered', 'read'), false), 'channel', m.channel, 'opened', i.opened_at is not null,
               'reminded', i.reminded_at is not null, 'asked', i.escalated_at is not null, 'at', coalesce(i.answered_at, i.created_at), 'wouldSend', i.would_send)
             order by coalesce(nullif(btrim(p.full_name), ''), p.email))
        from public.details_check_items i
        join public.people p on p.id = i.person_id
        left join public.messages m on m.id = i.message_id
       where i.check_id = c.id), '[]'::jsonb));
end;
$$;

-- Stops a run: links stop opening, and what has not gone out is not sent. What people have answered stays.
create function public.god_details_close(p_check uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.details_checks;
begin
  perform public.god_only();
  select * into c from public.details_checks x where x.id = p_check for update;
  if not found then
    raise exception 'We could not find that run' using errcode = 'P0002';
  end if;
  if c.closed_at is not null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.details_checks set closed_at = now() where id = c.id;
  update public.details_check_items set status = 'closed' where check_id = c.id and status in ('queued', 'later', 'rehearsal', 'no_reply');
  delete from public.details_check_tokens where item_id in (select i.id from public.details_check_items i where i.check_id = c.id);
  update public.messages m set status = 'skipped', error = 'The run was stopped', reply_token = null
   where m.status = 'queued' and m.dedupe_key like 'details-check:%'
     and m.id in (select i.message_id from public.details_check_items i where i.check_id = c.id);
  perform public.write_event(me, 'details.closed', 'details_check', c.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The private link
-- ---------------------------------------------------------------------------
-- The item a link opens: hashed, looked up, not expired, the run not stopped. Null for anything else, and the page cannot tell which. Opening
-- a link records only that it was opened (mail scanners open links too); the person presses a button to answer.
create function public.details_item_for_link(p_link text)
returns public.details_check_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
  v_hash text;
begin
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  v_hash := public.details_hash(p_link);
  select x.* into i
    from public.details_check_tokens k
    join public.details_check_items x on x.id = k.item_id
    join public.details_checks c on c.id = x.check_id
   where k.token_hash = v_hash and k.expires_at > now() and c.closed_at is null and c.mode = 'live' and x.status not in ('closed', 'rehearsal');
  if i.id is null then
    return null;
  end if;
  update public.details_check_tokens set clicks = clicks + 1 where token_hash = v_hash;
  update public.details_check_items set opened_at = coalesce(opened_at, now()) where id = i.id;
  -- If the function was switched off since, the link says nothing.
  if public.feature_state_of('details_check', i.person_id) <> 'on' then
    return null;
  end if;
  return i;
end;
$$;

-- The next question for an item: the first fact not yet answered. Null when all are answered.
create function public.details_item_state(p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
  r public.profile_fact_registry;
  cur jsonb;
  k text;
  c public.profile_changes;
begin
  select * into i from public.details_check_items x where x.id = p_item;
  foreach k in array i.facts loop
    continue when i.answers ? k;
    select * into r from public.profile_fact_registry x where x.key = k;
    cur := public.profile_fact_current(i.person_id, k);
    continue when cur ->> 'state' = 'none';
    return jsonb_build_object(
      'found', true, 'done', false, 'first', public.first_name_of(i.person_id), 'key', k, 'label', r.label,
      'question', replace(r.question, '{value}', cur ->> 'label'), 'valueLabel', cur ->> 'label', 'options', public.profile_fact_options(k),
      'left', (select count(*)::integer from unnest(i.facts) f where not (i.answers ? f)));
  end loop;
  select * into c from public.profile_changes x where x.person_id = i.person_id and x.status = 'pending' order by x.requested_at desc limit 1;
  return jsonb_build_object('found', true, 'done', true, 'first', public.first_name_of(i.person_id), 'answers', i.answers,
    'waiting', c.id is not null);
end;
$$;

-- An answer given on a link. Records it on the item, and when every fact is answered, settles the item's status.
create function public.details_item_answer(p_item uuid, p_key text, p_action text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
  v_res jsonb;
  v_outcome text;
  v_answers jsonb;
  v_status text;
begin
  select * into i from public.details_check_items x where x.id = p_item for update;
  if not found or not (p_key = any (i.facts)) or i.answers ? p_key then
    return jsonb_build_object('ok', false, 'reason', 'not_asked');
  end if;
  v_res := public.profile_fact_answer(i.person_id, p_key, p_action, p_value, 'details_check');
  if (v_res ->> 'ok')::boolean is not true then
    return v_res;
  end if;
  v_outcome := v_res ->> 'outcome';
  v_answers := i.answers || jsonb_build_object(p_key, v_outcome);
  if (select count(*) from unnest(i.facts) f where not (v_answers ? f)) = 0 or v_outcome in ('not_me') then
    v_status := case
      when v_answers::text like '%not_me%' then 'not_me'
      when v_answers::text like '%pending_review%' then 'pending_review'
      when v_answers::text like '%applied_now%' or v_answers::text like '%recorded%' then 'changed'
      when v_answers::text like '%later%' then 'later'
      else 'confirmed' end;
    update public.details_check_items
       set answers = v_answers, status = v_status, answered_at = now(),
           snoozed_until = case when v_status = 'later' then now() + interval '3 days' end,
           -- Asking again later moves the reminder and the call along with it
           remind_at = case when v_status = 'later' then now() + interval '6 days' else remind_at end,
           escalate_at = case when v_status = 'later' then now() + interval '10 days' else escalate_at end
     where id = i.id;
  else
    update public.details_check_items set answers = v_answers where id = i.id;
  end if;
  return v_res;
end;
$$;

-- ---- signed in: one tap ----
create function public.details_check_info(p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  i public.details_check_items;
begin
  if me is null then
    return jsonb_build_object('found', false, 'reason', 'signed_out');
  end if;
  i := public.details_item_for_link(p_link);
  if i.id is null then
    return jsonb_build_object('found', false);
  end if;
  if i.person_id <> me then
    -- Someone else's link: say nothing about whose.
    return jsonb_build_object('found', false, 'reason', 'other_account');
  end if;
  return public.details_item_state(i.id);
end;
$$;

create function public.details_check_answer(p_link text, p_key text, p_action text, p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  i public.details_check_items;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  i := public.details_item_for_link(p_link);
  if i.id is null or i.person_id <> me then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.details_item_answer(i.id, p_key, p_action, p_value);
end;
$$;

-- ---- not signed in: the code ----
-- Is this session good for this item? True only for the session the code opened, before it ends.
create function public.details_session_ok(p_item uuid, p_session text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_session ~ '^[a-f0-9]{64}$' and exists (
    select 1 from public.details_check_access a
     where a.item_id = p_item and a.session_hash = public.details_hash(p_session) and a.session_expires_at > now());
$$;

create function public.worker_details_info(p_token text, p_link text, p_session text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
begin
  perform public.worker_ok(p_token);
  i := public.details_item_for_link(p_link);
  if i.id is null then
    return jsonb_build_object('found', false);
  end if;
  if not public.details_session_ok(i.id, p_session) then
    return jsonb_build_object('found', true, 'needsCode', true);
  end if;
  return public.details_item_state(i.id);
end;
$$;

-- Sends a six-digit code. By email, or by text when the link came by text and the person agreed to texts. Never by WhatsApp: a one-time code
-- there needs Meta's own category. A few an hour, and five wrong tries lock it for half an hour.
create function public.worker_details_code_send(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
  a public.details_check_access;
  v_ch text;
  v_chans text[];
  v_code text;
  v_salt text;
  v_msg uuid;
  v_email text;
  v_phone text;
begin
  perform public.worker_ok(p_token);
  i := public.details_item_for_link(p_link);
  if i.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.details_check_access (item_id) values (i.id) on conflict (item_id) do nothing;
  select * into a from public.details_check_access x where x.item_id = i.id for update;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', greatest(1, ceil(extract(epoch from (a.locked_until - now())) / 60)::integer));
  end if;
  if a.codes_since is null or a.codes_since < now() - interval '1 hour' then
    a.codes_sent := 0;
    a.codes_since := now();
  end if;
  if a.codes_sent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_chans := public.details_channels(i.person_id);
  v_ch := case when 'email' = any (v_chans) then 'email' when 'sms' = any (v_chans) then 'sms' end;
  if v_ch is null then
    return jsonb_build_object('ok', false, 'reason', 'no_way');
  end if;
  select p.email, cp.phone into v_email, v_phone from public.people p left join public.contact_preferences cp on cp.person_id = p.id where p.id = i.person_id;
  v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
  v_salt := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.details_check_access
     set code_salt = v_salt, code_hash = public.details_hash(v_salt || v_code), code_expires_at = now() + interval '10 minutes', code_tries = 0,
         codes_sent = a.codes_sent + 1, codes_since = a.codes_since
   where item_id = i.id;
  v_msg := public.enqueue_message(i.person_id, 'details_check_code', jsonb_build_object('code', v_code, 'minutes', 10), null,
    'details-check:' || i.id || ':code:' || extract(epoch from clock_timestamp())::bigint, null, 'urgent', v_ch);
  return jsonb_build_object('ok', true, 'via', v_ch,
    'to', case v_ch when 'email' then left(v_email, 1) || '***' || substr(v_email, position('@' in v_email)) else '***' || right(coalesce(v_phone, ''), 3) end);
end;
$$;

create function public.worker_details_code_check(p_token text, p_link text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
  a public.details_check_access;
  v_session text;
begin
  perform public.worker_ok(p_token);
  i := public.details_item_for_link(p_link);
  if i.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into a from public.details_check_access x where x.item_id = i.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', greatest(1, ceil(extract(epoch from (a.locked_until - now())) / 60)::integer));
  end if;
  if a.code_hash is null or a.code_expires_at is null or a.code_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'format');
  end if;
  if public.details_hash(a.code_salt || p_code) <> a.code_hash then
    update public.details_check_access
       set locked_until = case when code_tries + 1 >= 5 then now() + interval '30 minutes' else locked_until end,
           code_hash = case when code_tries + 1 >= 5 then null else code_hash end,
           code_tries = case when code_tries + 1 >= 5 then 0 else code_tries + 1 end
     where item_id = i.id;
    if a.code_tries + 1 >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', 30);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'triesLeft', 5 - a.code_tries - 1);
  end if;
  v_session := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.details_check_access
     set code_hash = null, code_salt = null, code_tries = 0, session_hash = public.details_hash(v_session), session_expires_at = now() + interval '3 hours'
   where item_id = i.id;
  return jsonb_build_object('ok', true, 'session', v_session);
end;
$$;

create function public.worker_details_answer(p_token text, p_link text, p_session text, p_key text, p_action text, p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.details_check_items;
begin
  perform public.worker_ok(p_token);
  i := public.details_item_for_link(p_link);
  if i.id is null or not public.details_session_ok(i.id, p_session) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.details_item_answer(i.id, p_key, p_action, p_value);
end;
$$;

-- ---------------------------------------------------------------------------
-- The heartbeat's part: reminders, the call, and clearing out
-- ---------------------------------------------------------------------------
-- Day 3: one reminder by the other channel. Day 7: the coach, or a director when there is none, is asked to speak to the person. Nothing
-- else is automated. Links and codes are forgotten once they have done their work. A person who asked to be asked later is left alone
-- until that time. The Master pause and a switch that has gone Off stop all of it.
create function public.worker_details_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_first text;
  v_other text;
  v_raw text;
  v_msg uuid;
  v_coach uuid;
  v_centre uuid;
  v_reminded integer := 0;
  v_called integer := 0;
  v_scrubbed integer := 0;
  v_expired integer := 0;
begin
  perform public.worker_ok(p_token);

  -- Links and codes are forgotten once their message is finished with.
  update public.messages set reply_token = null
   where reply_token is not null and template in ('details_check_request', 'details_check_reminder')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_scrubbed = row_count;
  update public.messages set params = params - 'code'
   where template = 'details_check_code' and params ? 'code'
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '30 minutes'));
  delete from public.details_check_tokens where expires_at < now();
  update public.details_check_access set code_hash = null, code_salt = null where code_hash is not null and code_expires_at < now();
  update public.details_check_access set session_hash = null where session_hash is not null and session_expires_at < now();

  for r in
    select i.* from public.details_check_items i join public.details_checks c on c.id = i.check_id
     where i.status = 'queued' and i.reminded_at is null and i.remind_at <= now() and c.mode = 'live' and c.closed_at is null
       and (i.snoozed_until is null or i.snoozed_until <= now())
     order by i.remind_at limit 200
  loop
    continue when public.feature_state_of('details_check', r.person_id) <> 'on';
    v_raw := public.details_token_mint(r.id, 14);
    -- The other channel, when there is one
    v_other := (select x from unnest(public.details_channels(r.person_id)) x
                 where x is distinct from (select m.channel from public.messages m where m.id = r.message_id) limit 1);
    v_msg := public.enqueue_message(r.person_id, 'details_check_reminder', jsonb_build_object('facts', cardinality(r.facts)), null,
      'details-check:' || r.id || ':reminder', null, 'normal', v_other);
    if v_msg is not null then
      update public.messages set reply_token = v_raw where id = v_msg;
    end if;
    update public.details_check_items set reminded_at = now() where id = r.id;
    v_reminded := v_reminded + 1;
  end loop;

  for r in
    select i.* from public.details_check_items i join public.details_checks c on c.id = i.check_id
     where i.status in ('queued', 'later') and i.escalated_at is null and i.escalate_at <= now() and c.mode = 'live' and c.closed_at is null
       and (i.snoozed_until is null or i.snoozed_until <= now())
     order by i.escalate_at limit 200
  loop
    continue when public.feature_state_of('details_check', r.person_id) <> 'on';
    v_first := public.first_name_of(r.person_id);
    select t.coach_id into v_coach from public.tribes t where t.leader_id = r.person_id and t.status <> 'closed' order by t.created_at desc limit 1;
    select p.centre_id into v_centre from public.people p where p.id = r.person_id;
    begin
      if v_coach is not null and public.notify_named(v_coach, 'coach', 'coach_details_unanswered', 'details:' || r.id,
           jsonb_build_object('leader', v_first), 'Please speak to ' || v_first || ' about their details', '/coach') is not null then
        null;
      else
        perform public.notify_role(v_centre, array['director'], 'staff_escalation', 'details:' || r.id,
          jsonb_build_object('what', 'leader who has not yet confirmed their details', 'count', 1, 'days', 7),
          v_first || ' has not confirmed their details', '/admin');
      end if;
    exception when others then
      perform public.notice_fault('details_check', sqlerrm);
    end;
    update public.details_check_items set escalated_at = now(), status = case when status = 'queued' then 'no_reply' else status end where id = r.id;
    v_called := v_called + 1;
  end loop;

  -- A run's links have all run out: whoever has not answered is marked as no reply.
  update public.details_check_items i set status = 'no_reply'
   where i.status = 'queued' and i.created_at < now() - interval '14 days'
     and not exists (select 1 from public.details_check_tokens k where k.item_id = i.id);
  get diagnostics v_expired = row_count;
  return jsonb_build_object('reminded', v_reminded, 'called', v_called, 'scrubbed', v_scrubbed, 'expired', v_expired);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader's welcome email carries "Confirm your details" once the Details Check is open for them. A step in the message's own insert, so the
-- three functions that queue the welcome email are untouched. With the switch Off, the email is exactly what it was.
-- ---------------------------------------------------------------------------
create function public.messages_welcome_confirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is not null
     and public.feature_state_of('details_check', new.person_id) = 'on'
     and public.profile_fact_current(new.person_id, 'life_stage') ->> 'state' = 'unconfirmed' then
    new.params := coalesce(new.params, '{}'::jsonb) || jsonb_build_object('confirm_details', true);
  end if;
  return new;
exception when others then
  return new;
end;
$$;
create trigger messages_welcome_confirm
  before insert on public.messages
  for each row when (new.template = 'leader_welcome')
  execute function public.messages_welcome_confirm();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Everything is closed first. Then three groups are opened: what a signed-in person may ask or do about themselves, the console's functions
-- (each begins god_only(), which also needs the owner to be unlocked on this sign-in), and what the private page and the heartbeat call with
-- the sending service's token. The rest are internal and callable by nothing but the functions above.
revoke execute on function
  public.details_channels(p_person uuid),
  public.details_check_answer(p_link text, p_key text, p_action text, p_value text),
  public.details_check_info(p_link text),
  public.details_clean_facts(p_facts text[]),
  public.details_hash(p_text text),
  public.details_item_answer(p_item uuid, p_key text, p_action text, p_value text),
  public.details_item_for_link(p_link text),
  public.details_item_state(p_item uuid),
  public.details_plan_rows(p_audience jsonb, p_facts text[], p_live boolean),
  public.details_session_ok(p_item uuid, p_session text),
  public.details_token_mint(p_item uuid, p_days integer),
  public.details_would_send(p_person uuid),
  public.feature_held_back(p_person uuid),
  public.feature_position_at(p_key text, p_scope text, p_scope_id uuid),
  public.feature_rank(p_position text),
  public.feature_rule_for(p_key text, p_person uuid),
  public.feature_scope_label(p_scope text, p_id uuid),
  public.feature_state(p_key text, p_person uuid),
  public.feature_state_of(p_key text, p_person uuid, p_depth integer),
  public.feature_summary(p_key text),
  public.features_overview(),
  public.god_details_checks(),
  public.god_details_close(p_check uuid),
  public.god_details_plan(p_audience jsonb, p_facts text[], p_mode text),
  public.god_details_send(p_audience jsonb, p_facts text[], p_mode text),
  public.god_details_status(p_check uuid),
  public.god_feature_board(),
  public.god_feature_find(p_scope text, p_q text),
  public.god_feature_log(p_limit integer),
  public.god_feature_master(p_paused boolean, p_reason text),
  public.god_feature_remove(p_rule uuid, p_reason text),
  public.god_feature_set(p_feature text, p_scope text, p_scope_id uuid, p_position text, p_roles text[], p_reason text, p_holdout_until date),
  public.messages_welcome_confirm(),
  public.my_features(),
  public.my_page_answer(p_key text, p_action text, p_value text),
  public.my_page_state(),
  public.profile_fact_answer(p_person uuid, p_key text, p_action text, p_value text, p_via text),
  public.profile_fact_applies(p_person uuid, p_key text),
  public.profile_fact_current(p_person uuid, p_key text),
  public.profile_fact_label(p_key text, p_value text),
  public.profile_fact_options(p_key text),
  public.profile_stage_confirmed(p_person uuid),
  public.profile_track_phrase(p_slug text),
  public.stage_review_decide(p_id uuid, p_approve boolean, p_note text),
  public.stage_reviews_list(),
  public.tribe_stage_status(p_tribe uuid),
  public.tribes_hold_for_stage(),
  public.worker_details_answer(p_token text, p_link text, p_session text, p_key text, p_action text, p_value text),
  public.worker_details_code_check(p_token text, p_link text, p_code text),
  public.worker_details_code_send(p_token text, p_link text),
  public.worker_details_info(p_token text, p_link text, p_session text),
  public.worker_details_tick(p_token text)
  from public, anon, authenticated;

-- A signed-in person: about themselves only, or (for staff) what their role already reads
grant execute on function
  public.feature_state(p_key text, p_person uuid),
  public.my_features(),
  public.my_page_state(),
  public.my_page_answer(p_key text, p_action text, p_value text),
  public.details_check_info(p_link text),
  public.details_check_answer(p_link text, p_key text, p_action text, p_value text),
  public.stage_reviews_list(),
  public.stage_review_decide(p_id uuid, p_approve boolean, p_note text),
  public.tribe_stage_status(p_tribe uuid),
  public.features_overview()
  to authenticated;

-- The console
grant execute on function
  public.god_feature_board(),
  public.god_feature_find(p_scope text, p_q text),
  public.god_feature_set(p_feature text, p_scope text, p_scope_id uuid, p_position text, p_roles text[], p_reason text, p_holdout_until date),
  public.god_feature_remove(p_rule uuid, p_reason text),
  public.god_feature_master(p_paused boolean, p_reason text),
  public.god_feature_log(p_limit integer),
  public.god_details_plan(p_audience jsonb, p_facts text[], p_mode text),
  public.god_details_send(p_audience jsonb, p_facts text[], p_mode text),
  public.god_details_checks(),
  public.god_details_status(p_check uuid),
  public.god_details_close(p_check uuid)
  to authenticated;

-- The private page and the heartbeat: no account; the sending service's token is the credential
grant execute on function
  public.worker_details_info(p_token text, p_link text, p_session text),
  public.worker_details_code_send(p_token text, p_link text),
  public.worker_details_code_check(p_token text, p_link text, p_code text),
  public.worker_details_answer(p_token text, p_link text, p_session text, p_key text, p_action text, p_value text),
  public.worker_details_tick(p_token text)
  to anon;

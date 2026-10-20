-- Phase 4 (database): the Tribe Card catalogue.
--
-- One reviewed "ready-made card" for every goal a leader can run: who it is for, the three Success Picture lines, the three
-- weekly ideas, a guardrail, and a hidden profile (what the group asks of its leader, and whether it is a sensitive subject) that
-- only the compatibility test and the pastorate can see. Written against the live (renamed) schema: communities, tribes.
--
-- This file adds new objects only. It never inserts a goal and never edits a goal's weekly ideas; a goal is created, or switched
-- back on, only when a pastor or director signs its card off. The cards themselves are loaded by the next two files.
--
-- Nobody but these functions can read the table: row level security is on and no client policy exists.


create table public.tribe_card_templates (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 50),
  community_id uuid not null references public.communities (id),
  family_id uuid not null references public.goal_families (id),
  season_goal_id uuid unique references public.season_goals (id),
  title text not null check (title = btrim(title) and char_length(title) between 6 and 100),
  sort integer not null default 0,
  who_for text not null check (char_length(btrim(who_for)) between 10 and 160),
  loving_god text not null check (char_length(btrim(loving_god)) between 10 and 200),
  loving_others text not null check (char_length(btrim(loving_others)) between 10 and 200),
  loving_life text not null check (char_length(btrim(loving_life)) between 10 and 200),
  week12_outcome text not null check (char_length(btrim(week12_outcome)) between 10 and 200),
  arc_1 text not null check (char_length(btrim(arc_1)) between 10 and 300),
  arc_2 text not null check (char_length(btrim(arc_2)) between 10 and 300),
  arc_3 text not null check (char_length(btrim(arc_3)) between 10 and 300),
  guardrail text not null check (char_length(btrim(guardrail)) between 10 and 300),
  track_slugs text[] not null check (cardinality(track_slugs) >= 1),
  rhythm_slot text not null check (rhythm_slot in ('sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning')),
  rhythm_mode text not null check (rhythm_mode in ('online', 'in_person')),
  who_leads_well text not null check (char_length(btrim(who_leads_well)) between 10 and 300),
  demand_structure smallint not null check (demand_structure between 0 and 3),
  demand_connection smallint not null check (demand_connection between 0 and 3),
  demand_teaching smallint not null check (demand_teaching between 0 and 3),
  demand_doing smallint not null check (demand_doing between 0 and 3),
  sensitive boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'signed_off', 'retired')),
  signed_off_by uuid references public.people (id) on delete set null,
  signed_off_at timestamptz,
  version integer not null default 1,
  updated_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (demand_structure + demand_connection + demand_teaching + demand_doing > 0),
  check (status <> 'signed_off' or (signed_off_at is not null))
);
create unique index tribe_card_templates_title_uk on public.tribe_card_templates (community_id, lower(title));
create index tribe_card_templates_status_idx on public.tribe_card_templates (status, community_id, sort);
alter table public.tribe_card_templates enable row level security;
revoke all on table public.tribe_card_templates from public, anon, authenticated;
create trigger tribe_card_templates_touch before update on public.tribe_card_templates
  for each row execute function public.touch_updated_at();

-- Internal: the first thing wrong with a template that is about to be signed off, in plain words, or null.
create function public.card_template_problem(t public.tribe_card_templates)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s text;
begin
  if not exists (select 1 from public.communities c where c.id = t.community_id and c.active) then
    return 'This community is switched off';
  end if;
  if 'To be written by the pastorate' in (t.who_for, t.loving_god, t.loving_others, t.loving_life, t.week12_outcome, t.guardrail, t.who_leads_well) then
    return 'This card still has text that has not been written';
  end if;
  foreach s in array t.track_slugs loop
    if not exists (select 1 from public.tracks k where k.slug = s and k.active) then
      return format('The life stage "%s" is not available', s);
    end if;
  end loop;
  if exists (select 1 from public.season_goals g
              where g.community_id = t.community_id and lower(g.title) = lower(t.title) and g.slug <> t.slug) then
    return 'This community already has a goal with that title';
  end if;
  if exists (select 1 from public.season_goals g where g.slug = t.slug and g.community_id <> t.community_id) then
    return 'That goal name is already used in another community';
  end if;
  if t.season_goal_id is not null
     and not exists (select 1 from public.season_goals g where g.id = t.season_goal_id and g.community_id = t.community_id) then
    return 'This card points at a goal in a different community';
  end if;
  return null;
end;
$$;

-- Internal: signs one template off and makes sure its goal exists, is on, and has exactly the three weekly ideas.
create function public.card_template_activate(p_slug text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tribe_card_templates%rowtype;
  g public.season_goals%rowtype;
  v_goal uuid;
  v_new boolean := false;
  v_problem text;
begin
  select * into t from public.tribe_card_templates x where x.slug = p_slug for update;
  if not found then
    raise exception 'We could not find that card' using errcode = 'P0002';
  end if;
  if t.status = 'signed_off' then
    return jsonb_build_object('slug', t.slug, 'goal_id', t.season_goal_id, 'already', true);
  end if;
  v_problem := public.card_template_problem(t);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;

  if t.season_goal_id is not null then
    select * into g from public.season_goals x where x.id = t.season_goal_id for update;
  else
    select * into g from public.season_goals x where x.slug = t.slug for update;
  end if;
  if found then
    v_goal := g.id;
    -- A goal the catalogue has switched off stays off unless this card was the one retired.
    if not g.active and t.status <> 'retired' then
      raise exception 'This goal is switched off in the catalogue. Switch it on there first' using errcode = '22023';
    end if;
    if not g.active then
      update public.season_goals set active = true where id = v_goal;
    end if;
  else
    insert into public.season_goals (community_id, family_id, slug, title, sort, active)
    values (t.community_id, t.family_id, t.slug, t.title, t.sort, true)
    returning id into v_goal;
    v_new := true;
  end if;

  insert into public.goal_ideas (season_goal_id, phase, idea)
  values (v_goal, 1, btrim(t.arc_1)), (v_goal, 2, btrim(t.arc_2)), (v_goal, 3, btrim(t.arc_3))
  on conflict (season_goal_id, phase) do update set idea = excluded.idea;

  update public.tribe_card_templates
     set season_goal_id = v_goal, status = 'signed_off', signed_off_by = p_by, signed_off_at = now(), updated_by = p_by
   where slug = t.slug;
  perform public.write_event(p_by, 'card_template.signed_off', 'tribe_card_template', t.slug,
    jsonb_build_object('new_goal', v_new, 'version', t.version));
  return jsonb_build_object('slug', t.slug, 'goal_id', v_goal, 'new_goal', v_new, 'already', false);
end;
$$;

create function public.card_template_list()
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
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see card templates' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'total', count(*), 'draft', count(*) filter (where status = 'draft'),
        'signed_off', count(*) filter (where status = 'signed_off'), 'retired', count(*) filter (where status = 'retired'))
       from public.tribe_card_templates),
    'by_community', coalesce((
      select jsonb_agg(jsonb_build_object(
        'community_id', c.id, 'slug', c.slug, 'name', c.name, 'total', x.total, 'signed_off', x.signed_off,
        'draft', x.draft, 'retired', x.retired, 'sensitive_left', x.sensitive_left) order by c.sort, c.name)
        from public.communities c
        join (select t.community_id,
                     count(*) as total,
                     count(*) filter (where t.status = 'signed_off') as signed_off,
                     count(*) filter (where t.status = 'draft') as draft,
                     count(*) filter (where t.status = 'retired') as retired,
                     count(*) filter (where t.sensitive and t.status <> 'signed_off') as sensitive_left
                from public.tribe_card_templates t group by t.community_id) x on x.community_id = c.id), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', t.slug, 'title', t.title, 'community_id', t.community_id, 'community', c.name, 'family_id', t.family_id,
        'goal_id', t.season_goal_id, 'goal_active', g.active,
        'sort', t.sort, 'who_for', t.who_for, 'loving_god', t.loving_god, 'loving_others', t.loving_others, 'loving_life', t.loving_life,
        'week12_outcome', t.week12_outcome, 'arc', jsonb_build_array(t.arc_1, t.arc_2, t.arc_3), 'guardrail', t.guardrail,
        'tracks', to_jsonb(t.track_slugs), 'rhythm_slot', t.rhythm_slot, 'rhythm_mode', t.rhythm_mode,
        'who_leads_well', t.who_leads_well,
        'demand', jsonb_build_object('structure', t.demand_structure, 'connection', t.demand_connection, 'teaching', t.demand_teaching, 'doing', t.demand_doing),
        'sensitive', t.sensitive, 'status', t.status, 'version', t.version, 'signed_off_at', t.signed_off_at,
        -- A hidden owner's name is never shown
        'signed_off_by', (select public.person_display_name(p.id) from public.people p where p.id = t.signed_off_by and not p.hidden),
        'updated_at', t.updated_at)
        order by c.sort, t.sort, t.title)
      from public.tribe_card_templates t
      join public.communities c on c.id = t.community_id
      left join public.season_goals g on g.id = t.season_goal_id), '[]'::jsonb));
end;
$$;

create function public.card_template_save(p_slug text, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tribe_card_templates%rowtype;
  k text;
  allowed constant text[] := array['title', 'who_for', 'loving_god', 'loving_others', 'loving_life', 'week12_outcome', 'arc_1', 'arc_2', 'arc_3',
    'guardrail', 'track_slugs', 'rhythm_slot', 'rhythm_mode', 'who_leads_well', 'demand_structure', 'demand_connection', 'demand_teaching',
    'demand_doing', 'sensitive'];
  v_was text;
  v_tracks text[];
  s text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can edit card templates' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    raise exception 'There is nothing to save' using errcode = '22023';
  end if;
  select * into t from public.tribe_card_templates x where x.slug = p_slug for update;
  if not found then
    raise exception 'We could not find that card' using errcode = 'P0002';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any (allowed)) then
      raise exception 'Unknown field: %', k using errcode = '22023';
    end if;
  end loop;
  v_was := t.status;

  if p_fields ? 'title' then
    if t.season_goal_id is not null then
      raise exception 'The title of a card whose goal exists is changed in the catalogue' using errcode = '22023';
    end if;
    t.title := public.admin_text(p_fields ->> 'title', 'The title', 6, 100);
  end if;
  if p_fields ? 'who_for' then t.who_for := public.admin_text(p_fields ->> 'who_for', 'Who it is for', 10, 160); end if;
  if p_fields ? 'loving_god' then t.loving_god := public.admin_text(p_fields ->> 'loving_god', 'The Loving God line', 10, 200); end if;
  if p_fields ? 'loving_others' then t.loving_others := public.admin_text(p_fields ->> 'loving_others', 'The Loving Others line', 10, 200); end if;
  if p_fields ? 'loving_life' then t.loving_life := public.admin_text(p_fields ->> 'loving_life', 'The Loving Life line', 10, 200); end if;
  if p_fields ? 'week12_outcome' then t.week12_outcome := public.admin_text(p_fields ->> 'week12_outcome', 'The week-12 outcome', 10, 200); end if;
  if p_fields ? 'arc_1' then t.arc_1 := public.admin_text(p_fields ->> 'arc_1', 'The weeks 1 to 4 idea', 10, 300); end if;
  if p_fields ? 'arc_2' then t.arc_2 := public.admin_text(p_fields ->> 'arc_2', 'The weeks 5 to 8 idea', 10, 300); end if;
  if p_fields ? 'arc_3' then t.arc_3 := public.admin_text(p_fields ->> 'arc_3', 'The weeks 9 to 12 idea', 10, 300); end if;
  if p_fields ? 'guardrail' then t.guardrail := public.admin_text(p_fields ->> 'guardrail', 'The guardrail', 10, 300); end if;
  if p_fields ? 'who_leads_well' then t.who_leads_well := public.admin_text(p_fields ->> 'who_leads_well', 'The note on who leads it well', 10, 300); end if;
  if p_fields ? 'track_slugs' then
    if jsonb_typeof(p_fields -> 'track_slugs') <> 'array' then
      raise exception 'Choose at least one life stage' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_tracks from jsonb_array_elements_text(p_fields -> 'track_slugs') x;
    if cardinality(v_tracks) = 0 then
      raise exception 'Choose at least one life stage' using errcode = '22023';
    end if;
    foreach s in array v_tracks loop
      if not exists (select 1 from public.tracks tr where tr.slug = s and tr.active) then
        raise exception 'The life stage "%" is not available', s using errcode = '22023';
      end if;
    end loop;
    t.track_slugs := v_tracks;
  end if;
  if p_fields ? 'rhythm_slot' then
    if (p_fields ->> 'rhythm_slot') is null or not ((p_fields ->> 'rhythm_slot') in ('sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning')) then
      raise exception 'Choose one of the four meeting times' using errcode = '22023';
    end if;
    t.rhythm_slot := p_fields ->> 'rhythm_slot';
  end if;
  if p_fields ? 'rhythm_mode' then
    if (p_fields ->> 'rhythm_mode') is null or not ((p_fields ->> 'rhythm_mode') in ('online', 'in_person')) then
      raise exception 'Choose online or in person' using errcode = '22023';
    end if;
    t.rhythm_mode := p_fields ->> 'rhythm_mode';
  end if;
  foreach s in array array['structure', 'connection', 'teaching', 'doing'] loop
    if p_fields ? ('demand_' || s) then
      if jsonb_typeof(p_fields -> ('demand_' || s)) <> 'number' or (p_fields ->> ('demand_' || s)) !~ '^[0-3]$' then
        raise exception 'Each way of leading is a whole number from 0 to 3' using errcode = '22023';
      end if;
      case s
        when 'structure' then t.demand_structure := (p_fields ->> 'demand_structure')::smallint;
        when 'connection' then t.demand_connection := (p_fields ->> 'demand_connection')::smallint;
        when 'teaching' then t.demand_teaching := (p_fields ->> 'demand_teaching')::smallint;
        else t.demand_doing := (p_fields ->> 'demand_doing')::smallint;
      end case;
    end if;
  end loop;
  if t.demand_structure + t.demand_connection + t.demand_teaching + t.demand_doing = 0 then
    raise exception 'At least one way of leading must be above 0' using errcode = '22023';
  end if;
  if p_fields ? 'sensitive' then
    if jsonb_typeof(p_fields -> 'sensitive') <> 'boolean' then
      raise exception 'Sensitive is yes or no' using errcode = '22023';
    end if;
    t.sensitive := (p_fields ->> 'sensitive')::boolean;
  end if;

  update public.tribe_card_templates set
    title = t.title, who_for = t.who_for, loving_god = t.loving_god, loving_others = t.loving_others, loving_life = t.loving_life,
    week12_outcome = t.week12_outcome, arc_1 = t.arc_1, arc_2 = t.arc_2, arc_3 = t.arc_3, guardrail = t.guardrail,
    track_slugs = t.track_slugs, rhythm_slot = t.rhythm_slot, rhythm_mode = t.rhythm_mode, who_leads_well = t.who_leads_well,
    demand_structure = t.demand_structure, demand_connection = t.demand_connection, demand_teaching = t.demand_teaching,
    demand_doing = t.demand_doing, sensitive = t.sensitive,
    -- Any change takes a signed-off card back to draft: nothing is live without a new sign-off.
    status = case when v_was = 'signed_off' then 'draft' else v_was end,
    signed_off_by = case when v_was = 'signed_off' then null else t.signed_off_by end,
    signed_off_at = case when v_was = 'signed_off' then null else t.signed_off_at end,
    version = t.version + 1, updated_by = uid
   where slug = t.slug;
  perform public.write_event(uid, 'card_template.saved', 'tribe_card_template', t.slug,
    jsonb_build_object('fields', (select jsonb_agg(f) from jsonb_object_keys(p_fields) f), 'returned_to_draft', v_was = 'signed_off'));
  return jsonb_build_object('slug', t.slug, 'status', case when v_was = 'signed_off' then 'draft' else v_was end, 'version', t.version + 1);
end;
$$;

create function public.card_template_sign_off(p_slug text)
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
  if not public.has_any_role(array['director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor and directors can sign off a card' using errcode = '42501';
  end if;
  return public.card_template_activate(p_slug, uid);
end;
$$;

-- Signs off every unsigned card in one community, except sensitive ones, which are always signed off one at a time.
create function public.card_template_sign_off_community(p_community uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r record;
  v_signed text[] := '{}';
  v_sensitive integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor and directors can sign off cards' using errcode = '42501';
  end if;
  if not exists (select 1 from public.communities c where c.id = p_community) then
    raise exception 'Choose a community' using errcode = '22023';
  end if;
  select count(*) into v_sensitive from public.tribe_card_templates t
   where t.community_id = p_community and t.status <> 'signed_off' and t.sensitive;
  for r in
    select t.slug, t.title from public.tribe_card_templates t
     where t.community_id = p_community and t.status = 'draft' and not t.sensitive
     order by t.sort, t.title
  loop
    begin
      perform public.card_template_activate(r.slug, uid);
    exception when others then
      raise exception '%: %', r.title, sqlerrm using errcode = '22023';
    end;
    v_signed := array_append(v_signed, r.slug);
  end loop;
  return jsonb_build_object('signed', to_jsonb(v_signed), 'left_for_one_by_one', v_sensitive);
end;
$$;

create function public.card_template_retire(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tribe_card_templates%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor and directors can retire a card' using errcode = '42501';
  end if;
  select * into t from public.tribe_card_templates x where x.slug = p_slug for update;
  if not found then
    raise exception 'We could not find that card' using errcode = 'P0002';
  end if;
  if t.status = 'retired' then
    return jsonb_build_object('slug', t.slug, 'status', 'retired');
  end if;
  update public.tribe_card_templates set status = 'retired', updated_by = uid where slug = t.slug;
  if t.season_goal_id is not null then
    update public.season_goals set active = false where id = t.season_goal_id;
  end if;
  perform public.write_event(uid, 'card_template.retired', 'tribe_card_template', t.slug, '{}'::jsonb);
  return jsonb_build_object('slug', t.slug, 'status', 'retired');
end;
$$;

-- A goal created in the catalogue (not from the 100) gets a draft card here, so it can join the compatibility test.
create function public.card_template_create_for_goal(p_goal uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  g public.season_goals%rowtype;
  v_slug text;
  v_key text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can add card templates' using errcode = '42501';
  end if;
  select * into g from public.season_goals x where x.id = p_goal;
  if not found then
    raise exception 'We could not find that goal' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.tribe_card_templates t where t.season_goal_id = p_goal or t.slug = g.slug) then
    raise exception 'This goal already has a card' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'There is nothing to save' using errcode = '22023';
  end if;
  foreach v_key in array array['who_for', 'loving_god', 'loving_others', 'loving_life', 'week12_outcome', 'arc_1', 'arc_2', 'arc_3', 'guardrail',
      'track_slugs', 'rhythm_slot', 'rhythm_mode', 'who_leads_well', 'demand_structure', 'demand_connection', 'demand_teaching',
      'demand_doing', 'sensitive'] loop
    if not (p_fields ? v_key) then
      raise exception 'A card needs every field. Missing: %', v_key using errcode = '22023';
    end if;
  end loop;
  v_slug := g.slug;
  -- Created with placeholders that sign-off refuses; every real value arrives through card_template_save, which checks each one.
  insert into public.tribe_card_templates (
    slug, community_id, family_id, season_goal_id, title, sort, who_for, loving_god, loving_others, loving_life, week12_outcome,
    arc_1, arc_2, arc_3, guardrail, track_slugs, rhythm_slot, rhythm_mode, who_leads_well, demand_structure, demand_connection,
    demand_teaching, demand_doing, sensitive, updated_by)
  select v_slug, g.community_id, g.family_id, g.id, g.title, g.sort,
         'To be written by the pastorate',
         'To be written by the pastorate', 'To be written by the pastorate', 'To be written by the pastorate', 'To be written by the pastorate',
         coalesce((select i.idea from public.goal_ideas i where i.season_goal_id = g.id and i.phase = 1), 'To be written by the pastorate'),
         coalesce((select i.idea from public.goal_ideas i where i.season_goal_id = g.id and i.phase = 2), 'To be written by the pastorate'),
         coalesce((select i.idea from public.goal_ideas i where i.season_goal_id = g.id and i.phase = 3), 'To be written by the pastorate'),
         'To be written by the pastorate', array['builders'], 'weeknight-evening', 'online', 'To be written by the pastorate', 1, 1, 1, 1, false, uid;
  perform public.write_event(uid, 'card_template.created', 'tribe_card_template', v_slug, '{}'::jsonb);
  return public.card_template_save(v_slug, p_fields);
end;
$$;

-- What a leader may see of the card behind their own tribe: the public fields only.
create function public.card_template_for_tribe(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  t public.tribe_card_templates%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  -- assistant_id is often null, and null in a plain "or" would let anyone through: every test is forced to true or false.
  if not found or not (coalesce(c.leader_id = uid, false) or coalesce(c.assistant_id = uid, false)
                       or public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[])) then
    raise exception 'We could not find that tribe' using errcode = 'P0002';
  end if;
  select * into t from public.tribe_card_templates x where x.season_goal_id = c.season_goal_id and x.status = 'signed_off';
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'title', t.title, 'who_for', t.who_for, 'loving_god', t.loving_god, 'loving_others', t.loving_others, 'loving_life', t.loving_life,
    'week12_outcome', t.week12_outcome, 'arc', jsonb_build_array(t.arc_1, t.arc_2, t.arc_3), 'guardrail', t.guardrail,
    'rhythm_slot', t.rhythm_slot, 'rhythm_mode', t.rhythm_mode);
end;
$$;

-- Internal: copies the three Success Picture lines of the signed-off card onto a draft tribe card, only where a line is still empty.
-- One copy of this rule, used by the leader's own button and by an accepted offer (Phase 7).
create function public.card_template_fill(p_tribe uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.tribes%rowtype;
  t public.tribe_card_templates%rowtype;
begin
  select * into c from public.tribes x where x.id = p_tribe for update;
  if not found or c.status::text not in ('draft', 'changes_requested') then
    return false;
  end if;
  select * into t from public.tribe_card_templates x where x.season_goal_id = c.season_goal_id and x.status = 'signed_off';
  if not found then
    return false;
  end if;
  update public.tribes set
    loving_god = coalesce(nullif(btrim(loving_god), ''), t.loving_god),
    loving_others = coalesce(nullif(btrim(loving_others), ''), t.loving_others),
    loving_life = coalesce(nullif(btrim(loving_life), ''), t.loving_life)
   where id = p_tribe;
  return true;
end;
$$;

-- The leader's button: "Start from the ready-made card". Never overwrites what they have written.
create function public.card_template_prefill(p_tribe uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  if not found or c.leader_id is distinct from uid then
    raise exception 'We could not find your tribe card' using errcode = 'P0002';
  end if;
  if c.status::text not in ('draft', 'changes_requested') then
    raise exception 'This card can no longer be edited here' using errcode = '22023';
  end if;
  return jsonb_build_object('filled', public.card_template_fill(p_tribe));
end;
$$;

revoke execute on function public.card_template_problem(public.tribe_card_templates), public.card_template_activate(text, uuid),
  public.card_template_fill(uuid)
  from public, anon, authenticated;
revoke execute on function
  public.card_template_list(), public.card_template_save(text, jsonb), public.card_template_sign_off(text),
  public.card_template_sign_off_community(uuid), public.card_template_retire(text), public.card_template_create_for_goal(uuid, jsonb),
  public.card_template_for_tribe(uuid), public.card_template_prefill(uuid)
  from public, anon;
grant execute on function
  public.card_template_list(), public.card_template_save(text, jsonb), public.card_template_sign_off(text),
  public.card_template_sign_off_community(uuid), public.card_template_retire(text), public.card_template_create_for_goal(uuid, jsonb),
  public.card_template_for_tribe(uuid), public.card_template_prefill(uuid)
  to authenticated;

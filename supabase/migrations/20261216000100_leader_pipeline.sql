-- Phase A, part one: the switchboard for becoming a leader (the settings, who may change them, and the record of every change)
--
-- This migration only adds things. Nothing reads the new switches yet, so nothing in the platform behaves differently when it
-- is applied: every switch starts where the process stands today, and no existing function, table or screen is touched.
--
--   leader_pipeline_settings   one row: the position of every switch (required, optional or off; Find your tribe on or off)
--   leader_pipeline_log        one row per setting changed: what it was, what it became, who did it and why
--   leader_application_policy  one row per application sent after the switches exist: the positions in force when it was
--                              sent and when it was decided, and whether the decision rests on full or reduced evidence.
--                              An application with no row was made when every stage was required, which is exactly true of
--                              every application sent before this.
--
-- The functions that change the switches check the role themselves. The office (administrator or director) may change them; a
-- pastor may read the log. The platform owner passes the same role check as an unlocked administrator and is shown in the log
-- only as "an administrator".

-- ---------------------------------------------------------------------------
-- The settings row
-- ---------------------------------------------------------------------------

create table public.leader_pipeline_settings (
  id boolean primary key default true check (id),
  -- The seven eligibility questions. The names match the keys in answers.eligibility and in check_leader_eligibility.
  elig_member6 text not null default 'required' check (elig_member6 in ('required', 'optional', 'off')),
  elig_foundation text not null default 'required' check (elig_foundation in ('required', 'optional', 'off')),
  elig_serving text not null default 'required' check (elig_serving in ('required', 'optional', 'off')),
  elig_age21 text not null default 'required' check (elig_age21 in ('required', 'optional', 'off')),
  elig_time text not null default 'required' check (elig_time in ('required', 'optional', 'off')),
  elig_safeguarding text not null default 'required' check (elig_safeguarding in ('required', 'optional', 'off')),
  elig_confidentiality text not null default 'required' check (elig_confidentiality in ('required', 'optional', 'off')),
  -- Two referees; the reference check
  references_mode text not null default 'required' check (references_mode in ('required', 'optional', 'off')),
  -- The interview with the panel
  interview_mode text not null default 'required' check (interview_mode in ('required', 'optional', 'off')),
  -- Find your tribe: the fit questions on the application and the pastor's fit panel. Off until its weights and cards are approved.
  tribe_fit text not null default 'off' check (tribe_fit in ('on', 'off')),
  -- The Academy: the modules and quizzes, the two workshops and the coach's practice sign-off, together
  academy_mode text not null default 'required' check (academy_mode in ('required', 'optional', 'off')),
  -- The signed safeguarding declaration
  declaration_mode text not null default 'required' check (declaration_mode in ('required', 'off')),
  -- The preset these positions came from, or 'empty' once any switch has been moved by hand
  preset text not null default 'full' check (preset in ('full', 'open_door', 'empty')),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.leader_pipeline_settings default values;

-- ---------------------------------------------------------------------------
-- The change log
-- ---------------------------------------------------------------------------

create table public.leader_pipeline_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The same id for every row written by one press of a preset or one save
  batch uuid not null,
  setting text not null,
  old_value text not null,
  new_value text not null,
  preset text not null check (preset in ('full', 'open_door', 'empty')),
  reason text check (char_length(reason) <= 500),
  -- Empty for the platform owner, who is shown only as "an administrator"
  changed_by uuid references public.people (id) on delete set null,
  shown_as text not null
);
create index leader_pipeline_log_at_idx on public.leader_pipeline_log (at desc, id desc);

-- ---------------------------------------------------------------------------
-- The positions in force for each application
-- ---------------------------------------------------------------------------

create table public.leader_application_policy (
  application_id uuid primary key references public.leader_applications (id) on delete cascade,
  at_send jsonb,
  at_decision jsonb,
  evidence text not null default 'full' check (evidence in ('full', 'reduced')),
  evidence_note text check (char_length(evidence_note) <= 600),
  noted_by uuid references public.people (id) on delete set null,
  decided_at timestamptz
);

alter table public.leader_pipeline_settings enable row level security;
alter table public.leader_pipeline_log enable row level security;
alter table public.leader_application_policy enable row level security;
-- No grants and no policies: only the functions below touch these tables.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- Every other function reads the switches through this one.
create function public.leader_pipeline_cfg()
returns public.leader_pipeline_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.leader_pipeline_settings where id is true;
$$;

-- The switches as the form, the tracker and the screens read them. No names and no log.
create function public.leader_pipeline_json(p_cfg public.leader_pipeline_settings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'eligibility', jsonb_build_object(
      'member6', p_cfg.elig_member6,
      'foundation', p_cfg.elig_foundation,
      'serving', p_cfg.elig_serving,
      'age21', p_cfg.elig_age21,
      'time', p_cfg.elig_time,
      'safeguarding', p_cfg.elig_safeguarding,
      'confidentiality', p_cfg.elig_confidentiality),
    'references', p_cfg.references_mode,
    'interview', p_cfg.interview_mode,
    'tribe_fit', p_cfg.tribe_fit,
    'academy', p_cfg.academy_mode,
    'declaration', p_cfg.declaration_mode,
    'preset', p_cfg.preset,
    'updated_at', p_cfg.updated_at);
$$;

-- A hook. It says whether Find your tribe may be switched on: its weights and cards approved. Until that work is done it is false,
-- so the setters below never need to change when it arrives.
create function public.leader_fit_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

-- The plain name of a setting, for the messages and the log.
create function public.leader_pipeline_label(p_setting text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_setting
    when 'elig_member6' then 'Six months as a member'
    when 'elig_foundation' then 'Foundation of Faith'
    when 'elig_serving' then 'Serving in a team'
    when 'elig_age21' then 'Age 21 or over'
    when 'elig_time' then 'Time each week'
    when 'elig_safeguarding' then 'Safeguarding'
    when 'elig_confidentiality' then 'Confidentiality'
    when 'references_mode' then 'References'
    when 'interview_mode' then 'Interview'
    when 'tribe_fit' then 'Find your tribe'
    when 'academy_mode' then 'Leader Academy'
    when 'declaration_mode' then 'Safeguarding declaration'
    else p_setting end;
$$;

-- ---------------------------------------------------------------------------
-- What anyone signed in may read
-- ---------------------------------------------------------------------------

create function public.leader_pipeline_public()
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
  return public.leader_pipeline_json(public.leader_pipeline_cfg());
end;
$$;

-- ---------------------------------------------------------------------------
-- Changing the switches (the office only)
-- ---------------------------------------------------------------------------

-- Moves one or more switches. A switch set to where it already is changes nothing and logs nothing. An unknown switch, or a value
-- that switch does not take, refuses the whole call and changes nothing.
create function public.leader_pipeline_set(p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.leader_pipeline_settings;
  v_now jsonb;
  k text;
  v text;
  v_old text;
  v_batch uuid := gen_random_uuid();
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_changed jsonb := '[]'::jsonb;
  v_hidden boolean := false;
  v_shown text;
begin
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an administrator or the director can change the leader pipeline' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;

  select * into cur from public.leader_pipeline_settings where id is true for update;
  v_now := to_jsonb(cur);

  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('elig_member6', 'elig_foundation', 'elig_serving', 'elig_age21', 'elig_time', 'elig_safeguarding',
                 'elig_confidentiality', 'references_mode', 'interview_mode', 'tribe_fit', 'academy_mode', 'declaration_mode') then
      raise exception 'Unknown setting' using errcode = '22023';
    end if;
    if jsonb_typeof(p_changes -> k) is distinct from 'string' then
      raise exception 'That value is not allowed for %', public.leader_pipeline_label(k) using errcode = '22023';
    end if;
    v := p_changes ->> k;
    if k = 'tribe_fit' then
      if v not in ('on', 'off') then
        raise exception 'That value is not allowed for %', public.leader_pipeline_label(k) using errcode = '22023';
      end if;
      if v = 'on' and v is distinct from (v_now ->> k) and not public.leader_fit_ready() then
        raise exception 'Find your tribe cannot be switched on until its weights and cards have been approved' using errcode = '22023';
      end if;
    elsif k = 'declaration_mode' then
      if v not in ('required', 'off') then
        raise exception 'That value is not allowed for %', public.leader_pipeline_label(k) using errcode = '22023';
      end if;
    elsif v not in ('required', 'optional', 'off') then
      raise exception 'That value is not allowed for %', public.leader_pipeline_label(k) using errcode = '22023';
    end if;
  end loop;

  -- Which ones really change
  for k in select jsonb_object_keys(p_changes) loop
    v := p_changes ->> k;
    v_old := v_now ->> k;
    if v is distinct from v_old then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('setting', k, 'old', v_old, 'new', v));
    end if;
  end loop;

  if jsonb_array_length(v_changed) = 0 then
    return jsonb_build_object('changed', 0, 'positions', public.leader_pipeline_json(cur));
  end if;

  update public.leader_pipeline_settings set
    elig_member6 = coalesce(p_changes ->> 'elig_member6', elig_member6),
    elig_foundation = coalesce(p_changes ->> 'elig_foundation', elig_foundation),
    elig_serving = coalesce(p_changes ->> 'elig_serving', elig_serving),
    elig_age21 = coalesce(p_changes ->> 'elig_age21', elig_age21),
    elig_time = coalesce(p_changes ->> 'elig_time', elig_time),
    elig_safeguarding = coalesce(p_changes ->> 'elig_safeguarding', elig_safeguarding),
    elig_confidentiality = coalesce(p_changes ->> 'elig_confidentiality', elig_confidentiality),
    references_mode = coalesce(p_changes ->> 'references_mode', references_mode),
    interview_mode = coalesce(p_changes ->> 'interview_mode', interview_mode),
    tribe_fit = coalesce(p_changes ->> 'tribe_fit', tribe_fit),
    academy_mode = coalesce(p_changes ->> 'academy_mode', academy_mode),
    declaration_mode = coalesce(p_changes ->> 'declaration_mode', declaration_mode),
    preset = 'empty',
    updated_by = auth.uid(),
    updated_at = now()
  where id is true;

  select coalesce(p.hidden, false) into v_hidden from public.people p where p.id = auth.uid();
  v_shown := case when coalesce(v_hidden, false) then 'an administrator'
                  else coalesce(public.person_display_name(auth.uid()), 'an administrator') end;

  insert into public.leader_pipeline_log (batch, setting, old_value, new_value, preset, reason, changed_by, shown_as)
  select v_batch, c ->> 'setting', c ->> 'old', c ->> 'new', 'empty', v_reason,
         case when coalesce(v_hidden, false) then null else auth.uid() end, v_shown
    from jsonb_array_elements(v_changed) c;

  perform public.write_event(auth.uid(), 'leader.pipeline_set', 'leader_pipeline', 'settings',
    jsonb_build_object('batch', v_batch, 'changes', v_changed, 'reason', v_reason));

  return jsonb_build_object('changed', jsonb_array_length(v_changed), 'positions', public.leader_pipeline_json(public.leader_pipeline_cfg()));
end;
$$;

-- Sets every switch at once. Both presets leave the Academy and the declaration Required, so pressing a preset never turns
-- training off by accident: turning training off is a separate, deliberate switch.
--   full       today's process: every question, both referees and the interview are required
--   open_door  age 21, time each week, safeguarding and confidentiality required; six months as a member, Foundation of Faith and
--              serving off; no references; no interview; Find your tribe on when it is ready, otherwise it stays off and the reply says so
create function public.leader_pipeline_preset(p_preset text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.leader_pipeline_settings;
  want public.leader_pipeline_settings;
  v_batch uuid := gen_random_uuid();
  v_changed jsonb := '[]'::jsonb;
  v_note text;
  v_hidden boolean := false;
  v_shown text;
  k text;
  v_old text;
  v_new text;
begin
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an administrator or the director can change the leader pipeline' using errcode = '42501';
  end if;
  if p_preset is null or p_preset not in ('full', 'open_door') then
    raise exception 'Choose the full process or the open door' using errcode = '22023';
  end if;

  select * into cur from public.leader_pipeline_settings where id is true for update;
  want := cur;

  if p_preset = 'full' then
    want.elig_member6 := 'required'; want.elig_foundation := 'required'; want.elig_serving := 'required';
    want.elig_age21 := 'required'; want.elig_time := 'required'; want.elig_safeguarding := 'required';
    want.elig_confidentiality := 'required';
    want.references_mode := 'required';
    want.interview_mode := 'required';
    want.tribe_fit := 'off';
  else
    want.elig_member6 := 'off'; want.elig_foundation := 'off'; want.elig_serving := 'off';
    want.elig_age21 := 'required'; want.elig_time := 'required'; want.elig_safeguarding := 'required';
    want.elig_confidentiality := 'required';
    want.references_mode := 'off';
    want.interview_mode := 'off';
    if public.leader_fit_ready() then
      want.tribe_fit := 'on';
    else
      want.tribe_fit := 'off';
      v_note := 'Find your tribe stays off for now: its weights and cards have not been approved yet.';
    end if;
  end if;
  want.academy_mode := 'required';
  want.declaration_mode := 'required';

  foreach k in array array['elig_member6', 'elig_foundation', 'elig_serving', 'elig_age21', 'elig_time', 'elig_safeguarding',
                           'elig_confidentiality', 'references_mode', 'interview_mode', 'tribe_fit', 'academy_mode', 'declaration_mode'] loop
    v_old := to_jsonb(cur) ->> k;
    v_new := to_jsonb(want) ->> k;
    if v_new is distinct from v_old then
      v_changed := v_changed || jsonb_build_array(jsonb_build_object('setting', k, 'old', v_old, 'new', v_new));
    end if;
  end loop;

  update public.leader_pipeline_settings set
    elig_member6 = want.elig_member6, elig_foundation = want.elig_foundation, elig_serving = want.elig_serving,
    elig_age21 = want.elig_age21, elig_time = want.elig_time, elig_safeguarding = want.elig_safeguarding,
    elig_confidentiality = want.elig_confidentiality, references_mode = want.references_mode,
    interview_mode = want.interview_mode, tribe_fit = want.tribe_fit, academy_mode = want.academy_mode,
    declaration_mode = want.declaration_mode,
    preset = p_preset,
    updated_by = case when jsonb_array_length(v_changed) > 0 or cur.preset <> p_preset then auth.uid() else updated_by end,
    updated_at = case when jsonb_array_length(v_changed) > 0 or cur.preset <> p_preset then now() else updated_at end
  where id is true;

  if jsonb_array_length(v_changed) > 0 then
    select coalesce(p.hidden, false) into v_hidden from public.people p where p.id = auth.uid();
    v_shown := case when coalesce(v_hidden, false) then 'an administrator'
                    else coalesce(public.person_display_name(auth.uid()), 'an administrator') end;
    insert into public.leader_pipeline_log (batch, setting, old_value, new_value, preset, reason, changed_by, shown_as)
    select v_batch, c ->> 'setting', c ->> 'old', c ->> 'new', p_preset, null,
           case when coalesce(v_hidden, false) then null else auth.uid() end, v_shown
      from jsonb_array_elements(v_changed) c;
    perform public.write_event(auth.uid(), 'leader.pipeline_preset', 'leader_pipeline', 'settings',
      jsonb_build_object('batch', v_batch, 'preset', p_preset, 'changes', v_changed));
  end if;

  return jsonb_build_object(
    'changed', jsonb_array_length(v_changed),
    'note', v_note,
    'positions', public.leader_pipeline_json(public.leader_pipeline_cfg()));
end;
$$;

-- The most recent changes, newest first. The platform owner appears as "an administrator", never by name.
create function public.leader_pipeline_log_list(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the office and the pastors can see this' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', x.at, 'batch', x.batch, 'setting', x.setting, 'label', public.leader_pipeline_label(x.setting),
             'old_value', x.old_value, 'new_value', x.new_value, 'preset', x.preset, 'reason', x.reason, 'shown_as', x.shown_as)
           order by x.at desc, x.id desc)
      from (select * from public.leader_pipeline_log order by at desc, id desc limit greatest(1, least(coalesce(p_limit, 50), 200))) x),
    '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.leader_pipeline_cfg(),
  public.leader_pipeline_json(public.leader_pipeline_settings),
  public.leader_fit_ready(),
  public.leader_pipeline_label(text),
  public.leader_pipeline_public(),
  public.leader_pipeline_set(jsonb, text),
  public.leader_pipeline_preset(text),
  public.leader_pipeline_log_list(integer)
  from public, anon, authenticated;

grant execute on function
  public.leader_pipeline_public(),
  public.leader_pipeline_set(jsonb, text),
  public.leader_pipeline_preset(text),
  public.leader_pipeline_log_list(integer)
  to authenticated;

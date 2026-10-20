-- Phase C: the owner can appoint a leader from the console, with no application. This adds a table and six functions. It changes no
-- existing function, table or default.
--
-- What an appointment does:  gives the person the leader role, and starts their Tribe Card with the community, goal and life stage
--   locked, filled from the signed-off card. What it never does: it does not approve the card (a pastor still does), it does not
--   make the leader certified (the Academy still does), and it does not show the tribe to members before both. Safeguarding is
--   exactly as for any other leader.
-- Who can use it:  the platform owner while unlocked, and nobody else. Each function begins with god_only().
-- Step down:  ends the appointment. It closes a tribe that has no members, and refuses while members have joined. It never
--   withdraws a certificate.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table public.leader_appointments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- Only the console reads this. The office is told "an administrator" and nothing else.
  appointed_by uuid references public.people (id) on delete set null,
  season_id uuid references public.seasons (id) on delete set null,
  tribe_id uuid references public.tribes (id) on delete set null,
  season_goal_id uuid references public.season_goals (id) on delete set null,
  run_id uuid references public.leader_fit_runs (id) on delete set null,
  -- The short fit form, as given
  form jsonb not null,
  -- The owner said a pastor has cleared this person for sensitive subjects. Without it the care gate stays closed.
  care_cleared boolean not null default false,
  -- The appointment is what gave them the leader role (so stepping down can take it back, and only then)
  granted_role boolean not null default false,
  note text check (char_length(note) <= 500),
  status text not null default 'active' check (status in ('active', 'stepped_down')),
  appointed_at timestamptz not null default now(),
  stepped_down_at timestamptz,
  stepped_down_by uuid references public.people (id) on delete set null,
  step_down_reason text check (char_length(step_down_reason) <= 500),
  check ((status = 'active') = (stepped_down_at is null))
);
create unique index leader_appointments_one_active on public.leader_appointments (person_id) where status = 'active';
create index leader_appointments_tribe_idx on public.leader_appointments (tribe_id);
alter table public.leader_appointments enable row level security;
revoke all on table public.leader_appointments from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The short fit form -> the engine's inputs
-- ---------------------------------------------------------------------------
-- Five answers, no free text: life stage, how they lead best, the community and goal they have walked (both optional), whether
-- that road is behind them or ahead, and whether a pastor has cleared them for sensitive subjects. There are no scenario results for
-- someone who has not applied, so Judgement is "not assessed yet" (the model's own value for that) and Care is open only when the
-- owner says a pastor has cleared them.
create function public.god_appointment_inputs(p_form jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
  v_track text;
  v_lead text;
  v_community text;
  v_goal text;
  v_relation text;
  v_cleared boolean;
  v_goal_community text;
begin
  if jsonb_typeof(p_form) is distinct from 'object' then
    raise exception 'Fill in the short form' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_form) loop
    if k not in ('track', 'lead_best', 'community', 'goal', 'relation', 'care_cleared') then
      raise exception 'The form has a question we do not ask' using errcode = '22023';
    end if;
  end loop;
  v_track := nullif(btrim(p_form ->> 'track'), '');
  v_lead := nullif(btrim(p_form ->> 'lead_best'), '');
  v_community := nullif(btrim(p_form ->> 'community'), '');
  v_goal := nullif(btrim(p_form ->> 'goal'), '');
  v_relation := nullif(btrim(p_form ->> 'relation'), '');
  if jsonb_typeof(p_form -> 'care_cleared') not in ('boolean') and p_form ? 'care_cleared' then
    raise exception 'Say yes or no to whether a pastor has cleared them for sensitive subjects' using errcode = '22023';
  end if;
  v_cleared := coalesce((p_form ->> 'care_cleared')::boolean, false);

  if v_track is null or not exists (select 1 from public.tracks t where t.slug = v_track and t.active) then
    raise exception 'Choose their stage of life' using errcode = '22023';
  end if;
  if v_lead is null or v_lead not in ('structure', 'connection', 'teaching', 'doing') then
    raise exception 'Say how they lead best' using errcode = '22023';
  end if;
  if v_community is not null and not exists (select 1 from public.communities c where c.slug = v_community and c.active) then
    raise exception 'That community is not one we have' using errcode = '22023';
  end if;
  if v_goal is not null then
    select c.slug into v_goal_community from public.season_goals g join public.communities c on c.id = g.community_id where g.slug = v_goal;
    if v_goal_community is null then
      raise exception 'That goal is not one we have' using errcode = '22023';
    end if;
    if v_community is not null and v_community <> v_goal_community then
      raise exception 'That goal belongs to a different community' using errcode = '22023';
    end if;
    v_community := v_goal_community;
    if v_relation is null or v_relation not in ('achieved', 'pursuing') then
      raise exception 'Say whether they have achieved that goal or are pursuing it' using errcode = '22023';
    end if;
  elsif v_relation is not null and v_relation not in ('achieved', 'pursuing') then
    raise exception 'Say whether they have achieved that goal or are pursuing it' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'track', v_track, 'community', v_community, 'goal', v_goal, 'relation', v_relation, 'lead_best', v_lead,
    'judgement', null, 'care', case when v_cleared then 100 end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Find a person to appoint
-- ---------------------------------------------------------------------------
create function public.god_appointment_find(p_q text)
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
  if char_length(q) < 2 then
    return '[]'::jsonb;
  end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return coalesce((
    select jsonb_agg(x.o order by x.nm)
      from (
        select coalesce(p.full_name, p.email) as nm,
               jsonb_build_object(
                 'id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email,
                 'roles', coalesce((select jsonb_agg(r.role order by r.role) from public.person_roles r where r.person_id = p.id), '[]'::jsonb),
                 'leads', (select count(*) from public.tribes t where t.leader_id = p.id and t.status <> 'closed'),
                 'appointed', exists (select 1 from public.leader_appointments a where a.person_id = p.id and a.status = 'active'),
                 'has_application', exists (select 1 from public.leader_applications a where a.person_id = p.id and a.status in ('approved_leader', 'approved_assistant'))) as o
          from public.people p
         where not p.hidden
           and not exists (select 1 from public.platform_owner o where o.person_id = p.id)
           and (p.full_name ilike '%' || q || '%' escape '\' or p.preferred_name ilike '%' || q || '%' escape '\' or p.email ilike '%' || q || '%' escape '\')
         order by coalesce(p.full_name, p.email)
         limit 8) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The panel's suggestions
-- ---------------------------------------------------------------------------
-- Two lists, from the one engine and the one "members waiting" figure the application screen uses:
--   options  the tribes that suit this person best (recommended ones, best first), with every part of the score
--   needed   the tribes where members are waiting for a leader, biggest gap first, with how well this person would fit each
-- Nothing is saved: asking for suggestions changes nothing.
create function public.god_appointment_suggest(p_person uuid, p_form jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i jsonb;
  m public.leader_fit_models := public.leader_fit_cfg();
  v_season uuid := public.leader_fit_season();
  v_options jsonb;
  v_needed jsonb;
begin
  perform public.god_only();
  if not exists (select 1 from public.people p where p.id = p_person and not p.hidden) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  i := public.god_appointment_inputs(p_form);
  if m.version is null then
    return jsonb_build_object('status', 'no_model');
  end if;
  with opts as (
    select o.recommended, o.ord, o.rec_rank, o.gap,
           jsonb_build_object(
             'goal_id', o.goal_id, 'title', o.title, 'community', o.community_name, 'label', o.label, 'degree', o.degree,
             'recommended', o.recommended, 'next_to', o.next_to, 'sensitive', o.sensitive, 'care_flag', o.care_flag,
             'parts', jsonb_build_object('calling', o.calling, 'judgement', o.judgement, 'style', o.style, 'need', o.need, 'stage', o.stage),
             'waiting', coalesce(d.waiting, 0), 'seats_open', coalesce(d.seats_open, 0), 'gap', o.gap) as j
      from public.leader_fit_options(i) o
      left join public.goal_demand_rows(v_season) d on d.goal_id = o.goal_id)
  select (select coalesce(jsonb_agg(a.j order by a.rec_rank), '[]'::jsonb) from (select * from opts where recommended order by ord limit 8) a),
         (select coalesce(jsonb_agg(b.j order by b.gap desc, b.ord), '[]'::jsonb) from (select * from opts where gap > 0 order by gap desc, ord limit 8) b)
    into v_options, v_needed;
  return jsonb_build_object('status', 'ok', 'model', m.version, 'inputs', i, 'options', v_options, 'needed', v_needed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Appoint
-- ---------------------------------------------------------------------------
create function public.god_appoint_leader(p_person uuid, p_form jsonb, p_goal uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  i jsonb;
  m public.leader_fit_models := public.leader_fit_cfg();
  v_season uuid := public.leader_fit_season();
  o public.leader_fit_option;
  p public.people;
  v_track uuid;
  v_community uuid;
  v_name text;
  v_first text;
  v_tribe uuid;
  v_run uuid;
  v_id uuid := gen_random_uuid();
  v_had boolean;
  v_hidden boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.god_only();
  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if m.version is null then
    raise exception 'The pastorate needs to approve a fit model first' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023';
  end if;
  i := public.god_appointment_inputs(p_form);

  if exists (select 1 from public.leader_appointments a where a.person_id = p_person and a.status = 'active') then
    raise exception 'They are already appointed. Step them down first to appoint them to a different tribe' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    raise exception 'They already lead a tribe' using errcode = '22023';
  end if;

  select * into o from public.leader_fit_options(i) x where x.goal_id = p_goal;
  if o.goal_id is null then
    raise exception 'That tribe is not one of the options for this person' using errcode = '22023';
  end if;
  if o.care_flag then
    raise exception 'That tribe is about a sensitive subject. Say a pastor has cleared this person for it, or choose another tribe' using errcode = '22023';
  end if;

  select t.id into v_track from public.tracks t where t.slug = i ->> 'track';
  select g.community_id into v_community from public.season_goals g where g.id = p_goal;

  -- The engine run that explains the choice, and the choice itself
  v_run := public.leader_fit_record(p_person, null, i, 'appointment');
  perform public.leader_fit_apply_choice(v_run, p_goal, '{}'::uuid[], true);

  -- The leader role, only if they do not hold it already
  select exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader') into v_had;
  select coalesce(x.hidden, false) into v_hidden from public.people x where x.id = me;
  if not v_had then
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (p_person, 'leader', p.centre_id, case when v_hidden then null else me end)
    on conflict do nothing;
  end if;

  -- Their Tribe Card, started the way start_tribe_card starts one from an approved application: the track, community and goal are
  -- locked, and the three Success Picture lines come from the signed-off card where they are still empty.
  v_first := coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1));
  select c.name into v_name from public.communities c where c.id = v_community;
  v_name := case when coalesce(v_first, '') <> '' and v_name is not null and char_length(v_first || '’s ' || v_name || ' tribe') <= 48
                 then v_first || '’s ' || v_name || ' tribe' end;
  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed)
  values (v_season, p_person, v_name, v_track, v_community, p_goal, array['track', 'community', 'goal'])
  returning id into v_tribe;
  perform public.card_template_fill(v_tribe);

  insert into public.leader_appointments (id, person_id, appointed_by, season_id, tribe_id, season_goal_id, run_id, form, care_cleared, granted_role, note)
  values (v_id, p_person, me, v_season, v_tribe, p_goal, v_run, p_form, coalesce((p_form ->> 'care_cleared')::boolean, false), not v_had, v_note);

  perform public.write_event(me, 'leader.appointed', 'leader_appointment', v_id::text,
    jsonb_build_object('person', p_person, 'goal', p_goal, 'tribe', v_tribe, 'degree', o.degree));
  return jsonb_build_object('ok', true, 'appointment', v_id, 'tribe', v_tribe, 'run', v_run, 'degree', o.degree, 'label', o.label);
end;
$$;

-- ---------------------------------------------------------------------------
-- The list
-- ---------------------------------------------------------------------------
create function public.god_appointment_list()
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
             'id', a.id,
             'status', a.status,
             'person', jsonb_build_object('id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email),
             'goal', g.title,
             'community', c.name,
             'degree', r.chosen_degree,
             'label', case when r.chosen_degree is null then null else public.leader_fit_word(r.chosen_degree) end,
             'flags', coalesce((select jsonb_agg(public.leader_fit_flag_text(f)) from unnest(coalesce(r.chosen_flags, '{}')) f), '[]'::jsonb),
             'care_cleared', a.care_cleared,
             'note', a.note,
             'form', a.form,
             'tribe', case when t.id is null then null else jsonb_build_object(
                'id', t.id, 'status', t.status, 'name', t.name,
                'members', (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active'),
                'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = a.person_id)) end,
             'appointed_at', a.appointed_at,
             'stepped_down_at', a.stepped_down_at,
             'step_down_reason', a.step_down_reason)
           order by (a.status = 'active') desc, a.appointed_at desc)
      from public.leader_appointments a
      join public.people p on p.id = a.person_id
      left join public.season_goals g on g.id = a.season_goal_id
      left join public.communities c on c.id = g.community_id
      left join public.tribes t on t.id = a.tribe_id
      left join public.leader_fit_runs r on r.id = a.run_id), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Step down
-- ---------------------------------------------------------------------------
create function public.god_appointment_step_down(p_appointment uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.leader_appointments;
  t public.tribes;
  v_members integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_closed boolean := false;
  v_role_removed boolean := false;
begin
  perform public.god_only();
  select * into a from public.leader_appointments x where x.id = p_appointment for update;
  if not found then
    raise exception 'We could not find that appointment' using errcode = 'P0002';
  end if;
  if a.status <> 'active' then
    raise exception 'They have already stepped down' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  select * into t from public.tribes x where x.id = a.tribe_id for update;
  if found and t.status <> 'closed' then
    select count(*) into v_members from public.tribe_members m where m.tribe_id = t.id and m.status = 'active';
    if v_members > 0 then
      raise exception '% members have joined this tribe. Ask the pastor to move them to another tribe first, then step this leader down', v_members using errcode = '22023';
    end if;
    update public.tribes set status = 'closed' where id = t.id;
    v_closed := true;
  end if;

  -- The role is taken back only if the appointment gave it, and they have nothing else to lead or no approved application
  if a.granted_role
     and not exists (select 1 from public.tribes x where x.leader_id = a.person_id and x.status <> 'closed')
     and not exists (select 1 from public.leader_applications x where x.person_id = a.person_id and x.status = 'approved_leader') then
    delete from public.person_roles where person_id = a.person_id and role = 'leader';
    v_role_removed := true;
  end if;

  update public.leader_appointments
     set status = 'stepped_down', stepped_down_at = now(), stepped_down_by = me, step_down_reason = v_reason
   where id = a.id;
  perform public.write_event(me, 'leader.stepped_down', 'leader_appointment', a.id::text,
    jsonb_build_object('person', a.person_id, 'tribe_closed', v_closed, 'role_removed', v_role_removed));
  return jsonb_build_object('ok', true, 'tribe_closed', v_closed, 'role_removed', v_role_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the office is told
-- ---------------------------------------------------------------------------
-- The pastor reviewing a Tribe Card should know it has no application behind it. Never a name.
create function public.tribe_appointment_note(p_tribe uuid)
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
    raise exception 'Only the pastor, directors and the admin can see this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leader_appointments a where a.tribe_id = p_tribe) then
    return null;
  end if;
  return jsonb_build_object(
    'text', 'This leader was appointed by an administrator. There is no application behind this card.',
    'active', exists (select 1 from public.leader_appointments a where a.tribe_id = p_tribe and a.status = 'active'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.god_appointment_inputs(jsonb) from public, anon, authenticated;
revoke execute on function
  public.god_appointment_find(text), public.god_appointment_suggest(uuid, jsonb), public.god_appoint_leader(uuid, jsonb, uuid, text),
  public.god_appointment_list(), public.god_appointment_step_down(uuid, text), public.tribe_appointment_note(uuid)
  from public, anon;
grant execute on function
  public.god_appointment_find(text), public.god_appointment_suggest(uuid, jsonb), public.god_appoint_leader(uuid, jsonb, uuid, text),
  public.god_appointment_list(), public.god_appointment_step_down(uuid, text), public.tribe_appointment_note(uuid)
  to authenticated;

-- =============================================================================
-- The season engine, completed (release 4)
--
--   The two-minute leader log: meeting energy, prayer requests (the circle's private
--   prayer list), care flags (practical, pastoral, urgent), "I need my coach", and
--   celebrations (anniversaries, new babies, promotions, answered prayers).
--
--   Care tasks: a practical or pastoral flag becomes a task for the assistant leader or
--   coach with a 7-day deadline; an urgent one alerts the Care Lead by email AND text
--   at once; three missed meetings and a low pulse become tasks for the coach.
--   Reminders and overdue alerts run from the same heartbeat as the calendar.
--
--   Testimonies: tagged by tribe and goal (automatically) and by theme (the leader's
--   choice), a testimony wall, and a way to forward one to the TCN testimony form.
--
--   The curriculum engine: the confession for each week, a tribe-specific skill-share
--   prompt and goal-step ideas for each Season Goal, and the sermon the week is tied to.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------

alter table public.circle_logs
  add column energy smallint check (energy between 1 and 5),
  add column need_coach boolean not null default false,
  add column need_coach_note text check (char_length(need_coach_note) <= 300);

-- The circle's private prayer list: seen by the leader, the assistant and the coach, never by members.
create table public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week between 1 and 12),
  body text not null check (char_length(btrim(body)) between 3 and 200),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_note text check (char_length(answered_note) <= 200)
);
create index prayer_requests_circle_idx on public.prayer_requests (circle_id, answered_at nulls first, created_at desc);

create table public.celebrations (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week between 1 and 12),
  kind text not null check (kind in ('anniversary', 'new_baby', 'promotion', 'answered_prayer', 'milestone', 'other')),
  person_id uuid references public.people (id) on delete set null,
  note text check (char_length(note) <= 140),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  key text not null,
  unique (circle_id, week, key)
);
create index celebrations_circle_idx on public.celebrations (circle_id, week);

create table public.care_tasks (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- who the care is for; empty for "my leader asked for help from the coach"
  person_id uuid references public.people (id) on delete cascade,
  kind text not null check (kind in ('practical', 'pastoral', 'urgent', 'missed_three', 'low_pulse', 'coach_help')),
  week smallint,
  note text check (char_length(note) <= 300),
  assignee_role text not null check (assignee_role in ('assistant', 'coach', 'leader', 'care_lead')),
  -- empty when the task sits in the Care Lead queue for any care lead to take
  assigned_to uuid references public.people (id) on delete set null,
  raised_by uuid references public.people (id) on delete set null,
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  closed_by uuid references public.people (id) on delete set null,
  closed_at timestamptz,
  closed_note text check (char_length(closed_note) <= 300),
  created_at timestamptz not null default now()
);
create unique index care_tasks_one_open on public.care_tasks
  (circle_id, kind, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open';
create index care_tasks_assignee_idx on public.care_tasks (assigned_to, status, due_on);
create index care_tasks_queue_idx on public.care_tasks (status, due_on) where status = 'open';

alter table public.testimonies
  add column tribe_id uuid references public.tribes (id),
  add column season_goal_id uuid references public.season_goals (id),
  add column themes text[] not null default '{}'
    check (themes <@ array['healing', 'provision', 'breakthrough', 'family', 'salvation', 'direction', 'peace', 'answered_prayer', 'community', 'growth']::text[]
           and cardinality(themes) <= 3),
  add column forwarded_at timestamptz,
  add column forwarded_by uuid references public.people (id) on delete set null;
create index testimonies_wall_idx on public.testimonies (decided_at desc) where status = 'church_approved';

alter table public.week_guides
  add column sermon_series text check (char_length(sermon_series) <= 120),
  add column sermon_title text check (char_length(sermon_title) <= 160);

-- The tribe-specific layer of a guide: a skill-share prompt and, for each Season Goal, step ideas.
-- Three phases of the season: 1 = weeks 1-4, 2 = weeks 5-8, 3 = weeks 9-12.
create table public.tribe_prompts (
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  phase smallint not null check (phase between 1 and 3),
  skill_share text not null check (char_length(btrim(skill_share)) between 10 and 300),
  primary key (tribe_id, phase)
);
create table public.goal_ideas (
  season_goal_id uuid not null references public.season_goals (id) on delete cascade,
  phase smallint not null check (phase between 1 and 3),
  idea text not null check (char_length(btrim(idea)) between 10 and 300),
  primary key (season_goal_id, phase)
);

alter table public.prayer_requests enable row level security;
alter table public.celebrations enable row level security;
alter table public.care_tasks enable row level security;
alter table public.tribe_prompts enable row level security;
alter table public.goal_ideas enable row level security;

-- ---------------------------------------------------------------------------
-- A testimony takes the tribe and goal of its circle when it is written
-- ---------------------------------------------------------------------------

create function public.tag_testimony()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.tribe_id, c.season_goal_id into new.tribe_id, new.season_goal_id
    from public.circles c where c.id = new.circle_id;
  return new;
end;
$$;
create trigger testimonies_tag before insert on public.testimonies
  for each row execute function public.tag_testimony();

update public.testimonies t set tribe_id = c.tribe_id, season_goal_id = c.season_goal_id
  from public.circles c where c.id = t.circle_id and t.tribe_id is null;

-- ---------------------------------------------------------------------------
-- Care: who a task goes to, and raising one
-- ---------------------------------------------------------------------------

-- Practical needs go to the assistant leader (the coach if there is none); pastoral ones to the
-- coach (the assistant if there is none); the coach's own tasks go to the Care Lead queue if the
-- circle has no coach. Returns the role and the person (empty person = the Care Lead queue).
create function public.care_route(p_circle uuid, p_kind text)
returns table (role text, person uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
begin
  select * into c from public.circles where id = p_circle;
  if p_kind = 'urgent' then
    return query select 'care_lead'::text, null::uuid;
  elsif p_kind = 'practical' then
    if c.assistant_id is not null then return query select 'assistant'::text, c.assistant_id;
    elsif c.coach_id is not null then return query select 'coach'::text, c.coach_id;
    else return query select 'care_lead'::text, null::uuid; end if;
  elsif p_kind = 'pastoral' then
    if c.coach_id is not null then return query select 'coach'::text, c.coach_id;
    elsif c.assistant_id is not null then return query select 'assistant'::text, c.assistant_id;
    else return query select 'care_lead'::text, null::uuid; end if;
  else
    if c.coach_id is not null then return query select 'coach'::text, c.coach_id;
    else return query select 'care_lead'::text, null::uuid; end if;
  end if;
end;
$$;

-- Opens a task, once: asking again while one is open updates its note instead. Sends what the
-- kind calls for (an urgent alert to every care lead by email AND text; a task message to the assignee).
create function public.raise_care_task(
  p_circle uuid, p_person uuid, p_kind text, p_note text, p_week integer, p_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
  r record;
  v_id uuid;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
  v_due date;
  v_by text;
  v_member text;
  team record;
  v_inserted boolean;
begin
  select * into c from public.circles where id = p_circle;
  if not found then
    return null;
  end if;
  select * into r from public.care_route(p_circle, p_kind);
  v_due := public.today_lagos() + case when p_kind = 'urgent' then 0 else 7 end;

  insert into public.care_tasks (circle_id, person_id, kind, week, note, assignee_role, assigned_to, raised_by, due_on)
  values (p_circle, p_person, p_kind, p_week, v_note, r.role, r.person, p_by, v_due)
  on conflict (circle_id, kind, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'open'
  do update set note = coalesce(excluded.note, public.care_tasks.note), week = coalesce(excluded.week, public.care_tasks.week)
  returning id, (xmax = 0) into v_id, v_inserted;
  if not v_inserted then
    return v_id;
  end if;

  v_by := coalesce(public.first_name_of(p_by), 'Your leader');
  v_member := coalesce(public.person_display_name(p_person), '');

  if p_kind = 'urgent' then
    -- A person must respond today: both channels at once, whatever the preferences, quiet hours or not.
    for team in select * from public.care_team() as person_id loop
      perform public.enqueue_message(team.person_id, 'care_urgent',
        jsonb_build_object('member', v_member, 'circle', c.name, 'raised_by', v_by, 'note', v_note),
        p_circle, 'care:' || v_id || ':' || team.person_id || ':email', null, 'urgent', 'email');
      perform public.enqueue_message(team.person_id, 'care_urgent',
        jsonb_build_object('member', v_member, 'circle', c.name, 'raised_by', v_by),
        p_circle, 'care:' || v_id || ':' || team.person_id || ':sms', null, 'urgent', 'sms');
    end loop;
  elsif p_kind in ('practical', 'pastoral') and r.person is not null then
    perform public.enqueue_message(r.person, 'care_task',
      jsonb_build_object('member', v_member, 'circle', c.name, 'raised_by', v_by, 'level', p_kind, 'due_on', v_due, 'note', v_note),
      p_circle, 'caretask:' || v_id);
  elsif p_kind = 'coach_help' and r.person is not null then
    perform public.enqueue_message(r.person, 'coach_help',
      jsonb_build_object('circle', c.name, 'leader', public.person_display_name(c.leader_id), 'note', v_note, 'week', p_week, 'due_on', v_due),
      p_circle, 'coachhelp:' || v_id);
  end if;

  perform public.write_event(p_by, 'care.task_opened', 'care_task', v_id::text,
    jsonb_build_object('kind', p_kind, 'role', r.role));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The triggers that open tasks on their own
-- ---------------------------------------------------------------------------

-- Same as before, with one addition: the third missed meeting in a row opens a task for the coach.
create or replace function public.on_attendance_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
  rec record;
  n integer := 0;
  v_wa text;
  team record;
  v_first text;
begin
  if new.status <> 'absent' then
    return new;
  end if;
  for rec in
    select a.week, a.status
      from public.circle_attendance a
      join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
     where a.circle_id = new.circle_id and a.person_id = new.person_id and a.week <= new.week
     order by a.week desc
  loop
    exit when rec.status <> 'absent';
    n := n + 1;
  end loop;
  if n = 0 then
    return new;
  end if;
  select * into c from public.circles where id = new.circle_id;
  v_first := public.first_name_of(new.person_id);
  select case when public.consent_granted(new.person_id, 'whatsapp') then mp.whatsapp end into v_wa
    from public.member_profiles mp where mp.person_id = new.person_id;

  -- Held back half an hour, so a leader who taps the wrong button and fixes it sends nothing.
  if n = 1 then
    for team in select * from public.circle_team(new.circle_id) as person_id loop
      perform public.enqueue_message(team.person_id, 'leader_missed_one',
        jsonb_build_object('member_first', v_first, 'member_whatsapp', v_wa, 'circle', c.name, 'week', new.week,
                           'leader_first', public.first_name_of(c.leader_id)),
        new.circle_id, 'miss1:' || new.circle_id || ':' || new.week || ':' || new.person_id || ':' || team.person_id,
        now() + interval '30 minutes');
    end loop;
  elsif n = 2 then
    for team in select * from public.circle_team(new.circle_id) as person_id loop
      perform public.enqueue_message(team.person_id, 'leader_missed_two',
        jsonb_build_object('member_first', v_first, 'member_whatsapp', v_wa, 'circle', c.name, 'week', new.week),
        new.circle_id, 'miss2:' || new.circle_id || ':' || new.week || ':' || new.person_id || ':' || team.person_id,
        now() + interval '30 minutes');
    end loop;
    perform public.enqueue_message(new.person_id, 'member_missed_two',
      jsonb_build_object('circle', c.name, 'leader_first', public.first_name_of(c.leader_id), 'week', new.week),
      new.circle_id, 'miss2m:' || new.circle_id || ':' || new.week || ':' || new.person_id,
      now() + interval '30 minutes');
  else
    if c.coach_id is not null then
      perform public.enqueue_message(c.coach_id, 'coach_missed_three',
        jsonb_build_object('member_first', v_first, 'member_name', public.person_display_name(new.person_id),
                           'circle', c.name, 'leader', public.person_display_name(c.leader_id), 'missed', n, 'week', new.week),
        new.circle_id, 'miss3:' || new.circle_id || ':' || new.week || ':' || new.person_id,
        now() + interval '30 minutes');
    end if;
    perform public.raise_care_task(new.circle_id, new.person_id, 'missed_three',
      'Missed ' || n || ' meetings in a row.', new.week, null);
  end if;
  return new;
end;
$$;

-- Editing a log deletes and re-adds the attendance: what was waiting about the old marks goes too,
-- including a coach task nobody has picked up yet.
create or replace function public.on_attendance_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages
   where status = 'queued'
     and (dedupe_key like 'miss1:' || old.circle_id || ':' || old.week || ':' || old.person_id || ':%'
       or dedupe_key like 'miss2:' || old.circle_id || ':' || old.week || ':' || old.person_id || ':%'
       or dedupe_key = 'miss2m:' || old.circle_id || ':' || old.week || ':' || old.person_id
       or dedupe_key = 'miss3:' || old.circle_id || ':' || old.week || ':' || old.person_id);
  delete from public.care_tasks
   where circle_id = old.circle_id and person_id = old.person_id and kind = 'missed_three'
     and status = 'open' and week = old.week and created_at > now() - interval '2 days';
  return old;
end;
$$;

-- A low belonging answer alerts the coach (as before) and opens a task for them.
create or replace function public.on_care_flag_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
begin
  if new.kind = 'low_belonging' then
    select * into c from public.circles where id = new.circle_id;
    if c.coach_id is not null then
      perform public.enqueue_message(c.coach_id, 'coach_low_pulse',
        jsonb_build_object('member_name', public.person_display_name(new.person_id), 'circle', c.name,
                           'leader', public.person_display_name(c.leader_id), 'week', new.week),
        new.circle_id, 'lowpulse:' || new.id);
    end if;
    perform public.raise_care_task(new.circle_id, new.person_id, 'low_pulse',
      'Scored belonging below 3 in the week ' || coalesce(new.week::text, '?') || ' check-in.', new.week, null);
  end if;
  return new;
end;
$$;

-- Reminders and alerts for tasks that are close or late. Safe to run as often as you like.
create function public.care_sweep(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  c public.circles%rowtype;
  team record;
  n integer := 0;
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_member text;
  v_to uuid;
begin
  for t in select * from public.care_tasks x where x.status = 'open' loop
    n := n + 1;
    select * into c from public.circles where id = t.circle_id;
    v_member := coalesce(public.person_display_name(t.person_id), '');

    -- two days before it is due: a nudge to the person it is assigned to
    if t.kind <> 'urgent' and t.assigned_to is not null and v_today = t.due_on - 2 and public.lagos_hour() >= 8 then
      perform public.enqueue_message(t.assigned_to, 'care_task_reminder',
        jsonb_build_object('member', v_member, 'circle', c.name, 'level', t.kind, 'due_on', t.due_on),
        t.circle_id, 'caretask:rem:' || t.id);
    end if;

    -- the day after: the assignee and the care leads are told it is late
    if t.kind <> 'urgent' and v_today > t.due_on then
      for team in select * from public.care_team() as person_id loop
        perform public.enqueue_message(team.person_id, 'care_task_overdue',
          jsonb_build_object('member', v_member, 'circle', c.name, 'level', t.kind, 'due_on', t.due_on,
                             'assignee', coalesce(public.person_display_name(t.assigned_to), 'the Care Lead queue')),
          t.circle_id, 'caretask:late:' || t.id || ':' || team.person_id);
      end loop;
      if t.assigned_to is not null then
        perform public.enqueue_message(t.assigned_to, 'care_task_overdue',
          jsonb_build_object('member', v_member, 'circle', c.name, 'level', t.kind, 'due_on', t.due_on, 'assignee', 'you'),
          t.circle_id, 'caretask:late:' || t.id || ':' || t.assigned_to);
      end if;
    end if;

    -- an urgent flag nobody has answered after four hours goes to the directors too
    if t.kind = 'urgent' and p_now > t.created_at + interval '4 hours' then
      for v_to in select r.person_id from public.person_roles r where r.role in ('director', 'pastor') loop
        perform public.enqueue_message(v_to, 'care_task_overdue',
          jsonb_build_object('member', v_member, 'circle', c.name, 'level', 'urgent', 'due_on', t.due_on, 'assignee', 'the Care Lead'),
          t.circle_id, 'caretask:urg4h:' || t.id || ':' || v_to, null, 'urgent');
      end loop;
    end if;
  end loop;

  return jsonb_build_object('care_open', n);
end;
$$;

-- The heartbeat now runs the care sweep as well as the calendar.
create or replace function public.worker_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.run_calendar(now()) || public.care_sweep(now());
end;
$$;

-- ---------------------------------------------------------------------------
-- The two-minute log, with its new parts
-- ---------------------------------------------------------------------------

drop function public.save_circle_log(uuid, integer, boolean, text, jsonb);

create function public.save_circle_log(
  p_circle uuid,
  p_week integer,
  p_held boolean,
  p_highlight text,
  p_attendance jsonb,
  p_energy integer default null,
  p_prayers jsonb default null,
  p_care jsonb default null,
  p_need_coach boolean default false,
  p_need_coach_note text default null,
  p_celebrations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  s public.seasons%rowtype;
  today date := public.today_lagos();
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  cw integer;
  ws date;
  hl text := nullif(btrim(coalesce(p_highlight, '')), '');
  coach_note text := nullif(btrim(coalesce(p_need_coach_note, '')), '');
  ids uuid[];
  item jsonb;
  pid uuid;
  stat text;
  seen uuid[] := '{}';
  keep uuid[] := '{}';
  v_body text;
  v_id uuid;
  v_level text;
  v_kind text;
  v_key text;
  v_keys text[] := '{}';
  v_note text;
  v_new uuid;
  team record;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found or not (public.can_lead_circle(p_circle) or office) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  if p_week is null or p_week < 1 or p_week > s.weeks or p_week > cw then
    raise exception 'You can only log a week that has started' using errcode = '22023';
  end if;
  ws := s.starts_on + (p_week - 1) * 7;
  if not office and today > ws + 13 then
    raise exception 'That week is closed. Ask a pastor to correct it' using errcode = '22023';
  end if;
  if p_held is null then
    raise exception 'Say whether the circle met' using errcode = '22023';
  end if;
  if hl is not null and char_length(hl) > 300 then
    raise exception 'Keep the highlight to 300 characters or fewer' using errcode = '22023';
  end if;
  if p_energy is not null and (p_energy < 1 or p_energy > 5) then
    raise exception 'Rate the energy from 1 to 5' using errcode = '22023';
  end if;
  if coach_note is not null and char_length(coach_note) > 300 then
    raise exception 'Keep the note to your coach to 300 characters or fewer' using errcode = '22023';
  end if;
  select coalesce(array_agg(m.person_id), '{}') into ids
    from public.circle_members m where m.circle_id = p_circle and m.status = 'active';

  if p_held then
    if p_attendance is null or jsonb_typeof(p_attendance) <> 'array' then
      raise exception 'Mark who came' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_attendance) loop
      pid := (item ->> 'person')::uuid;
      stat := item ->> 'status';
      if not (pid = any (ids)) then
        raise exception 'That person is not in your circle' using errcode = 'P0002';
      end if;
      if stat is null or stat not in ('present', 'absent', 'excused') then
        raise exception 'Mark each person as here, away or excused' using errcode = '22023';
      end if;
      seen := array_append(seen, pid);
    end loop;
    if (select count(distinct x) from unnest(seen) as x) <> cardinality(ids) then
      raise exception 'Mark every member as here, away or excused' using errcode = '22023';
    end if;
  end if;

  -- Check the optional parts before anything is written.
  if p_prayers is not null then
    if jsonb_typeof(p_prayers) <> 'array' or jsonb_array_length(p_prayers) > 10 then
      raise exception 'Add up to ten prayer requests' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_prayers) loop
      v_body := btrim(coalesce(item ->> 'body', ''));
      if char_length(v_body) < 3 or char_length(v_body) > 200 then
        raise exception 'A prayer request needs 3 to 200 characters' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_care is not null then
    if jsonb_typeof(p_care) <> 'array' or jsonb_array_length(p_care) > 5 then
      raise exception 'Flag up to five people for care' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_care) loop
      v_level := item ->> 'level';
      if v_level is null or v_level not in ('none', 'practical', 'pastoral', 'urgent') then
        raise exception 'Choose practical, pastoral or urgent care' using errcode = '22023';
      end if;
      continue when v_level = 'none';
      if not ((item ->> 'person')::uuid = any (ids)) then
        raise exception 'That person is not in your circle' using errcode = 'P0002';
      end if;
      if char_length(coalesce(item ->> 'note', '')) > 300 then
        raise exception 'Keep a care note to 300 characters or fewer' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_celebrations is not null then
    if jsonb_typeof(p_celebrations) <> 'array' or jsonb_array_length(p_celebrations) > 5 then
      raise exception 'Add up to five celebrations' using errcode = '22023';
    end if;
    for item in select * from jsonb_array_elements(p_celebrations) loop
      v_kind := item ->> 'kind';
      if v_kind is null or v_kind not in ('anniversary', 'new_baby', 'promotion', 'milestone', 'other') then
        raise exception 'Choose what you are celebrating' using errcode = '22023';
      end if;
      if item ->> 'person' is not null and not ((item ->> 'person')::uuid = any (ids)) then
        raise exception 'That person is not in your circle' using errcode = 'P0002';
      end if;
      if char_length(coalesce(item ->> 'note', '')) > 140 then
        raise exception 'Keep a celebration note to 140 characters or fewer' using errcode = '22023';
      end if;
    end loop;
  end if;

  insert into public.circle_logs (circle_id, week, held, highlight, logged_by, energy, need_coach, need_coach_note)
  values (p_circle, p_week, p_held, hl, uid, case when p_held then p_energy end, coalesce(p_need_coach, false),
          case when coalesce(p_need_coach, false) then coach_note end)
  on conflict (circle_id, week)
  do update set held = excluded.held, highlight = excluded.highlight, logged_by = excluded.logged_by,
                energy = excluded.energy, need_coach = excluded.need_coach, need_coach_note = excluded.need_coach_note,
                updated_at = now();
  delete from public.circle_attendance where circle_id = p_circle and week = p_week;
  if p_held then
    insert into public.circle_attendance (circle_id, week, person_id, status)
    select p_circle, p_week, (e ->> 'person')::uuid, e ->> 'status' from jsonb_array_elements(p_attendance) e;
    perform public.flag_missed_twice(p_circle, p_week);
  end if;

  -- Prayer requests: the list sent is this week's list. Answered ones are left alone.
  if p_prayers is not null then
    for item in select * from jsonb_array_elements(p_prayers) loop
      v_body := btrim(item ->> 'body');
      v_id := nullif(item ->> 'id', '')::uuid;
      if v_id is not null and exists (select 1 from public.prayer_requests where id = v_id and circle_id = p_circle) then
        update public.prayer_requests set body = v_body where id = v_id and answered_at is null;
        keep := array_append(keep, v_id);
      else
        insert into public.prayer_requests (circle_id, week, body, created_by) values (p_circle, p_week, v_body, uid) returning id into v_id;
        keep := array_append(keep, v_id);
      end if;
    end loop;
    delete from public.prayer_requests
     where circle_id = p_circle and week = p_week and answered_at is null and not (id = any (keep));
  end if;

  -- Care flags: each opens a task (once). "None" opens nothing.
  if p_care is not null then
    for item in select * from jsonb_array_elements(p_care) loop
      v_level := item ->> 'level';
      continue when v_level = 'none';
      perform public.raise_care_task(p_circle, (item ->> 'person')::uuid, v_level, item ->> 'note', p_week, uid);
    end loop;
  end if;

  -- "I need my coach this week": a task for the coach; unticking it withdraws the task if nobody has taken it up.
  if coalesce(p_need_coach, false) then
    perform public.raise_care_task(p_circle, null, 'coach_help', coach_note, p_week, uid);
  else
    update public.care_tasks set status = 'dismissed', closed_at = now(), closed_by = uid, closed_note = 'Withdrawn by the leader'
     where circle_id = p_circle and kind = 'coach_help' and status = 'open' and week = p_week;
  end if;

  -- Celebrations: the list sent is this week's list (answered prayers are added separately).
  if p_celebrations is not null then
    for item in select * from jsonb_array_elements(p_celebrations) loop
      v_kind := item ->> 'kind';
      v_note := nullif(btrim(coalesce(item ->> 'note', '')), '');
      pid := nullif(item ->> 'person', '')::uuid;
      v_key := md5(v_kind || ':' || coalesce(pid::text, '') || ':' || coalesce(v_note, ''));
      v_keys := array_append(v_keys, v_key);
      v_new := null;
      insert into public.celebrations (circle_id, week, kind, person_id, note, created_by, key)
      values (p_circle, p_week, v_kind, pid, v_note, uid, v_key)
      on conflict (circle_id, week, key) do nothing
      returning id into v_new;
      if v_new is not null then
        for team in select * from public.circle_team(p_circle) as person_id loop
          perform public.enqueue_message(team.person_id, 'celebration_prompt',
            jsonb_build_object('circle', c.name, 'kind', v_kind, 'first_name', public.first_name_of(pid), 'note', v_note,
                               'group_url', c.whatsapp_group_url),
            p_circle, 'celeb:' || p_circle || ':' || p_week || ':' || v_key || ':' || team.person_id);
        end loop;
      end if;
    end loop;
    delete from public.celebrations
     where circle_id = p_circle and week = p_week and key not like 'answered:%' and not (key = any (v_keys));
  end if;

  perform public.write_event(uid, 'circle.log', 'circle', p_circle::text,
    jsonb_build_object('week', p_week, 'held', p_held, 'office', office and not public.can_lead_circle(p_circle)));
  return public.circle_week_report(p_circle, p_week);
end;
$$;

-- What the log holds beyond the basics, for the form and the prep pack: this week's extras, the circle's
-- private prayer list, and the recent mood of the meetings.
create function public.circle_log_extras(p_circle uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  s public.seasons%rowtype;
  wk integer;
  lg public.circle_logs%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  if not (public.can_lead_circle(p_circle) or coalesce(c.coach_id = uid, false)
          or public.has_any_role(array['pastor', 'director']::public.app_role[])) then
    raise exception 'You do not run this circle' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  wk := coalesce(p_week, greatest(1, least(s.weeks, public.season_week(s.starts_on, s.weeks, public.today_lagos()))));
  select * into lg from public.circle_logs where circle_id = p_circle and week = wk;

  return jsonb_build_object(
    'week', wk,
    'energy', lg.energy,
    'need_coach', coalesce(lg.need_coach, false),
    'need_coach_note', lg.need_coach_note,
    'has_coach', c.coach_id is not null,
    'prayers_this_week', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body) order by r.created_at)
        from public.prayer_requests r where r.circle_id = p_circle and r.week = wk and r.answered_at is null), '[]'::jsonb),
    'prayer_list', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'week', r.week, 'created_at', r.created_at) order by r.created_at desc)
        from public.prayer_requests r where r.circle_id = p_circle and r.answered_at is null), '[]'::jsonb),
    'answered', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'body', r.body, 'note', r.answered_note, 'answered_at', r.answered_at) order by r.answered_at desc)
        from public.prayer_requests r where r.circle_id = p_circle and r.answered_at > now() - interval '28 days'), '[]'::jsonb),
    'celebrations', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'person_id', x.person_id, 'first_name', public.first_name_of(x.person_id), 'note', x.note, 'week', x.week)
                       order by x.week desc, x.created_at desc)
        from public.celebrations x where x.circle_id = p_circle and x.week between greatest(1, wk - 1) and wk), '[]'::jsonb),
    'care', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'person_id', t.person_id, 'name', public.person_display_name(t.person_id),
                                          'level', t.kind, 'note', t.note, 'status', t.status, 'due_on', t.due_on, 'week', t.week)
                       order by t.created_at desc)
        from public.care_tasks t
       where t.circle_id = p_circle and t.kind in ('practical', 'pastoral', 'urgent') and (t.status = 'open' or t.week = wk)), '[]'::jsonb),
    'energy_trend', coalesce((
      select jsonb_agg(jsonb_build_object('week', l.week, 'energy', l.energy) order by l.week)
        from public.circle_logs l where l.circle_id = p_circle and l.held and l.energy is not null and l.week <= wk
         and l.week > wk - 6), '[]'::jsonb));
end;
$$;

create function public.answer_prayer(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.prayer_requests%rowtype;
  c public.circles%rowtype;
  s public.seasons%rowtype;
  nt text := nullif(btrim(coalesce(p_note, '')), '');
  team record;
  v_week integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.prayer_requests where id = p_id for update;
  if not found then
    raise exception 'That prayer request does not exist' using errcode = 'P0002';
  end if;
  if not public.can_lead_circle(r.circle_id) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  if r.answered_at is not null then
    raise exception 'That prayer is already marked as answered' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 200 then
    raise exception 'Keep the note to 200 characters or fewer' using errcode = '22023';
  end if;
  select * into c from public.circles where id = r.circle_id;
  select * into s from public.seasons where id = c.season_id;
  v_week := greatest(r.week, least(s.weeks, greatest(1, public.season_week(s.starts_on, s.weeks, public.today_lagos()))));
  update public.prayer_requests set answered_at = now(), answered_note = nt where id = p_id;
  insert into public.celebrations (circle_id, week, kind, note, created_by, key)
  values (r.circle_id, v_week, 'answered_prayer', coalesce(nt, left(r.body, 140)), uid, 'answered:' || p_id)
  on conflict do nothing;
  for team in select * from public.circle_team(r.circle_id) as person_id loop
    perform public.enqueue_message(team.person_id, 'celebration_prompt',
      jsonb_build_object('circle', c.name, 'kind', 'answered_prayer', 'note', coalesce(nt, left(r.body, 140)), 'group_url', c.whatsapp_group_url),
      r.circle_id, 'celeb:answered:' || p_id || ':' || team.person_id);
  end loop;
  perform public.write_event(uid, 'prayer.answered', 'circle', r.circle_id::text, '{}'::jsonb);
end;
$$;

create function public.remove_prayer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.prayer_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.prayer_requests where id = p_id;
  if not found or not public.can_lead_circle(r.circle_id) then
    raise exception 'You cannot remove this request' using errcode = '42501';
  end if;
  delete from public.prayer_requests where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Care tasks: what is mine, finishing one, passing one on, and how we are doing
-- ---------------------------------------------------------------------------

create function public.my_care_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_today date := public.today_lagos();
  is_care boolean := public.has_role('care_lead');
  is_office boolean := public.has_any_role(array['pastor', 'director', 'care_lead']::public.app_role[]);
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'mine', coalesce((
      select jsonb_agg(public.care_task_json(t.id) order by t.due_on, t.created_at)
        from public.care_tasks t where t.status = 'open' and t.assigned_to = uid), '[]'::jsonb),
    'queue', case when is_office then coalesce((
      select jsonb_agg(public.care_task_json(t.id) order by (t.kind = 'urgent') desc, t.due_on, t.created_at)
        from public.care_tasks t where t.status = 'open' and t.assigned_to is null), '[]'::jsonb) else '[]'::jsonb end,
    'others', case when is_office then coalesce((
      select jsonb_agg(public.care_task_json(t.id) order by t.due_on, t.created_at)
        from public.care_tasks t where t.status = 'open' and t.assigned_to is not null and t.assigned_to <> uid), '[]'::jsonb) else '[]'::jsonb end,
    'raised', coalesce((
      select jsonb_agg(public.care_task_json(t.id) order by t.created_at desc)
        from public.care_tasks t
       where t.raised_by = uid and t.created_at > now() - interval '30 days'
         and t.kind in ('practical', 'pastoral', 'urgent', 'coach_help')), '[]'::jsonb));
end;
$$;

-- One task as the app shows it (internal: the callers above have already checked who may see it).
create function public.care_task_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'status', t.status, 'note', t.note, 'week', t.week,
    'due_on', t.due_on, 'overdue', t.status = 'open' and t.due_on < public.today_lagos(),
    'days_left', t.due_on - public.today_lagos(),
    'member', public.person_display_name(t.person_id), 'first_name', public.first_name_of(t.person_id),
    'circle', jsonb_build_object('id', c.id, 'name', c.name),
    'leader', public.person_display_name(c.leader_id),
    'raised_by', public.person_display_name(t.raised_by),
    'assignee_role', t.assignee_role, 'assigned_to', public.person_display_name(t.assigned_to),
    'created_at', t.created_at, 'closed_at', t.closed_at, 'closed_note', t.closed_note)
  from public.care_tasks t join public.circles c on c.id = t.circle_id
  where t.id = p_id;
$$;

create function public.complete_care_task(p_id uuid, p_outcome text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.care_tasks%rowtype;
  nt text := nullif(btrim(coalesce(p_note, '')), '');
  office boolean := public.has_any_role(array['care_lead', 'pastor', 'director']::public.app_role[]);
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.care_tasks where id = p_id for update;
  if not found then
    raise exception 'That task does not exist' using errcode = 'P0002';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'dismissed') then
    raise exception 'Choose done or dismissed' using errcode = '22023';
  end if;
  if not (t.assigned_to = uid or office or (p_outcome = 'dismissed' and t.raised_by = uid)) then
    raise exception 'This task is not yours to close' using errcode = '42501';
  end if;
  if t.status <> 'open' then
    raise exception 'That task is already closed' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 300 then
    raise exception 'Keep the note to 300 characters or fewer' using errcode = '22023';
  end if;
  if p_outcome = 'dismissed' and nt is null then
    raise exception 'Say briefly why it is not needed' using errcode = '22023';
  end if;
  update public.care_tasks set status = p_outcome, closed_by = uid, closed_at = now(), closed_note = nt where id = p_id;
  perform public.write_event(uid, 'care.task_' || p_outcome, 'care_task', p_id::text, jsonb_build_object('kind', t.kind));
end;
$$;

create function public.reassign_care_task(p_id uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.care_tasks%rowtype;
  c public.circles%rowtype;
  v_role text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['care_lead', 'pastor', 'director']::public.app_role[]) then
    raise exception 'Only the care team can pass a task on' using errcode = '42501';
  end if;
  select * into t from public.care_tasks where id = p_id for update;
  if not found or t.status <> 'open' then
    raise exception 'That task is not open' using errcode = 'P0002';
  end if;
  select * into c from public.circles where id = t.circle_id;
  v_role := case
    when p_to = c.coach_id then 'coach'
    when p_to = c.assistant_id then 'assistant'
    when p_to = c.leader_id then 'leader'
    when exists (select 1 from public.person_roles r where r.person_id = p_to and r.role = 'care_lead') then 'care_lead'
    else null end;
  if v_role is null then
    raise exception 'Choose the circle''s coach, assistant or leader, or a care lead' using errcode = '22023';
  end if;
  update public.care_tasks set assigned_to = p_to, assignee_role = v_role where id = p_id;
  if t.kind in ('practical', 'pastoral') then
    perform public.enqueue_message(p_to, 'care_task',
      jsonb_build_object('member', public.person_display_name(t.person_id), 'circle', c.name,
                         'raised_by', coalesce(public.first_name_of(t.raised_by), 'Your leader'), 'level', t.kind, 'due_on', t.due_on, 'note', t.note),
      t.circle_id, 'caretask:' || p_id || ':' || p_to);
  end if;
  perform public.write_event(uid, 'care.task_reassigned', 'care_task', p_id::text, jsonb_build_object('role', v_role));
end;
$$;

-- How care is going: for the dashboards and the pastorate's report. Counts only.
create function public.care_task_stats(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 730));
begin
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead', 'care_lead']::public.app_role[]) then
    raise exception 'Only the office can see care totals' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'opened', count(*),
      'closed', count(*) filter (where status <> 'open'),
      'resolved', count(*) filter (where status = 'done'),
      'resolved_in_7_days', count(*) filter (where status = 'done' and closed_at <= created_at + interval '7 days'),
      'open', count(*) filter (where status = 'open'),
      'overdue', count(*) filter (where status = 'open' and due_on < public.today_lagos()),
      'urgent', count(*) filter (where kind = 'urgent'),
      'urgent_same_day', count(*) filter (where kind = 'urgent' and status = 'done'
                                           and (closed_at at time zone 'Africa/Lagos')::date = (created_at at time zone 'Africa/Lagos')::date),
      'median_days_to_resolve', (select round((percentile_cont(0.5) within group (order by extract(epoch from closed_at - created_at) / 86400))::numeric, 1)
                                   from public.care_tasks x where x.status = 'done' and x.created_at >= v_since),
      'by_kind', coalesce((select jsonb_object_agg(k, n) from (select kind as k, count(*) as n from public.care_tasks y where y.created_at >= v_since group by kind) q), '{}'::jsonb))
      from public.care_tasks z where z.created_at >= v_since and z.status <> 'dismissed');
end;
$$;

-- Who a care task can be passed to: the circle's own coach, assistant and leader, and the Care Leads.
create function public.care_task_options(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.care_tasks%rowtype;
  c public.circles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['care_lead', 'pastor', 'director']::public.app_role[]) then
    raise exception 'Only the care team can pass a task on' using errcode = '42501';
  end if;
  select * into t from public.care_tasks where id = p_id;
  if not found then
    raise exception 'That task does not exist' using errcode = 'P0002';
  end if;
  select * into c from public.circles where id = t.circle_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'name', public.person_display_name(o.id), 'role', o.role) order by o.ord, public.person_display_name(o.id))
      from (
        select c.coach_id as id, 'coach' as role, 1 as ord where c.coach_id is not null
        union all select c.assistant_id, 'assistant', 2 where c.assistant_id is not null
        union all select c.leader_id, 'leader', 3
        union all select distinct r.person_id, 'care_lead', 4 from public.person_roles r where r.role = 'care_lead'
      ) o), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Testimonies: themes on approval, the wall, and forwarding to the TCN form
-- ---------------------------------------------------------------------------

drop function public.review_testimony(uuid, text, text);

-- The reviewer can tag up to three themes when approving; a pastor can re-tag when approving for the church.
create function public.review_testimony(p_id uuid, p_decision text, p_note text, p_themes text[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.testimonies%rowtype;
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  nt text := nullif(btrim(coalesce(p_note, '')), '');
  tags text[];
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.testimonies where id = p_id for update;
  if not found then
    raise exception 'That testimony does not exist' using errcode = 'P0002';
  end if;
  if not (office or public.can_lead_circle(t.circle_id)) then
    raise exception 'You cannot review this testimony' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'decline') then
    raise exception 'Choose approve or decline' using errcode = '22023';
  end if;
  if t.status not in ('submitted', 'circle_approved') then
    raise exception 'This testimony has already been decided' using errcode = '22023';
  end if;
  if t.status = 'circle_approved' and not office then
    raise exception 'The circle can already read this. A pastor decides whether the church reads it' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 200 then
    raise exception 'Keep your note to 200 characters or fewer' using errcode = '22023';
  end if;
  if p_themes is not null then
    select coalesce(array_agg(distinct x order by x), '{}') into tags from unnest(p_themes) as x;
    if cardinality(tags) > 3 then
      raise exception 'Choose up to three themes' using errcode = '22023';
    end if;
    if not (tags <@ array['healing', 'provision', 'breakthrough', 'family', 'salvation', 'direction', 'peace', 'answered_prayer', 'community', 'growth']::text[]) then
      raise exception 'That theme is not one we use' using errcode = '22023';
    end if;
  end if;
  if p_decision = 'decline' then
    update public.testimonies set status = 'declined', decided_by = uid, decided_at = now(), decline_note = nt where id = p_id;
  else
    update public.testimonies
       set status = case when office and share_with = 'church' then 'church_approved' else 'circle_approved' end,
           themes = coalesce(tags, themes),
           decided_by = uid, decided_at = now(), decline_note = null
     where id = p_id;
  end if;
  perform public.write_event(uid, 'testimony.' || p_decision, 'testimony', p_id::text, '{}'::jsonb);
end;
$$;

-- The wall: what the pastorate has approved for the whole church, filtered by tribe, goal or theme.
-- Names follow the credit the person chose. Nothing here says who wrote an anonymous one.
create function public.testimony_wall(
  p_tribe uuid default null,
  p_goal uuid default null,
  p_theme text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  off integer := greatest(coalesce(p_offset, 0), 0);
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  rows_json jsonb;
  total integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select count(*) into total
    from public.testimonies t
   where t.status = 'church_approved'
     and (p_tribe is null or t.tribe_id = p_tribe)
     and (p_goal is null or t.season_goal_id = p_goal)
     and (p_theme is null or p_theme = any (t.themes));
  select coalesce(jsonb_agg(q.j order by q.sort_at desc, q.id), '[]'::jsonb) into rows_json
    from (
      select t.id, coalesce(t.decided_at, t.created_at) as sort_at,
             jsonb_build_object(
               'id', t.id, 'body', t.body, 'themes', to_jsonb(t.themes),
               'tribe', tr.name, 'tribe_id', t.tribe_id, 'goal', sg.title, 'goal_id', t.season_goal_id,
               'by', case t.credit
                       when 'anonymous' then 'A member of The Covenant Nation'
                       when 'first_name' then public.first_name_of(t.person_id)
                       else public.person_display_name(t.person_id) end,
               'at', coalesce(t.decided_at, t.created_at),
               'forwarded', case when office then t.forwarded_at is not null end) as j
        from public.testimonies t
        left join public.tribes tr on tr.id = t.tribe_id
        left join public.season_goals sg on sg.id = t.season_goal_id
       where t.status = 'church_approved'
         and (p_tribe is null or t.tribe_id = p_tribe)
         and (p_goal is null or t.season_goal_id = p_goal)
         and (p_theme is null or p_theme = any (t.themes))
       order by coalesce(t.decided_at, t.created_at) desc, t.id
       limit lim offset off) q;
  return jsonb_build_object(
    'items', rows_json,
    'total', total,
    'has_more', off + lim < total,
    'facets', jsonb_build_object(
      'tribes', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'n', f.n) order by f.name)
                            from (select tr.id, tr.name, count(*) as n
                                    from public.testimonies t join public.tribes tr on tr.id = t.tribe_id
                                   where t.status = 'church_approved' group by tr.id, tr.name) f), '[]'::jsonb),
      'themes', coalesce((select jsonb_agg(jsonb_build_object('theme', f.theme, 'n', f.n) order by f.n desc, f.theme)
                            from (select th as theme, count(*) as n
                                    from public.testimonies t, unnest(t.themes) as th
                                   where t.status = 'church_approved' group by th) f), '[]'::jsonb)));
end;
$$;

-- The pastorate passes a church-approved testimony to the TCN testimony form. We keep the record of who and when,
-- and hand back the words so they can be pasted into the form. Doing it twice is harmless.
create function public.forward_testimony(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.testimonies%rowtype;
  was boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['pastor', 'director']::public.app_role[]) then
    raise exception 'Only the pastorate can forward a testimony' using errcode = '42501';
  end if;
  select * into t from public.testimonies where id = p_id for update;
  if not found then
    raise exception 'That testimony does not exist' using errcode = 'P0002';
  end if;
  if t.status <> 'church_approved' then
    raise exception 'Only a testimony approved for the church can be forwarded' using errcode = '22023';
  end if;
  was := t.forwarded_at is not null;
  if not was then
    update public.testimonies set forwarded_at = now(), forwarded_by = uid where id = p_id returning * into t;
    perform public.write_event(uid, 'testimony.forwarded', 'testimony', p_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'id', t.id, 'body', t.body, 'themes', to_jsonb(t.themes), 'already', was, 'forwarded_at', t.forwarded_at,
    'credit', t.credit,
    'by', case t.credit
            when 'anonymous' then 'Anonymous'
            when 'first_name' then public.first_name_of(t.person_id)
            else public.person_display_name(t.person_id) end,
    'tribe', (select tr.name from public.tribes tr where tr.id = t.tribe_id),
    'goal', (select sg.title from public.season_goals sg where sg.id = t.season_goal_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- The curriculum layer on top of a weekly guide
-- ---------------------------------------------------------------------------

-- The confession, the sermon the week is tied to, a skill-share prompt for the circle's tribe and an idea for its goal.
-- Members of the circle, its team, its coach and the office can read it.
create function public.week_layer(p_circle uuid, p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  s public.seasons%rowtype;
  g public.week_guides%rowtype;
  office boolean := public.has_any_role(array['pastor', 'director', 'admin', 'tribe_champion']::public.app_role[]);
  cw integer;
  wk integer;
  ph integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  if not (office
          or c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false)
          or exists (select 1 from public.circle_members m
                      where m.circle_id = p_circle and m.person_id = uid and m.status = 'active')) then
    raise exception 'You are not part of this circle' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  wk := coalesce(p_week, case when cw < 1 then 1 when cw > s.weeks then s.weeks else cw end);
  if wk < 1 or wk > s.weeks then
    raise exception 'That week does not exist' using errcode = 'P0002';
  end if;
  select * into g from public.week_guides where week = wk;
  ph := ((wk - 1) / 4) + 1;
  return jsonb_build_object(
    'week', wk,
    'phase', ph,
    'confession', g.confession,
    'sermon_series', g.sermon_series,
    'sermon_title', g.sermon_title,
    'tribe', (select t.name from public.tribes t where t.id = c.tribe_id),
    'goal', (select sg.title from public.season_goals sg where sg.id = c.season_goal_id),
    'skill_share', (select tp.skill_share from public.tribe_prompts tp where tp.tribe_id = c.tribe_id and tp.phase = ph),
    'goal_idea', (select gi.idea from public.goal_ideas gi where gi.season_goal_id = c.season_goal_id and gi.phase = ph));
end;
$$;

-- ---------------------------------------------------------------------------
-- Content: the weekly confessions. DRAFT WORDING for the pastorate to review.
-- Each rests on the week's passage and can be changed by an admin (a later screen).
-- ---------------------------------------------------------------------------

update public.week_guides w set confession = v.confession
from (values
  (1,  'I write the vision and make it plain. God''s appointed time for it will come and will not delay, so I will run with it.'),
  (2,  'I delight in the Word of God and think on it day and night. I am like a tree planted by streams of water, and what I do will prosper.'),
  (3,  'I will not be anxious about anything. In everything I pray with thanksgiving, and the peace of God guards my heart and my mind in Christ Jesus.'),
  (4,  'I am not alone. Two are better than one, and God has placed people beside me. I will lift them when they fall, and I will let them lift me.'),
  (5,  'I speak the truth in love. I confess my faults, I pray for others and I walk in the light with my brothers and sisters.'),
  (6,  'I forget what is behind and press on towards what is ahead. I keep my eyes on the goal God has set before me.'),
  (7,  'I am faithful with a little, so I can be trusted with much. I honour God with my time and with my money.'),
  (8,  'Whatever I do, I work at it with all my heart, as for the Lord and not for people. My work is worship.'),
  (9,  'I am strong and courageous. I will not be afraid, for the Lord my God is with me wherever I go. He has given me power, love and a sound mind.'),
  (10, 'I serve others in love. I follow Jesus, who came to serve, and this week I will look for one person to bless.'),
  (11, 'I give thanks to the Lord, for He is good and His love endures for ever. I will say so, and I will tell what He has done.'),
  (12, 'He who began a good work in me will carry it on to completion. I finish well, and I go out as one who is sent.')
) as v (week, confession)
where w.week = v.week and w.confession is null;

-- ---------------------------------------------------------------------------
-- Content: a skill-share prompt for each tribe and phase (weeks 1-4, 5-8, 9-12), and an idea for each goal.
-- DRAFT WORDING for tribe champions and the pastorate to review.
-- ---------------------------------------------------------------------------

insert into public.tribe_prompts (tribe_id, phase, skill_share)
select t.id, v.phase, v.skill_share
from (values
  ('business-entrepreneurship', 1, 'Each person gives a one-minute pitch of their business or idea and names the one question they most want answered.'),
  ('business-entrepreneurship', 2, 'Share one number you now track every week (sales, customers, cash in hand) and how you keep it honest.'),
  ('business-entrepreneurship', 3, 'Teach the circle one thing you learned the hard way this season, so that no one else has to learn it that way.'),
  ('professionals',             1, 'Name one skill at work you are proud of and one you want to grow. Ask the circle who has the one you want.'),
  ('professionals',             2, 'Share how you handle a difficult colleague or manager, and what you would do differently.'),
  ('professionals',             3, 'Offer a ten-minute coaching slot: someone in the circle brings a work problem, and everyone helps think it through.'),
  ('consulting',                1, 'Say in one sentence who you help and what changes for them. Let the circle tell you whether it is clear.'),
  ('consulting',                2, 'Share one way you find clients that has actually worked, and one that has not.'),
  ('consulting',                3, 'Practise a price conversation in pairs: one asks for a discount, the other holds the line with grace.'),
  ('in-between-jobs',           1, 'Share your story in two minutes and the kind of role you want. Ask who in the circle knows someone in that field.'),
  ('in-between-jobs',           2, 'Do a mock interview in pairs with one real question each, then give two kind and honest pieces of feedback.'),
  ('in-between-jobs',           3, 'Share one open door from this season and one thing you will do daily so that you keep moving while you wait.'),
  ('global-citizens',           1, 'Share what home means to you now and one thing you miss most. Say how the circle can keep you close.'),
  ('global-citizens',           2, 'Teach the circle one practical thing about living or moving between countries: paperwork, money transfers, schools or time zones.'),
  ('global-citizens',           3, 'Plan one ritual to keep family close across distance, such as a weekly call, a shared prayer or a standing family meal online.'),
  ('marriage-relationships',    1, 'Share one thing you admire in your spouse or in a couple you know. If you are single, name a quality you are growing in.'),
  ('marriage-relationships',    2, 'Share one habit that helps you resolve conflict well, and one you are still learning. Keep the details kind and private.'),
  ('marriage-relationships',    3, 'Write a short blessing for someone in the circle and read it aloud. Note what changed in how you speak at home.'),
  ('parents-family',            1, 'Share one rhythm in your home that works, such as a meal, a bedtime prayer or a weekly family talk, and why it works.'),
  ('parents-family',            2, 'Name one parenting challenge this month. The circle shares what has helped them, without judging.'),
  ('parents-family',            3, 'Each parent shares one thing they will keep doing after the season to build a faith-filled home.'),
  ('health-fitness-sports',     1, 'Share one habit you want to build and how you will measure it. Pick an accountability partner in the circle.'),
  ('health-fitness-sports',     2, 'Teach a warm-up, a stretch or a simple meal that anyone can do, and let the circle try it together.'),
  ('health-fitness-sports',     3, 'Share your progress with one number and one story. Plan one activity the whole circle can do together.'),
  ('education',                 1, 'Share how you study or teach best and one habit that gets in your way. Swap one tip.'),
  ('education',                 2, 'Teach a hard idea from your course or subject in two minutes, in plain words, to someone who has not studied it.'),
  ('education',                 3, 'Share one encouragement for a student or a teacher you know, and decide how to deliver it this week.'),
  ('medical-healthcare',        1, 'Share what drew you to your work and what drains you most. Name one way the circle can pray for you.'),
  ('medical-healthcare',        2, 'Share one boundary or rest practice that protects you on a heavy week, and ask for one from someone else.'),
  ('medical-healthcare',        3, 'Offer a ten-minute health tip for the whole circle, from sleep to blood pressure checks, in plain language.'),
  ('creative-economy',          1, 'Show or describe one piece of your work and say what you want it to do for people. Receive feedback kindly.'),
  ('creative-economy',          2, 'Share your process for finishing: how you set deadlines, keep going when you are stuck and know it is done.'),
  ('creative-economy',          3, 'Choose one piece to release or share this month and tell the circle the date. They will hold you to it.')
) as v (tribe_slug, phase, skill_share)
join public.tribes t on t.slug = v.tribe_slug
on conflict (tribe_id, phase) do nothing;

insert into public.goal_ideas (season_goal_id, phase, idea)
select g.id, v.phase, v.idea
from (values
  ('launch-or-formalise-a-business', 1, 'Write down who your first ten customers are and what problem you solve for each of them.'),
  ('launch-or-formalise-a-business', 2, 'Take the next legal or practical step: register the name with the CAC, open a business account or make your first sale.'),
  ('launch-or-formalise-a-business', 3, 'Set a 90-day plan with one revenue target, and ask one person in the circle to check on it monthly.'),
  ('grow-revenue-and-systems', 1, 'Pick one number that tells you if the business is healthy and record it every week.'),
  ('grow-revenue-and-systems', 2, 'Write down one process that depends only on you and make it simple enough for someone else to do.'),
  ('grow-revenue-and-systems', 3, 'Ask your five best customers what they value most, then do more of it.'),
  ('step-into-a-leadership-role', 1, 'Name the leadership role you want and the three skills it needs. Rate yourself honestly on each.'),
  ('step-into-a-leadership-role', 2, 'Ask a leader you respect for twenty minutes and bring two questions. Act on one thing they say.'),
  ('step-into-a-leadership-role', 3, 'Take one visible responsibility at work, in church or in the community, and report back to the circle.'),
  ('change-career-direction-with-confidence', 1, 'List what you enjoy, what you are good at and what the market pays for. Look for the overlap.'),
  ('change-career-direction-with-confidence', 2, 'Speak to two people already in the field you are considering and ask what they wish they had known.'),
  ('change-career-direction-with-confidence', 3, 'Try a small test before you commit: a short course, a side project or a week of shadowing.'),
  ('build-a-steady-client-pipeline', 1, 'List twenty people who could hire you or refer you, and contact five this week.'),
  ('build-a-steady-client-pipeline', 2, 'Ask two past clients for a short testimonial and one introduction.'),
  ('build-a-steady-client-pipeline', 3, 'Set a weekly hour for outreach and keep it, whatever the week looks like.'),
  ('price-and-package-my-expertise', 1, 'Write down what you charge today and what the result is worth to the client. Notice the gap.'),
  ('price-and-package-my-expertise', 2, 'Turn what you do into a clear package with a scope, a timeline and a price.'),
  ('price-and-package-my-expertise', 3, 'Raise your price for the next new client, and practise saying it aloud first.'),
  ('land-my-next-role', 1, 'Update your CV and your LinkedIn profile this week, and ask one person to read them with you.'),
  ('land-my-next-role', 2, 'Send five focused applications or messages a week, and ask for one introduction each week.'),
  ('land-my-next-role', 3, 'Keep a short list of interviews and follow-ups, and thank everyone who helped you, even if it did not lead anywhere.'),
  ('retool-with-new-skills', 1, 'Pick one skill the roles you want keep asking for and find one free or low-cost way to start.'),
  ('retool-with-new-skills', 2, 'Build something small that shows the skill, such as a sample, a project or a short write-up.'),
  ('retool-with-new-skills', 3, 'Share what you built with someone who hires, and ask what would make it stronger.'),
  ('thrive-in-a-long-distance-family', 1, 'Agree a regular time to call each close family member, and keep to it for the whole season.'),
  ('thrive-in-a-long-distance-family', 2, 'Plan one thing to do together online each month, such as a meal, a prayer, a game or a devotional.'),
  ('thrive-in-a-long-distance-family', 3, 'Write a letter or voice note of thanks to someone at home and send it.'),
  ('make-a-cross-border-move-well', 1, 'Write the full list of what the move needs: documents, money, housing and people. Put a date next to each item.'),
  ('make-a-cross-border-move-well', 2, 'Find one person already living where you are going and ask what they would do differently.'),
  ('make-a-cross-border-move-well', 3, 'Plan your first month there, including how you will find a church family from week one.'),
  ('strengthen-our-marriage', 1, 'Set a weekly time to talk, with phones away, and begin each time by naming one thing you appreciate.'),
  ('strengthen-our-marriage', 2, 'Pray together every day this month, even for two minutes.'),
  ('strengthen-our-marriage', 3, 'Plan one date or day away that you both look forward to, and agree what you want it to do for the marriage.'),
  ('prepare-well-for-marriage', 1, 'Write what you hope for in a marriage and what you are growing in. Share it with a trusted mentor.'),
  ('prepare-well-for-marriage', 2, 'Talk openly about money, children, family and faith, and note where you agree and where you do not.'),
  ('prepare-well-for-marriage', 3, 'Book your pre-marriage counselling or class, and ask a married couple to walk with you.'),
  ('rebuild-after-a-relationship-ends', 1, 'Give yourself space to grieve, and tell one safe person how you are really doing.'),
  ('rebuild-after-a-relationship-ends', 2, 'Return to one habit that keeps you steady, such as prayer, exercise, rest or time with friends.'),
  ('rebuild-after-a-relationship-ends', 3, 'Name what you want to carry forward and what you are leaving behind, and share it with the circle.'),
  ('build-a-faith-filled-home-rhythm', 1, 'Choose one daily moment, such as a meal, bedtime or the car ride, to pray or read together as a family.'),
  ('build-a-faith-filled-home-rhythm', 2, 'Let each child choose a Bible story or a song for the family this week.'),
  ('build-a-faith-filled-home-rhythm', 3, 'Write your family''s top three values and put them where everyone can see them.'),
  ('parent-teenagers-well', 1, 'Listen for ten minutes with no advice. Ask one question you do not know the answer to.'),
  ('parent-teenagers-well', 2, 'Agree one clear boundary with your teenager and the reason for it, and let them help set it.'),
  ('parent-teenagers-well', 3, 'Do something your teenager enjoys, and let them lead it.'),
  ('build-a-consistent-fitness-habit', 1, 'Choose one activity you can do on your worst day, and do it three times this week.'),
  ('build-a-consistent-fitness-habit', 2, 'Find a partner in the circle and agree the days you will check in with each other.'),
  ('build-a-consistent-fitness-habit', 3, 'Set a goal you can measure, such as a distance, a weight or a time, and mark the date.'),
  ('reach-a-health-milestone', 1, 'Write your milestone with a date, and book any check-up or test you have been putting off.'),
  ('reach-a-health-milestone', 2, 'Break the milestone into four monthly steps and record where you are each week.'),
  ('reach-a-health-milestone', 3, 'Plan how you will keep it going after the milestone, so that it is a way of life and not a moment.'),
  ('excel-in-my-studies-or-exams', 1, 'Make a study timetable that fits your real life, and share it with one person who will ask how it is going.'),
  ('excel-in-my-studies-or-exams', 2, 'Study with one or two others once a week and teach each other the hardest topics.'),
  ('excel-in-my-studies-or-exams', 3, 'Do past papers under timed conditions, and learn from every mistake.'),
  ('grow-as-an-educator', 1, 'Choose one thing in your teaching to improve this season and ask a colleague to watch one lesson.'),
  ('grow-as-an-educator', 2, 'Try one new method with your class and note what the students say.'),
  ('grow-as-an-educator', 3, 'Write down one lesson you will keep and share it with another teacher.'),
  ('sustain-my-calling-without-burning-out', 1, 'List what drains you and what restores you. Protect one restoring thing this week.'),
  ('sustain-my-calling-without-burning-out', 2, 'Set one boundary on your time and tell someone who will help you keep it.'),
  ('sustain-my-calling-without-burning-out', 3, 'Plan a proper rest, a day or more, in the next quarter and put it in your calendar now.'),
  ('advance-my-specialisation', 1, 'Write the next exam, certificate or posting you need and the date you want it by.'),
  ('advance-my-specialisation', 2, 'Find a mentor already where you want to be and ask for a regular conversation.'),
  ('advance-my-specialisation', 3, 'Set a weekly study block and protect it, even on busy weeks.'),
  ('finish-and-release-a-body-of-work', 1, 'Choose the work you will finish. Write what finished means, and the date.'),
  ('finish-and-release-a-body-of-work', 2, 'Work on it at the same time every day for a month, and mark each day you do.'),
  ('finish-and-release-a-body-of-work', 3, 'Release it to a small audience first, and ask three people for honest feedback.'),
  ('turn-my-craft-into-income', 1, 'Decide who would pay for your craft and what they would pay for, and ask three of them.'),
  ('turn-my-craft-into-income', 2, 'Put a price on one thing you make and offer it to ten people this month.'),
  ('turn-my-craft-into-income', 3, 'Set up a simple way to be paid and to be found, such as a page, a profile or an account.')
) as v (goal_slug, phase, idea)
join public.season_goals g on g.slug = v.goal_slug
on conflict (season_goal_id, phase) do nothing;

-- ---------------------------------------------------------------------------
-- The weekly numbers for a circle now include the energy of the meeting and its open care tasks
-- ---------------------------------------------------------------------------

create or replace function public.circle_week_report(p_circle uuid, p_week integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
  s public.seasons%rowtype;
  lg public.circle_logs%rowtype;
  today date := public.today_lagos();
  cw integer;
  n integer;
  present_n integer := 0;
  absent_n integer := 0;
  excused_n integer := 0;
  steps_n integer;
  done_n integer;
  partly_n integer;
  notyet_n integer;
  pulse_n integer;
  pulse_wk boolean;
  bel numeric;
  open_n integer;
  esc_n integer;
  testi_n integer;
  care_n integer;
  rate numeric;
  mdate date;
  st text;
begin
  select * into c from public.circles where id = p_circle;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  mdate := public.meeting_date_of(p_circle, p_week);
  select count(*) into n from public.circle_members where circle_id = p_circle and status = 'active';
  select * into lg from public.circle_logs where circle_id = p_circle and week = p_week;
  if found and lg.held then
    select count(*) filter (where a.status = 'present'),
           count(*) filter (where a.status = 'absent'),
           count(*) filter (where a.status = 'excused')
      into present_n, absent_n, excused_n
      from public.circle_attendance a
     where a.circle_id = p_circle and a.week = p_week;
  end if;
  select count(*),
         count(*) filter (where w.outcome = 'done'),
         count(*) filter (where w.outcome = 'partly'),
         count(*) filter (where w.outcome = 'not_yet')
    into steps_n, done_n, partly_n, notyet_n
    from public.week_steps w
    join public.circle_members m on m.circle_id = w.circle_id and m.person_id = w.person_id and m.status = 'active'
   where w.circle_id = p_circle and w.week = p_week;
  pulse_wk := public.is_pulse_week(p_week, s.weeks);
  select count(*), avg(p.belonging) into pulse_n, bel
    from public.pulses p
    join public.circle_members m on m.circle_id = p.circle_id and m.person_id = p.person_id and m.status = 'active'
   where p.circle_id = p_circle and p.week = p_week;
  select count(*) filter (where f.status <> 'closed'), count(*) filter (where f.status = 'escalated')
    into open_n, esc_n from public.care_flags f where f.circle_id = p_circle;
  select count(*) into testi_n from public.testimonies t
   where t.circle_id = p_circle and t.week = p_week and t.status <> 'withdrawn';
  select count(*) into care_n from public.care_tasks x where x.circle_id = p_circle and x.status = 'open';
  rate := case when lg.held is true and n > 0 then round(present_n::numeric / n, 2) end;

  st := case
    when p_week > cw then 'upcoming'
    when lg.circle_id is null then case when p_week < cw or today > mdate then 'no_log' else 'upcoming' end
    when not lg.held then 'needs_attention'
    when esc_n > 0 or coalesce(rate, 1) < 0.5 then 'needs_attention'
    when open_n > 0 or coalesce(rate, 1) < 0.7 then 'watch'
    else 'on_track' end;

  return jsonb_build_object(
    'week', p_week,
    'meeting_date', mdate,
    'logged', lg.circle_id is not null,
    'held', case when lg.circle_id is null then null else lg.held end,
    'highlight', lg.highlight,
    'members', n,
    'present', present_n, 'absent', absent_n, 'excused', excused_n,
    'attendance_rate', rate,
    'steps_set', steps_n, 'steps_done', done_n, 'steps_partly', partly_n, 'steps_not_yet', notyet_n,
    'pulse_week', pulse_wk,
    'pulse_answers', case when pulse_wk then pulse_n end,
    -- an average of fewer than three people could point at one person
    'belonging_average', case when pulse_wk and pulse_n >= 3 then round(bel, 1) end,
    'follow_ups_open', open_n, 'follow_ups_escalated', esc_n,
    'testimonies', testi_n,
    -- how the meeting felt (1-5) and how many care tasks are open for the circle
    'energy', case when lg.held then lg.energy end,
    'care_open', care_n,
    'status', st);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.tag_testimony(),
  public.care_route(uuid, text),
  public.raise_care_task(uuid, uuid, text, text, integer, uuid),
  public.care_sweep(timestamptz),
  public.care_task_json(uuid),
  public.save_circle_log(uuid, integer, boolean, text, jsonb, integer, jsonb, jsonb, boolean, text, jsonb),
  public.circle_log_extras(uuid, integer),
  public.answer_prayer(uuid, text),
  public.remove_prayer(uuid),
  public.my_care_tasks(),
  public.complete_care_task(uuid, text, text),
  public.reassign_care_task(uuid, uuid),
  public.care_task_stats(integer),
  public.care_task_options(uuid),
  public.review_testimony(uuid, text, text, text[]),
  public.testimony_wall(uuid, uuid, text, integer, integer),
  public.forward_testimony(uuid),
  public.week_layer(uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.save_circle_log(uuid, integer, boolean, text, jsonb, integer, jsonb, jsonb, boolean, text, jsonb),
  public.circle_log_extras(uuid, integer),
  public.answer_prayer(uuid, text),
  public.remove_prayer(uuid),
  public.my_care_tasks(),
  public.complete_care_task(uuid, text, text),
  public.reassign_care_task(uuid, uuid),
  public.care_task_stats(integer),
  public.care_task_options(uuid),
  public.review_testimony(uuid, text, text, text[]),
  public.testimony_wall(uuid, uuid, text, integer, integer),
  public.forward_testimony(uuid),
  public.week_layer(uuid, integer)
to authenticated;

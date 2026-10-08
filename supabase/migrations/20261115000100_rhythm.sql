-- =============================================================================
-- United Tribes, Phase 5: the weekly rhythm
--
--   week_guides         the twelve weekly guides (content is in the next migration)
--   week_steps          "When ..., I will ..." and the Friday check-in, one row per person per week
--   circle_logs         the leader's two-minute log of a meeting, with circle_attendance
--   pulses              the three short pulses (weeks 1, 6 and 12): belonging and the Success Picture
--   care_flags          follow-ups: two missed meetings, two "not yet" weeks, a low pulse, a leader's concern
--   testimonies         short testimonies, reviewed before anyone else reads them
--
-- Nobody reads or writes these tables directly. Every screen goes through the
-- functions below, which check who is asking. Weeks count from the season's
-- start date; every date is a Lagos date.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Dates and weeks
-- ---------------------------------------------------------------------------

create function public.today_lagos()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;

-- 0 before the season starts, 1..weeks while it runs, weeks + 1 after it ends.
create function public.season_week(p_starts date, p_weeks integer, p_day date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_day < p_starts then 0
              when p_day >= p_starts + p_weeks * 7 then p_weeks + 1
              else ((p_day - p_starts) / 7) + 1 end;
$$;

-- Weeks 1, the middle and the last carry a pulse.
create function public.is_pulse_week(p_week integer, p_weeks integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_week in (1, p_weeks / 2, p_weeks);
$$;

-- The day a circle meets in a given week.
create function public.meeting_date_of(p_circle uuid, p_week integer)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select s.starts_on + (p_week - 1) * 7
         + case when c.meeting_day is null then 0
                else (c.meeting_day - extract(dow from s.starts_on)::integer + 7) % 7 end
    from public.circles c
    join public.seasons s on s.id = c.season_id
   where c.id = p_circle;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.week_guides (
  week smallint primary key check (week between 1 and 12),
  theme text not null check (theme in ('begin', 'loving_god', 'loving_others', 'loving_life', 'review', 'finish')),
  title text not null,
  passage text not null,
  big_idea text not null,
  opening_question text not null,
  questions text[] not null check (cardinality(questions) = 3),
  practice text not null,
  step_hint text not null,
  prayer text not null,
  plan jsonb not null,
  leader_tip text not null
);

-- The Success Picture the circle settles on in week 1 or 2
alter table public.circles
  add column final_god text check (char_length(final_god) <= 200),
  add column final_others text check (char_length(final_others) <= 200),
  add column final_life text check (char_length(final_life) <= 200),
  add column picture_refined_at timestamptz,
  add column picture_refined_by uuid references public.people (id) on delete set null;

create table public.week_steps (
  person_id uuid not null references public.people (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week between 1 and 12),
  when_text text not null check (char_length(btrim(when_text)) between 3 and 140),
  will_text text not null check (char_length(btrim(will_text)) between 3 and 140),
  outcome text check (outcome in ('done', 'partly', 'not_yet')),
  reflection text check (char_length(reflection) <= 300),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, circle_id, week)
);
create index week_steps_circle_idx on public.week_steps (circle_id, week);

create table public.circle_logs (
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week between 1 and 12),
  held boolean not null,
  highlight text check (char_length(highlight) <= 300),
  logged_by uuid references public.people (id) on delete set null,
  logged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (circle_id, week)
);

create table public.circle_attendance (
  circle_id uuid not null,
  week smallint not null,
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused')),
  primary key (circle_id, week, person_id),
  foreign key (circle_id, week) references public.circle_logs (circle_id, week) on delete cascade
);
create index circle_attendance_person_idx on public.circle_attendance (person_id, circle_id);

create table public.pulses (
  person_id uuid not null references public.people (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week in (1, 6, 12)),
  belonging smallint not null check (belonging between 1 and 5),
  god smallint not null check (god between 1 and 5),
  others smallint not null check (others between 1 and 5),
  life smallint not null check (life between 1 and 5),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  primary key (person_id, circle_id, week)
);

create table public.care_flags (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('missed_twice', 'not_yet_twice', 'low_belonging', 'leader_concern')),
  week smallint,
  status text not null default 'open' check (status in ('open', 'escalated', 'closed')),
  attempts smallint not null default 0,
  last_outcome text check (last_outcome in ('reached', 'not_reached', 'needs_care_lead')),
  note text check (char_length(note) <= 300),
  opened_by uuid references public.people (id) on delete set null,
  opened_at timestamptz not null default now(),
  last_called_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.people (id) on delete set null
);
create unique index care_flags_one_open on public.care_flags (person_id, circle_id, kind) where status <> 'closed';
create index care_flags_circle_idx on public.care_flags (circle_id) where status <> 'closed';
create index care_flags_queue_idx on public.care_flags (status, opened_at) where status <> 'closed';

create table public.testimonies (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  week smallint not null check (week between 1 and 12),
  body text not null check (char_length(btrim(body)) between 20 and 600),
  share_with text not null check (share_with in ('circle', 'church')),
  credit text not null check (credit in ('full_name', 'first_name', 'anonymous')),
  status text not null default 'submitted'
    check (status in ('submitted', 'circle_approved', 'church_approved', 'declined', 'withdrawn')),
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  decline_note text check (char_length(decline_note) <= 200),
  created_at timestamptz not null default now()
);
create index testimonies_circle_idx on public.testimonies (circle_id, status);
create index testimonies_person_idx on public.testimonies (person_id);

-- ---------------------------------------------------------------------------
-- Helpers (not callable from the app)
-- ---------------------------------------------------------------------------

-- A person's placement in the newest season they have one in.
create function public.current_placement(p_person uuid)
returns setof public.circle_members
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.circle_members m
    join public.seasons s on s.id = m.season_id
   where m.person_id = p_person and m.status = 'active'
   order by s.starts_on desc
   limit 1;
$$;

-- Two held meetings in a row missed with no word: open a follow-up.
create function public.flag_missed_twice(p_circle uuid, p_week integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev integer;
begin
  select max(l.week) into prev from public.circle_logs l
   where l.circle_id = p_circle and l.week < p_week and l.held;
  if prev is null then
    return;
  end if;
  insert into public.care_flags (circle_id, person_id, kind, week)
  select p_circle, a.person_id, 'missed_twice', p_week
    from public.circle_attendance a
    join public.circle_members m on m.circle_id = a.circle_id and m.person_id = a.person_id and m.status = 'active'
   where a.circle_id = p_circle and a.week = p_week and a.status = 'absent'
     and exists (select 1 from public.circle_attendance b
                  where b.circle_id = p_circle and b.person_id = a.person_id and b.week = prev and b.status = 'absent')
  on conflict (person_id, circle_id, kind) where status <> 'closed' do nothing;
end;
$$;

-- The week's numbers for one circle. Used by the leader, the coach and the office.
create function public.circle_week_report(p_circle uuid, p_week integer)
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
    'status', st);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's week
-- ---------------------------------------------------------------------------

create function public.my_week(p_view integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  c public.circles%rowtype;
  s public.seasons%rowtype;
  g public.week_guides%rowtype;
  st public.week_steps%rowtype;
  today date := public.today_lagos();
  cw integer;
  gw integer;
  state text;
  ws date;
  check_target integer;
  pulse_target integer;
  nudges jsonb := '[]'::jsonb;
  have_step boolean := false;
  testimony_n integer;
  attended_n integer;
  logged_n integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    return jsonb_build_object('placed', false);
  end if;
  select * into c from public.circles where id = pm.circle_id;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  select count(*) filter (where a.status = 'present') into attended_n
    from public.circle_attendance a where a.circle_id = c.id and a.person_id = uid;
  select count(*) into logged_n from public.circle_logs l where l.circle_id = c.id and l.held;
  select count(*) into testimony_n from public.testimonies t
   where t.person_id = uid and t.circle_id = c.id and t.status not in ('withdrawn', 'declined');

  if state = 'running' then
    ws := s.starts_on + (cw - 1) * 7;
    -- A member can read any week that has started; the guide shown is the one they ask for
    gw := case when p_view between 1 and cw then p_view else cw end;
    select * into g from public.week_guides where week = gw;
    select * into st from public.week_steps where person_id = uid and circle_id = c.id and week = gw;
    have_step := found;
    if not exists (select 1 from public.week_steps x where x.person_id = uid and x.circle_id = c.id and x.week = cw) then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'set_step', 'week', cw));
    end if;
  end if;

  -- The last check-in and the last pulse stay open for a little while after the final week
  if state in ('running', 'complete') then
    select x.week into check_target from public.week_steps x
     where x.person_id = uid and x.circle_id = c.id and x.outcome is null and x.week <= cw
       and today between s.starts_on + (x.week - 1) * 7 + 5 and s.starts_on + (x.week - 1) * 7 + 9
     order by x.week desc limit 1;

    select gs.w into pulse_target from generate_series(1, s.weeks) as gs(w)
     where public.is_pulse_week(gs.w, s.weeks) and gs.w <= cw
       and today between s.starts_on + (gs.w - 1) * 7 and s.starts_on + (gs.w - 1) * 7 + 13
       and not exists (select 1 from public.pulses p where p.person_id = uid and p.circle_id = c.id and p.week = gs.w)
     order by gs.w desc limit 1;

    if check_target is not null then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'check_in', 'week', check_target));
    end if;
    if pulse_target is not null then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'pulse', 'week', pulse_target));
    end if;
  end if;
  if (state = 'complete' or cw >= s.weeks - 2) and testimony_n = 0 then
    nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'testimony', 'week', least(greatest(cw, 1), s.weeks)));
  end if;

  return jsonb_build_object(
    'placed', true,
    'state', state,
    'week', case when state = 'running' then cw end,
    'viewing', case when state = 'running' then gw end,
    'weeks', s.weeks,
    'starts_on', s.starts_on,
    'ends_on', s.starts_on + s.weeks * 7 - 1,
    'days_to_start', case when state = 'before' then s.starts_on - today end,
    'season_name', s.name,
    'circle', jsonb_build_object(
      'id', c.id, 'name', c.name, 'leader_first_name', public.first_name_of(c.leader_id),
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
      'meeting_mode', c.meeting_mode, 'group_url', c.whatsapp_group_url,
      'meeting_date', case when state = 'running' then public.meeting_date_of(c.id, gw) end),
    'picture', jsonb_build_object(
      'god', coalesce(c.final_god, c.loving_god),
      'others', coalesce(c.final_others, c.loving_others),
      'life', coalesce(c.final_life, c.loving_life),
      'refined', c.picture_refined_at is not null),
    'guide', case when state = 'running' and g.week is not null then jsonb_build_object(
      'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
      'opening_question', g.opening_question, 'questions', to_jsonb(g.questions), 'practice', g.practice,
      'step_hint', g.step_hint, 'prayer', g.prayer) end,
    'step', case when have_step then jsonb_build_object(
      'week', st.week, 'when', st.when_text, 'will', st.will_text, 'outcome', st.outcome, 'reflection', st.reflection) end,
    'check_in', jsonb_build_object(
      'week', check_target,
      'opens_on', case when state = 'running' then ws + 5 end,
      'closes_on', case when state = 'running' then ws + 9 end),
    'pulse_week', pulse_target,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', gs.w,
               'state', case when gs.w < cw then 'past' when gs.w = cw then 'now' else 'future' end,
               'held', (select l.held from public.circle_logs l where l.circle_id = c.id and l.week = gs.w),
               'attended', (select a.status from public.circle_attendance a
                             where a.circle_id = c.id and a.week = gs.w and a.person_id = uid),
               'step', (select coalesce(x.outcome, 'set') from public.week_steps x
                         where x.person_id = uid and x.circle_id = c.id and x.week = gs.w)) order by gs.w)
        from generate_series(1, s.weeks) as gs(w)), '[]'::jsonb),
    'attended', attended_n,
    'logged', logged_n,
    'testimonies', testimony_n,
    'nudges', nudges);
end;
$$;

create function public.save_week_step(p_week integer, p_when text, p_will text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  cw integer;
  w text := btrim(coalesce(p_when, ''));
  i text := btrim(coalesce(p_will, ''));
  existing public.week_steps%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    raise exception 'Join a circle first' using errcode = '22023';
  end if;
  select * into s from public.seasons where id = pm.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  if cw < 1 or cw > s.weeks or p_week is distinct from cw then
    raise exception 'You can set a step for the current week only' using errcode = '22023';
  end if;
  if char_length(w) < 3 or char_length(i) < 3 then
    raise exception 'Say when you will do it and what you will do' using errcode = '22023';
  end if;
  if char_length(w) > 140 or char_length(i) > 140 then
    raise exception 'Keep each part to 140 characters or fewer' using errcode = '22023';
  end if;
  select * into existing from public.week_steps
   where person_id = uid and circle_id = pm.circle_id and week = cw;
  if found and existing.outcome is not null then
    raise exception 'You have already checked in on this step' using errcode = '22023';
  end if;
  insert into public.week_steps (person_id, circle_id, week, when_text, will_text)
  values (uid, pm.circle_id, cw, w, i)
  on conflict (person_id, circle_id, week)
  do update set when_text = excluded.when_text, will_text = excluded.will_text, updated_at = now();
end;
$$;

create function public.save_checkin(p_week integer, p_outcome text, p_reflection text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  ws date;
  today date := public.today_lagos();
  refl text := nullif(btrim(coalesce(p_reflection, '')), '');
  prev_outcome text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    raise exception 'Join a circle first' using errcode = '22023';
  end if;
  select * into s from public.seasons where id = pm.season_id;
  if p_week is null or p_week < 1 or p_week > s.weeks then
    raise exception 'That week does not exist' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'partly', 'not_yet') then
    raise exception 'Choose done, partly or not yet' using errcode = '22023';
  end if;
  if refl is not null and char_length(refl) > 300 then
    raise exception 'Keep your note to 300 characters or fewer' using errcode = '22023';
  end if;
  ws := s.starts_on + (p_week - 1) * 7;
  if today < ws + 5 then
    raise exception 'The check-in opens on Friday' using errcode = '22023';
  end if;
  if today > ws + 9 then
    raise exception 'The check-in for that week has closed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.week_steps where person_id = uid and circle_id = pm.circle_id and week = p_week) then
    raise exception 'Set your step for the week before you check in' using errcode = '22023';
  end if;
  update public.week_steps
     set outcome = p_outcome, reflection = refl, checked_at = now(), updated_at = now()
   where person_id = uid and circle_id = pm.circle_id and week = p_week;

  if p_outcome = 'not_yet' and p_week > 1 then
    select x.outcome into prev_outcome from public.week_steps x
     where x.person_id = uid and x.circle_id = pm.circle_id and x.week = p_week - 1;
    if prev_outcome = 'not_yet' then
      insert into public.care_flags (circle_id, person_id, kind, week)
      values (pm.circle_id, uid, 'not_yet_twice', p_week)
      on conflict (person_id, circle_id, kind) where status <> 'closed' do nothing;
    end if;
  end if;
end;
$$;

create function public.save_pulse(p_week integer, p_belonging integer, p_god integer, p_others integer, p_life integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  ws date;
  today date := public.today_lagos();
  nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    raise exception 'Join a circle first' using errcode = '22023';
  end if;
  select * into s from public.seasons where id = pm.season_id;
  if p_week is null or p_week < 1 or p_week > s.weeks or not public.is_pulse_week(p_week, s.weeks) then
    raise exception 'There is no check-in for that week' using errcode = '22023';
  end if;
  ws := s.starts_on + (p_week - 1) * 7;
  if today < ws then
    raise exception 'That check-in has not opened yet' using errcode = '22023';
  end if;
  if today > ws + 13 then
    raise exception 'That check-in has closed' using errcode = '22023';
  end if;
  if p_belonging is null or p_god is null or p_others is null or p_life is null
     or least(p_belonging, p_god, p_others, p_life) < 1 or greatest(p_belonging, p_god, p_others, p_life) > 5 then
    raise exception 'Answer each question from 1 to 5' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 300 then
    raise exception 'Keep your note to 300 characters or fewer' using errcode = '22023';
  end if;
  insert into public.pulses (person_id, circle_id, week, belonging, god, others, life, note)
  values (uid, pm.circle_id, p_week, p_belonging, p_god, p_others, p_life, nt)
  on conflict (person_id, circle_id, week)
  do update set belonging = excluded.belonging, god = excluded.god, others = excluded.others,
                life = excluded.life, note = excluded.note, created_at = now();

  if p_belonging <= 2 then
    insert into public.care_flags (circle_id, person_id, kind, week)
    values (pm.circle_id, uid, 'low_belonging', p_week)
    on conflict (person_id, circle_id, kind) where status <> 'closed' do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Testimonies
-- ---------------------------------------------------------------------------

create function public.submit_testimony(p_body text, p_share text, p_credit text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  cw integer;
  b text := btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    raise exception 'Join a circle first' using errcode = '22023';
  end if;
  select * into s from public.seasons where id = pm.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  if cw < 1 then
    raise exception 'You can share a testimony once your season has started' using errcode = '22023';
  end if;
  if char_length(b) < 20 then
    raise exception 'Say a little more. A testimony needs at least 20 characters' using errcode = '22023';
  end if;
  if char_length(b) > 600 then
    raise exception 'Keep your testimony to 600 characters or fewer' using errcode = '22023';
  end if;
  if p_share is null or p_share not in ('circle', 'church') then
    raise exception 'Choose who may read it' using errcode = '22023';
  end if;
  if p_credit is null or p_credit not in ('full_name', 'first_name', 'anonymous') then
    raise exception 'Choose how your name appears' using errcode = '22023';
  end if;
  if (select count(*) from public.testimonies t
       where t.person_id = uid and t.circle_id = pm.circle_id and t.status not in ('withdrawn', 'declined')) >= 5 then
    raise exception 'You have shared five testimonies this season. Withdraw one to add another' using errcode = '22023';
  end if;
  insert into public.testimonies (person_id, circle_id, week, body, share_with, credit)
  values (uid, pm.circle_id, least(cw, s.weeks), b, p_share, p_credit)
  returning id into new_id;
  perform public.write_event(uid, 'testimony.submitted', 'testimony', new_id::text,
    jsonb_build_object('share_with', p_share, 'credit', p_credit));
  return new_id;
end;
$$;

create function public.withdraw_testimony(p_id uuid)
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
  update public.testimonies set status = 'withdrawn'
   where id = p_id and person_id = uid and status in ('submitted', 'circle_approved', 'church_approved');
  if not found then
    raise exception 'That testimony cannot be withdrawn' using errcode = 'P0002';
  end if;
end;
$$;

-- What a member reads: their own, whatever its state, and what the leader approved for the circle.
create function public.circle_testimonies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  pm public.circle_members%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'week', t.week, 'body', t.body, 'share_with', t.share_with, 'credit', t.credit,
             'status', t.status, 'mine', t.person_id = uid, 'decline_note', case when t.person_id = uid then t.decline_note end,
             'by', case t.credit
                     when 'anonymous' then 'A member of the circle'
                     when 'first_name' then public.first_name_of(t.person_id)
                     else public.person_display_name(t.person_id) end,
             'created_at', t.created_at) order by t.created_at desc)
      from public.testimonies t
     where t.circle_id = pm.circle_id
       and t.status <> 'withdrawn'
       and (t.person_id = uid or t.status in ('circle_approved', 'church_approved'))), '[]'::jsonb);
end;
$$;

-- The leader approves for the circle; a pastor or director approves for the church.
create function public.review_testimony(p_id uuid, p_decision text, p_note text)
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
  if p_decision = 'decline' then
    update public.testimonies set status = 'declined', decided_by = uid, decided_at = now(), decline_note = nt where id = p_id;
  else
    update public.testimonies
       set status = case when office and share_with = 'church' then 'church_approved' else 'circle_approved' end,
           decided_by = uid, decided_at = now(), decline_note = null
     where id = p_id;
  end if;
  perform public.write_event(uid, 'testimony.' || p_decision, 'testimony', p_id::text, '{}'::jsonb);
end;
$$;

-- Waiting for the caller: their own circle's (leader), and the church-wide queue (pastor, director).
create function public.pending_testimonies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'circle', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'week', t.week, 'body', t.body, 'share_with', t.share_with, 'credit', t.credit,
               'by', public.person_display_name(t.person_id), 'circle', c.name, 'created_at', t.created_at)
             order by t.created_at)
        from public.testimonies t
        join public.circles c on c.id = t.circle_id
       where t.status = 'submitted' and (c.leader_id = uid or coalesce(c.assistant_id = uid, false))), '[]'::jsonb),
    'church', case when office then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'week', t.week, 'body', t.body, 'share_with', t.share_with, 'credit', t.credit,
               'by', public.person_display_name(t.person_id), 'circle', c.name, 'status', t.status,
               'created_at', t.created_at) order by t.created_at)
        from public.testimonies t
        join public.circles c on c.id = t.circle_id
       where t.share_with = 'church' and t.status in ('submitted', 'circle_approved')), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader's week: prep pack, two-minute log, follow-ups
-- ---------------------------------------------------------------------------

create function public.circle_week(p_circle uuid, p_week integer default null)
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
  lg public.circle_logs%rowtype;
  today date := public.today_lagos();
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  can_edit boolean;
  cw integer;
  state text;
  wk integer;
  ws date;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  can_edit := c.leader_id = uid or coalesce(c.assistant_id = uid, false);
  if not (can_edit or coalesce(c.coach_id = uid, false) or office) then
    raise exception 'You do not run this circle' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;
  wk := case when p_week is not null then p_week
             when state = 'before' then 1
             when state = 'complete' then s.weeks
             else cw end;
  if wk < 1 or wk > s.weeks then
    raise exception 'That week does not exist' using errcode = 'P0002';
  end if;
  ws := s.starts_on + (wk - 1) * 7;
  select * into g from public.week_guides where week = wk;
  select * into lg from public.circle_logs where circle_id = p_circle and week = wk;

  return jsonb_build_object(
    'circle', jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity,
                                 'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI')),
    'state', state,
    'season_name', s.name,
    'starts_on', s.starts_on,
    'weeks', s.weeks,
    'current_week', case when state = 'running' then cw end,
    'week', wk,
    'week_starts_on', ws,
    'meeting_date', public.meeting_date_of(p_circle, wk),
    'can_edit', can_edit,
    -- the leader can log a week that has started until the end of the week after it; the office any time
    'log_open', (can_edit or office) and wk <= cw and (office or today <= ws + 13),
    'guide', jsonb_build_object(
      'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
      'opening_question', g.opening_question, 'questions', to_jsonb(g.questions), 'practice', g.practice,
      'step_hint', g.step_hint, 'prayer', g.prayer, 'plan', g.plan, 'leader_tip', g.leader_tip),
    'picture', jsonb_build_object(
      'god', coalesce(c.final_god, c.loving_god), 'others', coalesce(c.final_others, c.loving_others),
      'life', coalesce(c.final_life, c.loving_life), 'refined', c.picture_refined_at is not null,
      'can_refine', can_edit and state = 'running' and cw <= 2),
    'log', case when lg.circle_id is null then null else jsonb_build_object(
      'held', lg.held, 'highlight', lg.highlight, 'logged_at', lg.logged_at) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'first_name', public.first_name_of(m.person_id),
               'whatsapp', mp.whatsapp,
               'attendance', (select a.status from public.circle_attendance a
                               where a.circle_id = c.id and a.week = wk and a.person_id = m.person_id),
               'last_attendance', (select a.status from public.circle_attendance a
                                    where a.circle_id = c.id and a.person_id = m.person_id and a.week < wk
                                      and exists (select 1 from public.circle_logs l where l.circle_id = c.id and l.week = a.week and l.held)
                                    order by a.week desc limit 1),
               'attended', (select count(*) from public.circle_attendance a
                             where a.circle_id = c.id and a.person_id = m.person_id and a.status = 'present'),
               -- only whether the step was done, never what it was
               'step', (select coalesce(x.outcome, 'set') from public.week_steps x
                         where x.circle_id = c.id and x.person_id = m.person_id and x.week = wk),
               'open_follow_up', exists (select 1 from public.care_flags f
                                          where f.circle_id = c.id and f.person_id = m.person_id and f.status <> 'closed'))
             order by public.person_display_name(m.person_id))
        from public.circle_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
       where m.circle_id = c.id and m.status = 'active'), '[]'::jsonb),
    'logged_weeks', (select count(*) from public.circle_logs l where l.circle_id = c.id and l.held),
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'person_id', f.person_id, 'name', public.person_display_name(f.person_id),
               'first_name', public.first_name_of(f.person_id), 'whatsapp', mp.whatsapp,
               'kind', f.kind, 'status', f.status, 'attempts', f.attempts, 'last_outcome', f.last_outcome,
               'note', f.note, 'opened_at', f.opened_at, 'last_called_at', f.last_called_at)
             order by f.opened_at)
        from public.care_flags f
        left join public.member_profiles mp on mp.person_id = f.person_id
       where f.circle_id = c.id and f.status <> 'closed'), '[]'::jsonb),
    'celebrations', coalesce((
      select jsonb_agg(x order by (x ->> 'sort')::int, x ->> 'first_name')
        from (
          select jsonb_build_object('kind', 'birthday', 'first_name', public.first_name_of(m.person_id),
                   'on', d.d, 'sort', 1) as x
            from public.circle_members m
            join public.member_profiles mp on mp.person_id = m.person_id
            cross join lateral (select (ws + i)::date as d from generate_series(0, 6) as i) d
           where m.circle_id = c.id and m.status = 'active'
             and mp.birthday_month = extract(month from d.d)::int and mp.birthday_day = extract(day from d.d)::int
          union all
          select jsonb_build_object('kind', 'every_meeting', 'first_name', public.first_name_of(m.person_id), 'sort', 2)
            from public.circle_members m
           where m.circle_id = c.id and m.status = 'active'
             and (select count(*) from public.circle_logs l where l.circle_id = c.id and l.held and l.week < wk) >= 3
             and not exists (select 1 from public.circle_logs l
                              where l.circle_id = c.id and l.held and l.week < wk
                                and not exists (select 1 from public.circle_attendance a
                                                 where a.circle_id = c.id and a.week = l.week
                                                   and a.person_id = m.person_id and a.status = 'present'))
          union all
          select jsonb_build_object('kind', 'steps_streak', 'first_name', public.first_name_of(m.person_id), 'sort', 3)
            from public.circle_members m
           where m.circle_id = c.id and m.status = 'active' and wk >= 4
             and (select count(*) from public.week_steps x
                   where x.circle_id = c.id and x.person_id = m.person_id and x.outcome = 'done'
                     and x.week between wk - 3 and wk - 1) = 3
        ) q), '[]'::jsonb),
    'report', public.circle_week_report(p_circle, wk),
    'last_report', case when wk > 1 then public.circle_week_report(p_circle, wk - 1) end,
    'testimonies_waiting', (select count(*) from public.testimonies t where t.circle_id = c.id and t.status = 'submitted'));
end;
$$;

create function public.save_circle_log(p_circle uuid, p_week integer, p_held boolean, p_highlight text, p_attendance jsonb)
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
  ids uuid[];
  item jsonb;
  pid uuid;
  stat text;
  seen uuid[] := '{}';
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

  insert into public.circle_logs (circle_id, week, held, highlight, logged_by)
  values (p_circle, p_week, p_held, hl, uid)
  on conflict (circle_id, week)
  do update set held = excluded.held, highlight = excluded.highlight, logged_by = excluded.logged_by, updated_at = now();
  delete from public.circle_attendance where circle_id = p_circle and week = p_week;
  if p_held then
    insert into public.circle_attendance (circle_id, week, person_id, status)
    select p_circle, p_week, (e ->> 'person')::uuid, e ->> 'status' from jsonb_array_elements(p_attendance) e;
    perform public.flag_missed_twice(p_circle, p_week);
  end if;
  perform public.write_event(uid, 'circle.log', 'circle', p_circle::text,
    jsonb_build_object('week', p_week, 'held', p_held, 'office', office and not public.can_lead_circle(p_circle)));
  return public.circle_week_report(p_circle, p_week);
end;
$$;

create function public.record_call(p_flag uuid, p_outcome text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  f public.care_flags%rowtype;
  nt text := nullif(btrim(coalesce(p_note, '')), '');
  tries integer;
  next_status text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into f from public.care_flags where id = p_flag for update;
  if not found then
    raise exception 'That follow-up does not exist' using errcode = 'P0002';
  end if;
  if not (public.can_lead_circle(f.circle_id)
          or public.has_any_role(array['care_lead', 'pastor', 'director']::public.app_role[])) then
    raise exception 'You cannot record a call for this person' using errcode = '42501';
  end if;
  if f.status = 'closed' then
    raise exception 'That follow-up is already closed' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('reached', 'not_reached', 'needs_care_lead') then
    raise exception 'Choose how the call went' using errcode = '22023';
  end if;
  if nt is not null and char_length(nt) > 300 then
    raise exception 'Keep your note to 300 characters or fewer' using errcode = '22023';
  end if;
  tries := f.attempts + 1;
  next_status := case p_outcome
    when 'reached' then 'closed'
    when 'needs_care_lead' then 'escalated'
    else case when tries >= 3 then 'escalated' else f.status end end;
  update public.care_flags
     set attempts = tries, last_outcome = p_outcome, last_called_at = now(), status = next_status,
         note = coalesce(nt, note),
         closed_at = case when next_status = 'closed' then now() end,
         closed_by = case when next_status = 'closed' then uid end
   where id = p_flag;
  perform public.write_event(uid, 'care.call', 'care_flag', p_flag::text,
    jsonb_build_object('outcome', p_outcome, 'status', next_status));
end;
$$;

create function public.raise_concern(p_circle uuid, p_person uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  nt text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if uid is null or not public.can_lead_circle(p_circle) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  if not exists (select 1 from public.circle_members where circle_id = p_circle and person_id = p_person and status = 'active') then
    raise exception 'That person is not in your circle' using errcode = 'P0002';
  end if;
  if nt is not null and char_length(nt) > 300 then
    raise exception 'Keep your note to 300 characters or fewer' using errcode = '22023';
  end if;
  insert into public.care_flags (circle_id, person_id, kind, note, opened_by)
  values (p_circle, p_person, 'leader_concern', nt, uid)
  on conflict (person_id, circle_id, kind) where status <> 'closed' do nothing;
  perform public.write_event(uid, 'care.concern', 'circle', p_circle::text, '{}'::jsonb);
end;
$$;

create function public.refine_success_picture(p_circle uuid, p_god text, p_others text, p_life text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  s public.seasons%rowtype;
  cw integer;
  g text := btrim(coalesce(p_god, ''));
  o text := btrim(coalesce(p_others, ''));
  l text := btrim(coalesce(p_life, ''));
begin
  if uid is null or not public.can_lead_circle(p_circle) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, public.today_lagos());
  if cw < 1 or cw > 2 then
    raise exception 'The Success Picture is refined in the first two weeks of the season' using errcode = '22023';
  end if;
  if least(char_length(g), char_length(o), char_length(l)) < 10 then
    raise exception 'Write at least 10 characters for each line' using errcode = '22023';
  end if;
  if greatest(char_length(g), char_length(o), char_length(l)) > 200 then
    raise exception 'Keep each line to 200 characters or fewer' using errcode = '22023';
  end if;
  update public.circles
     set final_god = g, final_others = o, final_life = l, picture_refined_at = now(), picture_refined_by = uid
   where id = p_circle;
  perform public.write_event(uid, 'circle.picture_refined', 'circle', p_circle::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office: the weekly report and the care queue
-- ---------------------------------------------------------------------------

create function public.rhythm_digest(p_week integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.seasons%rowtype;
  today date := public.today_lagos();
  all_circles boolean := public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]);
  is_coach boolean := public.has_any_role(array['coach']::public.app_role[]);
  cw integer;
  wk integer;
  circle_rows jsonb;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (all_circles or is_coach) then
    raise exception 'Only the pastorate and coaches can see the weekly report' using errcode = '42501';
  end if;
  select * into s from public.seasons where starts_on <= today order by starts_on desc limit 1;
  if not found then
    return jsonb_build_object('state', 'none');
  end if;
  cw := public.season_week(s.starts_on, s.weeks, today);
  wk := least(coalesce(p_week, greatest(cw, 1)), s.weeks);
  if wk < 1 then
    wk := 1;
  end if;

  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into circle_rows
    from (
      select jsonb_build_object(
               'circle_id', c.id, 'name', c.name,
               'leader', public.person_display_name(c.leader_id),
               'coach', case when c.coach_id is null then null else public.person_display_name(c.coach_id) end,
               'report', public.circle_week_report(c.id, wk)) as x
        from public.circles c
       where c.season_id = s.id and c.status = 'approved'
         and exists (select 1 from public.circle_members m where m.circle_id = c.id and m.status = 'active')
         and (all_circles or c.coach_id = uid)) q;

  return jsonb_build_object(
    'state', case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end,
    'season_name', s.name, 'starts_on', s.starts_on, 'weeks', s.weeks,
    'current_week', case when cw between 1 and s.weeks then cw end,
    'week', wk,
    'circles', circle_rows,
    'totals', jsonb_build_object(
      'circles', jsonb_array_length(circle_rows),
      'logged', (select count(*) from jsonb_array_elements(circle_rows) r where (r -> 'report' ->> 'logged')::boolean),
      'not_logged', (select count(*) from jsonb_array_elements(circle_rows) r where r -> 'report' ->> 'status' = 'no_log'),
      'needs_attention', (select count(*) from jsonb_array_elements(circle_rows) r where r -> 'report' ->> 'status' = 'needs_attention'),
      'watch', (select count(*) from jsonb_array_elements(circle_rows) r where r -> 'report' ->> 'status' = 'watch'),
      'present', (select coalesce(sum((r -> 'report' ->> 'present')::int), 0) from jsonb_array_elements(circle_rows) r),
      'members', (select coalesce(sum((r -> 'report' ->> 'members')::int), 0)
                    from jsonb_array_elements(circle_rows) r where (r -> 'report' ->> 'held')::boolean),
      'follow_ups', (select coalesce(sum((r -> 'report' ->> 'follow_ups_open')::int), 0) from jsonb_array_elements(circle_rows) r)));
end;
$$;

create function public.care_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['care_lead', 'pastor', 'director', 'admin']::public.app_role[]) then
    raise exception 'Only the care team can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'name', public.person_display_name(f.person_id), 'whatsapp', mp.whatsapp,
               'circle', c.name, 'leader', public.person_display_name(c.leader_id),
               'kind', f.kind, 'status', f.status, 'attempts', f.attempts, 'last_outcome', f.last_outcome,
               'note', f.note, 'opened_at', f.opened_at, 'last_called_at', f.last_called_at)
             order by (f.status = 'escalated') desc, f.opened_at)
        from public.care_flags f
        join public.circles c on c.id = f.circle_id
        left join public.member_profiles mp on mp.person_id = f.person_id
       where f.status = 'escalated' or (f.status = 'open' and f.opened_at < now() - interval '3 days')), '[]'::jsonb),
    'open_total', (select count(*) from public.care_flags where status <> 'closed'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.week_guides enable row level security;
alter table public.week_steps enable row level security;
alter table public.circle_logs enable row level security;
alter table public.circle_attendance enable row level security;
alter table public.pulses enable row level security;
alter table public.care_flags enable row level security;
alter table public.testimonies enable row level security;
-- No grants: only the functions touch these tables.

revoke execute on function
  public.today_lagos(),
  public.season_week(date, integer, date),
  public.is_pulse_week(integer, integer),
  public.meeting_date_of(uuid, integer),
  public.current_placement(uuid),
  public.flag_missed_twice(uuid, integer),
  public.circle_week_report(uuid, integer),
  public.my_week(integer),
  public.save_week_step(integer, text, text),
  public.save_checkin(integer, text, text),
  public.save_pulse(integer, integer, integer, integer, integer, text),
  public.submit_testimony(text, text, text),
  public.withdraw_testimony(uuid),
  public.circle_testimonies(),
  public.review_testimony(uuid, text, text),
  public.pending_testimonies(),
  public.circle_week(uuid, integer),
  public.save_circle_log(uuid, integer, boolean, text, jsonb),
  public.record_call(uuid, text, text),
  public.raise_concern(uuid, uuid, text),
  public.refine_success_picture(uuid, text, text, text),
  public.rhythm_digest(integer),
  public.care_queue()
  from public, anon, authenticated;

grant execute on function
  public.my_week(integer),
  public.save_week_step(integer, text, text),
  public.save_checkin(integer, text, text),
  public.save_pulse(integer, integer, integer, integer, integer, text),
  public.submit_testimony(text, text, text),
  public.withdraw_testimony(uuid),
  public.circle_testimonies(),
  public.review_testimony(uuid, text, text),
  public.pending_testimonies(),
  public.circle_week(uuid, integer),
  public.save_circle_log(uuid, integer, boolean, text, jsonb),
  public.record_call(uuid, text, text),
  public.raise_concern(uuid, uuid, text),
  public.refine_success_picture(uuid, text, text, text),
  public.rhythm_digest(integer),
  public.care_queue()
  to authenticated;

-- =============================================================================
-- Package 6: the seat window (the 48-hour clock)
--
-- A seat the church placed and the member has not answered gets a clock. A reminder at hour 24, a last call at hour 40, and at the deadline (48 hours, rounded to
-- the next 9 am when it would end at night, and never less than 6 hours after the last call) the seat is released and offered at once to the best fit on the bench at
-- the bar or above. The member who lost the seat is told kindly and may take it back for 7 days. It is the blueprint's Part B, with Part A, C and D left to
-- their own packages. Every rule that protects a person is here and not on the screen.
--
-- Switch (Switchboard): 'seat_window', Off / Rehearsal / On, for the whole church, one community, one tribe or one person. It starts Off. In Rehearsal the clock
-- is kept and every step it would take is written down in the clock's log; nothing is sent and no seat moves. The Master pause stops it and keeps each clock's
-- remaining time. It cannot be moved to On while the heartbeat is late, the emails are failing, or automatic placement is not On.
--
-- What it adds
--   seat_window_settings   the numbers (window, reminder, last call, take-back days, offers in a row, most releases a day, the bar) and the day it starts counting
--   seat_clocks            one clock for each placed seat that has not been answered, with its exact deadline kept as a time (never recalculated)
--   seat_clock_log         what each clock did or, in Rehearsal, would have done
--   seat_chain             how many seats in a row were offered again for one place (three, then it is "Hard to fill")
--   seat_ledger            one append-only line for every seat taken, confirmed, released or left, written by a trigger so no code can forget it
--   guard                  a trigger on tribe_members that refuses a 13th active member whatever wrote it
--
-- Safety rules, all kept here:
--   * never released: someone who said yes or chose the seat, someone under 18, with a deletion request, a care follow-up, a stopped announcement or bouncing
--     email, a seat the office holds, a call asked for and not made; anyone while the Master pause is on; anything outside 9 am to 7 pm in Lagos
--   * a seat whose emails failed is "Not reached" and is never released; a deadline more than 2 hours overdue gives the member a fresh 12 hours, once
--   * breakers: more than a quarter of a tribe's seats, or more than the day's limit, or more than a quarter of the last 20 emails failing, and nothing is released
--   * only seats whose "Your tribe" email was sent after the day the owner sets (it starts as the day this file is applied) ever get a clock
--   * the seat window takes the place of the day-5 reminder and of the answer sequence for a seat it is timing; when the office keeps the seat, they resume
--   * nothing is sent on WhatsApp, and no phone number is in an email, a row or a log
--
-- This replaces one function, placed_seq_block (the old text is in the rollback file). It adds a trigger on feature_settings that refuses 'On' for this switch
-- while a check is red. Run it as the database owner, after Leader Desk Phase 2b-2 (20270119000100) is applied.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.placed_seq_block(uuid, uuid)') is null
     or to_regprocedure('public.placement_office_do(uuid, uuid, text[], text, boolean, boolean, text, uuid, text, uuid)') is null
     or to_regprocedure('public.feature_state_of(text, uuid, integer)') is null then
    raise exception 'Apply Package 6b (20270114000100_placed_answers.sql) and the office placement (20270109000100_office_placement.sql) before this file.';
  end if;
end
$guard$;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('seat_window', 'Seat window', 'Gives every seat the church placed a clock. A reminder at hour 24, a last call at hour 40, and at the deadline (48 hours, moved to the next 9 am if it would end at night) the seat is offered to the next best fit at 70% or more, and the member can take it back for 7 days. Members who said yes are never touched, and nor is anyone the church could not email. Adds Admin → People → Seats. Rehearsal writes down what each clock would do and sends nothing. Cannot be put On while the heartbeat is late, emails are failing or automatic placement is not On.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 33, false);

-- ---------------------------------------------------------------------------
-- The numbers
-- ---------------------------------------------------------------------------
create table public.seat_window_settings (
  id boolean primary key default true check (id),
  window_hours integer not null default 48 check (window_hours between 24 and 96),
  remind_hours integer not null default 24 check (remind_hours between 6 and 90),
  last_call_hours integer not null default 40 check (last_call_hours between 12 and 94),
  take_back_days integer not null default 7 check (take_back_days between 0 and 14),
  offers_in_row integer not null default 3 check (offers_in_row between 1 and 5),
  day_cap integer not null default 30 check (day_cap between 5 and 100),
  bar integer not null default 70 check (bar between 60 and 95),
  counted_from timestamptz not null default now(),
  paused boolean not null default false,
  paused_reason text check (char_length(paused_reason) <= 300),
  paused_at timestamptz,
  paused_by uuid references public.people (id) on delete set null,
  last_tick_at timestamptz,
  swept_at timestamptz,
  updated_at timestamptz not null default now(),
  check (remind_hours < last_call_hours and last_call_hours < window_hours)
);
insert into public.seat_window_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- The clock
-- ---------------------------------------------------------------------------
create table public.seat_clocks (
  id uuid primary key default gen_random_uuid(),
  tm_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  rehearsal boolean not null default false,
  -- running: counting. kept: the office stopped it. answered: the member said yes. released: the seat was offered on. ended: the seat went another way.
  state text not null default 'running' check (state in ('running', 'kept', 'answered', 'released', 'ended')),
  outcome text check (char_length(outcome) <= 60),
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  remind_at timestamptz not null,
  last_call_at timestamptz not null,
  remind_sent_at timestamptz,
  last_call_sent_at timestamptz,
  extended boolean not null default false,
  extended_by text check (extended_by in ('office', 'leader')),
  fresh_given boolean not null default false,
  chain integer not null default 1 check (chain between 1 and 20),
  frozen_at timestamptz,
  blocked_by text check (char_length(blocked_by) <= 40),
  kept_by uuid references public.people (id) on delete set null,
  kept_reason text check (char_length(kept_reason) <= 300),
  released_at timestamptz,
  retake_until timestamptz,
  front_of_line boolean not null default false,
  hard_to_fill boolean not null default false,
  replaced_by uuid references public.tribe_members (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index seat_clocks_one_running on public.seat_clocks (tm_id) where state = 'running' and not rehearsal;
create index seat_clocks_state_idx on public.seat_clocks (state, deadline_at) where state in ('running', 'kept');
create index seat_clocks_person_idx on public.seat_clocks (person_id);
create index seat_clocks_tribe_idx on public.seat_clocks (tribe_id, state);

create table public.seat_clock_log (
  id bigserial primary key,
  clock_id uuid not null references public.seat_clocks (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('start', 'remind', 'last_call', 'release', 'replace', 'no_bench', 'hard_to_fill', 'extend', 'keep', 'back', 'fresh_hours', 'blocked',
                                     'would_remind', 'would_last_call', 'would_release', 'would_replace', 'not_reached', 'breaker')),
  by_person uuid references public.people (id) on delete set null,
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) < 2000)
);
create index seat_clock_log_clock_idx on public.seat_clock_log (clock_id, id);

create table public.seat_chain (
  tm_id uuid primary key references public.tribe_members (id) on delete cascade,
  chain integer not null check (chain between 1 and 20)
);

create table public.seat_ledger (
  id bigserial primary key,
  at timestamptz not null default now(),
  tm_id uuid not null,
  person_id uuid not null,
  tribe_id uuid not null,
  kind text not null check (kind in ('taken', 'confirmed', 'released', 'left')),
  reason text check (char_length(reason) <= 300),
  actor uuid,
  via text not null default 'other' check (char_length(via) <= 40)
);
create index seat_ledger_tribe_idx on public.seat_ledger (tribe_id, id);
create index seat_ledger_person_idx on public.seat_ledger (person_id, id);

alter table public.seat_window_settings enable row level security;
alter table public.seat_clocks enable row level security;
alter table public.seat_clock_log enable row level security;
alter table public.seat_chain enable row level security;
alter table public.seat_ledger enable row level security;
revoke all on table public.seat_window_settings, public.seat_clocks, public.seat_clock_log, public.seat_chain, public.seat_ledger from public, anon, authenticated;

-- The ledger is append-only: nothing may change or remove a line.
create function public.seat_ledger_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The seat ledger is never changed' using errcode = '42501';
end;
$$;
create trigger seat_ledger_no_update before update or delete on public.seat_ledger for each row execute function public.seat_ledger_frozen();

-- ---------------------------------------------------------------------------
-- The guard in the table itself: no tribe ever holds a 13th active member, whatever code wrote it. The tribe's row is locked first, so two requests for the last
-- seat are handled one after the other.
-- ---------------------------------------------------------------------------
create function public.tribe_members_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.tribes t where t.id = new.tribe_id for update;
  if (select count(*) from public.tribe_members m where m.tribe_id = new.tribe_id and m.status = 'active' and m.id <> new.id) >= 12 then
    raise exception 'A tribe cannot hold more than 12 people' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger tribe_members_cap_guard_insert
  before insert on public.tribe_members
  for each row when (new.status = 'active')
  execute function public.tribe_members_cap_guard();
create trigger tribe_members_cap_guard_update
  before update of status, tribe_id on public.tribe_members
  for each row when (new.status = 'active' and (old.status is distinct from 'active' or old.tribe_id is distinct from new.tribe_id))
  execute function public.tribe_members_cap_guard();

-- ---------------------------------------------------------------------------
-- The ledger, written by a trigger so that every way a seat is taken or lost leaves a line, whoever wrote it
-- ---------------------------------------------------------------------------
create function public.seat_ledger_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via text := coalesce(nullif(current_setting('app.seat_via', true), ''), case when auth.uid() is null then 'system' else 'other' end);
begin
  if tg_op = 'INSERT' then
    insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
    values (new.id, new.person_id, new.tribe_id, 'taken', null, auth.uid(), v_via);
    if new.confirmed_at is not null or new.placement_source <> 'auto' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  else
    if new.status = 'released' and old.status = 'active' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, case when new.release_reason = 'No reply in time' then 'released' else 'left' end, left(new.release_reason, 300), auth.uid(), v_via);
    elsif new.status = 'active' and old.status = 'released' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'taken', 'Taken back', auth.uid(), v_via);
    elsif new.confirmed_at is not null and old.confirmed_at is null then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  end if;
  return null;
end;
$$;
create trigger seat_ledger_write
  after insert or update of status, confirmed_at on public.tribe_members
  for each row execute function public.seat_ledger_write();

-- ---------------------------------------------------------------------------
-- Who can see and act
-- ---------------------------------------------------------------------------
-- 'act' for the owner, an admin, a director or a pastor; 'look' for the data lead; nobody else
create function public.seat_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if public.is_god() or public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    return 'act';
  end if;
  if public.has_any_role(array['data_lead']::public.app_role[]) then
    return 'look';
  end if;
  return null;
end;
$$;

create function public.seat_need(p_act boolean)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.seat_role();
begin
  if v_role is null or (p_act and v_role <> 'act') then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Time: the 9 am to 7 pm window in Lagos
-- ---------------------------------------------------------------------------
-- The first moment at or after p_at that is inside 9 am to 7 pm in Lagos.
create function public.seat_open_at(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  l timestamp := p_at at time zone 'Africa/Lagos';
begin
  if l::time >= time '09:00' and l::time < time '19:00' then
    return p_at;
  elsif l::time < time '09:00' then
    return (l::date + time '09:00') at time zone 'Africa/Lagos';
  end if;
  return ((l::date + 1) + time '09:00') at time zone 'Africa/Lagos';
end;
$$;

create function public.seat_in_window()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.seat_open_at(now()) = now();
$$;

-- ---------------------------------------------------------------------------
-- The switch, as the rest of the system reads it
-- ---------------------------------------------------------------------------
create function public.seat_window_any()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when not exists (select 1 from public.feature_registry f where f.key = 'seat_window' and f.available) then 'off'
    when exists (select 1 from public.feature_settings s where s.feature = 'seat_window' and s.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings s where s.feature = 'seat_window' and s.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
$$;

-- Whether a seat that has a running (not Rehearsal) clock is being timed, so the answer sequence and the day-5 reminder leave it alone
create function public.seat_clock_block(p_tm uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.seat_clocks c where c.tm_id = p_tm and c.state = 'running' and not c.rehearsal) then 'seat_clock' end;
$$;

-- ---------------------------------------------------------------------------
-- Who is never released (the old text of placed_seq_block, kept as it was) and the answer sequence's new rule
-- ---------------------------------------------------------------------------
-- A reason a seat must not be released or written to: under 18, a deletion request, stopped announcements, bouncing email, a care follow-up, a "Stop these
-- reminders", a hold by the office, a call asked for and not made. Null when nothing stands in the way.
create function public.seat_never(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := public.message_blocker(p_person);
begin
  if public.is_minor(p_person) then
    return 'under18';
  end if;
  if v in ('deletion', 'under18') then
    return v;
  end if;
  if public.reminder_stopped(p_person, 'announcements') then
    return 'announcements_off';
  end if;
  if v in ('bounced', 'email_off') then
    return v;
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = p_person and f.status <> 'closed') then
    return 'care';
  end if;
  if exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'stop_reminders') then
    return 'stopped';
  end if;
  if exists (select 1 from public.placed_holds h where h.tm_id = p_tm and h.held_until > now()) then
    return 'held';
  end if;
  if public.placed_call_pending(p_tm) then
    return 'call_pending';
  end if;
  return null;
end;
$$;

-- Replaced function (the old text is in the rollback file): the answer sequence leaves a seat the seat window is timing
create or replace function public.placed_seq_block(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.seat_clock_block(p_tm) is not null then
    return 'seat_clock';
  end if;
  return public.seat_never(p_person, p_tm);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the emails did: sent, waiting to go, or failed
-- ---------------------------------------------------------------------------
create function public.seat_msg_state(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when m.status in ('sent', 'delivered', 'read') then 'sent'
                               when m.status in ('queued', 'sending') then 'pending'
                               else 'failed' end
                     from public.messages m where m.dedupe_key = p_key), 'none');
$$;

-- ---------------------------------------------------------------------------
-- The checks: is it safe to run, and has a breaker tripped
-- ---------------------------------------------------------------------------
-- Email: more than a quarter of the last 20 finished emails about seats failed (with at least 8 to judge by)
create function public.seat_email_breaker()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select count(*) >= 8 and count(*) filter (where q.status = 'failed') * 4 > count(*)
                     from (select m.status from public.messages m
                            where m.template in ('placement_your_tribe', 'placement_reminder', 'placed_seq', 'seat_reminder', 'seat_last_call', 'seat_released')
                              and m.status in ('sent', 'delivered', 'read', 'failed')
                            order by m.created_at desc limit 20) q), false);
$$;

create function public.seat_releases_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.seat_clock_log l join public.seat_clocks c on c.id = l.clock_id
   where l.kind = 'release' and not c.rehearsal and (l.at at time zone 'Africa/Lagos')::date = public.today_lagos();
$$;

-- The code of the breaker that stops a release in this tribe now, or null
create function public.seat_breaker(p_tribe uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
  v_cap integer;
  v_in_tribe integer;
begin
  select * into s from public.seat_window_settings x where x.id;
  if public.seat_email_breaker() then
    return 'email';
  end if;
  if public.seat_releases_today() >= s.day_cap then
    return 'day_cap';
  end if;
  select t.capacity into v_cap from public.tribes t where t.id = p_tribe;
  select count(*)::integer into v_in_tribe from public.seat_clock_log l join public.seat_clocks c on c.id = l.clock_id
   where l.kind = 'release' and not c.rehearsal and c.tribe_id = p_tribe and (l.at at time zone 'Africa/Lagos')::date = public.today_lagos();
  if (v_in_tribe + 1) * 4 > greatest(coalesce(v_cap, 0), 4) then
    return 'tribe_quarter';
  end if;
  return null;
end;
$$;

create function public.seat_breaker_words(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'email' then 'More than a quarter of the last 20 seat emails failed, so no seat is being released until the office has looked at it'
    when 'day_cap' then 'The most seats the church lets go of in one day has been reached'
    when 'tribe_quarter' then 'A quarter of this tribe''s seats have already been released today'
    else 'A safety limit is holding this release' end;
$$;

-- Everything the strip on the Seats page and the gate on the switch need, with no role check (the page's own function and the gate wrap it)
create function public.seat_health_core()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
  v_late boolean;
  v_problems text[] := '{}';
  v_sent integer;
  v_delivered integer;
  v_failed integer;
  v_over integer;
begin
  select * into s from public.seat_window_settings x where x.id;
  v_late := s.last_tick_at is null or s.last_tick_at < now() - interval '15 minutes';
  select count(*) filter (where m.status in ('sent', 'delivered', 'read')), count(*) filter (where m.status in ('delivered', 'read')), count(*) filter (where m.status = 'failed')
    into v_sent, v_delivered, v_failed
    from public.messages m
   where m.template in ('placement_your_tribe', 'placement_reminder', 'placed_seq', 'seat_reminder', 'seat_last_call', 'seat_released')
     and (m.created_at at time zone 'Africa/Lagos')::date = public.today_lagos();
  select count(*)::integer into v_over from public.tribes t
   where (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') > t.capacity;
  if v_late then
    v_problems := v_problems || 'The heartbeat has not beaten in the last 15 minutes'::text;
  end if;
  if public.placement_mode() <> 'on' then
    v_problems := v_problems || 'Automatic placement is not On, so a released seat could not be offered on'::text;
  end if;
  if public.seat_email_breaker() then
    v_problems := v_problems || public.seat_breaker_words('email');
  end if;
  return jsonb_build_object(
    'mode', public.seat_window_any(), 'placement_on', public.placement_mode() = 'on',
    'last_beat_at', s.last_tick_at, 'beat_late', v_late,
    'sent_today', v_sent, 'delivered_today', v_delivered, 'failed_today', v_failed, 'email_breaker', public.seat_email_breaker(),
    'releases_today', public.seat_releases_today(), 'day_cap', s.day_cap, 'over_capacity', v_over, 'paused', s.paused,
    'ok', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems));
end;
$$;

-- Putting the switch On is refused while a check is red, and says which one. Rehearsal and Off are never refused.
create function public.seat_window_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := public.seat_health_core();
begin
  if not (h ->> 'ok')::boolean then
    raise exception 'Seat window cannot be put On yet: %', (h -> 'problems' ->> 0) using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger seat_window_gate_insert
  before insert on public.feature_settings
  for each row when (new.feature = 'seat_window' and new.position = 'on')
  execute function public.seat_window_gate();
create trigger seat_window_gate_update
  before update on public.feature_settings
  for each row when (new.feature = 'seat_window' and new.position = 'on' and old.position is distinct from 'on')
  execute function public.seat_window_gate();

-- ---------------------------------------------------------------------------
-- The numbers: read by the owner's card, changed with a reason
-- ---------------------------------------------------------------------------
create function public.god_seat_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select * into s from public.seat_window_settings x where x.id;
  return jsonb_build_object('window_hours', s.window_hours, 'remind_hours', s.remind_hours, 'last_call_hours', s.last_call_hours, 'take_back_days', s.take_back_days,
    'offers_in_row', s.offers_in_row, 'day_cap', s.day_cap, 'bar', s.bar, 'counted_from', s.counted_from);
end;
$$;

create function public.god_seat_settings_set(p_window integer, p_remind integer, p_last_call integer, p_take_back integer, p_offers integer, p_day_cap integer, p_bar integer,
                                             p_include_days integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_window not between 24 and 96 or p_remind not between 6 and 90 or p_last_call not between 12 and 94 or p_take_back not between 0 and 14
     or p_offers not between 1 and 5 or p_day_cap not between 5 and 100 or p_bar not between 60 and 95 or (p_include_days is not null and p_include_days not between 0 and 30) then
    raise exception 'One of the numbers is outside its range' using errcode = '22023';
  end if;
  if not (p_remind < p_last_call and p_last_call < p_window) then
    raise exception 'The reminder must come before the last call, and the last call before the deadline' using errcode = '22023';
  end if;
  update public.seat_window_settings
     set window_hours = p_window, remind_hours = p_remind, last_call_hours = p_last_call, take_back_days = p_take_back, offers_in_row = p_offers, day_cap = p_day_cap, bar = p_bar,
         counted_from = case when p_include_days is null then counted_from else now() - make_interval(days => p_include_days) end, updated_at = now()
   where id;
  perform public.write_event(auth.uid(), 'seat_window.settings', 'seat_window', 'settings',
    jsonb_build_object('window', p_window, 'remind', p_remind, 'last_call', p_last_call, 'take_back', p_take_back, 'offers', p_offers, 'day_cap', p_day_cap, 'bar', p_bar,
                       'include_days', p_include_days, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- Stop every clock for a while, or let them run again. A clock keeps the time it had left.
create function public.seat_pause_set(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.seat_need(true);
  if coalesce(p_paused, false) and (v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300) then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if coalesce(p_paused, false) then
    update public.seat_window_settings set paused = true, paused_reason = v_reason, paused_at = now(), paused_by = auth.uid() where id;
  else
    update public.seat_window_settings set paused = false, paused_reason = null, paused_at = null, paused_by = null where id;
  end if;
  perform public.write_event(auth.uid(), 'seat_window.pause', 'seat_window', 'pause', jsonb_build_object('paused', coalesce(p_paused, false), 'reason', v_reason));
  return jsonb_build_object('ok', true, 'paused', coalesce(p_paused, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- The log, the mail and the clock's own keys
-- ---------------------------------------------------------------------------
create function public.seat_log(p_clock uuid, p_kind text, p_by uuid, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.seat_clock_log (clock_id, kind, by_person, detail) values (p_clock, p_kind, p_by, coalesce(p_detail, '{}'::jsonb));
$$;

-- The key an email of a clock is queued and looked up by. A last call sent again after more time was given, or after a fresh 12 hours, has its own.
create function public.seat_mail_key(p_clock uuid, p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'seat-' || p_kind || ':' || c.id::text
         || case when p_kind = 'last_call' and c.extended then ':x' else '' end
         || case when p_kind = 'last_call' and c.fresh_given then ':f' else '' end
    from public.seat_clocks c where c.id = p_clock;
$$;

-- The reminder (hour 24) and the last call (hour 40). In Rehearsal it is written down and nothing is queued.
create function public.seat_mail(p_clock uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  tm public.tribe_members%rowtype;
  s public.seat_window_settings%rowtype;
  v_params jsonb;
  v_link text;
  v_msg uuid;
begin
  select * into c from public.seat_clocks x where x.id = p_clock;
  select * into tm from public.tribe_members x where x.id = c.tm_id;
  select * into s from public.seat_window_settings x where x.id;
  if c.rehearsal then
    perform public.seat_log(c.id, case p_kind when 'remind' then 'would_remind' else 'would_last_call' end, null, jsonb_build_object('deadline_at', c.deadline_at));
  else
    v_params := public.placement_member_params(c.tribe_id, c.person_id, tm.degree) || jsonb_build_object('deadline_at', c.deadline_at, 'take_back_days', s.take_back_days);
    v_link := public.placement_token_mint(c.tm_id, c.person_id, 14);
    v_msg := public.enqueue_message(c.person_id, case p_kind when 'remind' then 'seat_reminder' else 'seat_last_call' end, v_params, c.tribe_id,
                                    public.seat_mail_key(c.id, p_kind), now(), 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
    end if;
    perform public.seat_log(c.id, p_kind, null, jsonb_build_object('deadline_at', c.deadline_at));
  end if;
  if p_kind = 'remind' then
    update public.seat_clocks set remind_sent_at = now() where id = c.id;
  else
    update public.seat_clocks set last_call_sent_at = now() where id = c.id;
  end if;
  return case when c.rehearsal then 'would_' || p_kind else p_kind end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Putting a seat on the clock: every seat the church placed whose "Your tribe" email has gone and who has not answered
-- ---------------------------------------------------------------------------
create function public.seat_clock_new(p_tm uuid, p_start timestamptz, p_rehearsal boolean, p_chain integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.seat_window_settings%rowtype;
  v_id uuid;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  select * into s from public.seat_window_settings x where x.id;
  insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, rehearsal, started_at, deadline_at, remind_at, last_call_at, chain)
  values (tm.id, tm.person_id, tm.tribe_id, tm.season_id, coalesce(p_rehearsal, false), p_start,
          public.seat_open_at(p_start + make_interval(hours => s.window_hours)),
          public.seat_open_at(p_start + make_interval(hours => s.remind_hours)),
          public.seat_open_at(p_start + make_interval(hours => s.last_call_hours)),
          greatest(coalesce(p_chain, 1), 1))
  returning id into v_id;
  perform public.seat_log(v_id, 'start', null, jsonb_build_object('rehearsal', coalesce(p_rehearsal, false)));
  -- The clock takes the place of the day-5 reminder for this seat: one that has not gone yet is withdrawn
  if not coalesce(p_rehearsal, false) then
    update public.messages set status = 'skipped', error = 'seat_window', reply_token = null
     where status = 'queued' and dedupe_key = 'placement-reminder:' || tm.id;
  end if;
  return v_id;
end;
$$;

create function public.seat_clock_sweep(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
  r record;
  v_mode text;
  v_n integer := 0;
begin
  select * into s from public.seat_window_settings x where x.id;
  for r in
    select tm.id as tm_id, tm.person_id, tm.placed_by_run, m.sent_at
      from public.tribe_members tm
      join public.messages m on m.dedupe_key = 'placement:' || tm.id::text and m.template = 'placement_your_tribe'
     where tm.status = 'active' and tm.placement_source = 'auto' and tm.confirmed_at is null
       and m.status in ('sent', 'delivered', 'read') and m.sent_at is not null and m.sent_at >= s.counted_from
       and not exists (select 1 from public.seat_clocks k where k.tm_id = tm.id and not k.rehearsal)
     order by m.sent_at
     limit p_limit * 3
  loop
    exit when v_n >= p_limit;
    v_mode := public.feature_state_of('seat_window', r.person_id);
    continue when v_mode not in ('on', 'rehearsal');
    continue when v_mode = 'rehearsal' and exists (select 1 from public.seat_clocks k where k.tm_id = r.tm_id and k.rehearsal);
    -- "They told me they agree": an office placement ticked so is a yes by the member's word, and has no clock
    continue when exists (select 1 from public.placement_items i where i.run_id = r.placed_by_run and i.person_id = r.person_id and i.agreed);
    continue when public.is_minor(r.person_id) or coalesce(public.message_blocker(r.person_id), '') in ('under18', 'deletion');
    perform public.seat_clock_new(r.tm_id, r.sent_at, v_mode = 'rehearsal', coalesce((select ch.chain from public.seat_chain ch where ch.tm_id = r.tm_id), 1));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- When a seat is answered or ends by any route, its clock ends with what happened to it
create function public.seat_clock_on_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.confirmed_at is not null and old.confirmed_at is null then
    update public.seat_clocks set state = 'answered', outcome = 'yes' where tm_id = new.id and state in ('running', 'kept');
  elsif new.status <> 'active' and old.status = 'active' then
    update public.seat_clocks set state = 'ended', outcome = 'left' where tm_id = new.id and state in ('running', 'kept');
  end if;
  return new;
end;
$$;
create trigger seat_clock_on_answer
  after update of confirmed_at, status on public.tribe_members
  for each row execute function public.seat_clock_on_answer();

-- ---------------------------------------------------------------------------
-- The bench: who a released seat is offered to. The best fit at the bar or above, front of the line first.
-- ---------------------------------------------------------------------------
create function public.seat_pick(p_tribe uuid, p_season uuid, p_exclude uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
  cand record;
  v_chk jsonb;
  v_deg integer;
  v_best uuid;
  v_best_deg integer := -1;
  v_best_front boolean := false;
begin
  select * into s from public.seat_window_settings x where x.id;
  for cand in
    select mp.person_id,
           coalesce((select bool_or(k.front_of_line) from public.seat_clocks k where k.person_id = mp.person_id and k.state = 'released' and k.retake_until > now()), false) as front
      from public.member_profiles mp
     where mp.person_id is distinct from p_exclude
       and (mp.season_id is null or mp.season_id = p_season)
       and not exists (select 1 from public.tribe_members x where x.person_id = mp.person_id and x.season_id = p_season and x.status = 'active')
       and not exists (select 1 from public.seat_clocks k where k.person_id = mp.person_id and not k.rehearsal and k.state in ('running', 'kept'))
       and not exists (select 1 from public.seat_clocks k where k.person_id = mp.person_id and k.tribe_id = p_tribe and k.state = 'released' and k.retake_until > now() and not k.front_of_line)
     order by 2 desc, mp.updated_at asc, mp.person_id
     limit 80
  loop
    continue when public.placement_pool_reason(cand.person_id, p_season, 7) is not null;
    begin
      v_chk := public.placement_check_core(cand.person_id, p_tribe, false, 'owner', null);
    exception when others then
      continue;
    end;
    continue when jsonb_array_length(v_chk -> 'blockers') > 0 or jsonb_array_length(v_chk -> 'warnings') > 0;
    v_deg := coalesce((v_chk ->> 'degree')::integer, 0);
    continue when v_deg < s.bar;
    if v_best is null or (cand.front and not v_best_front) or (cand.front = v_best_front and v_deg > v_best_deg) then
      v_best := cand.person_id;
      v_best_deg := v_deg;
      v_best_front := cand.front;
    end if;
  end loop;
  if v_best is null then
    return null;
  end if;
  return jsonb_build_object('person_id', v_best, 'degree', v_best_deg);
end;
$$;

-- Offers the seat that was just released to the next person. Within one heartbeat, inside the day's window.
create function public.seat_replace(p_clock uuid, p_rehearsal boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  s public.seat_window_settings%rowtype;
  t public.tribes%rowtype;
  v_pick jsonb;
  v_tm uuid;
begin
  select * into c from public.seat_clocks x where x.id = p_clock;
  select * into s from public.seat_window_settings x where x.id;
  select * into t from public.tribes x where x.id = c.tribe_id;
  if t.status <> 'approved' then
    perform public.seat_log(c.id, 'no_bench', null, jsonb_build_object('why', 'tribe_closed'));
    return 'tribe_closed';
  end if;
  if c.chain >= s.offers_in_row then
    update public.seat_clocks set hard_to_fill = true where id = c.id;
    perform public.seat_log(c.id, 'hard_to_fill', null, jsonb_build_object('offers', c.chain));
    return 'hard';
  end if;
  if public.placement_mode() <> 'on' then
    perform public.seat_log(c.id, 'no_bench', null, jsonb_build_object('why', 'placement_off'));
    return 'placement_off';
  end if;
  if not p_rehearsal and (select count(*) from public.tribe_members m where m.tribe_id = c.tribe_id and m.status = 'active') >= t.capacity then
    perform public.seat_log(c.id, 'no_bench', null, jsonb_build_object('why', 'full'));
    return 'full';
  end if;
  v_pick := public.seat_pick(c.tribe_id, c.season_id, c.person_id);
  if v_pick is null then
    perform public.seat_log(c.id, 'no_bench', null, jsonb_build_object('why', 'nobody_fits', 'bar', s.bar));
    return 'nobody';
  end if;
  if p_rehearsal then
    perform public.seat_log(c.id, 'would_replace', null, jsonb_build_object('degree', (v_pick ->> 'degree')::integer));
    return 'would_replace';
  end if;
  begin
    perform set_config('app.seat_via', 'seat-window', true);
    perform public.placement_office_do((v_pick ->> 'person_id')::uuid, c.tribe_id, '{}'::text[], null, false, false, 'owner', null, 'owner', null);
  exception when others then
    perform public.seat_log(c.id, 'no_bench', null, jsonb_build_object('why', 'could_not_place', 'error', left(sqlerrm, 120)));
    return 'failed';
  end;
  select m.id into v_tm from public.tribe_members m where m.person_id = (v_pick ->> 'person_id')::uuid and m.tribe_id = c.tribe_id and m.status = 'active';
  if v_tm is not null then
    insert into public.seat_chain (tm_id, chain) values (v_tm, c.chain + 1) on conflict (tm_id) do update set chain = excluded.chain;
    update public.seat_clocks set replaced_by = v_tm where id = c.id;
  end if;
  perform public.seat_log(c.id, 'replace', null, jsonb_build_object('degree', (v_pick ->> 'degree')::integer));
  return 'placed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Letting a seat go, kindly, and the way back
-- ---------------------------------------------------------------------------
create function public.seat_release_core(p_clock uuid, p_by uuid, p_via text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  tm public.tribe_members%rowtype;
  s public.seat_window_settings%rowtype;
  v_link text;
  v_msg uuid;
  v_params jsonb;
begin
  select * into c from public.seat_clocks x where x.id = p_clock for update;
  select * into tm from public.tribe_members x where x.id = c.tm_id for update;
  select * into s from public.seat_window_settings x where x.id;
  if not found or tm.status <> 'active' or tm.confirmed_at is not null or c.state <> 'running' then
    return false;
  end if;
  perform set_config('app.seat_via', p_via, true);
  update public.seat_clocks
     set state = 'released', outcome = case when p_by is null then 'no_reply' else 'by_office' end, released_at = now(), blocked_by = null,
         retake_until = case when s.take_back_days > 0 then now() + make_interval(days => s.take_back_days) end
   where id = c.id;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'No reply in time' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  perform public.seat_log(c.id, 'release', p_by, jsonb_build_object('via', p_via));
  v_params := public.placement_member_params(c.tribe_id, c.person_id, tm.degree) || jsonb_build_object('take_back_days', s.take_back_days);
  v_msg := public.enqueue_message(c.person_id, 'seat_released', v_params, c.tribe_id, 'seat-released:' || c.id::text, now(), 'normal', 'email');
  if v_msg is not null then
    v_link := public.placement_token_mint(tm.id, c.person_id, greatest(s.take_back_days, 1) + 1);
    update public.messages set reply_token = v_link where id = v_msg;
  end if;
  perform public.write_event(p_by, 'seat_window.release', 'tribe', c.tribe_id::text, jsonb_build_object('via', p_via, 'chain', c.chain));
  perform public.seat_replace(c.id, false);
  return true;
end;
$$;

-- Giving the seat back to the person it was released from: if it is still free (and they have not been seated elsewhere), they hold it again, as a seat waiting
-- for their yes, on a clock of its own. If it has gone, they go to the front of the line.
create function public.seat_take_back_core(p_clock uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  v_chk jsonb;
  v_new uuid;
  v_link text;
begin
  select * into c from public.seat_clocks x where x.id = p_clock for update;
  if not found or c.state <> 'released' or c.outcome = 'taken_back' or c.retake_until is null or c.retake_until <= now() then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select * into tm from public.tribe_members x where x.id = c.tm_id for update;
  select * into t from public.tribes x where x.id = c.tribe_id;
  v_chk := public.placement_check_core(c.person_id, c.tribe_id, false, 'owner', null);
  if tm.status <> 'released' or t.status <> 'approved'
     or (select count(*) from public.tribe_members m where m.tribe_id = c.tribe_id and m.status = 'active') >= t.capacity
     or exists (select 1 from public.tribe_members m where m.person_id = c.person_id and m.season_id = c.season_id and m.status = 'active')
     or exists (select 1 from jsonb_array_elements(v_chk -> 'blockers') b where b ->> 'code' not in ('held')) then
    update public.seat_clocks set front_of_line = true where id = c.id;
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  perform set_config('app.seat_via', 'take-back', true);
  update public.tribe_members set status = 'active', released_at = null, release_reason = null where id = tm.id;
  update public.seat_clocks set outcome = 'taken_back', retake_until = null where id = c.id;
  perform public.seat_log(c.id, 'back', p_by, '{}'::jsonb);
  v_new := public.seat_clock_new(tm.id, now(), false, c.chain);
  v_link := public.placement_token_mint(tm.id, c.person_id, 14);
  perform public.write_event(p_by, 'seat_window.back', 'tribe', c.tribe_id::text, jsonb_build_object('by_office', p_by is not null));
  return jsonb_build_object('ok', true, 'link', v_link, 'clock', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- One step of one clock, under its own lock. Returns what it did.
-- ---------------------------------------------------------------------------
create function public.seat_clock_step(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  s public.seat_window_settings%rowtype;
  tm public.tribe_members%rowtype;
  v_state text;
  v_never text;
  v_ready timestamptz;
  v_code text;
  v_shift interval;
  v_want text;
  k_rem text;
  k_last text;
begin
  select * into c from public.seat_clocks x where x.id = p_id and x.state = 'running' for update skip locked;
  if not found then
    return 'busy';
  end if;
  select * into s from public.seat_window_settings x where x.id;
  select * into tm from public.tribe_members x where x.id = c.tm_id;
  if not found or tm.status <> 'active' or tm.confirmed_at is not null then
    update public.seat_clocks set state = case when tm.confirmed_at is not null then 'answered' else 'ended' end, outcome = case when tm.confirmed_at is not null then 'yes' else 'left' end where id = c.id;
    return 'ended';
  end if;
  v_state := public.feature_state_of('seat_window', c.person_id);
  if c.rehearsal and v_state = 'on' then
    update public.seat_clocks set state = 'ended', outcome = 'rehearsal_over' where id = c.id;
    return 'ended';
  end if;
  -- Off, the Master pause, or the office's pause: the clock stops and keeps the time it had left
  v_want := case when c.rehearsal then 'rehearsal' else 'on' end;
  if v_state <> v_want or s.paused then
    if c.frozen_at is null then
      update public.seat_clocks set frozen_at = now() where id = c.id;
    end if;
    return 'frozen';
  end if;
  if c.frozen_at is not null then
    v_shift := now() - c.frozen_at;
    update public.seat_clocks
       set deadline_at = public.seat_open_at(deadline_at + v_shift), remind_at = public.seat_open_at(remind_at + v_shift), last_call_at = public.seat_open_at(last_call_at + v_shift), frozen_at = null
     where id = c.id returning * into c;
  end if;
  -- Someone who must never be released: written to nobody, released by nobody, until it clears
  v_never := public.seat_never(c.person_id, c.tm_id);
  if v_never is not null then
    if c.blocked_by is distinct from v_never then
      update public.seat_clocks set blocked_by = v_never where id = c.id;
      perform public.seat_log(c.id, 'blocked', null, jsonb_build_object('why', v_never));
    end if;
    return 'blocked';
  elsif c.blocked_by is not null and c.blocked_by not in ('email', 'day_cap', 'tribe_quarter') then
    update public.seat_clocks set blocked_by = null where id = c.id;
  end if;
  if not public.seat_in_window() then
    return 'waiting';
  end if;
  -- An email that failed puts the seat in "Not reached", never in "silent"
  k_rem := public.seat_mail_key(c.id, 'remind');
  k_last := public.seat_mail_key(c.id, 'last_call');
  if public.seat_msg_state('placement:' || tm.id::text) = 'failed' then
    if c.blocked_by is distinct from 'not_reached' then
      update public.seat_clocks set blocked_by = 'not_reached' where id = c.id;
      perform public.seat_log(c.id, 'not_reached', null, jsonb_build_object('email', 'your_tribe'));
    end if;
    return 'not_reached';
  end if;
  if c.remind_sent_at is null and now() >= c.remind_at then
    return public.seat_mail(c.id, 'remind');
  end if;
  if c.last_call_sent_at is null and now() >= c.last_call_at then
    return public.seat_mail(c.id, 'last_call');
  end if;
  if c.last_call_sent_at is null then
    return 'waiting';
  end if;
  -- The deadline, and at least 6 hours after the last call
  v_ready := greatest(c.deadline_at, c.last_call_sent_at + interval '6 hours');
  if now() < v_ready then
    return 'waiting';
  end if;
  if not c.rehearsal then
    if public.seat_msg_state(k_rem) = 'failed' or public.seat_msg_state(k_last) = 'failed' then
      if c.blocked_by is distinct from 'not_reached' then
        update public.seat_clocks set blocked_by = 'not_reached' where id = c.id;
        perform public.seat_log(c.id, 'not_reached', null, jsonb_build_object('email', 'notice'));
      end if;
      return 'not_reached';
    end if;
    if public.seat_msg_state(k_rem) = 'pending' or public.seat_msg_state(k_last) = 'pending' then
      return 'waiting';
    end if;
  end if;
  -- If the site missed its beats, nobody loses a seat because we were down: a fresh 12 hours, once, and a new last call
  if now() > v_ready + interval '2 hours' and not c.fresh_given then
    update public.seat_clocks
       set deadline_at = public.seat_open_at(now() + interval '12 hours'), last_call_at = now(), last_call_sent_at = null, fresh_given = true, blocked_by = null
     where id = c.id;
    perform public.seat_log(c.id, 'fresh_hours', null, jsonb_build_object('was_due', v_ready));
    return 'fresh_hours';
  end if;
  if c.rehearsal then
    perform public.seat_log(c.id, 'would_release', null, '{}'::jsonb);
    perform public.seat_replace(c.id, true);
    update public.seat_clocks set state = 'ended', outcome = 'would_release' where id = c.id;
    return 'would_release';
  end if;
  v_code := public.seat_breaker(c.tribe_id);
  if v_code is not null then
    if c.blocked_by is distinct from v_code then
      update public.seat_clocks set blocked_by = v_code where id = c.id;
      perform public.seat_log(c.id, 'breaker', null, jsonb_build_object('why', v_code));
    end if;
    return 'breaker';
  end if;
  perform public.seat_release_core(c.id, null, 'seat-window');
  return 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- The heartbeat
-- ---------------------------------------------------------------------------
create function public.seat_clock_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.seat_window_settings%rowtype;
  v_any text := public.seat_window_any();
  v_enrolled integer := 0;
  v_steps jsonb := '{}'::jsonb;
  r record;
  res text;
  v_told integer := 0;
  v_one integer;
begin
  update public.seat_window_settings set last_tick_at = now() where id;
  select * into s from public.seat_window_settings x where x.id;
  if v_any = 'off' and not exists (select 1 from public.seat_clocks k where k.state = 'running') then
    return jsonb_build_object('ran', false);
  end if;
  if v_any <> 'off' and not s.paused and (s.swept_at is null or s.swept_at < now() - interval '5 minutes') then
    update public.seat_window_settings set swept_at = now() where id;
    v_enrolled := public.seat_clock_sweep(200);
  end if;
  for r in select k.id from public.seat_clocks k where k.state = 'running' order by k.deadline_at limit 500 loop
    res := public.seat_clock_step(r.id);
    v_steps := jsonb_set(v_steps, array[res], to_jsonb(coalesce((v_steps ->> res)::integer, 0) + 1));
  end loop;
  -- A safety limit that held a release back is told to the office, once a day for each reason
  for r in select distinct k.blocked_by as code from public.seat_clocks k where k.state = 'running' and k.blocked_by in ('email', 'day_cap', 'tribe_quarter') loop
    begin
      select coalesce(sum(public.notify_role(x.id, array['admin', 'director'], 'admin_seat_stopped', 'seatstop:' || r.code || ':' || public.today_lagos()::text,
               jsonb_build_object('why', public.seat_breaker_words(r.code)), 'Seat releases are held by a safety limit', '/admin/seats', true, null)), 0)::integer
        into v_one from public.centres x where x.active;
      v_told := v_told + v_one;
    exception when others then
      perform public.notice_fault('seat_window', sqlerrm);
    end;
  end loop;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('seat_reminder', 'seat_last_call', 'seat_released')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  return jsonb_build_object('ran', true, 'enrolled', v_enrolled, 'steps', v_steps, 'told', v_told);
end;
$$;

create function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.seat_clock_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- More time: the office gives 48 hours once, and so may the tribe's leader (who knows who is travelling)
-- ---------------------------------------------------------------------------
create function public.seat_extend_core(p_clock uuid, p_by uuid, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  s public.seat_window_settings%rowtype;
  v_deadline timestamptz;
begin
  select * into c from public.seat_clocks x where x.id = p_clock for update;
  select * into s from public.seat_window_settings x where x.id;
  if not found or c.state <> 'running' or c.rehearsal then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;
  if c.extended then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  v_deadline := public.seat_open_at(greatest(c.deadline_at, now()) + interval '48 hours');
  update public.seat_clocks
     set deadline_at = v_deadline, extended = true, extended_by = p_who, blocked_by = case when blocked_by in ('email', 'day_cap', 'tribe_quarter') then null else blocked_by end,
         last_call_at = public.seat_open_at(greatest(now(), v_deadline - make_interval(hours => s.window_hours - s.last_call_hours))), last_call_sent_at = null
   where id = c.id;
  perform public.seat_log(c.id, 'extend', p_by, jsonb_build_object('by', p_who, 'deadline_at', v_deadline));
  perform public.write_event(p_by, 'seat_window.extend', 'tribe', c.tribe_id::text, jsonb_build_object('by', p_who));
  return jsonb_build_object('ok', true, 'deadline_at', v_deadline);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's side: a private link, no sign-in
-- ---------------------------------------------------------------------------
create function public.seat_link_clock(p_link text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return null;
  end if;
  select c.id into v
    from public.placement_tokens k join public.seat_clocks c on c.tm_id = k.placement_id and c.state = 'released'
   where k.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex') and k.expires_at > now()
   order by c.released_at desc limit 1;
  return v;
end;
$$;

-- Whether the seat could be taken back right now (nothing is changed)
create function public.seat_can_take_back(p_clock uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  v_chk jsonb;
begin
  select * into c from public.seat_clocks x where x.id = p_clock;
  if not found or c.state <> 'released' or c.outcome = 'taken_back' or c.retake_until is null or c.retake_until <= now() then
    return false;
  end if;
  select * into tm from public.tribe_members x where x.id = c.tm_id;
  select * into t from public.tribes x where x.id = c.tribe_id;
  v_chk := public.placement_check_core(c.person_id, c.tribe_id, false, 'owner', null);
  return tm.status = 'released' and t.status = 'approved'
     and (select count(*) from public.tribe_members m where m.tribe_id = c.tribe_id and m.status = 'active') < t.capacity
     and not exists (select 1 from public.tribe_members m where m.person_id = c.person_id and m.season_id = c.season_id and m.status = 'active')
     and not exists (select 1 from jsonb_array_elements(v_chk -> 'blockers') b where b ->> 'code' not in ('held'));
end;
$$;

create function public.worker_seat_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
  c public.seat_clocks%rowtype;
  t public.tribes%rowtype;
  v_state text;
begin
  perform public.worker_ok(p_token);
  v := public.seat_link_clock(p_link);
  if v is null then
    return jsonb_build_object('found', false);
  end if;
  select * into c from public.seat_clocks x where x.id = v;
  select * into t from public.tribes x where x.id = c.tribe_id;
  v_state := case when c.outcome = 'taken_back' then 'back'
                  when c.retake_until is null or c.retake_until <= now() then 'closed'
                  when public.seat_can_take_back(c.id) then 'free'
                  else 'gone' end;
  return jsonb_build_object('found', true, 'state', v_state, 'tribe', t.name, 'leader', public.first_name_of(t.leader_id), 'until', c.retake_until,
                            'first', public.first_name_of(c.person_id));
end;
$$;

create function public.worker_seat_take_back(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  perform public.worker_ok(p_token);
  v := public.seat_link_clock(p_link);
  if v is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  return public.seat_take_back_core(v, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office's board: Admin → People → Seats. Every count above the list is computed from the same rows as the list.
-- ---------------------------------------------------------------------------
create function public.seat_board_base(p_centre uuid, p_reh boolean)
returns table (clock_id uuid, tm_id uuid, person_id uuid, tribe_id uuid, tribe text, leader text, name text, flag text, hours_left numeric, hours_in numeric,
               deadline_at timestamptz, extended boolean, chain integer, retake_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.clock_id, q.tm_id, q.person_id, q.tribe_id, t.name, public.person_display_name(t.leader_id), public.person_display_name(q.person_id), q.flag,
         q.hours_left, q.hours_in, q.deadline_at, q.extended, q.chain, q.retake_until
    from (
      select c.id as clock_id, c.tm_id, c.person_id, c.tribe_id,
             case when c.state = 'running' and c.blocked_by = 'not_reached' then 'not_reached'
                  when c.state = 'running' and c.blocked_by is not null then 'blocked'
                  when c.state = 'running' then 'waiting'
                  when c.state = 'kept' then 'kept'
                  when c.state = 'released' and c.hard_to_fill then 'hard'
                  when c.state = 'released' and c.outcome <> 'taken_back' and c.retake_until > now() then 'released' end as flag,
             case when c.state = 'running' then greatest(0, extract(epoch from (c.deadline_at - now())) / 3600)::numeric end as hours_left,
             greatest(0, extract(epoch from (now() - c.started_at)) / 3600)::numeric as hours_in,
             c.deadline_at, c.extended, c.chain, c.retake_until
        from public.seat_clocks c
       where c.rehearsal = p_reh and c.state in ('running', 'kept', 'released')
      union all
      select null::uuid, tm.id, tm.person_id, tm.tribe_id, 'not_reached', null::numeric, greatest(0, extract(epoch from (now() - m.created_at)) / 3600)::numeric,
             null::timestamptz, false, 1, null::timestamptz
        from public.tribe_members tm
        join public.messages m on m.dedupe_key = 'placement:' || tm.id::text and m.template = 'placement_your_tribe' and m.status = 'failed'
       where tm.status = 'active' and tm.placement_source = 'auto' and tm.confirmed_at is null
         and m.created_at >= (select s.counted_from from public.seat_window_settings s where s.id)
         and not exists (select 1 from public.seat_clocks k where k.tm_id = tm.id and k.rehearsal = p_reh)
    ) q
    join public.tribes t on t.id = q.tribe_id
    join public.people p on p.id = q.person_id
   where q.flag is not null and (p_centre is null or p.centre_id = p_centre);
$$;

create function public.seat_board(p_filter text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.seat_need(false);
  v_centre uuid := public.my_centre();
  v_reh boolean := public.seat_window_any() <> 'on';
  v_filter text := case when p_filter in ('waiting', 'under24', 'kept', 'blocked', 'not_reached', 'released', 'hard') then p_filter end;
  v_tiles jsonb;
  v_rows jsonb;
  v_total integer;
begin
  select jsonb_build_object(
           'waiting', count(*) filter (where b.flag = 'waiting'),
           'under24', count(*) filter (where b.flag = 'waiting' and b.hours_left < 24),
           'kept', count(*) filter (where b.flag = 'kept'),
           'blocked', count(*) filter (where b.flag = 'blocked'),
           'not_reached', count(*) filter (where b.flag = 'not_reached'),
           'released', count(*) filter (where b.flag = 'released'),
           'hard', count(*) filter (where b.flag = 'hard'))
    into v_tiles from public.seat_board_base(v_centre, v_reh) b;
  select count(*)::integer into v_total from public.seat_board_base(v_centre, v_reh) b
   where v_filter is null or b.flag = v_filter or (v_filter = 'under24' and b.flag = 'waiting' and b.hours_left < 24);
  select coalesce(jsonb_agg(jsonb_build_object(
           'clock_id', x.clock_id, 'tm_id', x.tm_id, 'person_id', x.person_id, 'tribe', x.tribe, 'leader', x.leader, 'name', x.name, 'flag', x.flag,
           'hours_left', round(x.hours_left, 1), 'hours_in', round(x.hours_in, 1), 'deadline_at', x.deadline_at, 'extended', x.extended, 'chain', x.chain,
           'retake_until', x.retake_until) order by x.hours_left nulls last, x.name), '[]'::jsonb)
    into v_rows
    from (select * from public.seat_board_base(v_centre, v_reh) b
           where v_filter is null or b.flag = v_filter or (v_filter = 'under24' and b.flag = 'waiting' and b.hours_left < 24)
           order by b.hours_left nulls last, b.name
           limit greatest(least(coalesce(p_limit, 50), 200), 1) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('role', v_role, 'rehearsal', v_reh, 'health', public.seat_health_core(), 'tiles', v_tiles, 'total', v_total, 'filter', v_filter, 'rows', v_rows);
end;
$$;

-- What a clock did, newest first, for the office (never a number, never what a person typed)
create function public.seat_clock_history(p_clock uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.seat_need(false);
  return coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'by', case when l.by_person is null then null else public.person_display_name(l.by_person) end) order by l.id desc)
                     from (select * from public.seat_clock_log x where x.clock_id = p_clock order by x.id desc limit 30) l), '[]'::jsonb);
end;
$$;

create function public.seat_keep(p_clock uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  c public.seat_clocks%rowtype;
begin
  perform public.seat_need(true);
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  select * into c from public.seat_clocks x where x.id = p_clock for update;
  if not found or c.rehearsal then
    raise exception 'No such seat on the clock' using errcode = 'P0002';
  end if;
  if c.state = 'released' then
    raise exception 'That seat has already been offered to someone else. Use Give it back' using errcode = '22023';
  end if;
  if c.state <> 'running' then
    raise exception 'That seat is not on the clock any more' using errcode = '22023';
  end if;
  update public.seat_clocks set state = 'kept', kept_by = auth.uid(), kept_reason = v_reason where id = c.id;
  perform public.seat_log(c.id, 'keep', auth.uid(), '{}'::jsonb);
  perform public.write_event(auth.uid(), 'seat_window.keep', 'tribe', c.tribe_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.seat_extend(p_clock uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.seat_need(true);
  v := public.seat_extend_core(p_clock, auth.uid(), 'office');
  if not (v ->> 'ok')::boolean then
    raise exception '%', case v ->> 'reason' when 'already' then 'More time has already been given for this seat' else 'That seat is not on the clock' end using errcode = '22023';
  end if;
  return v;
end;
$$;

create function public.seat_release_now(p_clock uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  c public.seat_clocks%rowtype;
  v_never text;
begin
  perform public.seat_need(true);
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  select * into c from public.seat_clocks x where x.id = p_clock;
  if not found or c.rehearsal or c.state <> 'running' then
    raise exception 'That seat is not on the clock' using errcode = '22023';
  end if;
  if public.seat_window_any() <> 'on' then
    raise exception 'Seat window is not switched On' using errcode = '22023';
  end if;
  v_never := public.seat_never(c.person_id, c.tm_id);
  if v_never is not null then
    raise exception 'This seat cannot be released: %', case v_never
      when 'under18' then 'the member is under 18' when 'deletion' then 'the member has asked for their account to be deleted'
      when 'care' then 'a care follow-up is open' when 'held' then 'the office is holding it' when 'call_pending' then 'the member asked for a call'
      else 'the member cannot be written to' end using errcode = '22023';
  end if;
  if public.seat_msg_state('placement:' || c.tm_id::text) = 'failed' then
    raise exception 'This seat cannot be released: the first email never reached them' using errcode = '22023';
  end if;
  if not public.seat_release_core(c.id, auth.uid(), 'office') then
    raise exception 'That seat has already been answered' using errcode = '22023';
  end if;
  perform public.write_event(auth.uid(), 'seat_window.release_now', 'tribe', c.tribe_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.seat_give_back(p_clock uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.seat_need(true);
  v := public.seat_take_back_core(p_clock, auth.uid());
  if not (v ->> 'ok')::boolean then
    raise exception '%', case v ->> 'reason' when 'gone' then 'That seat has gone to someone else. They are first in line for the next one' else 'The time to give this seat back has passed' end using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Sends the three seat emails to the person asking, with an invented name, to see that email is working before anything goes to a member
create function public.seat_test_send()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_stamp text := extract(epoch from clock_timestamp())::bigint::text;
  v_n integer := 0;
  v_params jsonb := jsonb_build_object('tribe', 'Sample Tribe', 'leader_first', 'Ngozi', 'deadline_at', now() + interval '2 days', 'take_back_days', 7, 'sample', true,
                                       'meeting_day', 3, 'meeting_time', '20:00', 'mode', 'online', 'place_note', '', 'starts_on', public.today_lagos(), 'season', 'Season 1');
  t text;
begin
  perform public.seat_need(true);
  foreach t in array array['seat_reminder', 'seat_last_call', 'seat_released'] loop
    if public.enqueue_message(v_uid, t, v_params, null, 'seat-test:' || v_uid::text || ':' || v_stamp || ':' || t, now(), 'normal', 'email') is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  perform public.write_event(v_uid, 'seat_window.test_send', 'seat_window', 'test', jsonb_build_object('queued', v_n));
  return jsonb_build_object('ok', true, 'queued', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader's side: first names and where each seat stands, and one more 48 hours when they know someone is away
-- ---------------------------------------------------------------------------
create function public.seat_leader_strip(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tribes%rowtype;
  v_reh boolean := public.seat_window_any() <> 'on';
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found or auth.uid() is null or not (coalesce(auth.uid() = t.leader_id, false) or coalesce(auth.uid() = t.assistant_id, false) or public.seat_role() is not null) then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mode', public.seat_window_any(),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('clock_id', b.clock_id, 'first', public.first_name_of(b.person_id), 'flag', b.flag, 'hours_in', round(b.hours_in, 0),
                                                           'hours_left', round(b.hours_left, 0), 'extended', b.extended, 'deadline_at', b.deadline_at)
                                       order by b.hours_left nulls last)
                        from public.seat_board_base(null, v_reh) b where b.tribe_id = p_tribe and b.flag in ('waiting', 'blocked', 'released', 'kept')), '[]'::jsonb));
end;
$$;

create function public.seat_leader_more_time(p_clock uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.seat_clocks%rowtype;
  t public.tribes%rowtype;
  v jsonb;
begin
  select * into c from public.seat_clocks x where x.id = p_clock;
  select * into t from public.tribes x where x.id = c.tribe_id;
  if not found or auth.uid() is null or auth.uid() is distinct from t.leader_id then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  v := public.seat_extend_core(p_clock, auth.uid(), 'leader');
  if not (v ->> 'ok')::boolean then
    raise exception '%', case v ->> 'reason' when 'already' then 'More time has already been given for this seat' else 'That seat is not waiting on a clock' end using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.seat_ledger_frozen(), public.tribe_members_cap_guard(), public.seat_ledger_write(), public.seat_role(), public.seat_need(boolean), public.seat_open_at(timestamptz),
  public.seat_in_window(), public.seat_window_any(), public.seat_clock_block(uuid), public.seat_never(uuid, uuid), public.seat_msg_state(text), public.seat_email_breaker(),
  public.seat_releases_today(), public.seat_breaker(uuid), public.seat_breaker_words(text), public.seat_health_core(), public.seat_window_gate(), public.seat_log(uuid, text, uuid, jsonb),
  public.seat_mail_key(uuid, text), public.seat_mail(uuid, text), public.seat_clock_new(uuid, timestamptz, boolean, integer), public.seat_clock_sweep(integer),
  public.seat_clock_on_answer(), public.seat_pick(uuid, uuid, uuid), public.seat_replace(uuid, boolean), public.seat_release_core(uuid, uuid, text),
  public.seat_take_back_core(uuid, uuid), public.seat_clock_step(uuid), public.seat_clock_tick(), public.seat_extend_core(uuid, uuid, text), public.seat_link_clock(text),
  public.seat_can_take_back(uuid), public.seat_board_base(uuid, boolean)
  from public, anon, authenticated;

revoke execute on function
  public.god_seat_settings(), public.god_seat_settings_set(integer, integer, integer, integer, integer, integer, integer, integer, text), public.seat_pause_set(boolean, text),
  public.seat_board(text, integer, integer), public.seat_clock_history(uuid), public.seat_keep(uuid, text), public.seat_extend(uuid), public.seat_release_now(uuid, text),
  public.seat_give_back(uuid), public.seat_test_send(), public.seat_leader_strip(uuid), public.seat_leader_more_time(uuid)
  from public, anon;
grant execute on function
  public.god_seat_settings(), public.god_seat_settings_set(integer, integer, integer, integer, integer, integer, integer, integer, text), public.seat_pause_set(boolean, text),
  public.seat_board(text, integer, integer), public.seat_clock_history(uuid), public.seat_keep(uuid, text), public.seat_extend(uuid), public.seat_release_now(uuid, text),
  public.seat_give_back(uuid), public.seat_test_send(), public.seat_leader_strip(uuid), public.seat_leader_more_time(uuid)
  to authenticated;

revoke execute on function public.worker_seat_window_tick(text), public.worker_seat_info(text, text), public.worker_seat_take_back(text, text) from public, anon, authenticated;
grant execute on function public.worker_seat_window_tick(text), public.worker_seat_info(text, text), public.worker_seat_take_back(text, text) to anon;

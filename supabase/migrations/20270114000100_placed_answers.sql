-- =============================================================================
-- United Tribes: the placed-member answer sequence, the board and the call desk (Package 6b of "seats and contacts")
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), starting Off, Off / Rehearsal / On for the whole church, one
-- community, one tribe or one person:
--
--   Placed answer sequence   after the "Your tribe" email, each placed member who has not answered is written to by a short sequence, every email naming the
--                            day joining closes: 2a "Did this reach you?" (page not opened) or 2b "Anything stopping you?" (page opened), then 3 "Still held"
--                            every three days while more than two days remain, then 4 "Last call" a day before joining closes. It stops the moment the member
--                            answers. The private page gains three answers: "Not this season" (seat released, a reason chip, automatic placement leaves
--                            them alone for the season), "Call me" (morning, afternoon or evening: the seat stays held and the sequence waits for a person)
--                            and "Remind me tonight" (one extra email at 6 pm, once, the deadline never moves). It replaces the day-5 reminder for the
--                            members it covers. Step 1 is the existing placement email, unchanged.
--   The board                Admin -> People -> Placed members: a funnel (placed, emailed, page opened, answered, needs a call), one row for each placed
--                            member with the step they are on, a By tribe tab, an email-health strip, and Hold this seat / Mark called / Don't call.
--                            Every tile is a count of the rows it opens.
--   The call desk            the one screen that shows a number, for the admin and a director only: two lists (members who asked for a call, and members
--                            worth a call), numbers masked and revealed on tap with a log entry, an outcome for every call, at most three tries, calls
--                            8 am to 8 pm Lagos time, and a download with numbers behind an owner switch that starts Off.
--
-- Safety rules, all kept here and not on the screen:
--   * never in the sequence or on the desk: under 18s, a deletion request, a care follow-up, a seat whose member pressed "Stop these reminders" (sequence) or
--     "Don't call me" (desk), a member who pressed "Don't share my details" (desk), anyone who has answered; the sequence also skips people who stopped
--     announcements or whose email bounces, and a seat the office is holding
--   * pace: one email to a seat in any 20 hours, counted across the placement emails, the 6a nudge and this sequence; at most six sequence emails to a seat
--   * the weekly limit counts these emails (person_cap_ok knows them); only "Last call" and "Remind me tonight" may go beyond it
--   * emails go only between 9 am and 7 pm Lagos time; the Master pause holds everything; Rehearsal counts and writes down what it would send
--   * the member is checked again at the moment each email is made; an email never goes to someone who answered in between
--   * no number is ever put in an email, a message row or a log. A number leaves the database only in a desk reveal (logged without the number) and in the
--     desk download, and only for the admin and a director
--   * the sequence pauses itself when, after 50 or more have gone, more than 1 in 100 people stop announcements, more than 1 in 1,000 complain or more than
--     1 in 20 bounce, and tells the director and the admin; the office resumes it
--
-- What it never does: send anything on WhatsApp, tick WhatsApp for anyone, move or release a seat on its own (a seat is released only when the member or a
-- person at the desk says "not this season"), or change the wording of an existing message.
--
-- Replaced (the old text is in the rollback file): person_cap_ok, because it now counts the new emails against the weekly limit, and retry_message, so a failed
-- sequence email is tried again with a fresh private link.
-- Needs Package 6a (the placed nudge) applied first.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.placed_is_waiting(uuid)') is null or to_regprocedure('public.placed_email_at(uuid)') is null then
    raise exception 'Apply Package 6a (20270113000100_placed_nudge.sql) before this file.';
  end if;
end
$guard$;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('placed_answers', 'Placed answer sequence', 'After the placement email, writes to each placed member who has not answered: a short note at 24 hours, "Still held" every 3 days, and a last call a day before joining closes, each naming the day. The private page gains Not this season, Call me and Remind me tonight. Adds the Placed members board and the call desk in Admin. Rehearsal counts and writes down what would be sent. Nothing is sent on WhatsApp.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 31, false);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- The numbers behind the sequence, and the office's pause. One row.
create table public.placed_answers_settings (
  id boolean primary key default true check (id),
  -- Hours after the placement email before step 2
  second_after_hours smallint not null default 24 check (second_after_hours between 1 and 240),
  -- Days between "Still held" emails
  step3_days smallint not null default 3 check (step3_days between 1 and 14),
  -- "Last call" goes this many hours before joining closes
  last_call_hours smallint not null default 24 check (last_call_hours between 6 and 96),
  -- Hours between two emails to one seat, whatever sent them
  pace_hours smallint not null default 20 check (pace_hours between 1 and 72),
  -- Most sequence emails to one seat
  max_emails smallint not null default 6 check (max_emails between 2 and 10),
  -- Most tries at one phone call
  call_tries smallint not null default 3 check (call_tries between 1 and 6),
  -- The download of the call desk with numbers (owner's switch)
  numbers_download boolean not null default false,
  -- The office's pause for everyone, and the moment from which the self-stop counts again after a resume
  paused boolean not null default false,
  paused_reason text check (char_length(paused_reason) <= 300),
  paused_by uuid references public.people (id) on delete set null,
  paused_at timestamptz,
  counted_from timestamptz,
  swept_at timestamptz,
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.placed_answers_settings (id) values (true);
alter table public.placed_answers_settings enable row level security;
revoke all on table public.placed_answers_settings from public, anon, authenticated;

-- One row each time a placed seat is put in the sequence (a Rehearsal writes its own rows, which are retired when the switch moves to On).
create table public.placed_seq (
  id uuid primary key default gen_random_uuid(),
  tm_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid references public.tribes (id) on delete set null,
  season_id uuid references public.seasons (id) on delete set null,
  rehearsal boolean not null default false,
  status text not null default 'active' check (status in ('active', 'ended')),
  outcome text check (outcome in ('yes', 'other_tribe', 'not_this_season', 'stopped', 'left', 'not_eligible', 'deadline', 'office_yes', 'office_other_tribe', 'rehearsal_over')),
  started_at timestamptz not null default now(),
  sends smallint not null default 0,
  last_send_at timestamptz,
  -- "Remind me tonight": the moment of the one extra email, and whether it has gone
  remind_at timestamptz,
  remind_done boolean not null default false,
  ended_at timestamptz,
  check ((status = 'active') = (outcome is null))
);
create unique index placed_seq_one_active on public.placed_seq (tm_id, rehearsal) where status = 'active';
create index placed_seq_tm_idx on public.placed_seq (tm_id, started_at desc);
create index placed_seq_person_idx on public.placed_seq (person_id);
alter table public.placed_seq enable row level security;
revoke all on table public.placed_seq from public, anon, authenticated;

-- One row for each email of a sequence (or each line Rehearsal wrote). The message is the outbox's own row.
create table public.placed_seq_sends (
  id bigint generated always as identity primary key,
  seq_id uuid not null references public.placed_seq (id) on delete cascade,
  n smallint not null check (n between 1 and 12),
  step text not null check (step in ('2a', '2b', '3', '4', 'remind')),
  status text not null check (status in ('sent', 'would_send')),
  message_id uuid references public.messages (id) on delete set null,
  at timestamptz not null default now(),
  unique (seq_id, n)
);
create index placed_seq_sends_message_idx on public.placed_seq_sends (message_id);
alter table public.placed_seq_sends enable row level security;
revoke all on table public.placed_seq_sends from public, anon, authenticated;

-- What a member pressed on the private page, and what the desk recorded for them. A choice from short lists, never free text.
create table public.placed_answers (
  id bigint generated always as identity primary key,
  tm_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('not_this_season', 'call_me', 'remind_tonight', 'stop_reminders', 'dont_call')),
  reason text check (reason in ('timing', 'place', 'busy', 'different', 'other')),
  window_pref text check (window_pref in ('morning', 'afternoon', 'evening')),
  topic text check (topic in ('place', 'other_tribe')),
  created_at timestamptz not null default now()
);
create index placed_answers_tm_idx on public.placed_answers (tm_id, created_at desc);
create index placed_answers_kind_idx on public.placed_answers (kind, created_at desc);
alter table public.placed_answers enable row level security;
revoke all on table public.placed_answers from public, anon, authenticated;

-- Every call the desk recorded. Never the number, never the words.
create table public.placed_calls (
  id bigint generated always as identity primary key,
  tm_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  by_person uuid references public.people (id) on delete set null,
  outcome text not null check (outcome in ('yes', 'other_tribe', 'not_this_season', 'needs_time', 'no_answer', 'wrong_number', 'dont_call')),
  followup_on date,
  created_at timestamptz not null default now()
);
create index placed_calls_tm_idx on public.placed_calls (tm_id, id desc);
alter table public.placed_calls enable row level security;
revoke all on table public.placed_calls from public, anon, authenticated;

-- "Hold this seat": the office is dealing with this member, so the sequence waits.
create table public.placed_holds (
  tm_id uuid primary key references public.tribe_members (id) on delete cascade,
  held_until timestamptz not null,
  held_by uuid references public.people (id) on delete set null,
  reason text not null check (char_length(reason) between 5 and 300),
  held_at timestamptz not null default now()
);
alter table public.placed_holds enable row level security;
revoke all on table public.placed_holds from public, anon, authenticated;

-- A leader's one line to new members: "From Lara: ..." in the sequence emails. No links, no numbers.
alter table public.tribes add column if not exists seat_line text check (char_length(seat_line) <= 200);

-- "Not this season" holds a member out of automatic placement; the hold needs its own source.
alter table public.placement_holds drop constraint placement_holds_source_check;
alter table public.placement_holds add constraint placement_holds_source_check check (source in ('owner', 'removal', 'care', 'not_season'));

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------
create function public.placed_answers_cfg()
returns public.placed_answers_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s from public.placed_answers_settings s where s.id;
$$;

-- How far open the function is anywhere: 'on' if any rule opens it, else 'rehearsal' if any rule rehearses it, else 'off'. The Master pause makes it 'off'.
create function public.placed_answers_any()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when not exists (select 1 from public.feature_registry f where f.key = 'placed_answers' and f.available) then 'off'
    when exists (select 1 from public.feature_settings s where s.feature = 'placed_answers' and s.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings s where s.feature = 'placed_answers' and s.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
$$;

-- The day joining closes for a season (the last day a placed member may still choose), and the end of that day in Lagos.
create function public.placed_deadline_on(p_season uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select s.starts_on + (public.reminder_cfg()).joining_closes_days from public.seasons s where s.id = p_season;
$$;

create function public.placed_deadline_at(p_season uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((public.placed_deadline_on(p_season) + 1)::timestamp at time zone 'Africa/Lagos');
$$;

-- Has any private link for this seat been opened? (A mail scanner can open one, so this chooses wording and never excludes anyone.)
create function public.placed_page_opened(p_tm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.placement_tokens k where k.placement_id = p_tm and k.clicks > 0);
$$;

-- The last moment any email went (or was queued) to this seat: the placement email and its reminder, a 6a nudge, a sequence email. 'infinity' while the
-- placement email has not gone yet.
create function public.placed_last_email_at(p_tm uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(x.t), '-infinity'::timestamptz)
    from (
      select public.placed_email_at(p_tm) as t
      union all
      select max(m.sent_at) from public.messages m where m.dedupe_key = 'placement-reminder:' || p_tm and m.status in ('sent', 'delivered', 'read')
      union all
      select max(coalesce(n.sent_at, n.queued_at)) from public.placed_nudges n where n.tm_id = p_tm and n.status in ('queued', 'sent')
      union all
      select max(s.at) from public.placed_seq_sends s join public.placed_seq q on q.id = s.seq_id where q.tm_id = p_tm and not q.rehearsal
    ) x;
$$;

-- A member asked for a call and no one has tried yet. A pending call protects the seat and holds the sequence.
create function public.placed_call_pending(p_tm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.placed_answers a
                  where a.tm_id = p_tm and a.kind = 'call_me'
                    and a.created_at > coalesce((select max(c.created_at) from public.placed_calls c where c.tm_id = p_tm), '-infinity'::timestamptz));
$$;

-- The next 6 pm in Lagos: today's if it is before 6 pm, tomorrow's otherwise.
create function public.placed_remind_time()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.lagos_hour() < 18 then ((public.today_lagos())::timestamp + interval '18 hours') at time zone 'Africa/Lagos'
              else ((public.today_lagos() + 1)::timestamp + interval '18 hours') at time zone 'Africa/Lagos' end;
$$;

-- A number with its middle hidden, with the last four digits showing: +23480 •••• 4567. For the desk list.
create function public.placed_desk_mask(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null or char_length(p_phone) < 10 then null
              else left(p_phone, 6) || ' ' || repeat('•', greatest(char_length(p_phone) - 10, 2)) || ' ' || right(p_phone, 4) end;
$$;

-- Why the sequence must not write to this person right now, or null when it may.
--   under18, deletion              never written to
--   announcements_off, bounced, email_off   will not be emailed (the last two are listed "Email not reaching them")
--   care                            an open care follow-up: the sequence waits
--   stopped                         the member pressed "Stop these reminders"
--   held                            the office is holding this seat
--   call_pending                    the member asked for a call and no one has tried yet
create function public.placed_seq_block(p_person uuid, p_tm uuid)
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

-- What the email carries: the tribe card (as the placement email has it), the deadline, the leader's line, a reason the tribe fits, and honest progress.
-- Never a number, never another member's name.
create function public.placed_seq_params(p_tm uuid, p_step text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_why text[];
  v_answered integer;
  v_total integer;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  select * into t from public.tribes x where x.id = tm.tribe_id;
  select * into s from public.seasons x where x.id = tm.season_id;
  -- Why this tribe, for this member: only the reasons that are about the tribe's time and place, never faith or stage
  select coalesce(array(select r.k from public.match_recommendations m, unnest(m.reasons) with ordinality as r(k, o)
                         where m.run_id = tm.run_id and m.tribe_id = tm.tribe_id and m.person_id = tm.person_id
                           and r.k in ('rhythm_fit', 'place_same', 'place_near', 'place_online')
                         order by r.o limit 2), '{}') into v_why;
  select count(*)::integer, count(*) filter (where x.confirmed_at is not null or x.placement_source <> 'auto')::integer into v_total, v_answered
    from public.tribe_members x where x.tribe_id = tm.tribe_id and x.status = 'active';
  return public.placement_member_params(tm.tribe_id, tm.person_id, tm.degree) || jsonb_build_object(
    'step', p_step,
    'deadline', public.placed_deadline_on(tm.season_id)::text,
    'can_change', public.placement_change_open(s.starts_on),
    'leader_line', nullif(btrim(coalesce(t.seat_line, '')), ''),
    'why', to_jsonb(v_why),
    'answered', case when v_answered >= 3 and v_total >= 5 then v_answered end,
    'seats', case when v_answered >= 3 and v_total >= 5 then v_total end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The sequence: entering, each step, and the end
-- ---------------------------------------------------------------------------
create function public.placed_seq_end(p_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.placed_seq%rowtype;
begin
  update public.placed_seq x set status = 'ended', outcome = p_outcome, ended_at = now() where x.id = p_id and x.status = 'active' returning * into q;
  if found and not q.rehearsal then
    perform public.write_event(null, 'placed_answers.ended', 'person', q.person_id::text, jsonb_build_object('outcome', p_outcome, 'emails', q.sends));
  end if;
end;
$$;

-- Ends the sequence for a seat the moment something decisive happens to it (an answer, an office call).
create function public.placed_seq_end_for(p_tm uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select x.id from public.placed_seq x where x.tm_id = p_tm and x.status = 'active' and not x.rehearsal loop
    perform public.placed_seq_end(r.id, p_outcome);
  end loop;
end;
$$;

-- Puts one waiting seat in the sequence. A seat has one sequence for good: a member who stopped it, or finished it, is not put in again.
create function public.placed_seq_enrol(p_tm uuid, p_rehearsal boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  v_id uuid;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return null;
  end if;
  insert into public.placed_seq (tm_id, person_id, tribe_id, season_id, rehearsal)
  values (tm.id, tm.person_id, tm.tribe_id, tm.season_id, coalesce(p_rehearsal, false))
  on conflict do nothing
  returning id into v_id;
  -- The sequence takes the place of the day-5 reminder for this member: one that has not gone yet is withdrawn
  if v_id is not null and not coalesce(p_rehearsal, false) then
    update public.messages set status = 'skipped', error = 'sequence', reply_token = null
     where status = 'queued' and dedupe_key = 'placement-reminder:' || tm.id;
  end if;
  return v_id;
end;
$$;

-- Everyone waiting who can be written to and is not yet in: put them in (or in the Rehearsal). Not more than p_limit in one beat.
create function public.placed_seq_sweep(p_limit integer default 300)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  w record;
  v_state text;
  v_n integer := 0;
begin
  for c in select x.id from public.centres x where x.active loop
    for w in select * from public.placed_waiting_rows(c.id) loop
      exit when v_n >= p_limit;
      -- the cheap checks first
      continue when exists (select 1 from public.placed_seq q where q.tm_id = w.tm_id and not q.rehearsal);
      continue when exists (select 1 from public.placed_answers a where a.tm_id = w.tm_id and a.kind = 'stop_reminders');
      v_state := public.feature_state_of('placed_answers', w.person_id);
      continue when v_state not in ('on', 'rehearsal');
      continue when v_state = 'rehearsal' and exists (select 1 from public.placed_seq q where q.tm_id = w.tm_id and q.rehearsal);
      continue when public.is_minor(w.person_id) or coalesce(public.message_blocker(w.person_id), '') in ('under18', 'deletion');
      if public.placed_seq_enrol(w.tm_id, v_state = 'rehearsal') is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Sends email p_step of a sequence, or in Rehearsal writes down that it would have. Does not decide whether it should: placed_seq_step does.
create function public.placed_seq_send(p_id uuid, p_step text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.placed_seq%rowtype;
  v_n integer;
  v_link text;
  v_msg uuid;
begin
  select * into q from public.placed_seq x where x.id = p_id;
  v_n := q.sends + 1;
  if q.rehearsal then
    insert into public.placed_seq_sends (seq_id, n, step, status) values (q.id, v_n, p_step, 'would_send');
    update public.placed_seq set sends = v_n, last_send_at = now(), remind_done = remind_done or p_step = 'remind' where id = q.id;
    return 'would_send';
  end if;
  v_link := public.placement_token_mint(q.tm_id, q.person_id, 60);
  v_msg := public.enqueue_message(q.person_id, 'placed_seq', public.placed_seq_params(q.tm_id, p_step), q.tribe_id,
    'placed-seq:' || q.id::text || ':' || v_n::text, now(), 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
  end if;
  insert into public.placed_seq_sends (seq_id, n, step, status, message_id) values (q.id, v_n, p_step, 'sent', v_msg);
  update public.placed_seq set sends = v_n, last_send_at = now(), remind_done = remind_done or p_step = 'remind' where id = q.id;
  return 'sent';
end;
$$;

-- One step for one sequence, under its own lock. Returns what it did: busy, frozen, blocked, waiting, sent, would_send, ended.
create function public.placed_seq_step(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.placed_seq%rowtype;
  s public.placed_answers_settings%rowtype;
  tm public.tribe_members%rowtype;
  v_want text;
  v_state text;
  v_block text;
  v_end timestamptz;
  v_last timestamptz;
  v_step text;
  v_main_last timestamptz;
begin
  select * into q from public.placed_seq x where x.id = p_id and x.status = 'active' for update skip locked;
  if not found then
    return 'busy';
  end if;
  select * into s from public.placed_answers_settings x where x.id;
  v_want := case when q.rehearsal then 'rehearsal' else 'on' end;
  v_state := public.feature_state_of('placed_answers', q.person_id);
  -- A Rehearsal is over the moment the real thing is On
  if q.rehearsal and v_state = 'on' then
    perform public.placed_seq_end(q.id, 'rehearsal_over');
    return 'ended';
  end if;
  -- Off, the Master pause, or the office's pause: nothing is written. Every time is an exact moment, so nothing needs shifting when it resumes.
  if v_state <> v_want or s.paused then
    return 'frozen';
  end if;

  select * into tm from public.tribe_members x where x.id = q.tm_id;
  -- Is the seat still waiting? If not, the sequence ends with what happened to it
  if not public.placed_is_waiting(q.tm_id) then
    perform public.placed_seq_end(q.id, case
      when tm.id is null then 'left'
      when tm.confirmed_at is not null then 'yes'
      when tm.status = 'released' and tm.release_reason = 'Not this season' then 'not_this_season'
      when tm.status = 'released' and tm.release_reason = 'Chose to look at other tribes' then 'other_tribe'
      else 'left' end);
    return 'ended';
  end if;
  v_end := public.placed_deadline_at(tm.season_id);
  if now() >= v_end then
    perform public.placed_seq_end(q.id, 'deadline');
    return 'ended';
  end if;
  v_block := public.placed_seq_block(q.person_id, q.tm_id);
  if v_block in ('under18', 'deletion') then
    perform public.placed_seq_end(q.id, 'not_eligible');
    return 'ended';
  end if;
  if v_block = 'stopped' then
    perform public.placed_seq_end(q.id, 'stopped');
    return 'ended';
  end if;
  if v_block is not null then
    return 'blocked';
  end if;
  if not public.reach_window_ok() then
    return 'waiting';
  end if;

  -- "Remind me tonight": the one extra email the member asked for. It goes at its moment, once, and does not move the deadline.
  if q.remind_at is not null and not q.remind_done and now() >= q.remind_at then
    return public.placed_seq_send(q.id, 'remind');
  end if;
  if q.sends >= s.max_emails then
    return 'waiting';
  end if;
  -- Pace: one email to a seat in any 20 hours, whoever sent the last
  v_last := public.placed_last_email_at(q.tm_id);
  if v_last + make_interval(hours => s.pace_hours) > now() then
    return 'waiting';
  end if;

  select max(x.at) into v_main_last from public.placed_seq_sends x where x.seq_id = q.id and x.step in ('2a', '2b', '3');
  if not exists (select 1 from public.placed_seq_sends x where x.seq_id = q.id and x.step = '4') and now() >= v_end - make_interval(hours => s.last_call_hours) then
    v_step := '4';
  elsif exists (select 1 from public.placed_seq_sends x where x.seq_id = q.id and x.step = '4') then
    -- Last call has gone: nothing else follows it
    v_step := null;
  -- One place is always kept for Last call, so a long wait cannot use every email before it
  elsif q.sends + 1 >= s.max_emails then
    v_step := null;
  elsif not exists (select 1 from public.placed_seq_sends x where x.seq_id = q.id and x.step in ('2a', '2b'))
        and public.placed_email_at(q.tm_id) + make_interval(hours => s.second_after_hours) <= now() then
    v_step := case when public.placed_page_opened(q.tm_id) then '2b' else '2a' end;
  elsif exists (select 1 from public.placed_seq_sends x where x.seq_id = q.id and x.step in ('2a', '2b'))
        and v_end - now() > interval '2 days' and v_main_last + make_interval(days => s.step3_days) <= now() then
    v_step := '3';
  end if;
  if v_step is null then
    return 'waiting';
  end if;
  -- The weekly limit counts these emails. Only "Last call" may go beyond it, because it is the one that protects a seat.
  if v_step <> '4' and not public.person_cap_ok(q.person_id, 'announcement') then
    return 'waiting';
  end if;
  return public.placed_seq_send(q.id, v_step);
end;
$$;

-- The sequence pauses itself when, after 50 or more have gone, too many people stop announcements, complain or bounce. It tells the director and the admin.
create function public.placed_seq_selfcheck()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
  v_from timestamptz;
  v_sent integer;
  v_unsub integer;
  v_comp integer;
  v_bounce integer;
  v_why text;
begin
  select * into s from public.placed_answers_settings x where x.id for update;
  if s.paused then
    return false;
  end if;
  v_from := coalesce(s.counted_from, '-infinity'::timestamptz);
  select count(*)::integer into v_sent
    from public.placed_seq_sends x join public.placed_seq q on q.id = x.seq_id join public.messages m on m.id = x.message_id
   where not q.rehearsal and x.at >= v_from and m.status in ('sent', 'delivered', 'read');
  if v_sent < 50 then
    return false;
  end if;
  select count(*) filter (where e.kind = 'unsubscribe')::integer, count(*) filter (where e.kind = 'complaint')::integer, count(*) filter (where e.kind = 'hard_bounce')::integer
    into v_unsub, v_comp, v_bounce
    from public.email_signals e
   where e.created_at >= greatest(v_from, (select min(q.started_at) from public.placed_seq q where not q.rehearsal))
     and exists (select 1 from public.placed_seq q where q.person_id = e.person_id and not q.rehearsal and q.started_at <= e.created_at);
  if v_unsub * 100.0 / v_sent > 1 then
    v_why := format('%s people stopped announcements out of %s sent (more than 1 in 100).', v_unsub, v_sent);
  elsif v_comp * 1000.0 / v_sent > 1 then
    v_why := format('%s people marked this as spam out of %s sent (more than 1 in 1,000).', v_comp, v_sent);
  elsif v_bounce * 20.0 / v_sent > 1 then
    v_why := format('%s addresses bounced out of %s sent (more than 1 in 20).', v_bounce, v_sent);
  end if;
  if v_why is null then
    return false;
  end if;
  update public.placed_answers_settings set paused = true, paused_reason = left('Paused by itself: ' || v_why, 300), paused_by = null, paused_at = now() where id;
  perform public.write_event(null, 'placed_answers.self_paused', 'placed_answers', null, jsonb_build_object('unsubscribed', v_unsub, 'complaints', v_comp, 'bounces', v_bounce, 'sent', v_sent));
  perform public.signin_alert_staff('reminder_paused', jsonb_build_object('journey', 'Placed answer sequence', 'why', v_why),
    'pa:' || to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDDHH24'), array['director', 'admin']::public.app_role[]);
  return true;
end;
$$;

-- The heartbeat's step: put new people in, take every running sequence one step, check the health, and tidy. Off (and nothing running) it does nothing at all.
create function public.placed_seq_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
  v_paused boolean := coalesce((select m.paused from public.feature_master m where m.id), true);
  v_any boolean := exists (select 1 from public.feature_settings f where f.feature = 'placed_answers' and f.position in ('on', 'rehearsal'));
  v_active boolean := exists (select 1 from public.placed_seq e where e.status = 'active');
  v_enrolled integer := 0;
  v_steps jsonb := '{}'::jsonb;
  v_cleared integer := 0;
  v_stopped boolean := false;
  r record;
  res text;
begin
  if not v_active and (not v_any or v_paused) then
    return jsonb_build_object('ran', false);
  end if;
  select * into s from public.placed_answers_settings x where x.id;
  if v_any and not v_paused and not s.paused and (s.swept_at is null or s.swept_at < now() - interval '15 minutes') then
    update public.placed_answers_settings set swept_at = now() where id;
    v_enrolled := public.placed_seq_sweep(300);
  end if;
  for r in select e.id from public.placed_seq e where e.status = 'active' order by e.started_at limit 500 loop
    res := public.placed_seq_step(r.id);
    v_steps := jsonb_set(v_steps, array[res], to_jsonb(coalesce((v_steps ->> res)::integer, 0) + 1));
  end loop;
  v_stopped := public.placed_seq_selfcheck();
  update public.messages set reply_token = null
   where reply_token is not null and template = 'placed_seq'
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('ran', true, 'enrolled', v_enrolled, 'steps', v_steps, 'cleared', v_cleared, 'self_paused', v_stopped);
end;
$$;

create function public.worker_placed_seq_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.placed_seq_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced function (the old text is in the rollback file): the weekly limit now counts the sequence's emails too
-- ---------------------------------------------------------------------------
create or replace function public.person_cap_ok(p_person uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
begin
  if (select count(*) from public.messages m
       where m.person_id = p_person and m.template in ('reminder_email', 'office_message', 'placed_seq') and not (m.params ? 'test')
         and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_nonessential_week then
    return false;
  end if;
  if p_kind = 'reminder' then
    if (select count(*) from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_reminders_week then
      return false;
    end if;
    if s.cap_gap_days > 0 and exists (select 1 from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - make_interval(days => s.cap_gap_days) + interval '1 hour') then
      return false;
    end if;
  end if;
  return true;
end;
$$;

-- Replaced function (the old text is in the rollback file): trying a failed email again. The private link in a sequence email is wiped once the email is finished
-- with, so a retry makes a new one, and only for a seat that is still waiting.
create or replace function public.retry_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_template text;
  v_key text;
  v_person uuid;
  v_tm uuid;
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can retry a message' using errcode = '42501';
  end if;
  update public.messages
     set status = 'queued', tried = '{}', attempts = 0, error = null, scheduled_for = now(), provider_id = null
   where id = p_id and status in ('failed', 'skipped');
  if not found then
    raise exception 'Only a failed or skipped message can be tried again' using errcode = '22023';
  end if;
  -- The private link in a placement email is wiped once the email is finished with. A retry makes a new one, so the email goes out with its three buttons
  -- and not with the signed-in fallback.
  select m.template, m.dedupe_key, m.person_id into v_template, v_key, v_person from public.messages m where m.id = p_id;
  if v_template in ('placement_your_tribe', 'placement_reminder') and v_key ~ '^placement(-reminder)?:[0-9a-f-]{36}$' then
    v_tm := substring(v_key from '[0-9a-f-]{36}$')::uuid;
    if public.placed_is_waiting(v_tm) then
      update public.messages set reply_token = public.placement_token_mint(v_tm, v_person, 60) where id = p_id;
    end if;
  elsif v_template = 'placed_seq' and v_key ~ '^placed-seq:[0-9a-f-]{36}:[0-9]+$' then
    v_tm := (select q.tm_id from public.placed_seq q where q.id = substring(v_key from '^placed-seq:([0-9a-f-]{36}):')::uuid);
    if v_tm is not null and public.placed_is_waiting(v_tm) and public.placed_seq_block(v_person, v_tm) is null then
      update public.messages set reply_token = public.placement_token_mint(v_tm, v_person, 60) where id = p_id;
    else
      update public.messages set status = 'skipped', error = 'answered' where id = p_id;
    end if;
  end if;
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Two more logs: every number shown on the call desk, and every download. Never the number itself.
-- ---------------------------------------------------------------------------
create table public.placed_reveals (
  id bigint generated always as identity primary key,
  tm_id uuid references public.tribe_members (id) on delete set null,
  person_id uuid references public.people (id) on delete set null,
  by_person uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index placed_reveals_by_idx on public.placed_reveals (by_person, created_at desc);
alter table public.placed_reveals enable row level security;
revoke all on table public.placed_reveals from public, anon, authenticated;

create table public.placed_downloads (
  id bigint generated always as identity primary key,
  by_person uuid references public.people (id) on delete set null,
  row_count integer not null,
  created_at timestamptz not null default now()
);
alter table public.placed_downloads enable row level security;
revoke all on table public.placed_downloads from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The desk's rules: who may be called, and when
-- ---------------------------------------------------------------------------
-- Tries at one phone call: "no answer" since the member last asked for a call (or ever, if they never did).
create function public.placed_call_tries(p_tm uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.placed_calls c
   where c.tm_id = p_tm and c.outcome = 'no_answer'
     and c.created_at > coalesce((select max(a.created_at) from public.placed_answers a where a.tm_id = p_tm and a.kind = 'call_me'), '-infinity'::timestamptz);
$$;

-- Calls are made between 8 am and 8 pm in Lagos.
create function public.placed_calls_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.lagos_hour() >= 8 and public.lagos_hour() < 20;
$$;

-- Is this the time of day the member chose? Nothing chosen means any time in call hours.
create function public.placed_in_window(p_window text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_window
    when 'morning' then public.lagos_hour() >= 8 and public.lagos_hour() < 12
    when 'afternoon' then public.lagos_hour() >= 12 and public.lagos_hour() < 17
    when 'evening' then public.lagos_hour() >= 17 and public.lagos_hour() < 20
    else public.placed_calls_ok() end;
$$;

-- Is this seat on the call desk? One answer for the desk, the board and every action, so none of them can disagree.
--   asked   the member pressed "Call me" and nothing since has settled it
--   worth   the member has had a sequence email (so they were told the office may call), has a number, and has not answered
--   null    not on the desk
-- Never: not waiting, under 18, deletion, a care follow-up, "Don't share my details", "Don't call me", a settled call, three tries, a wrong number, a
-- follow-up date that has not come, or no number we can use. "Worth" also leaves out anyone who stopped these reminders or stopped announcements.
create function public.placed_desk_state(p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.placed_answers_settings%rowtype;
  v_last record;
  v_req timestamptz;
  v_blocker text;
  v_told boolean;
begin
  if not public.placed_is_waiting(p_tm) then
    return null;
  end if;
  select * into tm from public.tribe_members x where x.id = p_tm;
  select * into s from public.placed_answers_settings x where x.id;
  if tm.contact_withheld or public.is_minor(tm.person_id) then
    return null;
  end if;
  v_blocker := public.message_blocker(tm.person_id);
  if v_blocker in ('deletion', 'under18') then
    return null;
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = tm.person_id and f.status <> 'closed') then
    return null;
  end if;
  if exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'dont_call') then
    return null;
  end if;
  v_req := (select max(a.created_at) from public.placed_answers a where a.tm_id = p_tm and a.kind = 'call_me');
  select c.outcome, c.created_at, c.followup_on into v_last from public.placed_calls c where c.tm_id = p_tm order by c.id desc limit 1;
  if found and (v_req is null or v_last.created_at > v_req) then
    if v_last.outcome in ('yes', 'other_tribe', 'not_this_season', 'wrong_number', 'dont_call') then
      return null;
    end if;
    if v_last.outcome = 'needs_time' and v_last.followup_on is not null and v_last.followup_on > public.today_lagos() then
      return null;
    end if;
  end if;
  if public.placed_call_tries(p_tm) >= s.call_tries then
    return null;
  end if;
  if public.placed_held_number(tm.person_id) is null then
    return null;
  end if;
  if v_req is not null then
    return 'asked';
  end if;
  v_told := exists (select 1 from public.placed_seq_sends x join public.placed_seq q on q.id = x.seq_id join public.messages m on m.id = x.message_id
                     where q.tm_id = p_tm and not q.rehearsal and m.status in ('sent', 'delivered', 'read'));
  if v_told
     and not exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'stop_reminders')
     and not public.reminder_stopped(tm.person_id, 'announcements') then
    return 'worth';
  end if;
  return null;
end;
$$;

-- Releases a seat for "not this season", for the member or for a person at the desk. The seat is given up, automatic placement leaves the member alone until
-- the season is over, and the sequence ends. Nothing else moves.
create function public.placed_do_not_season(p_tm uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.seasons%rowtype;
begin
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' or tm.confirmed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select * into s from public.seasons x where x.id = tm.season_id;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Not this season' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  update public.messages set status = 'skipped', error = 'not_this_season', reply_token = null
   where status = 'queued' and (dedupe_key in ('placement:' || tm.id, 'placement-reminder:' || tm.id, 'placement-withheld:' || tm.id)
                                or (template = 'placed_seq' and person_id = tm.person_id));
  insert into public.placement_holds (person_id, note, until, source)
  values (tm.person_id, null, ((s.starts_on + s.weeks * 7)::timestamp at time zone 'Africa/Lagos'), 'not_season')
  on conflict (person_id) do update set until = excluded.until, source = 'not_season', created_at = now()
   where public.placement_holds.source <> 'owner';
  perform public.write_event(tm.person_id, 'placed_answers.not_this_season', 'tribe', tm.tribe_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- However a seat stops waiting (the member answers on any page, the office moves them, a call settles it), the sequence ends and any email of it still waiting to
-- go is withdrawn. This is what makes "an email never goes to someone who has answered" true for every route, not only the new page.
create function public.placed_seq_on_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_outcome text;
begin
  if new.confirmed_at is not null and old.confirmed_at is null then
    v_outcome := 'yes';
  elsif new.status <> 'active' and old.status = 'active' then
    v_outcome := case new.release_reason when 'Not this season' then 'not_this_season' when 'Chose to look at other tribes' then 'other_tribe' else 'left' end;
  else
    return new;
  end if;
  update public.messages set status = 'skipped', error = 'answered', reply_token = null
   where status = 'queued' and template = 'placed_seq' and person_id = new.person_id;
  for r in select q.id from public.placed_seq q where q.tm_id = new.id and q.status = 'active' loop
    perform public.placed_seq_end(r.id, v_outcome);
  end loop;
  return new;
end;
$$;

create trigger placed_seq_on_answer
  after update of confirmed_at, status on public.tribe_members
  for each row execute function public.placed_seq_on_answer();

-- ---------------------------------------------------------------------------
-- The member's side: the private page, with no sign-in
-- ---------------------------------------------------------------------------
-- What the page needs to show the new answers. Nothing is offered unless the function is On for this member and the seat is still waiting.
create function public.worker_placed_answers_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
  v_closed boolean;
  v_remind timestamptz;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('on', false);
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  if not public.placed_is_waiting(v_tm) or public.is_minor(tm.person_id)
     or coalesce(public.message_blocker(tm.person_id), '') in ('under18', 'deletion')
     or public.feature_state_of('placed_answers', tm.person_id) <> 'on' then
    return jsonb_build_object('on', false);
  end if;
  v_closed := now() >= public.placed_deadline_at(tm.season_id);
  v_remind := public.placed_remind_time();
  return jsonb_build_object('on', true,
    'deadline', public.placed_deadline_on(tm.season_id)::text,
    'closed', v_closed,
    'can_change', public.placement_change_open((select s.starts_on from public.seasons s where s.id = tm.season_id)),
    'call_pending', public.placed_call_pending(v_tm),
    'call_window', (select a.window_pref from public.placed_answers a where a.tm_id = v_tm and a.kind = 'call_me' order by a.id desc limit 1),
    'remind_set', exists (select 1 from public.placed_answers a where a.tm_id = v_tm and a.kind = 'remind_tonight'),
    'remind_possible', not v_closed and v_remind < public.placed_deadline_at(tm.season_id),
    -- after 6 pm the one reminder goes at 6 pm the next day: the page says "tomorrow" instead of "tonight"
    'remind_tomorrow', v_remind::timestamptz >= ((public.today_lagos() + 1)::timestamp at time zone 'Africa/Lagos'),
    'stopped', exists (select 1 from public.placed_answers a where a.tm_id = v_tm and a.kind = 'stop_reminders'),
    'number', public.reach_mask(public.placed_held_number(tm.person_id)),
    'withheld', tm.contact_withheld);
end;
$$;

-- One answer from the page. A choice from short lists; nothing typed except a number for "Call me" when we hold none.
--   not_this_season   gives up the seat, with an optional reason chip. Open until the season closes.
--   call_me           the seat stays held; a time of day (morning, afternoon, evening) and, after joining closes, a topic. Needs a number we can use.
--   remind_tonight    one extra email at 6 pm, once for the seat; it never moves the deadline
--   stop_reminders    ends the sequence (the seat is not touched)
--   dont_call         the office will not phone this member
-- The first three need the function On for the member. The last two are kept whatever the switch says.
create function public.worker_placed_answer(p_token text, p_link text, p_kind text, p_reason text, p_window text, p_topic text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
  v_state text;
  v_closed boolean;
  v_at timestamptz;
  v_seq uuid;
  v_res jsonb;
begin
  perform public.worker_ok(p_token);
  if p_kind is null or p_kind not in ('not_this_season', 'call_me', 'remind_tonight', 'stop_reminders', 'dont_call')
     or (p_reason is not null and p_reason not in ('timing', 'place', 'busy', 'different', 'other'))
     or (p_window is not null and p_window not in ('morning', 'afternoon', 'evening'))
     or (p_topic is not null and p_topic not in ('place', 'other_tribe')) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm for update;
  if public.is_minor(tm.person_id) or coalesce(public.message_blocker(tm.person_id), '') in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if not public.placed_is_waiting(v_tm) then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  v_state := public.feature_state_of('placed_answers', tm.person_id);
  if p_kind in ('not_this_season', 'call_me', 'remind_tonight') and v_state <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  v_closed := now() >= public.placed_deadline_at(tm.season_id);

  if p_kind = 'not_this_season' then
    v_res := public.placed_do_not_season(v_tm);
    if (v_res ->> 'ok')::boolean is not true then
      return v_res;
    end if;
    insert into public.placed_answers (tm_id, person_id, kind, reason) values (v_tm, tm.person_id, 'not_this_season', p_reason);
    return jsonb_build_object('ok', true, 'kind', p_kind);

  elsif p_kind = 'call_me' then
    if public.placed_call_pending(v_tm) then
      return jsonb_build_object('ok', true, 'kind', p_kind, 'again', true);
    end if;
    -- A number for the call: the one typed, else the one we hold. A number that does not look right stops the request, and nothing is saved.
    if nullif(btrim(coalesce(p_phone, '')), '') is not null then
      perform public.reach_apply_number(tm.person_id, p_phone, false, false);
    elsif public.placed_held_number(tm.person_id) is null then
      raise exception 'Write your number with its country code, like +2348031234567' using errcode = '22023';
    end if;
    insert into public.placed_answers (tm_id, person_id, kind, window_pref, topic)
    values (v_tm, tm.person_id, 'call_me', p_window, case when v_closed then coalesce(p_topic, 'other_tribe') else coalesce(p_topic, 'place') end);
    perform public.write_event(tm.person_id, 'placed_answers.call_me', 'tribe', tm.tribe_id::text, jsonb_build_object('window', p_window));
    return jsonb_build_object('ok', true, 'kind', p_kind, 'window', p_window);

  elsif p_kind = 'remind_tonight' then
    if v_closed then
      return jsonb_build_object('ok', false, 'reason', 'closed');
    end if;
    if exists (select 1 from public.placed_answers a where a.tm_id = v_tm and a.kind = 'remind_tonight') then
      return jsonb_build_object('ok', true, 'kind', p_kind, 'again', true);
    end if;
    v_at := public.placed_remind_time();
    if v_at >= public.placed_deadline_at(tm.season_id) then
      return jsonb_build_object('ok', false, 'reason', 'too_late');
    end if;
    -- The reminder rides on the member's sequence; a member the sweep has not reached yet is put in now
    select q.id into v_seq from public.placed_seq q where q.tm_id = v_tm and not q.rehearsal and q.status = 'active';
    if v_seq is null and not exists (select 1 from public.placed_seq q where q.tm_id = v_tm and not q.rehearsal) then
      v_seq := public.placed_seq_enrol(v_tm, false);
    end if;
    if v_seq is null then
      return jsonb_build_object('ok', false, 'reason', 'not_active');
    end if;
    update public.placed_seq set remind_at = v_at where id = v_seq;
    insert into public.placed_answers (tm_id, person_id, kind) values (v_tm, tm.person_id, 'remind_tonight');
    return jsonb_build_object('ok', true, 'kind', p_kind);

  elsif p_kind = 'stop_reminders' then
    if not exists (select 1 from public.placed_answers a where a.tm_id = v_tm and a.kind = 'stop_reminders') then
      insert into public.placed_answers (tm_id, person_id, kind) values (v_tm, tm.person_id, 'stop_reminders');
      update public.messages set status = 'skipped', error = 'stopped', reply_token = null
       where status = 'queued' and (dedupe_key = 'placement-reminder:' || v_tm or (template = 'placed_seq' and person_id = tm.person_id));
      perform public.placed_seq_end_for(v_tm, 'stopped');
      perform public.write_event(tm.person_id, 'placed_answers.stopped', 'tribe', tm.tribe_id::text, '{}'::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'kind', p_kind);

  else
    if not exists (select 1 from public.placed_answers a where a.tm_id = v_tm and a.kind = 'dont_call') then
      insert into public.placed_answers (tm_id, person_id, kind) values (v_tm, tm.person_id, 'dont_call');
      perform public.write_event(tm.person_id, 'placed_answers.dont_call', 'tribe', tm.tribe_id::text, '{}'::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'kind', p_kind);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The office: who may open what
-- ---------------------------------------------------------------------------
-- The board: admin, director and pastor read it. The desk and every action on it: admin and director only. Nobody else.
create function public.placed_board_role()
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
  if public.has_any_role(array['admin', 'director']::public.app_role[]) then
    return 'desk';
  end if;
  if public.has_any_role(array['pastor']::public.app_role[]) then
    return 'board';
  end if;
  return null;
end;
$$;

create function public.placed_board_need(p_desk boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.placed_board_role();
begin
  if v_role is null or (p_desk and v_role <> 'desk') then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The board: one row for each placed member. Every tile, every list and the desk are computed from this one set, so they cannot disagree.
-- ---------------------------------------------------------------------------
create function public.placed_board_base(p_centre uuid)
returns table (
  tm_id uuid, person_id uuid, tribe_id uuid, tribe_name text, community_name text, leader_name text,
  placed_at timestamptz, emailed boolean, opened boolean, answer text, answered boolean,
  step text, sends integer, seq_status text, last_touch_at timestamptz, last_touch_kind text,
  hours_left numeric, flags text[], call_state text, desk text, tries integer, window_pref text, topic text, requested_at timestamptz, last_outcome text
)
language sql
stable
security definer
set search_path = ''
as $$
  with seats as (
    select distinct on (tm.person_id) tm.id as tm_id, tm.person_id, tm.tribe_id, tm.season_id, tm.status, tm.release_reason, tm.confirmed_at, tm.contact_withheld,
           tm.joined_at, t.name as tribe_name, t.leader_id, t.community_id
      from public.tribe_members tm
      join public.tribes t on t.id = tm.tribe_id
      join public.seasons s on s.id = tm.season_id
      join public.people p on p.id = tm.person_id
     where p.centre_id = p_centre and tm.placement_source = 'auto' and s.status <> 'closed'
       and (tm.status = 'active' or (tm.status = 'released' and tm.release_reason in ('Not this season', 'Chose to look at other tribes')))
     order by tm.person_id, (tm.status = 'active') desc, tm.joined_at desc, tm.id
  ), f as (
    select x.*,
           exists (select 1 from public.messages m where m.dedupe_key = 'placement:' || x.tm_id and m.status in ('sent', 'delivered', 'read')) as emailed,
           public.placed_page_opened(x.tm_id) as opened,
           public.placed_is_waiting(x.tm_id) as waiting,
           (select c.outcome from public.placed_calls c where c.tm_id = x.tm_id order by c.id desc limit 1) as last_outcome,
           (select max(a.created_at) from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'call_me') as requested_at,
           (select a.window_pref from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'call_me' order by a.id desc limit 1) as window_pref,
           (select a.topic from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'call_me' order by a.id desc limit 1) as topic,
           exists (select 1 from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'remind_tonight') as remind,
           exists (select 1 from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'stop_reminders') as stopped,
           exists (select 1 from public.placed_answers a where a.tm_id = x.tm_id and a.kind = 'dont_call') as dont_call,
           public.message_blocker(x.person_id) as blocker,
           public.placed_desk_state(x.tm_id) as desk,
           public.placed_call_tries(x.tm_id) as tries
      from seats x
  ), g as (
    select f.*,
           case when f.confirmed_at is not null then 'yes'
                when f.status = 'released' and f.release_reason = 'Not this season' then 'not_season'
                when f.status = 'released' then 'other_tribe'
                when f.last_outcome = 'other_tribe' then 'other_tribe'
                when f.requested_at is not null and (f.last_outcome is null or f.last_outcome not in ('yes', 'not_this_season', 'dont_call', 'wrong_number')) then 'call_me'
                when f.remind then 'remind'
                else 'none' end as answer
      from f
  )
  select g.tm_id, g.person_id, g.tribe_id, g.tribe_name,
         (select c.name from public.communities c where c.id = g.community_id),
         public.person_display_name(g.leader_id),
         public.placed_email_at(g.tm_id),
         g.emailed, g.opened, g.answer, g.answer in ('yes', 'not_season', 'other_tribe'),
         coalesce((select s.step from public.placed_seq_sends s join public.placed_seq q on q.id = s.seq_id where q.tm_id = g.tm_id and not q.rehearsal order by s.at desc, s.n desc limit 1), 'none'),
         coalesce((select sum(q.sends)::integer from public.placed_seq q where q.tm_id = g.tm_id and not q.rehearsal), 0),
         coalesce((select q.status from public.placed_seq q where q.tm_id = g.tm_id and not q.rehearsal order by q.started_at desc limit 1), 'none'),
         nullif(greatest(coalesce(nullif(public.placed_last_email_at(g.tm_id), '-infinity'::timestamptz), '-infinity'::timestamptz),
                         coalesce((select max(c.created_at) from public.placed_calls c where c.tm_id = g.tm_id), '-infinity'::timestamptz),
                         coalesce((select max(a.created_at) from public.placed_answers a where a.tm_id = g.tm_id), '-infinity'::timestamptz)), '-infinity'::timestamptz),
         case when coalesce((select max(a.created_at) from public.placed_answers a where a.tm_id = g.tm_id), '-infinity'::timestamptz)
                   >= greatest(coalesce(nullif(public.placed_last_email_at(g.tm_id), '-infinity'::timestamptz), '-infinity'::timestamptz),
                               coalesce((select max(c.created_at) from public.placed_calls c where c.tm_id = g.tm_id), '-infinity'::timestamptz)) then 'answer'
              when coalesce((select max(c.created_at) from public.placed_calls c where c.tm_id = g.tm_id), '-infinity'::timestamptz)
                   >= coalesce(nullif(public.placed_last_email_at(g.tm_id), '-infinity'::timestamptz), '-infinity'::timestamptz) then 'call'
              else 'email' end,
         case when g.waiting then greatest(extract(epoch from (public.placed_deadline_at(g.season_id) - now())) / 3600, 0)::numeric end,
         array_remove(array[
           case when public.is_minor(g.person_id) then 'under18' end,
           case when g.blocker = 'deletion' then 'deletion' end,
           case when g.blocker in ('bounced', 'email_off') then 'email_failing' end,
           case when exists (select 1 from public.care_flags cf where cf.person_id = g.person_id and cf.status <> 'closed') then 'care' end,
           case when g.contact_withheld then 'withheld' end,
           case when public.reminder_stopped(g.person_id, 'announcements') then 'announcements_off' end,
           case when g.stopped then 'stopped' end,
           case when g.dont_call then 'dont_call' end,
           case when g.last_outcome = 'wrong_number' then 'wrong_number' end,
           case when exists (select 1 from public.placed_holds h where h.tm_id = g.tm_id and h.held_until > now()) then 'held' end
         ], null),
         case when g.dont_call or g.last_outcome = 'dont_call' then 'dont_call'
              when g.last_outcome = 'wrong_number' then 'wrong_number'
              when g.last_outcome in ('yes', 'other_tribe', 'not_this_season') then 'reached'
              when g.desk is not null and g.tries > 0 then 'tried'
              when g.desk = 'asked' then 'asked'
              when g.desk = 'worth' then 'waiting'
              when g.tries > 0 then 'tried'
              else 'not_needed' end,
         g.desk, g.tries, g.window_pref, g.topic, g.requested_at, g.last_outcome
    from g;
$$;

-- The numbers at the top of the board and the line on Today. A tile is a count of the rows it opens: placed_board_rows takes the same names.
create function public.placed_board_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
  v_centre uuid := public.my_centre();
  v_season uuid;
  v_tiles jsonb;
  v_from timestamptz;
  v_sent integer := 0;
  v_delivered integer := 0;
  v_bounce integer := 0;
  v_comp integer := 0;
  v_unsub integer := 0;
  v_state text := public.placed_answers_any();
  v_reh jsonb;
begin
  perform public.placed_board_need(false);
  select * into s from public.placed_answers_settings x where x.id;
  v_tiles := (select jsonb_build_object('placed', count(*), 'emailed', count(*) filter (where b.emailed), 'opened', count(*) filter (where b.opened),
                                        'answered', count(*) filter (where b.answered), 'waiting', count(*) filter (where not b.answered),
                                        'needs_call', count(*) filter (where b.desk is not null), 'asked', count(*) filter (where b.desk = 'asked'),
                                        'under48', count(*) filter (where not b.answered and b.hours_left is not null and b.hours_left < 48))
                from public.placed_board_base(v_centre) b);
  select tm.season_id into v_season from public.tribe_members tm join public.seasons se on se.id = tm.season_id
   where tm.placement_source = 'auto' and se.status <> 'closed' order by se.starts_on desc limit 1;
  v_from := greatest(coalesce(s.counted_from, '-infinity'::timestamptz), coalesce((select min(q.started_at) from public.placed_seq q where not q.rehearsal), 'infinity'::timestamptz));
  if v_from < 'infinity'::timestamptz then
    select count(*)::integer, count(*) filter (where m.status in ('delivered', 'read'))::integer into v_sent, v_delivered
      from public.placed_seq_sends x join public.placed_seq q on q.id = x.seq_id join public.messages m on m.id = x.message_id
     where not q.rehearsal and x.at >= v_from and m.status in ('sent', 'delivered', 'read');
    select count(*) filter (where e.kind = 'hard_bounce')::integer, count(*) filter (where e.kind = 'complaint')::integer, count(*) filter (where e.kind = 'unsubscribe')::integer
      into v_bounce, v_comp, v_unsub
      from public.email_signals e
     where e.created_at >= v_from
       and exists (select 1 from public.placed_seq q where q.person_id = e.person_id and not q.rehearsal and q.started_at <= e.created_at);
  end if;
  v_reh := jsonb_build_object(
    'enrolled', (select count(*) from public.placed_seq q where q.rehearsal),
    'would_send', coalesce((select jsonb_object_agg(z.step, z.n) from (select x.step, count(*) as n from public.placed_seq_sends x where x.status = 'would_send' group by x.step) z), '{}'::jsonb));
  return jsonb_build_object(
    'state', v_state,
    'paused', s.paused, 'paused_reason', s.paused_reason, 'paused_at', s.paused_at,
    'deadline', case when v_season is not null then public.placed_deadline_on(v_season)::text end,
    'hours_left', case when v_season is not null then greatest(extract(epoch from (public.placed_deadline_at(v_season) - now())) / 3600, 0) end,
    'tiles', v_tiles,
    'health', jsonb_build_object('sent', v_sent, 'delivered', v_delivered, 'bounced', v_bounce, 'complaints', v_comp, 'stopped', v_unsub,
                                 'since', case when v_from < 'infinity'::timestamptz and v_from > '-infinity'::timestamptz then v_from end),
    'rehearsal', v_reh,
    'can_desk', public.placed_board_role() = 'desk',
    'calls_ok', public.placed_calls_ok());
end;
$$;


-- The rows. p_tile is one of the tiles: placed, emailed, opened, answered, waiting, needs_call, asked, under48. The other filters narrow it further.
-- Names, tribes and steps; never a number.
create function public.placed_board_rows(p_tile text default null, p_tribe uuid default null, p_step text default null, p_answer text default null,
                                         p_flag text default null, p_call text default null, p_opened text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  perform public.placed_board_need(false);
  if p_tile is not null and p_tile not in ('placed', 'emailed', 'opened', 'answered', 'waiting', 'needs_call', 'asked', 'under48') then
    raise exception 'That is not a tile' using errcode = '22023';
  end if;
  with b as (
    select x.*, public.person_display_name(x.person_id) as member_name
      from public.placed_board_base(public.my_centre()) x
     where (p_tile is null or p_tile = 'placed'
            or (p_tile = 'emailed' and x.emailed)
            or (p_tile = 'opened' and x.opened)
            or (p_tile = 'answered' and x.answered)
            or (p_tile = 'waiting' and not x.answered)
            or (p_tile = 'needs_call' and x.desk is not null)
            or (p_tile = 'asked' and x.desk = 'asked')
            or (p_tile = 'under48' and not x.answered and x.hours_left is not null and x.hours_left < 48))
       and (p_tribe is null or x.tribe_id = p_tribe)
       and (p_step is null or x.step = p_step)
       and (p_answer is null or x.answer = p_answer)
       and (p_flag is null or p_flag = any (x.flags))
       and (p_call is null or x.call_state = p_call)
       and (p_opened is null or (p_opened = 'yes' and x.opened) or (p_opened = 'no' and not x.opened))
  )
  select (select count(*) from b)::integer,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'tm', r.tm_id, 'person', r.person_id, 'name', r.member_name, 'tribe_id', r.tribe_id, 'tribe', r.tribe_name, 'community', r.community_name,
                     'placed_at', r.placed_at, 'emailed', r.emailed, 'opened', r.opened, 'answer', r.answer, 'answered', r.answered,
                     'step', r.step, 'sends', r.sends, 'seq', r.seq_status, 'last_touch_at', r.last_touch_at, 'last_touch', r.last_touch_kind,
                     'hours_left', r.hours_left, 'flags', to_jsonb(r.flags), 'call', r.call_state, 'tries', r.tries, 'window', r.window_pref, 'desk', r.desk)
                   order by r.answered, (r.desk is null), r.hours_left nulls last, r.placed_at nulls last, r.member_name, r.tm_id)
                    from (select * from b order by b.answered, (b.desk is null), b.hours_left nulls last, b.placed_at nulls last, b.member_name, b.tm_id
                           limit v_limit offset v_offset) r), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- "By tribe": which tribes still have the most people waiting, with the leader to speak to, and which tribes are thin.
create function public.placed_board_tribes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.placed_board_need(false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tribe', z.tribe_id, 'name', z.tribe_name, 'community', z.community_name, 'leader', z.leader_name,
             'placed', z.placed, 'waiting', z.waiting, 'yes', z.yes, 'not_season', z.not_season, 'other_tribe', z.other_tribe, 'asked', z.asked,
             'active', (select count(*) from public.tribe_members m where m.tribe_id = z.tribe_id and m.status = 'active'),
             'confirmed', (select count(*) from public.tribe_members m where m.tribe_id = z.tribe_id and m.status = 'active' and m.confirmed_at is not null),
             'thin', (select count(*) from public.tribe_members m where m.tribe_id = z.tribe_id and m.status = 'active' and m.confirmed_at is not null) < 5)
           order by z.waiting desc, z.tribe_name)
      from (select b.tribe_id, b.tribe_name, b.community_name, b.leader_name,
                   count(*)::integer as placed,
                   count(*) filter (where not b.answered)::integer as waiting,
                   count(*) filter (where b.answer = 'yes')::integer as yes,
                   count(*) filter (where b.answer = 'not_season')::integer as not_season,
                   count(*) filter (where b.answer = 'other_tribe')::integer as other_tribe,
                   count(*) filter (where b.desk = 'asked')::integer as asked
              from public.placed_board_base(public.my_centre()) b
             group by b.tribe_id, b.tribe_name, b.community_name, b.leader_name) z), '[]'::jsonb);
end;
$$;

-- The line on Today: how many are waiting, and how many need a call now. Counts only.
create function public.placed_answers_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  perform public.placed_board_need(false);
  v_state := public.placed_answers_any();
  if v_state = 'off' and not exists (select 1 from public.placed_seq) then
    return jsonb_build_object('state', 'off');
  end if;
  return jsonb_build_object('state', v_state) || coalesce((
    select jsonb_build_object('waiting', count(*) filter (where not b.answered), 'needs_call', count(*) filter (where b.desk is not null), 'asked', count(*) filter (where b.desk = 'asked'))
      from public.placed_board_base(public.my_centre()) b), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Actions on a row
-- ---------------------------------------------------------------------------
-- "Hold this seat": the office is dealing with this member, so the sequence waits (one to fourteen days). A reason, in the log.
create function public.placed_hold_set(p_tm uuid, p_days integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  tm public.tribe_members%rowtype;
begin
  perform public.placed_board_need(true);
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 or p_days > 14 then
    raise exception 'Hold a seat for 1 to 14 days' using errcode = '22023';
  end if;
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found or not exists (select 1 from public.people p where p.id = tm.person_id and p.centre_id = public.my_centre()) or not public.placed_is_waiting(p_tm) then
    raise exception 'That seat is not waiting for an answer' using errcode = 'P0002';
  end if;
  insert into public.placed_holds (tm_id, held_until, held_by, reason) values (p_tm, now() + make_interval(days => p_days), auth.uid(), v_reason)
  on conflict (tm_id) do update set held_until = excluded.held_until, held_by = excluded.held_by, reason = excluded.reason, held_at = now();
  perform public.write_event(auth.uid(), 'placed_answers.hold', 'person', tm.person_id::text, jsonb_build_object('days', p_days, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.placed_hold_clear(p_tm uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
begin
  perform public.placed_board_need(true);
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found or not exists (select 1 from public.people p where p.id = tm.person_id and p.centre_id = public.my_centre()) then
    raise exception 'That seat is not waiting for an answer' using errcode = 'P0002';
  end if;
  delete from public.placed_holds where tm_id = p_tm;
  perform public.write_event(auth.uid(), 'placed_answers.hold_cleared', 'person', tm.person_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The call desk
-- ---------------------------------------------------------------------------
-- Two lists. Masked numbers (the middle hidden); the name, tribe, the time of day the member chose, the tries so far and the last outcome. No email, no full number.
create function public.placed_desk_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
begin
  perform public.placed_board_need(true);
  select * into s from public.placed_answers_settings x where x.id;
  return jsonb_build_object(
    'calls_ok', public.placed_calls_ok(),
    'hour', public.lagos_hour(),
    'max_tries', s.call_tries,
    'download', s.numbers_download,
    'deadline_hours', (select min(b.hours_left) from public.placed_board_base(public.my_centre()) b where b.hours_left is not null),
    'asked', coalesce((select jsonb_agg(public.placed_desk_row(b.tm_id, b.person_id, b.member_name, b.tribe_name, b.window_pref, b.topic, b.requested_at, b.tries, b.last_outcome, b.opened, b.hours_left)
                              order by b.requested_at, b.member_name)
                         from (select x.*, public.person_display_name(x.person_id) as member_name from public.placed_board_base(public.my_centre()) x where x.desk = 'asked') b), '[]'::jsonb),
    'worth', coalesce((select jsonb_agg(public.placed_desk_row(b.tm_id, b.person_id, b.member_name, b.tribe_name, b.window_pref, b.topic, b.requested_at, b.tries, b.last_outcome, b.opened, b.hours_left)
                              order by b.opened desc, b.placed_at nulls last, b.member_name)
                         from (select x.*, public.person_display_name(x.person_id) as member_name from public.placed_board_base(public.my_centre()) x where x.desk = 'worth') b), '[]'::jsonb));
end;
$$;

create function public.placed_desk_row(p_tm uuid, p_person uuid, p_name text, p_tribe text, p_window text, p_topic text, p_requested timestamptz, p_tries integer,
                                       p_last text, p_opened boolean, p_hours numeric)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('tm', p_tm, 'name', p_name, 'tribe', p_tribe, 'window', p_window, 'topic', p_topic, 'requested_at', p_requested, 'tries', p_tries,
                            'last_outcome', p_last, 'opened', p_opened, 'hours_left', p_hours, 'mask', public.placed_desk_mask(public.placed_held_number(p_person)),
                            'in_window', public.placed_in_window(p_window));
$$;

-- Shows one number, and writes down that it was shown, to whom, by whom and when. Never the number. The member is checked again here, and the call hours kept.
-- Sixty reveals an hour at most for one person, so the desk cannot be used to copy the whole list out.
create function public.placed_desk_reveal(p_tm uuid, p_anyway boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  v_window text;
begin
  perform public.placed_board_need(true);
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found or not exists (select 1 from public.people p where p.id = tm.person_id and p.centre_id = public.my_centre()) then
    raise exception 'That member is not on the call list' using errcode = 'P0002';
  end if;
  if public.placed_desk_state(p_tm) is null then
    raise exception 'That member is no longer on the call list' using errcode = 'P0002';
  end if;
  if not public.placed_calls_ok() then
    raise exception 'Calls are made between 8 am and 8 pm, Lagos time' using errcode = '22023';
  end if;
  v_window := (select a.window_pref from public.placed_answers a where a.tm_id = p_tm and a.kind = 'call_me' order by a.id desc limit 1);
  if v_window is not null and not public.placed_in_window(v_window) and not coalesce(p_anyway, false) then
    raise exception 'They asked to be called in the %. Call then, or choose to call now', v_window using errcode = '22023';
  end if;
  if (select count(*) from public.placed_reveals r where r.by_person = auth.uid() and r.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That is a lot of numbers in an hour. Please wait a little' using errcode = '22023';
  end if;
  insert into public.placed_reveals (tm_id, person_id, by_person) values (p_tm, tm.person_id, auth.uid());
  perform public.write_event(auth.uid(), 'placed_answers.reveal', 'person', tm.person_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'number', public.placed_held_number(tm.person_id));
end;
$$;

-- The outcome of a call, from the short list. What each one does:
--   yes              confirms the place (version phone-v1). Not a WhatsApp yes and not a number: only the place.
--   other_tribe      writes it down and ends the sequence; the office moves them by hand
--   not_this_season  releases the seat, marked Not this season
--   needs_time       a follow-up date (up to the day joining closes); the seat is held until then, once
--   no_answer        a try; three tries and the member leaves the desk
--   wrong_number     the number is flagged and the member leaves the desk; nothing is deleted
--   dont_call        the member is never shown on the desk again
-- Any recorded call also ends a waiting "Call me", so the sequence carries on after a try.
create function public.placed_desk_record(p_tm uuid, p_outcome text, p_followup date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  v_res jsonb;
  v_req timestamptz;
begin
  perform public.placed_board_need(true);
  if p_outcome is null or p_outcome not in ('yes', 'other_tribe', 'not_this_season', 'needs_time', 'no_answer', 'wrong_number', 'dont_call') then
    raise exception 'Choose how the call went' using errcode = '22023';
  end if;
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or not exists (select 1 from public.people p where p.id = tm.person_id and p.centre_id = public.my_centre())
     or not public.placed_is_waiting(p_tm) then
    raise exception 'That seat is not waiting for an answer' using errcode = 'P0002';
  end if;
  if public.is_minor(tm.person_id) or coalesce(public.message_blocker(tm.person_id), '') in ('under18', 'deletion') then
    raise exception 'That member cannot be called' using errcode = '42501';
  end if;
  if p_outcome = 'needs_time' then
    if p_followup is null or p_followup < public.today_lagos() or p_followup > public.placed_deadline_on(tm.season_id) then
      raise exception 'Choose a follow-up date between today and the day joining closes' using errcode = '22023';
    end if;
    v_req := (select max(a.created_at) from public.placed_answers a where a.tm_id = p_tm and a.kind = 'call_me');
    if exists (select 1 from public.placed_calls c where c.tm_id = p_tm and c.outcome = 'needs_time' and (v_req is null or c.created_at > v_req)) then
      raise exception 'They have already asked for time once. Choose another outcome' using errcode = '22023';
    end if;
  end if;

  if p_outcome = 'yes' then
    v_res := public.placement_do_confirm(p_tm, 'phone-v1');
    if (v_res ->> 'ok')::boolean is not true then
      raise exception 'That seat is not waiting for an answer' using errcode = 'P0002';
    end if;
    perform public.placed_seq_end_for(p_tm, 'office_yes');
  elsif p_outcome = 'not_this_season' then
    v_res := public.placed_do_not_season(p_tm);
    if (v_res ->> 'ok')::boolean is not true then
      raise exception 'That seat is not waiting for an answer' using errcode = 'P0002';
    end if;
  elsif p_outcome = 'other_tribe' then
    perform public.placed_seq_end_for(p_tm, 'office_other_tribe');
  elsif p_outcome = 'needs_time' then
    insert into public.placed_holds (tm_id, held_until, held_by, reason)
    values (p_tm, ((p_followup + 1)::timestamp at time zone 'Africa/Lagos'), auth.uid(), 'Asked for time on a call')
    on conflict (tm_id) do update set held_until = excluded.held_until, held_by = excluded.held_by, reason = excluded.reason, held_at = now();
  elsif p_outcome = 'dont_call' then
    if not exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'dont_call') then
      insert into public.placed_answers (tm_id, person_id, kind) values (p_tm, tm.person_id, 'dont_call');
    end if;
  end if;
  insert into public.placed_calls (tm_id, person_id, by_person, outcome, followup_on)
  values (p_tm, tm.person_id, auth.uid(), p_outcome, case when p_outcome = 'needs_time' then p_followup end);
  perform public.write_event(auth.uid(), 'placed_answers.call', 'person', tm.person_id::text, jsonb_build_object('outcome', p_outcome));
  return jsonb_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

-- The desk as a download, with numbers: only when the owner has switched it on, only for admin and director, the same people as the desk and no one else. Each
-- download is written down. The caller adds the last line naming who downloaded it and when.
create function public.placed_desk_download()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
  v_rows jsonb;
  v_n integer;
begin
  perform public.placed_board_need(true);
  select * into s from public.placed_answers_settings x where x.id;
  if not s.numbers_download then
    raise exception 'The download with numbers is switched off' using errcode = '42501';
  end if;
  if (select count(*) from public.placed_downloads d where d.by_person = auth.uid() and d.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is enough downloads for today' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', z.member_name, 'tribe', z.tribe_name, 'list', z.desk, 'window', z.window_pref, 'tries', z.tries,
                                              'last_outcome', z.last_outcome, 'number', public.placed_held_number(z.person_id))
                            order by (z.desk = 'asked') desc, z.requested_at nulls last, z.opened desc, z.placed_at nulls last, z.member_name), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_n
    from (select x.*, public.person_display_name(x.person_id) as member_name from public.placed_board_base(public.my_centre()) x where x.desk is not null) z;
  insert into public.placed_downloads (by_person, row_count) values (auth.uid(), v_n);
  perform public.write_event(auth.uid(), 'placed_answers.download', 'placed_answers', null, jsonb_build_object('rows', v_n));
  return jsonb_build_object('rows', v_rows, 'by', public.person_display_name(auth.uid()), 'at', now(), 'count', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- A leader's one line to new members
-- ---------------------------------------------------------------------------
create function public.tribe_seat_line_get(p_tribe uuid)
returns jsonb
language plpgsql
stable
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
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false)
          or public.has_any_role(array['pastor', 'director', 'admin']::public.app_role[])) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  return jsonb_build_object('line', c.seat_line, 'can_edit', c.leader_id = uid or public.has_any_role(array['director', 'admin']::public.app_role[]),
                            'leader_first', public.first_name_of(c.leader_id), 'state', public.placed_answers_any());
end;
$$;

-- No web addresses, no numbers, no email addresses, no markup: the same rules as an announcement, and a little stricter, because this goes to people who have not met the leader.
create function public.tribe_seat_line_set(p_tribe uuid, p_line text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  v_line text := nullif(btrim(regexp_replace(coalesce(p_line, ''), '\s+', ' ', 'g')), '');
  v_problem text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe for update;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or public.has_any_role(array['director', 'admin']::public.app_role[])) then
    raise exception 'Only the leader can write this line' using errcode = '42501';
  end if;
  if v_line is not null then
    if char_length(v_line) > 200 then
      raise exception 'Keep it to 200 characters' using errcode = '22023';
    end if;
    v_problem := public.wording_problem(v_line, '{}');
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '22023';
    end if;
    if v_line ~ '[0-9][0-9 .()-]{5,}' or v_line ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' or v_line ~ '[<>{}]' then
      raise exception 'Leave out phone numbers, email addresses and symbols. Write one sentence in your own words' using errcode = '22023';
    end if;
  end if;
  update public.tribes set seat_line = v_line where id = p_tribe;
  perform public.write_event(uid, 'tribe.seat_line', 'tribe', p_tribe::text, jsonb_build_object('set', v_line is not null));
  return jsonb_build_object('ok', true, 'line', v_line);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office's pause and the owner's settings
-- ---------------------------------------------------------------------------
-- Admin or director pauses or resumes the whole sequence. Resuming starts the health counts afresh, so the self-stop is judged on what happens next.
create function public.placed_answers_pause_set(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.placed_board_need(true);
  if p_paused is null then
    raise exception 'Choose pause or resume' using errcode = '22023';
  end if;
  if p_paused and (v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300) then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_paused then
    update public.placed_answers_settings set paused = true, paused_reason = v_reason, paused_by = auth.uid(), paused_at = now() where id;
  else
    update public.placed_answers_settings set paused = false, paused_reason = null, paused_by = null, paused_at = null, counted_from = now() where id;
  end if;
  perform public.write_event(auth.uid(), case when p_paused then 'placed_answers.paused' else 'placed_answers.resumed' end, 'placed_answers', null,
                             jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true, 'paused', p_paused);
end;
$$;

create function public.god_placed_answers_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.placed_answers_settings%rowtype;
begin
  perform public.god_only();
  select * into s from public.placed_answers_settings x where x.id;
  return jsonb_build_object('second_after_hours', s.second_after_hours, 'step3_days', s.step3_days, 'last_call_hours', s.last_call_hours, 'pace_hours', s.pace_hours,
    'max_emails', s.max_emails, 'call_tries', s.call_tries, 'numbers_download', s.numbers_download, 'paused', s.paused, 'paused_reason', s.paused_reason,
    'reason', s.reason, 'changed_at', s.changed_at);
end;
$$;

create function public.god_placed_answers_settings_set(p_second_after integer, p_step3_days integer, p_last_call integer, p_pace integer, p_max integer, p_tries integer,
                                                       p_download boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  o public.placed_answers_settings%rowtype;
begin
  perform public.god_only();
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_second_after is null or p_second_after < 1 or p_second_after > 240 then
    raise exception 'The second email waits 1 to 240 hours after the placement email' using errcode = '22023';
  end if;
  if p_step3_days is null or p_step3_days < 1 or p_step3_days > 14 then
    raise exception 'Still held goes every 1 to 14 days' using errcode = '22023';
  end if;
  if p_last_call is null or p_last_call < 6 or p_last_call > 96 then
    raise exception 'Last call goes 6 to 96 hours before joining closes' using errcode = '22023';
  end if;
  if p_pace is null or p_pace < 1 or p_pace > 72 then
    raise exception 'Emails to one seat are 1 to 72 hours apart' using errcode = '22023';
  end if;
  if p_max is null or p_max < 2 or p_max > 10 then
    raise exception 'A seat can have 2 to 10 sequence emails' using errcode = '22023';
  end if;
  if p_tries is null or p_tries < 1 or p_tries > 6 then
    raise exception 'A member can be tried 1 to 6 times' using errcode = '22023';
  end if;
  if p_download is null then
    raise exception 'Choose whether the download with numbers is on' using errcode = '22023';
  end if;
  select * into o from public.placed_answers_settings x where x.id for update;
  update public.placed_answers_settings
     set second_after_hours = p_second_after, step3_days = p_step3_days, last_call_hours = p_last_call, pace_hours = p_pace, max_emails = p_max,
         call_tries = p_tries, numbers_download = p_download, reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'placed_answers.settings', 'placed_answers', null,
    jsonb_build_object('reason', v_reason,
      'from', jsonb_build_object('second_after', o.second_after_hours, 'step3_days', o.step3_days, 'last_call', o.last_call_hours, 'pace', o.pace_hours,
                                 'max', o.max_emails, 'tries', o.call_tries, 'download', o.numbers_download),
      'to', jsonb_build_object('second_after', p_second_after, 'step3_days', p_step3_days, 'last_call', p_last_call, 'pace', p_pace,
                               'max', p_max, 'tries', p_tries, 'download', p_download)));
  return public.god_placed_answers_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.placed_answers_cfg(),
  public.placed_answers_any(),
  public.placed_deadline_on(uuid),
  public.placed_deadline_at(uuid),
  public.placed_page_opened(uuid),
  public.placed_last_email_at(uuid),
  public.placed_call_pending(uuid),
  public.placed_remind_time(),
  public.placed_desk_mask(text),
  public.placed_seq_block(uuid, uuid),
  public.placed_seq_params(uuid, text),
  public.placed_seq_end(uuid, text),
  public.placed_seq_end_for(uuid, text),
  public.placed_seq_enrol(uuid, boolean),
  public.placed_seq_sweep(integer),
  public.placed_seq_send(uuid, text),
  public.placed_seq_step(uuid),
  public.placed_seq_selfcheck(),
  public.placed_seq_tick(),
  public.placed_call_tries(uuid),
  public.placed_calls_ok(),
  public.placed_in_window(text),
  public.placed_desk_state(uuid),
  public.placed_do_not_season(uuid),
  public.placed_seq_on_answer(),
  public.placed_board_role(),
  public.placed_board_need(boolean),
  public.placed_board_base(uuid),
  public.placed_desk_row(uuid, uuid, text, text, text, text, timestamptz, integer, text, boolean, numeric)
  from public, anon, authenticated;

-- Signed-in staff
revoke execute on function
  public.placed_board_summary(),
  public.placed_board_rows(text, uuid, text, text, text, text, text, integer, integer),
  public.placed_board_tribes(),
  public.placed_answers_overview(),
  public.placed_hold_set(uuid, integer, text),
  public.placed_hold_clear(uuid),
  public.placed_desk_list(),
  public.placed_desk_reveal(uuid, boolean),
  public.placed_desk_record(uuid, text, date),
  public.placed_desk_download(),
  public.tribe_seat_line_get(uuid),
  public.tribe_seat_line_set(uuid, text),
  public.placed_answers_pause_set(boolean, text),
  public.god_placed_answers_settings(),
  public.god_placed_answers_settings_set(integer, integer, integer, integer, integer, integer, boolean, text)
  from public, anon;

grant execute on function
  public.placed_board_summary(),
  public.placed_board_rows(text, uuid, text, text, text, text, text, integer, integer),
  public.placed_board_tribes(),
  public.placed_answers_overview(),
  public.placed_hold_set(uuid, integer, text),
  public.placed_hold_clear(uuid),
  public.placed_desk_list(),
  public.placed_desk_reveal(uuid, boolean),
  public.placed_desk_record(uuid, text, date),
  public.placed_desk_download(),
  public.tribe_seat_line_get(uuid),
  public.tribe_seat_line_set(uuid, text),
  public.placed_answers_pause_set(boolean, text),
  public.god_placed_answers_settings(),
  public.god_placed_answers_settings_set(integer, integer, integer, integer, integer, integer, boolean, text)
  to authenticated;

-- The sending service and the private page (the worker token is the credential, as for every page behind an email link)
revoke execute on function
  public.worker_placed_seq_tick(text),
  public.worker_placed_answers_info(text, text),
  public.worker_placed_answer(text, text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function
  public.worker_placed_seq_tick(text),
  public.worker_placed_answers_info(text, text),
  public.worker_placed_answer(text, text, text, text, text, text, text)
  to anon;

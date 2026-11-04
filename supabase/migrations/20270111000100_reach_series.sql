-- =============================================================================
-- United Tribes: the contact series and the tribe note (Package 5 of "seats and contacts")
--
-- What this adds, and nothing else. Two more functions on the Switchboard (God Mode -> Features), both starting Off, each Off / Rehearsal / On for the
-- whole church, one community or one tribe:
--
--   Reach series   a member who holds a seat and appears on Contact gaps (no number, a number but no WhatsApp yes, or a number that looks made up) is
--                  asked in four emails over six days (days 0, 2, 4 and 5), each with a private one-minute page that needs no sign-in. The leader goes
--                  first: for 24 hours they can press "Ask my members" and email 1 goes at once with their own line; if they do not, it goes by itself.
--                  The series ends the moment the gap is closed. It never releases a seat in this version: at the end it only writes down what
--                  happened (fixed, chose email, seen but not done, silent, not reached), for the office list. Needs Contact gaps On.
--   Tribe note     a leader writes one short email (600 characters, two a week for each tribe) to everyone in the tribe. It is sent by the church
--                  office in the leader's name. A member who still has a contact gap finds the "Add my number" link under it.
--
-- The private page. Every series email carries a link made of a 64-character secret that is kept only as a fingerprint. It is valid for 30 days.
-- Opening it changes nothing but a counter (mail scanners open links too); the member presses a button to do anything. The page saves a number and a
-- WhatsApp yes only for the person the link was made for, and never withdraws a yes. "Email me instead" ends the series and says so to the leader.
--
-- Rehearsal. The same machine runs, but "sending" writes a line saying what would have been sent. Nothing is emailed, no seat moves, and the
-- Rehearsal rows are retired the moment the switch moves to On, so the first real run starts clean.
--
-- Safety rules, all kept here and not on the page:
--   * never in the series: anyone under 18, anyone with a deletion request open, anyone with an open care follow-up (the series waits), anyone whose
--     seat is still waiting for a reply to the placement (they are on that clock, and a person is on one clock at a time)
--   * a person whose address bounces, or who has switched email off, is never asked: they are listed "Not reached" for a phone call
--   * the condition is checked again before every email; an email more than two days late is not sent late, the whole series is moved on by the
--     days lost so the spacing is kept and nobody gets four emails in a day
--   * the Master pause, switching the function Off, a care follow-up and the leader's "I'll follow this up myself" all FREEZE the series, and it
--     resumes with exactly the days it had left
--   * sent only between 9 am and 7 pm Lagos time, and inside the outbox's own quiet hours on top
--   * one series for a person in a season (the office can stop one, never restart one in this version)
--
-- What it never does: release a seat, remove anyone, send a number to anyone, tick WhatsApp for anyone, change the wording of any existing message,
-- or send anything on WhatsApp (the new emails are email only and are never put to Meta).
--
-- Replaced, because they now know about the series (the old text of each is in the rollback file): contact_ask_history, contact_ask_send,
-- contact_gaps_report (one more optional filter), contact_gaps_export (two more columns).
-- Needs the contact-gaps package, the placement-visibility package and the Switchboard's Master pause in place first.
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('reach_series', 'Reach series', 'Asks a member whom a leader cannot reach on WhatsApp, in four emails over six days, each with a one-minute page that needs no sign-in. The leader goes first for 24 hours with an Ask my members button, and a leader can say they will follow someone up themselves. It never releases a seat in this version. Rehearsal writes down who would be asked and which email each would get, and sends nothing. Needs Contact gaps On.', 8, array['contact_gaps'], array['off', 'rehearsal', 'on'], 'off', true, 28, false),
  ('tribe_note', 'Tribe note', 'Lets a leader write one short email to everyone in their tribe, sent by the church office in the leader''s name, two a week for each tribe at most. A member who still has a contact gap finds an Add my number link under it. Rehearsal saves the note and sends nothing.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 29, false);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- The settings. One row.
create table public.reach_settings (
  id boolean primary key default true check (id),
  -- Hours the leader has to send email 1 in their own name before it goes by itself
  first_go_hours smallint not null default 24 check (first_go_hours between 0 and 72),
  -- Days from email 1 to the end of the series. Four emails need four different days, so the least is 4.
  release_after_days smallint not null default 6 check (release_after_days between 4 and 10),
  -- What happens at the end of the series. Used when release is built (a later package); until then nothing is released whatever this says.
  end_mode text not null default 'silent' check (end_mode in ('silent', 'everyone', 'list')),
  -- Tribe notes for each tribe in any seven days
  note_per_week smallint not null default 2 check (note_per_week between 1 and 4),
  -- The office's pause for everyone (the series keeps its days)
  paused boolean not null default false,
  paused_reason text check (char_length(paused_reason) <= 300),
  paused_by uuid references public.people (id) on delete set null,
  paused_at timestamptz,
  swept_at timestamptz,
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.reach_settings (id) values (true);
alter table public.reach_settings enable row level security;
revoke all on table public.reach_settings from public, anon, authenticated;

-- One row for each time a person is put in the series. The deadline of every step is an exact time, worked out from day0_at and the days kept here.
create table public.reach_enrolments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  tm_id uuid references public.tribe_members (id) on delete set null,
  season_id uuid references public.seasons (id) on delete set null,
  -- Written by Rehearsal: the same machine, but nothing is emailed
  rehearsal boolean not null default false,
  -- What is missing, in the words of the first email
  kind text not null check (kind in ('no_number', 'no_yes')),
  status text not null default 'active' check (status in ('active', 'ended')),
  outcome text check (outcome in ('fixed', 'email_only', 'seen_not_done', 'silent', 'not_reached', 'stopped', 'left', 'not_eligible', 'rehearsal_over')),
  started_at timestamptz not null default now(),
  -- Email 1 goes at the leader's word, or at this moment
  first_go_until timestamptz not null,
  -- The moment email 1 went: day 0
  day0_at timestamptz,
  -- Kept when the person enters, so changing a setting never moves a series already running
  email_days smallint[] not null check (cardinality(email_days) = 4),
  release_days smallint not null,
  -- Days added because the site missed its beats
  shift_days integer not null default 0 check (shift_days >= 0),
  sends smallint not null default 0 check (sends between 0 and 4),
  leader_line text check (char_length(leader_line) <= 200),
  leader_asked_by uuid references public.people (id) on delete set null,
  follow_up_used boolean not null default false,
  -- A freeze (Master pause, the switch, a care follow-up): the days it had left are kept
  frozen_at timestamptz,
  frozen_why text check (frozen_why in ('paused', 'switch', 'care', 'on_clock')),
  -- "I'll follow this up myself": three days, once
  paused_at timestamptz,
  paused_until timestamptz,
  fixed_by_email smallint check (fixed_by_email between 1 and 4),
  ended_at timestamptz,
  stopped_by uuid references public.people (id) on delete set null,
  stop_reason text check (char_length(stop_reason) <= 300),
  check ((status = 'active') = (outcome is null))
);
create unique index reach_enrolments_one_active on public.reach_enrolments (person_id, rehearsal) where status = 'active';
create index reach_enrolments_person_idx on public.reach_enrolments (person_id, season_id, started_at desc);
create index reach_enrolments_tribe_idx on public.reach_enrolments (tribe_id) where status = 'active';
alter table public.reach_enrolments enable row level security;
revoke all on table public.reach_enrolments from public, anon, authenticated;

-- One row for each email of a series (or each line Rehearsal wrote). The message is the outbox's own row.
create table public.reach_sends (
  id bigint generated always as identity primary key,
  enrolment_id uuid not null references public.reach_enrolments (id) on delete cascade,
  n smallint not null check (n between 1 and 4),
  status text not null check (status in ('sent', 'would_send')),
  message_id uuid references public.messages (id) on delete set null,
  at timestamptz not null default now(),
  unique (enrolment_id, n)
);
alter table public.reach_sends enable row level security;
revoke all on table public.reach_sends from public, anon, authenticated;

-- The private links. Only the fingerprint of the secret is kept. An expired link is kept for 60 days so the page can offer "Send me a new link".
create table public.reach_links (
  token_hash text primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid references public.tribes (id) on delete set null,
  enrolment_id uuid references public.reach_enrolments (id) on delete set null,
  source text not null check (source in ('series', 'note', 'again')),
  email_n smallint check (email_n between 1 and 4),
  expires_at timestamptz not null,
  clicks integer not null default 0,
  first_opened_at timestamptz,
  created_at timestamptz not null default now()
);
create index reach_links_person_idx on public.reach_links (person_id, created_at desc);
alter table public.reach_links enable row level security;
revoke all on table public.reach_links from public, anon, authenticated;

-- Each time a leader pressed "Ask my members" (once for a tribe in three days).
create table public.reach_leader_asks (
  id bigint generated always as identity primary key,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  by_person uuid references public.people (id) on delete set null,
  line text check (char_length(line) <= 200),
  sent smallint not null default 0,
  at timestamptz not null default now()
);
create index reach_leader_asks_tribe_idx on public.reach_leader_asks (tribe_id, at desc);
alter table public.reach_leader_asks enable row level security;
revoke all on table public.reach_leader_asks from public, anon, authenticated;

-- Each tribe note.
create table public.tribe_notes (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  by_person uuid references public.people (id) on delete set null,
  body text not null check (char_length(body) between 1 and 600),
  rehearsal boolean not null default false,
  recipients smallint not null default 0,
  at timestamptz not null default now()
);
create index tribe_notes_tribe_idx on public.tribe_notes (tribe_id, at desc);
alter table public.tribe_notes enable row level security;
revoke all on table public.tribe_notes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------
-- The day of each email, counted from the day email 1 goes: 0, a third of the way, two days before the end, the day before the end.
-- Six days gives 0, 2, 4 and 5. Always four different days when the length is 4 to 10.
create function public.reach_email_days(p_release integer)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select array[0, (p_release / 3), p_release - 2, p_release - 1]::smallint[];
$$;

-- A number with its middle hidden: +234•••••••67. For the page that shows a number to someone who is not signed in.
create function public.reach_mask(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null or char_length(p_phone) < 8 then null
              else left(p_phone, 4) || repeat('•', greatest(char_length(p_phone) - 6, 1)) || right(p_phone, 2) end;
$$;

-- The number a person signs in with, as +digits, when it can be used as a WhatsApp number.
create function public.reach_signin_number(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when length(d.digits) between 8 and 15 and d.digits ~ '^[1-9]' and not public.number_looks_made_up('+' || d.digits) then '+' || d.digits end
    from (select regexp_replace(coalesce((select u.phone from auth.users u where u.id = p_person), ''), '\D', '', 'g') as digits) d;
$$;

-- What the person has to put right, looking only at the number and the yes: 'no_number' (none, or one that looks made up), 'no_yes', or null.
-- A teenager and a person whose deletion is open are never asked. It does not look at whether a leader can see the contact yet.
create function public.reach_number_kind(p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if public.is_minor(p_person) or coalesce(public.message_blocker(p_person), '') in ('under18', 'deletion') then
    return null;
  end if;
  v_phone := coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = p_person),
                      (select mp.whatsapp from public.member_profiles mp where mp.person_id = p_person));
  if v_phone is null or public.number_looks_made_up(v_phone) then
    return 'no_number';
  end if;
  if not public.consent_granted(p_person, 'whatsapp') then
    return 'no_yes';
  end if;
  return null;
end;
$$;

-- The same, for a person in a seat, as Contact gaps sees it: only a gap a person can put right, so "Don't share", "contact not open yet" and "no way
-- to email them" are null here.
create function public.reach_gap_kind(p_person uuid, p_tm uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case public.contact_gap_cause_of(p_person, p_tm)
           when 'no_number' then 'no_number'
           when 'made_up' then 'no_number'
           when 'no_yes' then 'no_yes' end;
$$;

-- Why the series must not write to this person right now, or null when it may.
--   deletion, under18, bounced, email_off   the usual blocks (the last two mean "Not reached")
--   care                                    an open care follow-up: the series waits
--   on_clock                                a seat the church placed and the person has not answered: they are on that clock, one clock at a time
create function public.reach_block_of(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := public.message_blocker(p_person);
begin
  if v is not null then
    return v;
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = p_person and f.status <> 'closed') then
    return 'care';
  end if;
  if exists (select 1 from public.tribe_members x where x.id = p_tm and x.placement_source = 'auto' and x.confirmed_at is null) then
    return 'on_clock';
  end if;
  return null;
end;
$$;

-- The answer for this person: 'off', 'rehearsal' or 'on' (the Master pause, the narrowest rule, the hold-out and Contact gaps, all in one).
create function public.reach_state_of(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.feature_state_of('reach_series', p_person);
$$;

-- Emails go between 9 am and 7 pm in Lagos.
create function public.reach_window_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.lagos_hour() >= 9 and public.lagos_hour() < 19;
$$;

-- A private link. The database makes it; only its fingerprint is kept. The link itself goes into the message's reply token, which the heartbeat
-- scrubs once the message is finished with.
create function public.reach_link_mint(p_person uuid, p_tribe uuid, p_enrolment uuid, p_source text, p_n integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.reach_links (token_hash, person_id, tribe_id, enrolment_id, source, email_n, expires_at)
  values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), p_person, p_tribe, p_enrolment, p_source, p_n, now() + interval '30 days');
  return v_raw;
end;
$$;

-- Looks a link up. Opening it counts a click and nothing else. An expired link is still found (so the page can offer a new one), and says so.
-- Nothing at all for a string that is not a link we made.
create function public.reach_link_open(p_link text)
returns table (r_person uuid, r_tribe uuid, r_enrolment uuid, r_n smallint, r_expired boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  k public.reach_links%rowtype;
begin
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return;
  end if;
  v_hash := encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  update public.reach_links l
     set clicks = l.clicks + 1, first_opened_at = coalesce(l.first_opened_at, now())
   where l.token_hash = v_hash and l.expires_at > now()
  returning * into k;
  if not found then
    select * into k from public.reach_links l where l.token_hash = v_hash;
    if not found then
      return;
    end if;
  end if;
  return query select k.person_id, k.tribe_id, k.enrolment_id, k.email_n, k.expires_at <= now();
end;
$$;

-- ---------------------------------------------------------------------------
-- The series: entering, each step, and the end
-- ---------------------------------------------------------------------------
-- Ends an enrolment, once, with its outcome.
create function public.reach_end(p_id uuid, p_outcome text, p_by uuid default null, p_reason text default null, p_fixed_by integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
begin
  update public.reach_enrolments x
     set status = 'ended', outcome = p_outcome, ended_at = now(), stopped_by = p_by, stop_reason = p_reason,
         fixed_by_email = case when p_outcome = 'fixed' then coalesce(p_fixed_by, nullif(x.sends, 0)) end,
         frozen_at = null, frozen_why = null, paused_at = null, paused_until = null
   where x.id = p_id and x.status = 'active'
  returning * into e;
  if found and not e.rehearsal then
    perform public.write_event(p_by, 'reach.ended', 'person', e.person_id::text, jsonb_build_object('outcome', p_outcome, 'emails', e.sends));
  end if;
end;
$$;

-- Puts one person in the series, for the seat they hold. Does not decide whether they should be: the callers do. Null when they already are.
create function public.reach_enrol(p_tm uuid, p_rehearsal boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.reach_settings%rowtype;
  v_kind text;
  v_id uuid;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return null;
  end if;
  select * into s from public.reach_settings x where x.id;
  v_kind := public.reach_gap_kind(tm.person_id, p_tm);
  if v_kind is null then
    return null;
  end if;
  insert into public.reach_enrolments (person_id, tribe_id, tm_id, season_id, rehearsal, kind, started_at, first_go_until, email_days, release_days)
  values (tm.person_id, tm.tribe_id, tm.id, tm.season_id, coalesce(p_rehearsal, false), v_kind, now(),
          now() + make_interval(hours => s.first_go_hours), public.reach_email_days(s.release_after_days), s.release_after_days)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Has this person already had a series this season? (A series that was only a Rehearsal does not count when the real thing starts.)
create function public.reach_had_series(p_person uuid, p_season uuid, p_rehearsal boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.reach_enrolments e
                  where e.person_id = p_person and e.season_id is not distinct from p_season
                    and e.rehearsal = coalesce(p_rehearsal, false) and e.outcome is distinct from 'rehearsal_over');
$$;

-- Everyone on Contact gaps who can be asked and has not been: put them in the series (or in the Rehearsal). Not more than p_limit in one beat.
create function public.reach_enrol_sweep(p_limit integer default 300)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  g record;
  v_state text;
  v_season uuid;
  v_n integer := 0;
begin
  for c in select x.id from public.centres x where x.active loop
    for g in select * from public.contact_gap_rows(c.id) r where r.cause in ('no_number', 'made_up', 'no_yes') loop
      exit when v_n >= p_limit;
      select tm.season_id into v_season from public.tribe_members tm where tm.id = g.tm_id;
      -- the cheap check first: someone who has had their series this season is not looked at again
      continue when public.reach_had_series(g.person_id, v_season, false);
      v_state := public.reach_state_of(g.person_id);
      continue when v_state not in ('on', 'rehearsal');
      continue when v_state = 'rehearsal' and public.reach_had_series(g.person_id, v_season, true);
      continue when public.reach_block_of(g.person_id, g.tm_id) is not null;
      if public.reach_enrol(g.tm_id, v_state = 'rehearsal') is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Sends email p_n of a series, or in Rehearsal writes down that it would have. Does not decide whether it should: reach_step does.
create function public.reach_send(p_enrolment uuid, p_n integer, p_line text default null, p_by uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
  t public.tribes%rowtype;
  v_link text;
  v_msg uuid;
  v_params jsonb;
begin
  select * into e from public.reach_enrolments x where x.id = p_enrolment;
  select * into t from public.tribes x where x.id = e.tribe_id;
  if exists (select 1 from public.reach_sends r where r.enrolment_id = p_enrolment and r.n = p_n) then
    return 'done';
  end if;
  if e.rehearsal then
    insert into public.reach_sends (enrolment_id, n, status) values (p_enrolment, p_n, 'would_send');
    update public.reach_enrolments x
       set sends = p_n, day0_at = case when p_n = 1 then now() else x.day0_at end
     where x.id = p_enrolment;
    return 'would_send';
  end if;
  v_link := public.reach_link_mint(e.person_id, e.tribe_id, e.id, 'series', p_n);
  v_params := jsonb_build_object(
    'n', p_n, 'kind', e.kind, 'leader_first', public.first_name_of(t.leader_id), 'tribe', t.name,
    'has_group', coalesce(t.whatsapp_group_url, '') <> '', 'release_on', false);
  if p_n = 1 and p_line is not null then
    v_params := v_params || jsonb_build_object('line', p_line);
  end if;
  v_msg := public.enqueue_message(e.person_id, 'reach_series', v_params, e.tribe_id, 'reach:' || e.id::text || ':' || p_n::text, now(), 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
  end if;
  insert into public.reach_sends (enrolment_id, n, status, message_id) values (p_enrolment, p_n, 'sent', v_msg);
  update public.reach_enrolments x
     set sends = p_n,
         day0_at = case when p_n = 1 then now() else x.day0_at end,
         leader_line = case when p_n = 1 then p_line else x.leader_line end,
         leader_asked_by = case when p_n = 1 then p_by else x.leader_asked_by end
   where x.id = p_enrolment;
  return 'sent';
end;
$$;

-- One step for one enrolment, under its own lock. Returns what it did: busy, frozen, following_up, waiting, shifted, sent, would_send, ended.
--   p_ask    the leader pressed "Ask my members": email 1 goes now, with their line, without waiting for the 24 hours or the window
create function public.reach_step(p_id uuid, p_ask boolean default false, p_line text default null, p_by uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
  s public.reach_settings%rowtype;
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  v_state text;
  v_want text;
  v_cause text;
  v_block text;
  v_n integer;
  v_due timestamptz;
  v_end timestamptz;
  v_shift interval;
  v_late integer;
  v_failed boolean;
  v_seen boolean;
begin
  select * into e from public.reach_enrolments x where x.id = p_id and x.status = 'active' for update skip locked;
  if not found then
    return 'busy';
  end if;
  select * into s from public.reach_settings x where x.id;
  v_want := case when e.rehearsal then 'rehearsal' else 'on' end;
  v_state := public.reach_state_of(e.person_id);

  -- A Rehearsal is over the moment the real thing is On
  if e.rehearsal and v_state = 'on' then
    perform public.reach_end(e.id, 'rehearsal_over');
    return 'ended';
  end if;
  -- Off, the Master pause, or the office's pause: freeze, and keep the days it had left
  if v_state <> v_want or s.paused then
    if e.frozen_at is null then
      update public.reach_enrolments set frozen_at = now(), frozen_why = case when s.paused then 'paused' else 'switch' end where id = e.id;
    end if;
    return 'frozen';
  end if;
  -- Thaw: the days it had left are the days it has
  if e.frozen_at is not null then
    v_shift := now() - e.frozen_at;
    update public.reach_enrolments x
       set day0_at = x.day0_at + v_shift, first_go_until = x.first_go_until + v_shift, frozen_at = null, frozen_why = null
     where x.id = e.id;
    e.day0_at := e.day0_at + v_shift;
    e.first_go_until := e.first_go_until + v_shift;
    e.frozen_at := null;
    e.frozen_why := null;
  end if;
  -- The leader said they will follow this person up themselves: three days, once
  if e.paused_until is not null then
    if e.paused_until > now() then
      return 'following_up';
    end if;
    v_shift := e.paused_until - e.paused_at;
    update public.reach_enrolments x
       set day0_at = x.day0_at + v_shift, first_go_until = x.first_go_until + v_shift, paused_at = null, paused_until = null
     where x.id = e.id;
    e.day0_at := e.day0_at + v_shift;
    e.first_go_until := e.first_go_until + v_shift;
    e.paused_at := null;
    e.paused_until := null;
  end if;

  -- Is the person still someone to ask, in the seat they were asked for?
  select * into tm from public.tribe_members x where x.id = e.tm_id;
  select * into t from public.tribes x where x.id = e.tribe_id;
  select * into se from public.seasons x where x.id = t.season_id;
  if tm.id is null or tm.status <> 'active' or t.status = 'closed' or se.status = 'closed' then
    perform public.reach_end(e.id, 'left');
    return 'ended';
  end if;
  if public.is_minor(e.person_id) or coalesce(public.message_blocker(e.person_id), '') in ('under18', 'deletion') then
    perform public.reach_end(e.id, 'not_eligible');
    return 'ended';
  end if;
  v_cause := public.contact_gap_cause_of(e.person_id, tm.id);
  if v_cause is null then
    perform public.reach_end(e.id, 'fixed');
    return 'ended';
  end if;
  if v_cause in ('withheld', 'not_open') then
    perform public.reach_end(e.id, 'not_eligible');
    return 'ended';
  end if;
  if v_cause = 'unreachable' then
    perform public.reach_end(e.id, 'not_reached');
    return 'ended';
  end if;
  v_block := public.reach_block_of(e.person_id, tm.id);
  if v_block in ('bounced', 'email_off') then
    perform public.reach_end(e.id, 'not_reached');
    return 'ended';
  end if;
  if v_block in ('care', 'on_clock') then
    update public.reach_enrolments set frozen_at = now(), frozen_why = v_block where id = e.id;
    return 'frozen';
  end if;
  -- What is missing can change (a number added, the yes still missing): the next email says what is true now
  if v_cause in ('no_number', 'made_up') and e.kind <> 'no_number' then
    update public.reach_enrolments set kind = 'no_number' where id = e.id;
  elsif v_cause = 'no_yes' and e.kind <> 'no_yes' then
    update public.reach_enrolments set kind = 'no_yes' where id = e.id;
  end if;

  v_n := e.sends + 1;
  if v_n <= 4 then
    if p_ask then
      if v_n <> 1 then
        return 'waiting';
      end if;
    else
      v_due := case when v_n = 1 then e.first_go_until
                    else e.day0_at + make_interval(days => (e.email_days[v_n] + e.shift_days)::integer) end;
      if now() < v_due then
        return 'waiting';
      end if;
      -- More than two days late: the email is not sent late. The whole series moves on by the days lost, so the spacing is kept
      if v_n > 1 and now() > v_due + interval '2 days' then
        v_late := ceil(extract(epoch from (now() - v_due)) / 86400.0)::integer;
        update public.reach_enrolments set shift_days = shift_days + v_late where id = e.id;
        perform public.write_event(null, 'reach.moved_on', 'person', e.person_id::text, jsonb_build_object('days', v_late, 'email', v_n));
        return 'shifted';
      end if;
      if not public.reach_window_ok() then
        return 'waiting';
      end if;
    end if;
    return public.reach_send(e.id, v_n, case when v_n = 1 then p_line end, p_by);
  end if;

  -- All four have gone. The end comes release_days (and the days lost) after email 1
  v_end := e.day0_at + make_interval(days => (e.release_days + e.shift_days)::integer);
  if now() < v_end or not public.reach_window_ok() then
    return 'waiting';
  end if;
  -- Wait for an email still on its way (for at most a day), so "delivered" is a fact
  if exists (select 1 from public.reach_sends r join public.messages m on m.id = r.message_id
              where r.enrolment_id = e.id and m.status in ('queued', 'sending') and m.created_at > now() - interval '1 day') then
    return 'waiting';
  end if;
  v_failed := exists (select 1 from public.reach_sends r left join public.messages m on m.id = r.message_id
                       where r.enrolment_id = e.id and r.status = 'sent' and (m.id is null or m.status in ('failed', 'skipped')))
              or exists (select 1 from public.email_signals g where g.person_id = e.person_id and g.kind = 'hard_bounce' and g.created_at >= e.started_at);
  v_seen := exists (select 1 from public.reach_links l where l.person_id = e.person_id and l.clicks > 0 and l.created_at >= e.started_at)
            or exists (select 1 from auth.users u where u.id = e.person_id and u.last_sign_in_at > e.day0_at)
            or exists (select 1 from public.event_log ev where ev.actor_id = e.person_id and ev.at > e.day0_at);
  perform public.reach_end(e.id, case when v_failed and not e.rehearsal then 'not_reached' when v_seen then 'seen_not_done' else 'silent' end);
  return 'ended';
end;
$$;

-- The heartbeat's step: put new people in, take every running series one step, and tidy. Off (and nothing running) it does nothing at all.
create function public.reach_series_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reach_settings%rowtype;
  v_paused boolean := coalesce((select m.paused from public.feature_master m where m.id), true);
  v_any boolean := exists (select 1 from public.feature_settings f where f.feature = 'reach_series' and f.position in ('on', 'rehearsal'));
  v_active boolean := exists (select 1 from public.reach_enrolments e where e.status = 'active');
  v_enrolled integer := 0;
  v_steps jsonb := '{}'::jsonb;
  v_cleared integer := 0;
  r record;
  res text;
begin
  if not v_active and (not v_any or v_paused) then
    return jsonb_build_object('ran', false);
  end if;
  select * into s from public.reach_settings x where x.id;
  if v_any and not v_paused and not s.paused and (s.swept_at is null or s.swept_at < now() - interval '15 minutes') then
    update public.reach_settings set swept_at = now() where id;
    v_enrolled := public.reach_enrol_sweep(300);
  end if;
  for r in select e.id from public.reach_enrolments e where e.status = 'active' order by e.started_at limit 500 loop
    res := public.reach_step(r.id);
    v_steps := jsonb_set(v_steps, array[res], to_jsonb(coalesce((v_steps ->> res)::integer, 0) + 1));
  end loop;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('reach_series', 'reach_new_link', 'tribe_note')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  delete from public.reach_links where created_at < now() - interval '60 days';
  return jsonb_build_object('ran', true, 'enrolled', v_enrolled, 'steps', v_steps, 'cleared', v_cleared);
end;
$$;

create function public.worker_reach_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.reach_series_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's side: the private page, with no sign-in (the sending service's token is the credential, as for the placed page)
-- ---------------------------------------------------------------------------
-- Saves a number and, when ticked, the yes to WhatsApp, for one person. It only ever GRANTS the yes: unticked, it leaves an earlier answer alone.
-- p_use_signin takes the number the person signs in with, on the server, so the full number never goes to the page.
create function public.reach_apply_number(p_person uuid, p_phone text, p_whatsapp boolean, p_use_signin boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_old text;
  v_pref text;
begin
  if public.is_minor(p_person) or coalesce(public.message_blocker(p_person), '') in ('under18', 'deletion') then
    raise exception 'This page is not available' using errcode = '42501';
  end if;
  v_old := (select cp.phone from public.contact_preferences cp where cp.person_id = p_person);
  if coalesce(p_use_signin, false) then
    v_phone := public.reach_signin_number(p_person);
    if v_phone is null then
      raise exception 'We could not use that number. Please type it in' using errcode = '22023';
    end if;
  end if;
  v_phone := coalesce(v_phone, v_old);
  if v_phone is null then
    raise exception 'Write your number with its country code, like +2348031234567' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Write the number with its country code, like +2348031234567' using errcode = '22023';
  end if;
  if public.number_looks_made_up(v_phone) then
    raise exception 'That number looks made up. Check the digits and write it again' using errcode = '22023';
  end if;
  v_pref := coalesce((select cp.preferred from public.contact_preferences cp where cp.person_id = p_person), case when coalesce(p_whatsapp, false) then 'whatsapp' else 'email' end);
  insert into public.contact_preferences (person_id, phone, preferred) values (p_person, v_phone, v_pref)
  on conflict (person_id) do update set phone = excluded.phone, updated_at = now();
  if coalesce(p_whatsapp, false) and not public.consent_granted(p_person, 'whatsapp') then
    insert into public.consents (person_id, purpose, granted, version) values (p_person, 'whatsapp', true, 'reach-v1');
  end if;
  -- A preference for WhatsApp means nothing without the yes: fall back to email, as saving a contact does
  update public.contact_preferences set preferred = 'email'
   where person_id = p_person and preferred = 'whatsapp' and not public.consent_granted(p_person, 'whatsapp');
  -- A leader or coach reaches a member on the number the member shared, so keep the two in step
  update public.member_profiles set whatsapp = case when public.consent_granted(p_person, 'whatsapp') then v_phone else null end where person_id = p_person;
  perform public.write_event(p_person, 'reach.number_saved', 'person', p_person::text, jsonb_build_object('whatsapp', public.consent_granted(p_person, 'whatsapp')));
  return jsonb_build_object('ok', true, 'kind', public.reach_number_kind(p_person));
end;
$$;

-- When a number and a yes are in, every series for the person that is still running has done its work.
create function public.reach_close_if_fixed(p_person uuid, p_n integer default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if public.reach_number_kind(p_person) is not null then
    return false;
  end if;
  for r in select e.id from public.reach_enrolments e where e.person_id = p_person and e.status = 'active' loop
    perform public.reach_end(r.id, 'fixed', null, null, p_n);
  end loop;
  return true;
end;
$$;

-- What the page shows. state: form (something to put right), done (nothing to put right), email_only (they chose email), expired, unavailable.
create function public.worker_reach_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  v_kind text;
  t public.tribes%rowtype;
  v_phone text;
  v_only boolean;
begin
  perform public.worker_ok(p_token);
  select * into k from public.reach_link_open(p_link);
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if public.is_minor(k.r_person) or coalesce(public.message_blocker(k.r_person), '') in ('under18', 'deletion') then
    return jsonb_build_object('found', false);
  end if;
  select * into t from public.tribes x where x.id = k.r_tribe;
  v_kind := public.reach_number_kind(k.r_person);
  v_phone := (select cp.phone from public.contact_preferences cp where cp.person_id = k.r_person);
  v_only := exists (select 1 from public.reach_enrolments e where e.person_id = k.r_person and e.outcome = 'email_only' and not e.rehearsal);
  return jsonb_build_object(
    'found', true,
    'state', case when k.r_expired and v_kind is not null then 'expired' when v_kind is null then 'done' when v_only then 'email_only' else 'form' end,
    'first', public.first_name_of(k.r_person),
    'leader_first', case when t.id is not null then public.first_name_of(t.leader_id) end,
    'tribe', t.name,
    'kind', v_kind,
    'number', case when v_phone is not null and not public.number_looks_made_up(v_phone) then public.reach_mask(v_phone) end,
    'signin', public.reach_mask(public.reach_signin_number(k.r_person)));
end;
$$;

create function public.worker_reach_save(p_token text, p_link text, p_phone text, p_whatsapp boolean, p_use_signin boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  v jsonb;
begin
  perform public.worker_ok(p_token);
  select * into k from public.reach_link_open(p_link);
  if not found or k.r_expired then
    return jsonb_build_object('ok', false, 'reason', case when found then 'expired' else 'invalid' end);
  end if;
  v := public.reach_apply_number(k.r_person, p_phone, p_whatsapp, p_use_signin);
  perform public.reach_close_if_fixed(k.r_person, k.r_n);
  return v || jsonb_build_object('done', public.reach_number_kind(k.r_person) is null);
end;
$$;

-- "Email me instead": the series stops, the person is not asked again this season, and the leader is told to use the tribe note.
create function public.worker_reach_email_instead(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  e public.reach_enrolments%rowtype;
  v_tm public.tribe_members%rowtype;
begin
  perform public.worker_ok(p_token);
  select * into k from public.reach_link_open(p_link);
  if not found or k.r_expired then
    return jsonb_build_object('ok', false, 'reason', case when found then 'expired' else 'invalid' end);
  end if;
  if public.is_minor(k.r_person) or coalesce(public.message_blocker(k.r_person), '') in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into e from public.reach_enrolments x
   where x.person_id = k.r_person and not x.rehearsal and x.status = 'active' for update;
  if found then
    perform public.reach_end(e.id, 'email_only');
  else
    select * into e from public.reach_enrolments x
     where x.person_id = k.r_person and not x.rehearsal and x.outcome in ('seen_not_done', 'silent', 'not_reached')
     order by x.started_at desc limit 1 for update;
    if found then
      update public.reach_enrolments set outcome = 'email_only' where id = e.id;
    else
      select * into v_tm from public.tribe_members x
       where x.person_id = k.r_person and x.status = 'active' order by x.joined_at desc nulls last limit 1;
      if v_tm.id is not null and not public.reach_had_series(k.r_person, v_tm.season_id, false) then
        insert into public.reach_enrolments (person_id, tribe_id, tm_id, season_id, kind, status, outcome, started_at, first_go_until, email_days, release_days, ended_at)
        values (k.r_person, v_tm.tribe_id, v_tm.id, v_tm.season_id, coalesce(public.reach_number_kind(k.r_person), 'no_number'), 'ended', 'email_only',
                now(), now(), public.reach_email_days(6), 6, now());
      end if;
    end if;
  end if;
  perform public.write_event(k.r_person, 'reach.email_instead', 'person', k.r_person::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- An expired link: one email with a fresh one. Not more than three a day for one person, and only to someone who may be written to.
create function public.worker_reach_new_link(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  t public.tribes%rowtype;
  v_link text;
  v_msg uuid;
  v_n integer;
begin
  perform public.worker_ok(p_token);
  select * into k from public.reach_link_open(p_link);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if public.is_minor(k.r_person) or public.message_blocker(k.r_person) is not null then
    return jsonb_build_object('ok', true);
  end if;
  select count(*) into v_n from public.reach_links l where l.person_id = k.r_person and l.source = 'again' and l.created_at > now() - interval '1 day';
  if v_n >= 3 or public.reach_number_kind(k.r_person) is null then
    return jsonb_build_object('ok', true);
  end if;
  select * into t from public.tribes x where x.id = k.r_tribe;
  v_link := public.reach_link_mint(k.r_person, k.r_tribe, null, 'again', null);
  v_msg := public.enqueue_message(k.r_person, 'reach_new_link', jsonb_build_object('leader_first', case when t.id is not null then public.first_name_of(t.leader_id) end),
    k.r_tribe, 'reach-again:' || encode(sha256(convert_to(v_link, 'UTF8')), 'hex'), now(), 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- "Yes, I'm in" (the placed page): the same two boxes, shown only when the member has a number or a yes to put right. The member has just been placed,
-- so Contact gaps may still call the contact "not open"; this looks only at the number and the yes.
create function public.worker_placed_reach(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
  v_kind text;
  v_phone text;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('gap', null);
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  if tm.status <> 'active' or public.reach_state_of(tm.person_id) <> 'on' then
    return jsonb_build_object('gap', null);
  end if;
  v_kind := public.reach_number_kind(tm.person_id);
  if v_kind is null then
    return jsonb_build_object('gap', null);
  end if;
  v_phone := (select cp.phone from public.contact_preferences cp where cp.person_id = tm.person_id);
  return jsonb_build_object('gap', v_kind,
    'number', case when v_phone is not null and not public.number_looks_made_up(v_phone) then public.reach_mask(v_phone) end,
    'signin', public.reach_mask(public.reach_signin_number(tm.person_id)));
end;
$$;

create function public.worker_placed_reach_save(p_token text, p_link text, p_phone text, p_whatsapp boolean, p_use_signin boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
  v jsonb;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  if tm.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v := public.reach_apply_number(tm.person_id, p_phone, p_whatsapp, p_use_signin);
  perform public.reach_close_if_fixed(tm.person_id, null);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- What a leader sees and does
-- ---------------------------------------------------------------------------
-- The state of one person in one tribe, for the strip. Names, never reasons, never numbers.
--   reachable   a leader can message them on WhatsApp
--   to_ask      has a gap and has not been asked: they get email 1 when the leader presses Ask my members, or by themselves after the first go
--   first_go    in the series and email 1 has not gone yet
--   asked       in the series, email n of 4 has gone
--   follow_up   the leader said they will follow this person up
--   email_only  chose "Email me instead"
--   asked_out   asked four times and nothing changed: ask in person, or use the tribe note
--   other       cannot be asked (not open yet, "Don't share", cannot be emailed, a care follow-up, on the placement clock): not listed
create function public.reach_person_status(p_person uuid, p_tm uuid, p_season uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cause text := public.contact_gap_cause_of(p_person, p_tm);
  e public.reach_enrolments%rowtype;
begin
  if public.is_minor(p_person) or coalesce(public.message_blocker(p_person), '') in ('under18', 'deletion') then
    return jsonb_build_object('status', 'skip');
  end if;
  if v_cause is null then
    return jsonb_build_object('status', 'reachable');
  end if;
  if v_cause not in ('no_number', 'made_up', 'no_yes') then
    return jsonb_build_object('status', 'other');
  end if;
  select * into e from public.reach_enrolments x
   where x.person_id = p_person and not x.rehearsal and x.season_id is not distinct from p_season
   order by (x.status = 'active') desc, x.started_at desc limit 1;
  if found and e.status = 'active' then
    if e.paused_until is not null and e.paused_until > now() then
      return jsonb_build_object('status', 'follow_up', 'until', e.paused_until);
    end if;
    if e.sends = 0 then
      return jsonb_build_object('status', 'first_go', 'until', e.first_go_until);
    end if;
    return jsonb_build_object('status', 'asked', 'email', e.sends, 'follow_up_used', e.follow_up_used);
  end if;
  if found and e.outcome = 'email_only' then
    return jsonb_build_object('status', 'email_only');
  end if;
  if found and e.outcome in ('seen_not_done', 'silent') then
    return jsonb_build_object('status', 'asked_out');
  end if;
  if found and e.outcome in ('not_reached') then
    return jsonb_build_object('status', 'other');
  end if;
  if public.reach_block_of(p_person, p_tm) is not null then
    return jsonb_build_object('status', 'other');
  end if;
  return jsonb_build_object('status', 'to_ask');
end;
$$;

-- The strip for one tribe: how many can be messaged on WhatsApp, who is being asked, and what the leader can do. Only for those who run the tribe.
create function public.tribe_reach(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tribes%rowtype;
  s public.reach_settings%rowtype;
  v_roster jsonb;
  v_series boolean;
  v_note text;
  m record;
  v_tm uuid;
  v_st jsonb;
  v_people jsonb := '[]'::jsonb;
  v_adults integer := 0;
  v_reachable integer := 0;
  v_ask integer := 0;
  v_names jsonb := '[]'::jsonb;
  v_next timestamptz;
  v_used integer;
  v_recipients integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_roster := public.tribe_roster(p_tribe);
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.reach_settings x where x.id;
  v_series := public.feature_state_of('reach_series', uid) = 'on';
  v_note := public.feature_state_of('tribe_note', uid);
  if not v_series and v_note = 'off' then
    return jsonb_build_object('on', false, 'note', jsonb_build_object('state', 'off'));
  end if;
  for m in select (e ->> 'person_id')::uuid as pid from jsonb_array_elements(v_roster -> 'members') e loop
    select x.id into v_tm from public.tribe_members x where x.person_id = m.pid and x.tribe_id = p_tribe and x.status = 'active' limit 1;
    continue when v_tm is null;
    v_st := public.reach_person_status(m.pid, v_tm, t.season_id);
    continue when v_st ->> 'status' = 'skip';
    v_adults := v_adults + 1;
    if public.message_blocker(m.pid) is null then
      v_recipients := v_recipients + 1;
    end if;
    if v_st ->> 'status' = 'reachable' then
      v_reachable := v_reachable + 1;
    elsif v_st ->> 'status' <> 'other' then
      v_people := v_people || (jsonb_build_object('person_id', m.pid, 'first_name', public.first_name_of(m.pid)) || v_st);
      if v_st ->> 'status' in ('to_ask', 'first_go') then
        v_ask := v_ask + 1;
        v_names := v_names || to_jsonb(public.first_name_of(m.pid));
      end if;
    end if;
  end loop;
  select count(*) into v_used from public.tribe_notes b where b.tribe_id = p_tribe and not b.rehearsal and b.at > now() - interval '7 days';
  -- The next note can go when enough of the week's notes have aged out: the oldest one that still counts, plus seven days
  if v_used >= s.note_per_week then
    select n.at + interval '7 days' into v_next from public.tribe_notes n
     where n.tribe_id = p_tribe and not n.rehearsal and n.at > now() - interval '7 days'
     order by n.at asc offset (v_used - s.note_per_week) limit 1;
  else
    v_next := null;
  end if;
  return jsonb_build_object(
    'on', v_series,
    'adults', v_adults, 'reachable', v_reachable, 'people', v_people,
    'ask', jsonb_build_object(
      'count', v_ask, 'names', v_names,
      'next_at', (select max(a.at) + interval '3 days' from public.reach_leader_asks a where a.tribe_id = p_tribe and a.at > now() - interval '3 days'),
      'can', v_series and v_ask > 0 and not exists (select 1 from public.reach_leader_asks a where a.tribe_id = p_tribe and a.at > now() - interval '3 days')),
    'note', jsonb_build_object(
      'state', v_note, 'limit', s.note_per_week, 'used', v_used,
      'next_at', v_next,
      'recipients', v_recipients,
      'can', v_note <> 'off' and v_used < s.note_per_week and t.status <> 'closed'));
end;
$$;

-- The leader's button: email 1 goes now, in the leader's name, with their own line, to everyone in the tribe who has been put in the series and not yet
-- asked. A person who has a gap and was not yet in the series is put in first. Once for a tribe in three days.
create function public.reach_ask_tribe(p_tribe uuid, p_line text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tribes%rowtype;
  v_line text := nullif(btrim(regexp_replace(coalesce(p_line, ''), '\s+', ' ', 'g')), '');
  v_roster jsonb;
  m record;
  e record;
  v_tm uuid;
  v_sent integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (t.leader_id = uid or coalesce(t.assistant_id = uid, false) or coalesce(t.coach_id = uid, false)) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  if public.feature_state_of('reach_series', uid) <> 'on' then
    raise exception 'Asking your members by email is not switched on' using errcode = '22023';
  end if;
  if v_line is not null and char_length(v_line) > 200 then
    raise exception 'Keep your line to 200 characters or fewer' using errcode = '22023';
  end if;
  if v_line is not null and v_line ~* '(https?://|www\.|@)' then
    raise exception 'Please leave links and addresses out. The email carries its own button' using errcode = '22023';
  end if;
  if exists (select 1 from public.reach_leader_asks a where a.tribe_id = p_tribe and a.at > now() - interval '3 days') then
    raise exception 'This tribe was asked in the last three days. Please wait' using errcode = '22023';
  end if;
  v_roster := public.tribe_roster(p_tribe);
  for m in select (j ->> 'person_id')::uuid as pid from jsonb_array_elements(v_roster -> 'members') j loop
    select x.id into v_tm from public.tribe_members x where x.person_id = m.pid and x.tribe_id = p_tribe and x.status = 'active' limit 1;
    continue when v_tm is null;
    continue when public.reach_state_of(m.pid) <> 'on';
    continue when public.reach_gap_kind(m.pid, v_tm) is null;
    continue when public.reach_block_of(m.pid, v_tm) is not null;
    continue when public.reach_had_series(m.pid, t.season_id, false);
    perform public.reach_enrol(v_tm, false);
  end loop;
  for e in select x.id from public.reach_enrolments x
            where x.tribe_id = p_tribe and x.status = 'active' and not x.rehearsal and x.sends = 0 loop
    if public.reach_step(e.id, true, v_line, uid) = 'sent' then
      v_sent := v_sent + 1;
    end if;
  end loop;
  if v_sent = 0 then
    raise exception 'There is nobody to ask right now' using errcode = '22023';
  end if;
  insert into public.reach_leader_asks (tribe_id, by_person, line, sent) values (p_tribe, uid, v_line, v_sent);
  perform public.write_event(uid, 'reach.ask', 'tribe', p_tribe::text, jsonb_build_object('sent', v_sent));
  return jsonb_build_object('ok', true, 'sent', v_sent);
end;
$$;

-- "I'll follow this up myself": the emails to this person wait three days, once, and then carry on with the days they had left.
create function public.reach_follow_up(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  e public.reach_enrolments%rowtype;
  t public.tribes%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into e from public.reach_enrolments x where x.person_id = p_person and x.status = 'active' and not x.rehearsal for update;
  if not found then
    raise exception 'There is no email series running for this person' using errcode = '22023';
  end if;
  select * into t from public.tribes x where x.id = e.tribe_id;
  if not (t.leader_id = uid or coalesce(t.assistant_id = uid, false)) then
    raise exception 'You do not lead this person' using errcode = '42501';
  end if;
  if public.feature_state_of('reach_series', uid) <> 'on' then
    raise exception 'Asking your members by email is not switched on' using errcode = '22023';
  end if;
  if e.follow_up_used then
    raise exception 'You have already used your follow-up for this person' using errcode = '22023';
  end if;
  update public.reach_enrolments set follow_up_used = true, paused_at = now(), paused_until = now() + interval '3 days' where id = e.id;
  perform public.write_event(uid, 'reach.follow_up', 'person', p_person::text, jsonb_build_object('tribe', e.tribe_id));
  return jsonb_build_object('ok', true, 'until', now() + interval '3 days');
end;
$$;

-- The tribe note. One email to everyone in the tribe the leader can see and who may be written to, sent by the church office in the leader's name.
-- Words only: no links (the church office is the sender, so a link would be the church's), not more than the weekly limit for the tribe.
create function public.tribe_note_send(p_tribe uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.tribes%rowtype;
  s public.reach_settings%rowtype;
  v_state text;
  v_body text := btrim(regexp_replace(replace(coalesce(p_body, ''), E'\r', ''), E'[ \t]+', ' ', 'g'));
  v_roster jsonb;
  v_id uuid := gen_random_uuid();
  v_rehearsal boolean;
  m record;
  v_tm uuid;
  v_link text;
  v_msg uuid;
  v_kind text;
  v_sent integer := 0;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (t.leader_id = uid or coalesce(t.assistant_id = uid, false)) then
    raise exception 'Only the leader or their assistant can write to the tribe' using errcode = '42501';
  end if;
  v_state := public.feature_state_of('tribe_note', uid);
  if v_state = 'off' then
    raise exception 'Writing to the whole tribe is not switched on' using errcode = '22023';
  end if;
  v_rehearsal := v_state = 'rehearsal';
  if t.status = 'closed' then
    raise exception 'This tribe has finished' using errcode = '22023';
  end if;
  if char_length(v_body) < 1 then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if char_length(v_body) > 600 then
    raise exception 'Keep the note to 600 characters or fewer' using errcode = '22023';
  end if;
  if v_body ~* '(https?://|www\.)' then
    raise exception 'Please leave links out. Your tribe''s meeting details are on its page' using errcode = '22023';
  end if;
  select * into s from public.reach_settings x where x.id;
  if (select count(*) from public.tribe_notes n where n.tribe_id = p_tribe and not n.rehearsal and n.at > now() - interval '7 days') >= s.note_per_week and not v_rehearsal then
    raise exception 'This tribe has had its notes for the week. Please wait' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribe_notes n where n.tribe_id = p_tribe and n.by_person = uid and n.body = v_body and n.at > now() - interval '10 minutes') then
    raise exception 'That note was just sent' using errcode = '22023';
  end if;
  v_roster := public.tribe_roster(p_tribe);
  insert into public.tribe_notes (id, tribe_id, by_person, body, rehearsal) values (v_id, p_tribe, uid, v_body, v_rehearsal);
  for m in select (j ->> 'person_id')::uuid as pid from jsonb_array_elements(v_roster -> 'members') j loop
    continue when m.pid = uid;
    continue when public.is_minor(m.pid) or public.message_blocker(m.pid) is not null;
    select x.id into v_tm from public.tribe_members x where x.person_id = m.pid and x.tribe_id = p_tribe and x.status = 'active' limit 1;
    continue when v_tm is null;
    v_sent := v_sent + 1;
    continue when v_rehearsal;
    -- A member who still has a gap finds the Add my number link under the note
    v_kind := case when public.reach_state_of(m.pid) = 'on' then public.reach_gap_kind(m.pid, v_tm) end;
    v_link := case when v_kind is not null then public.reach_link_mint(m.pid, p_tribe, null, 'note', null) end;
    v_msg := public.enqueue_message(m.pid, 'tribe_note',
      jsonb_build_object('leader_first', public.first_name_of(uid), 'tribe', t.name, 'body', v_body, 'gap', v_kind),
      p_tribe, 'tribe-note:' || v_id::text || ':' || m.pid::text, now(), 'normal', 'email');
    if v_msg is not null and v_link is not null then
      update public.messages set reply_token = v_link where id = v_msg;
    end if;
  end loop;
  update public.tribe_notes set recipients = v_sent where id = v_id;
  perform public.write_event(uid, 'tribe_note.sent', 'tribe', p_tribe::text, jsonb_build_object('recipients', v_sent, 'rehearsal', v_rehearsal));
  return jsonb_build_object('ok', true, 'sent', v_sent, 'rehearsal', v_rehearsal);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the office sees and does (Contact gaps, extended)
-- ---------------------------------------------------------------------------
-- Where one person stands in the series, in one object: state, emails sent, and the moments the page turns into words. Never a number.
--   in_series, rehearsal, email_only, seen_not_done, silent, not_reached, stopped, not_in_series
create function public.reach_series_of(p_person uuid, p_season uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
  st text;
begin
  select * into e from public.reach_enrolments x
   where x.person_id = p_person and x.season_id is not distinct from p_season
   order by x.rehearsal, (x.status = 'active') desc, x.started_at desc limit 1;
  if not found or e.outcome = 'rehearsal_over' then
    return jsonb_build_object('state', case when coalesce(public.message_blocker(p_person), '') in ('bounced', 'email_off') then 'not_reached' else 'not_in_series' end, 'sends', 0);
  end if;
  st := case when e.rehearsal then 'rehearsal'
             when e.status = 'active' then 'in_series'
             when e.outcome = 'email_only' then 'email_only'
             when e.outcome = 'seen_not_done' then 'seen_not_done'
             when e.outcome = 'silent' then 'silent'
             when e.outcome = 'not_reached' then 'not_reached'
             when e.outcome = 'stopped' then 'stopped'
             else 'not_in_series' end;
  return jsonb_build_object('state', st, 'sends', e.sends, 'started_at', e.started_at, 'first_go_until', e.first_go_until, 'day0_at', e.day0_at,
    'following_up', e.paused_until is not null and e.paused_until > now(), 'frozen', e.frozen_at is not null, 'ended_at', e.ended_at);
end;
$$;

-- Ask history now includes the series: an email of the series is an ask. (A person is not asked twice in 14 days, or more than three times, by
-- anything else once the series has been at them.)
create or replace function public.contact_ask_history(p_person uuid)
returns table (n integer, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, max(x.at)
    from (select a.created_at as at from public.contact_asks a where a.person_id = p_person
          union all
          select coalesce(r.released_at, b.approved_at, b.scheduled_for, now())
            from public.broadcast_recipients r
            join public.broadcasts b on b.id = r.broadcast_id
           where r.person_id = p_person and b.audience ->> 'kind' = 'cannot_reach'
             and r.status in ('pending', 'queued') and b.status in ('scheduled', 'sending', 'paused', 'sent')
          union all
          select rs.at
            from public.reach_sends rs
            join public.reach_enrolments e on e.id = rs.enrolment_id
           where e.person_id = p_person and rs.status = 'sent') x;
$$;

-- The leader's one-person button (fix 13), unchanged except that a person already in the series is asked by the series, not twice.
create or replace function public.contact_ask_send(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_tm uuid;
  v_tribe uuid;
  v_cause text;
  v_kind text;
  v_blocker text;
  v_id bigint;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') <> 'on' then
    raise exception 'Asking for a number is not switched on' using errcode = '22023';
  end if;
  select cm.id, cm.tribe_id into v_tm, v_tribe
    from public.tribe_members cm
    join public.tribes t on t.id = cm.tribe_id
    join public.seasons se on se.id = t.season_id
   where cm.person_id = p_person and cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed'
     and uid in (t.leader_id, t.assistant_id, t.coach_id)
   order by cm.joined_at desc nulls last, cm.id limit 1;
  if v_tm is null then
    raise exception 'You do not lead this person' using errcode = '42501';
  end if;
  -- (new) a person the series is already asking is not asked twice
  if exists (select 1 from public.reach_enrolments e where e.person_id = p_person and e.status = 'active' and not e.rehearsal) then
    raise exception 'They are already being asked by email. Please wait, or ask them in person' using errcode = '22023';
  end if;
  v_cause := public.contact_gap_cause_of(p_person, v_tm);
  if v_cause = 'unreachable' then
    raise exception 'We cannot email them. Please ask them in person' using errcode = '22023';
  end if;
  if v_cause is null or v_cause not in ('no_number', 'made_up', 'no_yes') then
    raise exception 'There is nothing to ask this person for' using errcode = '22023';
  end if;
  v_kind := case when v_cause = 'no_yes' then 'no_yes' else 'no_number' end;
  v_blocker := coalesce(public.contact_ask_blocker(p_person), public.message_blocker(p_person));
  if v_blocker = 'asked_recently' then
    raise exception 'They were asked in the last two weeks. Please wait, or ask them in person' using errcode = '22023';
  elsif v_blocker = 'asked_enough' then
    raise exception 'They have been asked three times already. Please ask them in person' using errcode = '22023';
  elsif v_blocker is not null then
    raise exception 'We cannot email them. Please ask them in person' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_asks a where a.by_person = uid and a.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is 20 requests today. Try again tomorrow' using errcode = '22023';
  end if;
  insert into public.contact_asks (person_id, kind, by_person, tribe_id) values (p_person, v_kind, uid, v_tribe) returning id into v_id;
  perform public.enqueue_message(p_person, 'contact_ask_leader',
    jsonb_build_object('leader_first', public.first_name_of(uid), 'kind', v_kind),
    v_tribe, 'contact-ask:' || v_id::text, null, 'normal', 'email');
  perform public.write_event(uid, 'contact.ask', 'person', p_person::text, jsonb_build_object('kind', v_kind, 'tribe', v_tribe));
  return jsonb_build_object('ok', true, 'kind', v_kind);
end;
$$;

-- The office list, with the series: where each person is, filters, and what the series has done so far. One more optional filter at the end.
drop function public.contact_gaps_report(text, uuid, uuid, integer, integer);
create function public.contact_gaps_report(
  p_cause text default null, p_tribe uuid default null, p_community uuid default null, p_limit integer default 100, p_offset integer default 0,
  p_series text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := public.feature_platform_state('contact_gaps');
  v_role text := public.contact_gaps_role();
  v_centre uuid := public.my_centre();
  v_counts jsonb;
  v_scounts jsonb;
  v_adults integer;
  v_total integer;
  v_rows jsonb;
  v_trend jsonb;
  v_stats jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_state = 'off' then
    return jsonb_build_object('state', 'off', 'role', v_role);
  end if;
  if p_cause is not null and p_cause not in ('no_number', 'no_yes', 'made_up', 'unreachable', 'withheld', 'not_open') then
    raise exception 'Choose a cause from the list' using errcode = '22023';
  end if;
  if p_series is not null and p_series not in ('in_series', 'rehearsal', 'email_only', 'seen_not_done', 'silent', 'not_reached', 'stopped', 'not_in_series') then
    raise exception 'Choose a stage from the list' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(c.cause, c.n), '{}'::jsonb) into v_counts
    from (select g.cause, count(*)::integer as n from public.contact_gap_rows(v_centre) g group by g.cause) c;
  select count(distinct cm.person_id)::integer into v_adults
    from public.tribe_members cm
    join public.tribes t on t.id = cm.tribe_id
    join public.seasons se on se.id = t.season_id
    join public.people p on p.id = cm.person_id
   where cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed' and p.centre_id = v_centre
     and not public.is_minor(cm.person_id)
     and coalesce(public.message_blocker(cm.person_id), '') not in ('under18', 'deletion');

  with g as materialized (
         select r.*, public.reach_series_of(r.person_id, (select tm.season_id from public.tribe_members tm where tm.id = r.tm_id)) as ser
           from public.contact_gap_rows(v_centre) r),
       f as (select g.* from g
              where (p_cause is null or g.cause = p_cause)
                and (p_tribe is null or g.tribe_id = p_tribe)
                and (p_series is null or g.ser ->> 'state' = p_series)
                and (p_community is null or exists (select 1 from public.member_profiles mp where mp.person_id = g.person_id and mp.community_id = p_community)))
  select (select count(*)::integer from f),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'person_id', y.person_id, 'name', y.name, 'tribe_id', y.tribe_id, 'tribe', y.tribe, 'leader', y.leader,
                     'cause', y.cause, 'asks', y.asks, 'last_asked', y.last_asked, 'series', y.ser) order by y.rank, y.tribe, y.name)
                     from (select f.person_id, public.person_display_name(f.person_id) as name, f.tribe_id, t.name as tribe,
                                  public.first_name_of(t.leader_id) as leader, f.cause, h.n as asks, h.last_at as last_asked, f.ser,
                                  case f.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4
                                               when 'not_open' then 5 else 6 end as rank
                             from f join public.tribes t on t.id = f.tribe_id
                            cross join lateral public.contact_ask_history(f.person_id) h
                            order by rank, tribe, name
                            limit v_limit offset v_offset) y), '[]'::jsonb),
         coalesce((select jsonb_object_agg(z.st, z.n) from (select g.ser ->> 'state' as st, count(*)::integer as n from g group by 1) z), '{}'::jsonb)
    into v_total, v_rows, v_scounts;

  -- What the series has done so far, for real (a Rehearsal is not counted): started, and how each ended, and which email fixed it
  select jsonb_build_object(
           'started', count(*)::integer,
           'running', count(*) filter (where e.status = 'active')::integer,
           'fixed', count(*) filter (where e.outcome = 'fixed')::integer,
           'email_only', count(*) filter (where e.outcome = 'email_only')::integer,
           'seen_not_done', count(*) filter (where e.outcome = 'seen_not_done')::integer,
           'silent', count(*) filter (where e.outcome = 'silent')::integer,
           'not_reached', count(*) filter (where e.outcome = 'not_reached')::integer,
           'fixed_by', jsonb_build_object(
             'before', count(*) filter (where e.outcome = 'fixed' and e.fixed_by_email is null)::integer,
             '1', count(*) filter (where e.outcome = 'fixed' and e.fixed_by_email = 1)::integer,
             '2', count(*) filter (where e.outcome = 'fixed' and e.fixed_by_email = 2)::integer,
             '3', count(*) filter (where e.outcome = 'fixed' and e.fixed_by_email = 3)::integer,
             '4', count(*) filter (where e.outcome = 'fixed' and e.fixed_by_email = 4)::integer))
    into v_stats
    from public.reach_enrolments e
    join public.people p on p.id = e.person_id
   where not e.rehearsal and e.outcome is distinct from 'rehearsal_over' and p.centre_id = v_centre;

  -- Today's counts, kept for the trend (the last time the list is opened in a day wins)
  insert into public.contact_gap_days (day, counts, adults) values (public.today_lagos(), v_counts, v_adults)
  on conflict (day) do update set counts = excluded.counts, adults = excluded.adults, made_at = now();
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'counts', d.counts, 'adults', d.adults) order by d.day), '[]'::jsonb) into v_trend
    from (select * from public.contact_gap_days order by day desc limit 30) d;

  if p_cause is null and p_tribe is null and p_community is null and p_series is null and v_offset = 0 then
    perform public.write_event(auth.uid(), 'contact_gaps.viewed', 'contact_gaps', null, jsonb_build_object('state', v_state));
  end if;
  return jsonb_build_object('state', v_state, 'role', v_role, 'counts', v_counts, 'adults', v_adults, 'total', v_total, 'rows', v_rows, 'trend', v_trend,
                            'limit', v_limit, 'offset', v_offset,
                            'series_counts', v_scounts, 'series_stats', v_stats,
                            'series_switch', public.feature_summary('reach_series'),
                            'series_paused', (select s.paused from public.reach_settings s where s.id));
end;
$$;

-- The whole list for the download: names, tribe, leader, cause, how often asked, where each stands in the series. Never a number.
create or replace function public.contact_gaps_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.contact_gaps_role() is distinct from 'act' then
    raise exception 'Your role does not include this file' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') = 'off' then
    raise exception 'Contact gaps is switched Off' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', y.name, 'tribe', y.tribe, 'leader', y.leader, 'cause', y.cause, 'asks', y.asks, 'last_asked', y.last_asked,
           'series', y.ser ->> 'state', 'emails', coalesce((y.ser ->> 'sends')::integer, 0))
           order by y.rank, y.tribe, y.name), '[]'::jsonb) into v_rows
    from (select public.person_display_name(g.person_id) as name, t.name as tribe, public.first_name_of(t.leader_id) as leader, g.cause,
                 h.n as asks, h.last_at as last_asked,
                 public.reach_series_of(g.person_id, (select tm.season_id from public.tribe_members tm where tm.id = g.tm_id)) as ser,
                 case g.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4 when 'not_open' then 5 else 6 end as rank
            from public.contact_gap_rows(public.my_centre()) g
            join public.tribes t on t.id = g.tribe_id
           cross join lateral public.contact_ask_history(g.person_id) h) y;
  perform public.write_event(auth.uid(), 'contact_gaps.exported', 'contact_gaps', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- The office's pause for the whole series. Nothing is lost: every running series keeps the days it had left and carries on when it is lifted.
create function public.reach_series_pause(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.contact_gaps_role() is distinct from 'act' then
    raise exception 'Your role does not include this' using errcode = '42501';
  end if;
  if p_paused is null then
    raise exception 'Choose pause or resume' using errcode = '22023';
  end if;
  if p_paused and (v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300) then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  update public.reach_settings
     set paused = p_paused, paused_reason = case when p_paused then v_reason end, paused_by = auth.uid(), paused_at = now()
   where id;
  perform public.write_event(auth.uid(), case when p_paused then 'reach.paused' else 'reach.resumed' end, 'contact_gaps', null, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true, 'paused', p_paused);
end;
$$;

-- Stops the series for one person. They are not asked again this season.
create function public.reach_series_stop(p_person uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  r record;
  v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.contact_gaps_role() is distinct from 'act' then
    raise exception 'Your role does not include this' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.people p where p.id = p_person and p.centre_id = public.my_centre()) then
    raise exception 'That person does not exist' using errcode = 'P0002';
  end if;
  for r in select e.id from public.reach_enrolments e where e.person_id = p_person and e.status = 'active' loop
    perform public.reach_end(r.id, 'stopped', auth.uid(), v_reason);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'There is no series running for this person' using errcode = '22023';
  end if;
  perform public.write_event(auth.uid(), 'reach.stopped', 'person', p_person::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's settings (God Mode)
-- ---------------------------------------------------------------------------
create function public.god_reach_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reach_settings%rowtype;
begin
  perform public.god_only();
  select * into s from public.reach_settings x where x.id;
  return jsonb_build_object('first_go_hours', s.first_go_hours, 'release_after_days', s.release_after_days, 'end_mode', s.end_mode,
    'note_per_week', s.note_per_week, 'paused', s.paused, 'paused_reason', s.paused_reason, 'reason', s.reason, 'changed_at', s.changed_at,
    'email_days', to_jsonb(public.reach_email_days(s.release_after_days)));
end;
$$;

create function public.god_reach_settings_set(p_first_go integer, p_release integer, p_end_mode text, p_note_per_week integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  o public.reach_settings%rowtype;
begin
  perform public.god_only();
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_first_go is null or p_first_go < 0 or p_first_go > 72 then
    raise exception 'The leader''s first go is 0 to 72 hours' using errcode = '22023';
  end if;
  if p_release is null or p_release < 4 or p_release > 10 then
    raise exception 'The series lasts 4 to 10 days' using errcode = '22023';
  end if;
  if p_end_mode is null or p_end_mode not in ('silent', 'everyone', 'list') then
    raise exception 'Choose what happens at the end of the series' using errcode = '22023';
  end if;
  if p_note_per_week is null or p_note_per_week < 1 or p_note_per_week > 4 then
    raise exception 'A tribe can have 1 to 4 notes a week' using errcode = '22023';
  end if;
  select * into o from public.reach_settings x where x.id for update;
  update public.reach_settings
     set first_go_hours = p_first_go, release_after_days = p_release, end_mode = p_end_mode, note_per_week = p_note_per_week,
         reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'reach.settings', 'contact_gaps', null,
    jsonb_build_object('reason', v_reason,
      'from', jsonb_build_object('first_go', o.first_go_hours, 'release', o.release_after_days, 'end', o.end_mode, 'notes', o.note_per_week),
      'to', jsonb_build_object('first_go', p_first_go, 'release', p_release, 'end', p_end_mode, 'notes', p_note_per_week)));
  return public.god_reach_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.reach_email_days(integer),
  public.reach_mask(text),
  public.reach_signin_number(uuid),
  public.reach_number_kind(uuid),
  public.reach_gap_kind(uuid, uuid),
  public.reach_block_of(uuid, uuid),
  public.reach_state_of(uuid),
  public.reach_window_ok(),
  public.reach_link_mint(uuid, uuid, uuid, text, integer),
  public.reach_link_open(text),
  public.reach_end(uuid, text, uuid, text, integer),
  public.reach_enrol(uuid, boolean),
  public.reach_had_series(uuid, uuid, boolean),
  public.reach_enrol_sweep(integer),
  public.reach_send(uuid, integer, text, uuid),
  public.reach_step(uuid, boolean, text, uuid),
  public.reach_series_tick(),
  public.reach_apply_number(uuid, text, boolean, boolean),
  public.reach_close_if_fixed(uuid, integer),
  public.reach_person_status(uuid, uuid, uuid),
  public.reach_series_of(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function
  public.tribe_reach(uuid),
  public.reach_ask_tribe(uuid, text),
  public.reach_follow_up(uuid),
  public.tribe_note_send(uuid, text),
  public.contact_gaps_report(text, uuid, uuid, integer, integer, text),
  public.reach_series_pause(boolean, text),
  public.reach_series_stop(uuid, text),
  public.god_reach_settings(),
  public.god_reach_settings_set(integer, integer, text, integer, text)
  from public, anon;

grant execute on function
  public.tribe_reach(uuid),
  public.reach_ask_tribe(uuid, text),
  public.reach_follow_up(uuid),
  public.tribe_note_send(uuid, text),
  public.contact_gaps_report(text, uuid, uuid, integer, integer, text),
  public.reach_series_pause(boolean, text),
  public.reach_series_stop(uuid, text),
  public.god_reach_settings(),
  public.god_reach_settings_set(integer, integer, text, integer, text)
  to authenticated;

revoke execute on function
  public.worker_reach_tick(text),
  public.worker_reach_info(text, text),
  public.worker_reach_save(text, text, text, boolean, boolean),
  public.worker_reach_email_instead(text, text),
  public.worker_reach_new_link(text, text),
  public.worker_placed_reach(text, text),
  public.worker_placed_reach_save(text, text, text, boolean, boolean)
  from public, anon, authenticated;

grant execute on function
  public.worker_reach_tick(text),
  public.worker_reach_info(text, text),
  public.worker_reach_save(text, text, text, boolean, boolean),
  public.worker_reach_email_instead(text, text),
  public.worker_reach_new_link(text, text),
  public.worker_placed_reach(text, text),
  public.worker_placed_reach_save(text, text, text, boolean, boolean)
  to anon;

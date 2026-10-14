-- United Tribes, Round 2, Phase 6: sign in with a code on WhatsApp or email, with brakes.
--
-- What this adds. Sign-in with a WhatsApp code already works (the "Send SMS" hook sends it). This file adds the
-- barriers around it, and the settings the office uses to run it:
--
--   signin_settings        one row: the kill switch, the limits, normal or reply-first mode, the circuit breaker
--   signin_attempts        one row per code asked for. Only salted hashes and outcomes: never a number, never a code
--   signin_pending         a code held for a person who has not yet messaged first (reply-first mode). Sealed, short-lived
--   signin_blocks          numbers that replied STOP or "not me": no codes to them for 30 days
--   signin_events          every time the breaker tripped or was reset, and every change a person made
--
-- Rules this file enforces in the database itself (the app cannot skip them by calling the API directly):
--   * Limits are checked in ONE place, under a lock, so a flood of simultaneous requests cannot slip past them:
--     per number (3 in 15 minutes, 8 a day, and a wait that grows 1, 2, then 5 minutes), per network per hour,
--     and a ceiling for the whole channel (20 an hour, 150 a day). Only the director can raise the ceiling.
--   * The circuit breaker trips by itself (failed sends, refusals, no delivery receipts, the sending number
--     logged out or restricted, a run of STOP / "not me") and never restarts by itself: a person turns it back on.
--   * A number that said STOP or "not me" gets no codes for 30 days.
--   * Email is a separate road. Nothing here can switch email sign-in off.
--   * Nothing is dropped and no existing row changes. The kill switch ships ON because WhatsApp sign-in only
--     appears on the screen when the website's own setting (WHATSAPP_SIGNIN=on) says so.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.signin_settings (
  id boolean primary key default true check (id),
  -- The kill switch. Off: no WhatsApp codes at all. Email sign-in is never affected.
  whatsapp_on boolean not null default true,
  -- How the ordinary-number sender behaves. normal: send the code at once. reply_first: send it only after the
  -- person has messaged the number first (the safer way to run an ordinary number). The official route ignores this.
  mode text not null default 'reply_first' check (mode in ('normal', 'reply_first')),
  -- Per number
  cap_number_15m smallint not null default 3 check (cap_number_15m between 1 and 10),
  cap_number_day smallint not null default 8 check (cap_number_day between 1 and 30),
  -- The wait before the next code to the same number: after the first, after the second, after the third and later (seconds)
  gap_1_s integer not null default 60 check (gap_1_s between 0 and 3600),
  gap_2_s integer not null default 120 check (gap_2_s between 0 and 3600),
  gap_3_s integer not null default 300 check (gap_3_s between 0 and 3600),
  -- Per network (an address on the internet, kept only as a salted hash)
  cap_network_hour smallint not null default 12 check (cap_network_hour between 1 and 500),
  -- The whole channel
  cap_channel_hour integer not null default 20 check (cap_channel_hour between 1 and 2000),
  cap_channel_day integer not null default 150 check (cap_channel_day between 1 and 20000),
  -- Only accept a code asked for on our own sign-in screen (which is where the network limit is applied)
  require_screen boolean not null default true,
  -- The circuit breaker: what it watches, over how long
  breaker_window_min smallint not null default 30 check (breaker_window_min between 10 and 240),
  breaker_min_sends smallint not null default 5 check (breaker_min_sends between 3 and 100),
  breaker_fail_pct smallint not null default 50 check (breaker_fail_pct between 10 and 100),
  breaker_receipt_grace_min smallint not null default 3 check (breaker_receipt_grace_min between 1 and 30),
  breaker_no_receipt_pct smallint not null default 70 check (breaker_no_receipt_pct between 20 and 100),
  breaker_stop_count smallint not null default 3 check (breaker_stop_count between 1 and 50),
  -- How long a held code (reply-first) waits for the person's message. Match the sign-in service's code expiry.
  code_minutes smallint not null default 10 check (code_minutes between 3 and 60),
  -- The breaker itself. Tripped stays tripped until a person resets it.
  breaker_state text not null default 'ok' check (breaker_state in ('ok', 'tripped')),
  breaker_reason text check (char_length(breaker_reason) <= 40),
  breaker_tripped_at timestamptz,
  -- Everything before this has been looked at, so the same failures do not trip it again at once
  breaker_cleared_at timestamptz,
  -- What the sending service last said about itself (only the ordinary-number sender reports this)
  sender_signal text not null default 'unknown' check (sender_signal in ('unknown', 'ok', 'logged_out', 'restricted', 'unreachable')),
  sender_checked_at timestamptz,
  sender_bad_since timestamptz,
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.signin_settings default values;

-- ---------------------------------------------------------------------------
-- One row per code asked for. Hashes and outcomes only.
-- ---------------------------------------------------------------------------

create table public.signin_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Salted hashes made by the website. The database never sees the number or the network itself.
  number_hash text check (number_hash ~ '^[0-9a-f]{64}$'),
  network_hash text check (network_hash ~ '^[0-9a-f]{64}$'),
  flow text not null default 'sign_in' check (flow in ('sign_in', 'add_number')),
  route text not null default 'official' check (route in ('official', 'linked')),
  -- requested        the sign-in screen asked; waiting for the sign-in service to ask us to send
  -- accepted         every check passed; being sent or held
  -- held             reply-first: the code waits for the person's message
  -- sent / delivered / failed / rejected   what happened when it went out
  -- expired          held and never collected, or replaced by a newer code
  -- unmatched        asked for, and no account has that number (the screen said nothing different)
  -- declined_*       stopped by a limit, the kill switch, the breaker, the STOP list, or a request that did not come from our screen
  outcome text not null default 'requested' check (outcome in (
    'requested', 'accepted', 'held', 'sent', 'delivered', 'failed', 'rejected', 'expired', 'unmatched',
    'declined_paused', 'declined_blocked', 'declined_direct', 'declined_wait', 'declined_number', 'declined_channel', 'declined_network')),
  -- Used a place under the limits (it reached a send or a hold)
  counted boolean not null default false,
  detail text check (char_length(detail) <= 80),
  decided_at timestamptz
);
create index signin_attempts_number_idx on public.signin_attempts (number_hash, at desc) where counted;
create index signin_attempts_request_idx on public.signin_attempts (number_hash, at desc) where outcome = 'requested';
create index signin_attempts_network_idx on public.signin_attempts (network_hash, at desc);
create index signin_attempts_at_idx on public.signin_attempts (at desc);
create index signin_attempts_counted_idx on public.signin_attempts (at desc) where counted;

-- A code waiting for the person to message first. Sealed with the website's key; gone after a few minutes.
create table public.signin_pending (
  attempt_id bigint primary key references public.signin_attempts (id) on delete cascade,
  number_hash text not null check (number_hash ~ '^[0-9a-f]{64}$'),
  sealed text not null check (char_length(sealed) between 20 and 400),
  expires_at timestamptz not null
);
create index signin_pending_number_idx on public.signin_pending (number_hash);

-- Numbers that said STOP or "not me"
create table public.signin_blocks (
  number_hash text primary key check (number_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('stop', 'not_me')),
  blocked_at timestamptz not null default now(),
  blocked_until timestamptz not null
);
create index signin_blocks_recent_idx on public.signin_blocks (blocked_at desc);

-- Every trip and reset, and every change a person made
create table public.signin_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('tripped', 'reset', 'switch_on', 'switch_off', 'mode', 'settings')),
  reason text check (char_length(reason) <= 200),
  detail jsonb not null default '{}'::jsonb,
  actor uuid references public.people (id) on delete set null
);
create index signin_events_at_idx on public.signin_events (at desc);

alter table public.signin_settings enable row level security;
alter table public.signin_attempts enable row level security;
alter table public.signin_pending enable row level security;
alter table public.signin_blocks enable row level security;
alter table public.signin_events enable row level security;
revoke all on public.signin_settings, public.signin_attempts, public.signin_pending, public.signin_blocks, public.signin_events
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------

-- Is this person allowed to run WhatsApp sign-in? (the office's data people; the screens use the same list)
create function public.signin_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]);
$$;

create function public.signin_effective_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when not s.whatsapp_on then 'off' when s.breaker_state = 'tripped' then 'paused' else 'on' end
    from public.signin_settings s;
$$;

-- The one thing anyone may ask: is WhatsApp sign-in on, off, or paused? Nothing else is exposed.
create function public.signin_channel_status()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.signin_effective_status();
$$;

-- An email to the people who run this: the roles asked for; if there is nobody in them, the directors; then the admins.
-- Never WhatsApp.
create function public.signin_alert_staff(p_template text, p_params jsonb, p_dedupe text, p_roles public.app_role[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
  n integer := 0;
begin
  select coalesce(array_agg(distinct r.person_id), '{}') into v_ids from public.person_roles r where r.role = any (p_roles);
  if cardinality(v_ids) = 0 then
    select coalesce(array_agg(distinct r.person_id), '{}') into v_ids from public.person_roles r where r.role = 'director';
  end if;
  if cardinality(v_ids) = 0 then
    select coalesce(array_agg(distinct r.person_id), '{}') into v_ids from public.person_roles r where r.role = 'admin';
  end if;
  foreach v_id in array v_ids loop
    if public.enqueue_message(v_id, p_template, p_params, null, p_dedupe || ':' || v_id, null, 'normal', 'email') is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- The circuit breaker
-- ---------------------------------------------------------------------------

-- Pauses WhatsApp codes. Does nothing if it is already tripped. It never turns itself back on.
create function public.signin_trip(p_reason text, p_detail jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event bigint;
begin
  update public.signin_settings
     set breaker_state = 'tripped', breaker_reason = left(p_reason, 40), breaker_tripped_at = now(), updated_at = now()
   where breaker_state = 'ok';
  if not found then
    return false;
  end if;
  insert into public.signin_events (kind, reason, detail) values ('tripped', left(p_reason, 200), coalesce(p_detail, '{}'::jsonb))
    returning id into v_event;
  perform public.signin_alert_staff('signin_paused', jsonb_build_object('reason', p_reason), 'signin_trip:' || v_event,
    array['director', 'data_lead']::public.app_role[]);
  return true;
end;
$$;

-- Looks at the recent past and trips the breaker if it looks wrong. Returns the reason it tripped, or null.
create function public.signin_breaker_check()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
  v_from timestamptz;
  v_sends integer;
  v_failed integer;
  v_rejected integer;
  v_old_sent integer;
  v_no_receipt integer;
  v_stops integer;
  v_reason text := null;
  v_detail jsonb := '{}'::jsonb;
begin
  select * into cfg from public.signin_settings;
  if cfg.breaker_state = 'tripped' then
    return null;
  end if;
  v_from := greatest(now() - make_interval(mins => cfg.breaker_window_min), coalesce(cfg.breaker_cleared_at, '-infinity'::timestamptz));

  select count(*) filter (where a.outcome in ('sent', 'delivered', 'failed', 'rejected')),
         count(*) filter (where a.outcome = 'failed'),
         count(*) filter (where a.outcome = 'rejected')
    into v_sends, v_failed, v_rejected
    from public.signin_attempts a
   where a.counted and a.at >= v_from;

  -- Linked-number sends that should have a delivery receipt by now
  select count(*) filter (where a.outcome in ('sent', 'delivered')),
         count(*) filter (where a.outcome = 'sent')
    into v_old_sent, v_no_receipt
    from public.signin_attempts a
   where a.counted and a.route = 'linked' and a.at >= v_from
     and a.at < now() - make_interval(mins => cfg.breaker_receipt_grace_min);

  select count(*) into v_stops from public.signin_blocks b where b.blocked_at >= v_from;

  if v_sends >= cfg.breaker_min_sends and v_failed * 100 >= cfg.breaker_fail_pct * v_sends then
    v_reason := 'failed_sends';
  elsif v_sends >= cfg.breaker_min_sends and v_rejected * 100 >= cfg.breaker_fail_pct * v_sends then
    v_reason := 'rejections';
  elsif v_old_sent >= cfg.breaker_min_sends and v_no_receipt * 100 >= cfg.breaker_no_receipt_pct * v_old_sent then
    v_reason := 'no_receipts';
  elsif v_stops >= cfg.breaker_stop_count then
    v_reason := 'stop_spike';
  end if;

  if v_reason is not null then
    v_detail := jsonb_build_object('sends', v_sends, 'failed', v_failed, 'rejected', v_rejected,
      'linked_sent', v_old_sent, 'no_receipt', v_no_receipt, 'stops', v_stops, 'window_min', cfg.breaker_window_min);
    perform public.signin_trip(v_reason, v_detail);
  end if;
  return v_reason;
end;
$$;

-- ---------------------------------------------------------------------------
-- The limits: asked by the website, answered here, under one lock
-- ---------------------------------------------------------------------------

-- Step 1, from the sign-in screen's own server route, for every request: is this network asking too often?
-- Records the request so the "Send SMS" hook can tell it came through the screen.
create function public.worker_signin_network_gate(p_token text, p_network_hash text, p_number_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
  v_n integer;
  v_id bigint;
  v_now timestamptz;
begin
  perform public.worker_ok(p_token);
  if p_network_hash !~ '^[0-9a-f]{64}$' or p_number_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad hash' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  v_now := clock_timestamp();
  select * into cfg from public.signin_settings;
  if not cfg.whatsapp_on then
    return jsonb_build_object('decision', 'decline', 'reason', 'off');
  elsif cfg.breaker_state = 'tripped' then
    return jsonb_build_object('decision', 'decline', 'reason', 'paused');
  end if;
  select count(*) into v_n from public.signin_attempts a
   where a.network_hash = p_network_hash and a.at > v_now - interval '1 hour' and a.outcome <> 'declined_network';
  if v_n >= cfg.cap_network_hour then
    insert into public.signin_attempts (network_hash, number_hash, outcome, detail, decided_at)
      values (p_network_hash, p_number_hash, 'declined_network', 'network_hour', now());
    return jsonb_build_object('decision', 'decline', 'reason', 'network');
  end if;
  insert into public.signin_attempts (network_hash, number_hash) values (p_network_hash, p_number_hash) returning id into v_id;
  return jsonb_build_object('decision', 'allow', 'attempt', v_id);
end;
$$;

-- Step 2, from the "Send SMS" hook, once the sign-in service has passed the bot check and found an account:
-- may a code go to this number right now? Every limit is checked here, together, and a place is taken in the same step.
-- A decline is recorded and returned; the hook then answers exactly as it would for a sent code, so nothing it says
-- tells anyone whether a number has an account.
create function public.worker_signin_gate(p_token text, p_number_hash text, p_flow text default 'sign_in', p_route text default 'official')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
  a public.signin_attempts;
  v_n15 integer;
  v_nday integer;
  v_last timestamptz;
  v_hour integer;
  v_chday integer;
  v_gap integer;
  v_reason text := null;
  v_outcome text;
  v_now timestamptz;
begin
  perform public.worker_ok(p_token);
  if p_number_hash !~ '^[0-9a-f]{64}$' or p_flow not in ('sign_in', 'add_number') or p_route not in ('official', 'linked') then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  -- The moment the lock was won, so a crowd queueing for it is judged by the clock, not by when each request began
  v_now := clock_timestamp();
  select * into cfg from public.signin_settings;

  -- The request the sign-in screen made a moment ago (adding a number comes from a signed-in page, not the screen)
  if p_flow = 'sign_in' then
    select * into a from public.signin_attempts x
     where x.number_hash = p_number_hash and x.outcome = 'requested' and x.at > v_now - interval '3 minutes'
     order by x.id desc limit 1 for update;
  end if;

  select count(*) filter (where c.at > v_now - interval '15 minutes'),
         count(*),
         max(c.at)
    into v_n15, v_nday, v_last
    from public.signin_attempts c
   where c.number_hash = p_number_hash and c.counted and c.at > v_now - interval '24 hours';
  select count(*) filter (where c.at > v_now - interval '1 hour'), count(*)
    into v_hour, v_chday
    from public.signin_attempts c where c.counted and c.at > v_now - interval '24 hours';
  v_gap := case when v_nday <= 1 then cfg.gap_1_s when v_nday = 2 then cfg.gap_2_s else cfg.gap_3_s end;

  if not cfg.whatsapp_on or cfg.breaker_state = 'tripped' then
    v_reason := case when not cfg.whatsapp_on then 'off' else 'paused' end;
    v_outcome := 'declined_paused';
  elsif exists (select 1 from public.signin_blocks b where b.number_hash = p_number_hash and b.blocked_until > v_now) then
    v_reason := 'blocked';
    v_outcome := 'declined_blocked';
  elsif p_flow = 'sign_in' and cfg.require_screen and a.id is null then
    v_reason := 'direct';
    v_outcome := 'declined_direct';
  elsif v_nday >= cfg.cap_number_day then
    v_reason := 'number_day';
    v_outcome := 'declined_number';
  elsif v_n15 >= cfg.cap_number_15m then
    v_reason := 'number_15m';
    v_outcome := 'declined_number';
  elsif v_nday > 0 and v_last > v_now - make_interval(secs => v_gap) then
    v_reason := 'wait';
    v_outcome := 'declined_wait';
  elsif v_hour >= cfg.cap_channel_hour then
    v_reason := 'channel_hour';
    v_outcome := 'declined_channel';
  elsif v_chday >= cfg.cap_channel_day then
    v_reason := 'channel_day';
    v_outcome := 'declined_channel';
  end if;

  if v_reason is not null then
    if a.id is null then
      insert into public.signin_attempts (number_hash, flow, route, outcome, detail, decided_at)
        values (p_number_hash, p_flow, p_route, v_outcome, v_reason, now());
    else
      update public.signin_attempts set flow = p_flow, route = p_route, outcome = v_outcome, detail = v_reason, decided_at = now() where id = a.id;
    end if;
    return jsonb_build_object('decision', 'decline', 'reason', v_reason);
  end if;

  if a.id is null then
    insert into public.signin_attempts (number_hash, flow, route, outcome, counted, decided_at)
      values (p_number_hash, p_flow, p_route, 'accepted', true, now()) returning * into a;
  else
    update public.signin_attempts set flow = p_flow, route = p_route, outcome = 'accepted', counted = true, decided_at = now()
     where id = a.id returning * into a;
  end if;
  return jsonb_build_object('decision', 'allow', 'attempt', a.id, 'mode', cfg.mode);
end;
$$;

-- Step 3: what happened to the code. Only sensible moves are accepted, so a late report cannot rewrite history.
create function public.worker_signin_record(p_token text, p_attempt bigint, p_outcome text, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.signin_attempts;
  v_ok boolean;
begin
  perform public.worker_ok(p_token);
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  select * into a from public.signin_attempts where id = p_attempt for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  v_ok := case a.outcome
    when 'accepted' then p_outcome in ('sent', 'failed', 'rejected')
    when 'held' then p_outcome in ('sent', 'failed', 'rejected', 'expired')
    when 'sent' then p_outcome in ('delivered', 'failed')
    else false end;
  if not v_ok then
    return jsonb_build_object('ok', false, 'outcome', a.outcome);
  end if;
  update public.signin_attempts set outcome = p_outcome, detail = left(p_detail, 80), decided_at = now() where id = a.id;
  if p_outcome in ('failed', 'rejected', 'expired') then
    delete from public.signin_pending where attempt_id = a.id;
  end if;
  perform public.signin_breaker_check();
  return jsonb_build_object('ok', true, 'status', public.signin_effective_status());
end;
$$;

-- Reply-first: keep the code until the person messages the number. A newer code replaces an older one for the same
-- number (the sign-in service only honours the newest).
create function public.worker_signin_hold(p_token text, p_attempt bigint, p_sealed text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.signin_attempts;
  cfg public.signin_settings;
begin
  perform public.worker_ok(p_token);
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  select * into cfg from public.signin_settings;
  select * into a from public.signin_attempts where id = p_attempt and outcome = 'accepted' for update;
  if not found or a.number_hash is null then
    return jsonb_build_object('ok', false);
  end if;
  update public.signin_attempts x set outcome = 'expired', detail = 'replaced', decided_at = now()
   where x.outcome = 'held' and x.id in (select p.attempt_id from public.signin_pending p where p.number_hash = a.number_hash);
  delete from public.signin_pending where number_hash = a.number_hash;
  insert into public.signin_pending (attempt_id, number_hash, sealed, expires_at)
    values (a.id, a.number_hash, p_sealed, now() + make_interval(mins => cfg.code_minutes));
  update public.signin_attempts set outcome = 'held', decided_at = now() where id = a.id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Reply-first: the person messaged the number. Hand back the sealed code for that number, once, and call it sent.
create function public.worker_signin_release(p_token text, p_number_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
  v_id bigint;
  v_sealed text;
begin
  perform public.worker_ok(p_token);
  if p_number_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad hash' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  select * into cfg from public.signin_settings;
  if not cfg.whatsapp_on or cfg.breaker_state = 'tripped' then
    return null;
  end if;
  if exists (select 1 from public.signin_blocks b where b.number_hash = p_number_hash and b.blocked_until > now()) then
    return null;
  end if;
  with pick as (
    select p.attempt_id from public.signin_pending p
     where p.number_hash = p_number_hash and p.expires_at > now()
     order by p.attempt_id desc limit 1 for update)
  delete from public.signin_pending p using pick where p.attempt_id = pick.attempt_id
  returning p.attempt_id, p.sealed into v_id, v_sealed;
  if v_id is null then
    return null;
  end if;
  update public.signin_attempts set outcome = 'sent', detail = 'reply', decided_at = now() where id = v_id and outcome = 'held';
  return jsonb_build_object('attempt', v_id, 'sealed', v_sealed);
end;
$$;

-- A delivery receipt from the ordinary-number sender (the official route does not need one).
create function public.worker_signin_receipt(p_token text, p_number_hash text, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform public.worker_ok(p_token);
  if p_number_hash !~ '^[0-9a-f]{64}$' or p_state not in ('delivered', 'read', 'failed') then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  select a.id into v_id from public.signin_attempts a
   where a.number_hash = p_number_hash and a.route = 'linked' and a.outcome = 'sent' and a.at > now() - interval '30 minutes'
   order by a.id desc limit 1 for update;
  if v_id is null then
    return jsonb_build_object('ok', false);
  end if;
  if p_state = 'failed' then
    update public.signin_attempts set outcome = 'failed', detail = 'receipt_failed', decided_at = now() where id = v_id;
  else
    update public.signin_attempts set outcome = 'delivered', decided_at = now() where id = v_id;
  end if;
  perform public.signin_breaker_check();
  return jsonb_build_object('ok', true);
end;
$$;

-- The person replied STOP, or "not me". No codes to that number for 30 days, and the data lead hears of it.
create function public.worker_signin_stop(p_token text, p_number_hash text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz := now() + interval '30 days';
  v_fresh boolean;
begin
  perform public.worker_ok(p_token);
  if p_number_hash !~ '^[0-9a-f]{64}$' or p_kind not in ('stop', 'not_me') then
    raise exception 'Bad request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  v_fresh := not exists (select 1 from public.signin_blocks b where b.number_hash = p_number_hash and b.blocked_until > now());
  insert into public.signin_blocks (number_hash, reason, blocked_at, blocked_until) values (p_number_hash, p_kind, now(), v_until)
    on conflict (number_hash) do update set reason = excluded.reason, blocked_at = excluded.blocked_at, blocked_until = excluded.blocked_until;
  update public.signin_attempts x set outcome = 'expired', detail = 'stopped', decided_at = now()
   where x.outcome = 'held' and x.id in (select p.attempt_id from public.signin_pending p where p.number_hash = p_number_hash);
  delete from public.signin_pending where number_hash = p_number_hash;
  if v_fresh then
    perform public.signin_alert_staff('signin_stop_alert', jsonb_build_object('kind', p_kind),
      'signin_stop:' || left(p_number_hash, 16) || ':' || to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDD'),
      array['data_lead']::public.app_role[]);
  end if;
  perform public.signin_breaker_check();
  return jsonb_build_object('ok', true, 'blocked_until', v_until);
end;
$$;

-- What the ordinary-number sender says about itself. Logged out or restricted pauses WhatsApp at once.
create function public.worker_signin_sender_signal(p_token text, p_signal text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
begin
  perform public.worker_ok(p_token);
  if p_signal not in ('ok', 'logged_out', 'restricted', 'unreachable') then
    raise exception 'Bad signal' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  update public.signin_settings
     set sender_signal = p_signal, sender_checked_at = now(),
         sender_bad_since = case when p_signal = 'ok' then null else coalesce(sender_bad_since, now()) end
   returning * into cfg;
  if p_signal = 'logged_out' then
    perform public.signin_trip('sender_logged_out', '{}'::jsonb);
  elsif p_signal = 'restricted' then
    perform public.signin_trip('sender_restricted', '{}'::jsonb);
  elsif p_signal = 'unreachable' and cfg.sender_bad_since < now() - interval '15 minutes' then
    perform public.signin_trip('sender_unreachable', jsonb_build_object('since', cfg.sender_bad_since));
  end if;
  return jsonb_build_object('ok', true, 'status', public.signin_effective_status());
end;
$$;

-- The status and mode the website shows the screen (never any detail about who or why)
create function public.worker_signin_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return (select jsonb_build_object('status', public.signin_effective_status(), 'mode', s.mode) from public.signin_settings s);
end;
$$;

-- The heartbeat's housekeeping. Safe to run as often as it is called.
create function public.worker_signin_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unmatched integer;
  v_lost integer;
  v_expired integer;
  v_purged integer;
begin
  perform public.worker_ok(p_token);
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  -- Asked for on the screen, and the sign-in service never called us: no account has that number
  update public.signin_attempts set outcome = 'unmatched', decided_at = now()
   where outcome = 'requested' and at < now() - interval '5 minutes';
  get diagnostics v_unmatched = row_count;
  -- Every check passed and then nothing was reported: the send did not finish
  update public.signin_attempts set outcome = 'failed', detail = 'no_result', decided_at = now()
   where outcome = 'accepted' and decided_at < now() - interval '2 minutes';
  get diagnostics v_lost = row_count;
  -- Held codes nobody collected
  update public.signin_attempts a set outcome = 'expired', detail = 'not_collected', decided_at = now()
    from public.signin_pending p where p.attempt_id = a.id and p.expires_at < now() and a.outcome = 'held';
  get diagnostics v_expired = row_count;
  delete from public.signin_pending where expires_at < now();
  -- Nothing is kept longer than 30 days; a lifted block is forgotten
  delete from public.signin_attempts where at < now() - interval '30 days';
  get diagnostics v_purged = row_count;
  delete from public.signin_blocks where blocked_until < now();
  perform public.signin_breaker_check();
  return jsonb_build_object('status', public.signin_effective_status(), 'unmatched', v_unmatched, 'lost', v_lost,
    'expired', v_expired, 'purged', v_purged);
end;
$$;

-- ---------------------------------------------------------------------------
-- For the Admin page (director, super admin and data lead)
-- ---------------------------------------------------------------------------

create function public.signin_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.signin_settings;
begin
  if not public.signin_manager() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into cfg from public.signin_settings;
  return jsonb_build_object(
    'status', public.signin_effective_status(),
    'settings', to_jsonb(cfg) - 'id' - 'updated_by',
    'can_raise', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'now', (select jsonb_build_object(
        'hour', count(*) filter (where a.counted and a.at > now() - interval '1 hour'),
        'day', count(*) filter (where a.counted and a.at > now() - interval '24 hours'))
      from public.signin_attempts a where a.at > now() - interval '24 hours'),
    'blocks_active', (select count(*) from public.signin_blocks b where b.blocked_until > now()),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
          'day', to_char(g.d, 'YYYY-MM-DD'),
          'asked', coalesce(x.asked, 0), 'delivered', coalesce(x.delivered, 0), 'failed', coalesce(x.failed, 0),
          'declined', coalesce(x.declined, 0), 'not_collected', coalesce(x.not_collected, 0)) order by g.d)
        from generate_series((now() at time zone 'Africa/Lagos')::date - 29, (now() at time zone 'Africa/Lagos')::date, interval '1 day') as g(d)
        left join (
          select (a.at at time zone 'Africa/Lagos')::date as d,
                 count(*) as asked,
                 count(*) filter (where a.outcome = 'delivered' or (a.outcome = 'sent' and a.route = 'official')) as delivered,
                 count(*) filter (where a.outcome in ('failed', 'rejected')) as failed,
                 count(*) filter (where a.outcome like 'declined\_%') as declined,
                 count(*) filter (where a.outcome in ('expired', 'held', 'unmatched', 'requested', 'accepted')
                                     or (a.outcome = 'sent' and a.route = 'linked')) as not_collected
            from public.signin_attempts a group by 1) x on x.d = g.d::date), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', e.id, 'at', e.at, 'kind', e.kind, 'reason', e.reason, 'detail', e.detail,
          'by', (select coalesce(nullif(btrim(p.preferred_name), ''), nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1))
                   from public.people p where p.id = e.actor)) order by e.id desc)
        from (select * from public.signin_events order by id desc limit 50) e), '[]'::jsonb));
end;
$$;

-- Changes the switch, the limits, the mode and the breaker's thresholds. Each change is recorded with the person's name.
create function public.signin_admin_update(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prev public.signin_settings;
  cur public.signin_settings;
  v_diff jsonb := '{}'::jsonb;
  k text;
  v_keys constant text[] := array[
    'whatsapp_on', 'mode', 'cap_number_15m', 'cap_number_day', 'gap_1_s', 'gap_2_s', 'gap_3_s', 'cap_network_hour',
    'cap_channel_hour', 'cap_channel_day', 'require_screen', 'breaker_window_min', 'breaker_min_sends', 'breaker_fail_pct',
    'breaker_receipt_grace_min', 'breaker_no_receipt_pct', 'breaker_stop_count', 'code_minutes'];
  v_old jsonb;
  v_new jsonb;
begin
  if not public.signin_manager() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if not (k = any (v_keys)) then
      raise exception 'Unknown setting: %', left(k, 40) using errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  select * into prev from public.signin_settings for update;
  begin
    update public.signin_settings s set
      whatsapp_on = coalesce((p_changes ->> 'whatsapp_on')::boolean, s.whatsapp_on),
      mode = coalesce(p_changes ->> 'mode', s.mode),
      cap_number_15m = coalesce((p_changes ->> 'cap_number_15m')::smallint, s.cap_number_15m),
      cap_number_day = coalesce((p_changes ->> 'cap_number_day')::smallint, s.cap_number_day),
      gap_1_s = coalesce((p_changes ->> 'gap_1_s')::integer, s.gap_1_s),
      gap_2_s = coalesce((p_changes ->> 'gap_2_s')::integer, s.gap_2_s),
      gap_3_s = coalesce((p_changes ->> 'gap_3_s')::integer, s.gap_3_s),
      cap_network_hour = coalesce((p_changes ->> 'cap_network_hour')::smallint, s.cap_network_hour),
      cap_channel_hour = coalesce((p_changes ->> 'cap_channel_hour')::integer, s.cap_channel_hour),
      cap_channel_day = coalesce((p_changes ->> 'cap_channel_day')::integer, s.cap_channel_day),
      require_screen = coalesce((p_changes ->> 'require_screen')::boolean, s.require_screen),
      breaker_window_min = coalesce((p_changes ->> 'breaker_window_min')::smallint, s.breaker_window_min),
      breaker_min_sends = coalesce((p_changes ->> 'breaker_min_sends')::smallint, s.breaker_min_sends),
      breaker_fail_pct = coalesce((p_changes ->> 'breaker_fail_pct')::smallint, s.breaker_fail_pct),
      breaker_receipt_grace_min = coalesce((p_changes ->> 'breaker_receipt_grace_min')::smallint, s.breaker_receipt_grace_min),
      breaker_no_receipt_pct = coalesce((p_changes ->> 'breaker_no_receipt_pct')::smallint, s.breaker_no_receipt_pct),
      breaker_stop_count = coalesce((p_changes ->> 'breaker_stop_count')::smallint, s.breaker_stop_count),
      code_minutes = coalesce((p_changes ->> 'code_minutes')::smallint, s.code_minutes),
      updated_by = auth.uid(), updated_at = now()
    returning * into cur;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception 'One of those values is outside what is allowed. Nothing was changed.' using errcode = '22023';
  end;
  -- Raising the channel's ceiling is the director's decision (lowering it is anyone's)
  if (cur.cap_channel_hour > prev.cap_channel_hour or cur.cap_channel_day > prev.cap_channel_day)
     and not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the director can raise the channel limits.' using errcode = '42501';
  end if;

  v_old := to_jsonb(prev);
  v_new := to_jsonb(cur);
  for k in select unnest(v_keys) loop
    if v_old -> k is distinct from v_new -> k then
      v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
    end if;
  end loop;
  if v_diff ? 'whatsapp_on' then
    insert into public.signin_events (kind, reason, detail, actor)
      values (case when cur.whatsapp_on then 'switch_on' else 'switch_off' end, null, '{}'::jsonb, auth.uid());
  end if;
  if v_diff ? 'mode' then
    insert into public.signin_events (kind, reason, detail, actor)
      values ('mode', cur.mode, jsonb_build_object('from', prev.mode, 'to', cur.mode), auth.uid());
  end if;
  if (v_diff - 'whatsapp_on' - 'mode') <> '{}'::jsonb then
    insert into public.signin_events (kind, reason, detail, actor) values ('settings', null, v_diff - 'whatsapp_on' - 'mode', auth.uid());
  end if;
  return public.signin_admin_overview();
end;
$$;

-- Turns the breaker back on. Only a person can; the note is kept with their name.
create function public.signin_admin_reset(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.signin_manager() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('signin_gate'));
  update public.signin_settings
     set breaker_state = 'ok', breaker_reason = null, breaker_cleared_at = now(), sender_bad_since = null,
         updated_by = auth.uid(), updated_at = now()
   where breaker_state = 'tripped';
  if found then
    insert into public.signin_events (kind, reason, actor) values ('reset', nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid());
  end if;
  return public.signin_admin_overview();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who can call what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.signin_manager(),
  public.signin_effective_status(),
  public.signin_channel_status(),
  public.signin_alert_staff(text, jsonb, text, public.app_role[]),
  public.signin_trip(text, jsonb),
  public.signin_breaker_check(),
  public.worker_signin_network_gate(text, text, text),
  public.worker_signin_gate(text, text, text, text),
  public.worker_signin_record(text, bigint, text, text),
  public.worker_signin_hold(text, bigint, text),
  public.worker_signin_release(text, text),
  public.worker_signin_receipt(text, text, text),
  public.worker_signin_stop(text, text, text),
  public.worker_signin_sender_signal(text, text),
  public.worker_signin_status(text),
  public.worker_signin_tick(text),
  public.signin_admin_overview(),
  public.signin_admin_update(jsonb),
  public.signin_admin_reset(text)
  from public, anon, authenticated;

-- Anyone may ask whether WhatsApp sign-in is on, off or paused. It says nothing else.
grant execute on function public.signin_channel_status() to anon, authenticated;

-- The website's server proves itself with the sending token, as the other worker functions do.
grant execute on function
  public.worker_signin_network_gate(text, text, text),
  public.worker_signin_gate(text, text, text, text),
  public.worker_signin_record(text, bigint, text, text),
  public.worker_signin_hold(text, bigint, text),
  public.worker_signin_release(text, text),
  public.worker_signin_receipt(text, text, text),
  public.worker_signin_stop(text, text, text),
  public.worker_signin_sender_signal(text, text),
  public.worker_signin_status(text),
  public.worker_signin_tick(text)
  to anon, authenticated;

-- The Admin page, for signed-in people (each function checks the role itself)
grant execute on function
  public.signin_admin_overview(),
  public.signin_admin_update(jsonb),
  public.signin_admin_reset(text)
  to authenticated;

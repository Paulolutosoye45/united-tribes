-- =============================================================================
-- United Tribes: the placed-member nudge (Package 6a of "seats and contacts")
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), starting Off, Off / Rehearsal / On for the whole church, one
-- community or one tribe:
--
--   Placed nudge   a new choice in Announcements, "Placed by the church, waiting for a reply": one more email to a member the church placed and who has not
--                  answered yet. Each email carries that member's own private links (Yes, I'm in / Show me other tribes / Don't share my details), made at
--                  the moment the email is sent. The private page then offers two ways to say yes: "Yes, I'm in, and message me on WhatsApp" (one press says
--                  yes to the tribe, saves the number and records the member's yes to WhatsApp, version placed-v1) and "Yes, I'm in, email only" (says yes
--                  to the tribe and nothing about WhatsApp).
--
-- Three levels, kept apart:
--   Saved       a number that looks real (contact_preferences, as before)
--   Agreed      the member pressed the button that says "message me on WhatsApp" (consents, placed-v1; never pre-ticked)
--   Confirmed   the number reaches this person: it is the number they sign in with (a code was sent to it), or, later, they send one message from it
--               (a table of fingerprints, never the number). A changed number is no longer confirmed, because the fingerprint no longer matches it.
--
-- Safety rules, all kept here and not on the screen:
--   * who is "waiting": a seat the church placed (placement_source = 'auto'), active, not confirmed, in a season that is not closed; one shared test
--   * never nudged: anyone under 18, anyone with a deletion request open, anyone whose email is off or bounces, anyone who stopped announcements, anyone
--     who pressed "Don't share my details" (they are never asked for a number)
--   * the first nudge goes no sooner than 24 hours after the placement email, at least 3 days apart, at most 2 for one seat (the three numbers are settings
--     the owner can change with a reason; each change is logged)
--   * checked three times: when the office counts, when the announcement is released, and at the moment each email is sent; a member who answered in
--     between is left out ("Answered since")
--   * the private links are made when each email is sent (so a retry gets new ones), kept only as fingerprints, valid for 60 days, and the page can tell a
--     link that ran out from a seat that is gone, and can send a fresh one (three a day)
--   * opening the page saves nothing (mail scanners open links); only a button press does; "email only" never writes a WhatsApp yes
--   * no number is ever put in an email or a log; the page shows it with its middle hidden
--   * Rehearsal shows the choice, the counts, the reasons and the test email, and refuses to send; Off hides the choice; the Master pause holds a
--     scheduled send until it is lifted
--   * it pauses itself when, after 50 or more have gone, more than 1 in 100 stop announcements or 1 in 1,000 complain, and tells the director
--
-- Also fixed here: the original "Your tribe" email's retry. A retry of a failed placement email used to go out with no private link (the heartbeat wipes
-- it); now a retry makes a new one.
--
-- What it never does: send anything on WhatsApp, send to a number the member has not agreed to, tick WhatsApp for anyone, release or move a seat, or change
-- the wording of any existing message.
--
-- Replaced, because they now know about the nudge (the old text of each is in the rollback file): placement_token_mint, retry_message, audience_clean,
-- audience_base, audience_members, broadcasts_release, claim_prepare, broadcast_results, contact_gaps_export.
-- Needs the Switchboard, the announcements engine, the placement package and the contact series in place first.
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('placed_nudge', 'Placed nudge', 'One more email, from Announcements, to members the church placed who have not answered yet. Each email carries that member''s own private links, and the page offers Yes, I''m in with a message on WhatsApp, or Yes, I''m in by email only. The first goes 24 hours after the placement email, at least 3 days apart, at most 2 for one seat. Rehearsal shows the choice, the counts and the reasons, and sends nothing. Nothing is sent on WhatsApp.', 8, '{}', array['off', 'rehearsal', 'on'], 'off', true, 30, false);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- The three numbers. One row.
create table public.placed_nudge_settings (
  id boolean primary key default true check (id),
  -- Hours after the placement email before the first nudge
  first_after_hours smallint not null default 24 check (first_after_hours between 0 and 240),
  -- Days between two nudges for one seat
  spacing_days smallint not null default 3 check (spacing_days between 1 and 14),
  -- Most nudges for one seat
  max_per_seat smallint not null default 2 check (max_per_seat between 1 and 4),
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.placed_nudge_settings (id) values (true);
alter table public.placed_nudge_settings enable row level security;
revoke all on table public.placed_nudge_settings from public, anon, authenticated;

-- One row for each nudge put to a seat: queued when the announcement is released, sent when the email is made ready, skipped when it was left out at the last
-- moment. Spacing and "most per seat" count the queued and the sent.
create table public.placed_nudges (
  id bigint generated always as identity primary key,
  tm_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  broadcast_id uuid references public.broadcasts (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped')),
  reason text check (char_length(reason) <= 60),
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);
create index placed_nudges_tm_idx on public.placed_nudges (tm_id, queued_at desc);
create index placed_nudges_broadcast_idx on public.placed_nudges (broadcast_id);
create index placed_nudges_message_idx on public.placed_nudges (message_id);
alter table public.placed_nudges enable row level security;
revoke all on table public.placed_nudges from public, anon, authenticated;

-- Every private link made for a placed member, kept as a fingerprint after the heartbeat has taken the live one away, so the page can say "this link ran
-- out" and offer a fresh one. Kept for 60 days after it expires.
create table public.placed_links (
  token_hash text primary key,
  placement_id uuid not null references public.tribe_members (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  source text not null default 'placement' check (source in ('placement', 'nudge', 'again')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index placed_links_person_idx on public.placed_links (person_id, created_at desc);
create index placed_links_expiry_idx on public.placed_links (expires_at);
alter table public.placed_links enable row level security;
revoke all on table public.placed_links from public, anon, authenticated;

-- A number that reaches its owner: who, a fingerprint of the number (never the number), how, when.
create table public.number_confirmations (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  method text not null check (method in ('signin', 'message')),
  confirmed_at timestamptz not null default now(),
  unique (person_id, fingerprint, method)
);
alter table public.number_confirmations enable row level security;
revoke all on table public.number_confirmations from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------
create function public.placed_nudge_cfg()
returns public.placed_nudge_settings
language sql
stable
security definer
set search_path = ''
as $$
  select s from public.placed_nudge_settings s where s.id;
$$;

-- Who is "waiting": the church placed them, they are in the seat, they have not said yes, and the season is not closed. The contact series uses the same
-- test for "on the placement clock".
create function public.placed_is_waiting(p_tm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tribe_members tm join public.seasons s on s.id = tm.season_id
                  where tm.id = p_tm and tm.placement_source = 'auto' and tm.status = 'active' and tm.confirmed_at is null and s.status <> 'closed');
$$;

-- The seat a person is waiting in (the latest, if ever there were two), or null.
create function public.placed_nudge_seat(p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.id from public.tribe_members x where x.person_id = p_person and public.placed_is_waiting(x.id) order by x.joined_at desc, x.id limit 1;
$$;

-- When the placement email went. A placement email that has not gone yet is "not yet" (infinity); one that failed, or none at all, falls back to the day
-- they joined the seat.
create function public.placed_email_at(p_tm uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(m.sent_at) from public.messages m where m.dedupe_key = 'placement:' || p_tm and m.status in ('sent', 'delivered', 'read')),
    case when exists (select 1 from public.messages m where m.dedupe_key = 'placement:' || p_tm and m.status in ('queued', 'sending')) then 'infinity'::timestamptz end,
    (select tm.joined_at from public.tribe_members tm where tm.id = p_tm));
$$;

-- Every waiting member in a centre, once each.
create function public.placed_waiting_rows(p_centre uuid)
returns table (person_id uuid, tm_id uuid, tribe_id uuid, placed_at timestamptz, withheld boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (tm.person_id) tm.person_id, tm.id, tm.tribe_id, public.placed_email_at(tm.id), tm.contact_withheld
    from public.tribe_members tm
    join public.people p on p.id = tm.person_id
   where p.centre_id = p_centre and public.placed_is_waiting(tm.id)
   order by tm.person_id, tm.joined_at desc, tm.id;
$$;

-- How far open the function is anywhere: 'on' if any rule opens it, else 'rehearsal' if any rule rehearses it, else 'off'. The Master pause makes it 'off'.
-- Not who is covered: that is feature_state_of for one person.
create function public.placed_nudge_any()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when not exists (select 1 from public.feature_registry f where f.key = 'placed_nudge' and f.available) then 'off'
    when exists (select 1 from public.feature_settings s where s.feature = 'placed_nudge' and s.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings s where s.feature = 'placed_nudge' and s.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
$$;

-- Why this person must not be nudged now, or null when they may be. Used when the office counts (p_live false: Rehearsal counts as open, so the office can
-- see the numbers), when the announcement is released and when each email is sent (p_live true: only On). p_message is the email being sent, which is not
-- counted against itself.
--   answered_since    no longer waiting: said yes, changed tribe, gave up the seat, or the season closed
--   not_on            the function is not switched on for them (outside the tribe or community it was opened for)
--   withheld          pressed "Don't share my details": never asked for a number
--   placed_recent     the placement email is younger than the first-nudge wait (or has not gone yet)
--   nudged_enough     already nudged as many times as allowed for this seat
--   nudged_recently   nudged within the spacing
create function public.placed_nudge_blocker(p_person uuid, p_spec jsonb, p_live boolean, p_message uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.placed_nudge_settings := public.placed_nudge_cfg();
  v_tm uuid := public.placed_nudge_seat(p_person);
  tm public.tribe_members%rowtype;
  v_state text;
  v_wait integer;
  v_n integer;
  v_last timestamptz;
begin
  if v_tm is null then
    return 'answered_since';
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  v_state := public.feature_state_of('placed_nudge', p_person);
  if v_state = 'off' or (coalesce(p_live, false) and v_state <> 'on') then
    return 'not_on';
  end if;
  if tm.contact_withheld then
    return 'withheld';
  end if;
  v_wait := greatest(cfg.first_after_hours, coalesce(nullif(p_spec ->> 'waited_hours', '')::integer, 0));
  if public.placed_email_at(v_tm) + make_interval(hours => v_wait) > now() then
    return 'placed_recent';
  end if;
  select count(*)::integer, max(coalesce(n.sent_at, n.queued_at)) into v_n, v_last
    from public.placed_nudges n where n.tm_id = v_tm and n.status in ('queued', 'sent') and (p_message is null or n.message_id is distinct from p_message);
  if v_n >= cfg.max_per_seat then
    return 'nudged_enough';
  end if;
  if v_last is not null and v_last + make_interval(days => cfg.spacing_days) > now() then
    return 'nudged_recently';
  end if;
  return null;
end;
$$;

-- A fingerprint of a number for one person: salted with the person, never the number itself.
create function public.number_fp(p_person uuid, p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_person::text || ':' || regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 'UTF8')), 'hex');
$$;

-- Does the number we hold reach its owner? 'signin' (it is the number they sign in with, which a code was sent to), 'message' (they sent one message from
-- it), or null. A changed number is no longer confirmed, because the fingerprint no longer matches it.
create function public.number_confirmed(p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text := (select cp.phone from public.contact_preferences cp where cp.person_id = p_person);
  v_in text;
begin
  if v_phone is null or public.number_looks_made_up(v_phone) then
    return null;
  end if;
  v_in := public.reach_signin_number(p_person);
  if v_in is not null and regexp_replace(v_in, '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g') then
    return 'signin';
  end if;
  return (select c.method from public.number_confirmations c where c.person_id = p_person and c.fingerprint = public.number_fp(p_person, v_phone)
           order by (c.method = 'message') desc, c.id desc limit 1);
end;
$$;

-- Holds back a nudge that has gone wrong: after 50 or more have gone, more than 1 in 100 stopped announcements or more than 1 in 1,000 complained. It pauses
-- that announcement and tells the director and the admin. The same limits the reminder journeys use. True when it paused it.
create function public.placed_nudge_selfcheck(p_broadcast uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
  v_sent integer;
  v_unsub integer;
  v_comp integer;
  v_why text;
begin
  select * into b from public.broadcasts x where x.id = p_broadcast for update;
  if not found or b.status <> 'sending' then
    return false;
  end if;
  select count(*)::integer into v_sent from public.broadcast_recipients r join public.messages m on m.id = r.message_id
   where r.broadcast_id = b.id and m.status in ('sent', 'delivered', 'read');
  if v_sent < 50 then
    return false;
  end if;
  select count(*) filter (where e.kind = 'unsubscribe')::integer, count(*) filter (where e.kind = 'complaint')::integer into v_unsub, v_comp
    from public.email_signals e
   where e.created_at >= coalesce(b.started_at, b.created_at)
     and (e.broadcast_id = b.id or exists (select 1 from public.broadcast_recipients r where r.broadcast_id = b.id and r.person_id = e.person_id));
  if v_unsub * 100.0 / v_sent > 1 then
    v_why := format('%s people stopped announcements out of %s sent (more than 1 in 100).', v_unsub, v_sent);
  elsif v_comp * 1000.0 / v_sent > 1 then
    v_why := format('%s people marked this as spam out of %s sent (more than 1 in 1,000).', v_comp, v_sent);
  end if;
  if v_why is null then
    return false;
  end if;
  update public.broadcasts set status = 'paused' where id = b.id;
  perform public.write_event(null, 'placed_nudge.self_paused', 'broadcast', b.id::text, jsonb_build_object('unsubscribed', v_unsub, 'complaints', v_comp, 'sent', v_sent));
  perform public.signin_alert_staff('reminder_paused', jsonb_build_object('journey', 'Placed nudge', 'why', v_why),
    'pn:' || b.id::text, array['director', 'admin']::public.app_role[]);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced functions (the old text of each is in the rollback file)
-- ---------------------------------------------------------------------------
-- A private link for a placed member: also kept as a fingerprint, so a link that has run out can be told from one that never was.
create or replace function public.placement_token_mint(p_placement uuid, p_person uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash text := encode(sha256(convert_to(v_raw, 'UTF8')), 'hex');
begin
  insert into public.placement_tokens (token_hash, placement_id, person_id, expires_at)
  values (v_hash, p_placement, p_person, now() + make_interval(days => greatest(p_days, 1)));
  -- Kept as a fingerprint for 60 days after it runs out, so the page can say so and offer a fresh link
  insert into public.placed_links (token_hash, placement_id, person_id, expires_at)
  values (v_hash, p_placement, p_person, now() + make_interval(days => greatest(p_days, 1)));
  return v_raw;
end;
$$;

-- Trying a failed message again: a placement email gets a new private link.
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
  end if;
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

-- Who an announcement is for: one more choice, "placed by the church, waiting for a reply".
create or replace function public.audience_clean(p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
  v jsonb;
  v_out jsonb;
  v_idle integer;
  v_nofit text;
  v_comm uuid;
  v_stages text[];
  v_roles text[];
  v_cause text;
  v_trib uuid;
  v_need text;
  v_wait integer;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff', 'cannot_reach', 'leader_cards', 'placed_waiting') then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  v_out := jsonb_build_object('kind', k);

  if p_spec ? 'community' and nullif(p_spec ->> 'community', '') is not null then
    begin
      v_comm := (p_spec ->> 'community')::uuid;
    exception when others then
      raise exception 'That community does not exist' using errcode = '22023';
    end;
    if not exists (select 1 from public.communities t where t.id = v_comm) then
      raise exception 'That community does not exist' using errcode = '22023';
    end if;
    if k in ('leader_applicants', 'leaders', 'staff', 'leader_cards') then
      raise exception 'A community can only narrow members' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('community', v_comm);
  end if;

  if k = 'started' and p_spec ? 'idle_days' then
    v_idle := coalesce(nullif(p_spec ->> 'idle_days', '')::integer, 0);
    if v_idle < 0 or v_idle > 60 then
      raise exception 'Days since they last did anything must be 0 to 60' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('idle_days', v_idle);
  end if;

  if k = 'finished_no_tribe' and p_spec ? 'no_fit' then
    v_nofit := p_spec ->> 'no_fit';
    if v_nofit not in ('include', 'exclude', 'only') then
      raise exception 'Choose whether to include the people with no tribe that fits yet' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('no_fit', v_nofit);
  end if;

  if k = 'leader_applicants' then
    v := coalesce(p_spec -> 'stages', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the stages' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_stages from jsonb_array_elements_text(v) s;
    if exists (select 1 from unnest(v_stages) s where s not in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed', 'approved_leader', 'approved_assistant', 'not_approved')) then
      raise exception 'Choose from the stages shown' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('stages', to_jsonb(v_stages));
  end if;

  if k = 'staff' then
    v := coalesce(p_spec -> 'roles', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the roles' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_roles from jsonb_array_elements_text(v) s;
    if cardinality(v_roles) = 0 or exists (select 1 from unnest(v_roles) s where s not in ('coach', 'care_lead', 'community_champion', 'data_lead', 'director', 'pastor', 'admin')) then
      raise exception 'Choose at least one role from the list' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('roles', to_jsonb(v_roles));
  end if;
  if k = 'cannot_reach' then
    -- Members a leader cannot reach on WhatsApp (Contact gaps, fix 13). Only while the function is On.
    if public.feature_platform_state('contact_gaps') <> 'on' then
      raise exception 'Contact gaps is not switched On' using errcode = '22023';
    end if;
    v_cause := coalesce(nullif(p_spec ->> 'cause', ''), 'either');
    if v_cause not in ('no_number', 'no_yes', 'either') then
      raise exception 'Choose who has no number, who has not agreed to WhatsApp, or both' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('cause', v_cause);
    if nullif(p_spec ->> 'tribe', '') is not null then
      begin
        v_trib := (p_spec ->> 'tribe')::uuid;
      exception when others then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end;
      if not exists (select 1 from public.tribes t where t.id = v_trib) then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('tribe', v_trib);
    end if;
  end if;
  if k = 'placed_waiting' then
    -- Members the church placed who have not answered yet (the placed nudge). Offered only while the function is Rehearsal or On.
    if public.placed_nudge_any() = 'off' then
      raise exception 'The placed nudge is not switched on' using errcode = '22023';
    end if;
    v_need := coalesce(nullif(p_spec ->> 'need', ''), 'all');
    if v_need not in ('all', 'gap') then
      raise exception 'Choose everyone waiting, or only those with no number or no WhatsApp yes' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('need', v_need);
    if nullif(p_spec ->> 'waited_hours', '') is not null then
      begin
        v_wait := (p_spec ->> 'waited_hours')::integer;
      exception when others then
        raise exception 'The hours they have waited must be 0 to 720' using errcode = '22023';
      end;
      if v_wait < 0 or v_wait > 720 then
        raise exception 'The hours they have waited must be 0 to 720' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('waited_hours', v_wait);
    end if;
    if nullif(p_spec ->> 'tribe', '') is not null then
      begin
        v_trib := (p_spec ->> 'tribe')::uuid;
      exception when others then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end;
      if not exists (select 1 from public.tribes t where t.id = v_trib) then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('tribe', v_trib);
    end if;
  end if;
  return v_out;
end;
$$;

create or replace function public.audience_base(p_spec jsonb, p_centre uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
begin
  if k = 'everyone' then
    return query select p.id from public.people p where p.centre_id = p_centre;
  elsif k = 'started' then
    return query
      select d.person_id from public.intake_drafts d join public.people p on p.id = d.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.member_profiles mp where mp.person_id = d.person_id)
         and d.updated_at <= now() - make_interval(days => coalesce((p_spec ->> 'idle_days')::integer, 0));
  elsif k = 'finished_no_tribe' then
    return query
      select mp.person_id from public.member_profiles mp join public.people p on p.id = mp.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.tribe_members cm join public.seasons s on s.id = cm.season_id
                          where cm.person_id = mp.person_id and cm.status = 'active' and s.status <> 'closed')
         and case coalesce(p_spec ->> 'no_fit', 'include')
               when 'only' then exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               when 'exclude' then not exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               else true end;
  elsif k = 'in_tribe' then
    return query
      select distinct cm.person_id from public.tribe_members cm
        join public.seasons s on s.id = cm.season_id join public.people p on p.id = cm.person_id
       where p.centre_id = p_centre and cm.status = 'active' and s.status in ('planning', 'open', 'running');
  elsif k = 'leader_applicants' then
    return query
      select la.person_id from public.leader_applications la join public.people p on p.id = la.person_id
       where p.centre_id = p_centre
         and la.status::text = any (coalesce(
               (select array_agg(x) from jsonb_array_elements_text(p_spec -> 'stages') x),
               array['draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed']));
  elsif k = 'leaders' then
    return query
      select distinct x.pid from (
        select c.leader_id as pid from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed'
        union
        select c.assistant_id from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed' and c.assistant_id is not null
        union
        select r.person_id from public.person_roles r where r.role in ('leader', 'assistant_leader')) x
        join public.people p on p.id = x.pid
       where p.centre_id = p_centre;
  elsif k = 'staff' then
    return query
      select distinct r.person_id from public.person_roles r join public.people p on p.id = r.person_id
       where p.centre_id = p_centre
         and r.role::text = any (coalesce((select array_agg(x) from jsonb_array_elements_text(p_spec -> 'roles') x), '{}'));
  elsif k = 'cannot_reach' then
    return query
      select g.person_id from public.contact_gap_rows(p_centre) g
       where g.cause = any (public.contact_gap_causes(p_spec ->> 'cause'))
         and (nullif(p_spec ->> 'tribe', '') is null or g.tribe_id = (p_spec ->> 'tribe')::uuid);
  elsif k = 'placed_waiting' then
    return query
      select w.person_id from public.placed_waiting_rows(p_centre) w
       where (nullif(p_spec ->> 'tribe', '') is null or w.tribe_id = (p_spec ->> 'tribe')::uuid)
         and (coalesce(p_spec ->> 'need', 'all') = 'all' or public.reach_number_kind(w.person_id) is not null);
  elsif k = 'leader_cards' then
    -- Leaders whose Tribe Card is still open: not started, in progress, or sent back with changes asked for.
    return query
      select r.person_id from public.leader_card_rows(p_centre) r
       where r.state in ('not_started', 'in_progress', 'changes_asked');
  end if;
end;
$$;

create or replace function public.audience_members(p_spec jsonb, p_centre uuid)
returns table (person_id uuid, blocker text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.pid,
         coalesce(public.message_blocker(b.pid),
                  case when public.reminder_stopped(b.pid, 'announcements') then 'announcements_off' end,
                  case when p_spec ->> 'kind' = 'cannot_reach' then public.contact_ask_blocker(b.pid) end,
                  case when p_spec ->> 'kind' = 'placed_waiting' then public.placed_nudge_blocker(b.pid, p_spec, false, null) end)
    from (select distinct t.pid from public.audience_base(p_spec, p_centre) as t(pid)) b
   where (p_spec ->> 'community' is null
          or exists (select 1 from public.member_profiles mp where mp.person_id = b.pid and mp.community_id = (p_spec ->> 'community')::uuid));
$$;

-- Hands announcements to the outbox, a little at a time. A nudge is checked again here.
create or replace function public.broadcasts_release()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  b public.broadcasts%rowtype;
  rec record;
  v_quota integer;
  v_blocker text;
  v_msg uuid;
  v_total integer := 0;
  v_left integer;
begin
  if not public.send_window_ok('bulk') then
    return 0;
  end if;
  delete from public.placed_links where expires_at < now() - interval '60 days';
  for b in select * from public.broadcasts x where x.status in ('scheduled', 'sending') and x.scheduled_for <= now() order by x.scheduled_for for update skip locked loop
    if b.audience ->> 'kind' = 'placed_waiting' then
      -- A nudge is held, not skipped, while the function is Off, in Rehearsal or paused: it goes when the switch is On again. One that has done harm pauses itself.
      if public.placed_nudge_any() <> 'on' then
        continue;
      end if;
      if b.status = 'sending' and public.placed_nudge_selfcheck(b.id) then
        continue;
      end if;
    end if;
    if b.status = 'scheduled' then
      update public.broadcasts set status = 'sending', started_at = now(), last_release_at = now() - interval '1 minute' where id = b.id;
      b.last_release_at := now() - interval '1 minute';
    end if;
    v_quota := least(3000, greatest(1, floor(extract(epoch from now() - coalesce(b.last_release_at, now() - interval '1 minute')) / 60.0 * s.bulk_per_minute)::integer));
    for rec in select r.person_id from public.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'pending' order by r.person_id limit v_quota for update skip locked loop
      v_blocker := coalesce(public.message_blocker(rec.person_id),
                            case when public.reminder_stopped(rec.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is null and not public.person_cap_ok(rec.person_id, 'announcement') then
        v_blocker := 'weekly_cap';
      end if;
      if v_blocker is null and b.audience ->> 'kind' = 'cannot_reach' and not public.contact_gap_still(rec.person_id, b.audience ->> 'cause') then
        v_blocker := 'gap_closed';
      end if;
      if v_blocker is null and b.audience ->> 'kind' = 'placed_waiting' then
        v_blocker := public.placed_nudge_blocker(rec.person_id, b.audience, true, null);
      end if;
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
      else
        v_msg := public.enqueue_message(rec.person_id, 'office_message', jsonb_build_object('broadcast_id', b.id), null,
          'bc:' || b.id::text || ':' || rec.person_id::text, now(), 'normal', 'email');
        update public.broadcast_recipients set status = 'queued', message_id = v_msg, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
        v_total := v_total + 1;
        if b.audience ->> 'kind' = 'placed_waiting' and v_msg is not null and public.placed_nudge_seat(rec.person_id) is not null then
          insert into public.placed_nudges (tm_id, person_id, broadcast_id, message_id) values (public.placed_nudge_seat(rec.person_id), rec.person_id, b.id, v_msg);
        end if;
      end if;
    end loop;
    update public.broadcasts set last_release_at = now() where id = b.id;
    select count(*) into v_left from public.broadcast_recipients where broadcast_id = b.id and status = 'pending';
    if v_left = 0 then
      update public.broadcasts set status = 'sent', finished_at = now() where id = b.id;
      perform public.write_event(null, 'broadcast.finished', 'broadcast', b.id::text, '{}'::jsonb);
    end if;
  end loop;
  return v_total;
end;
$$;

-- What an email needs when it is claimed. A nudge also gets the member's own private links, made now.
create or replace function public.claim_prepare(m public.messages)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  r public.journey_runs;
  b public.broadcasts;
  e public.journey_emails;
  v_state text;
  v_step integer;
  v_data jsonb;
  v_copy jsonb;
  v_links jsonb := '{}'::jsonb;
  v_action text;
  v_blocker text;
  rr public.leader_references;
  ra public.leader_applications;
  rt public.referee_trust;
  rac public.referee_access;
  rcfg public.referee_settings;
  v_code text;
  v_salt text;
  v_secret text;
  v_tm uuid;
  v_placed jsonb;
  t public.tribes%rowtype;
begin
  -- A referee has no account: their messages carry a fresh link or a fresh code, made now and never stored in a readable form.
  if m.template in ('referee_request', 'referee_reverify', 'referee_code') then
    rcfg := public.referee_cfg();
    select * into rr from public.leader_references where id = nullif(m.params ->> 'reference_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    -- A message for a contact that has since been replaced must never carry the new person's link
    if rr.contact_norm is distinct from (m.params ->> 'contact') then
      return jsonb_build_object('ok', false, 'reason', 'the referee was changed');
    end if;
    select * into ra from public.leader_applications where id = rr.application_id;
    select * into rt from public.referee_trust where reference_id = rr.id;
    if m.template = 'referee_reverify' then
      if rr.submitted_at is null or rt.reverified_at is not null or rt.verification <> 'unverified' then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    elsif m.template = 'referee_request' then
      if rr.submitted_at is not null or ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    else
      if (rr.submitted_at is not null and not (coalesce(rt.legacy, false) and rt.reverify_sent_at is not null and rt.reverified_at is null))
         or (rr.submitted_at is null and ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved')) then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    end if;

    if m.template = 'referee_code' then
      select * into rac from public.referee_access where reference_id = rr.id for update;
      if rac.locked_until is not null and rac.locked_until > now() then
        return jsonb_build_object('ok', false, 'reason', 'locked');
      end if;
      v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
      v_salt := public.referee_secret();
      update public.referee_access
         set code_salt = v_salt, code_hash = public.referee_hash(v_salt || v_code),
             code_expires_at = now() + make_interval(mins => rcfg.code_minutes), code_tries = 0
       where reference_id = rr.id;
      return jsonb_build_object('ok', true, 'params', jsonb_build_object(
        'kind', 'referee_code', 'code', v_code, 'minutes', rcfg.code_minutes,
        'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id)));
    end if;

    v_secret := public.referee_secret();
    update public.leader_references
       set token_hash = public.referee_hash(v_secret), token_expires_at = now() + make_interval(days => rcfg.link_days)
     where id = rr.id;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', m.template, 'secret', v_secret, 'days', rcfg.link_days,
      'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id),
      'applicant_first', public.first_name_of(ra.person_id)));
  end if;

  if m.person_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no person');
  end if;

  if m.template = 'reminder_email' then
    select * into r from public.journey_runs where id = nullif(m.params ->> 'run_id', '')::uuid;
    if not found or r.status <> 'active' then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    v_state := public.journey_state(r);
    if v_state <> 'ok' then
      perform public.journey_apply_state(r.id, v_state);
      update public.journey_sends set kind = 'skipped', reason = left(coalesce(substr(v_state, 7), 'acted'), 60) where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'condition changed: ' || v_state);
    end if;
    if not public.send_window_ok('reminder') then
      return jsonb_build_object('ok', false, 'defer', true);
    end if;
    v_step := nullif(m.params ->> 'step', '')::integer;
    select * into e from public.journey_emails x where x.journey_key = r.journey_key and x.step = v_step;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no wording');
    end if;
    v_data := public.journey_data(r);
    if r.journey_key = 'no_tribe' and v_step = 3 and coalesce((v_data ->> 'seats_left')::integer, 0) <= 0 then
      update public.journey_sends set kind = 'skipped', reason = 'no seats left' where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'the best match has no seats left');
    end if;
    v_copy := jsonb_build_object('subject', e.subject, 'paragraphs', to_jsonb(e.paragraphs), 'button_label', e.button_label,
      'actions', to_jsonb(e.actions), 'tone', e.tone, 'step', v_step, 'journey', r.journey_key);
    if e.target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', e.target, r.id, null, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'reminders', r.id, null, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', r.id, null, 400));
    foreach v_action in array e.actions loop
      v_links := v_links || jsonb_build_object(v_action, public.make_email_link(m.person_id, 'ask', v_action, r.id, null, 90));
    end loop;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'reminder', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));

  elsif m.template = 'office_message' then
    select * into b from public.broadcasts where id = nullif(m.params ->> 'broadcast_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'announcement is gone');
    end if;
    if not (m.params ? 'test') then
      if b.status = 'paused' then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
      if b.status not in ('scheduled', 'sending', 'sent') then
        update public.broadcast_recipients set status = 'skipped', reason = 'cancelled' where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', 'announcement ' || b.status);
      end if;
      v_blocker := coalesce(public.message_blocker(m.person_id), case when public.reminder_stopped(m.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', v_blocker);
      end if;
      if not public.send_window_ok('bulk') then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
      if b.audience ->> 'kind' = 'placed_waiting' then
        -- The last of the three checks: the member may have answered since the announcement was released
        if public.placed_nudge_any() <> 'on' then
          return jsonb_build_object('ok', false, 'defer', true);
        end if;
        v_blocker := public.placed_nudge_blocker(m.person_id, b.audience, true, m.id);
        if v_blocker is not null then
          update public.broadcast_recipients set status = 'skipped', reason = v_blocker where message_id = m.id;
          update public.placed_nudges set status = 'skipped', reason = v_blocker where message_id = m.id;
          return jsonb_build_object('ok', false, 'reason', v_blocker);
        end if;
      end if;
    end if;
    v_data := public.broadcast_vars(m.person_id);
    v_copy := jsonb_build_object('subject', (case when m.params ? 'test' then '[Test] ' else '' end) || b.subject,
      'paragraphs', to_jsonb(b.paragraphs), 'button_label', b.button_label, 'actions', '[]'::jsonb, 'tone', 'office', 'step', 0);
    if b.button_target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', b.button_target, null, case when m.params ? 'test' then null else b.id end, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'announcements', null, case when m.params ? 'test' then null else b.id end, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', null, null, 400));
    if b.audience ->> 'kind' = 'placed_waiting' then
      if m.params ? 'test' then
        -- The office's own test: a made-up tribe and links that go nowhere
        v_placed := jsonb_build_object('sample', true, 'secret', repeat('0', 64), 'tribe', 'Builders Tribe', 'leader_first', 'Ngozi',
                                       'meeting_day', 2, 'meeting_time', '19:00', 'mode', 'in_person');
      else
        -- This member's own private links, made now, so a retry gets new ones. Only their fingerprint is kept.
        v_tm := public.placed_nudge_seat(m.person_id);
        select * into t from public.tribes x where x.id = (select tm.tribe_id from public.tribe_members tm where tm.id = v_tm);
        v_secret := public.placement_token_mint(v_tm, m.person_id, 60);
        update public.placed_links set source = 'nudge' where token_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
        update public.placed_nudges set status = 'sent', sent_at = now() where message_id = m.id;
        v_placed := jsonb_build_object('secret', v_secret, 'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
                                       'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode);
      end if;
    end if;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'announcement', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address))
      || case when v_placed is not null then jsonb_build_object('placed', v_placed) else '{}'::jsonb end);
  end if;
  return jsonb_build_object('ok', true, 'params', '{}'::jsonb);
end;
$$;

-- The results of one announcement: a nudge gets two more rows.
create or replace function public.broadcast_results(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
  r jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'frozen', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id),
    'waiting', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id and x.status in ('pending', 'queued')
                   and not exists (select 1 from public.messages m where m.id = x.message_id and m.status in ('sent', 'delivered', 'read', 'failed', 'skipped'))),
    'sent', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
              where x.broadcast_id = p_id and m.status in ('sent', 'delivered', 'read')),
    'delivered', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                   where x.broadcast_id = p_id and m.status in ('delivered', 'read')),
    'bounced', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                 where x.broadcast_id = p_id and m.status = 'failed'),
    'left_out', coalesce((select jsonb_object_agg(z.reason, z.n) from (
                  select coalesce(x.reason, 'other') as reason, count(*) as n from public.broadcast_recipients x
                   where x.broadcast_id = p_id and x.status in ('skipped', 'cancelled') group by 1) z), '{}'::jsonb),
    'unsubscribed', (select count(*) from public.email_signals e where e.broadcast_id = p_id and e.kind = 'unsubscribe'),
    'tapped', (select count(distinct l.person_id) from public.email_links l where l.broadcast_id = p_id and l.kind = 'go' and l.clicks > 0),
    'final_at', b.finished_at + interval '7 days') into r;
  if b.audience ->> 'kind' = 'placed_waiting' then
    -- Two more rows for a nudge: how many said yes since it went, and how many agreed to WhatsApp since
    r := r || jsonb_build_object('placed', jsonb_build_object(
      'asked', (select count(*) from public.placed_nudges n where n.broadcast_id = p_id and n.status = 'sent'),
      'said_yes', (select count(*) from public.placed_nudges n join public.tribe_members tm on tm.id = n.tm_id
                    where n.broadcast_id = p_id and n.status = 'sent' and tm.confirmed_at is not null and tm.confirmed_at > n.sent_at),
      'agreed', (select count(*) from public.placed_nudges n
                  where n.broadcast_id = p_id and n.status = 'sent'
                    and exists (select 1 from public.consents c where c.person_id = n.person_id and c.purpose = 'whatsapp' and c.granted and c.created_at > n.sent_at))));
  end if;
  return r;
end;
$$;

-- The Contact gaps download: one more column, whether the number is confirmed (never the number).
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
           'series', y.ser ->> 'state', 'emails', coalesce((y.ser ->> 'sends')::integer, 0),
           'number_confirmed', y.confirmed is not null)
           order by y.rank, y.tribe, y.name), '[]'::jsonb) into v_rows
    from (select public.person_display_name(g.person_id) as name, t.name as tribe, public.first_name_of(t.leader_id) as leader, g.cause,
                 h.n as asks, h.last_at as last_asked, public.number_confirmed(g.person_id) as confirmed,
                 public.reach_series_of(g.person_id, (select tm.season_id from public.tribe_members tm where tm.id = g.tm_id)) as ser,
                 case g.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4 when 'not_open' then 5 else 6 end as rank
            from public.contact_gap_rows(public.my_centre()) g
            join public.tribes t on t.id = g.tribe_id
           cross join lateral public.contact_ask_history(g.person_id) h) y;
  perform public.write_event(auth.uid(), 'contact_gaps.exported', 'contact_gaps', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Broadcasts guard: the buttons of a nudge are fixed, and a nudge is sent only while the function is On
-- ---------------------------------------------------------------------------
-- The nudge's buttons are made for each member when their email is sent, so the writer cannot add another button or page to it. And a nudge cannot go for
-- approval or be scheduled while the function is Rehearsal or Off: Rehearsal shows the counts and the test email, and sends nothing.
create function public.broadcasts_placed_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.audience ->> 'kind' = 'placed_waiting' then
    new.button_label := null;
    new.button_target := null;
    if (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status in ('awaiting_approval', 'scheduled') then
      v_state := public.placed_nudge_any();
      if v_state = 'rehearsal' then
        raise exception 'Rehearsal: nothing will be sent. Move the placed nudge to On to send it' using errcode = '22023';
      elsif v_state <> 'on' then
        raise exception 'The placed nudge is switched off, so nothing can be sent' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger broadcasts_placed_guard
  before insert or update on public.broadcasts
  for each row execute function public.broadcasts_placed_guard();

-- ---------------------------------------------------------------------------
-- The number a person already has, for the page
-- ---------------------------------------------------------------------------
-- The number we hold for a person when it looks real (the contact the member saved, else the one on their profile), or null.
create function public.placed_held_number(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when x.n is not null and not public.number_looks_made_up(x.n) and x.n ~ '^\+[1-9][0-9]{7,14}$' then x.n end
    from (select coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = p_person),
                          (select mp.whatsapp from public.member_profiles mp where mp.person_id = p_person)) as n) x;
$$;

-- ---------------------------------------------------------------------------
-- The office's views
-- ---------------------------------------------------------------------------
-- What the composer asks: is the choice offered at all? 'off' for anyone who is not the office.
create function public.placed_nudge_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.broadcast_role() is distinct from 'office' then
    return 'off';
  end if;
  return public.placed_nudge_any();
end;
$$;

-- The card on the admin home: how many placed members are waiting for a reply, and how many for more than two days. Counts only; never a name.
create function public.placed_nudge_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_waiting integer;
  v_two integer;
begin
  if auth.uid() is null or not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  v_state := public.placed_nudge_any();
  if v_state = 'off' then
    return jsonb_build_object('state', 'off');
  end if;
  select count(*)::integer, count(*) filter (where w.placed_at < now() - interval '2 days')::integer into v_waiting, v_two
    from public.placed_waiting_rows(public.my_centre()) w
   where not public.is_minor(w.person_id) and coalesce(public.message_blocker(w.person_id), '') not in ('under18', 'deletion');
  return jsonb_build_object('state', v_state, 'waiting', v_waiting, 'waited_two_days', v_two);
end;
$$;

-- What a tribe's leader, assistant, coach or a pastor or director sees about nudges: when a member still waiting was last reminded, and, for a member who has said
-- yes and agreed to WhatsApp, whether the number is confirmed. Never a number.
create function public.tribe_nudge_marks(p_tribe uuid)
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
          or public.has_any_role(array['pastor', 'director']::public.app_role[])) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'person_id', tm.person_id,
             'reminded_at', case when tm.confirmed_at is null then (select max(n.sent_at) from public.placed_nudges n where n.tm_id = tm.id and n.status = 'sent') end,
             'number_confirmed', tm.confirmed_at is not null and not tm.contact_withheld and public.consent_granted(tm.person_id, 'whatsapp')
                                 and public.number_confirmed(tm.person_id) is not null))
      from public.tribe_members tm
     where tm.tribe_id = p_tribe and tm.status = 'active' and tm.placement_source = 'auto'), '[]'::jsonb);
end;
$$;

-- For Contact gaps: how each of these people's numbers was confirmed ('signin' or 'message'); a person whose number is not confirmed is left out.
create function public.number_confirmed_for(p_people uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.contact_gaps_role() is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if p_people is null or cardinality(p_people) > 500 then
    raise exception 'Ask for up to 500 people at a time' using errcode = '22023';
  end if;
  return coalesce((select jsonb_object_agg(x.pid::text, x.how)
                     from (select p.pid, public.number_confirmed(p.pid) as how
                             from unnest(p_people) as p(pid)
                            where exists (select 1 from public.people q where q.id = p.pid and q.centre_id = public.my_centre())) x
                    where x.how is not null), '{}'::jsonb);
end;
$$;

-- "Confirmed on WhatsApp: 18 of 40": of the adults in a seat who have a number and have agreed to WhatsApp, how many numbers are confirmed.
create function public.whatsapp_confirmed_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agreed integer;
  v_confirmed integer;
begin
  if auth.uid() is null or public.contact_gaps_role() is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select count(*)::integer, count(*) filter (where public.number_confirmed(x.person_id) is not null)::integer into v_agreed, v_confirmed
    from (select distinct cm.person_id
            from public.tribe_members cm
            join public.tribes t on t.id = cm.tribe_id
            join public.seasons se on se.id = t.season_id
            join public.people p on p.id = cm.person_id
           where cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed' and p.centre_id = public.my_centre()
             and not public.is_minor(cm.person_id)
             and coalesce(public.message_blocker(cm.person_id), '') not in ('under18', 'deletion')
             and public.consent_granted(cm.person_id, 'whatsapp')
             and public.placed_held_number(cm.person_id) is not null) x;
  return jsonb_build_object('agreed', v_agreed, 'confirmed', v_confirmed);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's side: the private page, with no sign-in (the sending service's token is the credential, as for the placed page)
-- ---------------------------------------------------------------------------
-- Why a link did not open, without a name or a number: 'ok' (it opens), 'expired' (it ran out), 'gone' (the seat is not theirs now) or 'unknown' (we have no
-- such link). Opening it counts nothing.
create function public.worker_placed_link_state(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.placed_links%rowtype;
begin
  perform public.worker_ok(p_token);
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('state', 'unknown');
  end if;
  select * into l from public.placed_links x where x.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if not exists (select 1 from public.tribe_members tm where tm.id = l.placement_id and tm.status = 'active' and tm.placement_source = 'auto') then
    return jsonb_build_object('state', 'gone');
  end if;
  if l.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;
  return jsonb_build_object('state', 'ok');
end;
$$;

-- What the two-button page needs: whether it is On for this member, the number we hold (middle hidden), the number they sign in with (middle hidden), and whether
-- they have already agreed to WhatsApp. Nothing is offered to a member who held back their details, a teenager or a person whose deletion is open.
create function public.worker_placed_nudge_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
begin
  perform public.worker_ok(p_token);
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('on', false);
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  if tm.status <> 'active' or tm.confirmed_at is not null or tm.contact_withheld or public.is_minor(tm.person_id)
     or coalesce(public.message_blocker(tm.person_id), '') in ('under18', 'deletion')
     or public.feature_state_of('placed_nudge', tm.person_id) <> 'on' then
    return jsonb_build_object('on', false);
  end if;
  return jsonb_build_object('on', true,
    'number', public.reach_mask(public.placed_held_number(tm.person_id)),
    'signin', public.reach_mask(public.reach_signin_number(tm.person_id)),
    'yes', public.consent_granted(tm.person_id, 'whatsapp'));
end;
$$;

-- "Yes, I'm in", with the choice made on the page. One press, all or nothing:
--   email     says yes to the tribe, and nothing about WhatsApp
--   whatsapp  says yes to the tribe, saves the number (the one typed, the one they sign in with, or the one we hold) and records the member's yes to WhatsApp,
--             version placed-v1. A number that does not look right stops the whole press: the seat stays unconfirmed and nothing is saved.
-- A number that is the one they sign in with is confirmed on the spot (a code was sent to it).
create function public.worker_placed_choose(p_token text, p_link text, p_mode text, p_phone text, p_use_signin boolean, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tm uuid;
  tm public.tribe_members%rowtype;
  v jsonb;
  v_phone text;
  v_in text;
  v_match boolean := false;
begin
  perform public.worker_ok(p_token);
  if p_mode is null or p_mode not in ('whatsapp', 'email') then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_tm := public.placement_link_seat(p_link);
  if v_tm is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into tm from public.tribe_members x where x.id = v_tm;
  if p_mode = 'whatsapp' and (tm.contact_withheld or public.is_minor(tm.person_id) or coalesce(public.message_blocker(tm.person_id), '') in ('under18', 'deletion')) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  v := public.placement_do_confirm(v_tm, p_version);
  if (v ->> 'ok')::boolean is not true then
    return v;
  end if;
  if p_mode = 'email' then
    return jsonb_build_object('ok', true, 'mode', 'email');
  end if;

  -- The number is checked and saved here; a number that does not look right raises, and the yes above is undone with it
  perform public.reach_apply_number(tm.person_id,
    case when coalesce(p_use_signin, false) then null else coalesce(nullif(btrim(coalesce(p_phone, '')), ''), public.placed_held_number(tm.person_id)) end,
    false, coalesce(p_use_signin, false));
  if not public.consent_granted(tm.person_id, 'whatsapp') then
    insert into public.consents (person_id, purpose, granted, version) values (tm.person_id, 'whatsapp', true, 'placed-v1');
  end if;
  update public.contact_preferences set preferred = 'whatsapp', updated_at = now() where person_id = tm.person_id;
  v_phone := (select cp.phone from public.contact_preferences cp where cp.person_id = tm.person_id);
  -- A leader or coach reaches a member on the number the member shared, so keep the two in step
  update public.member_profiles set whatsapp = v_phone where person_id = tm.person_id;
  perform public.write_event(tm.person_id, 'placed.whatsapp_agreed', 'person', tm.person_id::text, jsonb_build_object('version', 'placed-v1'));

  v_in := public.reach_signin_number(tm.person_id);
  if v_in is not null and regexp_replace(v_in, '\D', '', 'g') = regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') then
    insert into public.number_confirmations (person_id, fingerprint, method) values (tm.person_id, public.number_fp(tm.person_id, v_phone), 'signin')
    on conflict (person_id, fingerprint, method) do nothing;
    perform public.write_event(tm.person_id, 'placed.number_confirmed', 'person', tm.person_id::text, jsonb_build_object('method', 'signin'));
    v_match := true;
  end if;
  return jsonb_build_object('ok', true, 'mode', 'whatsapp', 'confirmed', v_match);
end;
$$;

-- "Send me a fresh link": for a link that ran out. One email with a new link to the address we hold, three a day for one person at most, and only to someone who
-- may be written to and whose seat is still waiting. The answer is the same whoever asks, so it tells nobody anything.
create function public.worker_placed_new_link(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.placed_links%rowtype;
  tm public.tribe_members%rowtype;
  v_new text;
  v_params jsonb;
  v_msg uuid;
begin
  perform public.worker_ok(p_token);
  if p_link is null or p_link !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', true);
  end if;
  select * into l from public.placed_links x where x.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  if not found or not public.placed_is_waiting(l.placement_id) then
    return jsonb_build_object('ok', true);
  end if;
  select * into tm from public.tribe_members x where x.id = l.placement_id;
  if public.is_minor(l.person_id) or public.message_blocker(l.person_id) is not null then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.placed_links x where x.person_id = l.person_id and x.source = 'again' and x.created_at > now() - interval '1 day') >= 3 then
    return jsonb_build_object('ok', true);
  end if;
  v_params := (select m.params from public.messages m where m.dedupe_key = 'placement:' || tm.id limit 1);
  if v_params is null then
    return jsonb_build_object('ok', true);
  end if;
  v_new := public.placement_token_mint(tm.id, l.person_id, 60);
  update public.placed_links set source = 'again' where token_hash = encode(sha256(convert_to(v_new, 'UTF8')), 'hex');
  v_msg := public.enqueue_message(l.person_id, 'placement_reminder', v_params, tm.tribe_id,
    'placement-again:' || encode(sha256(convert_to(v_new, 'UTF8')), 'hex'), now(), 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_new where id = v_msg;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's settings (God Mode)
-- ---------------------------------------------------------------------------
create function public.god_placed_nudge_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.placed_nudge_settings%rowtype;
begin
  perform public.god_only();
  select * into s from public.placed_nudge_settings x where x.id;
  return jsonb_build_object('first_after_hours', s.first_after_hours, 'spacing_days', s.spacing_days, 'max_per_seat', s.max_per_seat,
    'reason', s.reason, 'changed_at', s.changed_at);
end;
$$;

create function public.god_placed_nudge_settings_set(p_first_after integer, p_spacing integer, p_max integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  o public.placed_nudge_settings%rowtype;
begin
  perform public.god_only();
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_first_after is null or p_first_after < 0 or p_first_after > 240 then
    raise exception 'The first nudge waits 0 to 240 hours after the placement email' using errcode = '22023';
  end if;
  if p_spacing is null or p_spacing < 1 or p_spacing > 14 then
    raise exception 'Nudges are 1 to 14 days apart' using errcode = '22023';
  end if;
  if p_max is null or p_max < 1 or p_max > 4 then
    raise exception 'A seat can be nudged 1 to 4 times' using errcode = '22023';
  end if;
  select * into o from public.placed_nudge_settings x where x.id for update;
  update public.placed_nudge_settings
     set first_after_hours = p_first_after, spacing_days = p_spacing, max_per_seat = p_max, reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'placed_nudge.settings', 'placed_nudge', null,
    jsonb_build_object('reason', v_reason,
      'from', jsonb_build_object('first_after', o.first_after_hours, 'spacing', o.spacing_days, 'max', o.max_per_seat),
      'to', jsonb_build_object('first_after', p_first_after, 'spacing', p_spacing, 'max', p_max)));
  return public.god_placed_nudge_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.placed_nudge_cfg(),
  public.placed_is_waiting(uuid),
  public.placed_nudge_seat(uuid),
  public.placed_email_at(uuid),
  public.placed_waiting_rows(uuid),
  public.placed_nudge_any(),
  public.placed_nudge_blocker(uuid, jsonb, boolean, uuid),
  public.number_fp(uuid, text),
  public.number_confirmed(uuid),
  public.placed_nudge_selfcheck(uuid),
  public.placed_held_number(uuid),
  public.broadcasts_placed_guard()
  from public, anon, authenticated;

revoke execute on function
  public.placed_nudge_state(),
  public.placed_nudge_overview(),
  public.tribe_nudge_marks(uuid),
  public.number_confirmed_for(uuid[]),
  public.whatsapp_confirmed_counts(),
  public.god_placed_nudge_settings(),
  public.god_placed_nudge_settings_set(integer, integer, integer, text)
  from public, anon;

grant execute on function
  public.placed_nudge_state(),
  public.placed_nudge_overview(),
  public.tribe_nudge_marks(uuid),
  public.number_confirmed_for(uuid[]),
  public.whatsapp_confirmed_counts(),
  public.god_placed_nudge_settings(),
  public.god_placed_nudge_settings_set(integer, integer, integer, text)
  to authenticated;

revoke execute on function
  public.worker_placed_link_state(text, text),
  public.worker_placed_nudge_info(text, text),
  public.worker_placed_choose(text, text, text, text, boolean, text),
  public.worker_placed_new_link(text, text)
  from public, anon, authenticated;

grant execute on function
  public.worker_placed_link_state(text, text),
  public.worker_placed_nudge_info(text, text),
  public.worker_placed_choose(text, text, text, text, boolean, text),
  public.worker_placed_new_link(text, text)
  to anon;

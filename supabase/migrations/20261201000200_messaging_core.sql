-- =============================================================================
-- United Tribes, Stage 2: the messaging engine (part 1: the outbox)
--
--   contact_preferences   how a person wants to be reached (number, preferred channel)
--   messages              the outbox and the log in one: every message the platform
--                         will send or has sent, one row each
--   worker_tokens         the one secret the sending service holds. It can run the
--                         outbox and nothing else. There is no service-role key anywhere.
--   calendar_runs         remembers which weekly rules have already run
--
-- The wording of each message lives in the app (src/lib/messaging), so it can be
-- improved without a migration. The database decides WHO gets WHAT and WHEN, and
-- checks consent at the moment of sending, not only when the message was queued.
--
-- Nobody reads or writes these tables directly. People use the functions below,
-- the sending service uses the worker_* functions with its token.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Contact preferences
-- ---------------------------------------------------------------------------

create table public.contact_preferences (
  person_id uuid primary key references public.people (id) on delete cascade,
  -- One number, used for WhatsApp and for SMS. Digits with the country code.
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  preferred text not null default 'whatsapp' check (preferred in ('whatsapp', 'email', 'sms')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid references public.centres (id),
  -- Who it is for: a person with an account, or (a referee, say) a bare address.
  person_id uuid references public.people (id) on delete cascade,
  to_email text check (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  to_phone text check (to_phone ~ '^\+[1-9][0-9]{7,14}$'),
  to_name text check (char_length(to_name) <= 120),
  circle_id uuid references public.circles (id) on delete set null,
  template text not null check (template ~ '^[a-z0-9_]{2,48}$'),
  -- Everything the wording needs, so a message reads the same however late it is sent.
  params jsonb not null default '{}'::jsonb check (pg_column_size(params) < 6000),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  -- When set, only this channel is tried (an urgent care alert goes out on email AND text).
  force_channel text check (force_channel in ('whatsapp', 'email', 'sms')),
  -- Stops the same message being queued twice when a rule runs again.
  dedupe_key text unique,
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  channel text check (channel in ('whatsapp', 'email', 'sms')),
  -- Channels already tried and given up on; the next one is chosen from the rest.
  tried text[] not null default '{}',
  attempts smallint not null default 0,
  provider_id text,
  error text check (char_length(error) <= 300),
  -- A secret in the "done / partly / not yet" buttons of the Friday message.
  reply_token text unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  check (person_id is not null or to_email is not null or to_phone is not null)
);
create index messages_queue_idx on public.messages (scheduled_for) where status in ('queued', 'sending');
create index messages_person_idx on public.messages (person_id, created_at desc);
create index messages_circle_idx on public.messages (circle_id, created_at desc);
create index messages_provider_idx on public.messages (provider_id) where provider_id is not null;
create index messages_status_idx on public.messages (status, created_at desc);

create table public.worker_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 60),
  token_hash text not null unique,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.calendar_runs (
  key text primary key,
  ran_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Small helpers (internal: not callable through the API)
-- ---------------------------------------------------------------------------

-- A Lagos wall-clock moment as a point in time.
create function public.lagos_at(p_day date, p_time time)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_day + coalesce(p_time, time '00:00')) at time zone 'Africa/Lagos';
$$;

-- The hour in Lagos right now. A function of its own so a test can stand in for the clock.
create function public.lagos_hour()
returns integer
language sql
stable
set search_path = ''
as $$
  select extract(hour from (now() at time zone 'Africa/Lagos'))::integer;
$$;

-- The latest answer decides, as in has_consent(), but for any person (the sender is not that person).
create function public.consent_granted(p_person uuid, p_purpose public.consent_purpose)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.granted from public.consents c
                    where c.person_id = p_person and c.purpose = p_purpose
                    order by c.id desc limit 1), false);
$$;

-- Email is a service every account has; it stops only when the person says so.
create function public.email_opted_out(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select not c.granted from public.consents c
                    where c.person_id = p_person and c.purpose = 'email'
                    order by c.id desc limit 1), false);
$$;

-- The people who answer an urgent care alert: Care Leads; if there are none, directors; then admins.
create function public.care_team()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.person_roles where role = 'care_lead') then
    return query select distinct r.person_id from public.person_roles r where r.role = 'care_lead';
  elsif exists (select 1 from public.person_roles where role = 'director') then
    return query select distinct r.person_id from public.person_roles r where r.role = 'director';
  else
    return query select distinct r.person_id from public.person_roles r where r.role = 'admin';
  end if;
end;
$$;

-- Queue one message. Safe to call twice with the same dedupe key.
create function public.enqueue_message(
  p_person uuid,
  p_template text,
  p_params jsonb default '{}'::jsonb,
  p_circle uuid default null,
  p_dedupe text default null,
  p_at timestamptz default null,
  p_urgency text default 'normal',
  p_force text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_to_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  v_centre uuid;
  v_token text := null;
begin
  if p_person is null and p_to_email is null and p_to_phone is null then
    return null;
  end if;
  if p_person is not null then
    select p.centre_id into v_centre from public.people p where p.id = p_person;
    if v_centre is null then
      return null;
    end if;
  else
    select c.id into v_centre from public.centres c where c.active order by c.created_at limit 1;
  end if;
  if p_template = 'friday_checkin' then
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;

  insert into public.messages
    (centre_id, person_id, to_email, to_phone, to_name, circle_id, template, params, urgency, force_channel,
     dedupe_key, scheduled_for, reply_token)
  values
    (v_centre, p_person, lower(p_to_email), p_to_phone, p_to_name, p_circle, p_template,
     coalesce(p_params, '{}'::jsonb), coalesce(p_urgency, 'normal'), p_force,
     p_dedupe, coalesce(p_at, now()), v_token)
  on conflict (dedupe_key) do nothing
  returning id into new_id;
  return new_id;
end;
$$;

-- The channels that may be used for a message right now, best first.
create function public.message_channels(p_msg uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  cp public.contact_preferences%rowtype;
  v_email text;
  v_phone text;
  v_order text[] := array['whatsapp', 'email', 'sms'];
  v_out text[] := '{}';
  ch text;
begin
  select * into m from public.messages where id = p_msg;
  if not found then
    return '{}';
  end if;
  if m.person_id is not null then
    select p.email into v_email from public.people p where p.id = m.person_id;
    select * into cp from public.contact_preferences c where c.person_id = m.person_id;
    v_phone := cp.phone;
  else
    v_email := m.to_email;
    v_phone := m.to_phone;
  end if;

  if m.force_channel is not null then
    if m.force_channel = any (m.tried) then
      return '{}';
    end if;
    if (m.force_channel = 'email' and v_email is not null) or (m.force_channel <> 'email' and v_phone is not null) then
      return array[m.force_channel];
    end if;
    return '{}';
  end if;

  if cp.preferred is not null then
    v_order := array[cp.preferred] || array_remove(v_order, cp.preferred);
  end if;
  foreach ch in array v_order loop
    continue when ch = any (m.tried);
    if ch = 'whatsapp' and v_phone is not null
       and (m.person_id is null or public.consent_granted(m.person_id, 'whatsapp')) then
      v_out := v_out || ch;
    elsif ch = 'email' and v_email is not null
       and (m.person_id is null or not public.email_opted_out(m.person_id)) then
      v_out := v_out || ch;
    elsif ch = 'sms' and v_phone is not null
       and (m.person_id is null or public.consent_granted(m.person_id, 'sms')) then
      v_out := v_out || ch;
    end if;
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- A person's own contact settings
-- ---------------------------------------------------------------------------

create function public.my_contact()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cp public.contact_preferences%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into cp from public.contact_preferences where person_id = uid;
  return jsonb_build_object(
    'email', (select p.email from public.people p where p.id = uid),
    'phone', cp.phone,
    'preferred', coalesce(cp.preferred, 'whatsapp'),
    'whatsapp', public.consent_granted(uid, 'whatsapp'),
    'sms', public.consent_granted(uid, 'sms'),
    'email_ok', not public.email_opted_out(uid));
end;
$$;

create function public.save_contact(
  p_phone text,
  p_preferred text,
  p_whatsapp boolean,
  p_sms boolean,
  p_email boolean,
  p_version text default 'contact-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_pref text := coalesce(p_preferred, 'whatsapp');
  v_version text := coalesce(p_version, 'contact-v1');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_pref not in ('whatsapp', 'email', 'sms') then
    raise exception 'Choose WhatsApp, email or text message' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Write the number with its country code, like +2348031234567' using errcode = '22023';
  end if;
  if (coalesce(p_whatsapp, false) or coalesce(p_sms, false)) and v_phone is null then
    raise exception 'Add a phone number to be reached on WhatsApp or by text message' using errcode = '22023';
  end if;
  if v_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  if v_pref = 'whatsapp' and not coalesce(p_whatsapp, false) then
    v_pref := case when coalesce(p_email, true) then 'email' else 'sms' end;
  end if;
  if v_pref = 'sms' and not coalesce(p_sms, false) then
    v_pref := case when coalesce(p_whatsapp, false) then 'whatsapp' else 'email' end;
  end if;
  if v_pref = 'email' and not coalesce(p_email, true) then
    v_pref := case when coalesce(p_whatsapp, false) then 'whatsapp' else 'sms' end;
  end if;

  insert into public.contact_preferences (person_id, phone, preferred)
  values (uid, v_phone, v_pref)
  on conflict (person_id) do update set phone = excluded.phone, preferred = excluded.preferred, updated_at = now();

  -- Record each change in the ledger; withdrawing has its effect through the ledger's own trigger.
  if coalesce(p_whatsapp, false) is distinct from public.consent_granted(uid, 'whatsapp') then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'whatsapp', coalesce(p_whatsapp, false), v_version);
  end if;
  if coalesce(p_sms, false) is distinct from public.consent_granted(uid, 'sms') then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'sms', coalesce(p_sms, false), v_version);
  end if;
  if coalesce(p_email, true) is distinct from (not public.email_opted_out(uid)) then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'email', coalesce(p_email, true), v_version);
  end if;

  -- A leader or coach reaches a member on the number the member shared, so keep the two in step.
  update public.member_profiles
     set whatsapp = case when coalesce(p_whatsapp, false) then v_phone else null end
   where person_id = uid;

  perform public.write_event(uid, 'contact.saved', 'person', uid::text,
    jsonb_build_object('preferred', v_pref, 'whatsapp', coalesce(p_whatsapp, false), 'sms', coalesce(p_sms, false)));
  return public.my_contact();
end;
$$;

-- ---------------------------------------------------------------------------
-- The sending service's token
-- ---------------------------------------------------------------------------

-- Checks the token and notes that it was used. Anything else is refused.
create function public.worker_ok(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select t.id into v_id from public.worker_tokens t
   where t.token_hash = public.referee_token_hash(p_token) and t.revoked_at is null;
  if v_id is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.worker_tokens set last_used_at = now()
   where id = v_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
end;
$$;

create function public.new_worker_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'utw_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- One-time setup, from the Supabase SQL editor (never from the app):
--   select public.bootstrap_worker_token('production');
-- The token is shown once. Put it in WORKER_TOKEN on the host.
create function public.bootstrap_worker_token(p_label text default 'production')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := public.new_worker_secret();
begin
  if exists (select 1 from public.worker_tokens where revoked_at is null) then
    raise exception 'A sending token already exists. An admin can make another on the Admin page.' using errcode = '23505';
  end if;
  insert into public.worker_tokens (label, token_hash) values (p_label, public.referee_token_hash(v_secret));
  return v_secret;
end;
$$;

create function public.create_worker_token(p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_secret text := public.new_worker_secret();
  v_id uuid;
begin
  if uid is null or not public.has_role('admin') then
    raise exception 'Only an admin can make a sending token' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_label, ''))) < 2 then
    raise exception 'Give the token a name' using errcode = '22023';
  end if;
  insert into public.worker_tokens (label, token_hash, created_by)
  values (btrim(p_label), public.referee_token_hash(v_secret), uid)
  returning id into v_id;
  perform public.write_event(uid, 'worker_token.created', 'worker_token', v_id::text, '{}'::jsonb);
  return v_secret;
end;
$$;

create function public.list_worker_tokens()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only an admin can see sending tokens' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'label', t.label, 'created_at', t.created_at,
             'last_used_at', t.last_used_at, 'revoked_at', t.revoked_at) order by t.created_at desc)
      from public.worker_tokens t), '[]'::jsonb);
end;
$$;

create function public.revoke_worker_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_role('admin') then
    raise exception 'Only an admin can revoke a sending token' using errcode = '42501';
  end if;
  update public.worker_tokens set revoked_at = now() where id = p_id and revoked_at is null;
  if not found then
    raise exception 'That token is not active' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'worker_token.revoked', 'worker_token', p_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The outbox, as the sending service sees it
-- ---------------------------------------------------------------------------

-- Hands out the messages that are due, choosing the channel for each at this moment.
create function public.worker_claim(p_token text, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_hour integer := public.lagos_hour();
  v_channels text[];
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_first text;
begin
  perform public.worker_ok(p_token);

  for m in
    select * from public.messages x
     where ((x.status = 'queued' and x.scheduled_for <= now())
         or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'))
       -- quiet hours: nothing but urgent messages between 22:00 and 06:00 in Lagos
       and (x.urgency = 'urgent' or v_hour between 6 and 21)
     order by (x.urgency = 'urgent') desc, x.scheduled_for
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  loop
    v_channels := public.message_channels(m.id);
    if cardinality(v_channels) = 0 then
      update public.messages
         set status = case when m.urgency = 'urgent' then 'failed' else 'skipped' end,
             error = coalesce(nullif(m.error, ''), 'no channel the person has agreed to'),
             channel = null
       where id = m.id;
      continue;
    end if;

    update public.messages
       set status = 'sending', channel = v_channels[1], claimed_at = now(), attempts = m.attempts + 1
     where id = m.id;

    if m.person_id is not null then
      select p.email, public.person_display_name(p.id), public.first_name_of(p.id), cp.phone
        into v_email, v_name, v_first, v_phone
        from public.people p
        left join public.contact_preferences cp on cp.person_id = p.id
       where p.id = m.person_id;
    else
      v_email := m.to_email;
      v_phone := m.to_phone;
      v_name := m.to_name;
      v_first := split_part(coalesce(m.to_name, ''), ' ', 1);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', m.id,
      'template', m.template,
      'channel', v_channels[1],
      'params', m.params,
      'urgency', m.urgency,
      'attempts', m.attempts + 1,
      'reply_token', m.reply_token,
      'to', jsonb_build_object('email', v_email, 'phone', v_phone, 'name', v_name, 'first_name', nullif(v_first, ''))));
  end loop;
  return v_out;
end;
$$;

-- The service says how a send went: sent, retry (a hiccup), or rejected (this channel will not work for them).
create function public.worker_report(
  p_token text,
  p_id uuid,
  p_outcome text,
  p_provider_id text default null,
  p_error text default null,
  p_retry_minutes integer default 10
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
  v_next text[];
begin
  perform public.worker_ok(p_token);
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'rejected') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  select * into m from public.messages where id = p_id for update;
  if not found or m.status <> 'sending' then
    return;
  end if;

  if p_outcome = 'sent' then
    update public.messages
       set status = 'sent', sent_at = now(), provider_id = left(p_provider_id, 120), error = null,
           -- a link that works as a key is not kept once it has been sent
           params = case when template in ('referee_request') then jsonb_build_object('scrubbed', true) else params end
     where id = p_id;
    return;
  end if;

  if p_outcome = 'retry' and m.attempts < 3 then
    update public.messages
       set status = 'queued', scheduled_for = now() + make_interval(mins => greatest(1, least(coalesce(p_retry_minutes, 10), 240))),
           error = v_err
     where id = p_id;
    return;
  end if;

  -- Give up on this channel; try the next one the person has agreed to.
  update public.messages set tried = tried || coalesce(m.channel, ''), attempts = 0, error = v_err where id = p_id;
  v_next := public.message_channels(p_id);
  if cardinality(v_next) = 0 then
    update public.messages set status = 'failed', channel = coalesce(channel, m.channel) where id = p_id;
  else
    update public.messages set status = 'queued', scheduled_for = now() where id = p_id;
  end if;
end;
$$;

-- Delivery news from WhatsApp or the email provider, matched by their message id.
create function public.worker_provider_event(p_token text, p_provider_id text, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
  v_next text[];
begin
  perform public.worker_ok(p_token);
  if p_provider_id is null or p_status not in ('delivered', 'read', 'failed') then
    return;
  end if;
  select * into m from public.messages where provider_id = p_provider_id order by created_at desc limit 1 for update;
  if not found then
    return;
  end if;

  if p_status = 'delivered' then
    update public.messages
       set delivered_at = coalesce(delivered_at, now()),
           status = case when status in ('sent', 'sending') then 'delivered' else status end
     where id = m.id;
  elsif p_status = 'read' then
    update public.messages
       set delivered_at = coalesce(delivered_at, now()), read_at = coalesce(read_at, now()), status = 'read'
     where id = m.id;
  elsif m.status in ('sent', 'sending') then
    -- It never arrived. Try the next channel.
    update public.messages set tried = tried || coalesce(m.channel, ''), attempts = 0, error = v_err, provider_id = null where id = m.id;
    v_next := public.message_channels(m.id);
    if cardinality(v_next) = 0 then
      update public.messages set status = 'failed' where id = m.id;
    else
      update public.messages set status = 'queued', scheduled_for = now() where id = m.id;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The Friday check-in by reply: one tap on WhatsApp, a link in email or text
-- ---------------------------------------------------------------------------

-- The check-in logic once, for the member's own screen and for the reply.
create function public.apply_checkin(p_person uuid, p_week integer, p_outcome text, p_reflection text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pm public.circle_members%rowtype;
  s public.seasons%rowtype;
  ws date;
  today date := public.today_lagos();
  refl text := nullif(btrim(coalesce(p_reflection, '')), '');
  prev_outcome text;
begin
  select * into pm from public.current_placement(p_person);
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
  if not exists (select 1 from public.week_steps where person_id = p_person and circle_id = pm.circle_id and week = p_week) then
    raise exception 'Set your step for the week before you check in' using errcode = '22023';
  end if;
  update public.week_steps
     set outcome = p_outcome, reflection = coalesce(refl, reflection), checked_at = now(), updated_at = now()
   where person_id = p_person and circle_id = pm.circle_id and week = p_week;

  if p_outcome = 'not_yet' and p_week > 1 then
    select x.outcome into prev_outcome from public.week_steps x
     where x.person_id = p_person and x.circle_id = pm.circle_id and x.week = p_week - 1;
    if prev_outcome = 'not_yet' then
      insert into public.care_flags (circle_id, person_id, kind, week)
      values (pm.circle_id, p_person, 'not_yet_twice', p_week)
      on conflict (person_id, circle_id, kind) where status <> 'closed' do nothing;
    end if;
  end if;
end;
$$;

create or replace function public.save_checkin(p_week integer, p_outcome text, p_reflection text)
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
  perform public.apply_checkin(uid, p_week, p_outcome, p_reflection);
end;
$$;

-- What the reply page shows before the person taps.
create function public.worker_reply_info(p_token text, p_reply_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_week integer;
  st public.week_steps%rowtype;
  s public.seasons%rowtype;
  ws date;
  today date := public.today_lagos();
begin
  perform public.worker_ok(p_token);
  select * into m from public.messages where reply_token = p_reply_token and template = 'friday_checkin';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  v_week := nullif(m.params ->> 'week', '')::integer;
  select x.* into st from public.week_steps x where x.person_id = m.person_id and x.circle_id = m.circle_id and x.week = v_week;
  select se.* into s from public.circles c join public.seasons se on se.id = c.season_id where c.id = m.circle_id;
  ws := s.starts_on + (v_week - 1) * 7;
  return jsonb_build_object(
    'found', true,
    'first_name', public.first_name_of(m.person_id),
    'week', v_week,
    'step_set', st.person_id is not null,
    'when', st.when_text,
    'will', st.will_text,
    'outcome', st.outcome,
    'open', today between ws + 5 and ws + 9,
    'closed', today > ws + 9);
end;
$$;

create function public.worker_checkin_reply(p_token text, p_reply_token text, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_week integer;
begin
  perform public.worker_ok(p_token);
  select * into m from public.messages where reply_token = p_reply_token and template = 'friday_checkin';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  v_week := nullif(m.params ->> 'week', '')::integer;
  begin
    perform public.apply_checkin(m.person_id, v_week, p_outcome, null);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'reason', 'not_now', 'message', sqlerrm);
  end;
  perform public.write_event(m.person_id, 'checkin.by_reply', 'circle', m.circle_id::text,
    jsonb_build_object('week', v_week, 'outcome', p_outcome, 'channel', m.channel));
  return jsonb_build_object('ok', true, 'outcome', p_outcome, 'week', v_week);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office: what was sent, what failed
-- ---------------------------------------------------------------------------

create function public.message_log(p_status text default null, p_template text default null, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see the message log' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'to', coalesce(public.person_display_name(x.person_id), x.to_name, x.to_email, x.to_phone),
             'template', x.template, 'channel', x.channel, 'status', x.status, 'urgency', x.urgency,
             'tried', to_jsonb(x.tried), 'attempts', x.attempts, 'error', x.error,
             'scheduled_for', x.scheduled_for, 'sent_at', x.sent_at, 'delivered_at', x.delivered_at, 'read_at', x.read_at,
             'created_at', x.created_at) order by x.created_at desc)
      from (
        select * from public.messages m
         where (p_status is null or m.status = p_status)
           and (p_template is null or m.template = p_template)
         order by m.created_at desc
         limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end;
$$;

create function public.message_stats(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
begin
  if not public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see message totals' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 7), 90)),
    'queued', (select count(*) from public.messages where status in ('queued', 'sending')),
    'sent', (select count(*) from public.messages where created_at >= v_since and status in ('sent', 'delivered', 'read')),
    'delivered', (select count(*) from public.messages where created_at >= v_since and status in ('delivered', 'read')),
    'read', (select count(*) from public.messages where created_at >= v_since and status = 'read'),
    'failed', (select count(*) from public.messages where created_at >= v_since and status = 'failed'),
    'skipped', (select count(*) from public.messages where created_at >= v_since and status = 'skipped'),
    'by_channel', coalesce((
      select jsonb_object_agg(channel, n) from (
        select channel, count(*) as n from public.messages
         where created_at >= v_since and status in ('sent', 'delivered', 'read') and channel is not null group by channel) c), '{}'::jsonb),
    'by_template', coalesce((
      select jsonb_agg(jsonb_build_object('template', template, 'count', n) order by n desc) from (
        select template, count(*) as n from public.messages where created_at >= v_since group by template order by n desc limit 12) t), '[]'::jsonb),
    'last_sent_at', (select max(sent_at) from public.messages),
    'last_worker_seen', (select max(last_used_at) from public.worker_tokens where revoked_at is null));
end;
$$;

create function public.retry_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
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
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- A referee's link, sent for the applicant
-- ---------------------------------------------------------------------------

-- The applicant has just made a fresh link (renew_referee_link) and asks us to send it.
create function public.send_referee_link(p_reference uuid, p_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.leader_references%rowtype;
  a public.leader_applications%rowtype;
  v_contact text;
  v_email text;
  v_phone text;
  v_sent integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id and person_id = uid;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  if r.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;
  if p_link is null or p_link !~ '^https?://[^[:space:]]{8,255}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select count(*) into v_sent from public.messages
   where template = 'referee_request' and dedupe_key like 'referee:' || p_reference::text || ':%' and created_at > now() - interval '1 day';
  if v_sent >= 3 then
    raise exception 'We have already sent this link three times today. Share it yourself, or try again tomorrow.' using errcode = '22023';
  end if;

  v_contact := btrim(r.contact);
  if position('@' in v_contact) > 1 then
    v_email := lower(v_contact);
  else
    v_phone := regexp_replace(v_contact, '[\s()-]', '', 'g');
    if v_phone ~ '^0[0-9]{10}$' then
      v_phone := '+234' || substr(v_phone, 2);
    end if;
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'We could not read that contact as an email address or a phone number. Share the link yourself.' using errcode = '22023';
    end if;
  end if;

  perform public.enqueue_message(
    null, 'referee_request',
    jsonb_build_object('referee', r.referee_name, 'applicant', public.person_display_name(uid),
                       'applicant_first', public.first_name_of(uid), 'link', p_link),
    null, 'referee:' || p_reference::text || ':' || gen_random_uuid()::text,
    null, 'normal', null, v_email, v_phone, r.referee_name);
  perform public.write_event(uid, 'reference.link_sent', 'reference', p_reference::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.contact_preferences enable row level security;
alter table public.messages enable row level security;
alter table public.worker_tokens enable row level security;
alter table public.calendar_runs enable row level security;
-- No grants: only the functions touch these tables.

revoke execute on function
  public.lagos_at(date, time),
  public.lagos_hour(),
  public.consent_granted(uuid, public.consent_purpose),
  public.email_opted_out(uuid),
  public.care_team(),
  public.enqueue_message(uuid, text, jsonb, uuid, text, timestamptz, text, text, text, text, text),
  public.message_channels(uuid),
  public.my_contact(),
  public.save_contact(text, text, boolean, boolean, boolean, text),
  public.worker_ok(text),
  public.new_worker_secret(),
  public.bootstrap_worker_token(text),
  public.create_worker_token(text),
  public.list_worker_tokens(),
  public.revoke_worker_token(uuid),
  public.worker_claim(text, integer),
  public.worker_report(text, uuid, text, text, text, integer),
  public.worker_provider_event(text, text, text, text),
  public.apply_checkin(uuid, integer, text, text),
  public.save_checkin(integer, text, text),
  public.worker_reply_info(text, text),
  public.worker_checkin_reply(text, text, text),
  public.message_log(text, text, integer),
  public.message_stats(integer),
  public.retry_message(uuid),
  public.send_referee_link(uuid, text)
  from public, anon, authenticated;

-- People
grant execute on function
  public.my_contact(),
  public.save_contact(text, text, boolean, boolean, boolean, text),
  public.save_checkin(integer, text, text),
  public.send_referee_link(uuid, text),
  public.create_worker_token(text),
  public.list_worker_tokens(),
  public.revoke_worker_token(uuid),
  public.message_log(text, text, integer),
  public.message_stats(integer),
  public.retry_message(uuid)
  to authenticated;

-- The sending service has no account; the token is the credential.
grant execute on function
  public.worker_claim(text, integer),
  public.worker_report(text, uuid, text, text, text, integer),
  public.worker_provider_event(text, text, text, text),
  public.worker_reply_info(text, text),
  public.worker_checkin_reply(text, text, text)
  to anon, authenticated;

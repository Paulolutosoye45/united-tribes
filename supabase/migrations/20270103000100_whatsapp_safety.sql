-- =============================================================================
-- United Tribes: WhatsApp that cannot fail quietly, stage 1 (the safety net)
--
-- What this adds, and nothing else. One new function on the Switchboard (God Mode -> Features), "WhatsApp safety net", which starts Off:
--
--   Pause           a person (the admin, a director or the data lead) pauses every WhatsApp message with a reason. A paused message is not lost:
--                   it goes to the member's next channel (email, then text, as they agreed), exactly as it does today when WhatsApp rejects it.
--   Automatic pause when Meta rejects the account itself (an expired token, a test number, a payment or policy problem) five times in thirty
--                   minutes (both numbers can be changed), WhatsApp pauses itself and tells the director and the admin by email, never by WhatsApp.
--                   Nothing turns it back on by itself: a person restarts it.
--   What was missed a count of messages Meta accepted but never confirmed, on the Messages page.
--
-- The three positions. Off: nothing here runs and the outbox behaves exactly as it did before. Rehearsal: faults are written down and the page says
-- when it WOULD have paused; nothing is held back and nobody is emailed. On: a pause (by a person or by the rule) takes effect.
--
-- Also here, because every later stage uses them and none of them changes anything while its switch is Off:
--   * the Switchboard learns two more groups (stage 7 and 8) and a flag, platform_only, for a function that only makes sense for the whole church;
--   * feature_platform_state(), the answer for such a function; a rule for one cannot be limited to a place or a role.
--
-- What it never does: it does not change the wording, the order or the consent rules of any message, a member's channel choice, a template, a
-- reminder or a report. The golden recordings of how the platform answers and of every email are unchanged.
--
-- Replaced, because they now know about the pause (the old text of each is in the rollback file): message_channels, god_feature_board.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The Switchboard: two more groups, and a function that is for the whole church only
-- ---------------------------------------------------------------------------
alter table public.feature_registry drop constraint feature_registry_stage_check;
alter table public.feature_registry add constraint feature_registry_stage_check check (stage between 1 and 8);
alter table public.feature_registry add column platform_only boolean not null default false;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('whatsapp_guard', 'WhatsApp safety net', 'A pause for every WhatsApp message, and an automatic pause when Meta rejects the church''s account itself. Rehearsal writes down when it would have paused and holds nothing back. For the whole church only.', 7, '{}', array['off', 'rehearsal', 'on'], 'off', true, 22, true);

-- A rule for a whole-church-only function cannot name a place, a role or a hold-out, so there is never a second answer to wonder about.
create function public.feature_platform_only_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.feature_registry f where f.key = new.feature and f.platform_only)
     and (new.scope <> 'platform' or new.roles <> '{}' or new.holdout_until is not null) then
    raise exception 'This function is for the whole church only. It cannot be limited to a place, a role or a group of tribes' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger feature_settings_platform_only
  before insert or update on public.feature_settings
  for each row execute function public.feature_platform_only_guard();

-- The answer for a whole-church-only function, with no person in it: 'off', 'rehearsal' or 'on'. The Master pause, then the church-wide rule,
-- then every function it depends on. Anything that goes wrong is 'off'. Not callable by anyone.
create function public.feature_platform_state(p_key text, p_depth integer default 0)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.feature_registry;
  r public.feature_settings;
  v_pos text;
  d text;
begin
  if p_depth > 4 then
    return 'off';
  end if;
  if coalesce((select m.paused from public.feature_master m where m.id), true) then
    return 'off';
  end if;
  select * into f from public.feature_registry x where x.key = p_key;
  if not found or not f.available then
    return 'off';
  end if;
  select s.* into r from public.feature_settings s where s.feature = p_key and s.scope = 'platform' limit 1;
  v_pos := coalesce(r.position, f.default_mode);
  if not (v_pos = any (f.modes)) or v_pos = 'off' then
    return 'off';
  end if;
  foreach d in array f.depends loop
    if public.feature_rank(public.feature_platform_state(d, p_depth + 1)) < public.feature_rank(v_pos) then
      return 'off';
    end if;
  end loop;
  return v_pos;
exception when others then
  return 'off';
end;
$$;

-- The board tells the page which functions are for the whole church only (one key more than before).
create or replace function public.god_feature_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.feature_master;
begin
  perform public.god_only();
  select * into m from public.feature_master x where x.id;
  return jsonb_build_object(
    'paused', m.paused, 'pausedReason', m.reason, 'pausedAt', m.changed_at,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'name', f.name, 'blurb', f.blurb, 'stage', f.stage, 'depends', to_jsonb(f.depends), 'modes', to_jsonb(f.modes),
               'default', f.default_mode, 'available', f.available, 'summary', public.feature_summary(f.key), 'platformOnly', f.platform_only,
               'rules', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'scope', s.scope, 'scopeId', s.scope_id, 'label', public.feature_scope_label(s.scope, s.scope_id),
                          'position', s.position, 'roles', to_jsonb(s.roles), 'reason', s.reason, 'holdoutUntil', s.holdout_until, 'at', s.set_at)
                        order by case s.scope when 'platform' then 1 when 'centre' then 2 when 'community' then 3 when 'tribe' then 4 else 5 end, s.set_at)
                         from public.feature_settings s where s.feature = f.key), '[]'::jsonb))
             order by f.sort)
        from public.feature_registry f), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The pause, its log, and the faults that count
-- ---------------------------------------------------------------------------
-- One row. While `paused` is true and the safety net is On, no message is sent on WhatsApp.
create table public.whatsapp_guard (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  -- true when the rule paused it, false when a person did
  auto boolean not null default false,
  reason text check (char_length(reason) <= 300),
  paused_at timestamptz,
  paused_by uuid references public.people (id) on delete set null,
  -- faults before this moment are not counted again after a restart
  cleared_at timestamptz,
  -- the two numbers of the automatic rule
  trip_count smallint not null default 5 check (trip_count between 2 and 50),
  trip_minutes smallint not null default 30 check (trip_minutes between 5 and 240),
  -- how long a message Meta accepted may go without a receipt before it is counted as unconfirmed
  unconfirmed_hours smallint not null default 24 check (unconfirmed_hours between 2 and 168),
  -- in Rehearsal: when the rule last said "I would have paused"
  would_pause_at timestamptz
);
insert into public.whatsapp_guard (id) values (true);
alter table public.whatsapp_guard enable row level security;
revoke all on table public.whatsapp_guard from public, anon, authenticated;

create table public.whatsapp_guard_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('paused', 'resumed', 'auto_paused', 'would_pause', 'settings')),
  by_person uuid references public.people (id) on delete set null,
  reason text check (char_length(reason) <= 300),
  detail jsonb not null default '{}'::jsonb
);
create index whatsapp_guard_log_at_idx on public.whatsapp_guard_log (at desc);
alter table public.whatsapp_guard_log enable row level security;
revoke all on table public.whatsapp_guard_log from public, anon, authenticated;

-- A rejection that says something about the church's account and not about one member. Kept three days, only to be counted.
create table public.whatsapp_faults (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  message_id uuid,
  code integer not null
);
create index whatsapp_faults_at_idx on public.whatsapp_faults (at desc);
alter table public.whatsapp_faults enable row level security;
revoke all on table public.whatsapp_faults from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------
-- Who may pause and restart WhatsApp, and read the numbers: the same people who run WhatsApp sign-in.
create function public.whatsapp_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]);
$$;

-- What a stored error says about the account, as a number, or null when it is about one member (or not WhatsApp at all). The sender writes
-- "meta 131030: ..." for a reply from Meta and "http 401" when Meta gave no code.
--   10, 200   the access token lacks a permission        190      the access token has expired or is wrong
--   368       the account is temporarily blocked         131030   the sender is a test number and the recipient is not on its list
--   131031    the account is locked                      131037   the display name needs approval
--   131042    a payment problem on the account           131045   the sending number is not registered
--   401, 403  Meta refused our access without a code
create function public.whatsapp_fault_code(p_error text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code integer;
begin
  if p_error is null then
    return null;
  end if;
  if p_error ~ '^meta [0-9]{1,6}' then
    v_code := (substring(p_error from '^meta ([0-9]{1,6})'))::integer;
    if v_code in (10, 190, 200, 368, 131030, 131031, 131037, 131042, 131045) then
      return v_code;
    end if;
    return null;
  end if;
  if p_error ~ '^http (401|403)' then
    return (substring(p_error from '^http ([0-9]{3})'))::integer;
  end if;
  return null;
end;
$$;

-- Is the safety net On, and has WhatsApp been paused? Any fault answers "not paused": the platform then behaves as it did before.
create function public.whatsapp_paused()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select g.paused from public.whatsapp_guard g where g.id), false) then
    return false;
  end if;
  return public.feature_platform_state('whatsapp_guard') = 'on';
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- The outbox learns about the pause
-- ---------------------------------------------------------------------------
-- The channels that may be used for a message right now, best first. The only difference from before: while WhatsApp is paused (by a person or by
-- the rule, with the safety net On) WhatsApp is left out, so the message goes to the next channel the person agreed to. A test message from the
-- health page is the one exception, so a person can try the account before restarting it.
create or replace function public.message_channels(p_msg uuid)
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
  v_hold boolean;
  ch text;
begin
  select * into m from public.messages where id = p_msg;
  if not found then
    return '{}';
  end if;
  v_hold := m.template <> 'whatsapp_test' and public.whatsapp_paused();
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
    if v_hold and m.force_channel = 'whatsapp' then
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
    continue when ch = 'whatsapp' and v_hold;
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
-- Watching for a fault with the account itself
-- ---------------------------------------------------------------------------
-- Called whenever a WhatsApp message gets a new error. Off: does nothing at all. Rehearsal: counts, and says when it would have paused. On: pauses
-- WhatsApp when the numbers are reached, writes it in the log and emails the director and the admin (never by WhatsApp: the alarm must not
-- depend on the channel that is failing). Internal.
create function public.whatsapp_note_fault(p_message uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := public.feature_platform_state('whatsapp_guard');
  v_code integer;
  g public.whatsapp_guard;
  v_n integer;
  v_event bigint;
begin
  if v_state = 'off' then
    return;
  end if;
  v_code := public.whatsapp_fault_code(p_error);
  if v_code is null then
    return;
  end if;
  select * into g from public.whatsapp_guard x where x.id for update;
  insert into public.whatsapp_faults (message_id, code) values (p_message, v_code);
  delete from public.whatsapp_faults where at < now() - interval '3 days';
  if g.paused then
    return;
  end if;
  select count(*)::integer into v_n
    from public.whatsapp_faults f
   where f.at > greatest(now() - make_interval(mins => g.trip_minutes), coalesce(g.cleared_at, '-infinity'::timestamptz));
  if v_n < g.trip_count then
    return;
  end if;
  if v_state = 'on' then
    update public.whatsapp_guard
       set paused = true, auto = true, paused_at = now(), paused_by = null,
           reason = left(format('Automatic: WhatsApp refused the account %s times in %s minutes (Meta code %s)', v_n, g.trip_minutes, v_code), 300)
     where id;
    insert into public.whatsapp_guard_log (kind, reason, detail)
    values ('auto_paused', left(format('%s rejections in %s minutes, latest code %s', v_n, g.trip_minutes, v_code), 300),
            jsonb_build_object('count', v_n, 'minutes', g.trip_minutes, 'code', v_code))
    returning id into v_event;
    perform public.signin_alert_staff('whatsapp_paused', jsonb_build_object('code', v_code, 'count', v_n, 'minutes', g.trip_minutes),
      'whatsapp_pause:' || v_event, array['director', 'admin']::public.app_role[]);
  elsif g.would_pause_at is null or g.would_pause_at < now() - make_interval(mins => g.trip_minutes) then
    update public.whatsapp_guard set would_pause_at = now() where id;
    insert into public.whatsapp_guard_log (kind, reason, detail)
    values ('would_pause', left(format('%s rejections in %s minutes, latest code %s', v_n, g.trip_minutes, v_code), 300),
            jsonb_build_object('count', v_n, 'minutes', g.trip_minutes, 'code', v_code));
  end if;
end;
$$;

-- Never allowed to stop a message: a fault in the watch is recorded for the office and the message carries on.
create function public.messages_fault_watch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.whatsapp_note_fault(new.id, new.error);
  exception when others then
    perform public.notice_fault('whatsapp_guard', sqlerrm);
  end;
  return null;
end;
$$;
create trigger messages_fault_watch
  after update of error on public.messages
  for each row
  when (new.channel = 'whatsapp' and new.error is not null and new.error is distinct from old.error)
  execute function public.messages_fault_watch();

-- ---------------------------------------------------------------------------
-- The people who run it
-- ---------------------------------------------------------------------------
-- How WhatsApp stands, for the Messages page. The admin, directors, the data lead and the pastor may read it; the platform owner is only ever
-- "an administrator".
create function public.whatsapp_guard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_guard;
  v_state text := public.feature_platform_state('whatsapp_guard');
  v_from timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'data_lead', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can read this' using errcode = '42501';
  end if;
  select * into g from public.whatsapp_guard x where x.id;
  v_from := greatest(now() - make_interval(mins => g.trip_minutes), coalesce(g.cleared_at, '-infinity'::timestamptz));
  return jsonb_build_object(
    'state', v_state,
    'paused', g.paused,
    'auto', g.auto,
    'reason', g.reason,
    'pausedAt', g.paused_at,
    'pausedBy', case when g.paused_by is null then null
                     when public.notice_is_owner(g.paused_by) then 'an administrator'
                     else coalesce(nullif(btrim((select p.full_name from public.people p where p.id = g.paused_by)), ''), 'someone in the office') end,
    'wouldPauseAt', g.would_pause_at,
    'canChange', public.whatsapp_manager(),
    'canSettings', public.has_any_role(array['admin', 'director']::public.app_role[]),
    'settings', jsonb_build_object('tripCount', g.trip_count, 'tripMinutes', g.trip_minutes, 'unconfirmedHours', g.unconfirmed_hours),
    'faultsNow', (select count(*) from public.whatsapp_faults f where f.at > v_from),
    'faultCodes', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'n', x.n) order by x.n desc, x.code)
                              from (select f.code, count(*)::integer as n from public.whatsapp_faults f where f.at > now() - interval '24 hours' group by f.code) x), '[]'::jsonb),
    'unconfirmed', public.whatsapp_unconfirmed(g.unconfirmed_hours),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'reason', l.reason,
                         'by', case when l.by_person is null then null
                                    when public.notice_is_owner(l.by_person) then 'an administrator'
                                    else coalesce(nullif(btrim((select p.full_name from public.people p where p.id = l.by_person)), ''), 'someone in the office') end)
                       order by l.id desc)
                       from (select * from public.whatsapp_guard_log x order by x.id desc limit 12) l), '[]'::jsonb));
end;
$$;

-- Messages Meta accepted that never got a receipt: how many, and since when the oldest has waited. Internal.
create function public.whatsapp_unconfirmed(p_hours integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('count', count(*), 'oldest', min(m.sent_at))
    from public.messages m
   where m.channel = 'whatsapp' and m.status = 'sent' and m.provider_id is not null and m.delivered_at is null
     and m.sent_at < now() - make_interval(hours => p_hours)
     and m.sent_at > now() - interval '30 days';
$$;

-- Pauses every WhatsApp message. Only while the safety net is On; the reason is kept in the log.
create function public.whatsapp_pause(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  g public.whatsapp_guard;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can pause WhatsApp' using errcode = '42501';
  end if;
  if public.feature_platform_state('whatsapp_guard') <> 'on' then
    raise exception 'The WhatsApp safety net is not switched On in God Mode, so a pause would do nothing. Ask the platform owner to switch it On' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 8 then
    raise exception 'Say why, in at least eight characters, so the log can tell the next person' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  select * into g from public.whatsapp_guard x where x.id for update;
  if g.paused then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.whatsapp_guard set paused = true, auto = false, reason = v_reason, paused_at = now(), paused_by = me where id;
  insert into public.whatsapp_guard_log (kind, by_person, reason) values ('paused', me, v_reason);
  perform public.write_event(me, 'whatsapp.paused', 'whatsapp', 'guard', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- Puts WhatsApp back. Nothing does this by itself. The faults counted so far are forgotten, so the same ones cannot pause it again.
create function public.whatsapp_resume(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  g public.whatsapp_guard;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can restart WhatsApp' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  select * into g from public.whatsapp_guard x where x.id for update;
  if not g.paused then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = now() where id;
  insert into public.whatsapp_guard_log (kind, by_person, reason) values ('resumed', me, v_reason);
  perform public.write_event(me, 'whatsapp.resumed', 'whatsapp', 'guard', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- The three numbers. Only the admin or a director; the log says what they were and what they became.
create function public.whatsapp_guard_settings_save(p_trip_count integer, p_trip_minutes integer, p_unconfirmed_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.whatsapp_guard;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only the admin or a director can change these' using errcode = '42501';
  end if;
  if p_trip_count is null or p_trip_count < 2 or p_trip_count > 50 then
    raise exception 'Choose between 2 and 50 rejections' using errcode = '22023';
  end if;
  if p_trip_minutes is null or p_trip_minutes < 5 or p_trip_minutes > 240 then
    raise exception 'Choose a window between 5 and 240 minutes' using errcode = '22023';
  end if;
  if p_unconfirmed_hours is null or p_unconfirmed_hours < 2 or p_unconfirmed_hours > 168 then
    raise exception 'Choose between 2 and 168 hours' using errcode = '22023';
  end if;
  select * into g from public.whatsapp_guard x where x.id for update;
  if g.trip_count = p_trip_count and g.trip_minutes = p_trip_minutes and g.unconfirmed_hours = p_unconfirmed_hours then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.whatsapp_guard set trip_count = p_trip_count, trip_minutes = p_trip_minutes, unconfirmed_hours = p_unconfirmed_hours where id;
  insert into public.whatsapp_guard_log (kind, by_person, reason, detail)
  values ('settings', me, null, jsonb_build_object(
    'from', jsonb_build_object('tripCount', g.trip_count, 'tripMinutes', g.trip_minutes, 'unconfirmedHours', g.unconfirmed_hours),
    'to', jsonb_build_object('tripCount', p_trip_count, 'tripMinutes', p_trip_minutes, 'unconfirmedHours', p_unconfirmed_hours)));
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function
  public.feature_platform_only_guard(),
  public.feature_platform_state(text, integer),
  public.whatsapp_manager(),
  public.whatsapp_fault_code(text),
  public.whatsapp_paused(),
  public.whatsapp_note_fault(uuid, text),
  public.messages_fault_watch(),
  public.whatsapp_unconfirmed(integer)
  from public, anon, authenticated;

revoke execute on function
  public.whatsapp_guard_overview(),
  public.whatsapp_pause(text),
  public.whatsapp_resume(text),
  public.whatsapp_guard_settings_save(integer, integer, integer)
  from public, anon;

grant execute on function
  public.whatsapp_guard_overview(),
  public.whatsapp_pause(text),
  public.whatsapp_resume(text),
  public.whatsapp_guard_settings_save(integer, integer, integer)
  to authenticated;

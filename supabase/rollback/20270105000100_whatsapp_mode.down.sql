-- Way back from "WhatsApp mode" (Full, Saver and Free, the cost page, and WhatsApp sent by people).
--
-- Puts message_channels, worker_claim, worker_whatsapp_signal, whatsapp_check_save and whatsapp_test_send back exactly as they were, so WhatsApp goes out
-- as it did before this package. Drops the functions the package added and the six tables it made (the chosen mode and its settings, the log of
-- changes, the class of each message, the rates, the message types filed as Marketing, and the log of what people sent by hand), and takes the function off
-- the Switchboard (with its rule; the log of who moved a switch is kept). WHAT THIS TAKES WITH IT: the rates the director entered, any class the director
-- changed, and the lines of the mode log and the hand-sent log. No message, no consent, no member and no pause is touched. Copy them first if you want them:
--   select * from public.whatsapp_mode_log; select * from public.whatsapp_rates; select * from public.whatsapp_hand_log;
-- Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;
-- The functions that were replaced, as they stood
CREATE OR REPLACE FUNCTION public.message_channels(p_msg uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.worker_claim(p_token text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.messages%rowtype;
  v_hour integer := public.lagos_hour();
  v_channels text[];
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_first text;
  v_prep jsonb;
  v_extra jsonb;
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
    v_extra := null;
    if m.template in ('reminder_email', 'office_message', 'referee_request', 'referee_reverify', 'referee_code') then
      v_prep := public.claim_prepare(m);
      if (v_prep ->> 'ok')::boolean is not true then
        if (v_prep ->> 'defer')::boolean is true then
          update public.messages set status = 'queued', claimed_at = null, scheduled_for = now() + interval '15 minutes' where id = m.id;
        else
          update public.messages set status = 'skipped', error = left(coalesce(v_prep ->> 'reason', 'left out'), 300), channel = null where id = m.id;
        end if;
        continue;
      end if;
      v_extra := v_prep -> 'params';
    end if;

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
      'params', m.params || coalesce(v_extra, '{}'::jsonb),
      'urgency', m.urgency,
      'attempts', m.attempts + 1,
      'reply_token', m.reply_token,
      'to', jsonb_build_object('email', v_email, 'phone', v_phone, 'name', v_name, 'first_name', nullif(v_first, ''))));
  end loop;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.worker_whatsapp_signal(p_token text, p_kind text, p_subject text, p_status text, p_detail text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_subject text := left(nullif(btrim(coalesce(p_subject, '')), ''), 200);
  v_status text := upper(left(nullif(btrim(coalesce(p_status, '')), ''), 80));
  v_detail text := left(nullif(btrim(coalesce(p_detail, '')), ''), 300);
  v_bad text[] := array['REJECTED', 'DISABLED', 'PAUSED', 'FLAGGED', 'DOWNGRADE', 'RESTRICTED', 'DECLINED', 'BANNED', 'ACCOUNT_RESTRICTION', 'DISABLED_UPDATE', 'ACCOUNT_VIOLATION', 'PENDING_DELETION', 'LIMITED', 'RED', 'CATEGORY_MARKETING', 'NAME_DECLINED', 'REVIEW_REJECTED'];
  v_what text;
begin
  perform public.worker_ok(p_token);
  if p_kind is null or p_kind not in ('template', 'quality', 'account') or v_subject is null or v_status is null then
    return false;
  end if;
  if public.feature_platform_state('whatsapp_health') <> 'on' then
    return false;
  end if;
  insert into public.whatsapp_signals (kind, subject, status, detail) values (p_kind, v_subject, v_status, v_detail);
  delete from public.whatsapp_signals where at < now() - interval '90 days';
  if v_status = any (v_bad) then
    v_what := case p_kind
      when 'template' then format('The message wording %s is now %s', v_subject, v_status)
      when 'quality' then format('The sending number %s: %s', v_subject, v_status)
      else format('The WhatsApp account: %s', v_status)
    end || coalesce(' (' || v_detail || ')', '');
    perform public.signin_alert_staff('whatsapp_signal', jsonb_build_object('what', left(v_what, 300)),
      'whatsapp_signal:' || p_kind || ':' || v_subject || ':' || v_status || ':' || public.today_lagos()::text,
      array['director', 'admin']::public.app_role[]);
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_check_save(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can run the checks' using errcode = '42501';
  end if;
  if public.feature_platform_state('whatsapp_health') <> 'on' then
    raise exception 'The WhatsApp health page is not switched On in God Mode' using errcode = '22023';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or pg_column_size(p_result) > 50000 then
    raise exception 'That answer cannot be kept' using errcode = '22023';
  end if;
  update public.whatsapp_checks set checked_at = now(), checked_by = me, result = p_result where id;
  perform public.write_event(me, 'whatsapp.checked', 'whatsapp', 'health', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.whatsapp_test_send()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  v_phone text;
  v_n integer;
  v_id uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can send a test message' using errcode = '42501';
  end if;
  if public.feature_platform_state('whatsapp_health') <> 'on' then
    raise exception 'The WhatsApp health page is not switched On in God Mode' using errcode = '22023';
  end if;
  select c.phone into v_phone from public.contact_preferences c where c.person_id = me;
  if v_phone is null then
    raise exception 'Save your own phone number on your profile first: the test goes to the number saved there' using errcode = '22023';
  end if;
  select count(*)::integer into v_n from public.messages m where m.person_id = me and m.template = 'whatsapp_test' and m.created_at > now() - interval '1 day';
  if v_n >= 5 then
    raise exception 'Five test messages a day is the most. Look at the last one first' using errcode = '22023';
  end if;
  v_id := public.enqueue_message(me, 'whatsapp_test', '{}'::jsonb, null,
    'whatsapp_test:' || me::text || ':' || (floor(extract(epoch from now()) / 30))::bigint::text, null, 'urgent', 'whatsapp');
  if v_id is null then
    raise exception 'A test message was only just sent. Wait half a minute and try again' using errcode = '22023';
  end if;
  perform public.write_event(me, 'whatsapp.test', 'whatsapp', 'health', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

drop function if exists public.hand_staff_list();
drop function if exists public.hand_mark(bigint, text);
drop function if exists public.hand_group(uuid, text);
drop function if exists public.hand_open(uuid, uuid, text);
drop function if exists public.hand_context(uuid);
drop function if exists public.hand_can(uuid);
drop function if exists public.whatsapp_rate_add(text, numeric, date, text);
drop function if exists public.whatsapp_class_set(text, text);
drop function if exists public.whatsapp_mode_settings(jsonb);
drop function if exists public.whatsapp_mode_set(text, text);
drop function if exists public.whatsapp_cost_report();
drop function if exists public.whatsapp_mode_overview();
drop function if exists public.whatsapp_by_name(uuid);
drop function if exists public.worker_whatsapp_marketing(text, text, boolean);
drop function if exists public.worker_whatsapp_allowed(text);
drop function if exists public.worker_whatsapp_tick(text);
drop function if exists public.whatsapp_resume_at(text);
drop function if exists public.whatsapp_pressure(uuid);
drop function if exists public.whatsapp_mode_facts(jsonb);
drop function if exists public.whatsapp_mode_quality(text, text);
drop function if exists public.whatsapp_mode_alert(text, text);
drop function if exists public.whatsapp_month_estimate();
drop function if exists public.whatsapp_month_start();
drop function if exists public.whatsapp_rate(text);
drop function if exists public.whatsapp_class(text);
drop function if exists public.whatsapp_mode_now();
drop index if exists public.messages_whatsapp_claim_idx;
drop table if exists public.whatsapp_hand_log;
drop table if exists public.whatsapp_marketing;
drop table if exists public.whatsapp_rates;
drop table if exists public.whatsapp_message_class;
drop table if exists public.whatsapp_mode_log;
drop table if exists public.whatsapp_mode;
-- The Switchboard: the function and its rule
delete from public.feature_settings where feature = 'whatsapp_mode';
delete from public.feature_registry where key = 'whatsapp_mode';
commit;

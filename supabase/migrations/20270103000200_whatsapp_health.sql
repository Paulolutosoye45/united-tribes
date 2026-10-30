-- =============================================================================
-- United Tribes: WhatsApp that cannot fail quietly, stage 2 (the health page)
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), "WhatsApp health", which starts Off. When it is On,
-- the Messages page links to a page that answers, in plain words, "is WhatsApp working, and if not, why?":
--
--   Checks         the page asks Meta directly (the access token, the sending number and its quality, the app's subscription, every template's
--                  approval and category) and keeps the last answer here, with who asked and when. The asking is done by the application;
--                  the database keeps the answer and decides who may read and save it.
--   What Meta says Meta also tells the site when a template is approved or rejected, when the number's quality changes and when the account is
--                  restricted. Those notices are kept (ninety days) and, when one is bad news, the director and the admin are emailed.
--   The last week  for the last seven days: how many WhatsApp messages were received, how many are waiting for a receipt, and how many were
--                  given up on, by cause, in words (an expired token, a test number, a number that is not on WhatsApp, and so on).
--   A test         a person in the office can send themselves a test message to the number saved on their own profile.
--
-- Off: nothing here runs. No notice is kept, no refusal is counted, the Messages page is exactly as it was and no function answers.
--
-- What it never does: it does not change the wording, the order or the consent rules of any message, a member's channel choice, a reminder or a
-- report. It never keeps a token or a secret, and a member's number never appears on the page. The golden recordings are unchanged.
--
-- Needs stage 1 (WhatsApp safety net) in place first: the page also says whether WhatsApp is paused.
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('whatsapp_health', 'WhatsApp health', 'A page under Messages that checks the church''s WhatsApp account with Meta, shows the last week''s results by cause in plain words, keeps Meta''s notices, and lets the office send themselves a test message. For the whole church only.', 7, '{}', array['off', 'on'], 'off', true, 23, true);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- What Meta told the site about a template, the number or the account. Kept ninety days.
create table public.whatsapp_signals (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('template', 'quality', 'account')),
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null check (char_length(status) between 1 and 80),
  detail text check (char_length(detail) <= 300)
);
create index whatsapp_signals_latest_idx on public.whatsapp_signals (kind, subject, id desc);
create index whatsapp_signals_at_idx on public.whatsapp_signals (at desc);
alter table public.whatsapp_signals enable row level security;
revoke all on table public.whatsapp_signals from public, anon, authenticated;

-- A WhatsApp message that was given up on, and why, in a word. Kept thirty days. Never a name or a number.
create table public.whatsapp_outcomes (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  message_id uuid,
  cause text not null check (char_length(cause) between 1 and 40)
);
create index whatsapp_outcomes_at_idx on public.whatsapp_outcomes (at desc);
alter table public.whatsapp_outcomes enable row level security;
revoke all on table public.whatsapp_outcomes from public, anon, authenticated;

-- The last answer the checks gave: one row.
create table public.whatsapp_checks (
  id boolean primary key default true check (id),
  checked_at timestamptz,
  checked_by uuid references public.people (id) on delete set null,
  result jsonb not null default '{}'::jsonb check (pg_column_size(result) < 60000)
);
insert into public.whatsapp_checks (id) values (true);
alter table public.whatsapp_checks enable row level security;
revoke all on table public.whatsapp_checks from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A stored error, as a cause in a word (internal). The page puts each word in plain language.
-- ---------------------------------------------------------------------------
create function public.whatsapp_cause(p_error text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_code integer;
begin
  if p_error is null then
    return 'unknown';
  end if;
  if p_error = 'whatsapp unreachable' then
    return 'unreachable';
  end if;
  if p_error = 'no phone number' then
    return 'no_number';
  end if;
  if p_error ~ '^http (401|403)' then
    return 'token';
  end if;
  if p_error !~ '^meta [0-9]{1,6}' then
    return 'other';
  end if;
  v_code := (substring(p_error from '^meta ([0-9]{1,6})'))::integer;
  return case
    when v_code in (10, 190, 200) then 'token'
    when v_code = 131030 then 'test_number'
    when v_code in (131031, 368) then 'locked'
    when v_code = 131042 then 'payment'
    when v_code = 131045 then 'not_registered'
    when v_code = 131037 then 'display_name'
    when v_code = 131026 then 'not_on_whatsapp'
    when v_code = 131049 then 'held_back'
    when v_code = 131056 then 'person_limit'
    when v_code in (4, 80007, 130429, 131016, 131048) then 'rate_limit'
    when v_code = 131021 then 'to_itself'
    when v_code = 132001 then 'template_missing'
    when v_code in (132000, 132005, 132007, 132012) then 'template_wrong'
    when v_code in (132015, 132016) then 'template_paused'
    else 'other'
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing down why a WhatsApp message was given up on
-- ---------------------------------------------------------------------------
-- Called when a message first gives up on WhatsApp (the sender or Meta's receipt moved it to the next channel). Off: nothing. Never allowed to
-- stop a message: a fault here is recorded for the office and the message carries on. Internal.
create function public.messages_outcome_watch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if public.feature_platform_state('whatsapp_health') = 'on' then
      insert into public.whatsapp_outcomes (message_id, cause) values (new.id, public.whatsapp_cause(new.error));
      delete from public.whatsapp_outcomes where at < now() - interval '30 days';
    end if;
  exception when others then
    perform public.notice_fault('whatsapp_health', sqlerrm);
  end;
  return null;
end;
$$;
create trigger messages_outcome_watch
  after update of tried on public.messages
  for each row
  when ('whatsapp' = any (new.tried) and not ('whatsapp' = any (old.tried)))
  execute function public.messages_outcome_watch();

-- ---------------------------------------------------------------------------
-- What Meta tells the site (the sending service calls this; the token is the credential)
-- ---------------------------------------------------------------------------
-- A template approved or rejected, the number's quality changed, the account restricted. Off: stored nowhere. Bad news emails the director and the
-- admin once a day per matter.
create function public.worker_whatsapp_signal(p_token text, p_kind text, p_subject text, p_status text, p_detail text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- The page
-- ---------------------------------------------------------------------------
-- What the health page reads. The admin, directors, the data lead and the pastor may read it. Off: only the word "off".
create function public.whatsapp_health_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_state text := public.feature_platform_state('whatsapp_health');
  v_hours integer;
  v_manager boolean := public.whatsapp_manager();
  v_chk public.whatsapp_checks;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'data_lead', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can read this' using errcode = '42501';
  end if;
  if v_state = 'off' then
    return jsonb_build_object('state', 'off');
  end if;
  select g.unconfirmed_hours into v_hours from public.whatsapp_guard g where g.id;
  v_hours := coalesce(v_hours, 24);
  select * into v_chk from public.whatsapp_checks c where c.id;
  return jsonb_build_object(
    'state', v_state,
    'canCheck', v_manager,
    'canTest', v_manager and exists (select 1 from public.contact_preferences c where c.person_id = me and c.phone is not null),
    'paused', public.whatsapp_paused(),
    'unconfirmedHours', v_hours,
    'check', case when v_chk.checked_at is null then null
                  else jsonb_build_object('at', v_chk.checked_at, 'result', v_chk.result,
                         'by', case when v_chk.checked_by is null then null
                                    when public.notice_is_owner(v_chk.checked_by) then 'an administrator'
                                    else coalesce(nullif(btrim((select p.full_name from public.people p where p.id = v_chk.checked_by)), ''), 'someone in the office') end) end,
    'week', (select jsonb_build_object(
                'reached', count(*) filter (where m.status in ('delivered', 'read')),
                'read', count(*) filter (where m.status = 'read'),
                'waiting', count(*) filter (where m.status = 'sent' and m.sent_at >= now() - make_interval(hours => v_hours)),
                'silent', count(*) filter (where m.status = 'sent' and m.sent_at < now() - make_interval(hours => v_hours)),
                'inQueue', count(*) filter (where m.status in ('queued', 'sending')))
               from public.messages m
              where m.channel = 'whatsapp' and m.created_at > now() - interval '7 days'),
    'movedOn', coalesce((select jsonb_agg(jsonb_build_object('cause', x.cause, 'n', x.n) order by x.n desc, x.cause)
                           from (select o.cause, count(*)::integer as n from public.whatsapp_outcomes o where o.at > now() - interval '7 days' group by o.cause) x), '[]'::jsonb),
    'countedSince', (select min(o.at) from public.whatsapp_outcomes o),
    'lastReceiptAt', (select max(m.delivered_at) from public.messages m where m.channel = 'whatsapp' and m.created_at > now() - interval '30 days'),
    'lastSentAt', (select max(m.sent_at) from public.messages m where m.channel = 'whatsapp' and m.created_at > now() - interval '30 days'),
    'signals', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'kind', s.kind, 'subject', s.subject, 'status', s.status, 'detail', s.detail) order by s.at desc)
                           from (select * from (select distinct on (x.kind, x.subject) x.* from public.whatsapp_signals x
                                                  where x.at > now() - interval '90 days' order by x.kind, x.subject, x.id desc) d
                                  order by d.at desc limit 30) s), '[]'::jsonb),
    'test', (select jsonb_build_object('id', t.id, 'status', t.status, 'at', t.created_at,
                    'cause', case when t.status in ('failed', 'skipped') or t.error is not null then public.whatsapp_cause(t.error) else null end)
               from public.messages t where t.person_id = me and t.template = 'whatsapp_test' order by t.created_at desc limit 1));
end;
$$;

-- Keeps the answer the checks gave, so everyone in the office sees the same. Only the admin, a director or the data lead; only while On.
create function public.whatsapp_check_save(p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- Sends the signed-in office person one test message, on WhatsApp only, to the number saved on their own profile. Five a day at most, one
-- every half minute. A pause does not hold it back: the point is to try the account.
create function public.whatsapp_test_send()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function
  public.whatsapp_cause(text),
  public.messages_outcome_watch()
  from public, anon, authenticated;

revoke execute on function
  public.whatsapp_health_overview(),
  public.whatsapp_check_save(jsonb),
  public.whatsapp_test_send()
  from public, anon;

grant execute on function
  public.whatsapp_health_overview(),
  public.whatsapp_check_save(jsonb),
  public.whatsapp_test_send()
  to authenticated;

-- The sending service has no account; the token is the credential.
grant execute on function public.worker_whatsapp_signal(text, text, text, text, text) to anon, authenticated;

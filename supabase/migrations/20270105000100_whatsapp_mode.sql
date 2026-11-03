-- =============================================================================
-- United Tribes: WhatsApp mode (Full, Saver and Free), the cost page, and WhatsApp sent by people
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), "WhatsApp mode", which starts Off and needs the
-- WhatsApp safety net to be On (it reuses the pause and the alarm email). It is for the whole church only. When it is On, a person in the office
-- chooses how the church uses WhatsApp:
--
--   Full    every message that can go by WhatsApp goes by WhatsApp first, as before. The number-health guards below still apply.
--   Saver   only the messages that must reach (class A) go by WhatsApp. The weekly rhythm (B) and everything else (C) go by email. A person who
--           has no other channel still gets the message by WhatsApp: nobody is left out.
--   Free    NOTHING goes through Meta. Every automatic message goes by email (or text). WhatsApp is used by people: a leader posts the week's
--           text to the tribe's group and sends personal messages from their own phone (wa.me), and the office does the same for leaders. The
--           website makes no call to Meta at all: not for messages, not for sign-in codes over the official route, not for the health checks.
--
-- Also here, each of them dormant while the switch is Off:
--   * a class (A, B or C) for every message type that can go by WhatsApp, which the director can change;
--   * a rate table and a monthly ceiling: the cost page shows an estimate, warns at 80 percent, and at 100 percent drops Full to Saver by itself;
--   * a Marketing guard (a template Meta has refiled as Marketing goes by email), a weekly cap per person, an hourly pace, a daily reach limit and
--     a 9 am to 7 pm window for the weekly rhythm, so the number is not reported;
--   * a quality guard: when Meta rates the number Medium the mode drops to Saver, and at Low WhatsApp pauses itself through the safety net;
--   * the log of what people sent by hand, and the functions a leader or the office calls for it.
--
-- Off: nothing here runs and the outbox behaves exactly as it did before. Rehearsal: the pages show what each mode would have done on the last seven
-- days of real messages; nothing is changed. On: the chosen mode takes effect on the next message, with no redeploy.
--
-- What it never does: it does not change a member's channel choice, the consent rules, the wording of any message, the pause, or how sign-in codes
-- choose their route (the website refuses the official route in Free mode, and says so). The golden recordings are unchanged.
--
-- Replaced, because they now know about the mode (the old text of each is in the rollback file): message_channels, worker_claim,
-- worker_whatsapp_signal, whatsapp_check_save, whatsapp_test_send.
-- Needs the WhatsApp safety net and WhatsApp health in place first.
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('whatsapp_mode', 'WhatsApp mode', 'Chooses how the church uses WhatsApp: Full (as today), Saver (only the messages that must reach go by WhatsApp) or Free (nothing goes through Meta; people send WhatsApp by hand). Also holds the monthly ceiling and the number-health guards. Needs the WhatsApp safety net On. For the whole church only.', 7, array['whatsapp_guard'], array['off', 'rehearsal', 'on'], 'off', true, 26, true);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- One row: the chosen mode and every setting.
create table public.whatsapp_mode (
  id boolean primary key default true check (id),
  mode text not null default 'full' check (mode in ('full', 'saver', 'free')),
  reason text check (char_length(reason) <= 300),
  changed_at timestamptz,
  changed_by uuid references public.people (id) on delete set null,
  -- true when the rule changed it (the ceiling or the quality guard), false when a person did
  auto boolean not null default false,
  -- the monthly ceiling in US dollars (an estimate, never Meta's own figure); null means none
  ceiling_usd numeric(8, 2) check (ceiling_usd is null or ceiling_usd > 0),
  warn_pct smallint not null default 80 check (warn_pct between 10 and 100),
  pace_per_hour integer not null default 300 check (pace_per_hour between 10 and 5000),
  reach_pct smallint not null default 80 check (reach_pct between 10 and 100),
  weekly_cap smallint not null default 2 check (weekly_cap between 1 and 14),
  window_from smallint not null default 9 check (window_from between 0 and 23),
  window_to smallint not null default 19 check (window_to between 1 and 24),
  quality_guard boolean not null default true,
  ceiling_warned_month date,
  ceiling_tripped_month date,
  check (window_from < window_to)
);
insert into public.whatsapp_mode (id, ceiling_usd) values (true, 100);
alter table public.whatsapp_mode enable row level security;
revoke all on table public.whatsapp_mode from public, anon, authenticated;

create table public.whatsapp_mode_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('mode', 'settings', 'class', 'rate', 'ceiling_warn', 'ceiling_drop', 'quality_drop', 'quality_pause')),
  by_person uuid references public.people (id) on delete set null,
  from_mode text,
  to_mode text,
  reason text check (char_length(reason) <= 300)
);
create index whatsapp_mode_log_at_idx on public.whatsapp_mode_log (at desc);
alter table public.whatsapp_mode_log enable row level security;
revoke all on table public.whatsapp_mode_log from public, anon, authenticated;

-- The class of every message type that can go by WhatsApp. The same starting list as src/lib/whatsapp/classes.ts.
create table public.whatsapp_message_class (
  template text primary key check (template ~ '^[a-z0-9_]{2,48}$'),
  class text not null check (class in ('A', 'B', 'C')),
  changed_at timestamptz not null default now(),
  changed_by uuid references public.people (id) on delete set null
);
alter table public.whatsapp_message_class enable row level security;
revoke all on table public.whatsapp_message_class from public, anon, authenticated;
insert into public.whatsapp_message_class (template, class) values
  ('swap_offered', 'A'),
  ('care_urgent', 'A'),
  ('care_task_overdue', 'A'),
  ('details_check_request', 'A'),
  ('details_check_reminder', 'A'),
  ('referee_code', 'A'),
  ('guardian_request', 'A'),
  ('whatsapp_test', 'A'),
  ('welcome', 'B'),
  ('season_starts_soon', 'B'),
  ('week_start', 'B'),
  ('triad_prompt', 'B'),
  ('meeting_reminder', 'B'),
  ('meeting_recap', 'B'),
  ('friday_checkin', 'B'),
  ('member_missed_two', 'B'),
  ('season_complete', 'B'),
  ('swap_declined', 'B'),
  ('new_member', 'B'),
  ('welcome_call_overdue', 'B'),
  ('leader_prep', 'B'),
  ('leader_meeting_reminder', 'B'),
  ('leader_log_link', 'B'),
  ('leader_log_reminder', 'B'),
  ('weekly_report', 'B'),
  ('leader_missed_one', 'B'),
  ('leader_missed_two', 'B'),
  ('birthday_tomorrow', 'B'),
  ('birthday_today', 'B'),
  ('testimony_waiting', 'B'),
  ('care_task', 'B'),
  ('care_task_reminder', 'B'),
  ('celebration_prompt', 'B'),
  ('swap_moved', 'B'),
  ('coach_digest', 'B'),
  ('coach_log_missing', 'B'),
  ('coach_missed_three', 'B'),
  ('coach_low_pulse', 'B'),
  ('coach_welcome_overdue', 'B'),
  ('coach_help', 'B'),
  ('swap_requested', 'B'),
  ('application_received', 'C'),
  ('application_interview_invited', 'C'),
  ('application_interview_booked', 'C'),
  ('application_approved', 'C'),
  ('application_approved_optional', 'C'),
  ('application_approved_declaration', 'C'),
  ('application_approved_open', 'C'),
  ('application_not_approved', 'C'),
  ('leader_check_consent', 'C'),
  ('leader_check_strengthen', 'C'),
  ('leader_check_clear', 'C'),
  ('leader_check_clear_open', 'C'),
  ('leader_check_clear_optional', 'C'),
  ('referee_request', 'C'),
  ('referee_reverify', 'C'),
  ('report_ready', 'C'),
  ('guardian_update', 'C');

-- What Meta charges per message, by category, as the director enters it from the rate card. The two starting figures are third-party estimates
-- for Nigeria and err high; every figure on the pages is labelled an estimate.
create table public.whatsapp_rates (
  id bigint generated always as identity primary key,
  category text not null check (category in ('utility', 'marketing')),
  usd numeric(8, 4) not null check (usd >= 0 and usd < 10),
  effective_on date not null,
  source text check (char_length(source) <= 200),
  added_by uuid references public.people (id) on delete set null,
  added_at timestamptz not null default now()
);
create index whatsapp_rates_idx on public.whatsapp_rates (category, effective_on desc);
insert into public.whatsapp_rates (category, usd, effective_on, source) values
  ('utility', 0.0101, date '2026-11-01', 'A third-party figure for Nigeria. Replace it with the figure on your own rate card'),
  ('marketing', 0.0516, date '2026-11-01', 'A third-party figure for Nigeria. Replace it with the figure on your own rate card');
alter table public.whatsapp_rates enable row level security;
revoke all on table public.whatsapp_rates from public, anon, authenticated;

-- The message types Meta has filed as Marketing (they cost about five times as much). Filled by the health check and by Meta's own notice.
create table public.whatsapp_marketing (
  template_key text primary key check (template_key ~ '^[a-z0-9_]{2,48}$'),
  since timestamptz not null default now()
);
alter table public.whatsapp_marketing enable row level security;
revoke all on table public.whatsapp_marketing from public, anon, authenticated;

-- What people sent by hand from their own phone: a post to a tribe's group, or a message to one person. Never what was said.
create table public.whatsapp_hand_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_person uuid not null references public.people (id) on delete cascade,
  tribe_id uuid references public.tribes (id) on delete set null,
  person_id uuid references public.people (id) on delete set null,
  scope text not null check (scope in ('group', 'person')),
  kind text not null check (kind ~ '^[a-z_]{2,32}$'),
  outcome text not null default 'opened' check (outcome in ('opened', 'sent', 'skipped'))
);
create index whatsapp_hand_log_by_idx on public.whatsapp_hand_log (by_person, at desc);
create index whatsapp_hand_log_tribe_idx on public.whatsapp_hand_log (tribe_id, at desc);
alter table public.whatsapp_hand_log enable row level security;
revoke all on table public.whatsapp_hand_log from public, anon, authenticated;

-- The pace and the daily reach look at the WhatsApp messages claimed lately.
create index messages_whatsapp_claim_idx on public.messages (claimed_at) where channel = 'whatsapp';

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------
-- The mode in force right now: 'full', 'saver' or 'free'. Anything but On is 'full', and so is any fault: the platform then behaves as it did.
create function public.whatsapp_mode_now()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.feature_platform_state('whatsapp_mode') <> 'on' then
    return 'full';
  end if;
  return coalesce((select g.mode from public.whatsapp_mode g where g.id), 'full');
exception when others then
  return 'full';
end;
$$;

-- The class of a message type. One the table does not know is A: it stays on WhatsApp, as it does today.
create function public.whatsapp_class(p_template text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.class from public.whatsapp_message_class c where c.template = p_template), 'A');
$$;

-- The rate in force today for a category, in US dollars.
create function public.whatsapp_rate(p_category text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.usd from public.whatsapp_rates r where r.category = p_category and r.effective_on <= public.today_lagos()
                    order by r.effective_on desc, r.id desc limit 1), 0);
$$;

-- The first moment of this month in Lagos.
create function public.whatsapp_month_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
$$;

-- What this month's WhatsApp messages cost, as an estimate: those sent so far this month, each at the rate of its category.
create function public.whatsapp_month_estimate()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'sent', count(*)::integer,
           'usd', round(coalesce(sum(case when mk.template_key is not null then public.whatsapp_rate('marketing') else public.whatsapp_rate('utility') end), 0), 2))
    from public.messages m
    left join public.whatsapp_marketing mk on mk.template_key = m.template
   where m.channel = 'whatsapp' and m.status in ('sent', 'delivered', 'read') and coalesce(m.sent_at, m.created_at) >= public.whatsapp_month_start();
$$;

-- The alarm for the people who run WhatsApp: an email to the directors and the admins, never a WhatsApp message.
create function public.whatsapp_mode_alert(p_what text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.signin_alert_staff('whatsapp_mode_alert', jsonb_build_object('what', left(p_what, 300)),
    'whatsapp_mode:' || p_dedupe || ':' || public.today_lagos()::text, array['director', 'admin']::public.app_role[]);
end;
$$;

-- Meta rates the number Medium ('medium'): Full drops to Saver. Low ('low'): WhatsApp pauses itself through the safety net. Only while the mode is On
-- and the quality guard is on. A person puts it back.
create function public.whatsapp_mode_quality(p_level text, p_why text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_mode;
begin
  if public.feature_platform_state('whatsapp_mode') <> 'on' then
    return;
  end if;
  select * into g from public.whatsapp_mode x where x.id for update;
  if not g.quality_guard then
    return;
  end if;
  if p_level = 'low' then
    if public.feature_platform_state('whatsapp_guard') = 'on' and not coalesce((select w.paused from public.whatsapp_guard w where w.id), true) then
      update public.whatsapp_guard
         set paused = true, auto = true, paused_at = now(), paused_by = null, reason = left('Automatic: ' || p_why, 300)
       where id;
      insert into public.whatsapp_guard_log (kind, reason, detail) values ('auto_paused', left(p_why, 300), jsonb_build_object('source', 'quality'));
      insert into public.whatsapp_mode_log (kind, reason) values ('quality_pause', left(p_why, 300));
      perform public.whatsapp_mode_alert('WhatsApp has paused itself: ' || p_why || '. Members are reached by email. A person restarts it from Messages once the number is healthy.', 'pause');
    end if;
  elsif p_level = 'medium' and g.mode = 'full' then
    update public.whatsapp_mode
       set mode = 'saver', auto = true, changed_at = now(), changed_by = null, reason = left('Automatic: ' || p_why, 300)
     where id;
    insert into public.whatsapp_mode_log (kind, from_mode, to_mode, reason) values ('quality_drop', 'full', 'saver', left(p_why, 300));
    perform public.whatsapp_mode_alert('WhatsApp mode dropped from Full to Saver: ' || p_why || '. Only the messages that must reach go by WhatsApp now.', 'quality');
  end if;
end;
$$;

-- The structured facts the health check keeps with its answer: which message types Meta has filed as Marketing, and how the number is rated.
create function public.whatsapp_mode_facts(p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := p_result -> 'facts';
  q text;
begin
  if f is null or jsonb_typeof(f) <> 'object' then
    return;
  end if;
  if jsonb_typeof(f -> 'marketing') = 'array' then
    delete from public.whatsapp_marketing where template_key not in (select jsonb_array_elements_text(f -> 'marketing'));
    insert into public.whatsapp_marketing (template_key)
    select x from jsonb_array_elements_text(f -> 'marketing') x where x ~ '^[a-z0-9_]{2,48}$'
    on conflict do nothing;
  end if;
  q := upper(coalesce(f ->> 'quality', ''));
  if q = 'YELLOW' then
    perform public.whatsapp_mode_quality('medium', 'Meta rates the sending number Medium (yellow)');
  elsif q = 'RED' then
    perform public.whatsapp_mode_quality('low', 'Meta rates the sending number Low (red)');
  end if;
end;
$$;

-- Is this message to be held back from WhatsApp for the number's sake? 'ok', 'window' (outside 9 am to 7 pm, the weekly rhythm only), 'pace' (the
-- hour is full) or 'reach' (today's limit of different people is reached). Only while the mode is On; the office test message and the
-- messages that must reach are never held for the window or the pace.
create function public.whatsapp_pressure(p_msg uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  g public.whatsapp_mode;
  v_hour integer := public.lagos_hour();
  v_n integer;
  v_limit integer;
  v_raw text;
  v_day timestamptz;
begin
  if public.feature_platform_state('whatsapp_mode') <> 'on' then
    return 'ok';
  end if;
  select * into m from public.messages x where x.id = p_msg;
  if not found or m.template = 'whatsapp_test' then
    return 'ok';
  end if;
  select * into g from public.whatsapp_mode x where x.id;
  if public.whatsapp_class(m.template) <> 'A' and m.urgency <> 'urgent' then
    if v_hour < g.window_from or v_hour >= g.window_to then
      return 'window';
    end if;
    select count(*)::integer into v_n from public.messages x
     where x.channel = 'whatsapp' and x.claimed_at > now() - interval '1 hour' and x.status in ('sending', 'sent', 'delivered', 'read') and x.id <> m.id;
    if v_n >= g.pace_per_hour then
      return 'pace';
    end if;
  end if;
  select c.result -> 'facts' ->> 'limit' into v_raw from public.whatsapp_checks c where c.id;
  v_limit := case when v_raw ~ '^[0-9]{1,9}$' then v_raw::integer else null end;
  if v_limit is not null and v_limit > 0 and m.person_id is not null then
    v_day := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
    if not exists (select 1 from public.messages x where x.person_id = m.person_id and x.channel = 'whatsapp' and x.claimed_at >= v_day
                      and x.status in ('sending', 'sent', 'delivered', 'read') and x.id <> m.id) then
      select count(distinct x.person_id)::integer into v_n from public.messages x
       where x.channel = 'whatsapp' and x.claimed_at >= v_day and x.status in ('sending', 'sent', 'delivered', 'read') and x.person_id is not null;
      if v_n >= (v_limit * g.reach_pct) / 100 then
        return 'reach';
      end if;
    end if;
  end if;
  return 'ok';
exception when others then
  return 'ok';
end;
$$;

-- When a held-back message tries again: the pace waits for the next hour, the window for 9 am, the reach for 9 am tomorrow.
create function public.whatsapp_resume_at(p_kind text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today timestamptz := (date_trunc('day', now() at time zone 'Africa/Lagos') + make_interval(hours => coalesce((select g.window_from from public.whatsapp_mode g where g.id), 9))) at time zone 'Africa/Lagos';
begin
  if p_kind = 'pace' then
    return date_trunc('hour', now()) + interval '1 hour 1 minute';
  end if;
  if p_kind = 'window' and v_today > now() then
    return v_today;
  end if;
  return v_today + interval '1 day';
end;
$$;

-- ---------------------------------------------------------------------------
-- The outbox learns about the mode
-- ---------------------------------------------------------------------------
-- The channels that may be used for a message right now, best first. The differences from before, all of them while WhatsApp mode is On:
--   Free     WhatsApp is left out for every message, the office test message included. Nothing goes through Meta.
--   Saver    WhatsApp is left out for a class B or C message, if the person has another channel they agreed to. A person with no other channel still
--            gets it by WhatsApp: nobody is left out.
--   Always   (Full too) a message whose wording Meta has filed as Marketing, and a message to someone who has already had the weekly cap of WhatsApp
--            messages this week (class A is never counted), go by the next channel when there is one.
-- A forced channel and the office test message are not touched (except by Free, which forbids WhatsApp altogether), and the pause works as before.
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
  v_mode text := public.whatsapp_mode_now();
  v_class text;
  v_other boolean;
  v_skip boolean := false;
  g public.whatsapp_mode;
  ch text;
begin
  select * into m from public.messages where id = p_msg;
  if not found then
    return '{}';
  end if;
  v_hold := (m.template <> 'whatsapp_test' and public.whatsapp_paused()) or v_mode = 'free';
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

  -- Is there another channel this person agreed to and that has not been tried?
  if not v_hold and m.template <> 'whatsapp_test' and public.feature_platform_state('whatsapp_mode') = 'on' then
    v_other := ('email' <> all (m.tried) and v_email is not null and (m.person_id is null or not public.email_opted_out(m.person_id)))
            or ('sms' <> all (m.tried) and v_phone is not null and (m.person_id is null or public.consent_granted(m.person_id, 'sms')));
    if v_other then
      select * into g from public.whatsapp_mode x where x.id;
      v_class := public.whatsapp_class(m.template);
      if v_mode = 'saver' and v_class in ('B', 'C') then
        v_skip := true;
      elsif exists (select 1 from public.whatsapp_marketing k where k.template_key = m.template) then
        v_skip := true;
      elsif v_class <> 'A' and m.person_id is not null
            and (select count(*) from public.messages x
                  where x.person_id = m.person_id and x.channel = 'whatsapp' and x.status in ('sent', 'delivered', 'read')
                    and coalesce(x.sent_at, x.created_at) > now() - interval '7 days' and x.id <> m.id) >= g.weekly_cap then
        v_skip := true;
      end if;
    end if;
  end if;

  if cp.preferred is not null then
    v_order := array[cp.preferred] || array_remove(v_order, cp.preferred);
  end if;
  foreach ch in array v_order loop
    continue when ch = any (m.tried);
    continue when ch = 'whatsapp' and (v_hold or v_skip);
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
-- The claim, the signal, the saved check and the test message learn about the mode (marked in the text)
-- ---------------------------------------------------------------------------
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
  v_free boolean := public.whatsapp_mode_now() = 'free';
  v_press text;
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
             error = coalesce(nullif(m.error, ''), case when v_free and m.person_id is not null and public.consent_granted(m.person_id, 'whatsapp') then 'WhatsApp is in Free mode: send this one by hand' else 'no channel the person has agreed to' end),
             channel = null
       where id = m.id;
      continue;
    end if;

    -- WhatsApp mode, when On: keep the number healthy. A message for WhatsApp waits if the hour is full or it is outside 9 am to 7 pm (the weekly
    -- rhythm only), and if today's limit of different people is reached it goes by the next channel, or waits until tomorrow when it has none.
    if v_channels[1] = 'whatsapp' then
      v_press := public.whatsapp_pressure(m.id);
      if v_press <> 'ok' then
        if v_press = 'reach' and cardinality(v_channels) > 1 then
          v_channels := v_channels[2:cardinality(v_channels)];
        else
          update public.messages set status = 'queued', claimed_at = null, scheduled_for = public.whatsapp_resume_at(v_press) where id = m.id;
          continue;
        end if;
      end if;
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
  -- WhatsApp mode's quality guard hears of a flagged or downgraded number whether or not the health page is On. A fault in it never stops the receipt.
  if p_kind = 'quality' and v_status in ('FLAGGED', 'DOWNGRADE') then
    begin
      perform public.whatsapp_mode_quality('medium', 'Meta reported the sending number as ' || lower(v_status));
    exception when others then
      perform public.notice_fault('whatsapp_mode', sqlerrm);
    end;
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
  -- WhatsApp mode keeps the structured facts (which message types are Marketing, how the number is rated, its limit). A fault in it never loses the answer.
  begin
    perform public.whatsapp_mode_facts(p_result);
  exception when others then
    perform public.notice_fault('whatsapp_mode', sqlerrm);
  end;
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
  if public.whatsapp_mode_now() = 'free' then
    raise exception 'WhatsApp is in Free mode, so nothing is sent to Meta, a test message included. Choose Saver or Full to try the account' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- The heartbeat: the monthly ceiling
-- ---------------------------------------------------------------------------
-- The sending service has no account; the token is the credential.
-- A warning email at the warning percentage, once a month. At the ceiling, Full drops to Saver by itself, once a month (a person who then
-- chooses Full again is not overruled until next month). In Saver and Free nothing is changed. Does nothing while the mode is not On.
create function public.worker_whatsapp_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_mode;
  v_est jsonb;
  v_usd numeric;
  v_pct numeric;
  v_month date := (public.whatsapp_month_start() at time zone 'Africa/Lagos')::date;
begin
  perform public.worker_ok(p_token);
  if public.feature_platform_state('whatsapp_mode') <> 'on' then
    return jsonb_build_object('state', 'off');
  end if;
  select * into g from public.whatsapp_mode x where x.id for update;
  if g.ceiling_usd is null then
    return jsonb_build_object('state', 'no_ceiling');
  end if;
  v_est := public.whatsapp_month_estimate();
  v_usd := (v_est ->> 'usd')::numeric;
  v_pct := v_usd * 100 / g.ceiling_usd;
  if v_pct >= 100 and g.mode = 'full' and g.ceiling_tripped_month is distinct from v_month then
    update public.whatsapp_mode
       set mode = 'saver', auto = true, changed_at = now(), changed_by = null, ceiling_tripped_month = v_month, ceiling_warned_month = v_month,
           reason = left(format('Automatic: the estimate reached the monthly ceiling (US$%s of US$%s)', v_usd, g.ceiling_usd), 300)
     where id;
    insert into public.whatsapp_mode_log (kind, from_mode, to_mode, reason)
    values ('ceiling_drop', 'full', 'saver', left(format('US$%s of US$%s', v_usd, g.ceiling_usd), 300));
    perform public.whatsapp_mode_alert(format('WhatsApp mode dropped from Full to Saver: this month''s estimate is US$%s, at the ceiling of US$%s. Only the messages that must reach go by WhatsApp now.', v_usd, g.ceiling_usd), 'ceiling');
    return jsonb_build_object('state', 'on', 'usd', v_usd, 'pct', round(v_pct), 'action', 'saver');
  end if;
  if v_pct >= g.warn_pct and g.ceiling_warned_month is distinct from v_month then
    update public.whatsapp_mode set ceiling_warned_month = v_month where id;
    insert into public.whatsapp_mode_log (kind, reason) values ('ceiling_warn', left(format('US$%s of US$%s', v_usd, g.ceiling_usd), 300));
    perform public.whatsapp_mode_alert(format('This month''s WhatsApp estimate is US$%s, %s%% of the ceiling of US$%s.', v_usd, round(v_pct), g.ceiling_usd), 'warn');
    return jsonb_build_object('state', 'on', 'usd', v_usd, 'pct', round(v_pct), 'action', 'warned');
  end if;
  return jsonb_build_object('state', 'on', 'usd', v_usd, 'pct', round(v_pct));
end;
$$;

-- What the website asks before it speaks to Meta: may it? (the token is the credential). Free mode answers no.
create function public.worker_whatsapp_allowed(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  perform public.worker_ok(p_token);
  v_mode := public.whatsapp_mode_now();
  return jsonb_build_object('mode', v_mode, 'meta', v_mode <> 'free');
end;
$$;

-- A template Meta has just filed as Marketing (or put back to Utility), told by Meta's notice. The website works out which message type the name belongs to.
create function public.worker_whatsapp_marketing(p_token text, p_key text, p_marketing boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  if p_key is null or p_key !~ '^[a-z0-9_]{2,48}$' then
    return false;
  end if;
  if coalesce(p_marketing, false) then
    insert into public.whatsapp_marketing (template_key) values (p_key) on conflict do nothing;
  else
    delete from public.whatsapp_marketing where template_key = p_key;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The pages for the office: the mode, the classes, the rates, the cost
-- ---------------------------------------------------------------------------
-- Who is shown as the author of a change: the person's name, or "an administrator" for the hidden owner.
create function public.whatsapp_by_name(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_person is null then null
              when public.notice_is_owner(p_person) then 'an administrator'
              else coalesce(nullif(btrim((select p.full_name from public.people p where p.id = p_person)), ''), 'someone in the office') end;
$$;

-- What the WhatsApp mode page reads. The admin, directors, the data lead and the pastor may read it.
create function public.whatsapp_mode_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.whatsapp_mode;
  v_week jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'data_lead', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can read this' using errcode = '42501';
  end if;
  select * into g from public.whatsapp_mode x where x.id;
  -- What the last seven days of WhatsApp messages were, by class: what each mode would have done to them
  select jsonb_build_object(
           'a', count(*) filter (where public.whatsapp_class(m.template) = 'A'),
           'b', count(*) filter (where public.whatsapp_class(m.template) = 'B'),
           'c', count(*) filter (where public.whatsapp_class(m.template) = 'C'),
           'total', count(*),
           'usd', round(coalesce(sum(case when mk.template_key is not null then public.whatsapp_rate('marketing') else public.whatsapp_rate('utility') end), 0), 2),
           'usdBC', round(coalesce(sum(case when public.whatsapp_class(m.template) <> 'A'
                                            then case when mk.template_key is not null then public.whatsapp_rate('marketing') else public.whatsapp_rate('utility') end end), 0), 2))
    into v_week
    from public.messages m
    left join public.whatsapp_marketing mk on mk.template_key = m.template
   where m.channel = 'whatsapp' and m.status in ('sent', 'delivered', 'read') and coalesce(m.sent_at, m.created_at) > now() - interval '7 days';
  return jsonb_build_object(
    'state', public.feature_platform_state('whatsapp_mode'),
    'guard', public.feature_platform_state('whatsapp_guard'),
    'paused', public.whatsapp_paused(),
    'chosen', g.mode,
    'effective', public.whatsapp_mode_now(),
    'changedAt', g.changed_at,
    'changedBy', public.whatsapp_by_name(g.changed_by),
    'auto', g.auto,
    'reason', g.reason,
    'canChange', public.whatsapp_manager(),
    'settings', jsonb_build_object('ceilingUsd', g.ceiling_usd, 'warnPct', g.warn_pct, 'pacePerHour', g.pace_per_hour, 'reachPct', g.reach_pct,
                                   'weeklyCap', g.weekly_cap, 'windowFrom', g.window_from, 'windowTo', g.window_to, 'qualityGuard', g.quality_guard),
    'month', public.whatsapp_month_estimate() || jsonb_build_object('from', public.whatsapp_month_start()),
    'week', v_week,
    'classes', coalesce((select jsonb_agg(jsonb_build_object('template', c.template, 'class', c.class) order by c.class, c.template) from public.whatsapp_message_class c), '[]'::jsonb),
    'marketing', coalesce((select jsonb_agg(k.template_key order by k.template_key) from public.whatsapp_marketing k), '[]'::jsonb),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('category', r.category, 'usd', r.usd, 'effectiveOn', r.effective_on, 'source', r.source) order by r.effective_on desc, r.id desc)
                         from (select * from public.whatsapp_rates order by effective_on desc, id desc limit 12) r), '[]'::jsonb),
    'hand', (select jsonb_build_object('opened', count(*), 'sent', count(*) filter (where h.outcome = 'sent'), 'skipped', count(*) filter (where h.outcome = 'skipped'))
               from public.whatsapp_hand_log h where h.at > now() - interval '7 days'),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'by', public.whatsapp_by_name(l.by_person), 'from', l.from_mode, 'to', l.to_mode, 'reason', l.reason) order by l.at desc)
                       from (select * from public.whatsapp_mode_log order by id desc limit 20) l), '[]'::jsonb));
end;
$$;

-- What the cost page reads: the last 7 and 30 days of WhatsApp messages by message type, an estimate of what they cost, the share filed as Marketing,
-- and what Saver or Free would have saved. All of it an estimate from the rates the director entered.
create function public.whatsapp_cost_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_u numeric := public.whatsapp_rate('utility');
  v_m numeric := public.whatsapp_rate('marketing');
  v_rows jsonb;
  v_sum jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'data_lead', 'pastor']::public.app_role[]) then
    raise exception 'Only the office can read this' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('template', x.template, 'class', x.class, 'marketing', x.mk, 'n7', x.n7, 'n30', x.n30,
                                               'usd30', round(x.n30 * (case when x.mk then v_m else v_u end), 2)) order by x.n30 desc, x.template), '[]'::jsonb)
    into v_rows
    from (select m.template, public.whatsapp_class(m.template) as class, bool_or(mk.template_key is not null) as mk,
                 count(*) filter (where coalesce(m.sent_at, m.created_at) > now() - interval '7 days')::integer as n7,
                 count(*)::integer as n30
            from public.messages m
            left join public.whatsapp_marketing mk on mk.template_key = m.template
           where m.channel = 'whatsapp' and m.status in ('sent', 'delivered', 'read') and coalesce(m.sent_at, m.created_at) > now() - interval '30 days'
           group by m.template) x;
  select jsonb_build_object(
           'n7', coalesce(sum((r ->> 'n7')::integer), 0), 'n30', coalesce(sum((r ->> 'n30')::integer), 0),
           'usd7', round(coalesce(sum((r ->> 'n7')::integer * (case when (r ->> 'marketing')::boolean then v_m else v_u end)), 0), 2),
           'usd30', round(coalesce(sum((r ->> 'usd30')::numeric), 0), 2),
           'marketing30', coalesce(sum((r ->> 'n30')::integer) filter (where (r ->> 'marketing')::boolean), 0),
           'saver30', round(coalesce(sum((r ->> 'usd30')::numeric) filter (where r ->> 'class' <> 'A'), 0), 2),
           'saverN30', coalesce(sum((r ->> 'n30')::integer) filter (where r ->> 'class' <> 'A'), 0))
    into v_sum
    from jsonb_array_elements(v_rows) r;
  return jsonb_build_object(
    'state', public.feature_platform_state('whatsapp_mode'),
    'effective', public.whatsapp_mode_now(),
    'rates', jsonb_build_object('utility', v_u, 'marketing', v_m),
    'sum', v_sum,
    'templates', v_rows,
    'month', public.whatsapp_month_estimate() || jsonb_build_object('from', public.whatsapp_month_start()),
    'ceilingUsd', (select g.ceiling_usd from public.whatsapp_mode g where g.id),
    'canChange', public.whatsapp_manager());
end;
$$;

-- Chooses the mode. A reason of a few words is kept with the change. Allowed while the switch is Off (the choice waits), but it only takes effect when
-- the switch is On.
create function public.whatsapp_mode_set(p_mode text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can change the WhatsApp mode' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('full', 'saver', 'free') then
    raise exception 'Choose Full, Saver or Free' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why in a few words (5 to 300 characters). It is kept with the change' using errcode = '22023';
  end if;
  select g.mode into v_old from public.whatsapp_mode g where g.id for update;
  update public.whatsapp_mode set mode = p_mode, auto = false, changed_at = now(), changed_by = me, reason = v_reason where id;
  insert into public.whatsapp_mode_log (kind, by_person, from_mode, to_mode, reason) values ('mode', me, v_old, p_mode, v_reason);
  perform public.write_event(me, 'whatsapp.mode', 'whatsapp', 'mode', jsonb_build_object('from', v_old, 'to', p_mode));
  return jsonb_build_object('ok', true, 'mode', p_mode, 'effective', public.whatsapp_mode_now());
end;
$$;

-- The numbers: ceiling (null for none), warning percentage, messages an hour, reach percentage, messages a week to one person, the sending window and the
-- quality guard. Only the keys given are changed.
create function public.whatsapp_mode_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.whatsapp_mode;
  k text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.whatsapp_manager() then
    raise exception 'Only the admin, a director or the data lead can change these' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Something went wrong. Reload the page and try again' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('ceilingUsd', 'warnPct', 'pacePerHour', 'reachPct', 'weeklyCap', 'windowFrom', 'windowTo', 'qualityGuard') then
      raise exception 'Unknown setting' using errcode = '22023';
    end if;
  end loop;
  select * into g from public.whatsapp_mode x where x.id for update;
  begin
    if p_settings ? 'ceilingUsd' then
      g.ceiling_usd := case when jsonb_typeof(p_settings -> 'ceilingUsd') = 'null' then null else (p_settings ->> 'ceilingUsd')::numeric end;
    end if;
    if p_settings ? 'warnPct' then g.warn_pct := (p_settings ->> 'warnPct')::smallint; end if;
    if p_settings ? 'pacePerHour' then g.pace_per_hour := (p_settings ->> 'pacePerHour')::integer; end if;
    if p_settings ? 'reachPct' then g.reach_pct := (p_settings ->> 'reachPct')::smallint; end if;
    if p_settings ? 'weeklyCap' then g.weekly_cap := (p_settings ->> 'weeklyCap')::smallint; end if;
    if p_settings ? 'windowFrom' then g.window_from := (p_settings ->> 'windowFrom')::smallint; end if;
    if p_settings ? 'windowTo' then g.window_to := (p_settings ->> 'windowTo')::smallint; end if;
    if p_settings ? 'qualityGuard' then g.quality_guard := (p_settings ->> 'qualityGuard')::boolean; end if;
    update public.whatsapp_mode
       set ceiling_usd = g.ceiling_usd, warn_pct = g.warn_pct, pace_per_hour = g.pace_per_hour, reach_pct = g.reach_pct, weekly_cap = g.weekly_cap,
           window_from = g.window_from, window_to = g.window_to, quality_guard = g.quality_guard
     where id;
  exception when others then
    raise exception 'That value is outside what is allowed' using errcode = '22023';
  end;
  insert into public.whatsapp_mode_log (kind, by_person, reason) values ('settings', me, left(p_settings::text, 300));
  return jsonb_build_object('ok', true);
end;
$$;

-- Changes the class of one message type.
create function public.whatsapp_class_set(p_template text, p_class text)
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
    raise exception 'Only the admin, a director or the data lead can change a class' using errcode = '42501';
  end if;
  if p_class is null or p_class not in ('A', 'B', 'C') or p_template is null or not exists (select 1 from public.whatsapp_message_class c where c.template = p_template) then
    raise exception 'Choose a message and a class' using errcode = '22023';
  end if;
  update public.whatsapp_message_class set class = p_class, changed_at = now(), changed_by = me where template = p_template;
  insert into public.whatsapp_mode_log (kind, by_person, reason) values ('class', me, left(p_template || ' is now ' || p_class, 300));
  return jsonb_build_object('ok', true);
end;
$$;

-- Adds a rate from the rate card. The newest rate in force is the one used.
create function public.whatsapp_rate_add(p_category text, p_usd numeric, p_effective date, p_source text)
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
    raise exception 'Only the admin, a director or the data lead can enter a rate' using errcode = '42501';
  end if;
  if p_category is null or p_category not in ('utility', 'marketing') or p_usd is null or p_usd < 0 or p_usd >= 10 or p_effective is null then
    raise exception 'Choose a category, a rate in US dollars and the date it starts' using errcode = '22023';
  end if;
  insert into public.whatsapp_rates (category, usd, effective_on, source, added_by) values (p_category, p_usd, p_effective, left(nullif(btrim(coalesce(p_source, '')), ''), 200), me);
  insert into public.whatsapp_mode_log (kind, by_person, reason) values ('rate', me, left(format('%s: US$%s from %s', p_category, p_usd, p_effective), 300));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp sent by people: a post to a tribe's group, and a message to one person
-- ---------------------------------------------------------------------------
-- A leader, an assistant or the coach of the tribe, and the office roles that already see members' contact details, may use the tools for it.
create function public.hand_can(p_tribe uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tribe is not null and auth.uid() is not null
     and (public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[])
          or exists (select 1 from public.tribes t where t.id = p_tribe and auth.uid() in (t.leader_id, t.assistant_id, t.coach_id)));
$$;

-- What the leader's page reads: the tribe's group link, each member with whether they can be messaged on WhatsApp (said yes to WhatsApp, and their
-- details are open to the leader by the same rule as the leader's list), the members only WhatsApp can reach, the messages the site could not send
-- because the church is in Free mode, and what has been done by hand lately. Never a number.
create function public.hand_context(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t record;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.hand_can(p_tribe) then
    raise exception 'You do not lead this tribe' using errcode = '42501';
  end if;
  select x.id, x.name, x.whatsapp_group_url into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'We could not open that tribe' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'state', public.feature_platform_state('whatsapp_mode'),
    'mode', public.whatsapp_mode_now(),
    'free', public.whatsapp_mode_now() = 'free',
    'tribe', jsonb_build_object('id', t.id, 'name', t.name, 'groupUrl', t.whatsapp_group_url),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person', tm.person_id,
               'name', public.person_display_name(tm.person_id),
               'first', public.first_name_of(tm.person_id),
               'wa', public.chat_phone(tm.person_id) is not null,
               'open', coalesce(public.placement_contact(tm.id) ->> 'state', 'open') = 'open',
               'onlyWa', public.consent_granted(tm.person_id, 'whatsapp')
                         and not (exists (select 1 from public.people p where p.id = tm.person_id and p.email is not null) and not public.email_opted_out(tm.person_id))
                         and not public.consent_granted(tm.person_id, 'sms'))
             order by public.person_display_name(tm.person_id))
        from public.tribe_members tm
       where tm.tribe_id = p_tribe and tm.status = 'active' and tm.person_id <> uid), '[]'::jsonb),
    'unsent', coalesce((
      select jsonb_agg(distinct public.first_name_of(m.person_id))
        from public.messages m
        join public.tribe_members tm on tm.person_id = m.person_id and tm.tribe_id = p_tribe and tm.status = 'active'
       where m.error like 'WhatsApp is in Free mode%' and m.created_at > now() - interval '7 days'), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'at', h.at, 'scope', h.scope, 'kind', h.kind, 'outcome', h.outcome,
                                          'by', public.whatsapp_by_name(h.by_person), 'person', public.first_name_of(h.person_id)) order by h.id desc)
        from (select * from public.whatsapp_hand_log where tribe_id = p_tribe order by id desc limit 15) h), '[]'::jsonb));
end;
$$;

-- Opens one person's chat: logs it, and gives the page the number to put in the wa.me link. The leader sees the number only inside the link.
-- For a tribe member the rule is the leader's own: they said yes to WhatsApp, and their details are open to the leader. With no tribe, the office
-- messages a leader, an assistant or a coach.
create function public.hand_open(p_person uuid, p_tribe uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_office boolean;
  v_tm uuid;
  v_phone text;
  v_log bigint;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind is null or p_kind !~ '^[a-z_]{2,32}$' or p_person is null then
    raise exception 'Something went wrong. Reload the page and try again' using errcode = '22023';
  end if;
  v_office := public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]);
  if p_tribe is not null then
    if not public.hand_can(p_tribe) then
      raise exception 'You do not lead this tribe' using errcode = '42501';
    end if;
    select tm.id into v_tm from public.tribe_members tm where tm.tribe_id = p_tribe and tm.person_id = p_person and tm.status = 'active';
    if v_tm is null then
      raise exception 'That person is not in this tribe' using errcode = '42501';
    end if;
    if not v_office and coalesce(public.placement_contact(v_tm) ->> 'state', 'open') <> 'open' then
      raise exception 'This member has not shared their details with you yet' using errcode = '42501';
    end if;
  else
    if not v_office then
      raise exception 'Only the office can message a leader from here' using errcode = '42501';
    end if;
    if not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader', 'coach')) then
      raise exception 'Only leaders and coaches can be messaged from here' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.whatsapp_hand_log h where h.by_person = uid and h.scope = 'person' and h.at > now() - interval '1 day') >= 300 then
    raise exception 'That is 300 chats opened today. Try again tomorrow' using errcode = '22023';
  end if;
  v_phone := public.chat_phone(p_person);
  if v_phone is null then
    raise exception 'This person has not said yes to WhatsApp, or has no number saved' using errcode = '42501';
  end if;
  insert into public.whatsapp_hand_log (by_person, tribe_id, person_id, scope, kind) values (uid, p_tribe, p_person, 'person', p_kind) returning id into v_log;
  return jsonb_build_object('log', v_log, 'phone', v_phone, 'first', public.first_name_of(p_person));
end;
$$;

-- Logs that the leader opened the tribe's group to post this week's text, and gives the page the group's address.
create function public.hand_group(p_tribe uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_url text;
  v_log bigint;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.hand_can(p_tribe) then
    raise exception 'You do not lead this tribe' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('week_start', 'meeting_reminder', 'meeting_recap', 'custom') then
    raise exception 'Something went wrong. Reload the page and try again' using errcode = '22023';
  end if;
  select t.whatsapp_group_url into v_url from public.tribes t where t.id = p_tribe;
  insert into public.whatsapp_hand_log (by_person, tribe_id, scope, kind) values (uid, p_tribe, 'group', p_kind) returning id into v_log;
  return jsonb_build_object('log', v_log, 'groupUrl', v_url);
end;
$$;

-- The person says whether they sent it or left it. Only their own line.
create function public.hand_mark(p_log bigint, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'skipped') then
    raise exception 'Something went wrong. Reload the page and try again' using errcode = '22023';
  end if;
  update public.whatsapp_hand_log set outcome = p_outcome where id = p_log and by_person = auth.uid();
  return found;
end;
$$;

-- The leaders and coaches the office may message by hand: those who said yes to WhatsApp. Names and their tribe, never numbers.
create function public.hand_staff_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'care_lead']::public.app_role[]) then
    raise exception 'Only the office can use this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'state', public.feature_platform_state('whatsapp_mode'),
    'free', public.whatsapp_mode_now() = 'free',
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person', x.person_id, 'name', x.name, 'first', x.first, 'role', x.role, 'tribe', x.tribe) order by x.name)
        from (select r.person_id, public.person_display_name(r.person_id) as name, public.first_name_of(r.person_id) as first,
                     min(r.role::text) as role,
                     (select t.name from public.tribes t where t.leader_id = r.person_id limit 1) as tribe
                from public.person_roles r
               where r.role in ('leader', 'assistant_leader', 'coach') and public.chat_phone(r.person_id) is not null
               group by r.person_id
               limit 300) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'at', h.at, 'kind', h.kind, 'outcome', h.outcome, 'by', public.whatsapp_by_name(h.by_person),
                                          'person', public.first_name_of(h.person_id)) order by h.id desc)
        from (select * from public.whatsapp_hand_log where scope = 'person' and tribe_id is null order by id desc limit 15) h), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.whatsapp_mode_now(),
  public.whatsapp_class(text),
  public.whatsapp_rate(text),
  public.whatsapp_month_start(),
  public.whatsapp_month_estimate(),
  public.whatsapp_mode_alert(text, text),
  public.whatsapp_mode_quality(text, text),
  public.whatsapp_mode_facts(jsonb),
  public.whatsapp_pressure(uuid),
  public.whatsapp_resume_at(text),
  public.whatsapp_by_name(uuid),
  public.hand_can(uuid)
  from public, anon, authenticated;

revoke execute on function
  public.whatsapp_mode_overview(),
  public.whatsapp_cost_report(),
  public.whatsapp_mode_set(text, text),
  public.whatsapp_mode_settings(jsonb),
  public.whatsapp_class_set(text, text),
  public.whatsapp_rate_add(text, numeric, date, text),
  public.hand_context(uuid),
  public.hand_open(uuid, uuid, text),
  public.hand_group(uuid, text),
  public.hand_mark(bigint, text),
  public.hand_staff_list()
  from public, anon;

grant execute on function
  public.whatsapp_mode_overview(),
  public.whatsapp_cost_report(),
  public.whatsapp_mode_set(text, text),
  public.whatsapp_mode_settings(jsonb),
  public.whatsapp_class_set(text, text),
  public.whatsapp_rate_add(text, numeric, date, text),
  public.hand_context(uuid),
  public.hand_open(uuid, uuid, text),
  public.hand_group(uuid, text),
  public.hand_mark(bigint, text),
  public.hand_staff_list()
  to authenticated;

-- The sending service has no account; the token is the credential.
grant execute on function
  public.worker_whatsapp_tick(text),
  public.worker_whatsapp_allowed(text),
  public.worker_whatsapp_marketing(text, text, boolean)
  to anon, authenticated;

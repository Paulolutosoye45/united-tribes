-- =============================================================================
-- United Tribes: Leader cards (see, for every appointed leader, whether the email arrived, whether they have started, and chase them kindly)
--
-- What this adds, and nothing else:
--
--   The board       one page for the office (admin, a director, a pastor; the data lead may look). One row for each leader who has a Tribe Card this
--                   season: the department they serve in, how they came (appointed or applied), whether their invitation email went out, was only
--                   queued, failed (with the reason) or never went, whether they have signed in, where their card is (not started, in progress, sent
--                   to the pastorate, changes asked for, approved) and when they last did anything. Filters for "not finished", "not started", "email
--                   did not arrive" and "never signed in". Nothing here changes a card.
--   The sends       "Send the email again" for one leader, or for everyone whose email did not arrive and who has not started. Each leader is sent
--                   at most three times, never twice in a day, and never once they have sent their card in. Quiet hours and the usual blocks (a
--                   bounced address, an open deletion) hold exactly as they do for every other message.
--   Reminders       a kind email on Thursday, Friday and Saturday at nine to each leader whose card is still open, and nobody else. It starts Off. In
--                   Rehearsal it writes down who it WOULD have written to and sends nothing. On sends it. Each leader gets one a day, twelve in all,
--                   and none once their card is sent in. The Master pause stops it like every other new function.
--   Departments     the office tags each leader with the department they serve in (free text), so each head of department can be given their own
--                   list. Nobody is added to anything by this; a department is only a label.
--   The sheets      "For the heads of department" (names, tribe, department, where the card is: no number and no address) and "Call sheet"
--                   (adds the number and the address; admin, a director and a pastor only, and every download is written to the log).
--   The count       the leaders whose invitation did not arrive, with the reason, for Admin -> Sending and email.
--   The audience    Announcements gains "Leaders whose Tribe Card is not finished".
--
-- Off: nothing is sent by this package until the office presses Send again or moves Reminders off Off. Every other page and every message behave
-- exactly as they did.
--
-- What it never does: it does not read or change what a leader wrote on a card, approve or return a card, send anything on WhatsApp (the new email is
-- email only and is never put to Meta), or give a number or an address to a role that may not see one.
--
-- Replaced, because they now know about the new audience (the old text of each is in the rollback file): audience_clean, audience_base.
-- Needs the appointments package, the contact-gaps package (for the audience functions) and the Switchboard's Master pause in place first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- The department a leader serves in. One row each; no row means none set.
create table public.leader_departments (
  person_id uuid primary key references public.people (id) on delete cascade,
  department text not null check (char_length(department) between 2 and 60),
  set_by uuid references public.people (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.leader_departments enable row level security;
revoke all on table public.leader_departments from public, anon, authenticated;

-- The reminder settings. One row.
create table public.leader_card_settings (
  id boolean primary key default true check (id),
  reminder_mode text not null default 'off' check (reminder_mode in ('off', 'rehearsal', 'on')),
  -- 0 is Sunday, as in Postgres. Thursday, Friday and Saturday.
  days smallint[] not null default array[4, 5, 6]::smallint[],
  start_hour smallint not null default 9 check (start_hour between 6 and 17),
  max_total smallint not null default 12 check (max_total between 1 and 30),
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.leader_card_settings (id) values (true);
alter table public.leader_card_settings enable row level security;
revoke all on table public.leader_card_settings from public, anon, authenticated;

-- What was sent, or would have been, to whom, and when. Counts and the "never twice a day" rule are read from here.
create table public.leader_card_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('reminder', 'would_send', 'resend')),
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid references public.tribes (id) on delete set null,
  by_person uuid references public.people (id) on delete set null,
  day date not null default public.today_lagos(),
  at timestamptz not null default now()
);
create index leader_card_log_tribe_idx on public.leader_card_log (tribe_id, kind, day);
create index leader_card_log_person_idx on public.leader_card_log (person_id, kind, at desc);
alter table public.leader_card_log enable row level security;
revoke all on table public.leader_card_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may look, and who may act
-- ---------------------------------------------------------------------------
-- act: the admin, a director and a pastor. look: the data lead (the board and the sheet for heads of department, nothing else).
create function public.leader_cards_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then 'act'
              when public.has_any_role(array['data_lead']::public.app_role[]) then 'look' end;
$$;

-- Where a card is. null for a card that has been closed.
--   not_started   still a draft and the leader has filled in none of the four things only they can say (story, meeting time, how they meet, zone)
--   in_progress   a draft with something filled in
--   changes_asked the pastorate sent it back
--   submitted     sent in, waiting for the pastorate
--   approved      approved
create function public.leader_card_state(p_status text, p_filled boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
           when 'approved' then 'approved'
           when 'submitted' then 'submitted'
           when 'changes_requested' then 'changes_asked'
           when 'draft' then case when p_filled then 'in_progress' else 'not_started' end
         end;
$$;

-- One row for each leader with a current card: their newest tribe in a season that is not closed.
create function public.leader_card_rows(p_centre uuid)
returns table (person_id uuid, tribe_id uuid, tribe text, state text, how text, department text, appointed_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.leader_id, s.id, s.name,
         public.leader_card_state(s.status::text, (s.story is not null or s.slot is not null or s.meeting_mode is not null or s.zone is not null)),
         case when a.id is not null then 'appointed' else 'applied' end,
         d.department, a.appointed_at, s.created_at
    from (select distinct on (t.leader_id) t.*
            from public.tribes t
            join public.seasons se on se.id = t.season_id
            join public.people p on p.id = t.leader_id
           where t.leader_id is not null and t.status <> 'closed' and se.status <> 'closed' and p.centre_id = p_centre and not p.hidden
           order by t.leader_id, t.created_at desc, t.id) s
    left join lateral (select x.id, x.appointed_at from public.leader_appointments x
                        where x.person_id = s.leader_id and x.status = 'active' order by x.appointed_at desc limit 1) a on true
    left join public.leader_departments d on d.person_id = s.leader_id;
$$;

-- Did the email with the card's link reach this leader? The best result of every message that carries the link, whichever way it was first sent.
--   sent       at least one went out (sent, delivered or read)
--   sending    one is waiting to go
--   failed     every one that was tried failed or was held back; the reason is the newest
--   not_sent   none was ever queued
create function public.leader_card_invite_of(p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
             'state', case when bool_or(m.status in ('sent', 'delivered', 'read')) then 'sent'
                           when bool_or(m.status in ('queued', 'sending')) then 'sending'
                           else 'failed' end,
             'reason', (array_agg(nullif(btrim(m.error), '') order by m.created_at desc) filter (where m.status in ('failed', 'skipped')))[1],
             'at', max(coalesce(m.sent_at, m.created_at)),
             'tries', count(*))
      from public.messages m
     where m.person_id = p_person
       and (m.template in ('placement_leader_appointed', 'role_invitation', 'leader_welcome', 'leader_card_reminder') or m.template like 'application_approved%')
       and not (m.params ? 'test')
    having count(*) > 0),
    jsonb_build_object('state', 'not_sent', 'reason', null, 'at', null, 'tries', 0));
$$;

-- When they last did anything: their newest action in the app, or the time their card was last saved once they had put something on it.
create function public.leader_last_activity(p_person uuid, p_tribe uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           (select max(e.at) from public.event_log e where e.actor_id = p_person),
           (select t.updated_at from public.tribes t
             where t.id = p_tribe and (t.story is not null or t.slot is not null or t.meeting_mode is not null or t.zone is not null)));
$$;

-- ---------------------------------------------------------------------------
-- The board
-- ---------------------------------------------------------------------------
-- filter: unfinished (default), not_started, in_progress, changes_asked, submitted, approved, all, email_failed (the email did not arrive or never went),
-- never_signed_in.  department: a name, or 'none' for leaders with no department.
-- Returns the counts for the whole church (the filters do not change them), the page of rows, and the departments in use.
create function public.leader_cards_board(p_filter text default 'unfinished', p_department text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.leader_cards_role();
  v_centre uuid := public.my_centre();
  v_filter text := coalesce(nullif(p_filter, ''), 'unfinished');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_counts jsonb;
  v_total integer;
  v_rows jsonb;
  v_depts jsonb;
  v_set public.leader_card_settings;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_filter not in ('unfinished', 'not_started', 'in_progress', 'changes_asked', 'submitted', 'approved', 'all', 'email_failed', 'never_signed_in') then
    raise exception 'Choose a filter from the list' using errcode = '22023';
  end if;
  select * into v_set from public.leader_card_settings s where s.id;

  with b as materialized (
    select r.person_id, r.tribe_id, r.tribe, r.state, r.how, r.department, r.appointed_at,
           public.person_display_name(r.person_id) as name,
           public.leader_card_invite_of(r.person_id) as invite,
           (select u.last_sign_in_at from auth.users u where u.id = r.person_id) as signed_in_at,
           public.leader_last_activity(r.person_id, r.tribe_id) as last_activity,
           (select count(*)::integer from public.leader_card_log l where l.person_id = r.person_id and l.kind = 'reminder') as reminders,
           (select count(*)::integer from public.leader_card_log l where l.person_id = r.person_id and l.kind = 'resend') as resends,
           public.message_blocker(r.person_id) as blocker,
           case r.state when 'not_started' then 1 when 'changes_asked' then 2 when 'in_progress' then 3 when 'submitted' then 4 else 5 end as rank
      from public.leader_card_rows(v_centre) r),
  f as (
    select b.* from b
     where case v_filter
             when 'unfinished' then b.state in ('not_started', 'in_progress', 'changes_asked')
             when 'all' then true
             when 'email_failed' then b.invite ->> 'state' in ('failed', 'not_sent')
             when 'never_signed_in' then b.signed_in_at is null
             else b.state = v_filter end
       and (p_department is null or p_department = ''
            or (p_department = 'none' and b.department is null)
            or b.department = p_department))
  select (select jsonb_build_object(
                   'all', count(*),
                   'unfinished', count(*) filter (where b.state in ('not_started', 'in_progress', 'changes_asked')),
                   'not_started', count(*) filter (where b.state = 'not_started'),
                   'in_progress', count(*) filter (where b.state = 'in_progress'),
                   'changes_asked', count(*) filter (where b.state = 'changes_asked'),
                   'submitted', count(*) filter (where b.state = 'submitted'),
                   'approved', count(*) filter (where b.state = 'approved'),
                   'email_failed', count(*) filter (where b.invite ->> 'state' in ('failed', 'not_sent')),
                   'never_signed_in', count(*) filter (where b.signed_in_at is null)) from b),
         (select coalesce(jsonb_agg(d.department order by d.department), '[]'::jsonb) from (select distinct b.department from b where b.department is not null) d),
         (select count(*)::integer from f),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'person_id', y.person_id, 'name', y.name, 'tribe_id', y.tribe_id, 'tribe', y.tribe, 'state', y.state, 'how', y.how,
                   'department', y.department, 'appointed_at', y.appointed_at, 'invite', y.invite,
                   'blocker', y.blocker, 'signed_in', y.signed_in_at is not null, 'signed_in_at', y.signed_in_at,
                   'last_activity', y.last_activity, 'reminders', y.reminders, 'resends', y.resends,
                   'email', case when v_role = 'act' and y.invite ->> 'state' in ('failed', 'not_sent') then (select p.email from public.people p where p.id = y.person_id) end,
                   'can_chat', case when v_role = 'act' then public.chat_phone(y.person_id) is not null end)
                   order by y.rank, y.name), '[]'::jsonb)
            from (select f.* from f order by f.rank, f.name limit v_limit offset v_offset) y)
    into v_counts, v_depts, v_total, v_rows;

  return jsonb_build_object('role', v_role, 'filter', v_filter, 'counts', v_counts, 'total', v_total, 'rows', v_rows, 'departments', v_depts,
                            'limit', v_limit, 'offset', v_offset, 'reminders', jsonb_build_object('mode', v_set.reminder_mode));
end;
$$;

-- ---------------------------------------------------------------------------
-- Department
-- ---------------------------------------------------------------------------
create function public.leader_card_department_set(p_person uuid, p_department text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept text := nullif(btrim(coalesce(p_department, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can set a department' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leader_card_rows(public.my_centre()) r where r.person_id = p_person) then
    raise exception 'That person does not have a Tribe Card this season' using errcode = 'P0002';
  end if;
  if v_dept is not null and char_length(v_dept) not between 2 and 60 then
    raise exception 'A department is 2 to 60 characters' using errcode = '22023';
  end if;
  if v_dept is null then
    delete from public.leader_departments where person_id = p_person;
  else
    insert into public.leader_departments (person_id, department, set_by) values (p_person, v_dept, auth.uid())
    on conflict (person_id) do update set department = excluded.department, set_by = excluded.set_by, set_at = now();
  end if;
  perform public.write_event(auth.uid(), 'leader_cards.department_set', 'leader_cards', p_person::text, jsonb_build_object('department', v_dept));
  return jsonb_build_object('ok', true, 'department', v_dept);
end;
$$;

-- ---------------------------------------------------------------------------
-- Send the email again
-- ---------------------------------------------------------------------------
-- p_person set: that one leader. p_person null: everyone whose email did not arrive (failed or never went) and who has not started their card.
-- Never to a leader who has sent their card in, never more than three times to one leader, never twice in a day (the same key as the reminders).
-- Quiet hours and the usual blocks apply when the message goes out. Returns how many were queued and who was left out, and why.
create function public.leader_cards_resend(p_person uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r record;
  v_msg uuid;
  v_queued integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_why text;
  v_today date := public.today_lagos();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can send this again' using errcode = '42501';
  end if;
  if p_person is not null and not exists (select 1 from public.leader_card_rows(public.my_centre()) x where x.person_id = p_person) then
    raise exception 'That person does not have a Tribe Card this season' using errcode = 'P0002';
  end if;

  for r in
    select x.person_id, x.tribe_id, x.tribe, x.state, x.how, public.leader_card_invite_of(x.person_id) ->> 'state' as invite
      from public.leader_card_rows(public.my_centre()) x
     where (p_person is null or x.person_id = p_person)
     order by x.tribe, x.person_id
  loop
    v_why := null;
    if p_person is null and (r.invite not in ('failed', 'not_sent') or r.state <> 'not_started') then
      continue;
    end if;
    if r.state in ('submitted', 'approved') then
      v_why := 'card_sent';
    elsif (select count(*) from public.leader_card_log l where l.person_id = r.person_id and l.kind = 'resend') >= 3 then
      v_why := 'sent_three_times';
    elsif exists (select 1 from public.leader_card_log l where l.tribe_id = r.tribe_id and l.day = v_today and l.kind in ('resend', 'reminder')) then
      v_why := 'already_today';
    else
      v_why := public.message_blocker(r.person_id);
    end if;
    if v_why is not null then
      v_skipped := v_skipped || jsonb_build_object('person_id', r.person_id, 'name', public.person_display_name(r.person_id), 'reason', v_why);
      continue;
    end if;
    v_msg := public.enqueue_message(r.person_id, 'leader_card_reminder',
      jsonb_build_object('tribe', r.tribe, 'state', r.state, 'kind', 'again', 'how', r.how), r.tribe_id,
      'leader-card:' || r.tribe_id::text || ':' || to_char(v_today, 'YYYYMMDD'), now(), 'normal', 'email');
    if v_msg is null then
      v_skipped := v_skipped || jsonb_build_object('person_id', r.person_id, 'name', public.person_display_name(r.person_id), 'reason', 'already_today');
      continue;
    end if;
    insert into public.leader_card_log (kind, person_id, tribe_id, by_person) values ('resend', r.person_id, r.tribe_id, uid);
    v_queued := v_queued + 1;
  end loop;
  perform public.write_event(uid, 'leader_cards.resent', 'leader_cards', p_person::text,
    jsonb_build_object('queued', v_queued, 'skipped', jsonb_array_length(v_skipped), 'scope', case when p_person is null then 'all' else 'one' end));
  return jsonb_build_object('ok', true, 'queued', v_queued, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- The count for Admin -> Sending and email
-- ---------------------------------------------------------------------------
-- The leaders whose email with the card link did not arrive, or never went, and have not sent their card in. The reason is the sender's own words.
create function public.leader_cards_failures()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('person_id', z.person_id, 'name', z.name, 'tribe', z.tribe, 'state', z.invite ->> 'state',
                                                 'reason', z.invite ->> 'reason', 'at', z.invite ->> 'at') order by z.name), '[]'::jsonb)
    into v_rows
    from (select r.person_id, r.tribe, public.person_display_name(r.person_id) as name, public.leader_card_invite_of(r.person_id) as invite
            from public.leader_card_rows(public.my_centre()) r
           where r.state in ('not_started', 'in_progress', 'changes_asked')) z
   where z.invite ->> 'state' in ('failed', 'not_sent');
  return jsonb_build_object('count', jsonb_array_length(v_rows), 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- The sheets
-- ---------------------------------------------------------------------------
-- p_kind 'hod': for the heads of department, with no number and no address (the data lead may download it too).
-- p_kind 'call': adds the number and the address. Only the people who may act, and the download is written to the log.
create function public.leader_cards_sheet(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.leader_cards_role();
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind not in ('hod', 'call') then
    raise exception 'Choose a sheet from the list' using errcode = '22023';
  end if;
  if v_role is null or (p_kind = 'call' and v_role <> 'act') then
    raise exception 'Your role does not include this file' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'department', y.department, 'name', y.name, 'tribe', y.tribe, 'how', y.how, 'state', y.state,
             'invite', y.invite ->> 'state', 'signed_in', y.signed_in_at is not null, 'last_activity', y.last_activity,
             'phone', case when p_kind = 'call' then y.phone end,
             'email', case when p_kind = 'call' then y.email end,
             'whatsapp_ok', case when p_kind = 'call' then y.whatsapp_ok end))
           order by y.dept_rank, y.department, y.rank, y.name), '[]'::jsonb) into v_rows
    from (select r.department, public.person_display_name(r.person_id) as name, r.tribe, r.how, r.state,
                 public.leader_card_invite_of(r.person_id) as invite,
                 (select u.last_sign_in_at from auth.users u where u.id = r.person_id) as signed_in_at,
                 public.leader_last_activity(r.person_id, r.tribe_id) as last_activity,
                 coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = r.person_id),
                          (select mp.whatsapp from public.member_profiles mp where mp.person_id = r.person_id)) as phone,
                 (select p.email from public.people p where p.id = r.person_id) as email,
                 public.consent_granted(r.person_id, 'whatsapp') as whatsapp_ok,
                 case when r.department is null then 1 else 0 end as dept_rank,
                 case r.state when 'not_started' then 1 when 'changes_asked' then 2 when 'in_progress' then 3 when 'submitted' then 4 else 5 end as rank
            from public.leader_card_rows(public.my_centre()) r) y;
  perform public.write_event(auth.uid(), case when p_kind = 'call' then 'leader_cards.call_sheet' else 'leader_cards.hod_sheet' end, 'leader_cards', null,
    jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders: the setting, and the heartbeat's step
-- ---------------------------------------------------------------------------
create function public.leader_card_reminders_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.leader_cards_role();
  s public.leader_card_settings;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select * into s from public.leader_card_settings x where x.id;
  return jsonb_build_object(
    'role', v_role, 'mode', s.reminder_mode, 'days', to_jsonb(s.days), 'start_hour', s.start_hour, 'max_total', s.max_total,
    'reason', s.reason, 'changed_at', s.changed_at,
    'paused', coalesce((select m.paused from public.feature_master m where m.id), true),
    'week', jsonb_build_object(
      'sent', (select count(*) from public.leader_card_log l where l.kind = 'reminder' and l.at > now() - interval '7 days'),
      'would_send', (select count(*) from public.leader_card_log l where l.kind = 'would_send' and l.at > now() - interval '7 days'),
      'resent', (select count(*) from public.leader_card_log l where l.kind = 'resend' and l.at > now() - interval '7 days')));
end;
$$;

-- Admin, a director or a pastor. A reason is needed to move it, and it is kept.
create function public.leader_card_reminders_set(p_mode text, p_days integer[], p_hour integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_days smallint[];
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can change the reminders' using errcode = '42501';
  end if;
  if p_mode not in ('off', 'rehearsal', 'on') then
    raise exception 'Choose Off, Rehearsal or On' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why, in 5 to 300 characters' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_days from unnest(coalesce(p_days, array[4, 5, 6])) d where d between 0 and 6;
  if cardinality(v_days) = 0 or cardinality(v_days) > 4 then
    raise exception 'Choose one to four days a week' using errcode = '22023';
  end if;
  if p_hour is null or p_hour not between 6 and 17 then
    raise exception 'Choose an hour from 6 in the morning to 5 in the afternoon' using errcode = '22023';
  end if;
  update public.leader_card_settings
     set reminder_mode = p_mode, days = v_days, start_hour = p_hour, reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'leader_cards.reminders_set', 'leader_cards', null,
    jsonb_build_object('mode', p_mode, 'days', to_jsonb(v_days), 'hour', p_hour, 'reason', v_reason));
  return public.leader_card_reminders_get();
end;
$$;

-- One beat of the heartbeat. Off: nothing. The Master pause: nothing. Rehearsal: writes down who it would have written to. On: queues the email.
-- Only on the chosen days, from the chosen hour, inside the reminder send window, and never to a leader who has sent their card in.
create function public.leader_card_reminders_run()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.leader_card_settings;
  r record;
  v_today date := public.today_lagos();
  v_kind text;
  v_queued integer := 0;
  v_would integer := 0;
begin
  select * into s from public.leader_card_settings x where x.id;
  if s.reminder_mode = 'off' then
    return jsonb_build_object('mode', 'off', 'queued', 0, 'would_send', 0);
  end if;
  if coalesce((select m.paused from public.feature_master m where m.id), true) then
    return jsonb_build_object('mode', s.reminder_mode, 'paused', true, 'queued', 0, 'would_send', 0);
  end if;
  if not (public.lagos_dow()::smallint = any (s.days)) or public.lagos_hour() < s.start_hour or not public.send_window_ok('reminder') then
    return jsonb_build_object('mode', s.reminder_mode, 'queued', 0, 'would_send', 0);
  end if;
  v_kind := case public.lagos_dow() when 4 then 'thursday' when 5 then 'friday' when 6 then 'saturday' else 'weekly' end;

  for r in
    select x.person_id, x.tribe_id, x.tribe, x.state, x.how
      from public.leader_card_rows((select c.id from public.centres c where c.active order by c.created_at limit 1)) x
     where x.state in ('not_started', 'in_progress', 'changes_asked')
     order by x.tribe, x.person_id
  loop
    continue when public.message_blocker(r.person_id) is not null or public.reminder_stopped(r.person_id, 'reminders');
    continue when exists (select 1 from public.leader_card_log l where l.tribe_id = r.tribe_id and l.day = v_today and l.kind in ('reminder', 'resend'));
    continue when (select count(*) from public.leader_card_log l where l.person_id = r.person_id and l.kind in ('reminder', 'resend')) >= s.max_total;
    if s.reminder_mode = 'rehearsal' then
      continue when exists (select 1 from public.leader_card_log l where l.tribe_id = r.tribe_id and l.day = v_today and l.kind = 'would_send');
      insert into public.leader_card_log (kind, person_id, tribe_id) values ('would_send', r.person_id, r.tribe_id);
      v_would := v_would + 1;
    else
      if public.enqueue_message(r.person_id, 'leader_card_reminder',
           jsonb_build_object('tribe', r.tribe, 'state', r.state, 'kind', v_kind, 'how', r.how), r.tribe_id,
           'leader-card:' || r.tribe_id::text || ':' || to_char(v_today, 'YYYYMMDD'), now(), 'normal', 'email') is not null then
        insert into public.leader_card_log (kind, person_id, tribe_id) values ('reminder', r.person_id, r.tribe_id);
        v_queued := v_queued + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('mode', s.reminder_mode, 'queued', v_queued, 'would_send', v_would);
end;
$$;

create function public.worker_leader_card_reminders(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.leader_card_reminders_run();
end;
$$;

-- ---------------------------------------------------------------------------
-- The functions this package replaces (the old text of each is in the rollback file)
-- ---------------------------------------------------------------------------
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
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff', 'cannot_reach', 'leader_cards') then
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
  elsif k = 'leader_cards' then
    -- Leaders whose Tribe Card is still open: not started, in progress, or sent back with changes asked for.
    return query
      select r.person_id from public.leader_card_rows(p_centre) r
       where r.state in ('not_started', 'in_progress', 'changes_asked');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.leader_cards_role(),
  public.leader_card_state(text, boolean),
  public.leader_card_rows(uuid),
  public.leader_card_invite_of(uuid),
  public.leader_last_activity(uuid, uuid),
  public.leader_card_reminders_run()
  from public, anon, authenticated;

revoke execute on function
  public.leader_cards_board(text, text, integer, integer),
  public.leader_card_department_set(uuid, text),
  public.leader_cards_resend(uuid),
  public.leader_cards_failures(),
  public.leader_cards_sheet(text),
  public.leader_card_reminders_get(),
  public.leader_card_reminders_set(text, integer[], integer, text)
  from public, anon;

grant execute on function
  public.leader_cards_board(text, text, integer, integer),
  public.leader_card_department_set(uuid, text),
  public.leader_cards_resend(uuid),
  public.leader_cards_failures(),
  public.leader_cards_sheet(text),
  public.leader_card_reminders_get(),
  public.leader_card_reminders_set(text, integer[], integer, text)
  to authenticated;

-- The sending service has no account; the token is the credential.
revoke execute on function public.worker_leader_card_reminders(text) from public, anon, authenticated;
grant execute on function public.worker_leader_card_reminders(text) to anon;

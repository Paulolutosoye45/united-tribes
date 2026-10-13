-- =============================================================================
-- United Tribes, Stage 2: the messaging engine (part 2: the calendar and the triggers)
--
-- The weekly automation calendar from the blueprint, run by the database:
--
--   Monday      members: the week's passage, confession and a reminder of their step
--               leaders: the prep pack          coaches: the digest for their circles
--   Tuesday     members: the triad check-in prompt
--   Meeting     members and leaders: a reminder two hours before, with the link
--   After it    leaders: the two-minute log link
--   Next day    members: the recap and their "When..., I will..." step
--   Friday      members: the one-tap step check-in and the testimony prompt
--   Saturday    leaders: the weekly circle report
--   Birthdays   the leader, the day before; the leader again on the day, to prompt the group
--   Late log    leader after 24 hours; coach after 48 hours
--   New member  welcome (member), call-within-72-hours (leader), reminders if the call is missed
--
-- worker_tick() runs it. Every rule has a window of time in which it fires and a key
-- that stops it firing twice, so calling it every fifteen minutes is safe, and a
-- missed run is caught up on the next one. Times are Lagos times.
--
-- The event triggers at the end react to things people do (joining a circle,
-- marking someone absent, a low pulse, an application changing stage).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns this needs
-- ---------------------------------------------------------------------------

-- Triads: small groups of three inside a circle who check in on each other between meetings.
alter table public.circle_members add column triad smallint check (triad >= 1);
create index circle_members_triad_idx on public.circle_members (circle_id, triad) where status = 'active';

-- The link the circle meets on, for online circles (and for a hybrid one).
alter table public.circles
  add column meeting_link text check (meeting_link ~ '^https://[^[:space:]]{6,255}$');

-- The confession the circle says through the week (the wording is loaded with the guides).
alter table public.week_guides
  add column confession text check (char_length(confession) <= 300);

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

create function public.in_window(p_now timestamptz, p_due timestamptz, p_hours integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_now >= p_due and p_now < p_due + make_interval(hours => p_hours);
$$;

-- Puts members into triads of three. A newcomer joins the fullest triad that has room; nobody is left on their own.
create function public.assign_triads(p_circle uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  t smallint;
  single record;
begin
  for m in
    select cm.id from public.circle_members cm
     where cm.circle_id = p_circle and cm.status = 'active' and cm.triad is null
     order by cm.joined_at, cm.id
  loop
    select x.triad into t from (
      select cm.triad, count(*) as n from public.circle_members cm
       where cm.circle_id = p_circle and cm.status = 'active' and cm.triad is not null
       group by cm.triad) x
     where x.n < 3 order by x.n desc, x.triad limit 1;
    if t is null then
      select coalesce(max(cm.triad), 0) + 1 into t from public.circle_members cm
       where cm.circle_id = p_circle and cm.status = 'active';
    end if;
    update public.circle_members set triad = t where id = m.id;
  end loop;

  for single in
    select cm.triad from public.circle_members cm
     where cm.circle_id = p_circle and cm.status = 'active' and cm.triad is not null
     group by cm.triad having count(*) = 1
  loop
    update public.circle_members cm
       set triad = coalesce((
             select y.triad from (
               select o.triad, count(*) as n from public.circle_members o
                where o.circle_id = p_circle and o.status = 'active' and o.triad is not null and o.triad <> single.triad
                group by o.triad having count(*) < 4) y
              order by y.n, y.triad limit 1), cm.triad)
     where cm.circle_id = p_circle and cm.status = 'active' and cm.triad = single.triad;
  end loop;
end;
$$;

-- The people who run a circle: its leader and, if there is one, the assistant.
create function public.circle_team(p_circle uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.leader_id from public.circles c where c.id = p_circle
  union
  select c.assistant_id from public.circles c where c.id = p_circle and c.assistant_id is not null;
$$;

-- The leader sets the link and the place note after the card is approved.
create function public.save_circle_meeting(p_circle uuid, p_link text, p_place_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_note text := nullif(btrim(coalesce(p_place_note, '')), '');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found or not (c.leader_id = uid or coalesce(c.assistant_id = uid, false)) then
    raise exception 'You do not lead this circle' using errcode = '42501';
  end if;
  if c.status <> 'approved' then
    raise exception 'Your circle opens once its card is approved' using errcode = '22023';
  end if;
  if v_link is not null and v_link !~ '^https://[^[:space:]]{6,255}$' then
    raise exception 'Paste the full meeting link. It starts with https://' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 120 then
    raise exception 'Keep the place note to 120 characters or fewer, and never a home address' using errcode = '22023';
  end if;
  update public.circles set meeting_link = v_link, place_note = v_note where id = p_circle;
  perform public.write_event(uid, 'circle.meeting_saved', 'circle', p_circle::text,
    jsonb_build_object('link', v_link is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- The calendar
-- ---------------------------------------------------------------------------

create function public.run_calendar(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Africa/Lagos';
  v_today date := v_local::date;
  s public.seasons%rowtype;
  c public.circles%rowtype;
  g public.week_guides%rowtype;
  m record;
  t record;
  d record;
  cw integer;
  wk integer;
  pw integer;
  ws date;
  mdate date;
  mdt timestamptz;
  due timestamptz;
  k text;
  made integer := 0;
  v_leader_first text;
  v_rep jsonb;
  v_params jsonb;
  v_has_log boolean;
  v_held boolean;
  v_highlight text;
  v_year integer := extract(year from v_today)::integer;
  v_circles jsonb;
begin
  for s in
    select se.* from public.seasons se
     where v_today between se.starts_on - 5 and se.starts_on + se.weeks * 7 + 3
  loop
    cw := public.season_week(s.starts_on, s.weeks, v_today);

    for c in
      select x.* from public.circles x
       where x.season_id = s.id and x.status = 'approved'
         and exists (select 1 from public.circle_members mm where mm.circle_id = x.id and mm.status = 'active')
    loop
      perform public.assign_triads(c.id);
      v_leader_first := public.first_name_of(c.leader_id);

      -- Two days before the season: where and when the first meeting is.
      due := public.lagos_at(s.starts_on - 2, time '09:00');
      k := 'soon:' || c.id;
      if public.in_window(p_now, due, 30) and not exists (select 1 from public.calendar_runs where key = k) then
        for m in select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
          if public.enqueue_message(m.person_id, 'season_starts_soon',
               jsonb_build_object('circle', c.name, 'leader_first', v_leader_first, 'starts_on', s.starts_on,
                                  'first_meeting_on', c.first_meeting_on, 'meeting_day', c.meeting_day,
                                  'meeting_time', to_char(c.meeting_time, 'HH24:MI'), 'mode', c.meeting_mode,
                                  'meeting_link', c.meeting_link, 'place_note', c.place_note, 'group_url', c.whatsapp_group_url),
               c.id, 'soon:' || c.id || ':' || m.person_id) is not null then
            made := made + 1;
          end if;
        end loop;
        insert into public.calendar_runs (key) values (k) on conflict do nothing;
      end if;

      -- This week and the one before (a recap or a late log can fall after the week turns).
      for wk in greatest(1, cw - 1) .. least(cw, s.weeks) loop
        ws := s.starts_on + (wk - 1) * 7;
        mdate := public.meeting_date_of(c.id, wk);
        mdt := public.lagos_at(mdate, c.meeting_time);
        select * into g from public.week_guides where week = wk;

        -- Monday: the passage, the confession and the step (members); the prep pack (the team)
        due := public.lagos_at(ws + 1, time '07:30');
        k := 'wkstart:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 20) and not exists (select 1 from public.calendar_runs where key = k) then
          for m in select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
            select w.when_text, w.will_text into t from public.week_steps w
             where w.person_id = m.person_id and w.circle_id = c.id and w.week = wk;
            if public.enqueue_message(m.person_id, 'week_start',
                 jsonb_build_object('week', wk, 'weeks', s.weeks, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
                                    'confession', g.confession, 'circle', c.name, 'leader_first', v_leader_first,
                                    'when', t.when_text, 'will', t.will_text,
                                    'pulse', public.is_pulse_week(wk, s.weeks)),
                 c.id, 'wkstart:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- The prep pack is for the next meeting: this week's if it is still to come, otherwise next week's.
        pw := case when mdate >= ws + 1 then wk else wk + 1 end;
        due := public.lagos_at(ws + 1, time '08:00');
        k := 'prep:' || c.id || ':' || wk;
        if pw <= s.weeks and public.in_window(p_now, due, 20) and not exists (select 1 from public.calendar_runs where key = k) then
          select * into g from public.week_guides where week = pw;
          for m in select * from public.circle_team(c.id) as person_id loop
            if public.enqueue_message(m.person_id, 'leader_prep',
                 jsonb_build_object('week', pw, 'weeks', s.weeks, 'title', g.title, 'passage', g.passage,
                                    'big_idea', g.big_idea, 'opening_question', g.opening_question,
                                    'circle', c.name, 'meeting_date', public.meeting_date_of(c.id, pw),
                                    'members', (select count(*) from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active'),
                                    'follow_ups', coalesce((
                                      select jsonb_agg(public.first_name_of(f.person_id) order by f.opened_at)
                                        from public.care_flags f where f.circle_id = c.id and f.status <> 'closed'), '[]'::jsonb)),
                 c.id, 'prep:' || c.id || ':' || pw || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
          select * into g from public.week_guides where week = wk;
        end if;

        -- Tuesday: the triad check-in
        due := public.lagos_at(ws + 2, time '12:00');
        k := 'triad:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 12) and not exists (select 1 from public.calendar_runs where key = k) then
          for m in select cm.person_id, cm.triad from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
            select coalesce(array_agg(public.first_name_of(o.person_id) order by o.joined_at), '{}') as names into d
              from public.circle_members o
             where o.circle_id = c.id and o.status = 'active' and o.triad = m.triad and o.person_id <> m.person_id;
            if cardinality(d.names) > 0 and public.enqueue_message(m.person_id, 'triad_prompt',
                 jsonb_build_object('week', wk, 'partners', to_jsonb(d.names), 'circle', c.name),
                 c.id, 'triad:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- Two hours before the meeting
        due := mdt - interval '2 hours';
        k := 'remind:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 2) and not exists (select 1 from public.calendar_runs where key = k) then
          v_params := jsonb_build_object('week', wk, 'title', g.title, 'circle', c.name, 'leader_first', v_leader_first,
                                         'meeting_time', to_char(c.meeting_time, 'HH24:MI'), 'mode', c.meeting_mode,
                                         'meeting_link', c.meeting_link, 'place_note', c.place_note);
          for m in select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
            if public.enqueue_message(m.person_id, 'meeting_reminder', v_params, c.id,
                 'remind:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          for m in select * from public.circle_team(c.id) as person_id loop
            if public.enqueue_message(m.person_id, 'leader_meeting_reminder',
                 v_params || jsonb_build_object('opening_question', g.opening_question), c.id,
                 'lremind:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- Straight after the meeting: the two-minute log
        due := mdt + make_interval(mins => c.duration_minutes + 15);
        k := 'loglink:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 5) and not exists (select 1 from public.calendar_runs where key = k)
           and not exists (select 1 from public.circle_logs l where l.circle_id = c.id and l.week = wk) then
          for m in select * from public.circle_team(c.id) as person_id loop
            if public.enqueue_message(m.person_id, 'leader_log_link',
                 jsonb_build_object('circle', c.name, 'week', wk), c.id,
                 'loglink:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- The next morning: the recap (not if the leader logged that it did not meet)
        due := public.lagos_at(mdate + 1, time '08:00');
        k := 'recap:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 14) and not exists (select 1 from public.calendar_runs where key = k) then
          select l.held, l.highlight into v_held, v_highlight from public.circle_logs l where l.circle_id = c.id and l.week = wk;
          if v_held is distinct from false then
            for m in select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
              select w.when_text, w.will_text into t from public.week_steps w
               where w.person_id = m.person_id and w.circle_id = c.id and w.week = wk;
              if public.enqueue_message(m.person_id, 'meeting_recap',
                   jsonb_build_object('week', wk, 'title', g.title, 'highlight', v_highlight, 'circle', c.name,
                                      'when', t.when_text, 'will', t.will_text),
                   c.id, 'recap:' || c.id || ':' || wk || ':' || m.person_id) is not null then
                made := made + 1;
              end if;
            end loop;
          end if;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- Friday: the one-tap check-in and the testimony prompt
        due := public.lagos_at(ws + 5, time '09:00');
        k := 'friday:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 20) and not exists (select 1 from public.calendar_runs where key = k) then
          for m in select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active' loop
            select w.when_text, w.will_text, w.outcome into t from public.week_steps w
             where w.person_id = m.person_id and w.circle_id = c.id and w.week = wk;
            if t.outcome is null and public.enqueue_message(m.person_id, 'friday_checkin',
                 jsonb_build_object('week', wk, 'circle', c.name, 'when', t.when_text, 'will', t.will_text,
                                    'step_set', t.will_text is not null, 'near_end', wk >= s.weeks - 2),
                 c.id, 'friday:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- Saturday: the weekly circle report
        due := public.lagos_at(ws + 6, time '08:00');
        k := 'report:' || c.id || ':' || wk;
        if public.in_window(p_now, due, 20) and not exists (select 1 from public.calendar_runs where key = k) then
          v_rep := public.circle_week_report(c.id, wk);
          v_params := jsonb_build_object(
            'circle', c.name, 'week', wk, 'weeks', s.weeks, 'report', v_rep,
            'missed', coalesce((
              select jsonb_agg(public.first_name_of(a.person_id) order by public.first_name_of(a.person_id))
                from public.circle_attendance a
               where a.circle_id = c.id and a.week = wk and a.status = 'absent'), '[]'::jsonb),
            'messages_sent', coalesce((
              select jsonb_agg(distinct mm.template) from public.messages mm
               where mm.circle_id = c.id and mm.template in ('leader_missed_one', 'leader_missed_two', 'member_missed_two')
                 and mm.dedupe_key ~ ('^miss(1|2|2m):' || c.id || ':' || wk || ':')), '[]'::jsonb));
          for m in select * from public.circle_team(c.id) as person_id loop
            if public.enqueue_message(m.person_id, 'weekly_report', v_params, c.id,
                 'report:' || c.id || ':' || wk || ':' || m.person_id) is not null then
              made := made + 1;
            end if;
          end loop;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end if;

        -- A meeting that happened but was not logged: the leader after 24 hours, the coach after 48
        select exists (select 1 from public.circle_logs l where l.circle_id = c.id and l.week = wk) into v_has_log;
        if not v_has_log and mdt < p_now then
          if public.in_window(p_now, mdt + interval '24 hours', 12) then
            for m in select * from public.circle_team(c.id) as person_id loop
              if public.enqueue_message(m.person_id, 'leader_log_reminder',
                   jsonb_build_object('circle', c.name, 'week', wk), c.id,
                   'logrem:' || c.id || ':' || wk || ':' || m.person_id) is not null then
                made := made + 1;
              end if;
            end loop;
          end if;
          if c.coach_id is not null and public.in_window(p_now, mdt + interval '48 hours', 12) then
            if public.enqueue_message(c.coach_id, 'coach_log_missing',
                 jsonb_build_object('circle', c.name, 'leader', public.person_display_name(c.leader_id), 'week', wk), c.id,
                 'logcoach:' || c.id || ':' || wk) is not null then
              made := made + 1;
            end if;
          end if;
        end if;
      end loop;

      -- Birthdays: the leader the day before, and again on the day to prompt the group.
      k := 'bday:' || c.id || ':' || v_today;
      if v_local::time >= time '08:00' and not exists (select 1 from public.calendar_runs where key = k) then
        for m in
          select mp.person_id, mp.birthday_month, mp.birthday_day
            from public.circle_members cm
            join public.member_profiles mp on mp.person_id = cm.person_id
           where cm.circle_id = c.id and cm.status = 'active' and mp.birthday_day is not null
        loop
          -- 29 February is kept on 28 February in years without one
          if (m.birthday_month = extract(month from v_today + 1)::integer
              and (m.birthday_day = extract(day from v_today + 1)::integer
                   or (m.birthday_month = 2 and m.birthday_day = 29 and extract(day from v_today + 1)::integer = 28
                       and extract(day from make_date(v_year, 3, 1) - 1)::integer = 28))) then
            for d in select * from public.circle_team(c.id) as person_id loop
              if public.enqueue_message(d.person_id, 'birthday_tomorrow',
                   jsonb_build_object('member_first', public.first_name_of(m.person_id), 'circle', c.name), c.id,
                   'bday1:' || c.id || ':' || m.person_id || ':' || v_year || ':' || d.person_id) is not null then
                made := made + 1;
              end if;
            end loop;
          end if;
          if (m.birthday_month = extract(month from v_today)::integer
              and (m.birthday_day = extract(day from v_today)::integer
                   or (m.birthday_month = 2 and m.birthday_day = 29 and extract(day from v_today)::integer = 28
                       and extract(day from make_date(v_year, 3, 1) - 1)::integer = 28))) then
            for d in select * from public.circle_team(c.id) as person_id loop
              if public.enqueue_message(d.person_id, 'birthday_today',
                   jsonb_build_object('member_first', public.first_name_of(m.person_id), 'circle', c.name,
                                      'group_url', c.whatsapp_group_url), c.id,
                   'bday0:' || c.id || ':' || m.person_id || ':' || v_year || ':' || d.person_id) is not null then
                made := made + 1;
              end if;
            end loop;
          end if;
        end loop;
        insert into public.calendar_runs (key) values (k) on conflict do nothing;
      end if;

      -- A new member the leader has not yet called: a reminder at 72 hours, the coach at seven days.
      for m in
        select cm.person_id, cm.joined_at from public.circle_members cm
         where cm.circle_id = c.id and cm.status = 'active' and cm.called_at is null
           and cm.joined_at < p_now - interval '72 hours' and cm.joined_at > p_now - interval '21 days'
      loop
        for d in select * from public.circle_team(c.id) as person_id loop
          if public.enqueue_message(d.person_id, 'welcome_call_overdue',
               jsonb_build_object('member_first', public.first_name_of(m.person_id), 'circle', c.name,
                                  'joined_on', (m.joined_at at time zone 'Africa/Lagos')::date,
                                  'member_whatsapp', (select case when public.consent_granted(m.person_id, 'whatsapp') then mp.whatsapp end
                                                        from public.member_profiles mp where mp.person_id = m.person_id)),
               c.id, 'wcall1:' || c.id || ':' || m.person_id || ':' || d.person_id) is not null then
            made := made + 1;
          end if;
        end loop;
        if c.coach_id is not null and m.joined_at < p_now - interval '7 days' then
          if public.enqueue_message(c.coach_id, 'coach_welcome_overdue',
               jsonb_build_object('member_first', public.first_name_of(m.person_id), 'circle', c.name,
                                  'leader', public.person_display_name(c.leader_id)),
               c.id, 'wcall2:' || c.id || ':' || m.person_id) is not null then
            made := made + 1;
          end if;
        end if;
      end loop;

      -- The season is over: thanks, and where to see the journey.
      due := public.lagos_at(s.starts_on + s.weeks * 7, time '10:00');
      k := 'done:' || c.id;
      if public.in_window(p_now, due, 48) and not exists (select 1 from public.calendar_runs where key = k) then
        for m in
          select cm.person_id from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active'
          union select * from public.circle_team(c.id)
        loop
          if public.enqueue_message(m.person_id, 'season_complete',
               jsonb_build_object('season', s.name, 'circle', c.name, 'weeks', s.weeks), c.id,
               'done:' || c.id || ':' || m.person_id) is not null then
            made := made + 1;
          end if;
        end loop;
        insert into public.calendar_runs (key) values (k) on conflict do nothing;
      end if;
    end loop;

    -- Monday: each coach's digest of last week for their circles.
    if cw between 2 and s.weeks + 1 then
      ws := s.starts_on + (cw - 1) * 7;
      due := public.lagos_at(ws + 1, time '07:00');
      if public.in_window(p_now, due, 20) then
        for m in select distinct c2.coach_id as person_id from public.circles c2
                  where c2.season_id = s.id and c2.status = 'approved' and c2.coach_id is not null loop
          k := 'digest:' || m.person_id || ':' || s.id || ':' || cw;
          if exists (select 1 from public.calendar_runs where key = k) then
            continue;
          end if;
          select coalesce(jsonb_agg(jsonb_build_object(
                   'circle', c3.name, 'leader', public.person_display_name(c3.leader_id),
                   'report', public.circle_week_report(c3.id, least(cw - 1, s.weeks))) order by c3.name), '[]'::jsonb)
            into v_circles
            from public.circles c3
           where c3.season_id = s.id and c3.status = 'approved' and c3.coach_id = m.person_id
             and exists (select 1 from public.circle_members mm where mm.circle_id = c3.id and mm.status = 'active');
          if jsonb_array_length(v_circles) > 0 and public.enqueue_message(m.person_id, 'coach_digest',
               jsonb_build_object('week', least(cw - 1, s.weeks), 'weeks', s.weeks, 'season', s.name, 'circles', v_circles),
               null, k) is not null then
            made := made + 1;
          end if;
          insert into public.calendar_runs (key) values (k) on conflict do nothing;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object('queued', made, 'at', p_now);
end;
$$;

-- What the sending service calls every fifteen minutes.
create function public.worker_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.run_calendar(now());
end;
$$;

-- ---------------------------------------------------------------------------
-- Things people do that send a message
-- ---------------------------------------------------------------------------

-- A member joins a circle: welcome them, and tell the leader to call within 72 hours.
create function public.on_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
  s public.seasons%rowtype;
  team record;
  v_wa text;
begin
  if new.status <> 'active' then
    return new;
  end if;
  select * into c from public.circles where id = new.circle_id;
  select * into s from public.seasons where id = c.season_id;
  select case when public.consent_granted(new.person_id, 'whatsapp') then mp.whatsapp end into v_wa
    from public.member_profiles mp where mp.person_id = new.person_id;

  perform public.enqueue_message(new.person_id, 'welcome',
    jsonb_build_object('circle', c.name, 'leader_first', public.first_name_of(c.leader_id),
                       'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
                       'mode', c.meeting_mode, 'place_note', c.place_note, 'group_url', c.whatsapp_group_url,
                       'first_meeting_by', new.first_meeting_by, 'first_meeting_on', c.first_meeting_on,
                       'season', s.name, 'starts_on', s.starts_on),
    new.circle_id, 'welcome:' || new.id);
  for team in select * from public.circle_team(new.circle_id) as person_id loop
    perform public.enqueue_message(team.person_id, 'new_member',
      jsonb_build_object('member_first', public.first_name_of(new.person_id),
                         'member_name', public.person_display_name(new.person_id),
                         'member_whatsapp', v_wa, 'circle', c.name,
                         'call_by', ((new.joined_at + interval '72 hours') at time zone 'Africa/Lagos')::date),
      new.circle_id, 'newmember:' || new.id || ':' || team.person_id);
  end loop;
  return new;
end;
$$;
create trigger circle_members_joined after insert on public.circle_members
  for each row execute function public.on_member_joined();

-- Marking someone absent: one miss, two in a row, three.
create function public.on_attendance_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
  rec record;
  n integer := 0;
  v_wa text;
  team record;
  v_first text;
begin
  if new.status <> 'absent' then
    return new;
  end if;
  for rec in
    select a.week, a.status
      from public.circle_attendance a
      join public.circle_logs l on l.circle_id = a.circle_id and l.week = a.week and l.held
     where a.circle_id = new.circle_id and a.person_id = new.person_id and a.week <= new.week
     order by a.week desc
  loop
    exit when rec.status <> 'absent';
    n := n + 1;
  end loop;
  if n = 0 then
    return new;
  end if;
  select * into c from public.circles where id = new.circle_id;
  v_first := public.first_name_of(new.person_id);
  select case when public.consent_granted(new.person_id, 'whatsapp') then mp.whatsapp end into v_wa
    from public.member_profiles mp where mp.person_id = new.person_id;

  -- Held back half an hour, so a leader who taps the wrong button and fixes it sends nothing.
  if n = 1 then
    for team in select * from public.circle_team(new.circle_id) as person_id loop
      perform public.enqueue_message(team.person_id, 'leader_missed_one',
        jsonb_build_object('member_first', v_first, 'member_whatsapp', v_wa, 'circle', c.name, 'week', new.week,
                           'leader_first', public.first_name_of(c.leader_id)),
        new.circle_id, 'miss1:' || new.circle_id || ':' || new.week || ':' || new.person_id || ':' || team.person_id,
        now() + interval '30 minutes');
    end loop;
  elsif n = 2 then
    for team in select * from public.circle_team(new.circle_id) as person_id loop
      perform public.enqueue_message(team.person_id, 'leader_missed_two',
        jsonb_build_object('member_first', v_first, 'member_whatsapp', v_wa, 'circle', c.name, 'week', new.week),
        new.circle_id, 'miss2:' || new.circle_id || ':' || new.week || ':' || new.person_id || ':' || team.person_id,
        now() + interval '30 minutes');
    end loop;
    perform public.enqueue_message(new.person_id, 'member_missed_two',
      jsonb_build_object('circle', c.name, 'leader_first', public.first_name_of(c.leader_id), 'week', new.week),
      new.circle_id, 'miss2m:' || new.circle_id || ':' || new.week || ':' || new.person_id,
      now() + interval '30 minutes');
  elsif c.coach_id is not null then
    perform public.enqueue_message(c.coach_id, 'coach_missed_three',
      jsonb_build_object('member_first', v_first, 'member_name', public.person_display_name(new.person_id),
                         'circle', c.name, 'leader', public.person_display_name(c.leader_id), 'missed', n, 'week', new.week),
      new.circle_id, 'miss3:' || new.circle_id || ':' || new.week || ':' || new.person_id,
      now() + interval '30 minutes');
  end if;
  return new;
end;
$$;
create trigger circle_attendance_added after insert on public.circle_attendance
  for each row execute function public.on_attendance_added();

-- Editing a log deletes and re-adds the attendance. Messages still waiting about the old marks go too.
create function public.on_attendance_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages
   where status = 'queued'
     and (dedupe_key like 'miss1:' || old.circle_id || ':' || old.week || ':' || old.person_id || ':%'
       or dedupe_key like 'miss2:' || old.circle_id || ':' || old.week || ':' || old.person_id || ':%'
       or dedupe_key = 'miss2m:' || old.circle_id || ':' || old.week || ':' || old.person_id
       or dedupe_key = 'miss3:' || old.circle_id || ':' || old.week || ':' || old.person_id);
  return old;
end;
$$;
create trigger circle_attendance_removed before delete on public.circle_attendance
  for each row execute function public.on_attendance_removed();

-- A low belonging answer alerts the coach.
create function public.on_care_flag_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.circles%rowtype;
begin
  if new.kind = 'low_belonging' then
    select * into c from public.circles where id = new.circle_id;
    if c.coach_id is not null then
      perform public.enqueue_message(c.coach_id, 'coach_low_pulse',
        jsonb_build_object('member_name', public.person_display_name(new.person_id), 'circle', c.name,
                           'leader', public.person_display_name(c.leader_id), 'week', new.week),
        new.circle_id, 'lowpulse:' || new.id);
    end if;
  end if;
  return new;
end;
$$;
create trigger care_flags_opened after insert on public.care_flags
  for each row execute function public.on_care_flag_opened();

-- A testimony is waiting for the leader.
create function public.on_testimony_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  team record;
  c public.circles%rowtype;
begin
  select * into c from public.circles where id = new.circle_id;
  for team in select * from public.circle_team(new.circle_id) as person_id loop
    perform public.enqueue_message(team.person_id, 'testimony_waiting',
      jsonb_build_object('circle', c.name, 'by', case new.credit when 'anonymous' then 'A member' else public.first_name_of(new.person_id) end),
      new.circle_id, 'testimony:' || new.id || ':' || team.person_id);
  end loop;
  return new;
end;
$$;
create trigger testimonies_submitted after insert on public.testimonies
  for each row execute function public.on_testimony_submitted();

-- A leader application moves on: tell the applicant, kindly and plainly.
create function public.on_application_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template text;
  v_slot public.interview_slots%rowtype;
  v_phone text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_template := case new.status
    when 'submitted' then 'application_received'
    when 'interview_invited' then 'application_interview_invited'
    when 'interview_booked' then 'application_interview_booked'
    when 'approved_leader' then 'application_approved'
    when 'approved_assistant' then 'application_approved'
    when 'not_approved' then 'application_not_approved'
    else null end;
  if v_template is null then
    return new;
  end if;
  if new.status = 'interview_booked' then
    select * into v_slot from public.interview_slots where application_id = new.id;
  end if;
  perform public.enqueue_message(new.person_id, v_template,
    jsonb_build_object('first_name', public.first_name_of(new.person_id),
                       'role', case new.status when 'approved_leader' then 'circle leader' when 'approved_assistant' then 'assistant leader' end,
                       'starts_at', v_slot.starts_at, 'mode', v_slot.mode, 'place', v_slot.place, 'minutes', v_slot.minutes),
    null, 'app:' || new.id || ':' || new.status);

  -- An approved leader's number from the application becomes their contact number (they still choose the channels).
  if new.status in ('approved_leader', 'approved_assistant') then
    v_phone := regexp_replace(coalesce(new.answers #>> '{contact,whatsapp}', ''), '[\s()-]', '', 'g');
    if v_phone ~ '^\+[1-9][0-9]{7,14}$' then
      insert into public.contact_preferences (person_id, phone, preferred)
      values (new.person_id, v_phone, 'email')
      on conflict (person_id) do update set phone = coalesce(public.contact_preferences.phone, excluded.phone);
    end if;
  end if;
  return new;
end;
$$;
create trigger leader_applications_stage after update of status on public.leader_applications
  for each row execute function public.on_application_stage();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.in_window(timestamptz, timestamptz, integer),
  public.assign_triads(uuid),
  public.circle_team(uuid),
  public.save_circle_meeting(uuid, text, text),
  public.run_calendar(timestamptz),
  public.worker_tick(text),
  public.on_member_joined(),
  public.on_attendance_added(),
  public.on_attendance_removed(),
  public.on_care_flag_opened(),
  public.on_testimony_submitted(),
  public.on_application_stage()
  from public, anon, authenticated;

grant execute on function public.save_circle_meeting(uuid, text, text) to authenticated;
grant execute on function public.worker_tick(text) to anon, authenticated;

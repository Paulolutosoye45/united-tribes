-- Package 7: the end of the series lets the seat go, the leader's 5 pm note, the office's 7 am email, and "I need to leave this tribe".
--
-- One new switch, Release at the end of the series (reach_release), which starts Off and needs Reach series and Seat window On. Nothing here sends or releases
-- anything until a person moves it. It adds no table: a release writes a released seat-window clock, so the seat has the same log, the same seven days to take
-- it back, the same replacement from the bench and the same safety limits as one released for not answering.
--
-- Replaced functions (their old text is in the rollback file): reach_step (only its last lines), seat_ledger_write (a release for no contact is a release, not a
-- leaving) and worker_seat_window_tick (it now also runs the two notes).

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------
insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('reach_release', 'Release at the end of the series', 'When the six-day contact series ends and the member did nothing at all (no link opened, no sign-in, no activity) and all four emails were delivered, the seat is offered on and the member is told kindly, with seven days to take it back. A member who answers, chooses Email me instead, or whose email failed keeps the seat. Needs Reach series and Seat window On. Rehearsal writes down who would be released and sends nothing. The setting At the end of the series (on the Reach series card) chooses who: people who did nothing, everyone still without a number, or nobody (list only).', 8, array['reach_series', 'seat_window'], array['off', 'rehearsal', 'on'], 'off', true, 34, false);

-- Putting the switch On is refused while a seat-window check is red, and says which one. Rehearsal and Off are never refused.
create function public.reach_release_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := public.seat_health_core();
begin
  if not (h ->> 'ok')::boolean then
    raise exception 'Release at the end of the series cannot be put On yet: %', (h -> 'problems' ->> 0) using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger reach_release_gate_insert
  before insert on public.feature_settings
  for each row when (new.feature = 'reach_release' and new.position = 'on')
  execute function public.reach_release_gate();
create trigger reach_release_gate_update
  before update on public.feature_settings
  for each row when (new.feature = 'reach_release' and new.position = 'on' and old.position is distinct from 'on')
  execute function public.reach_release_gate();

-- ---------------------------------------------------------------------------
-- Letting a seat go at the end of the series
--
-- The series has already ended (reach_step). This decides, with every protection of the seat window, whether the seat is released, and does it through the same
-- door: a released clock is written so the seat has the same log, the same way back for seven days, the same replacement from the bench and the same breakers.
-- ---------------------------------------------------------------------------
create function public.reach_release_seat(p_enrolment uuid, p_outcome text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
  tm public.tribe_members%rowtype;
  s public.seat_window_settings%rowtype;
  v_mode text;
  v_never text;
  v_brk text;
  v_clock uuid;
  v_msg uuid;
  v_link text;
  v_chain integer;
  v_params jsonb;
begin
  select * into e from public.reach_enrolments x where x.id = p_enrolment;
  if not found then
    return 'gone';
  end if;
  select * into tm from public.tribe_members x where x.id = e.tm_id for update;
  if not found or tm.status <> 'active' then
    return 'gone';
  end if;
  select * into s from public.seat_window_settings x where x.id;
  v_mode := case when e.rehearsal then 'rehearsal' else public.feature_state_of('reach_release', e.person_id) end;
  if v_mode = 'off' or s.paused then
    return 'off';
  end if;
  -- Someone who must never be released is never released: a minor, a deletion, a care follow-up, a bounced or switched-off email, a hold, a call asked for
  v_never := public.seat_never(e.person_id, tm.id);
  if v_never is not null then
    perform public.write_event(null, 'reach.release_held', 'person', e.person_id::text, jsonb_build_object('why', v_never, 'rehearsal', v_mode = 'rehearsal'));
    return 'never:' || v_never;
  end if;
  if v_mode = 'rehearsal' then
    perform public.write_event(null, 'reach.would_release', 'person', e.person_id::text, jsonb_build_object('outcome', p_outcome, 'tribe', e.tribe_id));
    return 'would_release';
  end if;
  v_brk := public.seat_breaker(tm.tribe_id);
  if v_brk is not null then
    perform public.write_event(null, 'reach.release_held', 'person', e.person_id::text, jsonb_build_object('why', v_brk));
    return 'held:' || v_brk;
  end if;

  select sc.chain into v_chain from public.seat_chain sc where sc.tm_id = tm.id;
  perform set_config('app.seat_via', 'series', true);
  insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, state, outcome, started_at, deadline_at, remind_at, last_call_at, chain, released_at, retake_until)
  values (tm.id, tm.person_id, tm.tribe_id, tm.season_id, 'released', 'series', e.started_at, now(), now(), now(), coalesce(v_chain, 1), now(),
          case when s.take_back_days > 0 then now() + make_interval(days => s.take_back_days) end)
  returning id into v_clock;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'No contact in time' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  perform public.seat_log(v_clock, 'release', null, jsonb_build_object('via', 'series', 'outcome', p_outcome));
  v_params := public.placement_member_params(tm.tribe_id, tm.person_id, tm.degree) || jsonb_build_object('take_back_days', s.take_back_days, 'emails', e.sends);
  v_msg := public.enqueue_message(tm.person_id, 'reach_released', v_params, tm.tribe_id, 'reach-released:' || v_clock::text, now(), 'normal', 'email');
  if v_msg is not null then
    v_link := public.placement_token_mint(tm.id, tm.person_id, greatest(s.take_back_days, 1) + 1);
    update public.messages set reply_token = v_link where id = v_msg;
  end if;
  perform public.write_event(null, 'reach.released', 'tribe', tm.tribe_id::text, jsonb_build_object('outcome', p_outcome, 'emails', e.sends));
  perform public.seat_replace(v_clock, false);
  return 'released';
end;
$$;

-- ---------------------------------------------------------------------------
-- "I need to leave this tribe": a kind exit in the first 14 days of the season
-- ---------------------------------------------------------------------------
create function public.my_tribe_leave_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tm public.tribe_members%rowtype;
  se public.seasons%rowtype;
begin
  if uid is null then
    return jsonb_build_object('can', false);
  end if;
  select m.* into tm from public.tribe_members m where m.person_id = uid and m.status = 'active' limit 1;
  if not found then
    return jsonb_build_object('can', false);
  end if;
  select * into se from public.seasons x where x.id = tm.season_id;
  -- Nothing here changes for anyone until the seat window is moved off Off
  return jsonb_build_object('can', public.today_lagos() < se.starts_on + 14 and se.status <> 'closed' and public.feature_state_of('seat_window', uid) <> 'off',
                            'tribe', (select t.name from public.tribes t where t.id = tm.tribe_id), 'until', se.starts_on + 13);
end;
$$;

create function public.my_tribe_leave(p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tm public.tribe_members%rowtype;
  se public.seasons%rowtype;
  s public.seat_window_settings%rowtype;
  v_why text := nullif(btrim(coalesce(p_why, '')), '');
  v_clock uuid;
  v_name text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_why is not null and v_why not in ('time', 'place', 'fit', 'other') then
    raise exception 'Choose one of the reasons, or none' using errcode = '22023';
  end if;
  select m.* into tm from public.tribe_members m where m.person_id = uid and m.status = 'active' limit 1 for update;
  if not found then
    raise exception 'You do not hold a seat in a tribe' using errcode = '22023';
  end if;
  if public.feature_state_of('seat_window', uid) = 'off' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select * into se from public.seasons x where x.id = tm.season_id;
  if public.today_lagos() >= se.starts_on + 14 or se.status = 'closed' then
    -- After the first two weeks it is a request to the office, through the way that already exists
    return jsonb_build_object('ok', false, 'reason', 'later');
  end if;
  select * into s from public.seat_window_settings x where x.id;
  select t.name into v_name from public.tribes t where t.id = tm.tribe_id;
  perform set_config('app.seat_via', 'leave', true);
  insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, state, outcome, started_at, deadline_at, remind_at, last_call_at, chain, released_at)
  values (tm.id, tm.person_id, tm.tribe_id, tm.season_id, 'released', 'left', now(), now(), now(), now(),
          coalesce((select sc.chain from public.seat_chain sc where sc.tm_id = tm.id), 1), now())
  returning id into v_clock;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Left by the member' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  perform public.seat_log(v_clock, 'release', uid, jsonb_build_object('via', 'leave', 'why', v_why));
  perform public.write_event(uid, 'seat.left_by_member', 'tribe', tm.tribe_id::text, jsonb_build_object('why', v_why));
  -- The seat is offered on at once, the way a released seat is, when the seat window is On for this tribe
  if public.feature_state_of('seat_window', uid) = 'on' then
    begin
      perform public.seat_replace(v_clock, false);
    exception when others then
      perform public.notice_fault('seat_window', 'leave: ' || sqlerrm);
    end;
  end if;
  return jsonb_build_object('ok', true, 'tribe', v_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader's note, once a day at 5 pm, and only on a day something changed in their tribe
-- ---------------------------------------------------------------------------
create function public.seat_notes_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_day date := public.today_lagos();
  v_hour integer := public.lagos_hour();
  v_sent integer := 0;
  v_msg uuid;
  v_names jsonb;
begin
  if public.seat_window_any() <> 'on' or v_hour < 17 or v_hour >= 19 or coalesce((select p.paused from public.seat_window_settings p where p.id), true) then
    return 0;
  end if;
  for r in
    select t.id as tribe_id, t.name, t.leader_id, t.capacity,
           count(*) filter (where l.kind = 'confirmed')::integer as yes_n,
           count(*) filter (where l.kind = 'released' and l.reason = 'No reply in time')::integer as no_reply_n,
           count(*) filter (where l.kind = 'released' and l.reason = 'No contact in time')::integer as series_n,
           count(*) filter (where l.kind = 'left')::integer as left_n,
           count(*) filter (where l.kind = 'taken' and l.via = 'seat-window')::integer as replaced_n
      from public.seat_ledger l join public.tribes t on t.id = l.tribe_id
     where (l.at at time zone 'Africa/Lagos')::date = v_day and t.status = 'approved' and t.leader_id is not null
     group by t.id, t.name, t.leader_id, t.capacity
  loop
    begin
      select coalesce(jsonb_agg(f.first order by f.first), '[]'::jsonb) into v_names
        from (select distinct public.first_name_of(l.person_id) as first from public.seat_ledger l
               where l.tribe_id = r.tribe_id and l.kind = 'confirmed' and (l.at at time zone 'Africa/Lagos')::date = v_day limit 4) f;
      v_msg := public.enqueue_message(r.leader_id, 'leader_seat_note',
        jsonb_build_object('tribe', r.name, 'yes_n', r.yes_n, 'yes_names', v_names, 'no_reply_n', r.no_reply_n, 'series_n', r.series_n, 'left_n', r.left_n,
          'replaced_n', r.replaced_n,
          'numbers_n', (select count(*)::integer from public.reach_enrolments x
                         where x.tribe_id = r.tribe_id and x.outcome = 'fixed' and not x.rehearsal and (x.ended_at at time zone 'Africa/Lagos')::date = v_day),
          'waiting_n', (select count(*)::integer from public.seat_clocks k where k.tribe_id = r.tribe_id and k.state = 'running' and not k.rehearsal),
          'open_n', greatest(r.capacity - (select count(*)::integer from public.tribe_members m where m.tribe_id = r.tribe_id and m.status = 'active'), 0)),
        r.tribe_id, 'leader-seat-note:' || r.tribe_id::text || ':' || v_day::text, now(), 'normal', 'email');
      if v_msg is not null then
        v_sent := v_sent + 1;
      end if;
    exception when others then
      perform public.notice_fault('seat_window', 'leader note: ' || sqlerrm);
    end;
  end loop;
  return v_sent;
end;
$$;

-- ---------------------------------------------------------------------------
-- The office's morning email, at 7 am: yesterday's numbers, and only what needs a person
-- ---------------------------------------------------------------------------
create function public.seat_morning_numbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_y date := public.today_lagos() - 1;
  v_taken integer;
  v_yes integer;
  v_rel integer;
  v_left integer;
  v_refill integer;
begin
  select count(*) filter (where l.kind = 'taken' and l.reason is distinct from 'Taken back'), count(*) filter (where l.kind = 'confirmed'),
         count(*) filter (where l.kind = 'released'), count(*) filter (where l.kind = 'left'),
         count(*) filter (where l.kind = 'taken' and l.via = 'seat-window')
    into v_taken, v_yes, v_rel, v_left, v_refill
    from public.seat_ledger l where (l.at at time zone 'Africa/Lagos')::date = v_y;
  return jsonb_build_object(
    'taken', v_taken, 'yes', v_yes, 'released', v_rel, 'left', v_left, 'refilled', v_refill,
    'not_reached', (select count(*) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by = 'not_reached'),
    'hard', (select count(*) from public.seat_clocks k where k.state = 'released' and k.hard_to_fill and k.replaced_by is null and not k.rehearsal),
    'stopped', (select count(distinct k.blocked_by) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by in ('email', 'day_cap', 'tribe_quarter')),
    'small', (select count(*) from public.tribes t where t.status = 'approved'
               and (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') between 1 and 4),
    'over', (select count(*) from public.tribes t where (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') > 12),
    'in_series', (select count(*) from public.reach_enrolments x where x.status = 'active' and not x.rehearsal));
end;
$$;

create function public.seat_morning_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour integer := public.lagos_hour();
  v_n jsonb;
  v_needs integer;
  v_told integer := 0;
  v_one integer;
begin
  if public.seat_window_any() <> 'on' or v_hour < 7 or v_hour >= 9 then
    return 0;
  end if;
  v_n := public.seat_morning_numbers();
  v_needs := (v_n ->> 'not_reached')::integer + (v_n ->> 'hard')::integer + (v_n ->> 'stopped')::integer + (v_n ->> 'small')::integer + (v_n ->> 'over')::integer;
  select coalesce(sum(public.notify_role(x.id, array['admin', 'director'], 'admin_seat_morning', 'seatmorning:' || public.today_lagos()::text,
           v_n || jsonb_build_object('needs', v_needs), 'Seats this morning', '/admin/seats', true, null)), 0)::integer
    into v_one from public.centres x where x.active;
  v_told := v_one;
  return v_told;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced functions
-- ---------------------------------------------------------------------------
create or replace function public.reach_step(p_id uuid, p_ask boolean default false, p_line text default null, p_by uuid default null)
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
  v_outcome text;
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
  v_outcome := case when v_failed and not e.rehearsal then 'not_reached' when v_seen then 'seen_not_done' else 'silent' end;
  perform public.reach_end(e.id, v_outcome);
  -- Package 7: the end of the series can let the seat go. It has its own switch, it needs the seat window On, and "list" never releases anyone. A fault here
  -- never undoes the end of the series: the person simply keeps the seat and is on the office list.
  if s.end_mode <> 'list' and (v_outcome = 'silent' or (v_outcome = 'seen_not_done' and s.end_mode = 'everyone')) then
    begin
      perform public.reach_release_seat(e.id, v_outcome);
    exception when others then
      perform public.notice_fault('reach_release', sqlerrm);
    end;
  end if;
  return 'ended';
end;
$$;

create or replace function public.seat_ledger_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via text := coalesce(nullif(current_setting('app.seat_via', true), ''), case when auth.uid() is null then 'system' else 'other' end);
begin
  if tg_op = 'INSERT' then
    insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
    values (new.id, new.person_id, new.tribe_id, 'taken', null, auth.uid(), v_via);
    if new.confirmed_at is not null or new.placement_source <> 'auto' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  else
    if new.status = 'released' and old.status = 'active' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, case when new.release_reason in ('No reply in time', 'No contact in time') then 'released' else 'left' end, left(new.release_reason, 300), auth.uid(), v_via);
    elsif new.status = 'active' and old.status = 'released' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'taken', 'Taken back', auth.uid(), v_via);
    elsif new.confirmed_at is not null and old.confirmed_at is null then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.worker_ok(p_token);
  v := public.seat_clock_tick();
  -- The leader's note at 5 pm and the office's email at 7 am: each does nothing unless the seat window is On, and each fault is its own
  begin
    v := v || jsonb_build_object('notes', public.seat_notes_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'leader note: ' || sqlerrm);
  end;
  begin
    v := v || jsonb_build_object('morning', public.seat_morning_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'morning email: ' || sqlerrm);
  end;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the ticks and the helpers are for the database itself; a member may leave and ask only about their own seat
-- ---------------------------------------------------------------------------
revoke execute on function public.reach_release_gate(), public.reach_release_seat(uuid, text), public.seat_notes_tick(), public.seat_morning_numbers(), public.seat_morning_tick()
  from public, anon, authenticated;
revoke execute on function public.my_tribe_leave_state(), public.my_tribe_leave(text) from public, anon;
grant execute on function public.my_tribe_leave_state(), public.my_tribe_leave(text) to authenticated;

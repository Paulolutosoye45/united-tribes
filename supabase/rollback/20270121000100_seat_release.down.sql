-- Takes Package 7 back. Switch "Release at the end of the series" Off first. Seats already released stay released and are ordinary placements again; emails already
-- sent stay sent. Run before the Seat window's own rollback.
begin;

delete from public.feature_settings where feature = 'reach_release';
delete from public.feature_registry where key = 'reach_release';

drop trigger if exists reach_release_gate_insert on public.feature_settings;
drop trigger if exists reach_release_gate_update on public.feature_settings;

drop function if exists public.seat_morning_tick();
drop function if exists public.seat_morning_numbers();
drop function if exists public.seat_notes_tick();
drop function if exists public.my_tribe_leave(text);
drop function if exists public.my_tribe_leave_state();
drop function if exists public.reach_release_seat(uuid, text);
drop function if exists public.reach_release_gate();

-- The earlier texts, exactly
create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.seat_clock_tick();
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
      values (new.id, new.person_id, new.tribe_id, case when new.release_reason = 'No reply in time' then 'released' else 'left' end, left(new.release_reason, 300), auth.uid(), v_via);
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

-- reach_step names the series' own tables, so it is put back only while those tables exist (a way back run again after the series' own has already
-- taken them away has nothing to put it back on)
do $do$
begin
  if to_regclass('public.reach_enrolments') is not null then
    execute $q$
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
  perform public.reach_end(e.id, case when v_failed and not e.rehearsal then 'not_reached' when v_seen then 'seen_not_done' else 'silent' end);
  return 'ended';
end;
$$;
    $q$;
  end if;
end
$do$;

commit;

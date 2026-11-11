-- Way back from "Package 6, the seat window" (the 48-hour clock).
--
-- Puts back, word for word, the one function Package 6 replaced (placed_seq_block, as Package 6b had it). Drops what Package 6 added: the Seat window switch and every
-- rule the owner set for it, the clocks, their log, the chain of offers, the seat ledger, the 12-seat guard on tribe_members and every function and trigger.
--
-- What it does to data, plainly:
--   * A seat the clock released stays released. It was an ordinary release and the seat the next person was offered is an ordinary seat, placed by the ordinary function.
--     Taking a seat back is the office's job (place the person again), not this file's.
--   * An email already sent stays sent. One still waiting to go is left to go (the wording is in the application, so put the application files back first).
--   * The seat ledger is dropped with its lines: the log of the seats' own changes is still in the event log.
--   * No member, consent, number or tribe is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
set local check_function_bodies = off;

drop trigger if exists seat_window_gate_insert on public.feature_settings;
drop trigger if exists seat_window_gate_update on public.feature_settings;
delete from public.feature_settings where feature = 'seat_window';
delete from public.feature_registry where key = 'seat_window';

drop trigger if exists tribe_members_cap_guard_insert on public.tribe_members;
drop trigger if exists tribe_members_cap_guard_update on public.tribe_members;
drop trigger if exists seat_ledger_write on public.tribe_members;
drop trigger if exists seat_clock_on_answer on public.tribe_members;

create or replace function public.placed_seq_block(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := public.message_blocker(p_person);
begin
  if public.is_minor(p_person) then
    return 'under18';
  end if;
  if v in ('deletion', 'under18') then
    return v;
  end if;
  if public.reminder_stopped(p_person, 'announcements') then
    return 'announcements_off';
  end if;
  if v in ('bounced', 'email_off') then
    return v;
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = p_person and f.status <> 'closed') then
    return 'care';
  end if;
  if exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'stop_reminders') then
    return 'stopped';
  end if;
  if exists (select 1 from public.placed_holds h where h.tm_id = p_tm and h.held_until > now()) then
    return 'held';
  end if;
  if public.placed_call_pending(p_tm) then
    return 'call_pending';
  end if;
  return null;
end;
$$;

-- The tables go first: the ledger's trigger depends on the function that freezes it
drop table if exists public.seat_ledger;
drop table if exists public.seat_chain;
drop table if exists public.seat_clock_log;
drop table if exists public.seat_clocks;
drop table if exists public.seat_window_settings;

drop function if exists
  public.seat_ledger_frozen(), public.tribe_members_cap_guard(), public.seat_ledger_write(), public.seat_role(), public.seat_need(boolean), public.seat_open_at(timestamptz),
  public.seat_in_window(), public.seat_window_any(), public.seat_clock_block(uuid), public.seat_never(uuid, uuid), public.seat_msg_state(text), public.seat_email_breaker(),
  public.seat_releases_today(), public.seat_breaker(uuid), public.seat_breaker_words(text), public.seat_health_core(), public.seat_window_gate(), public.seat_log(uuid, text, uuid, jsonb),
  public.seat_mail_key(uuid, text), public.seat_mail(uuid, text), public.seat_clock_new(uuid, timestamptz, boolean, integer), public.seat_clock_sweep(integer),
  public.seat_clock_on_answer(), public.seat_pick(uuid, uuid, uuid), public.seat_replace(uuid, boolean), public.seat_release_core(uuid, uuid, text),
  public.seat_take_back_core(uuid, uuid), public.seat_clock_step(uuid), public.seat_clock_tick(), public.seat_extend_core(uuid, uuid, text), public.seat_link_clock(text),
  public.seat_can_take_back(uuid), public.seat_board_base(uuid, boolean),
  public.god_seat_settings(), public.god_seat_settings_set(integer, integer, integer, integer, integer, integer, integer, integer, text), public.seat_pause_set(boolean, text),
  public.seat_board(text, integer, integer), public.seat_clock_history(uuid), public.seat_keep(uuid, text), public.seat_extend(uuid), public.seat_release_now(uuid, text),
  public.seat_give_back(uuid), public.seat_test_send(), public.seat_leader_strip(uuid), public.seat_leader_more_time(uuid),
  public.worker_seat_window_tick(text), public.worker_seat_info(text, text), public.worker_seat_take_back(text, text);


commit;

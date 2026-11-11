-- Way back from "the placed-member answer sequence, the board and the call desk" (Package 6b of "seats and contacts").
--
-- Withdraws the sequence emails still waiting in the outbox, puts the two functions this change replaced back exactly as they stood (the weekly limit on emails to
-- a person, and trying a failed message again), drops what it added (47 functions, the trigger on a seat's confirmation, eight tables: the settings, the sequences,
-- what each sequence sent, the answers members gave, the calls, the holds, the reveals of a number and the downloads, and the leader's one line to new members on a
-- tribe) and takes the switch off the Switchboard.
-- What it keeps: every seat, member, tribe, message already sent and log line. A member who pressed "Not this season" stays held out of automatic placement for the
-- season: their hold is kept, and is marked as the office's own hold (the only other kinds are a removal and a care follow-up), because the earlier rule has no
-- word for "not this season". A leader's one line to new members is removed with its column. A member's answer ("Not this season", "Call me", "Remind me tonight")
-- is not kept: the table that held it goes with the page that asked for it.
-- Put the application files back before this one: the private page, the Placed members board and the cron route call these functions. Run it as the database
-- owner. Running it twice changes nothing.
begin;

-- The bodies of the functions put back read helpers that a still older way back may already have dropped (this file can be run again after those), so they
-- are not checked while they are put back; they are checked, as always, when they run
set local check_function_bodies = off;

-- The sequence cannot send without the pieces below, so none is left half-way
update public.messages set status = 'skipped', error = 'the placed answer sequence was taken away', reply_token = null
 where template = 'placed_seq' and status in ('queued', 'sending');

drop trigger if exists placed_seq_on_answer on public.tribe_members;

create or replace function public.person_cap_ok(p_person uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
begin
  if (select count(*) from public.messages m
       where m.person_id = p_person and m.template in ('reminder_email', 'office_message') and not (m.params ? 'test')
         and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_nonessential_week then
    return false;
  end if;
  if p_kind = 'reminder' then
    if (select count(*) from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_reminders_week then
      return false;
    end if;
    if s.cap_gap_days > 0 and exists (select 1 from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - make_interval(days => s.cap_gap_days) + interval '1 hour') then
      return false;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.retry_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_template text;
  v_key text;
  v_person uuid;
  v_tm uuid;
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
  -- The private link in a placement email is wiped once the email is finished with. A retry makes a new one, so the email goes out with its three buttons
  -- and not with the signed-in fallback.
  select m.template, m.dedupe_key, m.person_id into v_template, v_key, v_person from public.messages m where m.id = p_id;
  if v_template in ('placement_your_tribe', 'placement_reminder') and v_key ~ '^placement(-reminder)?:[0-9a-f-]{36}$' then
    v_tm := substring(v_key from '[0-9a-f-]{36}$')::uuid;
    if public.placed_is_waiting(v_tm) then
      update public.messages set reply_token = public.placement_token_mint(v_tm, v_person, 60) where id = p_id;
    end if;
  end if;
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

drop function if exists public.worker_placed_seq_tick(text);
drop function if exists public.worker_placed_answers_info(text, text);
drop function if exists public.worker_placed_answer(text, text, text, text, text, text, text);
drop function if exists public.tribe_seat_line_set(uuid, text);
drop function if exists public.tribe_seat_line_get(uuid);
drop function if exists public.placed_seq_tick();
drop function if exists public.placed_seq_sweep(integer);
drop function if exists public.placed_seq_step(uuid);
drop function if exists public.placed_seq_send(uuid, text);
drop function if exists public.placed_seq_selfcheck();
drop function if exists public.placed_seq_params(uuid, text);
drop function if exists public.placed_seq_on_answer();
drop function if exists public.placed_seq_enrol(uuid, boolean);
drop function if exists public.placed_seq_end_for(uuid, text);
drop function if exists public.placed_seq_end(uuid, text);
drop function if exists public.placed_seq_block(uuid, uuid);
drop function if exists public.placed_remind_time();
drop function if exists public.placed_page_opened(uuid);
drop function if exists public.placed_last_email_at(uuid);
drop function if exists public.placed_in_window(text);
drop function if exists public.placed_hold_set(uuid, integer, text);
drop function if exists public.placed_hold_clear(uuid);
drop function if exists public.placed_do_not_season(uuid);
drop function if exists public.placed_desk_state(uuid);
drop function if exists public.placed_desk_row(uuid, uuid, text, text, text, text, timestamp with time zone, integer, text, boolean, numeric);
drop function if exists public.placed_desk_reveal(uuid, boolean);
drop function if exists public.placed_desk_record(uuid, text, date);
drop function if exists public.placed_desk_mask(text);
drop function if exists public.placed_desk_list();
drop function if exists public.placed_desk_download();
drop function if exists public.placed_deadline_on(uuid);
drop function if exists public.placed_deadline_at(uuid);
drop function if exists public.placed_calls_ok();
drop function if exists public.placed_call_tries(uuid);
drop function if exists public.placed_call_pending(uuid);
drop function if exists public.placed_board_tribes();
drop function if exists public.placed_board_summary();
drop function if exists public.placed_board_rows(text, uuid, text, text, text, text, text, integer, integer);
drop function if exists public.placed_board_role();
drop function if exists public.placed_board_need(boolean);
drop function if exists public.placed_board_base(uuid);
drop function if exists public.placed_answers_pause_set(boolean, text);
drop function if exists public.placed_answers_overview();
drop function if exists public.placed_answers_cfg();
drop function if exists public.placed_answers_any();
drop function if exists public.god_placed_answers_settings_set(integer, integer, integer, integer, integer, integer, boolean, text);
drop function if exists public.god_placed_answers_settings();

delete from public.feature_settings where feature = 'placed_answers';
delete from public.feature_registry where key = 'placed_answers';

-- "Not this season" holds keep holding, as the office's own hold, so the earlier rule on where a hold comes from can be put back
update public.placement_holds set source = 'owner' where source = 'not_season';
alter table public.placement_holds drop constraint if exists placement_holds_source_check;
alter table public.placement_holds add constraint placement_holds_source_check check (source in ('owner', 'removal', 'care'));

alter table public.tribes drop column if exists seat_line;

drop table if exists public.placed_downloads;
drop table if exists public.placed_reveals;
drop table if exists public.placed_holds;
drop table if exists public.placed_calls;
drop table if exists public.placed_answers;
drop table if exists public.placed_seq_sends;
drop table if exists public.placed_seq;
drop table if exists public.placed_answers_settings;

commit;

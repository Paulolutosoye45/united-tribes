-- Way back from "Let them choose": every lock goes back on, and the trigger and the functions are removed.
--
-- First, every tribe this unlocked and has not locked again gets its lock back exactly as it was (the list of locked parts is kept on
-- the record), so the rule about sensitive goals is never left without its guard. Any goal a leader has already picked STAYS: only the
-- freedom to change it again goes. Then the trigger and the functions are dropped. The three tables and every row in them stay (no
-- unlock, pick or welcome email record is lost), as the way back from the earlier features does; the lines below say how to drop them
-- too. Welcome emails already queued or sent stay as they are.
-- Roll the application files back first (the Appointments, Bulk and Tribe Card pages call these functions). Run it as the database owner.
-- Running it twice changes nothing.
--
-- To take the three tables out as well (this loses the record of who was unlocked, what they picked and which welcome emails were queued;
-- the messages themselves are kept), run this after the rest:
--   drop table if exists public.leader_welcome_sends;
--   drop table if exists public.leader_welcome_settings;
--   drop table if exists public.leader_goal_unlock;

begin;

do $$
begin
  if to_regclass('public.leader_goal_unlock') is not null then
    update public.tribes t
       set fixed = u.fixed_before
      from public.leader_goal_unlock u
     where u.tribe_id = t.id and u.state = 'open';
  end if;
end;
$$;

drop trigger if exists tribes_goal_guard on public.tribes;
drop function if exists leader_goal_guard();

drop function if exists god_unlock_goal(uuid[],boolean,boolean,text);
drop function if exists god_unlock_goal_run(uuid,boolean,boolean,text);
drop function if exists god_lock_goal(uuid[]);
drop function if exists god_goal_unlock_view(uuid[]);
drop function if exists god_welcome_settings_get(text);
drop function if exists god_welcome_settings_save(text,text);
drop function if exists god_welcome_approve(text);
drop function if exists god_welcome_withdraw();
drop function if exists god_welcome_send(uuid[],text,boolean);
drop function if exists tribe_goal_hints(uuid);
drop function if exists tribe_goal_choice_note(uuid);
drop function if exists leader_welcome_queue(uuid,text,boolean);
drop function if exists leader_goal_unlock_why_not(uuid);

commit;

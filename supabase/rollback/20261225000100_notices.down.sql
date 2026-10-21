-- Way back from the notice system: the notices stop, nothing else changes
--
-- Drops every function the notice system added (the engine, the timed checks, the digest builder, the Admin pages' functions and the
-- heartbeat's entry point). The tables notice_settings, notice_prefs, notice_items, notice_pending, notice_faults and notice_numbers are LEFT
-- as they are, with every row, so no choice anyone made and no record is lost. They hold nothing the platform reads once the functions are gone.
-- To remove them as well, after this file:   drop table public.notice_items, public.notice_prefs, public.notice_pending, public.notice_faults,
--                                           public.notice_numbers, public.notice_settings;
-- Roll the application files back first (the Admin pages call these functions). Run 20261225000200_notice_triggers.down.sql before this one.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop function if exists save_notice_pref(text,text);
drop function if exists my_notice_prefs();
drop function if exists notice_log(integer);
drop function if exists notice_set_mode(text,text);
drop function if exists notice_overview();
drop function if exists admin_attention();
drop function if exists notice_row(text,text,text,text[],text[],integer,integer,boolean,text);
drop function if exists worker_notice_sweep(text);
drop function if exists notice_sweep(timestamp with time zone);
drop function if exists notice_chk_scrub(timestamp with time zone);
drop function if exists notice_chk_meetings(timestamp with time zone);
drop function if exists notice_chk_integrity(timestamp with time zone);
drop function if exists notice_chk_champions(timestamp with time zone);
drop function if exists notice_chk_referees(timestamp with time zone);
drop function if exists notice_chk_applicants(timestamp with time zone);
drop function if exists notice_chk_leaders(timestamp with time zone);
drop function if exists notice_chk_care(timestamp with time zone);
drop function if exists notice_chk_academy(timestamp with time zone);
drop function if exists notice_chk_email_week(timestamp with time zone);
drop function if exists notice_chk_reporting(timestamp with time zone);
drop function if exists notice_chk_sending(timestamp with time zone);
drop function if exists notice_chk_erasure_due(timestamp with time zone);
drop function if exists notice_chk_countdown(timestamp with time zone);
drop function if exists notice_chk_unplaced(timestamp with time zone);
drop function if exists notice_chk_demand(timestamp with time zone);
drop function if exists notice_chk_offers(timestamp with time zone);
drop function if exists notice_chk_slots_low(timestamp with time zone);
drop function if exists notice_chk_interview_outcome(timestamp with time zone);
drop function if exists notice_chk_interviews_tomorrow(timestamp with time zone);
drop function if exists notice_chk_season_review(timestamp with time zone);
drop function if exists notice_chk_templates(timestamp with time zone);
drop function if exists notice_chk_cards(timestamp with time zone);
drop function if exists notice_chk_decisions(timestamp with time zone);
drop function if exists notice_launch_left(uuid,uuid);
drop function if exists notice_number(text);
drop function if exists notice_digest(uuid,timestamp with time zone);
drop function if exists notice_role_removed(uuid,uuid);
drop function if exists notice_defer(text,text,integer,text);
drop function if exists notify_address(text,text,text,text,text,jsonb);
drop function if exists notify_care(uuid,text,text,jsonb,text,text,boolean);
drop function if exists notify_named(uuid,text,text,text,jsonb,text,text,boolean);
drop function if exists notify_role(uuid,text[],text,text,jsonb,text,text,boolean,uuid);
drop function if exists notify_person(uuid,text,text,text,jsonb,text,text,boolean);
drop function if exists notice_fault(text,text);
drop function if exists notice_is_young(uuid);
drop function if exists notice_delivery(uuid,text);
drop function if exists notice_is_owner(uuid);
drop function if exists notice_mode(text);
drop function if exists notice_service_group(text);
drop function if exists notice_digest_group(text);
drop function if exists notice_roles_in(text,uuid);
drop function if exists notice_group_roles(text);
drop function if exists notice_group_of_role(text);
drop function if exists notice_week(timestamp with time zone);
drop function if exists notice_isodow(timestamp with time zone);
drop function if exists notice_hour(timestamp with time zone);
drop function if exists notice_day(timestamp with time zone);

commit;

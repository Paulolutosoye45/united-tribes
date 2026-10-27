-- Way back from "Exports and Reports": no more files are made, and nothing else changes
--
-- Drops every function the feature added, the daily clean-up of the export log among them. The platform's own clean-up was never changed. The tables
-- export_packs, export_settings, export_switches, export_switch_log, export_testers, export_log, export_links and export_feed_links are LEFT
-- as they are, with every row, so the record of who made which file, and every switch change, is not lost. They hold nothing the platform
-- reads once the functions are gone, and with the functions gone no link can be opened, no feed can be read and no switch can be moved.
-- To remove them as well, after this file:   drop table public.export_feed_links, public.export_links, public.export_log, public.export_testers,
--                                           public.export_switch_log, public.export_switches, public.export_settings, public.export_packs;
-- Roll the application files back first (the Exports pages and the feed route call these functions).
-- Run it as the database owner. Running it twice changes nothing.

begin;

-- The daily clean-up has its own door, so the platform's own clean-up needs no change here
drop function if exists public.worker_export_sweep(text);
-- The functions
drop function if exists public.export_hash(text);
drop function if exists public.export_position(text);
drop function if exists public.export_holds(uuid, public.app_role[]);
drop function if exists public.export_refusal(text, uuid, uuid, uuid);
drop function if exists public.export_require(text, uuid, uuid);
drop function if exists public.export_choice_uuid(jsonb, text);
drop function if exists public.export_is_young(uuid);
drop function if exists public.export_note(text, text, text, text);
drop function if exists public.export_options();
drop function if exists public.export_prepare(text, text, text, jsonb);
drop function if exists public.export_open(text);
drop function if exists public.export_done(uuid, integer, boolean, text);
drop function if exists public.export_withdraw(uuid);
drop function if exists public.my_exports();
drop function if exists public.export_tribe_sheet(uuid);
drop function if exists public.export_attendance_register(uuid);
drop function if exists public.export_leaders_roster(uuid);
drop function if exists public.export_people_roles();
drop function if exists public.export_message_volumes(date, date);
drop function if exists public.export_table_rows(text);
drop function if exists public.export_insight_table(text);
drop function if exists public.export_feed_create(text, text);
drop function if exists public.export_feed_list();
drop function if exists public.export_feed_renew(uuid);
drop function if exists public.export_feed_revoke(uuid);
drop function if exists public.export_feed_read(text, text);
drop function if exists public.export_board();
drop function if exists public.export_pack_preview(text, text, jsonb);
drop function if exists public.export_pack_set(text, text, jsonb, text);
drop function if exists public.export_settings_save(jsonb, text);
drop function if exists public.export_tester_set(uuid, boolean);
drop function if exists public.export_log_list(integer, timestamptz, text);
drop function if exists public.export_retention(timestamptz, integer);

commit;

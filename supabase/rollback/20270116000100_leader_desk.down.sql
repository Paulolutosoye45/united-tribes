-- Way back from "the Leader Desk, in God Mode" (Phase 1: see).
--
-- Drops what this change added: the page's functions, its three tables (the draft groups, who was put in them, and the log of opened numbers) and the
-- Leader Desk's place on the Switchboard. It replaced no existing function, so nothing is put back. No seat, member, tribe, message, notice, consent or
-- number is changed, because the Desk never wrote to any of them. Draft groups and the log of opened numbers are removed with their tables: nothing
-- else reads them. Put the application files back before this one: the God Mode page calls these functions. Run it as the database owner.
-- Running it twice changes nothing.
begin;

delete from public.feature_settings where feature = 'leader_desk';
delete from public.feature_registry where key = 'leader_desk';

drop function if exists public.desk_overview();
drop function if exists public.desk_waiting(text, integer, integer);
drop function if exists public.desk_leaders(text, integer, integer);
drop function if exists public.desk_lead_signal(uuid);
drop function if exists public.desk_phone_reveal(uuid);
drop function if exists public.desk_groups_list();
drop function if exists public.desk_group_save(uuid, text, uuid, uuid, uuid, text, text, text, text, integer, text);
drop function if exists public.desk_group_archive(uuid);
drop function if exists public.desk_group_member_add(uuid, uuid);
drop function if exists public.desk_group_member_remove(uuid, uuid);
drop function if exists public.desk_group_suggest(uuid, integer);
drop function if exists public.desk_clusters();
drop function if exists public.desk_group_view(uuid);
drop function if exists public.desk_group_fit(uuid, uuid);
drop function if exists public.desk_block_reason(uuid);
drop function if exists public.desk_lead_notes(text, text, integer, integer, integer, integer, integer);
drop function if exists public.desk_lead_base(uuid);
drop function if exists public.desk_waiting_base(uuid);
drop function if exists public.desk_kind(text, text);
drop function if exists public.desk_base(uuid);
drop function if exists public.desk_need();
drop function if exists public.leader_desk_any();

drop table if exists public.desk_group_members;
drop table if exists public.desk_groups;
drop table if exists public.desk_reveals;

commit;

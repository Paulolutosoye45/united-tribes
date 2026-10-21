-- Way back from automatic placement and bulk leaders: the placing stops, nothing else changes
--
-- Drops the trigger and every function that migration 20261226000100 added (the scorer, planning, placing, the private-link functions, the
-- filtered leader lists, the bulk-leader functions and the heartbeat's entry point). The tables placement_settings, placement_runs,
-- placement_items, placement_teams, placement_tokens, placement_holds, placement_leader_runs and placement_leader_items, and the four columns
-- on tribe_members (placed_by_run, placement_source, confirmed_at, contact_withheld), are LEFT as they are, with every row, so no run, no
-- choice and no record is lost. They hold nothing the platform reads once the functions are gone.
-- Members the church has already placed STAY placed: they hold real seats. Release them first, with Undo, if that is what you want. Leaders
-- of a tribe with placed members will see the whole list again (the old roster has no hold-off), so do not roll back in the middle of a run.
-- To remove the tables as well, after this file:   drop table public.placement_leader_items, public.placement_leader_runs, public.placement_holds,
--   public.placement_tokens, public.placement_teams, public.placement_items, public.placement_runs, public.placement_settings;
--   alter table public.tribe_members drop column placed_by_run, drop column placement_source, drop column confirmed_at, drop column contact_withheld;
-- The consent value 'team_contact' added by 20261226000050 stays: Postgres cannot drop a value from an enum, and nothing reads it once these go.
-- Roll the application files back first (the Placement pages, the link page and the leader pages call these functions).
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists placement_runs_guard on public.placement_runs;
drop function if exists placement_run_guard();
drop trigger if exists tribe_members_placement_released on public.tribe_members;
drop function if exists placement_seat_released();

drop function if exists god_start_leader_card(uuid,uuid);
drop function if exists my_placement();
drop function if exists placement_adjust(uuid,uuid,text,uuid);
drop function if exists placement_assign_batch(uuid,integer);
drop function if exists placement_candidates(uuid,uuid);
drop function if exists placement_contact_refused(uuid);
drop function if exists placement_count_batch(uuid,integer);
drop function if exists placement_do_change(uuid);
drop function if exists placement_do_confirm(uuid,text);
drop function if exists placement_do_withhold(uuid);
drop function if exists placement_filter_members(uuid,jsonb);
drop function if exists placement_floor();
drop function if exists placement_hold_clear(uuid);
drop function if exists placement_hold_set(uuid,text);
drop function if exists placement_holds_list();
drop function if exists placement_leader_inputs(text,uuid,jsonb);
drop function if exists placement_leaders_adjust(uuid,uuid,text,uuid);
drop function if exists placement_leaders_apply(uuid);
drop function if exists placement_leaders_approve(uuid,integer);
drop function if exists placement_leaders_cancel(uuid);
drop function if exists placement_leaders_options(uuid,uuid);
drop function if exists placement_leaders_plan(jsonb,boolean);
drop function if exists placement_leaders_view(uuid);
drop function if exists placement_link_seat(text);
drop function if exists placement_member_params(uuid,uuid,integer);
drop function if exists placement_mode();
drop function if exists placement_my_confirm(text);
drop function if exists placement_my_withhold();
drop function if exists placement_options(uuid,uuid);
drop function if exists placement_overview();
drop function if exists placement_place_batch(uuid,integer);
drop function if exists placement_place_item(uuid,bigint);
drop function if exists placement_pool_reason(uuid,uuid,integer);
drop function if exists placement_rehearse_teams(uuid);
drop function if exists placement_resolve_small(uuid,uuid,text);
drop function if exists placement_run_approve(uuid,integer);
drop function if exists placement_run_cancel(uuid);
drop function if exists placement_run_items(uuid,text,integer,integer);
drop function if exists placement_run_new(jsonb);
drop function if exists placement_run_place(uuid);
drop function if exists placement_run_step(uuid);
drop function if exists placement_run_view(uuid);
drop function if exists placement_settings_get();
drop function if exists placement_settings_save(jsonb);
drop function if exists placement_slot(timestamp with time zone,integer,integer,integer,integer);
drop function if exists placement_state(uuid);
drop function if exists placement_team_mail(uuid);
drop function if exists placement_teams_refresh(uuid);
drop function if exists placement_tick();
drop function if exists placement_token_mint(uuid,uuid,integer);
drop function if exists placement_undo(uuid);
drop function if exists tribe_roster_marked(uuid);
drop function if exists tribe_week_marked(uuid,integer);
drop function if exists worker_placed_change(text,text);
drop function if exists worker_placed_confirm(text,text,text);
drop function if exists worker_placed_info(text,text);
drop function if exists worker_placed_withhold(text,text);
drop function if exists worker_placement_tick(text);

commit;

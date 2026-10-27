-- Way back from "Profiles and the Weekly Rhythm", stage 1: nothing new runs any more, and nothing else changes
--
-- Drops the two steps that sat inside other tables' own writes (the hold on a Tribe Card, and the "Confirm your details" line of the leader's
-- welcome email), then every function the stage added. No existing function was changed, so none needs putting back. The tables
-- feature_registry, feature_settings, feature_master, feature_log, profile_fact_registry, profile_facts, profile_fact_history, profile_changes,
-- details_checks, details_check_items, details_check_tokens and details_check_access are LEFT as they are, with every row, so the record of what
-- people confirmed, what was changed and who moved which switch is not lost. They hold nothing the platform reads once the functions are
-- gone. Nothing a person confirmed is undone: a stage that was corrected on a Tribe Card stays corrected.
-- To remove the tables as well, after this file:
--   drop table public.details_check_access, public.details_check_tokens, public.details_check_items, public.details_checks,
--              public.profile_changes, public.profile_fact_history, public.profile_facts, public.profile_fact_registry,
--              public.feature_log, public.feature_master, public.feature_settings, public.feature_registry;
-- Roll the application files back first (the Features page, the Details check page, My page and the private page call these functions).
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists tribes_hold_for_stage on public.tribes;
drop trigger if exists messages_welcome_confirm on public.messages;
drop function if exists public.tribes_hold_for_stage();
drop function if exists public.messages_welcome_confirm();

-- The heartbeat's step and the private page
drop function if exists public.worker_details_tick(text);
drop function if exists public.worker_details_answer(text, text, text, text, text, text);
drop function if exists public.worker_details_code_check(text, text, text);
drop function if exists public.worker_details_code_send(text, text);
drop function if exists public.worker_details_info(text, text, text);
drop function if exists public.details_check_answer(text, text, text, text);
drop function if exists public.details_check_info(text);
drop function if exists public.details_item_answer(uuid, text, text, text);
drop function if exists public.details_item_state(uuid);
drop function if exists public.details_session_ok(uuid, text);
drop function if exists public.details_item_for_link(text);

-- The console
drop function if exists public.god_details_close(uuid);
drop function if exists public.god_details_status(uuid);
drop function if exists public.god_details_checks();
drop function if exists public.god_details_send(jsonb, text[], text);
drop function if exists public.god_details_plan(jsonb, text[], text);
drop function if exists public.details_would_send(uuid);
drop function if exists public.details_clean_facts(text[]);
drop function if exists public.details_plan_rows(jsonb, text[], boolean);
drop function if exists public.details_token_mint(uuid, integer);
drop function if exists public.details_channels(uuid);
drop function if exists public.details_hash(text);

-- Stage reviews, My page and the facts
drop function if exists public.my_page_answer(text, text, text);
drop function if exists public.my_page_state();
drop function if exists public.tribe_stage_status(uuid);
drop function if exists public.stage_review_decide(uuid, boolean, text);
drop function if exists public.stage_reviews_list();
drop function if exists public.profile_fact_answer(uuid, text, text, text, text);
drop function if exists public.profile_stage_confirmed(uuid);
drop function if exists public.profile_fact_current(uuid, text);
drop function if exists public.profile_fact_applies(uuid, text);
drop function if exists public.profile_fact_options(text);
drop function if exists public.profile_fact_label(text, text);
drop function if exists public.profile_track_phrase(text);

-- The Switchboard
drop function if exists public.features_overview();
drop function if exists public.god_feature_log(integer);
drop function if exists public.god_feature_master(boolean, text);
drop function if exists public.god_feature_remove(uuid, text);
drop function if exists public.god_feature_set(text, text, uuid, text, text[], text, date);
drop function if exists public.god_feature_find(text, text);
drop function if exists public.god_feature_board();
drop function if exists public.feature_position_at(text, text, uuid);
drop function if exists public.feature_summary(text);
drop function if exists public.feature_scope_label(text, uuid);
drop function if exists public.my_features();
drop function if exists public.feature_state(text, uuid);
drop function if exists public.feature_state_of(text, uuid, integer);
drop function if exists public.feature_held_back(uuid);
drop function if exists public.feature_rule_for(text, uuid);
drop function if exists public.feature_rank(text);

commit;

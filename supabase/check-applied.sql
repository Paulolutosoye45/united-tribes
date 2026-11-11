-- Which migration files has this database had applied?
--
-- Paste the whole of this into the Supabase SQL editor and press Run. It only reads: it changes nothing.
-- It looks for one object near the start and one near the end of each migration file (a table or a function that file creates).
--   applied  : both are there
--   MISSING  : neither is there, so the file has not been run on this database (or was rolled back)
--   PARTIAL  : only one is there, so the file stopped part-way. Do not run it again as it is; tell Claude.
-- It lists only the files that are not "applied", oldest first, then one line that says how many files it checked.
-- (Twelve files only add reference data or change existing things, so they leave nothing to look for and are not checked.)

with files (file, has_first, has_last) as (
  values
  ('20261012000100_foundation', to_regclass('public.centres') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'bootstrap_first_admin')),
  ('20261013000100_intake', to_regclass('public.consents') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'intake_stats')),
  ('20261020000100_leaders', to_regclass('public.leader_applications') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_stats')),
  ('20261101000100_academy', to_regclass('public.academy_modules') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'academy_stats')),
  ('20261108000100_matching', to_regclass('public.match_models') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'match_stats')),
  ('20261115000100_rhythm', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'today_lagos'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'care_queue')),
  ('20261122000100_dashboards', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'kpi_targets'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'my_progress')),
  ('20261201000200_messaging_core', to_regclass('public.contact_preferences') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'retry_message')),
  ('20261201000300_messaging_calendar', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'in_window'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'on_application_stage')),
  ('20261201000400_messaging_ops', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'ping'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'sync_contact_from_profile')),
  ('20261202000100_season_engine', to_regclass('public.prayer_requests') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'week_layer')),
  ('20261203000100_intake_plus', to_regclass('public.person_photos') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'photo_of')),
  ('20261204000050_centres', to_regclass('public.platform_flags') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_centre')),
  ('20261204000100_insight', to_regclass('public.kpi_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'bi_status')),
  ('20261205000100_learn_scale', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'model_sample'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guardian_retention')),
  ('20261206000100_admin_hub', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'make_slug'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'launch_checklist')),
  ('20261207000100_platform', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'retention_periods'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'retention_tick')),
  ('20261208000100_data_rights', to_regclass('public.erasure_requests') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'erase_person')),
  ('20261209000100_superadmin', to_regclass('public.platform_owner') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_log_list')),
  ('20261211000100_leader_ai_scoring', to_regclass('public.leader_ai_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_leader_ai_alerts')),
  ('20261212000100_signin_channels', to_regclass('public.signin_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'signin_admin_reset')),
  ('20261213000100_reminders_broadcasts', to_regclass('public.reminder_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'ask_close')),
  ('20261214000100_referee_trust', to_regclass('public.referee_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_referee_tick')),
  ('20261215000100_activity', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'activity_min_group'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'activity_viewed')),
  ('20261216000100_leader_pipeline', to_regclass('public.leader_pipeline_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_pipeline_log_list')),
  ('20261217000100_leader_switchboard', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_lenient'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_pipeline_release')),
  ('20261218000100_academy_switch', to_regclass('public.leader_certification_basis') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_academy_sweep')),
  ('20261219000100_card_templates', to_regclass('public.tribe_card_templates') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'card_template_prefill')),
  ('20261220000100_leader_fit', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_fit_weights_ok'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_fit_quiet_all')),
  ('20261221000100_leader_fit_screen', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_fit_mine'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_fit_status')),
  ('20261222000100_leader_appointments', to_regclass('public.leader_appointments') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tribe_appointment_note')),
  ('20261223000100_leader_board', to_regclass('public.leader_offers') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'leader_offer_respond')),
  ('20261224000100_god_oversight', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_desks'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_looked')),
  ('20261225000100_notices', to_regclass('public.notice_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_notice_pref')),
  ('20261225000200_notice_triggers', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_tribe_open'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_trg_role_removed')),
  ('20261226000100_auto_placement', to_regclass('public.placement_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_hold_set')),
  ('20261226000200_assistant_recommendations', to_regclass('public.assistant_recommendations') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_assistant_tick')),
  ('20261227000100_invitation_email', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'invitation_email_trg'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'invitation_email_trg')),
  ('20261228000100_goal_unlock', to_regclass('public.leader_goal_unlock') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_welcome_send')),
  ('20261229000100_application_sent_notice', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_trg_application_sent'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_trg_application_sent')),
  ('20261230000100_my_appointment', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'my_appointment'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guard_application_appointee')),
  ('20261231000100_exports', to_regclass('public.export_packs') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_export_sweep')),
  ('20270101000100_profiles_stage1', to_regclass('public.feature_registry') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'messages_welcome_confirm')),
  ('20270101000200_leading_view', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'my_leading'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'my_leading')),
  ('20270101000300_placement_visibility', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_contact'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_open_all')),
  ('20270102000100_profiles_stage2', to_regclass('public.profile_story') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'my_profile_export')),
  ('20270103000100_whatsapp_safety', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'feature_platform_only_guard'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'whatsapp_guard_settings_save')),
  ('20270103000200_whatsapp_health', to_regclass('public.whatsapp_signals') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'whatsapp_test_send')),
  ('20270103000300_number_required', to_regclass('public.number_prompts') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tribe_number_gaps')),
  ('20270103000400_removal_requests', to_regclass('public.removal_requests') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_removal_tick')),
  ('20270104000100_inseason_placement', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_season'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_one_place')),
  ('20270105000100_whatsapp_mode', to_regclass('public.whatsapp_mode') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hand_staff_list')),
  ('20270106000100_contact_gaps', to_regclass('public.contact_asks') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reach_prompt_dismiss')),
  ('20270107000100_said_yes', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'seat_said_yes'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tribe_group_mark')),
  ('20270109000100_office_placement', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_gate'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'placement_office_counts')),
  ('20270110000100_leader_cards', to_regclass('public.leader_departments') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_leader_card_reminders')),
  ('20270111000100_reach_series', to_regclass('public.reach_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_reach_settings_set')),
  ('20270112000100_admin_remove', to_regclass('public.admin_removals') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_removal_tidy')),
  ('20270113000100_placed_nudge', to_regclass('public.placed_nudge_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_placed_nudge_settings_set')),
  ('20270114000100_placed_answers', to_regclass('public.placed_answers_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_placed_answers_settings_set')),
  ('20270115000100_owner_requests', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_chk_placement_requests'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'notice_chk_placement_requests')),
  ('20270116000100_leader_desk', to_regclass('public.desk_groups') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_clusters')),
  ('20270117000100_desk_proposals', to_regclass('public.desk_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_desk_tick')),
  ('20270118000100_desk_offers', to_regclass('public.desk_lead_stops') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'worker_desk_offer_answer')),
  ('20270119000100_desk_open', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_open_words'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_pipeline_settings_set')),
  ('20270120000100_seat_window', to_regclass('public.seat_window_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'seat_leader_more_time')),
  ('20270121000100_seat_release', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reach_release_gate'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'seat_morning_tick')),
  ('20270122000100_seat_autopilot', to_regclass('public.autopilot_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_autopilot_settings_set')),
  ('20270123000100_guide_release', to_regclass('public.guide_release_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'guide_release_set')),
  ('20270124000100_hod_reconcile', to_regclass('public.hod_reconciles') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hod_reconcile_delete')),
  ('20270125000100_desk_extras', exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_whatsapp_on'), exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_assistant_put_forward')),
  ('20270126000100_sign_in_prompt', to_regclass('public.prompt_settings') is not null, exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'god_prompt_settings_set'))
),
verdict as (
  select file,
         case when has_first and has_last then 'applied' when not has_first and not has_last then 'MISSING' else 'PARTIAL' end as status
    from files
)
select file, status from verdict where status <> 'applied'
union all
select 'checked ' || count(*) || ' files; ' || count(*) filter (where status = 'applied') || ' applied', null from verdict
order by 2 nulls last, 1;

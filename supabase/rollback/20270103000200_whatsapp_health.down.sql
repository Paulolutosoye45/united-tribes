-- Way back from "WhatsApp that cannot fail quietly", stage 2 (the health page): the Messages page goes back to what stage 1 left.
--
-- Drops the trigger that wrote down why a WhatsApp message was given up on, the functions the page called, the sending service's one new call and the
-- three tables that held Meta's notices, the last week's causes and the last answer the checks gave, and takes the function off the Switchboard
-- (with its rule; the log of who moved a switch is kept). Roll back the later stages first (their way-back files do), and the application files before
-- this one: the health page calls these functions. No message, no consent and no template is touched. Run it as the database owner. Running it
-- twice changes nothing.
begin;
drop trigger if exists messages_outcome_watch on public.messages;
drop function if exists public.messages_outcome_watch();
drop function if exists public.whatsapp_test_send();
drop function if exists public.whatsapp_check_save(jsonb);
drop function if exists public.whatsapp_health_overview();
drop function if exists public.worker_whatsapp_signal(text, text, text, text, text);
drop function if exists public.whatsapp_cause(text);
drop table if exists public.whatsapp_checks;
drop table if exists public.whatsapp_outcomes;
drop table if exists public.whatsapp_signals;
-- The Switchboard: the function and its rule
delete from public.feature_settings where feature = 'whatsapp_health';
delete from public.feature_registry where key = 'whatsapp_health';
commit;

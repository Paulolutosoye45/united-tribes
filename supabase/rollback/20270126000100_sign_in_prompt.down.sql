-- Way back from "the sign-in prompt" (the screen on top of the page that asks a signed-in person for the answer they owe: say yes to a placement, add a WhatsApp number,
-- answer an offer to lead a group, book an interview time). Switch "Sign-in prompt" Off first.
--
-- It replaced nothing, so this puts back nothing: it drops the one line on the Switchboard, the 17 functions and the four tables it added.
--
-- What it does to data, plainly:
--   * The answers people gave on the screen are NOT undone. A "yes" to a placement, a number saved, a WhatsApp yes or no, a booked interview time and an answered offer
--     were recorded by the site's own functions (the same ones the emails use), so they stay exactly where they are.
--   * The prompt's own memory is removed with its tables: the visits, the log of what was shown (kind and outcome only, never a number or an answer) and the "not now" counts.
--     Copy them first if you want the record (select * from public.prompt_log).
--   * No member, seat, tribe, notice, consent, message or number is changed. The emails and the banners were never touched, so they carry on as before.
-- Run it as the database owner. Running it twice changes nothing.
begin;

delete from public.feature_settings where feature = 'sign_in_prompt';
delete from public.feature_registry where key = 'sign_in_prompt';

drop function if exists public.god_prompt_settings_set(integer, integer, integer, integer, text[], text);
drop function if exists public.god_prompt_settings();
drop function if exists public.prompt_overview(integer);
drop function if exists public.prompt_whatsapp_answer(boolean);
drop function if exists public.prompt_save_number(text, boolean, boolean);
drop function if exists public.prompt_placement_answer(text, text, text);
drop function if exists public.prompt_log_set(text, text);
drop function if exists public.my_prompt_queue();
drop function if exists public.prompt_tasks_owed(uuid);
drop function if exists public.prompt_task(uuid, text);
drop function if exists public.prompt_mask(text);
drop function if exists public.prompt_can_skip(uuid);
drop function if exists public.prompt_seat_deadline(uuid);
drop function if exists public.prompt_rostered(uuid);
drop function if exists public.prompt_never(uuid);
drop function if exists public.prompt_rung(text);
drop function if exists public.prompt_kinds();

drop table if exists public.prompt_streaks;
drop table if exists public.prompt_log;
drop table if exists public.prompt_visits;
drop table if exists public.prompt_settings;

commit;

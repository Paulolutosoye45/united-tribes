-- Way back from "the Leader Desk, Phase 2a" (email a proposed group, check interest, and the member's one-tap answer).
--
-- Drops what this change added: the Desk's email functions, its four tables (the settings, what was sent or would have been, the private links, and the
-- members who pressed "Stop these") and puts the Switchboard text for the Leader Desk back as Phase 1 had it. It replaced no function, so nothing else is put
-- back. No member, seat, tribe, message, notice, consent or number is changed. Emails the Desk had already queued stay in the queue: the page they link to is
-- gone, so the link in them says it cannot be opened. Switch the Leader Desk to Off first if you want nothing more to go. Put the application files back
-- before this one: the God Mode page and the private page call these functions. Run it as the database owner.
-- Running it twice changes nothing.
begin;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal from willingness, walk of faith, attendance, being named and weekly steps. Sends nothing yet: emailing a proposed group, recommending a leader and forming a tribe come next.'
 where key = 'leader_desk';

drop function if exists public.desk_mail_state(uuid);
drop function if exists public.desk_mail_block(uuid);
drop function if exists public.desk_mail_cap(uuid, boolean);
drop function if exists public.desk_mail_words(text);
drop function if exists public.desk_send_at();
drop function if exists public.desk_tribe_pick(uuid);
drop function if exists public.desk_tribe_params(uuid, uuid);
drop function if exists public.desk_interest_params(uuid, uuid);
drop function if exists public.desk_link_mint(uuid, uuid, integer);
drop function if exists public.desk_link_proposal(text);
drop function if exists public.desk_mail_send(text, uuid, uuid, uuid, integer, jsonb, uuid);
drop function if exists public.desk_tick();
drop function if exists public.desk_send_state();
drop function if exists public.desk_settings_set(integer, integer, integer, integer, text);
drop function if exists public.desk_propose_preview(uuid);
drop function if exists public.desk_propose_tribe(uuid, uuid);
drop function if exists public.desk_interest_check(uuid);
drop function if exists public.desk_group_interest(uuid);
drop function if exists public.desk_proposals_list(text, integer, integer);
drop function if exists public.desk_proposal_cancel(uuid);
drop function if exists public.worker_desk_info(text, text);
drop function if exists public.worker_desk_answer(text, text, text, text[]);
drop function if exists public.worker_desk_tick(text);

drop table if exists public.desk_links;
drop table if exists public.desk_stops;
drop table if exists public.desk_proposals;
drop table if exists public.desk_settings;

commit;

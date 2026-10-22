-- Way back from the "a new leader application was sent" notice for admins and directors
--
-- Drops the trigger and the function it runs. Nothing is sent from the event any more. Notices already written stay in the log; nothing else is
-- touched, and applications are sent exactly as before.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists notice_application_sent on public.leader_applications;
drop function if exists public.notice_trg_application_sent();

commit;

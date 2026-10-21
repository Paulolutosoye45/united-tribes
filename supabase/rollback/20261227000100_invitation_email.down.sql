-- Way back from the invitation email: inviting someone saves the invitation and the role and sends nothing again, as it did before.
--
-- Drops the trigger and its function. Every invitation, every role and every email already queued or sent stays exactly as it is.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists invitation_email on public.invitations;
drop function if exists invitation_email_trg();

commit;

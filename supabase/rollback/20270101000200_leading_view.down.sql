-- Way back from "a leader can see the tribe they lead"
--
-- Drops the lookup. The Lead page then reads it as "not available" and shows a leader with neither an application nor an appointment the
-- ordinary "Lead another tribe" page again, exactly as it did before this change. Nothing else is touched: Tribe Cards, members, roles,
-- appointments and applications stay as they are.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop function if exists public.my_leading();

commit;

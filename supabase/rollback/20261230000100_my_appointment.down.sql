-- Way back from "an appointed leader can see that they were appointed"
--
-- Drops the guard on new applications and the lookup. The Lead page then reads the lookup as "not available" and shows an appointed leader
-- the ordinary "Start my application" page again, exactly as it did before this change. Nothing else is touched: appointments, Tribe Cards,
-- roles and applications stay as they are.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists leader_applications_guard_appointee on public.leader_applications;
drop function if exists public.guard_application_appointee();
drop function if exists public.my_appointment();

commit;

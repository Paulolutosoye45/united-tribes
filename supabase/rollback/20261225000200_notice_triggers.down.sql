-- Way back from the event triggers of the notice system: nothing is sent from events any more
--
-- Drops the 17 triggers that watched real events (an application reaching the pastors, a Tribe Card submitted, a deletion request, a role
-- given or taken away, and so on) and the functions they ran. The old tables, their rows and everything the platform did before are untouched.
-- The notice engine itself (20261225000100) stays; the heartbeat's timed checks and digests keep working until that file is rolled back too.
-- Run this BEFORE 20261225000100_notices.down.sql.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists notice_application_interviewed on public.leader_applications;
drop trigger if exists notice_certified on public.leader_certifications;
drop trigger if exists notice_erasure_request on public.erasure_requests;
drop trigger if exists notice_fit_model on public.leader_fit_models;
drop trigger if exists notice_guardian_given on public.guardian_consents;
drop trigger if exists notice_interview_booked on public.interview_slots;
drop trigger if exists notice_offer_answered on public.leader_offers;
drop trigger if exists notice_person_erased on public.people;
drop trigger if exists notice_practice_ready on public.academy_progress;
drop trigger if exists notice_referee_concern on public.leader_reference_answers;
drop trigger if exists notice_reference_held on public.leader_reference_flags;
drop trigger if exists notice_reference_in on public.leader_references;
drop trigger if exists notice_role_given on public.person_roles;
drop trigger if exists notice_role_removed on public.person_roles;
drop trigger if exists notice_seats on public.tribe_members;
drop trigger if exists notice_testimony_shared on public.testimonies;
drop trigger if exists notice_tribe_changed on public.tribes;

drop function if exists notice_tribe_open(uuid);
drop function if exists notice_trg_application();
drop function if exists notice_trg_referee_concern();
drop function if exists notice_trg_reference_in();
drop function if exists notice_trg_reference_held();
drop function if exists notice_trg_interview_booked();
drop function if exists notice_trg_tribe();
drop function if exists notice_trg_certified();
drop function if exists notice_trg_seats();
drop function if exists notice_trg_offer();
drop function if exists notice_trg_fit_model();
drop function if exists notice_trg_practice_ready();
drop function if exists notice_trg_testimony();
drop function if exists notice_trg_erasure();
drop function if exists notice_trg_person_erased();
drop function if exists notice_trg_guardian();
drop function if exists notice_trg_role_given();
drop function if exists notice_trg_role_removed();

commit;

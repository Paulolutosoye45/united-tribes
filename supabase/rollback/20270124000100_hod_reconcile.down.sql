-- Takes Fix 7's HOD report back. Run before the earlier packages' own rollbacks. The reports (and the contacts they hold) are removed with their tables: copy them first if you
-- want to keep them. Departments already put on leaders stay (they are ordinary labels), invitations already sent stay sent, and nobody's role changes.
begin;

drop function if exists public.hod_reconcile_delete(uuid);
drop function if exists public.hod_reconcile_invite(uuid);
drop function if exists public.hod_reconcile_tag(uuid);
drop function if exists public.hod_reconcile_list();
drop function if exists public.hod_reconcile_get(uuid);
drop function if exists public.hod_reconcile_run(jsonb, text);
drop function if exists public.hod_results(uuid);
drop function if exists public.hod_email_norm(text);

drop table if exists public.hod_reconcile_rows;
drop table if exists public.hod_reconciles;

commit;

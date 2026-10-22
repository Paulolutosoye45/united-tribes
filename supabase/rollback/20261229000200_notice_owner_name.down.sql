-- Way back from the owner-name fix in the "someone's role changed" notice
--
-- Puts back the function exactly as 20261225000200_notice_triggers.sql created it. THAT VERSION NAMES THE HIDDEN OWNER in the admins' email when the
-- owner gives a role from God Mode. Use this only if the fixed function is itself faulty, and switch the Admins group Off on Admin -> Notifications
-- while you do.
-- Run it as the database owner. Running it twice changes nothing.

begin;

create or replace function public.notice_trg_role_given()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff boolean := new.role::text in ('pastor', 'director', 'admin', 'coach', 'care_lead', 'data_lead');
  v_event text;
begin
  begin
    if not v_staff and new.role::text <> 'community_champion' then
      return null;
    end if;
    v_event := 'role:' || new.person_id || ':' || new.role || ':' || extract(epoch from coalesce(new.granted_at, now()))::bigint;
    if v_staff then
      perform public.notify_person(new.person_id, public.notice_group_of_role(new.role::text), 'staff_role_welcome', v_event,
        jsonb_build_object('role', new.role::text), 'You now hold the ' || replace(new.role::text, '_', ' ') || ' role', '/admin', true);
    end if;
    perform public.notify_role(new.centre_id, array['admin'], 'admin_role_changed', v_event || ':admin',
      jsonb_build_object('person', public.first_name_of(new.person_id), 'role', new.role::text, 'change', 'added',
                         'by', case when new.granted_by is null then null else public.first_name_of(new.granted_by) end),
      public.first_name_of(new.person_id) || ' was given the ' || replace(new.role::text, '_', ' ') || ' role', '/admin/people', true, new.person_id);
  exception when others then
    perform public.notice_fault('role_given', sqlerrm);
  end;
  return null;
end;
$$;

revoke execute on function public.notice_trg_role_given() from public, anon, authenticated;

commit;

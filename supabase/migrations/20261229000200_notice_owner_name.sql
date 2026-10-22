-- The hidden owner is never named in an email: closes a leak in the "someone's role changed" notice.
--
-- What was wrong: when the platform owner gave someone a role from God Mode, the admins' email said "given the coach role by <the owner's name>".
-- The owner's name is normally shown as "The office" to everyone, but that guard lifts while the owner's session is unlocked, and the notice is
-- written inside that session, so the real name went into the queued email.
--
-- What changes: the notice never names the person who gave the role when that person is the hidden owner (the email then simply says the role was
-- given, as it does when no one is recorded), and no notice is written at all if the hidden owner is the one receiving a role.
-- Nothing else about the notice changes. Roles given by anyone else are still credited by first name.
--
-- Way back: supabase/rollback/20261229000200_notice_owner_name.down.sql (puts the earlier function back, leak included; use only if this one is faulty)

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
    -- The hidden owner holds every role without a row and is never written about.
    if public.notice_is_owner(new.person_id) then
      return null;
    end if;
    v_event := 'role:' || new.person_id || ':' || new.role || ':' || extract(epoch from coalesce(new.granted_at, now()))::bigint;
    if v_staff then
      perform public.notify_person(new.person_id, public.notice_group_of_role(new.role::text), 'staff_role_welcome', v_event,
        jsonb_build_object('role', new.role::text), 'You now hold the ' || replace(new.role::text, '_', ' ') || ' role', '/admin', true);
    end if;
    perform public.notify_role(new.centre_id, array['admin'], 'admin_role_changed', v_event || ':admin',
      jsonb_build_object('person', public.first_name_of(new.person_id), 'role', new.role::text, 'change', 'added',
                         'by', case when new.granted_by is null or public.notice_is_owner(new.granted_by) then null
                                    else public.first_name_of(new.granted_by) end),
      public.first_name_of(new.person_id) || ' was given the ' || replace(new.role::text, '_', ' ') || ' role', '/admin/people', true, new.person_id);
  exception when others then
    perform public.notice_fault('role_given', sqlerrm);
  end;
  return null;
end;
$$;

revoke execute on function public.notice_trg_role_given() from public, anon, authenticated;

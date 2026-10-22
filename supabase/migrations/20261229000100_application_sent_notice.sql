-- A new leader application was sent: tell the admins and the directors.
--
-- Until now nobody on the team was told when an application arrived. The pastors were told once it had been through the interview
-- ("an application is ready for your decision"); the applicant was thanked. This adds the missing first step.
--
-- Who:     everyone who holds the admin or the director role in the applicant's centre, except the applicant. A person who holds both is told once.
-- When:    the moment the application's status becomes "submitted" (the applicant pressed Send). Sent at once, not in the summary;
--          quiet hours (10 pm to 6 am, Lagos) still hold it until morning like every other notice.
-- Says:    that an application came in, the applicant's first name, how many are waiting to be invited to an interview. Nothing the applicant wrote,
--          no score, no reference, no reason. No name at all for a young applicant or the hidden platform owner.
-- Button:  a director, pastor or coach goes to the review list. An admin who holds none of those cannot open the review list (by design), so
--          their button goes to the Figures page, where the intake numbers are.
-- Switch:  the "admin" and "directors" groups on Admin -> Notifications. Off, Rehearsal and On work as for every other notice.
-- Safety:  like every notice trigger, a failure here is written to the notice log and never stops the application from being sent.
-- Way back: supabase/rollback/20261229000100_application_sent_notice.down.sql

create function public.notice_trg_application_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_waiting integer;
  v_applicant text;
  v_event text;
  r record;
begin
  begin
    select p.centre_id into v_centre from public.people p where p.id = new.person_id;
    if v_centre is null then
      return null;
    end if;
    select count(*)::integer into v_waiting
      from public.leader_applications a join public.people p on p.id = a.person_id
     where a.status = 'submitted' and p.centre_id = v_centre;
    -- Never the name of the hidden owner or of anyone young.
    v_applicant := case when public.notice_is_owner(new.person_id) or public.notice_is_young(new.person_id) then null
                        else public.first_name_of(new.person_id) end;
    v_event := 'applied:' || new.id || ':' || extract(epoch from coalesce(new.submitted_at, now()))::bigint;

    for r in
      select distinct on (pr.person_id) pr.person_id, pr.role::text as role,
             exists (select 1 from public.person_roles x
                      where x.person_id = pr.person_id and x.centre_id = v_centre and x.role::text in ('pastor', 'director', 'coach')) as can_review
        from public.person_roles pr
       where pr.centre_id = v_centre
         and pr.role::text in ('admin', 'director')
         and pr.person_id <> new.person_id
       order by pr.person_id, case pr.role::text when 'director' then 1 else 2 end
    loop
      perform public.notify_person(r.person_id, public.notice_group_of_role(r.role), 'admin_application_sent', v_event,
        jsonb_build_object('applicant', v_applicant, 'waiting', v_waiting),
        'A new leader application was sent',
        case when r.can_review then '/review' else '/admin/figures' end,
        true);
    end loop;
  exception when others then
    perform public.notice_fault('application_sent', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_application_sent
  after update of status on public.leader_applications
  for each row when (new.status = 'submitted' and old.status is distinct from new.status)
  execute function public.notice_trg_application_sent();

-- Not reachable through the API: the database runs it when the event happens.
revoke execute on function public.notice_trg_application_sent() from public, anon, authenticated;

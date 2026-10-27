-- An appointed leader can see that they were appointed, and cannot start an application they do not need.
--
-- What was wrong: the "Lead a tribe" page decides what to show from the person's leader application. An appointment from God Mode creates
-- none (no application, no interview, no certificate), and the appointment itself is readable by nobody but the owner. So an appointed leader
-- was shown "Lead another tribe. Start my application", and could send one, which told every admin and director "a new leader application
-- was sent" and put them in the interview line.
--
-- What changes (two additions, nothing replaced, nothing rewritten):
--   1. my_appointment()  what the appointed leader may see about their own appointment: the tribe's name and where its card stands, and
--      whether they are certified. It says nothing about who appointed them, any note, or that an owner exists. Null when there is no
--      active appointment, or the leader role is gone.
--   2. A guard on leader_applications: someone with an active appointment cannot start a new application (a new draft). An application they
--      began before they were appointed is left alone, and so is anything the office loads directly.
--
-- Way back: supabase/rollback/20261230000100_my_appointment.down.sql

-- ---------------------------------------------------------------------------
-- 1. What the appointed leader sees
-- ---------------------------------------------------------------------------
create function public.my_appointment()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.leader_appointments;
  t public.tribes;
begin
  if me is null then
    return null;
  end if;
  select * into a from public.leader_appointments x where x.person_id = me and x.status = 'active';
  if not found or not public.is_trainee() then
    return null;
  end if;
  if a.tribe_id is not null then
    select * into t from public.tribes x where x.id = a.tribe_id and x.status <> 'closed';
  end if;
  -- Only these three things. Never who appointed them, the note, or the form the owner filled in.
  return jsonb_build_object(
    'tribe_name', case when t.id is null then null else t.name end,
    'tribe_status', case when t.id is null then null else t.status end,
    'certified', exists (select 1 from public.leader_certifications c where c.person_id = me));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. No new application for someone who has been appointed
-- ---------------------------------------------------------------------------
create function public.guard_application_appointee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a new draft, which is what the app starts. Anything the office loads directly is left alone.
  if new.status = 'draft' and exists (select 1 from public.leader_appointments a where a.person_id = new.person_id and a.status = 'active') then
    raise exception 'You have been appointed to lead, so there is no application to send' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger leader_applications_guard_appointee
  before insert on public.leader_applications
  for each row execute function public.guard_application_appointee();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.my_appointment() from public, anon;
grant execute on function public.my_appointment() to authenticated;
revoke execute on function public.guard_application_appointee() from public, anon, authenticated;

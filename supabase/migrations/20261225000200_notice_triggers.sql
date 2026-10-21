-- Notices that follow real events.
--
-- Each trigger below watches one thing that happens (an application reaches the pastors, a Tribe Card is submitted, a deletion request comes
-- in, a role is given or taken away) and hands the news to the notice engine from 20261225000100_notices.sql.
--
-- Three promises hold for every trigger here:
--   1. It runs AFTER the change and can never undo it. Any fault is written to notice_faults and the change goes through.
--   2. It changes nothing while the group of notices is Off (the engine returns before it writes anything).
--   3. It carries first names, counts and times only. Never a note, a score, a reason, a referee's words, a care word, a sealed note, or
--      anything about a young member.
--
-- Rolling back: supabase/rollback/20261225000200_notice_triggers.down.sql drops these triggers and functions and nothing else.

-- ---------------------------------------------------------------------------
-- A tribe that is approved and whose leader is certified is open to members
-- ---------------------------------------------------------------------------

create function public.notice_tribe_open(p_tribe uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tribes%rowtype;
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found or t.status <> 'approved' or t.leader_id is null then
    return;
  end if;
  if not exists (select 1 from public.leader_certifications c where c.person_id = t.leader_id) then
    return;
  end if;
  perform public.notify_person(t.leader_id, 'leaders', 'leader_tribe_open', 'open:' || t.id,
    jsonb_build_object('tribe', t.name), coalesce(t.name, 'Your tribe') || ' is open to members', '/lead/tribe');
end;
$$;

-- ---------------------------------------------------------------------------
-- Leader applications
-- ---------------------------------------------------------------------------

-- An application reaches "interviewed": the pastors have a decision to make.
create function public.notice_trg_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_waiting integer;
begin
  begin
    select p.centre_id into v_centre from public.people p where p.id = new.person_id;
    if v_centre is null then
      return null;
    end if;
    select count(*)::integer into v_waiting
      from public.leader_applications a join public.people p on p.id = a.person_id
     where a.status = 'interviewed' and p.centre_id = v_centre;
    perform public.notify_role(v_centre, array['pastor'], 'pastor_decision_ready',
      'decision:' || new.id || ':' || extract(epoch from now())::bigint,
      jsonb_build_object('applicant', public.first_name_of(new.person_id), 'waiting', v_waiting),
      'An application is ready for your decision', '/review', false, new.person_id);
  exception when others then
    perform public.notice_fault('application', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_application_interviewed
  after update of status on public.leader_applications
  for each row when (new.status = 'interviewed' and old.status is distinct from new.status)
  execute function public.notice_trg_application();

-- A referee marks a concern. The pastors are told that there is one, never what it says.
create function public.notice_trg_referee_concern()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  begin
    select app.id, app.person_id, p.centre_id into a
      from public.leader_references r
      join public.leader_applications app on app.id = r.application_id
      join public.people p on p.id = app.person_id
     where r.id = new.reference_id and app.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed');
    if found then
      perform public.notify_role(a.centre_id, array['pastor'], 'pastor_referee_concern', 'concern:' || new.reference_id,
        '{}'::jsonb, 'A referee raised a concern', '/review', true, a.person_id);
    end if;
  exception when others then
    perform public.notice_fault('referee_concern', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_referee_concern
  after insert or update of concern on public.leader_reference_answers
  for each row when (new.concern is true)
  execute function public.notice_trg_referee_concern();

-- A reference arrives: the applicant is told it is in, and the referee is thanked.
create function public.notice_trg_reference_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  v_first text := nullif(split_part(btrim(coalesce(new.referee_name, '')), ' ', 1), '');
begin
  begin
    select app.person_id into a from public.leader_applications app where app.id = new.application_id;
    if found then
      perform public.notify_person(a.person_id, 'applicants', 'applicant_reference_in', 'ref-in:' || new.id,
        jsonb_build_object('referee', v_first), 'A reference has come in', '/lead/apply');
    end if;
    if new.contact_kind = 'email' and new.contact_norm is not null then
      perform public.notify_address(new.contact_norm, new.referee_name, 'referees', 'referee_thanks', 'thanks:' || new.id,
        jsonb_build_object('referee', v_first));
    end if;
  exception when others then
    perform public.notice_fault('reference_in', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_reference_in
  after update of submitted_at on public.leader_references
  for each row when (old.submitted_at is null and new.submitted_at is not null)
  execute function public.notice_trg_reference_in();

-- The checks hold a reference for a look.
create function public.notice_trg_reference_held()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
begin
  begin
    select app.person_id, p.centre_id into a
      from public.leader_references r
      join public.leader_applications app on app.id = r.application_id
      join public.people p on p.id = app.person_id
     where r.id = new.reference_id;
    if found then
      perform public.notify_role(a.centre_id, array['pastor'], 'pastor_reference_held', 'held:' || new.id,
        '{}'::jsonb, 'A reference is held for a look', '/admin/referees', false, a.person_id);
    end if;
  exception when others then
    perform public.notice_fault('reference_held', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_reference_held
  after insert on public.leader_reference_flags
  for each row when (new.severity = 'hold')
  execute function public.notice_trg_reference_held();

-- ---------------------------------------------------------------------------
-- Interviews
-- ---------------------------------------------------------------------------

-- An applicant books a slot: the directors are told, and so is whoever opened the slot.
create function public.notice_trg_interview_booked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  v_centre uuid;
  v_params jsonb;
  v_event text := 'interview:' || new.id || ':' || new.application_id;
  v_group text;
begin
  begin
    select app.person_id, p.centre_id into v_person, v_centre
      from public.leader_applications app join public.people p on p.id = app.person_id where app.id = new.application_id;
    if v_centre is null then
      return null;
    end if;
    v_params := jsonb_build_object('applicant', public.first_name_of(v_person), 'starts_at', to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                   'minutes', new.minutes, 'mode', new.mode, 'place', new.place);
    perform public.notify_role(v_centre, array['director'], 'director_interview_booked', v_event, v_params,
      'An interview was booked', '/review/interviews', false, v_person);
    if new.created_by is not null and new.created_by is distinct from v_person then
      select case when exists (select 1 from public.person_roles r where r.person_id = new.created_by and r.role = 'director') then 'directors'
                  when exists (select 1 from public.person_roles r where r.person_id = new.created_by and r.role = 'pastor') then 'pastors' end
        into v_group;
      if v_group is not null then
        perform public.notify_person(new.created_by, v_group, 'director_interview_booked', v_event, v_params,
          'An interview was booked', '/review/interviews');
      end if;
    end if;
  exception when others then
    perform public.notice_fault('interview_booked', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_interview_booked
  after update of application_id on public.interview_slots
  for each row when (old.application_id is null and new.application_id is not null)
  execute function public.notice_trg_interview_booked();

-- ---------------------------------------------------------------------------
-- Tribe Cards, tribes and their leaders
-- ---------------------------------------------------------------------------

create function public.notice_trg_tribe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_event text;
  v_old text;
  v_new text;
begin
  begin
    select p.centre_id into v_centre from public.people p where p.id = new.leader_id;

    -- Submitted for review: the pastors and directors, and the tribe's coach, under one event so nobody is told twice
    if new.status = 'submitted' and old.status is distinct from new.status and v_centre is not null then
      v_event := 'card:' || new.id || ':' || extract(epoch from coalesce(new.submitted_at, now()))::bigint;
      perform public.notify_role(v_centre, array['pastor', 'director'], 'pastor_card_review', v_event,
        jsonb_build_object('tribe', new.name, 'leader', public.first_name_of(new.leader_id)),
        coalesce(new.name, 'A Tribe Card') || ' is ready for review', '/review/cards', false, new.leader_id);
      perform public.notify_named(new.coach_id, 'coach', 'coach_card_submitted', v_event,
        jsonb_build_object('tribe', new.name, 'leader', public.first_name_of(new.leader_id)),
        coalesce(new.name, 'A Tribe Card') || ' was submitted', '/review/cards');
    end if;

    -- Approved: the leader hears, and the tribe opens once the leader is certified
    if new.status = 'approved' and old.status is distinct from new.status then
      perform public.notify_person(new.leader_id, 'leaders', 'leader_card_approved', 'cardok:' || new.id || ':' || extract(epoch from now())::bigint,
        jsonb_build_object('tribe', new.name), 'Your Tribe Card was approved', '/lead/tribe');
      perform public.notice_tribe_open(new.id);
    end if;

    -- Changes asked for: the leader hears. The pastor's note stays on the page; it is not put in an email.
    if new.status = 'changes_requested' and old.status is distinct from new.status then
      perform public.notify_person(new.leader_id, 'leaders', 'leader_card_changes', 'cardchg:' || new.id || ':' || extract(epoch from now())::bigint,
        jsonb_build_object('tribe', new.name), 'Your Tribe Card needs a few changes', '/lead/tribe');
    end if;

    -- An assistant is added
    if new.assistant_id is not null and old.assistant_id is distinct from new.assistant_id then
      perform public.notify_person(new.leader_id, 'leaders', 'leader_assistant_added', 'assistant:' || new.id || ':' || new.assistant_id,
        jsonb_build_object('tribe', new.name, 'assistant', public.first_name_of(new.assistant_id)),
        public.first_name_of(new.assistant_id) || ' is now your assistant', '/lead/tribe');
    end if;

    -- A coach is given a leader
    if new.coach_id is not null and old.coach_id is distinct from new.coach_id then
      perform public.notify_named(new.coach_id, 'coach', 'coach_new_leader', 'coach:' || new.id || ':' || new.coach_id,
        jsonb_build_object('tribe', new.name, 'leader', public.first_name_of(new.leader_id)),
        public.first_name_of(new.leader_id) || ' is now one of your leaders', '/review/cards');
    end if;

    -- The meeting changes while the tribe is open: members are told once it has been quiet for half an hour
    if new.status = 'approved' then
      v_old := md5(concat_ws('|', old.meeting_day, old.meeting_time, old.meeting_mode, old.place_note, old.meeting_link));
      v_new := md5(concat_ws('|', new.meeting_day, new.meeting_time, new.meeting_mode, new.place_note, new.meeting_link));
      if old.status = 'approved' and v_old <> v_new then
        perform public.notice_defer('meeting_changed', new.id::text, 30, v_old);
      end if;
    end if;
  exception when others then
    perform public.notice_fault('tribe', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_tribe_changed
  after update of status, assistant_id, coach_id, meeting_day, meeting_time, meeting_mode, place_note, meeting_link on public.tribes
  for each row execute function public.notice_trg_tribe();

-- A leader is certified.
create function public.notice_trg_certified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  begin
    perform public.notify_person(new.person_id, 'leaders', 'leader_certified', 'certified:' || new.person_id || ':' || new.as_role,
      jsonb_build_object('as_role', new.as_role), 'You are certified', '/lead');
    for t in select x.id from public.tribes x where x.leader_id = new.person_id and x.status = 'approved' loop
      perform public.notice_tribe_open(t.id);
    end loop;
  exception when others then
    perform public.notice_fault('certified', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_certified
  after insert on public.leader_certifications
  for each row execute function public.notice_trg_certified();

-- A seat count worth knowing: two seats left, and full.
create function public.notice_trg_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  v_left integer;
begin
  begin
    select x.id, x.name, x.leader_id, x.capacity into t from public.tribes x where x.id = new.tribe_id and x.status = 'approved';
    if found and t.capacity is not null and t.capacity > 0 then
      v_left := t.capacity - (select count(*)::integer from public.tribe_members m where m.tribe_id = t.id and m.status = 'active');
      if v_left in (0, 2) then
        perform public.notify_person(t.leader_id, 'leaders', 'leader_seats', 'seats:' || t.id || ':' || v_left,
          jsonb_build_object('tribe', t.name, 'seats_left', v_left),
          case when v_left = 0 then t.name || ' is full' else t.name || ' has two seats left' end, '/lead/tribe');
      end if;
    end if;
  exception when others then
    perform public.notice_fault('seats', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_seats
  after insert or update of status on public.tribe_members
  for each row when (new.status = 'active')
  execute function public.notice_trg_seats();

-- A leader offer is answered.
create function public.notice_trg_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
begin
  begin
    select p.centre_id into v_centre from public.people p where p.id = new.person_id;
    if v_centre is not null then
      perform public.notify_role(v_centre, array['director'], 'director_offer_answered', 'offer:' || new.id || ':' || new.status,
        jsonb_build_object('person', public.first_name_of(new.person_id), 'answer', new.status),
        public.first_name_of(new.person_id) || case when new.status = 'accepted' then ' accepted a leader offer' else ' declined a leader offer' end,
        '/admin/leader-supply', false, new.person_id);
    end if;
  exception when others then
    perform public.notice_fault('offer', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_offer_answered
  after update of status on public.leader_offers
  for each row when (new.status in ('accepted', 'declined') and old.status = 'offered')
  execute function public.notice_trg_offer();

-- The leader fit model has a new version waiting for a pastor to approve it.
create function public.notice_trg_fit_model()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  begin
    for c in select x.id from public.centres x where x.active loop
      perform public.notify_role(c.id, array['pastor'], 'pastor_fit_model_waiting', 'fitmodel:' || new.version,
        '{}'::jsonb, 'A new fit model is waiting for approval', '/growth/model');
    end loop;
  exception when others then
    perform public.notice_fault('fit_model', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_fit_model
  after insert on public.leader_fit_models
  for each row when (new.approved_at is null and not new.active)
  execute function public.notice_trg_fit_model();

-- A leader has passed every Academy module and has not yet had a practice assessment: their coach is told.
create function public.notice_trg_practice_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_coach uuid;
  v_modules integer;
  v_passed integer;
begin
  begin
    select count(*)::integer into v_modules from public.academy_modules m where m.active;
    select count(*)::integer into v_passed
      from public.academy_progress ap join public.academy_modules m on m.id = ap.module_id
     where ap.person_id = new.person_id and ap.passed_at is not null and m.active;
    if v_modules > 0 and v_passed >= v_modules
       and not exists (select 1 from public.practice_assessments a where a.person_id = new.person_id) then
      select p.centre_id into v_centre from public.people p where p.id = new.person_id;
      select t.coach_id into v_coach from public.tribes t where t.leader_id = new.person_id and t.coach_id is not null order by t.created_at desc limit 1;
      if v_coach is not null then
        perform public.notify_named(v_coach, 'coach', 'coach_practice_ready', 'practice:' || new.person_id,
          jsonb_build_object('leader', public.first_name_of(new.person_id)),
          public.first_name_of(new.person_id) || ' is ready for a practice assessment', '/review/academy');
      elsif v_centre is not null then
        perform public.notify_role(v_centre, array['coach'], 'coach_practice_ready', 'practice:' || new.person_id,
          jsonb_build_object('leader', public.first_name_of(new.person_id)),
          public.first_name_of(new.person_id) || ' is ready for a practice assessment', '/review/academy', false, new.person_id);
      end if;
    end if;
  exception when others then
    perform public.notice_fault('practice_ready', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_practice_ready
  after insert or update of passed_at on public.academy_progress
  for each row when (new.passed_at is not null)
  execute function public.notice_trg_practice_ready();

-- ---------------------------------------------------------------------------
-- Members: what happens to what they wrote, and their right to be forgotten
-- ---------------------------------------------------------------------------

-- A testimony is approved to be shared. The words are not in the email.
create function public.notice_trg_testimony()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.notify_person(new.person_id, 'members', 'member_testimony_shared', 'testimony:' || new.id || ':' || new.status,
      jsonb_build_object('shared_with', case when new.status = 'church_approved' then 'church' else 'tribe' end),
      'Your testimony was shared', '/tribe/testimony');
  exception when others then
    perform public.notice_fault('testimony', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_testimony_shared
  after update of status on public.testimonies
  for each row when (new.status in ('tribe_approved', 'church_approved') and old.status is distinct from new.status)
  execute function public.notice_trg_testimony();

-- A deletion request comes in (or comes in again): the office is told, and the member is told it arrived.
create function public.notice_trg_erasure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text := 'erasure:' || new.person_id || ':' || extract(epoch from new.requested_at)::bigint;
begin
  begin
    if tg_op = 'UPDATE' and old.status = 'open' and old.requested_at = new.requested_at then
      return null;
    end if;
    perform public.notify_role(new.centre_id, array['admin', 'director'], 'admin_data_request', v_event,
      '{}'::jsonb, 'A deletion request came in', '/admin/privacy', false, new.person_id);
    if not new.by_office then
      perform public.notify_person(new.person_id, 'members', 'member_deletion_received', v_event, '{}'::jsonb,
        'We received your deletion request', '/profile');
    end if;
  exception when others then
    perform public.notice_fault('erasure', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_erasure_request
  after insert or update of status, requested_at on public.erasure_requests
  for each row when (new.status = 'open')
  execute function public.notice_trg_erasure();

-- The moment before a person with an open deletion request is erased, the last email is queued to their address. The address is
-- overwritten by the sweep once it has been sent, so nothing about them is kept.
create function public.notice_trg_person_erased()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if exists (select 1 from public.erasure_requests r where r.person_id = old.id and r.status = 'open')
       and not public.notice_is_young(old.id) then
      perform public.notify_address(old.email, public.first_name_of(old.id), 'members', 'member_deletion_done', 'del:' || old.id,
        jsonb_build_object('first_name', public.first_name_of(old.id)));
    end if;
  exception when others then
    perform public.notice_fault('person_erased', sqlerrm);
  end;
  return old;
end;
$$;

create trigger notice_person_erased
  before delete on public.people
  for each row execute function public.notice_trg_person_erased();

-- A parent's permission has been given and still needs its call. Only that a call is waiting: no name, no age.
create function public.notice_trg_guardian()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
begin
  begin
    select p.centre_id into v_centre from public.people p where p.id = new.person_id;
    if v_centre is not null then
      perform public.notify_care(v_centre, 'care_teen_confirm', 'teen:' || new.id || ':' || extract(epoch from coalesce(new.answered_at, now()))::bigint,
        '{}'::jsonb, 'A parent''s permission is waiting for its confirmation call', '/care/teens');
    end if;
  exception when others then
    perform public.notice_fault('guardian', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_guardian_given
  after update of status on public.guardian_consents
  for each row when (new.status = 'approved' and new.verified_at is null and old.status is distinct from new.status)
  execute function public.notice_trg_guardian();

-- ---------------------------------------------------------------------------
-- Roles: a welcome for the person, a note for the admins, and a stop for notices that no longer belong to them
-- ---------------------------------------------------------------------------

create function public.notice_trg_role_given()
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

create trigger notice_role_given
  after insert on public.person_roles
  for each row when (new.role <> 'member')
  execute function public.notice_trg_role_given();

create function public.notice_trg_role_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    -- A person who is being erased loses every role at once; that is not a change to announce, and there is nobody left to tell.
    if exists (select 1 from public.people p where p.id = old.person_id) then
      perform public.notice_role_removed(old.person_id, old.centre_id);
      if old.role::text in ('pastor', 'director', 'admin', 'coach', 'care_lead', 'data_lead', 'community_champion') then
        perform public.notify_role(old.centre_id, array['admin'], 'admin_role_changed',
          'role:' || old.person_id || ':' || old.role || ':removed:' || extract(epoch from now())::bigint,
          jsonb_build_object('person', public.first_name_of(old.person_id), 'role', old.role::text, 'change', 'removed', 'by', null),
          public.first_name_of(old.person_id) || ' no longer holds the ' || replace(old.role::text, '_', ' ') || ' role', '/admin/people', true, old.person_id);
      end if;
    end if;
  exception when others then
    perform public.notice_fault('role_removed', sqlerrm);
  end;
  return null;
end;
$$;

create trigger notice_role_removed
  after delete on public.person_roles
  for each row when (old.role <> 'member')
  execute function public.notice_trg_role_removed();

-- ---------------------------------------------------------------------------
-- Who may call what: none of these is reachable through the API. The database runs them when the event happens.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.notice_tribe_open(uuid),
  public.notice_trg_application(), public.notice_trg_referee_concern(), public.notice_trg_reference_in(), public.notice_trg_reference_held(),
  public.notice_trg_interview_booked(), public.notice_trg_tribe(), public.notice_trg_certified(), public.notice_trg_seats(),
  public.notice_trg_offer(), public.notice_trg_fit_model(), public.notice_trg_practice_ready(), public.notice_trg_testimony(),
  public.notice_trg_erasure(), public.notice_trg_person_erased(), public.notice_trg_guardian(), public.notice_trg_role_given(),
  public.notice_trg_role_removed()
  from public, anon, authenticated;

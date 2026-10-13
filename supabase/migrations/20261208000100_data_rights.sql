-- ---------------------------------------------------------------------------
-- Data rights: a member's own copy of their data, and the way a member asks for it all to be erased.
--
-- The Nigeria Data Protection Act 2023 gives people the right to see what is held about them and to ask for it to be
-- erased, and the blueprint promises both. This adds:
--
--   * export_my_data()      what the platform holds about the signed-in person, in one document (the app adds the
--                           private notes, which only the app's keys can open, and hands it over as a file);
--   * request_erasure()     a member asks, from their profile, for their account and everything in it to be deleted;
--   * erasure_queue() etc.  the office sees the requests, with what the deletion would touch, and either erases the
--                           person or declines with a reason the member can read.
--
-- Erasure is always a person's decision followed by an office decision, never automatic: the office must be able to stop
-- and check first (a care case that is open, a safeguarding matter the church must keep records of, a circle the person
-- leads). The one thing the database refuses on its own is erasing someone who leads a circle, because the circle and the
-- seats of the people in it belong to the leader's record.
--
-- Erasing deletes the sign-in account. Every table that holds something about a person points at that account and is
-- deleted with it (or, where the row is about someone else's work, loses only the author's name), so nothing is left to
-- forget to clean. What is kept: that an erasure happened, when and by whom (no name, no email).
-- ---------------------------------------------------------------------------

create table public.erasure_requests (
  person_id uuid primary key references public.people (id) on delete cascade,
  centre_id uuid not null references public.centres (id),
  status text not null default 'open' check (status in ('open', 'declined')),
  -- What the member chose to say, if anything
  note text check (char_length(note) <= 600),
  -- The office wrote the request down on the person's behalf (they asked in person or by email)
  by_office boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  -- Why the answer was no, in words the member will read
  decision_note text check (char_length(decision_note) <= 600),
  check (status = 'open' or (decided_at is not null and decision_note is not null))
);
alter table public.erasure_requests enable row level security;
-- No grants: only the functions below touch this table.

-- ---------------------------------------------------------------------------
-- The member's own copy
-- ---------------------------------------------------------------------------

create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people p where p.id = uid) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'about_this_file',
      'A copy of what United Tribes holds about you, made when you asked for it. Dates are in UTC. It leaves out what other people '
      'wrote about their own work (a leader''s notes on a meeting, the Care Team''s records): ask the data protection lead for those.',
    'made_at', now(),
    'you', (
      select jsonb_build_object(
        'name', p.full_name, 'preferred_name', p.preferred_name, 'email', p.email, 'joined', p.created_at,
        'roles', coalesce((select jsonb_agg(r.role::text order by r.role::text) from public.person_roles r where r.person_id = uid), '[]'::jsonb))
        from public.people p where p.id = uid),
    'how_we_reach_you', (select to_jsonb(c) - 'person_id' from public.contact_preferences c where c.person_id = uid),
    'agreements', coalesce((
      select jsonb_agg(jsonb_build_object('about', c.purpose::text, 'agreed', c.granted, 'wording_version', c.version, 'at', c.created_at) order by c.id)
        from public.consents c where c.person_id = uid), '[]'::jsonb),
    'form_answers', (
      select (to_jsonb(m) - 'person_id' - 'season_id' - 'age_range_id' - 'tribe_id' - 'second_tribe_id' - 'season_goal_id'
                         - 'support_enc' - 'leader_note_enc' - 'ai_assist')
             || jsonb_build_object(
                  'age_range', (select a.label from public.age_ranges a where a.id = m.age_range_id),
                  'tribe', (select t.name from public.tribes t where t.id = m.tribe_id),
                  'second_tribe', (select t.name from public.tribes t where t.id = m.second_tribe_id),
                  'goal', (select g.title from public.season_goals g where g.id = m.season_goal_id),
                  'season', (select s.name from public.seasons s where s.id = m.season_id),
                  'private_notes_saved', jsonb_build_object('what_would_help_care_for_you', m.support_enc is not null, 'note_to_your_leader', m.leader_note_enc is not null))
        from public.member_profiles m where m.person_id = uid),
    'circles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'circle', c.name, 'season', s.name, 'status', cm.status::text, 'joined', cm.joined_at, 'agreed_on', cm.agreed_at,
               'agreement_version', cm.agreement_version, 'agreement_answers', cm.covenant, 'degree_of_compatibility', cm.degree,
               'released', cm.released_at, 'release_reason', cm.release_reason)
             order by cm.joined_at nulls last)
        from public.circle_members cm
        join public.circles c on c.id = cm.circle_id
        left join public.seasons s on s.id = cm.season_id
       where cm.person_id = uid), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('circle', c.name, 'week', a.week, 'status', a.status) order by c.name, a.week)
        from public.circle_attendance a join public.circles c on c.id = a.circle_id where a.person_id = uid), '[]'::jsonb),
    'weekly_check_ins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'circle', c.name, 'week', p.week, 'belonging', p.belonging, 'god', p.god, 'others', p.others, 'life', p.life,
               'note', p.note, 'at', p.created_at) order by c.name, p.week)
        from public.pulses p join public.circles c on c.id = p.circle_id where p.person_id = uid), '[]'::jsonb),
    'weekly_steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'circle', c.name, 'week', w.week, 'when', w.when_text, 'what', w.will_text, 'how_it_went', w.outcome,
               'reflection', w.reflection, 'checked', w.checked_at) order by c.name, w.week)
        from public.week_steps w join public.circles c on c.id = w.circle_id where w.person_id = uid), '[]'::jsonb),
    'days_in_the_word', coalesce((
      select jsonb_agg(jsonb_build_object('circle', c.name, 'week', h.week, 'days', h.days) order by c.name, h.week)
        from public.word_habit h join public.circles c on c.id = h.circle_id where h.person_id = uid), '[]'::jsonb),
    'testimonies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', t.week, 'testimony', t.body, 'share_with', t.share_with, 'credit', t.credit, 'status', t.status,
               'reply', t.decline_note, 'written', t.created_at) order by t.created_at)
        from public.testimonies t where t.person_id = uid), '[]'::jsonb),
    'circle_change_requests', coalesce((
      select jsonb_agg(jsonb_build_object('status', r.status, 'reason', r.reason, 'note', r.note, 'reply', r.decision_note, 'asked', r.created_at) order by r.created_at)
        from public.swap_requests r where r.person_id = uid), '[]'::jsonb),
    'matching', jsonb_build_object(
      'suggestions', coalesce((
        select jsonb_agg(jsonb_build_object('circle', c.name, 'rank', x.rank, 'degree_of_compatibility', x.degree, 'reasons', x.reasons, 'chosen', x.chosen) order by x.run_id, x.rank)
          from public.match_recommendations x join public.circles c on c.id = x.circle_id where x.person_id = uid), '[]'::jsonb),
      'times_asked', (select count(*) from public.match_runs r where r.person_id = uid)),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.template, 'channel', m.channel, 'status', m.status, 'created', m.created_at, 'sent', m.sent_at) order by m.created_at desc)
        from (select * from public.messages x where x.person_id = uid order by x.created_at desc limit 1000) m), '[]'::jsonb),
    'assistant_use', coalesce((
      select jsonb_agg(jsonb_build_object('field', a.field, 'provider', a.provider, 'model', a.model, 'at', a.at, 'fell_back_to_plain_options', a.fallback) order by a.at)
        from public.ai_calls a where a.person_id = uid), '[]'::jsonb),
    'photo', (select jsonb_build_object('held', true, 'updated', p.updated_at, 'type', p.mime) from public.person_photos p where p.person_id = uid),
    'leader_academy', jsonb_build_object(
      'modules', coalesce((
        select jsonb_agg(jsonb_build_object('module', mo.title, 'opened', pr.opened_at, 'attempts', pr.attempts, 'best_score', pr.best_score, 'passed', pr.passed_at) order by mo.number)
          from public.academy_progress pr join public.academy_modules mo on mo.id = pr.module_id where pr.person_id = uid), '[]'::jsonb),
      'quiz_attempts', coalesce((
        select jsonb_agg(jsonb_build_object('module', mo.title, 'at', q.at, 'score', q.score, 'answers', q.answers) order by q.at)
          from public.academy_attempts q join public.academy_modules mo on mo.id = q.module_id where q.person_id = uid), '[]'::jsonb),
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object('kind', s.kind::text, 'starts', s.starts_at, 'booked', b.booked_at, 'attended', b.attended) order by s.starts_at)
          from public.academy_bookings b join public.academy_sessions s on s.id = b.session_id where b.person_id = uid), '[]'::jsonb),
      'safeguarding_declarations', coalesce((
        select jsonb_agg(jsonb_build_object('wording_version', d.version, 'signed_as', d.signed_name, 'at', d.signed_at) order by d.signed_at)
          from public.safeguarding_declarations d where d.person_id = uid), '[]'::jsonb),
      'certified_as', coalesce((
        select jsonb_agg(jsonb_build_object('role', c.as_role::text, 'at', c.certified_at) order by c.certified_at)
          from public.leader_certifications c where c.person_id = uid), '[]'::jsonb)),
    'leader_application', (
      select jsonb_build_object('status', a.status::text, 'answers', a.answers, 'wording_version', a.consent_version, 'agreed', a.consented_at,
                                'submitted', a.submitted_at, 'decided', a.decided_at, 'note_with_the_decision', a.decision_note)
        from public.leader_applications a where a.person_id = uid order by a.created_at desc limit 1),
    'parent_or_guardian_permission', (
      select jsonb_build_object('name', g.guardian_name, 'relationship', g.relationship, 'status', g.status, 'asked', g.requested_at,
                                'answered', g.answered_at, 'wording_version', g.consent_version, 'their_note', g.guardian_note, 'confirmed_by_phone', g.verified_at)
        from public.guardian_consents g where g.person_id = uid),
    'held_by_the_church_team', jsonb_build_object(
      'care_records', (select count(*) from public.care_flags f where f.person_id = uid) + (select count(*) from public.care_tasks t where t.person_id = uid),
      'how_to_ask', 'These are notes other people wrote in the course of caring for you. Ask the data protection lead what is held and how to see it.')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Asking for erasure
-- ---------------------------------------------------------------------------

create function public.my_erasure_request()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('status', r.status, 'requested_at', r.requested_at, 'note', r.note, 'by_office', r.by_office,
                              'decided_at', r.decided_at, 'decision_note', r.decision_note)
      from public.erasure_requests r where r.person_id = uid);
end;
$$;

create function public.request_erasure(p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_centre uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_changed integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select p.centre_id into v_centre from public.people p where p.id = uid;
  if v_centre is null then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'Please keep your note under 600 characters' using errcode = '22023';
  end if;

  -- A second ask while one is waiting changes nothing; an ask after a "no" starts again.
  insert into public.erasure_requests as r (person_id, centre_id, note)
  values (uid, v_centre, v_note)
  on conflict (person_id) do update
     set status = 'open', note = excluded.note, by_office = false, requested_at = now(),
         decided_by = null, decided_at = null, decision_note = null
   where r.status = 'declined';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform public.write_event(uid, 'erasure.requested', 'person', uid::text, '{}'::jsonb);
  end if;
end;
$$;

create function public.withdraw_erasure_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_was text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  delete from public.erasure_requests r where r.person_id = uid returning r.status into v_was;
  if v_was = 'open' then
    perform public.write_event(uid, 'erasure.withdrawn', 'person', uid::text, '{}'::jsonb);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The office's side
-- ---------------------------------------------------------------------------

-- Why a person cannot be erased right now (empty when they can). Used by the queue and by erase_person itself.
create function public.erasure_blockers(p_person uuid, p_actor uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  out text[] := '{}';
begin
  if p_person = p_actor then
    out := array_append(out, 'is_you');
  end if;
  if exists (select 1 from public.circles c where c.leader_id = p_person) then
    out := array_append(out, 'leads_a_circle');
  end if;
  if exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('admin', 'director', 'pastor'))
     and not exists (select 1 from public.person_roles r where r.person_id = p_actor and r.role = 'admin') then
    out := array_append(out, 'needs_an_admin');
  end if;
  if exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'admin')
     and (select count(*) from public.person_roles r where r.role = 'admin') <= 1 then
    out := array_append(out, 'last_admin');
  end if;
  return out;
end;
$$;

create function public.erasure_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can see these requests' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'person', r.person_id,
             'name', public.person_display_name(r.person_id),
             'email', p.email,
             'status', r.status,
             'note', r.note,
             'by_office', r.by_office,
             'requested_at', r.requested_at,
             'decided_at', r.decided_at,
             'decision_note', r.decision_note,
             'roles', coalesce((select jsonb_agg(x.role::text order by x.role::text) from public.person_roles x where x.person_id = r.person_id and x.role <> 'member'), '[]'::jsonb),
             'in_circles', (select count(*) from public.circle_members cm where cm.person_id = r.person_id and cm.released_at is null),
             'care_records', (select count(*) from public.care_flags f where f.person_id = r.person_id) + (select count(*) from public.care_tasks t where t.person_id = r.person_id),
             'blockers', to_jsonb(public.erasure_blockers(r.person_id, uid)))
           order by (r.status = 'open') desc, r.requested_at)
      from public.erasure_requests r
      join public.people p on p.id = r.person_id
     where r.centre_id = public.my_centre()), '[]'::jsonb);
end;
$$;

-- The office writes down a request someone made another way (by email, or in person).
create function public.record_erasure_request(p_email text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_person uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_changed integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can record a request' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 600 then
    raise exception 'Please keep the note under 600 characters' using errcode = '22023';
  end if;
  select p.id into v_person from public.people p where lower(p.email) = v_email and p.centre_id = public.my_centre();
  if v_person is null then
    raise exception 'No one in this centre has signed in with that email address' using errcode = 'P0002';
  end if;

  insert into public.erasure_requests as r (person_id, centre_id, note, by_office)
  values (v_person, public.my_centre(), v_note, true)
  on conflict (person_id) do update
     set status = 'open', note = excluded.note, by_office = true, requested_at = now(),
         decided_by = null, decided_at = null, decision_note = null
   where r.status = 'declined';
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform public.write_event(uid, 'erasure.recorded', 'person', v_person::text, '{}'::jsonb);
  end if;
end;
$$;

create function public.decline_erasure(p_person uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_note text;
  v_changed integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can answer these requests' using errcode = '42501';
  end if;
  v_note := public.admin_text(p_note, 'The reason', 3, 600);

  update public.erasure_requests r
     set status = 'declined', decided_by = uid, decided_at = now(), decision_note = v_note
   where r.person_id = p_person and r.status = 'open' and r.centre_id = public.my_centre();
  get diagnostics v_changed = row_count;
  if v_changed = 0 then
    raise exception 'There is no open request from that person' using errcode = 'P0002';
  end if;
  perform public.write_event(uid, 'erasure.declined', 'person', p_person::text, '{}'::jsonb);
end;
$$;

create function public.erase_person(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_email text;
  v_request public.erasure_requests%rowtype;
  v_blockers text[];
  v_deleted integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can erase a person' using errcode = '42501';
  end if;

  -- Serialise, so two people cannot erase the last two admins at the same moment.
  perform pg_advisory_xact_lock(hashtext('united_tribes.last_admin'));

  select r.* into v_request from public.erasure_requests r
   where r.person_id = p_person and r.status = 'open' and r.centre_id = public.my_centre();
  if not found then
    raise exception 'There is no open request from that person. Ask them to make one from their profile, or record it first' using errcode = 'P0002';
  end if;

  v_blockers := public.erasure_blockers(p_person, uid);
  if 'is_you' = any (v_blockers) then
    raise exception 'You cannot erase your own account here. Ask another admin' using errcode = '22023';
  end if;
  if 'leads_a_circle' = any (v_blockers) then
    raise exception 'They lead a circle. Arrange another leader, or close the circle, before erasing them' using errcode = '22023';
  end if;
  if 'needs_an_admin' = any (v_blockers) then
    raise exception 'Only an admin can erase someone who holds the admin, director or pastor role' using errcode = '42501';
  end if;
  if 'last_admin' = any (v_blockers) then
    raise exception 'You cannot erase the last admin' using errcode = '23514';
  end if;

  select p.email into v_email from public.people p where p.id = p_person;

  -- What is written about the person but would otherwise stay behind with their name only removed.
  delete from public.celebrations c where c.person_id = p_person;
  delete from public.prayer_requests x where x.created_by = p_person;
  delete from public.invitations i where lower(i.email) = lower(v_email);
  delete from public.messages m where m.person_id is null and lower(m.to_email) = lower(v_email);
  -- Where they gave a reference for someone else, their name and contact go; the ratings stay with the applicant's file.
  update public.leader_references l set referee_name = 'Former referee', contact = 'erased' where lower(l.contact) = lower(v_email);

  -- The sign-in account. Everything that is about the person is deleted with it.
  delete from auth.users u where u.id = p_person;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'No such person' using errcode = 'P0002';
  end if;

  perform public.write_event(uid, 'person.erased', 'person', p_person::text, jsonb_build_object('asked_by_office', v_request.by_office));
  return jsonb_build_object('erased', true);
end;
$$;

revoke execute on function
  public.export_my_data(),
  public.my_erasure_request(),
  public.request_erasure(text),
  public.withdraw_erasure_request(),
  public.erasure_blockers(uuid, uuid),
  public.erasure_queue(),
  public.record_erasure_request(text, text),
  public.decline_erasure(uuid, text),
  public.erase_person(uuid)
from public, anon, authenticated;

grant execute on function
  public.export_my_data(),
  public.my_erasure_request(),
  public.request_erasure(text),
  public.withdraw_erasure_request(),
  public.erasure_queue(),
  public.record_erasure_request(text, text),
  public.decline_erasure(uuid, text),
  public.erase_person(uuid)
to authenticated;

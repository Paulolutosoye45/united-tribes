-- =============================================================================
-- United Tribes: a leader recommends an assistant leader; the office decides
--
-- A tribe has one assistant leader at most. Until now the review panel paired one (pair_assistant). This adds a second way in, beside it:
-- the leader names the person they would like, in a sentence, and an admin, a director, a pastor or God Mode decides. It changes no
-- existing function and no existing table. The way the panel pairs an assistant is exactly as it was.
--
--   assistant_recommendations   one row for each recommendation: who, for which tribe, what the leader said, what the office decided
--
-- The rules every function below follows:
--   * one open recommendation for a tribe at a time, and one assistant for a tribe: Replace is one step, never a gap with no assistant
--   * a tribe with young members (or a teens tribe) is decided by a pastor, a director or God Mode: not by the admin alone
--   * a person under 18 is never an assistant, and is never sent anything from here
--   * someone who is not yet an approved assistant leader is invited to apply; when they are approved the heartbeat pairs them
--   * the leader is told the outcome in a line. The reason an application was or was not approved stays with the office
--   * emails come from the church office. Nothing here names the owner
-- =============================================================================

create table public.assistant_recommendations (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  recommended_by uuid references public.people (id) on delete set null,
  -- The person named: by account when they have one, by address when they do not yet
  nominee_id uuid references public.people (id) on delete set null,
  nominee_email text check (nominee_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(nominee_email) <= 254),
  -- The leader's own words. Not a place for anything private about the person.
  reason text check (char_length(reason) <= 400),
  -- requested: waiting for the office. invited: approved, and the person has been invited to apply as an assistant leader; the heartbeat pairs
  -- them when they are approved. paired: they are the tribe's assistant. declined / withdrawn / expired / replaced: final.
  status text not null default 'requested' check (status in ('requested', 'invited', 'paired', 'declined', 'withdrawn', 'expired', 'replaced')),
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 300),
  -- The office chose Replace: when this person is approved as an assistant leader they take the place of the one the tribe has
  replace_existing boolean not null default false,
  paired_at timestamptz,
  created_at timestamptz not null default now(),
  check (nominee_id is not null or nominee_email is not null)
);
-- One open recommendation for a tribe at a time
create unique index assistant_recommendations_one_open on public.assistant_recommendations (tribe_id) where status in ('requested', 'invited');
create index assistant_recommendations_status_idx on public.assistant_recommendations (status, created_at);
alter table public.assistant_recommendations enable row level security;
-- No grants: only the functions touch this table.

-- Does a tribe have young members? Then a pastor or a director decides.
create function public.assistant_tribe_young(p_tribe uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tribes t join public.tracks k on k.id = t.track_id where t.id = p_tribe and k.slug = 'teens')
      or exists (select 1 from public.tribe_members m where m.tribe_id = p_tribe and m.status = 'active' and public.is_minor(m.person_id));
$$;

-- May the person asking decide for this tribe? An admin, a director or a pastor; for a tribe with young members only a pastor or a
-- director. God Mode may decide any.
create function public.assistant_can_decide(p_tribe uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.is_god() then
    return true;
  end if;
  if public.assistant_tribe_young(p_tribe) then
    return public.has_any_role(array['pastor', 'director']::public.app_role[]);
  end if;
  return public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]);
end;
$$;

-- ---------------------------------------------------------------------------
-- The leader
-- ---------------------------------------------------------------------------

-- Recommend someone as the tribe's assistant leader: by account (a member of the tribe, say) or by email address
create function public.assistant_recommend(p_tribe uuid, p_person uuid default null, p_email text default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.tribes%rowtype;
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_person uuid := p_person;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid := gen_random_uuid();
  v_young boolean;
  v_centre uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  if not found or c.leader_id is distinct from me then
    raise exception 'Only the leader of a tribe can recommend an assistant for it' using errcode = '42501';
  end if;
  if c.status = 'closed' then
    raise exception 'This tribe is closed' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 400 then
    raise exception 'Keep it under 400 characters' using errcode = '22023';
  end if;
  if v_person is null and v_email is null then
    raise exception 'Name the person, by choosing them or giving their email address' using errcode = '22023';
  end if;
  if v_person is null then
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
      raise exception 'That does not look like an email address' using errcode = '22023';
    end if;
    select p.id into v_person from public.people p where lower(p.email) = v_email and not p.hidden;
  end if;
  if v_person is not null then
    if v_person = me then
      raise exception 'You lead this tribe, so you cannot be its assistant' using errcode = '22023';
    end if;
    if v_person is not distinct from c.assistant_id then
      raise exception 'They are already your assistant' using errcode = '22023';
    end if;
    if not exists (select 1 from public.people p where p.id = v_person and not p.hidden)
       or exists (select 1 from public.platform_owner w where w.person_id = v_person) then
      raise exception 'No such person' using errcode = 'P0002';
    end if;
    if public.is_minor(v_person) then
      raise exception 'An assistant leader must be 18 or older' using errcode = '22023';
    end if;
    select p.email into v_email from public.people p where p.id = v_person;
  end if;
  begin
    insert into public.assistant_recommendations (id, tribe_id, recommended_by, nominee_id, nominee_email, reason)
    values (v_id, p_tribe, me, v_person, lower(v_email), v_reason);
  exception when unique_violation then
    raise exception 'You already have a recommendation waiting. Withdraw it first to change it' using errcode = '22023';
  end;

  v_young := public.assistant_tribe_young(p_tribe);
  select p.centre_id into v_centre from public.people p where p.id = me;
  -- The office hears of it in its own notices (a group that is switched off stays quiet; the page below always lists it)
  perform public.notify_role(v_centre, case when v_young then array['pastor', 'director'] else array['admin', 'director', 'pastor'] end,
    'office_assistant_recommended', 'assistantrec:' || v_id,
    jsonb_build_object('tribe', c.name, 'leader_first', public.first_name_of(me), 'young', v_young),
    'Assistant leader recommended for ' || coalesce(c.name, 'a tribe'), '/admin/assistants');
  perform public.write_event(me, 'assistant.recommended', 'tribe', p_tribe::text, jsonb_build_object('recommendation', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create function public.assistant_withdraw(p_rec uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.assistant_recommendations%rowtype;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into r from public.assistant_recommendations x where x.id = p_rec for update;
  if not found or r.recommended_by is distinct from me then
    raise exception 'No such recommendation' using errcode = 'P0002';
  end if;
  if r.status not in ('requested', 'invited') then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;
  update public.assistant_recommendations set status = 'withdrawn' where id = p_rec;
  perform public.write_event(me, 'assistant.withdrawn', 'tribe', r.tribe_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end;
$$;

-- What the leader sees on their tribe page: the assistant they have, the recommendation waiting, and the last answer
create function public.assistant_my_state(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.tribes%rowtype;
  o public.assistant_recommendations%rowtype;
  l public.assistant_recommendations%rowtype;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  if not found or c.leader_id is distinct from me then
    raise exception 'Only the leader of a tribe can see this' using errcode = '42501';
  end if;
  select * into o from public.assistant_recommendations x where x.tribe_id = p_tribe and x.status in ('requested', 'invited');
  select * into l from public.assistant_recommendations x where x.tribe_id = p_tribe and x.status in ('declined', 'expired', 'paired', 'replaced')
    order by x.decided_at desc nulls last, x.created_at desc limit 1;
  return jsonb_build_object(
    'assistant', case when c.assistant_id is not null then jsonb_build_object('name', public.person_display_name(c.assistant_id)) end,
    'open', case when o.id is not null then jsonb_build_object(
        'id', o.id, 'status', o.status, 'name', coalesce(case when o.nominee_id is not null then public.person_display_name(o.nominee_id) end, o.nominee_email),
        'since', o.created_at) end,
    'last', case when l.id is not null then jsonb_build_object(
        'status', l.status, 'name', coalesce(case when l.nominee_id is not null then public.person_display_name(l.nominee_id) end, l.nominee_email),
        'at', l.decided_at) end,
    'closed', c.status = 'closed');
end;
$$;

-- ---------------------------------------------------------------------------
-- The office
-- ---------------------------------------------------------------------------

-- Pairing, one step: the tribe's assistant becomes this person, whoever it was. Returns the person it replaced, if there was one.
create function public.assistant_apply_pair(p_rec uuid, p_replace boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.assistant_recommendations%rowtype;
  c public.tribes%rowtype;
  v_old uuid;
begin
  select * into r from public.assistant_recommendations x where x.id = p_rec for update;
  select * into c from public.tribes x where x.id = r.tribe_id for update;
  if c.status = 'closed' then
    raise exception 'This tribe is closed' using errcode = '22023';
  end if;
  if r.nominee_id is null or not exists (select 1 from public.person_roles pr where pr.person_id = r.nominee_id and pr.role = 'assistant_leader') then
    raise exception 'That person is not an approved assistant leader yet' using errcode = '22023';
  end if;
  if public.is_minor(r.nominee_id) then
    raise exception 'An assistant leader must be 18 or older' using errcode = '22023';
  end if;
  if r.nominee_id = c.leader_id then
    raise exception 'A leader cannot be their own assistant' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes o where o.assistant_id = r.nominee_id and o.season_id = c.season_id and o.status <> 'closed' and o.id <> c.id) then
    raise exception 'That person is already the assistant of another tribe this season' using errcode = '22023';
  end if;
  v_old := c.assistant_id;
  if v_old is not null and v_old is distinct from r.nominee_id and not p_replace then
    raise exception 'This tribe already has an assistant leader. Choose Replace to change them' using errcode = '22023';
  end if;
  update public.tribes set assistant_id = r.nominee_id where id = c.id;
  update public.assistant_recommendations set status = 'paired', paired_at = now() where id = r.id;
  -- Whoever the recommendation replaced is no longer shown as the tribe's assistant
  update public.assistant_recommendations set status = 'replaced'
   where tribe_id = c.id and status = 'paired' and id <> r.id;
  perform public.write_event(auth.uid(), 'tribe.assistant_paired', 'tribe', c.id::text, jsonb_build_object('assistant', r.nominee_id, 'recommendation', r.id));
  return case when v_old is distinct from r.nominee_id then v_old end;
end;
$$;

-- The requests for the office to decide, and the last few answered
create function public.assistant_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not (public.is_god() or public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[])) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open', coalesce((
      select jsonb_agg(public.assistant_row(r.id) order by r.created_at)
        from public.assistant_recommendations r where r.status in ('requested', 'invited')), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(public.assistant_row(z.id) order by z.at desc)
        from (select r.id, coalesce(r.decided_at, r.created_at) as at from public.assistant_recommendations r
               where r.status not in ('requested', 'invited') order by coalesce(r.decided_at, r.created_at) desc limit 15) z), '[]'::jsonb));
end;
$$;

-- One row of that list
create function public.assistant_row(p_rec uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.assistant_recommendations%rowtype;
  c public.tribes%rowtype;
begin
  select * into r from public.assistant_recommendations x where x.id = p_rec;
  select * into c from public.tribes x where x.id = r.tribe_id;
  return jsonb_build_object(
    'id', r.id, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at, 'note', r.decision_note, 'reason', r.reason,
    'tribe', jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'leader', public.person_display_name(c.leader_id),
                                'assistant', case when c.assistant_id is not null then public.person_display_name(c.assistant_id) end),
    'young', public.assistant_tribe_young(c.id),
    'can_decide', public.assistant_can_decide(c.id),
    'nominee', jsonb_build_object(
      'name', case when r.nominee_id is not null then public.person_display_name(r.nominee_id) end,
      'email', coalesce(r.nominee_email, (select p.email from public.people p where p.id = r.nominee_id)),
      'has_account', r.nominee_id is not null or exists (select 1 from public.people p where lower(p.email) = r.nominee_email),
      'is_assistant', exists (select 1 from public.person_roles pr where pr.person_id = r.nominee_id and pr.role = 'assistant_leader'),
      'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = r.nominee_id and lc.as_role = 'assistant_leader'),
      'paired_elsewhere', exists (select 1 from public.tribes o where o.assistant_id = r.nominee_id and o.season_id = c.season_id and o.status <> 'closed' and o.id <> c.id)));
end;
$$;

-- Decide. Approving pairs the person at once if they are an approved assistant leader; if they are not, they are invited to apply and
-- paired when they are approved. If the tribe already has an assistant, Replace must be chosen: the change is one step.
create function public.assistant_decide(p_rec uuid, p_approve boolean, p_note text default null, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.assistant_recommendations%rowtype;
  c public.tribes%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hidden boolean;
  v_old uuid;
  v_nominee uuid;
  v_status text;
  v_msg text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Say approve or decline' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  select * into r from public.assistant_recommendations x where x.id = p_rec for update;
  if not found then
    raise exception 'No such recommendation' using errcode = 'P0002';
  end if;
  select * into c from public.tribes x where x.id = r.tribe_id;
  if not public.assistant_can_decide(r.tribe_id) then
    v_msg := case when public.assistant_tribe_young(r.tribe_id) and public.has_any_role(array['admin']::public.app_role[])
                  then 'This tribe has young members, so a pastor or a director decides' else 'Only the office can decide this' end;
    raise exception '%', v_msg using errcode = '42501';
  end if;
  if r.status not in ('requested') then
    return jsonb_build_object('ok', true, 'already', true, 'status', r.status);
  end if;
  select coalesce(p.hidden, false) into v_hidden from public.people p where p.id = me;

  if not p_approve then
    update public.assistant_recommendations set status = 'declined', decided_by = case when v_hidden then null else me end, decided_at = now(), decision_note = v_note where id = r.id;
    perform public.enqueue_message(c.leader_id, 'assistant_decided', jsonb_build_object('tribe', c.name, 'outcome', 'declined'), c.id, 'assistant-decided:' || r.id, p_force => 'email');
    perform public.write_event(me, 'assistant.declined', 'tribe', c.id::text, jsonb_build_object('recommendation', r.id));
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  v_nominee := coalesce(r.nominee_id, (select p.id from public.people p where lower(p.email) = r.nominee_email and not p.hidden));
  if v_nominee is not null and r.nominee_id is null then
    update public.assistant_recommendations set nominee_id = v_nominee where id = r.id;
  end if;
  if c.assistant_id is not null and c.assistant_id is distinct from v_nominee and not coalesce(p_replace, false) then
    raise exception 'This tribe already has an assistant leader. Choose Replace to change them' using errcode = '22023';
  end if;
  if v_nominee is not null and public.is_minor(v_nominee) then
    raise exception 'An assistant leader must be 18 or older' using errcode = '22023';
  end if;

  update public.assistant_recommendations set decided_by = case when v_hidden then null else me end, decided_at = now(), decision_note = v_note where id = r.id;
  if v_nominee is not null and exists (select 1 from public.person_roles pr where pr.person_id = v_nominee and pr.role = 'assistant_leader') then
    v_old := public.assistant_apply_pair(r.id, coalesce(p_replace, false));
    v_status := 'paired';
    perform public.enqueue_message(v_nominee, 'assistant_paired', jsonb_build_object('tribe', c.name, 'leader_first', public.first_name_of(c.leader_id)), c.id, 'assistant-paired:' || r.id, p_force => 'email');
    perform public.enqueue_message(c.leader_id, 'assistant_decided', jsonb_build_object('tribe', c.name, 'outcome', 'approved', 'assistant_first', public.first_name_of(v_nominee)), c.id, 'assistant-decided:' || r.id, p_force => 'email');
    if v_old is not null then
      perform public.enqueue_message(v_old, 'assistant_replaced', jsonb_build_object('tribe', c.name), c.id, 'assistant-replaced:' || r.id, p_force => 'email');
    end if;
  else
    -- Not an approved assistant leader yet: invited to apply. The heartbeat pairs them when they are approved.
    update public.assistant_recommendations set status = 'invited', replace_existing = coalesce(p_replace, false) and c.assistant_id is not null where id = r.id;
    v_status := 'invited';
    if v_nominee is not null then
      perform public.enqueue_message(v_nominee, 'assistant_invited', jsonb_build_object('tribe', c.name, 'leader_first', public.first_name_of(c.leader_id)), c.id, 'assistant-invited:' || r.id, p_force => 'email');
    elsif not exists (select 1 from public.people p where lower(p.email) = r.nominee_email and p.hidden)
          and not exists (select 1 from public.platform_owner w join public.people p on p.id = w.person_id where lower(p.email) = r.nominee_email) then
      -- (An address that belongs to the hidden owner is treated like any other address nobody can pair: nothing is sent to it)
      perform public.enqueue_message(null, 'assistant_invited', jsonb_build_object('tribe', c.name, 'leader_first', public.first_name_of(c.leader_id)), c.id,
                                     'assistant-invited:' || r.id, null, 'normal', 'email', r.nominee_email, null, null);
    end if;
    perform public.enqueue_message(c.leader_id, 'assistant_decided', jsonb_build_object('tribe', c.name, 'outcome', 'invited'), c.id, 'assistant-decided:' || r.id, p_force => 'email');
  end if;
  perform public.write_event(me, 'assistant.approved', 'tribe', c.id::text, jsonb_build_object('recommendation', r.id, 'status', v_status));
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- The heartbeat: pairs an invited person once they are an approved assistant leader, and closes an invitation nobody took up in 60 days
create function public.assistant_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.assistant_recommendations%rowtype;
  c public.tribes%rowtype;
  v_nominee uuid;
  v_paired integer := 0;
  v_expired integer := 0;
  v_old uuid;
begin
  for r in select x.* from public.assistant_recommendations x where x.status = 'invited' order by x.created_at for update skip locked loop
    select * into c from public.tribes x where x.id = r.tribe_id;
    v_old := null;
    v_nominee := coalesce(r.nominee_id, (select p.id from public.people p where lower(p.email) = r.nominee_email and not p.hidden));
    if v_nominee is not null and r.nominee_id is null then
      update public.assistant_recommendations set nominee_id = v_nominee where id = r.id;
    end if;
    if c.status = 'closed' or r.created_at < now() - interval '60 days' then
      update public.assistant_recommendations set status = 'expired', decided_at = coalesce(decided_at, now()) where id = r.id;
      perform public.enqueue_message(c.leader_id, 'assistant_decided', jsonb_build_object('tribe', c.name, 'outcome', 'expired'), c.id, 'assistant-expired:' || r.id, p_force => 'email');
      v_expired := v_expired + 1;
    elsif v_nominee is not null and exists (select 1 from public.person_roles pr where pr.person_id = v_nominee and pr.role = 'assistant_leader')
          and (c.assistant_id is null or r.replace_existing) then
      begin
        v_old := public.assistant_apply_pair(r.id, r.replace_existing);
        perform public.enqueue_message(v_nominee, 'assistant_paired', jsonb_build_object('tribe', c.name, 'leader_first', public.first_name_of(c.leader_id)), c.id, 'assistant-paired:' || r.id, p_force => 'email');
        perform public.enqueue_message(c.leader_id, 'assistant_decided', jsonb_build_object('tribe', c.name, 'outcome', 'approved', 'assistant_first', public.first_name_of(v_nominee)), c.id, 'assistant-paired-leader:' || r.id, p_force => 'email');
        if v_old is not null then
          perform public.enqueue_message(v_old, 'assistant_replaced', jsonb_build_object('tribe', c.name), c.id, 'assistant-replaced:' || r.id, p_force => 'email');
        end if;
        v_paired := v_paired + 1;
      exception when others then
        -- Something stops the pairing (they are already paired elsewhere, say). It is tried again next time, until the invitation expires.
        null;
      end;
    end if;
  end loop;
  return jsonb_build_object('paired', v_paired, 'expired', v_expired);
end;
$$;

create function public.worker_assistant_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.assistant_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.assistant_tribe_young(uuid), public.assistant_can_decide(uuid), public.assistant_recommend(uuid, uuid, text, text),
  public.assistant_withdraw(uuid), public.assistant_my_state(uuid), public.assistant_apply_pair(uuid, boolean),
  public.assistant_requests(), public.assistant_row(uuid), public.assistant_decide(uuid, boolean, text, boolean),
  public.assistant_tick(), public.worker_assistant_tick(text)
  from public, anon, authenticated;

-- A leader, on their own tribe
grant execute on function
  public.assistant_recommend(uuid, uuid, text, text), public.assistant_withdraw(uuid), public.assistant_my_state(uuid)
  to authenticated;
-- The office (each checks the caller's role itself)
grant execute on function public.assistant_requests(), public.assistant_decide(uuid, boolean, text, boolean) to authenticated;
-- The sending service has no account; the token is the credential.
grant execute on function public.worker_assistant_tick(text) to anon;

-- Remove a member from a tribe, from Admin, with a way back.
--
-- Until now only a leader could ask the church to change a member's place (the Leader removal requests), and a Care Lead, director or admin decided.
-- The office had no button of its own. This change gives an admin, a director or the owner one:
--   * Remove, beside each member on a tribe's page in Admin (and on the person's page). It needs a reason of 10 to 300 characters that only the office
--     reads: the member and the leader are never shown it, and the event log keeps no note. The reason is cleared after 12 months.
--   * The member goes back to the pile of people waiting to be placed. Their seat is released, the match is looked at afresh the next time they open
--     the page, and no automatic run places them for three days so they can choose for themselves first. The office can place them by hand at once.
--     The tribe they were taken out of is never offered to them again unless the office puts them back.
--   * The member is told kindly, by email, with other tribes and a person to talk to (the same words as a leader's request, without a time to appeal).
--     The leader is told by first name that the church has taken the place, with the reminder to take them out of any WhatsApp group they keep.
--   * Put back: within 14 days any admin, director or the owner can undo it if the tribe is open and has room and the person has not joined another.
--   * A young person, or someone with an open care matter in that tribe, is never removed from here: it is left to the Care Lead's own route.
--     Nobody removes themselves here. An admin or a director removes 20 people a day at most; the owner is not held to that.
-- No new switch: the office can always do this. The Leader removal requests switch, its 14 days to appeal and its limits are unchanged.
begin;

-- ---------------------------------------------------------------------------
-- What the office did, and why (the reason is for the office only)
-- ---------------------------------------------------------------------------
create table public.admin_removals (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references public.tribe_members (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  removed_by uuid references public.people (id) on delete set null,
  removed_role text not null check (removed_role in ('owner', 'admin', 'director')),
  reason text,
  reason_cleared_at timestamptz,
  member_told boolean not null default false,
  created_at timestamptz not null default now(),
  put_back_at timestamptz,
  put_back_by uuid references public.people (id) on delete set null,
  check (reason_cleared_at is not null or (reason is not null and char_length(reason) between 10 and 300))
);
create index admin_removals_tribe_idx on public.admin_removals (tribe_id, created_at desc);
create index admin_removals_person_idx on public.admin_removals (person_id, created_at desc);
create index admin_removals_by_idx on public.admin_removals (removed_by, created_at desc);
alter table public.admin_removals enable row level security;
revoke all on table public.admin_removals from public, anon, authenticated;

-- A tribe the church has taken a member out of stays blocked, whichever way it was done: by a request or by the office
alter table public.removal_blocks drop constraint removal_blocks_pkey;
alter table public.removal_blocks alter column request_id drop not null;
-- (Not a foreign key, so that the way back can drop the office's table and leave this column as every earlier change leaves its columns; a block row is
-- deleted with its person or tribe, as the office's own row is.)
alter table public.removal_blocks add column admin_removal_id uuid;
create unique index removal_blocks_request_uidx on public.removal_blocks (request_id);
create unique index removal_blocks_admin_uidx on public.removal_blocks (admin_removal_id) where admin_removal_id is not null;
alter table public.removal_blocks add constraint removal_blocks_one_source check ((request_id is null) <> (admin_removal_id is null));

-- ---------------------------------------------------------------------------
-- Remove
-- ---------------------------------------------------------------------------
create function public.admin_remove_member(p_tribe uuid, p_person uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.placement_gate();
  uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  seat public.tribe_members%rowtype;
  v_id uuid := gen_random_uuid();
  v_until timestamptz := now() + interval '3 days';
  v_told boolean;
begin
  -- One person is changed by one hand at a time: the second of two clicks finds the first one's work
  perform pg_advisory_xact_lock(hashtextextended('placement-one:' || p_person::text, 0));
  if char_length(v_reason) < 10 or char_length(v_reason) > 300 then
    raise exception 'Write a reason of 10 to 300 characters. Only the church''s office will read it' using errcode = '22023';
  end if;
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'No such tribe' using errcode = 'P0002';
  end if;
  select * into se from public.seasons x where x.id = t.season_id;
  if p_person = uid then
    raise exception 'You cannot take yourself out of a tribe here' using errcode = '22023';
  end if;
  select * into seat from public.tribe_members m
   where m.tribe_id = p_tribe and m.person_id = p_person and m.status = 'active' for update;
  if not found then
    raise exception 'They are not in this tribe any more' using errcode = '22023';
  end if;
  if se.status = 'closed' then
    raise exception 'This season is closed, so nobody can be taken out of its tribes' using errcode = '22023';
  end if;
  if coalesce(public.removal_is_restricted(p_person, p_tribe, ''), false) then
    raise exception 'This place can be changed only through the Care Lead. Ask them to look at it' using errcode = '22023';
  end if;
  if v_role <> 'owner'
     and (select count(*) from public.admin_removals x
           where x.removed_by = uid and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos()) >= 20 then
    raise exception 'You have taken 20 people out of tribes today, which is the most one person may in a day. Ask the owner to do the rest' using errcode = '22023';
  end if;

  insert into public.admin_removals (id, seat_id, tribe_id, person_id, removed_by, removed_role, reason)
  values (v_id, seat.id, p_tribe, p_person, uid, v_role, v_reason);

  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Removed by the church' where id = seat.id;
  insert into public.removal_blocks (admin_removal_id, person_id, tribe_id, season_id) values (v_id, p_person, p_tribe, seat.season_id);
  -- Their tribes are looked at afresh the next time they open the page, without the one they were taken out of
  update public.match_recommendations set chosen = false where person_id = p_person and tribe_id = p_tribe;
  delete from public.match_runs where person_id = p_person;
  -- Back in the pile, and left alone by the automatic runs for three days. A hold the owner put there stays the owner's.
  insert into public.placement_holds (person_id, note, until, source, request_id)
  values (p_person, null, v_until, 'removal', v_id)
  on conflict (person_id) do update
     set note = null, until = excluded.until, source = excluded.source, request_id = excluded.request_id, created_at = now()
   where public.placement_holds.source <> 'owner';

  v_told := not public.is_minor(p_person);
  if v_told then
    perform public.enqueue_message(p_person, 'removal_member_told',
      jsonb_build_object('tribe', t.name, 'contact_first', public.removal_contact_first(), 'appeal_days', 0),
      p_tribe, 'adminremoval:' || v_id || ':member', null, 'normal', 'email');
  end if;
  update public.admin_removals set member_told = v_told where id = v_id;
  if t.leader_id is not null then
    perform public.enqueue_message(t.leader_id, 'removal_leader_decided',
      jsonb_build_object('decision', 'removed', 'member_first', public.first_name_of(p_person), 'tribe', t.name),
      p_tribe, 'adminremoval:' || v_id || ':leader', null, 'normal', 'email');
  end if;
  perform public.write_event(uid, 'removal.admin', 'admin_removal', v_id::text, jsonb_build_object('role', v_role));
  return jsonb_build_object('ok', true, 'removal', v_id, 'name', public.person_display_name(p_person), 'until', v_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- Put back
-- ---------------------------------------------------------------------------
create function public.admin_put_back(p_removal uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.placement_gate();
  uid uuid := auth.uid();
  r public.admin_removals%rowtype;
  t public.tribes%rowtype;
  seat public.tribe_members%rowtype;
begin
  select * into r from public.admin_removals where id = p_removal;
  if not found then
    raise exception 'That removal does not exist' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('placement-one:' || r.person_id::text, 0));
  select * into r from public.admin_removals where id = p_removal for update;
  if r.put_back_at is not null then
    raise exception 'Their place has been put back already' using errcode = '22023';
  end if;
  if r.created_at < now() - interval '14 days' then
    raise exception 'It is more than 14 days since they were taken out. Place them again instead' using errcode = '22023';
  end if;
  select * into t from public.tribes where id = r.tribe_id;
  select * into seat from public.tribe_members where id = r.seat_id for update;
  if t.status <> 'approved' then
    raise exception 'That tribe is not open any more' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribe_members m where m.person_id = r.person_id and m.season_id = seat.season_id and m.status = 'active') then
    raise exception 'They have joined another tribe since. Their place there would have to change first' using errcode = '22023';
  end if;
  if (select count(*) from public.tribe_members m where m.tribe_id = r.tribe_id and m.status = 'active') >= t.capacity then
    raise exception 'The tribe is full. A place has to be free first' using errcode = '22023';
  end if;
  update public.tribe_members set status = 'active', released_at = null, release_reason = null where id = seat.id;
  update public.removal_blocks set lifted_at = now() where admin_removal_id = r.id;
  delete from public.placement_holds where request_id = r.id;
  update public.admin_removals set put_back_at = now(), put_back_by = uid where id = r.id;
  if not public.is_minor(r.person_id) then
    perform public.enqueue_message(r.person_id, 'removal_member_reinstated', jsonb_build_object('tribe', t.name),
      r.tribe_id, 'adminremoval:' || r.id || ':back:member', null, 'normal', 'email');
  end if;
  if t.leader_id is not null then
    perform public.enqueue_message(t.leader_id, 'removal_leader_decided',
      jsonb_build_object('decision', 'reinstated', 'member_first', public.first_name_of(r.person_id), 'tribe', t.name),
      r.tribe_id, 'adminremoval:' || r.id || ':back:leader', null, 'normal', 'email');
  end if;
  perform public.write_event(uid, 'removal.admin_put_back', 'admin_removal', r.id::text, jsonb_build_object('role', v_role));
  return jsonb_build_object('ok', true, 'name', public.person_display_name(r.person_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- What the pages read
-- ---------------------------------------------------------------------------
-- The removals of one tribe or one person in the last 30 days, with the office's own words
create function public.admin_removal_lately(p_tribe uuid, p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'person', r.person_id, 'tribe', r.tribe_id, 'tribe_name', tt.name,
           'name', public.person_display_name(r.person_id), 'at', r.created_at,
           'by', case when r.removed_by is null then null else public.person_display_name(r.removed_by) end,
           'reason', r.reason, 'put_back_at', r.put_back_at,
           'can_put_back', r.put_back_at is null and r.created_at > now() - interval '14 days') order by r.created_at desc), '[]'::jsonb)
    from public.admin_removals r join public.tribes tt on tt.id = r.tribe_id
   where r.created_at > now() - interval '30 days'
     and (p_tribe is null or r.tribe_id = p_tribe) and (p_person is null or r.person_id = p_person);
$$;

-- A tribe's members, for the Members list on the tribe page
create function public.admin_tribe_members(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.placement_gate();
  uid uuid := auth.uid();
begin
  if not exists (select 1 from public.tribes x where x.id = p_tribe) then
    raise exception 'No such tribe' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'role', v_role,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person', m.person_id, 'name', public.person_display_name(m.person_id), 'since', m.joined_at,
               'said_yes', public.seat_said_yes(m.placement_source, m.confirmed_at),
               'self', m.person_id = uid,
               'care_only', coalesce(public.removal_is_restricted(m.person_id, p_tribe, ''), false))
             order by public.person_display_name(m.person_id), m.id)
        from public.tribe_members m
       where m.tribe_id = p_tribe and m.status = 'active'), '[]'::jsonb),
    'lately', public.admin_removal_lately(p_tribe, null));
end;
$$;

-- One person, for their page: whether the Remove button is for them, and what the office did lately
create function public.admin_removal_person(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.placement_gate();
  uid uuid := auth.uid();
  m public.tribe_members%rowtype;
begin
  select * into m from public.tribe_members x
   where x.person_id = p_person and x.status = 'active' order by x.joined_at desc limit 1;
  return jsonb_build_object(
    'role', v_role,
    'seat', case when m.id is null then null else jsonb_build_object(
              'tribe', m.tribe_id, 'name', (select tt.name from public.tribes tt where tt.id = m.tribe_id),
              'self', p_person = uid,
              'care_only', coalesce(public.removal_is_restricted(p_person, m.tribe_id, ''), false)) end,
    'lately', public.admin_removal_lately(null, p_person));
end;
$$;

-- ---------------------------------------------------------------------------
-- The reason is kept for 12 months, like a leader's words in a request
-- ---------------------------------------------------------------------------
create function public.admin_removal_tidy()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.admin_removals set reason = null, reason_cleared_at = now()
   where reason_cleared_at is null and created_at < now() - interval '12 months';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.worker_removal_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  perform public.admin_removal_tidy();
  return public.removal_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function public.admin_remove_member(uuid, uuid, text), public.admin_put_back(uuid), public.admin_removal_lately(uuid, uuid),
  public.admin_tribe_members(uuid), public.admin_removal_person(uuid), public.admin_removal_tidy() from public, anon, authenticated;
grant execute on function public.admin_remove_member(uuid, uuid, text), public.admin_put_back(uuid),
  public.admin_tribe_members(uuid), public.admin_removal_person(uuid) to authenticated;

commit;

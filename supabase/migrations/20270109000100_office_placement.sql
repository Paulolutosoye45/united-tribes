-- Place or move one person from Admin (the owner's own tool, opened to admins and directors).
--
-- An admin or a director can place a member who holds no seat, or move one who does, from the person's page or from a tribe's page. It is the
-- owner's Place-one tool with a different front door: the same checks, the same placement (the church's own, one person at a time), the same emails,
-- the same Undo until the tribe's leader has been told. Of the warnings, an admin or a director may accept only "Joining has closed", "They have not
-- agreed to matching" (with a tick that they told you so, kept with who and when) and a hold the church put there after a removal; everything else
-- (a fit below the bar, a full tribe, a different age group, no form or score, a form for another season, a hold the owner put there) they ask the
-- owner for, and the owner answers within 7 days with every check run again. A blocker (a leader, under 18, a closed season, a tribe the church took
-- them out of, a bounce) is refused for everyone. A person is placed by one hand at a time; an admin or a director places 30 people a day at most.
-- A move gives up the old seat by the routine of a swap, tells the old leader, and is undone by putting the old seat back.
begin;

alter table public.placement_runs
  add column if not exists placed_by uuid references public.people (id) on delete set null,
  add column if not exists placed_role text check (placed_role in ('owner', 'admin', 'director')),
  add column if not exists placed_via text check (placed_via in ('owner', 'office')),
  add column if not exists approved_by uuid references public.people (id) on delete set null,
  add column if not exists moved_from uuid,
  add column if not exists moved_from_seat uuid,
  add column if not exists held_before jsonb;

CREATE OR REPLACE FUNCTION public.placement_check_core(p_person uuid, p_tribe uuid, p_move boolean, p_role text, p_placer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hold_source text;
  v_hold_until timestamptz;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  pe public.people%rowtype;
  v_mp_season uuid;
  v_mp_age uuid;
  c record;
  v_block jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_floor integer := public.placement_floor();
  v_active integer;
  v_blocker text;
  v_profile boolean;
  v_degree integer;
  v_seat text;
  v_seat_tribe uuid;
  v_track uuid;
  v_win jsonb;
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'No such tribe' using errcode = 'P0002';
  end if;
  select * into pe from public.people x where x.id = p_person;
  if not found then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  select * into se from public.seasons x where x.id = t.season_id;
  v_win := public.season_joining_window(se.id);
  select x.season_id, x.age_range_id into v_mp_season, v_mp_age from public.member_profiles x where x.person_id = p_person;
  v_profile := found;
  select count(*)::integer into v_active from public.tribe_members m where m.tribe_id = t.id and m.status = 'active';

  -- Blockers: nothing the owner ticks changes these
  if pe.hidden or not exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'member')
     or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'not_member', 'text', 'This person is not a member who can join a tribe'));
  end if;
  if exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader')) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'leader', 'text', 'They lead or assist a tribe, so they cannot join one as a member'));
  end if;
  if public.is_minor(p_person) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'under18', 'text', 'They are under 18. Tribes for young people are never filled from here'));
  end if;
  v_blocker := public.message_blocker(p_person);
  if v_blocker = 'deletion' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'deletion_open', 'text', 'They have asked for their account to be deleted'));
  elsif v_blocker is not null and v_blocker <> 'under18' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'cannot_email', 'text', 'They cannot be emailed (the address bounces or they asked us to stop), so they could not be told'));
  end if;
  if se.status = 'closed' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'season_closed', 'text', 'This season is closed'));
  end if;
  if t.status <> 'approved' or not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'tribe_closed', 'text', 'This tribe is not open: it is not approved, or its leader is not certified'));
  end if;
  select tt.name, tt.id into v_seat, v_seat_tribe from public.tribe_members m join public.tribes tt on tt.id = m.tribe_id
   where m.person_id = p_person and m.season_id = t.season_id and m.status = 'active' limit 1;
  if coalesce(p_move, false) then
    if v_seat is null then
      v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'no_seat', 'text', 'They do not have a seat to move from'));
    elsif v_seat_tribe = p_tribe then
      v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'same_tribe', 'text', 'They are already in this tribe'));
    end if;
  elsif v_seat is not null then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'has_seat', 'text', 'They already have a seat this season, in ' || v_seat));
  end if;
  if exists (select 1 from public.removal_blocks rb where rb.person_id = p_person and rb.tribe_id = p_tribe and rb.lifted_at is null) then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'removed_from', 'text', 'The church took them out of this tribe, so they cannot be put back in it from here'));
  end if;
  if p_person = p_placer and p_role <> 'owner' then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'self', 'text', 'You cannot place yourself'));
  end if;

  -- Warnings: each needs a tick and a reason
  select h.source, h.until into v_hold_source, v_hold_until from public.placement_holds h
   where h.person_id = p_person and (h.until is null or h.until > now());
  if found then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'held', 'source', v_hold_source, 'text', case v_hold_source
      when 'removal' then 'The church took them out of a tribe a short while ago, and automatic placement is leaving them alone until ' || to_char(v_hold_until at time zone 'Africa/Lagos', 'FMDD Mon') || ' so they can choose for themselves first'
      when 'care' then 'The Care Team is looking after this person after a request about their place, so automatic placement leaves them alone'
      else 'You put this person on hold' end));
  end if;
  if not v_profile then
    v_warn := v_warn || jsonb_build_array(
      jsonb_build_object('code', 'needs_form', 'text', 'They have not finished Find my tribe'),
      jsonb_build_object('code', 'no_score', 'text', 'There is no fit score, because there are no answers to score'));
  else
    if not public.consent_granted(p_person, 'matching') then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'no_consent', 'text', 'They have not agreed to matching. Place them only if they have told you they agree'));
    end if;
    if v_mp_season is not null and v_mp_season <> t.season_id then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'other_season', 'text', 'Their form was filled in for another season'));
    end if;
    select k.* into c from public.match_candidates(p_person) k where k.r_tribe = p_tribe;
    if found then
      v_degree := c.r_degree;
      if c.r_degree < v_floor then
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'below_bar',
          'text', 'Their fit with this tribe is ' || c.r_degree || ', below the bar of ' || v_floor));
      end if;
    else
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'no_score',
        'text', 'The matching does not offer them this tribe (the day, the format or the age group does not suit), so there is no fit score'));
    end if;
    select ar.track_id into v_track from public.age_ranges ar where ar.id = v_mp_age;
    if v_track is not null and t.track_id is not null and v_track <> t.track_id then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'other_track', 'text', 'This tribe is for a different age group from theirs'));
    end if;
  end if;
  if v_active >= t.capacity then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'full', 'text', 'This tribe is full (' || v_active || ' of ' || t.capacity || ')'));
  end if;
  if not coalesce(p_move, false) and (v_win ->> 'started')::boolean and not (v_win ->> 'open')::boolean then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'after_cutoff',
      'text', 'Joining for this season closed on ' || to_char((v_win ->> 'closes_on')::date, 'FMDD FMMonth YYYY')));
  end if;

  -- An admin or a director may accept only two warnings (joining has closed; they have not agreed to matching) and a hold the church put there. The rest are the owner's.
  select coalesce(jsonb_agg(e.w || jsonb_build_object('owner_only',
           p_role <> 'owner' and not (e.w ->> 'code' in ('after_cutoff', 'no_consent') or (e.w ->> 'code' = 'held' and e.w ->> 'source' in ('removal', 'care')))) order by e.ord), '[]'::jsonb)
    into v_warn from jsonb_array_elements(v_warn) with ordinality as e(w, ord);

  return jsonb_build_object(
    'who', p_role, 'move', coalesce(p_move, false),
    'from', case when coalesce(p_move, false) and v_seat is not null then jsonb_build_object('id', v_seat_tribe, 'name', v_seat) else null end,
    'ok', jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'warnings', v_warn,
    'person', jsonb_build_object('id', pe.id, 'name', public.person_display_name(pe.id)),
    'tribe', jsonb_build_object('id', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id), 'active', v_active, 'capacity', t.capacity),
    'degree', v_degree,
    'label', case when v_degree is null then null else public.degree_label(v_degree) end,
    'window', v_win);
end;
$function$;

CREATE OR REPLACE FUNCTION public.placement_one_options(p_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  v_floor integer := public.placement_floor();
begin
  perform public.placement_gate();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tribe', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id),
             'active', a.n, 'capacity', t.capacity, 'degree', k.r_degree,
             'label', case when k.r_degree is null then null else public.degree_label(k.r_degree) end,
             'below_floor', k.r_degree is not null and k.r_degree < v_floor,
             'removed', exists (select 1 from public.removal_blocks rb where rb.person_id = p_person and rb.tribe_id = t.id and rb.lifted_at is null),
             'current', exists (select 1 from public.tribe_members m where m.person_id = p_person and m.tribe_id = t.id and m.status = 'active'))
           order by k.r_degree desc nulls last, t.name, t.id)
      from public.tribes t
      cross join lateral (select count(*)::integer as n from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') a
      left join lateral (select c.r_degree from public.match_candidates(p_person) c where c.r_tribe = t.id) k on true
     where t.season_id = v_season and t.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.placement_undo(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
  i public.placement_items;
  tm public.tribe_members;
  v_released integer := 0;
  v_confirmed integer := 0;
  v_told integer := 0;
  v_left integer;
  v_role text;
  v_old public.tribe_members;
  v_restored boolean := false;
  v_person uuid;
begin
  v_role := public.placement_gate();
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  if v_role <> 'owner' and not r.single then
    raise exception 'Only the owner can undo a run that placed many people' using errcode = '42501';
  end if;
  if r.status in ('undone', 'cancelled', 'planning', 'planned') then
    return jsonb_build_object('status', r.status, 'already', true);
  end if;
  if r.rehearsal then
    raise exception 'A rehearsal placed nobody, so there is nothing to undo' using errcode = '22023';
  end if;
  if r.status not in ('approved', 'placing', 'placed', 'closed') then
    raise exception 'This run cannot be undone' using errcode = '22023';
  end if;
  if r.status = 'closed' or (r.status in ('placing', 'placed') and not exists (
       select 1 from public.placement_teams x where x.run_id = p_run and x.proposed > 0 and x.mail_queued_at is null and x.cancelled_at is null)
       and exists (select 1 from public.placement_items y where y.run_id = p_run and y.status = 'placed')) then
    raise exception 'Every leader has been told, so this run can no longer be undone' using errcode = '22023';
  end if;

  if r.status = 'approved' then
    update public.placement_runs set status = 'cancelled' where id = p_run;
    perform public.write_event(auth.uid(), 'placement.cancelled', 'placement_run', p_run::text, '{}'::jsonb);
    return jsonb_build_object('status', 'cancelled', 'released', 0);
  end if;
  -- Stop the batches: whoever is still waiting is left out
  update public.placement_items set status = 'skipped', reason = 'run_undone' where run_id = p_run and status = 'proposed';
  if r.status = 'placing' then
    update public.placement_runs set status = 'placed', placed_at = now() where id = p_run;
  end if;

  for i in select x.* from public.placement_items x where x.run_id = p_run and x.status = 'placed' order by x.id for update loop
    select * into tm from public.tribe_members x where x.id = i.placement_id for update;
    if not found or tm.status <> 'active' then
      continue;
    end if;
    if exists (select 1 from public.placement_teams x where x.run_id = p_run and x.tribe_id = tm.tribe_id and x.mail_queued_at is not null) then
      v_told := v_told + 1;
    elsif tm.confirmed_at is not null or tm.contact_withheld then
      v_confirmed := v_confirmed + 1;
    else
      update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Placement undone by the church' where id = tm.id;
      update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
      update public.messages set status = 'skipped', error = 'undone', reply_token = null
       where status = 'queued' and (dedupe_key = 'placement:' || tm.id or dedupe_key = 'placement-reminder:' || tm.id);
      delete from public.placement_tokens where placement_id = tm.id;
      update public.placement_items set status = 'undone' where id = i.id;
      v_released := v_released + 1;
    end if;
  end loop;
  -- A move is undone by putting the old seat back; if its tribe has no room now the whole undo is refused
  if v_released > 0 and r.moved_from_seat is not null then
    select * into v_old from public.tribe_members x where x.id = r.moved_from_seat for update;
    if found and v_old.status = 'released' and v_old.release_reason = 'Moved by the church'
       and not exists (select 1 from public.tribe_members x where x.person_id = v_old.person_id and x.season_id = v_old.season_id and x.status = 'active') then
      if (select count(*) from public.tribe_members x where x.tribe_id = v_old.tribe_id and x.status = 'active') >= (select t.capacity from public.tribes t where t.id = v_old.tribe_id) then
        raise exception 'Their old tribe has no room now, so this move cannot be undone. Move them again instead' using errcode = '22023';
      end if;
      update public.tribe_members set status = 'active', released_at = null, release_reason = null where id = v_old.id;
      perform public.enqueue_message((select t.leader_id from public.tribes t where t.id = v_old.tribe_id), 'swap_moved',
        jsonb_build_object('person_first', public.first_name_of(v_old.person_id), 'direction', 'in'), v_old.tribe_id, 'office-move:' || p_run || ':back');
      v_restored := true;
    end if;
  end if;
  -- A hold the church had put on the person comes back with the seat taken away
  if v_released > 0 and r.held_before is not null then
    select x.person_id into v_person from public.placement_items x where x.run_id = p_run limit 1;
    insert into public.placement_holds (person_id, note, until, source, request_id)
    values (v_person, r.held_before ->> 'note', (r.held_before ->> 'until')::timestamptz, r.held_before ->> 'source', (r.held_before ->> 'request_id')::uuid)
    on conflict (person_id) do nothing;
  end if;
  -- A tribe's leader is not told about a team that has been undone
  update public.placement_teams t set cancelled_at = now()
   where t.run_id = p_run and t.mail_queued_at is null
     and not exists (select 1 from public.tribe_members x where x.tribe_id = t.tribe_id and x.placed_by_run = p_run and x.status = 'active');
  update public.messages set status = 'skipped', error = 'undone'
   where status = 'queued' and template = 'placement_your_team' and dedupe_key like 'placement-team:' || p_run || ':%';

  select count(*)::integer into v_left from public.placement_items x where x.run_id = p_run and x.status = 'placed';
  update public.placement_runs set status = 'undone', undone_at = now() where id = p_run;
  perform public.write_event(auth.uid(), 'placement.undone', 'placement_run', p_run::text,
    jsonb_build_object('released', v_released, 'kept_confirmed', v_confirmed, 'kept_leader_told', v_told));
  return jsonb_build_object('status', 'undone', 'released', v_released, 'kept_confirmed', v_confirmed, 'kept_leader_told', v_told, 'restored', v_restored);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Who may place one person: the owner (with God Mode open), an admin or a director
-- ---------------------------------------------------------------------------
create function public.placement_gate()
 returns text
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_god() then
    return 'owner';
  end if;
  if exists (select 1 from public.person_roles r join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
              where r.person_id = uid and r.role = 'admin') then
    return 'admin';
  end if;
  if exists (select 1 from public.person_roles r join public.people p on p.id = r.person_id and p.centre_id = r.centre_id
              where r.person_id = uid and r.role = 'director') then
    return 'director';
  end if;
  raise exception 'That page is not available' using errcode = '42501';
end;
$function$;

-- A reason a placement was refused at the last moment, in words a person can read
create function public.placement_reason_words(p_code text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_code
    when 'chose_own' then 'they have just taken a seat for themselves'
    when 'tribe_full' then 'this tribe has just filled up'
    when 'tribe_closed' then 'this tribe is no longer open'
    when 'tribe_changed' then 'the matching no longer offers them this tribe'
    when 'below_bar' then 'their fit is below the bar'
    when 'leader' then 'they lead or assist a tribe'
    when 'held' then 'they are on hold'
    when 'needs_form' then 'they have not finished Find my tribe'
    when 'no_consent' then 'they have not agreed to matching'
    when 'under18' then 'they are under 18'
    when 'deletion_open' then 'they have asked for their account to be deleted'
    when 'cannot_email' then 'they cannot be emailed'
    when 'other_season' then 'their form is for another season'
    else coalesce(p_code, 'something changed') end;
$function$;

-- Can this run still be undone? Yes until the leader of the tribe has been told.
create function public.placement_run_undoable(p_run uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.placement_runs r
                  where r.id = p_run and not r.rehearsal and r.status in ('approved', 'placing', 'placed')
                    and exists (select 1 from public.placement_teams x where x.run_id = r.id and x.proposed > 0 and x.mail_queued_at is null and x.cancelled_at is null)
                    and exists (select 1 from public.placement_items y where y.run_id = r.id and y.status = 'placed'));
$function$;

-- ---------------------------------------------------------------------------
-- The one place that does it: the owner, an admin or a director placing or moving one person, and the owner approving an asked-for one.
-- It runs the church's own placement of a single item, so the person is treated exactly as a church run treats them.
-- ---------------------------------------------------------------------------
create function public.placement_office_do(
  p_person uuid, p_tribe uuid, p_accept text[], p_reason text, p_agreed boolean, p_move boolean,
  p_role text, p_placer uuid, p_placer_role text, p_approved_by uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_chk jsonb;
  v_codes text[];
  v_accept text[] := coalesce(p_accept, '{}'::text[]);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_via text := case when p_role = 'owner' and p_approved_by is null then 'owner' else 'office' end;
  s public.placement_settings;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  old public.tribe_members%rowtype;
  oldt public.tribes%rowtype;
  v_model text;
  v_run uuid := gen_random_uuid();
  v_item bigint;
  v_res text;
  v_tm uuid;
  v_started boolean;
  v_held jsonb;
  v_only text[];
begin
  -- One person is placed by one hand at a time: the second of two clicks finds the first one's seat
  perform pg_advisory_xact_lock(hashtextextended('placement-one:' || p_person::text, 0));
  if public.placement_mode() <> 'on' then
    raise exception 'Placement is not switched On. A person is placed for real only when it is On' using errcode = '22023';
  end if;
  v_chk := public.placement_check_core(p_person, p_tribe, coalesce(p_move, false), p_role, p_placer);
  if jsonb_array_length(v_chk -> 'blockers') > 0 then
    raise exception '%', (v_chk -> 'blockers' -> 0 ->> 'text') using errcode = '22023';
  end if;
  select coalesce(array_agg(x ->> 'code'), '{}'::text[]) into v_codes from jsonb_array_elements(v_chk -> 'warnings') x;
  select coalesce(array_agg(c), '{}'::text[]) into v_only from unnest(v_codes) c where c <> all (v_accept);
  if v_only = array['full'] then
    raise exception 'This tribe is full (% of %). Nothing was changed', v_chk #>> '{tribe,active}', v_chk #>> '{tribe,capacity}' using errcode = '22023';
  end if;
  if cardinality(v_only) > 0 then
    raise exception 'Read each warning and tick that you accept it' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_chk -> 'warnings') x where coalesce((x ->> 'owner_only')::boolean, false)) then
    raise exception 'Only the owner can place someone past this. Use Ask the owner' using errcode = '22023';
  end if;
  if cardinality(v_codes) > 0 and (v_reason is null or char_length(v_reason) < 5) then
    raise exception 'Say why, in a few words' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'Keep the reason under 200 characters' using errcode = '22023';
  end if;
  if 'no_consent' = any (v_codes) and not coalesce(p_agreed, false) then
    raise exception 'They have not agreed to matching. Tick that they have told you they agree, or leave them out' using errcode = '22023';
  end if;
  if p_role <> 'owner' and p_approved_by is null
     and (select count(*) from public.placement_runs x
           where x.placed_by = p_placer and x.placed_via = 'office' and x.single
             and (x.planned_at at time zone 'Africa/Lagos')::date = public.today_lagos()) >= 30 then
    raise exception 'You have placed 30 people today, which is the most one person may place in a day. Ask the owner to place the rest' using errcode = '22023';
  end if;

  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  select * into t from public.tribes x where x.id = p_tribe;
  select * into se from public.seasons x where x.id = t.season_id;
  v_started := se.starts_on <= public.today_lagos();

  -- A hold the church put there is saved, so that undoing the placement can put it back
  if 'held' = any (v_codes) then
    select jsonb_build_object('source', h.source, 'until', h.until, 'note', h.note, 'request_id', h.request_id) into v_held
      from public.placement_holds h
     where h.person_id = p_person and h.source in ('removal', 'care') and (h.until is null or h.until > now());
  end if;

  if p_move then
    -- The routine of a swap: leave the old seat first (a person has one active seat in a season), then take the new one
    select * into old from public.tribe_members m
     where m.person_id = p_person and m.season_id = t.season_id and m.status = 'active' for update;
    if not found then
      raise exception 'They do not have a seat to move from' using errcode = '22023';
    end if;
    select * into oldt from public.tribes x where x.id = old.tribe_id;
    update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Moved by the church' where id = old.id;
  end if;

  insert into public.placement_runs (id, season_id, status, phase, in_season, after_cutoff, single, note, rehearsal, grace_days, seats_free, min_tribe,
                                     pace_per_hour, send_from, send_until, hold_hours, model_version, pool, planned_at, approved_at, placed_at,
                                     placed_by, placed_role, placed_via, approved_by, moved_from, moved_from_seat, held_before)
  values (v_run, se.id, 'placed', 'ready', v_started, 'after_cutoff' = any (v_codes), true, v_reason, false, 0, 0, s.min_tribe,
          s.pace_per_hour, s.send_from, s.send_until, s.hold_hours, v_model, 1, now(), now(), now(),
          p_placer, p_placer_role, v_via, p_approved_by, old.tribe_id, old.id, v_held);
  insert into public.placement_items (run_id, person_id, status, tribe_id, degree, seq, moved, override, override_reason, agreed)
  values (v_run, p_person, 'proposed', p_tribe, (v_chk ->> 'degree')::integer, 1, true, v_codes, v_reason, coalesce(p_agreed, false))
  returning id into v_item;
  insert into public.placement_teams (run_id, tribe_id, active_before, proposed)
  values (v_run, p_tribe, (select count(*)::integer from public.tribe_members m where m.tribe_id = p_tribe and m.status = 'active'), 1);

  v_res := public.placement_place_item(v_run, v_item);
  if v_res is not null then
    -- Raising rolls back the run, the item, the team row and the old seat's release: nothing is left behind
    raise exception 'They could not be placed: %. Nothing was changed', public.placement_reason_words(v_res) using errcode = '22023';
  end if;
  select i.placement_id into v_tm from public.placement_items i where i.id = v_item;

  if p_move then
    perform public.enqueue_message(oldt.leader_id, 'swap_moved',
      jsonb_build_object('person_first', public.first_name_of(p_person), 'direction', 'out'), oldt.id, 'office-move:' || v_run || ':out');
  end if;
  perform public.write_event(auth.uid(), 'placement.single', 'placement_run', v_run::text,
    jsonb_build_object('tribe', p_tribe, 'codes', to_jsonb(v_codes), 'agreed', coalesce(p_agreed, false), 'in_season', v_started,
                       'by', p_placer, 'role', p_placer_role, 'via', v_via, 'move', coalesce(p_move, false)));
  return jsonb_build_object('ok', true, 'run', v_run, 'placement', v_tm, 'moved', coalesce(p_move, false));
end;
$function$;

-- Place one person (the owner, an admin or a director)
create or replace function public.placement_one_place(p_person uuid, p_tribe uuid, p_accept text[] DEFAULT '{}'::text[], p_reason text DEFAULT NULL::text, p_agreed boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
begin
  return public.placement_office_do(p_person, p_tribe, p_accept, p_reason, p_agreed, false, v_role, auth.uid(), v_role, null);
end;
$function$;

-- Move a member who has a seat to another tribe: the old seat is given up, the old leader is told, and the new seat is placed like any other
create function public.placement_one_move(p_person uuid, p_tribe uuid, p_accept text[] DEFAULT '{}'::text[], p_reason text DEFAULT NULL::text, p_agreed boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
begin
  return public.placement_office_do(p_person, p_tribe, p_accept, p_reason, p_agreed, true, v_role, auth.uid(), v_role, null);
end;
$function$;

create function public.placement_move_check(p_person uuid, p_tribe uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
begin
  return public.placement_check_core(p_person, p_tribe, true, v_role, auth.uid());
end;
$function$;

create or replace function public.placement_one_check(p_person uuid, p_tribe uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
begin
  return public.placement_check_core(p_person, p_tribe, false, v_role, auth.uid());
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ask the owner: what an admin or a director may not place past, the owner decides
-- ---------------------------------------------------------------------------
create table public.placement_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  move boolean not null default false,
  asked_by uuid not null references public.people (id) on delete cascade,
  asked_role text not null check (asked_role in ('admin', 'director')),
  codes text[] not null default '{}',
  reason text not null check (char_length(reason) between 5 and 200),
  told boolean not null default false,
  status text not null default 'open' check (status in ('open', 'approved', 'declined', 'withdrawn', 'lapsed')),
  asked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  decided_by uuid references public.people (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 200),
  run_id uuid
);
create unique index placement_requests_one_open on public.placement_requests (person_id) where status = 'open';
create index placement_requests_asker on public.placement_requests (asked_by, asked_at desc);
alter table public.placement_requests enable row level security;
revoke all on table public.placement_requests from public, anon, authenticated;

create function public.placement_office_ask(p_person uuid, p_tribe uuid, p_accept text[], p_reason text, p_told boolean DEFAULT false, p_move boolean DEFAULT false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  v_chk jsonb;
  v_codes text[];
  v_accept text[] := coalesce(p_accept, '{}'::text[]);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if v_role = 'owner' then
    raise exception 'You are the owner: place them yourself' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('placement-one:' || p_person::text, 0));
  if public.placement_mode() <> 'on' then
    raise exception 'Placement is not switched On. A person is placed for real only when it is On' using errcode = '22023';
  end if;
  v_chk := public.placement_check_core(p_person, p_tribe, coalesce(p_move, false), v_role, auth.uid());
  if jsonb_array_length(v_chk -> 'blockers') > 0 then
    raise exception '%', (v_chk -> 'blockers' -> 0 ->> 'text') using errcode = '22023';
  end if;
  select coalesce(array_agg(x ->> 'code'), '{}'::text[]) into v_codes from jsonb_array_elements(v_chk -> 'warnings') x;
  if not exists (select 1 from jsonb_array_elements(v_chk -> 'warnings') x where coalesce((x ->> 'owner_only')::boolean, false)) then
    raise exception 'You can place them yourself, so there is nothing to ask the owner' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_codes) c where c <> all (v_accept)) then
    raise exception 'Read each warning and tick that you accept it' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'Say why, in a few words' using errcode = '22023';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'Keep the reason under 200 characters' using errcode = '22023';
  end if;
  if 'no_consent' = any (v_codes) and not coalesce(p_told, false) then
    raise exception 'They have not agreed to matching. Tick that they have told you they agree, or leave them out' using errcode = '22023';
  end if;
  update public.placement_requests set status = 'lapsed' where person_id = p_person and status = 'open' and expires_at <= now();
  if exists (select 1 from public.placement_requests q where q.person_id = p_person and q.status = 'open') then
    raise exception 'There is already a request to the owner about this person' using errcode = '22023';
  end if;
  if (select count(*) from public.placement_requests q where q.asked_by = auth.uid() and q.status = 'open') >= 10 then
    raise exception 'You have 10 requests waiting for the owner. Wait for some to be answered' using errcode = '22023';
  end if;
  insert into public.placement_requests (person_id, tribe_id, move, asked_by, asked_role, codes, reason, told)
  values (p_person, p_tribe, coalesce(p_move, false), auth.uid(), v_role, v_codes, v_reason, coalesce(p_told, false))
  returning id into v_id;
  perform public.write_event(auth.uid(), 'placement.asked', 'placement_request', v_id::text,
    jsonb_build_object('tribe', p_tribe, 'codes', to_jsonb(v_codes), 'move', coalesce(p_move, false)));
  return jsonb_build_object('ok', true, 'request', v_id);
end;
$function$;

-- The requests: the owner sees every one, an admin or a director sees their own
create function public.placement_requests_list(p_person uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
begin
  return coalesce((
    select jsonb_agg(z.j order by z.asked_at desc)
      from (select q.asked_at,
                   jsonb_build_object(
                     'id', q.id, 'person', q.person_id, 'name', public.person_display_name(q.person_id),
                     'tribe', q.tribe_id, 'tribe_name', t.name, 'move', q.move,
                     'asked_by', public.person_display_name(q.asked_by), 'asked_role', q.asked_role, 'mine', q.asked_by = auth.uid(),
                     'codes', to_jsonb(q.codes), 'reason', q.reason, 'told', q.told,
                     'asked_at', q.asked_at, 'expires_at', q.expires_at,
                     'status', case when q.status = 'open' and q.expires_at <= now() then 'lapsed' else q.status end,
                     'decided_at', q.decided_at, 'decision_note', q.decision_note, 'run', q.run_id) as j
              from public.placement_requests q
              join public.tribes t on t.id = q.tribe_id
             where (v_role = 'owner' or q.asked_by = auth.uid())
               and (p_person is null or q.person_id = p_person)
               and (q.status = 'open' or q.asked_at > now() - interval '30 days')
             order by q.asked_at desc
             limit 100) z), '[]'::jsonb);
end;
$function$;

-- Look again, with today's facts, before deciding
create function public.placement_request_check(p_req uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  q public.placement_requests%rowtype;
begin
  perform public.god_only();
  select * into q from public.placement_requests x where x.id = p_req;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'status', case when q.status = 'open' and q.expires_at <= now() then 'lapsed' else q.status end,
    'check', public.placement_check_core(q.person_id, q.tribe_id, q.move, 'owner', q.asked_by));
end;
$function$;

create function public.placement_request_decide(p_req uuid, p_decision text, p_accept text[] DEFAULT '{}'::text[], p_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  q public.placement_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_res jsonb;
  v_ok boolean := p_decision = 'approve';
begin
  perform public.god_only();
  if p_decision not in ('approve', 'decline') then
    raise exception 'Choose to approve or to decline' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = '22023';
  end if;
  select * into q from public.placement_requests x where x.id = p_req for update;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;
  if q.expires_at <= now() then
    raise exception 'This request lapsed after 7 days. Ask them to ask again if it still matters' using errcode = '22023';
  end if;
  if v_ok then
    -- Everything is checked again, now: a tribe that has filled, a person who has joined another, a switch turned Off all stop it here
    v_res := public.placement_office_do(q.person_id, q.tribe_id, p_accept, q.reason, q.told, q.move, 'owner', q.asked_by, q.asked_role, auth.uid());
  end if;
  update public.placement_requests
     set status = case when v_ok then 'approved' else 'declined' end, decided_by = auth.uid(), decided_at = now(), decision_note = v_note,
         run_id = case when v_ok then (v_res ->> 'run')::uuid else null end
   where id = q.id;
  perform public.notify_person(q.asked_by, 'admin', 'admin_placement_answer', 'placement-request:' || q.id,
    jsonb_build_object('approved', v_ok), 'Your request to place a member was answered', '/admin/people/' || q.person_id, true);
  perform public.write_event(auth.uid(), 'placement.request_answered', 'placement_request', q.id::text, jsonb_build_object('approved', v_ok));
  return jsonb_build_object('ok', true, 'approved', v_ok, 'run', v_res ->> 'run');
end;
$function$;

create function public.placement_request_withdraw(p_req uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  q public.placement_requests%rowtype;
begin
  select * into q from public.placement_requests x where x.id = p_req for update;
  if not found or (v_role <> 'owner' and q.asked_by <> auth.uid()) then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  if q.status <> 'open' then
    raise exception 'This request has already been answered' using errcode = '22023';
  end if;
  update public.placement_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = q.id;
  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Finding a member, and the facts the office pages show
-- ---------------------------------------------------------------------------
create function public.placement_find(p_query text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  q text := lower(btrim(coalesce(p_query, '')));
  d text := right(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), 10);
  v_centre uuid;
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
begin
  if char_length(q) < 2 then
    return '[]'::jsonb;
  end if;
  select p.centre_id into v_centre from public.people p where p.id = auth.uid();
  return coalesce((
    select jsonb_agg(z.j order by z.nm)
      from (select public.person_display_name(p.id) as nm,
                   jsonb_build_object(
                     'id', p.id, 'name', public.person_display_name(p.id), 'email', p.email,
                     'tribe', st.name, 'has_form', mp.person_id is not null,
                     'leads', exists (select 1 from public.person_roles r where r.person_id = p.id and r.role in ('leader', 'assistant_leader'))) as j
              from public.people p
              left join public.member_profiles mp on mp.person_id = p.id
              left join public.contact_preferences cp on cp.person_id = p.id
              left join lateral (select tt.name from public.tribe_members m join public.tribes tt on tt.id = m.tribe_id
                                  where m.person_id = p.id and m.status = 'active' and m.season_id = v_season limit 1) st on true
             where not p.hidden
               and (v_role = 'owner' or p.centre_id = v_centre)
               and exists (select 1 from public.person_roles r where r.person_id = p.id and r.role = 'member')
               and not exists (select 1 from public.platform_owner w where w.person_id = p.id)
               and (position(q in lower(coalesce(p.full_name, ''))) > 0
                    or position(q in lower(coalesce(p.preferred_name, ''))) > 0
                    or position(q in lower(p.email)) > 0
                    or (char_length(d) >= 7 and (position(d in regexp_replace(coalesce(mp.whatsapp, ''), '\D', '', 'g')) > 0
                                                 or position(d in regexp_replace(coalesce(cp.phone, ''), '\D', '', 'g')) > 0)))
             order by 1
             limit 15) z), '[]'::jsonb);
end;
$function$;

-- One person, for the person page
create function public.placement_office_person(p_person uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  pe public.people%rowtype;
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  v_seat jsonb;
  v_hold jsonb;
  v_last jsonb;
begin
  select * into pe from public.people x where x.id = p_person;
  if not found or (v_role <> 'owner' and pe.hidden) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  select jsonb_build_object('tribe', tt.id, 'name', tt.name, 'leader', public.first_name_of(tt.leader_id)) into v_seat
    from public.tribe_members m join public.tribes tt on tt.id = m.tribe_id
   where m.person_id = p_person and m.season_id = v_season and m.status = 'active' limit 1;
  select jsonb_build_object('source', h.source, 'until', h.until) into v_hold
    from public.placement_holds h where h.person_id = p_person and (h.until is null or h.until > now());
  select jsonb_build_object('run', r.id, 'tribe', t.name, 'at', r.planned_at, 'moved', r.moved_from is not null,
                            'by', case when r.placed_by is null then null else public.person_display_name(r.placed_by) end,
                            'undoable', public.placement_run_undoable(r.id)) into v_last
    from public.placement_runs r join public.placement_items i on i.run_id = r.id and i.person_id = p_person
    join public.tribes t on t.id = i.tribe_id
   where r.single and r.status in ('placed', 'placing', 'approved', 'closed') and i.status = 'placed'
   order by r.planned_at desc limit 1;
  return jsonb_build_object(
    'mode', public.placement_mode(), 'role', v_role,
    'person', jsonb_build_object('id', pe.id, 'name', public.person_display_name(pe.id), 'email', pe.email),
    'member', exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'member')
              and not pe.hidden and not exists (select 1 from public.platform_owner w where w.person_id = p_person),
    'leads', exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader')),
    'form', exists (select 1 from public.member_profiles x where x.person_id = p_person),
    'seat', v_seat, 'hold', v_hold, 'last', v_last);
end;
$function$;

-- The tribes of the season, for the office list
create function public.placement_office_tribes()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
begin
  return jsonb_build_object(
    'mode', public.placement_mode(), 'role', v_role,
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id),
               'active', a.n, 'capacity', t.capacity,
               'open', t.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id))
             order by t.name, t.id)
        from public.tribes t
        cross join lateral (select count(*)::integer as n from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') a
       where t.season_id = v_season and t.status = 'approved'), '[]'::jsonb));
end;
$function$;

-- One tribe, for the tribe page: who it is, how full, and what the office placed there lately (with Undo while it can be)
create function public.placement_office_tribe(p_tribe uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_role text := public.placement_gate();
  t public.tribes%rowtype;
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    raise exception 'No such tribe' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'mode', public.placement_mode(), 'role', v_role,
    'tribe', jsonb_build_object(
      'id', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id),
      'active', (select count(*)::integer from public.tribe_members m where m.tribe_id = t.id and m.status = 'active'), 'capacity', t.capacity,
      'open', t.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id),
      'window', public.season_joining_window(t.season_id)),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'run', r.id, 'person', i.person_id, 'name', public.person_display_name(i.person_id), 'at', r.planned_at,
               'moved', r.moved_from is not null, 'by', case when r.placed_by is null then null else public.person_display_name(r.placed_by) end,
               'undoable', public.placement_run_undoable(r.id)) order by r.planned_at desc)
        from public.placement_runs r join public.placement_items i on i.run_id = r.id
       where r.single and i.tribe_id = p_tribe and i.status = 'placed' and r.status in ('placed', 'placing', 'approved', 'closed')
         and r.planned_at > now() - interval '14 days'), '[]'::jsonb));
end;
$function$;

-- For the owner's Placement page: what the office has placed, by person, and how many requests are waiting
create function public.placement_office_counts()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  perform public.god_only();
  return jsonb_build_object(
    'requests_open', (select count(*)::integer from public.placement_requests q where q.status = 'open' and q.expires_at > now()),
    'by_person', coalesce((
      select jsonb_agg(z.j order by z.n desc, z.nm)
        from (select count(*)::integer as n, public.person_display_name(r.placed_by) as nm,
                     jsonb_build_object(
                       'name', public.person_display_name(r.placed_by), 'role', max(r.placed_role),
                       'placed', count(*) filter (where r.moved_from is null and r.status <> 'undone'),
                       'moved', count(*) filter (where r.moved_from is not null and r.status <> 'undone'),
                       'undone', count(*) filter (where r.status = 'undone'),
                       'today', count(*) filter (where (r.planned_at at time zone 'Africa/Lagos')::date = public.today_lagos()),
                       'last', max(r.planned_at)) as j
                from public.placement_runs r
               where r.single and r.placed_via = 'office' and r.placed_by is not null and r.planned_at > now() - interval '30 days'
               group by r.placed_by) z), '[]'::jsonb));
end;
$function$;

-- Access
revoke execute on function public.placement_gate(), public.placement_reason_words(text), public.placement_run_undoable(uuid),
  public.placement_check_core(uuid, uuid, boolean, text, uuid),
  public.placement_office_do(uuid, uuid, text[], text, boolean, boolean, text, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.placement_one_move(uuid, uuid, text[], text, boolean), public.placement_move_check(uuid, uuid),
  public.placement_office_ask(uuid, uuid, text[], text, boolean, boolean), public.placement_requests_list(uuid), public.placement_request_check(uuid),
  public.placement_request_decide(uuid, text, text[], text), public.placement_request_withdraw(uuid), public.placement_find(text),
  public.placement_office_person(uuid), public.placement_office_tribes(), public.placement_office_tribe(uuid), public.placement_office_counts() from public, anon;
grant execute on function public.placement_one_move(uuid, uuid, text[], text, boolean), public.placement_move_check(uuid, uuid),
  public.placement_office_ask(uuid, uuid, text[], text, boolean, boolean), public.placement_requests_list(uuid), public.placement_request_check(uuid),
  public.placement_request_decide(uuid, text, text[], text), public.placement_request_withdraw(uuid), public.placement_find(text),
  public.placement_office_person(uuid), public.placement_office_tribes(), public.placement_office_tribe(uuid), public.placement_office_counts() to authenticated;

commit;

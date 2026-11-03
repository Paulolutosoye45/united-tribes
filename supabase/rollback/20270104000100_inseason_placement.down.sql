-- Way back from "In-season placement and placing one person" (Package 1).
--
-- Puts every function the migration changed back exactly as it was and drops the functions it added. The columns it added to the run and item tables
-- stay (the note, the in-season and after-the-cut-off marks, the "single placement" mark, and the list of warnings the owner accepted with the reason
-- and "they already agreed"): they do nothing without the functions, and nothing the owner wrote is lost, as the way back from the earlier features
-- keeps their tables. People placed one at a time stay placed and their runs stay in the list as ordinary runs of one; the fact that each was placed
-- stays in the event log. Put the application files back before this one: the pages call the functions dropped here. Run it as the database owner.
-- Running it twice changes nothing.
begin;
create or replace function public.placement_team_mail_for(p_run uuid, p_tribe uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  tm public.placement_teams;
  t public.tribes%rowtype;
  v_waiting integer;
  v_holding integer;
  v_late boolean;
  v_planned timestamptz;
  v_members jsonb;
  v_count integer;
  v_first date;
  v_queued integer := 0;
  who uuid;
begin
  select * into r from public.placement_runs x where x.id = p_run;
  if not found or r.rehearsal or r.status not in ('placing', 'placed', 'undone') then
    return 0;
  end if;
  for tm in select x.* from public.placement_teams x where x.run_id = p_run and x.mail_queued_at is null and x.cancelled_at is null and x.proposed > 0
               and (p_tribe is null or x.tribe_id = p_tribe)
            order by x.tribe_id for update loop
    select * into t from public.tribes x where x.id = tm.tribe_id;
    continue when exists (select 1 from public.placement_items x where x.run_id = p_run and x.tribe_id = tm.tribe_id and x.status = 'proposed');
    select count(*) filter (where msg.status in ('queued', 'sending'))::integer, max(msg.scheduled_for)
      into v_waiting, v_planned
      from public.tribe_members x
      left join public.placement_items i on i.placement_id = x.id
      left join public.messages msg on msg.id = i.member_message
     where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active';
    v_late := tm.contact_opened_at is not null or (v_planned is not null and now() >= v_planned + interval '72 hours');
    -- Not yet: someone's email is still to go (even a member who agreed on the form is told first) ...
    continue when v_waiting > 0 and not v_late;
    -- ... or someone's hold is running. Only a tribe whose emails have all gone is asked about holds, so a run that is still placing does
    -- not work out every member's state at every step.
    if not v_late then
      select count(*)::integer into v_holding
        from public.tribe_members x cross join lateral (select public.placement_contact(x.id) as c) k
       where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active' and k.c ->> 'state' = 'holding';
      continue when v_holding > 0;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'name', public.person_display_name(x.person_id),
             'state', k.c ->> 'state',
             'email', case when k.c ->> 'state' = 'open' then pe.email end,
             'whatsapp', case when k.c ->> 'state' = 'open' and public.consent_granted(x.person_id, 'whatsapp') then mp.whatsapp end,
             'withheld', x.contact_withheld,
             'opens_on', case when k.c ->> 'state' = 'holding' then ((k.c ->> 'opens_at')::timestamptz at time zone 'Africa/Lagos')::date end)
           order by public.person_display_name(x.person_id), x.id), '[]'::jsonb),
           count(*)::integer, min(x.first_meeting_by)
      into v_members, v_count, v_first
      from public.tribe_members x
      join public.people pe on pe.id = x.person_id
      left join public.member_profiles mp on mp.person_id = x.person_id
      cross join lateral (select public.placement_contact(x.id) as c) k
     where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active'
       and coalesce(public.message_blocker(x.person_id), '') not in ('deletion', 'under18');

    if v_count > 0 then
      for who in select * from public.tribe_team(t.id) loop
        perform public.enqueue_message(who, 'placement_your_team',
          jsonb_build_object('tribe', t.name, 'first_meeting_by', v_first,
                             'call_by', ((now() + interval '72 hours') at time zone 'Africa/Lagos')::date, 'members', v_members),
          t.id, 'placement-team:' || p_run || ':' || t.id || ':' || who, p_force => 'email');
      end loop;
    end if;
    update public.placement_teams set mail_queued_at = now() where run_id = p_run and tribe_id = tm.tribe_id;
    v_queued := v_queued + 1;
  end loop;
  -- Every team dealt with: the run is closed
  if r.status = 'placed' and not exists (select 1 from public.placement_teams x where x.run_id = p_run and x.proposed > 0 and x.mail_queued_at is null and x.cancelled_at is null) then
    update public.placement_runs set status = 'closed', closed_at = now() where id = p_run;
  end if;
  return v_queued;
end;
$$;
create or replace function public.placement_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.status in ('planning', 'planned', 'approved', 'placing') order by x.seq desc limit 1;
  return jsonb_build_object(
    'settings', public.placement_settings_get(),
    'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on) from public.seasons s where s.id = v_season),
    'open_run', case when r.id is null then null else jsonb_build_object(
        'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told) end,
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'seq', x.seq, 'status', x.status, 'rehearsal', x.rehearsal, 'created_at', x.created_at, 'pool', x.pool,
               'placed', (select count(*) from public.placement_items i where i.run_id = x.id and i.status = 'placed'),
               'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = x.id and m.status = 'active' and m.confirmed_at is not null))
             order by x.seq desc)
        from (select * from public.placement_runs order by seq desc limit 8) x), '[]'::jsonb),
    'supply', jsonb_build_object(
      'tribes_open', (select count(*) from public.tribes t where t.season_id = v_season and t.status = 'approved'
                        and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)),
      'seats_open', coalesce((select sum(greatest(t.capacity - (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active'), 0))
                                from public.tribes t where t.season_id = v_season and t.status = 'approved'
                                 and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)), 0),
      'members_with_form', (select count(*) from public.people p join public.member_profiles mp on mp.person_id = p.id
                             where not p.hidden and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
                               and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
                               and not exists (select 1 from public.tribe_members m where m.person_id = p.id and m.season_id = v_season and m.status = 'active')),
      'members_without_form', (select count(*) from public.people p
                                where not p.hidden and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
                                  and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
                                  and not exists (select 1 from public.member_profiles mp where mp.person_id = p.id)),
      'on_hold', (select count(*) from public.placement_holds)));
end;
$$;
create or replace function public.placement_place_item(p_run uuid, p_item bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
  i public.placement_items;
  t public.tribes;
  se public.seasons;
  m public.match_models;
  c record;
  tm public.tribe_members;
  v_reason text;
  v_floor integer := public.placement_floor();
  v_run uuid := gen_random_uuid();
  v_total integer;
  v_kept integer;
  v_at timestamptz;
  v_msg uuid;
  v_tok text;
  v_params jsonb;
  v_degree integer;
  v_days integer := (select s.reminder_days::integer from public.placement_settings s where s.singleton);
begin
  select * into r from public.placement_runs x where x.id = p_run;
  select * into i from public.placement_items x where x.id = p_item and x.run_id = p_run for update;
  if not found or i.status <> 'proposed' then
    return null;
  end if;

  -- A member who has taken a seat for themselves since the plan was made is left alone: this is the first thing looked at
  if exists (select 1 from public.tribe_members x where x.person_id = i.person_id and x.season_id = r.season_id and x.status = 'active') then
    v_reason := 'chose_own';
  else
    v_reason := public.placement_pool_reason(i.person_id, r.season_id, r.grace_days);
  end if;
  if v_reason is null then
    select * into t from public.tribes x where x.id = i.tribe_id for update;
    if not found or t.season_id <> r.season_id or t.status <> 'approved'
       or not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
      v_reason := 'tribe_closed';
    elsif (select count(*) from public.tribe_members x where x.tribe_id = t.id and x.status = 'active') + 1 + r.seats_free > t.capacity then
      v_reason := 'tribe_full';
    end if;
  end if;
  if v_reason is null and not r.rehearsal then
    select k.* into c from public.match_candidates(i.person_id) k where k.r_tribe = i.tribe_id;
    if not found then
      v_reason := 'tribe_changed';
    elsif not i.moved and c.r_degree < v_floor then
      v_reason := 'below_bar';
    else
      v_degree := c.r_degree;
    end if;
  end if;
  if v_reason is not null then
    update public.placement_items set status = 'skipped', reason = v_reason where id = i.id;
    return v_reason;
  end if;

  v_degree := coalesce(v_degree, i.degree);
  v_at := greatest(public.placement_slot(r.approved_at, r.pace_per_hour, r.send_from, r.send_until, r.told), now());
  v_params := public.placement_member_params(t.id, i.person_id, v_degree);

  if r.rehearsal then
    -- A rehearsal writes what would have gone to the message log as a skipped row, and places nobody.
    insert into public.messages (centre_id, person_id, tribe_id, template, params, force_channel, dedupe_key, scheduled_for, status, channel, error)
    select p.centre_id, i.person_id, t.id, 'placement_your_tribe', v_params, 'email', 'placement-rehearsal:' || p_run || ':' || i.person_id, v_at, 'skipped', 'email', 'Rehearsal: written to the log, not sent'
      from public.people p where p.id = i.person_id
    on conflict (dedupe_key) do nothing;
    update public.placement_items
       set status = 'rehearsed', slot_at = v_at, placed_at = now(),
           rehearsal = jsonb_build_object('tribe', t.name, 'degree', v_degree, 'send_at', v_at)
     where id = i.id;
    update public.placement_runs set told = told + 1 where id = p_run;
    return null;
  end if;

  select * into m from public.match_models x where x.active;
  select * into se from public.seasons x where x.id = t.season_id;
  select count(*)::integer into v_total from public.match_candidates(i.person_id);
  -- The same record a member's own run leaves behind, so their tribe page reads the same. The church's pick is shown first.
  insert into public.match_runs (id, person_id, season_id, model_version, candidates, shown) values (v_run, i.person_id, r.season_id, m.version, v_total, 0);
  insert into public.match_recommendations (run_id, person_id, rank, tribe_id, degree, components, reasons)
  select v_run, i.person_id, ranked.rk, ranked.r_tribe, ranked.r_degree,
         jsonb_build_object('goal', ranked.r_goal, 'stage', ranked.r_stage, 'community', ranked.r_community, 'place', ranked.r_place,
                            'style', ranked.r_style, 'rhythm', ranked.r_rhythm, 'faith', ranked.r_faith),
         public.match_reasons(ranked.r_goal, ranked.r_stage, ranked.r_community, ranked.r_place, ranked.r_online,
                              ranked.r_rhythm, ranked.r_balance, ranked.r_affinity, ranked.r_faith, m.weights)
    from (select cand.*,
                 (row_number() over (order by (cand.r_tribe = i.tribe_id) desc, cand.r_degree desc, cand.r_goal desc, cand.r_community desc,
                                              cand.r_published asc nulls last, cand.r_tribe))::smallint as rk
            from public.match_candidates(i.person_id) cand
           where cand.r_degree >= m.min_degree or cand.r_tribe = i.tribe_id) ranked
   where ranked.rk <= 3;
  get diagnostics v_kept = row_count;
  update public.match_runs set shown = v_kept where id = v_run;
  update public.match_recommendations set chosen = true where run_id = v_run and tribe_id = i.tribe_id;

  insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, model_version, run_id, agreement_version, covenant,
                                    first_meeting_by, placed_by_run, placement_source, contact_withheld)
  values (t.id, i.person_id, t.season_id, 1, v_degree, m.version, v_run, 'auto-pending',
          jsonb_build_object('name', t.name, 'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
          greatest(current_date, se.starts_on) + 14, p_run, 'auto', public.placement_contact_refused(i.person_id))
  returning * into tm;
  delete from public.match_demand where person_id = i.person_id;

  -- The join trigger has just written the standard welcome email and the "someone joined" email for the leader. This run sends its own,
  -- so the two standard ones are withdrawn in the same transaction, before anything can claim them.
  delete from public.messages x
   where x.status = 'queued' and (x.dedupe_key = 'welcome:' || tm.id or x.dedupe_key like 'newmember:' || tm.id || ':%');

  v_msg := public.enqueue_message(i.person_id, 'placement_your_tribe', v_params, t.id, 'placement:' || tm.id, v_at, p_force => 'email');
  v_tok := public.placement_token_mint(tm.id, i.person_id, 60);
  update public.messages set reply_token = v_tok where id = v_msg;
  v_tok := public.placement_token_mint(tm.id, i.person_id, 60);
  v_msg := public.enqueue_message(i.person_id, 'placement_reminder', v_params, t.id, 'placement-reminder:' || tm.id, v_at + make_interval(days => v_days), p_force => 'email');
  update public.messages set reply_token = v_tok where id = v_msg;

  update public.placement_items
     set status = 'placed', degree = v_degree, placement_id = tm.id, placed_at = now(), slot_at = v_at,
         member_message = (select x.id from public.messages x where x.dedupe_key = 'placement:' || tm.id)
   where id = i.id;
  update public.placement_runs set told = told + 1 where id = p_run;
  perform public.write_event(auth.uid(), 'placement.placed', 'tribe', t.id::text, jsonb_build_object('run', p_run, 'degree', v_degree));
  return null;
end;
$$;
create or replace function public.placement_do_change(p_tm uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  s public.seasons%rowtype;
begin
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select * into s from public.seasons x where x.id = tm.season_id;
  if s.starts_on <= public.today_lagos() then
    return jsonb_build_object('ok', false, 'reason', 'started');
  end if;
  update public.tribe_members set status = 'released', released_at = now(), release_reason = 'Chose to look at other tribes' where id = tm.id;
  update public.match_recommendations set chosen = false where run_id = tm.run_id and tribe_id = tm.tribe_id;
  update public.messages set status = 'skipped', error = 'changed', reply_token = null
   where status = 'queued' and dedupe_key in ('placement:' || tm.id, 'placement-reminder:' || tm.id, 'placement-withheld:' || tm.id);
  perform public.write_event(tm.person_id, 'placement.changed', 'tribe', tm.tribe_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;
CREATE OR REPLACE FUNCTION public.placement_state(p_tm uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_queued boolean;
  v_c jsonb;
  v_group boolean;
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into t from public.tribes x where x.id = tm.tribe_id;
  select * into s from public.seasons x where x.id = tm.season_id;
  v_c := public.placement_contact(p_tm);
  v_group := public.placement_group_open(p_tm);
  select coalesce(bool_or(pt.mail_queued_at is not null), false) into v_queued
    from public.placement_teams pt where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id;
  return jsonb_build_object(
    'found', true,
    'first_name', public.first_name_of(tm.person_id),
    'active', tm.status = 'active',
    'placed_by_church', tm.placement_source = 'auto',
    'confirmed', tm.confirmed_at is not null,
    'withheld', tm.contact_withheld,
    'leader_told', v_queued,
    -- Whether the leader has this member's contact yet ('open', or 'holding' until the date, 'waiting' for the email, 'not_reached'), and the group link
    'contact', v_c ->> 'state',
    'contact_opens_at', v_c -> 'opens_at',
    'contact_late', coalesce((v_c ->> 'late')::boolean, false),
    'group_visible', v_group,
    'group_opens_at', case when not v_group and (v_c ->> 'state') = 'holding' then v_c -> 'opens_at' end,
    'can_change', tm.status = 'active' and s.starts_on > public.today_lagos(),
    'fit', public.degree_label(tm.degree),
    'tribe', jsonb_build_object(
      'name', t.name, 'leader_first', public.first_name_of(t.leader_id),
      'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
      'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
      'place_note', t.place_note, 'group_url', case when v_group then t.whatsapp_group_url end, 'first_meeting_on', t.first_meeting_on,
      'first_meeting_by', tm.first_meeting_by, 'season', s.name, 'starts_on', s.starts_on,
      'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(tm.person_id, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = tm.person_id), false));
end;
$function$;
CREATE OR REPLACE FUNCTION public.placement_member_params(p_tribe uuid, p_person uuid, p_degree integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  v_hold integer := (select st.hold_hours::integer from public.placement_settings st where st.singleton);
  -- The group shows everyone in it your number, so the link goes with the first email only to a member who has already answered about
  -- sharing (agreed on the form, or said no there), or when God Mode has switched the wait off. Everyone else is told when it will appear.
  v_open boolean := not coalesce((select st.hold_group_link from public.placement_settings st where st.singleton), true)
                    or public.consent_granted(p_person, 'team_contact') or public.placement_contact_refused(p_person);
begin
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.seasons x where x.id = t.season_id;
  return jsonb_build_object(
    'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
    'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
    'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
    'place_note', t.place_note,
    'group_url', case when v_open then t.whatsapp_group_url end,
    'group_held', not v_open and t.whatsapp_group_url is not null,
    'first_meeting_by', greatest(current_date, s.starts_on) + 14, 'first_meeting_on', t.first_meeting_on,
    'season', s.name, 'starts_on', s.starts_on, 'fit', public.degree_label(p_degree),
    'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life,
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(p_person, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = p_person), false),
    'agreed_to_share', public.consent_granted(p_person, 'team_contact'),
    'hold_hours', v_hold);
end;
$function$;
create or replace function public.placement_teams_refresh(p_run uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.placement_runs;
begin
  select * into r from public.placement_runs x where x.id = p_run;
  if not found then
    return;
  end if;
  insert into public.placement_teams (run_id, tribe_id, active_before, proposed)
  select p_run, i.tribe_id,
         (select count(*)::integer from public.tribe_members m where m.tribe_id = i.tribe_id and m.status = 'active'),
         count(*)::integer
    from public.placement_items i
   where i.run_id = p_run and i.status = 'proposed' and i.tribe_id is not null
   group by i.tribe_id
  on conflict (run_id, tribe_id) do update set active_before = excluded.active_before, proposed = excluded.proposed;

  update public.placement_teams t set proposed = 0
   where t.run_id = p_run
     and not exists (select 1 from public.placement_items i where i.run_id = p_run and i.tribe_id = t.tribe_id and i.status = 'proposed');

  update public.placement_teams t
     set small = (t.proposed > 0 and t.active_before + t.proposed < least(r.min_tribe, tr.capacity))
    from public.tribes tr
   where tr.id = t.tribe_id and t.run_id = p_run;

  -- A decision to keep a small tribe only stands while the tribe is still small. "Hold" and "retry" are a record of what was chosen.
  update public.placement_teams t set decision = null where t.run_id = p_run and not t.small and t.decision = 'keep';
  update public.placement_teams t set decision = null where t.run_id = p_run and t.small and t.decision in ('hold', 'retry');
end;
$$;
create or replace function public.placement_run_new(p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.placement_settings;
  k text;
  v_season uuid;
  v_community uuid;
  v_zone text;
  v_model text;
  v_run uuid := gen_random_uuid();
  v_pool integer;
  v_centre uuid;
  o jsonb := coalesce(p_options, '{}'::jsonb);
begin
  perform public.god_only();
  if public.placement_mode() = 'off' then
    raise exception 'Placement is switched Off. Switch it to Rehearsal or On first' using errcode = '22023';
  end if;
  if jsonb_typeof(o) is distinct from 'object' then
    raise exception 'Say what to plan' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(o) loop
    if k not in ('season', 'community', 'zone', 'grace_days', 'seats_free', 'min_tribe', 'pace_per_hour') then
      raise exception 'That choice does not exist' using errcode = '22023';
    end if;
  end loop;
  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  if v_model is null then
    raise exception 'There is no active matching model, so nobody can be scored' using errcode = '22023';
  end if;
  v_season := coalesce(nullif(o ->> 'season', '')::uuid, public.leader_fit_season());
  select se.centre_id into v_centre from public.seasons se
   where se.id = v_season and se.status in ('planning', 'open') and se.starts_on > public.today_lagos();
  if v_centre is null then
    raise exception 'Choose a season that has not started' using errcode = '22023';
  end if;
  v_community := nullif(o ->> 'community', '')::uuid;
  if v_community is not null and not exists (select 1 from public.communities c where c.id = v_community) then
    raise exception 'That community does not exist' using errcode = '22023';
  end if;
  v_zone := nullif(o ->> 'zone', '');
  if v_zone is not null and v_zone not in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad') then
    raise exception 'That area does not exist' using errcode = '22023';
  end if;

  begin
    insert into public.placement_runs (id, season_id, rehearsal, scope_community, scope_zone, grace_days, seats_free, min_tribe, pace_per_hour,
                                       send_from, send_until, hold_hours, model_version)
    values (v_run, v_season, public.placement_mode() = 'rehearsal', v_community, v_zone,
            coalesce((o ->> 'grace_days')::integer, s.grace_days), coalesce((o ->> 'seats_free')::integer, s.seats_free),
            coalesce((o ->> 'min_tribe')::integer, s.min_tribe), coalesce((o ->> 'pace_per_hour')::integer, s.pace_per_hour),
            s.send_from, s.send_until, s.hold_hours, v_model);
  exception
    when unique_violation then
      raise exception 'A run is already in progress. Finish it or cancel it first' using errcode = '22023';
    when check_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'One of those numbers is outside what is allowed' using errcode = '22023';
  end;

  -- The pool: members of this church with no seat this season, who do not lead a tribe. Who is out, and why, is worked out batch by batch.
  insert into public.placement_items (run_id, person_id)
  select v_run, p.id
    from public.people p
   where p.centre_id = v_centre and not p.hidden
     and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role = 'member')
     and not exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))
     and not exists (select 1 from public.platform_owner w where w.person_id = p.id)
     and not exists (select 1 from public.tribe_members m where m.person_id = p.id and m.season_id = v_season and m.status = 'active')
     and (v_community is null or exists (select 1 from public.member_profiles mp where mp.person_id = p.id and mp.community_id = v_community))
     and (v_zone is null or exists (select 1 from public.member_profiles mp where mp.person_id = p.id and mp.zone = v_zone));
  get diagnostics v_pool = row_count;
  update public.placement_runs set pool = v_pool where id = v_run;

  perform public.write_event(auth.uid(), 'placement.run_new', 'placement_run', v_run::text,
    jsonb_build_object('pool', v_pool, 'rehearsal', public.placement_mode() = 'rehearsal'));
  return jsonb_build_object('run', v_run, 'pool', v_pool);
end;
$$;
create or replace function public.leader_fit_season()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.seasons where status in ('planning', 'open') order by starts_on limit 1;
$$;
-- The Tribe Card start looks up the season as it did
CREATE OR REPLACE FUNCTION public.start_tribe_card()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  existing uuid;
  season uuid;
  app jsonb;
  t_id uuid;
  tr_id uuid;
  g_id uuid;
  locked_fields text[] := '{}';
  first_name text;
  suggested text;
  community_name text;
  new_id uuid;
begin
  if not public.has_role('leader') then
    raise exception 'Tribe Cards are for approved tribe leaders' using errcode = '42501';
  end if;
  select id into existing from public.tribes where leader_id = me and status <> 'closed' order by created_at desc limit 1;
  if existing is not null then
    return existing;
  end if;
  select id into season from public.seasons where status in ('planning', 'open') order by starts_on limit 1;
  if season is null then
    raise exception 'No season is open for Tribe Cards yet. The office will open one' using errcode = '22023';
  end if;

  select a.answers into app from public.leader_applications a
   where a.person_id = me and a.status = 'approved_leader' order by a.decided_at desc nulls last limit 1;
  if app is not null then
    select id into t_id from public.tracks where slug = app #>> '{calling,track}' and active;
    select id, name into tr_id, community_name from public.communities where slug = app #>> '{calling,community}' and active;
    if tr_id is not null then
      select id into g_id from public.season_goals where slug = app #>> '{calling,goal}' and community_id = tr_id and active;
    end if;
    if t_id is not null then locked_fields := array_append(locked_fields, 'track'); end if;
    if tr_id is not null then locked_fields := array_append(locked_fields, 'community'); end if;
    if g_id is not null then locked_fields := array_append(locked_fields, 'goal'); end if;
  end if;

  select coalesce(nullif(btrim(preferred_name), ''), split_part(btrim(coalesce(full_name, '')), ' ', 1)) into first_name
    from public.people where id = me;
  if first_name is not null and first_name <> '' and community_name is not null then
    suggested := first_name || '’s ' || community_name || ' tribe';
    if char_length(suggested) > 48 then suggested := null; end if;
  end if;

  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed)
  values (season, me, suggested, t_id, tr_id, g_id, locked_fields)
  returning id into new_id;
  perform public.write_event(me, 'tribe.started', 'tribe', new_id::text, '{}'::jsonb);
  return new_id;
end;
$function$;

drop function if exists public.placement_one_place(uuid, uuid, text[], text, boolean);
drop function if exists public.placement_one_check(uuid, uuid);
drop function if exists public.placement_one_options(uuid);
drop function if exists public.season_joining_window(uuid);
drop function if exists public.placement_first_meeting_by(date);
drop function if exists public.placement_change_open(date);
drop function if exists public.placement_week(uuid);
drop function if exists public.placement_season();
commit;

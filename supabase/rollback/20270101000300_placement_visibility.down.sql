-- Way back from "one rule for who sees a church-placed member"
--
-- Puts every function this change replaced back exactly as it stood, and drops the five it added. The three columns it added
-- (placement_teams.contact_opened_at, placement_settings.hold_group_link, placement_settings.last_tick_at) are LEFT, with their values: nothing
-- reads them once the functions are gone, and nothing is lost. After this:
--   * a leader's lists show a church-placed member only after the "Your team" email for the tribe has been queued, as before (the raw
--     lists are unfiltered again, so the Dashboard and any direct call show everyone);
--   * the group link is shown to a placed member at once, as before;
--   * the heartbeat does nothing with the switch Off, and the leader's email waits for every member email plus the hold, as before.
-- Members already placed stay placed. Run it as the database owner. Running it twice changes nothing.
-- Roll the application files back first (the God Mode board and the leader pages read fields these functions add).

begin;

drop function if exists public.placement_open_all(uuid);
drop function if exists public.placement_open_now(uuid, uuid);

-- public.placement_run_view(uuid)
CREATE OR REPLACE FUNCTION public.placement_run_view(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.id = p_run;
  if not found then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'run', jsonb_build_object(
      'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told,
      'created_at', r.created_at, 'planned_at', r.planned_at, 'approved_at', r.approved_at, 'placed_at', r.placed_at, 'closed_at', r.closed_at,
      'undone_at', r.undone_at, 'grace_days', r.grace_days, 'seats_free', r.seats_free, 'min_tribe', r.min_tribe, 'pace_per_hour', r.pace_per_hour,
      'send_from', r.send_from, 'send_until', r.send_until, 'hold_hours', r.hold_hours,
      'scope_community', (select c.name from public.communities c where c.id = r.scope_community), 'scope_zone', r.scope_zone,
      'season', (select s.name from public.seasons s where s.id = r.season_id)),
    'counts', coalesce((select jsonb_object_agg(z.status, z.n) from (select i.status, count(*)::integer as n from public.placement_items i where i.run_id = p_run group by i.status) z), '{}'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('status', z.status, 'reason', z.reason, 'n', z.n) order by z.n desc, z.reason)
                           from (select i.status, i.reason, count(*)::integer as n from public.placement_items i
                                  where i.run_id = p_run and i.reason is not null group by i.status, i.reason) z), '[]'::jsonb),
    'fit', coalesce((select jsonb_object_agg(z.label, z.n) from (select public.degree_label(i.degree) as label, count(*)::integer as n
                       from public.placement_items i where i.run_id = p_run and i.status in ('proposed', 'placed', 'rehearsed') group by 1) z), '{}'::jsonb),
    'days', (select ceil(count(*)::numeric / greatest(r.pace_per_hour * (r.send_until - r.send_from), 1))::integer
               from public.placement_items i where i.run_id = p_run and i.status in ('proposed', 'placed', 'rehearsed')),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tribe', t.id, 'name', t.name, 'leader_first', public.first_name_of(t.leader_id), 'capacity', t.capacity,
               'active_before', pt.active_before, 'proposed', pt.proposed, 'small', pt.small, 'decision', pt.decision,
               'mail_queued_at', pt.mail_queued_at, 'cancelled_at', pt.cancelled_at,
               'placed', (select count(*) from public.placement_items i where i.run_id = p_run and i.tribe_id = t.id and i.status in ('placed', 'rehearsed')),
               'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.confirmed_at is not null),
               'withheld', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'active' and m.contact_withheld),
               'changed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.tribe_id = t.id and m.status = 'released'),
               'fit', coalesce((select jsonb_object_agg(z.label, z.n) from (
                         select public.degree_label(i.degree) as label, count(*)::integer as n from public.placement_items i
                          where i.run_id = p_run and i.tribe_id = t.id and i.status in ('proposed', 'placed', 'rehearsed') group by 1) z), '{}'::jsonb))
             order by pt.small desc, t.name)
        from public.placement_teams pt join public.tribes t on t.id = pt.tribe_id where pt.run_id = p_run and (pt.proposed > 0 or pt.mail_queued_at is not null)), '[]'::jsonb),
    'results', jsonb_build_object(
      'placed', (select count(*) from public.placement_items i where i.run_id = p_run and i.status = 'placed'),
      'confirmed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'active' and m.confirmed_at is not null),
      'withheld', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'active' and m.contact_withheld),
      'changed', (select count(*) from public.tribe_members m where m.placed_by_run = p_run and m.status = 'released' and m.release_reason = 'Chose to look at other tribes'),
      'messages', coalesce((select jsonb_object_agg(z.status, z.n) from (
                    select msg.status, count(*)::integer as n from public.placement_items i join public.messages msg on msg.id = i.member_message
                     where i.run_id = p_run group by msg.status) z), '{}'::jsonb),
      'leaders_told', (select count(*) from public.placement_teams pt where pt.run_id = p_run and pt.mail_queued_at is not null),
      'leaders_waiting', (select count(*) from public.placement_teams pt where pt.run_id = p_run and pt.proposed > 0 and pt.mail_queued_at is null and pt.cancelled_at is null)));
end;
$function$;

-- public.placement_settings_save(jsonb)
CREATE OR REPLACE FUNCTION public.placement_settings_save(p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k text;
  s public.placement_settings;
  v_mode text;
  v_int integer;
begin
  perform public.god_only();
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'Say what to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('mode', 'grace_days', 'seats_free', 'min_tribe', 'pace_per_hour', 'send_from', 'send_until', 'hold_hours', 'reminder_days') then
      raise exception 'That setting does not exist' using errcode = '22023';
    end if;
  end loop;
  select * into s from public.placement_settings x where x.singleton for update;
  if p_changes ? 'mode' then
    v_mode := p_changes ->> 'mode';
    if v_mode is null or v_mode not in ('off', 'rehearsal', 'on') then
      raise exception 'Choose Off, Rehearsal or On' using errcode = '22023';
    end if;
    s.mode := v_mode;
  end if;
  foreach k in array array['grace_days', 'seats_free', 'min_tribe', 'pace_per_hour', 'send_from', 'send_until', 'hold_hours', 'reminder_days'] loop
    continue when not (p_changes ? k);
    if jsonb_typeof(p_changes -> k) is distinct from 'number' or (p_changes ->> k) !~ '^[0-9]{1,4}$' then
      raise exception 'Use a whole number for %', replace(k, '_', ' ') using errcode = '22023';
    end if;
    v_int := (p_changes ->> k)::integer;
    case k
      when 'grace_days' then s.grace_days := v_int;
      when 'seats_free' then s.seats_free := v_int;
      when 'min_tribe' then s.min_tribe := v_int;
      when 'pace_per_hour' then s.pace_per_hour := v_int;
      when 'send_from' then s.send_from := v_int;
      when 'send_until' then s.send_until := v_int;
      when 'hold_hours' then s.hold_hours := v_int;
      when 'reminder_days' then s.reminder_days := v_int;
    end case;
  end loop;
  begin
    update public.placement_settings
       set mode = s.mode, grace_days = s.grace_days, seats_free = s.seats_free, min_tribe = s.min_tribe, pace_per_hour = s.pace_per_hour,
           send_from = s.send_from, send_until = s.send_until, hold_hours = s.hold_hours, reminder_days = s.reminder_days, updated_at = now()
     where singleton;
  exception when check_violation then
    raise exception 'One of those numbers is outside what is allowed. Grace 0 to 30 days, seats kept free 0 to 2, smallest tribe 4 to 8, pace 1 to 1000 an hour, sending between 6 am and 9 pm' using errcode = '22023';
  end;
  perform public.write_event(auth.uid(), 'placement.settings', 'placement', 'settings', p_changes);
  return public.placement_settings_get();
end;
$function$;

-- public.placement_settings_get()
CREATE OR REPLACE FUNCTION public.placement_settings_get()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.placement_settings;
begin
  perform public.god_only();
  select * into s from public.placement_settings x where x.singleton;
  return jsonb_build_object(
    'mode', public.placement_mode(), 'grace_days', s.grace_days, 'seats_free', s.seats_free, 'min_tribe', s.min_tribe,
    'pace_per_hour', s.pace_per_hour, 'send_from', s.send_from, 'send_until', s.send_until, 'hold_hours', s.hold_hours,
    'reminder_days', s.reminder_days, 'floor', public.placement_floor());
end;
$function$;

-- public.placement_place_batch(uuid,integer)
CREATE OR REPLACE FUNCTION public.placement_place_batch(p_run uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
  i public.placement_items;
  v_done integer := 0;
  v_skipped integer := 0;
  v_left integer;
  v_res text;
  v_start timestamptz := clock_timestamp();
begin
  select * into r from public.placement_runs x where x.id = p_run for update;
  if not found or r.status not in ('approved', 'placing') then
    return jsonb_build_object('status', coalesce(r.status, 'none'), 'done', 0, 'left', 0);
  end if;
  if r.status = 'approved' then
    update public.placement_runs set status = 'placing' where id = p_run;
  end if;
  for i in select x.* from public.placement_items x where x.run_id = p_run and x.status = 'proposed' order by x.seq, x.id limit greatest(p_limit, 1) loop
    -- A step is kept short: after about four seconds it stops, and the page asks for the next one
    exit when v_done > 0 and clock_timestamp() - v_start > interval '4 seconds';
    v_res := public.placement_place_item(p_run, i.id);
    v_done := v_done + 1;
    if v_res is not null then
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  select count(*)::integer into v_left from public.placement_items x where x.run_id = p_run and x.status = 'proposed';
  if v_left = 0 then
    update public.placement_runs set status = 'placed', placed_at = now() where id = p_run;
    if r.rehearsal then
      perform public.placement_rehearse_teams(p_run);
      update public.placement_runs set status = 'closed', closed_at = now() where id = p_run;
    end if;
  end if;
  return jsonb_build_object('status', (select x.status from public.placement_runs x where x.id = p_run), 'done', v_done, 'skipped', v_skipped, 'left', v_left);
end;
$function$;

-- public.placement_tick()
CREATE OR REPLACE FUNCTION public.placement_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mode text := public.placement_mode();
  r public.placement_runs;
  v_started timestamptz := clock_timestamp();
  v_batches integer := 0;
  v_teams integer := 0;
  v_cleared integer := 0;
  v jsonb;
begin
  if v_mode = 'off' then
    return jsonb_build_object('mode', 'off');
  end if;
  loop
    select * into r from public.placement_runs x
     where x.status in ('approved', 'placing') and x.rehearsal = (v_mode = 'rehearsal') order by x.seq limit 1;
    exit when not found or clock_timestamp() - v_started > interval '20 seconds';
    v := public.placement_place_batch(r.id, 50);
    v_batches := v_batches + 1;
    exit when (v ->> 'left')::integer = 0 and (v ->> 'done')::integer = 0;
  end loop;
  for r in select x.* from public.placement_runs x where x.status in ('placing', 'placed', 'undone') and not x.rehearsal order by x.seq loop
    v_teams := v_teams + public.placement_team_mail(r.id);
  end loop;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('placement_your_tribe', 'placement_reminder', 'placement_withheld')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  delete from public.placement_tokens where expires_at < now();
  return jsonb_build_object('mode', v_mode, 'batches', v_batches, 'teams', v_teams, 'cleared', v_cleared);
end;
$function$;

-- public.placement_team_mail(uuid)
CREATE OR REPLACE FUNCTION public.placement_team_mail(p_run uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.placement_runs;
  tm public.placement_teams;
  t public.tribes%rowtype;
  v_pending integer;
  v_last timestamptz;
  v_all_agreed boolean;
  v_members jsonb;
  v_count integer;
  v_first date;
  v_queued integer := 0;
  who uuid;
begin
  select * into r from public.placement_runs x where x.id = p_run;
  if not found or r.rehearsal or r.status not in ('placing', 'placed', 'undone') or public.placement_mode() <> 'on' then
    return 0;
  end if;
  for tm in select x.* from public.placement_teams x where x.run_id = p_run and x.mail_queued_at is null and x.cancelled_at is null and x.proposed > 0
            order by x.tribe_id for update loop
    select * into t from public.tribes x where x.id = tm.tribe_id;
    continue when exists (select 1 from public.placement_items x where x.run_id = p_run and x.tribe_id = tm.tribe_id and x.status = 'proposed');
    -- Members still in this tribe from this run, and how their first email went
    select count(*) filter (where msg.status in ('queued', 'sending') or msg.id is null)::integer,
           max(msg.sent_at) filter (where msg.status in ('sent', 'delivered', 'read')),
           coalesce(bool_and(public.consent_granted(x.person_id, 'team_contact')) filter (where msg.status in ('sent', 'delivered', 'read')), true)
      into v_pending, v_last, v_all_agreed
      from public.tribe_members x
      left join public.placement_items i on i.placement_id = x.id
      left join public.messages msg on msg.id = i.member_message
     where x.tribe_id = tm.tribe_id and x.placed_by_run = p_run and x.status = 'active';
    continue when v_pending > 0;
    continue when v_last is not null and not v_all_agreed and now() < v_last + make_interval(hours => r.hold_hours);

    select coalesce(jsonb_agg(jsonb_build_object(
             'name', public.person_display_name(x.person_id),
             'email', case when x.contact_withheld then null else pe.email end,
             'whatsapp', case when x.contact_withheld then null
                              else (case when public.consent_granted(x.person_id, 'whatsapp') then mp.whatsapp end) end,
             'withheld', x.contact_withheld) order by public.person_display_name(x.person_id), x.id), '[]'::jsonb),
           count(*)::integer, min(x.first_meeting_by)
      into v_members, v_count, v_first
      from public.tribe_members x
      join public.people pe on pe.id = x.person_id
      left join public.member_profiles mp on mp.person_id = x.person_id
      join public.placement_items i on i.placement_id = x.id
      join public.messages msg on msg.id = i.member_message and msg.status in ('sent', 'delivered', 'read')
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
$function$;

-- public.placement_do_withhold(uuid)
CREATE OR REPLACE FUNCTION public.placement_do_withhold(p_tm uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tm public.tribe_members%rowtype;
  v_queued boolean;
  v_params jsonb;
begin
  select * into tm from public.tribe_members x where x.id = p_tm for update;
  if not found or tm.status <> 'active' or tm.placement_source <> 'auto' then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select coalesce(bool_or(pt.mail_queued_at is not null), false) into v_queued
    from public.placement_teams pt where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id;
  if v_queued then
    return jsonb_build_object('ok', true, 'late', true);
  end if;
  if not tm.contact_withheld then
    update public.tribe_members set contact_withheld = true where id = tm.id;
    -- A refusal outlasts this seat: if they are placed again, their details are withheld from the start
    insert into public.consents (person_id, purpose, granted, version) values (tm.person_id, 'team_contact', false, 'placement-link');
    -- Their tribe's details come to them instead, with a line asking them to reach out
    v_params := public.placement_member_params(tm.tribe_id, tm.person_id, tm.degree);
    perform public.enqueue_message(tm.person_id, 'placement_withheld', v_params, tm.tribe_id, 'placement-withheld:' || tm.id, p_force => 'email');
    perform public.write_event(tm.person_id, 'placement.withheld', 'tribe', tm.tribe_id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'late', false);
end;
$function$;

-- public.placement_member_params(uuid,uuid,integer)
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
begin
  select * into t from public.tribes x where x.id = p_tribe;
  select * into s from public.seasons x where x.id = t.season_id;
  return jsonb_build_object(
    'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
    'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
    'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
    'place_note', t.place_note, 'group_url', t.whatsapp_group_url,
    'first_meeting_by', greatest(current_date, s.starts_on) + 14, 'first_meeting_on', t.first_meeting_on,
    'season', s.name, 'starts_on', s.starts_on, 'fit', public.degree_label(p_degree),
    'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life,
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(p_person, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = p_person), false),
    'agreed_to_share', public.consent_granted(p_person, 'team_contact'),
    'hold_hours', v_hold);
end;
$function$;

-- public.placement_state(uuid)
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
begin
  select * into tm from public.tribe_members x where x.id = p_tm;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into t from public.tribes x where x.id = tm.tribe_id;
  select * into s from public.seasons x where x.id = tm.season_id;
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
    'can_change', tm.status = 'active' and s.starts_on > public.today_lagos(),
    'fit', public.degree_label(tm.degree),
    'tribe', jsonb_build_object(
      'name', t.name, 'leader_first', public.first_name_of(t.leader_id),
      'assistant_first', case when t.assistant_id is not null then public.first_name_of(t.assistant_id) end,
      'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
      'place_note', t.place_note, 'group_url', t.whatsapp_group_url, 'first_meeting_on', t.first_meeting_on,
      'first_meeting_by', tm.first_meeting_by, 'season', s.name, 'starts_on', s.starts_on,
      'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(tm.person_id, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = tm.person_id), false));
end;
$function$;

-- public.my_week(integer)
CREATE OR REPLACE FUNCTION public.my_week(p_view integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  pm public.tribe_members%rowtype;
  c public.tribes%rowtype;
  s public.seasons%rowtype;
  g public.week_guides%rowtype;
  st public.week_steps%rowtype;
  today date := public.today_lagos();
  cw integer;
  gw integer;
  state text;
  ws date;
  check_target integer;
  pulse_target integer;
  nudges jsonb := '[]'::jsonb;
  have_step boolean := false;
  testimony_n integer;
  attended_n integer;
  logged_n integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into pm from public.current_placement(uid);
  if not found then
    return jsonb_build_object('placed', false);
  end if;
  select * into c from public.tribes where id = pm.tribe_id;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;

  select count(*) filter (where a.status = 'present') into attended_n
    from public.tribe_attendance a where a.tribe_id = c.id and a.person_id = uid;
  select count(*) into logged_n from public.tribe_logs l where l.tribe_id = c.id and l.held;
  select count(*) into testimony_n from public.testimonies t
   where t.person_id = uid and t.tribe_id = c.id and t.status not in ('withdrawn', 'declined');

  if state = 'running' then
    ws := s.starts_on + (cw - 1) * 7;
    -- A member can read any week that has started; the guide shown is the one they ask for
    gw := case when p_view between 1 and cw then p_view else cw end;
    select * into g from public.week_guides where week = gw;
    select * into st from public.week_steps where person_id = uid and tribe_id = c.id and week = gw;
    have_step := found;
    if not exists (select 1 from public.week_steps x where x.person_id = uid and x.tribe_id = c.id and x.week = cw) then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'set_step', 'week', cw));
    end if;
  end if;

  -- The last check-in and the last pulse stay open for a little while after the final week
  if state in ('running', 'complete') then
    select x.week into check_target from public.week_steps x
     where x.person_id = uid and x.tribe_id = c.id and x.outcome is null and x.week <= cw
       and today between s.starts_on + (x.week - 1) * 7 + 5 and s.starts_on + (x.week - 1) * 7 + 9
     order by x.week desc limit 1;

    select gs.w into pulse_target from generate_series(1, s.weeks) as gs(w)
     where public.is_pulse_week(gs.w, s.weeks) and gs.w <= cw
       and today between s.starts_on + (gs.w - 1) * 7 and s.starts_on + (gs.w - 1) * 7 + 13
       and not exists (select 1 from public.pulses p where p.person_id = uid and p.tribe_id = c.id and p.week = gs.w)
     order by gs.w desc limit 1;

    if check_target is not null then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'check_in', 'week', check_target));
    end if;
    if pulse_target is not null then
      nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'pulse', 'week', pulse_target));
    end if;
  end if;
  if (state = 'complete' or cw >= s.weeks - 2) and testimony_n = 0 then
    nudges := nudges || jsonb_build_array(jsonb_build_object('kind', 'testimony', 'week', least(greatest(cw, 1), s.weeks)));
  end if;

  return jsonb_build_object(
    'placed', true,
    'state', state,
    'week', case when state = 'running' then cw end,
    'viewing', case when state = 'running' then gw end,
    'weeks', s.weeks,
    'starts_on', s.starts_on,
    'ends_on', s.starts_on + s.weeks * 7 - 1,
    'days_to_start', case when state = 'before' then s.starts_on - today end,
    'season_name', s.name,
    'tribe', jsonb_build_object(
      'id', c.id, 'name', c.name, 'leader_first_name', public.first_name_of(c.leader_id),
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
      'meeting_mode', c.meeting_mode, 'group_url', c.whatsapp_group_url,
      'meeting_date', case when state = 'running' then public.meeting_date_of(c.id, gw) end),
    'picture', jsonb_build_object(
      'god', coalesce(c.final_god, c.loving_god),
      'others', coalesce(c.final_others, c.loving_others),
      'life', coalesce(c.final_life, c.loving_life),
      'refined', c.picture_refined_at is not null),
    'guide', case when state = 'running' and g.week is not null then jsonb_build_object(
      'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
      'opening_question', g.opening_question, 'questions', to_jsonb(g.questions), 'practice', g.practice,
      'step_hint', g.step_hint, 'prayer', g.prayer) end,
    'step', case when have_step then jsonb_build_object(
      'week', st.week, 'when', st.when_text, 'will', st.will_text, 'outcome', st.outcome, 'reflection', st.reflection) end,
    'check_in', jsonb_build_object(
      'week', check_target,
      'opens_on', case when state = 'running' then ws + 5 end,
      'closes_on', case when state = 'running' then ws + 9 end),
    'pulse_week', pulse_target,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'week', gs.w,
               'state', case when gs.w < cw then 'past' when gs.w = cw then 'now' else 'future' end,
               'held', (select l.held from public.tribe_logs l where l.tribe_id = c.id and l.week = gs.w),
               'attended', (select a.status from public.tribe_attendance a
                             where a.tribe_id = c.id and a.week = gs.w and a.person_id = uid),
               'step', (select coalesce(x.outcome, 'set') from public.week_steps x
                         where x.person_id = uid and x.tribe_id = c.id and x.week = gs.w)) order by gs.w)
        from generate_series(1, s.weeks) as gs(w)), '[]'::jsonb),
    'attended', attended_n,
    'logged', logged_n,
    'testimonies', testimony_n,
    'nudges', nudges);
end;
$function$;

-- public.my_match()
CREATE OR REPLACE FUNCTION public.my_match()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  has_profile boolean;
  run public.match_runs%rowtype;
  place public.tribe_members%rowtype;
  placement jsonb := null;
  shown jsonb := '[]'::jsonb;
  on_list boolean := false;
  season jsonb := null;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select exists (select 1 from public.member_profiles where person_id = uid) into has_profile;

  select s.* into place
    from public.tribe_members s
   where s.person_id = uid and s.status = 'active'
   order by s.joined_at desc limit 1;
  if found then
    select jsonb_build_object(
      'tribe', public.match_card(place.tribe_id),
      'rank', place.chosen_rank,
      'degree', place.degree,
      'label', public.degree_label(place.degree),
      'joined_at', place.joined_at,
      'agreed_at', place.agreed_at,
      'covenant', place.covenant,
      'first_meeting_by', place.first_meeting_by,
      'first_meeting_on', c.first_meeting_on,
      'group_url', c.whatsapp_group_url,
      'called', place.called_at is not null,
      'assistant_first_name', case when c.assistant_id is null then null else public.first_name_of(c.assistant_id) end,
      'can_release', s.starts_on > current_date,
      'season_name', s.name,
      'season_starts_on', s.starts_on)
      into placement
      from public.tribes c
      join public.seasons s on s.id = c.season_id
     where c.id = place.tribe_id;
  end if;

  select r.* into run from public.match_runs r where r.person_id = uid order by r.ran_at desc limit 1;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', x.rank,
             'degree', x.degree,
             'label', public.degree_label(x.degree),
             'reasons', to_jsonb(x.reasons),
             'chosen', x.chosen,
             'tribe', public.match_card(x.tribe_id)) order by x.rank), '[]'::jsonb)
      into shown
      from public.match_recommendations x
     where x.run_id = run.id;
  end if;

  select d.wants_starter into on_list from public.match_demand d where d.person_id = uid;

  select jsonb_build_object('name', s.name, 'starts_on', s.starts_on) into season
    from public.member_profiles mp join public.seasons s on s.id = mp.season_id
   where mp.person_id = uid;

  return jsonb_build_object(
    'profile', has_profile,
    'season', season,
    'ran', run.id is not null,
    'ran_at', run.ran_at,
    'model', run.model_version,
    'candidates', run.candidates,
    'tribes', shown,
    'short', run.id is not null and run.shown < 3,
    'on_starter_list', coalesce(on_list, false),
    'placement', placement);
end;
$function$;

-- public.tribe_week(uuid,integer)
CREATE OR REPLACE FUNCTION public.tribe_week(p_tribe uuid, p_week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  s public.seasons%rowtype;
  g public.week_guides%rowtype;
  lg public.tribe_logs%rowtype;
  today date := public.today_lagos();
  office boolean := public.has_any_role(array['pastor', 'director']::public.app_role[]);
  can_edit boolean;
  cw integer;
  state text;
  wk integer;
  ws date;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  can_edit := c.leader_id = uid or coalesce(c.assistant_id = uid, false);
  if not (can_edit or coalesce(c.coach_id = uid, false) or office) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  select * into s from public.seasons where id = c.season_id;
  cw := public.season_week(s.starts_on, s.weeks, today);
  state := case when cw = 0 then 'before' when cw > s.weeks then 'complete' else 'running' end;
  wk := case when p_week is not null then p_week
             when state = 'before' then 1
             when state = 'complete' then s.weeks
             else cw end;
  if wk < 1 or wk > s.weeks then
    raise exception 'That week does not exist' using errcode = 'P0002';
  end if;
  ws := s.starts_on + (wk - 1) * 7;
  select * into g from public.week_guides where week = wk;
  select * into lg from public.tribe_logs where tribe_id = p_tribe and week = wk;

  return jsonb_build_object(
    'tribe', jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity,
                                 'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI')),
    'state', state,
    'season_name', s.name,
    'starts_on', s.starts_on,
    'weeks', s.weeks,
    'current_week', case when state = 'running' then cw end,
    'week', wk,
    'week_starts_on', ws,
    'meeting_date', public.meeting_date_of(p_tribe, wk),
    'can_edit', can_edit,
    -- the leader can log a week that has started until the end of the week after it; the office any time
    'log_open', (can_edit or office) and wk <= cw and (office or today <= ws + 13),
    'guide', jsonb_build_object(
      'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
      'opening_question', g.opening_question, 'questions', to_jsonb(g.questions), 'practice', g.practice,
      'step_hint', g.step_hint, 'prayer', g.prayer, 'plan', g.plan, 'leader_tip', g.leader_tip),
    'picture', jsonb_build_object(
      'god', coalesce(c.final_god, c.loving_god), 'others', coalesce(c.final_others, c.loving_others),
      'life', coalesce(c.final_life, c.loving_life), 'refined', c.picture_refined_at is not null,
      'can_refine', can_edit and state = 'running' and cw <= 2),
    'log', case when lg.tribe_id is null then null else jsonb_build_object(
      'held', lg.held, 'highlight', lg.highlight, 'logged_at', lg.logged_at) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'first_name', public.first_name_of(m.person_id),
               'whatsapp', mp.whatsapp,
               'attendance', (select a.status from public.tribe_attendance a
                               where a.tribe_id = c.id and a.week = wk and a.person_id = m.person_id),
               'last_attendance', (select a.status from public.tribe_attendance a
                                    where a.tribe_id = c.id and a.person_id = m.person_id and a.week < wk
                                      and exists (select 1 from public.tribe_logs l where l.tribe_id = c.id and l.week = a.week and l.held)
                                    order by a.week desc limit 1),
               'attended', (select count(*) from public.tribe_attendance a
                             where a.tribe_id = c.id and a.person_id = m.person_id and a.status = 'present'),
               -- only whether the step was done, never what it was
               'step', (select coalesce(x.outcome, 'set') from public.week_steps x
                         where x.tribe_id = c.id and x.person_id = m.person_id and x.week = wk),
               'open_follow_up', exists (select 1 from public.care_flags f
                                          where f.tribe_id = c.id and f.person_id = m.person_id and f.status <> 'closed'))
             order by public.person_display_name(m.person_id))
        from public.tribe_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
       where m.tribe_id = c.id and m.status = 'active'), '[]'::jsonb),
    'logged_weeks', (select count(*) from public.tribe_logs l where l.tribe_id = c.id and l.held),
    'follow_ups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'person_id', f.person_id, 'name', public.person_display_name(f.person_id),
               'first_name', public.first_name_of(f.person_id), 'whatsapp', mp.whatsapp,
               'kind', f.kind, 'status', f.status, 'attempts', f.attempts, 'last_outcome', f.last_outcome,
               'note', f.note, 'opened_at', f.opened_at, 'last_called_at', f.last_called_at)
             order by f.opened_at)
        from public.care_flags f
        left join public.member_profiles mp on mp.person_id = f.person_id
       where f.tribe_id = c.id and f.status <> 'closed'), '[]'::jsonb),
    'celebrations', coalesce((
      select jsonb_agg(x order by (x ->> 'sort')::int, x ->> 'first_name')
        from (
          select jsonb_build_object('kind', 'birthday', 'first_name', public.first_name_of(m.person_id),
                   'on', d.d, 'sort', 1) as x
            from public.tribe_members m
            join public.member_profiles mp on mp.person_id = m.person_id
            cross join lateral (select (ws + i)::date as d from generate_series(0, 6) as i) d
           where m.tribe_id = c.id and m.status = 'active'
             and mp.birthday_month = extract(month from d.d)::int and mp.birthday_day = extract(day from d.d)::int
          union all
          select jsonb_build_object('kind', 'every_meeting', 'first_name', public.first_name_of(m.person_id), 'sort', 2)
            from public.tribe_members m
           where m.tribe_id = c.id and m.status = 'active'
             and (select count(*) from public.tribe_logs l where l.tribe_id = c.id and l.held and l.week < wk) >= 3
             and not exists (select 1 from public.tribe_logs l
                              where l.tribe_id = c.id and l.held and l.week < wk
                                and not exists (select 1 from public.tribe_attendance a
                                                 where a.tribe_id = c.id and a.week = l.week
                                                   and a.person_id = m.person_id and a.status = 'present'))
          union all
          select jsonb_build_object('kind', 'steps_streak', 'first_name', public.first_name_of(m.person_id), 'sort', 3)
            from public.tribe_members m
           where m.tribe_id = c.id and m.status = 'active' and wk >= 4
             and (select count(*) from public.week_steps x
                   where x.tribe_id = c.id and x.person_id = m.person_id and x.outcome = 'done'
                     and x.week between wk - 3 and wk - 1) = 3
        ) q), '[]'::jsonb),
    'report', public.tribe_week_report(p_tribe, wk),
    'last_report', case when wk > 1 then public.tribe_week_report(p_tribe, wk - 1) end,
    'testimonies_waiting', (select count(*) from public.testimonies t where t.tribe_id = c.id and t.status = 'submitted'));
end;
$function$;

-- public.tribe_roster(uuid)
CREATE OR REPLACE FUNCTION public.tribe_roster(p_tribe uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  c public.tribes%rowtype;
  v_leads boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.tribes where id = p_tribe;
  if not found then
    raise exception 'That tribe does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false)
          or public.has_any_role(array['pastor', 'director']::public.app_role[])) then
    raise exception 'You do not run this tribe' using errcode = '42501';
  end if;
  v_leads := c.leader_id = uid or coalesce(c.assistant_id = uid, false);
  return jsonb_build_object(
    'tribe', jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity,
      'group_url', c.whatsapp_group_url, 'first_meeting_on', c.first_meeting_on,
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
      'season_starts_on', (select s.starts_on from public.seasons s where s.id = c.season_id),
      'can_edit', v_leads),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'first_name', public.first_name_of(m.person_id),
               'whatsapp', mp.whatsapp,
               'joined_at', m.joined_at,
               'first_meeting_by', m.first_meeting_by,
               'called', m.called_at is not null,
               'called_at', m.called_at,
               'roles', to_jsonb(coalesce(mp.group_roles, '{}'::text[])),
               'success', mp.success_statement,
               'note_enc', case when v_leads then mp.leader_note_enc end) order by m.joined_at)
        from public.tribe_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
       where m.tribe_id = c.id and m.status = 'active'), '[]'::jsonb));
end;
$function$;

-- public.placement_filter_members(uuid,jsonb)
CREATE OR REPLACE FUNCTION public.placement_filter_members(p_tribe uuid, p_members jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.tribes%rowtype;
  v_team boolean;
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    return p_members;
  end if;
  select * into c from public.tribes x where x.id = p_tribe;
  v_team := coalesce(auth.uid() = c.leader_id, false) or coalesce(auth.uid() = c.assistant_id, false);
  return coalesce((
    select jsonb_agg(
             case
               when tm.contact_withheld then e.v || jsonb_build_object('whatsapp', null, 'withheld', true)
               else e.v
             end
             || case when tm.placement_source = 'auto'
                     then jsonb_build_object('placement', case when tm.confirmed_at is null then 'pending' else 'confirmed' end)
                     else '{}'::jsonb end
             order by e.ord)
      from jsonb_array_elements(p_members) with ordinality as e(v, ord)
      left join public.tribe_members tm
        on tm.tribe_id = p_tribe and tm.person_id = (e.v ->> 'person_id')::uuid and tm.status = 'active'
     where not coalesce(v_team and tm.placement_source = 'auto' and exists (
             select 1 from public.placement_teams pt join public.placement_runs pr on pr.id = pt.run_id
              where pt.run_id = tm.placed_by_run and pt.tribe_id = tm.tribe_id and pt.mail_queued_at is null and pt.cancelled_at is null
                and pr.status in ('placing', 'placed', 'undone')), false)), '[]'::jsonb);
end;
$function$;

drop function if exists public.placement_team_mail_for(uuid, uuid);
drop function if exists public.placement_group_open(uuid);
drop function if exists public.placement_contact(uuid);
drop index if exists public.placement_items_placement_idx;

commit;

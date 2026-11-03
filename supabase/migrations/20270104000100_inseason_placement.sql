-- Generated from the functions as they stood; every changed function keeps its name and its arguments.
-- =============================================================================
-- In-season placement, and placing one person (Package 1 of the placement blueprint: fixes 9a, 9b and 10)
--
-- 9a  A season that has started can still be placed into until joining closes (the cut-off the reminders already use). One rule, written
--     once (placement_season), is used by the placement run, the Tribe Card and Circle Card starts, the join form and the Placement page.
-- 9b  A tribe that has started is never "small", the grace period is two days in a running season, "Show me other tribes" works until the
--     cut-off, the first meeting is due within a week, and the leader hears about new members at most once a day per tribe.
-- 10  The owner can place one person into one tribe from God Mode. It is a run of one, so the member email, the consent gate, the leader
--     email, the undo and the log all work exactly as they do for a church run. Below the bar, full, not scored, on hold, other season,
--     no consent and after the cut-off each need a reason and a tick.
-- Nothing here sends anything by itself.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- What a run and an item remember
-- ---------------------------------------------------------------------------
alter table public.placement_runs
  add column in_season boolean not null default false,
  add column after_cutoff boolean not null default false,
  add column single boolean not null default false,
  add column note text check (char_length(note) <= 200);

alter table public.placement_items
  add column override text[] not null default '{}',
  add column override_reason text check (char_length(override_reason) <= 200),
  add column agreed boolean not null default false;

-- ---------------------------------------------------------------------------
-- The season rule, written once
-- ---------------------------------------------------------------------------

-- The season people are placed into now: a season that has started and is still inside its joining window comes first (a running season
-- is where the people waiting are), then the earliest one still to start. Null when there is none.
create function public.placement_season()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.seasons s
   where s.status in ('planning', 'open', 'running')
     and (s.starts_on > public.today_lagos()
          or public.today_lagos() <= s.starts_on + (public.reminder_cfg()).joining_closes_days)
   order by (s.starts_on <= public.today_lagos()) desc, s.starts_on
   limit 1;
$$;

-- The week of the season it is now (1 to the length of the season), or null before it starts.
create function public.placement_week(p_season uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.starts_on <= public.today_lagos() then least(((public.today_lagos() - s.starts_on) / 7) + 1, s.weeks) end
    from public.seasons s where s.id = p_season;
$$;

-- Whether a placed member may still ask to look at other tribes: until joining closes, which is after the season starts.
create function public.placement_change_open(p_starts date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.today_lagos() <= p_starts + (public.reminder_cfg()).joining_closes_days;
$$;

-- When a member placed now should hold their first meeting by: within a week once the season is running, two weeks after it starts otherwise.
create function public.placement_first_meeting_by(p_starts date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_starts <= public.today_lagos() then public.today_lagos() + 7 else p_starts + 14 end;
$$;

-- Where a season stands for joining: the name, when it starts, whether it has, which week it is, and the day joining closes.
create function public.season_joining_window(p_season uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.seasons%rowtype;
  v_id uuid := coalesce(p_season, public.placement_season());
  v_days integer := (public.reminder_cfg()).joining_closes_days;
  v_today date := public.today_lagos();
begin
  select * into s from public.seasons x where x.id = v_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'season', s.id, 'name', s.name, 'status', s.status, 'starts_on', s.starts_on, 'started', s.starts_on <= v_today,
    'week', public.placement_week(s.id), 'weeks', s.weeks, 'closes_on', s.starts_on + v_days, 'open', v_today <= s.starts_on + v_days);
end;
$$;

-- The season Tribe Cards are started in: the earliest in planning or open (as before). When none is, the season people are being placed into
-- now, so a leader appointed while a season is running still gets a card and the leader pages still have a season to show.
create or replace function public.leader_fit_season()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select id from public.seasons where status in ('planning', 'open') order by starts_on limit 1),
    public.placement_season());
$$;


-- The Tribe Card start uses the same season as everything else (placement_season through leader_fit_season), so a leader appointed while a
-- season is running can still start a card. Only the one line that looked up the season changes.
do $do$
declare
  v_def text := pg_get_functiondef('public.start_tribe_card()'::regprocedure);
begin
  if position('select id into season from public.seasons where status in (''planning'', ''open'') order by starts_on limit 1;' in v_def) = 0 then
    raise exception 'start_tribe_card is not as this update expects';
  end if;
  execute replace(v_def, 'select id into season from public.seasons where status in (''planning'', ''open'') order by starts_on limit 1;', 'season := public.leader_fit_season();');
end
$do$;


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
  v_starts date;
  v_started boolean;
  v_closes date;
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
    if k not in ('season', 'community', 'zone', 'grace_days', 'seats_free', 'min_tribe', 'pace_per_hour', 'after_cutoff') then
      raise exception 'That choice does not exist' using errcode = '22023';
    end if;
  end loop;
  if o ? 'after_cutoff' and jsonb_typeof(o -> 'after_cutoff') is distinct from 'boolean' then
    raise exception 'Placing after the cut-off is yes or no' using errcode = '22023';
  end if;
  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  if v_model is null then
    raise exception 'There is no active matching model, so nobody can be scored' using errcode = '22023';
  end if;
  v_season := coalesce(nullif(o ->> 'season', '')::uuid, public.placement_season());
  select se.centre_id, se.starts_on into v_centre, v_starts from public.seasons se
   where se.id = v_season and se.status in ('planning', 'open', 'running');
  if v_centre is null then
    raise exception 'There is no season to place into. Choose a season that is planned, open or running' using errcode = '22023';
  end if;
  v_started := v_starts <= public.today_lagos();
  v_closes := v_starts + (public.reminder_cfg()).joining_closes_days;
  if public.today_lagos() > v_closes and not coalesce((o ->> 'after_cutoff')::boolean, false) then
    raise exception 'Joining for this season closed on %. To place people after that on purpose, choose to place after the cut-off', to_char(v_closes, 'FMDD FMMonth YYYY') using errcode = '22023';
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
    insert into public.placement_runs (id, season_id, in_season, after_cutoff, rehearsal, scope_community, scope_zone, grace_days, seats_free, min_tribe, pace_per_hour,
                                       send_from, send_until, hold_hours, model_version)
    values (v_run, v_season, v_started, public.today_lagos() > v_closes, public.placement_mode() = 'rehearsal', v_community, v_zone,
            coalesce((o ->> 'grace_days')::integer, case when v_started then least(s.grace_days, 2) else s.grace_days end), coalesce((o ->> 'seats_free')::integer, s.seats_free),
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
    jsonb_build_object('pool', v_pool, 'rehearsal', public.placement_mode() = 'rehearsal', 'in_season', v_started, 'after_cutoff', public.today_lagos() > v_closes));
  return jsonb_build_object('run', v_run, 'pool', v_pool);
end;
$$;


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
     set small = (t.proposed > 0 and not r.in_season and t.active_before + t.proposed < least(r.min_tribe, tr.capacity))
    from public.tribes tr
   where tr.id = t.tribe_id and t.run_id = p_run;

  -- A decision to keep a small tribe only stands while the tribe is still small. "Hold" and "retry" are a record of what was chosen.
  update public.placement_teams t set decision = null where t.run_id = p_run and not t.small and t.decision = 'keep';
  update public.placement_teams t set decision = null where t.run_id = p_run and t.small and t.decision in ('hold', 'retry');
end;
$$;


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
    'first_meeting_by', public.placement_first_meeting_by(s.starts_on), 'first_meeting_on', t.first_meeting_on,
    'season', s.name, 'starts_on', s.starts_on, 'in_season', s.starts_on <= public.today_lagos(), 'week', public.placement_week(s.id),
    'change_until', s.starts_on + (public.reminder_cfg()).joining_closes_days,
    'fit', case when p_degree is null then null else public.degree_label(p_degree) end,
    'god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life,
    'has_whatsapp', coalesce((select mp.whatsapp is not null and public.consent_granted(p_person, 'whatsapp')
                                from public.member_profiles mp where mp.person_id = p_person), false),
    'agreed_to_share', public.consent_granted(p_person, 'team_contact'),
    'hold_hours', v_hold);
end;
$function$;


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
    'can_change', tm.status = 'active' and public.placement_change_open(s.starts_on),
    'in_season', s.starts_on <= public.today_lagos(),
    'change_until', s.starts_on + (public.reminder_cfg()).joining_closes_days,
    'fit', case when tm.degree is null then null else public.degree_label(tm.degree) end,
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
  if not public.placement_change_open(s.starts_on) then
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
    v_reason := public.placement_pool_reason(i.person_id, r.season_id, case when r.single then 0 else r.grace_days end);
    -- The owner placing one person may accept some reasons on purpose (each is ticked, and written down with why)
    if v_reason = any (i.override) then
      v_reason := null;
    end if;
  end if;
  if v_reason is null then
    select * into t from public.tribes x where x.id = i.tribe_id for update;
    if not found or t.season_id <> r.season_id or t.status <> 'approved'
       or not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
      v_reason := 'tribe_closed';
    elsif not ('full' = any (i.override))
          and (select count(*) from public.tribe_members x where x.tribe_id = t.id and x.status = 'active') + 1 + r.seats_free > t.capacity then
      v_reason := 'tribe_full';
    end if;
  end if;
  if v_reason is null and not r.rehearsal then
    select k.* into c from public.match_candidates(i.person_id) k where k.r_tribe = i.tribe_id;
    if not found then
      if not ('no_score' = any (i.override)) then
        v_reason := 'tribe_changed';
      end if;
    elsif not i.moved and not ('below_bar' = any (i.override)) and c.r_degree < v_floor then
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
          public.placement_first_meeting_by(se.starts_on), p_run, 'auto', public.placement_contact_refused(i.person_id))
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


create or replace function public.placement_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  r public.placement_runs;
begin
  perform public.god_only();
  select * into r from public.placement_runs x where x.status in ('planning', 'planned', 'approved', 'placing') order by x.seq desc limit 1;
  return jsonb_build_object(
    'settings', public.placement_settings_get(),
    'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'starts_on', s.starts_on) from public.seasons s where s.id = v_season),
    'window', public.season_joining_window(v_season),
    'open_run', case when r.id is null then null else jsonb_build_object(
        'id', r.id, 'seq', r.seq, 'status', r.status, 'phase', r.phase, 'rehearsal', r.rehearsal, 'pool', r.pool, 'told', r.told) end,
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'seq', x.seq, 'status', x.status, 'rehearsal', x.rehearsal, 'created_at', x.created_at, 'pool', x.pool,
               'single', x.single, 'in_season', x.in_season, 'note', x.note,
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
    -- One email a day per tribe: people placed during a running season come in ones and twos, and a leader should not be written to for each
    continue when r.in_season and p_tribe is null and exists (select 1 from public.placement_teams o
                                               where o.tribe_id = tm.tribe_id and o.run_id <> p_run and o.mail_queued_at > now() - interval '24 hours');
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
          jsonb_build_object('tribe', t.name, 'in_season', r.in_season, 'week', public.placement_week(t.season_id), 'first_meeting_by', v_first,
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


-- ---------------------------------------------------------------------------
-- Place one person (God Mode only). The owner picks a person and a tribe; the check says what stops it, and what needs a reason.
-- ---------------------------------------------------------------------------

-- The tribes a person could be placed into this season, best fit first, with how full each is. A tribe the matching would not offer them
-- is listed too, without a fit, because the owner may place someone where the matching would not.
create function public.placement_one_options(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := coalesce(public.placement_season(), public.leader_fit_season());
  v_floor integer := public.placement_floor();
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'tribe', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id),
             'active', a.n, 'capacity', t.capacity, 'degree', k.r_degree,
             'label', case when k.r_degree is null then null else public.degree_label(k.r_degree) end,
             'below_floor', k.r_degree is not null and k.r_degree < v_floor)
           order by k.r_degree desc nulls last, t.name, t.id)
      from public.tribes t
      cross join lateral (select count(*)::integer as n from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') a
      left join lateral (select c.r_degree from public.match_candidates(p_person) c where c.r_tribe = t.id) k on true
     where t.season_id = v_season and t.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id)), '[]'::jsonb);
end;
$$;

-- What would stop this placement (blockers, which cannot be overridden) and what needs the owner's reason (warnings).
create function public.placement_one_check(p_person uuid, p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
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
  v_track uuid;
  v_win jsonb;
begin
  perform public.god_only();
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
  select tt.name into v_seat from public.tribe_members m join public.tribes tt on tt.id = m.tribe_id
   where m.person_id = p_person and m.season_id = t.season_id and m.status = 'active' limit 1;
  if v_seat is not null then
    v_block := v_block || jsonb_build_array(jsonb_build_object('code', 'has_seat', 'text', 'They already have a seat this season, in ' || v_seat));
  end if;

  -- Warnings: each needs a tick and a reason
  if exists (select 1 from public.placement_holds h where h.person_id = p_person) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'held', 'text', 'You put this person on hold'));
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
  if (v_win ->> 'started')::boolean and not (v_win ->> 'open')::boolean then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'after_cutoff',
      'text', 'Joining for this season closed on ' || to_char((v_win ->> 'closes_on')::date, 'FMDD FMMonth YYYY')));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_block) = 0,
    'blockers', v_block, 'warnings', v_warn,
    'person', jsonb_build_object('id', pe.id, 'name', public.person_display_name(pe.id)),
    'tribe', jsonb_build_object('id', t.id, 'name', t.name, 'leader', public.first_name_of(t.leader_id), 'active', v_active, 'capacity', t.capacity),
    'degree', v_degree,
    'label', case when v_degree is null then null else public.degree_label(v_degree) end,
    'window', v_win);
end;
$$;

-- Places one person. Everything is checked again here. Every warning must be accepted and given a reason; "they already agreed" is the owner's
-- own statement and is written down as that. The person is placed as a run of one: they get the same "Your tribe" email, the same
-- choice to confirm or hold back their details, and the leader hears in the same way. It can be undone until the leader has been told.
create function public.placement_one_place(
  p_person uuid, p_tribe uuid, p_accept text[] default '{}', p_reason text default null, p_agreed boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chk jsonb;
  v_codes text[];
  v_accept text[] := coalesce(p_accept, '{}'::text[]);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  s public.placement_settings;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  v_model text;
  v_run uuid := gen_random_uuid();
  v_item bigint;
  v_res text;
  v_tm uuid;
  v_started boolean;
begin
  perform public.god_only();
  if public.placement_mode() <> 'on' then
    raise exception 'Placement is not switched On. A person is placed for real only when it is On' using errcode = '22023';
  end if;
  v_chk := public.placement_one_check(p_person, p_tribe);
  if jsonb_array_length(v_chk -> 'blockers') > 0 then
    raise exception '%', (v_chk -> 'blockers' -> 0 ->> 'text') using errcode = '22023';
  end if;
  select coalesce(array_agg(x ->> 'code'), '{}'::text[]) into v_codes from jsonb_array_elements(v_chk -> 'warnings') x;
  if exists (select 1 from unnest(v_codes) c where c <> all (v_accept)) then
    raise exception 'Read each warning and tick that you accept it' using errcode = '22023';
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
  select * into s from public.placement_settings x where x.singleton;
  select m.version into v_model from public.match_models m where m.active;
  select * into t from public.tribes x where x.id = p_tribe;
  select * into se from public.seasons x where x.id = t.season_id;
  v_started := se.starts_on <= public.today_lagos();

  insert into public.placement_runs (id, season_id, status, phase, in_season, after_cutoff, single, note, rehearsal, grace_days, seats_free, min_tribe,
                                     pace_per_hour, send_from, send_until, hold_hours, model_version, pool, planned_at, approved_at, placed_at)
  values (v_run, se.id, 'placed', 'ready', v_started, 'after_cutoff' = any (v_codes), true, v_reason, false, 0, 0, s.min_tribe,
          s.pace_per_hour, s.send_from, s.send_until, s.hold_hours, v_model, 1, now(), now(), now());
  insert into public.placement_items (run_id, person_id, status, tribe_id, degree, seq, moved, override, override_reason, agreed)
  values (v_run, p_person, 'proposed', p_tribe, (v_chk ->> 'degree')::integer, 1, true, v_codes, v_reason, coalesce(p_agreed, false))
  returning id into v_item;
  insert into public.placement_teams (run_id, tribe_id, active_before, proposed)
  values (v_run, p_tribe, (select count(*)::integer from public.tribe_members m where m.tribe_id = p_tribe and m.status = 'active'), 1);

  v_res := public.placement_place_item(v_run, v_item);
  if v_res is not null then
    -- Raising rolls back the run, the item and the team row: nothing is left behind
    raise exception 'They could not be placed (%). Nothing was changed', v_res using errcode = '22023';
  end if;
  select i.placement_id into v_tm from public.placement_items i where i.id = v_item;
  perform public.write_event(auth.uid(), 'placement.single', 'placement_run', v_run::text,
    jsonb_build_object('tribe', p_tribe, 'codes', to_jsonb(v_codes), 'agreed', coalesce(p_agreed, false), 'in_season', v_started));
  return jsonb_build_object('ok', true, 'run', v_run, 'placement', v_tm);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.placement_season(),
  public.placement_week(p_season uuid),
  public.placement_change_open(p_starts date),
  public.placement_first_meeting_by(p_starts date),
  public.season_joining_window(p_season uuid),
  public.placement_one_options(p_person uuid),
  public.placement_one_check(p_person uuid, p_tribe uuid),
  public.placement_one_place(p_person uuid, p_tribe uuid, p_accept text[], p_reason text, p_agreed boolean)
  from public, anon, authenticated;
-- The join form, the Tribe Card start and the pages read the season rule
grant execute on function public.placement_season(), public.season_joining_window(p_season uuid) to authenticated;
-- The console (each of these begins god_only())
grant execute on function
  public.placement_one_options(p_person uuid),
  public.placement_one_check(p_person uuid, p_tribe uuid),
  public.placement_one_place(p_person uuid, p_tribe uuid, p_accept text[], p_reason text, p_agreed boolean)
  to authenticated;


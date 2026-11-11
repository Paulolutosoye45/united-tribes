-- =============================================================================
-- Fix 8: the weekly guide opens for leaders on the Saturday before its week (one setting), and the leader FAQ
-- =============================================================================
-- One setting, "Open next week's guide for leaders on the Saturday before it starts, at [time]", on Admin → Weekly guides. It starts Off, which is how things are today:
-- a leader can open any week. When it is On, a leader reads this week's guide and the weeks already opened, and a later week says when it opens and shows nothing of
-- its content. Week 1 is open from the start. The pastor and the director (the office) always read every week, so the guides can still be read through before
-- they open. The release is the day before each week starts (a Saturday, when the season starts on a Sunday), at the hour and minute set, Lagos time.
--
-- The rule is kept in the database function behind the leader's weekly page (tribe_week), so no screen and no direct call can read a week early. The confession, the
-- sermon title, the skill-share prompt and the goal idea (the "week layer", its own function) are hidden on the leader's screen for a week that has not opened, and
-- are not hidden in the database.
--
-- It replaces one function, tribe_week (its old text is in the rollback file); every other part of the page is exactly as it was.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.tribe_week(uuid, integer)') is null or to_regclass('public.week_guides') is null then
    raise exception 'Apply the earlier packages first (20270101000300_placement_visibility.sql defines tribe_week).';
  end if;
end
$guard$;

create table public.guide_release_settings (
  id boolean primary key default true check (id),
  -- Off: a leader may open any week (as before). On: the Saturday rule.
  weekly boolean not null default false,
  release_hour smallint not null default 8 check (release_hour between 0 and 23),
  release_minute smallint not null default 0 check (release_minute in (0, 15, 30, 45)),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.guide_release_settings (id) values (true);
alter table public.guide_release_settings enable row level security;
revoke all on table public.guide_release_settings from public, anon, authenticated;

create function public.guide_release_weekly()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.weekly from public.guide_release_settings s where s.id), false);
$$;

-- The moment a week opens for leaders: the day before it starts, at the set time, Lagos time. Null for week 1, which is open from the start.
create function public.guide_opens_at(p_season uuid, p_week integer)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_week is null or p_week <= 1 then null
              else ((s.starts_on + (p_week - 1) * 7 - 1)::timestamp + make_interval(hours => r.release_hour, mins => r.release_minute)) at time zone 'Africa/Lagos' end
    from public.seasons s cross join public.guide_release_settings r
   where s.id = p_season and r.id;
$$;

-- The last week a leader may open now. Never below 1, never above the season's last week.
create function public.guide_open_week(p_season uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select max(w)
                     from public.seasons s, generate_series(1, s.weeks) as g(w)
                    where s.id = p_season and (public.guide_opens_at(s.id, w) is null or public.guide_opens_at(s.id, w) <= now())), 1);
$$;

-- What the leader's page shows about the rule: whether it is On, the last week open, and when the next one opens (nothing when the last week is already open).
create function public.guide_release_view(p_season uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'weekly', public.guide_release_weekly(),
           'open_week', case when public.guide_release_weekly() then public.guide_open_week(p_season) else s.weeks end,
           'next_week', case when public.guide_release_weekly() and public.guide_open_week(p_season) < s.weeks then public.guide_open_week(p_season) + 1 end,
           'next_opens_at', case when public.guide_release_weekly() and public.guide_open_week(p_season) < s.weeks
                                 then public.guide_opens_at(s.id, public.guide_open_week(p_season) + 1) end)
    from public.seasons s where s.id = p_season;
$$;

-- The setting, for the admin page.
create function public.guide_release_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.guide_release_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor', 'data_lead']::public.app_role[]) then
    raise exception 'Only the office can see this' using errcode = '42501';
  end if;
  select * into s from public.guide_release_settings x where x.id;
  return jsonb_build_object('weekly', s.weekly, 'hour', s.release_hour, 'minute', s.release_minute,
                            'can_edit', public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]),
                            'changed_at', s.changed_at,
                            'changed_by', case when s.changed_by is null then null else public.person_display_name(s.changed_by) end);
end;
$$;

create function public.guide_release_set(p_weekly boolean, p_hour integer, p_minute integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only an admin, a director or a pastor can change this' using errcode = '42501';
  end if;
  if p_weekly is null or not coalesce(p_hour between 0 and 23, false) or p_minute is null or p_minute not in (0, 15, 30, 45) then
    raise exception 'Choose On or Off, an hour from 0 to 23 and a quarter of an hour' using errcode = '22023';
  end if;
  update public.guide_release_settings
     set weekly = p_weekly, release_hour = p_hour, release_minute = p_minute, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'guides.release', 'guides', 'release', jsonb_build_object('weekly', p_weekly, 'hour', p_hour, 'minute', p_minute));
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function
  public.guide_release_weekly(), public.guide_opens_at(uuid, integer), public.guide_open_week(uuid), public.guide_release_view(uuid)
  from public, anon, authenticated;
revoke execute on function public.guide_release_get(), public.guide_release_set(boolean, integer, integer) from public, anon;
grant execute on function public.guide_release_get(), public.guide_release_set(boolean, integer, integer) to authenticated;

-- ---- copy: the leader's weekly page (the exact function as it stood, with the changes marked in the text) ----
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
  v jsonb;
  v_locked boolean;
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
  -- Package 8 (fix 8): while the weekly release is On, a leader reads this week's guide and the weeks already opened, and nothing later. The office reads every week.
  v_locked := not office and public.guide_release_weekly() and wk > public.guide_open_week(c.season_id);

  v := jsonb_build_object(
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
    'release', public.guide_release_view(c.season_id),
    -- the leader can log a week that has started until the end of the week after it; the office any time
    'log_open', (can_edit or office) and wk <= cw and (office or today <= ws + 13),
    'guide', case when v_locked then jsonb_build_object('week', wk, 'locked', true, 'opens_at', public.guide_opens_at(c.season_id, wk))
                  else jsonb_build_object(
      'week', g.week, 'theme', g.theme, 'title', g.title, 'passage', g.passage, 'big_idea', g.big_idea,
      'opening_question', g.opening_question, 'questions', to_jsonb(g.questions), 'practice', g.practice,
      'step_hint', g.step_hint, 'prayer', g.prayer, 'plan', g.plan, 'leader_tip', g.leader_tip) end,
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
  -- The rule for church-placed members is applied here, in the lists themselves, so no screen and no direct call can skip it
  v := jsonb_set(v, '{members}', public.placement_filter_members(p_tribe, v -> 'members'));
  return jsonb_set(v, '{follow_ups}', public.placement_filter_members(p_tribe, v -> 'follow_ups'));
end;
$function$;

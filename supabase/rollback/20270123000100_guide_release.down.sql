-- Takes Fix 8's guide release back. Run before the earlier packages' own rollbacks. Every leader can open any week again; the setting is dropped with its table.
begin;

drop function if exists public.guide_release_set(boolean, integer, integer);
drop function if exists public.guide_release_get();

-- The earlier text of the leader's weekly page, exactly (it no longer calls the release functions)
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
  -- The rule for church-placed members is applied here, in the lists themselves, so no screen and no direct call can skip it
  v := jsonb_set(v, '{members}', public.placement_filter_members(p_tribe, v -> 'members'));
  return jsonb_set(v, '{follow_ups}', public.placement_filter_members(p_tribe, v -> 'follow_ups'));
end;
$function$;

drop function if exists public.guide_release_view(uuid);
drop function if exists public.guide_open_week(uuid);
drop function if exists public.guide_opens_at(uuid, integer);
drop function if exists public.guide_release_weekly();
drop table if exists public.guide_release_settings;

commit;

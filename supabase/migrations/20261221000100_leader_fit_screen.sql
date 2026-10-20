-- Phase 6: the "Find your tribe" screen. This replaces the two do-nothing hooks Phase 2 made (so no live body is revised) and adds the two
-- reads the app needs: what an existing leader could lead next, and where the switch stands for the Admin page.
-- Nothing here changes a table, a default or a threshold. With Find your tribe Off, every function behaves exactly as before.

-- ---------------------------------------------------------------------------
-- Ready: may the switch be turned On?
-- ---------------------------------------------------------------------------
-- A fit model is approved and at least one card is signed off, with its goal and community on. The setters from Phase 1 already
-- refuse "On" while this is false, and the "open door" preset leaves the switch Off while it is false.
create or replace function public.leader_fit_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leader_fit_models m where m.active)
     and exists (
       select 1
         from public.tribe_card_templates t
         join public.season_goals g on g.id = t.season_goal_id and g.active
         join public.communities c on c.id = g.community_id and c.active
        where t.status = 'signed_off');
$$;

-- ---------------------------------------------------------------------------
-- The send gate
-- ---------------------------------------------------------------------------
-- submit_leader_application calls this just before it writes the sent-time record. It does nothing unless Find your tribe is On and
-- there is something to choose. Otherwise the leader must have chosen a tribe on a run made for the answers as they stand now, and
-- the goal saved in their answers must be that tribe. A late autosave that carries the old goal fails this, so the leader is sent back
-- to choose again instead of sending a tribe they did not pick.
create or replace function public.leader_fit_gate(p_app uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg public.leader_pipeline_settings := public.leader_pipeline_cfg();
  a public.leader_applications;
  i jsonb;
  r public.leader_fit_runs;
  v_saved uuid;
begin
  -- Off (or nothing approved to run): the behaviour is exactly what it was before this screen existed
  if cfg.tribe_fit is distinct from 'on' or not public.leader_fit_ready() then
    return;
  end if;
  select * into a from public.leader_applications x where x.id = p_app;
  if not found then
    return;
  end if;
  i := public.leader_fit_inputs_for(p_app);
  -- Nothing to choose (no options, or answers the engine cannot read): the leader is never blocked
  if i is null or not exists (select 1 from public.leader_fit_options(i)) then
    return;
  end if;
  select * into r from public.leader_fit_runs x where x.application_id = p_app order by x.seq desc limit 1;
  select g.id into v_saved
    from public.season_goals g
    join public.communities c on c.id = g.community_id
   where g.slug = a.answers #>> '{calling,goal}' and c.slug = a.answers #>> '{calling,community}';
  if r.id is null or r.chosen_goal_id is null or v_saved is distinct from r.chosen_goal_id or r.inputs is distinct from i then
    raise exception 'Choose your tribe first' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Tribes you could lead next season", for a leader we already have
-- ---------------------------------------------------------------------------
-- Read-only. The top three of the caller's latest run that are recommended, leaving out the goals of the tribes they already lead or
-- assist this season (their current tribe does not change). Labels, percentages and reasons only: the same words the applicant saw.
create function public.leader_fit_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.leader_fit_runs;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['leader', 'assistant_leader']::public.app_role[]) then
    raise exception 'Only leaders can see this' using errcode = '42501';
  end if;
  if (public.leader_pipeline_cfg()).tribe_fit is distinct from 'on' then
    return jsonb_build_object('status', 'off');
  end if;
  select * into r from public.leader_fit_runs x where x.person_id = uid order by x.seq desc limit 1;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'ran_at', r.ran_at,
    'options', coalesce((
      select jsonb_agg(x.o order by x.rk)
        from (
          select jsonb_build_object('goal_id', e ->> 'goal_id', 'title', e ->> 'title', 'community', e ->> 'community',
                                    'label', e ->> 'label', 'degree', (e ->> 'degree')::integer, 'reasons', e -> 'reasons') as o,
                 (e ->> 'rank')::integer as rk
            from jsonb_array_elements(r.options) e
           where (e ->> 'rank') is not null
             and not exists (
               select 1 from public.tribes t
                where (t.leader_id = uid or t.assistant_id = uid)
                  and t.season_goal_id = (e ->> 'goal_id')::uuid
                  and t.season_id is not distinct from coalesce(r.season_id, public.leader_fit_season()))
           order by (e ->> 'rank')::integer
           limit 3) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Where it stands, for the Admin page
-- ---------------------------------------------------------------------------
create function public.leader_fit_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.leader_fit_models := public.leader_fit_cfg();
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'tribe_fit', (public.leader_pipeline_cfg()).tribe_fit,
    'ready', public.leader_fit_ready(),
    'model', case when m.version is null then null else jsonb_build_object(
      'version', m.version, 'approved_at', m.approved_at,
      -- A hidden owner's name is never shown
      'approved_by', (select public.person_display_name(p.id) from public.people p where p.id = m.approved_by and not p.hidden)) end,
    'cards', jsonb_build_object(
      'signed_off', (select count(*) from public.tribe_card_templates t where t.status = 'signed_off'),
      'total', (select count(*) from public.tribe_card_templates)),
    'leaders', jsonb_build_object(
      'total', (select count(*) from public.people p
                 where not p.hidden and exists (select 1 from public.person_roles pr where pr.person_id = p.id and pr.role in ('leader', 'assistant_leader'))),
      'quiet_run', (select count(distinct x.person_id) from public.leader_fit_runs x
                     where x.source = 'quiet' and x.model_version = m.version)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function public.leader_fit_mine(), public.leader_fit_status() from public, anon;
grant execute on function public.leader_fit_mine(), public.leader_fit_status() to authenticated;

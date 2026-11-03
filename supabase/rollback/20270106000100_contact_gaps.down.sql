-- Way back from "Contact gaps".
--
-- Puts audience_clean, audience_base, audience_members and broadcasts_release back exactly as they were, so announcements behave as before. Drops the
-- functions the package added and the three tables it made (the log of leaders' asks, the "Not now" memory and the daily counts), and takes the function
-- off the Switchboard (with its rule; the log of who moved a switch is kept). WHAT THIS TAKES WITH IT: the log of who a leader asked, and the daily
-- counts. No message, no consent, no member and no number is touched; an announcement already drafted for the new audience can no longer be opened.
-- Copy them first if you want them:
--   select * from public.contact_asks; select * from public.contact_gap_days;
-- Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;

-- The functions that were replaced, as they stood
create or replace function public.audience_clean(p_spec jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
  v jsonb;
  v_out jsonb;
  v_idle integer;
  v_nofit text;
  v_comm uuid;
  v_stages text[];
  v_roles text[];
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff') then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  v_out := jsonb_build_object('kind', k);

  if p_spec ? 'community' and nullif(p_spec ->> 'community', '') is not null then
    begin
      v_comm := (p_spec ->> 'community')::uuid;
    exception when others then
      raise exception 'That community does not exist' using errcode = '22023';
    end;
    if not exists (select 1 from public.communities t where t.id = v_comm) then
      raise exception 'That community does not exist' using errcode = '22023';
    end if;
    if k in ('leader_applicants', 'leaders', 'staff') then
      raise exception 'A community can only narrow members' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('community', v_comm);
  end if;

  if k = 'started' and p_spec ? 'idle_days' then
    v_idle := coalesce(nullif(p_spec ->> 'idle_days', '')::integer, 0);
    if v_idle < 0 or v_idle > 60 then
      raise exception 'Days since they last did anything must be 0 to 60' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('idle_days', v_idle);
  end if;

  if k = 'finished_no_tribe' and p_spec ? 'no_fit' then
    v_nofit := p_spec ->> 'no_fit';
    if v_nofit not in ('include', 'exclude', 'only') then
      raise exception 'Choose whether to include the people with no tribe that fits yet' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('no_fit', v_nofit);
  end if;

  if k = 'leader_applicants' then
    v := coalesce(p_spec -> 'stages', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the stages' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_stages from jsonb_array_elements_text(v) s;
    if exists (select 1 from unnest(v_stages) s where s not in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed', 'approved_leader', 'approved_assistant', 'not_approved')) then
      raise exception 'Choose from the stages shown' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('stages', to_jsonb(v_stages));
  end if;

  if k = 'staff' then
    v := coalesce(p_spec -> 'roles', '[]'::jsonb);
    if jsonb_typeof(v) <> 'array' then
      raise exception 'Choose the roles' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct s), '{}') into v_roles from jsonb_array_elements_text(v) s;
    if cardinality(v_roles) = 0 or exists (select 1 from unnest(v_roles) s where s not in ('coach', 'care_lead', 'community_champion', 'data_lead', 'director', 'pastor', 'admin')) then
      raise exception 'Choose at least one role from the list' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('roles', to_jsonb(v_roles));
  end if;
  return v_out;
end;
$$;

create or replace function public.audience_base(p_spec jsonb, p_centre uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := p_spec ->> 'kind';
begin
  if k = 'everyone' then
    return query select p.id from public.people p where p.centre_id = p_centre;
  elsif k = 'started' then
    return query
      select d.person_id from public.intake_drafts d join public.people p on p.id = d.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.member_profiles mp where mp.person_id = d.person_id)
         and d.updated_at <= now() - make_interval(days => coalesce((p_spec ->> 'idle_days')::integer, 0));
  elsif k = 'finished_no_tribe' then
    return query
      select mp.person_id from public.member_profiles mp join public.people p on p.id = mp.person_id
       where p.centre_id = p_centre
         and not exists (select 1 from public.tribe_members cm join public.seasons s on s.id = cm.season_id
                          where cm.person_id = mp.person_id and cm.status = 'active' and s.status <> 'closed')
         and case coalesce(p_spec ->> 'no_fit', 'include')
               when 'only' then exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               when 'exclude' then not exists (select 1 from public.match_demand md where md.person_id = mp.person_id)
               else true end;
  elsif k = 'in_tribe' then
    return query
      select distinct cm.person_id from public.tribe_members cm
        join public.seasons s on s.id = cm.season_id join public.people p on p.id = cm.person_id
       where p.centre_id = p_centre and cm.status = 'active' and s.status in ('planning', 'open', 'running');
  elsif k = 'leader_applicants' then
    return query
      select la.person_id from public.leader_applications la join public.people p on p.id = la.person_id
       where p.centre_id = p_centre
         and la.status::text = any (coalesce(
               (select array_agg(x) from jsonb_array_elements_text(p_spec -> 'stages') x),
               array['draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed']));
  elsif k = 'leaders' then
    return query
      select distinct x.pid from (
        select c.leader_id as pid from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed'
        union
        select c.assistant_id from public.tribes c join public.seasons s on s.id = c.season_id
         where c.status <> 'closed' and s.status <> 'closed' and c.assistant_id is not null
        union
        select r.person_id from public.person_roles r where r.role in ('leader', 'assistant_leader')) x
        join public.people p on p.id = x.pid
       where p.centre_id = p_centre;
  elsif k = 'staff' then
    return query
      select distinct r.person_id from public.person_roles r join public.people p on p.id = r.person_id
       where p.centre_id = p_centre
         and r.role::text = any (coalesce((select array_agg(x) from jsonb_array_elements_text(p_spec -> 'roles') x), '{}'));
  end if;
end;
$$;

create or replace function public.audience_members(p_spec jsonb, p_centre uuid)
returns table (person_id uuid, blocker text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.pid,
         coalesce(public.message_blocker(b.pid),
                  case when public.reminder_stopped(b.pid, 'announcements') then 'announcements_off' end)
    from (select distinct t.pid from public.audience_base(p_spec, p_centre) as t(pid)) b
   where (p_spec ->> 'community' is null
          or exists (select 1 from public.member_profiles mp where mp.person_id = b.pid and mp.community_id = (p_spec ->> 'community')::uuid));
$$;

create or replace function public.broadcasts_release()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  b public.broadcasts%rowtype;
  rec record;
  v_quota integer;
  v_blocker text;
  v_msg uuid;
  v_total integer := 0;
  v_left integer;
begin
  if not public.send_window_ok('bulk') then
    return 0;
  end if;
  for b in select * from public.broadcasts x where x.status in ('scheduled', 'sending') and x.scheduled_for <= now() order by x.scheduled_for for update skip locked loop
    if b.status = 'scheduled' then
      update public.broadcasts set status = 'sending', started_at = now(), last_release_at = now() - interval '1 minute' where id = b.id;
      b.last_release_at := now() - interval '1 minute';
    end if;
    v_quota := least(3000, greatest(1, floor(extract(epoch from now() - coalesce(b.last_release_at, now() - interval '1 minute')) / 60.0 * s.bulk_per_minute)::integer));
    for rec in select r.person_id from public.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'pending' order by r.person_id limit v_quota for update skip locked loop
      v_blocker := coalesce(public.message_blocker(rec.person_id),
                            case when public.reminder_stopped(rec.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is null and not public.person_cap_ok(rec.person_id, 'announcement') then
        v_blocker := 'weekly_cap';
      end if;
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
      else
        v_msg := public.enqueue_message(rec.person_id, 'office_message', jsonb_build_object('broadcast_id', b.id), null,
          'bc:' || b.id::text || ':' || rec.person_id::text, now(), 'normal', 'email');
        update public.broadcast_recipients set status = 'queued', message_id = v_msg, released_at = now() where broadcast_id = b.id and person_id = rec.person_id;
        v_total := v_total + 1;
      end if;
    end loop;
    update public.broadcasts set last_release_at = now() where id = b.id;
    select count(*) into v_left from public.broadcast_recipients where broadcast_id = b.id and status = 'pending';
    if v_left = 0 then
      update public.broadcasts set status = 'sent', finished_at = now() where id = b.id;
      perform public.write_event(null, 'broadcast.finished', 'broadcast', b.id::text, '{}'::jsonb);
    end if;
  end loop;
  return v_total;
end;
$$;

drop function if exists public.reach_prompt_dismiss();
drop function if exists public.my_reach();
drop function if exists public.contact_ask_send(uuid);
drop function if exists public.tribe_reach_gaps(uuid);
drop function if exists public.contact_gaps_export();
drop function if exists public.contact_gaps_report(text, uuid, uuid, integer, integer);
drop function if exists public.contact_gaps_state();
drop function if exists public.contact_gaps_role();
drop function if exists public.contact_ask_blocker(uuid);
drop function if exists public.contact_ask_history(uuid);
drop function if exists public.contact_gap_still(uuid, text);
drop function if exists public.contact_gap_causes(text);
drop function if exists public.contact_gap_rows(uuid);
drop function if exists public.contact_gap_cause_of(uuid, uuid);
drop table if exists public.contact_gap_days;
drop table if exists public.reach_prompts;
drop table if exists public.contact_asks;
-- The Switchboard: the function and its rule
delete from public.feature_settings where feature = 'contact_gaps';
delete from public.feature_registry where key = 'contact_gaps';
commit;

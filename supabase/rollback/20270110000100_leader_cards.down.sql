-- Way back from "Leader cards".
--
-- Puts audience_clean and audience_base back exactly as the Contact gaps package left them, so announcements behave as before. Drops the functions the
-- package added and the three tables it made (the departments the office tagged leaders with, the reminder setting, and the log of reminders and resends),
-- so the heartbeat's reminder step finds nothing to call and does nothing. WHAT THIS TAKES WITH IT: the departments and the log of what was sent to whom.
-- Copy them first if you want them:
--   select * from public.leader_departments; select * from public.leader_card_log; select * from public.leader_card_settings;
-- No message already sent, no card, no leader and no consent is touched. An announcement already drafted for "Leaders whose Tribe Card is not finished"
-- can no longer be opened. Put the application files back before this one: the pages call these functions. Run it as the database owner. Running it
-- twice changes nothing.
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
  v_cause text;
  v_trib uuid;
begin
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'Choose who this is for' using errcode = '22023';
  end if;
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff', 'cannot_reach') then
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
  if k = 'cannot_reach' then
    -- Members a leader cannot reach on WhatsApp (Contact gaps, fix 13). Only while the function is On.
    if public.feature_platform_state('contact_gaps') <> 'on' then
      raise exception 'Contact gaps is not switched On' using errcode = '22023';
    end if;
    v_cause := coalesce(nullif(p_spec ->> 'cause', ''), 'either');
    if v_cause not in ('no_number', 'no_yes', 'either') then
      raise exception 'Choose who has no number, who has not agreed to WhatsApp, or both' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_object('cause', v_cause);
    if nullif(p_spec ->> 'tribe', '') is not null then
      begin
        v_trib := (p_spec ->> 'tribe')::uuid;
      exception when others then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end;
      if not exists (select 1 from public.tribes t where t.id = v_trib) then
        raise exception 'That tribe does not exist' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object('tribe', v_trib);
    end if;
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
  elsif k = 'cannot_reach' then
    return query
      select g.person_id from public.contact_gap_rows(p_centre) g
       where g.cause = any (public.contact_gap_causes(p_spec ->> 'cause'))
         and (nullif(p_spec ->> 'tribe', '') is null or g.tribe_id = (p_spec ->> 'tribe')::uuid);
  end if;
end;
$$;

drop function if exists public.worker_leader_card_reminders(text);
drop function if exists public.leader_card_reminders_run();
drop function if exists public.leader_card_reminders_set(text, integer[], integer, text);
drop function if exists public.leader_card_reminders_get();
drop function if exists public.leader_cards_sheet(text);
drop function if exists public.leader_cards_failures();
drop function if exists public.leader_cards_resend(uuid);
drop function if exists public.leader_card_department_set(uuid, text);
drop function if exists public.leader_cards_board(text, text, integer, integer);
drop function if exists public.leader_last_activity(uuid, uuid);
drop function if exists public.leader_card_invite_of(uuid);
drop function if exists public.leader_card_rows(uuid);
drop function if exists public.leader_card_state(text, boolean);
drop function if exists public.leader_cards_role();
drop table if exists public.leader_card_log;
drop table if exists public.leader_card_settings;
drop table if exists public.leader_departments;
commit;

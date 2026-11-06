-- Way back from "the placed-member nudge".
--
-- Cancels any nudge announcement that has not finished and withdraws the nudge emails still waiting in the outbox, puts the nine functions this change replaced back
-- exactly as they stood (the private-link maker, trying a failed message again, who an announcement is for, the announcement release, what an email needs when it
-- is claimed, the announcement results and the Contact gaps download), drops what it added (22 functions, the guard on announcements, and four tables: the three
-- numbers, the nudges put to each seat, the fingerprints of private links, and the fingerprints of confirmed numbers) and takes the switch off the Switchboard.
-- What it keeps: every consent a member gave (a yes to WhatsApp stays a yes), every number they saved, every seat that was confirmed, and every message already sent.
-- The fingerprints of confirmed numbers go with their table: they only recorded that a sign-in number had been matched, and the number itself is still there.
-- Put the application files back before this one: the pages and the composer call these functions. Run it as the database owner. Running it twice changes nothing.
begin;

-- One of the functions put back reads a helper that a still older way back may already have dropped (this file can be run again after those), so the
-- bodies are not checked while they are put back; they are checked, as always, when they run
set local check_function_bodies = off;

-- A nudge cannot be sent without the pieces above, so none is left half-way
update public.broadcasts set status = 'cancelled' where audience ->> 'kind' = 'placed_waiting' and status in ('awaiting_approval', 'scheduled', 'sending', 'paused');
update public.messages set status = 'skipped', error = 'the placed nudge was taken away', reply_token = null
 where template = 'office_message' and status in ('queued', 'sending')
   and nullif(params ->> 'broadcast_id', '')::uuid in (select b.id from public.broadcasts b where b.audience ->> 'kind' = 'placed_waiting');

drop trigger if exists broadcasts_placed_guard on public.broadcasts;
drop function if exists public.broadcasts_placed_guard();

create or replace function public.placement_token_mint(p_placement uuid, p_person uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.placement_tokens (token_hash, placement_id, person_id, expires_at)
  values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), p_placement, p_person, now() + make_interval(days => greatest(p_days, 1)));
  return v_raw;
end;
$$;

create or replace function public.retry_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or director can retry a message' using errcode = '42501';
  end if;
  update public.messages
     set status = 'queued', tried = '{}', attempts = 0, error = null, scheduled_for = now(), provider_id = null
   where id = p_id and status in ('failed', 'skipped');
  if not found then
    raise exception 'Only a failed or skipped message can be tried again' using errcode = '22023';
  end if;
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

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
  if k is null or k not in ('everyone', 'started', 'finished_no_tribe', 'in_tribe', 'leader_applicants', 'leaders', 'staff', 'cannot_reach', 'leader_cards') then
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
    if k in ('leader_applicants', 'leaders', 'staff', 'leader_cards') then
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
  elsif k = 'leader_cards' then
    -- Leaders whose Tribe Card is still open: not started, in progress, or sent back with changes asked for.
    return query
      select r.person_id from public.leader_card_rows(p_centre) r
       where r.state in ('not_started', 'in_progress', 'changes_asked');
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
                  case when public.reminder_stopped(b.pid, 'announcements') then 'announcements_off' end,
                  case when p_spec ->> 'kind' = 'cannot_reach' then public.contact_ask_blocker(b.pid) end)
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
      if v_blocker is null and b.audience ->> 'kind' = 'cannot_reach' and not public.contact_gap_still(rec.person_id, b.audience ->> 'cause') then
        v_blocker := 'gap_closed';
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

create or replace function public.claim_prepare(m public.messages)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  r public.journey_runs;
  b public.broadcasts;
  e public.journey_emails;
  v_state text;
  v_step integer;
  v_data jsonb;
  v_copy jsonb;
  v_links jsonb := '{}'::jsonb;
  v_action text;
  v_blocker text;
  rr public.leader_references;
  ra public.leader_applications;
  rt public.referee_trust;
  rac public.referee_access;
  rcfg public.referee_settings;
  v_code text;
  v_salt text;
  v_secret text;
begin
  -- A referee has no account: their messages carry a fresh link or a fresh code, made now and never stored in a readable form.
  if m.template in ('referee_request', 'referee_reverify', 'referee_code') then
    rcfg := public.referee_cfg();
    select * into rr from public.leader_references where id = nullif(m.params ->> 'reference_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    -- A message for a contact that has since been replaced must never carry the new person's link
    if rr.contact_norm is distinct from (m.params ->> 'contact') then
      return jsonb_build_object('ok', false, 'reason', 'the referee was changed');
    end if;
    select * into ra from public.leader_applications where id = rr.application_id;
    select * into rt from public.referee_trust where reference_id = rr.id;
    if m.template = 'referee_reverify' then
      if rr.submitted_at is null or rt.reverified_at is not null or rt.verification <> 'unverified' then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    elsif m.template = 'referee_request' then
      if rr.submitted_at is not null or ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    else
      if (rr.submitted_at is not null and not (coalesce(rt.legacy, false) and rt.reverify_sent_at is not null and rt.reverified_at is null))
         or (rr.submitted_at is null and ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved')) then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    end if;

    if m.template = 'referee_code' then
      select * into rac from public.referee_access where reference_id = rr.id for update;
      if rac.locked_until is not null and rac.locked_until > now() then
        return jsonb_build_object('ok', false, 'reason', 'locked');
      end if;
      v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
      v_salt := public.referee_secret();
      update public.referee_access
         set code_salt = v_salt, code_hash = public.referee_hash(v_salt || v_code),
             code_expires_at = now() + make_interval(mins => rcfg.code_minutes), code_tries = 0
       where reference_id = rr.id;
      return jsonb_build_object('ok', true, 'params', jsonb_build_object(
        'kind', 'referee_code', 'code', v_code, 'minutes', rcfg.code_minutes,
        'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id)));
    end if;

    v_secret := public.referee_secret();
    update public.leader_references
       set token_hash = public.referee_hash(v_secret), token_expires_at = now() + make_interval(days => rcfg.link_days)
     where id = rr.id;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', m.template, 'secret', v_secret, 'days', rcfg.link_days,
      'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id),
      'applicant_first', public.first_name_of(ra.person_id)));
  end if;

  if m.person_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no person');
  end if;

  if m.template = 'reminder_email' then
    select * into r from public.journey_runs where id = nullif(m.params ->> 'run_id', '')::uuid;
    if not found or r.status <> 'active' then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    v_state := public.journey_state(r);
    if v_state <> 'ok' then
      perform public.journey_apply_state(r.id, v_state);
      update public.journey_sends set kind = 'skipped', reason = left(coalesce(substr(v_state, 7), 'acted'), 60) where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'condition changed: ' || v_state);
    end if;
    if not public.send_window_ok('reminder') then
      return jsonb_build_object('ok', false, 'defer', true);
    end if;
    v_step := nullif(m.params ->> 'step', '')::integer;
    select * into e from public.journey_emails x where x.journey_key = r.journey_key and x.step = v_step;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no wording');
    end if;
    v_data := public.journey_data(r);
    if r.journey_key = 'no_tribe' and v_step = 3 and coalesce((v_data ->> 'seats_left')::integer, 0) <= 0 then
      update public.journey_sends set kind = 'skipped', reason = 'no seats left' where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'the best match has no seats left');
    end if;
    v_copy := jsonb_build_object('subject', e.subject, 'paragraphs', to_jsonb(e.paragraphs), 'button_label', e.button_label,
      'actions', to_jsonb(e.actions), 'tone', e.tone, 'step', v_step, 'journey', r.journey_key);
    if e.target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', e.target, r.id, null, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'reminders', r.id, null, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', r.id, null, 400));
    foreach v_action in array e.actions loop
      v_links := v_links || jsonb_build_object(v_action, public.make_email_link(m.person_id, 'ask', v_action, r.id, null, 90));
    end loop;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'reminder', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));

  elsif m.template = 'office_message' then
    select * into b from public.broadcasts where id = nullif(m.params ->> 'broadcast_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'announcement is gone');
    end if;
    if not (m.params ? 'test') then
      if b.status = 'paused' then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
      if b.status not in ('scheduled', 'sending', 'sent') then
        update public.broadcast_recipients set status = 'skipped', reason = 'cancelled' where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', 'announcement ' || b.status);
      end if;
      v_blocker := coalesce(public.message_blocker(m.person_id), case when public.reminder_stopped(m.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', v_blocker);
      end if;
      if not public.send_window_ok('bulk') then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
    end if;
    v_data := public.broadcast_vars(m.person_id);
    v_copy := jsonb_build_object('subject', (case when m.params ? 'test' then '[Test] ' else '' end) || b.subject,
      'paragraphs', to_jsonb(b.paragraphs), 'button_label', b.button_label, 'actions', '[]'::jsonb, 'tone', 'office', 'step', 0);
    if b.button_target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', b.button_target, null, case when m.params ? 'test' then null else b.id end, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'announcements', null, case when m.params ? 'test' then null else b.id end, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', null, null, 400));
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'announcement', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));
  end if;
  return jsonb_build_object('ok', true, 'params', '{}'::jsonb);
end;
$$;

create or replace function public.broadcast_results(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.broadcasts%rowtype;
  r jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into b from public.broadcasts where id = p_id;
  if not found or not public.broadcast_mine_or_office(b) then
    raise exception 'We could not find that announcement' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'frozen', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id),
    'waiting', (select count(*) from public.broadcast_recipients x where x.broadcast_id = p_id and x.status in ('pending', 'queued')
                   and not exists (select 1 from public.messages m where m.id = x.message_id and m.status in ('sent', 'delivered', 'read', 'failed', 'skipped'))),
    'sent', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
              where x.broadcast_id = p_id and m.status in ('sent', 'delivered', 'read')),
    'delivered', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                   where x.broadcast_id = p_id and m.status in ('delivered', 'read')),
    'bounced', (select count(*) from public.broadcast_recipients x join public.messages m on m.id = x.message_id
                 where x.broadcast_id = p_id and m.status = 'failed'),
    'left_out', coalesce((select jsonb_object_agg(z.reason, z.n) from (
                  select coalesce(x.reason, 'other') as reason, count(*) as n from public.broadcast_recipients x
                   where x.broadcast_id = p_id and x.status in ('skipped', 'cancelled') group by 1) z), '{}'::jsonb),
    'unsubscribed', (select count(*) from public.email_signals e where e.broadcast_id = p_id and e.kind = 'unsubscribe'),
    'tapped', (select count(distinct l.person_id) from public.email_links l where l.broadcast_id = p_id and l.kind = 'go' and l.clicks > 0),
    'final_at', b.finished_at + interval '7 days') into r;
  return r;
end;
$$;

create or replace function public.contact_gaps_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.contact_gaps_role() is distinct from 'act' then
    raise exception 'Your role does not include this file' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') = 'off' then
    raise exception 'Contact gaps is switched Off' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', y.name, 'tribe', y.tribe, 'leader', y.leader, 'cause', y.cause, 'asks', y.asks, 'last_asked', y.last_asked,
           'series', y.ser ->> 'state', 'emails', coalesce((y.ser ->> 'sends')::integer, 0))
           order by y.rank, y.tribe, y.name), '[]'::jsonb) into v_rows
    from (select public.person_display_name(g.person_id) as name, t.name as tribe, public.first_name_of(t.leader_id) as leader, g.cause,
                 h.n as asks, h.last_at as last_asked,
                 public.reach_series_of(g.person_id, (select tm.season_id from public.tribe_members tm where tm.id = g.tm_id)) as ser,
                 case g.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4 when 'not_open' then 5 else 6 end as rank
            from public.contact_gap_rows(public.my_centre()) g
            join public.tribes t on t.id = g.tribe_id
           cross join lateral public.contact_ask_history(g.person_id) h) y;
  perform public.write_event(auth.uid(), 'contact_gaps.exported', 'contact_gaps', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

drop function if exists public.worker_placed_link_state(text, text);
drop function if exists public.worker_placed_nudge_info(text, text);
drop function if exists public.worker_placed_choose(text, text, text, text, boolean, text);
drop function if exists public.worker_placed_new_link(text, text);
drop function if exists public.god_placed_nudge_settings_set(integer, integer, integer, text);
drop function if exists public.god_placed_nudge_settings();
drop function if exists public.whatsapp_confirmed_counts();
drop function if exists public.number_confirmed_for(uuid[]);
drop function if exists public.tribe_nudge_marks(uuid);
drop function if exists public.placed_nudge_overview();
drop function if exists public.placed_nudge_state();
drop function if exists public.placed_held_number(uuid);
drop function if exists public.placed_nudge_selfcheck(uuid);
drop function if exists public.number_confirmed(uuid);
drop function if exists public.number_fp(uuid, text);
drop function if exists public.placed_nudge_blocker(uuid, jsonb, boolean, uuid);
drop function if exists public.placed_nudge_any();
drop function if exists public.placed_waiting_rows(uuid);
drop function if exists public.placed_email_at(uuid);
drop function if exists public.placed_nudge_seat(uuid);
drop function if exists public.placed_is_waiting(uuid);
drop function if exists public.placed_nudge_cfg();

delete from public.feature_settings where feature = 'placed_nudge';
delete from public.feature_registry where key = 'placed_nudge';

drop table if exists public.placed_nudges;
drop table if exists public.placed_links;
drop table if exists public.number_confirmations;
drop table if exists public.placed_nudge_settings;

commit;

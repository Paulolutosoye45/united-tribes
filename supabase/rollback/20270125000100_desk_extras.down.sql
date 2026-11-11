-- Way back from "the Leader Desk, the three things Phase 2 left out" ("Yes, as assistant", "Recommend as leader" on a waiting member's row, WhatsApp for the Desk).
--
-- Puts back, exactly as they were, the seven functions this replaced: desk_offer_complete, worker_desk_offer_info, worker_desk_offer_answer, desk_group_leader,
-- desk_mail_send, desk_offer_open and desk_offer_tick. Drops what it added: five functions, the assistant columns on the Desk's groups, the WhatsApp columns on its
-- settings, and the "assist" answer the offer check allowed.
--
-- What it does to data, plainly:
--   * Every Desk message still waiting to be sent is put back to email, so nothing goes out on WhatsApp after this runs. Messages already sent keep their record.
--   * An offer answered "Yes, as assistant" keeps its place in the list but loses the answer word (it is a no to leading, as it always was).
--   * Who offered to assist a group (the group's column) is deleted. An assistant recommendation already put forward to the church office is kept, as every
--     recommendation is: the office decides it on the Assistants page as usual, and a leader can withdraw it.
--   * The four Desk messages leave WhatsApp mode's table of classes (a message the table does not know stays Class A, and the Desk is email only again).
--   * No member, seat, tribe, notice, consent or number is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
-- (the functions below are put back word for word. Their text may name a table that an earlier phase's way back has since dropped, so they are not checked
-- against the tables as they are now: each is checked against the database as it was, by the rollback test)
set local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.desk_offer_complete(p_offer uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.desk_offers%rowtype;
  g public.desk_groups%rowtype;
  v_form jsonb;
  v_res jsonb;
  v_tribe uuid;
  v_appt uuid;
  m record;
  v_ver text;
  v_welcome jsonb := jsonb_build_object('queued', false, 'reason', 'not_approved');
  v_found integer := 0;
  v_name text;
  v_season uuid := public.placement_season();
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  select * into g from public.desk_groups x where x.id = o.group_id for update;
  if o.status not in ('open', 'review') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if g.status <> 'draft' or g.leader_id is not null then
    perform public.desk_offer_close(p_offer, 'cancelled');
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  v_form := jsonb_build_object(
    'track', (select t.slug from public.tracks t where t.id = g.track_id),
    'lead_best', o.lead_best,
    'community', (select c.slug from public.communities c where c.id = g.community_id),
    'goal', (select sg.slug from public.season_goals sg where sg.id = g.season_goal_id),
    'relation', o.relation);
  v_res := public.leader_appoint_core(o.person_id, v_form, g.season_goal_id, null, p_actor, g.id);
  v_tribe := (v_res ->> 'tribe')::uuid;
  v_appt := (v_res ->> 'appointment')::uuid;

  update public.desk_offers set status = 'accepted', answer = 'lead', answered_at = coalesce(answered_at, now()), tribe_id = v_tribe, appointment_id = v_appt where id = p_offer;
  update public.desk_groups set leader_id = o.person_id, tribe_id = v_tribe, leader_found_at = now() where id = g.id;
  -- The backups are not needed now
  for m in select x.id from public.desk_offers x where x.group_id = g.id and x.id <> p_offer and x.status in ('queued', 'open', 'review') loop
    perform public.desk_offer_close(m.id, 'cancelled');
  end loop;
  delete from public.desk_group_members where group_id = g.id and person_id = o.person_id;

  -- The leader's welcome: the one the church already approved, else the short note a bulk appointment sends
  select s.approved_version into v_ver from public.leader_welcome_settings s where s.id;
  if v_ver is not null then
    v_welcome := public.leader_welcome_queue(v_tribe, v_ver);
  end if;
  if not coalesce((v_welcome ->> 'queued')::boolean, false) and coalesce(v_welcome ->> 'reason', '') <> 'already_sent' then
    select t.name into v_name from public.tribes t where t.id = v_tribe;
    perform public.enqueue_message(o.person_id, 'placement_leader_appointed',
      jsonb_build_object('goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
                         'community', (select c.name from public.communities c where c.id = g.community_id), 'tribe', v_name,
                         'fit', public.leader_fit_word(coalesce(o.fit_degree, 100))),
      v_tribe, 'leader-appointed:' || v_tribe, p_force => 'email');
  end if;

  -- "Your group has a leader", to each member of the draft still waiting who has not said no and whom the Desk may write to
  for m in select d.person_id from public.desk_group_members d where d.group_id = g.id and d.person_id <> o.person_id order by d.added_at, d.person_id loop
    if public.desk_mail_state(m.person_id) not in ('on', 'rehearsal') or public.desk_mail_block(m.person_id) is not null then
      continue;
    end if;
    if v_season is null or not public.desk_offer_member_ok(m.person_id, v_season) then
      continue;
    end if;
    perform public.desk_mail_send('found', m.person_id, null, g.id, null, public.desk_found_params(g.id, m.person_id, o.person_id), p_actor);
    v_found := v_found + 1;
  end loop;

  perform public.write_event(p_actor, 'desk.offer_accepted', 'desk_group', g.id::text, jsonb_build_object('members_told', v_found));
  return jsonb_build_object('ok', true, 'tribe', v_tribe, 'told', v_found, 'welcome', v_welcome ->> 'reason');
end;
$function$;

CREATE OR REPLACE FUNCTION public.worker_desk_offer_info(p_token text, p_link text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  o public.desk_offers%rowtype;
  v_open boolean;
  v_block text;
begin
  perform public.worker_ok(p_token);
  v_id := public.desk_offer_link_offer(p_link);
  if v_id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into o from public.desk_offers y where y.id = v_id;
  update public.desk_offer_links set clicks = clicks + 1 where token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  v_block := public.desk_mail_block(o.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('found', false);
  end if;
  v_open := o.status = 'open' and now() < o.window_ends_at and public.desk_mail_state(o.person_id) = 'on';
  return jsonb_build_object('found', true, 'open', v_open, 'status', o.status, 'first', public.first_name_of(o.person_id), 'answer', o.answer,
    'call_me', o.call_me, 'reminder_set', o.remind_at is not null, 'stopped', coalesce(v_block = 'stopped', false), 'ends', o.window_ends_at,
    'details', case when v_open then public.desk_offer_params(o.group_id, o.person_id, o.window_ends_at, null) else '{}'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.worker_desk_offer_answer(p_token text, p_link text, p_answer text, p_age boolean DEFAULT false, p_lead text DEFAULT NULL::text, p_relation text DEFAULT NULL::text, p_reasons text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  o public.desk_offers%rowtype;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_block text;
  v_code text;
  r record;
begin
  perform public.worker_ok(p_token);
  if p_answer is null or p_answer not in ('lead', 'not_season', 'call', 'tomorrow', 'never', 'stop')
     or not (v_reasons <@ array['busy', 'family', 'not_ready', 'other_goal', 'other']) or cardinality(v_reasons) > 5
     or (p_answer <> 'not_season' and cardinality(v_reasons) > 0)
     or (p_answer = 'lead' and (coalesce(p_age, false) is not true or p_lead is null or p_lead not in ('structure', 'connection', 'teaching', 'doing')
                               or p_relation is null or p_relation not in ('achieved', 'pursuing')))
     or (p_answer <> 'lead' and (p_lead is not null or p_relation is not null or coalesce(p_age, false))) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_id := public.desk_offer_link_offer(p_link);
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into o from public.desk_offers y where y.id = v_id for update;
  v_block := public.desk_mail_block(o.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if p_answer = 'stop' then
    insert into public.desk_stops (person_id) values (o.person_id) on conflict do nothing;
    update public.desk_proposals set status = 'cancelled' where person_id = o.person_id and status in ('sent', 'would_send');
    update public.messages set status = 'skipped', error = 'Stopped by the member', reply_token = null
     where person_id = o.person_id and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer') and status = 'queued';
    for r in select y.id, y.group_id, y.status from public.desk_offers y where y.person_id = o.person_id and y.status in ('queued', 'open', 'review') loop
      perform public.desk_offer_close(r.id, 'cancelled');
      if r.status in ('open', 'review') then
        perform public.desk_offer_advance(r.group_id);
      end if;
    end loop;
    update public.desk_offers set answer = 'stop', answered_at = now() where id = o.id and answer is null;
    perform public.write_event(null, 'desk.stop', 'person', o.person_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'answer', 'stop');
  end if;

  if o.status in ('accepted', 'review') and p_answer = 'lead' then
    return jsonb_build_object('ok', true, 'answer', 'lead', 'again', true, 'review', o.status = 'review');
  end if;
  if o.status = 'declined' and o.answer is not null and p_answer in ('not_season', 'never') then
    return jsonb_build_object('ok', true, 'answer', o.answer, 'again', true);
  end if;
  if o.status <> 'open' or now() >= o.window_ends_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if public.desk_mail_state(o.person_id) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;

  if p_answer = 'call' then
    update public.desk_offers set call_me = true where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'call'));
    return jsonb_build_object('ok', true, 'answer', 'call');
  end if;
  if p_answer = 'tomorrow' then
    if now() + interval '1 day' < o.window_ends_at - interval '1 hour' then
      update public.desk_offers set remind_at = now() + interval '1 day', reminded_tomorrow = null where id = o.id;
      return jsonb_build_object('ok', true, 'answer', 'tomorrow', 'later', true);
    end if;
    return jsonb_build_object('ok', true, 'answer', 'tomorrow', 'later', false);
  end if;
  if p_answer = 'not_season' then
    update public.desk_offers set status = 'declined', answer = 'not_season', reasons = v_reasons, answered_at = now() where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'not_season'));
    perform public.desk_offer_advance(o.group_id);
    return jsonb_build_object('ok', true, 'answer', 'not_season');
  end if;
  if p_answer = 'never' then
    insert into public.desk_lead_stops (person_id) values (o.person_id) on conflict do nothing;
    update public.desk_offers set status = 'declined', answer = 'never', answered_at = now() where id = o.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'never'));
    perform public.desk_offer_advance(o.group_id);
    return jsonb_build_object('ok', true, 'answer', 'never');
  end if;

  -- Yes, I will lead: the gates are checked again at this moment
  v_code := public.desk_offer_gate(o.person_id, o.group_id, o.id);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_available', 'code', v_code);
  end if;
  update public.desk_offers set lead_best = p_lead, relation = p_relation, age_confirmed_at = now() where id = o.id;
  return public.desk_offer_accept(o.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.desk_group_leader(p_group uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  g public.desk_groups%rowtype;
  v_last integer;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  select max(x.round) into v_last from public.desk_offers x where x.group_id = p_group and not x.rehearsal;
  return jsonb_build_object(
    'problem', public.desk_offer_problem(p_group),
    'paused', g.backups_paused,
    'leader', case when g.leader_id is null then null else jsonb_build_object(
        'person_id', g.leader_id, 'name', public.person_display_name(g.leader_id), 'found_at', g.leader_found_at, 'tribe_id', g.tribe_id,
        'tribe_status', (select t.status::text from public.tribes t where t.id = g.tribe_id),
        'certified', exists (select 1 from public.leader_certifications lc where lc.person_id = g.leader_id)) end,
    'needs_decision', g.leader_id is null and g.status = 'draft' and v_last is not null
        and not exists (select 1 from public.desk_offers x where x.group_id = p_group and x.round = v_last and not x.rehearsal and x.status in ('queued', 'open', 'review', 'accepted')),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'round', x.round, 'seq', x.seq, 'person_id', x.person_id, 'name', public.person_display_name(x.person_id), 'status', x.status,
               'rehearsal', x.rehearsal, 'opened_at', x.opened_at, 'window_ends_at', x.window_ends_at, 'call_me', x.call_me, 'answer', x.answer,
               'fit', x.fit_degree,
               'phone', public.placed_desk_mask(public.placed_held_number(x.person_id)), 'has_number', public.placed_held_number(x.person_id) is not null)
             order by x.round desc, x.seq)
        from (select * from public.desk_offers y where y.group_id = p_group order by y.round desc, y.seq limit 12) x), '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.desk_mail_send(p_kind text, p_person uuid, p_tribe uuid, p_group uuid, p_degree integer, p_params jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s public.desk_settings%rowtype;
  v_state text := public.desk_mail_state(p_person);
  v_id uuid;
  v_msg uuid;
  v_link text;
  v_expires timestamptz;
  v_status text;
begin
  if v_state not in ('on', 'rehearsal') then
    raise exception '%', public.desk_mail_words('off') using errcode = '22023';
  end if;
  select * into s from public.desk_settings x where x.id;
  v_expires := now() + case p_kind when 'interest' then make_interval(hours => s.interest_hours) else interval '7 days' end;
  v_status := case when v_state = 'rehearsal' then 'would_send' else 'sent' end;
  insert into public.desk_proposals (kind, person_id, season_id, tribe_id, group_id, rehearsal, status, degree, created_by, expires_at)
  values (p_kind, p_person, public.placement_season(), p_tribe, p_group, v_state = 'rehearsal', v_status, p_degree, p_actor, v_expires)
  returning id into v_id;
  if v_state = 'on' then
    -- The link outlives the question by 30 days, so "Stop these" keeps working
    v_link := public.desk_link_mint(v_id, p_person, 30 + 7);
    v_msg := public.enqueue_message(p_person, case p_kind when 'interest' then 'desk_interest' when 'found' then 'desk_found' else 'desk_proposal' end,
      p_params || jsonb_build_object('stop', true), p_tribe, 'desk:' || v_id::text, public.desk_send_at(), 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
      update public.desk_proposals set message_id = v_msg where id = v_id;
    end if;
  end if;
  perform public.write_event(p_actor, 'desk.proposal', 'person', p_person::text, jsonb_build_object('kind', p_kind, 'mode', v_state));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.desk_offer_open(p_offer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.desk_offers%rowtype;
  s public.desk_settings%rowtype;
  v_at timestamptz := public.desk_send_at();
  v_ends timestamptz;
  v_link text;
  v_msg uuid;
begin
  select * into o from public.desk_offers x where x.id = p_offer for update;
  select * into s from public.desk_settings x where x.id;
  v_ends := v_at + make_interval(hours => s.offer_hours);
  update public.desk_offers set status = 'open', opened_at = v_at, window_ends_at = v_ends where id = p_offer;
  -- The link outlives the window by a week, so "Stop these" and "Never ask me to lead" keep working
  v_link := public.desk_offer_link_mint(p_offer, o.person_id, v_ends + interval '7 days');
  v_msg := public.enqueue_message(o.person_id, 'desk_offer', public.desk_offer_params(o.group_id, o.person_id, v_ends, null) || jsonb_build_object('stop', true),
                                  null, 'desk-offer:' || p_offer::text, v_at, 'normal', 'email');
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
    update public.desk_offers set message_id = v_msg where id = p_offer;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.desk_offer_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_ended integer := 0;
  v_expired integer := 0;
  v_reminded integer := 0;
  v_links integer;
  v_kind text;
  v_link text;
  v_msg uuid;
  v_at timestamptz;
begin
  for r in select o.id from public.desk_offers o join public.desk_groups g on g.id = o.group_id
            where o.status in ('queued', 'open', 'review') and not o.rehearsal and (g.status <> 'draft' or g.leader_id is not null) loop
    perform public.desk_offer_close(r.id, 'cancelled');
    v_ended := v_ended + 1;
  end loop;
  for r in select o.id, o.group_id from public.desk_offers o where o.status = 'open' and o.window_ends_at < now() loop
    perform public.desk_offer_close(r.id, 'expired');
    perform public.write_event(null, 'desk.offer_expired', 'desk_group', r.group_id::text, '{}'::jsonb);
    perform public.desk_offer_advance(r.group_id);
    v_expired := v_expired + 1;
  end loop;
  for r in
    select o.*, case when o.reminded_24 is null and now() >= o.window_ends_at - interval '24 hours' and now() < o.window_ends_at - interval '12 hours'
                          and o.opened_at < o.window_ends_at - interval '25 hours' then '24'
                     when o.reminded_12 is null and now() >= o.window_ends_at - interval '12 hours' and now() < o.window_ends_at - interval '1 hour'
                          and o.opened_at < o.window_ends_at - interval '13 hours' then '12'
                     when o.remind_at is not null and o.reminded_tomorrow is null and o.remind_at <= now() and o.window_ends_at > now() + interval '1 hour' then 'tomorrow'
                end as due
      from public.desk_offers o
     where o.status = 'open' and not o.rehearsal and o.window_ends_at > now()
  loop
    v_kind := r.due;
    if v_kind is null or public.desk_mail_state(r.person_id) <> 'on' or public.desk_mail_block(r.person_id) is not null then
      continue;
    end if;
    v_at := public.desk_send_at();
    v_link := public.desk_offer_link_mint(r.id, r.person_id, r.window_ends_at + interval '7 days');
    v_msg := public.enqueue_message(r.person_id, 'desk_offer', public.desk_offer_params(r.group_id, r.person_id, r.window_ends_at, v_kind) || jsonb_build_object('stop', true),
                                    null, 'desk-offer:' || r.id::text || ':r' || v_kind, v_at, 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
    end if;
    update public.desk_offers set reminded_24 = case when v_kind = '24' then now() else reminded_24 end,
                                  reminded_12 = case when v_kind = '12' then now() else reminded_12 end,
                                  reminded_tomorrow = case when v_kind = 'tomorrow' then now() else reminded_tomorrow end
     where id = r.id;
    v_reminded := v_reminded + 1;
  end loop;
  delete from public.desk_offer_links where expires_at < now();
  get diagnostics v_links = row_count;
  return jsonb_build_object('offers_ended', v_ended, 'offers_expired', v_expired, 'offers_reminded', v_reminded, 'offer_links', v_links);
end;
$function$;

-- Nothing waiting goes out on WhatsApp now
do $rb$
begin
  if to_regclass('public.messages') is not null then
    update public.messages set force_channel = 'email'
     where status = 'queued' and force_channel is null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer');
  end if;
  if to_regclass('public.whatsapp_message_class') is not null then
    delete from public.whatsapp_message_class where template in ('desk_offer', 'desk_proposal', 'desk_interest', 'desk_found');
  end if;
end;
$rb$;

drop function if exists public.desk_person_lead_options(uuid);
drop function if exists public.desk_assistant_put_forward(uuid, uuid, uuid);
drop function if exists public.desk_whatsapp_set(boolean, text);
drop function if exists public.desk_whatsapp_state();
drop function if exists public.desk_whatsapp_on();

-- The "assist" answer goes; an offer that was answered that way keeps its place and loses only the word
-- (each table is looked for first: the Desk's own way back may already have dropped it, and running this twice must change nothing)
do $rbassist$
begin
  if to_regclass('public.desk_offers') is not null then
    update public.desk_offers set answer = null where answer = 'assist';
  end if;
end;
$rbassist$;
alter table if exists public.desk_offers drop constraint if exists desk_offers_answer_check;
alter table if exists public.desk_offers add constraint desk_offers_answer_check check (answer in ('lead', 'not_season', 'never', 'stop', 'owner'));

alter table if exists public.desk_groups drop column if exists assistant_offer_id, drop column if exists assistant_yes_at, drop column if exists assistant_id;
alter table if exists public.desk_settings drop column if exists whatsapp_changed_at, drop column if exists whatsapp_changed_by, drop column if exists whatsapp_reason, drop column if exists whatsapp_on;
commit;

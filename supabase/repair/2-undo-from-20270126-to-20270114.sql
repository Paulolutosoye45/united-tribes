-- Repair, step 2 of 3: UNDO the files from 20270114000100 onward, newest first, in one go.
--
-- Use this when supabase/check-applied.sql shows some of the files from 20270114000100 to 20270120000100 as MISSING while later ones (20270121000100 and
-- after) are applied: the files went in out of order, so the later ones were built on a base that is not there.
-- It runs the 13 way-back files in the order they must run (20270126000100 down to 20270114000100). Each file is safe to run when its
-- feature is only partly there or not there at all, and each one runs in its own transaction.
--
-- Before you run it: take a backup (Supabase > Database > Backups), and run step 1 (1-count-before-undo.sql) and read the numbers.
-- Afterwards the database is where it stood just before 20270114000100: run step 3 (apply the files 20270114000100 to 20270126000100 one at a time, in order).
-- Every switch on the Switchboard that belongs to these files is gone with them and comes back Off when its file is applied again.
--
-- Written by scripts/build-repair.mjs from supabase/rollback/. Do not edit it by hand.

-- ===== 20270126000100_sign_in_prompt.down.sql =====
-- Way back from "the sign-in prompt" (the screen on top of the page that asks a signed-in person for the answer they owe: say yes to a placement, add a WhatsApp number,
-- answer an offer to lead a group, book an interview time). Switch "Sign-in prompt" Off first.
--
-- It replaced nothing, so this puts back nothing: it drops the one line on the Switchboard, the 17 functions and the four tables it added.
--
-- What it does to data, plainly:
--   * The answers people gave on the screen are NOT undone. A "yes" to a placement, a number saved, a WhatsApp yes or no, a booked interview time and an answered offer
--     were recorded by the site's own functions (the same ones the emails use), so they stay exactly where they are.
--   * The prompt's own memory is removed with its tables: the visits, the log of what was shown (kind and outcome only, never a number or an answer) and the "not now" counts.
--     Copy them first if you want the record (select * from public.prompt_log).
--   * No member, seat, tribe, notice, consent, message or number is changed. The emails and the banners were never touched, so they carry on as before.
-- Run it as the database owner. Running it twice changes nothing.
begin;

delete from public.feature_settings where feature = 'sign_in_prompt';
delete from public.feature_registry where key = 'sign_in_prompt';

drop function if exists public.god_prompt_settings_set(integer, integer, integer, integer, text[], text);
drop function if exists public.god_prompt_settings();
drop function if exists public.prompt_overview(integer);
drop function if exists public.prompt_whatsapp_answer(boolean);
drop function if exists public.prompt_save_number(text, boolean, boolean);
drop function if exists public.prompt_placement_answer(text, text, text);
drop function if exists public.prompt_log_set(text, text);
drop function if exists public.my_prompt_queue();
drop function if exists public.prompt_tasks_owed(uuid);
drop function if exists public.prompt_task(uuid, text);
drop function if exists public.prompt_mask(text);
drop function if exists public.prompt_can_skip(uuid);
drop function if exists public.prompt_seat_deadline(uuid);
drop function if exists public.prompt_rostered(uuid);
drop function if exists public.prompt_never(uuid);
drop function if exists public.prompt_rung(text);
drop function if exists public.prompt_kinds();

drop table if exists public.prompt_streaks;
drop table if exists public.prompt_log;
drop table if exists public.prompt_visits;
drop table if exists public.prompt_settings;

commit;

-- ===== 20270125000100_desk_extras.down.sql =====
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

-- ===== 20270124000100_hod_reconcile.down.sql =====
-- Takes Fix 7's HOD report back. Run before the earlier packages' own rollbacks. The reports (and the contacts they hold) are removed with their tables: copy them first if you
-- want to keep them. Departments already put on leaders stay (they are ordinary labels), invitations already sent stay sent, and nobody's role changes.
begin;

drop function if exists public.hod_reconcile_delete(uuid);
drop function if exists public.hod_reconcile_invite(uuid);
drop function if exists public.hod_reconcile_tag(uuid);
drop function if exists public.hod_reconcile_list();
drop function if exists public.hod_reconcile_get(uuid);
drop function if exists public.hod_reconcile_run(jsonb, text);
drop function if exists public.hod_results(uuid);
drop function if exists public.hod_email_norm(text);

drop table if exists public.hod_reconcile_rows;
drop table if exists public.hod_reconciles;

commit;

-- ===== 20270123000100_guide_release.down.sql =====
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

-- ===== 20270122000100_seat_autopilot.down.sql =====
-- Takes Package 8 back. Switch "Seat autopilot" Off first. People it placed stay placed (they are ordinary placements with their own "Your tribe" email, Undo and
-- seat clock); emails already sent stay sent. The plans and what each plan held are removed with their tables: copy them first if you want to keep the record
-- (select * from public.autopilot_plans; select * from public.autopilot_items). Run before Package 7's own rollback.
begin;

delete from public.feature_settings where feature = 'seat_autopilot';
delete from public.feature_registry where key = 'seat_autopilot';

drop trigger if exists autopilot_gate_insert on public.feature_settings;
drop trigger if exists autopilot_gate_update on public.feature_settings;

drop function if exists public.god_autopilot_settings_set(text, integer, integer, integer, integer, integer, text);
drop function if exists public.god_autopilot_settings();
drop function if exists public.autopilot_pause_set(boolean, text);
drop function if exists public.autopilot_approve(uuid);
drop function if exists public.autopilot_overview();
drop function if exists public.autopilot_tick();
drop function if exists public.autopilot_apply_core(uuid, uuid);
drop function if exists public.autopilot_plan_build(uuid, text);
drop function if exists public.autopilot_bench(uuid, integer);
drop function if exists public.autopilot_season(integer);
drop function if exists public.autopilot_degree(uuid, uuid, boolean);
drop function if exists public.autopilot_gate();
drop function if exists public.autopilot_any();

drop table if exists public.autopilot_items;
drop table if exists public.autopilot_plans;
drop table if exists public.autopilot_settings;

-- The earlier texts, exactly (Package 7's)
create or replace function public.seat_morning_numbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_y date := public.today_lagos() - 1;
  v_taken integer;
  v_yes integer;
  v_rel integer;
  v_left integer;
  v_refill integer;
begin
  select count(*) filter (where l.kind = 'taken' and l.reason is distinct from 'Taken back'), count(*) filter (where l.kind = 'confirmed'),
         count(*) filter (where l.kind = 'released'), count(*) filter (where l.kind = 'left'),
         count(*) filter (where l.kind = 'taken' and l.via = 'seat-window')
    into v_taken, v_yes, v_rel, v_left, v_refill
    from public.seat_ledger l where (l.at at time zone 'Africa/Lagos')::date = v_y;
  return jsonb_build_object(
    'taken', v_taken, 'yes', v_yes, 'released', v_rel, 'left', v_left, 'refilled', v_refill,
    'not_reached', (select count(*) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by = 'not_reached'),
    'hard', (select count(*) from public.seat_clocks k where k.state = 'released' and k.hard_to_fill and k.replaced_by is null and not k.rehearsal),
    'stopped', (select count(distinct k.blocked_by) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by in ('email', 'day_cap', 'tribe_quarter')),
    'small', (select count(*) from public.tribes t where t.status = 'approved'
               and (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') between 1 and 4),
    'over', (select count(*) from public.tribes t where (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') > 12),
    'in_series', (select count(*) from public.reach_enrolments x where x.status = 'active' and not x.rehearsal));
end;
$$;

create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.worker_ok(p_token);
  v := public.seat_clock_tick();
  -- The leader's note at 5 pm and the office's email at 7 am: each does nothing unless the seat window is On, and each fault is its own
  begin
    v := v || jsonb_build_object('notes', public.seat_notes_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'leader note: ' || sqlerrm);
  end;
  begin
    v := v || jsonb_build_object('morning', public.seat_morning_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'morning email: ' || sqlerrm);
  end;
  return v;
end;
$$;

commit;

-- ===== 20270121000100_seat_release.down.sql =====
-- Takes Package 7 back. Switch "Release at the end of the series" Off first. Seats already released stay released and are ordinary placements again; emails already
-- sent stay sent. Run before the Seat window's own rollback.
begin;

delete from public.feature_settings where feature = 'reach_release';
delete from public.feature_registry where key = 'reach_release';

drop trigger if exists reach_release_gate_insert on public.feature_settings;
drop trigger if exists reach_release_gate_update on public.feature_settings;

drop function if exists public.seat_morning_tick();
drop function if exists public.seat_morning_numbers();
drop function if exists public.seat_notes_tick();
drop function if exists public.my_tribe_leave(text);
drop function if exists public.my_tribe_leave_state();
drop function if exists public.reach_release_seat(uuid, text);
drop function if exists public.reach_release_gate();

-- The earlier texts, exactly
create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.seat_clock_tick();
end;
$$;

create or replace function public.seat_ledger_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via text := coalesce(nullif(current_setting('app.seat_via', true), ''), case when auth.uid() is null then 'system' else 'other' end);
begin
  if tg_op = 'INSERT' then
    insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
    values (new.id, new.person_id, new.tribe_id, 'taken', null, auth.uid(), v_via);
    if new.confirmed_at is not null or new.placement_source <> 'auto' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  else
    if new.status = 'released' and old.status = 'active' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, case when new.release_reason = 'No reply in time' then 'released' else 'left' end, left(new.release_reason, 300), auth.uid(), v_via);
    elsif new.status = 'active' and old.status = 'released' then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'taken', 'Taken back', auth.uid(), v_via);
    elsif new.confirmed_at is not null and old.confirmed_at is null then
      insert into public.seat_ledger (tm_id, person_id, tribe_id, kind, reason, actor, via)
      values (new.id, new.person_id, new.tribe_id, 'confirmed', null, auth.uid(), v_via);
    end if;
  end if;
  return null;
end;
$$;

-- reach_step names the series' own tables, so it is put back only while those tables exist (a way back run again after the series' own has already
-- taken them away has nothing to put it back on)
do $do$
begin
  if to_regclass('public.reach_enrolments') is not null then
    execute $q$
create or replace function public.reach_step(p_id uuid, p_ask boolean default false, p_line text default null, p_by uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.reach_enrolments%rowtype;
  s public.reach_settings%rowtype;
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  se public.seasons%rowtype;
  v_state text;
  v_want text;
  v_cause text;
  v_block text;
  v_n integer;
  v_due timestamptz;
  v_end timestamptz;
  v_shift interval;
  v_late integer;
  v_failed boolean;
  v_seen boolean;
begin
  select * into e from public.reach_enrolments x where x.id = p_id and x.status = 'active' for update skip locked;
  if not found then
    return 'busy';
  end if;
  select * into s from public.reach_settings x where x.id;
  v_want := case when e.rehearsal then 'rehearsal' else 'on' end;
  v_state := public.reach_state_of(e.person_id);

  -- A Rehearsal is over the moment the real thing is On
  if e.rehearsal and v_state = 'on' then
    perform public.reach_end(e.id, 'rehearsal_over');
    return 'ended';
  end if;
  -- Off, the Master pause, or the office's pause: freeze, and keep the days it had left
  if v_state <> v_want or s.paused then
    if e.frozen_at is null then
      update public.reach_enrolments set frozen_at = now(), frozen_why = case when s.paused then 'paused' else 'switch' end where id = e.id;
    end if;
    return 'frozen';
  end if;
  -- Thaw: the days it had left are the days it has
  if e.frozen_at is not null then
    v_shift := now() - e.frozen_at;
    update public.reach_enrolments x
       set day0_at = x.day0_at + v_shift, first_go_until = x.first_go_until + v_shift, frozen_at = null, frozen_why = null
     where x.id = e.id;
    e.day0_at := e.day0_at + v_shift;
    e.first_go_until := e.first_go_until + v_shift;
    e.frozen_at := null;
    e.frozen_why := null;
  end if;
  -- The leader said they will follow this person up themselves: three days, once
  if e.paused_until is not null then
    if e.paused_until > now() then
      return 'following_up';
    end if;
    v_shift := e.paused_until - e.paused_at;
    update public.reach_enrolments x
       set day0_at = x.day0_at + v_shift, first_go_until = x.first_go_until + v_shift, paused_at = null, paused_until = null
     where x.id = e.id;
    e.day0_at := e.day0_at + v_shift;
    e.first_go_until := e.first_go_until + v_shift;
    e.paused_at := null;
    e.paused_until := null;
  end if;

  -- Is the person still someone to ask, in the seat they were asked for?
  select * into tm from public.tribe_members x where x.id = e.tm_id;
  select * into t from public.tribes x where x.id = e.tribe_id;
  select * into se from public.seasons x where x.id = t.season_id;
  if tm.id is null or tm.status <> 'active' or t.status = 'closed' or se.status = 'closed' then
    perform public.reach_end(e.id, 'left');
    return 'ended';
  end if;
  if public.is_minor(e.person_id) or coalesce(public.message_blocker(e.person_id), '') in ('under18', 'deletion') then
    perform public.reach_end(e.id, 'not_eligible');
    return 'ended';
  end if;
  v_cause := public.contact_gap_cause_of(e.person_id, tm.id);
  if v_cause is null then
    perform public.reach_end(e.id, 'fixed');
    return 'ended';
  end if;
  if v_cause in ('withheld', 'not_open') then
    perform public.reach_end(e.id, 'not_eligible');
    return 'ended';
  end if;
  if v_cause = 'unreachable' then
    perform public.reach_end(e.id, 'not_reached');
    return 'ended';
  end if;
  v_block := public.reach_block_of(e.person_id, tm.id);
  if v_block in ('bounced', 'email_off') then
    perform public.reach_end(e.id, 'not_reached');
    return 'ended';
  end if;
  if v_block in ('care', 'on_clock') then
    update public.reach_enrolments set frozen_at = now(), frozen_why = v_block where id = e.id;
    return 'frozen';
  end if;
  -- What is missing can change (a number added, the yes still missing): the next email says what is true now
  if v_cause in ('no_number', 'made_up') and e.kind <> 'no_number' then
    update public.reach_enrolments set kind = 'no_number' where id = e.id;
  elsif v_cause = 'no_yes' and e.kind <> 'no_yes' then
    update public.reach_enrolments set kind = 'no_yes' where id = e.id;
  end if;

  v_n := e.sends + 1;
  if v_n <= 4 then
    if p_ask then
      if v_n <> 1 then
        return 'waiting';
      end if;
    else
      v_due := case when v_n = 1 then e.first_go_until
                    else e.day0_at + make_interval(days => (e.email_days[v_n] + e.shift_days)::integer) end;
      if now() < v_due then
        return 'waiting';
      end if;
      -- More than two days late: the email is not sent late. The whole series moves on by the days lost, so the spacing is kept
      if v_n > 1 and now() > v_due + interval '2 days' then
        v_late := ceil(extract(epoch from (now() - v_due)) / 86400.0)::integer;
        update public.reach_enrolments set shift_days = shift_days + v_late where id = e.id;
        perform public.write_event(null, 'reach.moved_on', 'person', e.person_id::text, jsonb_build_object('days', v_late, 'email', v_n));
        return 'shifted';
      end if;
      if not public.reach_window_ok() then
        return 'waiting';
      end if;
    end if;
    return public.reach_send(e.id, v_n, case when v_n = 1 then p_line end, p_by);
  end if;

  -- All four have gone. The end comes release_days (and the days lost) after email 1
  v_end := e.day0_at + make_interval(days => (e.release_days + e.shift_days)::integer);
  if now() < v_end or not public.reach_window_ok() then
    return 'waiting';
  end if;
  -- Wait for an email still on its way (for at most a day), so "delivered" is a fact
  if exists (select 1 from public.reach_sends r join public.messages m on m.id = r.message_id
              where r.enrolment_id = e.id and m.status in ('queued', 'sending') and m.created_at > now() - interval '1 day') then
    return 'waiting';
  end if;
  v_failed := exists (select 1 from public.reach_sends r left join public.messages m on m.id = r.message_id
                       where r.enrolment_id = e.id and r.status = 'sent' and (m.id is null or m.status in ('failed', 'skipped')))
              or exists (select 1 from public.email_signals g where g.person_id = e.person_id and g.kind = 'hard_bounce' and g.created_at >= e.started_at);
  v_seen := exists (select 1 from public.reach_links l where l.person_id = e.person_id and l.clicks > 0 and l.created_at >= e.started_at)
            or exists (select 1 from auth.users u where u.id = e.person_id and u.last_sign_in_at > e.day0_at)
            or exists (select 1 from public.event_log ev where ev.actor_id = e.person_id and ev.at > e.day0_at);
  perform public.reach_end(e.id, case when v_failed and not e.rehearsal then 'not_reached' when v_seen then 'seen_not_done' else 'silent' end);
  return 'ended';
end;
$$;
    $q$;
  end if;
end
$do$;

commit;

-- ===== 20270120000100_seat_window.down.sql =====
-- Way back from "Package 6, the seat window" (the 48-hour clock).
--
-- Puts back, word for word, the one function Package 6 replaced (placed_seq_block, as Package 6b had it). Drops what Package 6 added: the Seat window switch and every
-- rule the owner set for it, the clocks, their log, the chain of offers, the seat ledger, the 12-seat guard on tribe_members and every function and trigger.
--
-- What it does to data, plainly:
--   * A seat the clock released stays released. It was an ordinary release and the seat the next person was offered is an ordinary seat, placed by the ordinary function.
--     Taking a seat back is the office's job (place the person again), not this file's.
--   * An email already sent stays sent. One still waiting to go is left to go (the wording is in the application, so put the application files back first).
--   * The seat ledger is dropped with its lines: the log of the seats' own changes is still in the event log.
--   * No member, consent, number or tribe is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
set local check_function_bodies = off;

drop trigger if exists seat_window_gate_insert on public.feature_settings;
drop trigger if exists seat_window_gate_update on public.feature_settings;
delete from public.feature_settings where feature = 'seat_window';
delete from public.feature_registry where key = 'seat_window';

drop trigger if exists tribe_members_cap_guard_insert on public.tribe_members;
drop trigger if exists tribe_members_cap_guard_update on public.tribe_members;
drop trigger if exists seat_ledger_write on public.tribe_members;
drop trigger if exists seat_clock_on_answer on public.tribe_members;

create or replace function public.placed_seq_block(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := public.message_blocker(p_person);
begin
  if public.is_minor(p_person) then
    return 'under18';
  end if;
  if v in ('deletion', 'under18') then
    return v;
  end if;
  if public.reminder_stopped(p_person, 'announcements') then
    return 'announcements_off';
  end if;
  if v in ('bounced', 'email_off') then
    return v;
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = p_person and f.status <> 'closed') then
    return 'care';
  end if;
  if exists (select 1 from public.placed_answers a where a.tm_id = p_tm and a.kind = 'stop_reminders') then
    return 'stopped';
  end if;
  if exists (select 1 from public.placed_holds h where h.tm_id = p_tm and h.held_until > now()) then
    return 'held';
  end if;
  if public.placed_call_pending(p_tm) then
    return 'call_pending';
  end if;
  return null;
end;
$$;

-- The tables go first: the ledger's trigger depends on the function that freezes it
drop table if exists public.seat_ledger;
drop table if exists public.seat_chain;
drop table if exists public.seat_clock_log;
drop table if exists public.seat_clocks;
drop table if exists public.seat_window_settings;

drop function if exists
  public.seat_ledger_frozen(), public.tribe_members_cap_guard(), public.seat_ledger_write(), public.seat_role(), public.seat_need(boolean), public.seat_open_at(timestamptz),
  public.seat_in_window(), public.seat_window_any(), public.seat_clock_block(uuid), public.seat_never(uuid, uuid), public.seat_msg_state(text), public.seat_email_breaker(),
  public.seat_releases_today(), public.seat_breaker(uuid), public.seat_breaker_words(text), public.seat_health_core(), public.seat_window_gate(), public.seat_log(uuid, text, uuid, jsonb),
  public.seat_mail_key(uuid, text), public.seat_mail(uuid, text), public.seat_clock_new(uuid, timestamptz, boolean, integer), public.seat_clock_sweep(integer),
  public.seat_clock_on_answer(), public.seat_pick(uuid, uuid, uuid), public.seat_replace(uuid, boolean), public.seat_release_core(uuid, uuid, text),
  public.seat_take_back_core(uuid, uuid), public.seat_clock_step(uuid), public.seat_clock_tick(), public.seat_extend_core(uuid, uuid, text), public.seat_link_clock(text),
  public.seat_can_take_back(uuid), public.seat_board_base(uuid, boolean),
  public.god_seat_settings(), public.god_seat_settings_set(integer, integer, integer, integer, integer, integer, integer, integer, text), public.seat_pause_set(boolean, text),
  public.seat_board(text, integer, integer), public.seat_clock_history(uuid), public.seat_keep(uuid, text), public.seat_extend(uuid), public.seat_release_now(uuid, text),
  public.seat_give_back(uuid), public.seat_test_send(), public.seat_leader_strip(uuid), public.seat_leader_more_time(uuid),
  public.worker_seat_window_tick(text), public.worker_seat_info(text, text), public.worker_seat_take_back(text, text);


commit;

-- ===== 20270119000100_desk_open.down.sql =====
-- Way back from "the Leader Desk, Phase 2b-2" (Open tribe, the pastors' 24-hour reminder, the leader pipeline and its limits).
--
-- Puts back, exactly as they were, the two functions Phase 2b-2 replaced: desk_interest_check (as Phase 2a had it) and desk_tick (as Phase 2b-1 had it). Drops what
-- 2b-2 added: its functions and the opened_at column on the Desk's groups. The Switchboard text for the Leader Desk goes back to Phase 2b-1's.
--
-- What it does to data, plainly:
--   * Members already placed by Open tribe stay placed: those are ordinary seats, placed by the ordinary function, and taking them back is Undo's job, not this file's.
--   * A draft that Open tribe archived stays archived.
--   * A reminder already sent to the pastors stays sent. Nothing sends another.
--   * The settings the owner changed stay as they are (the columns belong to Phase 2b-1).
--   * No member, seat, notice, consent or number is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
-- (the functions below are put back word for word. Their text may name a table that an earlier phase's way back has since dropped, so they are not checked
-- against the tables as they are now: each is checked against the database as it was, by the rollback test)
set local check_function_bodies = off;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode for members who finished the form and still have no tribe. It shows who is waiting and why, a masked phone number (opened one at a time, in calling hours), draft groups scored like tribe cards, and each member''s leadership signal. It can email a waiting member one open tribe that fits, ask the members of a draft whether it would suit them, and offer a draft group to a member to lead (with up to two backups, 72 hours to answer, started from a private page, a confirmed age of 21 or more, and the tribe card started from the draft for a pastor to approve). Rehearsal writes down what would be sent and sends nothing. It never places anyone, approves a card or certifies a leader.'
 where key = 'leader_desk';

create or replace function public.desk_interest_check(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  m record;
  v_season uuid := public.placement_season();
  v_state text;
  v_code text;
  v_params jsonb;
  v_sent integer := 0;
  v_would integer := 0;
  v_skipped jsonb := '{}'::jsonb;
  v_res jsonb;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if g.status <> 'draft' then
    raise exception 'That group has been archived' using errcode = '22023';
  end if;
  if not exists (select 1 from public.desk_group_members x where x.group_id = p_group) then
    raise exception 'Put at least one member in the group first' using errcode = '22023';
  end if;
  for m in select x.person_id from public.desk_group_members x where x.group_id = p_group order by x.added_at, x.person_id loop
    v_state := public.desk_mail_state(m.person_id);
    v_code := case
      when v_state not in ('on', 'rehearsal') then 'off'
      when exists (select 1 from public.desk_proposals x where x.group_id = p_group and x.person_id = m.person_id and x.status in ('sent', 'would_send', 'answered')
                      and x.rehearsal = (v_state = 'rehearsal')) then 'already'
      when v_season is null or not exists (select 1 from public.desk_waiting_base(v_season) w where w.person_id = m.person_id) then 'not_waiting'
      else coalesce(public.desk_mail_block(m.person_id), public.desk_mail_cap(m.person_id, v_state = 'rehearsal')) end;
    if v_code is null and jsonb_array_length(public.desk_group_fit(m.person_id, p_group) -> 'blocked') > 0 then
      v_code := 'no_fit';
    end if;
    if v_code is not null then
      v_skipped := jsonb_set(v_skipped, array[v_code], to_jsonb(coalesce((v_skipped ->> v_code)::integer, 0) + 1));
      continue;
    end if;
    v_params := public.desk_interest_params(p_group, m.person_id);
    v_res := public.desk_mail_send('interest', m.person_id, null, p_group, null, v_params, auth.uid());
    if v_res ->> 'status' = 'would_send' then
      v_would := v_would + 1;
    else
      v_sent := v_sent + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'would_send', v_would, 'skipped', v_skipped);
end;
$$;

create or replace function public.desk_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_links integer;
  v_cleared integer;
  v_offers jsonb;
begin
  v_offers := public.desk_offer_tick();
  update public.desk_proposals set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_expired = row_count;
  delete from public.desk_links where expires_at < now();
  get diagnostics v_links = row_count;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('expired', v_expired, 'links', v_links, 'cleared', v_cleared) || v_offers;
end;
$$;

drop function if exists public.desk_pipeline_settings_set(integer, integer, integer, integer, text);
drop function if exists public.desk_pipeline();
drop function if exists public.desk_open_tribe(uuid);
drop function if exists public.desk_open_preview(uuid);
drop function if exists public.desk_card_tick();
drop function if exists public.desk_open_plan(uuid);
drop function if exists public.desk_open_words(text);

alter table if exists public.desk_groups drop column if exists opened_at;

commit;

-- ===== 20270118000100_desk_offers.down.sql =====
-- Way back from "the Leader Desk, Phase 2b-1" (recommend a leader with backups, the member's private offer page, the shared appointment step, the tribe card
-- started from the draft, and "Your group has a leader").
--
-- Puts back, exactly as they were, the six functions Phase 2b-1 replaced: god_appoint_leader and save_tribe_card (before it) and desk_mail_send, worker_desk_info,
-- worker_desk_answer and desk_tick (as Phase 2a had them). Drops what 2b-1 added: its functions, the offer tables, the "never ask me to lead" list, the new columns
-- on the Desk's groups and settings. The Switchboard text for the Leader Desk goes back to Phase 2a's.
--
-- What it does to data, plainly:
--   * Offers, their links and the "never ask me to lead" list are deleted. Any email already queued keeps its place in the queue; the page it links to is gone, so the
--     link says it cannot be opened.
--   * "Your group has a leader" records (kind found) are deleted from the Desk's sent list.
--   * A tribe card the Desk started keeps every field it has. Only the locks on slot, format, area, circle kind and seats are lifted (track, community and goal stay
--     locked, as they were before).
--   * A leader appointed through an accepted offer stays appointed, with the card and the appointment record: undoing that is the leader board's job, not this file's.
--   * No member, seat, notice, consent or number is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
-- (the functions below are put back word for word. Their text may name a table that an earlier phase's way back has since dropped, so they are not checked
-- against the tables as they are now: each is checked against the database as it was, by the rollback test)
set local check_function_bodies = off;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal. Can email a waiting member one open tribe that fits them, or ask the members of a draft group whether they are interested; each is answered on a private page. In Rehearsal it writes down who would be emailed and sends nothing. Recommending a leader and forming a tribe come next.'
 where key = 'leader_desk';

-- (the Desk's sent list belongs to Phase 2a: if its way back has already run there is nothing to delete, and the checks below have nothing to narrow)
do $rb$
begin
  if to_regclass('public.desk_proposals') is not null then
    delete from public.desk_proposals where kind = 'found';
  end if;
end;
$rb$;
alter table if exists public.desk_proposals drop constraint if exists desk_proposals_check;
alter table if exists public.desk_proposals add constraint desk_proposals_check
  check ((kind = 'tribe' and tribe_id is not null) or (kind = 'interest' and group_id is not null) or status in ('expired', 'cancelled', 'answered'));
alter table if exists public.desk_proposals drop constraint if exists desk_proposals_kind_check;
alter table if exists public.desk_proposals add constraint desk_proposals_kind_check check (kind in ('tribe', 'interest'));

update public.tribes
   set fixed = array(select x from unnest(fixed) x where x in ('track', 'community', 'goal'))
 where not (fixed <@ array['track', 'community', 'goal']::text[]);
alter table public.tribes drop constraint if exists tribes_fixed_check;
alter table public.tribes add constraint tribes_fixed_check check (fixed <@ array['track', 'community', 'goal']::text[]);

-- The functions Phase 2b-1 replaced, back as they were
create or replace function public.god_appoint_leader(p_person uuid, p_form jsonb, p_goal uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  i jsonb;
  m public.leader_fit_models := public.leader_fit_cfg();
  v_season uuid := public.leader_fit_season();
  o public.leader_fit_option;
  p public.people;
  v_track uuid;
  v_community uuid;
  v_name text;
  v_first text;
  v_tribe uuid;
  v_run uuid;
  v_id uuid := gen_random_uuid();
  v_had boolean;
  v_hidden boolean;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.god_only();
  select * into p from public.people x where x.id = p_person and not x.hidden;
  if not found or exists (select 1 from public.platform_owner w where w.person_id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if m.version is null then
    raise exception 'The pastorate needs to approve a fit model first' using errcode = '22023';
  end if;
  if v_season is null then
    raise exception 'No season is open for Tribe Cards yet' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023';
  end if;
  i := public.god_appointment_inputs(p_form);

  if exists (select 1 from public.leader_appointments a where a.person_id = p_person and a.status = 'active') then
    raise exception 'They are already appointed. Step them down first to appoint them to a different tribe' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribes t where t.leader_id = p_person and t.status <> 'closed') then
    raise exception 'They already lead a tribe' using errcode = '22023';
  end if;

  select * into o from public.leader_fit_options(i) x where x.goal_id = p_goal;
  if o.goal_id is null then
    raise exception 'That tribe is not one of the options for this person' using errcode = '22023';
  end if;
  if o.care_flag then
    raise exception 'That tribe is about a sensitive subject. Say a pastor has cleared this person for it, or choose another tribe' using errcode = '22023';
  end if;

  select t.id into v_track from public.tracks t where t.slug = i ->> 'track';
  select g.community_id into v_community from public.season_goals g where g.id = p_goal;

  -- The engine run that explains the choice, and the choice itself
  v_run := public.leader_fit_record(p_person, null, i, 'appointment');
  perform public.leader_fit_apply_choice(v_run, p_goal, '{}'::uuid[], true);

  -- The leader role, only if they do not hold it already
  select exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader') into v_had;
  select coalesce(x.hidden, false) into v_hidden from public.people x where x.id = me;
  if not v_had then
    insert into public.person_roles (person_id, role, centre_id, granted_by)
    values (p_person, 'leader', p.centre_id, case when v_hidden then null else me end)
    on conflict do nothing;
  end if;

  -- Their Tribe Card, started the way start_tribe_card starts one from an approved application: the track, community and goal are
  -- locked, and the three Success Picture lines come from the signed-off card where they are still empty.
  v_first := coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1));
  select c.name into v_name from public.communities c where c.id = v_community;
  v_name := case when coalesce(v_first, '') <> '' and v_name is not null and char_length(v_first || '’s ' || v_name || ' tribe') <= 48
                 then v_first || '’s ' || v_name || ' tribe' end;
  insert into public.tribes (season_id, leader_id, name, track_id, community_id, season_goal_id, fixed)
  values (v_season, p_person, v_name, v_track, v_community, p_goal, array['track', 'community', 'goal'])
  returning id into v_tribe;
  perform public.card_template_fill(v_tribe);

  insert into public.leader_appointments (id, person_id, appointed_by, season_id, tribe_id, season_goal_id, run_id, form, care_cleared, granted_role, note)
  values (v_id, p_person, me, v_season, v_tribe, p_goal, v_run, p_form, coalesce((p_form ->> 'care_cleared')::boolean, false), not v_had, v_note);

  perform public.write_event(me, 'leader.appointed', 'leader_appointment', v_id::text,
    jsonb_build_object('person', p_person, 'goal', p_goal, 'tribe', v_tribe, 'degree', o.degree));
  return jsonb_build_object('ok', true, 'appointment', v_id, 'tribe', v_tribe, 'run', v_run, 'degree', o.degree, 'label', o.label);
end;
$$;;

CREATE OR REPLACE FUNCTION public.save_tribe_card(p_id uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid();
  c public.tribes;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v text;
  n integer;
  slug_id uuid;
  new_day smallint;
  new_time time;
  new_slot text;
begin
  select * into c from public.tribes where id = p_id and leader_id = me for update;
  if not found then
    raise exception 'Tribe Card not found' using errcode = 'P0002';
  end if;
  if c.status not in ('draft', 'changes_requested') then
    raise exception 'This card has been sent. It can be edited again if the pastorate asks for changes' using errcode = '22023';
  end if;

  if f ? 'name' then
    v := nullif(btrim(coalesce(f ->> 'name', '')), '');
    if v is not null and char_length(v) not between 3 and 48 then
      raise exception 'Give the tribe a name of 3 to 48 characters' using errcode = '22023';
    end if;
    c.name := v;
  end if;

  if f ? 'tribe_type' then
    if f ->> 'tribe_type' not in ('mixed', 'women', 'men') then
      raise exception 'Choose mixed, women only or men only' using errcode = '22023';
    end if;
    c.tribe_type := f ->> 'tribe_type';
  end if;

  if f ? 'story' then
    v := nullif(btrim(coalesce(f ->> 'story', '')), '');
    if v is not null and char_length(v) > 300 then
      raise exception 'Keep your story to 300 characters, about two lines' using errcode = '22023';
    end if;
    c.story := v;
  end if;

  if f ? 'track' and not ('track' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'track', '')), '');
    if v is null then
      c.track_id := null;
    else
      select id into slug_id from public.tracks where slug = v and active;
      if slug_id is null then raise exception 'Choose a life-stage track from the list' using errcode = '22023'; end if;
      c.track_id := slug_id;
    end if;
  end if;

  if f ? 'community' and not ('community' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'community', '')), '');
    if v is null then
      c.community_id := null;
      c.season_goal_id := null;
    else
      select id into slug_id from public.communities where slug = v and active;
      if slug_id is null then raise exception 'Choose a community from the list' using errcode = '22023'; end if;
      if slug_id is distinct from c.community_id then
        c.season_goal_id := null;
      end if;
      c.community_id := slug_id;
    end if;
  end if;

  if f ? 'goal' and not ('goal' = any (c.fixed)) then
    v := nullif(btrim(coalesce(f ->> 'goal', '')), '');
    if v is null then
      c.season_goal_id := null;
    else
      select id into slug_id from public.season_goals where slug = v and active and community_id = c.community_id;
      if slug_id is null then raise exception 'Choose a Season Goal from your community''s list' using errcode = '22023'; end if;
      c.season_goal_id := slug_id;
    end if;
  end if;

  if f ? 'meeting_day' then
    if f -> 'meeting_day' = 'null'::jsonb or btrim(coalesce(f ->> 'meeting_day', '')) = '' then
      c.meeting_day := null;
    else
      begin
        n := (f ->> 'meeting_day')::integer;
      exception when others then
        raise exception 'Choose the day of the week' using errcode = '22023';
      end;
      if n not between 0 and 6 then raise exception 'Choose the day of the week' using errcode = '22023'; end if;
      c.meeting_day := n;
    end if;
  end if;
  if f ? 'meeting_time' then
    v := nullif(btrim(coalesce(f ->> 'meeting_time', '')), '');
    if v is null then
      c.meeting_time := null;
    else
      begin
        c.meeting_time := v::time;
      exception when others then
        raise exception 'Choose a valid time' using errcode = '22023';
      end;
    end if;
  end if;
  new_day := c.meeting_day;
  new_time := c.meeting_time;
  if new_day is not null and new_time is not null then
    new_slot := public.tribe_slot_for(new_day, new_time);
    if new_slot is null then
      raise exception 'Choose a time members can make: weeknights from 7:30pm, Saturday morning, or Sunday afternoon or evening' using errcode = '22023';
    end if;
    c.slot := new_slot;
  else
    c.slot := null;
  end if;

  if f ? 'mode' then
    v := nullif(btrim(coalesce(f ->> 'mode', '')), '');
    if v is not null and v not in ('online', 'in_person') then
      raise exception 'Choose online or in person' using errcode = '22023';
    end if;
    c.meeting_mode := v;
  end if;
  if f ? 'zone' then
    v := nullif(btrim(coalesce(f ->> 'zone', '')), '');
    if v is not null and v not in ('iganmu-surulere', 'mainland', 'island-lekki', 'other-nigeria', 'abroad') then
      raise exception 'Choose a zone from the list' using errcode = '22023';
    end if;
    c.zone := v;
  end if;
  if f ? 'place_note' then
    v := nullif(btrim(coalesce(f ->> 'place_note', '')), '');
    if v is not null and char_length(v) > 120 then
      raise exception 'Keep the area note under 120 characters' using errcode = '22023';
    end if;
    c.place_note := v;
  end if;
  if f ? 'capacity' then
    begin
      n := (f ->> 'capacity')::integer;
    exception when others then
      raise exception 'Seats can be 4 to 12' using errcode = '22023';
    end;
    if n not between 4 and 12 then raise exception 'Seats can be 4 to 12' using errcode = '22023'; end if;
    c.capacity := n;
  end if;

  if f ? 'god' then
    v := nullif(btrim(coalesce(f ->> 'god', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_god := v;
  end if;
  if f ? 'others' then
    v := nullif(btrim(coalesce(f ->> 'others', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_others := v;
  end if;
  if f ? 'life' then
    v := nullif(btrim(coalesce(f ->> 'life', '')), '');
    if v is not null and char_length(v) > 200 then raise exception 'Keep each line under 200 characters' using errcode = '22023'; end if;
    c.loving_life := v;
  end if;

  update public.tribes
     set name = c.name, tribe_type = c.tribe_type, story = c.story,
         track_id = c.track_id, community_id = c.community_id, season_goal_id = c.season_goal_id,
         meeting_day = c.meeting_day, meeting_time = c.meeting_time, slot = c.slot,
         meeting_mode = c.meeting_mode, zone = c.zone, place_note = c.place_note, capacity = c.capacity,
         loving_god = c.loving_god, loving_others = c.loving_others, loving_life = c.loving_life
   where id = p_id;
end;
$function$;;

create or replace function public.desk_mail_send(p_kind text, p_person uuid, p_tribe uuid, p_group uuid, p_degree integer, p_params jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    v_msg := public.enqueue_message(p_person, case p_kind when 'interest' then 'desk_interest' else 'desk_proposal' end,
      p_params || jsonb_build_object('stop', true), p_tribe, 'desk:' || v_id::text, public.desk_send_at(), 'normal', 'email');
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
      update public.desk_proposals set message_id = v_msg where id = v_id;
    end if;
  end if;
  perform public.write_event(p_actor, 'desk.proposal', 'person', p_person::text, jsonb_build_object('kind', p_kind, 'mode', v_state));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

create or replace function public.worker_desk_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  x public.desk_proposals%rowtype;
  v_open boolean;
  v_params jsonb;
  v_block text;
begin
  perform public.worker_ok(p_token);
  v_id := public.desk_link_proposal(p_link);
  if v_id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into x from public.desk_proposals y where y.id = v_id;
  update public.desk_links set clicks = clicks + 1 where token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex');
  v_block := public.desk_mail_block(x.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('found', false);
  end if;
  v_open := x.status = 'sent' and now() < x.expires_at and public.desk_mail_state(x.person_id) = 'on';
  v_params := case when not v_open then null
                   when x.kind = 'tribe' then public.desk_tribe_params(x.person_id, x.tribe_id)
                   else public.desk_interest_params(x.group_id, x.person_id) end;
  if v_open and v_params is null then
    v_open := false;
  end if;
  return jsonb_build_object('found', true, 'kind', x.kind, 'open', v_open, 'first', public.first_name_of(x.person_id),
    'answered', x.status = 'answered', 'answer', x.answer, 'slots', to_jsonb(x.slots), 'stopped', coalesce(v_block = 'stopped', false),
    'expires_at', x.expires_at, 'details', coalesce(v_params, '{}'::jsonb));
end;
$$;

create or replace function public.worker_desk_answer(p_token text, p_link text, p_answer text, p_slots text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  x public.desk_proposals%rowtype;
  v_slots text[] := coalesce(p_slots, '{}');
  v_block text;
begin
  perform public.worker_ok(p_token);
  if p_answer is null or p_answer not in ('yes', 'no', 'other_time', 'stop')
     or not (v_slots <@ array['sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning'])
     or cardinality(v_slots) > 4
     or (p_answer = 'other_time' and cardinality(v_slots) = 0)
     or (p_answer <> 'other_time' and cardinality(v_slots) > 0) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  v_id := public.desk_link_proposal(p_link);
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into x from public.desk_proposals y where y.id = v_id for update;
  v_block := public.desk_mail_block(x.person_id);
  if v_block in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;

  if p_answer = 'stop' then
    insert into public.desk_stops (person_id) values (x.person_id) on conflict do nothing;
    update public.desk_proposals set status = case when status in ('sent', 'would_send') then 'answered' else status end,
           answer = case when status in ('sent', 'would_send') then 'stop' else answer end,
           answered_at = case when status in ('sent', 'would_send') then now() else answered_at end
     where id = x.id;
    -- Anything else the Desk has open for this member ends too
    update public.desk_proposals set status = 'cancelled' where person_id = x.person_id and status in ('sent', 'would_send') and id <> x.id;
    update public.messages set status = 'skipped', error = 'Stopped by the member', reply_token = null
     where person_id = x.person_id and template in ('desk_proposal', 'desk_interest') and status = 'queued';
    perform public.write_event(null, 'desk.stop', 'person', x.person_id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'answer', 'stop');
  end if;

  if x.status = 'answered' then
    return jsonb_build_object('ok', true, 'answer', x.answer, 'again', true);
  end if;
  if x.status <> 'sent' or now() >= x.expires_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if public.desk_mail_state(x.person_id) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if x.kind = 'tribe' and p_answer <> 'no' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;

  update public.desk_proposals set status = 'answered', answer = p_answer, slots = v_slots, answered_at = now() where id = x.id;
  if x.kind = 'interest' and p_answer in ('no', 'other_time') then
    delete from public.desk_group_members where group_id = x.group_id and person_id = x.person_id;
  end if;
  perform public.write_event(null, 'desk.answer', 'person', x.person_id::text, jsonb_build_object('kind', x.kind, 'answer', p_answer));
  return jsonb_build_object('ok', true, 'answer', p_answer);
end;
$$;

create or replace function public.desk_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_links integer;
  v_cleared integer;
begin
  update public.desk_proposals set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_expired = row_count;
  delete from public.desk_links where expires_at < now();
  get diagnostics v_links = row_count;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('desk_proposal', 'desk_interest')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('expired', v_expired, 'links', v_links, 'cleared', v_cleared);
end;
$$;;

-- What 2b-1 added
drop function if exists public.leader_appoint_core(uuid, jsonb, uuid, text, uuid, uuid);
drop function if exists public.desk_offer_words(text);
drop function if exists public.desk_offer_gate_core(uuid, uuid, uuid);
drop function if exists public.desk_offer_member_ok(uuid, uuid);
drop function if exists public.desk_offer_gate(uuid, uuid, uuid);
drop function if exists public.desk_offer_problem(uuid);
drop function if exists public.desk_offer_params(uuid, uuid, timestamptz, text);
drop function if exists public.desk_offer_link_mint(uuid, uuid, timestamptz);
drop function if exists public.desk_offer_link_offer(text);
drop function if exists public.desk_offer_open(uuid);
drop function if exists public.desk_offer_close(uuid, text);
drop function if exists public.desk_offer_advance(uuid);
drop function if exists public.desk_found_params(uuid, uuid, uuid);
drop function if exists public.desk_offer_complete(uuid, uuid);
drop function if exists public.desk_offer_accept(uuid);
drop function if exists public.desk_offer_candidates(uuid, integer);
drop function if exists public.desk_offer_send(uuid, uuid[]);
drop function if exists public.desk_offer_cancel(uuid, boolean);
drop function if exists public.desk_offers_pause(uuid, boolean);
drop function if exists public.desk_offer_review(uuid, boolean);
drop function if exists public.desk_group_leader(uuid);
drop function if exists public.desk_offers_list(integer, integer);
drop function if exists public.desk_offer_tick();
drop function if exists public.worker_desk_offer_info(text, text);
drop function if exists public.worker_desk_offer_answer(text, text, text, boolean, text, text, text[]);

drop table if exists public.desk_offer_links;
drop table if exists public.desk_offers;
drop table if exists public.desk_lead_stops;

drop index if exists public.desk_groups_one_tribe;
alter table if exists public.desk_groups drop column if exists backups_paused, drop column if exists leader_found_at, drop column if exists tribe_id, drop column if exists leader_id;
alter table if exists public.desk_settings drop column if exists card_days, drop column if exists said_yes_days, drop column if exists backups, drop column if exists offer_hours;

commit;

-- ===== 20270117000100_desk_proposals.down.sql =====
-- Way back from "the Leader Desk, Phase 2a" (email a proposed group, check interest, and the member's one-tap answer).
--
-- Drops what this change added: the Desk's email functions, its four tables (the settings, what was sent or would have been, the private links, and the
-- members who pressed "Stop these") and puts the Switchboard text for the Leader Desk back as Phase 1 had it. It replaced no function, so nothing else is put
-- back. No member, seat, tribe, message, notice, consent or number is changed. Emails the Desk had already queued stay in the queue: the page they link to is
-- gone, so the link in them says it cannot be opened. Switch the Leader Desk to Off first if you want nothing more to go. Put the application files back
-- before this one: the God Mode page and the private page call these functions. Run it as the database owner.
-- Running it twice changes nothing.
begin;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal from willingness, walk of faith, attendance, being named and weekly steps. Sends nothing yet: emailing a proposed group, recommending a leader and forming a tribe come next.'
 where key = 'leader_desk';

drop function if exists public.desk_mail_state(uuid);
drop function if exists public.desk_mail_block(uuid);
drop function if exists public.desk_mail_cap(uuid, boolean);
drop function if exists public.desk_mail_words(text);
drop function if exists public.desk_send_at();
drop function if exists public.desk_tribe_pick(uuid);
drop function if exists public.desk_tribe_params(uuid, uuid);
drop function if exists public.desk_interest_params(uuid, uuid);
drop function if exists public.desk_link_mint(uuid, uuid, integer);
drop function if exists public.desk_link_proposal(text);
drop function if exists public.desk_mail_send(text, uuid, uuid, uuid, integer, jsonb, uuid);
drop function if exists public.desk_tick();
drop function if exists public.desk_send_state();
drop function if exists public.desk_settings_set(integer, integer, integer, integer, text);
drop function if exists public.desk_propose_preview(uuid);
drop function if exists public.desk_propose_tribe(uuid, uuid);
drop function if exists public.desk_interest_check(uuid);
drop function if exists public.desk_group_interest(uuid);
drop function if exists public.desk_proposals_list(text, integer, integer);
drop function if exists public.desk_proposal_cancel(uuid);
drop function if exists public.worker_desk_info(text, text);
drop function if exists public.worker_desk_answer(text, text, text, text[]);
drop function if exists public.worker_desk_tick(text);

drop table if exists public.desk_links;
drop table if exists public.desk_stops;
drop table if exists public.desk_proposals;
drop table if exists public.desk_settings;

commit;

-- ===== 20270116000100_leader_desk.down.sql =====
-- Way back from "the Leader Desk, in God Mode" (Phase 1: see).
--
-- Drops what this change added: the page's functions, its three tables (the draft groups, who was put in them, and the log of opened numbers) and the
-- Leader Desk's place on the Switchboard. It replaced no existing function, so nothing is put back. No seat, member, tribe, message, notice, consent or
-- number is changed, because the Desk never wrote to any of them. Draft groups and the log of opened numbers are removed with their tables: nothing
-- else reads them. Put the application files back before this one: the God Mode page calls these functions. Run it as the database owner.
-- Running it twice changes nothing.
begin;

delete from public.feature_settings where feature = 'leader_desk';
delete from public.feature_registry where key = 'leader_desk';

drop function if exists public.desk_overview();
drop function if exists public.desk_waiting(text, integer, integer);
drop function if exists public.desk_leaders(text, integer, integer);
drop function if exists public.desk_lead_signal(uuid);
drop function if exists public.desk_phone_reveal(uuid);
drop function if exists public.desk_groups_list();
drop function if exists public.desk_group_save(uuid, text, uuid, uuid, uuid, text, text, text, text, integer, text);
drop function if exists public.desk_group_archive(uuid);
drop function if exists public.desk_group_member_add(uuid, uuid);
drop function if exists public.desk_group_member_remove(uuid, uuid);
drop function if exists public.desk_group_suggest(uuid, integer);
drop function if exists public.desk_clusters();
drop function if exists public.desk_group_view(uuid);
drop function if exists public.desk_group_fit(uuid, uuid);
drop function if exists public.desk_block_reason(uuid);
drop function if exists public.desk_lead_notes(text, text, integer, integer, integer, integer, integer);
drop function if exists public.desk_lead_base(uuid);
drop function if exists public.desk_waiting_base(uuid);
drop function if exists public.desk_kind(text, text);
drop function if exists public.desk_base(uuid);
drop function if exists public.desk_need();
drop function if exists public.leader_desk_any();

drop table if exists public.desk_group_members;
drop table if exists public.desk_groups;
drop table if exists public.desk_reveals;

commit;

-- ===== 20270115000100_owner_requests.down.sql =====
-- Way back from "requests to the owner, seen and answered".
--
-- Puts notice_sweep back exactly as it stood (without the daily check for lapsed requests) and drops the check. A request already marked lapsed stays lapsed, which is
-- what the page showed for it anyway; a notice already sent stays sent. Put the application files back before this one. Run it as the database owner.
-- Running it twice changes nothing.
begin;

create or replace function public.notice_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  p record;
  n integer;
  v_queued integer := 0;
  v_digests integer := 0;
  v_problems text[] := '{}';
  v_hour integer := public.notice_hour(p_now);
  v_dow integer := public.notice_isodow(p_now);
  v_day boolean := public.notice_hour(p_now) between 7 and 20;
begin
  for c in
    select * from (values
      ('notice_chk_meetings', 'open'), ('notice_chk_interview_outcome', 'open'), ('notice_chk_sending', 'open'),
      ('notice_chk_decisions', 'daily'), ('notice_chk_cards', 'daily'), ('notice_chk_season_review', 'daily'),
      ('notice_chk_slots_low', 'daily'), ('notice_chk_offers', 'daily'), ('notice_chk_countdown', 'daily'),
      ('notice_chk_erasure_due', 'daily'), ('notice_chk_reporting', 'daily'), ('notice_chk_care', 'daily'),
      ('notice_chk_applicants', 'daily'), ('notice_chk_referees', 'daily'), ('notice_chk_academy', 'daily'),
      ('notice_chk_templates', 'monday'), ('notice_chk_demand', 'monday'), ('notice_chk_unplaced', 'monday'),
      ('notice_chk_email_week', 'monday'), ('notice_chk_integrity', 'monday'),
      ('notice_chk_champions', 'daily'),
      ('notice_chk_interviews_tomorrow', 'evening'), ('notice_chk_leaders', 'evening')
    ) as t(name, gate)
  loop
    if not (case c.gate
              when 'open' then v_hour between 7 and 21
              when 'daily' then v_day
              when 'monday' then v_day and v_dow = 1
              when 'evening' then v_hour between 17 and 21
              else false end) then
      continue;
    end if;
    begin
      execute format('select public.%I($1)', c.name) into n using p_now;
      v_queued := v_queued + coalesce(n, 0);
    exception when others then
      v_problems := v_problems || ('notices: ' || c.name || ' could not run');
      perform public.notice_fault(c.name, sqlerrm);
    end;
  end loop;

  if v_day then
    for p in select distinct i.person_id from public.notice_items i where i.sent_at is null and i.delivery = 'digest' loop
      begin
        if public.notice_digest(p.person_id, p_now) is not null then
          v_digests := v_digests + 1;
        end if;
      exception when others then
        v_problems := v_problems || 'notices: a digest could not be built';
        perform public.notice_fault('digest', sqlerrm);
      end;
    end loop;
  end if;

  begin
    perform public.notice_chk_scrub(p_now);
  exception when others then
    v_problems := v_problems || 'notices: clean-up could not run';
    perform public.notice_fault('scrub', sqlerrm);
  end;
  return jsonb_build_object('queued', v_queued, 'digests', v_digests, 'problems', to_jsonb(v_problems));
end;
$$;

drop function if exists public.notice_chk_placement_requests(timestamptz);

commit;

-- ===== 20270114000100_placed_answers.down.sql =====
-- Way back from "the placed-member answer sequence, the board and the call desk" (Package 6b of "seats and contacts").
--
-- Withdraws the sequence emails still waiting in the outbox, puts the two functions this change replaced back exactly as they stood (the weekly limit on emails to
-- a person, and trying a failed message again), drops what it added (47 functions, the trigger on a seat's confirmation, eight tables: the settings, the sequences,
-- what each sequence sent, the answers members gave, the calls, the holds, the reveals of a number and the downloads, and the leader's one line to new members on a
-- tribe) and takes the switch off the Switchboard.
-- What it keeps: every seat, member, tribe, message already sent and log line. A member who pressed "Not this season" stays held out of automatic placement for the
-- season: their hold is kept, and is marked as the office's own hold (the only other kinds are a removal and a care follow-up), because the earlier rule has no
-- word for "not this season". A leader's one line to new members is removed with its column. A member's answer ("Not this season", "Call me", "Remind me tonight")
-- is not kept: the table that held it goes with the page that asked for it.
-- Put the application files back before this one: the private page, the Placed members board and the cron route call these functions. Run it as the database
-- owner. Running it twice changes nothing.
begin;

-- The bodies of the functions put back read helpers that a still older way back may already have dropped (this file can be run again after those), so they
-- are not checked while they are put back; they are checked, as always, when they run
set local check_function_bodies = off;

-- The sequence cannot send without the pieces below, so none is left half-way
update public.messages set status = 'skipped', error = 'the placed answer sequence was taken away', reply_token = null
 where template = 'placed_seq' and status in ('queued', 'sending');

drop trigger if exists placed_seq_on_answer on public.tribe_members;

create or replace function public.person_cap_ok(p_person uuid, p_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
begin
  if (select count(*) from public.messages m
       where m.person_id = p_person and m.template in ('reminder_email', 'office_message') and not (m.params ? 'test')
         and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_nonessential_week then
    return false;
  end if;
  if p_kind = 'reminder' then
    if (select count(*) from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - interval '7 days') >= s.cap_reminders_week then
      return false;
    end if;
    if s.cap_gap_days > 0 and exists (select 1 from public.messages m
         where m.person_id = p_person and m.template = 'reminder_email'
           and m.status not in ('failed', 'skipped') and m.created_at >= now() - make_interval(days => s.cap_gap_days) + interval '1 hour') then
      return false;
    end if;
  end if;
  return true;
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
  v_template text;
  v_key text;
  v_person uuid;
  v_tm uuid;
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
  -- The private link in a placement email is wiped once the email is finished with. A retry makes a new one, so the email goes out with its three buttons
  -- and not with the signed-in fallback.
  select m.template, m.dedupe_key, m.person_id into v_template, v_key, v_person from public.messages m where m.id = p_id;
  if v_template in ('placement_your_tribe', 'placement_reminder') and v_key ~ '^placement(-reminder)?:[0-9a-f-]{36}$' then
    v_tm := substring(v_key from '[0-9a-f-]{36}$')::uuid;
    if public.placed_is_waiting(v_tm) then
      update public.messages set reply_token = public.placement_token_mint(v_tm, v_person, 60) where id = p_id;
    end if;
  end if;
  perform public.write_event(uid, 'message.retried', 'message', p_id::text, '{}'::jsonb);
end;
$$;

drop function if exists public.worker_placed_seq_tick(text);
drop function if exists public.worker_placed_answers_info(text, text);
drop function if exists public.worker_placed_answer(text, text, text, text, text, text, text);
drop function if exists public.tribe_seat_line_set(uuid, text);
drop function if exists public.tribe_seat_line_get(uuid);
drop function if exists public.placed_seq_tick();
drop function if exists public.placed_seq_sweep(integer);
drop function if exists public.placed_seq_step(uuid);
drop function if exists public.placed_seq_send(uuid, text);
drop function if exists public.placed_seq_selfcheck();
drop function if exists public.placed_seq_params(uuid, text);
drop function if exists public.placed_seq_on_answer();
drop function if exists public.placed_seq_enrol(uuid, boolean);
drop function if exists public.placed_seq_end_for(uuid, text);
drop function if exists public.placed_seq_end(uuid, text);
drop function if exists public.placed_seq_block(uuid, uuid);
drop function if exists public.placed_remind_time();
drop function if exists public.placed_page_opened(uuid);
drop function if exists public.placed_last_email_at(uuid);
drop function if exists public.placed_in_window(text);
drop function if exists public.placed_hold_set(uuid, integer, text);
drop function if exists public.placed_hold_clear(uuid);
drop function if exists public.placed_do_not_season(uuid);
drop function if exists public.placed_desk_state(uuid);
drop function if exists public.placed_desk_row(uuid, uuid, text, text, text, text, timestamp with time zone, integer, text, boolean, numeric);
drop function if exists public.placed_desk_reveal(uuid, boolean);
drop function if exists public.placed_desk_record(uuid, text, date);
drop function if exists public.placed_desk_mask(text);
drop function if exists public.placed_desk_list();
drop function if exists public.placed_desk_download();
drop function if exists public.placed_deadline_on(uuid);
drop function if exists public.placed_deadline_at(uuid);
drop function if exists public.placed_calls_ok();
drop function if exists public.placed_call_tries(uuid);
drop function if exists public.placed_call_pending(uuid);
drop function if exists public.placed_board_tribes();
drop function if exists public.placed_board_summary();
drop function if exists public.placed_board_rows(text, uuid, text, text, text, text, text, integer, integer);
drop function if exists public.placed_board_role();
drop function if exists public.placed_board_need(boolean);
drop function if exists public.placed_board_base(uuid);
drop function if exists public.placed_answers_pause_set(boolean, text);
drop function if exists public.placed_answers_overview();
drop function if exists public.placed_answers_cfg();
drop function if exists public.placed_answers_any();
drop function if exists public.god_placed_answers_settings_set(integer, integer, integer, integer, integer, integer, boolean, text);
drop function if exists public.god_placed_answers_settings();

delete from public.feature_settings where feature = 'placed_answers';
delete from public.feature_registry where key = 'placed_answers';

-- "Not this season" holds keep holding, as the office's own hold, so the earlier rule on where a hold comes from can be put back
update public.placement_holds set source = 'owner' where source = 'not_season';
alter table public.placement_holds drop constraint if exists placement_holds_source_check;
alter table public.placement_holds add constraint placement_holds_source_check check (source in ('owner', 'removal', 'care'));

alter table public.tribes drop column if exists seat_line;

drop table if exists public.placed_downloads;
drop table if exists public.placed_reveals;
drop table if exists public.placed_holds;
drop table if exists public.placed_calls;
drop table if exists public.placed_answers;
drop table if exists public.placed_seq_sends;
drop table if exists public.placed_seq;
drop table if exists public.placed_answers_settings;

commit;


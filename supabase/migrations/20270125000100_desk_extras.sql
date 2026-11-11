-- =============================================================================
-- United Tribes: the Leader Desk, the three things Phase 2 left out
--
-- What this adds:
--
--   "Yes, as assistant"   The page behind "Would you lead this group?" gets one more honest answer. A member who would rather help than lead can say so. It is
--                         recorded as a no to leading (the next backup is asked, exactly as for "Not this season", and the member is not shut out of future
--                         offers), and the group remembers who offered. When someone else says yes to leading, the offer is passed on through the way the church
--                         already has: a recommendation on the new tribe's Assistants list, which the church office approves or declines as it does any other. The
--                         Desk never pairs anyone, and a member who is not yet an approved assistant leader is invited to apply, as before. The new leader is told, and
--                         can withdraw it from their tribe page. Nobody is asked twice, and only one member can offer to assist a group.
--
--   Recommend as leader   An owner-only list of the draft groups one waiting member could be offered to lead right now, so the button can sit on the member's
--                         row as well as on the group's card. It uses the same checks as the card (desk_offer_problem and desk_offer_gate), and sending is still
--                         the one function (desk_offer_send), so the daily limit, the backups and the Rehearsal behave exactly as they do from the card.
--
--   WhatsApp for the Desk One switch, Off to begin with, set by the owner with a reason. While it is Off nothing changes: every Desk message is forced to email, as
--                         now. When it is On the Desk stops forcing email and the ordinary rules choose the channel for each person: what they agreed to, WhatsApp
--                         mode (Full, Saver, Free), the Master pause, the weekly limit, and email as the fallback when WhatsApp cannot be used or Meta turns the
--                         message down. The Desk's own limits (a day, a gap, a season), its blocks (under 18, stopped, care, bounced) and Rehearsal are untouched,
--                         and a Rehearsal still sends nothing. Turning it Off puts any Desk message still waiting back to email.
--
-- Safety rules, kept here and not on the screen:
--   * everything here is the owner's alone and closed until the Switchboard opens the Desk; the helpers are closed to every signed-in person
--   * "Yes, as assistant" appoints nobody and promises nothing: the church office decides, a pastor decides every assistant application
--   * no phone number, note or reason is written to a message, a row or a log line
--
-- This replaces seven functions (the rollback puts each back exactly as it was), adds five, one column set on each of two tables and widens one check. It adds no
-- table and no trigger. Run it as the database owner, after the Leader Desk Phase 2b-2 (20270119000100) and the placement and assistant migrations are applied.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.desk_offer_complete(uuid, uuid)') is null or to_regprocedure('public.desk_open_tribe(uuid)') is null then
    raise exception 'The Leader Desk, Phase 2b-2 (20270119000100_desk_open) must be applied first';
  end if;
  if to_regprocedure('public.assistant_tribe_young(uuid)') is null or to_regclass('public.assistant_recommendations') is null then
    raise exception 'The assistant leader recommendations (20261226000200) must be applied first';
  end if;
  if to_regclass('public.whatsapp_message_class') is null or to_regprocedure('public.whatsapp_mode_now()') is null then
    raise exception 'WhatsApp mode (20270105000100) must be applied first';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Columns and checks
-- ---------------------------------------------------------------------------
alter table public.desk_groups
  add column assistant_id uuid references public.people (id) on delete set null,
  add column assistant_yes_at timestamptz,
  add column assistant_offer_id uuid references public.desk_offers (id) on delete set null;

alter table public.desk_settings
  add column whatsapp_on boolean not null default false,
  add column whatsapp_reason text check (char_length(whatsapp_reason) <= 300),
  add column whatsapp_changed_by uuid references public.people (id) on delete set null,
  add column whatsapp_changed_at timestamptz;

alter table public.desk_offers drop constraint desk_offers_answer_check;
alter table public.desk_offers add constraint desk_offers_answer_check check (answer in ('lead', 'not_season', 'never', 'stop', 'owner', 'assist'));

-- How the Desk's messages are classed for WhatsApp mode: the question to a person asked to lead has a clock on it, so it stays on WhatsApp in Saver; the others are
-- email-enough. The director can change any class on the WhatsApp mode page.
insert into public.whatsapp_message_class (template, class) values
  ('desk_offer', 'A'),
  ('desk_proposal', 'C'),
  ('desk_interest', 'C'),
  ('desk_found', 'C')
on conflict (template) do nothing;

-- ---------------------------------------------------------------------------
-- WhatsApp for the Desk
-- ---------------------------------------------------------------------------
-- Is the Desk allowed to use WhatsApp? (helper, closed to every signed-in person)
create function public.desk_whatsapp_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.whatsapp_on from public.desk_settings s where s.id), false);
$$;

-- What the switch says now, and how many of the members waiting for a tribe could be reached on WhatsApp if it were On (a number on file and their agreement).
create function public.desk_whatsapp_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.desk_settings%rowtype;
  v_season uuid := public.placement_season();
  v_waiting integer := 0;
  v_reach integer := 0;
begin
  perform public.desk_need();
  select * into s from public.desk_settings x where x.id;
  if v_season is not null then
    select count(*)::integer,
           count(*) filter (where exists (select 1 from public.contact_preferences cp where cp.person_id = w.person_id and cp.phone is not null)
                              and public.consent_granted(w.person_id, 'whatsapp'))::integer
      into v_waiting, v_reach
      from public.desk_waiting_base(v_season) w;
  end if;
  return jsonb_build_object(
    'on', s.whatsapp_on,
    'reason', s.whatsapp_reason,
    'changed_at', s.whatsapp_changed_at,
    'mode', public.whatsapp_mode_now(),
    'paused', public.whatsapp_paused(),
    'waiting', v_waiting,
    'reach', v_reach);
end;
$$;

-- The switch. Every change needs a reason. Turning it Off sends anything the Desk still has waiting to be sent back to email.
create function public.desk_whatsapp_set(p_on boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.desk_need();
  if p_on is null then
    raise exception 'Say whether WhatsApp is on or off for the Desk' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 3 to 300 characters' using errcode = '22023';
  end if;
  update public.desk_settings
     set whatsapp_on = p_on, whatsapp_reason = v_reason, whatsapp_changed_by = auth.uid(), whatsapp_changed_at = now()
   where id;
  if not p_on then
    update public.messages set force_channel = 'email'
     where status = 'queued' and force_channel is null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer');
  end if;
  perform public.write_event(auth.uid(), 'desk.whatsapp', 'desk', 'settings', jsonb_build_object('on', p_on));
  return public.desk_whatsapp_state();
end;
$$;

-- The three places the Desk queues a message now ask the switch which channel to force: email while it is Off, nothing (the ordinary rules) when it is On.
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
    v_msg := public.enqueue_message(p_person, case p_kind when 'interest' then 'desk_interest' when 'found' then 'desk_found' else 'desk_proposal' end,
      p_params || jsonb_build_object('stop', true), p_tribe, 'desk:' || v_id::text, public.desk_send_at(), 'normal',
      case when s.whatsapp_on then null else 'email' end);
    if v_msg is not null then
      update public.messages set reply_token = v_link where id = v_msg;
      update public.desk_proposals set message_id = v_msg where id = v_id;
    end if;
  end if;
  perform public.write_event(p_actor, 'desk.proposal', 'person', p_person::text, jsonb_build_object('kind', p_kind, 'mode', v_state));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

create or replace function public.desk_offer_open(p_offer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
                                  null, 'desk-offer:' || p_offer::text, v_at, 'normal', case when s.whatsapp_on then null else 'email' end);
  if v_msg is not null then
    update public.messages set reply_token = v_link where id = v_msg;
    update public.desk_offers set message_id = v_msg where id = p_offer;
  end if;
end;
$$;

create or replace function public.desk_offer_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_force text := case when public.desk_whatsapp_on() then null else 'email' end;
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
                                    null, 'desk-offer:' || r.id::text || ':r' || v_kind, v_at, 'normal', v_force);
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
$$;

-- ---------------------------------------------------------------------------
-- "Recommend as leader" on a waiting member's row
-- ---------------------------------------------------------------------------
-- The draft groups this member could be offered to lead right now, by the very rules "Recommend a leader" uses on the group's card. When there are none, the plain
-- reason why, so the button can say so. Sends nothing and writes nothing.
create function public.desk_person_lead_options(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g record;
  v_rows jsonb := '[]'::jsonb;
  v_why text;
  v_code text;
  v_drafts integer := 0;
begin
  perform public.desk_need();
  if not exists (select 1 from public.people p where p.id = p_person) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  for g in select x.id, x.name, c.name as community, sg.title as goal
             from public.desk_groups x
             left join public.communities c on c.id = x.community_id
             left join public.season_goals sg on sg.id = x.season_goal_id
            where x.status = 'draft' and x.leader_id is null
            order by x.created_at desc, x.id limit 24 loop
    v_drafts := v_drafts + 1;
    if public.desk_offer_problem(g.id) is not null then
      v_why := coalesce(v_why, public.desk_offer_problem(g.id));
      continue;
    end if;
    v_code := public.desk_offer_gate(p_person, g.id);
    if v_code is not null then
      v_why := coalesce(v_why, public.desk_offer_words(v_code));
      continue;
    end if;
    if jsonb_array_length(v_rows) < 12 then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('group_id', g.id, 'name', g.name, 'community', g.community, 'goal', g.goal));
    end if;
  end loop;
  return jsonb_build_object(
    'rows', v_rows,
    'why', case when jsonb_array_length(v_rows) > 0 then null
                when v_drafts = 0 then 'There is no draft group waiting for a leader. Start one on the Groups tab.'
                else v_why end);
end;
$$;

-- ---------------------------------------------------------------------------
-- "Yes, as assistant"
-- ---------------------------------------------------------------------------
-- When a group gets its leader and a member had offered to assist it: put them forward on the new tribe's Assistants list, as a recommendation in the new leader's
-- name that the church office decides, and tell the leader (who can withdraw it) and the office. Pairs nobody. Returns the recommendation, or null when there is
-- nothing to put forward (a person who is under 18 or hidden, or the leader themselves). Helper, closed to every signed-in person.
create function public.desk_assistant_put_forward(p_tribe uuid, p_nominee uuid, p_leader uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.tribes%rowtype;
  v_email text;
  v_id uuid := gen_random_uuid();
  v_young boolean;
  v_centre uuid;
begin
  select * into c from public.tribes x where x.id = p_tribe;
  select p.email into v_email from public.people p where p.id = p_nominee and not p.hidden;
  if c.id is null or c.status = 'closed' or v_email is null or p_nominee = p_leader or public.is_minor(p_nominee)
     or exists (select 1 from public.platform_owner w where w.person_id = p_nominee)
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    return null;
  end if;
  begin
    insert into public.assistant_recommendations (id, tribe_id, recommended_by, nominee_id, nominee_email, reason)
    values (v_id, p_tribe, p_leader, p_nominee, lower(v_email), 'Said yes to assisting this group when the Leader Desk asked');
  exception when unique_violation then
    return null;
  end;
  v_young := public.assistant_tribe_young(p_tribe);
  select p.centre_id into v_centre from public.people p where p.id = p_leader;
  perform public.notify_role(v_centre, case when v_young then array['pastor', 'director'] else array['admin', 'director', 'pastor'] end,
    'office_assistant_recommended', 'assistantrec:' || v_id,
    jsonb_build_object('tribe', c.name, 'young', v_young, 'from_desk', true),
    'Assistant leader put forward for ' || coalesce(c.name, 'a tribe'), '/admin/assistants');
  perform public.enqueue_message(p_leader, 'desk_assistant_offer', jsonb_build_object('tribe', c.name, 'assistant_first', public.first_name_of(p_nominee)),
                                 p_tribe, 'desk-assistant:' || v_id, public.desk_send_at(), 'normal', 'email');
  perform public.write_event(p_leader, 'assistant.recommended', 'tribe', p_tribe::text, jsonb_build_object('recommendation', v_id, 'source', 'desk'));
  return v_id;
end;
$$;

-- The private page: it now says whether the "assist" button is still free (only one member can offer to assist a group).
create or replace function public.worker_desk_offer_info(p_token text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    'assist_open', v_open and not exists (select 1 from public.desk_groups g where g.id = o.group_id and g.assistant_id is not null),
    'details', case when v_open then public.desk_offer_params(o.group_id, o.person_id, o.window_ends_at, null) else '{}'::jsonb end);
end;
$$;

create or replace function public.worker_desk_offer_answer(p_token text, p_link text, p_answer text, p_age boolean default false, p_lead text default null,
                                                           p_relation text default null, p_reasons text[] default '{}'::text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  o public.desk_offers%rowtype;
  g public.desk_groups%rowtype;
  v_reasons text[] := coalesce(p_reasons, '{}');
  v_block text;
  v_code text;
  r record;
begin
  perform public.worker_ok(p_token);
  if p_answer is null or p_answer not in ('lead', 'assist', 'not_season', 'call', 'tomorrow', 'never', 'stop')
     or not (v_reasons <@ array['busy', 'family', 'not_ready', 'other_goal', 'other']) or cardinality(v_reasons) > 5
     or (p_answer <> 'not_season' and cardinality(v_reasons) > 0)
     or (p_answer = 'lead' and (coalesce(p_age, false) is not true or p_lead is null or p_lead not in ('structure', 'connection', 'teaching', 'doing')
                               or p_relation is null or p_relation not in ('achieved', 'pursuing')))
     or (p_answer = 'assist' and (coalesce(p_age, false) is not true or p_lead is not null or p_relation is not null))
     or (p_answer not in ('lead', 'assist') and (p_lead is not null or p_relation is not null or coalesce(p_age, false))) then
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
  if o.status = 'declined' and o.answer is not null and (p_answer in ('not_season', 'never') or (p_answer = 'assist' and o.answer = 'assist')) then
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

  if p_answer = 'assist' then
    -- Yes, as assistant: a no to leading that the group remembers. The checks are made again at this moment, and the first member to offer is the one recorded.
    v_code := public.desk_offer_gate(o.person_id, o.group_id, o.id);
    if v_code is not null then
      return jsonb_build_object('ok', false, 'reason', 'not_available', 'code', v_code);
    end if;
    select * into g from public.desk_groups x where x.id = o.group_id for update;
    if g.assistant_id is not null and g.assistant_id is distinct from o.person_id then
      return jsonb_build_object('ok', false, 'reason', 'taken');
    end if;
    update public.desk_offers set status = 'declined', answer = 'assist', age_confirmed_at = now(), answered_at = now() where id = o.id;
    update public.desk_groups set assistant_id = o.person_id, assistant_yes_at = now(), assistant_offer_id = o.id where id = g.id;
    perform public.write_event(null, 'desk.offer_answer', 'desk_group', o.group_id::text, jsonb_build_object('answer', 'assist'));
    perform public.desk_offer_advance(o.group_id);
    return jsonb_build_object('ok', true, 'answer', 'assist');
  end if;

  -- Yes, I will lead: the gates are checked again at this moment
  v_code := public.desk_offer_gate(o.person_id, o.group_id, o.id);
  if v_code is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_available', 'code', v_code);
  end if;
  update public.desk_offers set lead_best = p_lead, relation = p_relation, age_confirmed_at = now() where id = o.id;
  return public.desk_offer_accept(o.id);
end;
$$;

create or replace function public.desk_offer_complete(p_offer uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_assist uuid;
  v_put uuid;
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

  -- A member who offered to assist this group: put forward to the church office for the new tribe, and no longer on the draft's list of people waiting for a place.
  -- (If the member who offered to assist is the one who now leads, there is nothing to put forward.)
  v_assist := g.assistant_id;
  if v_assist is not null then
    if v_assist = o.person_id then
      update public.desk_groups set assistant_id = null, assistant_yes_at = null, assistant_offer_id = null where id = g.id;
    else
      v_put := public.desk_assistant_put_forward(v_tribe, v_assist, o.person_id);
      if v_put is not null then
        delete from public.desk_group_members where group_id = g.id and person_id = v_assist;
      end if;
    end if;
  end if;

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
$$;

create or replace function public.desk_group_leader(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'assistant', case when g.assistant_id is null then null else jsonb_build_object(
        'person_id', g.assistant_id, 'name', public.person_display_name(g.assistant_id), 'since', g.assistant_yes_at,
        'status', (select r.status from public.assistant_recommendations r where r.tribe_id = g.tribe_id and r.nominee_id = g.assistant_id order by r.created_at desc limit 1)) end,
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
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.desk_whatsapp_on(), public.desk_assistant_put_forward(uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.desk_whatsapp_state(), public.desk_whatsapp_set(boolean, text), public.desk_person_lead_options(uuid) from public, anon;
grant execute on function public.desk_whatsapp_state(), public.desk_whatsapp_set(boolean, text), public.desk_person_lead_options(uuid) to authenticated;

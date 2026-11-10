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

update public.feature_registry
   set blurb = 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal. Can email a waiting member one open tribe that fits them, or ask the members of a draft group whether they are interested; each is answered on a private page. In Rehearsal it writes down who would be emailed and sends nothing. Recommending a leader and forming a tribe come next.'
 where key = 'leader_desk';

delete from public.desk_proposals where kind = 'found';
alter table public.desk_proposals drop constraint if exists desk_proposals_check;
alter table public.desk_proposals add constraint desk_proposals_check
  check ((kind = 'tribe' and tribe_id is not null) or (kind = 'interest' and group_id is not null) or status in ('expired', 'cancelled', 'answered'));
alter table public.desk_proposals drop constraint if exists desk_proposals_kind_check;
alter table public.desk_proposals add constraint desk_proposals_kind_check check (kind in ('tribe', 'interest'));

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
alter table public.desk_groups drop column if exists backups_paused, drop column if exists leader_found_at, drop column if exists tribe_id, drop column if exists leader_id;
alter table public.desk_settings drop column if exists card_days, drop column if exists said_yes_days, drop column if exists backups, drop column if exists offer_hours;

commit;

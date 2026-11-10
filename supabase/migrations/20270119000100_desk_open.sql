-- =============================================================================
-- United Tribes: the Leader Desk, Phase 2b-2 (Open tribe, the pastors' 24-hour reminder, the leader pipeline and its limits)
--
-- What this adds:
--
--   Open tribe        On a draft group whose leader has been appointed, whose tribe card a pastor has approved and whose leader the Academy has certified: the
--                     draft's members are placed in the tribe one at a time, by the same function the office uses to place one person (placement_one_place),
--                     once for each member. The Desk makes no seat of its own. The members who said yes to "Your group has a leader" come first, then the rest in
--                     the order they were added. Anyone who cannot be placed (a warning the office would have to accept, a blocker, no seat left) is left alone and
--                     named with the reason, so the owner can place them by hand. A member who is placed gets the ordinary "Your tribe" email and the leader the
--                     ordinary team list, because that is what the placement does. When everyone is placed the draft is archived. In Rehearsal it only shows who
--                     would be placed.
--   Pastors' reminder A tribe the Desk formed whose card is still waiting for review 24 hours after the leader sent it in: one reminder to the pastors and directors,
--                     through the notice system (so their delivery choices and the notice switches apply). The email pastors already get when any card is sent
--                     in is not repeated or changed. Tribes that did not come through the Desk get no extra email.
--   Pipeline          One row for each draft group that is on its way to having an open tribe: asked, said yes (waiting for the owner, below the fit model's
--                     minimum), card being filled in, card waiting for the pastors, card approved (waiting for the Academy), ready to open, or opened with people
--                     still to place. Each shows how long it has been in that stage and a "stuck" flag when it has passed its limit.
--   Limits            The offer window, the backups per group and the two pipeline limits (said yes: 2 days; card decision: 3 days) are settings, changed with a
--                     reason like the others, never code.
--   Led groups        "Check interest" now refuses a group that already has a leader, so nobody is told "we are still finding its leader" after it has one.
--
-- Safety rules, kept here and not on the screen:
--   * everything here is the owner's alone and closed until the Switchboard opens the Desk; the helpers are closed to every signed-in person
--   * the Desk never approves a card, never certifies a leader and never accepts a warning on anyone's behalf
--   * People are placed for real only when the Desk is On and Placement is On; in Rehearsal nothing is placed and nothing is written but a log line
--   * no phone number, note or reason is written to a message, a row or a log line
--
-- This replaces two functions (desk_interest_check, desk_tick; the rollback puts each back exactly as it was) and adds one column. Run it as the database owner,
-- after Phase 2b-1 (20270118000100) is applied.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.desk_offer_tick()') is null or to_regprocedure('public.desk_group_leader(uuid)') is null then
    raise exception 'The Leader Desk, Phase 2b-1 (20270118000100_desk_offers) must be applied first';
  end if;
  if to_regprocedure('public.placement_one_place(uuid, uuid, text[], text, boolean)') is null
     or to_regprocedure('public.placement_check_core(uuid, uuid, boolean, text, uuid)') is null
     or to_regprocedure('public.notify_role(uuid, text[], text, text, jsonb, text, text, boolean, uuid)') is null then
    raise exception 'The office placement and notices migrations must be applied first';
  end if;
end;
$guard$;

alter table public.desk_groups add column opened_at timestamptz;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode for members who finished the form and still have no tribe. It shows who is waiting and why, a masked phone number (opened one at a time, in calling hours), draft groups scored like tribe cards, and each member''s leadership signal. It can email a waiting member one open tribe that fits, ask the members of a draft whether it would suit them, and offer a draft group to a member to lead (with up to two backups, 72 hours to answer, started from a private page, a confirmed age of 21 or more, and the tribe card started from the draft for a pastor to approve). Rehearsal writes down what would be sent and sends nothing. Once the leader has been appointed, approved and certified, Open tribe places the draft''s members one at a time in the ordinary way and names anyone who cannot be placed; a pipeline shows who is stuck. It never approves a card or certifies a leader.'
 where key = 'leader_desk';

-- ---------------------------------------------------------------------------
-- Open tribe
-- ---------------------------------------------------------------------------
-- Why a group cannot be opened yet, in words.
create function public.desk_open_words(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'no_group' then 'No such group'
    when 'archived' then 'That group has been archived'
    when 'no_leader' then 'This group does not have a leader yet'
    when 'closed' then 'That tribe is closed'
    when 'card' then 'The leader''s tribe card has not been approved yet. A pastor approves it first'
    when 'not_certified' then 'The leader has not been certified by the Academy yet'
    else 'This tribe cannot be opened yet' end;
$$;

-- The plan for opening a group's tribe: whether it can be opened at all, and for each member of the draft whether they are already seated, would be placed now,
-- cannot be placed (and why), or would not fit. Each member is checked by the office's own check (placement_check_core) as the owner, so the answer is the one the
-- placement itself would give. It changes nothing. A warning is never accepted for anyone: those members are named, and the owner places them by hand.
create function public.desk_open_plan(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  t public.tribes%rowtype;
  v_code text;
  v_active integer;
  v_room integer;
  v_ready integer := 0;
  r record;
  v_chk jsonb;
  v_state text;
  v_text text;
  v_members jsonb := '[]'::jsonb;
begin
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    return jsonb_build_object('code', 'no_group', 'members', '[]'::jsonb);
  end if;
  if g.status <> 'draft' then
    v_code := 'archived';
  elsif g.leader_id is null or g.tribe_id is null then
    v_code := 'no_leader';
  else
    select * into t from public.tribes x where x.id = g.tribe_id;
    if not found or t.status = 'closed' then
      v_code := 'closed';
    elsif t.status <> 'approved' then
      v_code := 'card';
    elsif not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then
      v_code := 'not_certified';
    end if;
  end if;
  if v_code is not null then
    return jsonb_build_object('code', v_code, 'members', '[]'::jsonb);
  end if;

  select count(*)::integer into v_active from public.tribe_members x where x.tribe_id = t.id and x.status = 'active';
  v_room := greatest(t.capacity - v_active, 0);
  for r in
    select q.person_id, q.said_yes
      from (select d.person_id, d.added_at,
                   exists (select 1 from public.desk_proposals x
                            where x.group_id = g.id and x.person_id = d.person_id and x.kind = 'found' and x.answer = 'yes' and not x.rehearsal) as said_yes
              from public.desk_group_members d
             where d.group_id = g.id and d.person_id is distinct from g.leader_id) q
     order by q.said_yes desc, q.added_at, q.person_id
  loop
    v_state := null;
    v_text := null;
    if exists (select 1 from public.tribe_members x where x.person_id = r.person_id and x.tribe_id = t.id and x.status = 'active') then
      v_state := 'seated';
    else
      begin
        v_chk := public.placement_check_core(r.person_id, t.id, false, 'owner', auth.uid());
        if jsonb_array_length(v_chk -> 'blockers') > 0 then
          v_state := 'blocked';
          v_text := v_chk -> 'blockers' -> 0 ->> 'text';
        elsif exists (select 1 from jsonb_array_elements(v_chk -> 'warnings') w where w ->> 'code' <> 'full') then
          v_state := 'blocked';
          v_text := (select w ->> 'text' from jsonb_array_elements(v_chk -> 'warnings') w where w ->> 'code' <> 'full' limit 1);
        elsif v_ready >= v_room then
          v_state := 'full';
          v_text := 'There is no seat left in this tribe (' || t.capacity || ' of ' || t.capacity || ')';
        else
          v_state := 'ready';
          v_ready := v_ready + 1;
        end if;
      exception when others then
        v_state := 'blocked';
        v_text := 'They could not be checked just now';
      end;
    end if;
    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'person_id', r.person_id, 'name', public.person_display_name(r.person_id), 'said_yes', r.said_yes, 'state', v_state, 'text', v_text));
  end loop;
  return jsonb_build_object('code', null,
    'tribe', jsonb_build_object('id', t.id, 'name', t.name, 'capacity', t.capacity, 'active', v_active),
    'members', v_members);
end;
$$;

-- What "Open tribe" would do, so the owner sees it before pressing it. Changes nothing.
create function public.desk_open_preview(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
begin
  perform public.desk_need();
  v_plan := public.desk_open_plan(p_group);
  return jsonb_build_object(
    'ok', v_plan ->> 'code' is null,
    'problem', case when v_plan ->> 'code' is null then null else public.desk_open_words(v_plan ->> 'code') end,
    'rehearsal', public.leader_desk_any() = 'rehearsal',
    'placement_on', public.placement_mode() = 'on',
    'tribe', v_plan -> 'tribe',
    'members', v_plan -> 'members',
    'counts', jsonb_build_object(
      'ready', (select count(*)::integer from jsonb_array_elements(v_plan -> 'members') x where x ->> 'state' = 'ready'),
      'seated', (select count(*)::integer from jsonb_array_elements(v_plan -> 'members') x where x ->> 'state' = 'seated'),
      'not_placed', (select count(*)::integer from jsonb_array_elements(v_plan -> 'members') x where x ->> 'state' in ('blocked', 'full'))));
end;
$$;

-- Places the draft's members in the tribe, one at a time, each by placement_one_place (the function the office uses for one person). One member who cannot be placed
-- does not stop the rest, and changes nothing for them. In Rehearsal nobody is placed. When nobody is left to place, the draft is archived.
create function public.desk_open_tribe(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  v_plan jsonb;
  v_mode text := public.leader_desk_any();
  r record;
  v_placed integer := 0;
  v_would integer := 0;
  v_left integer := 0;
  v_not jsonb := '[]'::jsonb;
  v_text text;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group for update;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  v_plan := public.desk_open_plan(p_group);
  if v_plan ->> 'code' is not null then
    raise exception '%', public.desk_open_words(v_plan ->> 'code') using errcode = '22023';
  end if;
  if v_mode = 'on' and public.placement_mode() <> 'on' then
    raise exception 'Placement is not switched On. People are placed for real only when it is On' using errcode = '22023';
  end if;
  for r in select x.value as m from jsonb_array_elements(v_plan -> 'members') x loop
    if r.m ->> 'state' = 'ready' then
      if v_mode = 'rehearsal' then
        v_would := v_would + 1;
      else
        begin
          perform public.placement_one_place((r.m ->> 'person_id')::uuid, g.tribe_id, '{}'::text[], null, false);
          v_placed := v_placed + 1;
        exception when others then
          v_text := case when sqlstate = '22023' then sqlerrm else 'They could not be placed. Nothing was changed for them' end;
          v_not := v_not || jsonb_build_array(jsonb_build_object('person_id', r.m ->> 'person_id', 'name', r.m ->> 'name', 'text', v_text));
          v_left := v_left + 1;
        end;
      end if;
    elsif r.m ->> 'state' in ('blocked', 'full') then
      v_not := v_not || jsonb_build_array(jsonb_build_object('person_id', r.m ->> 'person_id', 'name', r.m ->> 'name', 'text', r.m ->> 'text'));
      v_left := v_left + 1;
    end if;
  end loop;
  if v_mode = 'on' then
    update public.desk_groups
       set opened_at = coalesce(opened_at, now()), updated_at = now(), status = case when v_left = 0 then 'archived' else status end
     where id = p_group;
  end if;
  perform public.write_event(auth.uid(), 'desk.open_tribe', 'desk_group', p_group::text,
    jsonb_build_object('placed', v_placed, 'would', v_would, 'not_placed', v_left, 'rehearsal', v_mode = 'rehearsal'));
  return jsonb_build_object('ok', true, 'rehearsal', v_mode = 'rehearsal', 'placed', v_placed, 'would', v_would, 'not_placed', v_not,
                            'closed', v_mode = 'on' and v_left = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- The pastors' reminder: a card the Desk's tribe sent in a day ago and nobody has decided
-- ---------------------------------------------------------------------------
create function public.desk_card_tick()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  v_centre uuid;
  v_told integer := 0;
begin
  if public.leader_desk_any() <> 'on' then
    return 0;
  end if;
  for t in
    select x.id, x.name, x.leader_id, x.submitted_at
      from public.tribes x
     where x.status = 'submitted' and x.submitted_at is not null
       and x.submitted_at <= now() - interval '24 hours' and x.submitted_at > now() - interval '14 days'
       and exists (select 1 from public.desk_groups g where g.tribe_id = x.id)
  loop
    begin
      select p.centre_id into v_centre from public.people p where p.id = t.leader_id;
      if v_centre is not null then
        v_told := v_told + public.notify_role(v_centre, array['pastor', 'director'], 'pastor_card_waiting',
          'cardwait:' || t.id || ':' || extract(epoch from t.submitted_at)::bigint,
          jsonb_build_object('tribe', t.name, 'leader', public.first_name_of(t.leader_id)),
          coalesce(t.name, 'A Tribe Card') || ' is still waiting for review', '/review/cards', false, t.leader_id);
      end if;
    exception when others then
      null;
    end;
  end loop;
  return v_told;
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
  v_cards integer;
begin
  v_offers := public.desk_offer_tick();
  v_cards := public.desk_card_tick();
  update public.desk_proposals set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_expired = row_count;
  delete from public.desk_links where expires_at < now();
  get diagnostics v_links = row_count;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('expired', v_expired, 'links', v_links, 'cleared', v_cleared, 'card_reminders', v_cards) || v_offers;
end;
$$;

-- "Check interest" on a group that already has a leader would say "we are still finding its leader". It is refused instead.
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
  if g.leader_id is not null then
    raise exception 'That group already has a leader, so there is nothing left to ask. Use Open tribe when its card is approved' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- The pipeline and its limits
-- ---------------------------------------------------------------------------
-- One row for each draft group on its way to an open tribe: where it stands, how long it has been there, and whether that is longer than the limit.
create function public.desk_pipeline()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.desk_settings%rowtype;
  v_rows jsonb;
begin
  perform public.desk_need();
  select * into s from public.desk_settings x where x.id;
  select coalesce(jsonb_agg(j.r order by j.stuck desc, j.hours desc, j.gname, j.group_id), '[]'::jsonb) into v_rows
    from (
      select z.group_id, z.gname, z.stuck, z.hours,
             jsonb_build_object('group_id', z.group_id, 'group', z.gname, 'person_id', z.person_id, 'name', public.person_display_name(z.person_id),
                                'stage', z.stage, 'since', z.since, 'hours', z.hours, 'limit_hours', z.limit_hours, 'stuck', z.stuck,
                                'formed', z.tribe_id is not null, 'tribe_id', z.tribe_id) as r
        from (
          select y.*, (y.limit_hours is not null and y.hours > y.limit_hours) as stuck
            from (
              select w.group_id, w.gname, w.person_id, w.tribe_id, w.stage, w.since, w.limit_hours,
                     greatest(floor(extract(epoch from now() - coalesce(w.since, now())) / 3600), 0)::integer as hours
                from (
                  select g.id as group_id, g.name as gname, g.leader_id as person_id, g.tribe_id,
                         case when t.status in ('draft', 'changes_requested') then 'card_started'
                              when t.status = 'submitted' then 'card_waiting'
                              when not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then 'card_approved'
                              when g.opened_at is null then 'ready'
                              else 'opened' end as stage,
                         case when t.status = 'draft' then g.leader_found_at
                              when t.status = 'changes_requested' then coalesce(t.reviewed_at, g.leader_found_at)
                              when t.status = 'submitted' then t.submitted_at
                              when not exists (select 1 from public.leader_certifications lc where lc.person_id = t.leader_id) then t.reviewed_at
                              when g.opened_at is null then greatest(t.reviewed_at, (select lc.certified_at from public.leader_certifications lc where lc.person_id = t.leader_id))
                              else g.opened_at end as since,
                         case when t.status = 'submitted' then s.card_days * 24 end as limit_hours
                    from public.desk_groups g
                    join public.tribes t on t.id = g.tribe_id
                   where g.status = 'draft' and g.leader_id is not null and t.status in ('draft', 'changes_requested', 'submitted', 'approved')
                  union all
                  select g.id, g.name, o.person_id, null::uuid,
                         case o.status when 'review' then 'said_yes' else 'asked' end,
                         case o.status when 'review' then o.answered_at else o.opened_at end,
                         case o.status when 'review' then s.said_yes_days * 24 else s.offer_hours end
                    from public.desk_groups g
                    join public.desk_offers o on o.group_id = g.id
                   where g.status = 'draft' and g.leader_id is null and not o.rehearsal and o.status in ('open', 'review')
                ) w
            ) y
        ) z
    ) j;
  return jsonb_build_object(
    'settings', jsonb_build_object('offer_hours', s.offer_hours, 'backups', s.backups, 'said_yes_days', s.said_yes_days, 'card_days', s.card_days),
    'stuck', (select count(*)::integer from jsonb_array_elements(v_rows) x where (x ->> 'stuck')::boolean),
    'rows', v_rows);
end;
$$;

-- The offer window, the backups per group and the two pipeline limits. Every change needs a reason; it applies from the next offer and the next look.
create function public.desk_pipeline_settings_set(p_offer_hours integer, p_backups integer, p_said_yes_days integer, p_card_days integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.desk_need();
  if p_offer_hours is null or p_offer_hours not between 24 and 240 then
    raise exception 'The offer window must be between 24 and 240 hours' using errcode = '22023';
  end if;
  if p_backups is null or p_backups not between 0 and 2 then
    raise exception 'Backups per group must be 0, 1 or 2' using errcode = '22023';
  end if;
  if p_said_yes_days is null or p_said_yes_days not between 1 and 14 then
    raise exception 'The limit for a yes waiting for you must be between 1 and 14 days' using errcode = '22023';
  end if;
  if p_card_days is null or p_card_days not between 1 and 14 then
    raise exception 'The limit for a card waiting for the pastors must be between 1 and 14 days' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 3 to 300 characters' using errcode = '22023';
  end if;
  update public.desk_settings
     set offer_hours = p_offer_hours, backups = p_backups, said_yes_days = p_said_yes_days, card_days = p_card_days,
         reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'desk.settings', 'desk', 'settings',
    jsonb_build_object('offer_hours', p_offer_hours, 'backups', p_backups, 'said_yes_days', p_said_yes_days, 'card_days', p_card_days));
  return public.desk_pipeline();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function public.desk_open_words(text), public.desk_open_plan(uuid), public.desk_card_tick() from public, anon, authenticated;

revoke all on function public.desk_open_preview(uuid), public.desk_open_tribe(uuid), public.desk_pipeline(), public.desk_pipeline_settings_set(integer, integer, integer, integer, text)
  from public, anon;
grant execute on function public.desk_open_preview(uuid), public.desk_open_tribe(uuid), public.desk_pipeline(), public.desk_pipeline_settings_set(integer, integer, integer, integer, text)
  to authenticated;

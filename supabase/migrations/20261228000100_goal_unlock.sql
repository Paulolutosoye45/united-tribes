-- =============================================================================
-- United Tribes: "Let them choose". The owner can unlock the goal (and, if ticked, the community) on the Tribe Card of a leader the owner
-- appointed, so the leader picks from a list on their own card. A welcome email, signed by the pastor, can go with it.
--
-- What this adds: three tables, one trigger and its function, and the functions below. It changes no existing function, table, column or
-- default. Everything a leader does through today's functions is exactly as before; the one trigger returns at once for any Tribe Card
-- that has no record here.
--
--   * Who can use it: the platform owner while unlocked, and nobody else. Every owner function begins with god_only(). A leader may only
--     read their own list (tribe_goal_hints), and only while their goal is unlocked.
--   * Whose card: a leader the owner appointed (an active appointment, or a bulk run that appointed them). A leader who applied, was
--     approved and accepted an offer cannot be unlocked this way.
--   * When: while the card is a draft or sent back for changes and nobody has joined. The unlock function refuses otherwise, and the guard
--     on the tribe refuses a change after that, so the rule holds even if something else tries to change the goal.
--   * Sensitive goals: left off the list unless the owner said a pastor cleared the leader, and refused by the guard in any case. The goal
--     the church started them on is always allowed, since it was the church's choice.
--   * Their own words: the three Success Picture lines refill from the new goal's ready-made card only where the leader has not changed
--     them from the old goal's card (or left them empty). A line they wrote is never touched.
--   * The way back: god_lock_goal puts the lock back exactly as it was and keeps whatever the leader already picked.
--   * The welcome email: queued only when the pastor's wording has been approved in God Mode (it is tied to a version of the wording),
--     and signed with the two lines the owner keeps. It is email only and never names the owner or the administrator.
--
-- Way back: supabase/rollback/20261228000100_goal_unlock.down.sql puts the lock back on every tribe this unlocked, keeping the goals
-- leaders picked, then removes the trigger and the functions. The three tables and every row stay, like the earlier features' way back,
-- and the file says how to drop them too. Emails already queued or sent stay.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row for each tribe the owner has ever unlocked.
create table public.leader_goal_unlock (
  tribe_id uuid primary key references public.tribes (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  appointment_id uuid references public.leader_appointments (id) on delete set null,
  -- open: the leader can choose. locked_again: the owner put the lock back (the leader's pick stays)
  state text not null default 'open' check (state in ('open', 'locked_again')),
  community_too boolean not null default false,
  -- The owner said a pastor cleared this leader for sensitive subjects (copied from the appointment; never true for a bulk-approved leader)
  care_cleared boolean not null default false,
  -- The lock as it was, so locking again restores it exactly
  fixed_before text[] not null,
  -- The goal the church started them on, and what they picked
  started_goal_id uuid references public.season_goals (id) on delete set null,
  chosen_goal_id uuid references public.season_goals (id) on delete set null,
  chosen_at timestamptz,
  picks integer not null default 0 check (picks >= 0),
  waiting_at_pick integer check (waiting_at_pick >= 0),
  seats_open_at_pick integer check (seats_open_at_pick >= 0),
  unlocked_by uuid references public.people (id) on delete set null,
  unlocked_at timestamptz not null default now(),
  locked_again_at timestamptz,
  locked_again_by uuid references public.people (id) on delete set null,
  check ((state = 'open') = (locked_again_at is null))
);
create index leader_goal_unlock_person_idx on public.leader_goal_unlock (person_id);
alter table public.leader_goal_unlock enable row level security;
revoke all on table public.leader_goal_unlock from public, anon, authenticated;

-- The pastor's name on the welcome email, and whether he has approved the wording. One row.
create table public.leader_welcome_settings (
  id boolean primary key default true check (id),
  signature_name text not null check (char_length(signature_name) between 2 and 60),
  signature_title text not null check (char_length(signature_title) between 2 and 80),
  -- The version of the wording that was approved. The email is queued only when this is the version the app is on.
  approved_version text check (approved_version ~ '^[a-z0-9-]{3,40}$'),
  approved_at timestamptz,
  approved_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((approved_version is null) = (approved_at is null))
);
alter table public.leader_welcome_settings enable row level security;
revoke all on table public.leader_welcome_settings from public, anon, authenticated;
insert into public.leader_welcome_settings (signature_name, signature_title) values ('Wale Ekundayo', 'Pastor TCN Iganmu Center');

-- Each welcome email queued: which tribe, which version of it, and the message.
create table public.leader_welcome_sends (
  id bigint generated always as identity primary key,
  tribe_id uuid not null references public.tribes (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- choose: they may choose their goal. fixed: their goal was chosen for them
  variant text not null check (variant in ('choose', 'fixed')),
  n integer not null check (n >= 1),
  message_id uuid references public.messages (id) on delete set null,
  queued_by uuid references public.people (id) on delete set null,
  queued_at timestamptz not null default now(),
  unique (tribe_id, variant, n)
);
create index leader_welcome_sends_tribe_idx on public.leader_welcome_sends (tribe_id, queued_at desc);
alter table public.leader_welcome_sends enable row level security;
revoke all on table public.leader_welcome_sends from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Is this a card the owner may give the choice on?
-- ---------------------------------------------------------------------------
-- Null when it is. Otherwise the reason, in words for the owner. Not callable by anyone.
create function public.leader_goal_unlock_why_not(p_tribe uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tribes;
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found then
    return 'We could not find that tribe';
  end if;
  if t.status::text = 'closed' then
    return 'That tribe is closed';
  end if;
  if t.leader_id is null
     or not (exists (select 1 from public.leader_appointments a where a.tribe_id = t.id and a.person_id = t.leader_id and a.status = 'active')
             or exists (select 1 from public.placement_leader_items i where i.tribe_id = t.id and i.person_id = t.leader_id and i.status = 'applied')) then
    return 'Only a leader you appointed can be given the choice';
  end if;
  if t.status::text not in ('draft', 'changes_requested') then
    return 'Their card has been sent to the pastorate, so the goal is final';
  end if;
  if exists (select 1 from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') then
    return 'A member has joined their tribe';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The welcome email, queued
-- ---------------------------------------------------------------------------
-- Queues "Welcome to leading a tribe" for the tribe's leader, in the version that matches the state of the lock. Returns what happened
-- instead of raising, so a refused email never undoes an unlock. A still-queued short bulk email for the same tribe is cancelled, since
-- this one covers it. Not callable by anyone: the owner functions below call it.
create function public.leader_welcome_queue(p_tribe uuid, p_version text, p_again boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  t public.tribes;
  s public.leader_welcome_settings;
  u public.leader_goal_unlock;
  p public.people;
  v_variant text;
  v_n integer;
  v_goal text;
  v_comm text;
  v_modes jsonb := public.leader_academy_modes();
  v_msg uuid;
begin
  select * into t from public.tribes x where x.id = p_tribe;
  if not found or t.leader_id is null or t.status::text = 'closed' then
    return jsonb_build_object('queued', false, 'reason', 'gone');
  end if;
  select * into s from public.leader_welcome_settings x where x.id;
  if p_version is null or s.approved_version is distinct from p_version then
    return jsonb_build_object('queued', false, 'reason', 'not_approved');
  end if;
  select * into p from public.people x where x.id = t.leader_id and not x.hidden;
  if not found or coalesce(btrim(p.email), '') = '' then
    return jsonb_build_object('queued', false, 'reason', 'no_email');
  end if;
  select * into u from public.leader_goal_unlock x where x.tribe_id = p_tribe;
  v_variant := case when u.tribe_id is not null and u.state = 'open' then 'choose' else 'fixed' end;
  select count(*)::integer into v_n from public.leader_welcome_sends x where x.tribe_id = p_tribe and x.variant = v_variant;
  if v_n > 0 and not p_again then
    return jsonb_build_object('queued', false, 'reason', 'already_sent', 'variant', v_variant);
  end if;

  select g.title, c.name into v_goal, v_comm
    from public.season_goals g join public.communities c on c.id = g.community_id
   where g.id = coalesce(case when v_variant = 'choose' then u.started_goal_id end, t.season_goal_id);

  v_msg := public.enqueue_message(
    p_person => t.leader_id, p_template => 'leader_welcome',
    p_params => jsonb_build_object(
      'choose', v_variant = 'choose',
      'community_free', v_variant = 'choose' and u.community_too,
      'goal', coalesce(v_goal, ''), 'community', coalesce(v_comm, ''),
      'academy', v_modes ->> 'academy', 'declaration', v_modes ->> 'declaration',
      'signature_name', s.signature_name, 'signature_title', s.signature_title, 'version', p_version),
    p_tribe => t.id, p_dedupe => 'leader-welcome:' || t.id || ':' || v_variant || ':' || (v_n + 1), p_force => 'email');
  if v_msg is null then
    return jsonb_build_object('queued', false, 'reason', 'not_queued');
  end if;
  insert into public.leader_welcome_sends (tribe_id, person_id, variant, n, message_id, queued_by)
  values (p_tribe, t.leader_id, v_variant, v_n + 1, v_msg, me);

  -- The short email a bulk run sends at the moment of appointment says the goal is set. If it has not gone yet, this one replaces it.
  update public.messages m set status = 'skipped', error = 'replaced by the welcome email'
   where m.dedupe_key = 'leader-appointed:' || p_tribe and m.status = 'queued';

  perform public.write_event(me, 'leader.welcome_queued', 'tribe', p_tribe::text, jsonb_build_object('variant', v_variant, 'again', v_n > 0));
  return jsonb_build_object('queued', true, 'variant', v_variant, 'message', v_msg);
end;
$$;

-- ---------------------------------------------------------------------------
-- Unlock
-- ---------------------------------------------------------------------------
-- Takes one tribe or many. A tribe that cannot be unlocked is skipped with the reason, and the rest go ahead. Pressing it again for a tribe
-- already unlocked changes nothing, except that it can add the community. With p_welcome the welcome email is queued for each tribe that
-- was unlocked (the unlock never waits on the email).
create function public.god_unlock_goal(p_tribes uuid[], p_community boolean default false, p_welcome boolean default false, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_id uuid;
  t public.tribes;
  u public.leader_goal_unlock;
  a public.leader_appointments;
  v_why text;
  v_ids uuid[];
  v_results jsonb := '[]'::jsonb;
  v_unlocked integer := 0;
  v_skipped integer := 0;
  v_mail jsonb := '[]'::jsonb;
  v_one jsonb;
  v_title text;
  v_fixed text[];
begin
  perform public.god_only();
  select coalesce(array_agg(x order by x), '{}') into v_ids from (select distinct x from unnest(coalesce(p_tribes, '{}')) x where x is not null) d;
  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one leader' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 300 then
    raise exception 'Choose up to 300 leaders at a time' using errcode = '22023';
  end if;

  foreach v_id in array v_ids loop
    select * into t from public.tribes x where x.id = v_id for update;
    v_why := public.leader_goal_unlock_why_not(v_id);
    if v_why is null then
      select * into u from public.leader_goal_unlock x where x.tribe_id = v_id;
      if (not found or u.state <> 'open') and not ('goal' = any (t.fixed)) then
        v_why := 'Their goal is not locked, so there is nothing to unlock';
      end if;
    end if;
    if v_why is not null then
      v_results := v_results || jsonb_build_array(jsonb_build_object('tribe', v_id, 'ok', false, 'reason', v_why));
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into u from public.leader_goal_unlock x where x.tribe_id = v_id for update;
    select * into a from public.leader_appointments x where x.tribe_id = v_id and x.person_id = t.leader_id and x.status = 'active';
    if u.tribe_id is not null and u.state = 'open' then
      -- Already unlocked. Only the community can still be added.
      if coalesce(p_community, false) and not u.community_too then
        update public.leader_goal_unlock set community_too = true where tribe_id = v_id;
        update public.tribes set fixed = array_remove(fixed, 'community') where id = v_id;
        v_results := v_results || jsonb_build_array(jsonb_build_object('tribe', v_id, 'ok', true, 'already', true, 'community_added', true));
        v_unlocked := v_unlocked + 1;
      else
        v_results := v_results || jsonb_build_array(jsonb_build_object('tribe', v_id, 'ok', true, 'already', true));
      end if;
      continue;
    end if;

    v_fixed := t.fixed;
    insert into public.leader_goal_unlock as r
      (tribe_id, person_id, appointment_id, state, community_too, care_cleared, fixed_before, started_goal_id, unlocked_by, unlocked_at)
    values (v_id, t.leader_id, a.id, 'open', coalesce(p_community, false), coalesce(a.care_cleared, false), v_fixed, t.season_goal_id, me, now())
    on conflict (tribe_id) do update
       set state = 'open', person_id = excluded.person_id, appointment_id = excluded.appointment_id, community_too = excluded.community_too,
           care_cleared = excluded.care_cleared, fixed_before = excluded.fixed_before, unlocked_by = excluded.unlocked_by,
           unlocked_at = now(), locked_again_at = null, locked_again_by = null,
           started_goal_id = coalesce(r.started_goal_id, excluded.started_goal_id);
    update public.tribes set fixed = array_remove(case when coalesce(p_community, false) then array_remove(fixed, 'community') else fixed end, 'goal') where id = v_id;

    select g.title into v_title from public.season_goals g where g.id = t.season_goal_id;
    perform public.write_event(me, 'leader.goal_unlocked', 'tribe', v_id::text,
      jsonb_build_object('goal', v_title, 'community_too', coalesce(p_community, false)));
    v_results := v_results || jsonb_build_array(jsonb_build_object('tribe', v_id, 'ok', true));
    v_unlocked := v_unlocked + 1;

    if coalesce(p_welcome, false) then
      v_one := public.leader_welcome_queue(v_id, p_version, false);
      v_mail := v_mail || jsonb_build_array(v_one || jsonb_build_object('tribe', v_id));
    end if;
  end loop;

  return jsonb_build_object('unlocked', v_unlocked, 'skipped', v_skipped, 'results', v_results, 'mail', v_mail);
end;
$$;

-- Unlocks the leaders a bulk run has appointed so far.
create function public.god_unlock_goal_run(p_run uuid, p_community boolean default false, p_welcome boolean default false, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform public.god_only();
  if not exists (select 1 from public.placement_leader_runs r where r.id = p_run) then
    raise exception 'No such run' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct i.tribe_id), '{}') into v_ids
    from public.placement_leader_items i
   where i.run_id = p_run and i.status = 'applied' and i.tribe_id is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'This run has not appointed anyone yet' using errcode = '22023';
  end if;
  return public.god_unlock_goal(v_ids, p_community, p_welcome, p_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock again
-- ---------------------------------------------------------------------------
-- Puts the lock back exactly as it was before the unlock. Whatever the leader already picked stays; the lock only stops further changes.
create function public.god_lock_goal(p_tribes uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_id uuid;
  u public.leader_goal_unlock;
  v_ids uuid[];
  v_done integer := 0;
  v_skipped integer := 0;
  v_title text;
begin
  perform public.god_only();
  select coalesce(array_agg(x order by x), '{}') into v_ids from (select distinct x from unnest(coalesce(p_tribes, '{}')) x where x is not null) d;
  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one leader' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 300 then
    raise exception 'Choose up to 300 leaders at a time' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    perform 1 from public.tribes x where x.id = v_id for update;
    select * into u from public.leader_goal_unlock x where x.tribe_id = v_id for update;
    if not found or u.state <> 'open' then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    update public.tribes set fixed = u.fixed_before where id = v_id;
    update public.leader_goal_unlock set state = 'locked_again', locked_again_at = now(), locked_again_by = me where tribe_id = v_id;
    select g.title into v_title from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = v_id;
    perform public.write_event(me, 'leader.goal_locked', 'tribe', v_id::text, jsonb_build_object('goal', v_title));
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('locked', v_done, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- The guard on a tribe's goal
-- ---------------------------------------------------------------------------
-- Runs only when a tribe's goal or community changes. For a tribe with no open record it returns at once. For one with an open record
-- it keeps the rules that the existing card-saving function does not know about:
--   * no change once the card is sent, or a member has joined
--   * the goal must be one with a signed-off ready-made card in an open community, in the tribe's community
--   * a sensitive goal only if the owner said a pastor cleared the leader (or it is the goal the church started them on)
--   * the community may change only if the owner unlocked it
--   * the three Success Picture lines the leader has not changed from the old goal's ready-made card (or left empty) refill from the new
--     goal's card; a line they wrote stays
--   * a tribe name that is still the one the appointment generated follows the community
--   * what the leader picked is recorded (for the owner's list and private record)
create function public.leader_goal_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.leader_goal_unlock;
  g public.season_goals;
  t_new public.tribe_card_templates;
  t_old public.tribe_card_templates;
  v_prev uuid;
  v_wait integer := 0;
  v_seats integer := 0;
  v_first text;
  v_old_name text;
  v_new_name text;
  v_from text;
  v_to text;
begin
  select * into u from public.leader_goal_unlock x where x.tribe_id = new.id;
  if not found or u.state <> 'open' then
    return new;
  end if;

  if new.status::text not in ('draft', 'changes_requested') then
    raise exception 'This card has been sent. It can be edited again if the pastorate asks for changes' using errcode = '22023';
  end if;
  if exists (select 1 from public.tribe_members m where m.tribe_id = new.id and m.status = 'active') then
    raise exception 'A member has joined this tribe, so its goal can no longer change' using errcode = '22023';
  end if;
  if new.community_id is distinct from old.community_id and not u.community_too then
    raise exception 'The community is fixed for this tribe' using errcode = '22023';
  end if;

  -- The last real goal, even if a community change cleared it for a moment
  v_prev := coalesce(old.season_goal_id, u.chosen_goal_id, u.started_goal_id);

  -- A tribe named by the appointment ("Ada’s Business tribe") follows the community. A name the leader wrote stays.
  if new.community_id is distinct from old.community_id and new.name is not distinct from old.name then
    select coalesce(nullif(btrim(p.preferred_name), ''), split_part(btrim(coalesce(p.full_name, '')), ' ', 1)) into v_first
      from public.people p where p.id = new.leader_id;
    select case when coalesce(v_first, '') <> '' and char_length(v_first || '’s ' || c.name || ' tribe') <= 48 then v_first || '’s ' || c.name || ' tribe' end
      into v_old_name from public.communities c where c.id = old.community_id;
    if new.name is not distinct from v_old_name and v_old_name is not null then
      select case when coalesce(v_first, '') <> '' and char_length(v_first || '’s ' || c.name || ' tribe') <= 48 then v_first || '’s ' || c.name || ' tribe' end
        into v_new_name from public.communities c where c.id = new.community_id;
      new.name := v_new_name;
    end if;
  end if;

  if new.season_goal_id is not null and new.season_goal_id is distinct from old.season_goal_id then
    select * into g from public.season_goals x where x.id = new.season_goal_id;
    select * into t_new from public.tribe_card_templates x where x.season_goal_id = new.season_goal_id and x.status = 'signed_off';
    if g.id is null or not g.active or t_new.season_goal_id is null
       or not exists (select 1 from public.communities c where c.id = g.community_id and c.active) then
      raise exception 'That goal is not available' using errcode = '22023';
    end if;
    if g.community_id is distinct from new.community_id then
      raise exception 'That goal belongs to a different community' using errcode = '22023';
    end if;
    if t_new.sensitive and not u.care_cleared and new.season_goal_id is distinct from u.started_goal_id then
      raise exception 'That goal is about a sensitive subject, so it is not on your list' using errcode = '22023';
    end if;

    -- Refill the lines that are still the old card's (or empty)
    select * into t_old from public.tribe_card_templates x where x.season_goal_id = v_prev and x.status = 'signed_off';
    if coalesce(btrim(new.loving_god), '') = '' or (t_old.season_goal_id is not null and btrim(new.loving_god) = btrim(coalesce(t_old.loving_god, ''))) then
      new.loving_god := t_new.loving_god;
    end if;
    if coalesce(btrim(new.loving_others), '') = '' or (t_old.season_goal_id is not null and btrim(new.loving_others) = btrim(coalesce(t_old.loving_others, ''))) then
      new.loving_others := t_new.loving_others;
    end if;
    if coalesce(btrim(new.loving_life), '') = '' or (t_old.season_goal_id is not null and btrim(new.loving_life) = btrim(coalesce(t_old.loving_life, ''))) then
      new.loving_life := t_new.loving_life;
    end if;

    -- Record the pick, unless it is the goal they already had
    if new.season_goal_id is distinct from coalesce(u.chosen_goal_id, u.started_goal_id) then
      select coalesce(max(d.waiting), 0), coalesce(max(d.seats_open), 0) into v_wait, v_seats
        from public.goal_demand_rows(new.season_id) d where d.goal_id = new.season_goal_id;
      update public.leader_goal_unlock
         set chosen_goal_id = new.season_goal_id, chosen_at = now(), picks = picks + 1, waiting_at_pick = v_wait, seats_open_at_pick = v_seats
       where tribe_id = new.id;
      select s.title into v_from from public.season_goals s where s.id = coalesce(u.chosen_goal_id, u.started_goal_id);
      v_to := g.title;
      -- The pick is the leader's, so the audit trail shows it as theirs; the owner's private record gets the plain facts too
      perform public.write_event(new.leader_id, 'leader.goal_chosen', 'tribe', new.id::text, jsonb_build_object('goal', v_to, 'was', v_from, 'waiting', v_wait));
      insert into public.god_log (kind, action, entity, entity_id, detail)
      values ('leader', 'leader.goal_chosen', 'tribe', new.id::text, jsonb_build_object('goal', v_to, 'was', v_from, 'waiting', v_wait, 'seats_open', v_seats));
    end if;
  end if;
  return new;
end;
$$;

create trigger tribes_goal_guard
  before update on public.tribes
  for each row
  when (old.season_goal_id is distinct from new.season_goal_id or old.community_id is distinct from new.community_id)
  execute function public.leader_goal_guard();

-- ---------------------------------------------------------------------------
-- The leader's list
-- ---------------------------------------------------------------------------
-- The goals this leader may take on their own Tribe Card, with how many people are waiting for each, the one the church started them on
-- first, then the ones with most people waiting. Only for a leader whose own goal is unlocked and whose card can still be edited: for any
-- other card of their own the answer is null (so the page asks every leader and shows the list to the few it is for), and a card that
-- is not theirs, or does not exist, is refused with the message a wrong id gets from the card-saving function.
create function public.tribe_goal_hints(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  t public.tribes;
  u public.leader_goal_unlock;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.tribes x where x.id = p_tribe and x.leader_id = me;
  if t.id is null then
    raise exception 'Tribe Card not found' using errcode = 'P0002';
  end if;
  select * into u from public.leader_goal_unlock x where x.tribe_id = p_tribe and x.state = 'open';
  -- A card whose goal is locked, or that has been sent, has no list. That is the ordinary case, so it is an empty answer, not an error.
  if u.tribe_id is null or t.status::text not in ('draft', 'changes_requested') then
    return null;
  end if;
  return jsonb_build_object(
    'community_too', u.community_too,
    'started', u.started_goal_id,
    'current', t.season_goal_id,
    'name', t.name,
    'community', (select c.slug from public.communities c where c.id = t.community_id),
    'goal', (select g.slug from public.season_goals g where g.id = t.season_goal_id),
    'lines', jsonb_build_object('god', t.loving_god, 'others', t.loving_others, 'life', t.loving_life),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'slug', x.slug, 'title', x.title, 'community', x.community_slug, 'community_name', x.community_name,
               'waiting', x.waiting, 'started', x.started)
             order by x.started desc, x.waiting desc, x.comm_sort, x.sort, x.title)
        from (
          select g.id, g.slug, g.title, g.sort, c.slug as community_slug, c.name as community_name, c.sort as comm_sort,
                 coalesce(d.waiting, 0) as waiting, g.id is not distinct from u.started_goal_id as started
            from public.season_goals g
            join public.communities c on c.id = g.community_id and c.active
            join public.tribe_card_templates tp on tp.season_goal_id = g.id and tp.status = 'signed_off'
            left join public.goal_demand_rows(t.season_id) d on d.goal_id = g.id
           where g.active
             and (u.community_too or g.community_id = t.community_id)
             and (not tp.sensitive or u.care_cleared or g.id is not distinct from u.started_goal_id or g.id is not distinct from t.season_goal_id)) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- What the pastor reviewing the card is told
-- ---------------------------------------------------------------------------
-- When the leader picked a goal other than the one the church started them on. Never a name, and never the owner.
create function public.tribe_goal_choice_note(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director', 'pastor']::public.app_role[]) then
    raise exception 'Only the pastor, directors and the admin can see this' using errcode = '42501';
  end if;
  if not exists (
       select 1 from public.leader_goal_unlock u join public.tribes t on t.id = u.tribe_id
        where u.tribe_id = p_tribe and u.picks > 0 and t.season_goal_id is not null and t.season_goal_id is distinct from u.started_goal_id) then
    return null;
  end if;
  return jsonb_build_object('text', 'This leader chose their own goal. The church had started them on a different one.');
end;
$$;

-- ---------------------------------------------------------------------------
-- What the owner's screens read
-- ---------------------------------------------------------------------------
-- For each tribe asked about: whether the goal can be unlocked (and if not, why), the record (what they picked, from what, how many were
-- waiting), and the welcome emails sent. The state is one of none, waiting, chosen, changed, sent, locked_again.
create function public.god_goal_unlock_view(p_tribes uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform public.god_only();
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_tribes, '{}')) x where x is not null;
  if cardinality(v_ids) > 600 then
    raise exception 'Ask about up to 600 tribes at a time' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(r)::jsonb order by r.tribe)
      from (
        select t.id as tribe,
               w.why,
               (w.why is null and (u.tribe_id is null or u.state <> 'open') and 'goal' = any (t.fixed)) as can_unlock,
               coalesce(u.state = 'open', false) as can_lock,
               case when u.tribe_id is null then 'none'
                    when u.state = 'locked_again' then 'locked_again'
                    when t.status::text not in ('draft', 'changes_requested') then 'sent'
                    when u.picks = 0 then 'waiting'
                    when u.picks = 1 then 'chosen'
                    else 'changed' end as state,
               u.community_too,
               coalesce(u.care_cleared, coalesce(a.care_cleared, false)) as care_cleared,
               (select g.title from public.season_goals g where g.id = u.started_goal_id) as started,
               (select g.title from public.season_goals g where g.id = t.season_goal_id) as goal_now,
               (select g.title from public.season_goals g where g.id = u.chosen_goal_id) as chosen,
               u.picks, u.waiting_at_pick, u.seats_open_at_pick, u.unlocked_at, u.chosen_at, u.locked_again_at,
               coalesce((
                 select jsonb_agg(jsonb_build_object('variant', s.variant, 'n', s.n, 'queued_at', s.queued_at, 'status', m.status) order by s.queued_at desc)
                   from public.leader_welcome_sends s left join public.messages m on m.id = s.message_id
                  where s.tribe_id = t.id), '[]'::jsonb) as welcome
          from public.tribes t
          left join public.leader_goal_unlock u on u.tribe_id = t.id
          left join public.leader_appointments a on a.tribe_id = t.id and a.person_id = t.leader_id and a.status = 'active'
          cross join lateral (select public.leader_goal_unlock_why_not(t.id) as why) w
         where t.id = any (v_ids)) r), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The pastor's name on the email, and his approval
-- ---------------------------------------------------------------------------
create function public.god_welcome_settings_get(p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.leader_welcome_settings;
begin
  perform public.god_only();
  select * into s from public.leader_welcome_settings x where x.id;
  return jsonb_build_object(
    'signature_name', s.signature_name, 'signature_title', s.signature_title,
    'approved', p_version is not null and s.approved_version is not distinct from p_version,
    'approved_version', s.approved_version, 'approved_at', s.approved_at);
end;
$$;

-- Changing the name or the title is a change to what the email says over a pastor's name, so it takes the approval away.
create function public.god_welcome_settings_save(p_name text, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.leader_welcome_settings;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_changed boolean;
begin
  perform public.god_only();
  if char_length(v_name) not between 2 and 60 or char_length(v_title) not between 2 and 80 then
    raise exception 'Give the name (up to 60 letters) and the title (up to 80)' using errcode = '22023';
  end if;
  if v_name ~ '[<>@/\\]|https?:' or v_title ~ '[<>@/\\]|https?:' or v_name ~ '[[:cntrl:]]' or v_title ~ '[[:cntrl:]]' then
    raise exception 'Use plain words for the name and the title' using errcode = '22023';
  end if;
  select * into s from public.leader_welcome_settings x where x.id for update;
  v_changed := s.signature_name <> v_name or s.signature_title <> v_title;
  if v_changed then
    update public.leader_welcome_settings
       set signature_name = v_name, signature_title = v_title, approved_version = null, approved_at = null, approved_by = null, updated_at = now()
     where id;
    perform public.write_event(me, 'leader.welcome_signature_saved', 'leader_welcome', 'signature', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end;
$$;

create function public.god_welcome_approve(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  perform public.god_only();
  if p_version is null or p_version !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'That is not a version of the wording' using errcode = '22023';
  end if;
  update public.leader_welcome_settings
     set approved_version = p_version, approved_at = now(), approved_by = me, updated_at = now()
   where id;
  perform public.write_event(me, 'leader.welcome_approved', 'leader_welcome', p_version, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Takes the approval away without changing the name.
create function public.god_welcome_withdraw()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  update public.leader_welcome_settings set approved_version = null, approved_at = null, approved_by = null, updated_at = now() where id;
  perform public.write_event(auth.uid(), 'leader.welcome_withdrawn', 'leader_welcome', 'approval', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Sends the welcome email on its own, to each leader the owner appointed. Each version goes once to a tribe; p_again sends it again.
create function public.god_welcome_send(p_tribes uuid[], p_version text, p_again boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ids uuid[];
  t public.tribes;
  v_one jsonb;
  v_results jsonb := '[]'::jsonb;
  v_queued integer := 0;
begin
  perform public.god_only();
  select coalesce(array_agg(x order by x), '{}') into v_ids from (select distinct x from unnest(coalesce(p_tribes, '{}')) x where x is not null) d;
  if cardinality(v_ids) = 0 then
    raise exception 'Choose at least one leader' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 300 then
    raise exception 'Choose up to 300 leaders at a time' using errcode = '22023';
  end if;
  foreach v_id in array v_ids loop
    select * into t from public.tribes x where x.id = v_id for update;
    if not found
       or not (exists (select 1 from public.leader_appointments a where a.tribe_id = t.id and a.person_id = t.leader_id and a.status = 'active')
               or exists (select 1 from public.placement_leader_items i where i.tribe_id = t.id and i.person_id = t.leader_id and i.status = 'applied')) then
      v_results := v_results || jsonb_build_array(jsonb_build_object('tribe', v_id, 'queued', false, 'reason', 'not_yours'));
      continue;
    end if;
    v_one := public.leader_welcome_queue(v_id, p_version, coalesce(p_again, false));
    if (v_one ->> 'queued')::boolean then
      v_queued := v_queued + 1;
    end if;
    v_results := v_results || jsonb_build_array(v_one || jsonb_build_object('tribe', v_id));
  end loop;
  return jsonb_build_object('queued', v_queued, 'results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Internal: never called by a person or by the sending service.
revoke execute on function
  public.leader_goal_unlock_why_not(uuid), public.leader_welcome_queue(uuid, text, boolean), public.leader_goal_guard()
  from public, anon, authenticated;

-- The owner's functions each begin god_only(); the leader's and the reviewer's check who is asking.
revoke execute on function
  public.god_unlock_goal(uuid[], boolean, boolean, text), public.god_unlock_goal_run(uuid, boolean, boolean, text), public.god_lock_goal(uuid[]),
  public.god_goal_unlock_view(uuid[]), public.god_welcome_settings_get(text), public.god_welcome_settings_save(text, text),
  public.god_welcome_approve(text), public.god_welcome_withdraw(), public.god_welcome_send(uuid[], text, boolean),
  public.tribe_goal_hints(uuid), public.tribe_goal_choice_note(uuid)
  from public, anon;
grant execute on function
  public.god_unlock_goal(uuid[], boolean, boolean, text), public.god_unlock_goal_run(uuid, boolean, boolean, text), public.god_lock_goal(uuid[]),
  public.god_goal_unlock_view(uuid[]), public.god_welcome_settings_get(text), public.god_welcome_settings_save(text, text),
  public.god_welcome_approve(text), public.god_welcome_withdraw(), public.god_welcome_send(uuid[], text, boolean),
  public.tribe_goal_hints(uuid), public.tribe_goal_choice_note(uuid)
  to authenticated;

-- =============================================================================
-- United Tribes: the Leader Desk, Phase 2a (email a proposed group, check interest, and the member's one-tap answer)
--
-- What this adds, and nothing else. Two emails the owner can send from the Desk, both to a member who is waiting for a tribe, both email only:
--
--   Tribe proposed    "Email a proposed group" on a waiting member: one open tribe the member already passes every matching rule for, with the fit, up to three
--                     reasons (about the goal, the place and the time only), the day, time, format and general area, the leader's first name and the seats left.
--                     The button opens a private page that shows the tribe and takes the member to the normal Tribes page. Nothing about joining is shortcut: the
--                     member still chooses the tribe the usual way, with the usual agreement. The page also has "Not for me" and "Stop these".
--   Interest check    "Check interest" on a draft group: the same details with no leader's name, and one question: Yes, count me in / Not for me / A different time
--                     (one or more of the four meeting times). Yes is counted on the draft. Not for me and A different time take the member off the draft; they stay
--                     waiting, and the different times are kept for the owner to read. No answer in 48 hours: left waiting, never placed by silence.
--
-- The switch is the Leader Desk's own (God Mode -> Features). Off: nothing is sent and the page is closed. Rehearsal: the Desk writes down who would have been
-- emailed and sends nothing. On: the emails are queued. The switch can be set for one community or one person, as for every function.
--
-- Safety rules, all kept here and not on the screen:
--   * never to: under 18s, a deletion request, an open care follow-up, a bounced or opted-out address, a person who stopped announcements, the owner, or a person
--     who pressed "Stop these"; only to a member who is still waiting for a tribe
--   * limits (a settings card for the owner, each change with a reason): one proposal to a member in 7 days, three in a season, 40 Desk emails a day
--   * emails go only between 9 am and 7 pm Lagos time: one asked for at another hour is held until 9 am
--   * the Master pause stops every send; nothing is sent on WhatsApp; no phone number is in an email, a message row, an event or a log
--   * every answer is one button on a private page that saves nothing until it is pressed; opening a link changes nothing
--   * the Desk places nobody, appoints nobody and changes no member, seat, tribe, message template or notice. It writes only to its own tables and to the
--     message queue
--
-- Replaces the Switchboard text for 'leader_desk' only (the old text is in the rollback file). It replaces no function.
-- Needs the Leader Desk, Phase 1 (20270116000100_leader_desk.sql).
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.desk_need()') is null or to_regprocedure('public.desk_group_fit(uuid, uuid)') is null then
    raise exception 'Apply the Leader Desk, Phase 1 (20270116000100_leader_desk.sql) before this file.';
  end if;
end
$guard$;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode. Shows members who finished the form and still have no tribe, why no tribe has fitted them, a masked phone number (opened one at a time, in calling hours), and how well each would suit a draft group. Builds draft groups with the same Degree of Compatibility and the same tribe health rules as matching, lists the groups the waiting members could already fill, and scores each member''s leadership signal. Can email a waiting member one open tribe that fits them, or ask the members of a draft group whether they are interested; each is answered on a private page. In Rehearsal it writes down who would be emailed and sends nothing. Recommending a leader and forming a tribe come next.'
 where key = 'leader_desk';

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- The numbers behind the emails. One row. Each change is made with a reason, which is kept here and never in the event log.
create table public.desk_settings (
  id boolean primary key default true check (id),
  daily_cap smallint not null default 40 check (daily_cap between 1 and 300),
  gap_days smallint not null default 7 check (gap_days between 1 and 60),
  season_cap smallint not null default 3 check (season_cap between 1 and 10),
  interest_hours smallint not null default 48 check (interest_hours between 12 and 240),
  reason text check (char_length(reason) <= 300),
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz
);
insert into public.desk_settings (id) values (true);

-- One row for each email the Desk sent, or, in Rehearsal, would have sent.
create table public.desk_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('tribe', 'interest')),
  person_id uuid not null references public.people (id) on delete cascade,
  season_id uuid not null references public.seasons (id),
  tribe_id uuid references public.tribes (id) on delete set null,
  group_id uuid references public.desk_groups (id) on delete set null,
  rehearsal boolean not null,
  status text not null check (status in ('would_send', 'sent', 'answered', 'expired', 'cancelled')),
  answer text check (answer in ('yes', 'no', 'other_time', 'stop')),
  slots text[] not null default '{}' check (slots <@ array['sunday-afternoon', 'sunday-evening', 'weeknight-evening', 'saturday-morning']),
  degree smallint,
  message_id uuid,
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  answered_at timestamptz,
  check ((kind = 'tribe' and tribe_id is not null) or (kind = 'interest' and group_id is not null) or status in ('expired', 'cancelled', 'answered'))
);
create index desk_proposals_person_idx on public.desk_proposals (person_id, created_at desc);
create index desk_proposals_group_idx on public.desk_proposals (group_id) where group_id is not null;
create index desk_proposals_open_idx on public.desk_proposals (expires_at) where status = 'sent';

-- The private link in an email. Only its hash is kept; the link itself goes into the message's reply token, which the heartbeat scrubs once the message is
-- finished with.
create table public.desk_links (
  token_hash text primary key,
  proposal_id uuid not null references public.desk_proposals (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  expires_at timestamptz not null,
  clicks integer not null default 0
);
create index desk_links_proposal_idx on public.desk_links (proposal_id);

-- "Stop these": a member who pressed it is not written to by the Desk again.
create table public.desk_stops (
  person_id uuid primary key references public.people (id) on delete cascade,
  at timestamptz not null default now()
);

alter table public.desk_settings enable row level security;
alter table public.desk_proposals enable row level security;
alter table public.desk_links enable row level security;
alter table public.desk_stops enable row level security;
revoke all on table public.desk_settings, public.desk_proposals, public.desk_links, public.desk_stops from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rules every Desk email obeys (helpers, closed to every signed-in person)
-- ---------------------------------------------------------------------------
-- How far open the Desk's email is for one person: 'on', 'rehearsal' or 'off'. The switch, its scope and the Master pause decide.
create function public.desk_mail_state(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.feature_state_of('leader_desk', p_person);
$$;

-- Why the Desk must not write to this person, or null when it may.
create function public.desk_mail_block(p_person uuid)
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
  if v in ('deletion', 'under18', 'bounced', 'email_off') then
    return v;
  end if;
  if public.reminder_stopped(p_person, 'announcements') then
    return 'announcements_off';
  end if;
  if exists (select 1 from public.care_flags f where f.person_id = p_person and f.status <> 'closed') then
    return 'care';
  end if;
  if exists (select 1 from public.desk_stops s where s.person_id = p_person) then
    return 'stopped';
  end if;
  if public.notice_is_owner(p_person) then
    return 'excluded';
  end if;
  return null;
end;
$$;

-- The limits: one in a gap, some in a season, some in a day. A Rehearsal counts only Rehearsal rows and a real send only real ones, so trying the Desk
-- out never uses up a member's real allowance. Null when there is room.
create function public.desk_mail_cap(p_person uuid, p_rehearsal boolean)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.desk_settings%rowtype;
  v_season uuid := public.placement_season();
begin
  select * into s from public.desk_settings x where x.id;
  if exists (select 1 from public.desk_proposals x where x.person_id = p_person and x.rehearsal = p_rehearsal
                and x.created_at >= now() - make_interval(days => s.gap_days)) then
    return 'gap';
  end if;
  if (select count(*) from public.desk_proposals x where x.person_id = p_person and x.rehearsal = p_rehearsal and x.season_id = v_season) >= s.season_cap then
    return 'season';
  end if;
  if (select count(*) from public.desk_proposals x where x.rehearsal = p_rehearsal
         and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos()) >= s.daily_cap then
    return 'day';
  end if;
  return null;
end;
$$;

-- The words for a reason the Desk would not write to someone. Plain, and the same wherever it is shown.
create function public.desk_mail_words(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'under18' then 'That member is under 18. The Desk never writes to young people.'
    when 'deletion' then 'That member has asked for their details to be deleted.'
    when 'bounced' then 'Emails to that member are not arriving.'
    when 'email_off' then 'That member has switched email off.'
    when 'announcements_off' then 'That member has stopped announcements.'
    when 'care' then 'That member has an open care follow-up. Wait for the pastors.'
    when 'stopped' then 'That member asked the Desk to stop writing to them.'
    when 'excluded' then 'The Desk does not write to that person.'
    when 'off' then 'The Leader Desk is switched off for that member.'
    when 'gap' then 'That member has already had a Desk email lately.'
    when 'season' then 'That member has had the most Desk emails allowed this season.'
    when 'day' then 'The Desk has reached its limit of emails for today.'
    when 'not_waiting' then 'That member is no longer waiting for a tribe.'
    else 'The Desk cannot write to that member.' end;
$$;

-- The next moment an email may go: now between 9 am and 7 pm in Lagos, else 9 am.
create function public.desk_send_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.lagos_hour() between 9 and 18 then now()
    when public.lagos_hour() < 9 then ((public.today_lagos())::timestamp + interval '9 hours') at time zone 'Africa/Lagos'
    else ((public.today_lagos() + 1)::timestamp + interval '9 hours') at time zone 'Africa/Lagos' end;
$$;

-- The best open tribe for a waiting member: the highest Degree of Compatibility at or above the floor, among the tribes the matching itself would show.
create function public.desk_tribe_pick(p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.r_tribe from public.match_candidates(p_person) r
   where r.r_degree >= public.placement_floor() and r.r_seats >= 1
   order by r.r_degree desc, r.r_published asc, r.r_tribe
   limit 1;
$$;

-- What the "Tribe proposed" email and its page carry. Null when the tribe is no longer one the matching would show this member (full, closed, or no longer
-- a fit). Never a number, never another member's name, never the group chat link, never anything about faith, stage or support.
create function public.desk_tribe_params(p_person uuid, p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
  t public.tribes%rowtype;
  w jsonb;
  v_reasons text[];
begin
  select * into r from public.match_candidates(p_person) x where x.r_tribe = p_tribe;
  if not found then
    return null;
  end if;
  select * into t from public.tribes x where x.id = p_tribe;
  select mm.weights into w from public.match_models mm where mm.active;
  v_reasons := coalesce(array(
    select k from unnest(public.match_reasons(r.r_goal, r.r_stage, r.r_community, r.r_place, r.r_online, r.r_rhythm, r.r_balance, r.r_affinity, r.r_faith, w)) with ordinality as u(k, o)
     where k in ('goal_same', 'goal_family', 'community_same', 'place_online', 'place_same', 'place_near', 'rhythm_fit')
     order by o limit 3), '{}');
  return jsonb_build_object(
    'kind', 'tribe',
    'first', public.first_name_of(p_person),
    'tribe', t.name,
    'leader_first', public.first_name_of(t.leader_id),
    'meeting_day', t.meeting_day,
    'meeting_time', to_char(t.meeting_time, 'HH24:MI'),
    'mode', t.meeting_mode,
    'zone', t.zone,
    'seats_left', r.r_seats,
    'degree', r.r_degree,
    'fit', public.degree_label(r.r_degree),
    'reasons', to_jsonb(v_reasons));
end;
$$;

-- What the "Interest check" email and its page carry: the group without a leader. Null when the group is archived or the member is no longer on it.
create function public.desk_interest_params(p_group uuid, p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'interest',
    'first', public.first_name_of(p_person),
    'community', (select c.name from public.communities c where c.id = g.community_id),
    'goal', (select sg.title from public.season_goals sg where sg.id = g.season_goal_id),
    'slot', g.slot,
    'mode', g.meeting_mode,
    'zone', g.zone,
    'capacity', g.capacity,
    'hours', (select s.interest_hours from public.desk_settings s where s.id))
    from public.desk_groups g
   where g.id = p_group and g.status = 'draft'
     and exists (select 1 from public.desk_group_members m where m.group_id = g.id and m.person_id = p_person);
$$;

create function public.desk_link_mint(p_proposal uuid, p_person uuid, p_days integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.desk_links (token_hash, proposal_id, person_id, expires_at)
  values (encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'), p_proposal, p_person, now() + make_interval(days => greatest(p_days, 1)));
  return v_raw;
end;
$$;

-- The proposal a private link belongs to, or null when the link is not one of ours or has run out.
create function public.desk_link_proposal(p_link text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select k.proposal_id from public.desk_links k
   where p_link ~ '^[a-f0-9]{64}$' and k.token_hash = encode(sha256(convert_to(p_link, 'UTF8')), 'hex') and k.expires_at > now();
$$;

-- Writes down one email (Rehearsal) or makes it (On), after every rule has been checked by the caller. Returns the proposal's id and status.
create function public.desk_mail_send(p_kind text, p_person uuid, p_tribe uuid, p_group uuid, p_degree integer, p_params jsonb, p_actor uuid)
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

-- ---------------------------------------------------------------------------
-- The owner's side
-- ---------------------------------------------------------------------------
-- What the Sending card shows: how open the Desk is, the numbers, and today's count.
create function public.desk_send_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.desk_settings%rowtype;
begin
  perform public.desk_need();
  select * into s from public.desk_settings x where x.id;
  return jsonb_build_object(
    'mode', public.leader_desk_any(),
    'paused', coalesce((select m.paused from public.feature_master m where m.id), true),
    'daily_cap', s.daily_cap, 'gap_days', s.gap_days, 'season_cap', s.season_cap, 'interest_hours', s.interest_hours,
    'changed_at', s.changed_at,
    'sent_today', (select count(*)::integer from public.desk_proposals x where not x.rehearsal and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos()),
    'would_today', (select count(*)::integer from public.desk_proposals x where x.rehearsal and (x.created_at at time zone 'Africa/Lagos')::date = public.today_lagos()),
    'sending_hours', public.lagos_hour() between 9 and 18);
end;
$$;

-- The settings card. Every change needs a reason; it applies from the next email on.
create function public.desk_settings_set(p_daily integer, p_gap integer, p_season integer, p_hours integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.desk_need();
  if p_daily is null or p_daily not between 1 and 300 then
    raise exception 'Emails a day must be between 1 and 300' using errcode = '22023';
  end if;
  if p_gap is null or p_gap not between 1 and 60 then
    raise exception 'Days between one member''s emails must be between 1 and 60' using errcode = '22023';
  end if;
  if p_season is null or p_season not between 1 and 10 then
    raise exception 'Emails to one member in a season must be between 1 and 10' using errcode = '22023';
  end if;
  if p_hours is null or p_hours not between 12 and 240 then
    raise exception 'The interest check window must be between 12 and 240 hours' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 3 to 300 characters' using errcode = '22023';
  end if;
  update public.desk_settings
     set daily_cap = p_daily, gap_days = p_gap, season_cap = p_season, interest_hours = p_hours,
         reason = v_reason, changed_by = auth.uid(), changed_at = now()
   where id;
  perform public.write_event(auth.uid(), 'desk.settings', 'desk', 'settings',
    jsonb_build_object('daily_cap', p_daily, 'gap_days', p_gap, 'season_cap', p_season, 'interest_hours', p_hours));
  return public.desk_send_state();
end;
$$;

-- What "Email a proposed group" would send: the best tribe for this member and why it fits, so the owner sees it before pressing send. Sends nothing.
create function public.desk_propose_preview(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_tribe uuid;
  v_block text;
  v_state text := public.desk_mail_state(p_person);
begin
  perform public.desk_need();
  if v_season is null or not exists (select 1 from public.desk_waiting_base(v_season) w where w.person_id = p_person) then
    return jsonb_build_object('ok', false, 'code', 'not_waiting', 'text', public.desk_mail_words('not_waiting'));
  end if;
  v_block := coalesce(public.desk_mail_block(p_person), case when v_state not in ('on', 'rehearsal') then 'off' end, public.desk_mail_cap(p_person, v_state = 'rehearsal'));
  if v_block is not null then
    return jsonb_build_object('ok', false, 'code', v_block, 'text', public.desk_mail_words(v_block));
  end if;
  v_tribe := public.desk_tribe_pick(p_person);
  if v_tribe is null then
    return jsonb_build_object('ok', false, 'code', 'no_tribe', 'text', 'No open tribe fits that member well enough to propose.');
  end if;
  return jsonb_build_object('ok', true, 'tribe_id', v_tribe, 'mode', v_state, 'params', public.desk_tribe_params(p_person, v_tribe));
end;
$$;

-- Emails one waiting member one open tribe. p_tribe null: the best one. In Rehearsal it is only written down.
create function public.desk_propose_tribe(p_person uuid, p_tribe uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.placement_season();
  v_state text;
  v_block text;
  v_tribe uuid := p_tribe;
  v_params jsonb;
  v_res jsonb;
begin
  perform public.desk_need();
  if v_season is null or not exists (select 1 from public.desk_waiting_base(v_season) w where w.person_id = p_person) then
    raise exception '%', public.desk_mail_words('not_waiting') using errcode = '22023';
  end if;
  v_state := public.desk_mail_state(p_person);
  if v_state not in ('on', 'rehearsal') then
    raise exception '%', public.desk_mail_words('off') using errcode = '22023';
  end if;
  v_block := public.desk_mail_block(p_person);
  if v_block is not null then
    raise exception '%', public.desk_mail_words(v_block) using errcode = '22023';
  end if;
  v_block := public.desk_mail_cap(p_person, v_state = 'rehearsal');
  if v_block is not null then
    raise exception '%', public.desk_mail_words(v_block) using errcode = '22023';
  end if;
  if v_tribe is null then
    v_tribe := public.desk_tribe_pick(p_person);
  end if;
  if v_tribe is null then
    raise exception 'No open tribe fits that member well enough to propose' using errcode = '22023';
  end if;
  v_params := public.desk_tribe_params(p_person, v_tribe);
  if v_params is null or (v_params ->> 'degree')::integer < public.placement_floor() then
    raise exception 'That tribe is not one the matching would show this member' using errcode = '22023';
  end if;
  v_res := public.desk_mail_send('tribe', p_person, v_tribe, null, (v_params ->> 'degree')::integer, v_params, auth.uid());
  return v_res || jsonb_build_object('tribe', v_params ->> 'tribe', 'degree', (v_params ->> 'degree')::integer);
end;
$$;

-- Asks the members of a draft group whether they are interested. Members who are already asked, no longer waiting, no longer fit the group, or cannot be written
-- to are left out and counted by reason. In Rehearsal it is only written down.
create function public.desk_interest_check(p_group uuid)
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

-- Who in a draft has said what: the members still on it (asked, said yes, no answer in time) and the people who left it by answering.
create function public.desk_group_interest(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.desk_need();
  if not exists (select 1 from public.desk_groups x where x.id = p_group) then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', m.person_id, 'state', coalesce(
               (select case when x.status = 'answered' then x.answer when x.status = 'would_send' then 'would_ask' else x.status end
                  from public.desk_proposals x where x.group_id = p_group and x.person_id = m.person_id and x.status <> 'cancelled'
                 order by x.created_at desc limit 1), 'none')) order by m.added_at, m.person_id)
        from public.desk_group_members m where m.group_id = p_group), '[]'::jsonb),
    'left', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', x.person_id, 'name', public.person_display_name(x.person_id), 'answer', x.answer, 'slots', to_jsonb(x.slots))
                       order by x.answered_at desc)
        from public.desk_proposals x
       where x.group_id = p_group and x.status = 'answered' and x.answer in ('no', 'other_time')
         and not exists (select 1 from public.desk_group_members m where m.group_id = p_group and m.person_id = x.person_id)), '[]'::jsonb));
end;
$$;

-- The list of what was sent (or would have been), newest first, with counts. A name, never a number.
create function public.desk_proposals_list(p_kind text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  perform public.desk_need();
  if v_kind is not null and v_kind not in ('tribe', 'interest') then
    raise exception 'That is not a kind of email the Desk sends' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'total', (select count(*)::integer from public.desk_proposals x where v_kind is null or x.kind = v_kind),
    'counts', jsonb_build_object(
      'sent', (select count(*)::integer from public.desk_proposals x where x.status = 'sent'),
      'would_send', (select count(*)::integer from public.desk_proposals x where x.status = 'would_send'),
      'yes', (select count(*)::integer from public.desk_proposals x where x.answer = 'yes'),
      'no', (select count(*)::integer from public.desk_proposals x where x.answer = 'no'),
      'other_time', (select count(*)::integer from public.desk_proposals x where x.answer = 'other_time'),
      'stop', (select count(*)::integer from public.desk_proposals x where x.answer = 'stop'),
      'expired', (select count(*)::integer from public.desk_proposals x where x.status = 'expired')),
    'rows', coalesce((
      select jsonb_agg(j.o order by j.at desc, j.id)
        from (
          select x.created_at as at, x.id,
                 jsonb_build_object(
                   'id', x.id, 'kind', x.kind, 'person_id', x.person_id, 'name', public.person_display_name(x.person_id),
                   'target', case x.kind when 'tribe' then (select t.name from public.tribes t where t.id = x.tribe_id)
                                         else (select g.name from public.desk_groups g where g.id = x.group_id) end,
                   'status', x.status, 'answer', x.answer, 'slots', to_jsonb(x.slots), 'rehearsal', x.rehearsal, 'degree', x.degree,
                   'at', x.created_at, 'expires_at', x.expires_at, 'answered_at', x.answered_at) as o
            from public.desk_proposals x
           where v_kind is null or x.kind = v_kind
           order by x.created_at desc, x.id
           limit v_limit offset v_offset) j), '[]'::jsonb));
end;
$$;

-- Withdraws an email that has not been answered. One still waiting in the queue is not sent; one already sent has its page closed.
create function public.desk_proposal_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.desk_proposals%rowtype;
begin
  perform public.desk_need();
  select * into x from public.desk_proposals y where y.id = p_id for update;
  if not found then
    raise exception 'No such email' using errcode = 'P0002';
  end if;
  if x.status not in ('sent', 'would_send') then
    raise exception 'That email has already been answered or has run out' using errcode = '22023';
  end if;
  update public.desk_proposals set status = 'cancelled' where id = p_id;
  delete from public.desk_links where proposal_id = p_id;
  if x.message_id is not null then
    update public.messages set status = 'skipped', error = 'Withdrawn by the owner', reply_token = null where id = x.message_id and status = 'queued';
  end if;
  perform public.write_event(auth.uid(), 'desk.cancelled', 'person', x.person_id::text, jsonb_build_object('kind', x.kind));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The member's side: the private page, with no sign-in. Each call needs the sending token and the link's secret.
-- ---------------------------------------------------------------------------
-- What the page shows. Opening the page saves nothing except that the link was opened.
create function public.worker_desk_info(p_token text, p_link text)
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

-- One answer from the page:
--   yes         (interest check) counted on the draft
--   no          (either) takes the member off the draft; they stay waiting
--   other_time  (interest check) the same, and the meeting times they would rather have are kept for the owner
--   stop        ends every Desk email to this member; kept whatever the switch says and for as long as the link lives
create function public.worker_desk_answer(p_token text, p_link text, p_answer text, p_slots text[] default '{}')
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

-- The heartbeat's step: an email with no answer in time runs out (the member stays waiting and nobody is placed by silence), links that have run out are
-- forgotten, and a finished email's link is wiped from the message.
create function public.desk_tick()
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
$$;

create function public.worker_desk_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.worker_ok(p_token);
  return public.desk_tick();
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function
  public.desk_mail_state(uuid), public.desk_mail_block(uuid), public.desk_mail_cap(uuid, boolean), public.desk_mail_words(text), public.desk_send_at(),
  public.desk_tribe_pick(uuid), public.desk_tribe_params(uuid, uuid), public.desk_interest_params(uuid, uuid), public.desk_link_mint(uuid, uuid, integer),
  public.desk_link_proposal(text), public.desk_mail_send(text, uuid, uuid, uuid, integer, jsonb, uuid), public.desk_tick()
  from public, anon, authenticated;

revoke all on function
  public.desk_send_state(), public.desk_settings_set(integer, integer, integer, integer, text), public.desk_propose_preview(uuid),
  public.desk_propose_tribe(uuid, uuid), public.desk_interest_check(uuid), public.desk_group_interest(uuid),
  public.desk_proposals_list(text, integer, integer), public.desk_proposal_cancel(uuid)
  from public, anon;
grant execute on function
  public.desk_send_state(), public.desk_settings_set(integer, integer, integer, integer, text), public.desk_propose_preview(uuid),
  public.desk_propose_tribe(uuid, uuid), public.desk_interest_check(uuid), public.desk_group_interest(uuid),
  public.desk_proposals_list(text, integer, integer), public.desk_proposal_cancel(uuid)
  to authenticated;

-- The private page and the heartbeat reach the database with the sending token: each checks it first.
revoke all on function public.worker_desk_info(text, text), public.worker_desk_answer(text, text, text, text[]), public.worker_desk_tick(text) from public, anon, authenticated;
grant execute on function public.worker_desk_info(text, text), public.worker_desk_answer(text, text, text, text[]), public.worker_desk_tick(text) to anon;

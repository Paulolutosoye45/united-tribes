-- =============================================================================
-- United Tribes: the sign-in prompt
--
-- The problem: some members never see the emails. Email is one road to a person; this adds a second road they walk every time they sign in. A person who owes the
-- church an answer (say yes to the tribe they were placed in, add a WhatsApp number, answer an offer to lead a group, book an interview time) sees one screen on top of
-- the page they asked for, with the first thing they owe and the button that does it. It applies to members, prospective leaders and certified leaders alike.
--
-- What this adds (all new; nothing that exists is replaced):
--
--   The switch        "Sign-in prompt" on the Switchboard, Off to begin with. Rehearsal counts who would see which task and shows nobody anything. On can be set for the
--                     whole church or narrowed to one centre, community, tribe or person, as every switch can. The Master pause stops it.
--   The list          my_prompt_queue(), the one function the page layout asks. The rule for "what does this person owe" lives here, once. Each kind of task is a small
--                     internal function that reads the SAME state the email link and the boards read, so the screen can never disagree with them. A task ends the
--                     moment the real answer is recorded, by email, on the screen, or by phone with the office.
--   The visit         A visit is a fresh sign-in, or the first page after the person has been away for 4 hours (set by the owner). The database remembers it (not a browser
--                     cookie: a page cannot set one while it is being drawn, and this also works across a person's devices). At the start of a visit it picks at most three tasks,
--                     most important first. "Not now" closes a task for the rest of the visit only; it comes back at the next one.
--   The answers       prompt_placement_answer ("Not this season" and "Call me" for a signed-in person, using the very same steps as the private link page),
--                     prompt_save_number, prompt_whatsapp_answer, and prompt_log_set (what happened). "Yes, I'm in", an offer to lead and booking an interview time use
--                     the functions the site already has (placement_my_confirm, leader_offer_respond, book_interview_slot).
--   The log           prompt_log holds the kind of task and what happened (shown, would have shown, answered, not now, opened), for 90 days. Never a number, an address
--                     or the words of an answer.
--   The office        prompt_overview() for the Placed members board; god_prompt_settings() and its setter for the owner (each change with a reason).
--
-- Tasks in this release (rung: what is lost if it waits; 1 is a running clock):
--   1 placement     a member the church placed who has not answered           (Yes / Not this season / Call me)
--   1 interview     a prospective leader invited to book a time               (the open times, one tap)
--   1 leader_offer  a leader with an offer to lead a group (leader board)     (Accept / Decline)
--   2 guardian      a member under 18 whose parent or guardian has not said yes (opens their page)
--   2 ai_consent    a prospective leader asked to agree to the first check    (opens the application)
--   3 number        an adult member or leader with no usable WhatsApp number  (the number box, saved in place)
--   3 whatsapp      an adult with a number and no WhatsApp answer             (Yes / No thanks)
--   4 joining_form  a member with the joining form started and not sent       (opens it)
--   4 application   a prospective leader with the application in draft       (opens it)
--   4 tribe_card    a leader whose Tribe Card is not yet sent                 (opens it)
--   5 care          a leader or care lead with care tasks due                 (opens them)
-- Not in this release, because they have no safe single answer to record yet: the details check, training lessons, the weekly update.
--
-- Safety rules, kept here and not on the screen:
--   * a person under 18 is never asked for a number or WhatsApp; only the guardian task applies to them (and "Yes, I'm in" for a seat)
--   * nobody with a deletion request open is asked anything; a hidden account and the platform owner are never prompted
--   * a recorded "No" to WhatsApp ends that task for good; the WhatsApp yes is its own choice and is never ticked for anyone
--   * "Not now" is refused for a placement only in the last hours before its seat is released (6 by default), so nobody is pushed into a yes: the three answers stay
--   * the email series, the seat clock and the autopilot are not touched: an answer given here is recorded by the same function, so their own triggers end their emails
--
-- Adds four tables, one line on the Switchboard and 17 functions. Replaces nothing. Run it as the database owner, after the Leader Desk extras (20270125000100).
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.placement_do_confirm(uuid, text)') is null or to_regprocedure('public.placed_do_not_season(uuid)') is null
     or to_regprocedure('public.placed_is_waiting(uuid)') is null or to_regprocedure('public.placed_held_number(uuid)') is null then
    raise exception 'Automatic placement and the placed answers (20261226000100, 20270113000100, 20270114000100) must be applied first';
  end if;
  if to_regprocedure('public.reach_apply_number(uuid, text, boolean, boolean)') is null or to_regprocedure('public.reach_number_kind(uuid)') is null
     or to_regprocedure('public.reach_close_if_fixed(uuid, integer)') is null then
    raise exception 'The reach series (20270111000100) must be applied first';
  end if;
  if to_regprocedure('public.book_interview_slot(uuid)') is null or to_regprocedure('public.leader_offer_respond(uuid, boolean)') is null
     or to_regprocedure('public.my_leader_offers()') is null then
    raise exception 'The leaders and the leader board (20261020000100, 20261223000100) must be applied first';
  end if;
  if to_regprocedure('public.feature_state_of(text, uuid, integer)') is null or to_regprocedure('public.is_god()') is null
     or to_regprocedure('public.placed_board_role()') is null then
    raise exception 'The Switchboard and the Placed members board must be applied first';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- The switch
-- ---------------------------------------------------------------------------
insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only)
select 'sign_in_prompt', 'Sign-in prompt',
       'Opens a screen on top of the page whenever a person signs in (or comes back after four hours away) and owes the church something: say yes to the tribe they were placed in, add a WhatsApp number, answer an offer to lead a group, book an interview time. The first task comes first, with the button that does it; Not now closes it for that visit only, and it returns next time. At most three a visit. A person with nothing owed sees nothing, and an under-18 is never asked for a number. Rehearsal counts who would see which task and shows nobody anything. It is a second road to the same answers: the emails stay as they are.',
       8, '{}', array['off', 'rehearsal', 'on'], 'off', true, coalesce(max(f.sort), 0) + 1, false
  from public.feature_registry f;

-- ---------------------------------------------------------------------------
-- The numbers, the visit, the log
-- ---------------------------------------------------------------------------
create table public.prompt_settings (
  id boolean primary key default true check (id),
  -- Hours away that make the next page a new visit
  visit_hours integer not null default 4 check (visit_hours between 1 and 48),
  -- Tasks shown in one visit; the rest wait for the next
  max_tasks integer not null default 3 check (max_tasks between 1 and 5),
  -- No "Not now" for a placement in the last hours before its seat is released
  last_hours integer not null default 6 check (last_hours between 0 and 48),
  -- "Not now" in a row on one task before the office is told the person may be worth a call
  worth_call_after integer not null default 5 check (worth_call_after between 3 and 20),
  -- Kinds of task turned off on their own
  kinds_off text[] not null default '{}',
  changed_by uuid references public.people (id) on delete set null,
  changed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.prompt_settings (id) values (true);

create table public.prompt_visits (
  person_id uuid primary key references public.people (id) on delete cascade,
  -- The sign-in this visit began with (the token's session), so a new sign-in is a new visit
  session_key text not null,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  -- The tasks chosen when the visit began, in order, and the ones the person closed with "Not now" or "Open"
  picked text[] not null default '{}',
  dismissed text[] not null default '{}'
);

create table public.prompt_log (
  id bigserial primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('placement', 'interview', 'leader_offer', 'guardian', 'ai_consent', 'number', 'whatsapp', 'joining_form', 'application', 'tribe_card', 'care')),
  -- shown: the screen was drawn. would_show: the same in Rehearsal. answered. not_now. opened: they went to the page to do it.
  outcome text not null check (outcome in ('shown', 'would_show', 'answered', 'not_now', 'opened')),
  at timestamptz not null default now()
);
create index prompt_log_at_idx on public.prompt_log (at);
create index prompt_log_person_idx on public.prompt_log (person_id, kind, at desc);

create table public.prompt_streaks (
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null,
  not_nows integer not null default 0 check (not_nows >= 0),
  last_at timestamptz not null default now(),
  primary key (person_id, kind)
);

alter table public.prompt_settings enable row level security;
alter table public.prompt_visits enable row level security;
alter table public.prompt_log enable row level security;
alter table public.prompt_streaks enable row level security;
-- No grants: only the functions touch these tables.

-- ---------------------------------------------------------------------------
-- Small helpers (closed to every signed-in person)
-- ---------------------------------------------------------------------------
create function public.prompt_kinds()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['placement', 'interview', 'leader_offer', 'guardian', 'ai_consent', 'number', 'whatsapp', 'joining_form', 'application', 'tribe_card', 'care'];
$$;

-- The rung of a kind: what is lost if it waits (1 is a running clock).
create function public.prompt_rung(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'placement' then 1 when 'interview' then 1 when 'leader_offer' then 1
    when 'guardian' then 2 when 'ai_consent' then 2
    when 'number' then 3 when 'whatsapp' then 3
    when 'joining_form' then 4 when 'application' then 4 when 'tribe_card' then 4
    else 5 end;
$$;

-- Is this person never to be prompted? The platform owner (locked or unlocked), a hidden account, and anyone with a deletion request open.
create function public.prompt_never(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_person is null
      or coalesce((select p.hidden from public.people p where p.id = p_person), true)
      or exists (select 1 from public.platform_owner o where o.person_id = p_person)
      or coalesce(public.message_blocker(p_person), '') = 'deletion';
$$;

-- Is this person someone the church has on its books: a finished joining form, a seat, or a leader's role? Someone who has only just signed up is not asked for a
-- number before the joining form (which asks for it) has had its chance.
create function public.prompt_rostered(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
      or exists (select 1 from public.tribe_members tm where tm.person_id = p_person and tm.status = 'active')
      or exists (select 1 from public.person_roles r where r.person_id = p_person and r.role in ('leader', 'assistant_leader'));
$$;

-- The seat clock's deadline for a member's waiting seat, when the church is timing it for real; null otherwise.
create function public.prompt_seat_deadline(p_tm uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select c.deadline_at from public.seat_clocks c where c.tm_id = p_tm and c.state = 'running' and not c.rehearsal order by c.created_at desc limit 1;
$$;

-- May this person close the placement task with "Not now"? Not in the last hours before the seat is released.
create function public.prompt_can_skip(p_tm uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.prompt_seat_deadline(p_tm) - make_interval(hours => (select s.last_hours from public.prompt_settings s where s.id)) > now(), true);
$$;

-- A number shown only masked, so the screen never holds the whole of it.
create function public.prompt_mask(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_phone is null then null else left(p_phone, 4) || ' ••• ' || right(p_phone, 3) end;
$$;

-- ---------------------------------------------------------------------------
-- What one person owes, one kind at a time. Null when they do not owe it. Each reads the state the email link and the boards read.
-- ---------------------------------------------------------------------------
create function public.prompt_task(p_person uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tm public.tribe_members%rowtype;
  t public.tribes%rowtype;
  s public.seasons%rowtype;
  a public.leader_applications%rowtype;
  v_minor boolean := public.is_minor(p_person);
  v_blocker text := coalesce(public.message_blocker(p_person), '');
  v_json jsonb;
  v_n integer;
  v_state text;
  v_phone text;
begin
  if p_kind = 'placement' then
    select * into tm from public.tribe_members x
     where x.person_id = p_person and x.status = 'active' and x.placement_source = 'auto' and x.confirmed_at is null order by x.joined_at desc limit 1;
    if not found or not public.placed_is_waiting(tm.id) then
      return null;
    end if;
    select * into t from public.tribes x where x.id = tm.tribe_id;
    select * into s from public.seasons x where x.id = tm.season_id;
    v_state := public.feature_state_of('placed_answers', p_person);
    return jsonb_build_object(
      'kind', 'placement', 'rung', 1, 'since', tm.joined_at,
      'tribe', t.name, 'leader_first', public.first_name_of(t.leader_id),
      'meeting_day', t.meeting_day, 'meeting_time', to_char(t.meeting_time, 'HH24:MI'), 'mode', t.meeting_mode,
      'season', s.name, 'starts_on', s.starts_on,
      'deadline_at', public.prompt_seat_deadline(tm.id),
      'can_skip', public.prompt_can_skip(tm.id),
      -- "Not this season" and "Call me" are offered only where the placed answers are On, and never to a young person (the private page does the same)
      'more_answers', v_state = 'on' and not v_minor and v_blocker not in ('under18', 'deletion'),
      'has_number', public.placed_held_number(p_person) is not null);

  elsif p_kind = 'interview' then
    select * into a from public.leader_applications x where x.person_id = p_person and x.status = 'interview_invited';
    if not found then
      return null;
    end if;
    select count(*) into v_n from public.interview_slots x where x.application_id is null and x.starts_at > now() + interval '24 hours';
    if v_n = 0 then
      return null;
    end if;
    return jsonb_build_object('kind', 'interview', 'rung', 1, 'since', a.updated_at, 'can_skip', true,
      'options', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'starts_at', x.starts_at, 'minutes', x.minutes, 'mode', x.mode) order by x.starts_at), '[]'::jsonb)
                    from (select * from public.interview_slots y where y.application_id is null and y.starts_at > now() + interval '24 hours' order by y.starts_at limit 6) x));

  elsif p_kind = 'leader_offer' then
    -- my_leader_offers() reads the signed-in person, which is who this is asked for
    if p_person is distinct from auth.uid() then
      return null;
    end if;
    v_json := public.my_leader_offers();
    if v_json is null then
      return null;
    end if;
    return jsonb_build_object('kind', 'leader_offer', 'rung', 1, 'since', v_json ->> 'offered_at', 'can_skip', true,
      'offer_id', v_json ->> 'offer_id', 'goal', v_json ->> 'goal', 'community', v_json ->> 'community', 'expires_at', v_json ->> 'expires_at');

  elsif p_kind = 'guardian' then
    if not v_minor or public.guardian_ready(p_person) then
      return null;
    end if;
    -- A request already sent is the young person's part done; they are asked again only if it was declined or withdrawn, or has sat for three days
    if exists (select 1 from public.guardian_consents g where g.person_id = p_person and g.status = 'requested' and g.requested_at > now() - interval '3 days') then
      return null;
    end if;
    if exists (select 1 from public.guardian_consents g where g.person_id = p_person and g.status = 'approved') then
      return null;
    end if;
    return jsonb_build_object('kind', 'guardian', 'rung', 2, 'since', now(), 'can_skip', true, 'href', '/tribe');

  elsif p_kind = 'ai_consent' then
    select * into a from public.leader_applications x
     where x.person_id = p_person and x.status in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed');
    if not found or not exists (select 1 from public.leader_ai_state z where z.application_id = a.id and z.state = 'consent_needed') then
      return null;
    end if;
    return jsonb_build_object('kind', 'ai_consent', 'rung', 2, 'since', a.updated_at, 'can_skip', true, 'href', '/lead');

  elsif p_kind = 'number' then
    -- Never to a young person, never without a joining form or a seat or a leader's role
    if v_minor or v_blocker in ('under18', 'deletion') or not public.prompt_rostered(p_person) then
      return null;
    end if;
    if public.reach_number_kind(p_person) is distinct from 'no_number' then
      return null;
    end if;
    return jsonb_build_object('kind', 'number', 'rung', 3, 'since', (select p.created_at from public.people p where p.id = p_person), 'can_skip', true,
      'signin_mask', public.prompt_mask(public.reach_signin_number(p_person)));

  elsif p_kind = 'whatsapp' then
    if v_minor or v_blocker in ('under18', 'deletion') or not public.prompt_rostered(p_person) then
      return null;
    end if;
    if public.reach_number_kind(p_person) is distinct from 'no_yes' then
      return null;
    end if;
    -- A recorded answer, yes or no, ends the question. A "No" is final.
    if exists (select 1 from public.consents c where c.person_id = p_person and c.purpose = 'whatsapp') then
      return null;
    end if;
    v_phone := public.placed_held_number(p_person);
    return jsonb_build_object('kind', 'whatsapp', 'rung', 3, 'since', (select p.created_at from public.people p where p.id = p_person), 'can_skip', true,
      'number_mask', public.prompt_mask(v_phone));

  elsif p_kind = 'joining_form' then
    if exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
       or not exists (select 1 from public.intake_drafts d where d.person_id = p_person) then
      return null;
    end if;
    return jsonb_build_object('kind', 'joining_form', 'rung', 4, 'since', (select d.updated_at from public.intake_drafts d where d.person_id = p_person), 'can_skip', true, 'href', '/join');

  elsif p_kind = 'application' then
    select * into a from public.leader_applications x where x.person_id = p_person and x.status = 'draft';
    if not found then
      return null;
    end if;
    return jsonb_build_object('kind', 'application', 'rung', 4, 'since', a.updated_at, 'can_skip', true, 'href', '/lead');

  elsif p_kind = 'tribe_card' then
    select x.* into t from public.tribes x join public.seasons se on se.id = x.season_id
     where x.leader_id = p_person and x.status::text in ('draft', 'changes_requested') and se.status <> 'closed'
     order by x.created_at desc limit 1;
    if not found then
      return null;
    end if;
    return jsonb_build_object('kind', 'tribe_card', 'rung', 4, 'since', t.created_at, 'can_skip', true, 'href', '/lead/tribe',
      'changes_asked', t.status::text = 'changes_requested');

  elsif p_kind = 'care' then
    select count(*) into v_n from public.care_tasks c where c.status = 'open' and c.assigned_to = p_person and c.due_on <= public.today_lagos();
    if v_n = 0 then
      return null;
    end if;
    return jsonb_build_object('kind', 'care', 'rung', 5, 'since', now(), 'can_skip', true, 'href', '/care', 'count', v_n);
  end if;
  return null;
end;
$$;

-- Everything a person owes right now, most important first (the rung, then the oldest), leaving out any kind the owner has turned off.
create function public.prompt_tasks_owed(p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by (x.j ->> 'rung')::integer, (x.j ->> 'since')::timestamptz nulls last), '[]'::jsonb)
    from (select public.prompt_task(p_person, k) as j
            from unnest(public.prompt_kinds()) k
           where not (k = any (coalesce((select s.kinds_off from public.prompt_settings s where s.id), '{}')))) x
   where x.j is not null;
$$;

-- ---------------------------------------------------------------------------
-- The list the page layout asks, once per page load
-- ---------------------------------------------------------------------------
-- Off: nothing. Rehearsal: records what would have been shown at the start of a visit and returns no tasks. On: the tasks picked for this visit that are still owed
-- and have not been closed with "Not now". The visit is remembered here, so a reload does not start another and does not lose the screen.
create function public.my_prompt_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.prompt_settings%rowtype;
  v public.prompt_visits%rowtype;
  v_state text;
  v_key text;
  v_owed jsonb;
  v_new boolean;
  v_picked text[];
  v_j jsonb;
  v_k text;
  v_out jsonb := '[]'::jsonb;
  v_total integer;
begin
  if me is null then
    return jsonb_build_object('state', 'off', 'tasks', '[]'::jsonb, 'total', 0);
  end if;
  v_state := public.feature_state_of('sign_in_prompt', me);
  if v_state = 'off' or public.prompt_never(me) then
    return jsonb_build_object('state', 'off', 'tasks', '[]'::jsonb, 'total', 0);
  end if;
  select * into s from public.prompt_settings x where x.id;
  v_key := coalesce(public.jwt_session()::text, 'none');
  select * into v from public.prompt_visits x where x.person_id = me for update;
  v_new := not found or v.session_key is distinct from v_key or v.seen_at < now() - make_interval(hours => s.visit_hours);

  if v_new then
    v_owed := public.prompt_tasks_owed(me);
    select coalesce(array_agg(e.k order by e.ord), '{}') into v_picked
      from (select (j ->> 'kind') as k, ord from jsonb_array_elements(v_owed) with ordinality as t(j, ord) where ord <= s.max_tasks) e;
    insert into public.prompt_visits (person_id, session_key, started_at, seen_at, picked, dismissed)
    values (me, v_key, now(), now(), v_picked, '{}')
    on conflict (person_id) do update set session_key = excluded.session_key, started_at = now(), seen_at = now(), picked = excluded.picked, dismissed = '{}';
    insert into public.prompt_log (person_id, kind, outcome) select me, k, case when v_state = 'on' then 'shown' else 'would_show' end from unnest(v_picked) k;
    v.picked := v_picked;
    v.dismissed := '{}';
  elsif v.seen_at < now() - interval '10 minutes' then
    update public.prompt_visits set seen_at = now() where person_id = me;
  end if;

  if v_state <> 'on' then
    return jsonb_build_object('state', v_state, 'tasks', '[]'::jsonb, 'total', coalesce(cardinality(v.picked), 0));
  end if;

  v_total := coalesce(cardinality(v.picked), 0);
  foreach v_k in array coalesce(v.picked, '{}') loop
    if v_k = any (v.dismissed) then
      continue;
    end if;
    v_j := public.prompt_task(me, v_k);
    if v_j is not null then
      v_out := v_out || jsonb_build_array(v_j);
    end if;
  end loop;
  return jsonb_build_object('state', 'on', 'tasks', v_out, 'total', v_total);
end;
$$;

-- Records what happened to a task: answered (the real answer was recorded), not_now (closed for this visit), opened (they went to the page to do it).
create function public.prompt_log_set(p_kind text, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.prompt_settings%rowtype;
  v public.prompt_visits%rowtype;
  v_tm uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind is null or not (p_kind = any (public.prompt_kinds())) or p_outcome is null or p_outcome not in ('answered', 'not_now', 'opened') then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into s from public.prompt_settings x where x.id;
  select * into v from public.prompt_visits x where x.person_id = me for update;
  if not found or not (p_kind = any (v.picked)) then
    return jsonb_build_object('ok', false, 'reason', 'no_visit');
  end if;
  -- No "Not now" in the last hours before a seat is released: the person still chooses among the answers
  if p_outcome = 'not_now' and p_kind = 'placement' then
    select x.id into v_tm from public.tribe_members x
     where x.person_id = me and x.status = 'active' and x.placement_source = 'auto' and x.confirmed_at is null order by x.joined_at desc limit 1;
    if v_tm is not null and not public.prompt_can_skip(v_tm) then
      return jsonb_build_object('ok', false, 'reason', 'no_skip');
    end if;
  end if;
  if not (p_kind = any (v.dismissed)) then
    update public.prompt_visits set dismissed = array_append(dismissed, p_kind) where person_id = me;
  end if;
  insert into public.prompt_log (person_id, kind, outcome) values (me, p_kind, p_outcome);
  if p_outcome = 'not_now' then
    insert into public.prompt_streaks (person_id, kind, not_nows, last_at) values (me, p_kind, 1, now())
    on conflict (person_id, kind) do update set not_nows = public.prompt_streaks.not_nows + 1, last_at = now();
  elsif p_outcome = 'answered' then
    delete from public.prompt_streaks where person_id = me and kind = p_kind;
  end if;
  -- Ninety days and no longer, trimmed a little at a time
  delete from public.prompt_log where id in (select l.id from public.prompt_log l where l.at < now() - interval '90 days' limit 200);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The answers the site did not yet have for a signed-in person
-- ---------------------------------------------------------------------------
-- "Not this season" and "Call me", the very same steps as the private page (worker_placed_answer): the same switch, the same blocks, the same recording, so every board
-- and every email rule reads one state. A young person gets neither.
create function public.prompt_placement_answer(p_kind text, p_window text default null, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  tm public.tribe_members%rowtype;
  v_closed boolean;
  v_res jsonb;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('not_season', 'call')
     or (p_window is not null and p_window not in ('morning', 'afternoon', 'evening')) then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  select * into tm from public.tribe_members x
   where x.person_id = me and x.status = 'active' and x.placement_source = 'auto' order by x.joined_at desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  select * into tm from public.tribe_members x where x.id = tm.id for update;
  if public.is_minor(me) or coalesce(public.message_blocker(me), '') in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if not public.placed_is_waiting(tm.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  if public.feature_state_of('placed_answers', me) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  v_closed := now() >= public.placed_deadline_at(tm.season_id);

  if p_kind = 'not_season' then
    v_res := public.placed_do_not_season(tm.id);
    if (v_res ->> 'ok')::boolean is not true then
      return v_res;
    end if;
    insert into public.placed_answers (tm_id, person_id, kind, reason) values (tm.id, me, 'not_this_season', null);
    return jsonb_build_object('ok', true, 'kind', 'not_season');
  end if;

  if public.placed_call_pending(tm.id) then
    return jsonb_build_object('ok', true, 'kind', 'call', 'again', true);
  end if;
  -- A number for the call: the one typed, else the one we hold. A number that does not look right stops the request, and nothing is saved.
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    perform public.reach_apply_number(me, p_phone, false, false);
  elsif public.placed_held_number(me) is null then
    raise exception 'Write your number with its country code, like +2348031234567' using errcode = '22023';
  end if;
  insert into public.placed_answers (tm_id, person_id, kind, window_pref, topic)
  values (tm.id, me, 'call_me', p_window, case when v_closed then 'other_tribe' else 'place' end);
  perform public.write_event(me, 'placed_answers.call_me', 'tribe', tm.tribe_id::text, jsonb_build_object('window', p_window));
  return jsonb_build_object('ok', true, 'kind', 'call', 'window', p_window);
end;
$$;

-- Saves a WhatsApp number for the signed-in person (typed, or the one they sign in with), and, only if they tick it, the yes to WhatsApp. It is the function the reach page
-- uses, so the series that writes to people with no number ends the moment this is fixed.
create function public.prompt_save_number(p_phone text, p_use_signin boolean, p_whatsapp boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_res jsonb;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_minor(me) or coalesce(public.message_blocker(me), '') in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if public.reach_number_kind(me) is distinct from 'no_number' then
    return jsonb_build_object('ok', true, 'again', true);
  end if;
  v_res := public.reach_apply_number(me, p_phone, coalesce(p_whatsapp, false), coalesce(p_use_signin, false));
  perform public.reach_close_if_fixed(me, null);
  return jsonb_build_object('ok', true, 'kind', v_res ->> 'kind');
end;
$$;

-- Yes or No to WhatsApp for a person who has a number. Yes is recorded the way the reach page records it; No is recorded in the same ledger and is final.
create function public.prompt_whatsapp_answer(p_yes boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_yes is null then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  if public.is_minor(me) or coalesce(public.message_blocker(me), '') in ('under18', 'deletion') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if public.reach_number_kind(me) is distinct from 'no_yes' or exists (select 1 from public.consents c where c.person_id = me and c.purpose = 'whatsapp') then
    return jsonb_build_object('ok', true, 'again', true);
  end if;
  if p_yes then
    perform public.reach_apply_number(me, public.placed_held_number(me), true, false);
    perform public.reach_close_if_fixed(me, null);
  else
    insert into public.consents (person_id, purpose, granted, version) values (me, 'whatsapp', false, 'prompt-v1');
    update public.contact_preferences set preferred = 'email' where person_id = me and preferred = 'whatsapp';
    update public.member_profiles set whatsapp = null where person_id = me;
    perform public.write_event(me, 'prompt.whatsapp_no', 'person', me::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'yes', p_yes);
end;
$$;

-- ---------------------------------------------------------------------------
-- The office: how it is going (counts only)
-- ---------------------------------------------------------------------------
-- Admin, director and pastor read it, as they read the Placed members board. No names, no numbers, no text.
create function public.prompt_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.prompt_settings%rowtype;
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_state text;
begin
  if public.placed_board_role() is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select * into s from public.prompt_settings x where x.id;
  v_state := case
    when coalesce((select m.paused from public.feature_master m where m.id), true) then 'off'
    when exists (select 1 from public.feature_settings f where f.feature = 'sign_in_prompt' and f.position = 'on') then 'on'
    when exists (select 1 from public.feature_settings f where f.feature = 'sign_in_prompt' and f.position = 'rehearsal') then 'rehearsal'
    else 'off' end;
  return jsonb_build_object(
    'state', v_state, 'days', v_days, 'visit_hours', s.visit_hours, 'max_tasks', s.max_tasks, 'last_hours', s.last_hours, 'worth_call_after', s.worth_call_after,
    'kinds_off', to_jsonb(s.kinds_off),
    'people_seen', (select count(distinct l.person_id) from public.prompt_log l where l.outcome = 'shown' and l.at > now() - make_interval(days => v_days)),
    'people_would', (select count(distinct l.person_id) from public.prompt_log l where l.outcome = 'would_show' and l.at > now() - make_interval(days => v_days)),
    'worth_a_call', (select count(*) from public.prompt_streaks z where z.not_nows >= s.worth_call_after),
    'kinds', coalesce((
      select jsonb_agg(jsonb_build_object('kind', k.kind,
               'shown', coalesce(c.shown, 0), 'would_show', coalesce(c.would_show, 0), 'answered', coalesce(c.answered, 0),
               'not_now', coalesce(c.not_now, 0), 'opened', coalesce(c.opened, 0), 'people', coalesce(c.people, 0)) order by public.prompt_rung(k.kind), k.kind)
        from (select unnest(public.prompt_kinds()) as kind) k
        left join (select l.kind,
                          count(*) filter (where l.outcome = 'shown') as shown, count(*) filter (where l.outcome = 'would_show') as would_show,
                          count(*) filter (where l.outcome = 'answered') as answered, count(*) filter (where l.outcome = 'not_now') as not_now,
                          count(*) filter (where l.outcome = 'opened') as opened, count(distinct l.person_id) as people
                     from public.prompt_log l where l.at > now() - make_interval(days => v_days) group by l.kind) c on c.kind = k.kind), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's settings
-- ---------------------------------------------------------------------------
create function public.god_prompt_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.prompt_settings%rowtype;
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  select * into s from public.prompt_settings x where x.id;
  return jsonb_build_object('visit_hours', s.visit_hours, 'max_tasks', s.max_tasks, 'last_hours', s.last_hours, 'worth_call_after', s.worth_call_after,
    'kinds_off', to_jsonb(s.kinds_off), 'kinds', to_jsonb(public.prompt_kinds()), 'changed_at', s.changed_at);
end;
$$;

create function public.god_prompt_settings_set(p_visit_hours integer, p_max_tasks integer, p_last_hours integer, p_worth integer, p_kinds_off text[], p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_off text[] := coalesce(p_kinds_off, '{}');
  k text;
begin
  if not public.is_god() then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'Say why you are changing this, in 5 to 300 characters' using errcode = '22023';
  end if;
  if p_visit_hours not between 1 and 48 or p_max_tasks not between 1 and 5 or p_last_hours not between 0 and 48 or p_worth not between 3 and 20 then
    raise exception 'One of the numbers is outside its range' using errcode = '22023';
  end if;
  foreach k in array v_off loop
    if not (k = any (public.prompt_kinds())) then
      raise exception 'That kind of task is not one of ours' using errcode = '22023';
    end if;
  end loop;
  update public.prompt_settings
     set visit_hours = p_visit_hours, max_tasks = p_max_tasks, last_hours = p_last_hours, worth_call_after = p_worth,
         kinds_off = (select coalesce(array_agg(distinct e order by e), '{}') from unnest(v_off) e),
         changed_by = auth.uid(), changed_at = now(), updated_at = now()
   where id;
  perform public.write_event(auth.uid(), 'sign_in_prompt.settings', 'sign_in_prompt', 'settings',
    jsonb_build_object('visit_hours', p_visit_hours, 'max_tasks', p_max_tasks, 'last_hours', p_last_hours, 'worth', p_worth, 'kinds_off', v_off, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.prompt_kinds(), public.prompt_rung(text), public.prompt_never(uuid), public.prompt_rostered(uuid), public.prompt_seat_deadline(uuid), public.prompt_can_skip(uuid),
  public.prompt_mask(text), public.prompt_task(uuid, text), public.prompt_tasks_owed(uuid)
  from public, anon, authenticated;

revoke execute on function
  public.my_prompt_queue(), public.prompt_log_set(text, text), public.prompt_placement_answer(text, text, text), public.prompt_save_number(text, boolean, boolean),
  public.prompt_whatsapp_answer(boolean), public.prompt_overview(integer), public.god_prompt_settings(), public.god_prompt_settings_set(integer, integer, integer, integer, text[], text)
  from public, anon;
grant execute on function
  public.my_prompt_queue(), public.prompt_log_set(text, text), public.prompt_placement_answer(text, text, text), public.prompt_save_number(text, boolean, boolean),
  public.prompt_whatsapp_answer(boolean), public.prompt_overview(integer), public.god_prompt_settings(), public.god_prompt_settings_set(integer, integer, integer, integer, text[], text)
  to authenticated;

-- =============================================================================
-- United Tribes: Contact gaps (find the members a leader cannot reach on WhatsApp, ask them, and let every member choose how they are reached)
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), "Contact gaps", which starts Off. It is for the whole
-- church only. Rehearsal shows the office list and the counts and sends nothing. On adds the rest:
--
--   The cause     a leader sees a member's number only if a number is saved AND the member has said yes to WhatsApp AND their contact is open. The
--                 database now says which of these is missing, for every adult in a current tribe: no number, a number that looks made up, a number
--                 but no WhatsApp yes, no way to be reached at all, "Don't share", or contact not open yet.
--   The list      the office (admin, a director, the data lead; the pastor and care lead may look) sees the counts by cause and the people. Never a
--                 number. A daily count is kept for a trend line. The download carries names, tribe, leader, cause and how often they were asked.
--   The audience  Announcements gains "Cannot be reached on WhatsApp" (no number, or a number but no WhatsApp yes, or both), with the usual left-out
--                 rules, and nobody is asked more than once in 14 days or more than three times. A person who has put it right before the email is
--                 released is skipped.
--   The ask       a leader can ask one person by email, signed with their first name (not more than 20 a day). The leader is told only that there is
--                 no number to show, never why.
--   The member    a prompt on Home, My page and Profile for a member with a gap, "Not now" putting it away for a week, and the number they sign in
--                 with offered back to them. Nothing is ticked for anyone: a yes is always the person's own.
--
-- Off: nothing here runs, the office page says the function is Off, and every other page behaves exactly as it did.
--
-- What it never does: it does not tick WhatsApp or save a number for anyone, change a member's channel choice, change what a leader is shown of a number,
-- or change the wording of any existing message. A teenager and a person whose deletion is open are never listed or asked.
--
-- Replaced, because they now know about the new audience (the old text of each is in the rollback file): audience_clean, audience_base, audience_members,
-- broadcasts_release.
-- Needs the number-required package (number_looks_made_up) and the placement-visibility package (placement_contact) in place first.
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('contact_gaps', 'Contact gaps', 'Finds the members a leader cannot reach on WhatsApp (no number, a number but no WhatsApp yes, a number that looks made up), says why, and lets the office ask them by email: an office list, two announcement audiences, a button for a leader to ask one person, and a prompt for the member. Rehearsal shows the list and the counts only and sends nothing. For the whole church only.', 8, array[]::text[], array['off', 'rehearsal', 'on'], 'off', true, 27, true);

-- ---------------------------------------------------------------------------
-- Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
-- Each time a leader asks one person to add their number. (An announcement's asks are read from the announcement's own recipients.)
create table public.contact_asks (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('no_number', 'no_yes')),
  by_person uuid references public.people (id) on delete set null,
  tribe_id uuid references public.tribes (id) on delete set null,
  created_at timestamptz not null default now()
);
create index contact_asks_person_idx on public.contact_asks (person_id, created_at desc);
create index contact_asks_by_idx on public.contact_asks (by_person, created_at desc);
alter table public.contact_asks enable row level security;
revoke all on table public.contact_asks from public, anon, authenticated;

-- Who has put the "how can we reach you" prompt away, and when. One row each.
create table public.reach_prompts (
  person_id uuid primary key references public.people (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  times smallint not null default 1
);
alter table public.reach_prompts enable row level security;
revoke all on table public.reach_prompts from public, anon, authenticated;

-- The counts by cause, once a day (the last time the list was opened that day), for the trend line.
create table public.contact_gap_days (
  day date primary key,
  counts jsonb not null,
  adults integer not null check (adults >= 0),
  made_at timestamptz not null default now()
);
alter table public.contact_gap_days enable row level security;
revoke all on table public.contact_gap_days from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The cause: why a leader cannot message this person on WhatsApp (internal)
-- ---------------------------------------------------------------------------
-- null means there is no gap (or the person is not one we ask: a teenager, or someone whose deletion is open).
--   withheld      they chose "Don't share" (never asked)
--   not_open      their contact is not open to the leader yet: holding, waiting or not reached (opens by itself; never asked)
--   unreachable   no number saved and no email we may use: only a person can ask them
--   no_number     no number saved
--   made_up       a number whose last seven digits are one digit repeated
--   no_yes        a number is saved, but they have not said yes to WhatsApp, so the leader is shown nothing
create function public.contact_gap_cause_of(p_person uuid, p_tm uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_state text;
  v_blocker text;
begin
  if public.is_minor(p_person) then
    return null;
  end if;
  v_blocker := public.message_blocker(p_person);
  if v_blocker in ('under18', 'deletion') then
    return null;
  end if;
  if coalesce((select tm.contact_withheld from public.tribe_members tm where tm.id = p_tm), false) then
    return 'withheld';
  end if;
  v_state := public.placement_contact(p_tm) ->> 'state';
  if v_state in ('holding', 'waiting', 'not_reached') then
    return 'not_open';
  end if;
  v_phone := coalesce((select cp.phone from public.contact_preferences cp where cp.person_id = p_person),
                      (select mp.whatsapp from public.member_profiles mp where mp.person_id = p_person));
  if v_phone is null then
    return case when v_blocker in ('email_off', 'bounced') then 'unreachable' else 'no_number' end;
  end if;
  if public.number_looks_made_up(v_phone) then
    return 'made_up';
  end if;
  if not public.consent_granted(p_person, 'whatsapp') then
    return 'no_yes';
  end if;
  return null;
end;
$$;

-- One row for each adult in a current tribe who has a cause. A person in more than one tribe is counted once, for their newest seat.
create function public.contact_gap_rows(p_centre uuid)
returns table (person_id uuid, tribe_id uuid, tm_id uuid, cause text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.person_id, s.tribe_id, s.id, s.cause
    from (select distinct on (cm.person_id) cm.person_id, cm.tribe_id, cm.id,
                 public.contact_gap_cause_of(cm.person_id, cm.id) as cause
            from public.tribe_members cm
            join public.tribes t on t.id = cm.tribe_id
            join public.seasons se on se.id = t.season_id
            join public.people p on p.id = cm.person_id
           where cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed' and p.centre_id = p_centre
           order by cm.person_id, cm.joined_at desc nulls last, cm.id) s
   where s.cause is not null;
$$;

-- The causes an announcement audience stands for. "no_number" includes the number that looks made up: the ask is the same, to add a working one.
create function public.contact_gap_causes(p_cause text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_cause, 'either')
           when 'no_number' then array['no_number', 'made_up']
           when 'no_yes' then array['no_yes']
           else array['no_number', 'made_up', 'no_yes'] end;
$$;

-- Is this person still in the gap an announcement meant (checked again just before it is released)?
create function public.contact_gap_still(p_person uuid, p_cause text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tribe_members cm
      join public.tribes t on t.id = cm.tribe_id
      join public.seasons se on se.id = t.season_id
     where cm.person_id = p_person and cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed'
       and public.contact_gap_cause_of(p_person, cm.id) = any (public.contact_gap_causes(p_cause)));
$$;

-- How often this person has been asked: by a leader, or by an announcement that was approved for them.
create function public.contact_ask_history(p_person uuid)
returns table (n integer, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, max(x.at)
    from (select a.created_at as at from public.contact_asks a where a.person_id = p_person
          union all
          select coalesce(r.released_at, b.approved_at, b.scheduled_for, now())
            from public.broadcast_recipients r
            join public.broadcasts b on b.id = r.broadcast_id
           where r.person_id = p_person and b.audience ->> 'kind' = 'cannot_reach'
             and r.status in ('pending', 'queued') and b.status in ('scheduled', 'sending', 'paused', 'sent')) x;
$$;

-- Nobody is asked more than once in 14 days, or more than three times in all.
create function public.contact_ask_blocker(p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when h.n >= 3 then 'asked_enough'
              when h.last_at is not null and h.last_at > now() - interval '14 days' then 'asked_recently' end
    from public.contact_ask_history(p_person) h;
$$;

-- ---------------------------------------------------------------------------
-- Who may look, and who may act
-- ---------------------------------------------------------------------------
-- act: the admin, a director and the data lead. look: the pastor and the care lead (they may read the list, not download it).
create function public.contact_gaps_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_any_role(array['admin', 'director', 'data_lead']::public.app_role[]) then 'act'
              when public.has_any_role(array['pastor', 'care_lead']::public.app_role[]) then 'look' end;
$$;

create function public.contact_gaps_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return public.feature_platform_state('contact_gaps');
end;
$$;

-- ---------------------------------------------------------------------------
-- The office list
-- ---------------------------------------------------------------------------
-- Counts by cause (always the whole church), the people on the page the filters leave, and the last 30 days of counts. Never a number.
create function public.contact_gaps_report(
  p_cause text default null, p_tribe uuid default null, p_community uuid default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := public.feature_platform_state('contact_gaps');
  v_role text := public.contact_gaps_role();
  v_centre uuid := public.my_centre();
  v_counts jsonb;
  v_adults integer;
  v_total integer;
  v_rows jsonb;
  v_trend jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'That page is not available' using errcode = '42501';
  end if;
  if v_state = 'off' then
    return jsonb_build_object('state', 'off', 'role', v_role);
  end if;
  if p_cause is not null and p_cause not in ('no_number', 'no_yes', 'made_up', 'unreachable', 'withheld', 'not_open') then
    raise exception 'Choose a cause from the list' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(c.cause, c.n), '{}'::jsonb) into v_counts
    from (select g.cause, count(*)::integer as n from public.contact_gap_rows(v_centre) g group by g.cause) c;
  select count(distinct cm.person_id)::integer into v_adults
    from public.tribe_members cm
    join public.tribes t on t.id = cm.tribe_id
    join public.seasons se on se.id = t.season_id
    join public.people p on p.id = cm.person_id
   where cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed' and p.centre_id = v_centre
     and not public.is_minor(cm.person_id)
     and coalesce(public.message_blocker(cm.person_id), '') not in ('under18', 'deletion');

  with g as materialized (select * from public.contact_gap_rows(v_centre)),
       f as (select g.* from g
              where (p_cause is null or g.cause = p_cause)
                and (p_tribe is null or g.tribe_id = p_tribe)
                and (p_community is null or exists (select 1 from public.member_profiles mp where mp.person_id = g.person_id and mp.community_id = p_community)))
  select (select count(*)::integer from f),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'person_id', y.person_id, 'name', y.name, 'tribe_id', y.tribe_id, 'tribe', y.tribe, 'leader', y.leader,
                     'cause', y.cause, 'asks', y.asks, 'last_asked', y.last_asked) order by y.rank, y.tribe, y.name)
                     from (select f.person_id, public.person_display_name(f.person_id) as name, f.tribe_id, t.name as tribe,
                                  public.first_name_of(t.leader_id) as leader, f.cause, h.n as asks, h.last_at as last_asked,
                                  case f.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4
                                               when 'not_open' then 5 else 6 end as rank
                             from f join public.tribes t on t.id = f.tribe_id
                            cross join lateral public.contact_ask_history(f.person_id) h
                            order by rank, tribe, name
                            limit v_limit offset v_offset) y), '[]'::jsonb)
    into v_total, v_rows;

  -- Today's counts, kept for the trend (the last time the list is opened in a day wins)
  insert into public.contact_gap_days (day, counts, adults) values (public.today_lagos(), v_counts, v_adults)
  on conflict (day) do update set counts = excluded.counts, adults = excluded.adults, made_at = now();
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'counts', d.counts, 'adults', d.adults) order by d.day), '[]'::jsonb) into v_trend
    from (select * from public.contact_gap_days order by day desc limit 30) d;

  if p_cause is null and p_tribe is null and p_community is null and v_offset = 0 then
    perform public.write_event(auth.uid(), 'contact_gaps.viewed', 'contact_gaps', null, jsonb_build_object('state', v_state));
  end if;
  return jsonb_build_object('state', v_state, 'role', v_role, 'counts', v_counts, 'adults', v_adults, 'total', v_total, 'rows', v_rows, 'trend', v_trend,
                            'limit', v_limit, 'offset', v_offset);
end;
$$;

-- The whole list for the download: names, tribe, leader, cause, how often asked and when. Never a number. Only the people who may act.
create function public.contact_gaps_export()
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
           'name', y.name, 'tribe', y.tribe, 'leader', y.leader, 'cause', y.cause, 'asks', y.asks, 'last_asked', y.last_asked)
           order by y.rank, y.tribe, y.name), '[]'::jsonb) into v_rows
    from (select public.person_display_name(g.person_id) as name, t.name as tribe, public.first_name_of(t.leader_id) as leader, g.cause,
                 h.n as asks, h.last_at as last_asked,
                 case g.cause when 'unreachable' then 1 when 'no_number' then 2 when 'no_yes' then 3 when 'made_up' then 4 when 'not_open' then 5 else 6 end as rank
            from public.contact_gap_rows(public.my_centre()) g
            join public.tribes t on t.id = g.tribe_id
           cross join lateral public.contact_ask_history(g.person_id) h) y;
  perform public.write_event(auth.uid(), 'contact_gaps.exported', 'contact_gaps', null, jsonb_build_object('rows', jsonb_array_length(v_rows)));
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- A leader asks one person
-- ---------------------------------------------------------------------------
-- The people of a tribe whose number the leader cannot see, by first name. It says what the leader can do, never why: whether someone has said
-- no to WhatsApp is theirs to say. A member who chose "Don't share" or whose contact is not open yet is not listed at all.
--   ask        the button
--   asked      asked in the last 14 days
--   in_person  cannot be emailed, or has been asked three times
create function public.tribe_reach_gaps(p_tribe uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') <> 'on' then
    return jsonb_build_object('on', false, 'people', '[]'::jsonb);
  end if;
  v := public.tribe_roster(p_tribe);
  return jsonb_build_object('on', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object(
             'person_id', z.pid, 'first_name', z.first_name, 'asked_at', z.last_at,
             'state', case when z.cause = 'unreachable' or z.blocker is not null and z.blocker not in ('asked_recently') then 'in_person'
                           when z.blocker = 'asked_recently' then 'asked'
                           else 'ask' end)
           order by z.first_name)
      from (select x.pid, public.first_name_of(x.pid) as first_name, k.cause, h.last_at,
                   coalesce(public.contact_ask_blocker(x.pid), public.message_blocker(x.pid)) as blocker
              from (select (e ->> 'person_id')::uuid as pid
                      from jsonb_array_elements(v -> 'members') e) x
              join lateral (select cm.id from public.tribe_members cm
                             where cm.person_id = x.pid and cm.tribe_id = p_tribe and cm.status = 'active' limit 1) s on true
              cross join lateral (select public.contact_gap_cause_of(x.pid, s.id) as cause) k
              cross join lateral public.contact_ask_history(x.pid) h
             where k.cause in ('no_number', 'made_up', 'no_yes', 'unreachable')) z), '[]'::jsonb));
end;
$$;

-- The leader's button: one polite email to one person, signed with the leader's first name. Not more than one in 14 days to the same person, not more
-- than three in all, not more than 20 a day from one leader. It never changes the person's choices.
create function public.contact_ask_send(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_tm uuid;
  v_tribe uuid;
  v_cause text;
  v_kind text;
  v_blocker text;
  v_id bigint;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') <> 'on' then
    raise exception 'Asking for a number is not switched on' using errcode = '22023';
  end if;
  select cm.id, cm.tribe_id into v_tm, v_tribe
    from public.tribe_members cm
    join public.tribes t on t.id = cm.tribe_id
    join public.seasons se on se.id = t.season_id
   where cm.person_id = p_person and cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed'
     and uid in (t.leader_id, t.assistant_id, t.coach_id)
   order by cm.joined_at desc nulls last, cm.id limit 1;
  if v_tm is null then
    raise exception 'You do not lead this person' using errcode = '42501';
  end if;
  v_cause := public.contact_gap_cause_of(p_person, v_tm);
  if v_cause = 'unreachable' then
    raise exception 'We cannot email them. Please ask them in person' using errcode = '22023';
  end if;
  if v_cause is null or v_cause not in ('no_number', 'made_up', 'no_yes') then
    raise exception 'There is nothing to ask this person for' using errcode = '22023';
  end if;
  v_kind := case when v_cause = 'no_yes' then 'no_yes' else 'no_number' end;
  v_blocker := coalesce(public.contact_ask_blocker(p_person), public.message_blocker(p_person));
  if v_blocker = 'asked_recently' then
    raise exception 'They were asked in the last two weeks. Please wait, or ask them in person' using errcode = '22023';
  elsif v_blocker = 'asked_enough' then
    raise exception 'They have been asked three times already. Please ask them in person' using errcode = '22023';
  elsif v_blocker is not null then
    raise exception 'We cannot email them. Please ask them in person' using errcode = '22023';
  end if;
  if (select count(*) from public.contact_asks a where a.by_person = uid and a.created_at > now() - interval '1 day') >= 20 then
    raise exception 'That is 20 requests today. Try again tomorrow' using errcode = '22023';
  end if;
  insert into public.contact_asks (person_id, kind, by_person, tribe_id) values (p_person, v_kind, uid, v_tribe) returning id into v_id;
  perform public.enqueue_message(p_person, 'contact_ask_leader',
    jsonb_build_object('leader_first', public.first_name_of(uid), 'kind', v_kind),
    v_tribe, 'contact-ask:' || v_id::text, null, 'normal', 'email');
  perform public.write_event(uid, 'contact.ask', 'person', p_person::text, jsonb_build_object('kind', v_kind, 'tribe', v_tribe));
  return jsonb_build_object('ok', true, 'kind', v_kind);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the member sees
-- ---------------------------------------------------------------------------
-- For the signed-in person. cause is one of no_number, made_up, no_yes, or null. The number they sign in with is returned only to them and only when they
-- have no usable number saved, so the form can offer it (they still press Save, and the yes is theirs to tick).
create function public.my_reach()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_tm uuid;
  v_cause text;
  v_sign text;
  v_dismissed timestamptz;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') <> 'on' then
    return jsonb_build_object('on', false, 'cause', null, 'prompt', false, 'signin', null);
  end if;
  select cm.id into v_tm
    from public.tribe_members cm
    join public.tribes t on t.id = cm.tribe_id
    join public.seasons se on se.id = t.season_id
   where cm.person_id = uid and cm.status = 'active' and t.status <> 'closed' and se.status <> 'closed'
   order by cm.joined_at desc nulls last, cm.id limit 1;
  if v_tm is not null then
    v_cause := public.contact_gap_cause_of(uid, v_tm);
  end if;
  if v_cause is null or v_cause not in ('no_number', 'made_up', 'no_yes') then
    return jsonb_build_object('on', true, 'cause', null, 'prompt', false, 'signin', null);
  end if;
  select d.dismissed_at into v_dismissed from public.reach_prompts d where d.person_id = uid;
  select regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') into v_sign from auth.users u where u.id = uid;
  return jsonb_build_object(
    'on', true, 'cause', v_cause,
    'prompt', v_dismissed is null or v_dismissed < now() - interval '7 days',
    'signin', case when v_cause in ('no_number', 'made_up') and length(coalesce(v_sign, '')) between 8 and 15 and not public.number_looks_made_up('+' || v_sign)
                   then '+' || v_sign else null end);
end;
$$;

-- "Not now": the prompt stays away for a week.
create function public.reach_prompt_dismiss()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_platform_state('contact_gaps') <> 'on' then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  insert into public.reach_prompts (person_id) values (uid)
  on conflict (person_id) do update set dismissed_at = now(), times = least(public.reach_prompts.times + 1, 1000);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The functions this package replaces (the old text of each is in the rollback file)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke execute on function
  public.contact_gap_cause_of(uuid, uuid),
  public.contact_gap_rows(uuid),
  public.contact_gap_causes(text),
  public.contact_gap_still(uuid, text),
  public.contact_ask_history(uuid),
  public.contact_ask_blocker(uuid),
  public.contact_gaps_role()
  from public, anon, authenticated;

revoke execute on function
  public.contact_gaps_state(),
  public.contact_gaps_report(text, uuid, uuid, integer, integer),
  public.contact_gaps_export(),
  public.tribe_reach_gaps(uuid),
  public.contact_ask_send(uuid),
  public.my_reach(),
  public.reach_prompt_dismiss()
  from public, anon;

grant execute on function
  public.contact_gaps_state(),
  public.contact_gaps_report(text, uuid, uuid, integer, integer),
  public.contact_gaps_export(),
  public.tribe_reach_gaps(uuid),
  public.contact_ask_send(uuid),
  public.my_reach(),
  public.reach_prompt_dismiss()
  to authenticated;

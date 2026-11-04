-- Way back from "Reach series and Tribe note" (Package 5 of seats and contacts).
--
-- Puts the four Contact gaps functions the package replaced back exactly as that package left them (contact_ask_history, contact_ask_send,
-- contact_gaps_report, contact_gaps_export), drops everything the package added, and removes the two Switchboard rows with any rules set on them.
-- WHAT THIS TAKES WITH IT: the record of who was put in the series and how each series ended, the private links, the leader's asks and every
-- tribe note. Copy them first if you want them:
--   select * from public.reach_enrolments; select * from public.reach_sends; select * from public.reach_leader_asks; select * from public.tribe_notes;
-- Emails of the series or of a tribe note that are still waiting to go are marked skipped here, so none leaves after the way back. Emails already sent,
-- every number, every WhatsApp yes and every seat are untouched. Put the application files back before this one: the pages call these functions.
-- Run it as the database owner. Running it twice changes nothing.
begin;

-- The Contact gaps functions below read a table that the Contact gaps way back drops later; run a second time, that table is already gone, so the
-- bodies are not checked as they are put back (the next way back drops them again)
set local check_function_bodies = off;

-- Nothing queued for the new emails goes out after this
update public.messages set status = 'skipped', error = 'rolled back', reply_token = null
 where status = 'queued' and template in ('reach_series', 'reach_new_link', 'tribe_note');

-- The functions that were replaced, as they stood
drop function if exists public.contact_gaps_report(text, uuid, uuid, integer, integer, text);

drop function if exists public.contact_gaps_report(text, uuid, uuid, integer, integer);
create or replace function public.contact_gaps_report(
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

create or replace function public.contact_ask_history(p_person uuid)
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

create or replace function public.contact_ask_send(p_person uuid)
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


revoke execute on function public.contact_gaps_report(text, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.contact_gaps_report(text, uuid, uuid, integer, integer) to authenticated;

-- What the package added
drop function if exists public.worker_placed_reach_save(text, text, text, boolean, boolean);
drop function if exists public.worker_placed_reach(text, text);
drop function if exists public.worker_reach_new_link(text, text);
drop function if exists public.worker_reach_email_instead(text, text);
drop function if exists public.worker_reach_save(text, text, text, boolean, boolean);
drop function if exists public.worker_reach_info(text, text);
drop function if exists public.worker_reach_tick(text);
drop function if exists public.god_reach_settings_set(integer, integer, text, integer, text);
drop function if exists public.god_reach_settings();
drop function if exists public.reach_series_stop(uuid, text);
drop function if exists public.reach_series_pause(boolean, text);
drop function if exists public.tribe_note_send(uuid, text);
drop function if exists public.reach_follow_up(uuid);
drop function if exists public.reach_ask_tribe(uuid, text);
drop function if exists public.tribe_reach(uuid);
drop function if exists public.reach_series_of(uuid, uuid);
drop function if exists public.reach_person_status(uuid, uuid, uuid);
drop function if exists public.reach_close_if_fixed(uuid, integer);
drop function if exists public.reach_apply_number(uuid, text, boolean, boolean);
drop function if exists public.reach_series_tick();
drop function if exists public.reach_step(uuid, boolean, text, uuid);
drop function if exists public.reach_send(uuid, integer, text, uuid);
drop function if exists public.reach_enrol_sweep(integer);
drop function if exists public.reach_had_series(uuid, uuid, boolean);
drop function if exists public.reach_enrol(uuid, boolean);
drop function if exists public.reach_end(uuid, text, uuid, text, integer);
drop function if exists public.reach_link_open(text);
drop function if exists public.reach_link_mint(uuid, uuid, uuid, text, integer);
drop function if exists public.reach_window_ok();
drop function if exists public.reach_state_of(uuid);
drop function if exists public.reach_block_of(uuid, uuid);
drop function if exists public.reach_gap_kind(uuid, uuid);
drop function if exists public.reach_number_kind(uuid);
drop function if exists public.reach_signin_number(uuid);
drop function if exists public.reach_mask(text);
drop function if exists public.reach_email_days(integer);

drop table if exists public.tribe_notes;
drop table if exists public.reach_leader_asks;
drop table if exists public.reach_links;
drop table if exists public.reach_sends;
drop table if exists public.reach_enrolments;
drop table if exists public.reach_settings;

delete from public.feature_settings where feature in ('reach_series', 'tribe_note');
delete from public.feature_registry where key in ('reach_series', 'tribe_note');

commit;

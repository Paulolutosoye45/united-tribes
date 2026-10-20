-- God Mode oversight: see what is happening for every stakeholder, and the conversations the platform has had.
--
-- The owner already opens every page, and the rule that decides what each role may see already says yes to the owner. What was missing
-- was one place to see, for each kind of person on the platform, how many there are, how active they are, and the numbers that person
-- would be looking at on their own dashboard; and a way to read the messages the platform sends and the chats the staff open.
--
-- Everything here is read-only and owner-only (`god_only()` first, so anyone else, and the owner while locked, is refused). There are two
-- limits that are decided here, in the database, not on the page:
--   * The platform has no store of free-text chat. A "conversation" is the outbox (what was sent, to whom, when, how it went), the
--     replies that come back as a button press or STOP, and the chats a staff member opened on WhatsApp (who opened one with whom and
--     when, never the words). This says so rather than pretending otherwise.
--   * The wording of care and safeguarding messages, a request for help, referee and guardian links, and anything sent to a young member
--     is not returned at all (who, when, which message and how it went are). Codes, links and tokens are taken out of every message.
-- Looking is written to the owner's own log, in plain words, and nowhere the office can read.

-- ---------------------------------------------------------------------------
-- The desks: how many, how active, and the numbers each stakeholder would be looking at
-- ---------------------------------------------------------------------------

create function public.god_desks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season uuid := public.leader_fit_season();
  v_demand record;
begin
  perform public.god_only();
  select coalesce(sum(d.waiting), 0)::integer as waiting, coalesce(sum(d.gap) filter (where d.gap > 0), 0)::integer as seats_needed
    into v_demand
    from public.goal_demand_rows(v_season) d;
  return jsonb_build_object(
    'now', now(),
    'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status) from public.seasons s where s.id = v_season),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'role', r.e::text,
               'people', (select count(distinct pr.person_id) from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden where pr.role = r.e),
               'active_7d', (select count(distinct pr.person_id) from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden
                              where pr.role = r.e
                                and exists (select 1 from public.event_log e where e.actor_id = pr.person_id and e.at > now() - interval '7 days')))
             order by r.ord)
        from (select t.e, t.ord from unnest(enum_range(null::public.app_role)) with ordinality as t(e, ord)) r), '[]'::jsonb),
    'counts', jsonb_build_object(
      'members_total', (select count(*) from public.people where not hidden),
      'members_seated', (select count(distinct m.person_id) from public.tribe_members m where m.status = 'active'),
      'members_waiting', v_demand.waiting,
      'tribes_live', (select count(*) from public.tribes where status = 'approved'),
      'tribes_to_review', (select count(*) from public.tribes where status = 'submitted'),
      'tribes_in_draft', (select count(*) from public.tribes where status in ('draft', 'changes_requested')),
      'tribes_without_coach', (select count(*) from public.tribes where status = 'approved' and coach_id is null),
      'leaders_without_tribe', (select count(*) from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden
                                 where pr.role = 'leader' and not exists (select 1 from public.tribes t where t.leader_id = pr.person_id and t.status <> 'closed')),
      'leader_seats_needed', v_demand.seats_needed,
      'leader_offers_open', (select count(*) from public.leader_offers f where f.status = 'offered' and f.expires_at > now()),
      'applications_in_review', (select count(*) from public.leader_applications where status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')),
      'cards_waiting_sign_off', (select count(*) from public.tribe_card_templates where status = 'draft'),
      'communities_without_champion', (select count(*) from public.communities c where c.active and not exists (select 1 from public.community_champions h where h.community_id = c.id)),
      'care_tasks_open', (select count(*) from public.care_tasks where status = 'open'),
      'care_flags_open', (select count(*) from public.care_flags where status in ('open', 'escalated')),
      'swaps_open', (select count(*) from public.swap_requests where status in ('requested', 'offered')),
      'seasons_live', (select count(*) from public.seasons where status in ('open', 'running')),
      'invitations_pending', (select count(*) from public.invitations where status = 'pending' and expires_at > now()),
      'erasure_open', (select count(*) from public.erasure_requests where status = 'open'),
      'messages_queued', (select count(*) from public.messages where status in ('queued', 'sending')),
      'messages_failed_7d', (select count(*) from public.messages where status = 'failed' and created_at > now() - interval '7 days'),
      'chat_opens_7d', (select count(*) from public.chat_opens where created_at > now() - interval '7 days')));
end;
$$;

-- The people holding one role, with how recently and how much they have done. A hidden account is never listed.
create function public.god_role_people(p_role text, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  perform public.god_only();
  begin
    v_role := p_role::public.app_role;
  exception when others then
    raise exception 'No such role' using errcode = '22023';
  end;
  return jsonb_build_object(
    'role', v_role,
    'people', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.last_seen desc nulls last, x.name)
        from (
          select p.id, public.person_display_name(p.id) as name, pr.granted_at,
                 (select max(e.at) from public.event_log e where e.actor_id = p.id) as last_seen,
                 (select count(*) from public.event_log e where e.actor_id = p.id and e.at > now() - interval '7 days')::integer as actions_7d,
                 (select count(*) from public.tribes t where p.id in (t.leader_id, t.assistant_id, t.coach_id) and t.status <> 'closed')::integer as tribes
            from public.person_roles pr
            join public.people p on p.id = pr.person_id and not p.hidden
           where pr.role = v_role
           order by (select max(e.at) from public.event_log e where e.actor_id = p.id) desc nulls last, 2
           limit least(greatest(coalesce(p_limit, 100), 1), 300)) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

-- Messages whose wording is never returned: care and safeguarding, a request for help, referee and guardian links, and anything sent to a
-- young member. Who, when, which message and how it went are still returned.
create function public.god_message_private(p_template text, p_person uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_person is not null and public.is_minor(p_person) then 'Sent to a young member. We keep the wording to ourselves.'
    when p_template like 'care\_%' or p_template = 'coach_help' then 'A care message. Who, when and how it went are shown, never the words.'
    when p_template like 'guardian\_%' then 'A message to a parent or guardian. Who, when and how it went are shown, never the words.'
    when p_template like 'referee\_%' then 'A message to a referee. It carries a private link, so the words are not shown.'
    else null
  end;
$$;

-- What the platform has sent, newest first: for everyone, or for one person. Page back with p_before (the time of the last one seen).
create function public.god_messages(p_person uuid default null, p_status text default null, p_before timestamptz default null, p_limit integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
begin
  perform public.god_only();
  if p_status is not null and p_status not in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc)
        from (
          select m.id, m.created_at as at, m.sent_at, m.person_id,
                 case when m.person_id is null then coalesce(m.to_name, 'A person without an account') else public.person_display_name(m.person_id) end as name,
                 (select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb) from public.person_roles r where r.person_id = m.person_id and r.role <> 'member') as roles,
                 m.template, m.channel, m.status, m.urgency,
                 case when m.status = 'failed' then m.error end as error,
                 public.god_message_private(m.template, m.person_id) as held,
                 case when public.god_message_private(m.template, m.person_id) is null
                      then m.params - array['secret', 'code', 'token', 'link', 'url', 'reply_token', 'password']
                 end as params
            from public.messages m
           where (p_person is null or m.person_id = p_person)
             and (p_status is null or m.status = p_status)
             and (p_before is null or m.created_at < p_before)
           order by m.created_at desc, m.id desc
           limit v_limit) x), '[]'::jsonb),
    'more', (select count(*) > v_limit
               from (select 1 from public.messages m
                      where (p_person is null or m.person_id = p_person)
                        and (p_status is null or m.status = p_status)
                        and (p_before is null or m.created_at < p_before)
                      limit v_limit + 1) c),
    -- The answers that come back: a check-in button, and STOP. For one person only.
    'replies', case when p_person is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(y) order by y.at desc)
        from (select e.at, e.action, e.meta ->> 'outcome' as outcome, e.meta ->> 'channel' as channel
                from public.event_log e
               where e.actor_id = p_person and e.action in ('checkin.by_reply', 'contact.opt_out')
               order by e.at desc limit 30) y), '[]'::jsonb) end);
end;
$$;

-- The chats staff opened on WhatsApp: who opened one with whom, when, and why. Never the words: they happen in WhatsApp.
create function public.god_chat_opens(p_person uuid default null, p_limit integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return jsonb_build_object(
    'total', (select count(*) from public.chat_opens c where p_person is null or c.person_id = p_person or c.opened_by = p_person),
    'opens', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc)
        from (
          select c.id, c.created_at as at, c.context,
                 c.opened_by, case when c.opened_by is null then null else public.person_display_name(c.opened_by) end as opened_by_name,
                 (select coalesce(jsonb_agg(r.role order by r.role), '[]'::jsonb) from public.person_roles r where r.person_id = c.opened_by and r.role <> 'member') as opened_by_roles,
                 c.person_id, case when c.person_id is null then null else public.person_display_name(c.person_id) end as person_name
            from public.chat_opens c
           where p_person is null or c.person_id = p_person or c.opened_by = p_person
           order by c.created_at desc, c.id desc
           limit least(greatest(coalesce(p_limit, 60), 1), 200)) x), '[]'::jsonb));
end;
$$;

-- The announcements the church has sent or planned to everyone, or to a group: what they said and how many it reached.
create function public.god_announcements(p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.at desc)
      from (
        select b.id, coalesce(b.started_at, b.scheduled_for, b.created_at) as at, b.title, b.subject, b.audience_label, b.status,
               b.recipient_count, b.snapshot_count, b.finished_at, b.scheduled_for,
               case when b.created_by is null then null else public.person_display_name(b.created_by) end as created_by_name
          from public.broadcasts b
         order by coalesce(b.started_at, b.scheduled_for, b.created_at) desc
         limit least(greatest(coalesce(p_limit, 40), 1), 100)) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The owner's own record of looking
-- ---------------------------------------------------------------------------

-- One note in the owner's log that these screens were opened, at most one a minute for the same screen. `detail` says which role or which
-- person, by id only.
create function public.god_looked(p_what text, p_ref text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.god_only();
  if p_what not in ('desks', 'desk', 'conversations', 'person_conversation', 'chat_opens') then
    raise exception 'Unknown screen' using errcode = '22023';
  end if;
  if exists (select 1 from public.god_log g
              where g.kind = 'looked' and g.action = p_what and g.entity_id is not distinct from p_ref and g.at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.god_log (kind, action, entity, entity_id, detail) values ('looked', p_what, 'oversight', p_ref, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function public.god_message_private(text, uuid) from public, anon, authenticated;
revoke execute on function
  public.god_desks(),
  public.god_role_people(text, integer),
  public.god_messages(uuid, text, timestamptz, integer),
  public.god_chat_opens(uuid, integer),
  public.god_announcements(integer),
  public.god_looked(text, text)
  from public, anon;
grant execute on function
  public.god_desks(),
  public.god_role_people(text, integer),
  public.god_messages(uuid, text, timestamptz, integer),
  public.god_chat_opens(uuid, integer),
  public.god_announcements(integer),
  public.god_looked(text, text)
  to authenticated;

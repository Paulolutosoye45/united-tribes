-- =============================================================================
-- Keeping the sending service honest
--
--   ping()                 a health check that touches the database and says nothing else
--   worker_status(token)   how the queue is doing: for a monitor, and the settings page
--   worker_opt_out(…)      someone replied STOP on WhatsApp, or marked an email as spam:
--                          record it as withdrawing that channel
-- =============================================================================

create function public.ping()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true);
$$;

create function public.worker_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_due integer;
  v_oldest numeric;
  v_stuck integer;
  v_failed integer;
  v_last_sent timestamptz;
  v_last_contact timestamptz;
begin
  perform public.worker_ok(p_token);
  select count(*), round(extract(epoch from now() - min(scheduled_for)) / 60)
    into v_due, v_oldest
    from public.messages where status = 'queued' and scheduled_for <= now();
  select count(*) into v_stuck from public.messages where status = 'sending' and claimed_at < now() - interval '10 minutes';
  select count(*) into v_failed from public.messages where status = 'failed' and created_at > now() - interval '24 hours';
  select max(sent_at) into v_last_sent from public.messages;
  select max(last_used_at) into v_last_contact from public.worker_tokens where revoked_at is null;
  return jsonb_build_object(
    'due', v_due,
    'oldest_due_minutes', coalesce(v_oldest, 0),
    'stuck', v_stuck,
    'failed_24h', v_failed,
    'last_sent_at', v_last_sent,
    'last_worker_contact_at', v_last_contact);
end;
$$;

-- A person withdraws one channel by replying STOP or by marking an email as spam.
-- Matched on the number or the address we hold for them; nothing is changed for anyone else.
create function public.worker_opt_out(p_token text, p_phone text, p_email text, p_channel text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  r record;
  n integer := 0;
begin
  perform public.worker_ok(p_token);
  if p_channel is null or p_channel not in ('whatsapp', 'sms', 'email') then
    raise exception 'Unknown channel' using errcode = '22023';
  end if;
  if char_length(v_digits) < 8 and char_length(v_email) < 5 then
    return 0;
  end if;

  for r in
    select distinct p.id
      from public.people p
      left join public.contact_preferences cp on cp.person_id = p.id
     where (char_length(v_digits) >= 8 and regexp_replace(coalesce(cp.phone, ''), '\D', '', 'g') = v_digits)
        or (char_length(v_email) >= 5 and lower(p.email) = v_email)
  loop
    if p_channel = 'email' then
      if not public.email_opted_out(r.id) then
        insert into public.consents (person_id, purpose, granted, version) values (r.id, 'email', false, 'opt-out-reply');
        n := n + 1;
      end if;
    elsif public.consent_granted(r.id, p_channel::public.consent_purpose) then
      insert into public.consents (person_id, purpose, granted, version) values (r.id, p_channel::public.consent_purpose, false, 'opt-out-reply');
      n := n + 1;
    end if;
    perform public.write_event(r.id, 'contact.opt_out', 'person', r.id::text, jsonb_build_object('channel', p_channel, 'by', 'reply'));
  end loop;
  return n;
end;
$$;

-- The leader's own view of the circle now also carries the meeting link they set.
create or replace function public.my_circle()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c public.circles;
  card jsonb;
  missing text[] := '{}';
  module_ok boolean;
begin
  select * into c from public.circles where (leader_id = me or assistant_id = me) and status <> 'closed'
    order by created_at desc limit 1;
  if not found then
    return null;
  end if;
  card := public.circle_json(c.id);
  module_ok := exists (
    select 1 from public.academy_progress p join public.academy_modules m on m.id = p.module_id
     where p.person_id = c.leader_id and m.slug = 'the-success-picture' and p.passed_at is not null);

  if c.name is null then missing := array_append(missing, 'name'); end if;
  if c.track_id is null then missing := array_append(missing, 'track'); end if;
  if c.tribe_id is null then missing := array_append(missing, 'tribe'); end if;
  if c.season_goal_id is null then missing := array_append(missing, 'goal'); end if;
  if coalesce(char_length(btrim(c.story)), 0) < 40 then missing := array_append(missing, 'story'); end if;
  if c.slot is null then missing := array_append(missing, 'time'); end if;
  if c.meeting_mode is null then missing := array_append(missing, 'mode'); end if;
  if c.zone is null then missing := array_append(missing, 'zone'); end if;
  if coalesce(char_length(btrim(c.loving_god)), 0) < 15 then missing := array_append(missing, 'god'); end if;
  if coalesce(char_length(btrim(c.loving_others)), 0) < 15 then missing := array_append(missing, 'others'); end if;
  if coalesce(char_length(btrim(c.loving_life)), 0) < 15 then missing := array_append(missing, 'life'); end if;

  return card || jsonb_build_object(
    'role', case when c.leader_id = me then 'leader' else 'assistant' end,
    'missing', to_jsonb(missing),
    'module_ok', module_ok,
    'editable', c.leader_id = me and c.status in ('draft', 'changes_requested'),
    'certified', exists (select 1 from public.leader_certifications where person_id = c.leader_id),
    'meeting_link', c.meeting_link);
end;
$$;

-- A number given in the join form is also the number we reach the person on, so the two never disagree.
create function public.sync_contact_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.whatsapp is not null then
    insert into public.contact_preferences (person_id, phone, preferred)
    values (new.person_id, new.whatsapp, 'whatsapp')
    on conflict (person_id) do update set phone = excluded.phone, updated_at = now();
  end if;
  return new;
end;
$$;
create trigger member_profiles_sync_contact after insert or update of whatsapp on public.member_profiles
  for each row execute function public.sync_contact_from_profile();

-- Members who already gave a number before this existed.
insert into public.contact_preferences (person_id, phone, preferred)
select person_id, whatsapp, 'whatsapp' from public.member_profiles where whatsapp is not null
on conflict (person_id) do nothing;

revoke execute on function
  public.sync_contact_from_profile(),
  public.ping(),
  public.worker_status(text),
  public.worker_opt_out(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.ping() to anon, authenticated;
grant execute on function public.worker_status(text) to anon, authenticated;
grant execute on function public.worker_opt_out(text, text, text, text) to anon, authenticated;

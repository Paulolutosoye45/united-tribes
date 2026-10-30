-- Way back from "WhatsApp that cannot fail quietly", stage 1 (the safety net): WhatsApp goes back to the day before it
--
-- Puts message_channels and god_feature_board back exactly as they were, drops the pause, the watch on faults, their tables and the one function
-- the stage added to the Switchboard (with its rules; the log of who moved a switch is kept), and gives the Switchboard back its six groups.
-- Roll back the later WhatsApp, number and removal stages first (their way-back files do), and the application files before this one: the Messages page
-- calls these functions. Nothing a member has agreed to, no message and no template is touched. The messages the pause held back are not lost: they
-- already went to the next channel the member agreed to.
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop trigger if exists messages_fault_watch on public.messages;
drop function if exists public.messages_fault_watch();
drop function if exists public.whatsapp_guard_settings_save(integer, integer, integer);
drop function if exists public.whatsapp_resume(text);
drop function if exists public.whatsapp_pause(text);
drop function if exists public.whatsapp_guard_overview();
drop function if exists public.whatsapp_unconfirmed(integer);
drop function if exists public.whatsapp_note_fault(uuid, text);

-- The outbox as it was: no pause
create or replace function public.message_channels(p_msg uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  cp public.contact_preferences%rowtype;
  v_email text;
  v_phone text;
  v_order text[] := array['whatsapp', 'email', 'sms'];
  v_out text[] := '{}';
  ch text;
begin
  select * into m from public.messages where id = p_msg;
  if not found then
    return '{}';
  end if;
  if m.person_id is not null then
    select p.email into v_email from public.people p where p.id = m.person_id;
    select * into cp from public.contact_preferences c where c.person_id = m.person_id;
    v_phone := cp.phone;
  else
    v_email := m.to_email;
    v_phone := m.to_phone;
  end if;

  if m.force_channel is not null then
    if m.force_channel = any (m.tried) then
      return '{}';
    end if;
    if (m.force_channel = 'email' and v_email is not null) or (m.force_channel <> 'email' and v_phone is not null) then
      return array[m.force_channel];
    end if;
    return '{}';
  end if;

  if cp.preferred is not null then
    v_order := array[cp.preferred] || array_remove(v_order, cp.preferred);
  end if;
  foreach ch in array v_order loop
    continue when ch = any (m.tried);
    if ch = 'whatsapp' and v_phone is not null
       and (m.person_id is null or public.consent_granted(m.person_id, 'whatsapp')) then
      v_out := v_out || ch;
    elsif ch = 'email' and v_email is not null
       and (m.person_id is null or not public.email_opted_out(m.person_id)) then
      v_out := v_out || ch;
    elsif ch = 'sms' and v_phone is not null
       and (m.person_id is null or public.consent_granted(m.person_id, 'sms')) then
      v_out := v_out || ch;
    end if;
  end loop;
  return v_out;
end;
$$;

drop function if exists public.whatsapp_paused();
drop function if exists public.whatsapp_fault_code(text);
drop function if exists public.whatsapp_manager();

drop table if exists public.whatsapp_faults;
drop table if exists public.whatsapp_guard_log;
drop table if exists public.whatsapp_guard;

-- The Switchboard: the function, its rule, and the extra groups
delete from public.feature_settings where feature = 'whatsapp_guard';
delete from public.feature_registry where key = 'whatsapp_guard';
create or replace function public.god_feature_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.feature_master;
begin
  perform public.god_only();
  select * into m from public.feature_master x where x.id;
  return jsonb_build_object(
    'paused', m.paused, 'pausedReason', m.reason, 'pausedAt', m.changed_at,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'name', f.name, 'blurb', f.blurb, 'stage', f.stage, 'depends', to_jsonb(f.depends), 'modes', to_jsonb(f.modes),
               'default', f.default_mode, 'available', f.available, 'summary', public.feature_summary(f.key),
               'rules', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', s.id, 'scope', s.scope, 'scopeId', s.scope_id, 'label', public.feature_scope_label(s.scope, s.scope_id),
                          'position', s.position, 'roles', to_jsonb(s.roles), 'reason', s.reason, 'holdoutUntil', s.holdout_until, 'at', s.set_at)
                        order by case s.scope when 'platform' then 1 when 'centre' then 2 when 'community' then 3 when 'tribe' then 4 else 5 end, s.set_at)
                         from public.feature_settings s where s.feature = f.key), '[]'::jsonb))
             order by f.sort)
        from public.feature_registry f), '[]'::jsonb));
end;
$$;

drop trigger if exists feature_settings_platform_only on public.feature_settings;
drop function if exists public.feature_platform_state(text, integer);
drop function if exists public.feature_platform_only_guard();
alter table public.feature_registry drop column if exists platform_only;
alter table public.feature_registry drop constraint if exists feature_registry_stage_check;
-- Only while no later stage's function still stands in the new groups
do $restore$
begin
  if not exists (select 1 from public.feature_registry where stage > 6) then
    alter table public.feature_registry add constraint feature_registry_stage_check check (stage between 1 and 6);
  end if;
end;
$restore$;

commit;

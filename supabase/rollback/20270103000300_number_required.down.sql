-- Way back from "WhatsApp that cannot fail quietly", stage 3 (the WhatsApp number is compulsory): the form and save_contact go back to what they were.
--
-- Puts save_contact back exactly as it was, drops the prompt table, the leader's list and the helpers, and takes the function off the Switchboard (with its
-- rule; the log of who moved a switch is kept). The only thing the table held was the date each person pressed "Not now". No phone number, consent or message
-- is touched: a number a member saved while the rule was On stays saved. Roll back stage 4 first (its way-back file does), and put the application files
-- back before this one: the pages call these functions. Run it as the database owner. Running it twice changes nothing.
begin;
drop function if exists public.tribe_number_gaps(uuid);
drop function if exists public.number_prompt_dismiss();
drop function if exists public.my_number_rule();
-- The form's save, as it was: no rule about the number
create or replace function public.save_contact(
  p_phone text,
  p_preferred text,
  p_whatsapp boolean,
  p_sms boolean,
  p_email boolean,
  p_version text default 'contact-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_pref text := coalesce(p_preferred, 'whatsapp');
  v_version text := coalesce(p_version, 'contact-v1');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_pref not in ('whatsapp', 'email', 'sms') then
    raise exception 'Choose WhatsApp, email or text message' using errcode = '22023';
  end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Write the number with its country code, like +2348031234567' using errcode = '22023';
  end if;
  if (coalesce(p_whatsapp, false) or coalesce(p_sms, false)) and v_phone is null then
    raise exception 'Add a phone number to be reached on WhatsApp or by text message' using errcode = '22023';
  end if;
  if v_version !~ '^[A-Za-z0-9._-]{1,24}$' then
    raise exception 'Something went wrong. Reload the page and try again.' using errcode = '22023';
  end if;
  if v_pref = 'whatsapp' and not coalesce(p_whatsapp, false) then
    v_pref := case when coalesce(p_email, true) then 'email' else 'sms' end;
  end if;
  if v_pref = 'sms' and not coalesce(p_sms, false) then
    v_pref := case when coalesce(p_whatsapp, false) then 'whatsapp' else 'email' end;
  end if;
  if v_pref = 'email' and not coalesce(p_email, true) then
    v_pref := case when coalesce(p_whatsapp, false) then 'whatsapp' else 'sms' end;
  end if;

  insert into public.contact_preferences (person_id, phone, preferred)
  values (uid, v_phone, v_pref)
  on conflict (person_id) do update set phone = excluded.phone, preferred = excluded.preferred, updated_at = now();

  -- Record each change in the ledger; withdrawing has its effect through the ledger's own trigger.
  if coalesce(p_whatsapp, false) is distinct from public.consent_granted(uid, 'whatsapp') then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'whatsapp', coalesce(p_whatsapp, false), v_version);
  end if;
  if coalesce(p_sms, false) is distinct from public.consent_granted(uid, 'sms') then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'sms', coalesce(p_sms, false), v_version);
  end if;
  if coalesce(p_email, true) is distinct from (not public.email_opted_out(uid)) then
    insert into public.consents (person_id, purpose, granted, version) values (uid, 'email', coalesce(p_email, true), v_version);
  end if;

  -- A leader or coach reaches a member on the number the member shared, so keep the two in step.
  update public.member_profiles
     set whatsapp = case when coalesce(p_whatsapp, false) then v_phone else null end
   where person_id = uid;

  perform public.write_event(uid, 'contact.saved', 'person', uid::text,
    jsonb_build_object('preferred', v_pref, 'whatsapp', coalesce(p_whatsapp, false), 'sms', coalesce(p_sms, false)));
  return public.my_contact();
end;
$$;

drop function if exists public.number_looks_made_up(text);
drop function if exists public.number_required_for(uuid);
drop table if exists public.number_prompts;
-- The Switchboard: the function and its rule
delete from public.feature_settings where feature = 'number_required';
delete from public.feature_registry where key = 'number_required';
commit;

-- =============================================================================
-- United Tribes: WhatsApp that cannot fail quietly, stage 3 (the WhatsApp number is compulsory)
--
-- What this adds, and nothing else. One more function on the Switchboard (God Mode -> Features), "WhatsApp number required", which starts Off. When it is
-- On, an adult member must give a phone number that WhatsApp can reach:
--
--   The form        the join form's contact step asks for it, shows it back as "We will use +234 ...", and will not go on without it. Saying yes to
--                   WhatsApp stays a separate, optional yes: the number is for reaching the person, and the leader sees it only if they choose WhatsApp.
--   save_contact    the database refuses to save an adult member's contact details without a number, or with a number that is plainly made up (the last
--                   seven digits all the same). A teenager, and anyone who has no member profile, are never asked.
--   Existing        a member who joined before has a gentle prompt on Home and My page until they add one. "Not now" hides it for a week.
--   Two numbers     if the number they sign in with differs from the number we message, My page says so in one line, with both.
--   Leaders         a leader sees how many of their people have no number saved, and their first names, so they can ask in person.
--
-- Off: nothing here runs. The form, save_contact and every page behave exactly as they did.
--
-- What it never does: it does not change the wording, the order or the consent rules of any message, a member's channel choice, or what a leader is shown
-- of a member's number. A person's sign-in number is read only to show them their own two numbers. The golden recordings are unchanged.
--
-- Replaced, because it now knows about the rule (the old text is in the rollback file): save_contact.
-- Needs stage 1 in place first (the Switchboard's whole-church-only functions).
-- =============================================================================

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only) values
  ('number_required', 'WhatsApp number required', 'Makes a phone number compulsory on the join form and in a member''s contact details (adults only), prompts members who joined before to add one, and shows leaders who has none. Saying yes to WhatsApp stays a separate choice. For the whole church only.', 8, '{}', array['off', 'on'], 'off', true, 24, true);

-- Who has put the prompt away, and when. One row each.
create table public.number_prompts (
  person_id uuid primary key references public.people (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  times smallint not null default 1
);
alter table public.number_prompts enable row level security;
revoke all on table public.number_prompts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Small helpers (internal)
-- ---------------------------------------------------------------------------
-- Is a phone number compulsory for this person? Only while the switch is On, only for someone with a member profile, never for a teenager.
create function public.number_required_for(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.feature_platform_state('number_required') = 'on'
     and exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
     and not public.is_minor(p_person);
$$;

-- A number whose last seven digits are one digit repeated is not a real person's number.
create function public.number_looks_made_up(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 7) ~ '^(\d)\1{6}$';
$$;

-- ---------------------------------------------------------------------------
-- save_contact: the same function, with the rule added (marked in the text)
-- ---------------------------------------------------------------------------
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
  -- The number is compulsory for an adult member while the switch is On (number_required_for is false Off, for a teenager and for anyone without a member profile)
  if public.number_required_for(uid) then
    if v_phone is null then
      raise exception 'Add your WhatsApp number. We need it to reach you with your tribe''s messages' using errcode = '22023';
    end if;
    if public.number_looks_made_up(v_phone) then
      raise exception 'That number looks made up. Check the digits and write it again' using errcode = '22023';
    end if;
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

-- ---------------------------------------------------------------------------
-- What the signed-in person sees
-- ---------------------------------------------------------------------------
-- The rule for the signed-in person, in one answer: whether it is On, whether it applies to them, whether to show the prompt, and whether the number
-- they sign in with differs from the one we message. Off: four "no"s.
create function public.my_number_rule()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_on boolean;
  v_req boolean;
  v_phone text;
  v_sign text;
  v_dismissed timestamptz;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  v_on := public.feature_platform_state('number_required') = 'on';
  if not v_on then
    return jsonb_build_object('on', false, 'required', false, 'prompt', false, 'mismatch', null);
  end if;
  v_req := public.number_required_for(uid);
  select c.phone into v_phone from public.contact_preferences c where c.person_id = uid;
  select regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') into v_sign from auth.users u where u.id = uid;
  select d.dismissed_at into v_dismissed from public.number_prompts d where d.person_id = uid;
  return jsonb_build_object(
    'on', true,
    'required', v_req,
    'prompt', v_req and v_phone is null and (v_dismissed is null or v_dismissed < now() - interval '7 days'),
    'mismatch', case when v_phone is not null and coalesce(v_sign, '') <> '' and regexp_replace(v_phone, '\D', '', 'g') <> v_sign
                     then jsonb_build_object('signin', '+' || v_sign, 'contact', v_phone) else null end);
end;
$$;

-- "Not now": the prompt stays away for a week.
create function public.number_prompt_dismiss()
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
  if public.feature_platform_state('number_required') <> 'on' then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  insert into public.number_prompts (person_id) values (uid)
  on conflict (person_id) do update set dismissed_at = now(), times = least(public.number_prompts.times + 1, 1000);
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a leader sees
-- ---------------------------------------------------------------------------
-- The people of a tribe who have no phone number saved: how many, and their first names. Asks the leader's own list who is in the tribe (tribe_roster),
-- so only those who run the tribe can ask, and the same people are counted. A teenager is never counted. Off: nothing.
create function public.tribe_number_gaps(p_tribe uuid)
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
  if public.feature_platform_state('number_required') <> 'on' then
    return jsonb_build_object('on', false, 'count', 0, 'names', '[]'::jsonb);
  end if;
  v := public.tribe_roster(p_tribe);
  return jsonb_build_object(
    'on', true,
    'count', (select count(*)::integer from jsonb_array_elements(v -> 'members') e
               where not exists (select 1 from public.contact_preferences c where c.person_id = (e ->> 'person_id')::uuid and c.phone is not null)
                 and not public.is_minor((e ->> 'person_id')::uuid)),
    'names', coalesce((select jsonb_agg(public.first_name_of((e ->> 'person_id')::uuid) order by e ->> 'name')
                         from jsonb_array_elements(v -> 'members') e
                        where not exists (select 1 from public.contact_preferences c where c.person_id = (e ->> 'person_id')::uuid and c.phone is not null)
                          and not public.is_minor((e ->> 'person_id')::uuid)), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function
  public.number_required_for(uuid),
  public.number_looks_made_up(text)
  from public, anon, authenticated;

revoke execute on function
  public.my_number_rule(),
  public.number_prompt_dismiss(),
  public.tribe_number_gaps(uuid)
  from public, anon;

grant execute on function
  public.my_number_rule(),
  public.number_prompt_dismiss(),
  public.tribe_number_gaps(uuid)
  to authenticated;

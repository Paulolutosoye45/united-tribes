-- Phase 7: sign-in with a code on WhatsApp.
--
-- One person keeps one account. A WhatsApp number is ADDED to an account that
-- was made with Google or an email code; it never makes an account of its
-- own. Otherwise someone who signed up by email and later tried WhatsApp
-- would land in a second, empty account and lose their circle.
--
-- The sign-in service stores the number on the account, and the app reads it
-- from the person's own token. Nothing is copied into our tables.
--
-- The only database change: refuse, with a clear message, a new account that
-- arrives with no email address. (It was refused before too, by the NOT NULL
-- on people.email, but with an error nobody could read.)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_centre uuid;
  v_name text;
  v_preferred text;
  v_email text := nullif(btrim(coalesce(new.email, '')), '');
begin
  if v_email is null then
    raise exception 'An account starts with Google or an email address. Add your WhatsApp number to it afterwards.'
      using errcode = '22023';
  end if;

  select c.id into v_centre
  from public.centres c
  where c.active
  order by c.created_at
  limit 1;

  if v_centre is null then
    raise exception 'No active centre is configured';
  end if;

  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_preferred := nullif(split_part(coalesce(v_name, ''), ' ', 1), '');

  insert into public.people (id, centre_id, email, full_name, preferred_name, avatar_url)
  values (
    new.id,
    v_centre,
    lower(v_email),
    v_name,
    v_preferred,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.person_roles (person_id, role, centre_id)
  values (new.id, 'member', v_centre)
  on conflict do nothing;

  perform public.write_event(new.id, 'person.created', 'person', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

-- Triggers run it; nobody calls it. Keep it out of reach, as before.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

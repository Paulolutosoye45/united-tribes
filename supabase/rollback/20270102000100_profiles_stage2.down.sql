-- Way back from "Profiles and the Weekly Rhythm", stage 2: My page goes back to what stage 1 made it
--
-- Drops the functions stage 2 added, puts back the eight functions it replaced exactly as stage 1 wrote them (they then know only the stage of life and the
-- age range), removes the four stage-2 functions from the Switchboard (with any rules and their place in the board's order; the log of who moved a switch
-- is kept), and removes the seven rows stage 2 added to the facts registry unless a person has already used one (then the row is left, and nothing
-- reads it). Stage 1 is exactly as it was.
-- The tables profile_story, profile_office_asks and profile_prompts are LEFT as they are, with every row, so what a person wrote about themselves, what
-- they told the Care Team and which strips they set aside is not lost. They hold nothing the platform reads once the functions are gone. Nothing a
-- person typed is undone: a preferred name, an area or a birthday saved on My page stays saved where the platform already read it.
-- To remove the tables as well, after this file:
--   drop table public.profile_prompts, public.profile_office_asks, public.profile_story;
-- Roll the application files back first (My page, Home, the account menu and the young people's page call these functions).
-- Run it as the database owner. Running it twice changes nothing.

begin;

drop function if exists public.my_profile_export();
drop function if exists public.still_right_later(text);
drop function if exists public.still_right_state();
drop function if exists public.profile_office_ask_close(uuid, text);
drop function if exists public.profile_office_asks_list();
drop function if exists public.my_office_ask(text);
drop function if exists public.my_panels_of(uuid);
drop function if exists public.my_page_open();
drop function if exists public.my_page_save(text, text);
drop function if exists public.profile_fact_save(uuid, text, text, text);

-- The eight functions stage 2 replaced, as stage 1 wrote them
-- Put back only while stage 1 is still in the database. If stage 1's own way back has already run, those functions have nothing to stand on, and
-- running this file again must not bring them back.
do $restore$
begin
  if to_regprocedure('public.profile_track_phrase(text)') is not null then
    execute $fn$
create or replace function public.profile_fact_label(p_key text, p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then public.profile_track_phrase(p_value)
    when 'age_range' then (select a.label from public.age_ranges a where a.slug = p_value)
  end;
$$;
    $fn$;

    execute $fn$
create or replace function public.profile_fact_options(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then coalesce((select jsonb_agg(jsonb_build_object('value', k.slug, 'label', k.name, 'detail', public.profile_track_phrase(k.slug)) order by k.sort)
                                       from public.tracks k where k.active and k.min_age >= 18), '[]'::jsonb)
    when 'age_range' then coalesce((select jsonb_agg(jsonb_build_object('value', a.slug, 'label', a.label, 'detail', k.name) order by a.sort)
                                      from public.age_ranges a join public.tracks k on k.id = a.track_id where a.min_age >= 18), '[]'::jsonb)
    else '[]'::jsonb
  end;
$$;
    $fn$;

    execute $fn$
create or replace function public.profile_fact_applies(p_person uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then exists (select 1 from public.person_roles r where r.person_id = p_person and r.role = 'leader')
    when 'age_range' then exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
    else false
  end;
$$;
    $fn$;

    execute $fn$
create or replace function public.profile_fact_current(p_person uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.profile_facts;
  v_val text;
  v_by text;
  v_at timestamptz;
  v_src text;
begin
  select * into f from public.profile_facts x where x.person_id = p_person and x.key = p_key;
  if found then
    return jsonb_build_object('state', case when f.confirmed_at is not null then 'confirmed' else 'unconfirmed' end, 'value', f.value,
      'label', public.profile_fact_label(p_key, f.value), 'by', f.set_by_kind, 'at', coalesce(f.confirmed_at, f.set_at), 'source', 'fact');
  end if;
  if p_key = 'life_stage' then
    -- The office's suggestion at the appointment: its short form is the proposal.
    select a.form ->> 'track', a.appointed_at into v_val, v_at
      from public.leader_appointments a where a.person_id = p_person and a.status = 'active';
    if v_val is not null then
      v_by := 'office';
      v_src := 'appointment';
    else
      select k.slug, t.created_at into v_val, v_at
        from public.tribes t join public.tracks k on k.id = t.track_id
       where t.leader_id = p_person and t.status <> 'closed' order by t.created_at desc limit 1;
      if v_val is not null then
        v_src := 'tribe';
        -- A card that began from the leader's own application carries what they typed there.
        v_by := case when exists (select 1 from public.leader_applications la
                                   where la.person_id = p_person and la.status in ('approved_leader', 'approved_assistant')
                                     and la.answers #>> '{calling,track}' = v_val) then 'person' else 'office' end;
      else
        select la.answers #>> '{calling,track}', la.decided_at into v_val, v_at
          from public.leader_applications la
         where la.person_id = p_person and la.status in ('approved_leader', 'approved_assistant')
         order by la.created_at desc limit 1;
        v_by := 'person';
        v_src := 'application';
      end if;
    end if;
    if v_val is null or public.profile_track_phrase(v_val) is null then
      return jsonb_build_object('state', 'none');
    end if;
  elsif p_key = 'age_range' then
    select a.slug, mp.submitted_at into v_val, v_at
      from public.member_profiles mp join public.age_ranges a on a.id = mp.age_range_id where mp.person_id = p_person;
    v_by := 'person';
    v_src := 'answers';
    if v_val is null then
      return jsonb_build_object('state', 'none');
    end if;
  else
    return jsonb_build_object('state', 'none');
  end if;
  return jsonb_build_object('state', case when v_by = 'person' then 'confirmed' else 'unconfirmed' end, 'value', v_val,
    'label', public.profile_fact_label(p_key, v_val), 'by', v_by, 'at', v_at, 'source', v_src);
end;
$$;
    $fn$;

    execute $fn$
create or replace function public.profile_fact_answer(p_person uuid, p_key text, p_action text, p_value text, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.profile_fact_registry;
  cur jsonb;
  v_old text;
  v_new text := nullif(btrim(coalesce(p_value, '')), '');
  t public.tribes;
  v_members integer;
  v_centre uuid;
  v_id uuid;
  v_old_min integer;
begin
  if p_via not in ('details_check', 'my_page') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select * into reg from public.profile_fact_registry x where x.key = p_key;
  if not found or not public.profile_fact_applies(p_person, p_key) then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  if p_action not in ('yes', 'change', 'not_me', 'later') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  cur := public.profile_fact_current(p_person, p_key);
  if cur ->> 'state' = 'none' then
    return jsonb_build_object('ok', false, 'reason', 'nothing');
  end if;
  v_old := cur ->> 'value';
  if exists (select 1 from public.profile_changes c where c.person_id = p_person and c.key = p_key and c.status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'waiting', 'message', 'A change is already waiting for a pastor to look at it');
  end if;

  if p_action = 'not_me' then
    insert into public.profile_fact_history (person_id, key, event, old_value, by_kind, by_person, via, note)
    values (p_person, p_key, 'not_me', v_old, 'person', null, p_via, 'The message was not for this person');
    return jsonb_build_object('ok', true, 'outcome', 'not_me');
  end if;
  if p_action = 'later' then
    insert into public.profile_fact_history (person_id, key, event, old_value, by_kind, by_person, via)
    values (p_person, p_key, 'later', v_old, 'person', p_person, p_via);
    return jsonb_build_object('ok', true, 'outcome', 'later');
  end if;

  if p_action = 'change' and (v_new is null or v_new = v_old) then
    -- Choosing what is already held is the same as saying it is right.
    if v_new is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose one from the list');
    end if;
    p_action := 'yes';
  end if;

  if p_action = 'yes' then
    insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, set_at, confirmed_at, confirmed_via)
    values (p_person, p_key, v_old, coalesce(nullif(cur ->> 'by', ''), 'office'), null, coalesce((cur ->> 'at')::timestamptz, now()), now(), p_via)
    on conflict (person_id, key) do update set confirmed_at = now(), confirmed_via = excluded.confirmed_via;
    insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via)
    values (p_person, p_key, 'confirmed', v_old, v_old, 'person', p_person, p_via);
    return jsonb_build_object('ok', true, 'outcome', 'confirmed');
  end if;

  -- change
  if not exists (select 1 from jsonb_array_elements(public.profile_fact_options(p_key)) o where o ->> 'value' = v_new) then
    return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose one from the list');
  end if;
  select p.centre_id into v_centre from public.people p where p.id = p_person;

  if p_key = 'life_stage' then
    select * into t from public.tribes x where x.leader_id = p_person and x.status <> 'closed' order by x.created_at desc limit 1;
    if not found then
      -- No tribe yet: the answer is kept, and the pastor sees it beside the card when one is started.
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'changed', v_old, v_new, 'person', p_person, p_via, 'No tribe is started yet');
      return jsonb_build_object('ok', true, 'outcome', 'recorded');
    end if;
    select count(*)::integer into v_members from public.tribe_members m where m.tribe_id = t.id and m.status = 'active';
    if t.status <> 'approved' and v_members = 0 then
      update public.tribes set track_id = (select k.id from public.tracks k where k.slug = v_new and k.active) where id = t.id;
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'applied', v_old, v_new, 'person', p_person, p_via, 'The Tribe Card was not approved and nobody had joined, so the change applied at once');
      perform public.write_event(p_person, 'profile.stage_corrected', 'tribe', t.id::text, jsonb_build_object('from', v_old, 'to', v_new));
      return jsonb_build_object('ok', true, 'outcome', 'applied_now', 'tribe', t.id);
    end if;
    insert into public.profile_changes (person_id, key, old_value, new_value, tribe_id, centre_id, via, due_on)
    values (p_person, p_key, v_old, v_new, t.id, v_centre, p_via, public.today_lagos() + 5)
    returning id into v_id;
  else
    -- A member's age range. Crossing 17 and 18 is never self-service.
    select a.min_age into v_old_min from public.age_ranges a where a.slug = v_old;
    if coalesce(v_old_min, 0) < 18 then
      return jsonb_build_object('ok', false, 'reason', 'special_route', 'message', 'A change for someone under 18 goes through the young people''s rules. Ask the church office');
    end if;
    if exists (select 1 from public.tribe_members m where m.person_id = p_person and m.status = 'active') then
      insert into public.profile_changes (person_id, key, old_value, new_value, tribe_id, centre_id, via, due_on)
      values (p_person, p_key, v_old, v_new, (select m.tribe_id from public.tribe_members m where m.person_id = p_person and m.status = 'active' order by m.joined_at desc limit 1),
              v_centre, p_via, public.today_lagos() + 5)
      returning id into v_id;
    else
      update public.member_profiles set age_range_id = (select a.id from public.age_ranges a where a.slug = v_new), updated_at = now() where person_id = p_person;
      insert into public.profile_facts (person_id, key, value, set_by_kind, set_by, confirmed_at, confirmed_via)
      values (p_person, p_key, v_new, 'person', p_person, now(), p_via)
      on conflict (person_id, key) do update set value = excluded.value, set_by_kind = 'person', set_by = excluded.set_by, set_at = now(), confirmed_at = now(), confirmed_via = excluded.confirmed_via;
      insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
      values (p_person, p_key, 'applied', v_old, v_new, 'person', p_person, p_via, 'Not in a tribe, so nobody is affected');
      return jsonb_build_object('ok', true, 'outcome', 'applied_now');
    end if;
  end if;

  insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
  values (p_person, p_key, 'pending', v_old, v_new, 'person', p_person, p_via, 'Waiting for the pastor of the person''s centre; the old value stays in force');
  -- The pastors hear. A fault here is recorded and never undoes the answer.
  begin
    perform public.notify_role(v_centre, array['pastor', 'director'], 'pastor_stage_review', 'stage:' || v_id,
      jsonb_build_object('leader', public.first_name_of(p_person), 'what', reg.label),
      public.first_name_of(p_person) || ' asked to change their ' || lower(reg.label), '/review/stages', false, p_person);
  exception when others then
    perform public.notice_fault('profile_review', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'outcome', 'pending_review', 'change', v_id);
end;
$$;
    $fn$;

    execute $fn$
create or replace function public.details_clean_facts(p_facts text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_facts, '{}')) x where x is not null), '{}');
begin
  if cardinality(v) < 1 or cardinality(v) > 3 then
    raise exception 'Choose between one and three facts to confirm' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v) x where not exists (select 1 from public.profile_fact_registry r where r.key = x)) then
    raise exception 'That is not a fact we hold' using errcode = '22023';
  end if;
  return v;
end;
$$;
    $fn$;

    execute $fn$
create or replace function public.my_page_answer(p_key text, p_action text, p_value text default null)
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
  if public.feature_state_of('my_page', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if p_action not in ('yes', 'change') then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  return public.profile_fact_answer(me, p_key, p_action, p_value, 'my_page');
end;
$$;
    $fn$;

    execute $fn$
create or replace function public.my_page_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.profile_fact_registry;
  cur jsonb;
  c public.profile_changes;
  v_last record;
  v_facts jsonb := '[]'::jsonb;
begin
  if me is null then
    return jsonb_build_object('enabled', false);
  end if;
  -- Never for someone under 18: the young people's rules, and their parent's permission, come first (a later stage decides what they see)
  if public.feature_state_of('my_page', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('enabled', false);
  end if;
  for r in select * from public.profile_fact_registry x where public.profile_fact_applies(me, x.key) order by x.sort loop
    cur := public.profile_fact_current(me, r.key);
    continue when cur ->> 'state' = 'none';
    select * into c from public.profile_changes x where x.person_id = me and x.key = r.key order by x.requested_at desc limit 1;
    select h.event, h.at, h.note into v_last from public.profile_fact_history h where h.person_id = me and h.key = r.key order by h.id desc limit 1;
    v_facts := v_facts || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'label', r.label, 'question', replace(r.question, '{value}', cur ->> 'label'), 'state', cur ->> 'state', 'value', cur ->> 'value', 'valueLabel', cur ->> 'label',
      'by', cur ->> 'by', 'at', cur ->> 'at', 'options', public.profile_fact_options(r.key),
      'change', case when c.id is null then null else jsonb_build_object('status', c.status, 'newLabel', public.profile_fact_label(r.key, c.new_value),
                  'note', c.decision_note, 'dueOn', c.due_on, 'at', coalesce(c.decided_at, c.requested_at)) end,
      'last', case when v_last.event is null then null else jsonb_build_object('event', v_last.event, 'at', v_last.at) end));
  end loop;
  return jsonb_build_object('enabled', true, 'first', public.first_name_of(me), 'facts', v_facts);
end;
$$;
    $fn$;
  end if;
end;
$restore$;
drop function if exists public.profile_gift_options();
drop function if exists public.profile_zone_options();
drop function if exists public.profile_fact_feature(text);
drop function if exists public.profile_fact_input(text);


-- The Switchboard: the four functions, their rules, and the board's order as it was
do $$
begin
  if exists (select 1 from public.feature_registry where key = 'my_details') then
    delete from public.feature_settings where feature in ('my_details', 'my_story', 'role_panels', 'still_right');
    delete from public.feature_registry where key in ('my_details', 'my_story', 'role_panels', 'still_right');
    update public.feature_registry set sort = sort - 4 where sort >= 8;
  end if;
end;
$$;
update public.feature_registry
   set blurb = 'A page where a person sees the facts the church holds about them and confirms them. In this release: leaders only.'
 where key = 'my_page';

-- The facts registry: the seven rows stage 2 added, unless a person has already used one
delete from public.profile_fact_registry r
 where r.key in ('preferred_name', 'area', 'birthday', 'about_me', 'gifts', 'ask_me', 'pray_for_me')
   and not exists (select 1 from public.profile_facts x where x.key = r.key)
   and not exists (select 1 from public.profile_fact_history x where x.key = r.key)
   and not exists (select 1 from public.profile_changes x where x.key = r.key)
   and not exists (select 1 from public.profile_story x where x.key = r.key)
   and not exists (select 1 from public.profile_office_asks x where x.key = r.key)
   and not exists (select 1 from public.profile_prompts x where x.key = r.key);

commit;

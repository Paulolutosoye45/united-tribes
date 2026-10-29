-- =============================================================================
-- United Tribes: Profiles and the Weekly Rhythm, stage 2 (My page for everyone)
--
-- What this adds, and nothing else. Stage 1 gave every person who is asked a way to confirm the two facts the office used to type (a leader's stage of
-- life, a member's age range) and gave the pastor a place to decide a change that touches others. This stage fills My page:
--
--   More facts      the person's preferred name, their area and their birthday, typed by them and saved at once (class A and B)
--   My story        about me, gifts, ask me about, how to pray for me: the person's own words, kept for them and visible to nobody else
--   Role panels     one short panel for each role a person holds: where their application stands, their tribe, what waits for them
--   Still right?    once a season a one-line strip on Home asks anyone whose age range or stage may have moved; nothing is sent
--   Ask the office  a person whose age range is wrong in a way the list cannot fix (above all, someone who is really under 18) tells the Care Team;
--                   a change across 17 and 18 is never self-service (class D). It opens and closes with More facts on My page
--
-- Four new functions on the Switchboard, all Off: my_details, my_story, role_panels, still_right. Nothing here is shown to anyone who is not
-- signed in as themselves, and a person under 18 never sees My page (the young people's rules, and a parent's permission, come first).
--
-- What it never does: it does not change a member's tribe, a Tribe Card's text, a Readiness Score, matching, placement, a report or a reminder
-- while its switches are Off. The golden fingerprint recorded before stage 1 must still match, character for character.
--
-- Replaced, because they now know more facts (each one's old text is in the rollback file): profile_fact_label, profile_fact_options,
-- profile_fact_applies, profile_fact_current, profile_fact_answer (one guard), details_clean_facts (the office asks only about confirmed facts),
-- my_page_answer and my_page_state. No function of the platform before stage 1 changes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The Switchboard: four more functions, and the board's order
-- ---------------------------------------------------------------------------
-- The board lists stage 1, then stage 2, then the rest: make room after the third row.
update public.feature_registry set sort = sort + 4 where sort >= 4;

insert into public.feature_registry (key, name, blurb, stage, depends, modes, default_mode, available, sort) values
  ('my_details', 'More facts on My page', 'The person''s preferred name, area and birthday, typed by them and saved at once, and a way to tell the Care Team that an age range is wrong across 17 and 18. Nobody else sees them in this release.', 2, array['my_page'], array['off', 'on'], 'off', true, 4),
  ('my_story', 'My story (private)', 'About me, gifts, ask me about, how to pray for me. The person''s own words, kept for them. Sharing comes with the visibility stage.', 2, array['my_page'], array['off', 'on'], 'off', true, 5),
  ('role_panels', 'Role panels', 'One short panel on My page for each role a person holds: where their application stands, their tribe, what waits for them.', 2, array['my_page'], array['off', 'on'], 'off', true, 6),
  ('still_right', 'Still right? once a season', 'At the start of each season a one-line strip on Home asks anyone whose age range or stage may have moved. Nothing is sent.', 2, array['my_page'], array['off', 'on'], 'off', true, 7);

update public.feature_registry
   set blurb = 'A page where a person sees the facts the church holds about them and confirms them. Open it to leaders first, then to everyone.'
 where key = 'my_page';

-- ---------------------------------------------------------------------------
-- The facts: seven more rows in the registry
-- ---------------------------------------------------------------------------
-- A fact is added by adding a row (and its readers to src/lib/profile/registry.ts, which a test checks against this).
--   class A  saved at once; nothing else moves        preferred name, birthday, the four story fields
--   class B  saved at once; suggested tribes are worked out again from the next look; nobody is moved        area
insert into public.profile_fact_registry (key, label, question, layer, change_class, applies_to, sort) values
  ('preferred_name', 'Name we use for you', 'What name should we use for you?', 'facts', 'A', array['leader', 'member'], 3),
  ('area', 'Area', 'Where do you live?', 'facts', 'B', array['member'], 4),
  ('birthday', 'Birthday', 'When is your birthday? Day and month only.', 'facts', 'A', array['member'], 5),
  ('about_me', 'About me', 'A line about you, up to 140 characters.', 'story', 'A', array['leader', 'member'], 6),
  ('gifts', 'Gifts', 'Up to three gifts you bring.', 'story', 'A', array['leader', 'member'], 7),
  ('ask_me', 'Ask me about', 'Something you are glad to be asked about.', 'story', 'A', array['leader', 'member'], 8),
  ('pray_for_me', 'How to pray for me', 'How you would like to be prayed for.', 'story', 'A', array['leader', 'member'], 9);

-- ---------------------------------------------------------------------------
-- Three new tables
-- ---------------------------------------------------------------------------
-- The person's own words. One row for each field they have written. Nothing reads it but them (and, in their data file, them again); the
-- visibility stage decides who else may.
create table public.profile_story (
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  value text not null check (char_length(value) between 1 and 300),
  updated_at timestamptz not null default now(),
  primary key (person_id, key)
);
alter table public.profile_story enable row level security;
revoke all on table public.profile_story from public, anon, authenticated;

-- "Ask the church office": a person whose age range is wrong in a way the list cannot fix. The Care Team looks at it; nothing is changed for them
-- automatically. The same roles who see the young people's page see this.
create table public.profile_office_asks (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  held_value text,
  note text check (char_length(note) <= 300),
  centre_id uuid not null references public.centres (id),
  status text not null default 'open' check (status in ('open', 'done')),
  asked_at timestamptz not null default now(),
  closed_by uuid references public.people (id) on delete set null,
  closed_at timestamptz,
  closing_note text check (char_length(closing_note) <= 300),
  check ((status = 'open') = (closed_at is null))
);
create unique index profile_office_asks_one_open on public.profile_office_asks (person_id, key) where status = 'open';
create index profile_office_asks_centre_idx on public.profile_office_asks (centre_id, status, asked_at);
alter table public.profile_office_asks enable row level security;
revoke all on table public.profile_office_asks from public, anon, authenticated;

-- "Not now" on the Still right? strip: once for a season, so the person is not asked again until the next one.
create table public.profile_prompts (
  person_id uuid not null references public.people (id) on delete cascade,
  key text not null references public.profile_fact_registry (key),
  season_id uuid not null references public.seasons (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (person_id, key, season_id)
);
alter table public.profile_prompts enable row level security;
revoke all on table public.profile_prompts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Words and lists
-- ---------------------------------------------------------------------------
-- How a person gives each fact: confirm (a question with yes or a choice), text, choice (one from a list), monthday, gifts (up to three from a list).
create function public.profile_fact_input(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then 'confirm'
    when 'age_range' then 'confirm'
    when 'preferred_name' then 'text'
    when 'area' then 'choice'
    when 'birthday' then 'monthday'
    when 'about_me' then 'text'
    when 'gifts' then 'gifts'
    when 'ask_me' then 'text'
    when 'pray_for_me' then 'text'
  end;
$$;

-- Which Switchboard function opens a fact on My page.
create function public.profile_fact_feature(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'life_stage' then 'my_page'
    when 'age_range' then 'my_page'
    when 'preferred_name' then 'my_details'
    when 'area' then 'my_details'
    when 'birthday' then 'my_details'
    when 'about_me' then 'my_story'
    when 'gifts' then 'my_story'
    when 'ask_me' then 'my_story'
    when 'pray_for_me' then 'my_story'
  end;
$$;

-- The five areas of the joining form, in its words.
create function public.profile_zone_options()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('value', 'iganmu-surulere', 'label', 'Iganmu, Surulere and nearby', 'detail', 'Close to The Covenant Nation'),
    jsonb_build_object('value', 'mainland', 'label', 'Lagos Mainland', 'detail', 'Yaba, Ikeja, Maryland, Ikorodu and around'),
    jsonb_build_object('value', 'island-lekki', 'label', 'Lagos Island and Lekki', 'detail', 'Victoria Island, Ikoyi, Lekki, Ajah'),
    jsonb_build_object('value', 'other-nigeria', 'label', 'Elsewhere in Nigeria', 'detail', 'Ogun, Abuja, Port Harcourt and beyond'),
    jsonb_build_object('value', 'abroad', 'label', 'Outside Nigeria', 'detail', 'Your tribe will meet online'));
$$;

-- Gifts a person may say they bring: the lists the New Testament gives (Romans 12, 1 Corinthians 12, Ephesians 4, 1 Peter 4), in plain words.
create function public.profile_gift_options()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('value', 'teaching', 'label', 'Teaching', 'detail', 'Romans 12:7'),
    jsonb_build_object('value', 'encouraging', 'label', 'Encouraging others', 'detail', 'Romans 12:8'),
    jsonb_build_object('value', 'serving', 'label', 'Serving and helping', 'detail', '1 Peter 4:10-11'),
    jsonb_build_object('value', 'giving', 'label', 'Giving', 'detail', 'Romans 12:8'),
    jsonb_build_object('value', 'leading', 'label', 'Leading', 'detail', 'Romans 12:8'),
    jsonb_build_object('value', 'mercy', 'label', 'Showing mercy and care', 'detail', 'Romans 12:8'),
    jsonb_build_object('value', 'hospitality', 'label', 'Hospitality', 'detail', '1 Peter 4:9'),
    jsonb_build_object('value', 'prayer', 'label', 'Prayer', 'detail', 'Ephesians 6:18'),
    jsonb_build_object('value', 'organising', 'label', 'Organising, so things run well', 'detail', '1 Corinthians 12:28'),
    jsonb_build_object('value', 'evangelism', 'label', 'Sharing the good news', 'detail', 'Ephesians 4:11'),
    jsonb_build_object('value', 'wisdom', 'label', 'Wise counsel', 'detail', '1 Corinthians 12:8'),
    jsonb_build_object('value', 'faith', 'label', 'Faith', 'detail', '1 Corinthians 12:9'));
$$;

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
    when 'area' then (select o ->> 'label' from jsonb_array_elements(public.profile_zone_options()) o where o ->> 'value' = p_value)
    when 'birthday' then to_char(make_date(2024, split_part(p_value, '-', 1)::integer, split_part(p_value, '-', 2)::integer), 'FMDD FMMonth')
    when 'gifts' then (select string_agg(o ->> 'label', ', ' order by array_position(string_to_array(p_value, ','), o ->> 'value'))
                         from jsonb_array_elements(public.profile_gift_options()) o where (o ->> 'value') = any (string_to_array(p_value, ',')))
    else p_value
  end;
$$;

-- The real choices for a person who says "No, change it", or picks one from a list. Adults only: a young person's range is never offered here.
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
    when 'area' then public.profile_zone_options()
    when 'gifts' then public.profile_gift_options()
    else '[]'::jsonb
  end;
$$;

-- Does this fact apply to this person? A leader's stage; a member's age range, area and birthday; a name and a story for anyone.
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
    when 'area' then exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
    when 'birthday' then exists (select 1 from public.member_profiles mp where mp.person_id = p_person)
    when 'preferred_name' then exists (select 1 from public.people p where p.id = p_person)
    when 'about_me' then exists (select 1 from public.people p where p.id = p_person)
    when 'gifts' then exists (select 1 from public.people p where p.id = p_person)
    when 'ask_me' then exists (select 1 from public.people p where p.id = p_person)
    when 'pray_for_me' then exists (select 1 from public.people p where p.id = p_person)
    else false
  end;
$$;

-- What the platform holds for this person now. 'confirmed' when the person has said so (or typed it themselves), 'unconfirmed' when someone else
-- proposed it and the person has not yet answered, 'none' when nothing is held. Stage 2 adds the facts the person types and their story.
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
  -- Facts the person types themselves. Their value lives where the platform already reads it (the name on the person, the area and birthday on the
  -- joining form's answers); this only reads it, and says when it last changed.
  if p_key in ('preferred_name', 'area', 'birthday') then
    v_val := case p_key
      when 'preferred_name' then (select nullif(btrim(p.preferred_name), '') from public.people p where p.id = p_person)
      when 'area' then (select mp.zone from public.member_profiles mp where mp.person_id = p_person)
      else (select case when mp.birthday_month is not null and mp.birthday_day is not null
                        then lpad(mp.birthday_month::text, 2, '0') || '-' || lpad(mp.birthday_day::text, 2, '0') end
              from public.member_profiles mp where mp.person_id = p_person)
    end;
    if v_val is null then
      return jsonb_build_object('state', 'none');
    end if;
    select h.at into v_at from public.profile_fact_history h where h.person_id = p_person and h.key = p_key and h.event = 'changed' order by h.id desc limit 1;
    return jsonb_build_object('state', 'confirmed', 'value', v_val, 'label', public.profile_fact_label(p_key, v_val), 'by', 'person', 'at', v_at, 'source', 'self');
  end if;
  -- The person's own words, kept only for them.
  if p_key in ('about_me', 'gifts', 'ask_me', 'pray_for_me') then
    select s.value, s.updated_at into v_val, v_at from public.profile_story s where s.person_id = p_person and s.key = p_key;
    if v_val is null then
      return jsonb_build_object('state', 'none');
    end if;
    return jsonb_build_object('state', 'confirmed', 'value', v_val, 'label', public.profile_fact_label(p_key, v_val), 'by', 'person', 'at', v_at, 'source', 'story');
  end if;
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

-- The one place an answer about a fact is handled, whoever asks the person. Stage 2 adds one guard: only the facts that are asked as a question can
-- be answered yes or no here.
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
  -- Only the facts the person is asked about can be answered yes or no here. The others are typed and saved (profile_fact_save).
  if public.profile_fact_input(p_key) is distinct from 'confirm' then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
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

-- The office asks only about the facts a person confirms, never about the ones they type for themselves.
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
  -- The office asks about the facts a person confirms (a stage, an age range), never about the ones they type for themselves.
  if exists (select 1 from unnest(v) x where not exists (select 1 from public.profile_fact_registry r where r.key = x and public.profile_fact_input(r.key) = 'confirm')) then
    raise exception 'That is not a fact we hold' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Typing and saving: classes A and B
-- ---------------------------------------------------------------------------
-- The one place a fact the person types is saved, whoever asks (My page today). Not callable by anyone: my_page_save checks who is asking and calls this.
--   preferred name, birthday, the four story fields    class A: saved at once, nothing else moves
--   area                                              class B: saved at once; suggested tribes are worked out again the next time the person looks
--                                                     (the joining form's answer is read live then); nobody is moved
-- A fact the person has typed leaves a line in its history (old value, new value, when, by whom); the story fields do not (they are the person's
-- words, not a fact other places read, and the old words are not kept). An empty value clears the fact.
create function public.profile_fact_save(p_person uuid, p_key text, p_value text, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reg public.profile_fact_registry;
  v_in text := public.profile_fact_input(p_key);
  v text := nullif(btrim(coalesce(p_value, '')), '');
  v_old text;
  v_m integer;
  v_d integer;
  v_parts text[];
  v_max integer;
begin
  select * into reg from public.profile_fact_registry x where x.key = p_key;
  if not found or v_in is null or v_in = 'confirm' or p_via not in ('my_page') or not public.profile_fact_applies(p_person, p_key) then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  v_old := nullif(public.profile_fact_current(p_person, p_key) ->> 'value', '');
  if v is not null then
    v := regexp_replace(v, '\s+', ' ', 'g');
  end if;

  if p_key = 'preferred_name' then
    if v is not null and (char_length(v) > 40 or v !~ '[[:alpha:]]' or v ~ '[<>@]') then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Use up to 40 characters, with at least one letter, and no @ or angle brackets');
    end if;
    update public.people set preferred_name = v, updated_at = now() where id = p_person;
  elsif p_key = 'area' then
    if v is null or not exists (select 1 from jsonb_array_elements(public.profile_zone_options()) o where o ->> 'value' = v) then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose one from the list');
    end if;
    update public.member_profiles set zone = v, updated_at = now() where person_id = p_person;
  elsif p_key = 'birthday' then
    if v is not null then
      if v !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
        return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose a day and a month');
      end if;
      v_m := split_part(v, '-', 1)::integer;
      v_d := split_part(v, '-', 2)::integer;
      begin
        perform make_date(2024, v_m, v_d);
      exception when others then
        return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'That day does not exist in that month');
      end;
    end if;
    update public.member_profiles set birthday_month = v_m, birthday_day = v_d, updated_at = now() where person_id = p_person;
  else
    -- The person's own words
    v_max := case p_key when 'about_me' then 140 when 'ask_me' then 80 when 'pray_for_me' then 200 else 300 end;
    if p_key = 'gifts' then
      if v is not null then
        select array_agg(x order by n) into v_parts from (select distinct on (b) b as x, n from (select btrim(g) as b, n from unnest(string_to_array(v, ',')) with ordinality as u(g, n)) u2 where b <> '' order by b, n) d;
        if cardinality(v_parts) > 3 then
          return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose up to three');
        end if;
        if exists (select 1 from unnest(v_parts) g where not exists (select 1 from jsonb_array_elements(public.profile_gift_options()) o where o ->> 'value' = g)) then
          return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Choose from the list');
        end if;
        v := array_to_string(v_parts, ',');
      end if;
    elsif v is not null and char_length(v) > v_max then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Keep it to ' || v_max || ' characters');
    elsif v is not null and v ~ '[<>]' then
      return jsonb_build_object('ok', false, 'reason', 'bad_value', 'message', 'Please leave out angle brackets');
    end if;
    if v is null then
      delete from public.profile_story where person_id = p_person and key = p_key;
    else
      insert into public.profile_story (person_id, key, value) values (p_person, p_key, v)
      on conflict (person_id, key) do update set value = excluded.value, updated_at = now();
    end if;
    return jsonb_build_object('ok', true, 'outcome', case when v is null then 'cleared' else 'saved' end);
  end if;

  if v is distinct from v_old then
    insert into public.profile_fact_history (person_id, key, event, old_value, new_value, by_kind, by_person, via, note)
    values (p_person, p_key, 'changed', v_old, v, 'person', p_person, p_via,
            case reg.change_class when 'B' then 'Saved at once. Suggested tribes use it from the next time they are worked out; nobody is moved' else 'Saved at once' end);
  end if;
  return jsonb_build_object('ok', true, 'outcome', case when v is null then 'cleared' else 'saved' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- The answers the person gives from their own page
-- ---------------------------------------------------------------------------
-- A leader's "not me" and "later" are for the private link; the page offers yes and change, for the facts that are asked as a question.
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
  if public.profile_fact_input(p_key) is distinct from 'confirm' then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  return public.profile_fact_answer(me, p_key, p_action, p_value, 'my_page');
end;
$$;

-- The person types or picks one of their own facts, or their own words. Open only while My page and the function that holds the fact are both On.
create function public.my_page_save(p_key text, p_value text default null)
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
  if public.notice_is_young(me) or public.feature_state_of('my_page', me) <> 'on'
     or public.feature_state_of(coalesce(public.profile_fact_feature(p_key), ''), me) <> 'on' then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  return public.profile_fact_save(me, p_key, p_value, 'my_page');
end;
$$;

-- Is My page open for the signed-in person? The account menu and Home ask this, and only this, to know whether to offer the link.
create function public.my_page_open()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  return me is not null and public.feature_state_of('my_page', me) = 'on' and not public.notice_is_young(me);
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role panels
-- ---------------------------------------------------------------------------
-- One short panel for each role a person holds, most senior first, each shown once. It only reads what the role already sees and gives a
-- number or a word and a link to the place that has the whole of it. Nothing about members' private details. Not callable by anyone: my_page_state calls
-- it when Role panels is On.
create function public.my_panels_of(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_roles text[];
  v_centre uuid;
  v_out jsonb := '[]'::jsonb;
  v_status text;
  t record;
  v_names text;
  v_week integer;
  v_step text;
begin
  select coalesce(array_agg(pr.role::text), '{}') into v_roles from public.person_roles pr where pr.person_id = p_person;
  select p.centre_id into v_centre from public.people p where p.id = p_person;

  -- Pastors, directors and the admin: what waits for them
  if v_roles && array['admin', 'pastor', 'director'] then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'office', 'title', 'Waiting for you',
      'lines', jsonb_build_array(
        jsonb_build_object('label', 'Changes waiting for a pastor', 'value', (select count(*) from public.profile_changes c where c.centre_id = v_centre and c.status = 'pending')::text),
        jsonb_build_object('label', 'Tribe Cards waiting for review', 'value', (select count(*) from public.tribes tr join public.seasons se on se.id = tr.season_id
                                                                                   where se.centre_id = v_centre and tr.status = 'submitted')::text),
        jsonb_build_object('label', 'Leader applications with the panel', 'value', (select count(*) from public.leader_applications a join public.people ap on ap.id = a.person_id
                                                                                       where ap.centre_id = v_centre and a.status = 'submitted')::text)),
      'link', jsonb_build_object('label', case when v_roles && array['pastor', 'director'] then 'Open Review' else 'Open Admin' end,
                                 'path', case when v_roles && array['pastor', 'director'] then '/review' else '/admin' end)));
  end if;

  if v_roles && array['data_lead'] then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'data', 'title', 'Reports and files',
      'lines', jsonb_build_array(jsonb_build_object('label', 'Files you made in the last seven days',
                                                    'value', (select count(*) from public.export_log l where l.person_id = p_person and l.at > now() - interval '7 days')::text)),
      'link', jsonb_build_object('label', 'Open Reports', 'path', '/reports')));
  end if;

  if v_roles && array['care_lead'] then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'care', 'title', 'Care',
      'lines', jsonb_build_array(
        jsonb_build_object('label', 'Care tasks open for you', 'value', (select count(*) from public.care_tasks k where k.assigned_to = p_person and k.status = 'open')::text),
        jsonb_build_object('label', 'Calls to make to a parent or guardian', 'value', (select count(*) from public.guardian_consents g join public.people gp on gp.id = g.person_id
                                                                                         where g.status = 'approved' and g.verified_at is null and gp.centre_id = v_centre)::text),
        jsonb_build_object('label', 'Members who say their age range is not right', 'value', (select count(*) from public.profile_office_asks a where a.centre_id = v_centre and a.status = 'open')::text)),
      'link', jsonb_build_object('label', 'Open Care', 'path', '/care')));
  end if;

  if v_roles && array['coach'] then
    select count(*) filter (where true) as walks,
           count(*) filter (where tr.status = 'approved' and se.status = 'running' and se.starts_on <= public.today_lagos() - 14
                              and not exists (select 1 from public.tribe_logs l where l.tribe_id = tr.id and l.logged_at > now() - interval '14 days')) as quiet
      into t
      from public.tribes tr join public.seasons se on se.id = tr.season_id
     where tr.coach_id = p_person and tr.status <> 'closed';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'coach', 'title', 'Your tribes',
      'lines', jsonb_build_array(
        jsonb_build_object('label', 'Tribes you walk with', 'value', t.walks::text),
        jsonb_build_object('label', 'Tribes with no meeting logged for two weeks', 'value', t.quiet::text)),
      'link', jsonb_build_object('label', 'Open the dashboard', 'path', '/dashboard')));
  end if;

  if v_roles && array['community_champion'] then
    select string_agg(c.name, ', ' order by c.sort), count(distinct c.id) into v_names, v_week
      from public.community_champions h join public.communities c on c.id = h.community_id where h.person_id = p_person;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'community', 'title', 'Your community',
      'lines', jsonb_build_array(
        jsonb_build_object('label', case when v_week = 1 then 'Community' else 'Communities' end, 'value', coalesce(v_names, 'None yet')),
        jsonb_build_object('label', 'Tribes in it', 'value', (select count(*) from public.tribes tr
                                                              where tr.status = 'approved' and tr.community_id in (select h.community_id from public.community_champions h where h.person_id = p_person))::text)),
      'link', jsonb_build_object('label', 'Open My community', 'path', '/community')));
  end if;

  if v_roles && array['leader'] then
    select tr.name, tr.status::text as status,
           (select count(*) from public.tribe_members m where m.tribe_id = tr.id and m.status = 'active') as members
      into t
      from public.tribes tr where tr.leader_id = p_person and tr.status <> 'closed' order by tr.created_at desc limit 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'leader', 'title', 'Your tribe',
      'lines', jsonb_build_array(
        jsonb_build_object('label', 'Tribe Card', 'value', case when t.status is null then 'Not started'
                                                                 else case t.status when 'draft' then 'Being written' when 'submitted' then 'With a pastor'
                                                                                     when 'changes_requested' then 'Needs changes' when 'approved' then 'Approved' else t.status end end),
        jsonb_build_object('label', 'People in it', 'value', coalesce(t.members, 0)::text),
        jsonb_build_object('label', 'Training', 'value', case when exists (select 1 from public.leader_certifications lc where lc.person_id = p_person) then 'Certified' else 'Not yet certified' end)),
      'link', jsonb_build_object('label', 'Open Lead a tribe', 'path', '/lead')));
  end if;

  if v_roles && array['assistant_leader'] then
    select tr.name into v_names from public.tribes tr where tr.assistant_id = p_person and tr.status <> 'closed' order by tr.created_at desc limit 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'assistant', 'title', 'Your tribe, as an assistant',
      'lines', jsonb_build_array(
        jsonb_build_object('label', 'Tribe', 'value', coalesce(v_names, 'None yet')),
        jsonb_build_object('label', 'Care tasks open for you', 'value', (select count(*) from public.care_tasks k where k.assigned_to = p_person and k.status = 'open')::text)),
      'link', jsonb_build_object('label', 'Open Lead a tribe', 'path', '/lead')));
  end if;

  -- Someone whose application to lead is not yet decided in their favour
  select a.status::text into v_status from public.leader_applications a where a.person_id = p_person order by a.created_at desc limit 1;
  if v_status is not null and v_status not in ('approved_leader', 'approved_assistant') then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'applicant', 'title', 'Your application to lead',
      'lines', jsonb_build_array(jsonb_build_object('label', 'Where it stands', 'code', v_status)),
      'link', jsonb_build_object('label', 'Open Lead a tribe', 'path', '/lead')));
  end if;

  -- A member: the tribe they are in, the goal they chose, this week's step
  select tr.id as tribe, tr.name, se.starts_on, se.weeks into t
    from public.tribe_members m join public.tribes tr on tr.id = m.tribe_id join public.seasons se on se.id = tr.season_id
   where m.person_id = p_person and m.status = 'active' order by m.joined_at desc limit 1;
  if t.tribe is not null or exists (select 1 from public.member_profiles mp where mp.person_id = p_person) then
    if t.tribe is not null then
      v_week := public.season_week(t.starts_on, t.weeks, public.today_lagos());
      select st.will_text into v_step from public.week_steps st where st.person_id = p_person and st.tribe_id = t.tribe and st.week = v_week;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'member', 'title', 'Your season',
      'lines', jsonb_build_array(
                 jsonb_build_object('label', 'Your tribe', 'value', coalesce(t.name, 'Not placed yet')),
                 jsonb_build_object('label', 'Your season goal', 'value', coalesce((select g.title from public.member_profiles mp join public.season_goals g on g.id = mp.season_goal_id where mp.person_id = p_person), 'Not chosen yet')))
               || case when t.tribe is not null and v_week between 1 and t.weeks then jsonb_build_array(jsonb_build_object('label', 'This week''s step', 'value', coalesce(v_step, 'Not set yet'))) else '[]'::jsonb end,
      'link', jsonb_build_object('label', 'Open My tribe', 'path', '/tribe')));
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- My page
-- ---------------------------------------------------------------------------
-- The page, whole, in one call: the facts asked as a question, the facts typed, the story, the role panels, and where an "Ask the church office" stands.
-- Each part appears only while its own function is On for the person. Off for everything, and for anyone under 18: `enabled: false`.
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
  v_details jsonb := '[]'::jsonb;
  v_story jsonb := '[]'::jsonb;
  v_item jsonb;
  v_in text;
  v_ask public.profile_office_asks;
  v_details_on boolean;
begin
  if me is null then
    return jsonb_build_object('enabled', false);
  end if;
  -- Never for someone under 18: the young people's rules, and their parent's permission, come first (a later stage decides what they see)
  if public.feature_state_of('my_page', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('enabled', false);
  end if;
  v_details_on := public.feature_state_of('my_details', me) = 'on';
  for r in select * from public.profile_fact_registry x where public.profile_fact_applies(me, x.key) order by x.sort loop
    v_in := public.profile_fact_input(r.key);
    if v_in = 'confirm' then
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
    elsif public.feature_state_of(coalesce(public.profile_fact_feature(r.key), ''), me) = 'on' then
      cur := public.profile_fact_current(me, r.key);
      v_item := jsonb_build_object(
        'key', r.key, 'label', r.label, 'question', r.question, 'kind', v_in, 'class', r.change_class,
        'value', cur ->> 'value', 'valueLabel', cur ->> 'label', 'at', cur ->> 'at',
        'options', public.profile_fact_options(r.key),
        'max', case r.key when 'preferred_name' then 40 when 'about_me' then 140 when 'ask_me' then 80 when 'pray_for_me' then 200 else null end,
        'limit', case r.key when 'gifts' then 3 else null end);
      if r.layer = 'story' then
        v_story := v_story || jsonb_build_array(v_item);
      else
        v_details := v_details || jsonb_build_array(v_item);
      end if;
    end if;
  end loop;
  select * into v_ask from public.profile_office_asks a where a.person_id = me order by a.asked_at desc limit 1;
  return jsonb_build_object(
    'enabled', true, 'first', public.first_name_of(me),
    'facts', v_facts, 'details', v_details, 'story', v_story,
    'panels', case when public.feature_state_of('role_panels', me) = 'on' then public.my_panels_of(me) else '[]'::jsonb end,
    'canAsk', v_details_on and public.profile_fact_applies(me, 'age_range'),
    'office', case when not v_details_on or v_ask.id is null or not (v_ask.status = 'open' or v_ask.closed_at > now() - interval '30 days') then null
                   else jsonb_build_object('status', v_ask.status, 'askedAt', v_ask.asked_at, 'closedAt', v_ask.closed_at,
                                           'note', case when v_ask.status = 'done' then v_ask.closing_note end) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Class D: a change across 17 and 18 is never self-service
-- ---------------------------------------------------------------------------
-- A person whose age range is wrong in a way the list cannot fix (the list offers adult ranges only: this is how someone who is really under 18, and
-- was put among adults, can say so) tells the Care Team. Nothing is changed for them. The Care Team speaks to them, and to a parent or guardian, as
-- the young people's rules say. The care lead hears at once; with no care lead, a director; with none, an admin.
create function public.my_office_ask(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_centre uuid;
  v_id uuid;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_state_of('my_page', me) <> 'on' or public.feature_state_of('my_details', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  if not public.profile_fact_applies(me, 'age_range') then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.profile_office_asks a where a.person_id = me and a.key = 'age_range' and a.status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'waiting', 'message', 'The Care Team already has your message');
  end if;
  select p.centre_id into v_centre from public.people p where p.id = me;
  insert into public.profile_office_asks (person_id, key, held_value, note, centre_id)
  values (me, 'age_range', public.profile_fact_current(me, 'age_range') ->> 'value', v_note, v_centre)
  returning id into v_id;
  perform public.write_event(me, 'profile.office_asked', 'profile_office_ask', v_id::text, jsonb_build_object('key', 'age_range'));
  -- The Care Team hears, by the same route as every other care notice (the care lead; with none, the directors; with none, the admins). It says that
  -- someone asked, never who or why: the page has that. A fault here is recorded and never undoes the message.
  begin
    perform public.notify_care(v_centre, 'care_age_ask', 'ageask:' || v_id, '{}'::jsonb, 'Someone says their age range is not right', '/care/teens', true);
  exception when others then
    perform public.notice_fault('profile_office_ask', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'ask', v_id);
end;
$$;

-- The Care Team's side: open messages first, and those closed in the last 30 days.
create function public.profile_office_asks_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.guardian_staff() then
    raise exception 'Only the Care Team can see this' using errcode = '42501';
  end if;
  return jsonb_build_object('asks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'status', a.status, 'person', public.person_display_name(a.person_id), 'held', public.profile_fact_label(a.key, a.held_value),
             'note', a.note, 'askedAt', a.asked_at, 'closedAt', a.closed_at, 'closingNote', a.closing_note)
           order by (a.status = 'open') desc, a.asked_at desc)
      from public.profile_office_asks a
     where a.centre_id = public.my_centre() and (a.status = 'open' or a.closed_at > now() - interval '30 days')), '[]'::jsonb));
end;
$$;

-- The Care Team says it has looked, with a short note the person reads on their page. Nothing about the person's age range is changed here: that
-- is done, if at all, through the young people's rules.
create function public.profile_office_ask_close(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a public.profile_office_asks;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.guardian_staff() then
    raise exception 'Only the Care Team can do this' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  select * into a from public.profile_office_asks x where x.id = p_id for update;
  if not found or a.centre_id is distinct from public.my_centre() then
    raise exception 'We could not find that message' using errcode = 'P0002';
  end if;
  if a.status <> 'open' then
    raise exception 'That message has been closed already' using errcode = '22023';
  end if;
  update public.profile_office_asks set status = 'done', closed_by = me, closed_at = now(), closing_note = v_note where id = a.id;
  perform public.write_event(me, 'profile.office_ask_closed', 'profile_office_ask', a.id::text, jsonb_build_object('key', a.key));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Still right?
-- ---------------------------------------------------------------------------
-- Once a season, on Home: a one-line strip for each fact the person confirms (a stage, an age range) that has not been confirmed or typed since the
-- season began. Nothing is sent. "Not now" hides it for the season, and a person who ignores it keeps what they have. Never while a change is
-- already waiting for a pastor, never for someone under 18.
create function public.still_right_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_centre uuid;
  v_season public.seasons;
  r public.profile_fact_registry;
  cur jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  if me is null
     or public.feature_state_of('my_page', me) <> 'on' or public.feature_state_of('still_right', me) <> 'on' or public.notice_is_young(me) then
    return jsonb_build_object('due', false);
  end if;
  select p.centre_id into v_centre from public.people p where p.id = me;
  select * into v_season from public.seasons s
   where s.centre_id = v_centre and s.status in ('open', 'running') and s.starts_on <= public.today_lagos() order by s.starts_on desc limit 1;
  if not found then
    return jsonb_build_object('due', false);
  end if;
  for r in select * from public.profile_fact_registry x where public.profile_fact_input(x.key) = 'confirm' and public.profile_fact_applies(me, x.key) order by x.sort loop
    cur := public.profile_fact_current(me, r.key);
    continue when cur ->> 'state' = 'none';
    continue when exists (select 1 from public.profile_changes c where c.person_id = me and c.key = r.key and c.status = 'pending');
    continue when exists (select 1 from public.profile_prompts p where p.person_id = me and p.key = r.key and p.season_id = v_season.id);
    continue when cur ->> 'at' is not null and (cur ->> 'at')::timestamptz >= v_season.starts_on::timestamp at time zone 'Africa/Lagos';
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', r.key, 'label', r.label, 'valueLabel', cur ->> 'label', 'options', public.profile_fact_options(r.key)));
  end loop;
  return jsonb_build_object('due', jsonb_array_length(v_items) > 0, 'season', v_season.name, 'items', v_items);
end;
$$;

create function public.still_right_later(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_season public.seasons;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.feature_state_of('my_page', me) <> 'on' or public.feature_state_of('still_right', me) <> 'on' or public.notice_is_young(me)
     or public.profile_fact_input(p_key) is distinct from 'confirm' or not public.profile_fact_applies(me, p_key) then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  select * into v_season from public.seasons s
   where s.centre_id = (select p.centre_id from public.people p where p.id = me) and s.status in ('open', 'running') and s.starts_on <= public.today_lagos()
   order by s.starts_on desc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'off');
  end if;
  insert into public.profile_prompts (person_id, key, season_id) values (me, p_key, v_season.id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Their data
-- ---------------------------------------------------------------------------
-- What this stage and the last one hold about the signed-in person, for their data file ("Download my data" merges it in). Only what exists is named.
create function public.my_profile_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'facts_you_confirmed', (select jsonb_agg(jsonb_build_object(
        'fact', r.label, 'value', public.profile_fact_label(f.key, f.value), 'set_by', f.set_by_kind, 'set_at', f.set_at, 'confirmed_at', f.confirmed_at, 'confirmed_through', f.confirmed_via) order by r.sort)
        from public.profile_facts f join public.profile_fact_registry r on r.key = f.key where f.person_id = me),
    'how_a_fact_changed', (select jsonb_agg(jsonb_build_object(
        'fact', r.label, 'what_happened', h.event, 'was', public.profile_fact_label(h.key, h.old_value), 'became', public.profile_fact_label(h.key, h.new_value),
        'by', h.by_kind, 'through', h.via, 'note', h.note, 'at', h.at) order by h.id)
        from public.profile_fact_history h join public.profile_fact_registry r on r.key = h.key where h.person_id = me),
    'changes_you_asked_a_pastor_for', (select jsonb_agg(jsonb_build_object(
        'fact', r.label, 'from', public.profile_fact_label(c.key, c.old_value), 'to', public.profile_fact_label(c.key, c.new_value),
        'status', c.status, 'asked_at', c.requested_at, 'decided_at', c.decided_at, 'note', c.decision_note) order by c.requested_at)
        from public.profile_changes c join public.profile_fact_registry r on r.key = c.key where c.person_id = me),
    'your_story', (select jsonb_object_agg(r.label, public.profile_fact_label(s.key, s.value))
        from public.profile_story s join public.profile_fact_registry r on r.key = s.key where s.person_id = me),
    'what_you_told_the_care_team', (select jsonb_agg(jsonb_build_object(
        'fact', r.label, 'we_held', public.profile_fact_label(a.key, a.held_value), 'your_note', a.note, 'asked_at', a.asked_at, 'status', a.status,
        'closed_at', a.closed_at, 'their_note', a.closing_note) order by a.asked_at)
        from public.profile_office_asks a join public.profile_fact_registry r on r.key = a.key where a.person_id = me),
    'still_right_not_now', (select jsonb_agg(jsonb_build_object('fact', r.label, 'season', s.name, 'at', p.dismissed_at) order by p.dismissed_at)
        from public.profile_prompts p join public.profile_fact_registry r on r.key = p.key join public.seasons s on s.id = p.season_id where p.person_id = me)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke execute on function
  public.profile_fact_input(p_key text),
  public.profile_fact_feature(p_key text),
  public.profile_zone_options(),
  public.profile_gift_options(),
  public.profile_fact_save(p_person uuid, p_key text, p_value text, p_via text),
  public.my_panels_of(p_person uuid),
  public.my_page_save(p_key text, p_value text),
  public.my_page_open(),
  public.my_office_ask(p_note text),
  public.profile_office_asks_list(),
  public.profile_office_ask_close(p_id uuid, p_note text),
  public.still_right_state(),
  public.still_right_later(p_key text),
  public.my_profile_export()
  from public, anon, authenticated;

grant execute on function
  public.my_page_save(p_key text, p_value text),
  public.my_page_open(),
  public.my_office_ask(p_note text),
  public.profile_office_asks_list(),
  public.profile_office_ask_close(p_id uuid, p_note text),
  public.still_right_state(),
  public.still_right_later(p_key text),
  public.my_profile_export()
  to authenticated;

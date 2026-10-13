-- =============================================================================
-- United Tribes, Stage 4: the rest of the smart intake form, and what the engine does with it.
--
--   member_profiles   relationship, children, work, field, group roles, second-choice tribe,
--                     "open to the next age group", the area they typed, and two notes that
--                     are sealed by the app before they reach the database:
--                       support_enc      what would help care for them (chips and a note)
--                       leader_note_enc  a note for their own leader
--                     plus support_load, the only thing about the first note the engine sees
--   intake_drafts     sealed: the same two notes, sealed, so "finish later" keeps them
--   person_photos     a small portrait (a leader's face on a match card), kept in the database
--                     so there is no file store to run, back up or secure separately
--   match_candidates  adjacent life stage (0.5), second-choice tribe (0.7), group-role balance
--   match_card        carries whether the leader has a photo
--   circle_roster     gives the leader a short brief on each member
--
-- Sealing happens in the app (AES-256-GCM, keys held by the app, never by the database), so a
-- copy of the database alone cannot read a support note. There is no pilot data to carry over:
-- the plain-text column is replaced by a number (0 none, 1 light, 2 heavy) and dropped. If you
-- ever load this on a database that already holds real answers, copy support_needs somewhere
-- safe before applying it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The profile
-- ---------------------------------------------------------------------------

alter table public.member_profiles
  add column relationship text
    check (relationship in ('single', 'courting', 'engaged', 'married', 'widowed', 'separated')),
  add column children text[] not null default '{}'
    check (children <@ array['none', 'expecting', 'under_12', 'teens', 'adult']::text[]),
  add column work_status text
    check (work_status in ('employed', 'self_employed', 'student', 'nysc', 'between_jobs', 'homemaker', 'retired')),
  add column work_field text
    check (work_field in ('finance', 'tech', 'health', 'education', 'creative', 'law_public', 'engineering_trades',
                          'agriculture_food', 'ministry_ngo', 'trade_retail', 'other')),
  add column group_roles text[] not null default '{}'
    check (group_roles <@ array['encourager', 'organiser', 'host', 'thinker', 'peacemaker', 'prayer_warrior',
                                'truth_teller', 'connector']::text[]
           and cardinality(group_roles) <= 2),
  add column second_tribe_id uuid references public.tribes (id),
  add column open_to_adjacent boolean not null default false,
  add column area_slug text check (area_slug ~ '^[a-z0-9-]{1,48}$'),
  add column support_load smallint not null default 0 check (support_load between 0 and 2),
  add column support_enc text check (char_length(support_enc) <= 4000),
  add column leader_note_enc text check (char_length(leader_note_enc) <= 4000),
  add constraint member_profiles_second_tribe_differs check (second_tribe_id is null or second_tribe_id is distinct from tribe_id);

-- Anything written before this existed counts as "light"; the text itself is not kept.
update public.member_profiles
   set support_load = 1
 where support_needs is not null and char_length(btrim(support_needs)) >= 3;
alter table public.member_profiles drop column support_needs;

alter table public.intake_drafts
  add column sealed text check (char_length(sealed) <= 4000);

-- ---------------------------------------------------------------------------
-- Portraits
-- ---------------------------------------------------------------------------

create table public.person_photos (
  person_id uuid primary key references public.people (id) on delete cascade,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) between 100 and 150000),
  updated_at timestamptz not null default now()
);
alter table public.person_photos enable row level security;

-- Saves the signed-in person's portrait. The app shrinks the picture first; this checks again that
-- it is a small, real image of an accepted type, so nothing else can be stored here.
create function public.set_my_photo(p_data text, p_mime text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_bytes bytea;
  v_ok boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Choose a JPEG, PNG or WebP picture' using errcode = '22023';
  end if;
  if p_data is null or char_length(p_data) > 210000 then
    raise exception 'That picture is too large. Choose a smaller one.' using errcode = '22023';
  end if;
  begin
    v_bytes := decode(p_data, 'base64');
  exception when others then
    raise exception 'That picture could not be read' using errcode = '22023';
  end;
  if octet_length(v_bytes) < 100 or octet_length(v_bytes) > 150000 then
    raise exception 'That picture is too large. Choose a smaller one.' using errcode = '22023';
  end if;
  v_ok := case p_mime
    when 'image/jpeg' then get_byte(v_bytes, 0) = 255 and get_byte(v_bytes, 1) = 216 and get_byte(v_bytes, 2) = 255
    when 'image/png'  then get_byte(v_bytes, 0) = 137 and get_byte(v_bytes, 1) = 80 and get_byte(v_bytes, 2) = 78 and get_byte(v_bytes, 3) = 71
    when 'image/webp' then substring(v_bytes from 1 for 4) = '\x52494646'::bytea and substring(v_bytes from 9 for 4) = '\x57454250'::bytea
    else false end;
  if not v_ok then
    raise exception 'That file is not the kind of picture it says it is' using errcode = '22023';
  end if;

  insert into public.person_photos (person_id, mime, data) values (uid, p_mime, v_bytes)
  on conflict (person_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now();
  perform public.write_event(uid, 'photo.saved', 'person', uid::text, jsonb_build_object('bytes', octet_length(v_bytes)));
  return public.my_photo_info();
end;
$$;

create function public.remove_my_photo()
returns void
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
  delete from public.person_photos where person_id = uid;
  perform public.write_event(uid, 'photo.removed', 'person', uid::text, '{}'::jsonb);
end;
$$;

create function public.my_photo_info()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('has', exists (select 1 from public.person_photos where person_id = (select auth.uid())),
                            'updated_at', (select updated_at from public.person_photos where person_id = (select auth.uid())));
$$;

-- Who may see whose face: yourself; anyone who leads, assists or coaches a circle (members see them on cards);
-- and the people who run the programme.
create function public.photo_of(p_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p public.person_photos%rowtype;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into p from public.person_photos where person_id = p_person;
  if not found then
    return null;
  end if;
  if p_person <> uid
     and not exists (select 1 from public.circles c where p_person in (c.leader_id, c.assistant_id, c.coach_id))
     and not public.has_any_role(array['admin', 'director', 'pastor', 'coach', 'care_lead', 'data_lead']::public.app_role[]) then
    return null;
  end if;
  return jsonb_build_object('mime', p.mime, 'data', replace(encode(p.data, 'base64'), E'\n', ''), 'updated_at', p.updated_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------

-- Up to three reasons, as keys. New: "second choice" and "a nearby stage of life" say what they are.
create or replace function public.match_reasons(
  p_goal numeric, p_stage numeric, p_tribe numeric, p_place numeric, p_online boolean,
  p_rhythm numeric, p_balance numeric, p_affinity numeric, p_faith numeric, p_weights jsonb
)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t.key order by t.strength desc, t.key), '{}'::text[])
  from (
    select k.key, k.strength
      from (values
        (case when p_goal >= 1 then 'goal_same' when p_goal >= 0.6 then 'goal_family' end,
           p_goal * (p_weights ->> 'goal')::numeric),
        (case when p_stage >= 1 then 'stage_same' when p_stage >= 0.5 then 'stage_near' end,
           p_stage * (p_weights ->> 'stage')::numeric),
        (case when p_tribe >= 1 then 'tribe_same' when p_tribe >= 0.7 then 'tribe_second' when p_tribe >= 0.3 then 'tribe_related' end,
           p_tribe * (p_weights ->> 'tribe')::numeric),
        (case when p_place >= 1 and p_online then 'place_online' when p_place >= 1 then 'place_same'
              when p_place >= 0.6 then 'place_near' end,
           p_place * (p_weights ->> 'place')::numeric),
        ('rhythm_fit', p_rhythm * (p_weights ->> 'rhythm')::numeric),
        (case when p_affinity >= 0.7 then 'style_leader' end, p_affinity * (p_weights ->> 'style')::numeric * 0.5),
        (case when p_balance >= 0.65 then 'style_balance' end, p_balance * (p_weights ->> 'style')::numeric * 0.5),
        (case when p_faith >= 1 then 'faith_needed' end, p_faith * (p_weights ->> 'faith')::numeric),
        -- Always last, so there are always three
        ('seats_open', 0.01::numeric)
      ) as k (key, strength)
     where k.key is not null
     order by k.strength desc, k.key
     limit 3
  ) t;
$$;

-- Every open circle that passes the hard rules for this member, scored. Not limited to three.
create or replace function public.match_candidates(p_person uuid)
returns table (
  r_circle uuid, r_degree integer,
  r_goal numeric, r_stage numeric, r_tribe numeric, r_place numeric, r_style numeric, r_rhythm numeric, r_faith numeric,
  r_balance numeric, r_affinity numeric, r_online boolean, r_seats integer, r_published timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.member_profiles%rowtype;
  my_track uuid;
  my_sort integer;
  my_family uuid;
  w jsonb;
  my_est boolean;
  my_heavy boolean;
begin
  select * into me from public.member_profiles where person_id = p_person;
  if not found then
    return;
  end if;
  select ar.track_id, t.sort into my_track, my_sort
    from public.age_ranges ar join public.tracks t on t.id = ar.track_id
   where ar.id = me.age_range_id;
  select sg.family_id into my_family from public.season_goals sg where sg.id = me.season_goal_id;
  select mm.weights into w from public.match_models mm where mm.active;
  my_est := me.faith_journey in ('established', 'leading');
  my_heavy := me.support_load >= 2;

  return query
  with pool as (
    select c.id, c.capacity, c.leader_id, c.tribe_id, c.track_id, c.season_goal_id, c.meeting_mode, c.zone, c.published_at,
           sg.family_id as goal_family,
           (select a.answers #>> '{style,leadBest}'
              from public.leader_applications a
             where a.person_id = c.leader_id and a.status = 'approved_leader'
             order by a.decided_at desc nulls last limit 1) as lead_style
      from public.circles c
      left join public.season_goals sg on sg.id = c.season_goal_id
     where c.status = 'approved'
       and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id)
       and (me.season_id is null or c.season_id = me.season_id)
       -- their own life stage, or the next one up or down if they said that would be fine
       and (c.track_id = my_track
            or (me.open_to_adjacent
                and exists (select 1 from public.tracks ct
                             where ct.id = c.track_id and ct.active and abs(ct.sort - my_sort) = 1)))
       and c.leader_id <> p_person
       and (c.assistant_id is null or c.assistant_id <> p_person)
       -- the member can make the time
       and (cardinality(me.meeting_times) = 0 or c.slot = any (me.meeting_times))
       -- the member can make the format
       and (me.meeting_mode = 'either' or me.meeting_mode::text = c.meeting_mode)
       and (c.meeting_mode = 'online' or me.zone in ('iganmu-surulere', 'mainland', 'island-lekki'))
       -- the circle is for them
       and (case c.circle_type
              when 'mixed' then me.circle_mix <> 'same_gender'
              when 'women' then me.gender = 'female' and me.circle_mix <> 'mixed'
              when 'men'   then me.gender = 'male'   and me.circle_mix <> 'mixed'
              else false end)
  ),
  mix as (
    select p.id as cid,
           count(cm.id) as n,
           coalesce(sum(mp.style_social), 0) as soc_sum,
           count(*) filter (where mp.style_social = -1) as quiet_n,
           count(*) filter (where mp.style_social = 1) as lively_n,
           count(*) filter (where mp.faith_journey in ('established', 'leading')) as est_n,
           count(*) filter (where mp.faith_journey = me.faith_journey) as same_stage_n,
           count(*) filter (where mp.support_load >= 2) as heavy_n
      from pool p
      left join public.circle_members cm on cm.circle_id = p.id and cm.status = 'active'
      left join public.member_profiles mp on mp.person_id = cm.person_id
     group by p.id
  ),
  open_ones as (
    select p.*, x.n, x.soc_sum, x.same_stage_n
      from pool p
      join mix x on x.cid = p.id
     where p.capacity - x.n >= 1
       -- circle health: no more than two heavy-support members
       and not (my_heavy and x.heavy_n >= 2)
       -- ...at least two established believers, still reachable with the seats that are left
       and greatest(0, 2 - (x.est_n + case when my_est then 1 else 0 end)) <= p.capacity - x.n - 1
       -- ...quiet and lively members both present, still reachable
       and ((case when (x.quiet_n + (case when me.style_social = -1 then 1 else 0 end)) = 0 then 1 else 0 end)
          + (case when (x.lively_n + (case when me.style_social = 1 then 1 else 0 end)) = 0 then 1 else 0 end)) <= p.capacity - x.n - 1
  ),
  comp as (
    select o.id, o.capacity, o.n, o.published_at, (o.meeting_mode = 'online') as online,
           case when o.season_goal_id = me.season_goal_id then 1.0
                when me.season_goal_id is not null and o.goal_family = my_family then 0.6
                else 0.2 end as c_goal,
           case when o.track_id = my_track then 1.0 else 0.5 end as c_stage,
           case when me.tribe_id is not null and o.tribe_id = me.tribe_id then 1.0
                when me.second_tribe_id is not null and o.tribe_id = me.second_tribe_id then 0.7
                when my_family is not null and o.goal_family = my_family then 0.3
                else 0.1 end as c_tribe,
           case when o.meeting_mode = 'online' then 1.0
                when o.zone = me.zone then 1.0
                when (o.zone, me.zone) in (('iganmu-surulere', 'mainland'), ('mainland', 'iganmu-surulere'),
                                           ('mainland', 'island-lekki'), ('island-lekki', 'mainland'),
                                           ('iganmu-surulere', 'island-lekki'), ('island-lekki', 'iganmu-surulere')) then 0.6
                else 0.2 end as c_place,
           0.5 * (case when me.meeting_mode::text = o.meeting_mode then 1.0 else 0.8 end)
             + 0.5 * (case when cardinality(me.meeting_times) = 0 then 0.7 else 1.0 end) as c_rhythm,
           case when o.n = 0 or me.style_social = 0 then 0.6
                else greatest(0.0, least(1.0, 0.5 + 0.5 * (abs(o.soc_sum::numeric / o.n)
                                                          - abs((o.soc_sum + me.style_social)::numeric / (o.n + 1))))) end as c_social,
           -- Does this person bring a role the circle is short of? A role two others already hold counts for less.
           case when cardinality(me.group_roles) = 0 then null
                else (select avg(case when (select count(*)
                                              from public.circle_members cm2
                                              join public.member_profiles mp2 on mp2.person_id = cm2.person_id
                                             where cm2.circle_id = o.id and cm2.status = 'active' and r = any (mp2.group_roles)) < 2
                                      then 1.0 else 0.4 end)
                        from unnest(me.group_roles) as r) end as c_roles,
           public.lead_affinity(o.lead_style, me.style_social, me.style_structure, me.style_openness,
                                me.style_disclosure, me.style_learning) as c_affinity,
           case when o.n = 0 then 0.8
                when o.same_stage_n::numeric / o.n <= 0.34 then 1.0
                else 0.6 end as c_faith
      from open_ones o
  ),
  scored as (
    select k.*,
           case when k.c_roles is null then k.c_social else 0.75 * k.c_social + 0.25 * k.c_roles end as c_balance
      from comp k
  )
  select k.id,
         round(
           (w ->> 'goal')::numeric * k.c_goal + (w ->> 'stage')::numeric * k.c_stage
         + (w ->> 'tribe')::numeric * k.c_tribe + (w ->> 'place')::numeric * k.c_place
         + (w ->> 'style')::numeric * (0.5 * k.c_balance + 0.5 * k.c_affinity)
         + (w ->> 'rhythm')::numeric * k.c_rhythm + (w ->> 'faith')::numeric * k.c_faith)::integer,
         k.c_goal, k.c_stage, k.c_tribe, k.c_place, (0.5 * k.c_balance + 0.5 * k.c_affinity), k.c_rhythm, k.c_faith,
         k.c_balance, k.c_affinity, k.online, (k.capacity - k.n)::integer, k.published_at
    from scored k;
end;
$$;

-- What a member is allowed to see of a circle before and after joining. A leader's first name and, if they added one, face.
create or replace function public.match_card(p_circle uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'tribe', tr.name,
    'track', t.name,
    'goal', g.title,
    'circle_type', c.circle_type,
    'story', c.story,
    'leader_first_name', public.first_name_of(c.leader_id),
    'leader_photo_id', case when exists (select 1 from public.person_photos pp where pp.person_id = c.leader_id)
                            then c.leader_id end,
    'meeting_day', c.meeting_day,
    'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
    'duration_minutes', c.duration_minutes,
    'mode', c.meeting_mode,
    'zone', c.zone,
    'place_note', c.place_note,
    'capacity', c.capacity,
    'seats_left', c.capacity - (select count(*) from public.circle_members cm where cm.circle_id = c.id and cm.status = 'active'),
    'open', c.status = 'approved' and exists (select 1 from public.leader_certifications lc where lc.person_id = c.leader_id),
    'god', c.loving_god,
    'others', c.loving_others,
    'life', c.loving_life,
    'season_starts_on', s.starts_on
  )
  from public.circles c
  join public.seasons s on s.id = c.season_id
  left join public.tracks t on t.id = c.track_id
  left join public.tribes tr on tr.id = c.tribe_id
  left join public.season_goals g on g.id = c.season_goal_id
  where c.id = p_circle;
$$;

-- The roster, for the people who run the circle. Each member shares a name and, only if they said yes to WhatsApp, a number.
-- New: a short brief the member wrote for their leader. The sealed note is passed through for the app to open, and only to
-- the leader and assistant, never to a coach, pastor or director.
create or replace function public.circle_roster(p_circle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c public.circles%rowtype;
  v_leads boolean;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into c from public.circles where id = p_circle;
  if not found then
    raise exception 'That circle does not exist' using errcode = 'P0002';
  end if;
  if not (c.leader_id = uid or coalesce(c.assistant_id = uid, false) or coalesce(c.coach_id = uid, false)
          or public.has_any_role(array['pastor', 'director']::public.app_role[])) then
    raise exception 'You do not run this circle' using errcode = '42501';
  end if;
  v_leads := c.leader_id = uid or coalesce(c.assistant_id = uid, false);
  return jsonb_build_object(
    'circle', jsonb_build_object(
      'id', c.id, 'name', c.name, 'status', c.status, 'capacity', c.capacity,
      'group_url', c.whatsapp_group_url, 'first_meeting_on', c.first_meeting_on,
      'meeting_day', c.meeting_day, 'meeting_time', to_char(c.meeting_time, 'HH24:MI'),
      'season_starts_on', (select s.starts_on from public.seasons s where s.id = c.season_id),
      'can_edit', v_leads),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'person_id', m.person_id,
               'name', public.person_display_name(m.person_id),
               'first_name', public.first_name_of(m.person_id),
               'whatsapp', mp.whatsapp,
               'joined_at', m.joined_at,
               'first_meeting_by', m.first_meeting_by,
               'called', m.called_at is not null,
               'called_at', m.called_at,
               'roles', to_jsonb(coalesce(mp.group_roles, '{}'::text[])),
               'success', mp.success_statement,
               'note_enc', case when v_leads then mp.leader_note_enc end) order by m.joined_at)
        from public.circle_members m
        left join public.member_profiles mp on mp.person_id = m.person_id
       where m.circle_id = c.id and m.status = 'active'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.set_my_photo(text, text),
  public.remove_my_photo(),
  public.my_photo_info(),
  public.photo_of(uuid),
  public.match_reasons(numeric, numeric, numeric, numeric, boolean, numeric, numeric, numeric, numeric, jsonb),
  public.match_candidates(uuid),
  public.match_card(uuid),
  public.circle_roster(uuid)
  from public, anon, authenticated;

grant execute on function
  public.set_my_photo(text, text),
  public.remove_my_photo(),
  public.my_photo_info(),
  public.photo_of(uuid),
  public.circle_roster(uuid)
  to authenticated;

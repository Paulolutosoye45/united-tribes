-- =============================================================================
-- Fix 7: map every head-of-department (HOD) leader and find the missing ones
-- =============================================================================
-- The platform could not say whether leaders on the HOD lists had been left out. This adds a report that reads a list of leaders (name, email or phone, department,
-- goal if known) and says, for each row, where that person stands, and which leaders on the platform are not on the list.
--
-- Each row of the list gets one result:
--   appointed    already a leader on the platform (an active appointment, or leading a tribe)
--   has_account  has an account, not appointed yet (the note says if they already hold the leader role)
--   no_account   nobody on the platform has this email or number (the note says if there is no email address to invite)
--   duplicate    the same person is on the list more than once (the note says which line came first)
--   unclear      nothing to go on, an email or number that is not valid, or an email and a number that belong to different people
-- A person is matched by email, or by any number they have given us (contact number, WhatsApp number, sign-in number), written in any usual way (0803…, +234803…).
--
-- Then, each a separate tap by the people who may act: tag the appointed leaders with the department on the list (a label only, and never over one already set), and send
-- the existing leader invitation to the people with no account yet (an admin or a director). Nothing is sent when a report is made, and the report can be reopened later:
-- it is read again from the platform each time, so a person who has since signed in or been appointed shows as such.
--
-- The report holds the contacts that were uploaded, so it can be deleted. The data lead can read a report without the contacts. Nothing here appoints anyone.
-- No existing function is replaced.
-- =============================================================================

do $guard$
begin
  if to_regprocedure('public.leader_cards_role()') is null or to_regprocedure('public.leader_card_rows(uuid)') is null or to_regprocedure('public.referee_phone_norm(text)') is null then
    raise exception 'Apply the earlier packages first (20270110000100_leader_cards.sql defines leader_card_rows).';
  end if;
end
$guard$;

create table public.hod_reconciles (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres (id) on delete cascade,
  made_by uuid references public.people (id) on delete set null,
  made_at timestamptz not null default now(),
  note text check (char_length(note) <= 200),
  rows_n integer not null check (rows_n between 1 and 500),
  -- How the list stood the day it was read (the report itself is read fresh each time)
  counts jsonb not null default '{}'::jsonb,
  tagged_at timestamptz,
  tagged_by uuid references public.people (id) on delete set null,
  invited_at timestamptz,
  invited_by uuid references public.people (id) on delete set null,
  invited_n integer
);
create index hod_reconciles_centre_idx on public.hod_reconciles (centre_id, made_at desc);
alter table public.hod_reconciles enable row level security;
revoke all on table public.hod_reconciles from public, anon, authenticated;

create table public.hod_reconcile_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.hod_reconciles (id) on delete cascade,
  line integer not null check (line >= 1),
  name text check (char_length(name) <= 120),
  email text check (char_length(email) <= 200),
  phone text check (char_length(phone) <= 40),
  department text check (char_length(department) <= 60),
  goal text check (char_length(goal) <= 120),
  unique (run_id, line)
);
alter table public.hod_reconcile_rows enable row level security;
revoke all on table public.hod_reconcile_rows from public, anon, authenticated;

create function public.hod_email_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when lower(btrim(coalesce(p_text, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then lower(btrim(p_text)) end;
$$;

-- Where each row of a report stands, now. Everything the report says comes from here.
create function public.hod_results(p_run uuid)
returns table (line integer, name text, email text, email_n text, phone text, department text, goal text, result text, person_id uuid, note text, leader_dept text)
language sql
stable
security definer
set search_path = ''
as $$
  with run as (select h.id, h.centre_id from public.hod_reconciles h where h.id = p_run),
  r as (
    select x.line, x.name, x.email, x.phone, x.department, x.goal,
           public.hod_email_norm(x.email) as e, public.referee_phone_norm(x.phone) as ph
      from public.hod_reconcile_rows x join run on run.id = x.run_id),
  phones as (
    select cp.person_id as pid, public.referee_phone_norm(cp.phone) as ph from public.contact_preferences cp
    union select mp.person_id, public.referee_phone_norm(mp.whatsapp) from public.member_profiles mp
    union select u.id, public.referee_phone_norm(u.phone) from auth.users u),
  cand as (
    select r.line, p.id as pid from r join run on true join public.people p on p.centre_id = run.centre_id and not p.hidden and lower(p.email) = r.e where r.e is not null
    union
    select r.line, p.id from r join run on true join phones ph on ph.ph = r.ph join public.people p on p.id = ph.pid and p.centre_id = run.centre_id and not p.hidden
     where r.ph is not null),
  hit as (select c.line, count(distinct c.pid) as n, (array_agg(distinct c.pid))[1] as pid from cand c group by c.line),
  leaders as (
    select lr.person_id as pid from run, public.leader_card_rows(run.centre_id) lr
    union select a.person_id from public.leader_appointments a where a.status = 'active'),
  base as (
    select r.*, coalesce(h.n, 0) as n, case when coalesce(h.n, 0) = 1 then h.pid end as pid,
           coalesce(case when coalesce(h.n, 0) = 1 then h.pid::text end, r.e, r.ph) as key
      from r left join hit h on h.line = r.line),
  ranked as (
    select b.*, row_number() over (partition by b.key order by b.line) as rn, first_value(b.line) over (partition by b.key order by b.line) as first_line
      from base b)
  select k.line, k.name, k.email, k.e, k.phone, k.department, k.goal,
         case when coalesce(btrim(k.name), '') = '' and coalesce(btrim(k.email), '') = '' and coalesce(btrim(k.phone), '') = '' then 'unclear'
              when k.key is not null and k.rn > 1 then 'duplicate'
              when k.n > 1 then 'unclear'
              when k.n = 0 and k.e is null and k.ph is null then 'unclear'
              when k.pid is not null and exists (select 1 from leaders l where l.pid = k.pid) then 'appointed'
              when k.pid is not null then 'has_account'
              else 'no_account' end,
         k.pid,
         case when coalesce(btrim(k.name), '') = '' and coalesce(btrim(k.email), '') = '' and coalesce(btrim(k.phone), '') = '' then 'There is nothing on this row to go on'
              when k.key is not null and k.rn > 1 then 'The same person as line ' || k.first_line
              when k.n > 1 then 'The email and the number belong to different people'
              when k.n = 0 and k.e is null and k.ph is null and coalesce(btrim(k.email), '') <> '' then 'This is not an email address'
              when k.n = 0 and k.e is null and k.ph is null and coalesce(btrim(k.phone), '') <> '' then 'This is not a phone number we can read'
              when k.n = 0 and k.e is null and k.ph is null then 'There is no email address or number'
              when k.pid is not null and not exists (select 1 from leaders l where l.pid = k.pid)
                   and exists (select 1 from public.person_roles pr where pr.person_id = k.pid and pr.role = 'leader') then 'Already holds the leader role'
              when k.pid is null and k.n = 0 and k.e is null then 'There is no email address to invite'
              end,
         (select d.department from public.leader_departments d where d.person_id = k.pid)
    from ranked k
   order by k.line;
$$;

-- Makes a report from a list. Nothing is sent and nobody is changed.
create function public.hod_reconcile_run(p_rows jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
  v_counts jsonb;
  e jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can do this' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The list is empty' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Use up to 500 people at a time' using errcode = '22023';
  end if;
  insert into public.hod_reconciles (centre_id, made_by, note, rows_n) values (public.my_centre(), auth.uid(), left(nullif(btrim(coalesce(p_note, '')), ''), 200), jsonb_array_length(p_rows))
  returning id into v_id;
  for e in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    if jsonb_typeof(e) <> 'object' then
      continue;
    end if;
    insert into public.hod_reconcile_rows (run_id, line, name, email, phone, department, goal)
    values (v_id, coalesce((e ->> 'line')::integer, v_n), left(nullif(btrim(e ->> 'name'), ''), 120), left(nullif(btrim(e ->> 'email'), ''), 200),
            left(nullif(btrim(e ->> 'phone'), ''), 40), left(nullif(btrim(e ->> 'department'), ''), 60), left(nullif(btrim(e ->> 'goal'), ''), 120))
    on conflict (run_id, line) do nothing;
  end loop;
  select coalesce(jsonb_object_agg(x.result, x.n), '{}'::jsonb) into v_counts
    from (select r.result, count(*) as n from public.hod_results(v_id) r group by r.result) x;
  update public.hod_reconciles set counts = v_counts where id = v_id;
  perform public.write_event(auth.uid(), 'hod.reconcile', 'hod', v_id::text, jsonb_build_object('rows', jsonb_array_length(p_rows), 'counts', v_counts));
  return jsonb_build_object('id', v_id, 'counts', v_counts);
end;
$$;

-- A report, read fresh from the platform. The contacts are for the people who may act; the data lead reads names, departments and results.
create function public.hod_reconcile_get(p_run uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.leader_cards_role();
  h public.hod_reconciles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_role is null then
    raise exception 'Your role does not include this report' using errcode = '42501';
  end if;
  select * into h from public.hod_reconciles x where x.id = p_run and x.centre_id = public.my_centre();
  if not found then
    raise exception 'That report is not available' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'role', v_role,
    'run', jsonb_build_object('id', h.id, 'made_at', h.made_at, 'rows', h.rows_n, 'note', h.note, 'tagged_at', h.tagged_at, 'invited_at', h.invited_at, 'invited_n', h.invited_n,
                              'by', case when h.made_by is null then null else public.person_display_name(h.made_by) end),
    'rows', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'line', r.line, 'name', r.name, 'department', r.department, 'goal', r.goal, 'result', r.result, 'note', r.note,
               'leader_dept', r.leader_dept,
               'email', case when v_role = 'act' then r.email end, 'phone', case when v_role = 'act' then r.phone end))
             order by r.line)
        from public.hod_results(p_run) r), '[]'::jsonb),
    -- Leaders on the platform who are not on the list (by who they are, not by what department was typed)
    'missing', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', public.person_display_name(m.person_id), 'tribe', m.tribe, 'department', m.department, 'state', m.state))
             order by m.department nulls last, public.person_display_name(m.person_id))
        from public.leader_card_rows(h.centre_id) m
       where not exists (select 1 from public.hod_results(p_run) r where r.person_id = m.person_id)), '[]'::jsonb));
end;
$$;

create function public.hod_reconcile_list()
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
  if public.leader_cards_role() is null then
    raise exception 'Your role does not include this report' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'role', public.leader_cards_role(),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'made_at', h.made_at, 'rows', h.rows_n, 'note', h.note, 'counts', h.counts, 'tagged_at', h.tagged_at, 'invited_at', h.invited_at)
                       order by h.made_at desc)
        from (select * from public.hod_reconciles x where x.centre_id = public.my_centre() order by x.made_at desc limit 20) h), '[]'::jsonb));
end;
$$;

-- Puts the department on the list on each appointed leader who has none. A label only: a department already set is never changed.
create function public.hod_reconcile_tag(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tagged integer;
  v_differs integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can do this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hod_reconciles x where x.id = p_run and x.centre_id = public.my_centre()) then
    raise exception 'That report is not available' using errcode = 'P0002';
  end if;
  with t as (
    select distinct on (r.person_id) r.person_id, btrim(r.department) as department
      from public.hod_results(p_run) r
     where r.result = 'appointed' and r.person_id is not null and char_length(btrim(coalesce(r.department, ''))) between 2 and 60
     order by r.person_id, r.line)
  insert into public.leader_departments (person_id, department, set_by) select t.person_id, t.department, auth.uid() from t on conflict (person_id) do nothing;
  get diagnostics v_tagged = row_count;
  select count(*)::integer into v_differs
    from public.hod_results(p_run) r
   where r.result = 'appointed' and r.leader_dept is not null and char_length(btrim(coalesce(r.department, ''))) > 0 and lower(btrim(r.department)) <> lower(r.leader_dept);
  update public.hod_reconciles set tagged_at = now(), tagged_by = auth.uid() where id = p_run;
  perform public.write_event(auth.uid(), 'hod.tag', 'hod', p_run::text, jsonb_build_object('tagged', v_tagged, 'differs', v_differs));
  return jsonb_build_object('tagged', v_tagged, 'differs', v_differs);
end;
$$;

-- Sends the existing leader invitation to each person with no account yet who has an email address. Once for a report. An admin or a director, as inviting anyone is.
create function public.hod_reconcile_invite(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.hod_reconciles%rowtype;
  v_n integer := 0;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.has_any_role(array['admin', 'director']::public.app_role[]) then
    raise exception 'Only an admin or a director can send invitations' using errcode = '42501';
  end if;
  select * into h from public.hod_reconciles x where x.id = p_run and x.centre_id = public.my_centre() for update;
  if not found then
    raise exception 'That report is not available' using errcode = 'P0002';
  end if;
  if h.invited_at is not null then
    raise exception 'The invitations for this report have already been sent' using errcode = '22023';
  end if;
  for v_email in
    select distinct r.email_n from public.hod_results(p_run) r where r.result = 'no_account' and r.email_n is not null order by 1 limit 200
  loop
    perform public.invite_person(v_email, 'leader');
    v_n := v_n + 1;
  end loop;
  update public.hod_reconciles set invited_at = now(), invited_by = auth.uid(), invited_n = v_n where id = p_run;
  perform public.write_event(auth.uid(), 'hod.invite', 'hod', p_run::text, jsonb_build_object('invited', v_n));
  return jsonb_build_object('invited', v_n);
end;
$$;

-- Removes a report and the contacts it holds.
create function public.hod_reconcile_delete(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.leader_cards_role() is distinct from 'act' then
    raise exception 'Only an admin, a director or a pastor can do this' using errcode = '42501';
  end if;
  delete from public.hod_reconciles where id = p_run and centre_id = public.my_centre();
  if not found then
    raise exception 'That report is not available' using errcode = 'P0002';
  end if;
  perform public.write_event(auth.uid(), 'hod.delete', 'hod', p_run::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.hod_email_norm(text), public.hod_results(uuid) from public, anon, authenticated;
revoke execute on function
  public.hod_reconcile_run(jsonb, text), public.hod_reconcile_get(uuid), public.hod_reconcile_list(), public.hod_reconcile_tag(uuid), public.hod_reconcile_invite(uuid),
  public.hod_reconcile_delete(uuid)
  from public, anon;
grant execute on function
  public.hod_reconcile_run(jsonb, text), public.hod_reconcile_get(uuid), public.hod_reconcile_list(), public.hod_reconcile_tag(uuid), public.hod_reconcile_invite(uuid),
  public.hod_reconcile_delete(uuid)
  to authenticated;

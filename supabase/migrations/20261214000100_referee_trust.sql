-- =============================================================================
-- Round 2, Phase 2: prove the referee is the person named
-- =============================================================================
-- Until now the applicant made the referee's link, saw it, and could open it. This release takes the applicant out of the chain:
--
--   * the system sends the link straight to the referee's WhatsApp, text or email. The applicant never sees it
--     (renew_referee_link and send_referee_link are gone), and sees only a status: sent, opened, verified, answered
--   * opening the link is not enough: the referee asks for a six-digit code at the same contact and types it in. Five wrong tries lock it
--   * a referee's contact must differ from the applicant's own, and from the other referee; a contact outside the church's list
--     cannot serve several applicants; temporary email addresses are refused; a referee can be changed twice per slot, each change logged
--   * the pastorate keeps a directory of pastors, unit heads and ministry leaders (imported from a spreadsheet, kept up to date by
--     uploading again). A referee whose contact is in it is "verified from the directory", and the system, not a tick box, sets
--     pastor-or-unit-head status. Anyone else is a "verified contact": their ratings count, but they only satisfy the gate if a pastor
--     confirms them in one tap
--   * integrity flags (not blocks): the same browser as the applicant, the same network, finished in under 40 seconds, the same
--     ratings as the other referee, a note that reads like the applicant's own writing, a link opened from many networks. A reference with a
--     hold flag is left out of the readiness score until a pastor clears it
--   * every flagged reference, and a random 20% of the rest, becomes a call-back task for the care team
--   * references already received stay valid, marked "not verified"; a pastor can send those referees a re-verify message. Nothing is deleted
--
-- Additive only: no table is dropped and no row is deleted. Two applicant-facing functions that handed out secrets are removed
-- (renew_referee_link, send_referee_link); get_reference_request and the seven-argument submit_reference are replaced.
-- Requires the Phase 1 release (leader_answer_prints) and the Messages and reminders release (claim_prepare, today_lagos).
--
--   referee_settings            the few numbers the pastorate may change
--   referee_directory           pastors, unit heads and ministry leaders; referee_directory_contacts their phones and emails
--   referee_import_batches      every spreadsheet upload, with a history that lets the latest be undone
--   referee_trust               what has been proved about each referee (staff only)
--   referee_access              the one-time code, the session after it, and the networks the link was opened from (never readable)
--   leader_reference_flags      integrity flags, with who cleared them and why
--   referee_callbacks           the call-back queue for the care team
--   applicant_sessions          a salted hash of each applicant's network and browser, kept 45 days
--   referee_changes             who was replaced, when
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.referee_settings (
  id boolean primary key default true check (id),
  -- Which directory standings satisfy the "one referee is a pastor or unit head" gate.
  gate_standings text[] not null default array['pastor', 'unit_head']
    check (gate_standings <@ array['pastor', 'unit_head', 'ministry_leader']::text[] and cardinality(gate_standings) >= 1),
  -- The share of references (besides every flagged one) the care team calls back.
  callback_pct smallint not null default 20 check (callback_pct between 0 and 100),
  -- Finishing the ratings faster than this is flagged.
  min_seconds smallint not null default 40 check (min_seconds between 0 and 600),
  code_minutes smallint not null default 10 check (code_minutes between 3 and 60),
  max_tries smallint not null default 5 check (max_tries between 3 and 10),
  lock_minutes smallint not null default 30 check (lock_minutes between 5 and 1440),
  max_changes smallint not null default 2 check (max_changes between 0 and 5),
  link_days smallint not null default 30 check (link_days between 7 and 90),
  sends_per_day smallint not null default 3 check (sends_per_day between 1 and 10),
  updated_by uuid references public.people (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.referee_settings (id) values (true);

create function public.referee_cfg()
returns public.referee_settings
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.referee_settings where id is true;
$$;

-- ---------------------------------------------------------------------------
-- The directory
-- ---------------------------------------------------------------------------

create table public.referee_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  standing text not null check (standing in ('pastor', 'unit_head', 'ministry_leader')),
  unit text check (char_length(unit) <= 80),
  note text check (char_length(note) <= 200),
  -- A person who has left is retired, not deleted, so the history still reads.
  active boolean not null default true,
  last_batch uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index referee_directory_active_idx on public.referee_directory (active, lower(name));
create trigger referee_directory_touch before update on public.referee_directory
  for each row execute function public.touch_updated_at();

-- Every phone (international form) and email (lower case) of a person. A contact belongs to one person only.
create table public.referee_directory_contacts (
  entry_id uuid not null references public.referee_directory (id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  value text not null check (char_length(value) between 5 and 120),
  primary key (entry_id, value),
  unique (value)
);

create table public.referee_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  filename text check (char_length(filename) <= 120),
  mode text not null check (mode in ('update', 'replace')),
  rows_total integer not null default 0,
  added integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  retired integer not null default 0,
  errors integer not null default 0,
  status text not null default 'applied' check (status in ('applied', 'undone')),
  undone_at timestamptz,
  undone_by uuid references public.people (id) on delete set null
);
create index referee_import_batches_idx on public.referee_import_batches (created_at desc);

-- What each person looked like before a batch changed them, so the latest batch can be undone.
create table public.referee_directory_history (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.referee_import_batches (id) on delete cascade,
  entry_id uuid not null,
  action text not null check (action in ('add', 'update', 'retire', 'revive')),
  before jsonb
);
create index referee_directory_history_batch_idx on public.referee_directory_history (batch_id, id);

-- Email domains that hand out throwaway inboxes. A referee at one of these is refused.
create table public.referee_blocked_domains (
  domain text primary key check (domain = lower(domain))
);
insert into public.referee_blocked_domains (domain) values
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamail.biz'),
  ('guerrillamail.de'), ('guerrillamailblock.com'), ('sharklasers.com'), ('grr.la'), ('10minutemail.com'),
  ('10minutemail.net'), ('20minutemail.com'), ('temp-mail.org'), ('temp-mail.io'), ('tempmail.com'),
  ('tempmail.net'), ('tempmailo.com'), ('tempr.email'), ('tempail.com'), ('tempinbox.com'), ('yopmail.com'),
  ('yopmail.fr'), ('yopmail.net'), ('trashmail.com'), ('trashmail.net'), ('throwawaymail.com'), ('getnada.com'),
  ('nada.email'), ('maildrop.cc'), ('dispostable.com'), ('fakeinbox.com'), ('mailnesia.com'), ('mintemail.com'),
  ('mohmal.com'), ('emailondeck.com'), ('spamgourmet.com'), ('moakt.com'), ('burnermail.io'), ('mytemp.email'),
  ('discard.email'), ('emltmp.com'), ('tmpmail.org'), ('tmail.ws'), ('harakirimail.com'), ('mailcatch.com'),
  ('mailsac.com'), ('inboxkitten.com'), ('minuteinbox.com'), ('dropmail.me'), ('1secmail.com'), ('1secmail.org'),
  ('1secmail.net'), ('fakemail.net'), ('mailtemp.info'), ('trbvm.com'), ('byom.de'), ('spambox.us'),
  ('mt2015.com'), ('wegwerfmail.de'), ('einrot.com'), ('cuvox.de');

-- ---------------------------------------------------------------------------
-- Reading a phone number or an email the same way everywhere
-- ---------------------------------------------------------------------------

-- A phone in international form (+234...), or null if it is not one. Nigerian numbers may be written 0803..., 234803...,
-- 803... (a spreadsheet drops the leading zero) or +234 (0)803... (the zero kept by mistake).
create function public.referee_phone_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when x ~ '^\+2340[0-9]{10}$' then '+234' || substr(x, 6)
    when x ~ '^002340[0-9]{10}$' then '+234' || substr(x, 7)
    when x ~ '^\+[1-9][0-9]{7,14}$' then x
    when x ~ '^00[1-9][0-9]{7,14}$' then '+' || substr(x, 3)
    when x ~ '^0[0-9]{10}$' then '+234' || substr(x, 2)
    when x ~ '^2340[0-9]{10}$' then '+234' || substr(x, 5)
    when x ~ '^234[0-9]{10}$' then '+' || x
    when x ~ '^[789][0-9]{9}$' then '+234' || x
    else null
  end
  from (select regexp_replace(coalesce(p_text, ''), '[^0-9+]', '', 'g') as x) t;
$$;

create function public.referee_email_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when lower(btrim(coalesce(p_text, ''))) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
              then lower(btrim(p_text)) else null end;
$$;

-- What the text is (email, phone or neither) and its normal form.
create function public.referee_contact_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when position('@' in coalesce(p_text, '')) > 1 then public.referee_email_norm(p_text)
              else public.referee_phone_norm(p_text) end;
$$;

create function public.referee_contact_kind(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when position('@' in coalesce(p_text, '')) > 1 then 'email' else 'phone' end;
$$;

create function public.referee_domain_blocked(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.referee_blocked_domains d where d.domain = split_part(lower(coalesce(p_email, '')), '@', 2));
$$;

-- ---------------------------------------------------------------------------
-- Columns on the references the applicant already reads. Nothing here says anything about the directory.
-- ---------------------------------------------------------------------------

alter table public.leader_references
  add column contact_kind text check (contact_kind in ('email', 'phone')),
  add column contact_norm text,
  -- What the applicant sees: waiting, sending, sent, opened, verified, answered, unreachable.
  add column stage text not null default 'waiting'
    check (stage in ('waiting', 'sending', 'sent', 'opened', 'verified', 'answered', 'unreachable')),
  add column sent_at timestamptz,
  add column last_request_at timestamptz,
  add column requests smallint not null default 0,
  -- How many times this slot was changed after a request had gone out.
  add column changes smallint not null default 0;
create index leader_references_contact_idx on public.leader_references (contact_norm);

-- ---------------------------------------------------------------------------
-- What has been proved. Staff only: the applicant must not learn who is in the directory.
-- ---------------------------------------------------------------------------

create table public.referee_trust (
  reference_id uuid primary key references public.leader_references (id) on delete cascade,
  -- unverified: not proved (every reference from before this release); contact: a code reached them;
  -- directory: a code reached them and the contact is in the directory; pastor: a pastor confirmed them; disputed: they said it was not theirs.
  verification text not null default 'unverified' check (verification in ('unverified', 'contact', 'directory', 'pastor', 'disputed')),
  -- The system's own answer to "is this referee a pastor or unit head?" (the applicant's tick is only a claim).
  standing boolean not null default false,
  directory_entry_id uuid references public.referee_directory (id) on delete set null,
  legacy boolean not null default false,
  verified_at timestamptz,
  verified_kind text check (verified_kind in ('email', 'phone')),
  form_seen_at timestamptz,
  confirmed_by uuid references public.people (id) on delete set null,
  confirmed_at timestamptz,
  confirmed_note text check (char_length(confirmed_note) <= 300),
  reverify_sent_at timestamptz,
  reverified_at timestamptz,
  opened_at timestamptz
);

create table public.referee_access (
  reference_id uuid primary key references public.leader_references (id) on delete cascade,
  code_salt text,
  code_hash text,
  code_expires_at timestamptz,
  code_tries smallint not null default 0,
  code_state text not null default 'none' check (code_state in ('none', 'queued', 'sent', 'failed')),
  locked_until timestamptz,
  last_code_at timestamptz,
  codes_sent smallint not null default 0,
  codes_day date,
  session_hash text,
  session_expires_at timestamptz,
  -- Salted hashes of the networks and browsers the link was opened from (never an address), at most ten.
  nets text[] not null default '{}',
  bids text[] not null default '{}'
);

create table public.leader_reference_flags (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null references public.leader_references (id) on delete cascade,
  kind text not null check (kind in ('same_browser', 'same_network', 'too_fast', 'identical_pattern', 'text_like_applicant', 'many_networks', 'disowned')),
  severity text not null check (severity in ('hold', 'note')),
  detail text check (char_length(detail) <= 200),
  created_at timestamptz not null default now(),
  cleared_by uuid references public.people (id) on delete set null,
  cleared_at timestamptz,
  cleared_note text check (char_length(cleared_note) <= 300),
  unique (reference_id, kind)
);

create table public.referee_callbacks (
  id uuid primary key default gen_random_uuid(),
  reference_id uuid not null unique references public.leader_references (id) on delete cascade,
  reason text not null check (reason in ('flagged', 'sample', 'disowned')),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  outcome text check (outcome in ('confirmed', 'not_reached', 'not_them')),
  attempts smallint not null default 0,
  note text check (char_length(note) <= 300),
  due_on date not null,
  created_at timestamptz not null default now(),
  closed_by uuid references public.people (id) on delete set null,
  closed_at timestamptz
);
create index referee_callbacks_open_idx on public.referee_callbacks (due_on) where status = 'open';

create table public.applicant_sessions (
  person_id uuid not null references public.people (id) on delete cascade,
  net_hash text not null,
  bid_hash text not null,
  seen_at timestamptz not null default now(),
  primary key (person_id, net_hash, bid_hash)
);
create index applicant_sessions_seen_idx on public.applicant_sessions (seen_at);

create table public.referee_changes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.leader_applications (id) on delete cascade,
  slot smallint not null,
  changed_by uuid references public.people (id) on delete set null,
  old_name text,
  old_contact text,
  new_contact text,
  after_request boolean not null default false,
  at timestamptz not null default now()
);

alter table public.referee_settings enable row level security;
alter table public.referee_directory enable row level security;
alter table public.referee_directory_contacts enable row level security;
alter table public.referee_import_batches enable row level security;
alter table public.referee_directory_history enable row level security;
alter table public.referee_blocked_domains enable row level security;
alter table public.referee_trust enable row level security;
alter table public.referee_access enable row level security;
alter table public.leader_reference_flags enable row level security;
alter table public.referee_callbacks enable row level security;
alter table public.applicant_sessions enable row level security;
alter table public.referee_changes enable row level security;
-- No policies and no grants: only the functions below read or write these.

-- ---------------------------------------------------------------------------
-- Small internal helpers
-- ---------------------------------------------------------------------------

create function public.referee_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['pastor', 'director', 'admin']::public.app_role[]);
$$;

create function public.referee_decider()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['pastor', 'director']::public.app_role[]);
$$;

create function public.referee_care()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_any_role(array['care_lead', 'pastor', 'director', 'admin']::public.app_role[]);
$$;

-- The directory entry an (already normalised) contact belongs to, if that person is still on the list.
create function public.referee_directory_match(p_norm text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.referee_directory_contacts c join public.referee_directory e on e.id = c.entry_id
   where c.value = p_norm and e.active
   limit 1;
$$;

-- Does this reference have a hold flag a pastor has not cleared?
create function public.reference_held(p_reference uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.leader_reference_flags f where f.reference_id = p_reference and f.severity = 'hold' and f.cleared_at is null);
$$;

create function public.referee_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create function public.referee_hash(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_text, ''), 'utf8')), 'hex');
$$;

-- "j•••@gmail.com" or "+234 ••• ••• 567": enough for the referee to recognise it, not enough for anyone else to use.
create function public.referee_mask(p_kind text, p_norm text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_norm is null then null
    when p_kind = 'email' then left(split_part(p_norm, '@', 1), 1) || '•••@' || split_part(p_norm, '@', 2)
    else left(p_norm, 4) || ' ••• ••• ' || right(p_norm, 3)
  end;
$$;

-- ---------------------------------------------------------------------------
-- The applicant names a referee (replaced) and asks for the request to be sent (new)
-- ---------------------------------------------------------------------------

-- Same signature as before. New: the contact must be a phone number or an email, not the applicant's own, not the other referee's, not a
-- throwaway inbox, and (unless it is on the church's list) not in use by another applicant. A slot can be changed twice after a request
-- has gone out; every change is logged. Changing the contact cancels the old link, the old code and everything proved about it.
create or replace function public.set_referee(
  p_app uuid,
  p_slot integer,
  p_name text,
  p_relationship text,
  p_contact text,
  p_head boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  existing public.leader_references;
  cfg public.referee_settings := public.referee_cfg();
  v_norm text := public.referee_contact_norm(p_contact);
  v_kind text := public.referee_contact_kind(p_contact);
  v_changed boolean;
  v_after boolean;
  v_own text[];
  rid uuid;
begin
  select * into a from public.leader_applications where id = p_app and person_id = auth.uid() for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status not in ('draft', 'submitted', 'interview_invited') then
    raise exception 'Referees can no longer be changed' using errcode = '22023';
  end if;
  if p_slot not in (1, 2) then
    raise exception 'A referee is slot 1 or 2' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 or char_length(btrim(coalesce(p_relationship, ''))) < 2 then
    raise exception 'Add their name and how you know them' using errcode = '22023';
  end if;
  if v_norm is null then
    raise exception 'Enter a phone number (like 0803 123 4567) or an email address we can reach them on' using errcode = '22023';
  end if;
  if v_kind = 'email' and public.referee_domain_blocked(v_norm) then
    raise exception 'Please use a personal or church email address, not a temporary one' using errcode = '22023';
  end if;

  -- Not the applicant's own contact, in any form they have given us
  select array_remove(array[
      public.referee_email_norm((select p.email from public.people p where p.id = a.person_id)),
      public.referee_phone_norm(a.answers #>> '{contact,whatsapp}'),
      public.referee_phone_norm((select cp.phone from public.contact_preferences cp where cp.person_id = a.person_id))], null)
    into v_own;
  if v_norm = any (v_own) then
    raise exception 'A referee has to be someone else, not you' using errcode = '22023';
  end if;

  -- Not the other referee
  if exists (select 1 from public.leader_references o where o.application_id = p_app and o.slot <> p_slot and o.contact_norm = v_norm) then
    raise exception 'Your two referees must be different people' using errcode = '22023';
  end if;

  -- Not another applicant's referee, unless this is a pastor or unit head on the church's list (they speak for many)
  if public.referee_directory_match(v_norm) is null and exists (
       select 1 from public.leader_references o join public.leader_applications oa on oa.id = o.application_id
        where o.contact_norm = v_norm and oa.person_id <> a.person_id
          and oa.status in ('draft', 'submitted', 'interview_invited', 'interview_booked', 'interviewed')) then
    raise exception 'That contact cannot be used as a referee. Please choose someone else who knows you' using errcode = '22023';
  end if;

  select * into existing from public.leader_references where application_id = p_app and slot = p_slot for update;
  if found and existing.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;

  if found then
    v_changed := existing.contact_norm is distinct from v_norm;
    v_after := existing.sent_at is not null or existing.requests > 0;
    if v_changed and v_after and existing.changes >= cfg.max_changes then
      raise exception 'You have already changed this referee % times. If something has gone wrong, ask the pastorate', cfg.max_changes using errcode = '22023';
    end if;
    if v_changed then
      insert into public.referee_changes (application_id, slot, changed_by, old_name, old_contact, new_contact, after_request)
      values (p_app, p_slot, auth.uid(), existing.referee_name, existing.contact, btrim(p_contact), v_after);
      -- Everything about the old person is cancelled: the link, the code, what was proved
      update public.leader_references
         set referee_name = btrim(p_name), relationship = btrim(p_relationship), contact = btrim(p_contact),
             contact_norm = v_norm, contact_kind = v_kind, is_pastor_or_unit_head = coalesce(p_head, false),
             token_hash = public.referee_hash(public.referee_secret()), token_expires_at = now(),
             stage = 'waiting', sent_at = null, last_request_at = null,
             changes = existing.changes + case when v_after then 1 else 0 end
       where id = existing.id returning id into rid;
      delete from public.referee_access where reference_id = rid;
      insert into public.referee_access (reference_id) values (rid);
      update public.referee_trust
         set verification = 'unverified', standing = false, verified_at = null, verified_kind = null, form_seen_at = null,
             confirmed_by = null, confirmed_at = null, confirmed_note = null, opened_at = null,
             directory_entry_id = public.referee_directory_match(v_norm)
       where reference_id = rid;
      perform public.write_event(auth.uid(), 'reference.changed', 'leader_application', p_app::text,
        jsonb_build_object('slot', p_slot, 'after_request', v_after));
    else
      update public.leader_references
         set referee_name = btrim(p_name), relationship = btrim(p_relationship), contact = btrim(p_contact),
             is_pastor_or_unit_head = coalesce(p_head, false)
       where id = existing.id returning id into rid;
    end if;
  else
    insert into public.leader_references
      (application_id, slot, referee_name, relationship, contact, contact_norm, contact_kind, is_pastor_or_unit_head, token_hash, token_expires_at, stage)
    values
      (p_app, p_slot, btrim(p_name), btrim(p_relationship), btrim(p_contact), v_norm, v_kind, coalesce(p_head, false),
       public.referee_hash(public.referee_secret()), now(), 'waiting')
    returning id into rid;
  end if;
  return rid;
end;
$$;

-- The applicant presses "Send request". The system makes the link and sends it to the referee's own contact; the applicant is
-- never given it. The link is made at the moment of sending, so it is never stored or queued in a readable form.
create function public.request_referee_send(p_reference uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  cfg public.referee_settings := public.referee_cfg();
  ai public.leader_ai_settings := public.leader_ai_cfg();
  v_sent integer;
begin
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id and person_id = auth.uid();
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  if a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
    raise exception 'Requests go out once your application has been sent' using errcode = '22023';
  end if;
  if ai.mode = 'on' and exists (
       select 1 from public.leader_ai_state s
        where s.application_id = a.id and s.state in ('consent_needed', 'checking', 'strengthen', 'held')) then
    raise exception 'Your application is still being checked. Requests to referees go out as soon as that is done' using errcode = '22023';
  end if;
  if r.submitted_at is not null then
    raise exception 'This referee has already answered' using errcode = '22023';
  end if;
  if r.contact_norm is null then
    raise exception 'We could not read this contact. Please change this person and enter a phone number or email' using errcode = '22023';
  end if;
  select count(*) into v_sent from public.messages
   where template = 'referee_request' and params ->> 'reference_id' = p_reference::text and created_at > now() - interval '1 day';
  if v_sent >= cfg.sends_per_day then
    raise exception 'We have already sent this request % times today. Please try again tomorrow, or check their number or email', cfg.sends_per_day using errcode = '22023';
  end if;

  perform public.enqueue_message(
    null, 'referee_request',
    jsonb_build_object('reference_id', r.id, 'contact', r.contact_norm),
    null, 'referee:' || r.id::text || ':' || gen_random_uuid()::text,
    null, 'normal', null,
    case when r.contact_kind = 'email' then r.contact_norm end,
    case when r.contact_kind = 'phone' then r.contact_norm end,
    r.referee_name);
  update public.leader_references
     set stage = case when stage in ('waiting', 'unreachable', 'sending') then 'sending' else stage end,
         last_request_at = now(), requests = requests + 1
   where id = r.id;
  perform public.write_event(auth.uid(), 'reference.requested', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
  return jsonb_build_object('ok', true, 'kind', r.contact_kind);
end;
$$;

-- Remember (as salted hashes only) where the applicant has been signed in from, so a referee answering from the same place can be noticed.
create function public.referee_note_applicant(p_net text, p_bid text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_net is null or p_bid is null or char_length(p_net) <> 64 or char_length(p_bid) <> 64 then
    return;
  end if;
  insert into public.applicant_sessions (person_id, net_hash, bid_hash) values (auth.uid(), p_net, p_bid)
  on conflict (person_id, net_hash, bid_hash) do update set seen_at = now();
end;
$$;

-- These two handed the applicant a secret. They are gone. (Phase 1 replaced renew_referee_link; the messaging release added send_referee_link.)
drop function public.renew_referee_link(uuid);
drop function public.send_referee_link(uuid, text);
-- Replaced below with versions that need a code and a session.
drop function public.get_reference_request(text);
drop function public.submit_reference(text, integer, integer, integer, integer, boolean, text);

-- When the message to a referee is sent, or cannot be, the applicant's status changes with it.
create function public.referee_message_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
  v_ok boolean;
  v_bad boolean;
begin
  if new.status is not distinct from old.status or new.template not in ('referee_request', 'referee_code', 'referee_reverify') then
    return new;
  end if;
  v_ref := nullif(old.params ->> 'reference_id', '')::uuid;
  if v_ref is null then
    return new;
  end if;
  v_ok := new.status in ('sent', 'delivered', 'read') and old.status not in ('sent', 'delivered', 'read');
  v_bad := new.status = 'failed' or (new.status = 'skipped' and coalesce(new.error, '') like 'no channel%');
  if new.template = 'referee_request' then
    if v_ok then
      update public.leader_references
         set stage = case when stage in ('waiting', 'sending', 'unreachable') then 'sent' else stage end,
             sent_at = coalesce(sent_at, now())
       where id = v_ref and contact_norm = old.params ->> 'contact';
    elsif v_bad then
      update public.leader_references set stage = 'unreachable'
       where id = v_ref and stage in ('waiting', 'sending') and contact_norm = old.params ->> 'contact';
    end if;
  elsif new.template = 'referee_code' then
    if v_ok then
      update public.referee_access set code_state = 'sent' where reference_id = v_ref and code_state = 'queued';
    elsif v_bad then
      update public.referee_access set code_state = 'failed' where reference_id = v_ref and code_state = 'queued';
    end if;
  end if;
  return new;
end;
$$;
create trigger messages_referee_outcome after update of status on public.messages
  for each row execute function public.referee_message_outcome();

-- ---------------------------------------------------------------------------
-- References already in the system
-- ---------------------------------------------------------------------------
-- Answered references stay valid and are marked "not verified"; the applicant's own tick is kept as the standing they had.
-- References not yet answered lose their link: the applicant may be holding it, and from now on only the system sends one.

insert into public.referee_trust (reference_id, legacy, standing, directory_entry_id)
select r.id, r.submitted_at is not null, r.submitted_at is not null and r.is_pastor_or_unit_head, null
  from public.leader_references r;
insert into public.referee_access (reference_id) select r.id from public.leader_references r;

update public.leader_references
   set contact_norm = public.referee_contact_norm(contact),
       contact_kind = public.referee_contact_kind(contact),
       stage = case when submitted_at is not null then 'answered' else 'waiting' end;
update public.leader_references
   set token_hash = public.referee_hash(public.referee_secret()), token_expires_at = now()
 where submitted_at is null;

-- From now on every reference row, however it is made, starts with its own trust and access rows. A row that arrives already answered
-- (only the database itself, or an import, can do that) is treated like the ones that were already here: valid, not verified.
create function public.referee_row_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.contact_norm := coalesce(new.contact_norm, public.referee_contact_norm(new.contact));
  new.contact_kind := coalesce(new.contact_kind, public.referee_contact_kind(new.contact));
  if new.submitted_at is not null then
    new.stage := 'answered';
  end if;
  return new;
end;
$$;
create trigger leader_references_defaults before insert on public.leader_references
  for each row execute function public.referee_row_defaults();

create function public.referee_row_init()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.referee_trust (reference_id, legacy, standing, directory_entry_id)
  values (new.id, new.submitted_at is not null, new.submitted_at is not null and new.is_pastor_or_unit_head,
          public.referee_directory_match(new.contact_norm))
  on conflict do nothing;
  insert into public.referee_access (reference_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger leader_references_init after insert on public.leader_references
  for each row execute function public.referee_row_init();

-- ---------------------------------------------------------------------------
-- The referee's own page: no account, the link is the first key and the code is the second
-- ---------------------------------------------------------------------------

-- Opens the request: what the page needs to draw itself, and a note (hashes only) of where it was opened from.
-- p_record is false for link-preview robots, which must not count as the referee opening it.
create function public.referee_open(p_token text, p_session text, p_net text, p_bid text, p_record boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
  ac public.referee_access;
  cfg public.referee_settings := public.referee_cfg();
  v_state text;
  v_reverify boolean;
  v_session boolean;
  v_entry public.referee_directory;
  v_who jsonb := null;
  v_wait integer := 0;
  v_locked integer := 0;
  v_live boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into r from public.leader_references where token_hash = public.referee_hash(p_token);
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  select * into t from public.referee_trust where reference_id = r.id;
  select * into ac from public.referee_access where reference_id = r.id;

  -- Waiting for "was this yours?" until it is answered, including after the right code has made the contact verified
  v_reverify := r.submitted_at is not null and coalesce(t.legacy, false) and t.reverify_sent_at is not null and t.reverified_at is null;
  v_state := case
    when r.submitted_at is not null and not v_reverify then 'answered'
    when a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') and not v_reverify then 'closed'
    when r.token_expires_at < now() then 'expired'
    else 'open' end;
  v_session := ac.session_hash is not null and ac.session_expires_at > now() and p_session is not null
               and ac.session_hash = public.referee_hash(p_session);

  if v_state = 'open' and p_record then
    update public.referee_trust set opened_at = coalesce(opened_at, now()) where reference_id = r.id;
    if r.stage in ('waiting', 'sending', 'sent', 'unreachable') then
      update public.leader_references set stage = 'opened' where id = r.id;
    end if;
    update public.referee_access
       set nets = case when p_net ~ '^[a-f0-9]{64}$' and not (p_net = any (nets)) and cardinality(nets) < 10 then array_append(nets, p_net) else nets end,
           bids = case when p_bid ~ '^[a-f0-9]{64}$' and not (p_bid = any (bids)) and cardinality(bids) < 10 then array_append(bids, p_bid) else bids end
     where reference_id = r.id;
    if v_session and t.form_seen_at is null and not v_reverify then
      update public.referee_trust set form_seen_at = now() where reference_id = r.id;
    end if;
  end if;

  if v_session then
    select * into v_entry from public.referee_directory where id = t.directory_entry_id and active;
    if found then
      v_who := jsonb_build_object('name', v_entry.name, 'standing', v_entry.standing, 'unit', v_entry.unit);
    end if;
  end if;
  if ac.last_code_at is not null then
    v_wait := greatest(0, 60 - extract(epoch from (now() - ac.last_code_at))::integer);
  end if;
  if ac.locked_until is not null and ac.locked_until > now() then
    v_locked := greatest(1, ceil(extract(epoch from (ac.locked_until - now())) / 60)::integer);
  end if;
  v_live := (ac.code_hash is not null and ac.code_expires_at > now())
         or (ac.code_state = 'queued' and ac.last_code_at > now() - make_interval(mins => cfg.code_minutes));

  return jsonb_build_object(
    'state', v_state,
    'mode', case when v_reverify then 'reverify' else 'give' end,
    'applicant', public.person_display_name(a.person_id),
    'referee', r.referee_name,
    'relationship', r.relationship,
    'kind', r.contact_kind,
    'masked', public.referee_mask(r.contact_kind, r.contact_norm),
    'verified', v_session,
    'who', v_who,
    'code', jsonb_build_object(
      'live', coalesce(v_live, false),
      'failed', ac.code_state = 'failed',
      'wait', v_wait,
      'locked_minutes', v_locked,
      'tries_left', greatest(0, cfg.max_tries - ac.code_tries),
      'minutes', cfg.code_minutes));
end;
$$;

-- "Send me a code": a second message to the same contact. Spaced out and limited, so it cannot be used to flood someone's phone.
create function public.referee_ask_code(p_token text, p_net text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
  ac public.referee_access;
  v_reverify boolean;
  v_today date := public.today_lagos();
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into r from public.leader_references where token_hash = public.referee_hash(p_token) for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  select * into t from public.referee_trust where reference_id = r.id;
  select * into ac from public.referee_access where reference_id = r.id for update;
  v_reverify := r.submitted_at is not null and coalesce(t.legacy, false) and t.reverify_sent_at is not null and t.reverified_at is null;
  if r.token_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if (r.submitted_at is not null and not v_reverify)
     or (a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') and not v_reverify) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if r.contact_norm is null then
    return jsonb_build_object('ok', false, 'reason', 'unreachable');
  end if;
  if ac.locked_until is not null and ac.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', greatest(1, ceil(extract(epoch from (ac.locked_until - now())) / 60)::integer));
  end if;
  if ac.last_code_at is not null and ac.last_code_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'wait', 'seconds', greatest(1, 60 - extract(epoch from (now() - ac.last_code_at))::integer));
  end if;
  if ac.codes_day is not distinct from v_today and ac.codes_sent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  perform public.enqueue_message(
    null, 'referee_code',
    jsonb_build_object('reference_id', r.id, 'contact', r.contact_norm),
    null, 'refcode:' || r.id::text || ':' || gen_random_uuid()::text,
    null, 'urgent', null,
    case when r.contact_kind = 'email' then r.contact_norm end,
    case when r.contact_kind = 'phone' then r.contact_norm end,
    r.referee_name);
  update public.referee_access
     set last_code_at = now(), code_state = 'queued',
         codes_sent = case when codes_day is not distinct from v_today then codes_sent + 1 else 1 end,
         codes_day = v_today,
         nets = case when p_net ~ '^[a-f0-9]{64}$' and not (p_net = any (nets)) and cardinality(nets) < 10 then array_append(nets, p_net) else nets end
   where reference_id = r.id;
  return jsonb_build_object('ok', true, 'masked', public.referee_mask(r.contact_kind, r.contact_norm), 'kind', r.contact_kind);
end;
$$;

-- The code is typed in. Right: a session opens, and what has been proved is recorded. Wrong five times: locked.
create function public.referee_check_code(p_token text, p_code text, p_net text, p_bid text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
  ac public.referee_access;
  cfg public.referee_settings := public.referee_cfg();
  v_entry public.referee_directory;
  v_entry_id uuid;
  v_secret text;
  v_reverify boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into r from public.leader_references where token_hash = public.referee_hash(p_token) for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  select * into t from public.referee_trust where reference_id = r.id for update;
  select * into ac from public.referee_access where reference_id = r.id for update;
  v_reverify := r.submitted_at is not null and coalesce(t.legacy, false) and t.reverify_sent_at is not null and t.reverified_at is null;
  if r.token_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if (r.submitted_at is not null and not v_reverify)
     or (a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') and not v_reverify) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if ac.locked_until is not null and ac.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', greatest(1, ceil(extract(epoch from (ac.locked_until - now())) / 60)::integer));
  end if;
  if ac.code_hash is null or ac.code_expires_at is null or ac.code_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'format');
  end if;

  if public.referee_hash(ac.code_salt || p_code) <> ac.code_hash then
    update public.referee_access
       set locked_until = case when code_tries + 1 >= cfg.max_tries then now() + make_interval(mins => cfg.lock_minutes) else locked_until end,
           code_hash = case when code_tries + 1 >= cfg.max_tries then null else code_hash end,
           code_tries = case when code_tries + 1 >= cfg.max_tries then 0 else code_tries + 1 end
     where reference_id = r.id;
    if ac.code_tries + 1 >= cfg.max_tries then
      perform public.write_event(null, 'reference.code_locked', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
      return jsonb_build_object('ok', false, 'reason', 'locked', 'minutes', cfg.lock_minutes);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'tries_left', cfg.max_tries - ac.code_tries - 1);
  end if;

  -- The right code: it works once. Whoever is in the directory now is matched now, so a list updated since the applicant
  -- named them is respected.
  v_secret := public.referee_secret();
  v_entry_id := public.referee_directory_match(r.contact_norm);
  select * into v_entry from public.referee_directory where id = v_entry_id;
  update public.referee_access
     set code_hash = null, code_tries = 0, code_state = 'none',
         session_hash = public.referee_hash(v_secret), session_expires_at = now() + interval '3 hours',
         nets = case when p_net ~ '^[a-f0-9]{64}$' and not (p_net = any (nets)) and cardinality(nets) < 10 then array_append(nets, p_net) else nets end,
         bids = case when p_bid ~ '^[a-f0-9]{64}$' and not (p_bid = any (bids)) and cardinality(bids) < 10 then array_append(bids, p_bid) else bids end
   where reference_id = r.id;
  update public.referee_trust
     set verified_at = now(), verified_kind = r.contact_kind, form_seen_at = null,
         directory_entry_id = v_entry_id,
         verification = case when verification in ('pastor', 'disputed') then verification
                             when v_entry_id is not null then 'directory' else 'contact' end,
         standing = standing or (v_entry_id is not null and v_entry.standing = any (cfg.gate_standings))
   where reference_id = r.id;
  update public.leader_references set stage = 'verified' where id = r.id and stage in ('waiting', 'sending', 'sent', 'opened', 'unreachable');
  perform public.write_event(null, 'reference.verified', 'leader_application', a.id::text,
    jsonb_build_object('slot', r.slot, 'via', r.contact_kind, 'directory', v_entry_id is not null));
  return jsonb_build_object('ok', true, 'session', v_secret);
end;
$$;

-- The ratings. Needs the link AND the session the code opened. Integrity flags are worked out here; they hold a reference back, they never refuse it.
create function public.submit_reference(
  p_token text,
  p_session text,
  p_reliability integer,
  p_warmth integer,
  p_confidentiality integer,
  p_maturity integer,
  p_concern boolean,
  p_note text,
  p_net text default null,
  p_bid text default null,
  p_norm_hash text default null,
  p_simhash bigint default null,
  p_words integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
  ac public.referee_access;
  cfg public.referee_settings := public.referee_cfg();
  v_nets text[];
  v_bids text[];
  v_flags jsonb := '[]'::jsonb;
  v_elapsed integer;
  v_notes integer;
  v_held boolean;
  v_other public.leader_reference_answers;
  f record;
begin
  select * into r from public.leader_references where token_hash = public.referee_hash(p_token) for update;
  if not found then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  if r.submitted_at is not null then
    raise exception 'This reference was already sent' using errcode = '22023';
  end if;
  if r.token_expires_at < now() then
    raise exception 'This link has expired. Ask the applicant to send you a new request' using errcode = '22023';
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  if a.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
    raise exception 'This reference is no longer needed' using errcode = '22023';
  end if;
  select * into t from public.referee_trust where reference_id = r.id for update;
  select * into ac from public.referee_access where reference_id = r.id for update;
  if ac.session_hash is null or ac.session_expires_at < now() or p_session is null or ac.session_hash <> public.referee_hash(p_session) then
    raise exception 'Please confirm the code we send you first. Reload this page to start again' using errcode = '22023';
  end if;

  insert into public.leader_reference_answers
    (reference_id, reliability, warmth, confidentiality, maturity, concern, concern_note)
  values
    (r.id, p_reliability, p_warmth, p_confidentiality, p_maturity, coalesce(p_concern, false),
     case when coalesce(p_concern, false) then nullif(btrim(coalesce(p_note, '')), '') end);
  -- Answering spends the link: it is refused once submitted_at is set
  update public.leader_references set submitted_at = now(), stage = 'answered' where id = r.id;

  -- Integrity flags
  v_nets := ac.nets || case when p_net ~ '^[a-f0-9]{64}$' and not (p_net = any (ac.nets)) then array[p_net] else '{}'::text[] end;
  v_bids := ac.bids || case when p_bid ~ '^[a-f0-9]{64}$' and not (p_bid = any (ac.bids)) then array[p_bid] else '{}'::text[] end;

  if exists (select 1 from public.applicant_sessions s where s.person_id = a.person_id and s.bid_hash = any (v_bids)
              and s.seen_at > now() - interval '45 days') then
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'same_browser', 'hold', 'Answered from a browser the applicant has signed in on') on conflict do nothing;
  end if;
  if exists (select 1 from public.applicant_sessions s where s.person_id = a.person_id and s.net_hash = any (v_nets)
              and s.seen_at > now() - interval '45 days') then
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'same_network', 'note', 'Answered from a network the applicant has used') on conflict do nothing;
  end if;
  v_elapsed := extract(epoch from (now() - coalesce(t.form_seen_at, t.verified_at, now())))::integer;
  if v_elapsed < cfg.min_seconds then
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'too_fast', 'hold', format('Finished the ratings in %s seconds', greatest(v_elapsed, 0))) on conflict do nothing;
  end if;
  select ra.* into v_other
    from public.leader_references o join public.leader_reference_answers ra on ra.reference_id = o.id
   where o.application_id = r.application_id and o.id <> r.id and o.submitted_at > now() - interval '30 minutes'
     and ra.reliability = p_reliability and ra.warmth = p_warmth and ra.confidentiality = p_confidentiality and ra.maturity = p_maturity
   limit 1;
  if found then
    -- Two referees who both give straight fives are common and honest; an uneven pattern that matches exactly is not
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'identical_pattern',
            case when p_reliability = p_warmth and p_warmth = p_confidentiality and p_confidentiality = p_maturity then 'note' else 'hold' end,
            'The same four ratings as the other referee, within half an hour') on conflict do nothing;
  end if;
  if coalesce(p_concern, false) and p_norm_hash ~ '^[a-f0-9]{64}$' and coalesce(p_words, 0) >= 8 and exists (
       select 1 from public.leader_answer_prints p
        where p.application_id = r.application_id and p.words >= 12
          and (p.norm_hash = p_norm_hash or (p_simhash is not null and coalesce(p_words, 0) >= 12 and bit_count((p.simhash # p_simhash)::bit(64)) <= 12))) then
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'text_like_applicant', 'hold', 'The note reads like the applicant''s own writing') on conflict do nothing;
  end if;
  if cardinality(v_nets) >= 3 then
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'many_networks', 'note', format('The link was opened from %s networks', cardinality(v_nets))) on conflict do nothing;
  end if;
  -- Two soft signals together are worth a look
  select count(*) into v_notes from public.leader_reference_flags where reference_id = r.id and severity = 'note';
  if v_notes >= 2 then
    update public.leader_reference_flags set severity = 'hold' where reference_id = r.id and severity = 'note';
  end if;

  v_held := public.reference_held(r.id);
  if v_held or random() * 100 < cfg.callback_pct then
    insert into public.referee_callbacks (reference_id, reason, due_on)
    values (r.id, case when v_held then 'flagged' else 'sample' end, public.today_lagos() + 3)
    on conflict (reference_id) do nothing;
  end if;

  select coalesce(jsonb_agg(kind), '[]'::jsonb) into v_flags from public.leader_reference_flags where reference_id = r.id;
  update public.referee_access set session_hash = null, session_expires_at = null where reference_id = r.id;
  perform public.write_event(null, 'leader.reference_received', 'leader_application', r.application_id::text,
    jsonb_build_object('concern', coalesce(p_concern, false), 'held', v_held, 'flags', v_flags, 'verification', t.verification));
  return jsonb_build_object('ok', true);
end;
$$;

-- A referee whose reference was received before this release confirms (or disowns) it.
create function public.referee_reverify_answer(p_token text, p_session text, p_mine boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  t public.referee_trust;
  ac public.referee_access;
begin
  select * into r from public.leader_references where token_hash = public.referee_hash(p_token) for update;
  if not found then
    raise exception 'This link is not valid' using errcode = 'P0002';
  end if;
  select * into t from public.referee_trust where reference_id = r.id for update;
  select * into ac from public.referee_access where reference_id = r.id for update;
  if r.submitted_at is null or not t.legacy or t.reverify_sent_at is null or t.reverified_at is not null then
    raise exception 'There is nothing to confirm here' using errcode = '22023';
  end if;
  if ac.session_hash is null or ac.session_expires_at < now() or p_session is null or ac.session_hash <> public.referee_hash(p_session) then
    raise exception 'Please confirm the code we send you first. Reload this page to start again' using errcode = '22023';
  end if;
  update public.referee_trust set reverified_at = now() where reference_id = r.id;
  update public.referee_access set session_hash = null, session_expires_at = null where reference_id = r.id;
  if coalesce(p_mine, false) then
    perform public.write_event(null, 'reference.reverified', 'leader_application', r.application_id::text, jsonb_build_object('slot', r.slot));
  else
    update public.referee_trust set verification = 'disputed' where reference_id = r.id;
    insert into public.leader_reference_flags (reference_id, kind, severity, detail)
    values (r.id, 'disowned', 'hold', 'The referee says this reference was not theirs') on conflict do nothing;
    insert into public.referee_callbacks (reference_id, reason, due_on) values (r.id, 'disowned', public.today_lagos())
    on conflict (reference_id) do update set reason = 'disowned', status = 'open', due_on = public.today_lagos();
    perform public.write_event(null, 'reference.disowned', 'leader_application', r.application_id::text, jsonb_build_object('slot', r.slot));
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The directory: reading a spreadsheet's rows, showing what an upload would do, doing it, undoing it
-- ---------------------------------------------------------------------------

-- A referee who proved they hold their contact before the person was on the list (or while their kind did not count) is matched
-- again whenever the list or the settings change, so updating the spreadsheet helps references that are already in. It never takes
-- standing away: what was proved at the time stays proved.
create function public.referee_rematch()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg public.referee_settings := public.referee_cfg();
  n integer;
begin
  with hit as (
    select t.reference_id, m.id as entry_id, m.standing as entry_standing
      from public.referee_trust t
      join public.leader_references r on r.id = t.reference_id
      join lateral (
        select e.id, e.standing
          from public.referee_directory_contacts c join public.referee_directory e on e.id = c.entry_id
         where c.value = r.contact_norm and e.active
         limit 1) m on true
     where t.verification in ('contact', 'directory') and t.verified_at is not null
  )
  update public.referee_trust t
     set verification = 'directory', directory_entry_id = hit.entry_id,
         standing = t.standing or (hit.entry_standing = any (cfg.gate_standings))
    from hit
   where hit.reference_id = t.reference_id
     and (t.verification <> 'directory' or t.directory_entry_id is distinct from hit.entry_id
          or (not t.standing and hit.entry_standing = any (cfg.gate_standings)));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Works out, row by row, what an upload would change. Used by the preview and by the real thing, so they cannot disagree.
-- A row is { line, name, standing, unit, note, contacts: [raw text, ...], active? }. A row with "active": false takes that person off the list. Mode "update" adds and changes people and never removes
-- anything; mode "replace" treats the file as the whole list: contacts and details not in the file are removed and people not in it are retired.
create function public.referee_import_plan(p_rows jsonb, p_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer := case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end;
  v_i integer;
  v_row jsonb;
  v_c jsonb;
  v_line integer;
  v_name text;
  v_stand text;
  v_unit text;
  v_note text;
  v_raw text;
  v_norm text;
  v_norms text[];
  v_bad text[];
  v_have text[];
  v_new text[];
  v_gone text[];
  v_ids uuid[];
  v_entry public.referee_directory;
  v_seen jsonb := '{}'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_matched uuid[] := '{}';
  v_action text;
  v_msg text;
  v_warn text[];
  v_changes text[];
  v_names text;
  v_off boolean;
begin
  if p_mode not in ('update', 'replace') then
    raise exception 'Choose whether to add and update, or replace the list' using errcode = '22023';
  end if;
  if v_n > 5000 then
    raise exception 'That file has more than 5,000 people. Please split it in two' using errcode = '22023';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_row := p_rows -> v_i;
    v_line := coalesce(nullif(v_row ->> 'line', '')::integer, v_i + 2);
    v_name := btrim(regexp_replace(coalesce(v_row ->> 'name', ''), '\s+', ' ', 'g'));
    v_stand := lower(replace(replace(btrim(coalesce(v_row ->> 'standing', '')), ' ', '_'), '-', '_'));
    v_unit := nullif(btrim(coalesce(v_row ->> 'unit', '')), '');
    v_note := nullif(btrim(coalesce(v_row ->> 'note', '')), '');
    v_norms := '{}'; v_bad := '{}'; v_warn := '{}'; v_changes := '{}'; v_msg := null; v_ids := '{}';

    for v_c in select * from jsonb_array_elements(case when jsonb_typeof(v_row -> 'contacts') = 'array' then v_row -> 'contacts' else '[]'::jsonb end) loop
      v_raw := btrim(coalesce(v_c #>> '{}', ''));
      continue when v_raw = '';
      v_norm := public.referee_contact_norm(v_raw);
      if v_norm is null then
        v_bad := v_bad || left(v_raw, 40);
      elsif not (v_norm = any (v_norms)) then
        v_norms := v_norms || v_norm;
      end if;
    end loop;

    -- "Active: No" in the file takes a person off the list (found by their phone or email), whatever else the row says
    v_off := (v_row -> 'active') = 'false'::jsonb;
    if v_off then
      if cardinality(v_norms) = 0 then
        v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'error', 'name', v_name,
          'message', 'To take someone off the list, give the phone or email they are listed under'));
        continue;
      end if;
      select coalesce(array_agg(distinct c.entry_id), '{}') into v_ids from public.referee_directory_contacts c where c.value = any (v_norms);
      if cardinality(v_ids) > 1 then
        v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'error', 'name', v_name,
          'message', 'These contacts belong to two different people on the list'));
        continue;
      end if;
      if cardinality(v_ids) = 1 then
        select * into v_entry from public.referee_directory where id = v_ids[1];
        v_matched := v_matched || v_entry.id;
        if v_entry.active then
          v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'retire', 'entry_id', v_entry.id,
            'name', v_entry.name, 'standing', v_entry.standing, 'unit', v_entry.unit, 'changes', '[]'::jsonb, 'warn', '[]'::jsonb));
        else
          v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'unchanged', 'entry_id', v_entry.id,
            'name', v_entry.name, 'changes', '[]'::jsonb, 'warn', '[]'::jsonb));
        end if;
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'unchanged', 'name', v_name,
          'changes', '[]'::jsonb, 'warn', to_jsonb(array['Not on the list, so nothing to take off'])));
      end if;
      continue;
    end if;

    if char_length(v_name) < 2 then
      v_msg := 'Add a name';
    elsif char_length(v_name) > 80 then
      v_msg := 'The name is longer than 80 characters';
    elsif v_stand not in ('pastor', 'unit_head', 'ministry_leader') then
      v_msg := 'Role must be Pastor, Unit head or Ministry leader';
    elsif char_length(coalesce(v_unit, '')) > 80 then
      v_msg := 'The unit is longer than 80 characters';
    elsif char_length(coalesce(v_note, '')) > 200 then
      v_msg := 'The note is longer than 200 characters';
    elsif cardinality(v_norms) = 0 then
      v_msg := case when cardinality(v_bad) > 0 then 'Could not read "' || v_bad[1] || '" as a phone number or an email' else 'Add a phone number or an email' end;
    end if;
    if v_msg is null then
      foreach v_norm in array v_norms loop
        if v_seen ? v_norm then
          v_msg := 'Shares a phone or email with row ' || (v_seen ->> v_norm);
          exit;
        end if;
      end loop;
    end if;
    if v_msg is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'error', 'name', v_name, 'message', v_msg));
      continue;
    end if;
    foreach v_norm in array v_norms loop
      v_seen := v_seen || jsonb_build_object(v_norm, v_line);
    end loop;
    if cardinality(v_bad) > 0 then
      v_warn := v_warn || ('Ignored "' || v_bad[1] || '" (not a phone or email)');
    end if;

    select coalesce(array_agg(distinct c.entry_id), '{}') into v_ids from public.referee_directory_contacts c where c.value = any (v_norms);
    if cardinality(v_ids) > 1 then
      select string_agg(e.name, ' and ' order by e.name) into v_names from public.referee_directory e where e.id = any (v_ids);
      v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'error', 'name', v_name,
        'message', 'These contacts already belong to two different people in the list (' || coalesce(v_names, '') || ')'));
      continue;
    elsif cardinality(v_ids) = 1 then
      select * into v_entry from public.referee_directory where id = v_ids[1];
      v_matched := v_matched || v_entry.id;
      select coalesce(array_agg(c.value), '{}') into v_have from public.referee_directory_contacts c where c.entry_id = v_entry.id;
      v_new := array(select unnest(v_norms) except select unnest(v_have));
      v_gone := case when p_mode = 'replace' then array(select unnest(v_have) except select unnest(v_norms)) else '{}'::text[] end;
      if v_name <> v_entry.name then v_changes := array_append(v_changes, 'name'); end if;
      if v_stand <> v_entry.standing then v_changes := array_append(v_changes, 'role'); end if;
      if (p_mode = 'replace' and v_unit is distinct from v_entry.unit) or (p_mode = 'update' and v_unit is not null and v_unit is distinct from v_entry.unit) then
        v_changes := array_append(v_changes, 'unit');
      end if;
      if (p_mode = 'replace' and v_note is distinct from v_entry.note) or (p_mode = 'update' and v_note is not null and v_note is distinct from v_entry.note) then
        v_changes := array_append(v_changes, 'note');
      end if;
      if cardinality(v_new) > 0 then v_changes := v_changes || ('+' || cardinality(v_new) || ' contact' || case when cardinality(v_new) > 1 then 's' else '' end); end if;
      if cardinality(v_gone) > 0 then v_changes := v_changes || ('-' || cardinality(v_gone) || ' contact' || case when cardinality(v_gone) > 1 then 's' else '' end); end if;
      v_action := case when not v_entry.active then 'revive' when cardinality(v_changes) > 0 then 'update' else 'unchanged' end;
      if v_action = 'revive' then v_changes := array_prepend('back on the list', v_changes); end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', v_action, 'entry_id', v_entry.id,
        'name', v_name, 'standing', v_stand, 'unit', v_unit, 'note', v_note, 'contacts', to_jsonb(v_norms),
        'changes', to_jsonb(v_changes), 'warn', to_jsonb(v_warn)));
    else
      if exists (select 1 from public.referee_directory e where e.active and lower(e.name) = lower(v_name)) then
        v_warn := array_append(v_warn, 'Same name as someone already listed, with different contacts. Added as a new person');
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('line', v_line, 'action', 'add', 'name', v_name, 'standing', v_stand,
        'unit', v_unit, 'note', v_note, 'contacts', to_jsonb(v_norms), 'changes', '[]'::jsonb, 'warn', to_jsonb(v_warn)));
    end if;
  end loop;

  if p_mode = 'replace' then
    for v_entry in select * from public.referee_directory e where e.active and not (e.id = any (v_matched)) order by lower(e.name) loop
      v_out := v_out || jsonb_build_array(jsonb_build_object('line', null, 'action', 'retire', 'entry_id', v_entry.id,
        'name', v_entry.name, 'standing', v_entry.standing, 'unit', v_entry.unit, 'changes', '[]'::jsonb, 'warn', '[]'::jsonb));
    end loop;
  end if;
  return v_out;
end;
$$;

create function public.referee_plan_counts(p_plan jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'add', count(*) filter (where e ->> 'action' = 'add'),
    'update', count(*) filter (where e ->> 'action' in ('update', 'revive')),
    'unchanged', count(*) filter (where e ->> 'action' = 'unchanged'),
    'retire', count(*) filter (where e ->> 'action' = 'retire'),
    'error', count(*) filter (where e ->> 'action' = 'error'),
    'total', count(*) filter (where e ->> 'action' <> 'retire'))
  from jsonb_array_elements(coalesce(p_plan, '[]'::jsonb)) e;
$$;

-- What an upload would do, without doing it. People who would not change are counted, not listed.
create function public.referee_import_preview(p_rows jsonb, p_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_active integer;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  v_plan := public.referee_import_plan(p_rows, p_mode);
  select count(*) into v_active from public.referee_directory where active;
  return jsonb_build_object(
    'counts', public.referee_plan_counts(v_plan),
    'active_now', v_active,
    'rows', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_plan) e where e ->> 'action' <> 'unchanged'), '[]'::jsonb));
end;
$$;

-- Does it. People whose rows have problems are skipped and counted. A "replace" that would retire a large part of the list stops
-- unless p_force says it was meant: a wrong file must not empty the directory.
create function public.referee_import_apply(p_rows jsonb, p_mode text, p_filename text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan jsonb;
  v_counts jsonb;
  v_batch uuid;
  v_row jsonb;
  v_entry public.referee_directory;
  v_id uuid;
  v_active integer;
  v_c text;
  v_before jsonb;
  v_gone text[];
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  v_plan := public.referee_import_plan(p_rows, p_mode);
  v_counts := public.referee_plan_counts(v_plan);
  select count(*) into v_active from public.referee_directory where active;
  if (v_counts ->> 'retire')::integer > greatest(5, round(v_active * 0.4)) and not coalesce(p_force, false) then
    raise exception 'This would take % of the % people on the list off it. If that is what you meant, confirm it and try again', (v_counts ->> 'retire'), v_active
      using errcode = '22023';
  end if;
  if (v_counts ->> 'add')::integer + (v_counts ->> 'update')::integer + (v_counts ->> 'retire')::integer = 0 then
    return jsonb_build_object('ok', true, 'nothing', true, 'counts', v_counts);
  end if;

  insert into public.referee_import_batches (created_by, filename, mode, rows_total, added, updated, unchanged, retired, errors)
  values (auth.uid(), left(nullif(btrim(coalesce(p_filename, '')), ''), 120), p_mode, (v_counts ->> 'total')::integer,
          (v_counts ->> 'add')::integer, (v_counts ->> 'update')::integer, (v_counts ->> 'unchanged')::integer,
          (v_counts ->> 'retire')::integer, (v_counts ->> 'error')::integer)
  returning id into v_batch;

  for v_row in select * from jsonb_array_elements(v_plan) loop
    case v_row ->> 'action'
      when 'add' then
        insert into public.referee_directory (name, standing, unit, note, last_batch)
        values (v_row ->> 'name', v_row ->> 'standing', nullif(v_row ->> 'unit', ''), nullif(v_row ->> 'note', ''), v_batch)
        returning id into v_id;
        for v_c in select jsonb_array_elements_text(v_row -> 'contacts') loop
          insert into public.referee_directory_contacts (entry_id, kind, value) values (v_id, public.referee_contact_kind(v_c), v_c);
        end loop;
        insert into public.referee_directory_history (batch_id, entry_id, action) values (v_batch, v_id, 'add');
      when 'update', 'revive' then
        select * into v_entry from public.referee_directory where id = (v_row ->> 'entry_id')::uuid for update;
        v_before := jsonb_build_object('name', v_entry.name, 'standing', v_entry.standing, 'unit', v_entry.unit, 'note', v_entry.note,
          'active', v_entry.active,
          'contacts', (select coalesce(jsonb_agg(c.value), '[]'::jsonb) from public.referee_directory_contacts c where c.entry_id = v_entry.id));
        insert into public.referee_directory_history (batch_id, entry_id, action, before)
        values (v_batch, v_entry.id, case when v_row ->> 'action' = 'revive' then 'revive' else 'update' end, v_before);
        update public.referee_directory
           set name = v_row ->> 'name', standing = v_row ->> 'standing', active = true, last_batch = v_batch,
               unit = case when p_mode = 'replace' then nullif(v_row ->> 'unit', '') else coalesce(nullif(v_row ->> 'unit', ''), unit) end,
               note = case when p_mode = 'replace' then nullif(v_row ->> 'note', '') else coalesce(nullif(v_row ->> 'note', ''), note) end
         where id = v_entry.id;
        if p_mode = 'replace' then
          delete from public.referee_directory_contacts c
           where c.entry_id = v_entry.id and not (c.value = any (array(select jsonb_array_elements_text(v_row -> 'contacts'))));
        end if;
        for v_c in select jsonb_array_elements_text(v_row -> 'contacts') loop
          insert into public.referee_directory_contacts (entry_id, kind, value) values (v_entry.id, public.referee_contact_kind(v_c), v_c)
          on conflict do nothing;
        end loop;
      when 'retire' then
        select * into v_entry from public.referee_directory where id = (v_row ->> 'entry_id')::uuid for update;
        insert into public.referee_directory_history (batch_id, entry_id, action, before)
        values (v_batch, v_entry.id, 'retire', jsonb_build_object('name', v_entry.name, 'standing', v_entry.standing, 'unit', v_entry.unit,
          'note', v_entry.note, 'active', v_entry.active,
          'contacts', (select coalesce(jsonb_agg(c.value), '[]'::jsonb) from public.referee_directory_contacts c where c.entry_id = v_entry.id)));
        update public.referee_directory set active = false, last_batch = v_batch where id = v_entry.id;
      else
        null;
    end case;
  end loop;

  perform public.referee_rematch();
  perform public.write_event(auth.uid(), 'referee.directory_import', 'referee_directory', v_batch::text,
    jsonb_build_object('mode', p_mode, 'counts', v_counts));
  return jsonb_build_object('ok', true, 'batch', v_batch, 'counts', v_counts);
end;
$$;

-- Puts the list back as it was before the most recent upload. Only the latest one can be undone, so the later edits of a list are never lost.
create function public.referee_import_undo(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.referee_import_batches;
  h record;
  v_c text;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  select * into b from public.referee_import_batches where id = p_batch for update;
  if not found or b.status <> 'applied' then
    raise exception 'That upload cannot be undone' using errcode = '22023';
  end if;
  if exists (select 1 from public.referee_import_batches x where x.status = 'applied' and x.created_at > b.created_at) then
    raise exception 'Only the most recent upload can be undone' using errcode = '22023';
  end if;
  for h in select * from public.referee_directory_history where batch_id = p_batch order by id desc loop
    if h.action = 'add' then
      delete from public.referee_directory where id = h.entry_id;
    else
      update public.referee_directory
         set name = h.before ->> 'name', standing = h.before ->> 'standing', unit = h.before ->> 'unit', note = h.before ->> 'note',
             active = (h.before ->> 'active')::boolean
       where id = h.entry_id;
      delete from public.referee_directory_contacts where entry_id = h.entry_id;
      for v_c in select jsonb_array_elements_text(h.before -> 'contacts') loop
        insert into public.referee_directory_contacts (entry_id, kind, value) values (h.entry_id, public.referee_contact_kind(v_c), v_c)
        on conflict do nothing;
      end loop;
    end if;
  end loop;
  update public.referee_import_batches set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = p_batch;
  perform public.referee_rematch();
  perform public.write_event(auth.uid(), 'referee.directory_undo', 'referee_directory', p_batch::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.referee_import_history(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest uuid;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can see the directory' using errcode = '42501';
  end if;
  select id into v_latest from public.referee_import_batches where status = 'applied' order by created_at desc limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'at', b.created_at, 'by', public.person_display_name(b.created_by), 'filename', b.filename, 'mode', b.mode,
             'added', b.added, 'updated', b.updated, 'unchanged', b.unchanged, 'retired', b.retired, 'errors', b.errors,
             'status', b.status, 'can_undo', b.id = v_latest) order by b.created_at desc)
      from (select * from public.referee_import_batches order by created_at desc limit least(greatest(coalesce(p_limit, 12), 1), 50)) b), '[]'::jsonb);
end;
$$;

-- One page of the list, searchable by name, unit, phone or email.
create function public.referee_directory_list(
  p_search text default null,
  p_standing text default null,
  p_state text default 'active',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_norm text;
  v_total integer;
  v_rows jsonb;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can see the directory' using errcode = '42501';
  end if;
  if p_standing is not null and p_standing not in ('pastor', 'unit_head', 'ministry_leader') then
    p_standing := null;
  end if;
  if v_term is not null then
    v_like := '%' || replace(replace(replace(lower(v_term), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_norm := public.referee_contact_norm(v_term);
  end if;

  with hits as (
    select e.* from public.referee_directory e
     where (p_state = 'all' or (p_state = 'retired' and not e.active) or (p_state not in ('all', 'retired') and e.active))
       and (p_standing is null or e.standing = p_standing)
       and (v_term is null
            or lower(e.name) like v_like or lower(coalesce(e.unit, '')) like v_like
            or exists (select 1 from public.referee_directory_contacts c where c.entry_id = e.id and (c.value like v_like or c.value = v_norm)))
  )
  select (select count(*) from hits),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', x.id, 'name', x.name, 'standing', x.standing, 'unit', x.unit, 'note', x.note, 'active', x.active,
                     'updated_at', x.updated_at,
                     'contacts', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value) order by c.kind desc, c.value), '[]'::jsonb)
                                    from public.referee_directory_contacts c where c.entry_id = x.id)) order by lower(x.name))
                     from (select * from hits order by lower(name) limit least(greatest(coalesce(p_limit, 25), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- The whole list, for downloading, editing and uploading again.
create function public.referee_directory_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can see the directory' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', e.name, 'standing', e.standing, 'unit', e.unit, 'note', e.note, 'active', e.active,
             'phones', (select coalesce(jsonb_agg(c.value order by c.value), '[]'::jsonb) from public.referee_directory_contacts c where c.entry_id = e.id and c.kind = 'phone'),
             'emails', (select coalesce(jsonb_agg(c.value order by c.value), '[]'::jsonb) from public.referee_directory_contacts c where c.entry_id = e.id and c.kind = 'email'))
           order by e.active desc, lower(e.name))
      from public.referee_directory e), '[]'::jsonb);
end;
$$;

-- Add or edit one person by hand.
create function public.referee_directory_save(p_id uuid, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_fields ->> 'name', ''), '\s+', ' ', 'g'));
  v_stand text := lower(btrim(coalesce(p_fields ->> 'standing', '')));
  v_unit text := nullif(btrim(coalesce(p_fields ->> 'unit', '')), '');
  v_note text := nullif(btrim(coalesce(p_fields ->> 'note', '')), '');
  v_active boolean := coalesce((p_fields ->> 'active')::boolean, true);
  v_raw text;
  v_norm text;
  v_norms text[] := '{}';
  v_owner text;
  v_id uuid := p_id;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Add a name (2 to 80 characters)' using errcode = '22023';
  end if;
  if v_stand not in ('pastor', 'unit_head', 'ministry_leader') then
    raise exception 'Choose Pastor, Unit head or Ministry leader' using errcode = '22023';
  end if;
  if char_length(coalesce(v_unit, '')) > 80 or char_length(coalesce(v_note, '')) > 200 then
    raise exception 'The unit or note is too long' using errcode = '22023';
  end if;
  for v_raw in select jsonb_array_elements_text(case when jsonb_typeof(p_fields -> 'contacts') = 'array' then p_fields -> 'contacts' else '[]'::jsonb end) loop
    continue when btrim(v_raw) = '';
    v_norm := public.referee_contact_norm(v_raw);
    if v_norm is null then
      raise exception 'Could not read "%" as a phone number or an email', left(v_raw, 40) using errcode = '22023';
    end if;
    if not (v_norm = any (v_norms)) then v_norms := v_norms || v_norm; end if;
  end loop;
  if cardinality(v_norms) = 0 then
    raise exception 'Add at least one phone number or email' using errcode = '22023';
  end if;
  foreach v_norm in array v_norms loop
    select e.name into v_owner from public.referee_directory_contacts c join public.referee_directory e on e.id = c.entry_id
     where c.value = v_norm and e.id is distinct from p_id limit 1;
    if v_owner is not null then
      raise exception '% is already listed under %', v_norm, v_owner using errcode = '22023';
    end if;
  end loop;

  if p_id is null then
    insert into public.referee_directory (name, standing, unit, note, active) values (v_name, v_stand, v_unit, v_note, v_active) returning id into v_id;
  else
    update public.referee_directory set name = v_name, standing = v_stand, unit = v_unit, note = v_note, active = v_active where id = p_id;
    if not found then
      raise exception 'That person is not on the list' using errcode = 'P0002';
    end if;
    delete from public.referee_directory_contacts where entry_id = p_id;
  end if;
  foreach v_norm in array v_norms loop
    insert into public.referee_directory_contacts (entry_id, kind, value) values (v_id, public.referee_contact_kind(v_norm), v_norm);
  end loop;
  perform public.referee_rematch();
  perform public.write_event(auth.uid(), case when p_id is null then 'referee.directory_add' else 'referee.directory_edit' end,
    'referee_directory', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

-- Retire (or bring back) one person. Their history stays.
create function public.referee_directory_set_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  update public.referee_directory set active = coalesce(p_active, true) where id = p_id;
  if not found then
    raise exception 'That person is not on the list' using errcode = 'P0002';
  end if;
  perform public.referee_rematch();
  perform public.write_event(auth.uid(), 'referee.directory_active', 'referee_directory', p_id::text, jsonb_build_object('active', coalesce(p_active, true)));
end;
$$;

-- Remove one person completely (someone who asks not to be on the list).
create function public.referee_directory_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change the directory' using errcode = '42501';
  end if;
  delete from public.referee_directory where id = p_id;
  if not found then
    raise exception 'That person is not on the list' using errcode = 'P0002';
  end if;
  delete from public.referee_directory_history where entry_id = p_id;
  perform public.write_event(auth.uid(), 'referee.directory_delete', 'referee_directory', p_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- The pastorate: what has been proved, flags, confirmations, re-verification, settings
-- ---------------------------------------------------------------------------

create function public.referee_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.referee_settings := public.referee_cfg();
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', jsonb_build_object('gate_standings', to_jsonb(s.gate_standings), 'callback_pct', s.callback_pct, 'min_seconds', s.min_seconds,
      'code_minutes', s.code_minutes, 'max_tries', s.max_tries, 'max_changes', s.max_changes),
    'directory', jsonb_build_object(
      'active', (select count(*) from public.referee_directory where active),
      'retired', (select count(*) from public.referee_directory where not active),
      'pastor', (select count(*) from public.referee_directory where active and standing = 'pastor'),
      'unit_head', (select count(*) from public.referee_directory where active and standing = 'unit_head'),
      'ministry_leader', (select count(*) from public.referee_directory where active and standing = 'ministry_leader'),
      'updated_at', (select max(updated_at) from public.referee_directory)),
    'references', jsonb_build_object(
      'unverified', (select count(*) from public.leader_references r join public.referee_trust t on t.reference_id = r.id
                      join public.leader_applications a on a.id = r.application_id
                      where r.submitted_at is not null and t.verification = 'unverified'
                        and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')),
      'asked', (select count(*) from public.leader_references r join public.referee_trust t on t.reference_id = r.id
                 join public.leader_applications a on a.id = r.application_id
                 where r.submitted_at is not null and t.verification = 'unverified' and t.reverify_sent_at is not null
                   and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')),
      'held', (select count(*) from public.leader_references r join public.leader_applications a on a.id = r.application_id
                where r.submitted_at is not null and public.reference_held(r.id)
                  and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')),
      'to_confirm', (select count(*) from public.leader_references r join public.referee_trust t on t.reference_id = r.id
                      join public.leader_applications a on a.id = r.application_id
                      where r.submitted_at is not null and r.is_pastor_or_unit_head and not t.standing and t.verification in ('contact', 'directory')
                        and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed'))),
    'callbacks_open', (select count(*) from public.referee_callbacks where status = 'open'));
end;
$$;

create function public.referee_settings_save(p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.referee_settings := public.referee_cfg();
  v_gate text[];
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can change these' using errcode = '42501';
  end if;
  if p_changes ? 'gate_standings' then
    select coalesce(array_agg(distinct x), '{}') into v_gate from jsonb_array_elements_text(p_changes -> 'gate_standings') x
     where x in ('pastor', 'unit_head', 'ministry_leader');
    if cardinality(v_gate) = 0 then
      raise exception 'At least one kind of person has to count as a pastor or unit head' using errcode = '22023';
    end if;
  else
    v_gate := s.gate_standings;
  end if;
  update public.referee_settings
     set gate_standings = v_gate,
         callback_pct = coalesce(nullif(p_changes ->> 'callback_pct', '')::smallint, callback_pct),
         min_seconds = coalesce(nullif(p_changes ->> 'min_seconds', '')::smallint, min_seconds),
         updated_by = auth.uid(), updated_at = now()
   where id is true;
  perform public.referee_rematch();
  perform public.write_event(auth.uid(), 'referee.settings', 'referee_settings', 'main', '{}'::jsonb);
exception when check_violation then
  raise exception 'One of those numbers is out of range' using errcode = '22023';
end;
$$;

-- Everything a reviewer needs to weigh the referees of one application. Reviewers see who a referee is and what has been proved;
-- the applicant sees none of this.
create function public.referee_review(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  v_decider boolean := public.referee_decider();
begin
  if not public.is_review_panel() then
    raise exception 'Only the review panel can see this' using errcode = '42501';
  end if;
  select * into a from public.leader_applications where id = p_app;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'slot', r.slot, 'name', r.referee_name, 'stage', r.stage, 'answered', r.submitted_at is not null,
      'verification', t.verification, 'standing', t.standing, 'claimed_head', r.is_pastor_or_unit_head, 'legacy', t.legacy,
      'verified_at', t.verified_at, 'verified_kind', t.verified_kind, 'reverify_sent', t.reverify_sent_at is not null,
      'reverified', t.reverified_at is not null, 'changes', r.changes,
      'directory', case when e.id is not null and e.active then jsonb_build_object('name', e.name, 'standing', e.standing, 'unit', e.unit) end,
      'held', public.reference_held(r.id),
      'flags', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'severity', f.severity, 'detail', f.detail,
                                'cleared', f.cleared_at is not null, 'cleared_by', public.person_display_name(f.cleared_by), 'cleared_note', f.cleared_note)
                                order by f.created_at)
                           from public.leader_reference_flags f where f.reference_id = r.id), '[]'::jsonb),
      'callback', (select jsonb_build_object('status', c.status, 'outcome', c.outcome, 'reason', c.reason, 'note', c.note)
                     from public.referee_callbacks c where c.reference_id = r.id),
      'confirmed_by', public.person_display_name(t.confirmed_by), 'confirmed_note', t.confirmed_note,
      'can_confirm', v_decider and a.person_id <> auth.uid() and not t.standing and t.verification <> 'disputed'
                     and (t.verified_at is not null or t.legacy),
      'can_clear', v_decider and a.person_id <> auth.uid()
                     and exists (select 1 from public.leader_reference_flags f where f.reference_id = r.id and f.cleared_at is null))
      order by r.slot)
      from public.leader_references r
      join public.referee_trust t on t.reference_id = r.id
      left join public.referee_directory e on e.id = t.directory_entry_id
     where r.application_id = p_app), '[]'::jsonb);
end;
$$;

-- A pastor confirms, in one tap, that this referee is a pastor or unit head. For a referee outside the directory this is the only way.
create function public.referee_confirm_standing(p_reference uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
begin
  if not public.referee_decider() then
    raise exception 'Only a pastor or the director can confirm this' using errcode = '42501';
  end if;
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  if a.person_id = auth.uid() then
    raise exception 'You cannot confirm a referee on your own application' using errcode = '42501';
  end if;
  select * into t from public.referee_trust where reference_id = r.id for update;
  if t.verification = 'disputed' then
    raise exception 'This referee said the reference was not theirs' using errcode = '22023';
  end if;
  if t.verified_at is null and not t.legacy then
    raise exception 'Wait until the referee has confirmed the code we sent them' using errcode = '22023';
  end if;
  update public.referee_trust
     set standing = true, confirmed_by = auth.uid(), confirmed_at = now(),
         confirmed_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300),
         verification = case when verification in ('unverified', 'contact') then 'pastor' else verification end
   where reference_id = r.id;
  perform public.write_event(auth.uid(), 'reference.standing_confirmed', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
end;
$$;

-- A pastor clears the flags on a reference after looking into them. The note is required: it is the record of why.
create function public.referee_flags_clear(p_reference uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if not public.referee_decider() then
    raise exception 'Only a pastor or the director can clear these' using errcode = '42501';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'Say briefly what you checked' using errcode = '22023';
  end if;
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  if a.person_id = auth.uid() then
    raise exception 'You cannot clear flags on your own application' using errcode = '42501';
  end if;
  if exists (select 1 from public.referee_trust t where t.reference_id = r.id and t.verification = 'disputed') then
    raise exception 'This referee said the reference was not theirs, so it cannot be cleared' using errcode = '22023';
  end if;
  update public.leader_reference_flags set cleared_by = auth.uid(), cleared_at = now(), cleared_note = v_note
   where reference_id = r.id and cleared_at is null;
  perform public.write_event(auth.uid(), 'reference.flags_cleared', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
end;
$$;

-- References received before this release, still unverified, on applications that are still open.
create function public.referee_unverified_list(p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can see this' using errcode = '42501';
  end if;
  select count(*) into v_total from public.leader_references r join public.referee_trust t on t.reference_id = r.id
    join public.leader_applications a on a.id = r.application_id
   where r.submitted_at is not null and t.verification = 'unverified'
     and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed');
  return jsonb_build_object('total', v_total, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'application_id', x.application_id, 'applicant', public.person_display_name(x.person_id), 'referee', x.referee_name,
             'relationship', x.relationship, 'kind', x.contact_kind, 'masked', public.referee_mask(x.contact_kind, x.contact_norm),
             'answered_at', x.submitted_at, 'asked_at', x.reverify_sent_at, 'reachable', x.contact_norm is not null) order by x.submitted_at)
      from (select r.id, r.application_id, a.person_id, r.referee_name, r.relationship, r.contact_kind, r.contact_norm, r.submitted_at, t.reverify_sent_at
              from public.leader_references r join public.referee_trust t on t.reference_id = r.id
              join public.leader_applications a on a.id = r.application_id
             where r.submitted_at is not null and t.verification = 'unverified'
               and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
             order by r.submitted_at limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end;
$$;

-- Asks one referee to confirm a reference they gave before this release. The link is made when the message goes out.
create function public.referee_reverify_send(p_reference uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leader_references;
  a public.leader_applications;
  t public.referee_trust;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can do this' using errcode = '42501';
  end if;
  select * into r from public.leader_references where id = p_reference;
  if not found then
    raise exception 'Referee not found' using errcode = 'P0002';
  end if;
  select * into a from public.leader_applications where id = r.application_id;
  select * into t from public.referee_trust where reference_id = r.id for update;
  if r.submitted_at is null or not t.legacy or t.verification <> 'unverified' or t.reverified_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not needed');
  end if;
  if a.status not in ('submitted', 'interview_invited', 'interview_booked', 'interviewed') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if r.contact_norm is null then
    return jsonb_build_object('ok', false, 'reason', 'no contact');
  end if;
  if t.reverify_sent_at is not null and t.reverify_sent_at > now() - interval '3 days' then
    return jsonb_build_object('ok', false, 'reason', 'recent');
  end if;
  perform public.enqueue_message(
    null, 'referee_reverify',
    jsonb_build_object('reference_id', r.id, 'contact', r.contact_norm),
    null, 'refverify:' || r.id::text || ':' || gen_random_uuid()::text,
    null, 'normal', null,
    case when r.contact_kind = 'email' then r.contact_norm end,
    case when r.contact_kind = 'phone' then r.contact_norm end,
    r.referee_name);
  update public.referee_trust set reverify_sent_at = now() where reference_id = r.id;
  perform public.write_event(auth.uid(), 'reference.reverify_sent', 'leader_application', a.id::text, jsonb_build_object('slot', r.slot));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.referee_reverify_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_res jsonb;
  v_sent integer := 0;
  v_skipped integer := 0;
begin
  if not public.referee_manager() then
    raise exception 'Only a pastor, the director or an admin can do this' using errcode = '42501';
  end if;
  for v_id in
    select r.id from public.leader_references r join public.referee_trust t on t.reference_id = r.id
      join public.leader_applications a on a.id = r.application_id
     where r.submitted_at is not null and t.verification = 'unverified' and t.legacy and t.reverified_at is null
       and a.status in ('submitted', 'interview_invited', 'interview_booked', 'interviewed')
     order by r.submitted_at
  loop
    v_res := public.referee_reverify_send(v_id);
    if (v_res ->> 'ok')::boolean then v_sent := v_sent + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------------
-- The call-back queue for the care team
-- ---------------------------------------------------------------------------

create function public.referee_callbacks_open()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.referee_care() then
    raise exception 'Only the care team can see these calls' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'reason', c.reason, 'due_on', c.due_on, 'overdue', c.due_on < public.today_lagos(), 'attempts', c.attempts,
      'referee', r.referee_name, 'relationship', r.relationship, 'contact', r.contact, 'kind', r.contact_kind,
      'applicant', public.person_display_name(a.person_id), 'application_id', a.id) order by c.due_on, c.created_at)
      from public.referee_callbacks c
      join public.leader_references r on r.id = c.reference_id
      join public.leader_applications a on a.id = r.application_id
     where c.status = 'open'), '[]'::jsonb);
end;
$$;

-- The outcome of a call. "Not reached" keeps it open for another try (three in all). "Not them" disputes the reference.
create function public.referee_callback_close(p_id uuid, p_outcome text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.referee_callbacks;
  r public.leader_references;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
begin
  if not public.referee_care() then
    raise exception 'Only the care team can record these calls' using errcode = '42501';
  end if;
  if p_outcome not in ('confirmed', 'not_reached', 'not_them') then
    raise exception 'Choose what happened on the call' using errcode = '22023';
  end if;
  select * into c from public.referee_callbacks where id = p_id for update;
  if not found or c.status <> 'open' then
    raise exception 'That call has already been recorded' using errcode = 'P0002';
  end if;
  select * into r from public.leader_references where id = c.reference_id;
  if p_outcome = 'not_reached' then
    if c.attempts + 1 >= 3 then
      update public.referee_callbacks set status = 'dismissed', outcome = 'not_reached', attempts = c.attempts + 1, note = v_note,
             closed_by = auth.uid(), closed_at = now() where id = c.id;
    else
      update public.referee_callbacks set attempts = c.attempts + 1, note = v_note, due_on = public.today_lagos() + 2 where id = c.id;
    end if;
  else
    update public.referee_callbacks set status = 'done', outcome = p_outcome, note = v_note, attempts = c.attempts + 1,
           closed_by = auth.uid(), closed_at = now() where id = c.id;
    if p_outcome = 'not_them' then
      update public.referee_trust set verification = 'disputed' where reference_id = r.id;
      insert into public.leader_reference_flags (reference_id, kind, severity, detail)
      values (r.id, 'disowned', 'hold', 'On the call-back the referee said this was not theirs') on conflict do nothing;
    end if;
  end if;
  perform public.write_event(auth.uid(), 'reference.callback', 'leader_application', r.application_id::text,
    jsonb_build_object('outcome', p_outcome));
end;
$$;

-- Run by the five-minute heartbeat: forget old hashes and expired codes.
create function public.worker_referee_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old integer;
  v_codes integer;
begin
  perform public.worker_ok(p_token);
  delete from public.applicant_sessions where seen_at < now() - interval '45 days';
  get diagnostics v_old = row_count;
  update public.referee_access set code_hash = null, code_salt = null where code_hash is not null and code_expires_at < now();
  get diagnostics v_codes = row_count;
  update public.referee_access set session_hash = null, session_expires_at = null where session_hash is not null and session_expires_at < now();
  -- A request that never found a channel to go out on should not sit as "sending"
  update public.leader_references set stage = 'unreachable'
   where stage = 'sending' and last_request_at < now() - interval '2 hours';
  return jsonb_build_object('hashes_forgotten', v_old, 'codes_expired', v_codes,
    'callbacks_open', (select count(*) from public.referee_callbacks where status = 'open'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Readiness: held references and disputed ones do not count; the pastor-or-unit-head gate reads what the system proved
-- ---------------------------------------------------------------------------
create or replace function public.application_readiness(p_app uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.leader_applications;
  calling numeric;
  calling_n int;
  calling_people_n int;
  calling_source text := 'people';
  ai_pct numeric;
  st public.leader_ai_state;
  interview numeric;
  interview_n int;
  scen numeric;
  refs numeric;
  refs_n int;
  concerns int;
  has_head boolean;
  goal_ok boolean;
  readiness numeric;
  held_n int;
  unverified_n int;
begin
  select * into a from public.leader_applications where id = p_app;
  if not found then return null; end if;

  select avg(public.rating_pct(scores)), count(*) into calling, calling_n
    from public.leader_reviews where application_id = p_app and stage = 'calling';
  calling_people_n := calling_n;
  select * into st from public.leader_ai_state where application_id = p_app;
  if st.basis = 'ai' and st.state = 'clear' then
    select s.calling_pct into ai_pct from public.leader_ai_scores s
     where s.application_id = p_app and not s.shadow and s.ai_ran and s.outcome = 'clear'
     order by s.run desc limit 1;
    if ai_pct is not null then
      calling := ai_pct;
      calling_n := 2;
      calling_source := 'ai';
    end if;
  end if;
  select avg(public.rating_pct(scores)), count(*) into interview, interview_n
    from public.leader_reviews where application_id = p_app and stage = 'interview';
  select scenario_pct into scen from public.leader_assessments where application_id = p_app;

  select avg((ra.reliability + ra.warmth + ra.confidentiality + ra.maturity) / 4.0 / 5 * 100), count(*)
    into refs, refs_n
    from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
    join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and rt.verification <> 'disputed' and not public.reference_held(r.id);
  select count(*) into concerns
    from public.leader_references r join public.leader_reference_answers ra on ra.reference_id = r.id
   where r.application_id = p_app and ra.concern and ra.concern_cleared_at is null;
  -- The system's own answer (the directory, or a pastor's confirmation), not the applicant's tick
  select coalesce(bool_or(rt.standing), false) into has_head
    from public.leader_references r join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and r.submitted_at is not null and rt.verification <> 'disputed' and not public.reference_held(r.id);
  select count(*) filter (where public.reference_held(r.id)), count(*) filter (where rt.verification = 'unverified')
    into held_n, unverified_n
    from public.leader_references r join public.referee_trust rt on rt.reference_id = r.id
   where r.application_id = p_app and r.submitted_at is not null;

  goal_ok := coalesce(nullif(btrim(a.answers #>> '{calling,goal}'), ''), nullif(btrim(a.answers #>> '{calling,goalOther}'), '')) is not null;

  if calling_n >= 2 and interview_n >= 2 and scen is not null and refs_n >= 2 then
    readiness := round(calling * 0.30 + scen * 0.25 + refs * 0.25 + interview * 0.20, 1);
  end if;

  return jsonb_build_object(
    'calling', round(calling, 1), 'calling_reviews', calling_people_n, 'calling_source', calling_source,
    'scenarios', scen,
    'references', round(refs, 1), 'references_received', refs_n,
    'interview', round(interview, 1), 'interview_reviews', interview_n,
    'readiness', readiness,
    'gates', jsonb_build_object(
      'goal_declared', goal_ok,
      'references_clean', refs_n >= 2 and concerns = 0 and has_head,
      'open_concerns', concerns,
      'pastor_or_unit_head_referee', has_head,
      'references_held', coalesce(held_n, 0), 'references_unverified', coalesce(unverified_n, 0)),
    'band', case
      when readiness is null then null
      when readiness >= 75 then 'leader'
      when readiness >= 60 then 'assistant_leader'
      else 'below' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- What the sending service is handed for a referee's message: the live link and the code are made here, at the moment of sending
-- ---------------------------------------------------------------------------
create or replace function public.claim_prepare(m public.messages)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.reminder_settings := public.reminder_cfg();
  r public.journey_runs;
  b public.broadcasts;
  e public.journey_emails;
  v_state text;
  v_step integer;
  v_data jsonb;
  v_copy jsonb;
  v_links jsonb := '{}'::jsonb;
  v_action text;
  v_blocker text;
  rr public.leader_references;
  ra public.leader_applications;
  rt public.referee_trust;
  rac public.referee_access;
  rcfg public.referee_settings;
  v_code text;
  v_salt text;
  v_secret text;
begin
  -- A referee has no account: their messages carry a fresh link or a fresh code, made now and never stored in a readable form.
  if m.template in ('referee_request', 'referee_reverify', 'referee_code') then
    rcfg := public.referee_cfg();
    select * into rr from public.leader_references where id = nullif(m.params ->> 'reference_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    -- A message for a contact that has since been replaced must never carry the new person's link
    if rr.contact_norm is distinct from (m.params ->> 'contact') then
      return jsonb_build_object('ok', false, 'reason', 'the referee was changed');
    end if;
    select * into ra from public.leader_applications where id = rr.application_id;
    select * into rt from public.referee_trust where reference_id = rr.id;
    if m.template = 'referee_reverify' then
      if rr.submitted_at is null or rt.reverified_at is not null or rt.verification <> 'unverified' then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    elsif m.template = 'referee_request' then
      if rr.submitted_at is not null or ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved') then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    else
      if (rr.submitted_at is not null and not (coalesce(rt.legacy, false) and rt.reverify_sent_at is not null and rt.reverified_at is null))
         or (rr.submitted_at is null and ra.status in ('draft', 'ineligible', 'approved_leader', 'approved_assistant', 'not_approved')) then
        return jsonb_build_object('ok', false, 'reason', 'no longer needed');
      end if;
    end if;

    if m.template = 'referee_code' then
      select * into rac from public.referee_access where reference_id = rr.id for update;
      if rac.locked_until is not null and rac.locked_until > now() then
        return jsonb_build_object('ok', false, 'reason', 'locked');
      end if;
      v_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
      v_salt := public.referee_secret();
      update public.referee_access
         set code_salt = v_salt, code_hash = public.referee_hash(v_salt || v_code),
             code_expires_at = now() + make_interval(mins => rcfg.code_minutes), code_tries = 0
       where reference_id = rr.id;
      return jsonb_build_object('ok', true, 'params', jsonb_build_object(
        'kind', 'referee_code', 'code', v_code, 'minutes', rcfg.code_minutes,
        'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id)));
    end if;

    v_secret := public.referee_secret();
    update public.leader_references
       set token_hash = public.referee_hash(v_secret), token_expires_at = now() + make_interval(days => rcfg.link_days)
     where id = rr.id;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', m.template, 'secret', v_secret, 'days', rcfg.link_days,
      'referee', rr.referee_name, 'applicant', public.person_display_name(ra.person_id),
      'applicant_first', public.first_name_of(ra.person_id)));
  end if;

  if m.person_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no person');
  end if;

  if m.template = 'reminder_email' then
    select * into r from public.journey_runs where id = nullif(m.params ->> 'run_id', '')::uuid;
    if not found or r.status <> 'active' then
      return jsonb_build_object('ok', false, 'reason', 'no longer needed');
    end if;
    v_state := public.journey_state(r);
    if v_state <> 'ok' then
      perform public.journey_apply_state(r.id, v_state);
      update public.journey_sends set kind = 'skipped', reason = left(coalesce(substr(v_state, 7), 'acted'), 60) where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'condition changed: ' || v_state);
    end if;
    if not public.send_window_ok('reminder') then
      return jsonb_build_object('ok', false, 'defer', true);
    end if;
    v_step := nullif(m.params ->> 'step', '')::integer;
    select * into e from public.journey_emails x where x.journey_key = r.journey_key and x.step = v_step;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'no wording');
    end if;
    v_data := public.journey_data(r);
    if r.journey_key = 'no_tribe' and v_step = 3 and coalesce((v_data ->> 'seats_left')::integer, 0) <= 0 then
      update public.journey_sends set kind = 'skipped', reason = 'no seats left' where message_id = m.id;
      return jsonb_build_object('ok', false, 'reason', 'the best match has no seats left');
    end if;
    v_copy := jsonb_build_object('subject', e.subject, 'paragraphs', to_jsonb(e.paragraphs), 'button_label', e.button_label,
      'actions', to_jsonb(e.actions), 'tone', e.tone, 'step', v_step, 'journey', r.journey_key);
    if e.target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', e.target, r.id, null, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'reminders', r.id, null, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', r.id, null, 400));
    foreach v_action in array e.actions loop
      v_links := v_links || jsonb_build_object(v_action, public.make_email_link(m.person_id, 'ask', v_action, r.id, null, 90));
    end loop;
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'reminder', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));

  elsif m.template = 'office_message' then
    select * into b from public.broadcasts where id = nullif(m.params ->> 'broadcast_id', '')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'announcement is gone');
    end if;
    if not (m.params ? 'test') then
      if b.status = 'paused' then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
      if b.status not in ('scheduled', 'sending', 'sent') then
        update public.broadcast_recipients set status = 'skipped', reason = 'cancelled' where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', 'announcement ' || b.status);
      end if;
      v_blocker := coalesce(public.message_blocker(m.person_id), case when public.reminder_stopped(m.person_id, 'announcements') then 'announcements_off' end);
      if v_blocker is not null then
        update public.broadcast_recipients set status = 'skipped', reason = v_blocker where message_id = m.id;
        return jsonb_build_object('ok', false, 'reason', v_blocker);
      end if;
      if not public.send_window_ok('bulk') then
        return jsonb_build_object('ok', false, 'defer', true);
      end if;
    end if;
    v_data := public.broadcast_vars(m.person_id);
    v_copy := jsonb_build_object('subject', (case when m.params ? 'test' then '[Test] ' else '' end) || b.subject,
      'paragraphs', to_jsonb(b.paragraphs), 'button_label', b.button_label, 'actions', '[]'::jsonb, 'tone', 'office', 'step', 0);
    if b.button_target is not null then
      v_links := v_links || jsonb_build_object('go', public.make_email_link(m.person_id, 'go', b.button_target, null, case when m.params ? 'test' then null else b.id end, 45));
    end if;
    v_links := v_links || jsonb_build_object(
      'stop', public.make_email_link(m.person_id, 'stop', 'announcements', null, case when m.params ? 'test' then null else b.id end, 400),
      'prefs', public.make_email_link(m.person_id, 'prefs', 'all', null, null, 400));
    return jsonb_build_object('ok', true, 'params', jsonb_build_object(
      'kind', 'announcement', 'copy', v_copy, 'data', v_data, 'links', v_links,
      'church', jsonb_build_object('name', s.church_name, 'address', s.church_address)));
  end if;
  return jsonb_build_object('ok', true, 'params', '{}'::jsonb);
end;
$$;

create or replace function public.worker_claim(p_token text, p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  v_hour integer := public.lagos_hour();
  v_channels text[];
  v_out jsonb := '[]'::jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_first text;
  v_prep jsonb;
  v_extra jsonb;
begin
  perform public.worker_ok(p_token);

  for m in
    select * from public.messages x
     where ((x.status = 'queued' and x.scheduled_for <= now())
         or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'))
       -- quiet hours: nothing but urgent messages between 22:00 and 06:00 in Lagos
       and (x.urgency = 'urgent' or v_hour between 6 and 21)
     order by (x.urgency = 'urgent') desc, x.scheduled_for
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  loop
    v_extra := null;
    if m.template in ('reminder_email', 'office_message', 'referee_request', 'referee_reverify', 'referee_code') then
      v_prep := public.claim_prepare(m);
      if (v_prep ->> 'ok')::boolean is not true then
        if (v_prep ->> 'defer')::boolean is true then
          update public.messages set status = 'queued', claimed_at = null, scheduled_for = now() + interval '15 minutes' where id = m.id;
        else
          update public.messages set status = 'skipped', error = left(coalesce(v_prep ->> 'reason', 'left out'), 300), channel = null where id = m.id;
        end if;
        continue;
      end if;
      v_extra := v_prep -> 'params';
    end if;

    v_channels := public.message_channels(m.id);
    if cardinality(v_channels) = 0 then
      update public.messages
         set status = case when m.urgency = 'urgent' then 'failed' else 'skipped' end,
             error = coalesce(nullif(m.error, ''), 'no channel the person has agreed to'),
             channel = null
       where id = m.id;
      continue;
    end if;

    update public.messages
       set status = 'sending', channel = v_channels[1], claimed_at = now(), attempts = m.attempts + 1
     where id = m.id;

    if m.person_id is not null then
      select p.email, public.person_display_name(p.id), public.first_name_of(p.id), cp.phone
        into v_email, v_name, v_first, v_phone
        from public.people p
        left join public.contact_preferences cp on cp.person_id = p.id
       where p.id = m.person_id;
    else
      v_email := m.to_email;
      v_phone := m.to_phone;
      v_name := m.to_name;
      v_first := split_part(coalesce(m.to_name, ''), ' ', 1);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', m.id,
      'template', m.template,
      'channel', v_channels[1],
      'params', m.params || coalesce(v_extra, '{}'::jsonb),
      'urgency', m.urgency,
      'attempts', m.attempts + 1,
      'reply_token', m.reply_token,
      'to', jsonb_build_object('email', v_email, 'phone', v_phone, 'name', v_name, 'first_name', nullif(v_first, ''))));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- What the applicant can read about the people they named: who, how they know them, and how the request is going. The link's hash
-- and its expiry never leave the database, and nothing here says anything about the church's list.
revoke select on public.leader_references from authenticated;
grant select (id, application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, created_at, submitted_at,
              contact_kind, stage, sent_at, last_request_at, requests, changes)
  on public.leader_references to authenticated;

revoke execute on function
  public.referee_cfg(),
  public.referee_phone_norm(text),
  public.referee_email_norm(text),
  public.referee_contact_norm(text),
  public.referee_contact_kind(text),
  public.referee_domain_blocked(text),
  public.referee_manager(),
  public.referee_decider(),
  public.referee_care(),
  public.referee_directory_match(text),
  public.reference_held(uuid),
  public.referee_secret(),
  public.referee_hash(text),
  public.referee_mask(text, text),
  public.referee_import_plan(jsonb, text),
  public.referee_plan_counts(jsonb),
  public.referee_rematch(),
  public.referee_message_outcome(),
  public.referee_row_defaults(),
  public.referee_row_init(),
  public.set_referee(uuid, integer, text, text, text, boolean),
  public.request_referee_send(uuid),
  public.referee_note_applicant(text, text),
  public.referee_open(text, text, text, text, boolean),
  public.referee_ask_code(text, text),
  public.referee_check_code(text, text, text, text),
  public.submit_reference(text, text, integer, integer, integer, integer, boolean, text, text, text, text, bigint, integer),
  public.referee_reverify_answer(text, text, boolean),
  public.referee_import_preview(jsonb, text),
  public.referee_import_apply(jsonb, text, text, boolean),
  public.referee_import_undo(uuid),
  public.referee_import_history(integer),
  public.referee_directory_list(text, text, text, integer, integer),
  public.referee_directory_export(),
  public.referee_directory_save(uuid, jsonb),
  public.referee_directory_set_active(uuid, boolean),
  public.referee_directory_delete(uuid),
  public.referee_overview(),
  public.referee_settings_save(jsonb),
  public.referee_review(uuid),
  public.referee_confirm_standing(uuid, text),
  public.referee_flags_clear(uuid, text),
  public.referee_unverified_list(integer, integer),
  public.referee_reverify_send(uuid),
  public.referee_reverify_all(),
  public.referee_callbacks_open(),
  public.referee_callback_close(uuid, text, text),
  public.worker_referee_tick(text)
  from public, anon, authenticated;

-- People who are signed in (each function checks the role itself).
grant execute on function
  public.set_referee(uuid, integer, text, text, text, boolean),
  public.request_referee_send(uuid),
  public.referee_note_applicant(text, text),
  public.referee_import_preview(jsonb, text),
  public.referee_import_apply(jsonb, text, text, boolean),
  public.referee_import_undo(uuid),
  public.referee_import_history(integer),
  public.referee_directory_list(text, text, text, integer, integer),
  public.referee_directory_export(),
  public.referee_directory_save(uuid, jsonb),
  public.referee_directory_set_active(uuid, boolean),
  public.referee_directory_delete(uuid),
  public.referee_overview(),
  public.referee_settings_save(jsonb),
  public.referee_review(uuid),
  public.referee_confirm_standing(uuid, text),
  public.referee_flags_clear(uuid, text),
  public.referee_unverified_list(integer, integer),
  public.referee_reverify_send(uuid),
  public.referee_reverify_all(),
  public.referee_callbacks_open(),
  public.referee_callback_close(uuid, text, text)
  to authenticated;

-- The referee has no account: the link is the first key and the code the second. The sending service uses its token.
grant execute on function
  public.referee_open(text, text, text, text, boolean),
  public.referee_ask_code(text, text),
  public.referee_check_code(text, text, text, text),
  public.submit_reference(text, text, integer, integer, integer, integer, boolean, text, text, text, text, bigint, integer),
  public.referee_reverify_answer(text, text, boolean),
  public.worker_referee_tick(text)
  to anon, authenticated;

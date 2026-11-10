-- Way back from "the Leader Desk, Phase 2b-2" (Open tribe, the pastors' 24-hour reminder, the leader pipeline and its limits).
--
-- Puts back, exactly as they were, the two functions Phase 2b-2 replaced: desk_interest_check (as Phase 2a had it) and desk_tick (as Phase 2b-1 had it). Drops what
-- 2b-2 added: its functions and the opened_at column on the Desk's groups. The Switchboard text for the Leader Desk goes back to Phase 2b-1's.
--
-- What it does to data, plainly:
--   * Members already placed by Open tribe stay placed: those are ordinary seats, placed by the ordinary function, and taking them back is Undo's job, not this file's.
--   * A draft that Open tribe archived stays archived.
--   * A reminder already sent to the pastors stays sent. Nothing sends another.
--   * The settings the owner changed stay as they are (the columns belong to Phase 2b-1).
--   * No member, seat, notice, consent or number is changed.
-- Put the application files back before this one. Run it as the database owner. Running it twice changes nothing.
begin;
-- (the functions below are put back word for word. Their text may name a table that an earlier phase's way back has since dropped, so they are not checked
-- against the tables as they are now: each is checked against the database as it was, by the rollback test)
set local check_function_bodies = off;

update public.feature_registry
   set blurb = 'An owner-only page in God Mode for members who finished the form and still have no tribe. It shows who is waiting and why, a masked phone number (opened one at a time, in calling hours), draft groups scored like tribe cards, and each member''s leadership signal. It can email a waiting member one open tribe that fits, ask the members of a draft whether it would suit them, and offer a draft group to a member to lead (with up to two backups, 72 hours to answer, started from a private page, a confirmed age of 21 or more, and the tribe card started from the draft for a pastor to approve). Rehearsal writes down what would be sent and sends nothing. It never places anyone, approves a card or certifies a leader.'
 where key = 'leader_desk';

create or replace function public.desk_interest_check(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.desk_groups%rowtype;
  m record;
  v_season uuid := public.placement_season();
  v_state text;
  v_code text;
  v_params jsonb;
  v_sent integer := 0;
  v_would integer := 0;
  v_skipped jsonb := '{}'::jsonb;
  v_res jsonb;
begin
  perform public.desk_need();
  select * into g from public.desk_groups x where x.id = p_group;
  if not found then
    raise exception 'No such group' using errcode = 'P0002';
  end if;
  if g.status <> 'draft' then
    raise exception 'That group has been archived' using errcode = '22023';
  end if;
  if not exists (select 1 from public.desk_group_members x where x.group_id = p_group) then
    raise exception 'Put at least one member in the group first' using errcode = '22023';
  end if;
  for m in select x.person_id from public.desk_group_members x where x.group_id = p_group order by x.added_at, x.person_id loop
    v_state := public.desk_mail_state(m.person_id);
    v_code := case
      when v_state not in ('on', 'rehearsal') then 'off'
      when exists (select 1 from public.desk_proposals x where x.group_id = p_group and x.person_id = m.person_id and x.status in ('sent', 'would_send', 'answered')
                      and x.rehearsal = (v_state = 'rehearsal')) then 'already'
      when v_season is null or not exists (select 1 from public.desk_waiting_base(v_season) w where w.person_id = m.person_id) then 'not_waiting'
      else coalesce(public.desk_mail_block(m.person_id), public.desk_mail_cap(m.person_id, v_state = 'rehearsal')) end;
    if v_code is null and jsonb_array_length(public.desk_group_fit(m.person_id, p_group) -> 'blocked') > 0 then
      v_code := 'no_fit';
    end if;
    if v_code is not null then
      v_skipped := jsonb_set(v_skipped, array[v_code], to_jsonb(coalesce((v_skipped ->> v_code)::integer, 0) + 1));
      continue;
    end if;
    v_params := public.desk_interest_params(p_group, m.person_id);
    v_res := public.desk_mail_send('interest', m.person_id, null, p_group, null, v_params, auth.uid());
    if v_res ->> 'status' = 'would_send' then
      v_would := v_would + 1;
    else
      v_sent := v_sent + 1;
    end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'would_send', v_would, 'skipped', v_skipped);
end;
$$;

create or replace function public.desk_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer;
  v_links integer;
  v_cleared integer;
  v_offers jsonb;
begin
  v_offers := public.desk_offer_tick();
  update public.desk_proposals set status = 'expired' where status = 'sent' and expires_at < now();
  get diagnostics v_expired = row_count;
  delete from public.desk_links where expires_at < now();
  get diagnostics v_links = row_count;
  update public.messages set reply_token = null
   where reply_token is not null and template in ('desk_proposal', 'desk_interest', 'desk_found', 'desk_offer')
     and (status in ('failed', 'skipped') or (status in ('sent', 'delivered', 'read') and sent_at < now() - interval '1 hour'));
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('expired', v_expired, 'links', v_links, 'cleared', v_cleared) || v_offers;
end;
$$;

drop function if exists public.desk_pipeline_settings_set(integer, integer, integer, integer, text);
drop function if exists public.desk_pipeline();
drop function if exists public.desk_open_tribe(uuid);
drop function if exists public.desk_open_preview(uuid);
drop function if exists public.desk_card_tick();
drop function if exists public.desk_open_plan(uuid);
drop function if exists public.desk_open_words(text);

alter table if exists public.desk_groups drop column if exists opened_at;

commit;

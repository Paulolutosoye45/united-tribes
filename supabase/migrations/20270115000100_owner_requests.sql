-- =============================================================================
-- United Tribes: requests to the owner, seen and answered (Phase 0 of the Leader Desk build)
--
-- What this adds, and nothing else. When an admin or a director asks the owner to place someone (Placement -> Ask the owner), the request waits for the owner
-- for 7 days and then lapses. Until now a lapsed request was only noticed if the admin looked, or asked again about the same person. This adds one daily check
-- that marks each request that has run out as lapsed and tells the admin who asked, once, with the notice `admin_placement_lapsed` (their first name for the
-- member, nothing else: never the reason, never a score). The owner is still never emailed: the platform does not email the owner, so the owner is shown the
-- waiting requests on the console instead (the Placement page, a count on the Placement tab and a tile on the Overview).
--
-- It changes one function: notice_sweep, which gains one line in the list of daily checks. Every other line of it is as it stood.
-- Nothing is deleted. A request that has lapsed keeps its row, and the person it was about is untouched.
-- =============================================================================
begin;

create function public.notice_chk_placement_requests(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    with lapsed as (
      update public.placement_requests q
         set status = 'lapsed'
       where q.status = 'open' and q.expires_at <= p_now
      returning q.id, q.person_id, q.asked_by
    )
    select l.id, l.person_id, l.asked_by from lapsed l
  loop
    if public.notify_person(r.asked_by, 'admin', 'admin_placement_lapsed', 'placement-lapsed:' || r.id,
         jsonb_build_object('member_first', public.first_name_of(r.person_id)),
         'Your request to place ' || coalesce(public.first_name_of(r.person_id), 'a member') || ' lapsed',
         '/admin/people/' || r.person_id, true) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- The daily checks, with the new one added
create or replace function public.notice_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  p record;
  n integer;
  v_queued integer := 0;
  v_digests integer := 0;
  v_problems text[] := '{}';
  v_hour integer := public.notice_hour(p_now);
  v_dow integer := public.notice_isodow(p_now);
  v_day boolean := public.notice_hour(p_now) between 7 and 20;
begin
  for c in
    select * from (values
      ('notice_chk_meetings', 'open'), ('notice_chk_interview_outcome', 'open'), ('notice_chk_sending', 'open'),
      ('notice_chk_decisions', 'daily'), ('notice_chk_cards', 'daily'), ('notice_chk_season_review', 'daily'),
      ('notice_chk_slots_low', 'daily'), ('notice_chk_offers', 'daily'), ('notice_chk_countdown', 'daily'),
      ('notice_chk_erasure_due', 'daily'), ('notice_chk_reporting', 'daily'), ('notice_chk_care', 'daily'),
      ('notice_chk_applicants', 'daily'), ('notice_chk_referees', 'daily'), ('notice_chk_academy', 'daily'),
      ('notice_chk_templates', 'monday'), ('notice_chk_demand', 'monday'), ('notice_chk_unplaced', 'monday'),
      ('notice_chk_email_week', 'monday'), ('notice_chk_integrity', 'monday'),
      ('notice_chk_champions', 'daily'), ('notice_chk_placement_requests', 'daily'),
      ('notice_chk_interviews_tomorrow', 'evening'), ('notice_chk_leaders', 'evening')
    ) as t(name, gate)
  loop
    if not (case c.gate
              when 'open' then v_hour between 7 and 21
              when 'daily' then v_day
              when 'monday' then v_day and v_dow = 1
              when 'evening' then v_hour between 17 and 21
              else false end) then
      continue;
    end if;
    begin
      execute format('select public.%I($1)', c.name) into n using p_now;
      v_queued := v_queued + coalesce(n, 0);
    exception when others then
      v_problems := v_problems || ('notices: ' || c.name || ' could not run');
      perform public.notice_fault(c.name, sqlerrm);
    end;
  end loop;

  if v_day then
    for p in select distinct i.person_id from public.notice_items i where i.sent_at is null and i.delivery = 'digest' loop
      begin
        if public.notice_digest(p.person_id, p_now) is not null then
          v_digests := v_digests + 1;
        end if;
      exception when others then
        v_problems := v_problems || 'notices: a digest could not be built';
        perform public.notice_fault('digest', sqlerrm);
      end;
    end loop;
  end if;

  begin
    perform public.notice_chk_scrub(p_now);
  exception when others then
    v_problems := v_problems || 'notices: clean-up could not run';
    perform public.notice_fault('scrub', sqlerrm);
  end;
  return jsonb_build_object('queued', v_queued, 'digests', v_digests, 'problems', to_jsonb(v_problems));
end;
$$;

revoke execute on function public.notice_chk_placement_requests(timestamptz) from public, anon, authenticated;

commit;

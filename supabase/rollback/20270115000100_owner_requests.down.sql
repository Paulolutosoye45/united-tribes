-- Way back from "requests to the owner, seen and answered".
--
-- Puts notice_sweep back exactly as it stood (without the daily check for lapsed requests) and drops the check. A request already marked lapsed stays lapsed, which is
-- what the page showed for it anyway; a notice already sent stays sent. Put the application files back before this one. Run it as the database owner.
-- Running it twice changes nothing.
begin;

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
      ('notice_chk_champions', 'daily'),
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

drop function if exists public.notice_chk_placement_requests(timestamptz);

commit;

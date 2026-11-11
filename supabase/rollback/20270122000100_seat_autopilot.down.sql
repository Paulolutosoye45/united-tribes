-- Takes Package 8 back. Switch "Seat autopilot" Off first. People it placed stay placed (they are ordinary placements with their own "Your tribe" email, Undo and
-- seat clock); emails already sent stay sent. The plans and what each plan held are removed with their tables: copy them first if you want to keep the record
-- (select * from public.autopilot_plans; select * from public.autopilot_items). Run before Package 7's own rollback.
begin;

delete from public.feature_settings where feature = 'seat_autopilot';
delete from public.feature_registry where key = 'seat_autopilot';

drop trigger if exists autopilot_gate_insert on public.feature_settings;
drop trigger if exists autopilot_gate_update on public.feature_settings;

drop function if exists public.god_autopilot_settings_set(text, integer, integer, integer, integer, integer, text);
drop function if exists public.god_autopilot_settings();
drop function if exists public.autopilot_pause_set(boolean, text);
drop function if exists public.autopilot_approve(uuid);
drop function if exists public.autopilot_overview();
drop function if exists public.autopilot_tick();
drop function if exists public.autopilot_apply_core(uuid, uuid);
drop function if exists public.autopilot_plan_build(uuid, text);
drop function if exists public.autopilot_bench(uuid, integer);
drop function if exists public.autopilot_season(integer);
drop function if exists public.autopilot_degree(uuid, uuid, boolean);
drop function if exists public.autopilot_gate();
drop function if exists public.autopilot_any();

drop table if exists public.autopilot_items;
drop table if exists public.autopilot_plans;
drop table if exists public.autopilot_settings;

-- The earlier texts, exactly (Package 7's)
create or replace function public.seat_morning_numbers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_y date := public.today_lagos() - 1;
  v_taken integer;
  v_yes integer;
  v_rel integer;
  v_left integer;
  v_refill integer;
begin
  select count(*) filter (where l.kind = 'taken' and l.reason is distinct from 'Taken back'), count(*) filter (where l.kind = 'confirmed'),
         count(*) filter (where l.kind = 'released'), count(*) filter (where l.kind = 'left'),
         count(*) filter (where l.kind = 'taken' and l.via = 'seat-window')
    into v_taken, v_yes, v_rel, v_left, v_refill
    from public.seat_ledger l where (l.at at time zone 'Africa/Lagos')::date = v_y;
  return jsonb_build_object(
    'taken', v_taken, 'yes', v_yes, 'released', v_rel, 'left', v_left, 'refilled', v_refill,
    'not_reached', (select count(*) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by = 'not_reached'),
    'hard', (select count(*) from public.seat_clocks k where k.state = 'released' and k.hard_to_fill and k.replaced_by is null and not k.rehearsal),
    'stopped', (select count(distinct k.blocked_by) from public.seat_clocks k where k.state = 'running' and not k.rehearsal and k.blocked_by in ('email', 'day_cap', 'tribe_quarter')),
    'small', (select count(*) from public.tribes t where t.status = 'approved'
               and (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') between 1 and 4),
    'over', (select count(*) from public.tribes t where (select count(*) from public.tribe_members m where m.tribe_id = t.id and m.status = 'active') > 12),
    'in_series', (select count(*) from public.reach_enrolments x where x.status = 'active' and not x.rehearsal));
end;
$$;

create or replace function public.worker_seat_window_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.worker_ok(p_token);
  v := public.seat_clock_tick();
  -- The leader's note at 5 pm and the office's email at 7 am: each does nothing unless the seat window is On, and each fault is its own
  begin
    v := v || jsonb_build_object('notes', public.seat_notes_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'leader note: ' || sqlerrm);
  end;
  begin
    v := v || jsonb_build_object('morning', public.seat_morning_tick());
  exception when others then
    perform public.notice_fault('seat_window', 'morning email: ' || sqlerrm);
  end;
  return v;
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- Platform housekeeping: what is kept, and for how long.
--
-- The blueprint says personal data is deleted or anonymised a set period after it is no longer needed, and that the
-- period is agreed with counsel. The periods live in ONE place, retention_periods(), so changing one is a one-line
-- migration that counsel can read. Once a day the sending service's tick calls retention_tick(), which:
--
--   * removes a parent or guardian's contact details a season after the young person's last season ended
--     (guardian_retention, from the Learn and Scale release);
--   * deletes a half-finished member form that nobody has touched for 30 days;
--   * clears the written season story from every profile whose season has ended (the story is kept "only until the end
--     of the season", so the suggestions can be checked, and members can delete it sooner from their profile);
--   * empties the wording of messages that have been sent or have failed, after 90 days (names, links and notes in the
--     message are not needed once it has gone; the template, channel and outcome stay for the message log and reports);
--   * deletes the messages that went to a bare address (a referee, a parent) after the same 90 days.
--
-- It runs once per Lagos day (calendar_runs remembers), writes one line to the event log with the counts, and never
-- includes who or what was removed. A fault in it is reported by worker_tick but never stops a message going out.
-- ---------------------------------------------------------------------------

create function public.retention_periods()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'guardian_days', 90,   -- after the young person's last season has ended
    'draft_days', 30,      -- an unfinished member form, from the last time it was touched
    'message_days', 90     -- the wording of a finished message, and any message to a bare address
  );
$$;

create function public.retention_tick(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_key text := 'retention:' || (p_now at time zone 'Africa/Lagos')::date::text;
  p jsonb := public.retention_periods();
  n_guardians integer;
  n_drafts integer;
  n_stories integer;
  n_bare integer;
  n_wording integer;
begin
  if exists (select 1 from public.calendar_runs c where c.key = v_key) then
    return jsonb_build_object('retention_ran', false);
  end if;

  n_guardians := public.guardian_retention((p ->> 'guardian_days')::integer);

  delete from public.intake_drafts d
   where d.updated_at < p_now - make_interval(days => (p ->> 'draft_days')::integer);
  get diagnostics n_drafts = row_count;

  update public.member_profiles m set story = null
    from public.seasons s
   where s.id = m.season_id and s.ends_on < v_today and m.story is not null;
  get diagnostics n_stories = row_count;

  delete from public.messages x
   where x.person_id is null
     and x.status in ('sent', 'delivered', 'read', 'failed', 'skipped')
     and x.created_at < p_now - make_interval(days => (p ->> 'message_days')::integer);
  get diagnostics n_bare = row_count;

  update public.messages x set params = '{}'::jsonb
   where x.status in ('sent', 'delivered', 'read', 'failed', 'skipped')
     and x.created_at < p_now - make_interval(days => (p ->> 'message_days')::integer)
     and x.params <> '{}'::jsonb;
  get diagnostics n_wording = row_count;

  insert into public.calendar_runs (key) values (v_key) on conflict do nothing;
  perform public.write_event(null, 'retention.ran', 'platform', 'retention',
    jsonb_build_object('guardians', n_guardians, 'drafts', n_drafts, 'stories', n_stories, 'bare_messages', n_bare, 'message_wording', n_wording));

  return jsonb_build_object(
    'retention_ran', true, 'guardians_removed', n_guardians, 'drafts_removed', n_drafts, 'stories_cleared', n_stories,
    'bare_messages_removed', n_bare, 'message_wording_cleared', n_wording);
end;
$$;

-- The heartbeat: the calendar, the care sweep, then the daily jobs (insight and retention). A fault in a daily job is
-- reported but never stops a message from going out.
create or replace function public.worker_tick(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_insight jsonb;
  v_retention jsonb;
begin
  perform public.worker_ok(p_token);
  begin
    v_insight := public.insight_tick(now());
  exception when others then
    v_insight := jsonb_build_object('insight_error', sqlerrm);
  end;
  begin
    v_retention := public.retention_tick(now());
  exception when others then
    v_retention := jsonb_build_object('retention_error', sqlerrm);
  end;
  return public.run_calendar(now()) || public.care_sweep(now()) || v_insight || v_retention;
end;
$$;

revoke execute on function public.retention_periods(), public.retention_tick(timestamptz) from public, anon, authenticated;
revoke execute on function public.worker_tick(text) from public;
grant execute on function public.worker_tick(text) to anon, authenticated;

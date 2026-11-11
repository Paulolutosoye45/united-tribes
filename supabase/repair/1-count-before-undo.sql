-- Repair, step 1 of 3: LOOK before you undo anything. This file only reads; it changes nothing.
--
-- The undo in step 2 drops the tables listed here (they belong to the files from 20270114000100 onward). This lists each one that exists, how many rows it
-- holds, and how many a fresh install holds (a settings table starts with its one row of standard settings; every other table starts empty).
-- If the last column says "nothing to lose" on every line (or the list is empty), the undo loses nothing but standard settings.
-- If any line says "HAS DATA - STOP", do not run step 2: send the list to Claude.
--
-- Written by scripts/build-repair.mjs. Do not edit it by hand.

select t.tbl as "table",
       n.rows as "rows",
       t.fresh as "fresh install holds",
       case when n.rows <= t.fresh then 'nothing to lose' else 'HAS DATA - STOP' end as "verdict"
from (values
  ('autopilot_items', 0),
  ('autopilot_plans', 0),
  ('autopilot_settings', 1),
  ('desk_group_members', 0),
  ('desk_groups', 0),
  ('desk_lead_stops', 0),
  ('desk_links', 0),
  ('desk_offer_links', 0),
  ('desk_offers', 0),
  ('desk_proposals', 0),
  ('desk_reveals', 0),
  ('desk_settings', 1),
  ('desk_stops', 0),
  ('guide_release_settings', 1),
  ('hod_reconcile_rows', 0),
  ('hod_reconciles', 0),
  ('placed_answers', 0),
  ('placed_answers_settings', 1),
  ('placed_calls', 0),
  ('placed_downloads', 0),
  ('placed_holds', 0),
  ('placed_reveals', 0),
  ('placed_seq', 0),
  ('placed_seq_sends', 0),
  ('prompt_log', 0),
  ('prompt_settings', 1),
  ('prompt_streaks', 0),
  ('prompt_visits', 0),
  ('seat_chain', 0),
  ('seat_clock_log', 0),
  ('seat_clocks', 0),
  ('seat_ledger', 0),
  ('seat_window_settings', 1)
) as t(tbl, fresh)
cross join lateral (
  select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.tbl), false, true, '')))[1]::text::int as rows
  where to_regclass('public.' || t.tbl) is not null
) as n
order by 1;

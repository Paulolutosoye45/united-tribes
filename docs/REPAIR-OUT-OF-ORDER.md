# Repair: migration files that went in out of order

**When to use this.** `supabase/check-applied.sql` shows some of the files from `20270114000100_placed_answers` to `20270120000100_seat_window` (and maybe `20270125000100_desk_extras`) as **MISSING**, while later files (`20270121000100` and after) are applied. Typical signs: a file stops with "must be applied first" or "function … already exists", and the Switchboard says "Open <NULL> first" for *Release at the end of the series* or *Seat autopilot*.

**Why it happens.** Those files build on each other. When the later ones go in on a database where the earlier ones are missing (or were undone in the wrong order), nothing can be applied cleanly from there. The fix is not to patch it file by file: go back to the last good point, then apply the files again in order.

**What it is safe against.** This was rehearsed (`tests/db/repair-files.test.ts`) on Mary's exact state and four others (undone newest first, undone oldest first, everything applied, nothing applied). Every time: after the undo the database is identical to the one before `20270114000100`, and after applying the files again it is identical to a clean install. Members, tribes, seats, messages already sent and every log line from before `20270114000100` are never touched.

**What it removes.** The tables, functions and Switchboard rows added by the files from `20270114000100` to `20270126000100` (the placed-member answers and board, the Leader Desk, the seat window, seat release, seat autopilot, guide release, HOD reconcile, desk extras and the sign-in prompt). All of these start **Off**, so on a database where they were never turned on there is nothing in them to lose. Step 1 proves that before anything is removed.

## Steps

Do these in the Supabase SQL Editor, in this order. Stop at the first thing that does not match what is written here and send it to Claude.

1. **Back up.** Supabase → Database → Backups: make sure a backup from today exists (or take one).
2. **Look first** (reads only, changes nothing): paste `supabase/repair/1-count-before-undo.sql`. Every line must say `nothing to lose`. If any line says `HAS DATA - STOP`, do not go on.
3. **Undo:** paste `supabase/repair/2-undo-from-20270126-to-20270114.sql` and run it. It is one large file (13 ways back, newest first). It is safe to run twice. If the editor will not take the whole file, run the 13 files in `supabase/rollback/` one at a time in this order: `20270126000100_sign_in_prompt`, `20270125000100_desk_extras`, `20270124000100_hod_reconcile`, `20270123000100_guide_release`, `20270122000100_seat_autopilot`, `20270121000100_seat_release`, `20270120000100_seat_window`, `20270119000100_desk_open`, `20270118000100_desk_offers`, `20270117000100_desk_proposals`, `20270116000100_leader_desk`, `20270115000100_owner_requests`, `20270114000100_placed_answers` (each `.down.sql`).
4. **Check:** run `supabase/check-applied.sql`. It should now list `20270114000100` and every file after it as MISSING (13 files), and nothing else.
5. **Apply the 13 files again, one at a time, in this order**, each from `supabase/migrations/`. Each should finish with "Success". Do not skip one and do not change the order:
   1. `20270114000100_placed_answers.sql`
   2. `20270115000100_owner_requests.sql`
   3. `20270116000100_leader_desk.sql`
   4. `20270117000100_desk_proposals.sql`
   5. `20270118000100_desk_offers.sql`
   6. `20270119000100_desk_open.sql`
   7. `20270120000100_seat_window.sql`
   8. `20270121000100_seat_release.sql`
   9. `20270122000100_seat_autopilot.sql`
   10. `20270123000100_guide_release.sql`
   11. `20270124000100_hod_reconcile.sql`
   12. `20270125000100_desk_extras.sql`
   13. `20270126000100_sign_in_prompt.sql`
6. **Check again:** run `supabase/check-applied.sql`. It should say `checked 72 files; 72 applied` and list nothing else.
7. Every switch is back **Off**. Turn things on the way each feature's own `APPLY-*.md` says (Rehearsal first).

If a file stops, do not run the next one. Run `supabase/check-applied.sql` and send Claude the file name, the error and the check's output.

## Keeping this current

`supabase/repair/` is written by `node scripts/build-repair.mjs` from the migration and rollback files. `tests/unit/repair-files.test.ts` fails if they differ, so a changed rollback file cannot leave an old undo behind.

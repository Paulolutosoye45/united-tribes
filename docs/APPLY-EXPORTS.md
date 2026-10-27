# Exports and Reports (release one): how to apply this package

This zip holds **only the files that changed** since the full build you last applied (the one with the How-to Library). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261230000100_my_appointment.sql`. **No new packages and no new settings.**

What it is, in one paragraph: leaders, champions, coaches, the office and the pastorate can take a real Excel file or a printed page with them, and the church's reporting tools can read coded tables with no names. How it works is in `docs/EXPORTS.md`. **Every switch for it is in God Mode (`/god/exports`) and nowhere else, and everything starts Off.** Applying this package lets nobody make a file, and nothing appears for anyone but the owner.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Decide who tries it first.** The plan is one director, the data lead and three tribe leaders (the owner has no tribe, so named testers do the real rehearsing).
3. **Have the impact assessment ready.** Named files (People files) cannot go beyond the testers until the owner records, in God Mode, the day it was signed and by whom. Nothing in the software makes that decision for you.
4. The daily clean-up (`/api/cron/tick`) is already running. It now also removes export log lines older than two years and standing links a month after they ended. There is nothing new to schedule.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20261231000100_exports.sql`

   Eight tables and 34 functions. Nothing is deleted or rewritten. **No existing function body is changed** (a test compares every function with the database before). Every new table has row-level security and no grants.
2. **Check**, in the SQL editor:
   - `select count(*) from public.export_switches where position <> 'off';` returns `0` (fourteen packs, all Off).
   - `select paused, people_stopped, formats, deliveries, doors, people_cleared_on from public.export_settings;` shows `false, false, {}, {}, {}` and nothing for the date.
   - `select count(*) from public.export_log;` returns `0`.
3. **Then the app**: deploy the website. Nothing else to set.

## Open it, one step at a time (God Mode → Exports)

Each step is reversible by moving the same switch back. Nothing here is available to an administrator, a director or a pastor.

1. **Formats and ways in.** Switch on only what you need first: *Excel files* and *Download from the Studio*. Leave *Open Data Pack* and *Standing links* until the Insight feeds pack is wanted.
2. **Testers.** Add by name: one director, the data lead and three tribe leaders.
3. **Rehearsal.** Move one pack to *Rehearsal* (start with *Tribes health sheet*, an Insight pack with no names). Only the testers see it, and every page says REHEARSAL. Ask them to open the file and compare the figures with the dashboard.
4. **Record the impact assessment** (the day, and who signed it). The Tribe sheet, the Attendance register, the Leaders roster and People and roles stay at Rehearsal until this is recorded: the page shows the gate.
5. **Limited, then On.** Opening beyond the testers needs a reason (at least eight characters) and the page shows how many people the choice reaches **before** it will let you save. A People pack must already have been in Rehearsal.
6. **If anything is wrong**: *Pause all exports* stops every file and every link already made. *Stop all People files* stops only the named files. Switching it back returns everything as it was. This is enough for almost any reason.

## Check it works (about twenty minutes)

1. As God Mode: **Exports** is in the menu, all fourteen packs show **Off**, and *Know your tribe* and *My data pack* cannot be moved (second release).
2. As an administrator: the same address shows "We can't find that page", and **Exports** shows *Nothing to export yet*.
3. Add yourself or a colleague as a tester, put the Tribes health sheet in Rehearsal, open the formats and downloading. As that person: **Exports** lists the file and says Rehearsal. Press **Make my file**; the Excel file downloads. Open it: a table with filters, an **About** tab and a **Dictionary** tab, and no leader or member names.
4. Press **Delete now**, then open the same link again: it says it could not find the file.
5. Move the Tribe sheet to Rehearsal with a leader as tester. As the leader, choose **Tribe sheet**: the page says what a People file is and **Make my file** waits for a reason and a promise. The members under 18 are not listed; the About tab says how many were left out.
6. In God Mode, the **log** shows who made which file, as which role, and why, with the number of rows and never the contents. **Every change to a switch** lists each move in words.
7. Press **Stop all People files**: the leader's link stops opening and their Studio is empty. Switch it off: the same link works again.

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `src/components/god/GodNav.tsx`: an *Exports* tab after *Placement*. `src/lib/god/wording.ts`: the words for the export switch lines in the owner's record.
- `src/app/api/cron/tick/route.ts`: one more step, `worker_export_sweep`, reported as `exportsSwept`. A fault in it is listed and never stops the messages after it.
- `src/proxy.ts`: `/feeds` is a public path (the standing link a reporting tool reads; every fault gives the same plain "Not found").
- `src/lib/messaging/templates-notices.ts`: registers one new notice, `data_unusual_export`, for the data lead. No existing notice changes.
- `src/app/(app)/lead/tribe/page.tsx`, `dashboard/page.tsx`, `community/page.tsx`, `reports/page.tsx`, `admin/page.tsx`: each gains one small entrance to Exports that is **not drawn at all** unless a pack is open to that person.
- `docs/RETENTION.md`, `docs/GOD.md`, `docs/NOTICES-ADMIN.md`, `README.md`: the export log's two-year rule, the new switchboard, the one new notice (59 now), and the new guides.

## Existing tests this package changes (all disclosed)

| Test | What changed, and why |
| --- | --- |
| `tests/db/foundation.test.ts` | The new function names are added to the list that signed-in people may call (the allow-list exists to be extended). |
| `tests/unit/messaging-hooks.test.ts` | One case added: the heartbeat runs the export clean-up. |
| `tests/unit/notice-templates.test.ts` | The count of notices goes from 58 to 59 (the new notice for the data lead), the exports migration is read with the others to see which notices the database queues, and `care_weekly` (a feed table, not a notice) is added to the list of names that only look like a notice. |
| `scripts/rehearse-rollback.sh` | Not a test: the way-back rehearsal's list of new tests. |

New tests: `tests/db/exports.test.ts`, `exports-rollback.test.ts`; `tests/unit/exports-registry.test.ts`, `exports-guard.test.ts`, `exports-xlsx.test.ts`, `exports-builders.test.ts`, `exports-feeds.test.ts`, `exports-load.test.ts`, `exports-parse.test.ts`; the journey `e2e/journeys/35-exports.ts`.

## Choices that differ from, or add to, what you approved

- **Print-view PDFs first.** The printed page is a page in the browser with a *Print or save as PDF* button. A server-made PDF is for the second release.
- **Insight files hold no names at all**, not even leaders'. Where a leader matters, the file says whether a tribe has a coach and whether its leader is certified.
- **Members under 18 are counted and never listed**, in every file. A number a member asked to withhold is left out; a WhatsApp number appears only when the member agreed to be messaged on WhatsApp and did not ask for their details to be withheld.
- **Message volumes use the last 90 days.** Choosing dates is not offered.
- **The unusual-use detail is on the owner's page**; the data lead gets a notice that it happened, and nothing more.
- **The owner is not a tester by default and has no tribe**, so the Tribe sheet and the Attendance register are rehearsed by named testers.
- **The Excel writer is our own**, extended from the one the library already had (no new package). There are no formulas anywhere, so nothing in a file runs.

## Not in this release

- **Second release**: a server-made PDF, *Know your tribe* cards, a member's *My data pack*, and links sent by email. Their switches exist and can only be Off.
- **A later release**: sending to a named destination with the member's consent, with its own switches. A live connection is not a switch, and there is none.

## The way back

1. **Switch what you need Off**, or press *Pause all exports*. Nothing more is made, and links already made stop opening. This is enough for almost any reason.
2. To take the feature out completely: restore the application files from the full package you had before this one, then run, as the database owner:
   `supabase/rollback/20261231000100_exports.down.sql`

   It drops the functions only and leaves the tables and every row (the log of who made which file is not lost); the last lines say how to drop the tables too. Running it twice changes nothing.

## What was checked, and what was not

Checked on a throwaway database built from the migration files, and in a test browser (Chromium):

- **Type check and lint**: clean.
- **Unit tests**: 78 files, 2,288 tests, all passing (71 of them new: the pack registry, the text guard, the Excel writer, every pack's tables, the feeds, the loader and the link reader, and one heartbeat case).
- **Database tests**: 61 files, 1,780 tests. 1,764 pass; the 16 that do not are the older messaging and referee tests that cannot run at night (below). 58 are new: that every pack, setting and tester change is the owner's alone, in the function and not only on the screen; the gate order and the reason and reach rules; who is offered which pack and who is refused; the link (one account, 24 hours, shown once, only its fingerprint kept, checked again on every open); that members under 18 and withheld numbers are never in a file; that Insight files hold no names; the log and its two-year clean-up; the feeds; and the way back.
- **Browser journey 35** (87 checks): every pack Off and nothing found by a leader or an administrator; the switchboard owner-only; the gate order (Rehearsal, then the impact assessment, then Limited or On, with a reason and a look at the reach); a file made as a tester; the link refused for another signed-in person and for someone not signed in; Delete now; a printed page made into a real PDF; both stops and the pause acting on links already made; the Open Data Pack and a standing link made, read by someone with no account and revoked; the log naming who and never what; the switchboard on a phone; and a director calling the database directly, refused.
- **Older browser journeys** (the 13 that open the pages this package touches: smoke, messaging, insight, growth, admin, owner, activity, find-tribe, oversight, browser pass, notices, admin menu, placement): each passes on its own, and in long sequences two things showed up. The **notices journey** (28) also passes straight after its usual neighbours, but failed when run in one long sequence before 8 am Lagos time: the older "messages are not going out" notice counts messages that the earlier journeys had queued that night, and sends the admin a second email. That is older code, not this package, but I did not rerun the long sequence after 8 am to prove it. The **admin menu journey** (29) failed one check (the "/" key opening the search) once in a long run, and passed on its own and in the first long run.
- **The way back, rehearsed**: the original suite (958 tests) gives the same answer, test by test, on a database with the migration and its rollback file run as on one that never had them (942 pass and the same 16 night-time tests fail on both).

One thing you may notice: **some older test files fail if you run the database tests between 10 pm and 6 am Lagos time** (the messaging and referee tests). The platform sends nothing in those hours, and those tests claim messages. They fail the same way before this package. Run them in the daytime and they pass.

**Not** checked: a real copy of Microsoft Excel opening the sample files (the files were read by a spreadsheet library and by LibreOffice, and the Excel structure follows the format's own rules, but **a person should open one in real Excel before the first leader is given access**); a real phone or a screen reader; the impact assessment itself; timing on your own server and data (rehearse on a copy first, `docs/RELEASE.md`).

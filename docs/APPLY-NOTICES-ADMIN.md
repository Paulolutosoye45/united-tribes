# Team emails and the new Admin: how to apply this package

This zip holds **only the files that changed** since the full build you last applied (the one with email through your own mail server). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261224000100_god_oversight.sql`. No new packages and no new settings.

What it is, in one paragraph: the Admin area opens on **Today** (what is waiting for the person signed in, with a menu down the side or behind a bar on a phone, and a search box), and the platform can **email the team** when something needs them (57 notices, a daily or weekly summary, escalations). Everything about it is in `docs/NOTICES-ADMIN.md`. **Every group of emails starts Off**: applying this package changes what the Admin pages look like, and sends nothing.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Tell the office that the Admin area looks different. Four pages were renamed (the addresses did not change): Leader quality → **Answer checks**, Leader supply → **Leaders needed**, Pastors and unit heads → **Church referee list**, Sending and reporting → **Sending and email**.
3. Check that the heartbeat is running (`/api/cron/tick`, every few minutes). The emails are written by the same heartbeat; there is nothing new to schedule.

## Deploy, in this order

1. **Database**, two files, each once (`supabase db push`, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20261225000100_notices.sql` (the switches, preferences, queue, the engine, the timed checks, the summary builder, the functions behind the Admin pages)
   2. `supabase/migrations/20261225000200_notice_triggers.sql` (the triggers that notice an event: an interview done, a reference in, a role given, and so on)

   Nothing is deleted or rewritten. No existing function body is changed. The triggers only write a row to the notice tables, inside a block that catches any failure, so **whatever happened still happens** if a notice cannot be written.
2. **Check**, in the SQL editor:
   - `select count(*), count(*) filter (where mode = 'off') from public.notice_settings;` returns `11, 11`.
   - `select count(*) from public.notice_items;` returns `0`.
3. **Then the app**: deploy the website. Nothing else to set.

## Switch it on, one group at a time

1. Open **Admin → Notifications** as an admin. Read **How it works**, then open **How the summary reads** and, in the groups, **How it reads** on a few notices.
2. Start with **Admins** and **Pastors**. Press **Rehearsal** on each. For a day, read the log on the same page: it shows what *would* have gone to whom (first names only), and nobody is emailed.
3. Check **My notices** (in your profile): each person chooses *Right away*, *A daily summary* or *A weekly summary* for each role they hold. The default is a daily summary.
4. When the log reads right, press **On**. Then, a week apart if you can, do **Directors**, **Care team**, **Coaches**. Do **Leaders**, **Community champions**, **Data lead**, **Members**, **Applicants** and **Referees** last: those are the emails that go to people outside the office.
5. To stop a group at any time, press **Off**. Nothing already sent is recalled; nothing more is queued.

## Check it works (about fifteen minutes)

1. As an admin: **Admin → Today** shows "Needs attention", and a warning that groups are Off. The menu is down the left; typing `delete account` into the search finds **Data requests**; pressing `/` goes to the search from anywhere.
2. On a phone: the bar at the top says where you are; tapping it opens the menu from the bottom; choosing a page closes it.
3. As someone who is **both an admin and a pastor**: Today shows the work of both in one list with a tag on each row, and chips (**Everything · Admin · Pastor**) that filter it; the menu has 26 pages (an admin alone sees 25, a pastor alone 20). **My notices** lists the two groups they receive.
4. As an admin, set **Pastors** to Rehearsal, then have a test applicant's application reach "interviewed". After the next heartbeat in the morning hours, **Notifications** shows a row in the log marked *Rehearsal: not sent*.
5. Set **Pastors** and **Admin** to On and do the same: the person who is both receives **one** email with a part for each role.

## Existing files this package changes

Only additive edits, and the four renamed headings:

- `src/app/(app)/admin/page.tsx`: replaced. The old hub is now Today. (To go back, restore this file from the full package.)
- `src/app/(app)/admin/seasons/page.tsx`: shows the launch checklist above the season board (it used to be on the hub).
- `src/app/(app)/admin/leader-quality/page.tsx`, `leader-supply/page.tsx`, `referees/page.tsx`, `system/page.tsx`: the heading and page title only. `messages/page.tsx`: the back-link label.
- `src/components/admin/PageHead.tsx`: marks its back link, so the new menu can hide it.
- `src/app/(app)/profile/page.tsx`: adds **My notices** for people with a team role.
- `src/app/api/cron/tick/route.ts`: calls the new sweep after the existing work, and reports it.
- `src/lib/messaging/templates.ts`, `render.ts`, `types.ts`: register the 57 new templates; an email can now carry a list of lines under titles (used only by the summary). No existing email changes its wording or layout.

## Existing tests this package changes (all disclosed)

The brief was to change no existing test. Nine had to change because they describe the old Admin hub or the old page names, which the approved redesign replaces, and one script gained a name. None checks less than before; each assertion moved to where the thing now lives.

| Test | What changed, and why |
| --- | --- |
| `tests/db/foundation.test.ts` | Seven new function names added to the lists of functions that may be called by signed-in people or by the sending service (the allow-lists exist to be extended). |
| `e2e/journeys/07-admin.ts` | The hub's heading is now "Today"; the thirteen links are checked in the menu (one each); the launch checklist assertions run on **Seasons**; "Sending and reporting" is now "Sending and email". |
| `e2e/journeys/10-owner.ts` | "Sending and reporting" → "Sending and email". |
| `e2e/journeys/12-leader-quality.ts` | Heading "Leader quality" → "Answer checks" (three places). |
| `e2e/journeys/13-referee.ts` | Heading "Pastors and unit heads" → "Church referee list" (two places). |
| `e2e/journeys/17-signin.ts` | On a phone the data lead now opens the menu bar to find "WhatsApp sign-in" (it was a link on the old hub). |
| `e2e/journeys/19-pipeline.ts` | The intake and matching numbers it reads (the old "At a glance") are now on **Figures**: two `open(page, "/admin")` → `/admin/figures`. |
| `e2e/journeys/25-leader-board.ts` | "Leader supply" → "Leaders needed". |
| `e2e/journeys/27-browser-pass.ts` | The Admin menu (opened from the bar on the phone) lists "Leaders needed" (was "Leader supply" on the hub); the open menu is swept for cut-off text and small tap targets as well. |
| `scripts/rehearse-rollback.sh` | Not a test, but the way-back rehearsal's list of new tables: `notices` and `notices-rollback` added, so the original suite is run without the new notice tests when it checks the rolled-back database. |

New tests: `tests/db/notices.test.ts` (includes a check that the pages read what the database actually returns), `tests/db/notices-rollback.test.ts` (the two rollback files, run against a real database), `tests/unit/notice-templates.test.ts`, `tests/unit/admin-nav.test.ts`, `tests/unit/admin-notices.test.ts`, `e2e/journeys/28-notices.ts` (a person who is both admin and pastor gets one email, with a part for each role), `e2e/journeys/29-admin-menu.ts` (the menu, search, breadcrumbs and phone sheet, for one role and for two).

## Choices that differ from the blueprint's wording

- **Care task**: the blueprint's "care_task_assigned" already exists in the platform as `care_task`; it is reused, not duplicated.
- **A cancelled meeting** (`member_meeting_cancelled`) is not built: the platform has no way to cancel a meeting, only to change one, and "your tribe's meeting has changed" covers that.
- **Role changes** are emailed for staff roles and community champion only. Giving someone the leader role is not news to the office.
- **Young members** (under 18) are never written to by any notice.
- **"Right away"** means "whatever the person's summary setting says", not "even at night": quiet hours (10 pm to 6 am, Lagos) apply to every notice.
- **Figures** is a new page. The old hub's four "At a glance" panels (intake, leaders, Academy, matching) are not on the new Today, so they live on **Figures** instead of being lost.
- **Shortcuts** show on phones and tablets only. On a computer the menu is beside the page, and the same links twice would only crowd it.
- **WhatsApp**: every notice is email. The WhatsApp wordings are written so the template list is complete; none has been submitted to Meta and none is sent.

## The way back

1. **Switch every group Off** on **Admin → Notifications**. Nothing more is sent. This is enough for almost any reason.
2. To take the feature out completely: restore the application files from the full package you had before this one (this is why `admin/page.tsx` is listed above), then run, as the database owner and in this order:
   1. `supabase/rollback/20261225000200_notice_triggers.down.sql`
   2. `supabase/rollback/20261225000100_notices.down.sql`

   They drop the functions and triggers and leave the notice tables and their rows in place (no choice anyone made is lost); the last lines of the second file say how to drop the tables too. Running either twice changes nothing.

## What was checked, and what was not

Checked on a throwaway database built from the files, with a test browser:

- Type-check and lint clean. Unit tests: 1,984 pass. Database tests: 1,476 pass. The 324-combination matrix passes. All 27 browser journeys pass, in order, in one run: the two new ones check 66 (emails) and 68 (menu) things, and the ones that changed still check as much as before (07: 78, 17: 94). The way-back rehearsal passes: the original 958 database tests give the same answer on a database built before the change and on one that has had the two rollback files run.
- This zip was also laid over a clean copy of the full package and the type-check, lint, unit tests and database tests were run on the result, with nothing missing and nothing left over.
- **Not** checked: delivery to a real inbox through your mail server, Gmail or Yahoo; a real phone or a screen reader; WhatsApp (nothing is sent there); the effect on your live data (run the rehearsal on a copy first, `docs/RELEASE.md`).

# Package 5b: Remove a member from a tribe, from Admin (how to apply this package)

This zip holds **only the files that changed** since Package 5 (`united-tribes-package-5.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270111000100_reach_series.sql` (Package 5).

**It has no switch and sends nothing by itself.** Nobody is removed until an admin, a director or you press **Remove** and give a reason.

## What is in it

| | What | Read |
|---|---|---|
| **Remove** | **Admin → Place or move a member → a tribe** now has a **Members** list with **Remove** beside each person, and **Remove from this tribe** is on each member's page. A reason of 10 to 300 characters is needed, and only the office reads it. | `docs/ADMIN-REMOVE.md` |
| **Back in the pile** | The seat is released and the member goes back to the people waiting to be placed. No automatic run places them for three days so they can choose for themselves first; the office can place them by hand at once. That tribe is not offered to them again. | the same |
| **The two emails** | The member is told kindly (other tribes, a person to talk to, no appeal). The leader is told by first name only, with the reminder to take them out of any WhatsApp group. Neither carries your reason. | the same |
| **Put back** | **Removed here lately**, on the tribe's page and the person's page, lists what the office removed in the last 30 days with **Put back** for 14 days. | the same |
| **What it refuses** | A young person, a member with an open care matter, yourself, a seat already gone, a closed season, and more than 20 a day for an admin or a director. | the same |
| **Guide** | **A4, Place or move a member in a tribe** has a new part, **Take a member out of a tribe**. | |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone.** Admins and directors will see the new buttons the moment the website is deployed. You may want to tell them that Remove emails the member and the leader straight away.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270112000100_admin_remove.sql`

   It adds one table (what the office did, and why), a second source for the table of blocked tribes, six functions, and replaces one (the heartbeat's removal round, which now also clears reasons after 12 months). No existing row is changed.
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('admin_remove_member','admin_put_back','admin_tribe_members','admin_removal_person','admin_removal_lately','admin_removal_tidy');`
   It should say **6**.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, the tribe page's Members list says "The members could not be loaded just now", and Remove does not work, until the file is run. Nothing else is affected.

## Check it works (ten minutes)

1. Sign in as an admin. **Admin → Place or move a member**, open a tribe. **Members** lists everyone in it with **Remove**.
2. Press **Remove** beside a test member. Read what will happen. The button with their name stays grey until the reason has 10 characters. Press **Keep them**: nothing changes.
3. Press **Remove** again, write a reason, and press the button. The page says the person is out and back in the pile. They are gone from **Members** and appear under **Removed here lately** with your reason.
4. Open that person's page: **Tribe: No tribe yet**, and the line that the church took them out of a tribe a short while ago and automatic placement is leaving them alone.
5. Check the two emails in the test inboxes: "Your place in <tribe> has changed" for the member (no sentence about asking again), and "<First name>’s place in your tribe has changed" for the leader. Neither mentions your reason.
6. Press **Put back** on the same page. The person is in the tribe again, the hold is gone, and both of them get an email.
7. Try a member who has an open care matter (or is under 18): there is no **Remove**, only "Only the Care Lead can change this place".

## Things to know

* **The reason is for the office only.** It is shown on these Admin pages to an admin, a director and you, and cleared after 12 months. It is not in any email or log.
* **The member's three days.** The hold stops automatic placement only. An admin, a director or you can place them in another tribe straight away, and the member can choose a tribe themselves.
* **Same tribe, never again** unless you put the removal back. This is the same rule a leader's approved request makes.
* **Leader removal requests are not changed.** Their switch, 14 days to appeal and limits stay as they were. A young person or an open care matter still goes through the Care Lead's own route.
* **The WhatsApp group is the leader's to tidy.** The leader's email says so, and the leader's page lists who to take out.
* **`/rhythm` is not a page.** The weekly rhythm is at **My tribe**, **Lead → This week** and **Reports → Rhythm**. This is why the file was not there. Remove lives on the Admin pages above.

## Existing files this package changes

* **Database:** one new migration and its way back (above).
* **Admin pages:** `src/app/(app)/admin/tribes/[id]/page.tsx`, `src/app/(app)/admin/tribes/actions.ts`, `src/app/(app)/admin/people/[id]/page.tsx`. New: `src/components/placement/RemoveMember.tsx`.
* **Words and parsing:** `src/lib/placement/types.ts` and `server.ts`.
* **Email:** `src/lib/messaging/templates-removal.ts` (the member's email leaves out the appeal sentence when told 0 days; the leader's email gains a fifth case). No message is added.
* **Guides:** `src/lib/guides/content/place-or-move-a-member.ts`.
* **Docs:** new `docs/ADMIN-REMOVE.md`, this file.

## Existing tests this package changes (all disclosed)

* `tests/db/foundation.test.ts`: the four new screen functions are added to the list the app may call. Nothing checks less than before.
* `scripts/rehearse-rollback.sh`: the two new test files are on the list of new tests.
* New tests: `tests/db/admin-removal.test.ts` (25), `tests/db/admin-removal-rollback.test.ts` (8), `tests/unit/admin-removal-templates.test.ts` (9), and the journey `e2e/journeys/51-remove-from-tribe.ts` (27 checks).
* No existing rollback test, email golden file or other test changed.

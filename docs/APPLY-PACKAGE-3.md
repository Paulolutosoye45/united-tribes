# Package 3: honest numbers, a closed group, removals an admin approves, and place or move a member from Admin (how to apply this package)

This zip holds **only the files that changed** since the contact-gaps package (`united-tribes-contact-gaps.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270106000100_contact_gaps.sql`. No new packages. **No new settings, and nothing to add on your hosting for this one.** Nothing here goes to Meta: the only messages it sends are ordinary emails, and the notices to staff that start Off.

**One file is deleted by hand:** `src/components/god/PlaceOne.tsx`. The owner's tool moved to `src/components/placement/PlaceOne.tsx`; a zip cannot delete a file, so remove the old one or the build will warn about an unused file.

## What is in it

| | What | Read |
|---|---|---|
| **Fix 1** | **Honest numbers.** "Matched", "members" and every rate on the dashboards now count only members who said yes. People the church placed who have not answered are their own figure beside it. | `docs/SAID-YES.md` |
| **Fix 2** | **A closed group.** A leader sees a member's number, and the tribe's WhatsApp group link is shown, only after the member says **Yes, I'm in**. A day passing no longer opens anything. The leader gets a list to add people to the group, and a list of people to remove. | `docs/SAID-YES.md` |
| **Fix 11** | **Removals an admin approves.** A coach recommends; an admin, a director or the Care Lead decides. Admins and directors are told. A short hold after an approval. | `docs/REMOVAL-REQUESTS.md` |
| **Fix 14** | **Place or move a member from Admin.** An admin or a director finds a member, places them or moves them, and can undo it. What only the owner may allow goes to the owner as a request. A how-to guide, **Place or move a member in a tribe**, goes with it. | `docs/OFFICE-PLACEMENT.md` |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone first.** The counts change the moment the database file is run (fix 1), and a leader stops seeing numbers for members who have not answered (fix 2). If a leader asks why a number went away, the answer is on the leader's own page: it opens when the member says yes.
3. **Placing from Admin needs Placement On.** It is as the owner left it; nothing changes there.

## Deploy, in this order

1. **Database**, three files, **in this order**, once each (`supabase db push` does it for you, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20270107000100_said_yes.sql` (fixes 1 and 2)
   2. `supabase/migrations/20270108000100_removal_admin.sql` (fix 11)
   3. `supabase/migrations/20270109000100_office_placement.sql` (fix 14; it builds on the second, so keep the order)

   No member, number, consent, seat, tribe or email is changed or deleted. They add columns and one table (`placement_requests`) and replace functions. The ways back are the three files in `supabase/rollback/`, newest first (`20270109000100_office_placement.down.sql`, then `20270108000100_removal_admin.down.sql`, then `20270107000100_said_yes.down.sql`); each puts the old text of every function back exactly as it stood. The columns they added stay in place.
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('seat_said_yes','tribe_group_list','tribe_group_mark','removal_recommend','placement_find','placement_office_ask','placement_request_decide');` returns `7`, and `select to_regclass('public.placement_requests');` returns `placement_requests`.
3. **Then the app**: deploy the website, after deleting `src/components/god/PlaceOne.tsx`.

Run the database files **first**. If the website goes out first, the new Admin pages for placing and moving will not work until the database files are run, and everything else works as before.

## Check it works (fifteen minutes)

**Fix 1 and 2**

1. **Dashboard → Headline.** If the church placed anyone who has not answered, a line says so: "N more members placed by the church, waiting for a reply. Not counted here until they say yes." The figure above it is smaller than before, and that is right.
2. **Lead → Your tribe**, as a leader with a church-placed member who has not answered: the member's name is there, marked *waiting for a reply*; no number. Under **Your WhatsApp group**, the person is under *Placed by the church, waiting for a reply*, not under *Ready to add*.
3. As that member, open the private link from the email and press **Yes, I'm in**. Back on the leader's page the member moves to **Ready to add** with their number (if they said yes to WhatsApp). Tick **Added to the group**.
4. God Mode → Placement → **Open now** still opens a whole tribe's contacts. Use it only if you mean to.

**Fix 11**

5. As a coach, **Growth → Removal requests**: you can write what you would do, but no button decides. As an admin or a director, **Admin → Leaders → Removal requests** (and a line on **Admin → Today**): you decide, with a note of 10 characters or more.

**Fix 14**

6. As an admin: **Admin → People and roles → Find a member to place or move**. Type part of a name. **Open · place**. Choose a tribe: the fit, the seats and what will happen appear. **Place** the member. The member is emailed **Your tribe**.
7. Press **Undo** on the same page. The seat goes. (Undo works until the tribe's leader has been told.)
8. Place them again, then open their page again: it now says **Move to another tribe**. Choose another tribe and move them; **Undo** puts the old seat back.
9. Find a member who has not agreed to matching: the page asks for two ticks and a reason. The button stays off until all three are done.
10. Choose a full tribe: the page says the owner has to allow it and offers **Ask the owner**. As the owner, **God Mode → Placement → Placed from Admin**: the request is there. **Look again before you answer**, then **Approve and place** or **Decline**. The admin is told (if the admin notices are On).
11. As a member with no staff role, open `/admin/tribes`: you are sent home.

## Things to know

- **Nobody is placed from Admin while Placement is Off or in Rehearsal.** The pages say so.
- **The admin notice about the owner's answer starts Off,** like every notice group. Until you switch the admin group On (`docs/NOTICES-ADMIN.md` says where), an admin finds the answer by opening their page.
- **A member the church took out of a tribe cannot be put back in that tribe by anyone from here,** the owner included. Putting a removal right is done on the removal request (the appeal), not by placing.
- **An admin's tick that a member "told me they agree" is the admin's word.** It is kept with the placement, the admin's name and the time. It does not record agreement from the member.
- **The ticks on the leader's group list are the leader's own record.** The app cannot add or remove anyone in WhatsApp.
- **30 placements a day for each admin or director.** The owner has no limit.
- **An old guess is gone for good:** a member's number no longer opens after a day. If you want a tribe opened without waiting for a yes, that is **Open now**.

## Existing files this package changes

- **Database:** three new migrations and their ways back (above).
- **Fix 1, numbers:** `src/components/dashboard/` (`ChurchViews`, `DashboardView`, `Headline`, `InsightViews`, `LeaderProgress`, `TribeResults`), `src/components/reports/ReportView.tsx`, `src/lib/dashboard/insight.ts` and `types.ts`, `src/lib/exports/builders.ts`, `src/lib/matching/types.ts`.
- **Fix 2, contact and group:** `src/app/(app)/lead/tribe/page.tsx` and `group-actions.ts`, `src/components/leaders/GroupAdmit.tsx`, `src/components/matching/TribeOnboarding.tsx`, `src/components/intake/Welcome.tsx`, `src/components/god/RunBoard.tsx`, `src/lib/intake/consent.ts`, `src/lib/placement/` (`group.ts`, `group-server.ts`, `marks.ts`, `placed.ts`, `wording.ts`), `src/lib/messaging/templates-placement.ts`, and the guides `src/lib/guides/content/you-have-been-placed.ts` and `appointed-to-lead.ts`.
- **Fix 11, removals:** `src/app/(app)/growth/removals/actions.ts`, `src/components/removal/RemovalBoard.tsx`, `src/lib/removal/removal.ts` and `server.ts`.
- **Fix 14, place or move:** `src/lib/auth/roles.ts`, `src/lib/admin/nav.ts`, `src/lib/placement/types.ts` and `server.ts`, `src/components/admin/PeopleList.tsx`, `src/components/god/PlacementHome.tsx`, `src/app/(app)/admin/people/page.tsx` and `[id]/page.tsx`, `src/app/(app)/god/people/[id]/page.tsx`, `src/app/(app)/god/placement/page.tsx` and `actions.ts`. New: `src/app/(app)/admin/tribes/` (`page.tsx`, `[id]/page.tsx`, `actions.ts`), `src/components/placement/` (`PlaceOne`, `FindMember`, `AddToTribe`, `PersonPlace`, `PlacedLately`, `OfficeRequests`). Deleted: `src/components/god/PlaceOne.tsx`.
- **Fix 14, guide and profile list:** `src/lib/guides/catalogue.ts` and `context.ts` (the guide opens from **Place or move a member** and **People and roles**), new `src/lib/guides/content/place-or-move-a-member.ts`; `src/lib/profile/registry.ts` (the two new functions that read a person's age range, life stage and name are written down on the list of who reads what: `placement_check_core` replaces `placement_one_check`, and `placement_find`), `docs/PROFILE-READERS.md` (regenerated).
- **Notices:** `src/lib/messaging/templates-notices.ts` (one new notice, `admin_placement_answer`, for admins and directors; 71 notices in all), `docs/NOTICES-ADMIN.md`.
- **Docs:** `docs/MESSAGES-AUDIT.md` (regenerated), `docs/AUTO-PLACEMENT.md` and `docs/REMOVAL-REQUESTS.md` (updated). New: `docs/SAID-YES.md`, `docs/OFFICE-PLACEMENT.md`, this file.

## Existing tests this package changes (all disclosed)

Nothing checks less than before; each changed test now states the new rule.

- **Fix 1 (counts):** `tests/db/dashboards.test.ts`, `tests/db/fingerprint-kit.ts` (the story the dashboards are read against: the step is named for what it counts, members who said yes), `tests/unit/exports-builders.test.ts` (a member's standing reads *Said yes*, *Waiting for a reply* or *Chose this tribe*).
- **Fix 2 (contact opens on a yes only):** `tests/db/placement-board.test.ts`, `placement-send.test.ts`, `placement-visibility.test.ts` (a number no longer opens because a day passed or the form was ticked; a member after the wait with no reply is *unanswered*), `tests/unit/placement-group.test.ts`, `placement-marks.test.ts`, `placement-templates.test.ts`, `placement-wording.test.ts`, `leader-leading.test.ts`, and `e2e/journeys/38-placement-visibility.ts`.
- **Browser journeys:** `e2e/journeys/29-admin-menu.ts` (the Admin menu now has 29 pages for an admin, 23 for a pastor and 30 for someone who is both; it counts the Contact gaps and Removal requests pages and the new Place or move a member page), `e2e/journeys/30-placement.ts` (a day passing no longer opens a number: Efe, who has not answered, is *waiting for a reply* with no number on the page).
- **Fix 11:** `tests/db/removal-requests.test.ts` (a coach recommends and no longer decides), `e2e/journeys/40-removal.ts`.
- **Fix 14, older tests:** `tests/db/placement-undo.test.ts` (the reply of `placement_undo` now also says `restored`, false for an ordinary run), `tests/db/placement-plan.test.ts` (an admin or a director is now let through the door of `placement_undo` and gets "No such run" for a run that is not there, every other role and function is refused as before), `tests/db/notices-rollback.test.ts` (the way back from fix 11 deletes the holds that change put on people, a removal or care hold that did not exist before it; that one statement is set aside, nothing else is), `tests/db/profile-readers.test.ts` reads the updated list.
- **Fix 14:** `tests/db/inseason-placement.test.ts` (a tribe that is only full now says *This tribe is full (n of m). Nothing was changed*), `tests/db/foundation.test.ts` (the twelve new screen functions are added to the list the app may call), `tests/unit/placement-inseason.test.ts` (a blocker also says whether only the owner may get past it), `tests/unit/admin-nav.test.ts` (the Admin menu has 30 pages, was 29, and **Place or move a member** is found by name), `tests/unit/notice-templates.test.ts` (71 notices), `tests/unit/fixtures/email-golden.json` (regenerated).
- **New tests:** `tests/db/said-yes.test.ts`, `said-yes-rollback.test.ts`, `removal-admin.test.ts`, `removal-admin-rollback.test.ts`, `office-placement.test.ts`, `office-placement-rollback.test.ts`, `tests/unit/office-placement.test.ts`, `e2e/journeys/47-office-placement.ts`; all on the list in `scripts/rehearse-rollback.sh`.

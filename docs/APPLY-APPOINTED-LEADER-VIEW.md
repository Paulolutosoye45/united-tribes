# The appointed leader's Lead page: how to apply this package

This zip holds **only the files that changed** since the package you last applied (the "application sent" notice). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261229000200_notice_owner_name.sql`. No new packages and no new settings.

## What was wrong

A leader you appoint from God Mode has no application, by design. The **Lead a tribe** page decided what to show from the person's application, so it treated an appointed leader as someone who had never applied: *"Lead another tribe. Start my application."* The appointment record is private to the owner, so the page had nothing else to read. Worse, the **Start my application** button worked. An appointed leader who sent one would have told every admin and director "a new leader application was sent" and joined the interview line.

Only the Lead page was wrong. **Home**, the **Tribe Card**, the **Academy** and **This week** already worked for appointed leaders.

## What it does

1. **The Lead page now says they are appointed.** *"You have been appointed to lead &lt;their tribe&gt;."* Under it, the four steps that are true for them:
   1. **Appointed** (done).
   2. **Leader training**. It becomes **Safeguarding declaration** if only that is asked, and is left out if neither is. It turns to done when they have finished everything asked of them, and says certification follows once a pastor approves the card.
   3. **Tribe Card**: *Started for you*, then *With a pastor for approval*, *A pastor asked for changes*, or *Approved by a pastor*.
   4. **Open to members**, done when the card is approved and they are certified.

   The buttons are the ones an approved leader has: training (until it is done), **My Tribe Card**, **This week**. The words follow your Academy and declaration switches exactly as the approval line does.
2. **It says appointed, not approved.** Nobody reviewed an application, and the page never says so. (A quicker fix would have made a pretend "approved" application for each appointee. That would have counted them as interviewed and approved in every report, shown pastors an application that does not exist, and sent a "you were approved" email. It was not done.)
3. **It never says who appointed them.** Not the owner, not "an administrator", not your note. The database function behind the page returns three things only: the tribe's name, where its card stands, and whether they are certified. A test reads the function's own text and fails if it ever touches the appointer, the note or the form.
4. **No application for someone who is appointed.** A guard in the database refuses a new application from a person with an active appointment, in words (*"You have been appointed to lead, so there is no application to send"*), and the apply page sends them back to the Lead page. When you **Step down** an appointment, they can apply again. The guard covers only a new draft: anything the office loads directly is untouched.
5. **An application sent before the appointment.** Their Lead page shows the appointed view, with a small card: *"An application you started. You do not need it, because you have already been appointed."* and the usual **Withdraw my application** button. Until they delete it, the review panel may still contact them about it. If you appoint someone who has an application waiting, tell the pastors too.
6. **Someone approved through the application is unchanged.** If a leader has an approved application, they keep the page they have today, even if they are also appointed.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell the office. No one needs to do anything.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20261230000100_my_appointment.sql`

   It adds one function and one guard. Nothing is deleted or rewritten.
2. **Check**, in the SQL editor:
   - `select count(*) from pg_proc where proname = 'my_appointment';` returns `1`.
   - `select count(*) from pg_trigger where tgname = 'leader_applications_guard_appointee';` returns `1`.
3. **Then the app**: deploy the website. Nothing else to set.

The website tolerates the old database: before the file is applied, the page simply reads "no appointment" and looks as it did. So the order above is safe either way, but run the database file first.

## Check it works (five minutes)

1. Sign in as a leader you appointed. Open **Lead**. You should see *"You have been appointed to lead …"*, the four steps, and no **Start my application** button.
2. Open the address `/lead/apply` by hand. It should send you back to **Lead**.
3. In **God Mode → Appointments**, step the test leader down. Their Lead page should go back to **Lead a tribe** with **Start my application**, because they have no role and no appointment.
4. Sign in as a leader who was approved through an application. Their page is exactly as before.

## Existing files this package changes

- `src/app/(app)/lead/page.tsx`: the appointed view, added before the "not started" view. Every other view is untouched.
- `src/app/(focus)/lead/apply/page.tsx` and `actions.ts`: the redirect, and the refusal said in words.
- `src/components/leaders/StageList.tsx`: it can take its own list of steps. With none given it shows the five application stages as before.
- `docs/GOD.md`: a paragraph on what the appointed leader sees.
- `scripts/rehearse-rollback.sh`: not a test; the new test's name is added to the list the way-back rehearsal leaves out.

## Existing tests this package changes (all disclosed)

Two files. `tests/db/foundation.test.ts` lists the database functions the app is allowed to call, and `my_appointment` is added to that list. `e2e/journeys/24-appointment.ts` (the browser journey for appointments) gains checks and keeps every one it had: it went from 41 to 53. Nothing in either checks less than before.

New tests: `tests/db/my-appointment.test.ts` (17 tests), `tests/unit/leader-appointed.test.ts` (14 tests), and new checks in the browser journey `e2e/journeys/24-appointment.ts` (the appointed Lead page on a phone, the apply page sending her back, and an appointee with an old application deleting it). Two deliberate breakages were tried and the tests failed both times: with the guard removed, two tests fail; with the lookup made to return the appointer and the note, four fail. Both were put back.

## The way back

1. The website tolerates the database file being absent, so you can stop at **Deploy** step 1 and nothing is lost.
2. To take it out: run `supabase/rollback/20261230000100_my_appointment.down.sql` as the database owner. Appointed leaders then see the old page again, with the **Start my application** button, exactly as before. Nothing else is touched: appointments, Tribe Cards, roles and applications stay as they are.

## What was checked, and what was not

Checked on a throwaway database built from the files, with a test browser:

- Type-check and lint clean. Unit tests: 2,176 pass (14 are new).
- Database tests: the full run is **1,722 passed, 0 failed** (59 files), including the new file (17 of 17) and the permission and static checks that list every function.
- The way-back rehearsal: the original 958 database tests give the same answer on a database built before the change and on one that has had every rollback file run (958 pass on both sides).
- The new tests fail when the thing they guard is broken on purpose: with the guard removed, 2 fail; with the lookup made to return the appointer and the note, 4 fail. Both were put back.
- Browser journeys: 24 (appointments) passes 53 checks, 07 (Admin) 78 and 28 (team emails) 66. The appointed Lead page was opened at phone width for a leader with no application and for one who had sent an application before being appointed. Neither page scrolls sideways.
- **Not** checked: a real phone, and your live data (run the five-minute check above on a test leader first).

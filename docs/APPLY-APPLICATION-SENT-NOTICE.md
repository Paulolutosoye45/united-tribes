# "A new leader application was sent", and one fix: how to apply this package

This zip holds **only the files that changed** since the package you last applied (the team emails and the new Admin). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261228000100_goal_unlock.sql`. No new packages and no new settings.

## What it does

1. **New email for admins and directors.** The moment someone presses **Send** on their leader application, every admin and every director of that centre is emailed: *"A new leader application was sent."* It names the applicant by first name, says how many applications are now waiting to be invited to an interview, and has one button.
   - **Right away**, not in the daily summary, whatever a person chose in **My notices**. (Quiet hours still hold it until 6 am Lagos time.) Applications are few, and the point is to know. If you would rather it went into the summary, say so and it is a one-word change.
   - **The button goes somewhere the person can open.** A director, pastor or coach goes to **Review leaders**. An admin who holds none of those roles cannot open that list (that is how the platform was built), so their button goes to **Figures**, where the intake numbers are.
   - **Someone who is both an admin and a director is emailed once.** The applicant is never emailed about their own application, even if they are an admin. Pastors and coaches are not emailed by this notice: the pastors are told later, when an interview is done, as before.
   - **What is in it:** a first name and a number. Nothing the applicant wrote, no score, no reference. A young applicant or the hidden owner is not named at all (the email says "Someone").
   - **Switches:** it follows the **Admins** and **Directors** groups on **Admin → Notifications**. Off sends nothing, Rehearsal writes to the log only, On emails.
   - If the notice cannot be written for any reason, the application is **still sent**; the failure is a line on the Notifications page.
2. **A fix: the hidden owner was named in the "someone's role changed" email.** When the owner gave a role from God Mode, the admins' email read *"Tunde was given the coach role by &lt;the owner's name&gt;"*. It now reads *"Tunde was given the coach role."* The owner is never named, and no email is written at all if the owner is the one receiving a role. Roles given by anyone else are still credited by first name. Emails already sent cannot be changed; the only ones affected are those written by an owner's role grant while the Admins group was On.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell the office: no page changed.

## Deploy, in this order

1. **Database**, two files, each once (`supabase db push`, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20261229000100_application_sent_notice.sql` (the new notice)
   2. `supabase/migrations/20261229000200_notice_owner_name.sql` (the fix)

   Nothing is deleted or rewritten. The second replaces one function from the earlier package with the corrected version.
2. **Check**, in the SQL editor:
   - `select count(*) from pg_trigger where tgname = 'notice_application_sent';` returns `1`.
   - `select pg_get_functiondef('public.notice_trg_role_given()'::regprocedure) like '%notice_is_owner(new.granted_by)%';` returns `true`.
3. **Then the app**: deploy the website. Nothing else to set.

## Check it works (ten minutes, on a rehearsal first)

1. **Admin → Notifications**: set **Admins** and **Directors** to **Rehearsal**. The list now shows **A new leader application was sent** under Admins, marked *At once*, with **How it reads**.
2. Sign in as a test applicant and send an application. After a minute, the log on the Notifications page shows one row for each admin and each director, marked *Rehearsal: not sent*. Nobody is emailed.
3. Set the two groups to **On** and send another test application. Each admin and director receives one email. A director's button opens **Review leaders**; an admin who is not a pastor, director or coach has a button to **Figures**.
4. As the owner (God Mode), give a test person a role. The admins' email says the role was given, and not by whom.

## Existing files this package changes

- `src/lib/messaging/templates-notices.ts`: the new wording, and a button's label may now depend on the page it opens. No existing email changes its wording or layout.
- `docs/NOTICES-ADMIN.md`: 58 notices; the two lists; the owner sentence.
- `scripts/rehearse-rollback.sh`: not a test; the new test's name is added to the list the way-back rehearsal leaves out.

## Existing tests this package changes (all disclosed)

Two files: `tests/unit/notice-templates.test.ts` and `tests/db/goal-unlock-rollback.test.ts`. Four assertions had to move because they count or list the notices: the number of notices is 58 (was 57); the list of "at once" notices gains `admin_application_sent`; the check that every notice the database queues has wording (and the reverse) also reads the new migration; the test title says 58. Nothing checks less than before. One test was added to it for the new wording.

`tests/db/goal-unlock-rollback.test.ts` assumed no migration came after "Let them choose", so it compared the whole database with the one before it. It now rolls back anything built later (found by file name, newest first) before it checks, exactly as the older way-back tests already do. It checks the same things as before.

New tests: `tests/db/notices-application-sent.test.ts` (19 tests: Off, Rehearsal and On; one that presses the real Send function; who is told and who is not; both roles once; the applicant not told; another centre not told; the count; right away; the right button for each person; nothing the applicant wrote; a young applicant not named; a failure never stops the application; not callable through the API; and, for the fix, the owner not named, an ordinary admin still credited, and the owner never written about). The owner test was run with the fix removed and **fails**, so it does catch the bug.

## The way back

1. **Switch Admins and Directors Off** on **Admin → Notifications**: nothing more is sent. This is enough for almost any reason.
2. To take the new notice out completely, run as the database owner: `supabase/rollback/20261229000100_application_sent_notice.down.sql`. Applications are sent exactly as before.
3. `supabase/rollback/20261229000200_notice_owner_name.down.sql` puts the earlier role-change function back, **including the owner-name leak**. Use it only if the fixed function is itself faulty, and keep **Admins** Off while you do.

## What was checked, and what was not

Checked on a throwaway database built from the files, with a test browser:

- Type-check and lint clean. Unit tests: 2,162 pass.
- Database tests: the new file passes (19 of 19); the four way-back tests pass (32 of 32), including that the earlier role-change function is put back exactly as it was; the new owner test **fails when the fix is removed** and passes with it. The full database run was 1,686 passed and 18 failed before the one fix above; 2 of the 18 were that way-back test (now passing). The other 16 are in `messaging.test.ts` and `referee-trust.test.ts` and fail only because the check was run at 3:45 am in Lagos, when the platform deliberately holds email that is not urgent (10 pm to 6 am). They fail in exactly the same way with this package's two database files taken out. They are to be re-run after 6 am Lagos time.
- The way-back rehearsal: the original 958 database tests give the same answer on a database built before the change and on one that has had the rollback files run (942 pass, the same 16 fail on both sides, for the reason above).
- Browser journeys 07 (Admin), 24 (appointments) and 28 (team emails): all pass (78, 41 and 66 checks).
- **Not** checked: delivery of the email to a real inbox through your mail server, Gmail or Yahoo (the journeys use a test mailbox); a real phone; your live data (run the rehearsal first, as above).

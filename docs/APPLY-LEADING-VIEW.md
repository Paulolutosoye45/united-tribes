# Leaders who lead a tribe: how to apply this package

This zip holds **only the files that changed** since the Profiles stage 1 package. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270101000100_profiles_stage1.sql`. No new packages and no new settings.

## What was wrong

Leaders whose Tribe Card had been approved, with people already in the tribe, opened **Lead** and were shown *"Lead another tribe. Start my application."*

Nothing was wrong with the cards or the members. The **Lead** page decided what to show from only two records: the person's leader application, or an active appointment. A leader who has the leader role but neither (the role was given directly, for example by an invitation) was treated as someone who had never applied. The same page was shown to an appointed leader on a database that did not yet have the appointed-leader file (`20261230000100_my_appointment.sql`). The page never asked the obvious question: does this person lead a tribe?

## What it does

1. **The Lead page asks whether the person leads a tribe.** A leader with no application and no appointment now sees *"You lead <their tribe>."*, with **My Tribe Card** and **This week**, and the training button only if training is still asked of them. It says where the card stands. Once the card is approved it also says how many people have joined.
2. **Who has joined, on the Lead page.** For a leader with an approved card, a card lists the people by name with the day they joined and whether they have been welcomed, and a button to the Tribe Card for the welcome work. The list is the leader's own list, so its rules apply: a member the church placed is not shown before they are told. A leader whose card is not approved yet sees no list.
3. **No application is offered to someone who leads.** And the page does not say how they came to lead: not that they were appointed, invited or approved.
4. **Leaders approved through an application, and appointed leaders, keep their pages.** They now also see **Who has joined**. Nothing else on their pages changed.
5. **A leader who began an application for a second tribe** still sees *"Pick up where you left off"* (or their application's progress), with a small card above the rest: *"You lead <their tribe>"* and **My Tribe Card**, one tap away.
6. **Assistant leaders** who have no application are told *"You are the assistant leader of <tribe>"* and may read the Tribe Card, instead of being offered an application.
7. **The My tribe tab** shows a leader a card for the tribe they lead above the member flow (*Find your tribe*). The member flow is still there, below it. A member who leads nothing sees the tab exactly as before. A leader placed in a tribe as a member still sees their week, as before.

It adds **one database function, `my_leading()`**. It is read-only and returns only the tribe's name, where its card stands, how many people have joined, whether the person is certified, and whether they lead or assist. It says nothing about how they came to lead: not who appointed them, not any note, not any application. A test reads the function's own text and fails if it ever touches those.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone. No leader needs to do anything.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270101000200_leading_view.sql`

   It adds one function. Nothing is deleted, rewritten or moved, and no Tribe Card, member, role, application or appointment is touched.
2. **Check**, in the SQL editor: `select count(*) from pg_proc where proname = 'my_leading';` returns `1`.
3. **Then the app**: deploy the website. Nothing else to set.

The website tolerates the old database: before the file is applied, the page simply reads "no tribe" and looks as it did. So the order above is safe either way, but run the database file first.

**If appointed leaders are still shown "Start my application"**, also check that the earlier appointed-leader file is in: `select count(*) from pg_proc where proname = 'my_appointment';` should return `1`. If it returns `0`, run `supabase/migrations/20261230000100_my_appointment.sql` from the earlier package. With `my_leading()` applied those leaders are no longer offered an application either way, but the appointed page (which says they were appointed and lists the four steps) needs that file.

## Check it works (five minutes)

1. Sign in as a leader whose role was given directly and whose card is approved. **Lead** should say *"You lead …"*, with the tribe's people listed and no **Start my application** button.
2. Open **My tribe**. A card for their tribe sits above *Find your tribe*.
3. Sign in as a leader approved through an application. The page is as before, with **Who has joined** added.
4. Sign in as an ordinary member. **Lead** still offers **Lead a tribe. Start my application**, and **My tribe** is as before.

## Existing files this package changes

- `src/app/(app)/lead/page.tsx`: one new view (a leader with no application and no appointment), the **Who has joined** card in the appointed and approved views, and a small strip above an application in progress. Every other view is untouched.
- `src/app/(app)/tribe/page.tsx`: the strip for a leader above the member flow.
- `src/lib/leaders/server.ts`: two loaders added; nothing changed.
- `docs/GOD.md`: a paragraph on what a leader who leads a tribe sees.
- `scripts/rehearse-rollback.sh`: not a test; the new test's name is added to the list the way-back rehearsal leaves out.

## Existing tests this package changes (all disclosed)

One file. `tests/db/foundation.test.ts` lists the database functions the app is allowed to call, and `my_leading` is added to that list. Nothing in it checks less than before.

New tests: `tests/db/my-leading.test.ts` (16 tests), `tests/unit/leader-leading.test.ts` (11 tests), and a new browser journey, `e2e/journeys/37-leading-view.ts` (24 checks: a leader given the role directly, an appointed leader on a database without the earlier file, an application-approved leader, an appointed leader, a leader whose card is a draft, an assistant leader, a leader with a second application begun, a member, the My tribe tab, and a phone). Two deliberate breakages were tried and the tests failed both times: with closed tribes no longer ignored, 1 test fails; with the lookup made to return who appointed the leader, 4 fail. Both were put back.

## The way back

1. The website tolerates the database file being absent, so you can stop at **Deploy** step 1 and nothing is lost.
2. To take it out: run `supabase/rollback/20270101000200_leading_view.down.sql` as the database owner. Leaders with neither an application nor an appointment then see *"Lead another tribe"* again, exactly as before. Nothing else is touched.

## What was checked, and what was not

Checked on a throwaway database built from the files, with a test browser, on the project as it stood after Profiles stage 1 plus this package:

- Type-check and lint clean. Unit tests: **2,387 pass** (84 files; 11 are new).
- Database tests: the full run is **1,917 passed, 0 failed** (68 files), including the new file (16 of 16) and the permission and static checks that list every function.
- The way-back rehearsal: the original 958 database tests give the same answer on a database built before the changes and on one that has had every rollback file run (958 pass on both sides).
- A before-and-after check on a database built before Profiles: eleven tables (tribes, members, applications, appointments, roles, certifications, people, profiles, logs, attendance, references) are identical to the row after Profiles stages 1 and 2 are applied, and what each leader reads is identical too. The approved Tribe Cards and their members were never touched.
- Browser journeys: all 35 ran. **34 passed the first time.** `29-admin-menu` failed once on a timing clash in the test (a page load interrupted by a redirect, at a page this package does not touch) and passed all 68 checks on both reruns. The new journey 37 passes 24 checks, and 24 (appointments) still passes its 53. The Lead page was opened at phone width for a leader whose role was given directly and does not scroll sideways.
- Reproduced before fixing: a leader with the role only, and an appointed leader on a database without the earlier file, were both shown "Lead another tribe. Start my application", with an approved card and members behind it. Both now see their tribe and their people.
- **Not** checked: a real phone, and your live data. Run the five-minute check above on a real leader first, and run the two queries under **Deploy** step 2 and the note below it.

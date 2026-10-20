# Phase A: the switchboard (settings, Admin page, presets, change log, and every switch carried through, with the Academy and declaration switches)

This zip holds **only the files that changed since the build you last applied**. Unzip it so its `united-tribes` folder merges into your
project (say yes to replacing files). **Everything from before must already be applied**, including the activity dashboard
(`20261215000100_activity.sql`). No new packages.

## What you get

- **One Admin page, Leader pipeline** (`/admin/leader-pipeline`), where the **admin or director** decides which steps a person goes through to become
  a leader: each of the seven first questions (Required, Optional or Off), references, the interview, the **Leader Academy** (Required, Optional
  or Off) and the **safeguarding declaration** (Required or Off). The **pastor** can read it. Two presets (**Full process** and **Open door**)
  move many switches at once, and every change is logged with who made it, when and why.
- **Every switch is carried through**: the application form and its first screen, the check before sending, the tracker, the interview
  invitation, the Leader Readiness Score, the pastor's decision, the review screens, the messages and the reports.
- **The Academy and declaration switches change certification**: a person is certified when the modules and practice session (if the Academy is Required),
  the declaration (if Required) and, for a leader, an approved Tribe Card are done. With both Off, an assistant leader is certified on approval and a
  leader once their card is approved.
- **Find your tribe is shown but not connected.** It stays Off and cannot be moved here until its own phase.
- **Nothing changes until a switch is moved.** The page starts at the Full process, and every screen, message and score reads exactly as before.
- Read **docs/SWITCHBOARD.md**.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Decide **who may change it**. The admin and the director can; give the role to no one else. Switching the Academy and the declaration both
   Off is a decision for the church, not the office, so agree it before anyone presses it (the page asks for a tick and warns plainly).
3. Nothing else is needed on day one. WhatsApp templates for the new wording are only needed when the matching switch is first moved
   (see "WhatsApp templates" below).

## Deploy, in this order

1. **Database**, three files, in this order, each once (`supabase db push`, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20261216000100_leader_pipeline.sql` (the settings row, the presets, the log, the Admin functions)
   2. `supabase/migrations/20261217000100_leader_switchboard.sql` (the application, send check, tracker, invitation, score, decision and reports follow the switches)
   3. `supabase/migrations/20261218000100_academy_switch.sql` (the Academy and declaration switches and certification)

   None of them deletes or rewrites anything that is already there. On a copy of a database holding eight leaders and assistants at every
   stage of training (with tribes, members, references, reviews and workshop bookings), the fingerprint of everything they own
   (`scripts/leaders-checksum.ts`) was identical before and after each of the three.
2. **Check**, in the SQL editor:
   - `select preset, references_mode, interview_mode, academy_mode, declaration_mode, tribe_fit from public.leader_pipeline_settings;` returns one row:
     `full, required, required, required, required, off`.
   - `select count(*) from public.leader_pipeline_log;` returns `0`.
   - `select public.academy_switch();` returns both switches as `required`.
3. **Then the app**: deploy the website. Nothing else to set.

## Check it works (about fifteen minutes)

Do this once with an admin or director, a pastor, and an ordinary member.

1. As the **director**, open **Admin → Leader pipeline**. Twelve switches, every one at today's position, **Full process** in use, only *Find your tribe* marked
   "Not connected yet", and "Nothing has been changed yet" in the log.
2. Press **Use open door**, then **Yes, set it**. The three first questions about six months, Foundation of Faith and serving, the references and the
   interview all read **Off**, and the Academy and declaration still read **Required**.
3. Move the **Leader Academy** to **Optional**, type a reason, **Review and save**, **Yes, save**. Find it in the log with your name and the reason. Press **Use full process** to go back.
4. Move the Academy and the declaration both to **Off**. A yellow warning appears and saving waits until you tick the box. Do not save unless you mean it
   (or save, look at step 6, then press **Use full process**, which puts both back to Required).
5. As the **pastor**, open the same page: it can be read, nothing can be moved. As a **member**, it does not open.
6. With the Open door in place, start a leader application as a new person: the first screen lists only the steps that apply, the questions screen asks four, and
   the tracker shows Application, Panel review and Decision. With the Academy off, the first screen asks only for the 75 minutes a week and promises no training.
7. Approve a test applicant as a leader (as a pastor, after two reviewers score them). With the Academy Required their Lead page says training is next; with both Off it says
   the Tribe Card is next.

## WhatsApp templates

Meta approves the wording of each WhatsApp template. This work adds five, used only when the matching switch is moved. **Before anyone moves the
Academy, the declaration, references or the interview away from Required**, submit them:

```
npm run templates -- --submit application_approved_optional
npm run templates -- --submit application_approved_declaration
npm run templates -- --submit application_approved_open
npm run templates -- --submit leader_check_clear_open
npm run templates -- --submit leader_check_clear_optional
```

Check them with `npm run templates -- --status`. Until one is approved, that message reaches the person by email and text instead. The wording of
`application_approved`, already approved, is not changed.

## What was tested

- **Database**: 34 files, 1,092 tests pass (before this work: 30 files, 958). The existing tests were not edited, apart from two lists that name every function and every
  key the database has (`tests/db/foundation.test.ts`, `tests/db/contract.ts`), which gained the new ones. Golden tests prove that with every switch at Required each score,
  status, message and certificate is exactly what it was.
- **Unit**: 47 files, 1,190 tests pass (before: 43 files, 1,064). Type check and lint are clean.
- **Browser** (a real browser at phone and desktop width, against a real Postgres with every migration): all journeys pass, including three new ones:
  the Admin page (`19-pipeline`), an application under the open door from the first screen to the pastor's decision (`20-switchboard`), and what a leader sees and what certification then needs
  under each Academy and declaration position (`21-academy-switch`).
- **Existing leaders**: the fingerprint test above, and switching training off then on certified the people who then qualified and withdrew no one.

## Not tested, because it cannot be from here

Your live data (how many leaders, applications and tribes you hold today, so the fingerprint test above was run on a copy built to look like them, not on yours; please
run `npx tsx scripts/leaders-checksum.ts <your database address>` before and after the three files and compare); a real WhatsApp, email or text provider and Meta's approval of the five
templates; a real Supabase project (the tests use a real Postgres with every migration and a stand-in for the sign-in and data API); real phones and a screen reader.

## What this does not do

It does not connect **Find your tribe** (its cards, the matching engine and the board come in later phases). It does not change the readiness thresholds (75 and 60), who decides
(a pastor, always) or any certificate already given. The two eligibility questions that mention "10 hours of training" and "safeguarding training" keep their wording
whatever the switches say: they are the church's questions, and the Admin page shows them as written.

## If something goes wrong

- **Quickest, no database change**: open Admin → Leader pipeline and press **Use full process**. Every switch returns to today's process, with the Academy and declaration Required.
  Applications already in progress keep the steps they were sent with, and certificates stay.
- **A person was certified who should not have been**: this happens only if a switch was moved to Off or Optional. Certificates are never withdrawn automatically; an administrator
  can remove one in the SQL editor if the church decides it. Check the log on the Admin page for who moved the switch and when.
- **Undo the database**: restore the backup. This also removes anything done since.

## Every file in this zip

The three migrations are new. So are the Admin page, the Academy and leader wording helpers, the tests and the three journeys; the rest are existing files that now follow the switches. Nothing is deleted.

**Database**: 3 files

- `supabase/migrations/20261216000100_leader_pipeline.sql`
- `supabase/migrations/20261217000100_leader_switchboard.sql`
- `supabase/migrations/20261218000100_academy_switch.sql`

**The website**: 52 files

- `src/app/(app)/admin/leader-pipeline/actions.ts`
- `src/app/(app)/admin/leader-pipeline/page.tsx`
- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/home/page.tsx`
- `src/app/(app)/lead/academy/[slug]/page.tsx`
- `src/app/(app)/lead/academy/declaration/page.tsx`
- `src/app/(app)/lead/academy/page.tsx`
- `src/app/(app)/lead/page.tsx`
- `src/app/(app)/lead/tribe/page.tsx`
- `src/app/(app)/review/academy/page.tsx`
- `src/app/(app)/review/actions.ts`
- `src/app/(focus)/lead/apply/actions.ts`
- `src/app/(focus)/lead/apply/page.tsx`
- `src/components/academy/CardReviewView.tsx`
- `src/components/academy/Checklist.tsx`
- `src/components/academy/CohortList.tsx`
- `src/components/academy/ModuleGrid.tsx`
- `src/components/academy/ModuleView.tsx`
- `src/components/academy/PracticeCard.tsx`
- `src/components/academy/SessionManager.tsx`
- `src/components/academy/StartCard.tsx`
- `src/components/academy/SwitchedOff.tsx`
- `src/components/academy/TrainingHero.tsx`
- `src/components/academy/TribeBuilder.tsx`
- `src/components/academy/Workshops.tsx`
- `src/components/admin/AcademyStats.tsx`
- `src/components/admin/PipelineSwitchboard.tsx`
- `src/components/leaders/ApplyEnds.tsx`
- `src/components/leaders/ApplyFlow.tsx`
- `src/components/leaders/ApplySteps.tsx`
- `src/components/leaders/ReviewQueue.tsx`
- `src/components/leaders/ReviewWorkspace.tsx`
- `src/components/leaders/StageList.tsx`
- `src/lib/academy/modes.ts`
- `src/lib/academy/options.ts`
- `src/lib/academy/server.ts`
- `src/lib/academy/types.ts`
- `src/lib/academy/wording.ts`
- `src/lib/admin/wording.ts`
- `src/lib/auth/roles.ts`
- `src/lib/leaders/answers.ts`
- `src/lib/leaders/modes.ts`
- `src/lib/leaders/pipeline.ts`
- `src/lib/leaders/readiness.ts`
- `src/lib/leaders/review-types.ts`
- `src/lib/leaders/server.ts`
- `src/lib/leaders/status.ts`
- `src/lib/leaders/steps.ts`
- `src/lib/leaders/wording.ts`
- `src/lib/messaging/templates.ts`
- `src/lib/outreach/compose.ts`
- `src/lib/outreach/templates.ts`

**Tests**: 13 files

- `tests/db/academy-switch.test.ts`
- `tests/db/contract.ts`
- `tests/db/foundation.test.ts`
- `tests/db/golden/academy-v1.sql`
- `tests/db/golden/leader-v1.sql`
- `tests/db/pipeline-kit.ts`
- `tests/db/pipeline.test.ts`
- `tests/db/switchboard-journeys.test.ts`
- `tests/db/switchboard.test.ts`
- `tests/unit/academy-modes.test.ts`
- `tests/unit/approved-messages.test.ts`
- `tests/unit/pipeline.test.ts`
- `tests/unit/switchboard-steps.test.ts`

**Browser journeys**: 4 files

- `e2e/dbkit.ts`
- `e2e/journeys/19-pipeline.ts`
- `e2e/journeys/20-switchboard.ts`
- `e2e/journeys/21-academy-switch.ts`

**Everything else**: 5 files

- `APPLY.md`
- `README.md`
- `docs/ADMIN.md`
- `docs/SWITCHBOARD.md`
- `scripts/leaders-checksum.ts`


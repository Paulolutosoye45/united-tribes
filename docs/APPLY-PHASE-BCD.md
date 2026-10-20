# Phases B, C and D: the compatibility test, the owner's appointment, and the other 77 cards

This zip holds **only the files that changed since the build you last applied** (Phase A, the switchboard). Unzip it so its `united-tribes` folder
merges into your project (say yes to replacing files). **Everything from before must already be applied**, including Phase A's three files
(`20261216000100`, `20261217000100`, `20261218000100`). No new packages. Phase A's notes are kept as `docs/APPLY-PHASE-A.md`.

## What you get

**B, the compatibility test** (read `docs/LEADER-FIT.md`)
- **The model, runs and recommendations** in the database: five parts (calling, judgement, style, need, stage) with weights the pastor approves, versions that are never
  edited, and a record of every run so any result can be explained afterwards. The first proposal, `lf-1`, ships **not approved**.
- **The "Find your tribe" screen**, after *How you lead best*: the best three tribes with a match word, a percentage and plain reasons; every other tribe under its
  community; one choice and up to two backups. A leader who presses *Send* without choosing is taken to it; if there is nothing to choose, nothing is blocked.
- **The pastor's "Tribe fit" panel** on each application (a pastor or director at once; any other reviewer only after scoring). It guides the conversation and
  changes no score.
- **Cards with their leadership demand and sensitive flag for the 23 live goals**, and **the 8 leaders' saved answers run quietly** from the Admin page (nobody is told).
  A leader's own page then lists *Tribes you could lead next season*.
- **An Admin card** (Leader pipeline → Tribe fit): ready or not, the model in use, propose a new version, the pastor approves, run the leaders quietly. The *Find your tribe*
  switch on the Leader pipeline page is now connected; it refuses **On** until a model is approved and a card is signed off.

**C, God Mode appointment** (read the new section in `docs/GOD.md`)
- Owner-only (`/god/appointments`): find a person, answer the short fit form, see the suggested tribes, appoint, and step down. An appointment gives the leader role and
  starts a Tribe Card; **a pastor still approves the card and the Academy still certifies**, so members see nothing until both are done. The office is told *"appointed by an
  administrator"* and never a name.

**D, the other 77 cards** (read `docs/TRIBE-CARDS.md`)
- **100 template rows** (the 23 live goals' cards and 77 new), **77 new goals created at the moment each card is signed off**, the **review sheet**
  (`tribe-cards-100-review.csv` here, and a live download on the page), **sign-off community by community** (sensitive cards one by one), a leader's **ready-made card button**,
  and the Companion's life facts and "by week 12" sentences for the 77 new goals.

**The leaders' improved application is untouched.** The checks on written answers (minimum words, retries, the consent wording, the kind notes, the hold for a person) are on the
earlier screens and run exactly as before; Find your tribe comes after them and has no written box. The browser journey `23-find-tribe` runs a whole application with the first check On and
shows keyboard mashing still gets the kind note before the new screen appears.

**Nothing changes until you switch it on.** Find your tribe starts Off. The cards load as drafts; no goal is created and nobody sees a card until a pastor signs it off.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Decide **who signs off the cards**. The pastor and directors can sign; the administrator can read and edit. The pastor alone approves the model.
3. Give the pastorate the **review sheet** (`tribe-cards-100-review.csv`) to read before anyone signs anything. It has a column for their decision and notes.
4. Nothing else is needed on day one. No new WhatsApp templates, no new secrets.

## Deploy, in this order

1. **Database**, six files, in this order, each once (`supabase db push`, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20261219000100_card_templates.sql` (the card table and its functions)
   2. `supabase/migrations/20261219000200_card_templates_seed.sql` (the 23 cards for the live goals; stops if any card's weekly ideas differ from the goal's, word for word)
   3. `supabase/migrations/20261219000300_card_templates_seed_new.sql` (the 77 new cards, as drafts; creates no goal)
   4. `supabase/migrations/20261220000100_leader_fit.sql` (the model, runs, engine, quiet run)
   5. `supabase/migrations/20261221000100_leader_fit_screen.sql` (the ready check, the send gate, next-season tribes, the Admin status)
   6. `supabase/migrations/20261222000100_leader_appointments.sql` (the owner's appointment)

   Nothing is deleted or rewritten. Two small functions that Phase A shipped as placeholders, `leader_fit_ready()` (always false) and `leader_fit_gate(uuid)` (did nothing),
   get their real bodies in file 5; the send check, the presets and the settings reader already called them, so none of those is touched again. Both do exactly what the placeholders did while
   Find your tribe is Off. On a copy of a database holding eight leaders and assistants at every stage of training, **the fingerprint of everything they own
   (`scripts/leaders-checksum.ts`) was identical before and after each of the six files**, and again after the pastor signed off the cards, approved the model and ran the leaders
   quietly (eight leaders; `FINGERPRINT 27eb0b77…`).
2. **Check**, in the SQL editor:
   - `select count(*), count(*) filter (where status = 'signed_off'), count(*) filter (where season_goal_id is not null) from public.tribe_card_templates;` returns `100, 0, 23`.
   - `select count(*) from public.season_goals;` returns the same number as before (no goal is created yet).
   - `select version, active from public.leader_fit_models;` returns `lf-1, false`.
   - `select tribe_fit from public.leader_pipeline_settings;` returns `off`.
3. **Then the app**: deploy the website. Nothing else to set.

## Switch it on, in this order (about thirty minutes of the pastorate's time, spread over days)

1. **Read the cards.** Review leaders → **Ready-made cards**. Read, edit, and **sign off** a community at a time. Open each sensitive card on its own and sign it off yourself. Signing a card off creates
   its goal (for the 77 new ones). Take as long as you need: nothing is live until it is signed.
2. **Approve the model.** Admin → Leader pipeline → **Tribe fit** → *Approve lf-1* (the pastor only). To change the weights first, propose a new version and approve that.
3. **Switch it on.** Leader pipeline → **Find your tribe** → On → Review and save. It will refuse, in words, if step 1 or 2 is missing.
4. **Look at the leaders we already have.** Tribe fit → *Look at the leaders now*. Leaders whose saved application has no situations or no "how I lead best" answer cannot be compared; the page says how many.
5. **Try it**: start a leader application as a new person. After *How you lead best* the new screen appears with your best three. Choose, add a backup, send, then open the application as the pastor and read **Tribe fit**.

To go back: Leader pipeline → Find your tribe → **Off**. Applications return to exactly what they were; choices already made are kept.

## Check it works (about twenty minutes)

1. As the **pastor**, open **Review leaders → Ready-made cards**: 100 cards, none signed off. Download the sheet and open it in Excel: 100 rows and a header.
2. Sign off one community. Its non-sensitive cards go to *Signed off*; the sensitive one stays *Waiting*. The goals of the new cards now exist (Admin → Catalogue).
3. Open a sensitive card: *Sign off* will not go ahead until you tick that you have read it.
4. As the **director**, try to switch **Find your tribe** On before `lf-1` is approved: it refuses, in words. Have the pastor approve `lf-1`, then switch it On.
5. Apply as a test leader on a phone. Mash the keyboard in *Why do you want to lead a tribe?*: you still get the kind note and stay on the screen. Then reach *Find your tribe*, choose, add a backup, send.
6. As a **coach**, open that application: the panel says it appears once you have scored. Score it; now it shows. As the **pastor** it shows at once. Record the decision as usual.
7. As an **approved leader** with no tribe yet, open Lead → Your Tribe Card: **Tribes you could lead next season** (after the quiet run).
8. As the **owner**, unlock the console → **Appointments**: find a person, answer the five questions, pick a tribe, appoint. The pastor opening that Tribe Card sees "appointed by an administrator". Step the person down.

## What was tested

- **Database**: 39 files, 1,288 tests; **1,272 pass**. The 5 new files hold the cards (66), the engine (62, plus an independent copy of the formulas held against it), the screen and send gate (31) and the appointment (37). The other
  **16 fail in two older files (`messaging`, `referee-trust`) for one reason: they were run at 03:00 in Lagos, inside the messaging quiet hours**, and the same 16 fail on the build from before this work when run at the same time. They passed
  when Phase A was tested on the evening of 19 October (all 1,092). **Please run them in the afternoon** (`npx vitest run --config vitest.db.config.mts`).
  Golden tests show that with Find your tribe Off every send, score, status and certificate is what it was.
- **Existing tests were not changed** apart from these three, each listed so you can see why: `tests/db/foundation.test.ts` (the list of every function a signed-in person may call gained the 24 new names), `tests/unit/pipeline.test.ts`
  (one test said "only Find your tribe is left unconnected"; it is connected now, so it says every switch is) and `e2e/journeys/19-pipeline.ts` (it expected the Find your tribe switch to be "not connected" and unmovable; it now expects it connected, Off, with two positions).
- **Unit**: 54 files, 1,266 tests pass (before this work: 47 files, 1,190). Type check and lint are clean.
- **Browser** (a real browser at phone and desktop width, against a real Postgres with every migration, failing on any console error): **22 journeys, 1,192 checks, 0 problems** (the 19 older journeys: 1,033 checks in one full run; the three new ones: 57, 61 and 41, re-run after fixing their own test set-up). Three new journeys: `22-card-templates` (sign-off by community, the sensitive card, the sheet, the leader's button),
  `23-find-tribe` (the Admin card, a whole application with the first check On, the send gate, the pastor's and a coach's panel, the second model version, the quiet run, next season's tribes) and `24-appointment` (find, form, suggestions, appoint,
  the pastor's note, step down, and a refusal when members have joined).
- **Existing leaders**: the fingerprint test above.

## Not tested, because it cannot be from here

Your live data: how many leaders and tribes you hold today, so the fingerprint test was run on a copy built to look like them, not on yours. Please run
`npx tsx scripts/leaders-checksum.ts <your database address>` before and after the six files and compare. Also: a real Supabase project (the tests use a real Postgres with every migration and a stand-in for the sign-in and data API);
real phones and a screen reader; and **how the match feels to real leaders**. The weights in `lf-1` are a first proposal; let the pastorate read what the first dozen leaders are shown before relying on it.
The quiet run skips leaders whose saved applications have no situations or no "how I lead best" answer, and says how many; if some of your eight were approved before those questions existed, they will show as skipped.

## What this does not do

It does not build the supply-and-demand **board, suggestions and offers** (the blueprint's Phase 7) or the release hardening run of every switch combination (Phase 8); those were not asked for. It does not change the readiness thresholds (75 and 60),
who decides (a pastor, always), or any certificate. It does not let a leader see a score, a weight, the hidden profile or another leader's choice.

## If something goes wrong

- **Quickest, no database change**: Admin → Leader pipeline → **Find your tribe → Off**. Applications return to exactly what they were. Cards and choices already made are kept.
- **A card is wrong**: open it on the Ready-made cards page and edit it (it returns to *Waiting*), or **Retire** it (its goal is switched off; nothing already chosen is removed).
- **An appointment was a mistake**: the owner opens Appointments → *Step down*. If members have joined, a pastor moves them first; the page says how many.
- **Undo the database**: restore the backup. This also removes anything done since.

## Every file in this zip

The six migrations are new. So are the card, compatibility-test and appointment pages and helpers, the tests and the three journeys; the rest are existing files that now know about them. Nothing is deleted.
This note is kept as a record of that release. For the whole package start at `DEPLOY.md`.

**Database**: 6 files

- `supabase/migrations/20261219000100_card_templates.sql`
- `supabase/migrations/20261219000200_card_templates_seed.sql`
- `supabase/migrations/20261219000300_card_templates_seed_new.sql`
- `supabase/migrations/20261220000100_leader_fit.sql`
- `supabase/migrations/20261221000100_leader_fit_screen.sql`
- `supabase/migrations/20261222000100_leader_appointments.sql`

**The website**: 40 files

- `src/app/(app)/admin/leader-pipeline/fit-actions.ts`
- `src/app/(app)/admin/leader-pipeline/page.tsx`
- `src/app/(app)/god/appointments/actions.ts`
- `src/app/(app)/god/appointments/page.tsx`
- `src/app/(app)/lead/page.tsx`
- `src/app/(app)/lead/tribe/actions.ts`
- `src/app/(app)/lead/tribe/page.tsx`
- `src/app/(app)/review/[id]/page.tsx`
- `src/app/(app)/review/cards/[id]/page.tsx`
- `src/app/(app)/review/templates/actions.ts`
- `src/app/(app)/review/templates/page.tsx`
- `src/app/(app)/review/templates/sheet/route.ts`
- `src/app/(focus)/lead/apply/actions.ts`
- `src/app/(focus)/lead/apply/page.tsx`
- `src/components/academy/TribeBuilder.tsx`
- `src/components/admin/TribeFitBoard.tsx`
- `src/components/cards/TemplateBoard.tsx`
- `src/components/cards/TemplateEditor.tsx`
- `src/components/god/AppointBoard.tsx`
- `src/components/god/GodNav.tsx`
- `src/components/leaders/ApplyFlow.tsx`
- `src/components/leaders/ApplySteps.tsx`
- `src/components/leaders/FindTribe.tsx`
- `src/components/leaders/NextSeasonTribes.tsx`
- `src/components/leaders/PanelTabs.tsx`
- `src/components/leaders/ReviewWorkspace.tsx`
- `src/components/leaders/TribeFitPanel.tsx`
- `src/lib/admin/wording.ts`
- `src/lib/auth/roles.ts`
- `src/lib/cards/templates.ts`
- `src/lib/companion/goal-extras.ts`
- `src/lib/companion/rank.ts`
- `src/lib/companion/sentences.ts`
- `src/lib/god/appointments.ts`
- `src/lib/god/wording.ts`
- `src/lib/leaders/fit-admin.ts`
- `src/lib/leaders/fit-panel.ts`
- `src/lib/leaders/fit.ts`
- `src/lib/leaders/pipeline.ts`
- `src/lib/leaders/steps.ts`

**Tests**: 15 files

- `tests/db/card-templates-all.test.ts`
- `tests/db/card-templates.test.ts`
- `tests/db/foundation.test.ts`
- `tests/db/leader-appointments.test.ts`
- `tests/db/leader-fit-reference.ts`
- `tests/db/leader-fit-screen.test.ts`
- `tests/db/leader-fit.test.ts`
- `tests/unit/appointments.test.ts`
- `tests/unit/card-templates.test.ts`
- `tests/unit/find-tribe-steps.test.ts`
- `tests/unit/fit-admin.test.ts`
- `tests/unit/fit-panel.test.ts`
- `tests/unit/fit.test.ts`
- `tests/unit/goal-extras.test.ts`
- `tests/unit/pipeline.test.ts`

**Browser journeys**: 4 files

- `e2e/journeys/19-pipeline.ts`
- `e2e/journeys/22-card-templates.ts`
- `e2e/journeys/23-find-tribe.ts`
- `e2e/journeys/24-appointment.ts`

**Everything else**: 11 files

- `docs/APPLY-PHASE-BCD.md` (this note, which used to be `APPLY.md`)
- `README.md`
- `cards/seed_tribe_cards.sql`
- `cards/tribe-cards-100-review.csv`
- `cards/tribe-cards-100.json`
- `docs/ADMIN.md`
- `docs/APPLY-PHASE-A.md`
- `docs/GOD.md`
- `docs/LEADER-FIT.md`
- `docs/SWITCHBOARD.md`
- `docs/TRIBE-CARDS.md`


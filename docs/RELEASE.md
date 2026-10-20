# Release: hardening, the way back, and the order to switch things on

This is the blueprint's Phase 8. No feature is added here. It proves the phases work together, gives a tested way back, and puts the order in
which to switch things on in one place. **Everything stays at today's position until Mary switches it.**

## 1. The combined test matrix

`tests/db/matrix.test.ts` takes one applicant from the first answer to a tribe that members can see, under one full set of positions of every
switch, using the real functions as the people who would call them: the applicant answers, adds referees if they are asked, chooses a tribe
(when Find your tribe is on), sends; the panel scores; a director invites; the applicant books; a pastor decides; the new leader does what the
Academy and the declaration ask; starts a Tribe Card, submits it; a pastor approves it; a member asks what the platform would offer.

| Switch | Positions | |
| --- | --- | --- |
| Eligibility questions | all Required; the Open door set; all Off | 3 |
| References | Required, Optional, Off | 3 |
| Interview | Required, Optional, Off | 3 |
| Find your tribe | On, Off | 2 |
| Academy | Required, Optional, Off | 3 |
| Declaration | Required, Off | 2 |
| **Combinations** | | **324** |

* **Every day** (`npm run test:db`): the twelve representative combinations. Together they put every position of every switch at least once.
* **For a release** (`npm run test:matrix`): all 324. About two minutes.
* On Windows set the variable first: `set UT_FULL_MATRIX=1` then `npx vitest run --config vitest.db.config.mts tests/db/matrix.test.ts`.

If a combination fails, the output names the combination and the invariant:

```
questions open door · references off · interview required · Find your tribe off · Academy optional · declaration required
  invariant 9 (The activity funnel shows no drop at a stage that was off): the funnel puts the approved applicant at stage 25, not 28
```

**The twelve invariants, read after every journey** (a test fails if a journey does not read all twelve):

1. Only a pastor's decision produces an approval. A coach, a director and an administrator are refused; the decision is recorded against a pastor.
2. The readiness bars are 75 and 60, and the weights used (30, 25, 25, 20, or the parts that apply) give the score the parts add up to.
3. An open referee concern blocks approval, and no approved application anywhere has one.
4. A tribe is shown to members only when its card is approved and its leader is certified.
5. A person is certified exactly when the certification rule table says so, checked after every step.
6. No application waits for a stage that is off; no slot is held for an interview that is off.
7. A "no" to a question that is not Required never leaves anyone ineligible.
8. The applicant's own view, the Find your tribe screens and the ready-made card shown to a leader carry no scores, tags, reasons, judgement, care result, sensitive flag, leadership profile or "who leads this well" note.
9. The activity funnel shows no one held at a stage that was off.
10. The hidden owner's name is in no log, list or screen a normal user can open, including as the person who signed a card off.
11. Every message queued carries the wording flags for that application (and the approval message is the one that fits the Academy and declaration), and none is queued twice.
12. No table loses a row during a journey.

A check that cannot fail is not a check. The matrix was run once with the certification rule table and the funnel's expected stage deliberately
wrong; invariants 5 and 9 failed in the combinations they should.

### A note on the clock

`npm run test:db` now stops with a failing exit code when a database test fails. (Before this package it exited "successfully" even with failures,
because stopping the throwaway Postgres lost the code; `tests/db/global-setup.ts` now keeps it.) That makes one older fact visible: about
sixteen messaging and referee tests from before this work send a message and expect it to go out at once, and the platform holds messages
between 10 pm and 6 am Lagos time. **Run the database tests and `npm run verify` between 7 am and 8 pm Lagos time.** At night those
tests fail because of the clock, not the code, and they failed the same way on the original package. The same applies to the
GitHub workflow if it runs between 9 pm and 5 am UTC: re-run it in the morning.

## 2. Static checks (every build)

`tests/db/static-checks.test.ts` and the existing suites:

* Each revised function exists exactly once in `pg_proc`; no function has two argument lists.
* Every function added from Phase 1 on is either closed to the client roles or on the permission list in `foundation.test.ts`; no table is without row-level security; every definer function pins its search path.
* One copy of each rule: "members waiting" (`goal_demand_rows`), the fit formula (`leader_fit_options`), the sign-off rule (`card_template_activate`), the readiness bars (75 and 60 in `application_readiness` and `decide_application`), the step rules in the form (`src/lib/leaders/steps.ts`), and one reference copy of the scoring formula in the tests.
* 23 goals each with exactly three weekly ideas at the start; all 100 cards signed off through the real functions, community by community and the sensitive ones one at a time; 100 goals, 300 weekly ideas, no community above ten, the 23 original goals unchanged in id, slug and title; the goals always equal 23 plus the signed-off cards that are not among the 23.
* No signed-off card has placeholder text.
* The golden copies: with every switch at today's position, every revised function gives what its saved `_v1` copy gave (`switchboard.test.ts`, `academy-switch.test.ts`).
* `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:db`, `npm run build`. `bash scripts/verify-release.sh` runs all of them in order.

## 3. The way back

1. **The switches** are the first way back. **Full process** on the Admin page puts the application, the Academy and Find your tribe back to today. A retired card switches its goal off.
2. **Rollback files** are the second, for when a function itself misbehaves. They are in `supabase/rollback/`. Each puts back the exact body that function had before, with the same name, arguments and permissions, and drops the triggers that phase added. **They do not touch a table or a row.** Run them as the database owner, newest first:

   | Order | File | Puts back |
   | --- | --- | --- |
   | 1 | `20261221000100_leader_fit_screen.down.sql` | the two do-nothing hooks (Phase 6) |
   | 2 | `20261218000100_academy_switch.down.sql` | 12 functions; drops 2 triggers (Phase 3) |
   | 3 | `20261217000100_leader_switchboard.down.sql` | 14 functions; drops 1 trigger (Phase 2) |

   Run all three to go back to Phase 0, or only the first (Phase 6) or the first two (back to the application switchboard).
3. **Phases 1, 4, 5, 7, the owner's appointments and the owner's oversight add only new things.** Their way back is to stop using them: switch Find your tribe Off, retire cards, do not open Leader supply or the new God screens. The tables stay. No row is ever deleted.

**Rehearsed, not assumed.**

* `tests/db/rollback.test.ts` applies everything forward, signs off all 100 cards, takes applicants through under three sets of positions, runs the three files, and compares with a database built from the migrations that existed before the rework: **every function equals what it was**, the triggers the rework added to old tables are gone, **every table has exactly the rows it had**, the files can be run twice, a whole application still works as it always did, and the 77 new cards can be retired (their goals switch off, nothing is deleted).
* `scripts/rehearse-rollback.sh` runs the **original test suite** (the 30 test files that existed before the rework) against two databases, one built to the Phase 0 baseline and one built forward and rolled back, and compares them test by test. A test the baseline passes must pass after the rollback.

## 4. A rehearsal on a copy of live data

This part needs your data, so the repository gives you the tools and the order, not the result.

1. Restore a copy of the live database to a scratch database (a Supabase branch, or `pg_dump` and `pg_restore`). Never rehearse on the live one.
2. Run the fingerprint of the leaders you already have, **before**: `npx tsx scripts/leaders-checksum.ts "$SCRATCH_URL" > before.txt`
3. Apply the migrations that are new to you, **one at a time, in filename order** (section 5). After each one run the fingerprint again; the output must equal `before.txt` byte for byte (`diff before.txt after.txt`). Stop at the first difference.
4. Take every application in progress and move it one step, once under today's positions and once under the Open door.
5. Sign off the cards on the copy through the screen (or `card_template_sign_off_community`), community by community, the sensitive ones one at a time. Check: 100 goals, 300 weekly ideas, no community above ten, the 23 original goals unchanged. `tests/db/static-checks.test.ts` is the same check against an empty database.
6. Run the quiet run for the existing leaders (**Admin → Find your tribe → Run for existing leaders**). Read the results with the pastors for sense: a leader's current goal should rank high for them.
7. Open the board, the pipeline page, the card screen and the pastor panel with real names and numbers. Time the board and the activity refresh. The board should answer in about a second at today's size. Asking for a suggestion for one goal works out how well every approved leader suits it: about two seconds with 100 leaders on the build machine, so time it on your own data and expect it to grow with the number of leaders.
8. Compare the function list with a dump taken before: `select proname, pg_get_function_identity_arguments(oid) from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2;` The only differences must be the functions in the migrations you applied. (`rollback.test.ts` does this comparison for you against the empty database.)

## 5. Release order

Everything stays at the defaults until Mary switches it.

1. **Back up.** Take a backup and note the counts (people, leaders, applications, tribes, members) and the fingerprint of the leaders.
2. **Ship the code first.** The new code tolerates the old database: the settings parser falls back to today's positions, new keys are optional, the goal hints for the 77 new goals are harmless before those goals exist, and the new message templates exist before anything can queue them.
3. **Apply the migrations, one at a time, in this order.** After each: the fingerprint, the function list against what the phase promised, and a quick sign-in. Stop at the first surprise.

   | Phase | File |
   | --- | --- |
   | 1 Settings | `20261216000100_leader_pipeline.sql` |
   | 2 Application switchboard | `20261217000100_leader_switchboard.sql` |
   | 3 Academy and declaration switches | `20261218000100_academy_switch.sql` |
   | 4 The 100 Tribe Cards | `20261219000100_card_templates.sql`, then `20261219000200_card_templates_seed.sql`, then `20261219000300_card_templates_seed_new.sql` |
   | 5 The compatibility engine | `20261220000100_leader_fit.sql` |
   | 6 Find your tribe screen and panel | `20261221000100_leader_fit_screen.sql` |
   | Owner's appointments | `20261222000100_leader_appointments.sql` |
   | 7 The board, suggestions and offers | `20261223000100_leader_board.sql` |
   | Owner's oversight (desks and conversations) | `20261224000100_god_oversight.sql` |

4. **Leave everything at the defaults for a few days.** The platform behaves exactly as before, with the new tools idle and the 100 cards waiting as drafts. Watch for errors (**Admin → System**, and the host's logs).
5. **Switch things on in this order, each its own decision, a week apart if you can:**
   1. The pastorate reviews the cards and signs them off in the screen (**Review → Ready-made cards**), community by community, the sensitive ones one at a time. A community's new goals reach members when they are signed, so open each community's goals together.
   2. The pastorate approves the fit weights (**Admin → Find your tribe**, activate `lf-1`).
   3. Run the quiet run for the existing leaders and look at the results.
   4. Set the application switches: press **Open door**, or set them one at a time.
   5. The Academy stays Required unless Mary decides otherwise. The declaration is a separate switch because it protects members.
   6. **Find your tribe goes on last**, once the privacy wording has been checked and enough cards are signed off.
6. After each switch, watch the applications in progress, the funnel and the "Reduced evidence" tags for a week before the next.

## 6. The browser pass

Journey `27-browser-pass` opens the pages the rework touched, on a phone-width screen with a clean browser profile each time, as the people
who use them, and fails if a page scrolls sideways, if text is cut off, or if anything you are meant to tap is smaller than 40 pixels:
apply (Full process and the Open door); Find your tribe; the pastor's review with the Tribe fit panel; the decision with a reduced-evidence
reason; the Academy under each position; the declaration alone; the ready-made cards; a leader starting from the ready-made card; the member's
goal choice with all 100 goals signed off, in every community; the board; an offer, accepted; and the pipeline page as a director, a pastor
(read only) and a member (turned away).

Run it with the other journeys: `npm run e2e`, or `npm run e2e -- 27`. It uses a computer-sized Chromium on a phone-sized screen, so it
does not replace holding a real phone. Hold one anyway before the season opens.

## After release

The switch positions are recorded on every application and certification, so tribe results can be compared by evidence level and training
level after a season. The fit weights are not changed by hand or by machine until at least 30 tribe verdicts exist. Any change is a new model
version approved by the pastorate.

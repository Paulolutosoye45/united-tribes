# The blueprint, traced to what was built

For each part of the blueprint: where it lives, what proves it, and what is still a decision for the church. The blueprint's own
phases are the rows; the two extras the owner asked for later are at the end.

Tests named here are in `tests/db` (a real Postgres 17 with every migration), `tests/unit` and `e2e` (browser journeys on the production
build). `npm run verify` runs all of them.

## The phases

| Phase | What the blueprint asked for | Where it is built | What proves it |
| --- | --- | --- | --- |
| 0 | Preparation: backup, baselines, a dump of the live functions, golden copies, a fingerprint of today's leaders | `supabase/migrations/` baseline `20261215000100`; golden copies `_v1` inside the migrations that revise a function; `tests/db/golden/`; `scripts/leaders-checksum.ts` | `switchboard.test.ts` and `academy-switch.test.ts` compare every revised function with its golden copy at today's positions |
| 1 | The settings row, the change log, the Admin page, presets | `20261216000100_leader_pipeline.sql`; `src/lib/leaders/modes.ts`, `pipeline.ts`; `src/components/admin/PipelineSwitchboard.tsx`; `docs/SWITCHBOARD.md` | `tests/db/pipeline.test.ts`; `tests/unit/pipeline.test.ts`; `e2e/journeys/19-pipeline.ts` |
| 2 | The application switchboard: seven questions, references, interview, carried through every place that checks them; readiness renormalised with bars at 75 and 60; a pastor decides every application | `20261217000100_leader_switchboard.sql`; `src/lib/leaders/steps.ts`, `readiness.ts`; the apply flow, review workspace and tracker | `switchboard.test.ts`, `switchboard-journeys.test.ts`; `tests/unit/switchboard-steps.test.ts`; `e2e/journeys/20-switchboard.ts` |
| 3 | The Academy switch, and the declaration as its own switch; certification follows a rule table; nothing certified is ever withdrawn | `20261218000100_academy_switch.sql`; `src/lib/academy/modes.ts`; the Academy, declaration and Lead pages | `academy-switch.test.ts`; `tests/unit/academy-modes.test.ts`; `e2e/journeys/21-academy-switch.ts` |
| 4 | The 100 Tribe Cards, loaded as drafts; sign-off by the pastorate community by community, sensitive cards one at a time; signing off creates the 77 new goals and their three weekly ideas; the leader's "start from the ready-made card" | `20261219000100_card_templates.sql`, `20261219000200_card_templates_seed.sql`, `20261219000300_card_templates_seed_new.sql`; `src/lib/cards/templates.ts`; `src/components/cards/`; the review sheet at `/review/templates/sheet`; `docs/TRIBE-CARDS.md` | `card-templates.test.ts`, `card-templates-all.test.ts`; `tests/unit/card-templates.test.ts`, `goal-extras.test.ts`; `e2e/journeys/22-card-templates.ts` |
| 5 | The compatibility engine in the database: one formula, one "members waiting" figure, a model the pastorate approves, a quiet run for existing leaders | `20261220000100_leader_fit.sql`; `src/lib/leaders/fit.ts`, `fit-admin.ts` | `leader-fit.test.ts` (against the reference copy in `leader-fit-reference.ts`); `tests/unit/fit.test.ts`, `fit-admin.test.ts` |
| 6 | The "Find your tribe" screen after "how I lead best", the pastor's "Tribe fit" panel, "Tribes you could lead next season" | `20261221000100_leader_fit_screen.sql`; `src/components/leaders/FindTribe.tsx`, `TribeFitPanel.tsx`, `NextSeasonTribes.tsx`; `src/components/admin/TribeFitBoard.tsx`; `docs/LEADER-FIT.md` | `leader-fit-screen.test.ts`; `tests/unit/find-tribe-steps.test.ts`, `fit-panel.test.ts`; `e2e/journeys/23-find-tribe.ts` |
| 7 | The supply-and-demand board, suggestions and offers; the offer is one message that says how many are waiting, never who; accepting fills the Tribe Card from the ready-made card | `20261223000100_leader_board.sql`; `src/lib/leaders/board.ts`; `src/components/admin/LeaderBoard.tsx`, `src/components/leaders/LeaderOffer.tsx`; `docs/LEADER-BOARD.md` | `leader-board.test.ts`; `tests/unit/leader-board.test.ts`, `leader-offer-message.test.ts`; `e2e/journeys/25-leader-board.ts` |
| 8 | Hardening: every combination of switches, twelve rules that must always hold, static checks, a way back, a release order, a browser pass | `tests/db/matrix-kit.ts`, `matrix.test.ts`, `static-checks.test.ts`, `rollback.test.ts`; `supabase/rollback/`; `scripts/rehearse-rollback.sh`, `verify-release.sh`; `docs/RELEASE.md`, `DEPLOY.md` | 324 combinations (`npm run test:matrix`); the original 958 database tests give the same result on the rolled-back database as on the Phase 0 baseline (`npm run test:rehearse`); `e2e/journeys/27-browser-pass.ts` |

## The extras the owner asked for

| | Where it is built | What proves it |
| --- | --- | --- |
| **The owner appoints a leader** (the blueprint left this out on purpose and left hooks for it): a known leader is appointed to a tribe without an application; a pastor still approves the card and the Academy still certifies | `20261222000100_leader_appointments.sql`; `src/lib/god/appointments.ts`; `src/components/god/AppointBoard.tsx` (`/god/appointments`); `docs/GOD.md` | `leader-appointments.test.ts`; `tests/unit/appointments.test.ts`; `e2e/journeys/24-appointment.ts` |
| **God Mode sees every stakeholder's dashboard, with the analysis and the conversations**: a desk for each of the ten roles, a read-only view of what that role sees, the platform's conversations (the message outbox, chat opens and broadcasts: the platform stores no free-text chat), and a private record of what the owner opened | `20261224000100_god_oversight.sql`; `src/lib/god/desks.ts`, `oversight.ts`; `/god/desks`, `/god/desks/[role]`, `/god/conversations`, `/god/record`; `docs/GOD.md` | `god-oversight.test.ts`; `tests/unit/god-desks.test.ts`; `e2e/journeys/26-god-oversight.ts` |

## What stayed true, and how it is held

* A pastor decides every application. Only `decide_application`, which needs the pastor role, produces an approval (matrix rule 1).
* The readiness bars are 75 and 60 and never move (rule 2; the static checks read the number in each function).
* An open referee concern blocks an approval (rule 3).
* A tribe reaches a member only when its card is approved and its leader certified (rule 4).
* Certification follows one rule table (rule 5). No switch withdraws a certificate, and no switch reopens a decided application.
* The hidden owner is never named: not in a log, a list, a card's sign-off, or an offer (rule 10 and the whole-house scan in `matrix.test.ts`).
* The applicant's own view carries no scores, tags, reasons or judgement (rule 8). The ready-made card shown to a leader leaves out the hidden profile.
* The platform owner's conversations view carries no sensitive or care content and nothing about young members.
* Sealed notes stay sealed.
* Nothing new deletes a row (rule 12 and `rollback.test.ts`).

## Decisions in the blueprint, and where each stands

The build followed the recommendation on every one, so the platform ships at today's behaviour. The ones that still need a person:

| # | Decision | Where it stands |
| --- | --- | --- |
| 4 | Who signs off each community's cards and approves the fit weights | The screens enforce "pastor or director". Name one person per community before the release steps. |
| 7 | Lawyer's review of the wording that tells applicants their answers also suggest tribes | **Not done.** It must be done before Find your tribe is switched on. |
| 9 | Confirming Season 1, 2027 so Tribe Cards can be started and offers accepted | **Not done.** The season's dates are provisional. |
| 10 | A copy of live data for the rehearsal | The steps and the fingerprint tool are in `docs/RELEASE.md` §4. **Not run**, because it needs your data. |
| 12 | The offer message by WhatsApp | Email only. The WhatsApp template `leader_offer` is written and waits for Meta's approval. |
| 14, 15, 16 | Which communities open first; whether pastors edit before signing; whether a community opens together | Release-time choices, set out in `docs/RELEASE.md` §5. |

## What was not tested

Not run against a live Supabase project, a real phone, a screen reader, or real WhatsApp, email, text and AI providers. The first
weights of the fit model (`lf-1`) and the order of the suggestions are a first proposal for the pastorate to read and approve; they have
not been compared with real tribe results, which is why `docs/RELEASE.md` says they are not changed until at least 30 tribe verdicts exist.

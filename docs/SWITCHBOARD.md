# The leader pipeline switchboard

One page, **Admin → Leader pipeline** (`/admin/leader-pipeline`), decides which steps a person goes through to become a leader, and
what the church asks of a new leader before they are certified. The **admin and the director** can change it; the **pastor** can read it
and the change log. Nobody else can open it.

Nothing is different until someone moves a switch: every switch starts where the process has always been (the **Full process**).

## The switches

| Switch | Positions | What it does |
| --- | --- | --- |
| Six months as a member, Foundation of Faith, Serving in a team | Required, Optional, Off | The first questions on the application. *Required*: the answer must be yes (a no is stopped kindly and shown other ways to serve). *Optional*: asked, and a no does not stop anyone, but the panel sees it. *Off*: not asked, not on the form, not on the tracker. |
| Age 21, Time each week, Safeguarding, Confidentiality | Required, Optional, Off | The same, for the other four questions. |
| References | Required, Optional, Off | Required: two referees, one a pastor or unit head, and both must answer. Optional: up to two, and a concern raised by a referee must still be cleared by a pastor. Off: nobody is contacted. |
| Interview | Required, Optional, Off | Required: a pastor can approve only after the interview is held and scored. Optional: the panel may invite someone, or decide without. Off: the panel decides from the application. |
| Find your tribe | Off, On | Off: the application is the same as before. On: a screen after *How you lead best* where the leader sees the tribes that suit their answers and chooses one (with up to two backups), and the pastor sees how well they fit it. It cannot be switched On until the pastor has approved a model and at least one tribe card is signed off. See LEADER-FIT.md. |
| Leader Academy | Required, Optional, Off | Required: every module passed and the practice session marked ready before a leader is certified. Optional: the Academy stays open to leaders but certification does not wait for it. Off: the Academy is closed to leaders and certification does not need it. |
| Safeguarding declaration | Required, Off | Required: the leader signs before they are certified. Off: no declaration is asked for. |

Two presets set many switches at once. **Full process** is today's positions. **Open door** asks age, time, safeguarding and
confidentiality only, with no references and no interview. **Both presets set the Academy and the declaration to Required**, so pressing a
preset never switches training off by accident. Switching training off is a separate, deliberate step.

## Rules that never change

- **A pastor decides every application.** The Leader Readiness Score guides; it does not decide. The thresholds stay **75** for a leader and **60** for an assistant leader. When a score rests on fewer parts (no references, no interview) the page says so, and a pastor approving on thinner evidence can add a note, kept with the decision and never shown to the applicant.
- **An application keeps the steps it was sent with, unless the new position is kinder.** Turning a step off releases people who were waiting on it. Turning one on never pulls anyone back.
- **No certificate is ever withdrawn.** Moving the Academy or the declaration to a stricter position asks for more of people who are not yet certified, and takes nothing from anyone who already is.
- **If the settings cannot be read, everything is asked.** A failure to read can only make the process stricter, never more lenient.
- **Every change is logged** with who made it, when, the old and new position and an optional reason. The platform owner is shown only as "an administrator".

## What certification needs

A person is certified when all of these hold. Parts marked "if" are switched by the Academy and declaration switches.

| Part | Needed |
| --- | --- |
| Six modules passed | if the Academy is **Required** |
| Practice session marked ready by a coach | if the Academy is **Required** |
| Safeguarding declaration signed | if the declaration is **Required** |
| Tribe Card approved | always, for a **leader** (an assistant leader has no card) |

With the Academy and the declaration both Off, an assistant leader is certified the moment they are approved, and a leader as soon as
their Tribe Card is approved. The admin page warns about exactly this and asks for a tick before it can be saved.

When a switch is moved, everyone who now qualifies is certified straight away (a leader approved while training is off would otherwise
never be asked again). Anyone already certified stays certified whatever the switches say later.

### What leaders see

- **Academy Required, declaration Required**: exactly as before.
- **Academy Optional**: the Academy stays open and says it is optional; the leader is sent to whatever certification still needs, not to a module.
- **Academy Off, declaration Required**: the Lead page offers only the declaration; modules, workshops and the practice session are closed ("The Academy is switched off", with the date), and the declaration can be signed at once, without the care and safeguarding module first.
- **Both Off**: no training is shown anywhere. The application's first screen promises none; the approval message says the Tribe Card is next (or, for an assistant, that there is nothing to complete).
- The panel's Academy page and the Admin page's Academy figures read **Off** rather than showing zeros. Workshop dates and registers already made are kept.

The approval message follows the switches too. With the Academy Required it is the message it has always been. Otherwise it is one of three
other templates (below), chosen by the database.

## New WhatsApp templates

Meta approves the wording of each WhatsApp template, so a changed sentence is a new template rather than an edit. This work adds five.
They are only used when the matching switch is moved, so nothing is needed on day one. Before anyone moves those switches, submit them:

```
npm run templates -- --submit application_approved_optional
npm run templates -- --submit application_approved_declaration
npm run templates -- --submit application_approved_open
npm run templates -- --submit leader_check_clear_open
npm run templates -- --submit leader_check_clear_optional
```

Check with `npm run templates -- --status`. Until one is approved, that message goes by email and text only. The wording of
`application_approved`, which is already approved, is unchanged.

## Turning it back

- **Quickest, no database change**: press **Full process** on the Admin page. Every switch returns to today's process. Applications in flight keep what they were sent with; certificates stay.
- **Fully**: restore the backup taken before the three migrations. (Nothing in them deletes or rewrites existing leaders' data; see the checks in `APPLY.md`.)

## Where it lives

- Migrations, in order: `20261216000100_leader_pipeline.sql` (the settings row, presets, the log, the Admin functions), `20261217000100_leader_switchboard.sql` (the application, send check, tracker, invitation, readiness score, decision and reports follow the switches), `20261218000100_academy_switch.sql` (the Academy and declaration switches and certification).
- Screens: `src/app/(app)/admin/leader-pipeline`, `src/components/admin/PipelineSwitchboard.tsx`, `src/lib/leaders/pipeline.ts`, `src/lib/academy/modes.ts`.
- Tests: `tests/db/pipeline.test.ts`, `switchboard.test.ts`, `switchboard-journeys.test.ts`, `academy-switch.test.ts`; browser journeys `e2e/journeys/19-pipeline.ts`, `20-switchboard.ts`, `21-academy-switch.ts`; `scripts/leaders-checksum.ts` proves existing leaders are untouched.

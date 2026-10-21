# Automatic placement, bulk leaders and assistant leaders: how to apply this package

This zip holds **only the files that changed** since the full build you last applied (the one with the team emails and the new Admin). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261225000200_notice_triggers.sql`. No new packages and no new settings.

What it is, in one paragraph: God Mode gets a **Placement** page that plans, and then carries out, the placing of waiting members into tribes by their Degree of Compatibility; a **Bulk** tab beside Appointments that appoints many leaders at once; and leaders can **recommend an assistant leader**, decided by the office on a new **Assistants** page. How it works is in `docs/AUTO-PLACEMENT.md`. **Placement starts Off.** Applying this package places nobody and emails nobody.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Have a lawyer read the contact-sharing wording** (see "Before you switch it On"). It is a legal question about your members' data, not a technical one.
3. Check that the heartbeat is running (`/api/cron/tick`, every few minutes). Placing continues on it; there is nothing new to schedule.
4. Tell the pastors that a new line appears on the member form (an optional box about sharing contact details with a leader), and that an approved matching model is needed: the compatibility bar comes from it.

## Deploy, in this order

1. **Database**, three files, each once (`supabase db push`, or paste each in the SQL editor and press **Run**):
   1. `supabase/migrations/20261226000050_placement_consent.sql` (one new consent purpose, `team_contact`). Run it **by itself**: Postgres will not let a new value be used in the same transaction that adds it.
   2. `supabase/migrations/20261226000100_auto_placement.sql` (the tables, the scorer, planning, placing, undo, the private link, the bulk-leader functions, the heartbeat step)
   3. `supabase/migrations/20261226000200_assistant_recommendations.sql` (the assistant recommendations)

   Nothing is deleted or rewritten. **No existing function body is changed** (a test compares every function with the database before). Four columns are added to `tribe_members`; every new table has row-level security and no grants.
2. **Check**, in the SQL editor:
   - `select mode from public.placement_settings;` returns `off`.
   - `select count(*) from public.placement_runs;` returns `0`.
3. **Then the app**: deploy the website. Nothing else to set.

## Before you switch it On

1. **Wording.** Members are told, on the form and in the email, that their leader may be given their name, email and WhatsApp number. The leader is given them 24 hours after the member is told, unless the member agreed on the form (then at once) or said "don't share my details" (never). This follows the choice you made; please have it read for the Nigeria Data Protection Act before the first real run.
2. **Look first.** On **God Mode → Placement** press **Rehearsal**, plan a run narrowed to one community, read the plan, and walk it through. Nobody is seated and nothing is sent. What each leader would have received is in the message log (first names only).
3. **A pilot.** Switch **On**, plan a run for one community or one area, set the emails an hour to about 50, read the plan, approve it, and watch the first emails arrive. You can **Undo** until a tribe's leader has been told (24 hours after the last of its members).
4. Then widen the run. The pace starts at 100 an hour, between 9 am and 7 pm Lagos time; 5,000 members take about two working days to tell.

## Check it works (about twenty minutes)

1. As God Mode: **Placement** shows the switch Off, the numbers waiting, and a note to switch to Rehearsal or On first.
2. Switch to Rehearsal, plan a small run. The page says *Making the plan* and then shows the plan: numbers, tribes, people, and who was left out with a reason. Approve ("Walk through"). Nobody is seated: `select count(*) from public.tribe_members where placement_source = 'auto';` stays `0`.
3. Switch On, plan, approve, place. A member you placed opens the link in their email: the page names the tribe and offers *Yes, I'm in*, *Show me other tribes* and *Don't share my details*. Pressing *Yes* confirms the seat. As that member, **Tribe** shows a banner above the tribe.
4. As the leader: until the team email has been queued, **My tribe** does not list the members who were placed (it says no one has joined yet). After it, the members are listed with *Placed by the church*, and a member who held back shows *asked that their number is not shared*, with no number. To see this without waiting a day, set *Hours before a leader is told* to 0 in The church's choices before the run.
5. **Bulk**: `God Mode → Appointments → Bulk`. Paste two rows with `Email, Stage of life, How they lead best`, press **Read the list**, then **Make the plan**. Each person is paired with a goal that needs a leader. Approve and apply: each gets a started Tribe Card as a draft, and an email.
6. **Assistants**: as a leader with an approved tribe, **My tribe → Recommend an assistant**; as an admin, **Admin → Assistant leaders** shows the request and offers *Approve* and *Decline*.

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `src/components/god/GodNav.tsx`: a *Placement* link. `src/app/(app)/god/appointments/page.tsx`: the tab row (*One at a time · Bulk*).
- `src/lib/admin/nav.ts`: the *Assistant leaders* page in the Admin menu (27 pages; an admin sees 26, a pastor 21).
- `src/app/api/cron/tick/route.ts`: two calls at the start of the heartbeat, `worker_placement_tick` and `worker_assistant_tick`. With Placement Off the first does nothing. A fault in either is listed but never stops the messages after it.
- `src/proxy.ts`: `/placed` is a public path (the private link page).
- `src/lib/messaging/templates.ts`: registers the ten new emails. No existing email changes.
- `src/components/intake/IntakeFlow.tsx`, `Welcome.tsx`, `src/lib/intake/consent.ts`, `src/app/(focus)/join/actions.ts`: the optional contact-sharing box on the form. The consent version becomes `2026-12-v4`. Young people are not shown the box. Leaving it empty records nothing.
- `src/app/(app)/tribe/page.tsx`, `actions.ts`: the banner above a placed member's tribe.
- `src/lib/matching/server.ts`, `types.ts`, `src/lib/rhythm/server.ts`, `src/components/matching/TribeOnboarding.tsx`: the leader's roster and weekly page call `tribe_roster_marked` and `tribe_week_marked` (new functions that call the old ones and then hold back contact details) and show who was placed by the church.
- `src/app/(app)/lead/tribe/page.tsx`, `actions.ts`: the *Recommend an assistant* card.
- `README.md`: two rows in the table of guides.

## Existing tests this package changes (all disclosed)

| Test | What changed, and why |
| --- | --- |
| `tests/db/foundation.test.ts` | 35 new function names added to the list that signed-in people may call, and 6 to the list the sending service and the private link may call (the allow-lists exist to be extended). |
| `tests/db/notices-rollback.test.ts` | Its way-back rehearsal now also runs the rollback files of anything built after the notices (newest first, found by name). Before, it expected the database to hold nothing newer. |
| `tests/unit/admin-nav.test.ts` | The page count 26 → 27. |
| `e2e/journeys/29-admin-menu.ts` | The same count in five places (25 → 26 for an admin, 20 → 21 for a pastor, 26 → 27 for both). |
| `tests/unit/fixtures/message-params.ts` | Includes the ten new emails' sample fields. |
| `scripts/rehearse-rollback.sh` | Not a test: the way-back rehearsal's list of new tests, so the original suite is run without them on the rolled-back database. |

New tests: `tests/db/placement-scorer.test.ts`, `placement-plan.test.ts`, `placement-send.test.ts`, `placement-undo.test.ts`, `placement-leaders.test.ts`, `assistant-recommendations.test.ts`, `placement-rollback.test.ts`, `placement-scale.test.ts`; `tests/unit/placement-templates.test.ts`, `placement-sheet.test.ts`, `placement-wording.test.ts`; the journeys `e2e/journeys/30-placement.ts` and `31-bulk-and-assistants.ts`.

## Choices that differ from, or add to, what you approved

- **A plan can leave members "full" where you expect room.** The matching engine keeps room in every tribe for two established or leading members and needs a quiet and a lively member before the last two seats go. A tribe of 12 made up of members who are still growing therefore takes about nine or ten. The plan says so in the reason *Every tribe that fits is full*.
- **Planning needs the page open.** The plan is made in steps by the page; if you close it, open the run again and it carries on. **Placing** does not: the heartbeat carries it on.
- **Undo does not take back a placed seat for a member who said yes**, nor for a tribe whose leader has been told.
- **The old direct calls still show contact.** The leader's pages use the new filtered lists. The older database functions `tribe_roster`, `chat_phone` and `tribe_week` are unchanged, and a leader who calls them directly (not through the app) is not held back. The app does not.
- **Rolling back leaves placed members seated.** They hold real seats.
- **The existing seat notice can reach a leader early.** When members are placed, the team's email "has two seats left" or "is full" (from the notices, group *Leaders*, if you switched it On) can reach a leader before their "Your team" email. It carries a tribe name and a number, no names.
- **Bulk leaders is run from the page only**: there is no way to run it from a sheet on its own. It never approves a card and never certifies anyone.
- **A set-aside list has no button to set someone aside from the member's own page.** You set a member aside from the plan; the list on Placement releases them.
- **WhatsApp**: every message here is email. None has been submitted to Meta.

## The way back

1. **Switch Placement Off.** Nothing more is planned, placed or sent, and the private links stop opening. This is enough for almost any reason.
2. To take the feature out completely: restore the application files from the full package you had before this one, then run, as the database owner and in this order:
   1. `supabase/rollback/20261226000200_assistant_recommendations.down.sql`
   2. `supabase/rollback/20261226000100_auto_placement.down.sql`

   They drop the functions and the two triggers and leave the tables and every row (no run, choice or recommendation is lost); the last lines of each say how to drop the tables too. Running either twice changes nothing. Members already placed **stay placed**. Do not roll back in the middle of a run.

## What was checked, and what was not

Checked on a throwaway database built from the migration files, and in a test browser (Chromium):

- **Type check and lint**: clean.
- **Unit tests**: 64 files, 2,090 tests (66 of them new: the ten emails, the leader sheet reader, the wording).
- **Database tests**: 54 files, 1,588 tests (112 of them new). They cover: the scorer gives exactly the answer the matching engine gives; capacity and the engine's own health rules; every state a run and a person can be in; Undo; consent in all three cases (agreed, 24-hour wait, refused); that no email or page carries anything private; every new function's access; no existing function changed; and the way back.
- **All 324 combinations of the switches**: 329 of 329.
- **Browser journeys**: all 29 pass, including the two new ones. Journey 30 does the whole placement in a browser (switch Off, Rehearsal, On; plan; take someone out; approve; three members answering from the private link on a phone, one signed in; the leader's page before and after the "Your team" email; Undo disappearing). Journey 31 does bulk leaders (paste a list, one row refused with its line number, the plan, apply) and the assistant leader (recommend by email address, Approve, then Replace in one step).
- **The way back, rehearsed**: the original suite (958 tests) gives the same answer, test by test, on a database with every migration and both rollback files run as it does on one that never had them.
- **Size, on made-up data**: 5,000 members ready, 600 tribes. Making the plan took about two minutes forty seconds with the page open (58 steps, none longer than 4.3 seconds); placing took 100 steps, none longer than 3.2 seconds; every page opened in under 130 milliseconds; the heartbeat step took 0.8 seconds. This was on a small shared test machine.

Two things you may notice:

- **Two older test files fail if you run the database tests between 10 pm and 6 am Lagos time** (`messaging.test.ts` and `referee-trust.test.ts`). The platform sends nothing in those hours, and those tests claim messages. They fail the same way on the package before this one. Run them in the daytime and they pass (124 of 124).
- The older `notices-rollback.test.ts` had to change (see the table above), because it expected a database with nothing newer than the notices.

**Not** checked: delivery of these emails to a real inbox through your mail server, at the volume of a real run; real members; a real phone or a screen reader; the lawyer's reading of the contact-sharing wording; timing on your own server and data (rehearse on a copy first, `docs/RELEASE.md`).

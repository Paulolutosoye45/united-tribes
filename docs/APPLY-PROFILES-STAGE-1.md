# Profiles and the Weekly Rhythm, stage 1: how to apply this package

This zip holds **only the files that changed** since the Exports and Reports package. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261231000100_exports.sql`. **No new settings.**

**It also carries the Next.js 16.4.3 update** (`package.json` and `package-lock.json`), so this one zip is enough. If you already applied the separate Next.js package, say yes to replacing the same two files: they are identical to it, plus two new lines in `package.json` for the commands `npm run readers` and `npm run messages-audit`. After unzipping, run `npm ci` once (it installs the Next.js update).

What it is, in one paragraph: **stage 1 of Profiles and the Weekly Rhythm**, the foundations. The owner gets a **Features** page and a **Details check** page in God Mode. A leader the office appointed can be asked, with a private link, to confirm the stage of life the office typed for them; a leader whose tribe has members who asks to change it waits for a pastor; and nobody is moved automatically. How it works is in `docs/PROFILES.md`. **Every switch is in God Mode and nowhere else, and everything starts Off.** Applying this package changes nothing for anyone until the owner moves a switch.

**This is stage 1 only.** Stages 2 to 6 (My page for everyone, faces and visibility, know your tribe, the weekly rhythm, leaders' week) wait for their gates and are listed on the Features page, where they cannot be moved.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Decide who is asked first.** The recommendation is the leaders the office appointed (the ones who are seeing the wrong stage or age now), then all leaders. The owner chooses the audience each time.
3. **WhatsApp is optional.** Until the one template below is approved by Meta, the request goes by email and text, and nothing else is needed. **I could not submit it for you** (it needs your WhatsApp credentials). To submit it once, with your credentials in place (see `docs/MESSAGES-REMINDERS.md`):
   `npm run templates -- --submit details_check_request`
   The six-digit code is never sent on WhatsApp and is never put to Meta.
4. The daily heartbeat (`/api/cron/tick`) is already running. It now also reminds, calls a coach and clears out the Details check's links. There is nothing new to schedule.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270101000100_profiles_stage1.sql`

   Twelve tables, 52 functions and two triggers. Nothing is deleted or rewritten. **No existing function body is changed** (a test compares every function with the database before). Every new table has row-level security and no grants.
2. **Check**, in the SQL editor:
   - `select count(*) from public.feature_settings;` returns `0` (no rule: everything Off).
   - `select paused from public.feature_master;` returns `false`.
   - `select count(*) from public.details_checks;` returns `0`.
   - `select count(*) from public.profile_changes;` returns `0`.
3. **Then the app**: deploy the website (after `npm ci`). Nothing else to set.

The website tolerates a database that does not have the migration yet (the new pages say "not found" until it is there), so the two steps may be a minute apart.

## Open it, one step at a time (God Mode → Features, then Details check)

Each step is reversible by moving the same switch back. Nothing here is available to an administrator, a director or a pastor.

1. **My page, for tribe leaders.** Features → *My page* → **Move the switch** → On → tick **Tribe leader** → Save. (A role filter means no reason is needed; opening it for the whole church with no filter needs a reason of at least eight characters.) Only leaders find My page now.
2. **The Details Check, in Rehearsal, for tribe leaders.** Features → *Details Check from God Mode* → Rehearsal → tick **Tribe leader** → Save. It cannot be opened before My page: the page says so.
3. **Rehearse.** Details check → *See who would be asked* → **Rehearse**. It writes what would be sent and sends nothing; the run shows where each person stands and never what they answered. Check the numbers and the reasons people are left out.
4. **Open it for tribe leaders.** Features → *Details Check* → On → tick **Tribe leader** → Save (this replaces the Rehearsal rule; there is one rule per place).
5. **Ask the appointed leaders.** Details check → *Appointed leaders* → *See who would be asked* → tick "I understand…" → **Ask them now**. Each leader gets one message with a private link.
6. **Watch the run.** Each run lists waiting, answered, asked later, waiting for a pastor, no reply. After three days the leader is reminded once; after seven their coach (or a director) is asked to speak to them. **Stop this run** ends the links at once.
7. **Hold the Tribe Card (optional, later).** Features → *Hold the Tribe Card…* → **Optional** makes a pastor see that the stage is not confirmed; **Required** stops a card being approved until it is. Leave it Off until most leaders have answered.
8. **If anything is wrong**: **Pause every function** (Features, at the top) makes every new function act as Off, at once, and **Resume** brings every rule back. Moving a switch back to Off does the same for one function.

## Check it works (about twenty minutes)

1. As God Mode: **Features** and **Details check** are in the menu; every function reads **Off**, and the functions of later stages say when they arrive and cannot be moved.
2. As an administrator: `/god/features` and `/god/details` say "We can't find that page".
3. As an appointed leader, before you open anything: `/my` says "We can't find that page" and the Lead page has no strip.
4. Do steps 1 to 3 above, then open the Details Check and ask **one** appointed leader (use *A list of named people* and choose her). As her:
   - her Lead page has a strip, "Please check your details", and one button to **My page**;
   - My page asks "We have you down as … Is that right?" with four answers;
   - the message she got has **one button**, and nothing in it says her stage or her age;
   - from the message, signed out, the page shows **nothing about her** until she types a six-digit code sent to her own email;
   - **Yes, that is right** thanks her, and the run shows her answered.
5. As a leader whose tribe has members: choose **No, I want to change it** and another stage. She is told a pastor will look at it; nothing changes, and nobody is moved.
6. As a pastor of her centre: **Review → Stage changes** shows the request with the tribe's member count. **Approve** moves the tribe to the new stage and moves nobody; **Keep as it is** (with a note) leaves everything and the leader reads the note.
7. In God Mode → Features, **What has changed** lists each move in words.
8. As an administrator or a director: the Stage changes tab is read-only (only a pastor has the Approve button).

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `package.json`, `package-lock.json`: the Next.js 16.4.3 update, and two commands (`readers`, `messages-audit`).
- `src/components/god/GodNav.tsx`: *Features* and *Details check* tabs after *Exports*.
- `src/app/api/cron/tick/route.ts`: one more step, `worker_details_tick`. A fault in it is listed and never stops the messages after it (it is kept apart from the faults that decide the heartbeat's answer).
- `src/proxy.ts`: `/details` is a public path (the private link a leader opens; every fault gives the same plain "This link isn't working").
- `src/lib/messaging/templates.ts`, `templates-notices.ts`, `templates-leader-welcome.ts`, `types.ts`, `render.ts`, `providers/whatsapp.ts`: three new messages (the request, the reminder, the code), two new notices (`pastor_stage_review`, `coach_details_unanswered`), a URL button on a WhatsApp template, and the welcome email's "Confirm your details" line, which appears **only while the Details Check is On for that leader and their stage is unconfirmed**. While it is Off, the welcome email is word for word the one the pastor approved.
- `scripts/templates.ts`: leaves out messages that are email-only or that reuse another message's template (the code, the reminder), so Meta is asked about one.
- `src/app/(app)/lead/page.tsx`: the strip for a leader with something to confirm (not drawn at all when there is nothing, or My page is closed to them).
- `src/app/(app)/review/cards/[id]/page.tsx`: the stage banner beside a Tribe Card (drawn only while the Details Check is open for that leader).
- `src/app/(app)/review/*/page.tsx` (applications, interviews, academy, cards, ready-made cards, weekly report) and `src/components/leaders/PanelTabs.tsx`, `ReviewTabs.tsx`: the review tabs became one component so that a **Stage changes** tab can appear for a pastor or director once My page or the Details Check is open. With both Off the tabs are exactly as before.
- `src/app/(app)/god/appointments/page.tsx`, `src/components/god/AppointBoard.tsx`: the appointment form says the stage of life is a suggestion the leader will be asked to confirm, only while the Details Check is open.
- `e2e/dbkit.ts`: a journey can name a sign-in session (the owner's unlock is kept per session).
- `docs/GOD.md`, `NOTICES-ADMIN.md`, `RETENTION.md`, `README.md`, `scripts/rehearse-rollback.sh`: the new tabs, the two new notices (61 now), the retention of links and codes, the new guides, and the way-back rehearsal's list of new tests.

## Existing tests this package changes (all disclosed)

| Test | What changed, and why |
| --- | --- |
| `tests/db/foundation.test.ts` | The new function names are added to the lists of what signed-in people, and visitors with the sending service's token, may call (the allow-lists exist to be extended). |
| `tests/unit/messaging-hooks.test.ts` | One case added: the heartbeat runs the Details check's reminders and clean-up each beat, and a fault in it is listed and never causes a failure. |
| `tests/unit/notice-templates.test.ts` | The count of notices goes from 59 to 61 and the profiles migration is read with the others to see which notices the database queues. |
| `tests/unit/fixtures/message-params.ts` | Believable parameters for the new messages. |
| `scripts/rehearse-rollback.sh` | Not a test: the way-back rehearsal's list of new tests. |

New tests: `tests/db/profiles-switchboard.test.ts`, `profiles-facts.test.ts`, `profiles-details.test.ts`, `profiles-rollback.test.ts`, `fingerprint.test.ts`, `profile-readers.test.ts`; `tests/unit/features-switchboard.test.ts`, `profile-answers.test.ts`, `details-templates.test.ts`, `review-tabs.test.ts`, `messages-audit.test.ts`; the journey `e2e/journeys/36-profiles.ts`.

## Choices that differ from, or add to, what you approved

- **Stage 1 only**, as you chose. The Switchboard lists everything to come and cannot move it.
- **Open it for tribe leaders first.** The role filter exists for this; the first rule you set should be limited to the *Tribe leader* role.
- **One rule for each function in each place.** A rule limited to some roles *replaces* an unfiltered rule at the same place. To reach different roles at one place, set the rule once with all the roles.
- **The reminder reuses the request's Meta template**, so one template is approved for both.
- **The six-digit code goes by email or text, never WhatsApp**, because a link in a chat with a code beside it would be no second check.
- **The welcome email and the appointment form change only while the Details Check is open.**
- **"Opened" on a run can be a mail scanner or link preview**, not a person. "Answered" is what counts.
- **The audit of the platform's emails was rebuilt.** I could not recover the wording of the five earlier points you had in mind, so `docs/MESSAGES-AUDIT.md` (written by `npm run messages-audit`) checks every one of the platform's 139 messages from scratch: nothing unfilled, a subject on one line, a text under two messages, WhatsApp wording Meta can approve, every link https, and what queues each. **If you paste the five points, I will compare them.**
- **Every reader of a personal fact is written down** in `docs/PROFILE-READERS.md`, and a test fails if a new one is not.

## Not in this release

- **Stages 2 to 6**, each waiting for its own gate. Their switches exist and can only be Off.
- **The WhatsApp template is not submitted to Meta** (needs your credentials; step 3 of *Before you start*).
- **Members are not asked anything by default.** The age-range question is built and tested; use it once My page opens to members (stage 2).

## The way back

1. **Switch what you need Off**, or press **Pause every function**. Nothing more is asked, and links already made stop working. This is enough for almost any reason.
2. To take the feature out completely: restore the application files from the package you had before this one, then run, as the database owner:
   `supabase/rollback/20270101000100_profiles_stage1.down.sql`

   It drops the functions and the two triggers only. It leaves the tables and every row (what people confirmed and the log of switch changes are not lost); the last lines say how to drop the tables too. Running it twice changes nothing. The platform works afterwards exactly as it did before (a test runs it).

## What was checked, and what was not

Checked on a throwaway database built from the migration files, and in a test browser (Chromium):

- **Type check and lint**: clean.
- **Unit tests**: 83 files, 2,376 tests, all passing (88 more tests than before: the switchboard words and readers, the answer reader, the three messages, the audit of every message, the review tabs, and one heartbeat case).
- **Database tests**: 67 files, 1,901 tests, all passing (run in the daytime). 121 more than before: the switchboard and its rules (who may move a switch, the dependency order, the reason, the hold-back, the Master pause, unreadable means Off); the facts store and the four ways an answer ends; the Details Check from the plan to the private link, the code (ten minutes, five tries, a lock), the reminder and the call to a coach; the stage review; the way back; the reader inventory; and the fingerprint.
- **"Off means identical"**: a small church is built with the platform's own functions and read 40 ways (matching, tribe lists, rosters, dashboard, KPIs, reminders, readiness, exports). The readings with every switch Off are identical, character for character, to a recording made on the database before this release.
- **Seven deliberate breakages, each caught by the tests**: the welcome email's extra line ignoring its switch; the hold on a Tribe Card ignoring its switch; the Master pause ignored; anyone able to ask for a Details Check; the way back forgetting a function; the hold-back reaching a tribe of young people; the Details Check asking someone under 18.
- **Browser journey 36** (83 checks): everything Off and nothing found by a leader, a pastor or an administrator; a private link that was never made says so; the switchboard owner-only; the Details Check refused until My page is open; both opened for tribe leaders only; a rehearsal that sends nothing and shows no answers; a live run that cannot be made in Rehearsal and needs a tick; three links made, stored only as fingerprints; a leader with no sign-in sees nothing about herself until the six-digit code; a wrong code refused; "Yes, that is right" recorded; two leaders with members ask to change their stage and nobody is moved; the pastor approves one and keeps the other as it was, with a note the leader reads; the banner beside the Tribe Card; the Master pause and its undoing; and the new pages on a phone.
- **Older browser journeys** (the 11 that open pages this package touches: smoke, owner, switchboard, card templates, appointment, leader board, oversight, notices, admin menu, invitation email, exports): all pass.
- **The way back, rehearsed**: the original suite (958 tests) gives the same answer, test by test, on a database with the migration and its rollback file run as on one that never had them (958 pass on both).
- **The heartbeat**: a fault in the Details check's step is listed and never makes the whole heartbeat fail (this was found and fixed while building).
- **Two things found by the browser journey and fixed before this package**: My page showed a gap ("We have you down as {value}") instead of the leader's stage in its question, and the Features board said "Optional" for the hold on the Tribe Card on a fresh install instead of Off. Both now have tests.

One thing you may notice: **some older test files fail if you run the database tests between 10 pm and 6 am Lagos time** (the messaging and referee tests claim messages, and the platform sends nothing in those hours). They fail the same way before this package. Run them in the daytime and they pass.

**Not** checked: the WhatsApp template with Meta (not submitted; needs your credentials); a real phone or a screen reader; a real mailbox receiving the six-digit code (the test browser reads it from the message queue); timing on your own server and data (rehearse on a copy first, `docs/RELEASE.md`); that the owner's first live run reaches the people you expect: **use *A list of named people* for the first live run and read the counts before you send.**

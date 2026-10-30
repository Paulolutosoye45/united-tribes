# WhatsApp that cannot fail quietly, and leader removal requests: how to apply this package

This zip holds **only the files that changed** since the Profiles stage 2 package. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270102000100_profiles_stage2.sql`. **No new packages, no `npm ci`, and no new settings of yours for the site to start: the Meta settings below are added by you, on your hosting settings, when you are ready, and none of them is needed for this package to be safe.**

What it is, in one paragraph: the four stages of the blueprint *WhatsApp Reliability, Member Removal and a Compulsory WhatsApp Number*. It adds **four functions to the owner's Features page (God Mode), all Off**: the **WhatsApp safety net** (a pause for every WhatsApp message and an automatic pause when Meta refuses the church's account), the **WhatsApp health page** (what is wrong, in plain words, and a test message), **WhatsApp number required** (a compulsory number on the join form, with the WhatsApp yes kept separate) and **Leader removal requests** (a leader asks, a person with the right to decides, silence never removes). **Applying this package changes nothing for anyone until the owner moves a switch.** What each one does is in `docs/WHATSAPP.md` and `docs/REMOVAL-REQUESTS.md`.

**This package does not fix error 131030 by itself.** That error means the site is still sending through Meta's free test number, which can reach five phones only. The cure is to register the church's own number with Meta: `docs/WHATSAPP.md` has the steps, in order, and the health page then proves each one. That part is yours; nothing in this package needs your Meta token, and you should never paste it in a chat.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to submit to Meta for the removal feature.** Its three messages are email only and its notices go through the notice engine (their groups start Off, like every notice group). The health page's test message is **one new WhatsApp template** (`ut_whatsapp_test`, 57 in all); it is submitted with the others when you do the Meta activation, not now.
3. **Decide who tries it first.** The recommendation is **you, as the owner**, in Rehearsal where there is one, then the whole church (below). These four functions are for the whole church only: they cannot be opened for one person.

## Deploy, in this order

1. **Database**, four files, each once and in this order (`supabase db push`, or paste each in the SQL editor and press **Run**). Check after each:

   | File | What it adds | Check in the SQL editor |
   |---|---|---|
   | `supabase/migrations/20270103000100_whatsapp_safety.sql` | The safety net: the pause and its log, the watch on refusals, the whole-church-only kind of switch, the switch (Off) | `select count(*) from public.feature_registry;` returns `22` (it was 21). `select paused from public.whatsapp_guard;` returns `false`. |
   | `supabase/migrations/20270103000200_whatsapp_health.sql` | The health page: what Meta told the site, the last answer of the checks, the test message, the switch (Off) | `select count(*) from public.feature_registry;` returns `23`. `select count(*) from public.whatsapp_signals;` returns `0`. |
   | `supabase/migrations/20270103000300_number_required.sql` | The required number (`save_contact` now knows the rule), the "Not now" memory, the switch (Off) | `select count(*) from public.feature_registry;` returns `24`. `select count(*) from public.number_prompts;` returns `0`. |
   | `supabase/migrations/20270103000400_removal_requests.sql` | Removal requests: three tables, 19 functions, the two matching functions (one added line each), the switch (Off) | `select count(*) from public.feature_registry;` returns `25`. `select count(*) from public.removal_requests;` returns `0`. |

   After all four: `select count(*) from public.feature_settings where feature in ('whatsapp_guard','whatsapp_health','number_required','removal_requests');` returns `0` (no rule: all four Off). **Every new table has row-level security and no grants: the website reaches them only through functions.** **The golden recording of how matching, rosters, dashboards, reminders and exports answered, and the golden recording of every existing email, are unchanged**, and tests prove Off answers the same.
2. **Then the app**: deploy the website. Nothing else to set.

The website tolerates a database that does not have a migration yet (the Messages page, the join form and the leader's page simply do not draw the new parts), so the database and the app may be a minute apart. **Apply the migrations in order**: the last one replaces the two matching functions, and the third replaces `save_contact`.

## Meta, and the settings on your host (yours, when you are ready)

Follow `docs/WHATSAPP.md`, "Meta activation, step by step". The settings it asks you to put on your hosting provider are:

`WHATSAPP_PROVIDER` (`meta`), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (a token that never expires), `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_TEMPLATE_NAME` (the sign-in template). **Only you hold these; type them in your hosting settings and nowhere else.** The health page, once it is On, reports which of them are missing by name and never shows a value.

## Open it, one step at a time (God Mode → Features)

Each step is reversible by moving the same switch back to Off. The four are listed under "WhatsApp that cannot fail quietly" and "Joining a tribe, and leaving one". Only the owner can move them.

1. **WhatsApp safety net → Rehearsal.** It counts Meta's refusals and says when it *would* have paused; nothing is held back. Leave it a few days.
2. **WhatsApp safety net → On** (a reason of at least eight characters, kept in the log). The Messages page now has the pause button and the automatic pause.
3. **WhatsApp health → On.** The Messages page gets a link to the page. Press **Check now** and read it. This is how you check each Meta step.
4. **WhatsApp number required → On**, when you want the form to insist. Ask counsel to read the line that says why the number is asked for.
5. **Leader removal requests → Rehearsal.** Leaders see a form marked "Practice"; deciders can walk the road; nothing is released and nobody is written to. Tell the Care Team and the coaches before you open it, and use Rehearsal until they are comfortable.
6. **Leader removal requests → On.** Then switch on the notice groups you want (Admin → Notifications; they start Off), so the coach and the Care Team are told when a request arrives. `docs/NOTICES-ADMIN.md` lists the six new notices.
7. **If anything is wrong**: **Pause every function** (Features, top) makes every new function act as Off at once, and **Resume** brings every rule back. Moving one switch back to Off removes only that part. **Nothing anyone has written is lost either way.**

## Check it works (about forty minutes)

1. **With everything Off:** the Messages page has no WhatsApp card and no health link, the join form's phone number is optional and can be skipped, no member is asked for a number, and a leader's tribe page has no way to ask about a member's place. Nothing about WhatsApp sending has changed.
2. **Safety net:** in Rehearsal the card says "Rehearsal". On, press **Pause all WhatsApp messages** with a reason: the card says who and why, a message to a member who agreed to WhatsApp is sent by email, and nothing reaches Meta. **Restart** it: the next message goes to WhatsApp. (With the test number still in use, the first message is refused with 131030 and goes by email; five of them pause WhatsApp by itself and email the director and the admin. That is the net working.)
3. **Health page:** **Check now** shows each line good, needs-fixing or unknown, and says what to press. With the test number it says so in words and names 131030. **Send me a test message** needs your own number saved on your profile, and the template approved.
4. **Required number:** a new member on the contact step cannot go on without a number; "0800 000 0000" is refused as made up; a good number is shown back; the WhatsApp tick is not ticked for her. A member who joined without a number sees a gentle prompt on Home; "Not now" puts it away for a week. A leader sees how many in their tribe have none, by first name.
5. **Removal requests:** in Rehearsal, as a leader, ask about a member (a reason, 20 to 500 characters, "I have spoken to this person"); as the coach, **Growth → Removal requests** shows it with the tribe's attendance; approve it and see that **nothing** happened to the member's seat. Move to On with a test tribe and a test member: the approval releases the seat, the member reads on Home and **My tribe** that her place has changed (never the reason, never who asked), the leader is told, and the Care Lead can put the place back within 14 days.
6. **Features → Pause every function:** all four act as Off at once. **Resume**: they are back, with everything that was written.

## Way back

Run these as the database owner, **after putting the previous application files back**, and in this order (newest first). Each can be run alone for its own stage, and running one twice changes nothing:

1. `supabase/rollback/20270103000400_removal_requests.down.sql`: restores both matching functions exactly as they were, drops the functions, the three tables and the switch. **A seat that was released stays released.** The first lines say how to copy the requests first, if you want them for the record.
2. `supabase/rollback/20270103000300_number_required.down.sql`: restores `save_contact` exactly as it was; drops the prompt memory and the switch. **Numbers members saved stay.**
3. `supabase/rollback/20270103000200_whatsapp_health.down.sql`: drops the health page's functions and tables and the switch.
4. `supabase/rollback/20270103000100_whatsapp_safety.down.sql`: restores `message_channels` and `god_feature_board` exactly as they were; drops the pause, its log, the watch and the switch.

All four were rehearsed by `scripts/rehearse-rollback.sh`: a database with the stage applied and used goes back, the platform answers as before (the original tests give the same result as on a database that never had it), and applying it again works.

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `src/app/(app)/admin/messages/page.tsx`, `actions.ts`: the safety net's card and the link to the health page, drawn only while those switches are On.
- `src/app/(app)/admin/messages/whatsapp/*`: the new health page.
- `src/components/admin/SignInControls.tsx`: the button is now called "Turn WhatsApp sign-in codes off" (it always stopped sign-in codes only).
- `src/lib/messaging/providers/whatsapp.ts`: Meta's account-level refusals (an expired token, a test number, a payment problem) are now "give up on WhatsApp for this message", where before an expired token was an unknown error. The message still goes to the next channel.
- `src/lib/messaging/inbound.ts`, `src/app/api/webhooks/whatsapp/route.ts`: Meta's news about templates, number quality and the account is read and kept (90 days) while the health page is On.
- `src/lib/messaging/dispatch.ts`: the heartbeat also runs the removal reminders (a no-op while Off).
- `src/lib/messaging/templates*.ts`, `src/lib/messaging/contact.ts`, `number-rule*.ts`: three email-only removal messages, two email-only alarms, the test template, six notices, and the number rule. `docs/MESSAGES-AUDIT.md` and `docs/NOTICES-ADMIN.md` are regenerated.
- `src/app/(focus)/join/*`, `src/components/intake/*`, `src/lib/intake/*`: the contact step asks for the number only while the rule is On.
- `src/app/(app)/profile/*`, `src/components/profile/*`, `src/app/(app)/home/page.tsx`, `src/app/(app)/my/page.tsx`: the contact card, the "add your number" prompt and the two-numbers note, each drawn only while the rule is On; Home and My tribe show a removed member their notice for 30 days.
- `src/app/(app)/lead/page.tsx`, `src/app/(app)/lead/tribe/*`, `src/components/leaders/LeadingTribe.tsx`: the leader's count of missing numbers and the request form.
- `src/app/(app)/growth/*`, `src/lib/auth/roles.ts`, `src/components/removal/*`, `src/lib/removal/*`: the board for deciders.
- `src/components/god/FeaturesBoard.tsx`, `src/lib/features/*`: the four new switches on the owner's Features page, and the whole-church-only kind of switch.
- `docs/GOD.md`, `README.md`, `scripts/rehearse-rollback.sh`: the new sections, and the way-back rehearsal's list of new tests.
- Tests: `tests/db/messaging.test.ts` and `referee-trust.test.ts` (now independent of the hour they are run: the quiet-hours failures seen after 22:00 Lagos are gone), `notices-rollback.test.ts` (a feature built after the notices may drop the tables it made itself; a notice table is still held to "never dropped"), `foundation.test.ts` (new functions the app may call), `profiles-switchboard.test.ts`, the new tests below, and `e2e/journeys/17`, `36`, `39` (the switch counts and the button's name).

## What was checked, and what was not

**Checked, on the stand-in backend (a real Postgres with every migration, and a stand-in for Meta):**

- **Types and lint:** clean. **The production build** succeeds.
- **Unit tests:** 2,606 tests in 93 files pass.
- **Database tests:** 2,178 tests in 80 files pass, including the golden recordings (`tests/db/golden/fingerprint-v1.json` and `tests/unit/fixtures/email-golden.json` are not in this package because nothing in them changed). By stage, the tests of the stage and of its way back: safety net 25 and 9, health page 26 and 9, required number 24 and 9, removal requests 38 and 9. They give the same answer at any hour of the day.
- **The way back:** `scripts/rehearse-rollback.sh` ran the 958 original tests on a database that never had these stages and on one that had them and went back: 958 passed in both.
- **Browser journeys:** all 40 pass (2,252 checks) against the built site, on a phone and a computer. The new ones are 40 (removal requests, 43 checks), 41 (the WhatsApp pause, the health page, Meta's news and receipts, 43 checks) and 42 (the required number, 27 checks). 17, 36 and 39 were changed only for the new switch count and the button's new name.

**Not checked:**

- **Your Meta account.** Nothing here has been tried against a live WhatsApp account; the stand-in answers the way Meta's documentation says it does. The first real proof is the "Prove it, in this order" list in `docs/WHATSAPP.md`.
- A real phone or screen reader; a real inbox (the stand-in backend records messages); timing on your own hosting and data; nobody has used the new pages as a real member, leader or coach.
- **Wording that touches people's places.** The messages a removed member and a leader read are written to be kind and to reveal nothing; ask the Care Lead and counsel to read `docs/MESSAGES-AUDIT.md` before the function is turned On.
- Meta's wording for 131030: its error-code page does not list it; the meaning comes from Meta's Get Started page (five recipients) and two third-party references.

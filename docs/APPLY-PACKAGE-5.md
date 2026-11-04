# Package 5: Seats and contacts, the contact series and the tribe note (how to apply this package)

This zip holds **only the files that changed** since Package 4 (`united-tribes-package-4.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270110000100_leader_cards.sql` (Package 4). **No new settings, and nothing to add on your hosting for this one.** Nothing here goes to Meta: all three new messages are ordinary emails. **Both new functions start Off**, so nobody is written to until you move them.

**This package asks. It never moves, removes or replaces anyone.** The door, the 48-hour clock and replacement are Package 6; ending the series with a release is Package 7.

## What is in it

| | What | Read |
|---|---|---|
| **The series** | Four emails over six days (days 0, 2, 4, 5; the series closes on day 6) to each member who holds a seat and whom their leader cannot message on WhatsApp (no number, a number with no yes, or a made-up number). Each email carries a private one-minute page that needs no sign-in. The leader goes first: **Ask my members**, with a line of their own, and if they do nothing the church sends email 1 for them after 24 hours. | `docs/REACH-SERIES.md` |
| **The one-minute page** | Opening the link changes nothing. Add a number and tick WhatsApp, or one tick if a number is already saved, or use the number you sign in with (shown with its middle hidden, used only when pressed), or **Email me instead**. An old link says so and sends a new one. Works on a phone. | the same |
| **The leader's box** | **Reaching your tribe** on the Lead page: "1 of 5 can be messaged on WhatsApp", the first names still left and where each is, **Ask my members**, **I'll follow this up myself**, and **Write to my tribe**. | the same |
| **The tribe note** | One short email from a leader to their whole tribe, sent by the office in the leader's name, two a week at most per tribe. Members who still have a gap find an **Add my number** button under it. | the same |
| **The office** | **Contact gaps** gains **The contact series** (how many put it right, a count for each stage), a **Series** filter and column, **Pause the series for everyone** and **Stop** for one person (each with a reason), and two new columns in the download (still no phone numbers). | the same |
| **God Mode** | **Features** gains **The contact series settings**: the leader's head start (default 24 hours), the length (default 6 days), notes a week (default 2). Every change needs a reason and is logged. | the same |
| **"Yes, I'm in"** | A placed member with no number, or no yes, sees the same two optional boxes on the placement page. A number that does not look right stops the confirm, and the place waits. | the same |
| **Guides** | New **L10, Reach the members you cannot message on WhatsApp** (for leaders); an added part in **A3** for the office; a pointer in **M7**. | |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone.** Both functions start **Off**. A member sees nothing new, and a leader's Lead page is exactly as it was, until you switch them on.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270111000100_reach_series.sql`

   It adds six small tables (settings, who is in the series, each email sent, each private link, each leader's ask, each tribe note), fifteen functions behind the screens, two entries on the Switchboard (**Reach series** and **Tribe note**, both Off), and redefines four existing functions so they know about the series (`contact_ask_history`, `contact_ask_send`, `contact_gaps_report`, `contact_gaps_export`). No member, number, consent, seat, tribe or email is changed or deleted. The way back is `supabase/rollback/20270111000100_reach_series.down.sql`: it puts the four functions back exactly as they stood and drops everything it added. Put the application files back **before** running it.
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('tribe_reach','reach_ask_tribe','reach_follow_up','tribe_note_send','reach_series_pause','reach_series_stop','god_reach_settings','god_reach_settings_set','worker_reach_tick','worker_reach_info','worker_reach_save','worker_reach_email_instead','worker_reach_new_link','worker_placed_reach','worker_placed_reach_save');` returns `15`, and `select key, default_mode from public.feature_registry where key in ('reach_series','tribe_note');` returns two rows, both `off`.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, every screen still works as it did (the new boxes simply do not appear), the private page says "This link isn't valid", and the heartbeat lists "reach series" among its problems for each beat until the file is run.

## Switch it on (a suggestion, in this order)

You do not need to decide this today; it is the order I would use.

1. **Contact gaps** must be **On** first (it is the list the series reads). Check it already is: **God Mode → Features**.
2. **Reach series → Rehearsal**, for the whole church, with a reason. Nothing is sent. Within a few minutes **Admin → People → Contact gaps** shows, in the **Series** column, who would have been asked. Read the list once. If the numbers look wrong, stop here and tell me.
3. **Reach series → On** for **one tribe** first (choose **One tribe** in the switch, and your own test tribe or a friendly leader's). Ask the leader to press **Ask my members**. Open the emails in the test inbox and the private page on a phone.
4. **Reach series → On for the whole church**, and **Tribe note → On**.

Joining closes on **Sunday 15 November**. Switching the series on by **Friday 6 November** means every email has gone, and the series has closed, before then.

## Check it works (fifteen minutes)

1. With **Reach series** On for one tribe: sign in as that tribe's leader. **Lead → Who has joined** shows **Reaching your tribe**: "x of y can be messaged on WhatsApp", the first names left and **Not asked yet** under each. **Ask my members** opens a panel that says how many will be emailed. Add a line, press the button. It says "Done. n members have been emailed."
2. At the next heartbeat (give it five minutes) each of those members gets one email from the church in the leader's name. Subject: "Lara would like to message you on WhatsApp". The leader's line is in quotes. There is **no phone number** in it.
3. Open the link from one email **on a phone, signed out**. The page greets the member by name, and the WhatsApp box is **not ticked**. Opening it saved nothing. Type a made-up number such as `12345`: it says it does not look right, and nothing is saved. Type a real number, tick the box, press **Save**: "Thank you… can now reach you on WhatsApp".
4. Back on **Lead**: that person is off the list, the count has gone up by one. Press **I'll follow this up myself** beside someone else: their line says **You are following up**, and the button is gone.
5. **Write to my tribe**: type two lines, press **Send the note**. Everyone who can be emailed gets it; only those who still have a gap see an **Add my number** button.
6. **Admin → People → Contact gaps**: **The contact series** shows how many put it right and a count for each stage. Press a stage: the list narrows. Try **Pause the series for everyone**: it will not work without a reason. Give one, then **Resume the series**. Press **Stop** beside one person, give a reason: their line says **Stopped by the office**. **Download** the list: it has **Contact series** and **Series emails sent** and no phone number.
7. **God Mode → Features → The contact series settings**: change **Hours the leader has** and the Save button stays grey until you give a reason.
8. Place a test member by hand (or use an auto-placed one), open their **Yes, I'm in** page from the email: it offers the two boxes, marked optional. A bad number stops the confirm; a good number saves first, then confirms.

## Things to know

- **The heartbeat must run every few minutes,** as for every other scheduled thing. The series sends only between **9 am and 7 pm Lagos time**, so a heartbeat that only runs once a day, early, would never reach the window. If it already runs every five minutes (the GitHub `Heartbeat` workflow, or Vercel Pro), there is nothing to do. See `docs/OPERATIONS.md`.
- **Reply-To is the church's address,** as for every message from the office. A member who replies writes to the office, not to the leader. This is a deliberate privacy choice: a leader's address is never given out. Tell me if you want replies to go to the leader instead.
- **One series for a person in a season.** Someone who chose **Email me instead**, or who put it right and later lost it again, is not started again this season. The office can stop a series; it cannot restart one in this version.
- **The Master pause, an open care follow-up, and a leader's "I'll follow this up myself" all freeze the series,** and it resumes with exactly the days it had left. An email more than two days late is not sent late: the series moves on by the days lost, so nobody gets four emails in a day.
- **Nobody under 18, nobody with a deletion request open, nobody whose seat is waiting for a reply to a placement, and nobody whose address bounces** is in the series. A person whose address bounces is listed **Not reached**, for a phone call.
- **The end of the series does nothing in this version.** After day 6 it writes down what happened (fixed, chose email, seen but not done, silent, not reached) for the office list, and the leader's box keeps showing who is left. Releasing a seat comes in Package 7, and will have its own switch.
- **The ordinary-number route is never used for bulk messages** (decision 19). The new messages are email only; they are never put to Meta for approval.
- **The tribe note is capped** at 600 characters, no links, and two a week for each tribe. You can change the weekly number (1 to 4) in God Mode.
- **Who sees the box.** The tribe's leader, their assistant leader and their coach can all read it. The leader and the assistant can press **Ask my members**, **I'll follow this up myself** and **Send the note**; the coach can read only.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **Lead page:** `src/app/(app)/lead/page.tsx`, `src/app/(app)/lead/reach-actions.ts`, `src/components/leaders/LeadingTribe.tsx`. New: `src/components/leaders/ReachStrip.tsx`.
- **The private page:** new `src/app/(public)/add-number/[token]/page.tsx` and `actions.ts`; `src/proxy.ts` (the page opens without sign-in).
- **The placement page:** `src/app/(public)/placed/[token]/page.tsx` and `actions.ts` (the two optional boxes).
- **Contact gaps:** `src/app/(app)/admin/people/contact-gaps/page.tsx`; `src/lib/contact-gaps/gaps.ts` and `server.ts`; `src/components/profile/ContactCard.tsx` (one button's word list renamed). New: `.../contact-gaps/actions.ts`, `src/components/contact-gaps/SeriesControls.tsx`.
- **God Mode:** `src/app/(app)/god/features/page.tsx` and `actions.ts`; `src/lib/features/server.ts` and `types.ts`. New: `src/components/god/ReachSettingsCard.tsx`.
- **Heartbeat:** `src/app/api/cron/tick/route.ts` (one new step, before the messages go out; a fault in it is listed and never stops the beat).
- **Email:** `src/lib/messaging/templates.ts` (registers three new emails). New: `src/lib/messaging/templates-reach-series.ts`.
- **Words and parsing:** new `src/lib/reach/series.ts` and `server.ts`.
- **Guides:** `src/lib/guides/catalogue.ts`, `context.ts`, `content/be-reached.ts`, `content/contact-gaps.ts`. New: `content/reach-your-tribe.ts` (no pictures, because the box starts Off).
- **Docs:** `docs/MESSAGES-AUDIT.md` (regenerated: three more messages, 161 in all). New: `docs/REACH-SERIES.md`, this file.

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: the new screen functions are added to the list the app may call, and the heartbeat's and private page's functions to the list only the sending service may call. Nothing checks less than before.
- `tests/db/contact-gaps.test.ts`: the report function takes one more optional filter, and the download has two more columns; the assertions say so.
- `tests/unit/features-switchboard.test.ts`: the list of functions, in order, gains the two new ones at the end.
- `tests/unit/messaging-hooks.test.ts`: one test added for the new heartbeat step.
- `e2e/journeys/36-profiles.ts` and `39-my-page-for-everyone.ts`: the number of functions that can be moved goes from thirteen to fifteen.
- `tests/unit/fixtures/message-params.ts`: the three new emails' sample fields.
- `scripts/rehearse-rollback.sh`: the two new test files are on the list of new tests.
- New tests: `tests/db/reach-series.test.ts` (57), `tests/db/reach-series-rollback.test.ts` (7), `tests/unit/reach-series.test.ts` (34), and the journey `e2e/journeys/50-reach-series.ts` (67 checks).
- No existing rollback test, email golden file or other test changed.

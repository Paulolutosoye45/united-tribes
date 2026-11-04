# Package 4: Leader cards (where every leader's Tribe Card is, and a kind way to chase it) (how to apply this package)

This zip holds **only the files that changed** since Package 3 (`united-tribes-package-3.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270109000100_office_placement.sql` (Package 3). No new packages. **No new settings, and nothing to add on your hosting for this one.** Nothing here goes to Meta: every message it sends is an ordinary email, and the reminders **start Off**.

## What is in it

| | What | Read |
|---|---|---|
| **Fix 5** | **Delivery status for every leader.** For each leader: did the email with their link arrive (and if not, why, and the address it went to), have they signed in, and when did they last do something. A **Send the email again** button for one leader or for everyone it did not reach. | `docs/LEADER-CARDS.md` |
| **Fix 4** | **The card board, the reminders, the call sheet, the audience.** One card for each leader showing where their Tribe Card is (Not started, In progress, Changes asked for, Sent in, Approved); filters and counts; a department tag; a **list for the heads of department** (no numbers, no addresses) and a **call sheet** (with them); reminders on **Thursday, Friday and Saturday**; and a new Announcements audience, **Leaders whose Tribe Card is not finished**. | the same |
| **Fix 6, the rest** | **The browser journey for the emailed link.** Signed out, the link takes a leader to sign in and brings them to their Tribe Card after an email code or a WhatsApp code; the wrong account is told whose it is and why the page is not theirs. (The explanation page itself was already in the app.) Proved in a browser, including filling the card in on a phone and sending it. | `docs/LEADER-CARDS.md` |
| | **Sending and email** lists the leaders whose email did not arrive. **Contact gaps** now says why its "Write to the people who can be asked" button can be hidden. A guide: **A5, See where every leader's Tribe Card is, and chase it kindly**. | |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone.** The page is new, and it only reads. The reminders start **Off**, so no leader is written to until you move them.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270110000100_leader_cards.sql`

   It adds three small tables (the department each leader serves in, the reminder setting, and a log of what was sent), fourteen functions behind the screens, and redefines two (`audience_clean`, `audience_base`) so Announcements knows the new audience. No member, number, consent, seat, tribe, card or email is changed or deleted. The way back is `supabase/rollback/20270110000100_leader_cards.down.sql`: it puts the two functions back exactly as they stood and drops everything it added. Put the application files back **before** running it.
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('leader_cards_board','leader_card_department_set','leader_cards_resend','leader_cards_failures','leader_cards_sheet','leader_card_reminders_get','leader_card_reminders_set','worker_leader_card_reminders');` returns `8`, and `select reminder_mode from public.leader_card_settings;` returns `off`.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, the new page says "This page is not available yet", the heartbeat lists "leader card reminders" among its problems for each beat until the file is run, and everything else works as before.

## Check it works (ten minutes)

1. **Admin → People → Leader cards.** The headline says how many cards are not finished ("7 of 31 cards are not finished"), with the counts beneath. Press **Email did not arrive**: the leaders whose email failed are listed with the reason the email service gave and the address it went to. **Never signed in** lists those who have never opened the link.
2. On one leader (use someone you are happy to write to, or a test leader), press **Send the email again**. The page says "1 email is on its way". The leader gets one short note that says where their card is and has one button. Press it again the same day: it says nothing was sent and why.
3. Type **Ushers** in the **Department** box beside one leader and press **Save**. Choose that department in the filter: only that leader is shown.
4. Press **Download the list for the heads of department** and open it: names, tribes and where each card is; **no numbers and no addresses**. Press **Download the call sheet** and open it: the same, with the phone, the email and whether they said yes to WhatsApp.
5. **Reminders** (under the board). It says Off. Move it to **Rehearsal**, give a reason, and keep **Thursday, Friday and Saturday** at **9 am**. Nothing is sent: from Thursday the page says how many leaders it **would have** written to this week. Move it to **On** only when you are happy with that number.
6. **Admin → System → Sending and email**: a section, **Leaders who did not get their Tribe Card email**, with the same names.
7. **Admin → Announcements → Write**: **Who is this for?** has **Leaders whose Tribe Card is not finished**, and counts who would get it. Do not send it unless you mean to.
8. Open a leader's emailed link in a browser where nobody is signed in: it asks them to sign in and, once they have, brings them to their Tribe Card (with an email code or a WhatsApp code). Open it as someone who is not a leader: it says whose account they are in and why the page is not theirs, and offers to sign out.

## Things to know

- **The reminders need the heartbeat to run every few minutes.** They go out at the first beat after the chosen hour (9 am, Lagos time, by default) on the chosen days. If the site is on Vercel's free **Hobby** plan, which allows one scheduled run a day, `vercel.json`'s every-five-minutes schedule is refused and a daily beat early in the morning would never reach the 9 am window. Use the GitHub heartbeat described in `docs/OPERATIONS.md` (the `Heartbeat` workflow, with the `SITE_URL` variable and the `CRON_SECRET` secret), or Vercel Pro. If your heartbeat is already every five minutes, there is nothing to do. **Send the email again** works at once whatever your heartbeat is, though it goes out at the next beat.
- **The reminders are their own setting on this page,** not a Switchboard function and not a fifth journey in Automatic reminders. They honour the **Master pause**: while it is on, nothing goes. They also stay inside the quiet hours, never go to someone who opted out of reminders, whose address bounces or who has an open deletion request, and stop the moment a card is sent in or approved.
- **The wording of the reminder is fixed.** It is one short, kind note ("A pastor reviews your card before members can see your tribe… If something is in the way, tell the church office"). It never says the leader is late and never gives a deadline. It is not editable in Automatic reminders; tell me if you want it to be.
- **Limits that cannot be passed from the page:** never to a leader who has sent their card in; at most **three** resends to one leader; at most **one** email a day to one tribe (Send again and the reminder share the day); at most **12** reminders in all to one leader.
- **Heads of department are not platform users yet** (that is fix 7). Until then, their list is the downloadable one: filter by department, download, and send it to them yourself. It never holds a number or an address.
- **The board has no row on the Today page.** It is under People.
- **WhatsApp by hand.** On a leader whose email failed and whose number the church may use, **Message Ben on WhatsApp** opens an ordinary chat with a prepared note, then asks "Did you send it?" so the by-hand list stays true. It sends nothing by itself. The ordinary-number route is still never used for bulk messages (decision 19).
- **The Foundation of Faith** is not touched by this package. If you want leaders to be able to send a card without it, that is your own setting: **Admin → Leader pipeline → Foundation of Faith → Optional**.
- **The data lead can read the board and download the list for the heads of department.** The data lead cannot send, tag, see an address or download the call sheet.
- **The care lead has no access to this page.** Tell me if you want it.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **Office:** `src/lib/admin/nav.ts` (the new page, in People), `src/lib/auth/roles.ts` (two role lists). New: `src/app/(app)/admin/people/leader-cards/page.tsx`, `actions.ts` and `download/route.ts`; `src/components/leader-cards/LeaderCardsBoard.tsx` and `ReminderControl.tsx`; `src/lib/leader-cards/cards.ts` and `server.ts`.
- **Heartbeat:** `src/app/api/cron/tick/route.ts` (one new step, before the messages go out; a fault in it is listed and never stops the beat).
- **Sending and email:** `src/app/(app)/admin/system/page.tsx` (the new section).
- **Contact gaps:** `src/app/(app)/admin/people/contact-gaps/page.tsx` (a line saying why the button can be hidden) and `docs/APPLY-CONTACT-GAPS.md` (step 3 corrected: the button is on the Contact gaps page, only when On, for an admin, a director or a pastor).
- **Announcements:** `src/lib/outreach/labels.ts` (the audience).
- **Email:** `src/lib/messaging/templates.ts` (registers the one new email). New: `src/lib/messaging/templates-leader-cards.ts`.
- **Guides:** `src/lib/guides/catalogue.ts` and `context.ts`. New: `src/lib/guides/content/leader-cards.ts` (the guide has no pictures of the reminders, because they start Off).
- **Docs:** `docs/MESSAGES-AUDIT.md` (regenerated: one more message, 158 in all). New: `docs/LEADER-CARDS.md`, this file.

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: the seven new screen functions are added to the list the app may call, and the heartbeat's function to the list of those only the sending service may call. Nothing checks less than before.
- `tests/db/shim.sql`: the test stand-in for `auth.users` gains `last_sign_in_at`, as the real one has.
- `tests/unit/admin-nav.test.ts`: the Admin menu now has 31 pages (was 30).
- `tests/unit/messaging-hooks.test.ts`: one test added for the new heartbeat step.
- `tests/unit/fixtures/message-params.ts`: the new email's sample fields.
- `e2e/journeys/29-admin-menu.ts`: the page counts each go up by one.
- `scripts/rehearse-rollback.sh`: the two new test files are on the list of new tests.
- New tests: `tests/db/leader-cards.test.ts` (45), `tests/db/leader-cards-rollback.test.ts` (7), `tests/unit/leader-cards.test.ts` (55), and the journeys `e2e/journeys/48-leader-card-link.ts` and `49-leader-cards-board.ts`.
- No existing rollback test, email golden file or other test changed.

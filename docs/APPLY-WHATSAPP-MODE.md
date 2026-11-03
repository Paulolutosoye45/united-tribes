# WhatsApp mode (Full, Saver, Free), the cost page and WhatsApp sent by people (how to apply this package)

This zip holds **only the files that changed** since the placement package (`united-tribes-inseason-placement.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Apply the placement package first: this one assumes everything up to and including `20270104000100_inseason_placement.sql`. No new packages and no new settings.

## What was wrong

| # | What was wrong |
| --- | --- |
| 1 | **Every WhatsApp message the site sent through Meta was charged,** and the church could not choose how much to spend. The only ways to stop were to pause WhatsApp altogether or to send from an ordinary number by hand, which can get a number blocked. |
| 2 | **There was no way to see what WhatsApp was costing** or to be warned before the month's bill was a surprise. |
| 3 | **Nothing protected the sending number** from the things that get a number rated Low and then limited: too many messages to one person, too many in an hour, messages at night, messages Meta had refiled as Marketing. |
| 4 | **There was nothing to help a leader send WhatsApp themselves** when the church chooses not to send it from the site. |

## What it does

- **A new function on the Switchboard, "WhatsApp mode"** (God Mode → Features). It starts Off, is for the whole church only, and needs the WhatsApp safety net to be On. Off, nothing here runs and the site behaves exactly as it did.
- **Three modes, chosen at Admin → Messages → WhatsApp mode** by the admin, a director or the data lead, with a reason that goes in the log:
  - **Full:** as before.
  - **Saver:** only the messages that must reach go by WhatsApp. The weekly rhythm and everything else go by email, unless the person has no other way to be reached.
  - **Free:** **nothing goes through Meta.** Every automatic message goes by email or text. The website makes no request to Meta at all: not for messages, not for sign-in codes over the official route, not for the health checks. WhatsApp is what people send from their own phones.
- **Send by WhatsApp, for leaders** (Lead → This week → **Send by WhatsApp**): post the week's words to the tribe's WhatsApp group (copy, then the group opens on the leader's phone), and message a member who said yes to WhatsApp (WhatsApp opens on the leader's phone with the words ready). The leader never sees a number. Nothing is sent from the website; what is logged is that it was opened, the kind of message, and whether the leader says they sent it or left it. **Never what was written.**
- **Message a leader by hand, for the office** (Admin → Messages): the same, for leaders, assistants and coaches who said yes to WhatsApp.
- **The cost page** lists the last 7 and 30 days by message type, with an estimate of the cost from rates you type in from Meta's rate card, the share Meta has filed as the dearer Marketing category, and what Saver or Free would have saved on your own last seven days.
- **A monthly ceiling** (optional): an email at the warning percentage, and at the ceiling Full drops to Saver by itself, once a month.
- **Protections for the number:** Marketing messages go by email; no more than two WhatsApp messages a week to one person; a 9 am to 7 pm window for the weekly rhythm; 300 an hour; stop short of the daily limit of different people. If Meta rates the number Medium, Full drops to Saver by itself; if it rates it Low, WhatsApp pauses itself. Every number can be changed on the page.
- **Two short guides** appear in the app's help: for the office (*Choose how the church uses WhatsApp, and what it costs*) and for leaders (*Send WhatsApp to your tribe yourself*).

What stays exactly as it is: a member's channel choice, the consent rules, the wording of every message, the pause, and how sign-in codes choose their route.

## What it cannot undo

Messages already sent stay sent. A mode change is a setting, not a deletion: choose Full again and the next message goes by WhatsApp. The log of mode changes and of what people sent by hand stays until the database file is rolled back.

## Things to know

- **"Free" means this website sends nothing to Meta. It cannot change what is already on your Meta account.** If your Meta account has other charges (a number rented from another provider, or messages sent from another tool), those are not affected.
- **Sign-in by WhatsApp.** In Free mode the official WhatsApp sign-in code is not sent. People sign in by email, or by the ordinary-number route if you have it linked. I did not extend the ordinary-number route to anything else: it stays for a person's own sign-in code, because sending bulk messages that way is what gets a number blocked.
- **The test message and the account check** are stopped in Free (they would be the website asking Meta). The health page says so. Choose Saver or Full to try the account.
- **Do not run `scripts/templates.ts` in Free mode.** It is a script you run by hand that sends the message wordings to Meta.
- **A member reachable only by WhatsApp** (no email or text we may use) cannot be sent anything in Free mode. The message says "send this one by hand", and the leader's Send by WhatsApp page names the member at the top.
- **The cost figures are estimates** from the rates you type in. The two starting rates are third-party figures for Nigeria and err high. Meta's invoice is the only true figure. Whether the church qualifies for a nonprofit rate is a question for Meta.
- **If the website cannot read the mode** (the database is unreachable), it does not speak to Meta and tries again in ten minutes. If the database has no WhatsApp mode at all (this package not applied yet), it behaves as before.
- **Your Meta settings stay where they are,** on your hosting provider. This package changes none of them and needs none of them from you. Never send them to anyone, including me.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone. Members are never told which mode is chosen; they get the same words by a channel they agreed to.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270105000100_whatsapp_mode.sql`

   It adds 26 functions, six tables, one index and one Switchboard function, and redefines five functions (`message_channels`, `worker_claim`, `worker_whatsapp_signal`, `whatsapp_check_save`, `whatsapp_test_send`). No member, message, consent or channel choice is changed or deleted. The way back is `supabase/rollback/20270105000100_whatsapp_mode.down.sql`.
2. **Check**, in the SQL editor: `select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('whatsapp_mode_now','whatsapp_class','whatsapp_rate','whatsapp_month_start','whatsapp_month_estimate','whatsapp_mode_alert','whatsapp_mode_quality','whatsapp_mode_facts','whatsapp_pressure','whatsapp_resume_at','worker_whatsapp_tick','worker_whatsapp_allowed','worker_whatsapp_marketing','whatsapp_by_name','whatsapp_mode_overview','whatsapp_cost_report','whatsapp_mode_set','whatsapp_mode_settings','whatsapp_class_set','whatsapp_rate_add','hand_can','hand_context','hand_open','hand_group','hand_mark','hand_staff_list');` returns `26`.
3. **Then the app**: deploy the website. Nothing else to set.

Run the database file **first**. The website tolerates the old database (it behaves as before), but the new pages and the Free-mode gate need the new functions.

## Turn it on (five minutes)

1. **God Mode → Features:** make sure **WhatsApp safety net** is **On**, then open **WhatsApp mode** and set it **On** (it needs a reason).
2. **Admin → Messages → WhatsApp mode.** The top line says which mode is in force. Read **What each mode would have done to the last seven days**, then press **Free**, write why, and press **Use Free**.
3. Open **The cost page**. In Free it says nothing is being paid to Meta.
4. Open a leader's **This week**: **Send by WhatsApp** is there. Check the group link is saved on the leader's Tribe page, or the page says where to add it.

To go back, choose **Full** (or **Saver**) the same way.

## Check it works

1. Choose Free. Queue any message for a member who agreed to WhatsApp and to email (for example from **Admin → Messages**): it goes by email, and the **Message log** shows the channel as email.
2. As a leader, open **Send by WhatsApp** on a phone: **Copy and open the group** opens the group and asks whether you sent it. Press a member's name: WhatsApp opens with the words ready. No number appears on the page.
3. As the office, open **Message a leader by hand** and do the same for a leader.
4. Choose Full: the next message goes by WhatsApp again.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **The gate:** `src/lib/messaging/dispatch.ts`, `src/app/api/cron/tick/route.ts`, `src/app/api/auth/send-code/route.ts`, `src/lib/signin/deps.ts`, `src/lib/whatsapp/health.ts`, `src/lib/whatsapp/names.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `src/app/(app)/admin/messages/whatsapp/actions.ts`, `src/lib/messaging/templates-whatsapp.ts` (one new internal alert email). New: `src/lib/whatsapp/mode.ts`, `classes.ts`, `mode-view.ts`, `mode-server.ts`, `hand-text.ts`.
- **Pages:** new `admin/messages/whatsapp-mode`, `admin/messages/whatsapp-cost`, `admin/messages/by-hand`, `lead/hand` with their components (`WhatsAppMode`, `WhatsAppCost`, `HandStaff`, `SendByHand`). Changed: `src/app/(app)/admin/messages/page.tsx` (a link when the function is On), `src/components/rhythm/LeaderWeek.tsx` and `src/app/(app)/lead/week/page.tsx` (the Send by WhatsApp button).
- **Help:** two new guides (`whatsapp-mode`, `send-by-whatsapp`), `src/lib/guides/catalogue.ts` and `context.ts` (which page shows which guide). They have no pictures: the screens only exist once the owner opens the function.
- **The Switchboard's list of names:** `src/lib/features/types.ts` gains `whatsapp_mode`, so the Features page lists it.
- **Profile readers list:** `src/lib/profile/registry.ts` and `docs/PROFILE-READERS.md` (two files that mention a person's name or the word birthday are listed, like every other one: the Send-by-WhatsApp page signs with the leader's first name, and the class list names the two birthday messages).
- **Docs and scripts:** `docs/WHATSAPP-MODES.md`, this file, `docs/WHATSAPP.md` (a pointer), `docs/MESSAGES-AUDIT.md` (regenerated: 153 messages, one more internal alert), `scripts/rehearse-rollback.sh` (the new tests are in the rollback rehearsal).

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: the eleven office and leader functions are added to the list of functions a signed-in person may call, and the three sending-service functions to the two lists that name them (the sending service has no account; its token is the credential). Nothing checks less than before.
- `tests/unit/whatsapp.test.ts`: the order of calls in the sign-in route changed on purpose. The route now asks the database whether it may speak to Meta only after the request's signature is verified, so a stranger's request costs no database call. The test asserts the new order.
- `tests/unit/whatsapp-faults.test.ts`: the list of the office's WhatsApp alert emails now ends with the new `whatsapp_mode_alert` (email only, like the other two alarms).
- `tests/unit/features-switchboard.test.ts`: the expected order of the Switchboard's functions ends with `whatsapp_mode`.
- `e2e/journeys/36-profiles.ts` and `e2e/journeys/39-my-page-for-everyone.ts`: each counted the functions the owner can move on the Features page (eleven); there are now twelve, with WhatsApp mode.
- No existing rollback test, email golden file or other test changed.

New tests: `tests/db/whatsapp-mode.test.ts` (47 tests), `tests/db/whatsapp-mode-rollback.test.ts` (9), `tests/unit/whatsapp-mode.test.ts` (21, including: with a `fetch` that throws if called, Free mode makes no call to Meta for member messages, the sign-in sender or the health checks), `tests/unit/whatsapp-mode-routes.test.ts` (7), and a browser journey, `e2e/journeys/45-whatsapp-mode.ts` (29 checks).

## What was not checked

- **Meta itself.** Nothing was sent to the real Meta. The stand-in answers like Meta's documented API, so Meta's real quality ratings, categories, limits and prices can only be seen on your account.
- **The price.** The cost figures are estimates; only Meta's invoice is the real cost.
- **WhatsApp opening on a phone.** The journey checked that the page opens the link and logs it; it did not open the WhatsApp app.
- **Your live database.** I cannot read it, so I have not seen your members' consents or your tribes' group links. A tribe with no group link saved shows where to add one.

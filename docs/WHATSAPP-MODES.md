# WhatsApp mode: Full, Saver and Free, what each costs, and WhatsApp sent by people

This is the design of the **WhatsApp mode** function: what it does, what it never does, and how each part was checked. How to apply it is in `APPLY-WHATSAPP-MODE.md`. It sits on top of the safety net and the health page (`WHATSAPP.md`) and reuses their pause and alarm.

## The problem

WhatsApp Business messages that the site sends through Meta are charged per message, by category (Utility or Marketing), and the church pays by the month. The church had found it could send the same message from an ordinary number instead and not be charged, but that route can get a number blocked and it is not safe to use for bulk messages. Two questions followed: can the church choose how much it spends, and can the number be kept from being blocked?

## What it is

One function on the Switchboard (**God Mode → Features → WhatsApp mode**), for the whole church only, Off until the owner opens it. It needs the WhatsApp safety net to be On. When it is On, the admin, a director or the data lead chooses one of three modes at **Admin → Messages → WhatsApp mode**. The choice takes effect on the next message: no redeploy, nothing lost.

| Mode | What goes through Meta | What the member gets |
| --- | --- | --- |
| **Full** | Everything that can go by WhatsApp, as before | The same as today |
| **Saver** | Only the messages that must reach (class A) | The weekly rhythm and everything else by email; a person with no other channel still gets it by WhatsApp |
| **Free** | **Nothing at all** | Every automatic message by email (or text); WhatsApp from a real person, sent by hand |

Members are never told which mode is chosen. They get the same words, by a channel they agreed to.

## Free mode: what "I pay Meta nothing" has to mean

Choosing Free only helps if no road from the website to Meta stays open. These were each closed and each is tested:

1. **Member messages.** The outbox leaves WhatsApp out of every message's channel list (`message_channels`), the office test message included.
2. **The sender.** Before any call to Meta, the website asks the database whether it may (`worker_whatsapp_allowed`). In Free the answer is no and the call is never made. A message that reached the sender anyway is turned back so the database can move it to the next channel the person agreed to, or list it to be sent by hand.
3. **Sign-in codes over the official route.** The website refuses to send them through Meta in Free mode and says so. Sign-in by email, and by the ordinary-number route that is already linked, keep working.
4. **The health checks.** The Meta account check, the template list and the test message are all stopped in Free. The health page says the account is not being checked, rather than showing a stale answer.

The rule behind the gate is that it can never cost anything: if the database cannot say (it is unreachable, or refuses the token), the website does not speak to Meta and tries again in ten minutes. Only a database that has no WhatsApp mode at all (the package is not applied yet) is allowed, so the site works as it always did.

**Decision 19 stays.** The ordinary-number route is for the person's own sign-in code only. It is not extended to bulk or automatic messages. In Free mode the church's automatic messages go by email, and WhatsApp is what people send from their own phones.

### WhatsApp sent by people

- **A leader** opens **Lead → This week → Send by WhatsApp**. They choose what to post to their tribe's group (the week's passage and step, a meeting reminder, a thank-you, or their own words), change the words, press **Copy and open the group**, paste and send. For a member who said yes to WhatsApp and whose details are open to the leader (the same rule as the leader's list), they choose what to say and press the member's name: WhatsApp opens on their own phone with the words ready. The page never shows a number; it is inside the link only.
- **The office** opens **Admin → Messages → Message a leader by hand** and does the same for leaders, assistants and coaches who said yes to WhatsApp.
- **What is logged** is that the page was opened, the kind of message, the tribe, who did it, and whether they then said they sent it or left it. **Never what was written.**
- **Members the site could not reach.** In Free mode a member who agreed to WhatsApp only, and has no email or text we may use, cannot be sent anything. The message is marked "send this one by hand" and the leader's page names the member at the top.

## Saver and the classes

Every message type that can go by WhatsApp has a class the director can change (**WhatsApp mode → Which messages must reach**). The starting list is in `src/lib/whatsapp/classes.ts` and the migration:

- **A, must reach (8):** a swap offered, an urgent care alert, an overdue care task, the details check and its reminder, a referee's code, a guardian's request, and the test message.
- **B, the weekly rhythm (33):** welcome, week start, meeting reminders and recaps, the Friday check-in, missed-meeting messages, birthdays, the leaders' and coaches' weekly messages, and similar.
- **C, everything else (17):** applications, leader checks, referee requests, reports and guardian updates.

A message type the table does not know is class A, so it stays on WhatsApp, as it does today. In Saver, B and C go by email **if the person has another channel they agreed to**; nobody is left out.

## Keeping the number from being blocked

These apply in Full and Saver (in Free nothing is sent, so there is nothing to protect). The numbers are on the mode page and can be changed there.

| Protection | Default | What it does |
| --- | --- | --- |
| Marketing guard | on | A message whose wording Meta has refiled as Marketing (about five times the price) goes by email instead. Filled by the health check and by Meta's own notice. |
| Weekly cap | 2 messages a week to one person | A third message that week goes by email. Class A is never counted or held. |
| Sending window | 9 am to 7 pm Lagos time | The weekly rhythm waits for 9 am. The messages that must reach are never held. |
| Pace | 300 an hour | When the hour is full, the next messages wait for the next hour. |
| Reach | 80% of the number's daily limit of different people | When it is reached, the next messages wait until 9 am tomorrow. |
| Quality guard | on | If Meta rates the number **Medium**, Full drops to Saver by itself. If it rates it **Low**, WhatsApp pauses itself through the safety net. A person puts it back. |

## What it costs, and how it is shown

- **The cost page** (**Admin → Messages → WhatsApp mode → The cost page**) lists the last 7 and 30 days by message type: how many were sent, about what each cost, and how much of it Meta has filed as Marketing. In Free it says nothing is being paid to Meta.
- **The rates are the church's own figures.** The director enters them from Meta's rate card (**Enter a new rate**: category, price in US dollars, the date it starts). The website never asks Meta for prices. Two starting figures are third-party estimates for Nigeria and err high; every figure on the pages is labelled an estimate, and **it is never Meta's invoice.**
- **A monthly ceiling** (optional). An email goes to the directors and the admins at the warning percentage (80 by default), once a month. At the ceiling, Full drops to Saver by itself, once a month; a person who then chooses Full again is not overruled until next month. Nothing drops by itself if there is no ceiling, and in Saver or Free nothing is changed.
- **What each mode would have done** is shown from the last seven days of real messages, so the choice is made on the church's own traffic.

Whether the church qualifies for a nonprofit rate is a question for Meta; this page does not claim it.

## What it never does

It does not change a member's channel choice, the consent rules, the wording of any message, the pause, or how sign-in codes choose their route. It does not send anything itself in Free that it did not send before in Full: it only removes. The existing golden recordings of every message are unchanged.

## Off, Rehearsal and On

- **Off:** nothing here runs and the outbox behaves exactly as it did.
- **Rehearsal:** the pages show what each mode would have done on the last seven days; nothing is changed.
- **On:** the chosen mode takes effect on the next message.

The way back is `supabase/rollback/20270105000100_whatsapp_mode.down.sql`. It restores the five replaced functions to their previous text, drops the six new tables and the Switchboard row, and keeps every message sent. The members' consents, channels and message history are never touched.

## How it was checked

- **Database:** `tests/db/whatsapp-mode.test.ts` covers the mode in force, each class, Saver and Free routing for a person with and without another channel, the Marketing guard, the weekly cap (counted from when a message was sent, or created if it was not), the window, pace and reach, the quality guard, the ceiling warning and drop (once a month), who may call what, the rates, the cost report, the by-hand tools (a leader's own members only; contact withheld means refused; the office sees leaders only), and that Off and Rehearsal change nothing. `tests/db/whatsapp-mode-rollback.test.ts` proves the way back leaves the earlier behaviour, and the earlier functions' text, exactly.
- **The gate:** `tests/unit/whatsapp-mode.test.ts` runs the real sender, the sign-in code sender and the health checks with a `fetch` that throws if it is ever called. In Free mode it is never called. When the mode cannot be read, it is never called. When the database has no WhatsApp mode, behaviour is as before.
- **The pages:** `tests/unit/whatsapp-mode-routes.test.ts` and the browser journey `e2e/journeys/45-whatsapp-mode.ts`. The journey runs the real site against a real database and a stand-in Meta: the owner opens the function, the admin chooses Free with a reason, a message goes by email and the stand-in is asked for nothing, a leader on a phone posts to the group and messages a member by hand, the office messages a leader, and Full sends through the stand-in again.

## What was not checked

- **Meta itself.** Nothing was sent to the real Meta. The stand-in answers like Meta's documented API; Meta's real quality ratings, categories and limits can only be seen on your account. The quality guard acts on the rating Meta reports in the health check; if Meta reports nothing, it does nothing.
- **The price.** The cost figures are estimates from rates typed in; only Meta's invoice is the real cost.
- **WhatsApp opening on a phone.** The links use WhatsApp's own `chat.whatsapp.com` and `wa.me` addresses. The browser journey checked that the page opens the link and logs it; it did not open the WhatsApp app.
- **The ordinary-number route in Free mode.** It was left alone on purpose (decision 19) and was not exercised against a real number.

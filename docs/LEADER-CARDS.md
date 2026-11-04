# Leader cards: where every leader's Tribe Card is, and a kind way to chase it

A tribe does not open to members until its leader has filled in a Tribe Card and a pastor has approved it. In the first week of a season the office needs to know three things about every leader: **has the email with their link arrived, have they started, and where is the card now**. This page answers all three, one card for each leader, and gives the office a way to write again that cannot become a nag.

Page: **Admin → People → Leader cards** (`/admin/people/leader-cards`). Guide: **A5, See where every leader's Tribe Card is, and chase it kindly** (under Help on that page).

Migration: `supabase/migrations/20270110000100_leader_cards.sql`. Way back: `supabase/rollback/20270110000100_leader_cards.down.sql`. Tests: `tests/db/leader-cards.test.ts` (45), `tests/db/leader-cards-rollback.test.ts` (7), `tests/unit/leader-cards.test.ts` (55), the heartbeat test in `tests/unit/messaging-hooks.test.ts`, and the browser journeys `e2e/journeys/48-leader-card-link.ts` and `49-leader-cards-board.ts`.

## Who can do what

| Who | What they can do |
|---|---|
| Admin, director, pastor | Everything: read the board, send the email again (one leader, or everyone it did not reach), tag a department, move the reminders, download both lists, see the address an email failed to reach, open WhatsApp for a leader whose email failed |
| Data lead | Read the board and download the list for the heads of department. Cannot send, tag, see an address or download the call sheet |
| Anyone else | The page is not theirs; a leader who opens it is told so, and sees nobody |

Each function checks the role inside the database before it reads or writes anything, and the three tables behind it are closed to every client.

## Where a card is

| Word on the board | What it means |
|---|---|
| **Not started** | The card exists (the church started it, or the application was approved) and the leader has put nothing of their own on it: no story, day, format or zone |
| **In progress** | They have put something on it and have not sent it in |
| **Changes asked for** | A pastor sent it back with a note |
| **Sent in** | Waiting for the pastorate |
| **Approved** | Done |

The board shows one card for each leader: the newest tribe of theirs that is not closed.

## Whether the email arrived

The board looks at **every message that carries the link** (the appointment email, the invitation, the welcome, the reminder, the application-approved email) and takes the best result: **Sent**, **Waiting to go**, **Did not arrive** (with the reason the email service gave, such as "Mailbox is full") or **Never sent** (with why: their address bounces, they opted out, a deletion request is open). The address an email went to is shown **only** to those who can act, and **only** when the email did not arrive, so the office can check it.

## The filters

Not finished (the start), Not started, In progress, Changes asked for, Sent in, Approved, **Email did not arrive**, **Never signed in**, and Everyone, plus a department filter. The counts above them come from the same rows as the list, so the two always agree.

## Send the email again

- **One leader**: **Send the email again** on their card.
- **Everyone it did not reach**: a button that appears only when there are leaders who have not started *and* whose email did not arrive. It asks first, and says how many.
- The email is the same kind note the reminders use (below). It never says the leader is late.
- **Limits, kept in the database:** never to a leader who has sent their card in; **at most three times** to one leader; **once a day** to one tribe (resend and reminder share the day, so a leader is never written to twice in one day); the usual blocks hold (opted out, address bounces, deletion request open). Anyone left out is named, with the reason, on the page.
- **If the email keeps failing,** the card offers **Message Ben on WhatsApp** (an ordinary chat the office opens by hand, using the existing by-hand list, only where the church may use the number). It says what to write and asks "Did you send it?" so the list stays true. This is not the Meta route and sends nothing by itself (decision 19 stands: the ordinary-number route is never used for bulk messages).

## Departments

Type a department beside a leader (for example **Ushers**), press Save. A department filter and the list for the heads of department use it. Two to sixty characters; blank removes it. The change is written to the office's log.

## The two spreadsheets

| List | Who | Holds |
|---|---|---|
| **For the heads of department** | admin, director, pastor, data lead | Department, name, tribe, how they came, where their card is, whether their email arrived, signed in, last did something. **No phone number, no address.** Leaders with no department are under "No department yet" |
| **Call sheet** | admin, director, pastor | The same, plus phone, email address and whether they said yes to WhatsApp. Logged each time it is downloaded |

Both open in Excel with the accents and curly apostrophes intact, and a name or number that begins with `=`, `+`, `-` or `@` is written as text so a spreadsheet cannot run it as a formula.

## The reminders

**Off** at the start. A dedicated setting on this page (not a Switchboard function, and not a fifth journey in Automatic reminders).

| Position | What it does |
|---|---|
| **Off** | Nothing |
| **Rehearsal** | Writes down who it *would* have emailed, sends nothing, and the page says how many it would have written to this week |
| **On** | Sends one email a day to each leader whose card is open, on the days chosen, from the hour chosen (default **Thursday, Friday and Saturday at 9 am**), up to **12 in all** to one leader |

Changing it needs a reason (5 to 300 characters), between one and four days, and an hour from 6 am to 5 pm. The change is logged with the name of the person who made it.

Every reminder is **email only** and:

- stops the moment the card is sent in or approved;
- never goes out while the **Master pause** is on;
- never goes inside the quiet hours (`send_window_ok('reminder')`);
- never goes to someone who opted out of reminders, whose address bounces or who has an open deletion request;
- is one note a day to a tribe, shared with Send again.

Wording (fixed, in plain English, never says "late" or gives a deadline): who invited them, where the card is, "A pastor reviews your card before members can see your tribe", "If something is in the way, tell the church office", and one button to open the card (or "See what to change" if changes were asked for).

## Sending and email

**Admin → System → Sending and email** now has a section, **Leaders who did not get their Tribe Card email**, with the count and the names, so a problem is seen from the page the office already watches.

## Announcements

A new audience in Announcements: **Leaders whose Tribe Card is not finished**. It counts exactly the leaders the board counts under "Not finished". It is not narrowed by community.

## The link in the email

The email has one link, to `/lead/tribe`. Opened signed out, it goes to sign in and remembers where it was going; after an **email code** or a **WhatsApp code** the leader lands on their Tribe Card, not Home. Someone signed in with a different account who opens it is told whose account they are in, that the page is for tribe leaders, who to tell if they were appointed, and has a button to sign out and use another account; they never see the leader's card. (Journey 48 proves all of this in a browser, and that the card can be filled in and sent from a phone.)

## What it never does

- It never changes a card, approves one, or lets a leader skip a step.
- It never sends anything to a leader who has sent their card in.
- It never sends a reminder by WhatsApp or text.
- It never shows a phone number to the heads of department, or to the data lead.
- It never turns itself on.

## What is not here

- **No row on the Today page** for the board; the page is under People.
- **Heads of department are not platform users yet** (that is fix 7), so for now their list is the downloadable one.
- **The reminders' wording is fixed** and cannot be edited in Automatic reminders.
- **Foundation of Faith** is not changed by this package. If you want leaders to be able to send a card without it, that is your own setting: **Admin → Leader pipeline → Foundation of Faith → Optional**.
- **The reminders need the heartbeat every few minutes** (see `docs/APPLY-PACKAGE-4.md`).

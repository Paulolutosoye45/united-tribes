# Messages and reminders

Two things, one engine. **Announcements** are messages the office writes and sends to a group. **Automatic reminders** are four
short journeys of at most four emails that bring people back to what they started. Email is live. WhatsApp bulk is shown greyed
**Not set up yet**; *Message on WhatsApp* is an ordinary tap-to-chat link (`wa.me`) that a person sends by hand.

Everything is in the **Admin** hub (Messages group), **Care → Asks**, and **Profile → Email**.

## Announcements (`/admin/announcements`)

- **Who** is chosen from live records, never an uploaded list, and the count is live. Left out every time: people who switched
  off email or announcements, people whose deletion is in progress, the 13–17 track, and addresses with 2 hard bounces. The
  screen says how many were left out and why, never who.
- **Write**: four starting notes, name fields (`{first_name}` etc.), paragraphs, one optional button that points only inside
  United Tribes ("Where they stopped" returns a person to the exact step of their form). Links typed into the words and unknown
  name fields are refused at once. Preview as one real person, phone or computer, light or dark; **test to me** goes only to you.
- **When**: now or later, inside 8am–8pm Lagos, spread at about 300 a minute. Pause and cancel at any time; recipients are frozen
  at approval.
- **Approval**: a send to 200 or more people needs a second person (Admin, Director or Pastor) who is not the writer. Champions
  always need approval and can write only to their own community.
- **Results** show counts only: delivered, tapped our page, acted (by state), stopped. There is no tracking pixel.

## Automatic reminders (`/admin/reminders`)

| Journey | Starts when | Emails on day |
|---|---|---|
| Member form | form started, not finished | 1, 3, 7, 21 |
| Leader application | application started | 2, 5, 10, 20 |
| No tribe | form finished, no tribe yet | 2, 6, 12, 20 |
| In tribe | joined a tribe | 3, 6, 10, 14 |

- Four tones, in order: warm, practical, encouraging, honest last call. The **condition is re-checked before every send**; an
  email more than 3 days overdue is skipped, not sent late.
- Each journey is **Off / Rehearsal / On**, plus a master switch. Every journey starts in **Rehearsal** (writes what it would
  send, sends nothing). Admin or Director switch; a change to the wording by an Admin waits for a Pastor, who sees it as the
  person will read it. Data lead can see results.
- The last email offers six ways out (*Not this season*, *Later*, *I need help*, ...). Each opens a page that changes nothing
  until a button is pressed, so link scanners cannot opt anyone out. Care Lead is emailed for asks and can message on WhatsApp
  only if the person agreed to WhatsApp.
- **Hold-out**: 10% of people (fixed rule) get no reminders, so the office can see what reminders change. It is a policy choice;
  set it to 0 on the settings if the church prefers.
- **Weekly caps and hours**: at most 2 reminders a week, 2 days apart, 3 non-essential emails a week; reminders 9am–7pm Lagos
  (Sundays from 2pm). The hours are shown but changed in the database settings row, not in the screen.
- **Self-pause**: if unsubscribes pass 1% or complaints pass 0.1% in a day the journey pauses itself, emails the office, and
  stays paused until someone restarts it.

## Safeguards on every email

One-click unsubscribe (RFC 8058 headers and `/api/email/unsubscribe`), a footer link that asks first, three switches on the
profile (reminders, announcements, tribe), nothing private in the text, links only to United Tribes, and a plain-text twin and
dark mode for every design. Opt-outs are recorded in the consent ledger.

## Settings you may want to change

`reminder_settings` (one row): `church_name`, **`church_address`** (printed in every footer; the default is a placeholder, set the
real address), `applications_close_on`, the caps, `holdout_pct`, `bulk_per_minute`, `approval_threshold`.

## What is not promised

- Nothing was sent through a real email provider while building. Do the check in APPLY.md with your own address first.
- Deliverability needs SPF, DKIM and DMARC on the sending domain; keep complaints under 0.3%.
- "Tapped" means someone opened our own page; "acted" is read from their records.
- A button opened by someone not signed in goes through sign-in, then on to the right place.
- WhatsApp bulk waits for the official route. *Message on WhatsApp* cannot confirm that a message was sent.

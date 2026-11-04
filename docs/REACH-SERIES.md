# The contact series and the tribe note: reaching the members a leader cannot message on WhatsApp

A leader can message a member on WhatsApp only if the member has added a number **and** said yes to WhatsApp. For many members one or both are missing. This package asks them, kindly, by email, in the leader's name, and gives the leader and the office a clear view of who has put it right. **It asks. It never moves, removes or replaces anyone.** (Releasing a seat is a later package.)

Two new functions on the Switchboard (**God Mode → Features**), both starting **Off**:

| Function | What it does | Needs |
|---|---|---|
| **Reach series** | Four emails over six days to each member who holds a seat and is on Contact gaps, each with a private one-minute page that needs no sign-in. The leader goes first. | **Contact gaps** On |
| **Tribe note** | A leader writes one short email to the whole tribe, sent by the church office in the leader's name. | nothing |

Each can be **Off**, **Rehearsal** (the machine runs and writes down what it would send, and sends nothing) or **On**, for the whole church, one community or one tribe.

Migration: `supabase/migrations/20270111000100_reach_series.sql`. Way back: `supabase/rollback/20270111000100_reach_series.down.sql`. Guides: **L10, Reach the members you cannot message on WhatsApp** (for leaders) and an added part in **A3, Find the members a leader cannot reach, and ask them** (for the office).

## What a member goes through

| Day | Email | Who it speaks as | What it says |
|---|---|---|---|
| 0 | 1 | the leader (sent by the church) | "Lara would like to message you on WhatsApp", the leader's own line in quotes, who can see a number, and that the choice is theirs |
| 2 | 2 | the church | a short reminder, one button |
| 4 | 3 | the leader | "still hoping to reach you" |
| 5 | 4 | the church | the last of four, said plainly, with **Email me instead** |
| 6 | | | the series closes. Nothing else happens in this version |

The subject lines fit on a phone's lock screen. No email ever says the person did something wrong, names another member or carries a phone number. Each says in one sentence who can see a number (the tribe's leader, their assistant and the person's coach, and only if WhatsApp is ticked) and that other members never do.

**The private page** (`/add-number/<link>`). The link is a 64-character secret, kept in the database only as a fingerprint, valid for **30 days**, and only that person's.

- Opening it **changes nothing** except a counter (mail scanners open links too). The person must press a button.
- A member with **no number** sees a number box and one tick. A member **with a number and no yes** sees one tick, and the number with its middle hidden (`+234••••••••22`). The tick is never ticked for them.
- If they sign in with a phone number, a button offers it (middle hidden). The whole number is used **on the server, only when they press that button**; the page never holds it.
- A number that does not look right is refused in words, and nothing is saved. A made-up number (the last seven digits all the same) is refused too.
- **Email me instead** ends their series, says so to the leader on their next look, and the link keeps saying "We will email you."
- An old link says **This link has run out** and offers **Send me a new link** (at most three a day). A link that was never made says **This link isn't valid.**
- Nothing is ever withdrawn: the page can add a yes, never remove one. A yes is recorded as version `reach-v1`.
- It needs no sign-in, is hidden from search engines, sends no referrer, and does not scroll sideways on a phone.

## What the leader sees

On **Lead → Who has joined**, a box, **Reaching your tribe**, replaces the older one-by-one list while Reach series is On:

- "**1 of 5 can be messaged on WhatsApp.**" with a bar.
- **Ask my members**: opens a panel that says who will be emailed and that they choose what to share, with an optional **line of your own** (200 characters, no links, quoted in email 1 in the leader's name). One press emails everyone with a gap; email 1 goes at once.
- **If the leader does nothing**, the church sends email 1 for them after **24 hours** (first go), at the next heartbeat inside 9 am to 7 pm Lagos time.
- The first names who still have a gap, each with where they are: **Not asked yet**, **Your go: email goes by itself soon**, **Email 2 of 4 sent**, **You are following up**, **Wants email only**, **Asked four times: please ask in person**. Never a number, never a surname, never an address.
- **I'll follow this up myself**, beside a name: that person is not emailed for **three days**, once.
- **Write to my tribe** (when **Tribe note** is On, even if Reach series is not): up to 600 characters, no links, two a week for each tribe. It goes to everyone in the tribe who can be emailed. Members who still have a gap find an **Add my number** or **Tick WhatsApp** button under the leader's words; everyone else just reads them. The box says how many notes are left this week.

The tribe's leader, assistant leader and coach can read the box; the leader and the assistant can press its buttons. An older database, or Reach series Off, leaves the Lead page exactly as it was.

## What the office sees

On **Contact gaps**, once Reach series is On: a section, **The contact series**, with **how many put it right** and a count for each stage (press one to see only those people); a **Series** filter and column on the list ("Email 2 of 4 sent", "Chose email", "Leader is following up", "Stopped by the office", "Not reached"); **Pause the series for everyone** and **Resume** (a reason of five letters or more); **Stop** beside a person (a reason of five letters or more). The download gains **Contact series** and **Series emails sent**; it still has no phone numbers.

On **God Mode → Features**, a card, **The contact series settings**: the hours the leader has before the church sends email 1 (0 to 72, default 24), the days the series runs (4 to 10, default 6; the emails fall on days 0, 2, 4 and 5 and keep that shape), how many notes a tribe may send a week (1 to 4, default 2), and what the end of the series does (in this version, nothing). Every change needs a reason and is written to the log.

## Who is never in the series

Anyone under 18; anyone with a deletion request open; anyone with an open care follow-up (the series waits and resumes with the days it had left); anyone whose seat is still waiting for a reply to a placement (they are on that clock, and a person is on one clock at a time); anyone whose address bounces or who has switched email off (listed **Not reached**, for a phone call); anyone who already had their series this season. The condition is checked again before every email, so a person who puts it right between two emails gets no more.

## Timing, and what slows it

- Emails go on days **0, 2, 4, 5** after email 1. They are never sent outside **9 am to 7 pm Lagos time**, and inside the outbox's own quiet hours on top.
- An email **more than two days late** is not sent late. The whole series moves on by the days lost, so the spacing is kept and nobody gets four emails in a day.
- The **Master pause**, switching the function Off, an open care follow-up and the leader's **I'll follow this up myself** all freeze the series. It resumes with exactly the days it had left.
- The heartbeat runs the series each beat, **before** the message sender. A fault in it is listed in the heartbeat's reply and never stops the beat.

## Rehearsal

Rehearsal runs the same machine, but "sending" writes a line saying what would have been sent. Nothing is emailed and nothing changes for anyone, and the leader's Lead page stays as it was (the strip appears only when Reach series is **On**). A tribe note written in Rehearsal is kept and not sent. The Rehearsal rows are retired the moment the switch moves to **On**, so the first real run starts clean. The office list still shows who would have been asked, and which email each would have got.

## Privacy, in one place

- A number is shown only with its middle hidden, and only to the person it belongs to.
- The leader sees first names and where each person is. Never a number unless the member ticked WhatsApp, and then only where they already could.
- Email 1 carries the leader's line, in quotes, in the leader's name. **Reply-To is the church's address**, as for every message from the office, so a member's reply reaches the office and not the leader. This is a deliberate privacy choice: a leader's address is never given out.
- Nothing in this package goes to WhatsApp or to Meta: all three new messages are **email only**. The ordinary-number route is never used for bulk messages (decision 19).

## The tests

`tests/db/reach-series.test.ts` (57), `tests/db/reach-series-rollback.test.ts` (7), `tests/unit/reach-series.test.ts`, the heartbeat test in `tests/unit/messaging-hooks.test.ts`, and the browser journey `e2e/journeys/50-reach-series.ts` (67 checks: the leader's strip and Ask, the emails, the member's page on a phone, the sign-in number, the one-tick page, email-only, the expired link and its new link, follow-up, the tribe note, the office list and its stages, pause and stop, the download, the owner's settings, and "Yes, I'm in" with the two boxes).

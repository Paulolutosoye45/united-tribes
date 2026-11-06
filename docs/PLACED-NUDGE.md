# The placed-member nudge: one tap to keep a place, and a choice about WhatsApp

The church places many members in a tribe by itself. Until a placed member says yes, the leader sees only a first name and the church cannot confirm the seat. This package lets the office remind those members once or twice, by email, and gives each a private page where **one press** says yes to the tribe. The page also asks, in plain words, whether the leader may message them on WhatsApp. That is the only place in the app where a number and a WhatsApp yes arrive together, and each is the member's own choice.

**It sends nothing by itself and starts Off.** The nudge is an ordinary announcement that the office writes and sends. There is no new kind of message, no new sender and nothing that goes to Meta.

Migration: `supabase/migrations/20270113000100_placed_nudge.sql`. Way back: `supabase/rollback/20270113000100_placed_nudge.down.sql`. Guide: the new part **Nudge the members we placed** in **A3, Find the members a leader cannot reach, and ask them**.

## Who is "waiting"

A member is waiting when all of these are true, and the count on every screen is this one test:

- the church placed them (the seat's source is the automatic run, not their own choice),
- the seat is active and they have not said yes,
- the season is not closed.

Then, **per member**, a nudge is left out, with its reason shown as a count and never a name, when:

| Reason shown | When |
|---|---|
| Placed less than a day ago | the placement email went less than 24 hours ago (the first wait is a setting) |
| Pressed Don't share my details | they asked that their email and number are not given to the leader |
| Nudged in the last few days | the last nudge was under 3 days ago (a setting) |
| Already nudged as many times as allowed | 2 nudges for this seat (a setting) |
| Said yes, changed tribe or gave up the seat since the count | they answered between the count and the send |
| Not switched on for them yet | the switch is On for another tribe or community, not theirs |

Under 18s, people who stopped announcements, people with no working email, people who asked for their data to be deleted and people who already had enough messages this week are left out by the same rules as any other announcement.

This is checked **three times**: when the office counts, when the announcement is released, and again at the moment each email is made. Rehearsal counts too, so a Rehearsal test cannot be gamed into thinking it would send more.

## The switch

**God Mode → Features → Placed nudge**, with the same Off, Rehearsal and On as every other function, for the whole church, one community, one tribe or one person.

| Setting | Off | Rehearsal | On |
|---|---|---|---|
| Today's card, **Placed members waiting** | no | no | yes |
| The audience in the composer | hidden | shown, with a note | shown |
| Counting who would get it | no | yes | yes |
| A test email to the writer | no | yes | yes |
| Sending to members | no | **no** (the Send button is off, and the database refuses) | yes |
| The member's page | today's page (three buttons) | today's page | two buttons |
| Contact gaps: **Number confirmed** column and count | no | yes | yes |
| Leader's line "The church reminded …" | only once a nudge has gone | the same | the same |

The **Master pause** holds a scheduled nudge exactly as it holds everything else. A nudge cannot be scheduled while it is not On: the database clears the button and refuses.

**Settings behind it** (owner only, on the same page, with a reason of 5 to 300 characters that goes in the log): hours to wait after the placement email (0 to 240, default 24), days between nudges for one seat (1 to 14, default 3), and most nudges for one seat (1 to 4, default 2).

**It stops itself.** After 50 or more have gone, if more than 1 in 100 people stop announcements, it pauses that announcement and tells the director and the admin, as the reminders do.

## What the office does

1. **Today** shows **Placed members waiting** with **Nudge them** once the function is On. **Contact gaps** has **Nudge the members we placed**. Either opens a new announcement pointed at the people who are waiting, with the count and the reasons for those left out.
2. **Who** can be everyone waiting, or only those with no number or no WhatsApp yes. **Placed more than** can be 24 hours (default), 2, 3 or 5 days. A tribe can be chosen.
3. **Use the nudge wording** fills the subject ("One tap keeps your place in {tribe}") and three short paragraphs. They can be edited. Only `{first_name}`, `{tribe}`, `{season_starts}` and `{my_page}` can be used in the words.
4. **Fixed on purpose:** the three answers (**Yes, I'm in**, **Show me other tribes**, **Don't share my details**), each with that member's own private link, and the line *"Your leader, their assistant and your coach can see your number only if you agree to WhatsApp. Other members never see it."* An email that offered only "yes" would be pressure, and a nudge that left out the line about the number would be unfair.
5. **Send a test to me** shows the real email in a real inbox. Its links belong to nobody, so opening them changes nothing.
6. The nudge counts toward the weekly limit like any other announcement.

## What the member sees

An email from the church with their tribe's name, when it meets, who leads it, and the three answers. The email contains **no phone number** and no other member's name.

The private page (`/placed/<link>`) opens without signing in. **Opening it saves nothing** (mail scanners open links too). It has two buttons that both say yes to the tribe:

| Button | Saves |
|---|---|
| **Yes, I'm in, and message me on WhatsApp** | the place, the number (typed, or the one they sign in with, if they tick it), their yes to WhatsApp (wording version `placed-v1`) and their preference, all in one step |
| **Yes, I'm in, email only** | the place only. No yes to WhatsApp, no number |

- A number that does not look right stops the whole press and the page says so: the place is still held and nothing was saved.
- A member who already agreed to WhatsApp and has a number is asked only to say yes: *You are nearly there.*
- The number box is never filled in for them, and nothing is ticked for them. The number they sign in with is offered, with its middle hidden, as a tick.
- **Show me other tribes** and **Don't share my details** are as they always were.

### A link that ran out

Private links last 60 days. An old link now says **This link has run out** and offers **Send me a fresh link**, which emails a new one to the address the church holds (three a day, the same answer whoever asks, so it tells a stranger nothing). A link for a seat that is gone says so, and a link we never made says it isn't valid. The original placement email's link is also tracked now, so it can tell these apart.

## "Number confirmed"

A saved number is not the same as a number that reaches the person. The app now keeps three levels and does not mix them up:

| Level | Meaning |
|---|---|
| **Saved** | there is a number in their contact details |
| **Agreed** | they said yes to WhatsApp |
| **Confirmed** | the number is the one they sign in with (a code was sent to it), or, from the next phase, they sent one message from it |

Confirmation is kept as a fingerprint of the number, not the number, so **changing the number un-confirms it**. Contact gaps shows a **Number confirmed** column and **Confirmed on WhatsApp: x of y**, and the download has the same column. A leader's list shows *"The church reminded Ada on 6 Nov."* for a member still waiting, and nothing for anyone else.

## What is kept, and what is not

- **Private links** are made when each email is sent and kept only as a fingerprint. They are not in the message row, the log or any export. A retry of an email makes new links.
- **No phone number** is in any email, any message row, any log, or the answers the office functions give. Contact gaps still shows names only.
- `placed_nudges` records that a nudge went, to which seat, and when. `number_confirmations` records the fingerprint and how it was confirmed.
- The owner's settings change is in the log (`placed_nudge.settings`); a self-pause is in the log (`placed_nudge.self_paused`).

## Rolling it out

1. Apply the database file, deploy the website. Everything stays Off.
2. Set **Placed nudge** to **Rehearsal** for the whole church. Open **Nudge the members we placed**, read the count and the reasons, send yourself a test, open it on your phone.
3. Set it to **On for one tribe**. Send one nudge to that tribe. Watch for a day: how many pressed which button, how many stopped announcements.
4. Set it **On for the whole church** and send.

## Not in this package (Phase 2)

"Say hello on WhatsApp" (the member sends one message from their number, which confirms it) and the **Number proof** switch need the live Meta number and its webhook. Everything here works without them, and the **Confirmed** level already counts the sign-in number. Nothing in this package talks to Meta.

## Tests

`tests/db/placed-nudge.test.ts` (56), `tests/db/placed-nudge-rollback.test.ts` (9), and the journey `e2e/journeys/52-placed-nudge.ts`.

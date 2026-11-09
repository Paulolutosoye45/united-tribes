# The placed answer sequence, the board and the call desk (Package 6b)

The church places many members in a tribe by itself, and many of them never answer. The placed-member nudge (Package 6a) sends one announcement by hand. This package adds what an announcement cannot do: **a short, honest sequence of emails to each placed member who has not answered**, a **private page that gives them more ways to answer than yes**, a **board** in Admin that shows where every placed member stands, and a **call desk** that lists exactly who is worth a phone call, with the number shown only when someone presses a button.

**It starts Off and sends nothing until you move the switch.** Nothing in it goes to WhatsApp or to Meta. The sequence is email only, and the call desk is a list for a person to phone from.

Migration: `supabase/migrations/20270114000100_placed_answers.sql`. Way back: `supabase/rollback/20270114000100_placed_answers.down.sql`. Guide: the part **Follow up the members who have not answered** in **A3**.

## The sequence

Step 1 is the placement email the church already sends. It is not changed. After it, a member who has not answered is sent:

| Step | When | What it says | Subject (under 60 characters) |
|---|---|---|---|
| **2a** | 24 hours after the placement email, if the page has not been opened | "We are not sure our first email reached you." The tribe, when it meets, why it fits, the day the seat is held to | Did this reach you, Ada? |
| **2b** | the same moment, if the page has been opened | "If something is in the way, we would like to know. Saying no is a fine answer." | Anything stopping you from joining Builders Tribe? |
| **3 Still held** | every 3 days while more than 2 days remain | The seat is still held. How many seats in the tribe are answered, but only when at least 3 have and the tribe has at least 5 seats | 7 of 12 seats in Builders Tribe are answered |
| **4 Last call** | 24 hours before joining closes | The last of these emails. Nothing follows it. It does not threaten and promises nothing more | Last call: Builders Tribe is held until Sun 22 Nov |
| **Remind me tonight** | 6 pm Lagos, once, when a member asked for it | One email, the tribe and the day | Your reminder: Builders Tribe is holding your seat |

* **The day.** Joining closes on the season's first day plus *Days after the season starts that joining closes* (Admin → Reminders), at the end of that day in Lagos. This season that is **Sunday 22 November** once the setting says 21 (it ships as 14, which is 15 November). Every email names the day, and the page says: *Your seat is held for you. You can switch tribes until Sunday 22 November.*
* **Backlog.** A member placed before the switch is turned on joins at step 2, not step 1, so nobody is sent the placement email again.
* **The 5-day reminder** the placement email already queues is skipped for a member who is in the sequence, so nobody gets both.
* **A slot is kept for Last call.** However long the window, the most emails for one seat (6) can never be used up before Last call.
* **Every email has the same buttons:** Yes, I'm in · Show me other tribes (while a member can still switch) · Not this season · Call me · Remind me tonight (not in Last call or the reminder) · Stop these reminders. Each opens the private page with that answer ready. **Opening it saves nothing.**
* **Every email says**, in one sentence, that *the church office may also call you about your place*, and how to stop that (Don't call me), and why they are getting it.
* **The leader's own line.** A leader may write one plain sentence (up to 200 characters, no links, numbers, email addresses or symbols) under **Lead → Tribe Card**. It is shown in every email as *Ngozi adds: "…"*. Only the leader and a director or admin can change it. It appears only while the sequence is On or Rehearsal.
* **What an email never says:** whether the member opened the page (a mail scanner can open a link), another member's name, a phone number, a faith journey, a score, a support need or an age. The reasons for the placement are only about the tribe's time and place.

## Who is left out, and when it stops

Each seat is looked at once per beat, under a lock. An email is **not** sent, and the seat is not enrolled, when:

| Reason | Rule |
|---|---|
| Already answered | the seat is confirmed, or released by any route (the member on any page, the office, a call). A database trigger ends the sequence and withdraws any email of it still waiting |
| Under 18, or asked to be deleted | never |
| Stopped announcements, or the email is bouncing | never |
| A care follow-up is open | never |
| Pressed Stop these reminders | ended |
| Held by the office | waits until the hold ends |
| Asked for a call that has not been made | waits |
| Too soon | at least **20 hours** between any two emails to one seat (the placement email, the 6a nudge and the sequence all count). Real sends only: a Rehearsal never delays a real email |
| The seat has had 6 | stops (a slot is kept for Last call) |
| Over the weekly limit | the weekly limit now counts these emails too. **Last call is exempt** (nothing follows it) |
| Outside 9 am to 7 pm Lagos time | waits |
| Master pause, or the office pause | waits |

**It stops itself.** After 50 or more emails, if more than 1 in 100 people stop announcements, or more than 1 in 1,000 mark one as spam, or more than 1 in 20 bounce, the sequence pauses and tells the director and the admin. Pressing Resume starts the counts afresh.

## The member's private page

The page the email opens (`/placed/<link>`) keeps today's three answers and adds, **only while the function is On for the member**:

| Answer | What it does |
|---|---|
| **Not this season** (optional reason: time, place, too busy, not what I expected, something else) | Gives up the seat. The member is not placed again this season; the door stays open for the next. Open until the season closes |
| **Call me** (a time of day: morning, afternoon, evening, any; a number if we hold none) | The seat stays held. The request goes to the call desk. After joining closes it reads **Ask the office about another tribe** and the office knows what it is about |
| **Remind me tonight at 6 pm** | One more email at 6 pm. After 6 pm the button says *tomorrow* and the email goes at 6 pm the next day. It never moves the day. Not offered when there is no time left |
| **Stop these reminders** | Ends the sequence. The seat is not touched. Works whatever the switch says, so an old email's link still does what it says |
| **Don't call me** | The office will not phone this member. Works whatever the switch says |

Everything is a press on a button from a short list. The only thing typed is a phone number for **Call me**, and only when we hold none; one that does not look right stops the request with the page unchanged. A number we hold is shown with its middle hidden.

## The Placed members board

**Admin → Placed members** (admin, a director or a pastor). Tiles run from **Placed → Emailed → Page opened → Answered**, plus **Needs a call**; smaller tiles show **Waiting**, **Asked for a call** and **Under 48 hours left**. Every tile and every list on every tab is computed from one base set, so they cannot disagree, and every number opens the rows it counts. The rows filter by tribe, step, page opened, answer, flag and call, with names, tribes and steps, **never a phone number**.

* **Health strip:** sent, delivered, bounced, marked as spam and stopped announcements since the sequence began.
* **"Page opened" is not "read".** The board says so. The sequence uses it only to choose its words.
* **By tribe:** which tribes still have the most people waiting, with the leader to speak to, and which are thin (fewer than five who have said yes).
* **Hold this seat** (admin and director): the emails to that member wait 1 to 14 days, with a reason in the log. **Let the emails resume** ends it. A hold never moves, gives up or confirms the seat.
* **Pause the sequence** (admin and director): needs a reason; emails already sent stay sent.
* **Today** gets a line: *3 placed members need a call, 1 asked for one.*
* A pastor reads the board and cannot see the desk, hold a seat or pause.

## The call desk

**Admin → Placed members → Call desk** (admin and director only). Two lists, and nobody else:

1. **Asked for a call:** members who pressed Call me, oldest first.
2. **Worth a call:** placed, with a number, no answer yet, **told by email that the office may call**, who have not stopped reminders or announcements, asked not to be called, been tried three times, had a wrong number, or asked for time and are waiting. Page opened first, then those placed longest ago.

The number is hidden until **Show number**. Each press is written down (who, which member, when; **never the number**), is limited to 60 an hour, and works only between 8 am and 8 pm Lagos time. A member who chose a time of day asks for a second, deliberate press at any other time. The number hides itself again after 90 seconds.

After a call the caller chooses what happened:

| Outcome | What it does |
|---|---|
| Reached, said yes | Confirms the place (wording version `phone-v1`). It does **not** save a WhatsApp yes or a number |
| Reached, wants another tribe | Writes it down and ends the emails. You move them by hand |
| Reached, not this season | Gives up the seat, marked Not this season |
| Reached, needs time | A follow-up date up to the day joining closes; the seat is held until then, once |
| No answer | A try. After three the member leaves the desk |
| Wrong number | The number is flagged and the member leaves the desk. Nothing is deleted |
| Asked not to be called | Never shown on the desk again |

**Download with numbers** is behind a switch only the owner can move (**God Mode → Features → Placed answer sequence → Allow the call desk download with numbers**), off by default. When on, an admin or director can download the desk; each download is logged (who, when, how many; not the numbers), is limited to 20 a day, and the file's last line says who downloaded it and when.

## The switch and the numbers

**God Mode → Features → Placed answer sequence**: Off, Rehearsal or On, for the whole church, one community, one tribe or one person.

| | Off | Rehearsal | On |
|---|---|---|---|
| Emails | none | none (the board counts what each step **would** send) | sent |
| The member's page | as it was | as it was | the new answers |
| The board and By tribe | read-only, as a count of where people stand | the same, plus the practice counts | the same |
| Today's line, the leader's one-line box | none | shown | shown |
| Call desk | lists, hours and tries apply | the same | the same |

Owner settings, with a reason of 5 to 300 characters that goes in the log: hours before the second email (1 to 240, default 24), days between Still held (1 to 14, default 3), hours before the end that Last call goes (6 to 96, default 24), hours between two emails to one seat (1 to 72, default 20), most sequence emails for one seat (2 to 10, default 6), most phone tries for one member (1 to 6, default 3), and the download switch.

## Things to know

* **It never moves, releases or confirms anyone on its own.** The only seats it gives up are ones a member (or a caller, on the member's word) gives up with Not this season.
* **Not this season** is kept after the season too: the member is not placed again until the season ends, unless the owner has set a longer hold.
* **A member whose email is bouncing** is never "told", so they are not on **Worth a call**. Reach them another way.
* **The signed-in tribe page** is unchanged. An answer given there ends the sequence by the same trigger.
* **Rehearsal** is real arithmetic on real members and sends nothing.
* **Decision 19 stands:** nothing in this package uses an ordinary number to send to many, and nothing in it goes to WhatsApp or Meta.

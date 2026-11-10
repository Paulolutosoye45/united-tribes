# Leader Desk (God Mode), Phase 1: see

**God Mode → Leader Desk.** The owner's own page for the people who finished the form and still have no seat, and for the members who could one day lead. **Phase 1 only shows, scores and drafts.** Phase 2a (below) adds two emails a member can answer with one tap. Phase 2b-1 adds asking a member to lead a draft group, and starting its tribe card when they say yes. All of it starts in Rehearsal, where nothing is sent. The rest of Phase 2b (the pastor's "card waiting" email, **Open tribe**, the parity test and the pipeline limits) is still to come.

## Who can use it, and when

* **The owner only**, with God Mode unlocked. Admins, directors, pastors, members and visitors are turned away by the database itself, not only by the page.
* **Closed until you open it.** The switch is **God Mode → Features → Leader Desk** (platform-owner only). **Off** (the start): the page says it is switched off and nothing is read. **Rehearsal** and **On** both open the page. In Phase 1 they do the same thing, because there is nothing to send; the page says so when it is in Rehearsal.

## What it shows

Three tabs, with a count on each.

| Tab | What it is |
|---|---|
| **Waiting** | Members with a finished profile this season, no active seat and no active hold. Not shown: hidden people, under-18s, leaders and assistants, the platform owner, anyone with an open erasure request, or anyone from another centre. Filter chips: **No tribe shown**, **One or two shown**, **Has options**, **Never ran the matching**, and **Asked for a Starter tribe**. Each person shows the days waiting, the **one reason no tribe fits**, and a masked phone number. |
| **Leaders** | Members by **leadership signal**, in three pools (below). |
| **Proposals** | Groups that waiting people could already fill (same life stage, time, way of meeting and type, at least the minimum tribe size, not counting people already in a draft), and your **draft groups**. |

### Why no tribe fits

One plain reason per person: **no tribes yet**, **life stage**, **under 18 needs an assistant**, **excluded from the tribes shown**, **time**, **format**, **area**, **type**, **tribes are full**, **score below the floor**, or **other**. The reason comes from the same rules the matching uses. If any tribe would score the person at or above the floor, there is no reason shown, because there is nothing wrong. A test proves the two agree.

## Phone numbers

* **Masked everywhere.** Only the last digits show.
* **Show number** opens one number at a time, **only 8 am to 8 pm Lagos time**, **at most 60 an hour**. The number hides itself again after 60 seconds.
* Every opening is written down (who, which person, when) **without the number**. The event log line is `leader_desk.reveal` and carries nothing else.
* The only phone link on the page is the one that appears after **Show number**.

## Draft groups

A draft is not a tribe. It has no leader, no seats, and nobody is told about it. Only you see it.

* One draft per person; at most 40 drafts a season. Archive a draft to remove it from the list.
* **Add** refuses what the matching would refuse for that person: wrong season, under 18, life stage, time, way of meeting, area, or type. It also refuses a full group, someone not waiting, or someone already in another draft.
* Things that are only worth a look (the group would have too many people who need extra support, too few established believers, or no quiet or lively voice) show as **watch**, not as a refusal.
* **Checks on each draft:** size, fit, score, heavy support, established believers, balance, and numbers. **Ready to form** means every check except numbers is ok. Numbers is information: a tribe needs the minimum size (5 by default) before a placement run will fill it.
* **The score is the real score.** A draft is scored by the same weights as a real tribe, over the draft's members, leave-one-out, with a neutral leader-style. For the same members and settings the number is the same as the matching would give; a test checks this across 17 profile variations on two tribes.
* **Who would suit it** lists waiting people by how well they would score, and you add them one at a time.

## Leadership signal

A number out of 100 built from five things the church already knows, and **nothing else**:

| Part | Out of | How |
|---|---|---|
| **Willingness** | 30 | said yes to leading 30, maybe 15, not now 0, not answered 7.5 |
| **Walk** | 25 | leading or established 25, growing 15, new 7.5, anything else 2.5 |
| **Reliability** | 20 | weeks present out of weeks present plus absent, once there are 3 weeks of records; before that, half marks |
| **Named by others** | 15 | none 0, one 9, two or more 15 (recommendations not withdrawn or declined) |
| **Progress** | 10 | steps done or partly done out of steps answered, once there are 3; before that, half marks |

**Pools**

* **Ready now**: willing (yes or maybe), established or leading, signal 70 or more.
* **Almost**: willing (yes or maybe), signal 50 or more, not in Ready now.
* **Members**: everyone else. Someone who said "not now" always stays here.

The signal **never reads** gender, age, area, health, care notes or support load (a test checks the function does not mention them). **No dates are promised** to anyone from it, and it makes nobody a leader. Appointing a leader still goes through the existing leader flow.

## Applying and undoing it

* **Apply:** `supabase/migrations/20270116000100_leader_desk.sql` (needs Package 6b applied first; it stops with a clear message if not). Then deploy the website. See `docs/APPLY-LEADER-DESK.md`.
* **Undo:** `supabase/rollback/20270116000100_leader_desk.down.sql`. It removes the Desk's own functions, its three tables (draft groups, their members, the log of numbers opened) and its place on the Switchboard. It changes no existing function and no member, seat, tribe, message, notice, consent or log line. Running it twice changes nothing. `tests/db/leader-desk-rollback.test.ts` rehearses it.
* The Phase 1 migration adds **22 functions** (13 the page calls, 9 helpers closed to every signed-in person), **3 tables**, and one Switchboard entry. It replaces no existing function.

## Phase 2a: two emails (Sending tab)

Two emails, both to members who are **still waiting for a tribe**, both email only, from the church office, with no number in them.

| Email | Where you start it | What the member sees |
|---|---|---|
| **A tribe that could suit you** | **Waiting** tab, **Email a proposed group** on a member | One open tribe they pass every matching rule for: the leader's first name, when it meets, the fit and up to three reasons (goal, place, time only), seats left. Buttons: **Look at this tribe**, **Not for me**, **Stop these emails**. |
| **Would this group suit you?** | **Proposals** tab, **Check interest** on a draft group | A group still being put together, no leader named, one question. Buttons: **Yes, count me in**, **A different time**, **Not for me**, **Stop these emails**. |

Every button opens a **private page** (`/d/…`). Opening it changes nothing; an answer is saved only when a button on that page is pressed.

### What the member's answer does

- **Tribe email.** The tribe button goes to the ordinary `/tribe` page. **Nothing about joining is shortcut**: choosing the seat is still the member's, the usual way. **Not for me** is noted; they stay waiting.
- **Interest check, Yes.** Counted on the draft group. It is interest, not a seat; if the group goes ahead they are written to again.
- **Interest check, Not for me / A different time.** The member comes off the draft and **stays waiting**, with their times kept. A different time records which of the four slots suit them better, and the draft card lists them under "Left the draft by answering".
- **Stop these emails.** Ends every Desk email to that member and cancels their open proposals and any Desk email still queued. The link keeps working for 37 days so Stop always works.
- **No answer.** After the window (default 48 hours) the check closes as "No answer in time". **Nobody is placed by silence.**

### Rehearsal first

The Switchboard has three positions for **Leader Desk**:

- **Off.** The page is closed. Nothing is sent.
- **Rehearsal.** The Sending tab and the buttons work, but **nothing is sent**. Each press writes down who would have been emailed, and the **Sending** tab lists them ("Would have been sent"). Rehearsal lines are counted apart from real ones, so trying it out never uses a member's real allowance.
- **On.** The emails are queued and sent, **between 9 am and 7 pm Lagos time** (outside those hours they wait until 9 am). The Master pause stops them whatever the switch says.

**Keep it on Rehearsal until Phase 1 has been used for a week and a pastor has approved the Lead signal v1** (the blueprint's gate). Pressing **Email a proposed group** or **Check interest** always asks twice: the first press shows what would be sent, the second confirms.

### Who is never written to

Under 18, a deletion request, an address that bounces, email switched off, announcements stopped, an open care follow-up, anyone who pressed **Stop these emails**, and the owner or hidden accounts. Only members still waiting are written to; a member who has been placed since is left out and counted.

### Limits (Sending tab → Limits)

| Limit | Starts at | Range |
|---|---|---|
| Emails a day | 40 | 1 to 300 |
| Days between one member's emails | 7 | 1 to 60 |
| Emails to one member in a season | 3 | 1 to 10 |
| Hours to answer an interest check | 48 | 12 to 240 |

Each change needs a reason (3 to 300 characters). Only you see it; the log line says settings changed, with no numbers and no reason. Changes apply from the next email.

### Withdrawing

**Withdraw** on any email nobody has answered. Its private page then says the proposal is closed, and a queued email that has not gone is not sent.

### The scheduled tick

`/api/cron/tick` now also calls `worker_desk_tick`, which closes interest checks nobody answered and tidies old links. If it fails, the fault is listed in the tick's `problems` with the others.

### Privacy

No number, no other member's name, nothing about faith, stage, support or age is in either email or on the private page. The reasons are only about the goal, the place and the time. Log lines (`desk.proposal`, `desk.answer`, `desk.stop`, `desk.settings`, `desk.cancelled`) carry no numbers and no reasons.

## Phase 2b-1: asking a member to lead a draft group

**Where:** **Proposals** tab → a draft group → **Recommend a leader**. Offers are listed together under **Sending → Leader offers**.

1. **Choose.** The list is members who could lead this group, best first, each already past every rule below. Choose **one to ask now** and up to **two backups, in the order you pick them**. The first press shows who will be asked; the second confirms (**Ask them**, or **Write it down** in Rehearsal).
2. **The email.** *Would you lead this group?* It names the community, goal, meeting time, format and size so far and, if an interest check ran, how many have said yes. **It names nobody.** It says plainly that a yes is not the end of the process: a pastor still approves the card and the Academy still certifies the leader.
3. **The private page** (`/o/…`). Opening it changes nothing; an answer is saved only when a button on it is pressed.

| Button | What it does |
|---|---|
| **Yes, I will lead** | Asks for a confirmation that they are **21 or older** and two short answers (how they lead best; whether they have achieved or are pursuing the goal). Only then is anything saved. |
| **Not this season** | Declines this group and any other asked of them this season. Five reasons can be ticked (too busy, family first, not ready, a different goal, something else). **They are counted and shown to nobody by name.** |
| **Call me** | Marks the offer "Asked for a call" on the Desk. |
| **Remind me tomorrow** | One more email tomorrow, if the window is still open. |
| **Never ask me to lead** | Stops every leader offer to them. Other Desk emails continue. |
| **Stop these emails** | Ends every Desk email to them and cancels their open offers. |

**72 hours to answer.** Reminders go **24 and 12 hours** before it closes. If the first person says no, never answers, or no longer fits, **the next backup is asked automatically**, unless you press **Pause backups** on that group. When nobody is left, the group says **it has no leader and needs your decision**.

### Who can be offered a group

Members only (a leader who already holds the role keeps using the Leader board). Each of these is checked when you choose, and **again at the moment of the yes**: 21 or older (confirmed by the member), said yes or maybe to serving, established or leading in faith, not already leading, no open offer, no hold, no open care follow-up, no deletion request, a reachable email, a gender that fits a women's or men's group, meeting times that include the group's slot, a goal that is not a sensitive subject, "Not this season" and "Never ask me to lead" honoured, and nobody who pressed **Stop these emails**.

### What a yes does

A yes goes through **one shared step**, the same one the owner's own **Appoint a leader** uses (`leader_appoint_core`). The Desk adds only a yes from the member and the confirmed age.

- **The leader is recorded as appointed**, so the Leader board, coach assignment, the welcome email and card reminders work unchanged.
- **The tribe card is started from the draft.** Track, community, goal, meeting slot, format, area (for an in-person group), kind and seats are **locked**, so a later edit cannot move the tribe away from the people it was formed for. The leader names it, tells their story and chooses the day and time **inside the slot**. A pastor still approves the card and the Academy still certifies the leader. The database enforces the locks, not only the page.
- **Below the usual fit,** the offer waits for you: **Appoint them** or **Decline for them**. Nothing is created until you choose.
- **The draft's members who have not said no get "Your group has a leader":** the leader's first name, no seat promised, and **Yes / Not for me**. Their place is confirmed by the normal "Your tribe" email when the tribe opens.
- **A group that has a leader** shows where it stands: the card's state and whether the Academy has certified them.

### Rehearsal first

Same three positions as before. In **Rehearsal** each offer is only written down ("Written down in Rehearsal"), nothing is emailed, and the first person is not marked as asked. The Master pause stops every send. **Keep the switch on Rehearsal until Phase 1 has been used for a week and a pastor has approved the Lead signal v1.** Nothing is sent by WhatsApp.

### The scheduled tick

Offer expiry, backups and the 24 and 12 hour reminders run inside the same `worker_desk_tick` the cron already calls. Nothing new to wire.

### Applying and undoing it

* **Apply:** `supabase/migrations/20270118000100_desk_offers.sql`, after Phase 2a. It stops with a clear message if Phase 2a, the leader appointment, the leader welcome or the tribe card migration is missing. See `docs/APPLY-LEADER-DESK.md`.
* **Undo:** `supabase/rollback/20270118000100_desk_offers.down.sql`. It puts back the six functions it replaces exactly as they were, narrows the two checks it widened, and removes its 24 new Desk functions, `leader_appoint_core`, three tables and the new columns. `tests/db/leader-desk-offers-rollback.test.ts` rehearses it.
* **It replaces six existing functions:** `god_appoint_leader` (now a thin wrapper over the shared step: same checks, same rows, same event), `save_tribe_card` (honours the locks), and, from Phase 2a, `desk_mail_send`, `worker_desk_info`, `worker_desk_answer` and `desk_tick` (they learn the third kind of email). **It adds 25 functions** (7 the page calls, 2 the private page calls, 16 closed to every signed-in person), **3 tables** and settings columns.
* **Privacy:** no number, no other member's name and nothing about faith, stage or support in either email or on the private page. Log lines carry no numbers and no reasons.

### Not built in 2b-1

* **"Yes, as assistant"** (assistants offered together with a leader). Offers are for the leader role only.
* **"Recommend as leader" on a waiting member's row.** The picker is on the draft group card.
* The pastor "card waiting" email and 24 hour reminder, **Open tribe**, the parity test, and the pipeline limits and "stuck" chips (Phase 2b-2). The settings columns for them are already in the database; nothing reads them yet.

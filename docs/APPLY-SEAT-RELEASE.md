# Package 7, release at the end of the series, the leader's 5 pm note, the office's 7 am email, and "I need to leave this tribe": how to apply

Everything before must already be applied, up to and including Package 6, the seat window (`20270120000100_seat_window.sql`), and Package 5, the six-day contact series (Reach series).

**It has a switch and starts Off.** Until you move **Release at the end of the series** to **Rehearsal** or **On** in God Mode → Features, the end of the series behaves exactly as it did. **Rehearsal writes down who would be released and sends nothing.** The leader's note, the office's email and the member's **Leave this tribe** card follow the **Seat window** switch, which you already control: while **Seat window** is **Off**, there is no **Leave this tribe** card and the call does nothing. On **Rehearsal** the card is there and a leave is real (it is the member's own decision), but no replacement is offered; on **On** the seat is offered on at once.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270121000100_seat_release.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('reach_release_gate','reach_release_seat','my_tribe_leave_state','my_tribe_leave','seat_notes_tick','seat_morning_numbers','seat_morning_tick');`
   It should say **7**.
   `select key, default_position from public.feature_registry where key = 'reach_release';` should say **off**.
3. **Then the website.** It adds the member's **Leave this tribe** card on **Your tribe** (a quiet link at the bottom, with the reasons list), the two new emails and the **Seat release** message in Admin → Messages.

Run the database file **first**. If the website goes out first, the **Leave this tribe** card says leaving is not available yet.

The file replaces three functions (`reach_step`, `seat_ledger_write` and `worker_seat_window_tick`). Their old text is in the rollback file, so you can go back exactly.

## What it does

**At the end of the six-day series** (when Reach series ends with a person still not reached), the setting **At the end of the series** on the Reach series card decides who loses the seat:

- **Silent** (the default): only people who did nothing at all: no link opened, no sign-in, no activity, and all four emails delivered.
- **Everyone**: also people who opened a link but never gave a number.
- **List**: nobody is released automatically; the person goes on the office's list as before.

A release is the same release as in Package 6: it writes a released clock, so the seat has the same log, the same **seven days to take it back**, the same replacement from the bench and the same safety stops. The member gets one kind email (it says how many emails we sent and never says whether they were opened) with a take-back link. A member who chooses **Email me instead** is counted as having answered and keeps the seat.

**The leader's note, at 5 pm Lagos time**, once a day, only when something changed: who said yes (first names, up to four), how many seats opened and why in counts only (did not reply, chose to leave), how many are still waiting, and how many seats are free. It never names anyone released or who left, and never gives a reason.

**The office's email, at 7 am Lagos time**: the morning numbers (seats put on a clock, kept, answered, released, taken back, replaced, and the tribes with an open seat). It is marked urgent only when a safety stop has paused releasing.

**Leave this tribe** (the member's own page). The member picks an optional reason from a short list (time, place, fit, other; never free text), and the seat opens at once. The leader is told in counts only, at 5 pm. A member can leave until the date shown. After the first 14 days it says to talk to the coach or the office; nothing is created automatically. A voluntary leave has no take-back.

**Before you move it to On**, the page tells you if anything is red: a late heartbeat, failing emails, or automatic placement not On. The switch refuses On until they are green, and says which check is red. Nothing is ever released outside 9 am to 7 pm Lagos time.

## Check it works (twenty minutes, on Rehearsal)

1. **God Mode → Features → Release at the end of the series** is **Off**, and says it needs **Reach series** and **Seat window** On. Move it to **Rehearsal**.
2. Let a test series run to its end (or wait for a real one). On Rehearsal nothing is released: each person who **would** be released is written to the event log as `reach.would_release` (with the outcome and tribe), and anyone who must never be released as `reach.release_held` (with the reason). Check in the SQL editor:
   `select at, action, entity_id, meta from public.event_log where action in ('reach.would_release','reach.release_held') order by at desc limit 20;`
   Check **Messages**: no email was made.
3. As a member of a test tribe, open **Your tribe**. The **Leave this tribe** card is at the bottom, saying until when. Do not press it on a real member.
4. Check the **Seat release** and **Leader seat note** samples in Admin → Messages: neither shows a phone number, and neither says a member "ignored" or "did not read" anything.
5. As a member, a pastor and an admin, try `/god/features`: only the unlocked owner gets in.

Start with one community or one tribe (use the switch's scope) and watch the first release on a weekday morning.

## What it never does

Never releases a seat for someone who answered, said yes or chose it, who is under 18, who asked for deletion, who pressed Stop, whose email bounced or whose announcements are off, who has a care follow-up open, whose seat the office is holding, or who asked for a call that has not been made. A series whose emails did not all arrive ends as **Not reached** and is not released. A Master or office pause freezes everything. A release held back by a safety stop is **not retried** (the series has already ended); it is logged as `reach.release_held` and goes on the office's list.

## Known limits (so nobody is surprised)

- A replacement placed after a release is labelled **owner** in the placement log (the existing `placed_via` list has no other word for it).
- A member who leaves cannot take it back.
- The first **Your tribe** email does not yet state the 48-hour deadline.
- A leader is not told separately when a minor's seat is released (minors are never released automatically; the care-lead notice is not built).

## Go back

Switch **Release at the end of the series** to **Off** first. Then run `supabase/rollback/20270121000100_seat_release.down.sql`. It removes the switch, the seven functions and the two triggers, and puts the earlier `reach_step`, `seat_ledger_write` and `worker_seat_window_tick` back exactly as they were. Seats already released stay released and can still be taken back until their date. People who left stay left. Emails already sent stay sent. Put the website files back before you run it.

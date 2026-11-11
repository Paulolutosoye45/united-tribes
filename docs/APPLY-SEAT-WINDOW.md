# Package 6, the seat window (the 48-hour clock): how to apply

Everything before must already be applied, up to and including Leader Desk Phase 2b-2 (`20270119000100_desk_open.sql`) and the placed answer sequence (`20270114000100_placed_answers.sql`).

**It has a switch and starts Off.** Until you move **Seat window** to **Rehearsal** or **On** in God Mode → Features, no seat has a clock and nobody is told anything. **Rehearsal writes down what each clock would do and sends nothing.**

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270120000100_seat_window.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname like 'seat\_%' or proname like 'worker\_seat\_%' or proname like 'god\_seat\_%';`
   It should say **48**: the 47 this file adds, plus `seat_said_yes` from the Said-yes package. (The file also adds `tribe_members_cap_guard` and replaces `placed_seq_block`, which this count leaves out.)
   `select key, default_position from public.feature_registry where key = 'seat_window';` should say **off**.
3. **Then the website.** It adds Admin → People → **Seats**, the owner's **Seat window** numbers under God Mode → Features, the leader's "Seats waiting for a yes" strip on the Tribe Card, the member's page `/seat/…`, and two extra calls in `/api/cron/tick`.

Run the database file **first**. If the website goes out first, the Seats page says the seat window is not available yet.

**This also fixes something that was missing.** The cron route did not call `worker_placed_seq_tick` before. It does now, so the placed answer sequence's own steps run on every tick, as the earlier package intended.

## Check it works (twenty minutes, on Rehearsal)

1. **God Mode → Features → Seat window** is **Off**. The **Seat window** card below the switches shows 48, 24, 40, 7, 3, 30 and 70.
2. Move it to **Rehearsal**. Open **Admin → People → Seats**: it says Rehearsal, nothing moves, and lists the seats that would be put on a clock. Only seats whose first "Your tribe" email went **after the day you switch it on** are counted, so older placements are never touched.
3. Open a seat: its log shows what each step would do. Check **Messages**: no email was made.
4. Press **Send me a test** (office roles): an email arrives with `[Test]` at the start of the subject, addressed only to you.
5. Open the Tribe Card as a leader whose member is waiting: the strip shows first names and the time left, and **Ask for 48 hours more**, once.
6. As a member, a pastor and an admin, try `/god/features`: only the unlocked owner gets in.

**Before you move it to On**, the page tells you if anything is red: a late heartbeat, failing emails, or automatic placement not On. The switch refuses On until they are green. Start with one community or one tribe (use the switch's scope) and watch the first release on a weekday morning, between 9 am and 7 pm Lagos time. Nothing is ever released outside those hours.

## What it never does

Never releases a seat for someone who said yes or chose it, who is under 18, who asked for deletion, who pressed Stop, whose email bounced or whose announcements are off, who has a care follow-up open, whose seat the office is holding, or who asked for a call that has not been made. A seat whose first email never arrived is marked **Not reached** and is never released. A Master or office pause freezes every clock and keeps the time each has left. Three safety stops (a quarter of a tribe in one day, thirty releases in a day, a quarter of the last twenty emails failing) pause releasing and tell the admin at once.

## Go back

Switch **Seat window** to **Off** first. Then run `supabase/rollback/20270120000100_seat_window.down.sql`. It removes its tables and functions and puts the earlier `placed_seq_block` back exactly as it was. Seats already released stay released; replacements already placed stay placed (they are ordinary placements). Emails already sent stay sent; the take-back link in them will say it has run out. Put the website files back before you run it.

# Package 8, the seat autopilot: how to apply

Everything before must already be applied, up to and including Package 7, release at the end of the series (`20270121000100_seat_release.sql`), and Package 6, the seat window (`20270120000100_seat_window.sql`).

**It has a switch and starts Off.** Until you move **Seat autopilot** to **Rehearsal** or **On** in God Mode → Features, nobody is placed by it and nothing is sent. **Rehearsal writes each day's plan down and places nobody.** It needs **Seat window** On (the switchboard does that itself: a tribe whose seat window is not On is left alone). The switch refuses **On** while a seat-window check is red, and says which one.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270122000100_seat_autopilot.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('autopilot_any','autopilot_gate','autopilot_degree','autopilot_season','autopilot_bench','autopilot_plan_build','autopilot_apply_core','autopilot_tick','autopilot_overview','autopilot_approve','autopilot_pause_set','god_autopilot_settings','god_autopilot_settings_set');`
   It should say **13**.
   `select key, default_position from public.feature_registry where key = 'seat_autopilot';` should say **off**.
3. **Then the website.** It adds the **Autopilot** panel to **Admin → Seats**, the owner's **Seat autopilot** card in God Mode → Features, the **Placements are ready for you to approve** email in Admin → Messages, and two lines in the 7 am seats email.

Run the database file **first**. If the website goes out first, the Seats page simply does not show the panel and the owner's card is not shown.

The file replaces two functions (`seat_morning_numbers` and `worker_seat_window_tick`). Their old text is in the rollback file, so you can go back exactly.

## What it does

**Once a day, between 8 am and 7 pm Lagos time**, while joining is open (and for a number of days after it closes, set by the owner), autopilot:

1. **Makes the bench**: members with a finished form who agreed to be matched, hold no seat, are on no seat clock, and did not change their answers in the last 7 days.
2. **Makes a plan**: each bench member goes to their best fit at the bar or above (the bar starts at 70%; within 5 points, the tribe with fewer members wins).
   - A tribe that already has the smallest size (5) is **filled one person at a time**, up to its capacity less the seats kept free for people who choose for themselves, at most 2 new members a day to one tribe.
   - A tribe with fewer people is **opened only when that many people fit it** at the bar, together, as a team. It never puts one person alone in a tribe.
   - At most 25 placements a day.
3. **Places the plan**, the way the switch and the setting say:
   - **Rehearsal**: the plan is written down (Admin → Seats shows it) and nothing else happens.
   - **On, Suggest** (the way to start): the admin and the director get one email, **Placements are ready for you to approve**. The Seats page shows each person, their tribe and their fit, and one tap, **Place them**, places the lot. A plan nobody places **runs out at midnight**; a new one is made the next morning.
   - **On, Auto**: it places at the first beat after 9 am by itself.

Every person is placed through the **same door as the office's own placement**, so the same checks, the **Your tribe** email, the consent check, the leader's email and the **Undo** apply to each of them. Each is logged as placed by autopilot. The page and the database both check again just before each person, and a person who changed their answers, asked to be left out or whose tribe filled up first is **skipped, with the reason in words** in the plan.

**The Seats page** also shows who is still waiting for a seat, against the seats open for each kind of tribe; how many are held back only by the bar; and the **small tribes**: a tribe still under the smallest size after the days the owner set, with a suggested merge (which tribe, and how many of its members fit it) or **Hard to fill** with the reason in words (nobody waiting, nobody who can meet at its time, nobody who can meet the way it meets, or nobody who fits). These figures are counted once, when the day's plan is made, so they cannot disagree with the plan beside them, and the page says when.

**The owner's numbers** (God Mode → Features → **Seat autopilot**, owner only, each change needs a reason that is kept in the log): Suggest or Auto, the bar (60 to 95%), new members to one tribe in a day (1 to 4), placements in a day (5 to 100), the days it keeps placing after joining closes (0 to 30), and the days before a tribe is called small (5 to 30). A change applies from the next plan; a plan already made keeps the numbers it was made with.

**Stop autopilot** (Admin → Seats, for the admin, a director or a pastor; a reason is needed and kept): nothing is planned or placed until it is started again. People already placed stay placed.

**The 7 am email** to the office gains two lines, only when there is something to say: how many people autopilot placed yesterday, and how many placements in yesterday's plan ran out because nobody placed them.

## Check it works (twenty minutes, on Rehearsal)

1. **God Mode → Features → Seat autopilot** is **Off** and says it needs **Seat window** On. Move it to **Rehearsal**.
2. Wait for the next beat after 8 am (or the next morning). On **Admin → Seats**, **Autopilot** shows **Rehearsal**, and **Today's plan** lists who **would be placed** and where. Check a few by hand: each person's fit is at or above the bar, no tribe is over its capacity, and no tribe of fewer than 5 gets a single person.
   Check **Messages**: no email was made.
3. Look at **Waiting for a seat** and **Small tribes**: the counts match what you know.
4. Check the **Placements are ready for you to approve** sample in Admin → Messages: it shows no phone number, and it says the same email and the same Undo apply.
5. As a member, a coach and a data lead, try `/god/features`: only the unlocked owner gets in. A data lead sees the Autopilot panel on Seats but not the buttons.
6. When the rehearsal plans look right for a few days, move the switch to **On** with the setting on **Suggest**, for one community or one tribe first (use the switch's scope), and place the first plan yourself on a weekday morning. **Auto** only after the Suggest days have looked right.

## What it never does

Never places someone below the bar, into a full tribe, who is under 18, who has not agreed to be matched, who changed their answers in the last 7 days, or who is on a seat clock. Never changes a confirmed seat. Never removes anyone. Never places a person alone in an empty tribe. A Master or office pause, and **Stop autopilot**, freeze it. It never writes to anyone itself: the only email a member gets is the same **Your tribe** email a placement by hand sends.

## Known limits (so nobody is surprised)

- A person it places is labelled **owner** in the placement log (the existing list has no other word); the seat log says **autopilot**.
- For each plan it looks at the first 60 people who have waited longest, against up to 80 tribes. A bigger waiting list is cleared over the following days.
- One plan a day. A plan not placed that day is not carried over: a new one is made the next morning from the people still waiting.
- The first batch that opens a small tribe is not held to the 2-a-day limit for one tribe (the team has to arrive together); it still counts against the 25 a day.
- The page does not yet have a one-tap **Ask the office to move** for a small tribe: the merge suggestion is for a person to act on.
- **Undo** is the existing one, for each placement, as for a placement by hand. There is no single undo for a whole plan.

## Go back

Switch **Seat autopilot** to **Off** first. Then run `supabase/rollback/20270122000100_seat_autopilot.down.sql`. It removes the switch, the thirteen functions, the two triggers and the three tables, and puts the earlier `seat_morning_numbers` and `worker_seat_window_tick` back exactly as they were. People already placed stay placed and can still use Undo until it ends. Emails already sent stay sent. Put the website files back before you run it.

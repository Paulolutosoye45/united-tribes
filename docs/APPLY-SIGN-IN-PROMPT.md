# The sign-in prompt: how to apply

Everything before must already be applied, up to and including the Leader Desk extras (`20270125000100_desk_extras.sql`). The file stops with a clear message if the placement answers, the reach series, the leader board or the Switchboard is missing.

## What problem it solves

Some members say they never see the emails. Email is one road to a person. This adds a second road they walk **every time they sign in**: a screen on top of the page they asked for, showing the first thing they owe the church and the button that does it. It applies to **members, prospective leaders and certified leaders alike**, and it never replaces the emails: they carry on exactly as before.

**It has a switch and starts Off.** Until you move **Sign-in prompt** to **Rehearsal** or **On** in God Mode → Features, nobody sees anything.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270126000100_sign_in_prompt.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname like 'prompt\_%' or proname in ('my_prompt_queue','god_prompt_settings','god_prompt_settings_set');`
   It should say **17**.
   `select key, default_position from public.feature_registry where key = 'sign_in_prompt';` should say **off**.
3. **Then the website.** It adds the screen (drawn once, in the layout every signed-in page shares), the **Sign-in prompt** counts on the **Placed members** board, and the owner's **Sign-in prompt** card in God Mode → Features.

**If a file stops with "must be applied first" or "already exists":** do not run files again to see what happens. Paste `supabase/check-applied.sql` into the SQL editor (it only reads) and it lists the files this database has not had applied, or had only half applied, oldest first. Apply the oldest missing one first, then carry on in order.

Run the database file **first**. If the website goes out first, the screen simply never appears (the database says nothing is owed) and the counts and the owner's card are not shown. The file replaces nothing, so there is nothing to put back by hand.

## What a person sees

A **visit** is a fresh sign-in, or the first page after the person has been away for **4 hours** (the owner can change it). At the start of a visit the database picks **at most three** of the tasks the person owes, most important first, and the screen shows them one at a time ("1 of 3") over the page they asked for. The database remembers the visit, not a browser cookie, so a reload keeps the screen and a different device does not disagree.

| Order | Task | Who | What the screen offers |
|---|---|---|---|
| 1 | Placement | a member the church placed who has not answered | **Yes, I'm in**; where the placed answers are On: **Not this season** (with a confirmation step) and **Call me** |
| 1 | Interview | a prospective leader invited to book a time | the open times, one tap each |
| 1 | Offer to lead | a leader with an offer on the leader board | **Yes, I'll lead** / **No, not this time** |
| 2 | Parent or guardian | a member under 18 whose guardian has not said yes | opens their tribe page |
| 2 | First check | a prospective leader asked to agree to the application's first check | opens the application |
| 3 | WhatsApp number | an adult member or leader with no usable number | the number box, saved in place; the yes to WhatsApp is its **own tick, never ticked for anyone** |
| 3 | WhatsApp yes | an adult with a number and no answer | **Yes, message me on WhatsApp** / **No thanks** (a No is final) |
| 4 | Joining form | a member who started it and did not send it | opens it |
| 4 | Application | a prospective leader with it in draft | opens it |
| 4 | Tribe Card | a leader whose Tribe Card is not sent | opens it |
| 5 | Care | a leader or care lead with care tasks due | opens them |

**Not now** closes a task **for that visit only**; it comes back at the next sign-in. A person who goes to a page to do a task ("Open it") is not shown a second screen on top of it; whatever else is owed waits for the next sign-in. **Not now is refused for a placement only in the last 6 hours before its seat is released**, so nobody is pushed into a yes: the three answers stay, and the screen says nothing is decided for them.

**Not in this release** (no safe single answer to record yet): the details check, training lessons, the weekly update.

## How it avoids conflicts

* **One judge.** Every answer is recorded by the function the site already used for it (`placement_my_confirm`, `leader_offer_respond`, `book_interview_slot`, `reach_apply_number`, and for "Not this season" and "Call me" the same steps as the private page). The task ends the moment the real answer is recorded, whether it came by email, on the screen, or by phone with the office. A second answer is told it is already recorded.
* **The email series, the seat clock and the autopilot are not touched.** Their own triggers end their emails when the answer is recorded, however it arrived.
* **The banners and boards are not touched**: the number and WhatsApp banners and the placement boards re-draw from the same state.
* **Nobody is prompted who should not be**: the platform owner (locked or unlocked), a hidden account, anyone with a deletion request open. An under-18 is never asked for a number or WhatsApp.
* **The owner's console** (`/god`) never has the screen over it.
* **The Master pause** stops it, as it stops every other switch.

## Rehearse first (three days, then one tribe)

1. **God Mode → Features → Sign-in prompt** is **Off**. Move it to **Rehearsal**. **Nobody sees a screen.** The database writes down who *would* have seen which task.
2. After a day, open **Admin → Placed members → Sign-in prompt**: the counts say how many people would have seen each task. Check they match what you know (the number of placed members who have not answered, the leaders with no number). The board shows counts only, never a name or a number.
3. After three days of sensible counts, move it to **On** with the scope narrowed to **one tribe** (use the switch's scope). Sign in as a member of that tribe who has not answered: the screen opens on top of the page; Yes records the answer; Not now closes it until the next sign-in.
4. Watch the board for the same counts again: **shown**, **answered**, **not now**, **opened the page**. A number of people who put the same task off five times in a row appears as "worth a call" (a count only).
5. When it looks right, widen the scope.

## The owner's numbers

God Mode → Features → **Sign-in prompt** (owner only, each change needs a reason of 5 to 300 characters, kept in the log; a change applies from the next visit):

| Number | Starts at | Allowed |
|---|---|---|
| Hours away that start a new visit | 4 | 1 to 48 |
| Tasks in one visit | 3 | 1 to 5 |
| Hours before a seat is released with no "Not now" | 6 | 0 to 48 |
| "Not now" in a row before a call is worth it | 5 | 3 to 20 |

There is also a switch for each kind of task, so one kind can be turned off without stopping the rest.

## What it never does

* Decide anything for a person: every answer is theirs, and "Not now" is always a way out except in the last hours of a placement, where the other answers remain.
* Tick the yes to WhatsApp for anyone, or ask again after a No.
* Write a phone number, an address or the words of an answer to its log. The log holds the kind of task and what happened (shown, would have shown, answered, not now, opened), for 90 days.
* Send an email or a WhatsApp message. It is a screen, not a message.

## Undo

`supabase/rollback/20270126000100_sign_in_prompt.down.sql`. Switch **Sign-in prompt** to **Off** first. It drops the 17 functions, the four tables and the switch's line. **The answers people gave on the screen stay where they are** (they were recorded by the site's own functions): a yes to a placement is an ordinary placement. The prompt's own memory (visits, the log, the "not now" counts) goes with its tables; copy `prompt_log` first if you want it. See `tests/db/sign-in-prompt-rollback.test.ts`.

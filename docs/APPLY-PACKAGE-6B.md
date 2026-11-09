# Package 6b: The placed answer sequence, the monitor and the call desk (how to apply this package)

This zip holds **only the files that changed** since Package 6a (`united-tribes-package-6a.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270113000100_placed_nudge.sql` (Package 6a).

**It has a switch and starts Off.** Until you turn **Placed answer sequence** on in God Mode, nobody sees anything new and nothing is sent. **Nothing in it goes to WhatsApp or Meta, and there is nothing to add to your hosting settings.**

## What is in it

| | What | Read |
|---|---|---|
| **The sequence** | After the placement email, each placed member who has not answered gets a short note at 24 hours, "Still held" every 3 days and a last call the day before joining closes. Each names the day, and nothing is sent to anyone who has answered. | `docs/PLACED-ANSWERS.md` |
| **The member's page** | New answers beside yes: **Not this season**, **Call me**, **Remind me tonight**, **Stop these reminders**, **Don't call me**. Opening the page saves nothing. | the same |
| **The board** | **Admin → Placed members**: from placed to answered, with who needs a call at the top, by tribe, with email health. Names and steps, never a number. | the same |
| **The call desk** | The members to phone, with the number shown only when someone presses **Show number** (each press is written down, never the number). Outcomes from a short list. | the same |
| **The leader's line** | One plain sentence a leader may add under **Lead → Tribe Card**, shown as "Ngozi adds: …" in the emails. | the same |
| **Owner and Today** | Seven numbers and a download switch under **God Mode → Features → Placed answer sequence**, and a line on **Today**. | the same |
| **Guide** | **A3** has a new part, **Follow up the members who have not answered**. | |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone.** Everything is Off until you move the switch.
3. **Check the closing day.** In **Admin → Reminders**, *Days after the season starts that joining closes* should say **21** (that is Sunday 22 November for a season that began on 1 November). If it says 14, change it to 21 **before** you turn the sequence on, because every email names that day.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270114000100_placed_answers.sql`

   It adds eight tables (the settings, the sequence, what each email sent, each member's answers, each call, each hold, each number reveal, each download), 47 functions and a trigger that ends the sequence the moment a seat is answered by any route, replaces two existing functions (the weekly limit now counts these emails; trying a failed email again knows about them), and adds one column (a leader's line). No existing row is changed.
2. **Check**, in the SQL editor:
   `select count(*) from public.feature_registry where key = 'placed_answers';`
   It should say **1**.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, the page and the board simply behave as before until the file is run, and nothing breaks.

## Turn it on gently (God Mode → Features → Placed answer sequence)

1. **Rehearsal, whole church.** Open **Admin → Placed members**. It shows how many seats are in the practice run and what each step **would** send. Nothing is sent.
2. **On, for one tribe.** Put one tribe on and watch the board for a day: the funnel, the health strip, and **Call desk**.
3. **On, whole church.** Then watch **Needs a call** and ring those who asked.

If anything looks wrong, press **Pause the sequence** on the board (the owner can also move the switch to **Off**). The page goes back to today's answers at once, and a link already in someone's inbox still works.

## Check it works (twenty minutes)

1. With the switch **Off**: the member page has its three buttons, **Today** has no new line, and the board says the sequence is Off.
2. Set it to **Rehearsal**: the board shows practice counts and sends nothing.
3. Set it **On for one test tribe**. Within the heartbeat's next beat a waiting member gets one email (a member placed days ago gets **Did this reach you?**; one who opened their page gets **Anything stopping you from joining?**). It has the day, five buttons, no phone number and the sentence about the office calling.
4. Open the link on a phone. Opening saves nothing. Press **Call me**, choose **Evening**, type a good number: the page says someone will call. A wrong number stops the press and the page says so.
5. **Admin → Placed members → Call desk**: the member is under **Asked for a call**, the number is hidden. Press **Show number**, call, choose an outcome, **Save the call**.
6. On another test member press **Not this season**: the seat is released and no more emails go. On a third press **Stop these reminders**: no more emails, the seat stays.
7. As a pastor, open **Placed members**: you can read the board, and there is no Call desk tab.
8. As the owner, **Allow the call desk download with numbers** is off. Leave it off unless you need it.

## Things to know

* **It never moves, releases or confirms anyone on its own.** A member who does not answer stays where they are. Package 6 (the 48-hour clock, release and replacement) is the one that will act on silence, and it comes after this.
* **Last call is the last email.** Nothing follows it, and it is exempt from the weekly limit so a member is never left without it.
* **A member with a bouncing email** is not on **Worth a call**. Reach them another way.
* **It stops itself** if, after 50 or more emails, more than 1 in 100 stop announcements, 1 in 1,000 mark spam or 1 in 20 bounce. It tells the director and the admin.
* **The Master pause** holds it like everything else.

## The way back

If you ever need to undo the package, run `supabase/rollback/20270114000100_placed_answers.down.sql`. It withdraws any email of the sequence still waiting, puts the two replaced functions back exactly as they were, and removes the new functions, the trigger, the switch and the eight tables. Like every way back in this project it alters no table, so the leader's line (an empty column) and the longer list of hold sources stay; the migration can be applied again over both. Seats a member gave up with **Not this season** stay released, and the member stays kept out of automatic placement: the hold becomes an ordinary hold with the note "Not this season", and it stays until it is lifted in God Mode.

## Existing files this package changes

* **Database:** one new migration and its way back (above).
* **The member's page:** `src/app/(public)/placed/[token]/page.tsx` and `actions.ts`.
* **The heartbeat:** `src/app/api/cron/tick/route.ts` (the sequence is looked at once per beat, before the messages go).
* **Messages:** `src/lib/messaging/templates.ts` (the new email is registered).
* **Admin:** `src/app/(app)/admin/page.tsx` (the line on Today), `src/lib/admin/nav.ts` (one new page), `src/lib/auth/roles.ts` (two role lists).
* **Owner and leader:** `src/app/(app)/god/features/page.tsx` and `actions.ts`, `src/app/(app)/lead/tribe/page.tsx`, `src/lib/features/types.ts` (the new switch).
* **New:** `src/lib/placement/answers.ts`, `answers-server.ts`; `src/lib/messaging/templates-placed-seq.ts`; `src/app/(app)/admin/placed/` (the board, By tribe, Call desk, the download and their actions); `src/components/placed/`, `src/components/god/PlacedAnswersSettingsCard.tsx`, `src/components/leaders/SeatLineCard.tsx`; `src/app/(app)/lead/tribe/seat-line-actions.ts`.
* **Guides:** `src/lib/guides/content/contact-gaps.ts` (a new part).
* **Docs:** new `docs/PLACED-ANSWERS.md`, this file; `docs/MESSAGES-AUDIT.md` (regenerated: one more message).

## Existing tests this package changes (all disclosed)

* `tests/db/foundation.test.ts`: the new screen functions are added to the list the app may call, and the three page functions to the list a signed-out visitor's page may call. Nothing checks less than before.
* `tests/unit/features-switchboard.test.ts`: the new switch is on the list of functions.
* `tests/unit/admin-nav.test.ts`: thirty-two pages instead of thirty-one.
* `tests/unit/fixtures/message-params.ts`: a sample for the new email.
* `e2e/journeys/36-profiles.ts`, `e2e/journeys/39-my-page-for-everyone.ts`: each counted the functions the Switchboard can move (sixteen); there are now seventeen. Nothing checks less than before.
* `scripts/rehearse-rollback.sh`: the two new database test files are on the list of new tests.
* New tests: `tests/db/placed-answers.test.ts` (56), `tests/db/placed-answers-rollback.test.ts` (9), `tests/unit/placed-answers.test.ts` (44), and the journey `e2e/journeys/53-placed-answers.ts`.
* No existing rollback test, email golden file or other test changed.

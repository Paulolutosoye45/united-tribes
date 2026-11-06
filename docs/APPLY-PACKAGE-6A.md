# Package 6a: The placed-member nudge (how to apply this package)

This zip holds **only the files that changed** since Package 5b (`united-tribes-package-5b.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270112000100_admin_remove.sql` (Package 5b).

**It has a switch and starts Off.** Until you turn **Placed nudge** on in God Mode, nobody sees anything new and nothing is sent. **Nothing in it goes to Meta, and there is nothing to add to your hosting settings.**

## What is in it

| | What | Read |
|---|---|---|
| **The nudge** | An ordinary announcement the office sends to the members the church placed who have not yet said yes: email only, one private link each, never more than twice per member and never twice in three days. | `docs/PLACED-NUDGE.md` |
| **The member's page** | Two buttons that both say yes to the tribe: **Yes, I'm in, and message me on WhatsApp** (the only one that agrees to WhatsApp) and **Yes, I'm in, email only**. Opening the page saves nothing. | the same |
| **Links that run out** | A link older than 60 days now says so and offers **Send me a fresh link**. The original placement email's link is covered too. | the same |
| **Number confirmed** | Contact gaps separates a number that is **saved**, one that is **agreed** to, and one that is **confirmed** (the number the member signs in with). It has a new column and a count, in the download too. | the same |
| **Today, the leader and the owner** | A **Placed members waiting** card on Today, a line on the leader's list ("The church reminded Ada on 6 Nov."), and three settings for you under **God Mode → Features → Placed nudge**. | the same |
| **Guide** | **A3, Find the members a leader cannot reach, and ask them** has a new part, **Nudge the members we placed**. | |

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to tell anyone.** Everything is Off until you move the switch.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270113000100_placed_nudge.sql`

   It adds four tables (the settings, a record of each nudge, a fingerprint of each private link, and a fingerprint of each confirmed number), 22 functions, replaces nine existing ones so the nudge can be counted and sent as an announcement, and adds one guard that stops a nudge being scheduled unless the function is On. No existing row is changed.
2. **Check**, in the SQL editor:
   `select count(*) from public.feature_registry where key = 'placed_nudge';`
   It should say **1**.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, the private page and the composer simply behave as before until the file is run, and nothing breaks.

## Turn it on gently (God Mode → Features → Placed nudge)

1. **Rehearsal, whole church.** Open **Admin → Announcements → New**, choose **Placed by the church, waiting for a reply**, and read the count and the reasons people are left out. Press **Use the nudge wording**, go to the next step, press **Send a test to me** and open it on your phone. Nothing can be sent to a member: the Send button is off.
2. **On, for one tribe.** Send one nudge to that tribe. Look at the result after a day: how many pressed each button and whether anyone stopped announcements.
3. **On, whole church.** Send.

If anything looks wrong, move the switch to **Off**. The member's page goes back to today's three buttons at once, and a link already in someone's inbox still works.

## Check it works (fifteen minutes)

1. With the switch **Off**: **Announcements → New** does not offer the placed audience, and **Today** has no new card.
2. Set it to **Rehearsal**. The composer offers it with a note. The count says how many are waiting and how many are left out, with reasons and no names. Write the nudge, send yourself a test: three links, a line about who can see a number, no phone number anywhere.
3. Set it to **On for one test tribe**. Send. Each waiting member in that tribe gets one email. A member who pressed **Don't share my details**, and one placed a few hours ago, get nothing.
4. Open one member's link on a phone. Opening it saves nothing. Press **email only**: the place is confirmed and no WhatsApp yes is saved. On another test member, type a wrong number and press the first button: the page says it does not look right and nothing is saved. Then use a good number.
5. As the leader, open **Lead**: a member still waiting shows "The church reminded …".
6. **Contact gaps** shows a **Number confirmed** column and "Confirmed on WhatsApp: x of y".

## Things to know

* **Joining stays open to Sunday 22 November**, so a nudge is still worth sending late in the second week. (Moving the date is a separate setting in Seasons, not part of this package.)
* **It never moves or removes anyone.** A member who does not answer stays where they are.
* **A number is "confirmed" only when it is the one the member signs in with.** The step where a member sends one message from their number ("Say hello on WhatsApp") and the **Number proof** switch need the live Meta number, so they come later. Nothing here waits on them.
* **No private link is kept.** Links are made at the moment each email is sent and stored only as a fingerprint. A retried email gets new links.
* **It stops itself** if, after 50 or more have gone, more than 1 in 100 people stop announcements. It tells the director and the admin.
* **The Master pause** holds a scheduled nudge like everything else.

## The way back

If you ever need to undo the package, run `supabase/rollback/20270113000100_placed_nudge.down.sql`. It cancels any nudge not yet sent, puts the nine replaced functions back exactly as they were, and removes the new functions, the switch and the four tables. Announcements already sent stay in the record as ordinary announcements.

## Existing files this package changes

* **Database:** one new migration and its way back (above).
* **Admin:** `src/app/(app)/admin/page.tsx` (the card), `src/app/(app)/admin/announcements/new/page.tsx` and `[id]/page.tsx`, `src/app/(app)/admin/people/contact-gaps/page.tsx` and `download/route.ts`. New: none.
* **Composer and email:** `src/components/outreach/AudiencePicker.tsx`, `Composer.tsx`, `Results.tsx`; `src/lib/outreach/email-design.ts`, `templates.ts`, `labels.ts`, `types.ts`.
* **The member's page:** `src/app/(public)/placed/[token]/page.tsx` and `actions.ts`.
* **Leader and owner:** `src/lib/leaders/leading.ts`, `server.ts`, `src/components/leaders/LeadingTribe.tsx`; `src/components/god/PlacedNudgeSettingsCard.tsx`, `src/app/(app)/god/features/page.tsx` and `actions.ts`.
* **New logic:** `src/lib/placement/nudge.ts`, `nudge-server.ts`; `src/lib/contact-gaps/gaps.ts`; `src/lib/features/types.ts` (the new switch).
* **Guides:** `src/lib/guides/content/contact-gaps.ts`.
* **Docs:** new `docs/PLACED-NUDGE.md`, this file.

## Existing tests this package changes (all disclosed)

* `tests/db/foundation.test.ts`: the new screen functions are added to the list the app may call, and the four page functions to the list a signed-out visitor's page may call. Nothing checks less than before.
* `tests/db/contact-gaps.test.ts`: the download's list of columns gains "number confirmed".
* `tests/unit/features-switchboard.test.ts`: the new switch is on the list of functions.
* `tests/unit/leader-cards.test.ts`, `tests/unit/leader-leading.test.ts`: a pattern and an expected value follow the new fields.
* `e2e/journeys/36-profiles.ts`, `e2e/journeys/39-my-page-for-everyone.ts`: each counted the functions the Switchboard can move (fifteen); there are now sixteen, so each now says sixteen. Nothing checks less than before.
* `scripts/rehearse-rollback.sh`: the two new test files are on the list of new tests.
* New tests: `tests/db/placed-nudge.test.ts` (56), `tests/db/placed-nudge-rollback.test.ts` (9), `tests/unit/placed-nudge.test.ts` (19), and the journey `e2e/journeys/52-placed-nudge.ts`.
* No existing rollback test, email golden file or other test changed.

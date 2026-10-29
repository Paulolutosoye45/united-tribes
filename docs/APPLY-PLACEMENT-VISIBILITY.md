# Placement: leaders see the people the church placed (how to apply this package)

This zip holds **only the files that changed** since the Leaders-who-lead-a-tribe package (`united-tribes-leading-view.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270101000200_leading_view.sql`. No new packages and no new settings.

## What was wrong

Members the church placed with God Mode were in the tribe, and were joining the tribe's WhatsApp group, but the tribe leader's pages showed nobody. It was not one fault but nine:

| # | What was wrong |
| --- | --- |
| 1 | **Two clocks.** The member saw their tribe and WhatsApp group the moment they were placed. The leader's list waited for a separate "tell the leader" step. |
| 2 | **The privacy hold contradicted the group link.** "Don't share my details" held back the number on the leader's list, but the group link was in the member's first email, and joining a WhatsApp group shows your number to everyone in it. |
| 3 | **The leader's own screens disagreed.** The Dashboard listed the people; My tribe, the weekly log and the Lead page did not. |
| 4 | **One slow email blocked the whole tribe,** and people were sent in order of how hard they were to place, not tribe by tribe, so a leader's last email fell late in the run. |
| 5 | **Telling the leader needed the switch On** and a running heartbeat. Set Off or Rehearsal after a live run and every unopened tribe stayed closed. |
| 6 | **A member whose email failed** was shown with their number but left out of the leader's email. |
| 7 | **The empty page said the wrong thing:** "appear here the moment they join". |
| 8 | **God Mode could not say why a tribe was closed.** |
| 9 | **The hold was enforced by which screen asked, not by the database.** A leader calling the raw list got everyone, with numbers. |

## What it does

One rule, kept in one place (the database function `placement_contact`), for every screen:

- **A leader sees every member the church places, by name, the moment they are placed** (My tribe, the weekly log, the Lead page, the Dashboard), each marked *Placed by the church, yet to answer*, *said yes*, *details open*, *details withheld* or *not yet reached*. The empty page now says what is true.
- **A member's email and WhatsApp number open member by member:** when they say yes, agreed on the form, or their own email went and 24 hours have passed (the hours are still your setting). A member who said "Don't share my details" is never opened, for anyone. A member whose email never went is listed as *not yet reached*; their details do not open by themselves.
- **The raw lists apply the rule** (`tribe_roster`, `tribe_week`), so no screen and no direct call can skip it. Coaches, pastors and directors see what they always saw, except that a member who held back is hidden for everyone.
- **The group link follows the same rule.** It is in the member's first email and on their tribe page only after they say yes, agreed on the form, or their hold has ended. Until then both say when it will appear, and that joining shows their number. It is a God Mode setting, **on to start**; turn it off and the link goes at once, as before.
- **The clocks.** Emails go out tribe by tribe, each tribe in one block. The "Your team" email goes as soon as nobody in the tribe is waiting for an email or sitting in the hold, and at the latest 72 hours after the tribe's last planned email, whatever is stuck. Switching Placement Off or to Rehearsal no longer strands people already placed: the heartbeat still finishes telling their leaders (it starts nothing new).
- **God Mode shows why, and lets you act.** The run board lists every tribe: seated, emails sent, waiting and failed, when its hold ends, and one state in plain words (Waiting for emails, In the hold, No email has gone, Due now, Leader told, Opened by you). Each tribe has **Open now** and the page has **Open all**; each asks first and says how many members who have not answered will have their email and number given to the leader. A member who held back stays held back. A line shows when the heartbeat last ran.

What stays exactly as it is: the planning and scoring, the undo, the member's three choices, the 24-hour length, the private links, and every other leader and member screen.

## What it cannot undo

Group links already sent in emails stay in those inboxes. The new rule applies from the day it is installed, to members already placed too.

## Things to know

- **Open now ends the undo for that tribe**, as telling a leader always did. A member who held back stays held back, whatever you press.
- **The raw lists are filtered, not refused.** A leader who calls `tribe_roster` or `tribe_week` directly still gets the names of their tribe, but only the numbers the rule allows. Coaches, pastors and directors see what they always saw, except that a member who held back is hidden for everyone.
- **A member who says "Don't share my details" is still given the group link,** in the email that tells them how to reach their tribe. That is their choice to join; joining shows their number to the group, and the page says so.
- **The standard welcome email, which carries the group link, is still withdrawn for church-placed members**, as before. The other emails that mention the group link (a birthday prompt, a celebration) go to leaders, who are already in the group.
- **The first email now holds the group link back** for a member who has not answered. If you would rather the link went out at once, as before, turn the group-link setting off in God Mode; nothing else changes.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone. If a leader is waiting now, you do not need the old stopgap (`update placement_teams set mail_queued_at = now() …`): once this is applied, their people are on their page by name at once.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270101000300_placement_visibility.sql`

   It adds five functions, three columns and one index (so the rule can look a member up quickly), and redefines the functions the rule runs through. No member, seat, email, consent or run is changed or deleted. The way back is `supabase/rollback/20270101000300_placement_visibility.down.sql`: it puts every redefined function back exactly as it stood, drops the added functions and the index, and leaves the three added columns with their values (nothing reads them afterwards).
2. **Check**, in the SQL editor: `select count(*) from pg_proc where proname in ('placement_contact','placement_group_open','placement_open_now','placement_open_all');` returns `4`.
3. **Then the app**: deploy the website. Nothing else to set.

Run the database file **first**. The website tolerates the old database for reading (a leader's page simply shows what it showed), but **Open now** and **Open all** need the new functions.

## Check it works (ten minutes)

1. Open **God Mode → Placement** and open the run that placed people. The **Tribe by tribe** table now says, for each tribe, how many member emails have gone, are waiting and failed, and where it stands. A line says when the heartbeat last ran. If that time is more than an hour old, the heartbeat is not running: that was mix-up 5.
2. Sign in as the leader of one of those tribes. **My tribe** lists every placed member by name, each with a mark. Members who have not answered have no WhatsApp button yet. The Lead page and the Dashboard list the same people.
3. Back in God Mode, press **Open now** on that tribe. The box says how many members' details will be shared. Confirm. The leader's page now shows the numbers, except for any member who pressed "Don't share my details". The leader and assistant are emailed their team.
4. As a member who has not answered, open the private link from your email. There is no WhatsApp group link, and the page says when it will appear. Press **Yes, I'm in**: the link appears, with the warning that joining shows your number.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **God Mode:** `src/app/(app)/god/placement/actions.ts` (Open now, Open all, the group-link setting), `src/components/god/RunBoard.tsx` (the tribe states, Open now / Open all, the heartbeat line), `src/components/god/PlacementHome.tsx` (the heartbeat line and the group-link setting).
- **Leader screens:** `src/components/matching/TribeOnboarding.tsx` (marks, wording), `src/components/leaders/LeadingTribe.tsx` and `src/lib/leaders/leading.ts` (marks, wording), `src/lib/matching/types.ts` (two fields).
- **Member screens:** `src/app/(public)/placed/[token]/page.tsx`, `src/components/matching/PlacedBanner.tsx`, `src/components/matching/PlacementView.tsx`, `src/app/(app)/tribe/page.tsx` (what they are told about their details, the group link and when it appears).
- **Wording and emails:** `src/lib/placement/wording.ts`, `src/lib/placement/types.ts`, `src/lib/messaging/templates-placement.ts` ("Your tribe" holds the link back and says when it will come; "Your team" lists everyone with where each stands). New: `src/lib/placement/marks.ts`, `src/lib/placement/placed.ts`.
- **Docs and scripts:** `docs/AUTO-PLACEMENT.md`, `docs/MESSAGES-AUDIT.md` (regenerated: three size figures), `scripts/rehearse-rollback.sh` (the two new test names are added to the list the way-back rehearsal leaves out).

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: `placement_open_now` and `placement_open_all` are added to the list of functions the app may call. Nothing checks less than before.
- `tests/db/placement-plan.test.ts`: the settings answer now also carries `hold_group_link` and `last_tick_at`; the two new owner-only functions are added to the "refuses every other role" list.
- `tests/db/placement-send.test.ts`: the old rule (a leader sees no one until told; the group link at once) is replaced by the new one, and the private-page answer carries the new fields.
- `tests/db/rollback.test.ts` and `tests/db/notices-rollback.test.ts`: these two rehearse the way back of earlier work and said "no function that existed before may differ from the old database". This fix has to rewrite four old functions (`my_match`, `my_week`, `tribe_roster`, `tribe_week`) so that no direct call can skip the rule. Both now let through a function that a later feature's own way back puts back (found by name from the rollback files), and the notices rehearsal still checks that, after every way back has run, each of those functions is exactly what the old database had. A function that no way back restores is held to "unchanged" as before. The notices rehearsal also stops reading function bodies when it checks that a later way back does not delete or insert rows (the way back puts old bodies back, and some of them contain those words); statements outside the bodies are checked as before.
- `tests/db/activity-kit.ts`: `makeOwner` takes an optional email (default unchanged), so the new browser journey can create its own owner in a database other journeys share.
- `tests/db/placement-plan.test.ts` also gains the three new internal functions in the "closed to every client" list.
- `tests/unit/placement-templates.test.ts`, `tests/unit/placement-wording.test.ts`, `tests/unit/leader-leading.test.ts`: the new fields and wording.
- `tests/unit/fixtures/email-golden.json`: three entries only (`placement_your_tribe`, `placement_your_team`, `placement_withheld`). Those three emails are meant to read differently now; every other email still renders exactly as before. `docs/MESSAGES-AUDIT.md` is regenerated with it (three size figures change).
- `e2e/journeys/30-placement.ts`: the leader's page before and after being told now follows the new rule.

New tests: `tests/db/placement-visibility.test.ts` (32 tests), `tests/db/placement-board.test.ts` (16 tests), `tests/unit/placement-marks.test.ts` (10 tests), and a new browser journey, `e2e/journeys/38-placement-visibility.ts` (42 checks: a leader sees six people at once with no numbers, the owner reads the board and presses Open now, the numbers appear, the member who held back stays held back). Run against the database as it stood before this fix, 42 of the 48 new database tests fail. The other six check things that must not change (Off starts nothing new, a member who chose their own seat sees everything at once, and so on) and pass before and after.

## What was not checked

- **Your live database.** I cannot read it, so I have not seen your switch, your run, your members' emails or your heartbeat. The five checks in the blueprint (https://claude.ai/artifact/Ch8b4Y4N2maHS9LcuL7Vsa) tell you which of the mix-ups you hit, and the board now answers the same question for you.
- **One older browser journey.** Journey 33 ("Let them choose", the welcome email line on God Mode) fails intermittently. It fails the same way on the code from before this fix, so it is not caused by it, and nothing here touches that page. Journey 36 (Profiles) failed once in a full run and passed on every re-run; I did not find the cause.
- **Real email sending.** The test database cannot send email, so messages were set to sent and failed by hand. How your provider retries and when it reaches its daily quota is read from the code, not observed.
- **WhatsApp.** That joining a group shows your number to its members is how WhatsApp groups normally work. It was not tested against WhatsApp.
- **Timings.** "Three days for 3,000 people" is arithmetic on the default settings (100 an hour, 9 am to 7 pm), not a measured run. On 5,000 test members and 600 tribes the slowest planning step took 4.0 s and the slowest placing step 3.4 s (3.6 s on the database before this fix), the heartbeat 0.06 s (1.0 s before), and the run board 0.1 s; the test's own limits are 10 s a step and 2 s a page. A first version of this fix made placing steps up to 9.4 s and the heartbeat 7 s, because every step re-worked out the state of every finished tribe; it now checks the cheap thing first and has an index for the lookup, which is what the figures above measure.

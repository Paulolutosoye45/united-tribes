# Placement in a running season, placing one person, and the leaders' page explanation (how to apply this package)

This zip holds **only the files that changed** since the How-to-use-this-app package (`united-tribes-howto-and-guides.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270103000400_removal_requests.sql`. No new packages and no new settings.

## What was wrong

Season 1 began on 1 November. From that day:

| # | What was wrong |
| --- | --- |
| 1 | **God Mode could only place people for a season that had not started.** The Placement page, a new run and a leader's Tribe Card all looked for the next season to begin. Once a season was running, there was none, so people who joined after day one had no way to be placed from God Mode. |
| 2 | **"Show me other tribes" was tied to the season's first day,** not to the joining window the church had set. |
| 3 | **The emails talked as if the season had not begun** ("before the season starts", a first meeting by the season's usual date). |
| 4 | **There was no way to place one person.** Every placement was a run over many people. |
| 5 | **A person who opened a leaders' page without being a leader was sent to their home page without a word.** A leader who had been appointed, but was signed in with the wrong account, could not tell why. |

## What it does

- **One season rule, kept in one place** (`placement_season`). The season to place for is the one that has started and is still inside its joining window (the **joining closes** setting, 14 days after the first day unless you changed it at **Admin → Reminders**); if none has, the next to start. Every screen and function that needs the season asks it. A leader can start a Tribe Card in a running season, inside the same window.
- **The Placement page says where the season stands:** "*Season 1* is running, in week 1 of 12. Joining is open until 15 Nov." When joining has closed it says so.
- **A run in a running season is the same run** (plan, read, approve, undo), with four differences, listed on the page when you start one: members are placed only until joining closes; a small tribe is not held back (it cannot wait to fill); the wait before the leader is told is two days at most; the member is asked to meet their tribe within a week, and a tribe's leader is not emailed twice in a day about new members.
- **After the cut-off** a new run is refused, unless you tick **Place after the cut-off**; that run is marked as such.
- **Place one person.** God Mode → People → a person with no seat → **Place in a tribe**. Choose a tribe; the database says in plain words what stops it (not a member, a leader, under 18, an open deletion request, no email we may use, a closed season or tribe, already has a seat), and what needs your word (a seat held for them, an unfinished form, no fit score, no agreement to be matched, a seat in another season, below the compatibility bar, another track, a full tribe, placed after joining closed). You tick that you have read each one and give a reason of a few words, which is kept. The person is then placed exactly as a run places them: the "Your tribe" email with a private link, the leader's team email, the same hold on details. It shows in the run list as a **Single placement**, and can be undone until the leader has been told.
- **"Show me other tribes"** works until joining closes, and says so. The join form and the "you are placed" page say the season "is already under way" when it is.
- **The emails** say the season is under way, which week it is, and when joining closes. Before a season starts they read exactly as they did.
- **A person on a leaders' page who is not a leader** now sees a page that says who they are signed in as (name or email), that the page is for tribe leaders, how to sign out and use another account, and whom to tell if they were appointed.

What stays exactly as it is: the planning and scoring, the 60 bar, the member's three choices, the hold on details, the 24-hour length, the private links, every email before a season starts, and every other screen.

## What it cannot undo

People placed one at a time stay placed if you go back; their runs stay in the list as ordinary runs of one. The event log keeps who placed each of them and why.

## Things to know

- **Placing one person needs Placement On.** In Rehearsal or Off the section says so and the button stays off. It is the owner's alone.
- **"They told me they agree" is your word, not theirs.** If the person has not agreed to be matched, placing them needs you to tick that they told you so; it is kept with your name and reason, and no agreement is recorded for them.
- **Undo ends when the leader is told,** as for a run. Open now still ends it earlier.
- **The window is a setting, not a date.** If you lengthen "Days after the season starts that joining closes" at Admin → Reminders, the Placement page, the member's "Show me other tribes", and the leader's Tribe Card all follow it.
- **A leader is not emailed twice in a day about new members.** In a running season, if an earlier run (a run of one counts) has already emailed a tribe's leader in the last 24 hours, the next run's "Your team" email for that tribe waits until the day has passed, and then lists everyone. **Open now** on the run board ignores the wait.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270104000100_inseason_placement.sql`

   It adds eight functions and seven columns, and redefines ten functions (`leader_fit_season`, `placement_run_new`, `placement_teams_refresh`, `placement_member_params`, `placement_state`, `placement_do_change`, `placement_place_item`, `placement_overview`, `placement_team_mail_for`, `start_tribe_card`). No member, seat, email, consent or run is changed or deleted. The way back is `supabase/rollback/20270104000100_inseason_placement.down.sql`: it puts every redefined function back exactly as it stood and drops the eight added functions; the seven added columns stay (nothing reads them afterwards). Put the application files back **before** running it.
2. **Check**, in the SQL editor: `select count(*) from pg_proc where proname in ('placement_season','placement_week','placement_change_open','placement_first_meeting_by','season_joining_window','placement_one_options','placement_one_check','placement_one_place');` returns `8`.
3. **Then the app**: deploy the website. Nothing else to set.

Run the database file **first**. The website tolerates the old database for the join pages (it falls back to the old season lookup), but the Placement page, placing one person and the explanation for a running season need the new functions.

## Check it works (ten minutes)

1. Open **God Mode → Placement**. The top line says the season is running, which week it is in and when joining closes. If you start a new run, the box lists the four things that differ for a running season.
2. Open **God Mode → People**, and open a member who finished the form and has no seat. **Place in a tribe** shows the open tribes with their leaders and seats. Choose one: the fit and any warnings appear. Tick, give a reason, press **Place**. The member has the "Your tribe" email; **Placement** lists it as a *Single placement*.
3. Open the member's private link on a phone: it names the tribe, and **Show me other tribes** is there until joining closes.
4. Signed in as a person who is not a leader, open `/lead/tribe`. The page says who you are signed in as and why it is not yours, and has a sign-out button.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **God Mode:** `src/app/(app)/god/placement/actions.ts` (the cut-off option, check and place one), `src/components/god/PlacementHome.tsx` (the season line, the running-season box, the Single placement mark), `src/app/(app)/god/people/[id]/page.tsx` (the **Place in a tribe** section). New: `src/components/god/PlaceOne.tsx`.
- **Placement code:** `src/lib/placement/types.ts`, `server.ts`, `wording.ts`. New: `src/lib/placement/season.ts`.
- **Join and member pages:** `src/app/(focus)/join/actions.ts`, `src/app/(focus)/join/page.tsx`, `src/components/intake/IntakeFlow.tsx`, `Done.tsx`, `JoinedView.tsx`, `src/app/(public)/placed/[token]/page.tsx`, `src/lib/guides/content/you-have-been-placed.ts`.
- **Emails:** `src/lib/messaging/templates-placement.ts` (the "Your tribe", reminder and "Your team" emails read differently only for a running season).
- **Leaders' pages:** `src/lib/auth/session.ts` (`requireRole` sends a non-leader to the explanation page). New: `src/app/(app)/no-access/page.tsx`.
- **Registry and docs:** `src/lib/profile/registry.ts` and `docs/PROFILE-READERS.md` (the new check reads two profile fields; it is listed like every other reader), `docs/AUTO-PLACEMENT.md` (two new sections).

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: `placement_season`, `season_joining_window`, `placement_one_options`, `placement_one_check` and `placement_one_place` are added to the list of functions the app may call. Nothing checks less than before.
- `tests/db/placement-send.test.ts`: three exact lists are extended on purpose (the member's parameters carry `in_season`, `week` and `change_until`; the private-page answer carries `change_until` and `in_season`; the team mail carries `in_season` and `week`), and "will not give up a seat once joining has closed" now moves the season 20 days back, since joining stays open for 14.
- No existing rollback test, email golden file or other test changed. The earlier rollback rehearsals (`rollback.test.ts`, `notices-rollback.test.ts`) pass unchanged with this migration's way back in the list.

New tests: `tests/db/inseason-placement.test.ts` (12 tests), `tests/unit/placement-inseason.test.ts` (10 tests), and a new browser journey, `e2e/journeys/44-inseason.ts` (17 checks: a non-leader gets the explanation page on a phone, the owner reads the running-season Placement page, places one person, the member opens the private link and asks for other tribes).

## What was not checked

- **Your live database.** I cannot read it, so I have not seen your season's dates, your joining setting, your tribes or your members. The Placement page now shows the season it found; if that is not Season 1, check its dates in **Admin → Seasons**.
- **Real email sending.** The test database cannot send email, so the "Your tribe" email was checked by reading what was queued, not by receiving it.
- **Real members at scale.** Placing one person was tested one at a time. A running-season run was tested on the same small worlds as the church's runs, not on thousands of people.

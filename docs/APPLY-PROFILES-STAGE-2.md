# Profiles and the Weekly Rhythm, stage 2 (My page for everyone): how to apply this package

This zip holds **only the files that changed** since the Placement visibility package. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270101000300_placement_visibility.sql` (and so stage 1, `20270101000100_profiles_stage1.sql`). **No new settings, no new packages, no `npm ci`.**

What it is, in one paragraph: **stage 2 of Profiles and the Weekly Rhythm**. It adds four functions to the Features page in God Mode, **all Off**: *More facts on My page* (preferred name, area, birthday, and a way to tell the Care Team that an age range is wrong), *My story (private)* (about me, gifts, ask me about, how to pray for me), *Role panels* (one short panel for each role a person holds) and *Still right? once a season* (a one-line strip on Home). Together with *My page* they let every member, not only leaders, use their own page. **Applying this package changes nothing for anyone until the owner moves a switch.** How it works is in `docs/PROFILES.md` (the section "Stage 2").

**This is stage 2 only.** Stages 3 to 6 (faces and visibility, know your tribe, the weekly rhythm, leaders' week) are listed on the Features page and cannot be moved. Nobody sees anybody else's story, birthday or message in this release: sharing comes with stage 3.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. **Nothing to submit to Meta.** The one new message is an email-and-notice to the Care Team; there is no new WhatsApp template.
3. **Decide who tries it first.** The recommendation is **you, as one named person**, then everyone (below). The Features page can open a function for one person, so nobody else sees anything while you look.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270102000100_profiles_stage2.sql`

   Three tables, 14 new functions, eight stage-1 functions replaced by versions that know the new facts (the new text only does more when a switch is On), four rows on the Switchboard and seven rows in the facts registry. Every new table has row-level security and **no grants**: the website reaches them only through functions. **The golden recording of how matching, rosters, dashboards, reminders and exports answered before stage 1 is unchanged**, and a test proves that Off answers the same.
2. **Check**, in the SQL editor:
   - `select count(*) from public.feature_registry;` returns `21` (it was 17).
   - `select count(*) from public.feature_settings where feature in ('my_details','my_story','role_panels','still_right');` returns `0` (no rule: all four Off).
   - `select count(*) from public.profile_story;`, `profile_office_asks` and `profile_prompts` each return `0`.
   - `select count(*) from public.profile_fact_registry;` returns `9` (it was 2).
3. **Then the app**: deploy the website. Nothing else to set.

The website tolerates a database that does not have the migration yet (My page keeps showing what stage 1 showed, and the new strips and the Care Team's list are simply not drawn), so the two steps may be a minute apart.

## Open it, one step at a time (God Mode → Features)

Each step is reversible by moving the same switch back to Off. Nothing here is available to an administrator, a director or a pastor.

1. **Try it as yourself.** Features → *My page* → Move the switch → On → **One person** → find a member account you can sign in as (a test member, or your own) → Save. Then do the same for the four stage-2 functions, one at a time, each for the same person. (A function cannot be opened before My page; the page says so.)
2. **Look at it as that person** (the check below). Nobody else sees any of it.
3. **My page for everyone.** Features → *My page* → Move the switch → On → **Whole platform** → give a reason (at least eight characters, kept in the log) → Save. Members now find My page in their account menu. *Recommended order from here, each one separately, a day or two apart:*
4. **More facts on My page** (name, area, birthday, and the way to tell the Care Team). Tell the Care Team first: a message will arrive on **Care → Young people**.
5. **Role panels.**
6. **My story (private).** Tell people it is private for now.
7. **Still right? once a season.** Last, and only when a season is open or running: the strip appears on Home the next time each person opens it.
8. **If anything is wrong**: **Pause every function** (Features, top) makes every new function act as Off at once, and **Resume** brings every rule back. Moving one switch back to Off removes only that part. **Nothing anyone has written is lost either way.**

A rule limited to some roles *replaces* an unfiltered rule at the same place (one rule per place). If My page is already On for tribe leaders at the platform level, step 3 replaces that rule.

## Check it works (about twenty minutes)

1. With everything Off: a member's account menu has no link to My page, `/my` says "We can't find that page", Home has no strip, and the young people's page has no list of messages.
2. Do steps 1 to 2 above for your test member, then, as that member:
   - **Account menu → My page** opens a page that greets her by the name we use for her and has **About you** and **My story** parts.
   - A name with no letter is refused in words and nothing is saved; a name with letters is saved the moment she presses **Save**.
   - **Area** says nobody is moved. **Birthday** keeps a day and a month, and says it never keeps the year.
   - Three gifts can be ticked and a fourth cannot. After a reload what she wrote is still there.
   - Her **panel** names her tribe or says she is not placed yet, with one link to the page that has the whole of it.
   - **Home** shows "Still right?" about her age range (if the season began after she last confirmed it). **Not now** says it will not ask again this season, and the strip does not come back.
3. As that member, **Is your age range not right? → Tell the Care Team** (add a line). She is told the Care Team has her message, and **her age range is exactly what it was.** As a care lead (or an administrator, director or pastor): **Care → Young people** lists it with what the church holds and what she wrote, and says nothing has been changed for her. Write a note and press **I have looked at this**: she reads your note on her page. The notice sent to the Care Team names nobody and gives no reason.
4. **Download my data** (Profile → *Download a copy of my data*): the file now holds her story, how her name, area and birthday changed, what she told the Care Team and the strip she put away, and only hers.
5. As someone **under 18**: no link to My page, `/my` says "We can't find that page", and there is no strip. (The Care Team handles an age range that crosses 17 and 18; it is never self-service.)
6. Features → **Pause every function**: My page acts as Off at once. **Resume**: it is back with everything she wrote.

## Way back

`supabase/rollback/20270102000100_profiles_stage2.down.sql` (run as the database owner, after rolling the application files back):

- drops the 14 functions stage 2 added, puts the eight it replaced back **exactly as stage 1 wrote them**, removes the four rows from the Switchboard (with their rules; the log of who moved a switch is kept) and the seven rows from the facts registry unless a person has already used one;
- **keeps the three tables with every row**, so what people wrote about themselves and told the Care Team is not lost. The file says how to remove them as well;
- running it twice changes nothing, and it is safe after stage 1's own way back has run.

It was rehearsed (`scripts/rehearse-rollback.sh`): a database with stage 2 applied and used goes back, the platform answers as before, and applying it again works.

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `src/app/(app)/my/page.tsx`, `src/app/(app)/my/actions.ts`: My page gains its parts (About you, My story, panels, the Care Team message); each is drawn only while its function is On for that person. With all four Off the page is the one stage 1 made.
- `src/app/(app)/home/page.tsx`: the "Still right?" strip, drawn only when something is due.
- `src/app/(app)/care/teens/page.tsx`: the list of age-range messages, drawn only when there are some.
- `src/components/shell/AccountMenu.tsx`, `src/components/shell/AppShell.tsx`: the link to My page, drawn only while My page is open for that person.
- `src/app/(app)/profile/data/route.ts`, `src/lib/privacy/export.ts`: a person's data file gains the stage-2 sections. The file is identical for anyone who has used none of it.
- `src/lib/profile/types.ts`, `parse.ts`, `wording.ts`, `server.ts`, `registry.ts`: the shapes, the words, the readers of the seven new facts (`docs/PROFILE-READERS.md` is regenerated).
- `src/lib/features/types.ts`: the four new keys.
- `src/lib/messaging/templates-notices.ts`: one new notice, `care_age_ask` (62 now; `docs/MESSAGES-AUDIT.md` and `docs/NOTICES-ADMIN.md` are updated). The golden recording of every existing email is unchanged.
- `docs/PROFILES.md`, `docs/GOD.md`, `docs/NOTICES-ADMIN.md`, `scripts/rehearse-rollback.sh`: the new section, the seven movable functions, the new notice, and the way-back rehearsal's list of new tests.
- Tests: `tests/db/foundation.test.ts` (eight new functions the app may call), `tests/db/notices-rollback.test.ts` (a later feature's way back may remove the switchboard and fact-list rows it added, and may be written in lower case), `tests/db/profile-readers.test.ts`, `profiles-facts.test.ts`, `profiles-switchboard.test.ts`, `tests/unit/*`, `e2e/journeys/36-profiles.ts` (seven movable functions), `e2e/journeys/04-intake.ts` (it now waits for the form to tick the suggested meeting times before counting them; on a slower machine it read them a moment too early).

## What was checked, and what was not

**Checked, on the stand-in backend (a real Postgres with every migration):**

- Type check and lint clean. **2,438 unit tests** and **2,028 database tests** pass (stage 2 adds 40 and 9 database tests and 25 unit tests).
- **Off is identical.** The golden recording of how matching, rosters, dashboards, reminders and exports answer (`tests/db/golden/fingerprint-v1.json`) and the golden recording of every existing email are both unchanged; neither file is in this package.
- **The way back is rehearsed.** The original 958 tests give the same result (958 of 958) on a database with stage 2 applied and then rolled back as on one that never had it.
- **Browser journey 39** (75 checks) walks the real screens: the owner opens the four functions in God Mode (one is refused when opened out of order); a member fills in her name, area, birthday and story, ticks three gifts (a fourth cannot be ticked), answers and puts away the "Still right?" strip, tells the Care Team; the care lead replies; she reads the reply; her data file holds only hers; someone under 18 sees none of it; the Master pause and one function back Off each take away only their part and lose nothing. Journey 36 (stage 1) now has seven movable switches and passes (87 checks). In the full run of 37 journeys, 35 passed. The two others were not about stage 2: journey 04 (the intake form) read the pre-ticked meeting times a moment too early on this machine, and passes now that it waits for them; journey 28 (team emails) stumbled once in the long run and passes, with all 66 checks, when run alone.
- **Six deliberate breakages** were each caught by a test: the under-18 guard removed from the strip, the under-18 guard removed from My page, the Care Team-only check removed from the messages list, a fourth gift allowed, asking the Care Team changing the age range, and the switch gate removed from the Care Team message.
- The browser journey also found one real fault, now fixed and tested: the thanks on the Home strip could vanish at once because saving redrew Home.

**Not checked:** a real phone or screen reader; a real inbox (the stand-in backend records messages); timing on your own hosting and data; and nobody has used the page as a real member. **Rehearse on a copy first.** The Care Team notice goes out right away, and only once an admin has switched the Care team group on (every group starts Off; see `docs/NOTICES-ADMIN.md`). Check one arrives for you before you tell the Care Team to expect it.

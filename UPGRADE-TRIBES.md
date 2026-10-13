# Upgrade guide: circles are now tribes, tribes are now communities

This zip is the **whole project** (the website, the backend functions, the database files, the tests and the documents). It
includes everything from the earlier updates (the platform owner and the Companion on the member form) and the new names.
Read this page once, top to bottom, before you deploy. The deployment itself takes about fifteen minutes.

## 1. What changed

| Before | Now | Examples |
|---|---|---|
| **circle**: a group of up to 12 people | **tribe** | "My tribe", "Tribe Card", "Tribe Covenant", tribe leader, tribe swap, `/tribe` |
| **tribe**: one of the 11 interest areas | **community** | "Your community" on the form, community champion, community dashboard, `/community` |
| *United Tribes*: the programme's name | *United Tribes* (unchanged) | Titles, emails, the home-screen name |

The two words moved at once, so a new "tribe" is what a "circle" used to be. This is why the interest areas needed a new
name: otherwise two different things would have shared one.

The change is made in four places, and all four ship together in this zip:

- **Screens and messages**: every sentence a member, leader, coach or the office reads.
- **Web addresses**: `/circle` is now `/tribe`, `/lead/circle` is `/lead/tribe`, `/god/circles` is `/god/tribes`, and the old
  champion page (`/tribe`) is now `/community`.
- **The backend**: every function, role and message the application uses.
- **The database**: tables, columns, roles, saved answers and event names, renamed in place (section 2).

## 2. Your members' data is kept

The database file `supabase/migrations/20261210000100_tribes_naming.sql` **renames; it never drops or deletes a table, a column
or a row.** Everyone who has filled in the first version keeps everything: their profile and answers, the form they left half
finished, their match, their place in a group, their weekly logs, testimonies, messages and consent records, and the groups
leaders already built.

How that is made safe:

- **One step, all or nothing.** The whole change runs as a single statement. If anything is wrong, the database is left exactly
  as it was and the message says why. There is no half-changed state to clean up.
- **It checks itself.** Before it starts it counts the rows in every table and takes a fingerprint of every row it is not
  supposed to change. At the end it counts and compares again, and it cancels itself if a row is missing or changed, or if a
  name with the old word is left anywhere in the structure.
- **Permissions are kept.** Every function keeps exactly the permission list it had, and the reporting copy keeps its reader.
- **Only words the application wrote are rewritten**: the keys inside saved answers (for example the form a member left at the
  "tribe" step now continues at the "community" step), match reasons and weights, report data, event names, message
  parameters, and the wording of the weekly guides and training. **Words people typed are left exactly as they typed them**:
  group names, stories, notes, testimonies, and what a member wrote in their own words.
- **"Last changed" times do not move**, so the upgrade does not look like activity to the reports.
- **People stay signed in.** Sign-in sessions are not touched.

What was proven before this zip was made (all with real Postgres 17, no stand-ins for the database):

- The upgrade was run on a database filled with first-version data, and 7,061 stored values were compared one by one
  against what they should become. Everything matched.
- The upgrade was run on a copy with 20,000 people and 120,000 log entries: it took about 30 seconds.
- The upgraded database was compared object by object with an independently worked-out expectation: tables, columns,
  functions, roles, policies and indexes.
- 633 database tests pass (613 existing, which now run on the renamed database, plus 20 new ones that perform the upgrade
  on old-style data, check nothing was lost, and check that a stopped upgrade changes nothing).
- 627 unit tests pass; type-check and lint are clean; all 11 browser journeys pass on the production build.

## 3. Before you start

1. **Rehearse if you can (recommended, about twenty minutes).** Restore your latest backup into a scratch Supabase project, run
   step 2 of section 4 there, then run `supabase/checks/after-rename-audit.sql` and open the site against that project. The
   upgrade was proven on test data, including a copy with 20,000 people, but a rehearsal on a copy of your real data is the only
   way to see it on exactly what you have. Delete the scratch project afterwards: it holds a copy of your members' data.
2. **Take a backup.** Supabase dashboard → Database → Backups → make a manual backup (or note the latest daily one). With
   point-in-time recovery, note the time you start. This is your way back (section 7).
3. **Choose a quiet hour** (early morning is best). Between the moment the database is renamed and the moment the new website
   is live, the old website cannot talk to the database, so the site will show errors for a minute or two. Nobody loses
   anything. Open pages simply need a refresh.
4. **Find out where your database stands.** In the Supabase SQL editor run:

   ```sql
   select to_regclass('public.circles')                  as groups_old_name,   -- a name = still on the old names
          to_regclass('public.communities')              as interest_new_name, -- a name = already renamed, do NOT run the rename again
          to_regproc('public.bootstrap_platform_owner')  as owner_update;      -- a name = the platform-owner update is already in
   ```

   | `groups_old_name` | `interest_new_name` | What it means |
   |---|---|---|
   | a name | empty | Normal. Do the steps below. |
   | empty | a name | The rename was already applied. Do not run it again (it refuses anyway). Only deploy the app. |
   | anything else | | Stop and send this result to your developer. |

   If `owner_update` is empty, the platform-owner database file has not been run yet. Step 2 of section 4 runs it for you first.
5. **Have the settings ready.** There are no new required settings. One optional setting is added
   (`WHATSAPP_TEMPLATE_SUFFIX`, section 6); leave it empty for now.

## 4. Deploy, in this order

1. **Prepare the new website without switching to it.**
   - *Vercel:* push this project to your repository on a branch other than the production one, so Vercel builds a *preview*.
     Wait for it to finish, but do **not** promote it yet.
   - *Container:* `docker build` the new image (build arguments as before) but do not stop the old container yet.
   - *Anything else:* build it (`npm ci && npm run build`) but do not start it yet.
2. **Run the database files.** Pick one way:
   - *Supabase CLI:* `supabase db push`. It applies, in order, only the files not yet applied: `20261209000100_superadmin.sql`
     (if the owner update was missing) and then `20261210000100_tribes_naming.sql`.
   - *SQL editor:* if `owner_update` above was empty, paste and run `20261209000100_superadmin.sql` first. Then paste the whole of
     `20261210000100_tribes_naming.sql` and press Run **once**. It finishes in seconds. A successful run shows no error.
   - If you see an error, **nothing was changed**. Do not run anything else. The usual reason is a message ending in
     "canceling statement due to lock timeout": something was busy for a whole minute. Wait a few minutes and run the file
     again. For any other message, send it to your developer.
   - If you already ran the earlier database files by pasting them into the SQL editor (rather than with `supabase db push`),
     use the SQL editor here too: the Supabase CLI does not know those files were run, and would try to run them again.
3. **Switch the website over straight away** (promote the Vercel preview, or start the new container). The site is back as
   soon as this finishes.
4. **Check the database says what it should** (SQL editor):

   ```sql
   select to_regclass('public.tribes') is not null       as groups_now_tribes,
          to_regclass('public.communities') is not null  as interest_areas_now_communities,
          to_regclass('public.circles') is null          as old_name_gone;
   ```

   All three columns must say `true`.

If you use the SQL editor and you are unsure whether you pressed Run twice: the second press changes nothing (it stops with
"already been applied").

## 5. Check it works (ten minutes, on a phone)

1. Open the home page and sign in as yourself. You should arrive where you normally do, without signing in again if your
   session was still valid.
2. As a member who already has a group: open **My tribe**. Their group, leader and meeting times are there.
3. As a leader: open **/lead**. The Tribe Card, the week, the roster and progress show the groups that already existed.
4. As an office user: Admin → People and roles shows the role named **community champion** where there were tribe champions.
   Admin → Communities and goals lists the 11 interest areas.
5. As a new test member: start the form. The step that used to say "tribe" now says "community", and the suggestions still appear.
6. Open an **old link** from a past message, for example `https://YOUR-SITE/circle`. It should take you to `/tribe`.
7. Run `supabase/checks/after-rename-audit.sql` in the SQL editor. The first result must be empty. The second lists where the
   old word still appears in stored text; it should only be words people typed (section 6, item 1).
8. Watch Admin → Message log for a day: new messages should send; failed ones show the reason.

## 6. After the upgrade: four things to decide

1. **Group names that leaders typed.** A leader who named a group "Builders Circle" typed that name, and the upgrade does not
   edit words people typed. To see them:

   ```sql
   select id, name from public.tribes where name ilike '%circle%';
   ```

   If you want them renamed, this changes only the names, keeping capital letters ("Builders Circle" becomes "Builders Tribe"):

   ```sql
   update public.tribes
      set name = replace(replace(name, 'Circle', 'Tribe'), 'circle', 'tribe')
    where name ilike '%circle%';
   ```

   Leave the leaders' own stories alone unless a leader asks. Messages already sent and reports already written keep the name as
   it was when they were made.
2. **WhatsApp templates.** WhatsApp only sends wordings that Meta has approved, and the approved ones still say "circle". So the
   app keeps sending them under their **original names**, and WhatsApp keeps working on the day of the upgrade. The wording in the
   app now says "tribe". To move WhatsApp to the new words: set `WHATSAPP_TEMPLATE_SUFFIX=_v2` **only in a place where you
   submit** (`npm run templates -- --submit`), wait for Meta's approval (`npm run templates -- --status`), then set the same
   value in the live site's settings and redeploy. Email and text messages already use the new words.
3. **The reporting copy (Power BI or similar).** The `bi` schema was rebuilt under the new names with the same reader and the
   same permissions. A report that points at the old names needs these changes in its queries, once:

   | Old | New |
   |---|---|
   | view `bi.circles` | `bi.tribes` |
   | `circle_id` (in `bi.tribes`, `bi.members`, `bi.weekly`) | `tribe_id` |
   | `tribe` (the interest area, in `bi.tribes` and `bi.members`) | `community` |
   | `bi.kpi_daily.assistants_per_circle` | `assistants_per_tribe` |

   The other views (`ai_fields`, `care_weekly`, `kpi_daily`, `members`, `messages_daily`, `weekly`) keep their names.
4. **The consent wording.** The sentences members agree to (matching and WhatsApp consent, the group agreement, and the
   parents' permission) and the privacy notice (`/privacy`) now say "tribe". Their version labels were raised (`2026-12-v3`, `2026-12-c2`, `2026-12-g2`), so the
   consent ledger can tell which words each person saw. **Nobody is asked to agree again**: existing records keep their old
   labels. The old sentences are kept word for word in `docs/WORDING-BEFORE-TRIBES.md`. This is a legal document under the
   Nigeria Data Protection Act, so please have your lawyer confirm that a change of name needs no new agreement.

## 7. If something goes wrong

- **The upgrade stops with an error:** the database was not changed. Leave the old website running and send the message.
- **The upgrade went through but the new website misbehaves:** the old website cannot run on the new database (the names
  changed), so there is no "just switch back" with the app alone. Use your backup: restore the database from the backup you took in
  section 3 (Supabase → Database → Backups → Restore, or point-in-time to just before you started), then start the *old* website
  again. Anything members saved after the upgrade started is lost with the restore, which is why the quiet hour matters.
- **Do not edit `20261210000100_tribes_naming.sql` or any earlier file.** If something needs correcting, it is a new file.
- **After any restore:** the restored database is on the *old* names, so redeploy the *old* website with it, until you try again.

## 8. What people will notice

- **Members:** the words. An open page or an installed home-screen app may show the old words or an error until it is refreshed
  once. A link from an old message still works and takes them to the right page.
- **Leaders and coaches:** "Tribe Card", "tribe leader", "My tribe". A link to one group's week or progress that carried the
  old address works.
- **Champions:** they are now **community champions** and their page is **Community**. A champion who bookmarked the *bare* old
  address `/tribe` (without anything after it) will land on the member page "My tribe". Their new address is `/community`.
- **Office:** the Admin hub says "communities" for the 11 interest areas and "tribes" for the groups.

## 9. Technical notes

- **The one rule** that maps old words to new is written once (the SQL functions `ut_rn1` and `ut_rn2` at the top of the
  migration), applied the same way to everything and checked by `tests/db/tribes-naming.test.ts`. It never changes "United Tribes".
- **Redirects** for old addresses are in `next.config.ts` (temporary 307s, so nothing is cached for ever). That file is the one
  place that still says "circle" on purpose, apart from this guide, the migration, and the upgrade test.
- **Files:** this zip has 25 database files (the new one is the last). Old database files are unchanged, on purpose. A brand-new
  database is built by running all 25 in order, so it also ends on the new names: the last file simply renames an empty database.
- **Tests:** `npm run typecheck`, `npm run lint`, `npm test` (unit and database; the upgrade test is
  `tests/db/tribes-naming.test.ts`), and `npm run e2e` (the 11 browser journeys, on the production build).
- **Where to look in the code:** `src/app/(app)/tribe` (member's group), `src/app/(app)/community` (champions),
  `src/app/(app)/lead/tribe` (leaders), `src/app/(app)/god/tribes` (owner console), `src/components/community`.

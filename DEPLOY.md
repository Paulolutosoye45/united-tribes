# Deploying United Tribes

This is the one page to start from. It says which of three situations you are in, what to run, in what order, and where the detail is.
Everything the package adds ships **switched off or at today's behaviour**: deploying it changes nothing for anyone until Mary decides.

## What you have

| | |
| --- | --- |
| The app | Next.js 16, React 19, TypeScript, Tailwind 4. Node 22 or newer. `npm install`, then `npm run build` and `npm start`, or the `Dockerfile`, or Vercel (`vercel.json`). |
| The database | `supabase/migrations/`: **42 files**, run in filename order. Every table has row-level security and no grants. The app never holds Supabase's service-role key. |
| The way back | `supabase/rollback/`: three files that put earlier function bodies back, and touch no table and no row. See `docs/RELEASE.md`. |
| The sender | `sender/`: the small service that sends WhatsApp, email and text from the outbox (optional until you switch a channel on). |
| The checks | `tests/` (unit and database), `e2e/` (browser journeys 01 to 27), `scripts/` (fingerprint of the leaders, rollback rehearsal, release verification). |
| The blueprint | `docs/BLUEPRINT-TRACE.md` shows where each part of the blueprint is built, which test proves it, and what is still a decision for the church. |

## Which situation are you in?

1. **Nothing is running yet.** Follow "A new project" below.
2. **The first version is running** (small groups still called "circles"). Do **not** follow this page yet. Follow `UPGRADE-TRIBES.md` first (backup, in-place rename, nobody's data lost). Then follow "An existing project" below, starting at the file after the rename.
3. **The version with "tribes" and "communities" is running** (everything up to `20261215000100_activity.sql`). Follow "An existing project" below.

## A new project

1. **Supabase project.** Choose the region nearest Lagos and a plan with daily backups. `docs/OPERATIONS.md` has the reasoning.
2. **Run all 42 migration files, in filename order**, with `supabase db push` or by pasting them into the SQL editor. Never skip one and never run them out of order. Check: `select public.ping();` returns `{"ok": true}`.
3. **Sign-in settings.** README → "Turn on sign-in (Supabase settings)": six-digit code, 600 seconds, your own email sender, the code-only template from `supabase/templates/`.
4. **Host settings.** Copy `.env.example` and fill it in: the two Supabase values, `NEXT_PUBLIC_SITE_URL`, `DATA_ENCRYPTION_KEYS` (keep a safe copy, it cannot be recovered), `WORKER_TOKEN`, `CRON_SECRET`, and a provider for each channel you want.
5. **First administrator.** Sign in once, then in the SQL editor: `select public.bootstrap_first_admin('your.email@example.org');`. Give the panel their roles from **Admin → People**.
6. **The platform owner (God Mode).** Once, from the SQL editor: `select public.bootstrap_platform_owner('owner@example.com', 'a passphrase of twelve or more characters');`. The owner signs in and is asked for the passphrase. See `docs/GOD.md` (and its sections on the desks and the conversations the owner can read).
7. **The heartbeat.** Vercel Pro reads `vercel.json`; otherwise use the GitHub workflow or any scheduler to call `/api/cron/tick` every five minutes. Put an uptime monitor on `/api/health`.
8. **Walk down Admin → Before the season opens** and then through it once on a phone.
9. **Leave the new tools at their defaults** and switch them on in the order in `docs/RELEASE.md` §5.

## An existing project

This is the safe path. Do not skip the rehearsal; it is a few hours and it is the reason nothing surprises you.

1. **Back up**, and note the counts (people, leaders, applications, tribes, members). Run the fingerprint of today's leaders and keep the output:
   `npx tsx scripts/leaders-checksum.ts "$DATABASE_URL" > before.txt`
2. **Rehearse on a copy of the live data**, not on the live database. `docs/RELEASE.md` §4 gives the eight steps. Every migration is applied one at a time and the fingerprint must come out the same after each.
3. **Ship the code first.** The new code tolerates the old database, so there is no order problem between code and migrations.
4. **Apply the migrations that are new to you, one at a time, in this order:**

   | | File |
   | --- | --- |
   | Switches | `20261216000100_leader_pipeline.sql`, `20261217000100_leader_switchboard.sql`, `20261218000100_academy_switch.sql` |
   | The 100 Tribe Cards | `20261219000100_card_templates.sql`, `20261219000200_card_templates_seed.sql`, `20261219000300_card_templates_seed_new.sql` |
   | Find your tribe | `20261220000100_leader_fit.sql`, `20261221000100_leader_fit_screen.sql` |
   | Appointments by the owner | `20261222000100_leader_appointments.sql` |
   | Leader supply board, suggestions, offers | `20261223000100_leader_board.sql` |
   | The owner's oversight of every desk and conversation | `20261224000100_god_oversight.sql` |

   After each: the fingerprint equals `before.txt`, and a quick sign-in works. Stop at the first surprise and use the way back.
5. **Leave everything at the defaults for a few days.** Watch **Admin → System** and the host's logs.
6. **Switch things on one at a time** (`docs/RELEASE.md` §5): sign off the cards, approve the fit weights, set the application switches, decide the Academy and the declaration, and Find your tribe last.

## Your first hour on the real services

Nothing here has ever run against a real Supabase project, Google, Meta, an email or text provider, or an AI provider. Do this once on a
staging project (or on the live one before anyone is invited), with your own phone and email:

1. Sign in with Google, and again with an emailed code. Sign out and in once more to check the session holds.
2. `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE/api/cron/tick` and read the answer: healthy is `"problems":[]`. Open `/api/health`.
3. **Admin → Messages**: preview and test an announcement to yourself on each channel you switched on (email, WhatsApp, text). The message log should say it was delivered.
4. If sign-in by code on WhatsApp is on, ask for a code to your own number (`docs/SIGNIN-CHANNELS.md`).
5. Apply to lead as a test person on a phone, naming yourself as a referee, and open the referee link on a second device (`docs/REFEREES.md`).
6. As the pastor, score it, approve it, and open the Academy as the new leader. Then fill the member form as a second test person and see the tribe.
7. Delete both test people from **Admin → People** or let them lapse, and check **Admin → System** for anything red.

## The way back

* **A switch** is the first way back: **Admin → Leader pipeline → Full process** puts the application, the Academy and Find your tribe back to today.
* **A function that misbehaves**: run the three files in `supabase/rollback/`, newest first, as the database owner. They change functions and triggers only. `docs/RELEASE.md` §3 says which phases they cover and which phases add only new things.
* **Nothing deletes data.** No certificate is withdrawn by any switch or rollback, and no application is ever reopened by one.

## Before you call it done: the checks

```bash
npm run verify            # type check, lint, unit, database tests, all 324 switch combinations, production build, browser journeys
npm run verify -- quick   # the first four only
npm run test:rehearse     # the original 958 database tests against the rolled-back database
```

Run these as an ordinary user: Postgres will not start as root, and between 7 am and 8 pm Lagos time: about sixteen older messaging and referee
tests depend on the clock (messages are held from 10 pm to 6 am), and they now fail the run at night. `docs/RELEASE.md` explains.

## What has not been tested

Everything above was proven on an embedded Postgres 17 with every migration, on a stand-in for Supabase's sign-in, and in a computer-sized Chromium on a phone-sized screen. **It has not been run against your live Supabase project, on a real phone, with a screen reader, or with real WhatsApp, email, text or AI providers.** WhatsApp message templates need Meta's approval before they can be sent; until then the message to a leader offering a tribe goes by email only. The decisions only the church can make (the season dates, the legal wording, which channels to switch on) are listed in the README and `docs/BLUEPRINT-TRACE.md`.

# United Tribes

The small-group platform for The Covenant Nation, Iganmu, Lagos. It matches 5,000 or more members into tribes of up to twelve,
trains the leaders first, runs the twelve-week season, and shows the pastorate whether people are thriving.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres, sign-in, row-level security).
Node 22 or newer.

This is the complete package: every screen, every database rule, the sending service, the checks, and the hosting files. It
starts from the Phase 7 package and adds the rest of the blueprint (releases R0 to R6). What is built, what was checked, and
**what has not been checked against real services** are set out below, in that order. Please read the last two sections before
launch.

> **Deploying this package? Start at [DEPLOY.md](DEPLOY.md).** It says which of three situations you are in (nothing running; the first
> version running; the tribes version running), what to run and in what order. `docs/BLUEPRINT-TRACE.md` shows where each part of the
> blueprint is built and which test proves it. Everything the later phases add ships **switched off or at today's behaviour**.

> **Already running the first version?** Do not follow "Putting it live" below. Follow **UPGRADE-TRIBES.md**: it takes a backup,
> renames the database in place without losing anyone's data, and switches the site over. In this version a small group of up
> to twelve is a **tribe** (it used to be a "circle") and the eleven interest areas are **communities** (they used to be
> "tribes"). The programme is still called United Tribes.

## What is in it

**For members**
- *Find my tribe*: a thirteen-screen form (about six minutes): age range, stage of life, relationship, children and work, area,
  a few words about their season, community and a second-choice community, walk with God, Season Goal, what success looks like, when and
  how they could meet, how they like to be in a group, an optional photo and private notes. It saves as they go and resumes later.
  Optional AI suggestions (Claude or ChatGPT) and a 60-second voice note; the form works without either.
- *Three best-fit tribes*, each with its own Degree of Compatibility and its reasons (first names only), the tribe's Success
  Picture and Covenant, then choose and commit. Ask later to swap into a different tribe.
- *The weekly rhythm*: the week's guide, one small step, the Friday check-in, days in the Word, testimonies, and a private
  progress card.
- *Messages and reminders*: announcements to live audiences with preview, test and second-person approval, and four automatic
  email journeys with a button back to the exact step of the form. See `docs/MESSAGES-REMINDERS.md`.
- *Profile*: change or delete answers, choose how to be reached (WhatsApp, email, text), add a WhatsApp number to sign in with,
  **download a copy of everything held**, **ask for the account to be deleted**, and read the privacy notice.
- Installable on a phone, with an offline page. Light and dark mode. Built phone-first.

**For leaders**
- *Apply to lead*: application, two referees who are sent a private link and a six-digit code straight to their own phone or email (the applicant never sees either), a scoring panel, interviews, a pastor's decision.
- *The Leader Academy*: six modules with quizzes, the safeguarding declaration, two live workshops, a coach's practice sign-off,
  then the *Tribe Card* a tribe is published from, and certification.
- *Lead*: the roster with a short brief on each member, the week's plan, a two-minute log (attendance, energy, prayer requests,
  care flags, celebrations), call lists so nobody misses twice without a call, and "the season so far" for the tribe.

**For coaches, pastors, the care team and the office**
- *Review*: the leader queue, interviews, Academy marking, Tribe Card review and pairing; for each reference, what was proved about the referee, and a pastor's one-tap confirmation or "looked at".
- *Referees* (docs/REFEREES.md): the church's own list of pastors and unit heads, uploaded from a spreadsheet in the browser and kept up to date by uploading again (preview, undo, history); integrity flags; and a call-back queue for the care team.
- *Leader pipeline* (docs/SWITCHBOARD.md): one Admin page where the office decides which questions, references, interview, Academy and safeguarding declaration the road to leading includes (each Required, Optional or Off), with two presets and a log of every change. Everything starts as it always was.
- *Find your tribe* (docs/LEADER-FIT.md, off until switched on): after "how you lead best" a leader sees the tribes their answers suit best, with a match word and plain reasons, and chooses one and up to two backups; the pastor sees a "Tribe fit" note on the application; leaders we already have see "Tribes you could lead next season". A pastor still decides every application.
- *Ready-made Tribe Cards* (docs/TRIBE-CARDS.md): one reviewed card for each of 100 goals in 11 communities, signed off by the pastorate community by community; signing off creates the 77 new goals. A leader can start their card from it.
- *Appointing a leader* (the owner's console, docs/GOD.md): the owner appoints a known leader to a tribe without an application; a pastor still approves the card and the Academy still certifies.
- *Leader supply and demand* (docs/LEADER-BOARD.md): a board of the goals members are waiting for and the leaders who could lead them; suggestions in a stated order; an offer that tells a leader how many are waiting, never who; accepting fills the Tribe Card from the ready-made card.
- *Exports and Reports* (docs/EXPORTS.md, off until the owner switches it on): leaders, champions, coaches, the office and the pastorate take a real Excel file or a printed page with them (a tribe sheet, an attendance register, the dashboard and reports as files, a leaders roster), made when asked and never stored, in a private link that works for one account for 24 hours. People files name people and are for the church's own use; Insight files carry no names and can feed other reporting tools through the Open Data Pack or a standing link. Members under 18 are counted and never listed. **Every switch is in the owner's console and nowhere else**, and everything starts Off.
- *Profiles and the Weekly Rhythm, stage 1* (docs/PROFILES.md, off until the owner switches it on): the owner's **Features** switchboard (every new function Off, Rehearsal, Limited or On, at five places, with a Master pause and a log), a facts store in which a person confirms what the church holds about them, the **Details Check** that asks appointed leaders to confirm their stage of life through a private link, a **My page** for leaders, and a pastor's review of a stage change that touches a tribe with members. Nobody is moved automatically. **Every switch is in the owner's console and nowhere else**, and everything starts Off; a test proves that with everything Off the platform answers exactly as it did before.
- *Profiles and the Weekly Rhythm, stage 2: My page for everyone* (docs/PROFILES.md, "Stage 2"; docs/APPLY-PROFILES-STAGE-2.md): four more switches, all Off. Members get their own page with a name we use, an area, a birthday (day and month only), a private story (about me, gifts, ask me about, how to pray for me), one panel for each role they hold, a "Still right?" strip on Home once a season, and a way to tell the Care Team that an age range is wrong (it changes nothing; crossing 17 and 18 is never self-service). Nobody else sees any of it in this release.
- *Care*: the care queue (urgent flags alert by email and text at once), teen-track care when that is switched on.
- *Results*: the Thriving Rate and the numbers behind it, funnel, supply and demand, tribe verdicts, retention, matching
  accuracy; weekly, monthly, community and season reports generated by the system; the community dashboard for champions.
- *Growth*: tribe swaps, the matching model (propose new weights after a season; a person approves and activates), and the
  multiplication planner.
- *Admin hub*, for the office, without a developer (docs/ADMIN.md): seasons, weekly guides, communities and goals, community champions,
  people and roles, targets, settings, sending and reporting, the message log (with Try again for failed messages), and
  **Data requests** (account deletion, answered by an admin or director).

**Behind the screens**
- *Messaging*: WhatsApp, email and text through one outbox. Consent is checked at the moment of sending, nothing goes between
  10 pm and 6 am except an urgent care alert, STOP and spam complaints withdraw that channel, and the weekly calendar (Monday
  guide, meeting reminders, Friday check-in, Saturday leader report, birthdays, late-log nudges, new-member welcome) runs from a
  heartbeat every five minutes.
- *Database*: 42 migration files. Every table has row-level security and **no grants**; people and the sending service reach
  data only through functions that check who is asking. There is **no service-role key anywhere in the app**.
- *Reporting copy*: a read-only `bi` schema for Power BI or similar, with every person replaced by a code (docs/BI.md).
- *Security and platform*: a strict per-request Content-Security-Policy, optional Cloudflare Turnstile bot check on sign-in and
  on the links anyone can open, per-person rate limits, sealed private notes (AES-256-GCM, key held by the app, with a key-rotation
  command), health check for monitors, installable PWA, GitHub CI, a Dockerfile, a Vercel schedule, and a GitHub heartbeat.
- *Data rights and retention*: a member's own download, a deletion path with an office decision, and a daily clean-up of old
  personal data (docs/RETENTION.md).
- *The Companion* (docs/SUGGESTIONS.md): the member form suggests answers from what the member writes and taps, in the browser,
  for every member with or without the AI service. Each pick says why, in their own words, and can be turned down in one tap.
- *The platform owner* (docs/GOD.md): one hidden account, set once from the SQL editor, with a passphrase step on top of sign-in,
  that can open every page and see what everyone is doing. Nobody below it can see it. Its **Activity room** (docs/ACTIVITY.md)
  shows how the platform is used and where it needs a decision: where people stop in the forms, quiet tribes, failing messages,
  the audit trail and the flags' thresholds. It is visible to the owner only, records what people did and when but never what
  they wrote, never names a young member and never shows a group under five as a number.
- *God Mode sees every stakeholder's desk* (docs/GOD.md): for each of the ten roles, a read-only view of what that role sees,
  with the numbers and the trend behind it; the platform's conversations (the message outbox, who opened a chat, the broadcasts: the
  platform stores no free-text chat); and a private record of what the owner opened. The conversations view carries no care or
  sensitive content, nothing about young members, and no sealed note. Only the owner can open any of it.
- *Optional and off until switched on*: more than one centre (docs/MULTI-CENTRE.md), tribes for ages 13 to 17 with a parent's
  permission (docs/TEENS.md), WhatsApp sign-in codes, the AI assistant, voice notes, the bot check.

## Try it on your own computer

No Supabase project needed. This starts a real Postgres 17 with every migration applied, plus a small stand-in for Supabase's
sign-in and data API (for local work only; everything is erased when it stops). Postgres will not start as root: use a normal user.

```bash
npm install
npm run standin   # first terminal: prints two lines
                  # put those two lines in a new file called .env.local
npm run dev       # second terminal: http://localhost:3000
```

Sign in with any email address and the code `123456`. An address that starts `admin.`, `director.`, `pastor.`, `coach.`,
`care_lead.`, `data_lead.` or `community_champion.` gets that role (for example `admin.mary@example.org`).

## Putting it live

**DEPLOY.md is the page to start from** (which situation you are in, and the order). **docs/OPERATIONS.md is the detailed guide**: the order of the steps, the settings, three ways to host, the heartbeat, monitoring, changing
secrets, backups, and what to do when something is wrong. The short version:

1. Create a Supabase project near Lagos on a plan with daily backups. Run the 42 files in `supabase/migrations/` in order
   (`supabase db push`, or paste them into the SQL editor). Set up sign-in ("Turn on sign-in", below).
2. `select public.bootstrap_first_admin('your.email@example.org');` once, after signing in once. Then give the panel their roles.
3. Settings in the host: the two Supabase values, `NEXT_PUBLIC_SITE_URL`, `DATA_ENCRYPTION_KEYS` (keep a safe copy),
   `WORKER_TOKEN`, `CRON_SECRET`, and a provider for each channel you want. `.env.example` lists everything with the reasons.
4. Start the heartbeat (Vercel Pro reads `vercel.json`; otherwise the GitHub workflow or any scheduler) and put an uptime
   monitor on `/api/health`.
5. Work down **Admin → Before the season opens**, then walk through it once on a phone.

### Turn on sign-in (Supabase settings)

- **Email code:** enable the Email provider; OTP length **6**, expiry **600** seconds. Use **your own email sender**
  (Authentication → SMTP Settings, with SPF, DKIM and DMARC); Supabase's built-in sender is for testing and allows only a few
  emails an hour. Paste `supabase/templates/sign-in-code.html` into both the **Magic link** and **Confirm signup** templates:
  it shows the code and has no link, on purpose (mail scanners open links and use up the one-time code).
- **Google:** create an OAuth client (Web application), authorised redirect `https://YOUR-PROJECT.supabase.co/auth/v1/callback`,
  paste the id and secret into the Supabase Google provider.
- **URLs:** Site URL = your address. Redirect URLs: `https://YOUR-DOMAIN/auth/callback` and `https://YOUR-DOMAIN/auth/confirm`.
- **Rate limits:** raise the hourly limit for sending codes for a Sunday-morning rush.
- **Bot check (recommended):** see `.env.example` ("Bot check") for the order of the steps.
- **Sign-in codes on WhatsApp or email (optional for WhatsApp):** docs/SIGNIN-CHANNELS.md has the three ways to send (Meta, an ordinary number, an ordinary number that replies first), the limits, the circuit breaker and the office page at `/admin/signin`.

## What was checked, and how

Everything below was run in a build environment **with no access to Supabase, Google, Meta, an email or text provider, an AI
provider or Cloudflare**. Where the app talks to one of those, the test talks to a stand-in written for the purpose.

| Check | Result | Against |
| --- | --- | --- |
| Type-check, lint | clean | `npm run typecheck`, `npm run lint` |
| Unit tests | **1,329 pass** (58 files): validation, wording, scoring, dates, roles, the assistant layer, the Companion, message templates and sending, security headers, sealing, data-rights wording, the church's spreadsheet reader, referee contact rules, the activity dashboard, and the rework (switch steps and modes, the 100 cards, the fit formula, the board and offer message, the owner's desks), and sending email through your own SMTP server (24 tests against a real mail server running on the build computer) | `npm run test:unit` |
| Database tests | **1,408 pass** (44 files), including the upgrade from the first version, every access rule, the golden copies of every revised function at today's positions, the 100 cards signed off through the real functions, the fit engine against its reference copy, the board and offers, the owner's desks and conversations, the static checks and the rollback | `npm run test:db`, a real Postgres 17 with every migration. A failing test now fails the command (it used to exit with success) |
| The switch matrix | **329 pass**: all **324 combinations** of the leader-pipeline switches, each taken from the first answer to a tribe members can see, with twelve rules read after every one | `npm run test:matrix` |
| The way back | **958 of 958** original database tests pass on the baseline and, test by test, on a database built forward and rolled back; every function equals what it was, every table keeps its rows | `npm run test:rehearse` |
| Browser journeys | **25 journeys, 1,440 checks, 0 problems**, in Chromium on a 390 px phone and a laptop, failing on any console error (a Content-Security-Policy violation fails a test). Journey 27 is the browser pass: no sideways scroll, no cut-off text, nothing to tap under 40 px, on every page the rework touched | The real app, built for production, against the real Postgres with stand-ins for Supabase's API, the messaging providers and Turnstile (`npm run e2e`) |
| Clean install | The package was unpacked into an empty folder, installed with `npm ci`, and **every row above was run there** (`npm run verify -- rollback`: type check, lint, unit, database, 324 combinations, production build and journeys, rollback rehearsal) | A fresh copy, so nothing depends on a file that is not in the package |
| Production build | passes (`next build`, as the first step of the browser journeys, from the clean copy). The container image and its standalone server were checked on an earlier version of this package and **not repeated on this one** (see the list below) | `next build`, `BUILD_STANDALONE=1` |

The journeys 01 to 18 (the rework's are listed after): **01** a first sign-in, and every link sent under the old names still arriving at the right page; **02** messaging (consent, quiet hours, STOP, the weekly calendar, templates, webhooks);
**03** the season engine (leader log, care tasks, celebrations, testimonies); **04** the smart intake (all screens, sealed notes,
photo, voice, the assistant); **05** insight (targets, reports, champions, the reporting copy); **06** growth (swaps, the
matching model, multiplication, the teen track and a parent's permission); **07** the admin hub (every office screen and who may
open it, message log with Try again); **08** the platform (security headers and the nonce, installability, offline, the bot check,
retention); **09** data rights (download, request, office answer, erasure, signed out cleanly, starting again); **10** the platform owner (hidden from the office, the unlock step, every page opening, the console, lockout, expiry); **11** the Companion (suggestions for a member who says no to the AI service, why-this and not-this-one, turning suggestions off and on); **12** the quality of leader answers; **13** the referee checks (a pastor uploads the church's messy spreadsheet and undoes and updates it, a referee's code goes to their own email or WhatsApp, a pastor's review, the care call-back, an old reference disowned, a wrong code five times); **16** the owner-only activity dashboard (an admin, a leader and a stranger cannot find it or download from it; real sign-ins and visits recorded by name only; every tab; small groups and young members hidden; the spreadsheet download; thresholds and pausing; the owner never recorded); **17** sign-in by code on WhatsApp or email; **18** messages and reminders. The rework adds **19** the leader pipeline page (who can change it, the log, the presets); **20** the application switches (every question, reference and interview position through the real form and the pastor's review); **21** the Academy and declaration switches; **22** the ready-made cards (read, ask, sign off a community, a sensitive card on its own, an edit signed off again); **23** Find your tribe (choosing, backups, a sensitive tribe below the care bar, changing the goal from the review, no model approved, the fit model page); **24** the owner appoints a leader; **25** the leader supply board, suggestions, an offer and its acceptance; **26** God Mode's desks for every role, the platform's conversations and the owner's private record; **27** the browser pass at phone width.

## What has NOT been checked: please read

1. **Nothing has run against a real Supabase project, real Google sign-in, Meta (WhatsApp), Resend, Termii or Twilio,
   Anthropic or OpenAI, or Cloudflare.** The stand-in for Supabase's sign-in and data API (`scripts/standin`) is hand-written. It
   has already caught two differences in the test set-up itself, so expect one or two small surprises on a real project. Budget
   a day on a staging project before real members: sign in with Google and with an emailed code, send a message on each channel,
   run the heartbeat, switch on the bot check, and walk the member journey.
2. **WhatsApp:** templates need Meta's approval (`npm run templates -- --submit`). Whether adding or changing a number sends the
   code on WhatsApp rather than as a text depends on the provider; test it (docs/SIGNIN-CHANNELS.md). Twilio set up *inside* Supabase cannot have the sign-in limits, so WhatsApp sign-in stays off for it.
3. **The container image has not been built** (there is no Docker here). The Dockerfile follows the standard Next.js standalone
   pattern and the standalone server it runs was started and checked, but build the image once before relying on it. The Supabase
   CLI settings in `supabase/config.toml` were not run either, and the heartbeat workflow has not run on GitHub.
4. **Vercel:** the schedule in `vercel.json` (every five minutes) needs Vercel's Pro plan; Hobby allows once a day and refuses to
   deploy a faster one. The alternatives are in docs/OPERATIONS.md.
5. **Not tested on real phones or with a screen reader.** Do a pass on a mid-range Android phone on mobile data. Not
   load-tested: nothing here has been run with thousands of people at once; a Sunday-morning sign-in rush is the first place to look.
6. **Voice notes and Nigerian English/Pidgin** with real recordings, and the assistant's accuracy with real keys, are not
   measured. Run `npm run bakeoff -- --providers anthropic,openai --runs 3` (31 invented stories) and agree the bars with the
   team before choosing a model.
7. **Security review.** The design follows the rules above, and the tests enforce them, but a person who is not me should
   review it before real data goes in, and run a penetration test on the real deployment.
8. **A deleted member remains in database backups until they roll off** and in the reporting copy until its next daily refresh;
   after any restore, delete again whoever was deleted since. Providers keep their own delivery logs (docs/RETENTION.md).
9. **The rename has not been run on your real database.** It was proven on first-version style data (including a copy with
   20,000 people) and on a database with all the earlier files, but not on the live one. Before the real run, take a backup and,
   if you can spare twenty minutes, restore it into a scratch Supabase project and run the upgrade there first
   (UPGRADE-TRIBES.md, section 3).

10. **Referee checks prove control of a phone or an email, not who holds it.** The list, the flags and the call-backs make a false
   reference hard and noticeable, not impossible, and a wrong number on the church's list verifies the wrong person. Nothing about
   referees has been sent through a real WhatsApp, text or email provider; the three new WhatsApp templates need Meta's approval
   (`npm run templates -- --submit`). See the last section of docs/REFEREES.md.

11. **The activity dashboard** (docs/ACTIVITY.md) was checked against a database of 20,000 people and 1,000,000 recorded events
   and in a browser, but not on real phones or real networks. It records only from the day it is deployed, so its first weeks
   hold little. Whether one sentence in the privacy notice is enough, or recording screen use needs its own consent line, is a
   question for counsel.

12. **The leader-pipeline rework** (the switches, the Academy and declaration switches, the 100 cards, Find your tribe, the board and the
   owner's desks) was proven on an embedded Postgres 17, on the stand-in for Supabase's sign-in, and in a computer-sized Chromium on a
   phone-sized screen (390 px, with a 40 px tap-size rule). It has **not** been run against your live data (the rehearsal on a copy in
   docs/RELEASE.md section 4 needs your database), on a real phone, or with a screen reader. All 324 switch combinations pass, and a
   rollback to the pre-rework functions was rehearsed, but the baseline and the rollback were checked against a database built from the
   files, not against yours.
13. **The first weights of the fit model (`lf-1`) and the order of the board's suggestions are a first proposal** for the pastorate to read
   and approve. They have not been compared with real tribe results, and are not changed until at least 30 tribe verdicts exist.
14. **Email through your own mail server (SMTP, docs/EMAIL-SMTP.md) was tested only against a mail server running on the build computer**, not against yours, your DNS, or Gmail, Yahoo or Microsoft. Whether mail reaches the inbox depends on your records (SPF, DKIM, DMARC, reverse DNS) and your server's reputation, so warm up gradually. With your own server there is no automatic bounce or complaint report to the platform.
15. **The message to a leader offering a tribe goes by email only.** Its WhatsApp template (`leader_offer`) is written and waits for
   Meta's approval (`npm run templates -- --submit`).
16. **The platform stores no free-text chat**, so the owner's "conversations" are the message outbox, the chats staff opened and the
   announcements, not the words members wrote to one another. If you want the owner to read members' private words, that is a
   privacy decision for the pastorate and counsel, and nothing here does it.

## Decisions only the church can make

These are drafts or proposals, not facts. Each is easy to change, and each is listed where to change it.

- **The wording of the consents, the privacy notice (`/privacy`) and the parent's page** is a draft for counsel to review against
  the Nigeria Data Protection Act 2023, with the office's contact details. The consent version string (`2026-12-v3`,
  `src/lib/intake/consent.ts`) is stored with every consent: change it when the wording changes. Open legal points are listed
  at the end of docs/RETENTION.md (how fast requests are answered, safeguarding records versus deletion, registration with the
  Nigeria Data Protection Commission, what a member's download includes).
- **Retention periods** (unfinished form 30 days; a parent's contact 90 days after the young person's last season; finished
  message wording 90 days): `retention_periods()` in the database, one line each.
- **The numbers the programme is held to** (85% thriving, two-thirds attendance, belonging 4, and so on) are my reading of the
  blueprint. They are editable by an admin, director or data lead in Admin → Targets.
- **Ratings are 1 to 5 on three lines** (about God, others, life), added to 3–15, not the blueprint's 1 to 10 on one line, so a
  "gain of 2" means 2 points of 15. It is easier on a phone and less hair-splitting; changing it means changing the question
  and the thresholds together.
- **Matching weights** are a first version chosen by judgement. After a season the system proposes new ones from what happened
  (needs 300 finished placements); a person approves and switches them on.
- **The leader scoring** (six situations and which response is best, rubric wording, weights, the 75 and 60 thresholds), the
  **twelve weekly guides**, the **Academy lessons and 35 quiz questions**, the **safeguarding declaration** and the **covenant
  and Success Picture wording** are drafts for the pastorate to approve. They are editable: guides in Admin → Weekly guides, the
  rest in the files named in docs/BUILD-NOTES.md.
- **The provisional Season 1** (14 February 2027, 12 weeks) is a placeholder; plan the real one in Admin → Seasons.
- **Switched off until decided:** more than one centre (do not switch on until the list in docs/MULTI-CENTRE.md is empty) and
  tribes for ages 13 to 17 (docs/TEENS.md: two-adult rule, parent's permission, who may see what).
- **Not applied:** the dashboards hide groups smaller than five, but the reporting copy (`bi` views, one coded row per person)
  does not, so apply a minimum group size in any report built on it (docs/BI.md).
- **Who counts as "a pastor or unit head"** for the reference gate (default: pastors and unit heads; ministry leaders can be added),
  **how much of the call-back sample** to call (20%), and **how fast is "too fast"** (40 seconds) are settings on Admin → Pastors and unit heads.
  The church's list itself is the church's to keep right.
- **The rework's open decisions** (docs/BLUEPRINT-TRACE.md): who signs off each community's cards and approves the fit weights; a
  lawyer's review of the wording that tells applicants their answers also suggest tribes (before Find your tribe is switched on); confirming
  Season 1, 2027 so Tribe Cards can be started and offers accepted; and which communities open first (docs/RELEASE.md section 5).
- **Who hosts the Starter Tribe** (the waiting list for members with no fit yet) and **how long a leader's approval record is
  kept after they leave** are open.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Development server; production build and server |
| `npm run typecheck`, `npm run lint` | TypeScript check; lint |
| `npm run test:unit` | Fast tests, no database |
| `npm run test:db` | Starts a throwaway Postgres, applies every migration, checks the rules. Needs a normal user (Postgres refuses root) |
| `npm test` | Both of the above |
| `npm run test:matrix` | All 324 combinations of the leader-pipeline switches, each taken from the first answer to a tribe members can see, with twelve rules read after every one (about two minutes). The everyday `test:db` runs twelve representative combinations |
| `npm run test:rehearse` | The way back, rehearsed: the original database tests run against a database built to the pre-rework baseline and against one built forward and rolled back; the results must match |
| `npm run verify` | Everything for a release in order: type check, lint, unit, database tests, the 324 combinations, production build, browser journeys (`-- quick` for the first four only). `bash scripts/verify-release.sh` |
| `npm run e2e` | Builds the app, starts it with the stand-ins and runs the browser journeys (`npm run e2e -- 07 09` for some). Needs a Chromium: set `CHROMIUM_PATH` or run `npx playwright-core install chromium` once |
| `npm run standin` | A real Postgres plus a stand-in for Supabase, for local work |
| `npm run reseal` | Change the key that seals private notes (`-- --apply` to do it). See docs/OPERATIONS.md |
| `npm run email:test -- you@example.org` | Sends one real test email through the email provider the settings choose (Resend or your own SMTP server) and says what happened. See docs/EMAIL-SMTP.md |
| `npm run templates` | Show the WhatsApp message wordings; `-- --submit` sends them to Meta; `-- --status` asks Meta |
| `npm run bakeoff -- --providers mock` | Dry run of the Claude-versus-ChatGPT comparison, no keys needed |

`.github/workflows/ci.yml` runs the type-check, lint, unit and database tests, the build and the browser journeys on every change.

## How it is kept safe (for the reviewer)

- **Row-level security on every table, no grants.** The foundation revokes the default grants; later tables grant nothing. Everyone,
  including the app, reaches data through `security definer` functions that pin their search path and check who is asking and
  what their role is *in their own centre*. A test fails if any table lacks RLS, if a visitor can call or read anything, or
  if a function is callable that the app does not use (the allow-list in `tests/db/foundation.test.ts`).
- **No service-role key exists in the app.** Every query runs as the signed-in person. The sending service holds one *worker token*
  that can claim a message, report how it went and run the calendar, and nothing else; it is made in Admin and can be revoked.
- **The browser is never trusted.** The server re-validates every answer; options come from the database; the assistant can only
  choose from options it is given and never sees contact details or support notes; an endpoint checks origin, sign-in, consent,
  a per-person limit and size before anything leaves the server.
- **Private notes** (what would help care for a member, the note for their leader) are sealed in the app with AES-256-GCM and the
  owner bound in, so a copy of the database cannot read them. Lose every key and they cannot be read again; keep a copy.
- **Pages** are sent with a per-request nonce Content-Security-Policy, HSTS, `nosniff`, no framing, and a strict referrer policy.
  Links anyone can open (a referee's, a parent's) are one-time, hashed in the database, no-index, expire, and are bot-checked
  when Turnstile is on. Sign-in identity is verified server-side with `getClaims()`; redirects stay inside the app.
- **What a leader can see is narrow by design**: for each member whether the step was done, never its words; pulse answers only as
  an average of three or more; sealed notes never leave the app except to their owner's own download.
- **Everything that changes anything is written to the event log** (what, when, who; never what was written).
- **Adding a migration:** new tables start locked, but Postgres lets everyone run a new function by default. End any migration that
  adds a function with `revoke execute on function … from public, anon, authenticated;` and then grant to the roles that need it. A
  test fails until the function is added to the allow-list.

## Where things are

```
supabase/migrations/       The database: 42 files, run in order; supabase/rollback/ holds the three files that put earlier function bodies back. supabase/config.toml and templates/ for the Supabase CLI and sign-in email
src/proxy.ts               Per-request security policy, session refresh, sign-in redirects
src/app/(public)/          Sign-in, a referee's page, a parent's page
src/app/(focus)/           The member form and the leader application (no menu while answering)
src/app/(app)/             Signed-in screens: home, tribe, lead, review, care, dashboard, reports, growth, community, profile, admin
src/app/api/               Heartbeat (cron/tick), health, assistant and voice endpoints, photo, webhooks, the WhatsApp code hook
src/app/auth/              Sign-in return routes; /auth/ended signs out someone whose account is gone
src/lib/                   The logic: auth, intake, leaders, academy, matching, rhythm, dashboard, growth, reports, admin, privacy,
                           messaging (templates, providers, dispatch), crypto (sealing, key change), security (CSP, bot check), ai, whatsapp
src/components/            Screens, by area; ui/ holds buttons, fields and badges
public/                    Icons, brand, the service worker (sw.js)
tests/unit, tests/db       Fast tests; database tests against a real Postgres
e2e/                       Browser journeys, the stand-ins, and the runner
scripts/                   standin, reseal, templates (WhatsApp wording), bakeoff (assistant comparison), leaders-checksum (fingerprint of today's leaders),
                           rehearse-rollback, verify-release
cards/                     The 100 ready-made Tribe Cards as data (JSON) and as a sheet to read (CSV); loaded by the migrations
docs/                      The documents listed below. DEPLOY.md and UPGRADE-TRIBES.md are at the top level
.github/workflows/         CI, and the heartbeat alternative to Vercel's schedule
Dockerfile, vercel.json    The container; the five-minute schedule
```

To change a question's options edit `src/lib/intake/options.ts` or the catalogue in Admin. To change colours or motion edit
`src/app/globals.css`. The wording of every message is in `src/lib/messaging/templates.ts`.

## The documents

| | For | About |
| --- | --- | --- |
| `docs/EMAIL-SMTP.md` | Whoever looks after the site | Sending email through your own mail server instead of Resend: DNS records, settings, a test tool, switching over, warming up, sign-in codes in Supabase, and what is different |
| `docs/OPERATIONS.md` | Whoever looks after the site | Deploying, settings, the heartbeat, monitoring, changing a secret, backups, a runbook |
| `docs/ADMIN.md` | The office | Every admin screen, who may do what, the launch checklist, data requests |
| `docs/RETENTION.md` | Pastorate and counsel | What is kept and for how long; what deleting a person does and does not reach; open legal points |
| `docs/BI.md` | The data lead | The reporting copy and how to connect Power BI |
| `docs/MULTI-CENTRE.md` | Whoever opens a second centre | What is done, what remains, and the switch |
| `docs/TEENS.md` | Pastorate | The 13-to-17 track and its safeguards |
| `docs/SIGNIN-CHANNELS.md` | Whoever sets up sign-in; the data lead; the director | Sign-in by code on WhatsApp or email: the routes, limits, circuit breaker, `/admin/signin`, set-up, limits of what can be promised |
| `docs/REFEREES.md` | The pastorate, the office, the care team | The church's list and how to upload it, how a referee is checked, the flags, call-backs, old references, and what this does and does not prove |
| `docs/MESSAGES-REMINDERS.md` | The office | Announcements, the four automatic reminder journeys, and every safeguard on them |
| `docs/LEADER-FIT.md` | Pastorate, the office | Find your tribe: what the comparison looks at, the model and who approves it, what a leader and a pastor see, the quiet run, switching it on, what it cannot tell |
| `docs/TRIBE-CARDS.md` | Pastorate, the office | The 100 ready-made Tribe Cards: reading and signing off by community, sensitive cards, the review sheet, what signing off creates, what a leader sees |
| `docs/LEADER-QUALITY.md` | Pastorate, reviewers | The first check on leader applications: how written answers are read before a pastor's time is spent, and what it can and cannot tell |
| `docs/ACTIVITY.md` | The platform owner, the pastorate and counsel | The owner-only activity log and decision dashboard: what is recorded and what never is, the rules for small groups and young members, the seven pages, the thresholds, how it fits the other phases, what it cannot tell you |
| `docs/BUILD-NOTES.md` | Reviewer | How each phase's rules work and which choices were judgement calls (history) |
| `DEPLOY.md` | Whoever deploys | The one page to start from: which of three situations you are in, what to run and in what order, your first hour on the real services, the way back |
| `docs/BLUEPRINT-TRACE.md` | Reviewer, pastorate | Each part of the blueprint, where it is built, what proves it, and which decisions still need a person |
| `docs/RELEASE.md` | Whoever deploys, reviewer | The combined test matrix and its twelve rules, the static checks, the way back (rollback files), the rehearsal on a copy of live data, the release order, the browser pass |
| `docs/SWITCHBOARD.md` | The office, pastorate | The Admin page that sets each question, reference, interview, Academy and declaration to Required, Optional or Off, and what each position does |
| `docs/LEADER-BOARD.md` | The office, directors | The leader supply and demand board, suggestions, offers and how an accepted offer fills the Tribe Card |
| `docs/NOTICES-ADMIN.md` | The office, whoever looks after the site | The new Admin (Today, the menu, search, the phone sheet, what changes for someone with two roles) and the team's emails: the eleven groups, the 57 notices, Off / Rehearsal / On, summaries, quiet hours, what an email never says |
| `docs/APPLY-NOTICES-ADMIN.md` | Whoever applies this package | The two migrations, switching it on group by group, how to check it, the way back, and every existing test that had to change |
| `docs/AUTO-PLACEMENT.md` | The owner, the pastorate, the office | Placing waiting members in tribes automatically (the Off / Rehearsal / On switch, a run in five steps, what the member and the leader are sent, Undo), appointing many leaders at once, and a leader recommending an assistant leader |
| `docs/APPLY-AUTO-PLACEMENT.md` | Whoever applies this package | The three migrations, switching it on with a pilot run, how to check it, the way back, and every existing test that had to change |
| `docs/APPLY-INVITATION-EMAIL.md` | Whoever applies this package | Why invitations sent no email, the one migration that fixes it, how to check it, what to look at if it still does not arrive, and the way back |
| `docs/APPLY-GOAL-UNLOCK.md` | Whoever applies this package | "Let them choose": the owner unlocks a leader's goal, the leader picks from a list, and a welcome email signed by the pastor goes with it. The one migration, how to approve the wording, how to check it, the way back, and what was and was not checked |
| `docs/EXPORTS.md` | The owner, the pastorate, the office, the data lead | Exports and Reports: the two lanes, the fourteen packs, the switchboard in God Mode, how a file is made and what is left out, the Open Data Pack and standing links, the log, and what is not in this release |
| `docs/APPLY-EXPORTS.md` | Whoever applies this package | The one migration, opening it up pack by pack from the owner's console, how to check it, the way back, and what was and was not checked |
| `docs/PROFILES.md` | The owner, the pastorate, the office | Profiles and the Weekly Rhythm, stages 1 and 2: the Features switchboard, the facts store, the Details Check and its private link, My page (first for leaders, then for everyone), the pastor's stage review, and how "Off means identical" is proved |
| `docs/APPLY-PROFILES-STAGE-1.md` | Whoever applies this package | The one migration, opening it up for leaders step by step from the owner's console, how to check it, the way back, and what was and was not checked |
| `docs/PROFILE-READERS.md` | Whoever changes how a personal fact is read | Every database function and file that reads a person's stage of life or age range (written by `npm run readers`; a test fails if one is missing) |
| `docs/MESSAGES-AUDIT.md` | The office, whoever writes a message | Every message the platform can send, written out and checked (written by `npm run messages-audit`) |
| `docs/GOD.md` | The platform owner | The hidden owner account, the passphrase, appointing a leader, the desk of each role, the platform's conversations, and what the owner never sees |
| `docs/APPLY-PHASE-A.md`, `docs/APPLY-PHASE-BCD.md` | Whoever applied the earlier packages | How the earlier change-only packages were applied (history; DEPLOY.md replaces them for a new project) |

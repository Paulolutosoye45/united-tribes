# Running United Tribes

For whoever looks after the site: how it is put together, how to deploy it, what to watch, how to change a secret, and what to
do when something stops working. The office's day-to-day screens are in docs/ADMIN.md; what is kept and for how long is in
docs/RETENTION.md.

**Starting from scratch or upgrading?** Read `DEPLOY.md` at the top of the package first: it says which migration files to run, in what order, how to
rehearse on a copy of live data, how to go back, and in what order to switch the new tools on (`docs/RELEASE.md`).

## What runs where

```
 member's phone ──►  the app (Next.js) ──►  Supabase: Postgres (all the rules) + sign-in
                       ▲        │
   heartbeat (every    │        └──►  providers, each optional: WhatsApp (Meta), email (Resend), text (Termii or Twilio),
   5 minutes) ─────────┘               AI suggestions (Anthropic or OpenAI), voice notes (OpenAI), bot check (Cloudflare)
```

- **The app** has no memory of its own. Every page is built per visit for the person looking at it. It can run on Vercel or in
  the container (`Dockerfile`), and more than one copy can run at once.
- **The database** is the authority. Every table has row-level security, and the app has no all-powerful key: it never holds
  Supabase's service-role key, so even a bug in the app cannot read what the signed-in person may not. Keep it that way: do not
  add that key to the app's settings.
- **The heartbeat** (`/api/cron/tick`) runs the season calendar, sends what is due, writes new report summaries, tidies the referee
  checks (forgets spent codes and ended sessions; marks a request that never went out as *Couldn’t reach*), rebuilds the
  platform owner's activity summaries (docs/ACTIVITY.md; a failure shows in `problems` as "activity summaries: …" and does not
  stop messages) and, once a day, refreshes the reporting copy and applies the clean-up rules, including deleting activity detail
  older than the retention setting. If it stops, nothing breaks for members today, but reminders
  and weekly messages stop. Watching it is the one job that matters most (see "Watching it" below).
- **Providers** are all optional and each is off until its settings are present. With none set, the site works and messages are
  simply not sent (or, with `MESSAGING_MODE=log`, are written to the server log instead).

## Deploying for the first time

Do these in order. About half a day, most of it waiting for WhatsApp template approval.

1. **Create the Supabase project.** Choose the region nearest Lagos when you create it (at the time of writing Cape Town,
   `af-south-1`, or London, `eu-west-2`; the region cannot be changed later). Choose a plan that includes daily backups (see
   "Backups" below), not the free tier, before real members use it.
2. **Run the database files.** In `supabase/migrations/` there are 42 files. Either paste them into the SQL editor in file-name
   order, or link the Supabase CLI to the project and run `supabase db push`. Never skip one and never run them out of order.
   Check afterwards: `select public.ping();` returns `{"ok": true}`.
3. **Set up sign-in** as in README → "Turn on sign-in (Supabase settings)" (6-digit code, 600 seconds, your own email sender, the code-only
   email template, Google if wanted, redirect URLs). `supabase/config.toml` holds the same values for local work with the
   Supabase CLI; it does **not** change the hosted project by itself, so make the changes in the dashboard.
4. **Make the first admin.** Sign in once so your account exists, then in the SQL editor run
   `select public.bootstrap_first_admin('your.email@example.org');`. It works once, only from the SQL editor, and only while there
   is no admin. Then give the panel their roles from Admin → People and roles: at least two pastors (nobody can review their own
   application), a director, a care lead, a data lead and the coaches.
5. **Make the sending token** once, in the SQL editor: `select public.bootstrap_worker_token('sender');` and keep what it
   prints; it is shown once. Later, admins can make and revoke tokens in Admin → Sending and reporting.
6. **Make the secrets.**
   - `CRON_SECRET`: any long random text (`openssl rand -hex 32`).
   - `DATA_ENCRYPTION_KEYS`: `node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"`. **Store a
     copy somewhere safe and separate from the site** (the church's password manager, not the repository). If every copy is
     lost, members' private notes can never be read again. Production refuses to save those notes until it is set.
7. **Put the app online** (one of the three ways below) with the settings from the table in the next section.
8. **Start the heartbeat** (below) and confirm it: open `https://YOUR-SITE/api/health` — it should say `{"ok":true,...}`.
   With the secret it also shows the message queue:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE/api/health`.
9. **WhatsApp:** `npm run templates -- --submit` sends the message wordings to Meta for approval (minutes to a day), then
   set up WhatsApp sign-in only if wanted (docs/SIGNIN-CHANNELS.md). Email: verify the sending domain at Resend first. Text: Termii's sender name needs
   approval. Until a channel works, leave it unset.
10. **Walk through it once** as a real person on a phone: sign in, fill the form, then open Admin and work down the checklist
    ("Before the season opens").

### Three ways to host the app

| | When it fits | How |
| --- | --- | --- |
| **Vercel, Pro plan** | The least work. | Import the repository. Add the settings. `vercel.json` already asks Vercel to call the heartbeat every 5 minutes. Vercel's free Hobby plan only allows one scheduled run a day and refuses to deploy a faster schedule, so use Pro, or use the GitHub heartbeat below. |
| **Vercel, Hobby, with the GitHub heartbeat** | Cheapest. | Delete the `crons` block from `vercel.json`. In the GitHub repository add the variable `SITE_URL` and the secret `CRON_SECRET` (Settings → Secrets and variables → Actions); `.github/workflows/heartbeat.yml` then calls the heartbeat every 5 minutes. GitHub sometimes starts a run late at busy times; fine for weekly messages. |
| **Container on your own server** | The church wants it on infrastructure it controls. | `docker build` with the three build arguments in the `Dockerfile`'s first lines (the public values are written into the site when it is built, so changing one means building again), then `docker run --env-file`. Put it behind HTTPS (a reverse proxy or the host's own). The container has no scheduler: call the heartbeat from anything that can run `curl` every 5 minutes (cron, the GitHub workflow above, a monitoring service). |

On Vercel, set Node.js to 22.x in the project's settings (`package.json` asks for 22 or newer; `.nvmrc` serves developers and the container).

### The settings

Required means the site does not work, or is unsafe, without it. Everything else is switched on by setting it. The full list,
with the reasons, is in `.env.example`.

| Setting | Needed | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | required | From Supabase → Project settings → API. Public by design; built into the site, so change means redeploy. |
| `NEXT_PUBLIC_SITE_URL` | required in production | The public address, no trailing slash. Used to build the private links sent to referees and parents. |
| `DATA_ENCRYPTION_KEYS` | required in production | Seals members' private notes. See "Changing a secret". |
| `WORKER_TOKEN` | required for messages | From step 5. |
| `CRON_SECRET` | required for messages | Who may call the heartbeat and see the detailed health check. |
| `WHATSAPP_*`, `EMAIL_*`/`RESEND_*`, `SMS_*`/`TERMII_*`/`TWILIO_*` | per channel | Sending providers. `MESSAGING_MODE=log` writes messages to the log instead of sending, for a rehearsal. |
| `WHATSAPP_SIGNIN=on` | optional | Shows the WhatsApp tab on the sign-in screen once a sender is working. Needs the hook (docs/SIGNIN-CHANNELS.md). |
| `SIGNIN_WHATSAPP_ROUTE`, `LINKED_SENDER_URL`, `LINKED_SENDER_SECRET`, `WHATSAPP_SIGNIN_NUMBER`, `SIGNIN_HASH_SALT` | optional | Only for sign-in codes from an ordinary WhatsApp number (the `sender/` service). Read docs/SIGNIN-CHANNELS.md first: WhatsApp can restrict such a number. Leave unset for the official (Meta) route. |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, `STT_PROVIDER` | optional | Suggestions and voice notes. Off with no key. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional, recommended | The bot check (below). |
| `CSP_REPORT_ONLY` | emergencies | See the runbook entry "A page is blank or a button does nothing". |
| `TESTIMONY_FORM_URL` | optional | Where a testimony the church keeps is sent. Can also be set in Admin → Settings. |

Never put a setting whose name does not begin with `NEXT_PUBLIC_` into the browser, and never put a secret in a setting that does.

### Switching on the bot check (recommended before launch)

Follow the numbered steps in `.env.example` ("Bot check"). In short: make a free Cloudflare Turnstile widget for your domain, set
the two keys, redeploy, then in Supabase → Authentication → Attack Protection turn on CAPTCHA protection with the same secret.
Two parts: the public key makes the sign-in page show the check; the Supabase switch makes sign-in refuse a request without it.
If you do the Supabase part and forget the public key, **nobody can sign in**. Do the key and redeploy first, then the switch.
A parent taking their permission back is never held up by the check.

## Watching it

Set up an uptime monitor (UptimeRobot, Better Stack, or whatever the church already uses) on these two. They cost nothing and
catch almost everything.

1. **`https://YOUR-SITE/api/health`**, every 5 minutes, alert on anything but 200. Without the secret it only says whether the site and
   database answer.
2. **The same address with the header `Authorization: Bearer <CRON_SECRET>`**, alert on anything but 200. This one also fails (503)
   when a message has been stuck for more than an hour or the oldest due message has waited more than 60 minutes: in other
   words, when sending has stopped. It reveals no names, numbers or message text.

The heartbeat's own answer (`/api/cron/tick`, visible in Vercel's cron log or the GitHub run) is a small summary with a list called
`problems`. Healthy is `"problems":[]`. The GitHub heartbeat fails the run (and emails the repository's watchers) when the list
is not empty. A fault in a once-a-day job (the reporting copy or the clean-up) appears in `problems` but does **not** turn the
status into an error, so a monitor that looks only at the status will not see it: look at the list.

Also worth a glance weekly: Admin → Sending and reporting (when the reporting copy was last filled, and the sending token
history) and Admin → Message log (failed messages and why).

## Changing a secret

| Secret | How to change it | What breaks while you do |
| --- | --- | --- |
| `CRON_SECRET` | Change it in the host and in whatever calls the heartbeat (the GitHub secret, the monitor's header). Deploy. | The heartbeat and detailed monitor get 401 until both match. Use the worker token as the caller for a minute if you need to bridge the gap: it is accepted too. |
| `WORKER_TOKEN` | Admin → Sending and reporting: make a new token, put it in the host, deploy, then revoke the old one. | Nothing, if you revoke last. |
| Provider keys (WhatsApp, Resend, Termii, Twilio, AI) | Make the new key at the provider, replace it in the host, deploy, revoke the old one at the provider. | Messages on that channel fail (and are retried) between the revoke and the deploy; do it in that order. |
| Supabase publishable key | Rarely needed. Rotate in Supabase, replace both `NEXT_PUBLIC_` values, rebuild. | Sign-in is down until the new build is live. |
| Turnstile secret | Rotate in Cloudflare, paste into the host **and** Supabase → Attack Protection, deploy. | Sign-in and parents' "yes" are refused in the gap. Do it off-hours. |
| `DATA_ENCRYPTION_KEYS` | See below. | Nothing, done in order. |
| `SIGNIN_HASH_SALT` | Make a new one (`openssl rand -hex 32`), put it in the host, deploy. If you never set one, a salt is derived from `WORKER_TOKEN`, so changing that token changes it too. | Older hashes stop matching: referee checks for the *same browser or network as the applicant* forget what they knew before the change (they get weaker for a while, nothing breaks), and so do the sign-in limits that use the same salt. |

### Changing the key that seals private notes

Do this when a key may have leaked, or on a schedule the church sets (for example once a year). It is safe while members are
using the site.

1. Make a new key: `openssl rand -base64 32`. Give it the next name (`k2` after `k1`).
2. Put it **in front** in the host's settings and deploy: `DATA_ENCRYPTION_KEYS="k2:<new>,k1:<old>"`. New notes are sealed with `k2`
   from now on; `k1` still opens the old ones.
3. On a trusted computer with this repository, set `DATABASE_URL` (Supabase → Project settings → Database → connection string,
   the direct or session-pooler one, ending `?sslmode=require`) and the same `DATA_ENCRYPTION_KEYS`, then run `npm run reseal`. It
   writes nothing and says how many notes would move.
4. `npm run reseal -- --apply` moves them. It never prints a note, only counts; it opens each note and checks the new seal opens
   before replacing it; and a note a member saved at that very moment is left for the next run.
5. When it says **Safe to remove the old keys**, take `k1` out of the list and deploy again.

If it reports notes "unreadable", it has not touched them: either the key that sealed them is not in your list (add it and run
again), or those notes cannot be recovered. The database password is used only here, by a person; the app never has one.

## Backups and getting back

- **The database is the only thing that matters.** The app can be rebuilt from the repository in minutes; the members' words
  cannot. Check in the Supabase dashboard (Database → Backups) what your plan keeps: daily backups for a limited number of
  days, and optionally point-in-time recovery, which lets you go back to a chosen minute. For a church with thousands of
  members, buy the plan with daily backups at least and consider point-in-time recovery, so a mistake at 14:00 can be undone
  to 13:59. A database backup holds private notes only in sealed form; to read them after a restore you also need the keys.
- **Keep the encryption keys separately from the backups.** A restore of the database without the keys leaves sealed notes
  unreadable. A copy of the database without the keys reads nothing sensitive, which is the point.
- **Practise a restore once** into a scratch Supabase project before launch, then run the app against it: sign in, open a
  tribe. A backup you have never restored is a hope, not a backup.
- **Deleted members come back after a restore.** If you restore a backup taken before an account was deleted, that account is
  back. Keep the list of accounts deleted since the backup (the log has `person.erased` lines with dates, not names, so keep
  a private list) and delete them again after any restore. Data-rights promises are described in docs/RETENTION.md.

## Changing the software

- **Database changes are new files, never edits to old ones.** Name them with the next date and time. Each ends with
  `revoke execute on function … from public, anon, authenticated;` and then grants only to the roles that need it. A test
  fails until a new function is added to its allow-list, on purpose.
- **Before releasing:** `npm run typecheck`, `npm run lint`, `npm test` and `npm run e2e` all pass (the GitHub workflow
  `ci.yml` runs them on every change). Apply new database files to a scratch Supabase project first.
- **Order on release:** run the new database files, then deploy the app. A new app against an old database may call a function
  that is not there; an old app on a new database is normally fine (database changes are additive).
  **One exception:** the rename of circles to tribes and tribes to communities (`20261210000100_tribes_naming.sql`) is not
  additive. The old app cannot run on the renamed database, and the new app cannot run on the old one, so that release is done in
  a quiet hour with the new app prepared and switched on straight after the database file. Follow `UPGRADE-TRIBES.md`.
- **There is no automatic undo for a database file.** If a change is wrong, write the next file that corrects it. For anything
  that removes or rewrites data, take a manual backup first (Supabase → Database → Backups).
- The in-app dashboards read live data; the **reporting copy** (`bi` views) is rebuilt from it once a day and by "Refresh now".

## When something is wrong

Find the symptom, do the check, apply the fix. Nothing here needs the database password.

**Members say they did not get their sign-in code.**
1. Is it email, or WhatsApp? WhatsApp codes: is `WHATSAPP_SIGNIN=on` and the sender set up (docs/SIGNIN-CHANNELS.md)? See also the next entry.
2. Email: Supabase's built-in sender is only for testing and allows a handful an hour. Check Authentication → SMTP Settings has the
   church's own sender, and Authentication → Rate Limits allows enough sign-in emails per hour for a Sunday morning.
3. Look in the sender's own log (Resend, or Supabase → Authentication → Logs) for bounces and spam-folder rejections; check SPF,
   DKIM and DMARC for the sending domain.
4. If the bot check was recently switched on or its keys changed, it may be failing: the sign-in page then says "We couldn’t check
   that you are a person. Reload the page, or try again in a moment." Check the site key is right and the site was rebuilt after
   setting it, and that the secret matches in both places; or turn the Supabase CAPTCHA switch off while you sort it out.

**Announcements or reminders are not going out, or a journey says "Paused".**
1. Open **Admin → Automatic reminders** (`/admin/reminders`). A journey that stopped itself says why (unsubscribes above 1% or
   complaints above 0.1% in a day). Read the emails, fix the cause, then press Restart. It never restarts on its own.
2. Is the master switch on, and is the journey **On** (not Rehearsal)? Rehearsal sends nothing by design.
3. Outside the hours (reminders 9am–7pm Lagos, announcements 8am–8pm) mail waits for morning. The heartbeat (`/api/cron/tick`) must be running.
4. An announcement for 200 or more people waits until a second person approves it: **Admin → Announcements → Approvals**.
5. Email provider checks as for sign-in codes, plus the Resend webhook (`/api/webhooks/email`) so bounces and complaints reach the self-pause.
6. The footer address is set in the `reminder_settings` row (`church_address`). See docs/MESSAGES-REMINDERS.md.

**WhatsApp codes stopped, or the sign-in screen says "WhatsApp codes are paused today".**
1. Open **Admin → WhatsApp sign-in** (`/admin/signin`; the director, a super admin and the data lead can). It says **On**, **Paused**
   or **Switched off**. If Paused, it says why and what to look at first. Email sign-in is not affected by any of this.
2. Paused by itself: read the reason (failed sends, refusals, no delivery receipts, people replying STOP, or the sender logged out).
   Fix that (for an ordinary number: open the phone, check the sender's log, check the number is not restricted), then press
   **Restart** and write a note. It never restarts on its own.
3. Switched off: someone pressed the kill switch. The log on the same page says who and when.
4. Busy event: a hall on one wifi shares one connection. Raise the per-connection and channel limits for the day on the same page.
5. Nothing at all on the page: the database file `20261212000100_signin_channels.sql` has not been applied.
6. The WhatsApp tab is missing from the sign-in screen altogether (not greyed): the site is not fully set up for it. It needs
   `WHATSAPP_SIGNIN=on`, a sender (Meta settings, or `LINKED_SENDER_*`), `WORKER_TOKEN`, and for reply-first a valid
   `WHATSAPP_SIGNIN_NUMBER`. Twilio set up *inside* Supabase also lands here, on purpose (docs/SIGNIN-CHANNELS.md).

**Messages (reminders, weekly nudges) are not going out.**
1. `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE/api/health`. Look at `queue` and `channels`.
2. `channels` has `null` for a channel: its provider settings are missing or wrong. Add them and redeploy.
3. `/api/cron/tick` answers 401: the caller's secret does not match `CRON_SECRET` (or the worker token). Fix the caller's copy.
4. It answers 503 "WORKER_TOKEN is not set": the host has lost the setting.
5. No ticks at all: the heartbeat is not running. Vercel Hobby cannot run a 5-minute schedule (see Hosting); GitHub schedules can be
   paused when a repository has had no activity for 60 days; re-enable the workflow in the Actions tab.
6. Messages fail one by one: Admin → Message log shows each reason. WhatsApp "template not approved" means the wording is still
   waiting at Meta (`npm run templates -- --status`). A hiccup at the provider is retried automatically (three tries, ten
   minutes apart); after that the message shows as failed, and an admin or director can press **Try again** beside it once the
   cause is fixed. It goes out on the next heartbeat.
7. Nothing is wrong but nothing sent: between 10 pm and 6 am messages wait (urgent care alerts excepted), and a member who has
   not agreed to a channel is never sent on it. This is by design.

**The tick's `problems` list is not empty.**
It names the job and carries no personal details. Typical entries: the reporting copy could not be rebuilt (try Admin → Sending
and reporting → Refresh now; a repeated failure means a database file is missing, so check that all 23 are applied), the daily
clean-up failed (`retention_error`: the database file `20261207000100_platform.sql` is missing or a table was changed by hand),
a report summary could not be written (the AI provider is out of credit or the key is wrong; reports still work without the
opening paragraph).

**A page is blank, or a button does nothing, after a change.**
Every page is sent with a strict Content-Security-Policy, so adding a new external service (a script, a video, an image host)
makes the browser block it silently. Set `CSP_REPORT_ONLY=true`, redeploy, and open the page with the browser's console open:
it lists what would be blocked. Add that origin in `src/lib/security/csp.ts`, deploy, and turn the setting off again. A
sign-in page that says "We couldn’t check that you are a person" usually means the bot check script was blocked or the key is
wrong (is the Turnstile site key right, and was the site rebuilt after setting it?).

**The site says "That account is no longer here, so you have been signed out."**
The member's account was deleted (by their request), or removed by hand in the database, while their phone still held a valid
sign-in. They can sign in again to start afresh.

**The health check reports `database: false`.**
Supabase is down or the URL or key is wrong: check status.supabase.com, then Project settings → API against the two
`NEXT_PUBLIC_` values in the host. Members see a plain "something went wrong" page, not details.

**A member cannot be found, or says their answers are gone.**
Admin → People and roles finds people by name or email. A member who asked for their account to be deleted and was erased starts
again as a new member with nothing held. Nothing can bring those answers back except a database restore (see "Backups").

**Someone asks to see, correct or delete what we hold about them.**
They can download a copy and ask for deletion themselves from Profile → Your data. If they ask by email or in person, write the
request down in Admin → Data requests (docs/ADMIN.md). Correction: they can change most of their own answers from their profile;
the rest is changed by an admin in the database, and the church should decide who may do that.

**Suspected leak or misuse.**
1. Rotate the secret involved ("Changing a secret"). For a signed-in session, remove the person's roles in Admin → People and roles.
2. The event log (`event_log`) records who did what and when, never what was written. Query it in the Supabase SQL editor.
3. Tell the Nigeria Data Protection Commission and affected members within the time the law and your counsel require. This
   is a legal duty that the software cannot carry out for you; name the person who will make that call before launch.

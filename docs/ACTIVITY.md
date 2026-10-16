# The activity log and decision dashboard (platform owner only)

Round 2, Phase 5. A private room inside the owner's console (`/god/activity`) that shows **how the platform is being used and
where it needs a decision**: where people drop out of the forms, which tribes are quiet, which messages fail, which referees to
chase, and what the church's own people did and when.

**Only the platform owner can see it.** Nobody else has a menu item, a link, a number, a page or a file from it. For an admin, a
pastor, a leader or a stranger, `/god/activity` is as missing as any page that does not exist. Read docs/GOD.md first for what the
owner is and how the unlock works; this guide covers only what Phase 5 adds.

## What it records, and what it never records

It records **what happened and when, by whom, never what was written.**

| Recorded | Never recorded |
| --- | --- |
| That a person opened a screen, by the screen's name (`home`, `join`, `care`, …) | The address of the page, anything in it, anything typed |
| The device size (phone, tablet, computer) | The device make, the browser, the network address, the location |
| A coarse load-speed band for the first full page load (fast, ok, slow) | Exact times, anything that could single out a handset |
| That a visit began (after 30 quiet minutes) | How the person arrived |
| That a sign-in happened, and whether it used a **code**, a **link** or **Google** (a WhatsApp code counts as a code) | The code, the address or number it went to, the session itself (a one-way hash is kept so one sign-in counts once) |
| That a form was started, moved a step, was submitted, or a profile was changed | Any answer, any private note, any story, any testimony |
| The owner's **own** looks at the dashboard, in the owner's own record, as "You" | The owner is **never** counted as activity and never appears under their name in the office's log |

The list of everything that can be recorded is one table, `activity_catalogue`, and the screens that can be named are another,
`activity_screens`. An event whose kind is not in the catalogue, or whose extra fields are not on its list, is refused by the
database. The extra fields can only be short identifiers (letters, digits, dot, dash), numbers or yes/no, so a sentence cannot be
slipped in as a "meta" value even by a bug. Adding something to be recorded is a deliberate one-line change to the catalogue, which
counsel can read.

### Reserved for Phases 3 and 4

Three kinds are in the catalogue but **nothing writes them yet**. Their numbers read **zero** until those phases are built:

| Kind | For |
| --- | --- |
| `form.answer_changed` | The answer-change log (Phase 3): which question people change after submitting. Carries the form and the field name, never the answer |
| `directory.opened` | The member directory (Phase 4): that it was opened, by whom |
| `directory.exported` | …and that someone exported from it, with the number of rows |

When those phases are built they write through one existing internal function, `activity_note(person, kind, meta)`, and the
dashboard picks them up with no further change. Phase 3's "last active" is **unchanged** by this phase: it stays whatever Phase 3
defines it to be.

## The rules that cannot be changed from a screen

They are written on the Settings page and enforced in the database, so a mistake in a page cannot break them:

1. **Groups under five are hidden.** A count between 1 and 4 is shown as "<5" and never as a number. A funnel bar or a drill-down
   with fewer than five people shows no names at all.
2. **Young members are counted, never named.** The teen track (docs/TEENS.md) is counted in every total, and in the audit trail
   appears as "Young member" with no name, no link and no reference code. The funnel drill-down says "n young members are counted
   and not listed".
3. **The owner is not recorded.** Their pages are not counted, their looks at the dashboard are in the owner's own record, not the
   office's log.
4. **Detail is kept 13 months** (the owner can set 3 to 36 on the Settings page). After that the individual events are deleted
   and only the daily counts, which hold no person, remain.
5. **No one else can read any of it.** The tables have row-level security on, no policy and no grant. They are read only through
   functions that begin by asking "is this the unlocked owner?" and otherwise answer with the same refusal as a missing page.
6. **Nothing here is sent anywhere.** The weekly brief is on the page, written by fixed rules, to read or copy. It is **not**
   sent by WhatsApp or email.

## The seven pages

| Page | What it answers |
| --- | --- |
| **Pulse** | "What needs a decision this week?" Up to seven flags, each with what it means and the one page to open (see Thresholds). Then the week at a glance, a 30-day line with the month before behind it (any of: people active, visits, screens, sign-ins, forms submitted), when in the week and day people are active, and young members counted. The **weekly brief** is here: a few lines in fixed wording ("Active people rose 12% on the week before"), with **Copy as text** |
| **Funnels** | Where people stop. The member journey from *Registered* to *Form saved*, *Form submitted*, *Matched*, *Accepted a place*, *Week 1*, *Week 4*, *Week 12*; how long the form takes to finish; a weekly retention grid by the week people registered; and a side-by-side comparison of communities, zones or tribes. Pressing a bar lists the people who stopped there (only when five or more). The member funnel can be split by community, zone or season. The leader journey (apply, referees, interview, certified, tribe led) has its own funnel, **not split** |
| **Stakeholders** | One panel for each group, each saying what it informs: Members, Leader applicants, Referees, Leaders in post, Admin and care team, Pastors and director, and the platform itself |
| **Quality and integrity** | How often the instant checks on leader answers fail and which question trips people up (Phase 1), how many were forced through; the referee checks, flags and call-backs (Phase 2); applications held and cleared by a person; and sign-in codes that fail |
| **Messages and sign-in** | Delivery by channel, sign-in codes sent and failing by method, the sign-in breaker state (the same one `/admin/signin` shows, Phase 6), and opt-outs (Phase 7) |
| **Audit trail** | Who did what, from the office's event log, in plain words, filtered by kind of work, person group, day range and "You" (the owner's own looks). Downloadable as a spreadsheet file; the download is itself written in the owner's record |
| **Settings** | Recording on or off; how long detail is kept; the seven thresholds below; and the fixed rules |

Every chart can be switched **Show as table**, every chart has a caption in fixed wording saying what moved, and every page works on
a phone (no sideways scrolling).

### Thresholds (the Pulse flags)

Defaults, as the blueprint recommended. Each can be changed on Settings (1 to 365); each change is written in the owner's record
with the old and new value.

| Flag | Default | What it opens |
| --- | --- | --- |
| Members waiting for a tribe | more than **14 days** | the people list |
| Leader applications held | more than **48 hours** | leader quality (Phase 1) |
| Referees not verified | after **5 days** | referees (Phase 2) |
| Messages failed in the last 7 days | **5** or more | messages (Phase 7) |
| Care tasks overdue | more than **2 days** | care |
| Sign-in codes failing | **25 percent** or more | sign-in (Phase 6) |
| Members in a tribe quiet | more than **21 days** | the people list |

A flag appears only when its number is reached, and says what to do. With nothing reached the page says so.

## How it is built

* **Closed tables.** `activity_events` (one row per thing that happened), the summaries `activity_people`, `activity_person_day`,
  `activity_daily`, `activity_hourly`, and the settings, catalogue, screens, steps and thresholds. All have row-level security on,
  **no policy**, and every right revoked.
* **Owner-only reports.** Thirteen `security definer` functions, each starting with `god_only()`. The unlock is bound to the one
  sign-in session the owner unlocked on (docs/GOD.md), so a second sign-in of the same account cannot open the dashboard.
* **One narrow door.** `activity_track(kind, screen, device, method, speed)` is the only thing a signed-in person can call. It
  ignores the owner and anyone hidden, ignores everything while recording is paused, caps a person at 1,500 events a day, counts the
  same screen at most once in 20 seconds, starts a visit after 30 quiet minutes, and counts one sign-in per session. The website
  reaches it through `/api/track`, which accepts only a same-origin JSON body of a few fixed fields in 400 bytes or less, answers
  "sign in" when signed out, and otherwise always answers "no content" so a page can never tell what was kept.
* **Form events by trigger.** Starting and moving through a form, submitting it and changing a profile are recorded by database
  triggers on the existing form tables (`intake_drafts`, `member_profiles`, `leader_applications`). The forms' own code is not
  changed, and a person created by any route (including a test) is counted.
* **Summaries on the heartbeat.** `/api/cron/tick` now also calls `worker_activity_refresh`, which rebuilds the last three days of
  summaries (the same five-minute heartbeat as everything else). The first run back-fills from the earliest record the platform
  has (the office's event log, form dates, registrations), within the retention window, so Pulse and Funnels are not empty on day
  one. Once a day it deletes events older than the retention setting. A failure appears in the heartbeat's `problems` list and
  does not stop messages going out.
* **The pages** are server-rendered per visit, read only the summaries, draw plain SVG and HTML charts in the site's own style
  (no chart library, no outside request) and record each tab the owner opens in the owner's record (one note a minute per tab).
* **The beacon.** `ScreenBeacon` sits in the two signed-in layouts and sends the screen's name, the device size and, on the first
  full page load, the speed band, using `sendBeacon`. It does not run on `/god` at all.
* **Wording.** `src/lib/activity/` holds the screen list, the request check, the formatting, the weekly brief, the chart captions
  and the spreadsheet writer. The fixed wording means the owner can predict every sentence; there is no AI in this phase.

## How it fits the other phases

| Phase | Fit |
| --- | --- |
| **1 Leader answer checks** | Quality tab reads the check records (failed, forced through, per question). The leader form's steps are mirrored in `activity_steps`; a unit test fails if the form and the list ever differ |
| **2 Referee trust** | Quality and Stakeholders read the referee state, flags, call-backs and time-to-verify. Flags open `/admin/referees` |
| **3 Answer-change log** | Reserved kind `form.answer_changed` (reads zero until built). "Last active" there is unchanged |
| **4 Member directory** | Reserved kinds `directory.opened` and `directory.exported` (read zero until built) |
| **6 Sign-in channels** | Sign-in method is recorded at the three places a sign-in completes; the Messages tab shows the same breaker state as `/admin/signin`; the failing-codes flag opens it. The two stay independent: neither blocks the other |
| **7 Messages and reminders** | Messages tab reads the message log and opt-outs; the failed-messages flag opens `/admin/messages` |
| **God console** | Gains an **Activity** tab; the owner's record gains three kinds of line (looked at, exported, changed a setting) in plain words |
| **Privacy notice** | One sentence added to `/privacy` saying screens and sign-in methods are recorded, never what is written, only the platform administrator sees it, groups under five are never shown as numbers, and detail is deleted after thirteen months |

## What it does not do, and the rough edges

* **Recording starts the day this is deployed.** Sign-ins, screens and visits before that day do not exist and are not guessed.
  Pulse says "recording since …". The form and registration history is back-filled from what the platform already holds.
* **"Active" includes registering and filling in a form**, not only using the programme. A person who only registered is counted
  active that day.
* **People who never use a form** (leaders appointed by invitation, office staff) appear in the member funnel as *stopped at
  Registered* if they are counted as members. The Stakeholders panels, not the member funnel, are the true picture of the team.
* **Leader funnel has no community, zone or season split.** It is shown whole.
* **"Slow screens" is a coarse band**, measured only on a first full page load, not on moves inside the app. It tells you
  whether the site feels slow, not which exact screen.
* **"Appeals upheld"** is shown as *held cases cleared by a person*: the platform has no separate appeal step.
* **Young members are in the totals.** A total that excludes them would be a different number from every other page. They are
  never named, but a very small group can still be guessed at from totals; the five-person rule covers breakdowns, not totals.
* **The sign-in method "WhatsApp" is a code** and is counted as one; the fixed-wording captions say so.
* **Nothing here has been checked on real phones, real mobile networks or a real WhatsApp provider.** The speed band and device
  size come from the browser; the tests drive a real browser at phone width but a fast local network.
* **Not a legal ruling.** See the open point below.

## Speed

Tested against a database holding **20,000 people and 1,000,000 recorded events** plus 200,000 office-log lines and 50,000
messages. The pages read the summaries, not the raw events.

| What | Time |
| --- | --- |
| First fill of every summary from scratch (once, at deploy) | about 26 seconds |
| The heartbeat's refresh (every five minutes) | about 1.5 seconds |
| Pulse | 0.6 s |
| Funnels, member (whole, by zone, by community) | 0.15 s, 0.34 s, 0.40 s |
| Funnels, leader; the list of people at a bar | 0.004 s; 0.27 s |
| Compare communities, zones, tribes | 0.18 s, 0.20 s, 0.09 s |
| Retention grid; the heat map | 0.49 s; 0.56 s |
| Stakeholders (the slowest) | 0.72 s |
| Quality and integrity; Messages and sign-in | 0.006 s; 0.08 s |
| Audit trail (100 rows; one area for a week) | 0.09 s; 0.08 s |
| Settings | 0.002 s |

Every tab must open in under two seconds and the test fails if one does not. These are database times, measured on the build
machine; add the network and the page's own drawing. A busier database server will differ.

## Open point for the pastorate and counsel

Is the one sentence in the privacy notice enough for the Nigeria Data Protection Act 2023, or does recording screen use by named
people need its own consent line (for example a tick on the first sign-in screen)? The software records only what people did and
when, never what they wrote, and shows it to one person; whether that is "legitimate interest" or needs consent is for counsel.
If a consent line is wanted, the recording switch on the Settings page is the place it would attach: with recording off, nothing
new is counted. Also confirm that **13 months** is the right period (docs/RETENTION.md).

## Where this is in the code

| Piece | File |
| --- | --- |
| The database | `supabase/migrations/20261215000100_activity.sql` |
| The owner's pages | `src/app/(app)/god/activity/` and `src/components/activity/` |
| Screens, request check, formatting, brief, captions, spreadsheet | `src/lib/activity/` |
| The one door | `src/app/api/track/route.ts` |
| Sign-in method recording | `src/lib/activity/signin.ts`, called from `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts` and `src/components/auth/SignInPanel.tsx` |
| The heartbeat | `src/app/api/cron/tick/route.ts` |
| Tests | `tests/db/activity.test.ts`, `activity-numbers.test.ts`, `activity-scale.test.ts`; `tests/unit/activity-*.test.ts`; `e2e/journeys/16-activity.ts` (75 checks in a browser) |

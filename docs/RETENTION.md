# What is kept, for how long, and what a member can ask for

The Nigeria Data Protection Act 2023 expects the church to keep personal data only as long as it needs it, and to let people see
what is held about them and ask for it to be deleted. This page says what the software does about both, in plain terms, so
the pastorate and counsel can check it against the privacy notice (`/privacy`) and decide the open points at the end.

Nothing here is legal advice. The periods below are the software's starting position, not a ruling.

## At a glance

| What | Kept | How it is cleared |
| --- | --- | --- |
| A member's answers, tribe history, check-ins, steps, testimonies, photo, agreements | While they are in the programme, until they delete their answers or their account | The member, from their profile (Change or Delete my answers; Your data → delete my account) |
| A half-finished member form (and the private notes saved with it, sealed) | 30 days after it was last touched | The daily clean-up |
| The sentence a member wrote about their season | Until the season ends | The daily clean-up (a member can delete it sooner) |
| The wording of a message that has been sent or has failed | 90 days | The daily clean-up empties the wording; the fact that it was sent, on which channel, and whether it arrived stays for the message log and reports |
| A message sent to someone who is not a member (a referee, a parent) | 90 days | The daily clean-up deletes it |
| A parent's or guardian's name and contact, with the permission they gave | 90 days after the young person's last season ended | The daily clean-up |
| A leader's application, referees' answers and the panel's scores | While the person serves; withdrawn applications are deleted at once | See "Leaders" below |
| The event log (what was done, when, by whom; never what was written) | Kept | Not cleared (it is the church's record of who did what). It holds no names or email addresses of members, only internal codes |
| What the platform owner's activity dashboard records (which screen was opened and when, sign-in method, form steps; never what was written; docs/ACTIVITY.md) | **13 months** of detail (the owner can set 3 to 36); the daily counts, which hold no person, are kept | The daily clean-up deletes events older than the setting. A deleted member's rows go with their account |
| The reporting copy (`bi` views, one coded row per member and season) | Rebuilt daily from live data | A deleted member drops out at the next daily rebuild, or at once with Admin → Sending and reporting → Refresh now |
| Database backups | As long as the backup plan keeps them | They roll off by themselves (see "What deleting does not reach") |

The periods live in one place, the database function `retention_periods()`, so changing one is a one-line database file that
counsel can read:

```sql
'guardian_days', 90, 'draft_days', 30, 'message_days', 90
```

## The daily clean-up

Once per Lagos day, inside the heartbeat (`worker_tick` calls `retention_tick`), the database:

1. removes parent and guardian contact details 90 days after the young person's last season ended;
2. deletes unfinished member forms untouched for 30 days;
3. clears the written season story from every profile whose season has ended;
4. deletes messages that went to a bare address (a referee, a parent) 90 days after they finished;
5. empties the wording of every other finished message after 90 days;
6. (Phase 5) deletes activity events older than the activity retention setting, 13 months unless the owner changed it. This runs
   in the activity refresh on the heartbeat (`worker_activity_refresh`), once per Lagos day, and its count appears in the heartbeat's answer.

It then writes one line to the event log with **counts only** ("3 forms, 12 messages…"), never who or what. It runs once a day
(it remembers it has run), and a failure shows up in the heartbeat's `problems` list without stopping messages going out
(docs/OPERATIONS.md). It is tested against a real database in `tests/db/platform.test.ts` and in a real browser in
`e2e/journeys/08-platform.ts`.

## What a member can do for themselves

All of this is on **Profile**, which any signed-in member can open.

- **See, change or delete their answers**, and withdraw any agreement (matching, WhatsApp, the AI assistant). It takes effect
  immediately.
- **Download a copy of everything held about them** (Your data → Download my data): one file, named with the date, that opens
  in any text editor. It contains their details and roles, how we reach them, their agreements, their form answers with community,
  goal and season written out in words, their tribes, attendance, weekly check-ins, steps, days in the Word, testimonies,
  tribe-change requests and the suggestions they were shown, the messages sent to them, their use of the assistant, their
  Leader Academy record and any leader application, and any parent permission. Their **private notes** (what would help us
  care for them, and the note for their leader) are sealed with keys only the app holds; the file contains them opened, in
  words, for them and nobody else. The file is never cached and cannot be fetched by another website.
  *Left out on purpose:* anything about anyone else; the assistant's raw usage records; and notes the staff wrote about them
  (care records): the file shows only **how many** exist. See open point 5.
- **Ask for their account to be deleted** (Your data → Ask for my account to be deleted). They can add a note, and can take the
  request back while it waits. They are told the office answers it, and, if the answer is "not yet", they read the reason on
  their profile and can ask again.

A member who cannot use the screens (no smartphone, no data) asks the office; the office writes the request down in **Admin →
Data requests → Someone asked another way**, and it goes through the same checks and the same office decision.

## What the office does

Admins and directors (nobody else) see **Admin → Data requests** (docs/ADMIN.md). Deleting is never automatic and never
bulk: each request is read by a person, who can say "not now" with a reason, or delete, after typing the person's own email
address so the wrong person cannot be erased by a slip. The log records that an erasure happened, when, and who answered; it
holds no name or email.

The software refuses on its own to delete:

- someone who **leads a tribe** (the tribe and the seats of the people in it belong to the leader's record; arrange another
  leader or close the tribe first);
- the person's **own** account (another admin must answer);
- someone who holds the **admin, director or pastor** role, unless the person answering is an admin;
- the **last admin** (so the church is never locked out of its own system).

## What deleting an account removes, and what it keeps

Deleting removes the person's sign-in account. Every table that holds something about a person points at that account and goes
with it. This was checked by listing every link into the people table: none refuses to cascade.

**Deleted:** the account and profile, answers and drafts, photo, agreements and contact choices, the place in any tribe and
attendance, check-ins, steps, days in the Word, testimonies, celebrations about them, prayer requests they raised, messages sent
to them, invitations to their email address, tribe-change requests, their Leader Academy record, their leader application
(with its referee answers and the panel's scores), and any parent permission.

**Kept, without the person's name:** work done *for other people*: a decision they made, a review they wrote, a note they
logged for a tribe, an interview they ran. The record stays so the other person's file is complete; only the link to who
did it is removed. **Their tribe** stays, as does everyone else's data; the leaver's attendance goes from its record.
**A reference they gave for someone else** keeps the ratings with that person's application; the referee's name becomes "Former
referee" and the contact "erased". **The event log** keeps what happened and when. Earlier actions by the person lose their link to
them, and entries *about* them keep only an internal code, never a name or email.

**Starting again:** the same email address can sign in later. It becomes a new account with nothing held.

## What deleting does not reach

Be honest about these in the privacy notice (it already says the first two). Software cannot reach beyond its own database:

- **Backups.** A deleted person is still in older database backups until those backups are replaced (depending on the plan, up
  to a few weeks). After a restore, delete again anyone deleted since the backup (docs/OPERATIONS.md → Backups).
- **The reporting copy** until its next daily rebuild.
- **Providers' own logs.** WhatsApp (Meta), the email and text-message services keep delivery records under their own terms; the
  AI provider receives a member's season sentence with contact details removed, and the speech service receives a recording
  that the church does not store. Choose provider settings with the shortest retention they offer and, where offered, switch off
  using content for training. Check each provider's terms with counsel; the church is responsible for who it chooses.
- **Other people's copies.** What a leader or another member already saw, wrote down or screenshotted.

## Where this is in the code

| Piece | File |
| --- | --- |
| Periods and the daily clean-up | `supabase/migrations/20261207000100_platform.sql` (`retention_periods`, `retention_tick`) |
| Download, request, queue, decline, erase | `supabase/migrations/20261208000100_data_rights.sql` |
| The download route (opens the sealed notes) | `src/app/(app)/profile/data/route.ts`, `src/lib/privacy/export.ts` |
| The member's screen | `src/components/profile/YourData.tsx` |
| The office's screen | `src/app/(app)/admin/privacy/`, `src/components/admin/ErasureBoard.tsx` |
| Activity retention (Phase 5) | `supabase/migrations/20261215000100_activity.sql` (`activity_prune`, `activity_settings`) |
| Tests | `tests/db/data-rights.test.ts` (16), `tests/unit/privacy.test.ts`, `e2e/journeys/09-data-rights.ts` (46 checks in a browser) |

## Open points for the pastorate and counsel

1. **How quickly requests are answered.** The software has no deadline. State the church's promise in the privacy notice and
   name who watches Admin → Data requests, and who covers them when away.
2. **Safeguarding records versus deletion.** Deleting a leader removes their application, referees' answers and scores, and
   the privacy notice says the church "keeps the record ... while you serve". If the church must keep a minimal record after
   someone leaves (for example, that a concern was raised and how it was settled), say so with counsel and either have the
   office say "not now" with that reason, or ask for a change that keeps a redacted record in place of deleting it.
3. **The periods** in the table above (30, 90, 90, season end). They are proposals.
4. **Whether the church must register or appoint a data protection officer** with the Nigeria Data Protection Commission, and
   whether holding the details of 5,000 or more members counts as large-scale processing needing an audit or impact
   assessment. The software does not do this for you.
5. **What a member's copy should include.** Care records written by staff (check-in follow-ups, care notes) are left out of the
   download and only counted, to protect the member and the person who wrote them. Counsel should confirm that is acceptable
   under the right of access, or the church can decide to include them.
6. **Young people.** With the teen track on (docs/TEENS.md), a parent or guardian may ask on a young person's behalf. They do
   that through the office, which writes the request down; check what proof of identity the church will ask for.
7. **Activity recording.** The privacy notice now says screens and sign-in methods are recorded (never what is written), only the
   platform administrator sees them, and detail is deleted after thirteen months. Counsel should say whether that is enough or a
   consent line is wanted, and whether 13 months is right (docs/ACTIVITY.md, last section).
8. **Wording.** The privacy notice, the consent screens and the parent's page are plain-language drafts. Counsel should review
   all three together, and add the office's contact details.

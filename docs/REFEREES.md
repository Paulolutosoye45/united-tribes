# Referees: proving the reference came from the person named

Before this release an applicant made each referee's link, saw it, and could open it. Anyone could answer a reference by
opening their own link and pretending. Now the **system** sends the link to the referee's own phone or email, a **six-digit code**
goes to the same place, and the church's own **list of pastors and unit heads** decides who counts as a pastor or unit head.
Nothing is deleted and nothing is blocked outright: odd cases are held for a person to look at.

Screens: **Admin → Pastors and unit heads** (`/admin/referees`), **Care → Referee call-backs** (`/care/referees`), and a new
panel on every application in **Review**.

## The one thing to do first: put the church's list in

1. Open **Admin → Pastors and unit heads**. Press **Choose a file** (or drop it on the box). Excel (`.xlsx`) or CSV.
2. The page reads it and shows exactly what would change **before anything does**: how many are new, updated, unchanged,
   taken off, or can't be used, and each person by name. Nothing has changed yet.
3. Press **Add N**. Done. To go back, press **Undo this upload** on the confirmation (or on **Upload history** later).

You can upload the same file as often as you like. People are matched by their **phone number or email**, never by name, so
nobody is added twice. Update the sheet whenever the pastorate changes and upload it again.

What the reader copes with, because spreadsheets typed by hand are never tidy:

- A title row above the columns, blank rows, a "total" line, example rows (anything starting "(example)" is left out).
- Any sensible column title: *Full Name, Position, Dept / Unit, Phone No., Alt Phone, WhatsApp, E-mail, Remarks*.
- Several sheets: it picks the one with the most people and lets you switch. Hidden sheets are ignored.
- Several numbers or emails in one cell ("0803 111 2222 / 0805 111 3333", "a@x.org; b@x.org"), numbers that lost their leading zero
  in Excel (`8031112222`), `+234`, `234…` and `0…` forms. All are stored one way.
- Roles written as *Pastor, Pst, Rev, Bishop, Unit head, HOD, Head of Department, Ministry leader…*. A role it cannot read
  (for example "Deacon") is **not guessed**: the row is shown as "can't use", with what the cell said and which row it is, and a
  question lets you give all such rows a role, or leave them out.
- An **Active** column: put `No` to take one person off the list (they are kept, as "Taken off", never deleted).
- CSV from Excel in Windows (semicolons, Windows-1252 accents) as well as UTF-8.

Two ways to use a file, chosen on the preview:

| | What it does | Use it when |
|---|---|---|
| **Add and update** (the usual) | Adds new people and changes those in the file. **Nobody is taken off.** | Almost always |
| **Replace the list** | The file is the whole list. People not in it are taken off (not deleted). | The sheet is the complete, current list |

A **Replace** that would take most of the list off (more than 5 people and more than 40% of those on it) is held until a box
is ticked, so uploading the wrong file cannot empty the list by accident. Everything an upload did can be undone.

Other things on the page: **Download the template** (Excel with a "How to fill this in" sheet and a Role drop-down, or CSV),
**Download the current list** (to edit and upload back), search, filters (role, on the list / taken off), add or edit one person
by hand, take one off or put one back, delete one completely (for someone who asks not to be on the list), and the upload history.

**Who counts as "a pastor or unit head"** is a setting on the same page (default: Pastor and Unit head; tick Ministry leader to
include them). It is the church's decision, not the software's.

Files are read in the website's own code and never stored: the page keeps the people it read and sends them back when you press Add.
The size limit is 4 MB and 5,000 people per file.

## What an applicant sees and does

- On **Lead**, each referee shows a status: *Not sent, Sending, Sent, Opened, Confirmed it’s them, Answered* (or *Couldn’t reach*). The
  applicant presses **Send request** and the system sends it. **They never see the link or the code**, in the page, in any
  message they are sent, or in the database role the website uses for them.
- A referee's contact must be **different from the applicant's own phone and email**, and **from the other referee**. A contact
  outside the church's list cannot be used by several applicants (a pastor on the list can). Temporary-email domains are refused.
  Messages say what to fix in plain words.
- A referee can be **changed at most twice per slot**, after a request has gone out; each change is logged with the old and new
  contact (staff only). A request can be sent at most 3 times a day for each referee.

## What a referee sees and does

1. The message (WhatsApp or text if a phone number, email if an email) holds a private link. Opening the link shows a page that
   says who it is for and where a code will go, with most of the address hidden (`i•••@church.org`). There is **no place to type a
   different address**.
2. **Send me the code** sends six digits to that same phone or email. They last 10 minutes; a new one can be asked for after a
   minute. **Five wrong tries lock the page for 30 minutes**; the right code is refused while it is locked.
3. The right code opens a three-hour session (kept in a cookie that only that link's page receives). Only then do the four
   questions appear. The screen says who the system now knows them as ("Pastor Ife Adeyemi, Ota Central") or that they have shown
   they hold the phone or email.
4. They send the ratings. The bot check (if switched on) is still asked at this step.

A link opened by a **program** (WhatsApp draws a preview of every link it sends; mail scanners open them too) is **not** counted as
the referee opening it. Programs are recognised by the name they give themselves.

## What a pastor sees (Review)

Under each reference: *On the church's list* and *Counts as pastor or unit head*, or *Verified contact*; what was proved and when;
and any **flags**, each in words with what to do. A pastor can:

- **Confirm they are a pastor or unit head**, in one tap with a short note, for a verified contact who is not on the list. Only that
  makes the reference count for the gate. A pastor-or-unit-head status is **never a tick box**: it comes from the list or from a
  pastor's confirmation.
- **Mark a hold as looked at**, with a note of what was checked. It is recorded with the pastor's name and the reference then counts.

A reference with a **hold** flag is left out of the Leader Readiness Score and does not satisfy "both references in" until a
pastor clears it. It is never refused or deleted.

### Flags

| Flag | When | Effect |
|---|---|---|
| Same browser as the applicant | Answered on a browser the applicant has signed in on (45 days) | **Hold** |
| Same network as the applicant | Answered from a network the applicant has used | Note only (a shared home wifi is common) |
| Finished too fast | Ratings sent in under 40 seconds after the questions appeared | **Hold** |
| Same ratings as the other referee | Both referees gave the same four ratings within half an hour | **Hold** |
| Note reads like the applicant's own | The concern text is very close to the applicant's written answers (uses the Phase 1 fingerprints) | **Hold** |
| Link opened from many networks | The link was opened from three or more different networks | Note |
| Disowned | The referee says an old reference was not theirs | **Hold** |

The 40 seconds and the 20% below are settings on the **Pastors and unit heads** page.

## Care team: call-backs

Every held reference, plus a **random 20%** of the others, becomes a **call-back** on **Care → Referee call-backs**: the care team
phones the referee on the contact they gave (the page shows who, what the applicant said about them, and why it was chosen),
and records one of: *They confirmed it*, *Couldn't reach them* (stays on the list), *It wasn't them* (the reference is left out
and a pastor is told). A note can be added. Care Lead, Pastor, Director and Admin can see the queue.

## References received before this release

They stay valid and are marked **Not verified**. Nothing is deleted. On **Admin → Pastors and unit heads**, under **Waiting for a
pastor / References to confirm**, a pastor can press **Ask to confirm** on one, or **Ask everyone to confirm** (each referee is
asked at most once every 3 days). The referee gets a link; after the code they are asked one question, *Did you send this
reference?* **Yes** records it as theirs. **No** marks it disowned, leaves it out of the scores, and gives the care team a call to
make. Until then the reference keeps counting as it did.

## What the system keeps about who opened what

Only **salted hashes** of the network address and a random browser cookie (`ut_bid`) ever reach the database, never the address
itself; applicants’ are kept 45 days; spent codes and ended sessions are cleared by the heartbeat. The
**privacy page** says so in plain words. Set `SIGNIN_HASH_SALT` (`openssl rand -hex 32`) to choose the salt; without it one is
derived from `WORKER_TOKEN`. Changing the salt makes older hashes stop matching, which only loosens the "same browser" check.

## Settings (Pastors and unit heads → Settings)

Who counts as pastor or unit head · share of references called back (0–100%, default 20) · "too fast" seconds (default 40).
The code lifetime (10 minutes), tries (5), lock (30 minutes), changes per slot (2), link lifetime (30 days) and sends a day (3) are
in the `referee_settings` row in the database.

## Messages and WhatsApp templates

New messages: `referee_request` (the link), `referee_code` (the six digits) and `referee_reverify` (the link for an old
reference). WhatsApp requires Meta to approve the wording of any message that starts a conversation. **Run `npm run templates`**
to see the three, `npm run templates -- --submit` to send them for approval, and `npm run templates -- --status` to check. Until
they are approved the WhatsApp message is not delivered. A request that goes out on no channel, or sits unsent for two hours,
shows as *Couldn’t reach*, and the applicant can change that referee’s contact. Emails need no approval.

## Safety and privacy

- The link and the code are made **when the message is picked up for sending**, not when the applicant presses the button, so they
  are never stored in the queue where a person could read them. The queue holds only which reference and which contact; once sent,
  even that is wiped.
- The applicant's database role is given a short list of columns on `leader_references`; `select *` on it is refused.
- Every trust table (settings, directory, trust, access, flags, call-backs, sessions, changes) is for staff only. The directory is
  never readable by an applicant: it would otherwise tell them whose name to give.
- Directory changes, clears, confirmations and call-backs are in the audit log with who did them.

## What this does and does not prove (please read)

- A referee check proves **control of a phone or an email**, not who is holding it. A determined person with a friend's phone, or
  who set up a new email, can still answer. The list, the flags and the call-backs make that **hard and noticeable**, not impossible.
- The **same-network** flag is deliberately soft (a household shares wifi) and is a note, not a hold.
- A person on the list is trusted because the contact the applicant typed matches the list. If the church's list has a wrong
  number, the wrong person is "verified". Keeping the list right is the safeguard.
- A reference answered **before** a person was added to the list is matched automatically when the list changes; a pastor's earlier
  confirmation is kept.
- Nothing has been sent through a real WhatsApp, text or email provider from where this was built. The tests use a stand-in
  that records what would be sent. Do the first-hour check in DEPLOY.md with your own phone and email first.
- A phone number is sent to on WhatsApp, and by text when an SMS provider is set (`SMS_PROVIDER`, as for the other messages).

## Where things are

| | |
|---|---|
| Database | `supabase/migrations/20261214000100_referee_trust.sql` |
| Spreadsheet reading and writing | `src/lib/leaders/referee/sheet/` (zip, xlsx, csv, columns, parse, build). No new packages |
| Contact rules | `src/lib/leaders/referee/contact.ts` (same rules in the database; one shared test list) |
| Upload endpoints | `src/app/api/referees/{read,preview,apply,undo,file}` |
| Pages | `src/app/(app)/admin/referees`, `src/app/(app)/care/referees`, `src/app/(public)/reference/[token]` |
| Components | `src/components/admin/referees/`, `src/components/leaders/{RefereeFlow,RefereeLinks,RefereeTrust}.tsx`, `src/components/care/CallbackQueue.tsx` |
| Tests | `tests/db/referee-trust.test.ts`, `tests/unit/referee-*.test.ts`, `e2e/journeys/13-referee.ts` |

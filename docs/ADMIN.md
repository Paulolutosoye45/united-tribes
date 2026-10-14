# The admin hub

Everything the office needs to run United Tribes without a developer. Open **Admin** in the top bar. The hub starts with
**Before the season opens**: a checklist of what is still missing, each line a link to the screen that fixes it. Below it
are the screens the signed-in person's role allows, and the numbers ("At a glance").

## Who can do what

| Screen | Read | Change |
| --- | --- | --- |
| Seasons | admin, director, pastor, data lead | admin, director |
| Weekly guides | admin, director, pastor, data lead | admin, director, pastor |
| Communities and goals | admin, director, pastor, data lead | admin, director |
| Community champions | admin, director, pastor, data lead | admin, director |
| People and roles | admin, director | admin, director |
| Targets | admin, director, pastor, data lead | admin, director, data lead |
| Settings (the church's words, testimony form) | admin, director, pastor, data lead | admin, director, pastor |
| Sending and reporting | admin, director, data lead | admin (tokens), admin, director, data lead (reporting copy) |
| Message log | admin, director, data lead | admin, director (put a failed message back in the queue) |
| Data requests (account deletion) | admin, director | admin, director |
| Pastors and unit heads (the list referees are checked against) | admin, director, pastor | admin, director, pastor |

The database enforces every line of this table; the screens only hide what a person could not use. Someone who opens a
screen they may not see is sent to Home.

## Seasons

- A season **starts on a Sunday** and runs **4 to 24 weeks**. Weekly messages, guides and reports count their days from
  the start date, so the dates matter more than the label.
- Only **one season can be prepared** (Planning or Open) at a time. Leaders and members are given the season that is being
  prepared. Run it or close it before planning another.
- Dates cannot change once tribes are approved for the season or it has begun.
- Planning → Open → Running → Closed. A season only moves forward (Open can step back to Planning). A closed season is
  final and its results stay as they are. Closing asks for confirmation.
- Two seasons cannot overlap.

## Weekly guides

Twelve guides, edited live: tribes read the guide as it stands, so a saved change reaches every tribe at once. Saving
counts as having read and approved the week (a guide shows *Draft* until someone does). Messages already sent are not
recalled. The **community and goal layer** (skill-share prompts, step ideas) has its own screen.

## Communities and goals

- Members and leaders choose from the same list, so the matching can pair them exactly.
- **Retire** a goal or close a community instead of deleting it: nobody new can choose it, people who chose it before keep it
  (and can save the form again unchanged), and every past season's results still read correctly.
- A goal cannot move to another community once members or tribes use it. Retire it and add a new one.
- **Goals members wrote in** are listed only when two or more members used the same wording, so one person's sentence is
  never singled out. Add the good ones to the catalogue, or mark them "Not for the catalogue". A switch shows wording
  written by one member; use it with care.
- **Age tracks** can be opened and closed (at least one stays open). The teen track also needs the platform switch
  (docs/TEENS.md) and cannot be opened from here until the database owner turns that on.

## Targets

The numbers every dashboard and report is measured against, with the programme's usual setting beside each. Percentages are
typed the way they read (85, not 0.85). Every change is written to the audit log with who made it; "Go back to" restores the
usual setting. Dashboards change the next time they are opened; nothing already sent is rewritten.

## Settings

- **Vision and mission** appear to leaders in the Academy, in the church's own words.
- **Testimony form address** (https only) is what the pastorate uses to forward a testimony. If it is blank, the
  `TESTIMONY_FORM_URL` environment variable is used.
- **Platform switches** (more than one centre, tribes for ages 13 to 17) are shown, never changed here. Only whoever manages
  the database can turn one on, after the steps in docs/MULTI-CENTRE.md and docs/TEENS.md.

## Sending and reporting

- **Sending token**: the sending service (Vercel cron or any host that calls the worker endpoints) holds one token and can
  only claim a message, report how it went and run the weekly calendar. The token is shown **once**; the database keeps a
  fingerprint. Put it in the host as `WORKER_TOKEN`. To rotate: make a new token, deploy it, revoke the old one.
- **Reporting copy**: see docs/BI.md.
- **Message log**: every message, its channel and what became of it, with a filter for status and kind. Names are shown to
  the office only.
  A message that **failed** has a **Try again** button (admins and directors only): it goes back in the queue as if new and is
  sent on the next heartbeat. Fix the cause first (the reason is shown beside it), or it will fail again.

## Data requests

Every member can download a copy of everything held about them and can ask for their account to be deleted, from **Profile →
Your data**. Deletion is never automatic: a request waits on **Admin → Data requests** until an admin or director answers it
(nobody else, pastors and data leads included, can open the screen). The page itself explains each choice; this is the short
version.

- **Waiting for an answer** lists each request with the member's own words, the date they asked, and what deleting them would
  remove (their account and answers, messages, check-ins, steps, testimonies and photo; their place in any tribe: the tribe
  stays and their attendance goes from its record).
- **Delete their account** is switched off until you type the person's own email address, so a wrong click cannot erase the
  wrong person. Deleting cannot be undone. The person is signed out; if they sign in again later they start as a new member
  with nothing held.
- **Say not now** needs a reason, which the member reads on their profile and can answer by asking again. The request moves to
  "Answered: not now".
- **Some people cannot be deleted yet**, and the card says why in plain words, with the delete button switched off: it is
  **your own account** (ask another admin), they **lead a tribe** (arrange another leader, or close the tribe, first), they
  hold the **admin, director or pastor role** (only an admin can erase them), or they are the **last admin** (make someone else
  an admin first). Say not now, with the reason, and the member is told.
- **Someone asked another way** (email, in person): write down the address they sign in with and what they said. It joins the
  same list, marked as written down by the office, and goes through the same checks. The person must have signed in at least once.
- The log records that a deletion happened, who answered, and nothing about who was deleted. Details of what is and is not
  removed, and how long everything else is kept, are in docs/RETENTION.md.

## Pastors and unit heads

The church's own list, used to tell whether a referee is a pastor or unit head. Upload the spreadsheet (Excel or CSV), read what it would
change, press Add, and upload again whenever it changes. Uploads can be undone. Everything about it, including the settings on the
same page and the call-backs the care team makes, is in **docs/REFEREES.md**. Set it up before applications open: until the list is in, every
referee is a "verified contact" and a pastor has to confirm each one by hand.

## Before the first season (the checklist, in order)

1. A season is planned (Seasons).
2. The team is in place: a pastor, a care lead, a data lead and at least one coach (People and roles).
3. The vision and mission are written (Settings).
4. The twelve guides are read and approved (Weekly guides).
5. At least one Tribe Card is approved (Review → Tribe Cards).
6. A sending token exists and the sending service has reported in (Sending and reporting).
7. Every community has a champion (Community champions).
8. The testimony form address is saved (Settings).
9. The reporting copy has been refreshed once (Sending and reporting).

Not on the screen's checklist, but needed before launch: the church's list of pastors and unit heads is uploaded (**Admin → Pastors and unit heads**, docs/REFEREES.md), and the church's privacy notice states how quickly a data request is answered
(the app does not set a deadline, so agree the time the church promises with counsel), and someone is named to watch **Admin → Data requests**. See docs/RETENTION.md.

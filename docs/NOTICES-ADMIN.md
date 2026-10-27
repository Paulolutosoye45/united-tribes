# Team emails, and the new Admin

Two things that belong together: the platform now **emails the team when something needs them**, and **Admin is rearranged** so that the first thing anyone sees is what is waiting for *them*.
Both are built for people who hold more than one role: an admin who is also a pastor sees one list, one menu and one daily summary, not two of each.

Nothing is sent until an admin switches a group on. Every group starts **Off**.

## Part 1: the Admin pages

### Today (`/admin`)

Today is what is waiting for the person signed in, and nothing else.

- **Needs attention**: one row for each kind of work (applications waiting for a decision, deletion requests, messages that failed, Tribe Cards to review, a launch step left, and so on). Each row says how many, how long the oldest has waited, and has an **Open** button that goes to the page where it is done. Urgent rows come first (a referee's concern; a deletion request in its last week), then the oldest, then the biggest.
- **Team emails**: only when there is something to say. Admins and directors are told when groups are still Off or a group that is On has nobody in it; anyone on the office team is told when a notice could not be queued this week.
- **Coming up**: the next few dates (a season opening or ending, a workshop, a deletion request falling due).
- **Shortcuts**: on a phone or tablet only. Four to six links to the pages that role uses most. On a computer the menu is already beside the page.
- **Numbers**: members placed, applications this month, leaders certified, tribes open. **More figures** opens the four panels that used to sit under "At a glance" (now `/admin/figures`). **See the full dashboard** shows for those who may open it.

### Someone who holds more than one role

An admin who is also a pastor gets **one** Today with the work of both, each kind of work once. Each row carries a small tag for the role it belongs to, and a row both roles share carries both tags.
Above the list are chips: **Everything · Admin · Pastor**. Press one to look at one hat at a time. The choice is remembered on that device (and if the browser will not keep it, for as long as the page is open). If a role is taken away, the chip goes the same day and a remembered choice that no longer exists is ignored.

The **menu** is the pages of every role the person holds, each page once. An admin sees 25 pages, a pastor 20, and someone who is both sees 26 (every page of either).

### The menu

- **On a computer**: down the left, in seven groups (Today, Season, People, Leaders, Messages, Programme, System), with the page you are on marked and the number waiting beside the pages that have work in them. It does not reload when you move between pages. Breadcrumbs above the page show where you are.
- **On a phone**: a bar at the top says where you are ("Programme › Targets"). Tap it and the whole menu opens from the bottom as a sheet; choose a page and it closes. On a page inside a page (one weekly guide) there is a way back to its list under the bar.
- **Search**: type what you came to do, such as "delete account", and the menu narrows to the pages that match (that one finds **Data requests**). Enter opens the best match; Escape clears. Pressing **/** goes to the search from anywhere. The old names still find their pages ("leader supply" finds **Leaders needed**).
- **What is hidden**: a page appears in the menu only if the person's role may open it, and the page checks the same thing itself. Typing the address of a page you may not open does what it always did.

### Pages whose names changed

The addresses did not change, so no link and no bookmark breaks.

| Was | Is now |
| --- | --- |
| Leader quality | Answer checks |
| Leader supply | Leaders needed |
| Pastors and unit heads | Church referee list |
| Sending and reporting | Sending and email |

Two pages are new: **Figures** (Programme) and **Notifications** (Messages). The launch checklist ("Before the season opens") moved from the top of the old hub to the top of **Seasons**, where it is acted on.

### My notices (`/profile`)

Anyone who receives team emails sees **My notices** in their profile, with one choice for each role they hold: *Right away*, *A daily summary* or *A weekly summary*. The choice is theirs alone. Someone with no team role does not see the section.

## Part 2: the team's emails

### How it works

- A notice goes to the people who hold a role **in this centre**, and stops the day the role is taken away (even a summary already waiting).
- **One email for each thing that happens, per person.** Someone who is both an admin and a pastor is told once.
- **Summaries.** Admins, pastors, directors, the care team and coaches get a **daily summary** by default: one email, with a part for each role they hold, at most 25 lines, most urgent first, then "And N more". It goes out between 7 am and 8 pm Lagos time. A person can choose weekly (Mondays) or *Right away*.
- **Always right away** (whatever anyone chose): a referee's concern, a deletion request near its deadline, messages that are stuck, a new role, a role taken away.
- **Quiet hours.** Nothing is sent between 10 pm and 6 am, Lagos time. What comes up overnight goes out in the morning.
- **Evening checks** (an interview tomorrow, a workshop tomorrow) run between 5 pm and 9 pm.
- **No pile-ups.** Reminders that repeat do so at most weekly; an offer is chased once.
- **The heartbeat does the work.** The platform's existing heartbeat (`/api/cron/tick`) runs the sweep that writes the timed notices and builds the summaries. There is nothing new to schedule.

### Off, Rehearsal, On

Each of the eleven groups has a switch on **Admin → Notifications**. Only an admin or a director can change it; everyone else with the page can read it.

| | What happens |
| --- | --- |
| **Off** | Nothing is queued. This is how every group starts. If the settings cannot be read, the platform acts as if they were Off. |
| **Rehearsal** | Each notice is written to the log as if it had been sent, and **nobody is emailed**. Read the log, then switch the group on. |
| **On** | The team is emailed, right away or in their summary as each person chose. |

Every change is written to the audit log with who made it.

The page also shows, for every group: who would receive it (with a note when someone has no usable email), the notices in the group with **How it reads** (the real email, built from sample words), the last 50 notices sent or rehearsed (first names, never an address), any notice that could not be queued, and the numbers the timed checks use.

A notice that cannot be queued **never stops the thing that caused it**. The application is still decided, the role is still given; the failure is a line on the page.

### What an email never contains

No name of a person in need, no note, score or reason, no referee's words, no sealed note, nothing about a young member (anyone under 18 is never emailed by this system), and never the hidden platform owner (who is neither a recipient nor named: when the owner gives someone a role in God Mode, the admins' email says the role was given and not by whom). Emails say that something is waiting and link to the page where it is done. A concern from a referee says only that there is one. A parent's permission waiting for its call says only that one is waiting.

### The groups and their notices

There are **61 notices**: 60 for events and checks, and the summary.

**Admins** (a summary by default): a new leader application was sent *(right away; also to the directors)*; a deletion request came in; a deletion request is nearly due *(right away; 7 and 2 days before the 30-day deadline)*; messages are failing; messages are not going out *(right away)*; someone's role changed *(right away)*; how the week's email went (Mondays); the reporting copy did not refresh; launch steps are still open before a season; you now hold a new role *(right away, to the person)*.

**Pastors** (a summary by default): an application is ready for a decision; applications are waiting a long time (weekly, after 7 days); a referee raised a concern *(right away)*; a reference is held for a look; a Tribe Card is ready for review; Tribe Cards are waiting (weekly, after 5 days); ready-made cards are waiting for sign-off (Mondays); a new fit model is waiting for approval; a season ends in two weeks; a leader asked to change their stage of life *(right away; only once the Details Check is open, and only for a leader whose tribe has members)*.

**Directors** (a summary by default): a new leader application was sent *(right away)*; an interview was booked; interviews tomorrow; an interview has no outcome; interview times are running out; a leader offer was answered; an offer has had no answer (once, after 5 days); members are waiting where no leader is ready (Mondays, 8 or more); members finished the form and have no tribe (Mondays); a season is about to open (14, 7 and 2 days before); something has waited too long (weekly, after 14 days for an application or 10 for a card).

**Care team** (a summary by default; never a name or a reason): referee call-backs are due (Mondays); a parent's permission is waiting for its call; people have asked for someone to reach out (after 2 days).

**Coaches** (a summary by default): a leader was given to you; a leader is ready for a practice assessment; a leader sent in a Tribe Card; a leader has stopped moving in the Academy (weekly, after 14 days); a leader has not answered the check of their details *(a week after the church asked)*.

**Leaders**: your Tribe Card was approved; it needs a few changes; you are certified; your tribe is open to members; your next Academy step (weekly, after 7 days); a workshop is tomorrow; seats are nearly gone; an assistant was added; next season: continue, multiply or rest?

**Community champions**: your community this month (the 1st); members are waiting in your community (Mondays).

**Data lead**: the week's integrity flags and held references (Mondays, when there is something); an unusual number of named files from one person in an hour *(right away, from the Exports feature; it says the role and the number, never the person or what was in the files)*.

**Members** (never anyone under 18): your tribe's meeting has changed (after 30 quiet minutes); your testimony was shared (without a word of it); we received your deletion request; your information has been deleted (sent to the address they used, which is wiped after).

**Applicants**: a reference has come in; a referee has not answered yet (after 5 days); your application is still with us (after 14 days at one stage).

**Referees** (by address): a reminder before the link stops working (3 days and 1 day before); thank you for your reference.

The Notifications page lists every one of these with when it is sent and how it reads.

### The numbers behind the timed checks

| Check | Number |
| --- | --- |
| Members waiting for a goal with no seat | 8 |
| An application waiting for a pastor's decision | 7 days (14 for the directors) |
| A Tribe Card waiting | 5 days (10 for the directors) |
| An offer with no answer | 5 days |
| A referee who has not answered | 5 days |
| A leader who has not moved in the Academy | 7 days (14 for the coach) |
| An application at one stage | 14 days |
| A person who asked for someone to reach out | 2 days |

They are rows in `public.notice_numbers` and change with a database update, not on a page.

## How it was checked

- **Database** (`tests/db/notices.test.ts`, 60 tests, and `tests/db/notices-application-sent.test.ts`, 19 tests for the new-application notice and the hidden owner's name): Off writes nothing; Rehearsal writes only to the log; On queues email only; settings unreadable means Off; the owner and anyone under 18 are never written to; a notice that cannot be queued is a line on the log, not an error; one email per event per person for someone with several roles; a role taken away stops the notices that day; every notice's recipient and wording; the timed checks at every hour that matters; the Admin pages' functions return the work of each role merged; who may call what; row security on every new table with no grant.
- **Templates** (`tests/unit/notice-templates.test.ts`): every notice has a template, none contains a private field, links go only to the platform's own pages, singular and plural, escaping.
- **Menu and Today** (`tests/unit/admin-nav.test.ts`, `admin-notices.test.ts`): every Admin page is in the menu, the menu's roles equal each page's own gate (read from the page source), the union for several roles, search, counts, shortcuts.
- **Browser journeys**: `28-notices` (the whole path for an admin who is also a pastor, including the email that arrives) and `29-admin-menu` (the menu on a computer and on a phone, for one role and two). The older journeys that touch Admin were updated for the new names; see `docs/APPLY-NOTICES-ADMIN.md`.

## What was not tested

- **Real delivery.** Emails were sent only to the test mailbox the journeys use. Whether they reach an inbox through your mail server, Gmail or Yahoo depends on your DNS records and sending reputation (see `docs/EMAIL-SMTP.md`).
- **WhatsApp.** Every notice is email-only. The WhatsApp wordings exist so the template list stays complete; none has been submitted to Meta and none is sent.
- **A real phone.** The phone layout was checked at 390 px in a test browser, not on a handset, and not with a screen reader.
- **Your data.** Everything ran on a database built from the files. Run the rehearsal on a copy of live data (`docs/RELEASE.md`) before you switch groups on.

## The way back

Switch every group Off on **Admin → Notifications** and nothing more is sent. To remove the feature, see "The way back" in `docs/APPLY-NOTICES-ADMIN.md`.

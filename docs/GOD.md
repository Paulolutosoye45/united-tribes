# The platform owner

One account, set once by whoever installs the platform, that can open every page, see what everyone is doing and change
anything. Nobody below it can see it, find it, count it, name it or promote it. This guide calls it **the owner**.

It is built on one migration, `supabase/migrations/20261209000100_superadmin.sql`, and one console at `/god`.

## Why there is no password in the code

The request was for credentials that are "hard-coded" and unique. A literal password written into the source would be readable
by everyone who ever sees the code, would sit in every copy and backup of it, and could not be changed without a new release.
So the owner is fixed in a different way, which gives the same uniqueness without the exposure:

* **One account.** `platform_owner` is a table that can only ever hold one row. It names one sign-in address. No page, API,
  invitation or role can create, change or remove it.
* **A passphrase only the owner knows.** Signing in is not enough. After signing in the owner is asked for a passphrase, which
  is checked in the database against a bcrypt hash. The passphrase itself is never stored, logged or sent anywhere. It is
  chosen once, in the SQL editor, by the person installing the platform.

Until the passphrase is given, the account has no powers at all.

## Setting it up (once)

1. Pick an email address used for nothing else (not a staff or member address). Turn on two-step verification for it.
2. Apply the migration (`supabase db push`, or paste the file into the SQL editor).
3. Sign in to United Tribes once with that address, so the account exists and is verified. Do not fill in the form.
4. In the Supabase SQL editor, as the database owner, run:

   ```sql
   select public.bootstrap_platform_owner('owner@example.com', 'four unrelated words make a good passphrase');
   ```

   The passphrase needs at least 12 characters. It is hashed on the spot and the hash is all that is kept. Do not keep the
   statement in a ticket, chat or shell history.
5. Sign in with that address. You are taken to an unlock step. Give the passphrase and the console opens.

The account has to be new to the programme: no role, no tribe, no form. The function refuses otherwise.

## What the owner sees and does

| | |
| --- | --- |
| **Every page** | `/admin`, `/review`, `/care`, `/dashboard`, `/reports`, `/growth`, privacy requests and the rest open for the owner. Every "may this person do that?" question in the platform is answered by `has_any_role()` or `my_roles()`, and both say yes to every role while the owner is unlocked. Nothing else had to change. |
| **The console, `/god`** | An overview with live numbers; a **live feed** of what is happening (it can be kept live and filtered); every person, with their tribe and form, and the power to give or take away any role; every tribe, with its members and weeks; the owner's own record. |
| **Appointments, `/god/appointments`** | Appoint a leader to a tribe without an application: see "Appointing a leader" below. Three tabs: **One at a time**, **Bulk**, and **Welcome email**. On each appointed leader, **Let them choose** lets the leader pick their own goal: see "Letting a leader choose their goal" below. |
| **Activity, `/god/activity`** | The decision dashboard (Round 2, Phase 5): what needs a decision this week, where people stop in the forms, quiet tribes, failing messages, the audit trail of what the church's people did, and the thresholds. **Visible to the owner only**; read docs/ACTIVITY.md. The console's tabs are Overview, Desks, People, Conversations, Tribes, Appointments, Placement, Exports, Features, Details check, Activity and Your record |
| **Desks, `/god/desks`** | Every kind of stakeholder (member, leader, assistant leader, coach, community champion, care lead, data lead, director, pastor, admin) as one desk: how many hold the role, how many were active this week, the numbers they watch (members waiting, tribes to review, applications in review, cards waiting for sign-off, open care tasks and so on), and the screens they use, each one a link that opens for the owner. See "Seeing what every stakeholder sees" below. |
| **Features, `/god/features`** | The switchboard for Profiles and the Weekly Rhythm: every new function is Off, Rehearsal, Limited or On, at the platform, a centre, a community, a tribe or one person, with the Master pause and the log. See "Features and the Details check" below. |
| **Details check, `/god/details`** | Ask leaders to confirm what the church holds about them (stage of life; age range for members): who, what, a rehearsal or live, and where each person stands. See below. |
| **Conversations, `/god/conversations`** | The messages the platform has sent (and the answers people gave to them), the chats staff opened, and the announcements. See "Conversations" below. |
| **A bar on every page** | Says the owner's access is on and when it ends, with a **Lock now** button. |
| **Changing the passphrase** | From the owner's record: the current passphrase and the new one twice. |

Everything the owner does is written to `god_log`, which only the owner can read. It also records every unlock, every wrong
passphrase and every time someone who is not the owner tried to reach the unlock page (at most one note an hour per person).
It never records a passphrase. Since Phase 5 it also records each tab of the activity dashboard the owner opens, each audit
trail download and each setting changed there, in plain words ("You looked at the Funnels tab of the activity dashboard").
The owner's own screens are never counted as activity.

## Invisible to everyone else

* The owner's row in `people` has `hidden = true`. The people policy hides it from every other account.
* People search, the intake totals and every count leave it out. A lookup of its name gives "The office".
* The owner cannot be given a role, invited or promoted (`keep_owner_roleless()`).
* What the owner does is not in the office's event log under their name. It is in `god_log`.
* For anyone else, `/god`, `/god/unlock` and everything under them are plain 404s, and no menu item points at them.
* Before the account became the owner, anything the shared event log said about it was removed.

## Appointing a leader (`/god/appointments`)

The owner can appoint a person to lead a tribe **without an application**. This is for the rare case where a leader is known and trusted and
the church wants them leading now. It is owner-only: the database refuses everyone else, including a pastor and the admin, and refuses the
owner too until they have unlocked on this sign-in. The page's tab is **Appointments**.

1. **Who.** Search by name or email (two letters at least). The owner never finds themselves or another hidden account. Someone who already
   leads a tribe, or is already appointed, cannot be chosen.
2. **A few things about them.** Five short questions stand in for the application: stage of life, how they lead best, and, if wanted, a
   community and a goal they have walked and whether they achieved it or are pursuing it. A tickbox says whether **a pastor has cleared
   them for sensitive subjects**; without it, tribes about a sensitive subject are not offered. Nothing is saved at this point.
3. **Where they could lead.** The same comparison the application screen uses (docs/LEADER-FIT.md), in two lists: *best fits for them*
   and *where members are waiting*, each with the five parts of the match. The owner sees the parts; no leader does. It needs an approved
   model and says so if there is none.
4. **Appoint.** After a confirmation that says what it does and does not do, the person is given the **leader role** (if they did not hold it) and a
   **Tribe Card is started** with the stage of life, community and goal locked and the three Success Picture lines filled from the
   ready-made card. An optional note for the owner's own record is kept.

**What an appointment does not do.** A pastor still approves the Tribe Card, and the Academy (if it is Required) and the safeguarding
declaration (if Required) still certify the leader, so **members see nothing until both are done**. It creates no certificate, no
application and no readiness score, and it does not change who decides anything.

**What the office sees.** The Tribe Card review page shows a pastor, director or admin the line *"This leader was appointed by an
administrator. There is no application behind this card."* The role is recorded with no grantor, the event log has no name, and nothing
anywhere names the owner. The owner's own record (`god_log`) has the full account.

**What the appointed leader sees.** Their **Lead a tribe** page says *"You have been appointed to lead <their tribe>."* and shows the four
steps that are true for them: **Appointed** (done), **Leader training** (or the safeguarding declaration, or nothing, as the Academy and
declaration switches say), **Tribe Card** (a pastor approves it) and **Open to members**. It has the same buttons an approved leader has. It
says **appointed**, never **approved**: nobody has reviewed an application, and the page does not pretend someone did. It never says who
appointed them, and never shows the owner's note. It reads one function, `my_appointment()`, which returns only the tribe's name, where its
card stands and whether they are certified. A leader approved through the application keeps the application page. A person who sent an
application before they were appointed sees the appointed page, with a card offering to delete the old application. While someone is
appointed they cannot start a new application (a guard in the database, and the apply page sends them back to Lead); after **Step down** they
can. Checked by `tests/db/my-appointment.test.ts`, `tests/unit/leader-appointed.test.ts` and journey 24.

**A leader who leads a tribe, however they came to lead.** The Lead page used to decide what to show from the leader's application or an
active appointment only. A leader whose role was given directly (an invitation with the leader role, for example) has neither, so the page
called them someone who had never applied: *"Lead another tribe. Start my application."*, with an approved Tribe Card and members behind it.
The same happened to an appointed leader on a database without `my_appointment()`. The page now also asks `my_leading()`, one read-only
function that returns the tribe the signed-in leader leads (or, for an assistant leader, the one they assist), where its card stands, how many
people have joined and whether they are certified. The count is read through the leader's own list, so a member the church placed is not
counted before they are told. Such a leader sees *"You lead <their tribe>."* with **My Tribe Card** and **This week**, and, once the card is
approved, **Who has joined** with the people by name. They are not offered an application and are not told how they came to lead. A leader
who began an application for a second tribe still picks it up, with their own tribe one tap away. Leaders approved through an application,
and appointed leaders, keep their pages and now see **Who has joined** too. The **My tribe** tab shows a leader a card for the tribe they lead
above the member flow. Checked by `tests/db/my-leading.test.ts`, `tests/unit/leader-leading.test.ts` and journey 37.

**Stepping down.** On an appointment, **Step down** (with an optional reason) ends it. A tribe with no members joined is closed. If members
have joined, **nothing happens** and the page says how many: a pastor moves them to another tribe first. The leader role goes back only if
the appointment gave it and the person has nothing else to lead and no approved application. **A certificate is never withdrawn.**

It is checked by `tests/db/leader-appointments.test.ts` (37 tests) and the journey `e2e/journeys/24-appointment.ts`.

## Letting a leader choose their goal (`/god/appointments`, Bulk, and Welcome email)

An appointment starts the leader on one goal and locks it. Sometimes the leader knows better which goal they have walked. **Let them choose**
hands that one decision to them, and nothing else. It is for the owner only (every function begins with the same owner check as the rest
of this page), and **a leader who has not been unlocked sees and does exactly what they did before**.

**The owner's side.**

* On each appointed leader, **Let them choose** opens a short panel saying what it does. **Yes, let them choose** unlocks the goal.
  **Let them choose the community too** is a tick, off by default. **Select** boxes unlock several at once, and on **Bulk**, once a run has
  appointed leaders, one button unlocks the whole run. A leader whose card cannot be unlocked is skipped with the reason beside them, and
  the rest go ahead.
* Each leader shows one status line: *locked*, *can choose*, *chose* (with the goal title), or why it cannot be done (the card was sent, a
  member has joined, or the leader applied and was approved in the ordinary way). **Lock it again** puts the lock back and **keeps what
  the leader already picked**.
* It stops by itself the moment the card is sent for review, or a member joins. The database refuses a change after that, whatever asks.

**The leader's side.** On their own Tribe Card the goal is a list instead of a fixed box. The goal the church started them on is first and
marked; the rest are ordered by how many members are waiting for them (*No one is waiting yet* when none are). Only goals that have a
signed-off ready-made card, in an open community, are offered. **Sensitive goals are left off** unless the owner said a pastor cleared that
leader when appointing them; the goal the church started them on is always allowed. Picking one refills the three Success Picture lines
from that goal's ready-made card, **but only the lines the leader has not rewritten**. The tribe's name follows the community only if it is
still the name the appointment made and the community was unlocked too.

**What the pastor sees.** On the Tribe Card review page: *"This leader chose their own goal. The church had started them on a different
one."* It never names the owner. The review is otherwise unchanged: a pastor still approves the card, and the Academy and the declaration
still certify the leader.

**The owner's private record** (`god_log`, `/god/record`) gets a line for each unlock, lock, leader's pick and welcome email, in plain
words, using the goal's title and not the leader's name (the owner's own pages show names live from the current data).

**The welcome email.** One email, from the system's address and signed with two lines the owner keeps (by default *Wale Ekundayo* and
*Pastor TCN Iganmu Center*). It explains the choice and the steps that follow, with a picture of each screen. There are two versions
(*you may choose your goal* and *your goal is set*), matching the state of the lock. It is **email only** (never put to Meta for approval),
is sent at most once per tribe per version unless the owner presses **Send again**, waits for the quiet hours (10 pm to 6 am Lagos), and
**cancels a short "you have been appointed" email for the same tribe that has not yet gone**, since this one covers it.

**Nothing is sent until the pastor's wording is approved.** On **Welcome email** the owner reads both versions as they would go today and
presses **<name> has approved this wording**. The approval is tied to the version of the wording; changing the name or title takes it away.
Until then, the *Send the welcome email* tick and button are off, and letting them choose still works without the email.

It is checked by `tests/db/goal-unlock.test.ts`, `tests/db/goal-unlock-rollback.test.ts`, the unit tests `leader-welcome-template.test.ts`,
`leader-guide-pictures.test.ts`, `god-goal-wording.test.ts` and `email-layout-unchanged.test.ts`, and the journey `e2e/journeys/33-let-them-choose.ts`.
How to apply it, and the way back: `docs/APPLY-GOAL-UNLOCK.md`.

## Seeing what every stakeholder sees (`/god/desks`)

The owner passes every "may this person?" question already, so every role's own dashboard opens for her. What was missing was one place to go
and look, so there is a desk for each of the ten roles.

* **The desk page** lists the ten roles. Each shows how many people hold the role and how many were active in the last seven days, and the
  figures that role would be watching, each one a link to the screen where it is worked.
* **A desk** (`/god/desks/<role>`) opens the same screens the role uses. Nothing is copied: the owner opens the real dashboard, the real review
  queue, the real care page. She is not pretending to be anyone, and nothing she opens is done in their name.
* **The people on a desk** are listed under it (`god_role_people`): name, when they were last active, and a link to their record in the console.
* **Analysis** has no second copy either. The desk page ends with a map of where the analysis already lives: the activity dashboard, the
  leader supply board, the dashboards and the reports.
* The numbers on the page are one database function (`god_desks()`), and the end-to-end test checks a few against the tables themselves.

Opening a desk is written to the owner's record as one line a minute at most ("You looked at the pastor desk"), in the owner's own log. It is not
in the office's event log under her name.

## Conversations (`/god/conversations`)

The platform does not store free-text chat. Members and leaders talk in WhatsApp, which the platform never sees. What it does hold, and what
the owner can now read:

| View | What it shows |
| --- | --- |
| **Messages** | Every message the platform queued or sent: to whom, which kind, when, whether it arrived, and the words it said (the same words the person was sent). One person's messages, with the check-in button answers they gave back (and any STOP), can be opened from their record. |
| **Chats** | Each time a member of staff opened a WhatsApp conversation from the platform: who opened it, with whom, and why. The words are never here, because the platform never had them. |
| **Announcements** | What was announced, to whom, and how many it reached. |

**What is held back, in the database, not on the page.** `god_messages` returns no words and no parameters for:

* anything about care or a coach's request for help (`care_*`, `coach_help`);
* anything to or about a guardian (`guardian_*`);
* referee requests and replies (`referee_*`);
* anything sent to a person under 18, whatever it was.

For these the owner sees that a message of that kind went to that person, when, and its status, and nothing else. Secrets, codes, links and tokens are
taken out of a message's details before its words are made, so reading a message can never sign her in as anyone. The two sealed notes stay sealed.

Reading is itself recorded in the owner's record ("You read the messages sent to one person").

Tests: `tests/db/god-oversight.test.ts` (31) and journey `26-god-oversight` (51 checks: every desk and every screen on it opens for the owner and
not for an administrator, the held messages show nothing, the owner's record names what she looked at, and none of it is in the office's log).

## Exports and Reports (`/god/exports`)

The **Exports** tab is the only place any switch for exports and reports can be moved. An administrator, a director and a pastor cannot, and the database refuses them if they call it directly. It holds a position for each of the fourteen packs (Off, Rehearsal, Limited, On), the formats and ways in, the two stops (*Pause all exports*, *Stop all People files*), the testers, the day the impact assessment was signed, the number that counts as unusual use, the log of every change, and the log of files made (who, which pack, why, how many rows; never what was in a file). Everything starts Off. How it works is in `docs/EXPORTS.md`.

## Features and the Details check (`/god/features`, `/god/details`)

The **Features** tab is the only place any switch of Profiles and the Weekly Rhythm can be moved. An administrator, a director and a pastor cannot, and the database refuses them if they call it directly (pastors, directors and the admin can only *read* what is on, so the Stage changes tab can appear for them). It lists twenty-five functions in eight groups (the six stages of Profiles and the Weekly Rhythm, then "WhatsApp that cannot fail quietly" and "Joining a tribe, and leaving one"); the three of stage 1 (My page, the Details Check, and the hold on the Tribe Card) and the four of stage 2 (More facts on My page, My story, Role panels, Still right?) can be moved, the others say when they arrive. Everything starts Off.

- **Where:** the whole platform, a centre, a community, a tribe, or one person; the narrowest place wins. One rule per function per place.
- **Who:** a rule can be limited to some roles. Open it **for tribe leaders first.** A rule limited to some roles replaces an unfiltered rule at the same place.
- **A reason** (at least eight characters) is required to open a function for the whole platform with no role filter. Every change is one line in the log, in words.
- **Order is enforced:** the Details Check and the four functions of stage 2 cannot be opened before My page, and My page cannot be closed while one of them needs it.
- **The Master pause** makes every new function act as Off at once; resuming brings back every rule.

The **Details check** tab asks people to confirm a fact. Choose who (appointed leaders, all leaders, one tribe's leader, named people, or everyone still unconfirmed) and what; the page shows how many would be asked and how many are left out and why, never who. A **Rehearsal** writes what would be sent and sends nothing; a **Live** run needs a tick to say you understand, then sends one message to each person with a private link. Each run shows where everyone stands and **never what they answered**. How it works is in `docs/PROFILES.md`.

### The four whole-church functions (WhatsApp and removal requests)

Four functions on the Features tab are **for the whole church only**: the editor shows no place, role or tribe to choose, and the database refuses a rule that names one. Each starts Off, needs a reason of at least eight characters to open, and is covered by the Master pause.

| Function | Positions | What it does | Guide |
| --- | --- | --- | --- |
| **WhatsApp safety net** (`whatsapp_guard`) | Off, Rehearsal, On | A pause for every WhatsApp message, an automatic pause when Meta refuses the account, a count of messages Meta never confirmed. Rehearsal says when it would have paused and holds nothing back. | `docs/WHATSAPP.md` |
| **WhatsApp health** (`whatsapp_health`) | Off, On | The page under Messages that asks Meta what is wrong, with a test message. | `docs/WHATSAPP.md` |
| **WhatsApp number required** (`number_required`) | Off, On | A phone number is compulsory on the join form and in an adult member's contact details; members without one are asked gently. | `docs/WHATSAPP.md` |
| **Leader removal requests** (`removal_requests`) | Off, Rehearsal, On | A leader asks the church to change a member's place; a person with the right to decides, with a note. Rehearsal walks the road as practice. | `docs/REMOVAL-REQUESTS.md` |

Open them in this order, a few days apart: the safety net (Rehearsal, then On), the health page, the required number, removal requests (Rehearsal, then On). Moving one back to Off puts the platform back exactly as it was and keeps what was written; the way-back files in `supabase/rollback/` remove the tables.

## Guarding it

| Rule | Detail |
| --- | --- |
| Two steps | Signing in, then the passphrase. |
| One sign-in | An unlock belongs to the sign-in session it was given on. A second sign-in of the same account is held at the unlock step, while the first stays open. |
| Four hours | The powers end by themselves. Then it is the bare account again. |
| Lockout | Five wrong tries lock it for 15 minutes. Each wrong try after that locks again, and the lock doubles every five tries, up to 24 hours. A correct passphrase during a lock is refused too. |
| No hints | A wrong passphrase from the owner and a try by anyone else get the same answer: "That did not work." |

## If the passphrase is lost, or the owner has to change

In the SQL editor:

```sql
select public.remove_platform_owner();   -- the account becomes an ordinary member again
select public.bootstrap_platform_owner('new-address@example.com', 'a new passphrase of twelve or more characters');
```

Only the database owner can do this. It is the one way in, and it is deliberate.

## What the owner cannot read

The two private notes a member writes (what would help a tribe care for them, and the note to their leader) are sealed with a
key held outside the database. The console shows a reminder that they stay sealed, and it does not open them. That is
deliberate: the promise to members is that nobody reads those notes except their leader and the member. If you ever decide the
owner should be able to, it needs a decision from the pastoral leadership first, and a change to the privacy notice.

## Residual exposure, plainly

* Anyone with access to the Supabase dashboard (the database owner) can already read and change everything, and can replace the
  owner. Protect that login with two-step verification and keep it to as few people as possible.
* Whoever controls the owner's sign-in address, and knows the passphrase, is the owner. Treat both as one secret held by one
  person.
* The privacy notice says that one platform administrator account exists and what it can and cannot see. Have counsel review
  that wording.

## How it is checked

`tests/db/superadmin.test.ts` (26 tests, against a real Postgres with every migration) covers one-owner-only, the bootstrap
refusals, the lockout schedule, session scoping, expiry, hiding, role immunity and the log. Journey `10-owner` (60 checks) walks it in
a browser: an admin cannot see it, the unlock step, every page opening, the feed, roles, a second sign-in, a changed
passphrase, a lockout, and the powers ending.

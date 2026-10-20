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
| **Appointments, `/god/appointments`** | Appoint a leader to a tribe without an application: see "Appointing a leader" below. |
| **Activity, `/god/activity`** | The decision dashboard (Round 2, Phase 5): what needs a decision this week, where people stop in the forms, quiet tribes, failing messages, the audit trail of what the church's people did, and the thresholds. **Visible to the owner only**; read docs/ACTIVITY.md. The console's tabs are Overview, People, Tribes, Desks, Conversations, Activity and Your record |
| **Desks, `/god/desks`** | Every kind of stakeholder (member, leader, assistant leader, coach, community champion, care lead, data lead, director, pastor, admin) as one desk: how many hold the role, how many were active this week, the numbers they watch (members waiting, tribes to review, applications in review, cards waiting for sign-off, open care tasks and so on), and the screens they use, each one a link that opens for the owner. See "Seeing what every stakeholder sees" below. |
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

**Stepping down.** On an appointment, **Step down** (with an optional reason) ends it. A tribe with no members joined is closed. If members
have joined, **nothing happens** and the page says how many: a pastor moves them to another tribe first. The leader role goes back only if
the appointment gave it and the person has nothing else to lead and no approved application. **A certificate is never withdrawn.**

It is checked by `tests/db/leader-appointments.test.ts` (37 tests) and the journey `e2e/journeys/24-appointment.ts`.

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

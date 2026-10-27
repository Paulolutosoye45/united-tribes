# Profiles and the Weekly Rhythm: stage 1, the foundations

**Who this is for:** the owner (God Mode), the pastorate, the office, and whoever maintains the platform.

Stage 1 is the ground the rest of Profiles and the Weekly Rhythm will stand on, and the first thing a leader sees of it. It does five things:

1. **The Switchboard.** One page in God Mode (**Features**) where every new function is Off, in Rehearsal, Limited or On.
2. **The facts store.** One dated, signed record for each personal fact the church holds that other people may type. The person owns it; the office only proposes.
3. **The Details Check.** God Mode asks a person to confirm a fact. The message carries no personal fact; it opens a private page that asks one question.
4. **Stage review.** A change that touches other people waits for a pastor. Nobody is moved automatically.
5. **My page, first layer.** A leader sees "We have you down as 26 to 40, the Builders stage. Is that right?" and answers.

It exists to fix one problem: an appointed leader's stage of life was typed by the office, and the tribe, its card and the members offered to it all followed that typing. Now the leader says whether it is right.

**Everything ships Off, and every switch is in God Mode and nowhere else.** Applying stage 1 changes nothing for anybody until the owner moves a switch. A test proves it (see *Off must mean identical*).

Stages 2 to 6 (My page for everyone, faces and visibility, know your tribe, the weekly rhythm, leaders' week) are listed on the Features page and **cannot be moved** until their stage ships.

## The principles every part follows

- **One fact, one owner, many readers.** The owner of a fact is the person it is about. Every place that reads a fact is written down (`docs/PROFILE-READERS.md`), and a test fails if a new reader is not.
- **The person confirms facts about themselves; the office only proposes.** A value the office typed is a suggestion until the person says "yes, that is right".
- **Facts carry their history:** who set a value, when, and whether the person confirmed it.
- **Four classes of change.** A: free, saved at once. B: noted, saved at once, the next list of suggested tribes is worked out again, nobody is moved. C: reviewed; for a person in a tribe or leading one it waits for the pastor of their centre within five days, and the old value stays in force until then. D: the special route; crossing 17 and 18 goes through the young people's rules or the office, never self-service. In stage 1 both facts are Class C (what that means in practice is below).
- **Nobody is moved automatically.** A pastor approving a leader's new stage moves the *tribe's* stage; the people already in the tribe stay where they are.
- **Off must mean identical.** With every switch Off, the platform answers exactly as it did before this release.
- **Additive only.** New tables and functions; no existing function, table or default changes. The website tolerates a database that does not have it yet.

## The Switchboard (God Mode → Features)

Seventeen functions are listed; three can be moved in stage 1:

| Function | What it does | Modes |
| --- | --- | --- |
| **My page** | The page where a person sees and confirms what the church holds about them. In stage 1: leaders. | Off, Rehearsal, On |
| **Details Check from God Mode** | The owner asks people to confirm a fact. Needs My page. | Off, Rehearsal, On |
| **Hold the Tribe Card until the leader's stage is confirmed** | *Optional*: a pastor sees that the stage is not yet confirmed. *Required*: a pastor cannot approve the card until it is. Needs the Details Check. | Off, Optional, Required |

How a switch is read:

- **Five places:** the whole platform, a centre, a community, a tribe, or one person. One rule for each function in each place. The narrowest place wins.
- **Optional role filter:** a rule can reach only some roles (for example, only tribe leaders). **One limit to know:** because there is one rule per place, a rule limited to some roles *replaces* an unfiltered rule at the same place; it does not sit beside it.
- **Dependencies are refused:** the Details Check cannot be opened before My page, and My page cannot be closed while the Details Check needs it.
- **A reason (at least eight characters)** is required to open a function for the whole platform with no role filter. Every change is one line in the log.
- **Hold-back:** a rule can hold back one tribe in ten until a chosen day, so the owner can compare. A tribe of young people is never held back.
- **Master pause:** one button makes every new function act as Off, at once, and one resumes. Rules are kept.
- **If the settings cannot be read, everything new is Off.**
- **A Rehearsal** shows the function to nobody; it writes what would happen and does nothing else.

The board says "Off" for the hold on the Tribe Card until the Details Check is open for somebody, because until then nothing is held (the hold's own default of Optional only means something once the check is open).

Pastors, directors and the admin can read *what is on* and the log, read-only, so that the Stage changes tab appears for them once My page or the Details Check is open. They cannot move a switch, and the database refuses them if they try.

## The facts store

Two facts, each a Class C change:

| Fact | Applies to | Where it is held today | Who may be asked |
| --- | --- | --- | --- |
| **Stage of life** (Rising, Builders, Stewards, Sages) | Tribe leaders | The leader's tribe (its track), their application, or the office's suggestion at the appointment | Leaders |
| **Age range** | Members | The member's profile | Members who have a profile, **never anyone under 18** |

Choices offered are always adult ones: never a young person's range or the teen stage. A change that would cross the line between under and over 18 is refused with "ask the church office" (Class D).

When a person answers:

- **Yes, that is right:** recorded as confirmed by the person. Nothing else changes.
- **No, I want to change it:** the person picks the right one. What happens depends on who is affected:
  - a leader whose tribe is a draft with nobody in it: **changes at once**, and the correction is logged;
  - a leader with no tribe yet: the answer is **kept**, for the pastor to see beside the card when one is started;
  - a leader whose tribe has members, or whose card is approved: **a pastor decides** (Stage review, below);
  - a member in no tribe: changes at once; a member in a tribe waits for a pastor in the same way.
- **This is not about me:** nothing changes, and this person is not asked again from that message.
- **Ask me later:** nothing changes; asked again in a few days.

In stage 1 the recommended use is **leaders only** (the role filter). The age-range question for members is built and tested, but members have no My page until stage 2, so opening the Details Check to members is possible and not recommended yet.

## The Details Check (God Mode → Details check)

The owner chooses **who** (one of five audiences), **what to check** (one to three facts), and **Rehearsal or Live**:

- **Appointed leaders**, **all leaders**, **one tribe's leader**, **a list of named people**, or **everyone whose fact is still unconfirmed.**
- The console shows **how many would be asked, and how many are left out and why** (never who). The reasons: has nothing recorded, has already confirmed, under 18, not covered by the Details Check switch, already asked in the last 14 days, has turned messages off, no way to reach them.
- A **Rehearsal** writes what would be sent and sends nothing; it makes no private link and changes no record.
- A **Live** run needs the owner to tick "I understand these people will get a message now", then sends one message to each person.
- Each run lists where every person stands: waiting, answered, asked later, waiting for a pastor, no reply, not me. **It never shows what anyone answered.**
- **Stop this run** ends a live run: its links stop opening at once.

The recommended order is Rehearsal first. A live run cannot be made while the switch is only in Rehearsal.

### The message and the private link

- The message is short, in the voice of the church office, with one button: **Confirm your details**. It carries **no personal fact**: not a stage, not an age range, not what the office has down.
- The link is made for one person and one run, shown only in the message, and **kept in the database only as a fingerprint**. It works for 14 days.
- **Signed in as that person:** one tap, no code. **With no account:** the page shows nothing about the person until a **six-digit code** is typed. The code goes to the email address (or phone) the church already holds, **never to anything typed on the page**, and never over WhatsApp, because a link in a chat with a code beside it would be no second check. It works for ten minutes and once; five wrong tries lock it for half an hour. The page shows only a half-hidden address for where the code went.
- The page does not say who asked.
- The heartbeat reminds once after three days (by the other channel), and after seven days asks the leader's coach (or a director when there is none) to speak to them, once. Links and codes are forgotten once their message is finished with.
- "Opened" on a run can be a mail scanner or a link preview rather than a person.

### WhatsApp

The request is sent on WhatsApp under one Meta template, **`details_check_request`** (Utility, English, one URL button): *"Hello {{1}}, please check the details we hold for your tribe. It takes under a minute."* The reminder reuses that same template, so Meta is asked about one, not two. The code message is **never** put to Meta. **Until the template is approved, the messages go by email and text.** To submit it: `npm run templates -- --submit details_check_request` with your WhatsApp credentials in place (see `docs/MESSAGES-REMINDERS.md`).

## My page (first layer)

For a leader the owner has opened it to, **My page** (`/my`) shows one card for each fact they can confirm. A fact the office wrote is a question with four answers; one the person has confirmed shows what it is and offers only "Change it". A change waiting for a pastor shows when it was asked and by when it will be decided; a declined change shows the pastor's note.

While the function is Off for a person, `/my` is a plain "We can't find that page", exactly as before the page existed.

On the **Lead page**, a leader with something to check sees a strip, "Please check your details", with one button to My page. Nothing is drawn when there is nothing to check or My page is closed to them.

## Stage review (Review → Stage changes)

A change from a leader whose tribe has members (or whose card is approved) arrives at **Review → Stage changes**, a tab that appears for pastors and directors once My page or the Details Check is open. It shows who asked, from what to what, how many members the tribe has, and when it must be decided (within five days; an overdue one says so).

- Only a **pastor of the leader's centre** decides. **Approve** moves the tribe to the new stage; **Keep as it is** leaves everything as it was. A note may be added, and the leader reads it.
- **Nobody is moved** either way.
- Directors and the admin can read the list and cannot decide.
- Beside a Tribe Card, a pastor sees whether the leader has confirmed their stage and whether the card agrees with it. It never says who asked the leader, and never a reason.
- **Hold the Tribe Card**, when the owner opens it: *Optional* shows the pastor that the stage is not confirmed; *Required* stops the card being approved until it is.

## Where else the platform changes (only while the Details Check is open for that person)

- The appointment form (God → Appointments) says the stage of life is a suggestion the leader will be asked to confirm.
- The leader's **welcome email** gains a "Confirm your details" line and button while their stage is unconfirmed. While the Details Check is Off the welcome email is the one the pastor approved, word for word.
- Two notices are new: `pastor_stage_review` (to the pastors and directors of the leader's centre) and `coach_details_unanswered` (to the coach). There are now **61 notices** (`docs/NOTICES-ADMIN.md`), and the platform can send **139 messages** in all (`docs/MESSAGES-AUDIT.md`).

## Off must mean identical

Three checks stand behind the promise:

1. **The fingerprint.** `tests/db/fingerprint.test.ts` builds a small church with the platform's own functions, reads what matching, tribe lists, rosters, dashboards, KPIs, reminders, readiness and exports say about it (40 readings), and compares them, character for character, with a recording made on the database **before** stage 1 (`tests/db/golden/fingerprint-v1.json`). It also shows that it *notices* a switch turned On, a one-letter change in a reader's wording, and a one-point change in a number.
2. **The rollback.** `tests/db/profiles-rollback.test.ts` runs the down file: no function that existed before changes, the new doors are gone, the tables and every row stay, and the platform works afterwards.
3. **The reader inventory.** `tests/db/profile-readers.test.ts` fails when a database function or a source file reads a registered fact and is not on the list in `src/lib/profile/registry.ts`, and when something on the list no longer reads it.

## Retention and privacy

- A private link is stored only as a fingerprint; its code only as a salted fingerprint, and both are forgotten once their work is done. Expired links are deleted by the daily clean-up.
- The facts store keeps the history of each value (who, when, how), so what was changed can be seen. A person's data file (`export_my_data`) already includes their age range.
- The owner never sees what anyone answered, only where each person stands.
- Nobody under 18 is asked through a Details Check; they are left out, with a count.
- The platform owner is never asked, and is never named to the person asked or to a pastor.

## Where things are

| What | Where |
| --- | --- |
| The migration, and its way back | `supabase/migrations/20270101000100_profiles_stage1.sql`, `supabase/rollback/20270101000100_profiles_stage1.down.sql` (12 tables, 52 functions, 2 triggers) |
| The switchboard and Details check consoles | `/god/features`, `/god/details` (`src/components/god/FeaturesBoard.tsx`, `DetailsConsole.tsx`) |
| My page, the private page, the strip, the banner | `/my`, `/details/[token]`, `src/components/profile/*` |
| Stage changes | `/review/stages` |
| The shape of a fact, its wording, how the page reads the database | `src/lib/profile/*`, `src/lib/features/*` |
| Every reader of a fact | `docs/PROFILE-READERS.md` (written by `npm run readers`) |
| Every message the platform can send | `docs/MESSAGES-AUDIT.md` (written by `npm run messages-audit`) |
| The heartbeat's part | `worker_details_tick`, called from `/api/cron/tick`; a fault in it is listed and never stops anything else |

## What is not in stage 1

- My page for **everyone** (stage 2), photos and visibility levels (3), Our Tribe, Encourage, This week's line and the directory (4), the weekly rhythm, thanks, fruit and the belonging pulse (5), the Shepherd's hour, coach card and rest week (6). Their switches are listed and cannot be moved.
- **Members are not asked anything by default.** The age-range question exists and is tested; use it only once My page opens to members.
- **The WhatsApp template is not submitted to Meta** (it needs your credentials; see above).

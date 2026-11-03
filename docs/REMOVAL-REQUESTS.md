# Leader removal requests (WhatsApp that cannot fail quietly, stage 4)

A leader can ask the church to change a member's place in their tribe. **The leader never removes anyone.** A person with the right to decide does, with a note, and **silence never removes anybody.** The function is on the owner's Features page (God Mode → Features) as **Leader removal requests**, for the whole church only, with three positions: **Off** (the start), **Rehearsal** (the whole road walked as practice) and **On**.

Migrations: `supabase/migrations/20270103000400_removal_requests.sql`, then `supabase/migrations/20270108000100_removal_admin.sql` (an admin or director approves; see "Who decides" below). Ways back: `supabase/rollback/20270108000100_removal_admin.down.sql` first, then `supabase/rollback/20270103000400_removal_requests.down.sql`. Tests: `tests/db/removal-requests.test.ts` (38), `tests/db/removal-admin.test.ts`, `tests/db/removal-requests-rollback.test.ts` (9), `tests/db/removal-admin-rollback.test.ts`, `tests/unit/removal.test.ts`, `tests/unit/removal-templates.test.ts`, browser journey `e2e/journeys/40-removal.ts`.

## Who decides (changed 3 November 2026)

**An admin, a director or the Care Lead decides every request. A coach no longer can.** Before this change a coach could close an ordinary request alone, admins were never told that one was waiting, and a member who had just been taken out of a tribe could be placed again by the next automatic run at once. Now:

* **The coach recommends.** On the same board the coach of the tribe sees **What would you do?** (approve, decline, or ask the leader a question first, with a note of 10 to 500 characters). It decides nothing and sends nobody anything. The person deciding **reads it first**, above what the leader wrote. The leader who asked never sees it. A coach does not recommend on a restricted request (safety or conduct, someone under 18, an open care flag).
* **Admins and directors are told.** Two notices (`admin_removal_ask`, when a request comes in or the leader answers a question; `admin_removal_waiting`, once, at day 3), with no name and no reason. The leader who asked is never told about their own request, even if they hold an admin role.
* **They can find it.** **Admin → Leaders → Removal requests** opens the same board as **Growth → Removal requests** (one list, not two), and **Admin → Today** shows "N removal requests waiting": the requests this person may decide, that wait for the church (not for the leader's answer), that are real (not practice).
* **A short hold after an approval.** The member goes on a hold: **no automatic run places them for three days**, so they can choose for themselves first (**Show me other tribes** is never blocked). A request about safety or conduct, someone under 18 or an open care flag is **never placed by a run**: the hold has no end date, and a person places them by hand. The hold ends by itself after three days, when the person gets a seat, or when the place is put back. The tribe they were taken out of is still never offered to them again. A hold the owner put there is never overwritten.
* **The staff emails start with the switch.** When the owner moves **Leader removal requests** to **On**, the email groups that take part (admins, directors, the Care Team, coaches) turn **On** if they were Off. It never turns one Off, never touches one that is already On or in Rehearsal, and does nothing when the switch goes to Rehearsal or Off.
* **Unchanged:** the switch, the two-open-requests limit, the privacy rules, the 14 days to appeal, the 12 months after which the leader's words (and now the coach's note) are cleared, and "silence never removes anyone".

## What each person sees

| Who | Where | What |
|---|---|---|
| The leader of a tribe (not the assistant) | **Lead → Your Tribe Card**, under the roster | "Requests about a member's place": a form (member, one of five reasons, what has happened in 20 to 500 characters, "I have spoken to this person", and an optional urgent mark), their own requests and the answers. At most **two** open at a time. A leader can take a request back before it is decided, and answers a question put to them here. |
| The tribe's coach | **Growth → Removal requests** | The ordinary requests of their own tribes: read them and **recommend** (approve, decline, or ask the leader a question). They cannot decide any request, and they can read, but not recommend on, a request that is for the Care Team. |
| An admin, a director, the Care Lead | **Admin → Leaders → Removal requests** (the same board), a line on **Admin → Today**, and a notice | Every request, with the coach's recommendation first. They decide. Anything about **safety or conduct**, **someone under 18**, or **a member with an open care flag** is the Care Team's to handle, and a director or an admin can decide it too. They also look again when a member asks, and can put a place back. |
| A pastor | the same page | Reads all of them. Decides none. |
| The member | **Home** and **My tribe**, for 30 days | After an approval: "Your place in *the tribe* has changed", kindly, with a button to see other tribes, a named person to speak to, and 14 days to ask that person to look again. Never the reason, the leader's note or who asked. A declined request tells the member **nothing**. A member under 18 is not written to: the Care Lead speaks to their parent or guardian. |

## The road

1. **Ask.** Recorded with the reason, the note and the leader's word that they have spoken to the person. An urgent mark also raises the existing urgent care alert to the Care Team (email and text, now). The Care Team, the coach and every admin and director are told by the notice engine (never a name or a reason). Asking releases nothing.
2. **Decide.** The coach may first say what they would do. An admin, a director or the Care Lead then chooses *Approve*, *Decline* or *Ask the leader a question*, always with a note of at least 10 characters. Nobody can decide a request they asked or one that is about them, whatever other roles they hold. A question leaves the request open and waiting for the leader; the leader answers on their page; nothing is decided meanwhile.
3. **Approved.** The seat is **released** with the reason "Place changed by the church". The member goes back to "no tribe yet" and onto a short hold (see above); the matching offers other tribes and **never that one again** (until the place is put back). **Nothing the member wrote or did is touched**: attendance, testimonies, consents and their profile stay. The member is told (email and in the app), and so is the leader, with a reminder to take the person out of any WhatsApp group they keep outside this site.
4. **Declined.** The leader is told, with the words of the person who decided. The member is told nothing. The leader may ask again later.
5. **Waiting.** A reminder to the coach, the Care Team, the admins and the directors at **day 3** (not while the request waits for the leader's answer); at **day 7** the Care Team and the directors are told at once. **That is all it does.**
6. **Appeal.** Within **14 days** the member can ask the Care Lead to look again (once, with an optional line). The Care Lead, a director or an admin keeps the decision or puts the place back; so can the person who approved it, to put it back. A place goes back only if the tribe has room and the person has not joined another tribe. The member and the leader are told.
7. **Kept.** The leader's note, the answers and the deciders' notes are **cleared after 12 months**, even if the switch has been turned Off; the fact that a request was made, its dates and the decision stay. The event log keeps the fact and the reason category, never a note.

## Rehearsal

In Rehearsal everything above can be walked, every request is marked **practice**, and:

* a request never releases a seat, never keeps a tribe from a member, never raises the urgent alert, and never writes to anyone;
* practice requests do not count towards a leader's two, and are never reminded or escalated;
* the leader's page and the board say it is practice.

## Messages

Three **email-only** messages (never put to Meta): `removal_member_told`, `removal_leader_decided` (approved, declined, a question, or the place put back) and `removal_member_reinstated`. Eight notices for the people who decide, through the notice engine (their groups start Off, as every notice group does, except that moving this switch to On starts the four that take part): `coach_removal_ask`, `care_removal_ask`, `admin_removal_ask`, `coach_removal_waiting`, `care_removal_waiting`, `admin_removal_waiting`, `director_removal_escalated` and `care_removal_appeal`. **There is no new WhatsApp template to submit.** `docs/MESSAGES-AUDIT.md` lists them; `docs/NOTICES-ADMIN.md` says who receives each.

## Privacy, in one place

* The reason and the leader's words are read only by the asking leader, the coach (for ordinary requests, to recommend on), the Care Lead, directors, admins and pastors. **Never by the member.** The coach's recommendation is read by the people who decide, the coach and pastors, and never by the leader who asked.
* The tables have row-level security and no grants: the website reaches them only through functions.
* A member under 18 is never emailed by this feature.
* The event log keeps the fact that a request was asked, answered or decided, with its category. It never keeps a note.

## The way back

To go back to "a coach may decide an ordinary request" run `supabase/rollback/20270108000100_removal_admin.down.sql` first (after putting the previous application files back). It restores every function the change replaced, drops the recommendation function and the trigger that started the email groups, and removes the holds it put on people (the older code cannot end a hold). The columns it added stay where they are; no request, answer, appeal, seat or message is changed.

To remove the whole feature, run `supabase/rollback/20270103000400_removal_requests.down.sql` (as the database owner, after putting the previous application files back). It restores both matching functions exactly as they were, drops the functions, the three tables and the Switchboard entry, and keeps everything else: **a seat that was released stays released**, and nothing a member wrote or attended is touched. To keep the requests for the record, copy them first (the first lines of the file say how). `scripts/rehearse-rollback.sh` rehearses it.

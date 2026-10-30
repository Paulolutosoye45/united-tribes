# Leader removal requests (WhatsApp that cannot fail quietly, stage 4)

A leader can ask the church to change a member's place in their tribe. **The leader never removes anyone.** A person with the right to decide does, with a note, and **silence never removes anybody.** The function is on the owner's Features page (God Mode → Features) as **Leader removal requests**, for the whole church only, with three positions: **Off** (the start), **Rehearsal** (the whole road walked as practice) and **On**.

Migration: `supabase/migrations/20270103000400_removal_requests.sql`. Way back: `supabase/rollback/20270103000400_removal_requests.down.sql`. Tests: `tests/db/removal-requests.test.ts` (38), `tests/db/removal-requests-rollback.test.ts` (9), `tests/unit/removal.test.ts`, `tests/unit/removal-templates.test.ts`, browser journey `e2e/journeys/40-removal.ts`.

## What each person sees

| Who | Where | What |
|---|---|---|
| The leader of a tribe (not the assistant) | **Lead → Your Tribe Card**, under the roster | "Requests about a member's place": a form (member, one of five reasons, what has happened in 20 to 500 characters, "I have spoken to this person", and an optional urgent mark), their own requests and the answers. At most **two** open at a time. A leader can take a request back before it is decided, and answers a question put to them here. |
| The tribe's coach | **Growth → Removal requests** | The ordinary requests of their own tribes: approve, decline, or ask the leader a question. They can read, but not decide, a request that is for the Care Team. |
| The Care Lead, a director, an admin | the same page | Every request. They alone decide anything about **safety or conduct**, **someone under 18**, or **a member with an open care flag**. They also look again when a member asks, and can put a place back. |
| A pastor | the same page | Reads all of them. Decides none. |
| The member | **Home** and **My tribe**, for 30 days | After an approval: "Your place in *the tribe* has changed", kindly, with a button to see other tribes, a named person to speak to, and 14 days to ask that person to look again. Never the reason, the leader's note or who asked. A declined request tells the member **nothing**. A member under 18 is not written to: the Care Lead speaks to their parent or guardian. |

## The road

1. **Ask.** Recorded with the reason, the note and the leader's word that they have spoken to the person. An urgent mark also raises the existing urgent care alert to the Care Team (email and text, now). The coach and the Care Team are told by the notice engine (never a name or a reason). Asking releases nothing.
2. **Decide.** *Approve*, *Decline* or *Ask the leader a question*, always with a note of at least 10 characters. Nobody can decide a request they asked or one that is about them, whatever other roles they hold. A question leaves the request open and waiting for the leader; the leader answers on their page; nothing is decided meanwhile.
3. **Approved.** The seat is **released** with the reason "Place changed by the church". The member goes back to "no tribe yet"; the matching offers other tribes and **never that one again** (until the place is put back). **Nothing the member wrote or did is touched**: attendance, testimonies, consents and their profile stay. The member is told (email and in the app), and so is the leader, with a reminder to take the person out of any WhatsApp group they keep outside this site.
4. **Declined.** The leader is told, with the words of the person who decided. The member is told nothing. The leader may ask again later.
5. **Waiting.** A reminder to the coach and the Care Team at **day 3**; at **day 7** the Care Team and the directors are told at once. **That is all it does.**
6. **Appeal.** Within **14 days** the member can ask the Care Lead to look again (once, with an optional line). The Care Lead, a director or an admin keeps the decision or puts the place back; so can the person who approved it, to put it back. A place goes back only if the tribe has room and the person has not joined another tribe. The member and the leader are told.
7. **Kept.** The leader's note, the answers and the deciders' notes are **cleared after 12 months**, even if the switch has been turned Off; the fact that a request was made, its dates and the decision stay. The event log keeps the fact and the reason category, never a note.

## Rehearsal

In Rehearsal everything above can be walked, every request is marked **practice**, and:

* a request never releases a seat, never keeps a tribe from a member, never raises the urgent alert, and never writes to anyone;
* practice requests do not count towards a leader's two, and are never reminded or escalated;
* the leader's page and the board say it is practice.

## Messages

Three **email-only** messages (never put to Meta): `removal_member_told`, `removal_leader_decided` (approved, declined, a question, or the place put back) and `removal_member_reinstated`. Six notices for the people who decide, through the notice engine (their groups start Off, as every notice group does): `coach_removal_ask`, `care_removal_ask`, `coach_removal_waiting`, `care_removal_waiting`, `director_removal_escalated` and `care_removal_appeal`. **There is no new WhatsApp template to submit.** `docs/MESSAGES-AUDIT.md` lists them; `docs/NOTICES-ADMIN.md` says who receives each.

## Privacy, in one place

* The reason and the leader's words are read only by the asking leader, the coach (for ordinary requests), the Care Lead, directors, admins and pastors. **Never by the member.**
* The tables have row-level security and no grants: the website reaches them only through functions.
* A member under 18 is never emailed by this feature.
* The event log keeps the fact that a request was asked, answered or decided, with its category. It never keeps a note.

## The way back

Run `supabase/rollback/20270103000400_removal_requests.down.sql` (as the database owner, after putting the previous application files back). It restores both matching functions exactly as they were, drops the functions, the three tables and the Switchboard entry, and keeps everything else: **a seat that was released stays released**, and nothing a member wrote or attended is touched. To keep the requests for the record, copy them first (the first lines of the file say how). `scripts/rehearse-rollback.sh` rehearses it.

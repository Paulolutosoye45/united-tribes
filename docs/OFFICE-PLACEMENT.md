# Place or move one member from Admin

Migration: `supabase/migrations/20270109000100_office_placement.sql`. Way back: `supabase/rollback/20270109000100_office_placement.down.sql`. Tests: `tests/db/office-placement.test.ts` (32), `tests/db/office-placement-rollback.test.ts`, `tests/unit/office-placement.test.ts`, browser journey `e2e/journeys/47-office-placement.ts`.

## What it is

The owner's **Place one person** tool, opened to **admins and directors**, with the same checks and the same road. It is not a second way of placing: the person is placed by the church's own routine, one person at a time. They get the same **Your tribe** email with a private link (**Yes, I'm in**, **Don't share my details**, **Show me other tribes**), the tribe's leader is told in the usual way, and the leader sees the member's number only after a yes.

It needs **Placement On**. In Rehearsal or Off the pages say so and nobody can place or move anyone from here.

## Where it is

| Who | Where | What |
|---|---|---|
| Admin, director | **Admin → People and roles → Find a member to place or move** | Search every member by name, e-mail or phone number (the last ten digits are compared, so 0803… finds +234803…). A leader is shown but cannot be chosen. **Open · place** or **Open · move** opens their page. |
| Admin, director | **Admin → People and roles → a person** | **Place in a tribe** (no seat) or **Move to another tribe** (has a seat); **Last placement from Admin** with **Undo**; **Requests to the owner** about this person. |
| Admin, director | **Admin → Place or move a member** (People section) | The open tribes this season; **Your requests to the owner**. Open a tribe to find a member and add them to it, and to see who the office placed there lately. |
| Owner | **God Mode → Placement → Placed from Admin** | The requests waiting for you, and a count of who placed or moved how many in the last 30 days. |
| Owner | **God Mode → a person** | The same Place or Move section as before, which now also moves a person who has a seat. |

## What an admin or director may do alone, and what goes to the owner

A check runs first and changes nothing. It sorts what it finds into **blockers**, which nobody can get past, and **warnings**, which are ticked and explained.

**Blockers, for everyone, owner included:** the person leads a tribe (a leader does not join as a member); they are under 18; the season is closed; the tribe is not open or has no certified leader; they already have a seat (place) or none (move); it is the tribe they are already in; **the church took them out of that tribe** (new: this also stops the owner); it is the signed-in person themselves.

**Warnings an admin or a director may accept**, with a tick, a reason of a few words, and the right to do it:

* **Joining has closed** for the season.
* **They have not agreed to matching.** A second tick says *they told me they agree to be matched and placed*. It is kept with the placement as the admin's word, with their name and the time. It does not record any agreement from the member and it does not give the member's consent.
* **A hold the church put there after a removal or for care.** It is lifted for this placement and put back if the placement is undone.

**Every other warning is the owner's:** a fit below the bar, a full tribe, no fit score, a different age group, a form for another season, a hold the owner put there. The page says *(only the owner can allow this)* and offers **Ask the owner** in place of the place button.

## Asking the owner

* The admin ticks, gives a reason and presses **Ask the owner**. Nothing happens to the member.
* The owner sees the request under **Placed from Admin**, with who asked, about whom, the words, and whether the admin said the member told them they agree. **Look again before you answer** runs every check again with today's facts; if a blocker has appeared, approving is not possible.
* **Approve and place** places the member. The run is recorded as the admin's placement (`placed_by` = the admin, `placed_via` = office), with the owner as `approved_by`. The admin is told by a notice (`admin_placement_answer`, in the admin group). **Decline** tells the admin too, with an optional word from the owner.
* A request **lapses after 7 days** if it is not answered. The admin can take it back until then. An admin or director sees only their own requests.

## Limits and safety

* **30 placements a day** for each admin or director. The owner, and requests the owner approved, are not counted.
* **One seat per person, always.** The database takes a lock on the person for the length of a placement, so two clicks (or two people) at the same moment make one seat, not two. If the last seat goes while someone is choosing, the page says *They could not be placed: this tribe has just filled up. Nothing was changed.*
* **A tribe that is only full** (nothing else wrong) says *This tribe is full (4 of 4). Nothing was changed.* if the warning is not accepted.
* Every placement, move, request and undo is written to the event log with who did it and in what role (no note text).

## Moving

A move is a swap done by the church: the old seat is released with the reason **Moved by the church**, the leader of the old tribe is told the member has moved (`swap_moved`), and the member is placed in the new tribe through the same routine as a placement. They are emailed **Your tribe** for the new tribe. If the new tribe is full, or anything else stops the placement, nothing is changed and the old seat stays.

## Undo

* Until the **leader of the new tribe has been told** (their team email goes out), the placement can be undone from the person's page, the tribe's page or **Last placement from Admin**. The seat is released, the member's emails for that placement stop, and any hold the church had put there comes back.
* **Undoing a move puts the old seat back** and tells the old leader (`swap_moved`, *in*). If the old tribe has filled up since, nothing is undone and the page says so: place or move them again instead.
* **The owner can undo any run. An admin or a director can undo only a one-person run** (the ones made here), not a church run.
* After the leader has been told, the page says so and offers no Undo.

## The way back

`supabase/rollback/20270109000100_office_placement.down.sql` puts back the four functions the migration replaced (`placement_one_options`, `placement_one_check`, `placement_one_place`, `placement_undo`), drops the 17 it added and the table of requests (`placement_requests`). Seats, runs, messages, consents and the event log are kept. The seven columns it added to the placement runs stay in place (as every rollback here leaves columns). After it, only the owner places one person and undoes a run, as before. Put the previous application files back first.

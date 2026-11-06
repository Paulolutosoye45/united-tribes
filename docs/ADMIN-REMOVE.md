# Remove a member from a tribe, from Admin

Migration: `supabase/migrations/20270112000100_admin_remove.sql`. Way back: `supabase/rollback/20270112000100_admin_remove.down.sql`. Tests: `tests/db/admin-removal.test.ts` (25), `tests/db/admin-removal-rollback.test.ts` (8), `tests/unit/admin-removal-templates.test.ts` (9), journey `e2e/journeys/51-remove-from-tribe.ts` (27 checks).

## What it is

A **Remove** button for the church's office. Until now only a leader could ask for a member's place to change (Leader removal requests), and the Care Lead, a director or an admin decided. The office had no button of its own. Now an **admin, a director or the owner** can take a member out of a tribe, and the member goes **back to the pile of people waiting to be placed**.

It has **no switch**. It is not part of Leader removal requests, which keep their own switch, their 14 days to appeal and their limits, and it works whether Placement is Off, Rehearsal or On.

## Where it is

| Who | Where | What |
|---|---|---|
| Admin, director, owner | **Admin → Place or move a member → a tribe → Members** | Everyone in the tribe, with **Remove** beside each. |
| Admin, director, owner | **Admin → People and roles → a person → Remove from a tribe** | **Remove from this tribe**, for a member who has a seat. |
| Admin, director, owner | the same two pages, **Removed here lately** | What the office took out of the tribe (or this person) in the last 30 days, with the reason that was written and **Put back** for 14 days. |

Nobody else sees any of it: pastors, leaders, coaches, the Care Lead and members are refused by the database, not only by the page.

## What Remove does

1. Asks for a **reason of 10 to 300 characters**. Only the office reads it. It is never in an email, never shown to the member or the leader, never in the event log (the log keeps the fact and the role, no name and no words), and it is **cleared after 12 months** by the heartbeat.
2. **Releases the seat** (`release_reason` is "Removed by the church"). Nothing the member wrote or agreed to is touched: their form, answers, consents, attendance and testimonies stay as they were.
3. **Blocks that tribe for them**: the matching never offers it again, and the office cannot place them back in it from the Place tools, unless the removal is put back. (The same block a leader's request makes; the two live in one table, one row for each.)
4. **Puts them in the pile with a three-day hold.** Their tribes are looked at afresh the next time they open the page, without that one. No automatic run places them for three days, so they can choose for themselves first. The office can place them by hand at once (the usual warning "The church took them out of a tribe a short while ago" is one an admin or director may accept). A hold the owner put there stays the owner's.
5. **Tells the member**, by email, kindly: which tribe, that other tribes are open, and the first name of the person to speak to (the same email as a leader's request, without the sentence about asking for it to be looked at again, because the office's change has no appeal). A young person is never written to.
6. **Tells the leader**, by email, by the member's first name only: the church has changed their place, with the reminder to take them out of any WhatsApp group they keep outside this site. The member also appears on the leader's **people to take out of the group** list, as for any member who has left.

## What it refuses (in words, and nothing is changed)

* **A young person, or a member with an open care matter in that tribe:** "This place can be changed only through the Care Lead. Ask them to look at it." The page shows that sentence beside the name instead of a button.
* **Yourself.** An admin who is also a member cannot remove themselves; another admin can.
* **A seat that is already gone** ("They are not in this tribe any more"). Two people pressing Remove at the same moment remove the person once: the second finds the seat gone, and nobody is emailed twice.
* **A closed season.**
* **More than 20 removals a day** for an admin or a director (counted for each person, by the Lagos day). The owner is not held to it.
* **A reason shorter than 10 or longer than 300 characters.**

## Put back

For **14 days**, any admin, director or the owner can press **Put back**. It returns the seat, lifts the block and the hold, and emails the member (their place is back) and the leader (they are back). It is refused, with the reason in words, when the tribe is not open, is full, or the person has joined another tribe since. After 14 days the page says to place them again instead.

## The tables and functions

* `admin_removals`: who, which tribe, which seat, by whom and in what role, the reason (cleared after 12 months, `reason_cleared_at`), whether the member was emailed, and when and by whom it was put back. No one can read it directly; only the functions below do.
* `removal_blocks`: now has `admin_removal_id` beside `request_id`. A row comes from exactly one of the two (a check says so), and the old one-per-request rule is kept as a unique index. The way back lifts the office's blocks and leaves these additions in place, as earlier files leave their columns.
* Functions the pages call: `admin_remove_member`, `admin_put_back`, `admin_tribe_members`, `admin_removal_person`. Inside: `admin_removal_lately`, `admin_removal_tidy` (no one can call either). `worker_removal_tick` (the heartbeat's removal round) now clears old reasons before it does what it did.

## Not done here

* **No "I need to leave this tribe" for the member**, and no leader-side removal without the office: those are Package 7.
* **The Care Lead's own route** for a young person or an open care matter is unchanged: Leader removal requests.
* **The WhatsApp group** is still the leader's to tidy; the site cannot remove anyone from a group.

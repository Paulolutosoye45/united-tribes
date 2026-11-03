# Count only members who said yes, and keep the WhatsApp group closed until they do

Migration: `supabase/migrations/20270107000100_said_yes.sql`. Way back: `supabase/rollback/20270107000100_said_yes.down.sql` (it holds the old text of every function the migration replaced). Tests: `tests/db/said-yes.test.ts`, `tests/db/said-yes-rollback.test.ts`, with the unit tests for the wording (`placement-wording`, `placement-marks`, `placement-group`, `placement-templates`) and journey 38.

## The problem

Two things were true that should not have been.

1. **The numbers counted people who had not answered.** A member the church placed was counted as "matched", as a member of the tribe, and in every rate on the dashboards, even if they had never opened their email. A tribe could look full of people who did not yet know about it.
2. **A leader saw a member's number, and the tribe's WhatsApp group link went out, without a yes.** A member's details opened to the leader when a day had passed since the email, or because the member had ticked "agreed to share" on the form. Silence opened a person's number.

## Fix 1: a seat is in one of three states

Worked out from columns that already exist. Nothing was added to a member's record for this.

| State | When | Counted as |
|---|---|---|
| **Said yes** | the member chose the seat themselves, or pressed **Yes, I'm in** | matched, a member, in every rate |
| **Placed, waiting** | placed by the church, no answer yet | its own figure, beside the others |
| **Gone** | declined, moved or released | nothing |

* **"Matched", "members" and every rate** on the headline, church, insight and community dashboards now mean *said yes*.
* **The people still waiting** are their own figure beside it: on the headline ("N more members placed by the church, waiting for a reply. Not counted here until they say yes."), on the church and insight pages, and on each tribe.
* **A waiting seat still counts against the tribe's capacity**, so a tribe cannot be overbooked while an answer is awaited.
* **No seat changes and nothing is sent.** Only what is counted and how it is worded.

## Fix 2: the leader's view of a number, and the group link, open on a yes and on nothing else

One rule, kept in one place (the database function `placement_contact`), for every screen and every list a leader reads.

| Member | What the leader sees |
|---|---|
| Chose the seat themselves | open, as it always was |
| Said **Yes, I'm in** | open: email and WhatsApp number (if they said yes to WhatsApp) |
| Placed by the church, **no answer yet** | their **name**, marked *placed by the church, yet to answer*. No number. |
| Placed, the wait has run out with **no reply** | the same, now marked **unanswered** (a new state). **Nothing opens by itself any more.** |
| Pressed **Don't share my details** | private for everyone, before and after a yes |
| God Mode pressed **Open now** or **Open all** | open: the pastor's call, kept as it was |

What no longer opens a number: a day passing, and the box "agreed to share" on the form.

### The tribe's WhatsApp group

* **The link is shown to the member after a yes** (or when the seat was their own choice). The first email carries it only if the owner has switched **Hold back the WhatsApp group link until a member has answered** off in God Mode.
* **The leader's list, on the tribe page: Your WhatsApp group.** **Ready to add**: the people who said yes, each with the number and a tick, **Added to the group**, so the assistant does not add them twice. A member who pressed *Don't share my details* is listed without a number, with a note to send them the group link instead. **Placed by the church, waiting for a reply**: names only ("Their number opens when they say yes, and not before").
* **If they joined the group, remove them.** A second list: people who have left the tribe (moved, released, removed by the church) and may already be in the group, each with a tick, **Removed from the group**.
* **People who left before this change** may already be in a group. The date the group closed is kept (`group_closed_from`), so the list shows them.
* The ticks are the leader's own record. The app cannot add or remove anyone in WhatsApp; it only tells the leader who should be there.

## What a member sees

The page they open from the email says the leader sees their name now, and is given their email and number only after they press **Yes, I'm in**; the guide **You have been placed** says the same. The leader's team email lists a member who has not answered as "waiting for a reply. Their details come once they say yes".

## What the owner can still do

**Open now** and **Open all** (God Mode → Placement) still open a tribe's contacts without waiting for a yes. They are the pastor's call and are recorded. A member who held back stays private under them.

## The way back

`supabase/rollback/20270107000100_said_yes.down.sql` puts every replaced function back exactly as it stood and removes the two new list functions (`tribe_group_list`, `tribe_group_mark`) and the helper (`seat_said_yes`). The three columns it added (`group_admitted_at`, `group_removed_at`, `group_closed_from`) stay where they are, as in every rollback here (nothing is dropped from a table that holds people's data). Put the previous application files back first.

# Leader Desk (God Mode), Phase 1: see

**God Mode → Leader Desk.** The owner's own page for the people who finished the form and still have no seat, and for the members who could one day lead. **Phase 1 only shows, scores and drafts. It sends nothing, changes no member, seat, tribe, message or notice, and tells nobody anything.** Emailing a proposed group, recommending a leader and forming a tribe are Phase 2.

## Who can use it, and when

* **The owner only**, with God Mode unlocked. Admins, directors, pastors, members and visitors are turned away by the database itself, not only by the page.
* **Closed until you open it.** The switch is **God Mode → Features → Leader Desk** (platform-owner only). **Off** (the start): the page says it is switched off and nothing is read. **Rehearsal** and **On** both open the page. In Phase 1 they do the same thing, because there is nothing to send; the page says so when it is in Rehearsal.

## What it shows

Three tabs, with a count on each.

| Tab | What it is |
|---|---|
| **Waiting** | Members with a finished profile this season, no active seat and no active hold. Not shown: hidden people, under-18s, leaders and assistants, the platform owner, anyone with an open erasure request, or anyone from another centre. Filter chips: **No tribe shown**, **One or two shown**, **Has options**, **Never ran the matching**, and **Asked for a Starter tribe**. Each person shows the days waiting, the **one reason no tribe fits**, and a masked phone number. |
| **Leaders** | Members by **leadership signal**, in three pools (below). |
| **Proposals** | Groups that waiting people could already fill (same life stage, time, way of meeting and type, at least the minimum tribe size, not counting people already in a draft), and your **draft groups**. |

### Why no tribe fits

One plain reason per person: **no tribes yet**, **life stage**, **under 18 needs an assistant**, **excluded from the tribes shown**, **time**, **format**, **area**, **type**, **tribes are full**, **score below the floor**, or **other**. The reason comes from the same rules the matching uses. If any tribe would score the person at or above the floor, there is no reason shown, because there is nothing wrong. A test proves the two agree.

## Phone numbers

* **Masked everywhere.** Only the last digits show.
* **Show number** opens one number at a time, **only 8 am to 8 pm Lagos time**, **at most 60 an hour**. The number hides itself again after 60 seconds.
* Every opening is written down (who, which person, when) **without the number**. The event log line is `leader_desk.reveal` and carries nothing else.
* The only phone link on the page is the one that appears after **Show number**.

## Draft groups

A draft is not a tribe. It has no leader, no seats, and nobody is told about it. Only you see it.

* One draft per person; at most 40 drafts a season. Archive a draft to remove it from the list.
* **Add** refuses what the matching would refuse for that person: wrong season, under 18, life stage, time, way of meeting, area, or type. It also refuses a full group, someone not waiting, or someone already in another draft.
* Things that are only worth a look (the group would have too many people who need extra support, too few established believers, or no quiet or lively voice) show as **watch**, not as a refusal.
* **Checks on each draft:** size, fit, score, heavy support, established believers, balance, and numbers. **Ready to form** means every check except numbers is ok. Numbers is information: a tribe needs the minimum size (5 by default) before a placement run will fill it.
* **The score is the real score.** A draft is scored by the same weights as a real tribe, over the draft's members, leave-one-out, with a neutral leader-style. For the same members and settings the number is the same as the matching would give; a test checks this across 17 profile variations on two tribes.
* **Who would suit it** lists waiting people by how well they would score, and you add them one at a time.

## Leadership signal

A number out of 100 built from five things the church already knows, and **nothing else**:

| Part | Out of | How |
|---|---|---|
| **Willingness** | 30 | said yes to leading 30, maybe 15, not now 0, not answered 7.5 |
| **Walk** | 25 | leading or established 25, growing 15, new 7.5, anything else 2.5 |
| **Reliability** | 20 | weeks present out of weeks present plus absent, once there are 3 weeks of records; before that, half marks |
| **Named by others** | 15 | none 0, one 9, two or more 15 (recommendations not withdrawn or declined) |
| **Progress** | 10 | steps done or partly done out of steps answered, once there are 3; before that, half marks |

**Pools**

* **Ready now**: willing (yes or maybe), established or leading, signal 70 or more.
* **Almost**: willing (yes or maybe), signal 50 or more, not in Ready now.
* **Members**: everyone else. Someone who said "not now" always stays here.

The signal **never reads** gender, age, area, health, care notes or support load (a test checks the function does not mention them). **No dates are promised** to anyone from it, and it makes nobody a leader. Appointing a leader still goes through the existing leader flow.

## Applying and undoing it

* **Apply:** `supabase/migrations/20270116000100_leader_desk.sql` (needs Package 6b applied first; it stops with a clear message if not). Then deploy the website. See `docs/APPLY-LEADER-DESK.md`.
* **Undo:** `supabase/rollback/20270116000100_leader_desk.down.sql`. It removes the Desk's own functions, its three tables (draft groups, their members, the log of numbers opened) and its place on the Switchboard. It changes no existing function and no member, seat, tribe, message, notice, consent or log line. Running it twice changes nothing. `tests/db/leader-desk-rollback.test.ts` rehearses it.
* The migration adds **22 functions** (13 the page calls, 9 helpers closed to every signed-in person), **3 tables**, and one Switchboard entry. It replaces no existing function.

## What comes next (Phase 2, not built)

Email a proposed group to waiting people; recommend someone as leader of a new group; form a tribe now and appoint a leader, with members emailed only after the leader accepts; and a settings card for the thresholds above.

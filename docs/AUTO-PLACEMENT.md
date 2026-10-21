# Automatic placement, bulk leaders and assistant leaders

Three things that belong together. God Mode can **place members in tribes automatically**, in bulk, by their Degree of Compatibility. God Mode can **appoint many leaders at once**, from the approved leaders waiting for a tribe and from a list you paste. And a leader can **recommend an assistant leader**, which the office decides.

Nothing is placed, appointed or sent until it is switched on and a person in God Mode has read a plan and pressed approve. **Placement starts Off.**

## Part 1: placing members (`/god/placement`)

### The switch

| | What it does |
| --- | --- |
| **Off** | Nothing is planned, placed or sent. This is how it starts. |
| **Rehearsal** | A plan is made and walked through. Nobody is seated and nothing is emailed. What each leader would have received is written to the message log as *Rehearsal: written to the log, not sent*, with first names only. |
| **On** | An approved plan seats members and sends their emails. Switching On asks you to read what it promises first. |

### A run, in five steps

1. **Overview.** Who there is to place (members with a finished form and agreement to be matched), the seats open in approved tribes with a certified leader, the plan in progress or a button for a new one, the church's choices, and the members you have set aside.
2. **Plan a run.** You may narrow it to one community or one area, and set the emails an hour. Nothing is placed. For a first run, narrow it and keep the pace low.
3. **The plan is made.** The page works through the members in small steps (about 200 at a time, never longer than a few seconds), first counting the tribes that suit each member, then giving each member the tribe the app would have shown them as card number one, hardest-to-place first. **Keep the page open while the plan is made**; if it closes, open the run again and it carries on.
4. **Read and change the plan.** You see the numbers, the tribes, the people, who was left out and why, and any tribe that would start too small. For each person you can see the other tribes they suit, move them, take them out of the run, or set them aside. For each tribe the plan would leave smaller than your smallest, you choose **Keep it**, **Hold the members back** or **Try their next-best tribes**. You cannot approve until each is decided.
5. **Approve.** The button shows the number it will place. If the plan changed since you read it, the approval is refused and you read it again. After you approve, members are seated in steps of 50, by the page if it is open and by the heartbeat if it is not.

### What a member is placed in

- Only a tribe at or above the pastor's compatibility bar (60, the active matching model's minimum). The bar is set with the model; this feature cannot change it.
- Only a tribe with room: a seat is **always kept free** (you can keep two free), and the tribe's own health rules still apply (it keeps room for established members, and a tribe with one or two seats left needs a quiet and a lively member).
- A member who changed their answers or looked for a tribe in the last **7 days** is left alone, so they can choose for themselves. A member who chooses a tribe while the plan is waiting keeps their own choice.
- Never a young member (under 18), never a member who has not agreed to be matched, never someone with a deletion request open, never a leader, never someone who already has a seat, never someone whose form is for another season, never someone you set aside.

### What the member receives

An email, **Your tribe**, from the church office: the tribe's name, its leader (and assistant), when and where it meets, the three lines of the Success Picture, and one sentence saying what the leader will be given. It carries three links to a private page, with no sign-in:

- **Yes, I'm in** — the member agrees to the Success Picture and the Tribe Covenant, and the seat is confirmed.
- **Show me other tribes** — the seat is given up and the member is taken to choose.
- **Don't share my details** — the leader is **not** given the member's email or WhatsApp number. The leader is told that this member has their details, and the member is sent a note saying how to reach the tribe.

Opening a link changes nothing; the page asks the member to press the button. The links are secrets the database makes (64 characters, kept only as a hash), last 60 days, and stop working the moment the seat is given up. A member who has not answered is sent **one reminder** five days after the first email.

Members are emailed no faster than the pace you set (100 an hour to start), between 9 am and 7 pm Lagos time, in the order they were placed.

### What the leader receives

An email, **Your team**: the name, email and WhatsApp number of each member, and nothing else about them (no answers, no age, no faith journey, no needs, no score). A member who held back is listed by name with *contact withheld; they have your details*.

It is sent **24 hours after the last member of that tribe was told** (the hours are one of the church's choices), so each member has a day to say "don't share my details". If every member of the tribe agreed on the form to share, it goes at once. The assistant leader is sent the same email. Until that email has been queued, the leader's tribe page and weekly page **do not list the members the church placed** (they have not yet had their day to hold back; the page says no one has joined yet). After it, each is listed with a mark that the church placed them, and a member who held back is listed without a WhatsApp number.

On the form, an optional line asks the member to agree that a leader may be given their name, email and WhatsApp number if they are placed. Leaving it empty is the same as the 24-hour wait; saying no later, on the private page, is final.

### Undo

You can undo a whole run **until a tribe's leader has been told**. Members who have not answered are released and their emails stop; members who said yes stay; a tribe whose leader has been told stays as it is. Members released by an undo can be placed again in a later run.

### The church's choices (Overview → The church's choices)

| Choice | Starts at | Range |
| --- | --- | --- |
| Days to let a member choose first | 7 | 0 to 30 |
| Seats kept free in each tribe | 1 | 0 to 2 |
| Smallest tribe worth starting | 5 | 4 to 8 |
| Emails an hour | 100 | 1 to 1,000 |
| Start / stop sending (hour, Lagos) | 9 / 19 | 6 to 20 / 7 to 21 |
| Hours before a leader is told | 24 | 0 to 72 |
| Days before the one reminder | 5 | 1 to 14 |

A plan already made keeps the numbers it was made with.

### Why a member was left out

Every person left out of a run has one plain sentence saying why: leads a tribe; on hold; has not finished the form; has not agreed to be matched; under 18; has asked for their data to be erased; has no email we may use; their form is for another season; changed their answers or looked for a tribe in the last few days; no tribe fits their stage, time or format; the best tribe is below the compatibility bar; every tribe that fits is full; their tribe would have been too small; you took them out; they chose a tribe themselves; their tribe was closed, changed or filled before they were placed; the run was undone.

## Part 2: appointing leaders in bulk (`/god/appointments`, **Bulk** tab)

1. **Who.** The approved leaders who have no tribe yet (switch off to leave them out) and, optionally, a list of people: pasted from a spreadsheet, or a `.csv` or `.xlsx` file of up to 300 rows. The columns are **Email, Stage of life, How they lead best** and, if known, **Community, Goal, Relation** (reached or working on it) and **Cleared** (a pastor cleared them for sensitive subjects). The page reads the file and lists every row it cannot use with its line number. People on the list must have signed in to the platform once.
2. **The plan.** The goals that most need a leader come first (a tribe for every twelve members waiting). Each person is paired with the goal that suits them best, by the same fit model as the one-at-a-time appointment. Only a fit of 60 or more is recommended; nobody is paired with a goal that needs a clearance they do not have. You see the goals still short of a leader and the people not in the plan, with the reason. You can move a person to another goal that suits them, or take them out.
3. **Approve and apply.** Applying appoints 25 at a time. A person who cannot be appointed (they took a tribe in the meantime, say) is marked with the reason and the rest carry on.

An approved leader's Tribe Card is **started** the same way as when they press *Start my card*. A person from the list is given the leader role and a started card the same way as the one-at-a-time appointment. In both cases the card is a draft with the community and goal set; **a pastor still reviews and approves every card, and the Academy still certifies every leader**. Members see no tribe until both are done. Each person is emailed *You have been appointed*, with the goal and community and no score. The owner is never named.

Bulk **approval of cards** is not part of this.

## Part 3: assistant leaders

A tribe has **one assistant leader at most**. The review panel's way of pairing one is unchanged. This adds a second way in:

1. **The leader recommends.** On their tribe page, the leader names someone, by choosing them or by email address, with a sentence in their own words. One recommendation can wait at a time; the leader can withdraw it. A person under 18 can never be named.
2. **The office decides** on **Admin → Assistants** (`/admin/assistants`). An admin, a director, a pastor or God Mode may decide. For a tribe with young members (a teens tribe, or any active member under 18) only a pastor or a director may.
3. **If the person is already an approved assistant leader**, approving pairs them at once. **If not**, they are invited to apply, and the heartbeat pairs them when a pastor approves them. An invitation nobody takes up in 60 days lapses, and the leader is told.
4. **If the tribe already has an assistant**, the office must choose **Replace**. The change is one step: the tribe is never without an assistant, the one replaced is told, and if the new one cannot be paired (they assist another tribe this season, say) the old one stays.
5. The leader is told the outcome in a line. **The reason the office gave stays with the office.** A decision by God Mode records no decider.

## Rules this keeps

- A pastor decides every leader application, and nothing here approves a Tribe Card or certifies anyone.
- No certificate is withdrawn. Nobody under 18 is placed, recommended or written to.
- The hidden owner is never named, never a recipient, and never recorded as a decider.
- No email carries a member's answers, faith journey, needs, age or score, a care note, or a young member's content.
- Every message here is email only, from the church office.

## How big

Tried on synthetic data with 5,000 ready members and 600 tribes (see `docs/APPLY-AUTO-PLACEMENT.md` for the numbers): every page opens in a fraction of a second and no step, planning or placing, runs longer than a few seconds.

## What is stored

`placement_settings`, `placement_runs`, `placement_items`, `placement_teams`, `placement_tokens`, `placement_holds`, `placement_leader_runs`, `placement_leader_items` and `assistant_recommendations`; four columns on `tribe_members` (`placed_by_run`, `placement_source`, `confirmed_at`, `contact_withheld`); and one new consent purpose, `team_contact`. Every table has row-level security and no grants: only the functions touch them.

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

An email, **Your tribe**, from the church office: the tribe's name, its leader (and assistant), when and where it meets, the three lines of the Success Picture, and one sentence saying what the leader will be given. The tribe's WhatsApp group link is in it **only if the member has already answered about sharing** (agreed on the form, or said no there). Joining a WhatsApp group shows your number to everyone in it, so a member who has not answered is told the link will be on their tribe page as soon as they press **Yes, I'm in**, or a day after they were emailed. It carries three links to a private page, with no sign-in:

- **Yes, I'm in** — the member agrees to the Success Picture and the Tribe Covenant, and the seat is confirmed.
- **Show me other tribes** — the seat is given up and the member is taken to choose.
- **Don't share my details** — the leader is **not** given the member's email or WhatsApp number. The leader is told that this member has their details, and the member is sent a note saying how to reach the tribe.

Opening a link changes nothing; the page asks the member to press the button. The links are secrets the database makes (64 characters, kept only as a hash), last 60 days, and stop working the moment the seat is given up. A member who has not answered is sent **one reminder** five days after the first email.

Members are emailed no faster than the pace you set (100 an hour to start), between 9 am and 7 pm Lagos time, **tribe by tribe**: the tribe holding the member hardest to place goes first, and each tribe's emails go out in one block, so a leader waits for their own team and not for the whole run. Who goes to which tribe does not change.

### What the leader sees, and when

One rule, kept in one place (the database function `placement_contact`), for every screen a leader looks at:

- **Names, at once.** The moment a member is placed, the leader and the assistant see them by name on My tribe, the weekly log, the Lead page and the Dashboard, marked *Placed by the church, yet to answer* or *said yes*. Names were never what the hold protected: the member's own email already names the leader.
- **Email and WhatsApp number, member by member.** A member's details open when that member has said yes, agreed on the form, or their own email went out and the hours you set (24 to start) have passed. A member who said **Don't share my details** is never opened, for anyone, whichever role. A member whose email failed or never went is listed as *not yet reached*, and their details never open by themselves; God Mode can open them (below).
- **The raw lists apply it too.** The lists themselves (`tribe_roster`, `tribe_week`) now apply the rule, so no screen and no direct call can skip it. A coach, pastor or director still sees what they always saw, except that a member who held back is hidden for everyone.
- **The group link follows the same rule**, and is a God Mode setting (*Hold back the WhatsApp group link until a member has answered*, on to start). Turn it off and the link is shown at once and goes in every first email, as before.

### What the leader receives

An email, **Your team**, listing **every member by name**. A member whose details are open comes with their email and WhatsApp number and nothing else about them (no answers, no age, no faith journey, no needs, no score). A member who held back is listed with *contact withheld; they have your details*; one still in the hold with the day it ends; one whose email has not gone with *not yet reached*.

It is queued, tribe by tribe, as soon as nobody in the tribe is still waiting for their email or sitting in the hold, or **72 hours after the tribe's last planned email**, whatever is still stuck, so one stuck email can no longer hold a tribe closed. It is also sent when you press **Open now**. The assistant leader is sent the same email. The switch no longer decides whether a leader is told: with the switch Off or Rehearsal the heartbeat starts nothing new, but it still finishes telling the leaders of people already placed.

On the form, an optional line asks the member to agree that a leader may be given their name, email and WhatsApp number if they are placed. Leaving it empty means the member's own day applies; saying no later, on the private page, holds their details back until they have actually opened (after that it is too late, and the page says so).

### Undo

You can undo a whole run **until a tribe's leader has been told**, whether by the heartbeat or by Open now. Members who have not answered are released and their emails stop; members who said yes stay; a tribe whose leader has been told stays as it is. Members released by an undo can be placed again in a later run.

### The church's choices (Overview → The church's choices)

| Choice | Starts at | Range |
| --- | --- | --- |
| Days to let a member choose first | 7 | 0 to 30 |
| Seats kept free in each tribe | 1 | 0 to 2 |
| Smallest tribe worth starting | 5 | 4 to 8 |
| Emails an hour | 100 | 1 to 1,000 |
| Start / stop sending (hour, Lagos) | 9 / 19 | 6 to 20 / 7 to 21 |
| Hours before a member's details open to their leader | 24 | 0 to 72 |
| Days before the one reminder | 5 | 1 to 14 |

A plan already made keeps the numbers it was made with. A tick box beside them holds the WhatsApp group link back until a member has answered (on to start).

### The run board: why a tribe is closed, and Open now

Once a run has placed people, the board lists every tribe with its members seated, member emails sent, waiting and failed, how many have not answered, when the last hold ends, and one state in plain words:

| State | Means |
| --- | --- |
| Waiting for emails | At least one member's email has not gone out yet |
| In the hold | Every email has gone; some members' details open when their day has passed (the day is shown) |
| No email has gone | Every member email failed or was skipped: fix sending, then ask for a re-send |
| Due now | Ready; the leader is told on the next heartbeat |
| Leader told / Opened by you | The leader has their team |

Each tribe that is not yet told has **Open now**, and the page has **Open all**. Each asks first and says how many members who have not answered will have their email and number given to the leader. A member who said "Don't share my details" stays withheld. The leader is emailed their team, and that tribe can no longer be undone. A line shows when the heartbeat last ran; if it is more than an hour old, the heartbeat is not running.

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

### Placing while a season is running

A season counts as **running** from the day it starts until it ends. People can join and be placed for the first two weeks of it (the church's **joining closes** setting, 14 days by default, counted from the first day). The Placement page says which season it is, which week it is in, and when joining closes.

A run made in a running season is the same run (plan, read, approve, undo) with these differences, which the page lists when you start one:

- **The window.** Members are placed only until joining closes. After that the page refuses a new run, unless you tick **Place after the cut-off** and say so; that run is marked as placed after the cut-off.
- **Small tribes are not held back.** In a running season a tribe cannot wait to reach its smallest size, so the "too small" decision is not asked.
- **A shorter wait before the leader is told.** The wait for a member to change their mind is two days at most (your own setting if it is shorter).
- **A first meeting within the week.** The member's email asks them to meet their tribe within a week of being placed, not by the season's usual date.
- **A leader is not emailed twice in a day.** If an earlier run (a run of one counts) emailed the same tribe's leader in the last 24 hours, the next "Your team" email for that tribe waits until the day has passed. **Open now** ignores the wait.
- **"Show me other tribes" works until joining closes**, and the member's page says so. After that, the member asks the leader or coach.

### Placing one person

God Mode → People → a person with no seat → **Place in a tribe**. It is for the one person who did not fit a run: someone who joined late, or whom a pastor asked you to place. It needs Placement **On** (it does not work in Rehearsal), and it is the owner's alone.

You choose a tribe from the open tribes with a certified leader; each shows its leader, its seats and the person's fit. The database then checks, and says in plain words:

- **What stops it, with no way round:** not a member, a leader, under 18, an open deletion request, no email we may use, a season that is closed, a tribe that is not open, already has a seat.
- **What needs your word:** a seat held for them, a form not finished, no fit score, no agreement to be matched (you must say they told you they agree; this is recorded as your word, not theirs), already in another season's tribe, below the compatibility bar, a different track, a full tribe, placed after joining closed. You tick that you have read each one, and give a reason of a few words, which is kept with the placement.

The person is then placed exactly as a run places them: the "Your tribe" email with a private link to say yes, hold back their details or look at other tribes, the leader's team email, the same hold on details. It is recorded as a **run of one** ("Single placement" in the run list) and can be undone until the leader has been told. The event log keeps who placed them and why.

## Rules this keeps

- A pastor decides every leader application, and nothing here approves a Tribe Card or certifies anyone.
- No certificate is withdrawn. Nobody under 18 is placed, recommended or written to.
- The hidden owner is never named, never a recipient, and never recorded as a decider.
- No email carries a member's answers, faith journey, needs, age or score, a care note, or a young member's content.
- Every message here is email only, from the church office.

## How big

Tried on synthetic data with 5,000 ready members and 600 tribes (see `docs/APPLY-AUTO-PLACEMENT.md` for the numbers): every page opens in a fraction of a second and no step, planning or placing, runs longer than a few seconds.

## What is stored

`placement_settings`, `placement_runs`, `placement_items`, `placement_teams`, `placement_tokens`, `placement_holds`, `placement_leader_runs`, `placement_leader_items` and `assistant_recommendations`; four columns on `tribe_members` (`placed_by_run`, `placement_source`, `confirmed_at`, `contact_withheld`); one new consent purpose, `team_contact`; and, from the placement visibility fix, `placement_teams.contact_opened_at`, `placement_settings.hold_group_link` and `placement_settings.last_tick_at`. Every table has row-level security and no grants: only the functions touch them.

From the in-season placement package: on `placement_runs`, `in_season`, `after_cutoff`, `single` and `note`; on `placement_items`, `override`, `override_reason` and `agreed`. Nothing new is stored about a member beyond that.

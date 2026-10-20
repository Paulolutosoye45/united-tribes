# Leader supply and demand (the board, suggestions and offers)

Members choose a Season Goal. Where more members are waiting for a goal than there are open seats in tribes for it, **a leader is needed**.
This page of the Admin hub shows where, suggests which leaders could fill the gap, and lets the pastorate offer the tribe to one of them.

`/admin/leader-supply` — Admin → **Leader supply**.

## Who sees what

| | Admin | Director | Pastor | Data lead | Coach, member |
|---|---|---|---|---|---|
| Read the board, ask for suggestions, read the offers | yes | yes | yes | yes | no (sent home) |
| Make an offer, withdraw an offer | yes | yes | yes | **no** | no |

The leader sees only **their own** open offer, on their Lead page. The database checks all of this again; the page only decides what to show.

## The board

- One row for every active goal. **Needing a leader** is every goal whose gap is above zero, the largest gap first.
- The figures are the ones the compatibility test already reads (`goal_demand_rows`): **waiting** (members who chose the goal and have no seat),
  **seats open** (open seats in tribes already for it) and **gap** (waiting less seats open). There is no second counting rule: a test fails if
  any function written for this page reads the members' choices itself.
- **Leaders interested**: how many leaders chose the goal first, and how many named it as a backup, on their *latest* run of Find your tribe.
  A quiet run does not count (the leader did not choose anything), nor an appointment, nor a leader who already leads that goal this season.
- **Leaders with few good options**: leaders whose last look found fewer than three tribes that suit them. It usually means the cards in their
  community are thin, not that the leader is.
- If a season is not open, no fit model is approved, or no card is signed off, the board still shows the true numbers and says in one sentence what
  is missing.

## Suggestions

*Who could lead this?* works out, **now**, up to three leaders for that goal. Nothing is saved and nobody is told. The order:

1. Higher degree of fit first (the compatibility test, model in use).
2. Then a leader who chose this goal first, then as a backup, then neither.
3. Then a leader inside the card's life stage before one next to it.
4. Then the earliest application, then the person's id (so the order never changes between two looks).

Who can be suggested: a person with the leader role **and** an approved leader application on file (their saved answers are the input), who
leads no tribe, has no open offer, and is not the platform owner. A leader whose saved answers are missing something the comparison needs is left out
rather than guessed for. A sensitive card is never suggested to a leader below the care bar. Each suggestion shows a degree, a word
(*excellent*, *strong*, *good*) and one sentence. The five parts of the score are not shown here.

## Offers

- *Offer this tribe* asks first, then records the offer and sends **one** message (email; a WhatsApp version would first need Meta's approval, so it
  is not put to Meta). The message says **how many people are waiting for the goal, and nothing about who they are**.
- An offer stays open **14 days**. A leader can hold **one open offer at a time**. An offer expires by itself; the list shows it as *Not answered
  in time*, and a new offer can be made.
- The pastorate can **withdraw** an offer that has not been answered. The leader is not told; their page simply stops showing it.
- The leader's Lead page shows the offer: how many are waiting *now* (and, if it has changed, how many were waiting when we asked), a **Yes, I'll lead
  it** and a **Not this time**.
  - **Yes** starts a Tribe Card exactly as an appointment does: the goal, community and life stage are locked and the three Success Picture lines
    are filled from the signed-off ready-made card (a line the leader wrote first is never overwritten). **A pastor still approves the card.** Nothing is
    certified by saying yes.
  - **No** changes nothing else.
  - Answering twice changes nothing the second time.
- An offer made by the platform owner records no name (`offered_by` is empty) and the owner's action goes to the owner's own log, never the office's.

## What is recorded

`public.leader_offers` (closed to every client; row level security on, no policy). The log gets `leader.offer_sent`, `leader.offer_withdrawn`,
`leader.offer_accepted`, `leader.offer_declined`. The owner's activity view words them in plain English.

## The functions (all `security definer`, empty search path)

| Function | Who | What |
|---|---|---|
| `leader_board()` | office | The board. |
| `leader_suggest(goal)` | office | Up to three leaders for one goal. Writes nothing. |
| `leader_offer_send(goal, person)` | admin, director, pastor | Records the offer, queues one message. |
| `leader_offer_withdraw(offer)` | admin, director, pastor | Closes an open offer. |
| `leader_offers_list()` | office | Open offers and those from the last 90 days. |
| `my_leader_offers()` | a leader | Their own open offer, with the count now. |
| `leader_offer_respond(offer, accept)` | the leader it is for | Yes or no. |
| `leader_offers_expire()`, `leader_interest_rows(season)` | nobody (internal) | Marks old offers; counts the leaders interested. |

Going back: this phase adds only new things (one table, new functions, one message template) and changes no existing function, so there is no
rollback file for it. The way back is to stop using it: do not open **Leader supply**, and withdraw any open offer there. No row is ever deleted.
`leader_offer` is the only template added and is harmless to leave in the code. (Phases 2, 3 and 6 change existing functions and do have
rollback files; see `docs/RELEASE.md`.)

## What is not tested with real people

The 14-day wording, how the message reads on a phone, and whether the order of suggestions feels right to the pastorate. Both the order and the
fit weights are a first proposal for the pastorate to judge, not a finding.

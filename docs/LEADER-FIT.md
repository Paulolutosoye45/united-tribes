# Find your tribe: the compatibility test for leaders

When a leader applies, the system compares their answers with the tribe cards, shows the best three with plain reasons, and lets them choose
one of those or any other. A pastor then sees how well the leader fits the tribe they chose. It is built the way members are matched to tribes,
so the platform has one way of matching, not two.

**It guides; it never decides.** A pastor decides every application, the readiness thresholds stay **75** (leader) and **60** (assistant
leader), and nothing in this feature changes a score, withholds a decision, or turns anyone down.

It is **off until you switch it on** (Admin → Leader pipeline → *Find your tribe*), and it will not switch on until there is something to show
(see "Switching it on").

## What a leader sees

After *How you lead best* a new screen, **Find your tribe**, opens. It adds about a minute.

- **The three best matches**, each with a word and a percentage (*Excellent match, 91%*; *Strong*; *Good*) and up to three plain reasons
  ("You have walked this road", "Your way of leading suits this group", "Members are waiting for a leader here").
- **Every other tribe**, under its community. These show only the word and percentage; a tribe that would be a stretch for them says **Stretch**
  and shows no number. The leader can choose any of them.
- **Up to two backups**: "I would also be glad to lead this one". A third is refused.
- The leader can come back and change their choice until they send. Changing an earlier answer that the comparison reads (stage of life,
  community, goal, how they lead best, or the six situations) sends them back to this screen once, so a choice never rests on stale answers.

They never see a score for judgement, the weights, the hidden leadership profile of a card, the sensitive flag, or another leader's choice.
If a leader's tribe is a sensitive subject and their care result is below the bar, it is simply not recommended to them (a pastor sees why).

**The send gate.** If Find your tribe is on and a leader presses *Send my application* without having chosen (for example a draft started
before the switch was on), they are taken to the screen instead, and the application stays a draft. If there is nothing to choose (no signed-off
card suits their stage of life), the screen is passed over and nothing is blocked.

**The leaders' first check is untouched.** The checks on written answers (minimum words, retries, the consent wording, the kind notes, the hold
for a person) happen on the earlier screens and in the same order as before. Find your tribe comes after them. Nothing on this screen is a
written answer, so it can never be filled with gibberish; the choice is one of the tribes the database offered, and the database refuses any
other.

## What the comparison looks at

Nothing new is asked of the leader. The five parts come from answers they already give:

| Part | From | Weight in model lf-1 |
| --- | --- | --- |
| **Calling** | The goal and community they named, and whether they have walked it or are walking it now. A card for the very goal they named scores 100, a goal in the same family 60, any goal in the same community 40, anything else 10; a leader who has walked the road counts fully, one still on it 80%. | 35 |
| **Judgement** | The six situations. A leader who has not answered them yet is given 60 until they have. | 20 |
| **Style** | How they lead best (structure, connection, teaching, doing) against what the card's group asks of its leader. | 20 |
| **Need** | How many members are waiting for the goal, less the seats already open. Zero for a tribe nobody needs, full for twelve or more. The same figure is used by the supply board (a later phase), so the two cannot disagree. | 15 |
| **Stage** | Whether the card suits their stage of life (100) or the next one along (60). A card two stages away is not offered. | 10 |

The degree is the weighted total, rounded. **Excellent** is 85 or more, **strong** 70, **good** 60 (the line a model calls a good match),
below that **stretch**. Sensitive subjects (marriage, grief, addiction and the like) also need a **care result** of 70 or more, which is the
average of the three care situations (a quiet member, words that worry you, a request for money).

The model, the thresholds and each formula are in one database function (`leader_fit_options`). A second copy, written independently in
TypeScript (`tests/db/leader-fit-reference.ts`), is held against it by the tests for thousands of generated leaders; if they ever disagree one has drifted.

## The model: weights the pastorate approves

The weights are a **model**, kept as versions that are never edited (`lf-1`, `lf-2`...). **Admin → Leader pipeline → Tribe fit** shows:

- Whether it is on, whether it is ready, which model is in use and who approved it, and how many of the tribe cards are signed off.
- A form to **propose a new version**: change the five weights (they must add up to 100, whole numbers) and the care bar. It is saved, not used.
- **Approve** (the pastor only): the version becomes the one in use. The earlier one stays on record, and every run keeps the model it was made
  with, so what a leader was shown can always be explained afterwards.
- **Look at the leaders now**: the quiet run, below.

`lf-1` ships as a proposal and is **not active**. Nothing uses a model until the pastor approves one.

## What the pastor sees: Tribe fit

On an application (`/review/<id>`) a **Tribe fit** panel shows which tribe the leader chose, the match word and percentage, the five parts as
bars, anything worth talking about, the backups they named, the other tribes that also suited them, and the model. Things to talk about are
plain sentences: *Chose a sensitive tribe below the care bar*, *Chose a tribe nobody needs while three were needed*, *Chose a tribe outside their
stage of life*, *Changed their pick after seeing the results*, *Fewer than three good options were available*, and whether they started by
writing their own goal before seeing the results.

It is shown to a **pastor or director at once**. To any other reviewer it appears **only after they have scored the application themselves**, so it cannot steer a score.
It is a note for the conversation. It does not enter the Leader Readiness Score.

## The leaders we already have (the quiet run)

*Admin → Leader pipeline → Tribe fit → Look at the leaders now* reads each approved leader's saved application answers and files which tribes
could suit them next season. **Nobody is told and nothing about them changes.** It is done once for each model. A leader then sees, on their
Tribe Card page, **Tribes you could lead next season** (up to three; never a stretch) with the reasons and a line saying their tribe this season
does not change. It is something to talk about with a pastor.

## Switching it on

The switch refuses to move to **On** until all of these hold, and says which is missing:

1. A model is approved by the pastor.
2. At least one tribe card is signed off whose goal and community are live (see TRIBE-CARDS.md).

The **Open door** preset turns it on only when both are true, and says so when it does not; **Full process** always leaves it off.
Switching it **off** at any time puts the application exactly where it was. Applications already sent keep what they chose.

## Rules that never change

- A pastor decides every application. Thresholds 75 and 60 do not move.
- The comparison reads only saved answers. It writes no score to an application, and the Leader Readiness Score has no new part.
- A leader is shown only what a leader may see (`leader_fit_applicant_view`). The page reads that answer through a list of allowed fields,
  so anything the database might add later cannot reach the screen.
- If the settings cannot be read, it behaves as off.
- Every choice, model proposal, approval and quiet run is recorded; the owner, if they ever do any of it, is shown only as "an administrator".

## What it cannot tell you

It does not know whether someone is a good leader. It says how closely their answers fit a card. A high match with an unreadable application
is still an unreadable application, and a low match can be exactly right for a leader who feels called to the harder tribe. The weights are
judgement calls the pastorate owns; change them with a new version, not by arguing with the numbers.

## Where it lives

- Database: `20261220000100_leader_fit.sql` (engine, model, runs, quiet run), `20261221000100_leader_fit_screen.sql` (ready check, the send
  gate, next-season tribes, the Admin status). Functions begin `leader_fit_`.
- Website: `src/lib/leaders/fit.ts` and `fit-panel.ts` and `fit-admin.ts` (read the database's answers), `src/components/leaders/FindTribe.tsx`,
  `TribeFitPanel.tsx`, `NextSeasonTribes.tsx`, `src/components/admin/TribeFitBoard.tsx`.
- Tests: `tests/db/leader-fit.test.ts`, `leader-fit-screen.test.ts`, `leader-fit-reference.ts`; `tests/unit/fit*.test.ts`,
  `find-tribe-steps.test.ts`; journey `e2e/journeys/23-find-tribe.ts`.

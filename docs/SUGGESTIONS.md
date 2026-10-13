# The Companion: how the member form suggests answers

The form used to suggest a community and a goal from one sentence the member wrote, by asking an AI service. That worked only
when the member had agreed to the AI service, had written a sentence, and the service answered inside a few seconds. For
everyone else the form was blank.

The **Companion** replaces that with a reader that lives in the member's browser. It works for every member, with or without
the AI service, and it gets sharper with every answer. The AI service is now an optional extra that can only add to what the
Companion already shows.

Nothing about the questions changed. Only the suggestions did.

## What a member sees

| Screen | What the Companion does |
| --- | --- |
| Welcome | One line saying a helper on the phone suggests answers, says why, and can be turned off. |
| Season story | Starting sentences written for the member's age group (and for members abroad). Tap one, make it yours. As soon as the member writes, **chips** appear live ("Own business", "Young children", "Growing a business"). Each has a ✕ for "not me". Three dots fill as it learns more, and a line says what to mention to sharpen the suggestions. |
| We heard… | Work, field, relationship and children are ticked from the member's own words, each marked **Picked for you** with the member's words as the reason ("You wrote “I run a small provisions shop”"). A fainter hint gets a ✦ but is not ticked. **Why this?** lists what it went on. **Not this one** takes it back, and it is never offered again. |
| Community | The best fit is picked, with a reason and up to two other good fits beside it. Only once the member has confirmed the "We heard…" answers does a pick become strong enough to be filled in, so a shop owner who is also a mother is shown both communities until she says which she is. A second choice is suggested too. |
| Walk with God | A card offers "Use this" if the member said where they are. It is never filled in. |
| Goal | The same, for the goals of the community chosen. If the community changes, the goal is chosen again. |
| In twelve weeks… | Three "By week 12…" pictures written for the chosen goal, to start from. A card offers a score on the 1 to 5 scale if the member said where they are. |
| How and when | Members abroad are set to meet online, and the screen says why. Meeting times are ticked, and timed around small children when the member has them. |
| This or that | A gift in a group is picked from the member's words. A ✦ marks the side of a this-or-that pair the Companion thinks fits, and **Use my suggested taps** takes them all in one go. Pairs are never filled in without a tap. |
| Anything you would like us to know | A card offers "Use this" for leading a tribe if the member said so. Private notes are never read or suggested. |
| Review | Every answer the Companion filled in and the member kept is marked. |
| Done | "Your Companion filled in N answers for you. You kept M and changed the rest." |

A member can switch suggestions off from the story, "We heard…", community and "This or that" screens. The choice is kept on that
phone. When it is off nothing is read, suggested or filled in.

## The rules that keep it honest

1. **A pick is the Companion's only until the member touches it or moves on.** After that it is theirs and never changes under
   them. If better information arrives while the screen is open (the member edits the story), a pick the member has not touched
   may change. One they have touched does not.
2. **Only the member's own answers count as "confirmed".** Anything the Companion filled in is not fed back into itself, so it
   cannot talk itself into a stronger pick.
3. **It fills in only when it is clearly ahead.** The leader of a list is "sure" only when its score is high and at least 3.5 ahead of the
   next. Otherwise the choices are shown, each with a reason, and nothing is chosen.
4. **Painful things are never guessed.** Widowed, separated, the end of a marriage, burnout and the like may nudge which community or
   goal is listed first (so Marriage & Relationships offers "rebuild after a relationship ends"), but are never shown as a chip,
   never quoted back and never ticked. The member finds the gentle option in the list.
5. **Gender is not used.** It says nothing reliable about someone's work, marriage or goals.
6. **A wish is not a fact.** "I want to start a business" is a topic, not "Own business". "Not married" is only a faint hint, since
   it could mean single, divorced or widowed.
7. **Corrections teach it.** Removing a chip, "Not this one", or choosing something else after a pick makes it listen less to the
   words that led there. This lasts for that visit only.
8. **Young people's words are never read**, not even on the phone. Their answers still get the plain rules (meeting times).
9. **Support chips and the care and leader notes are never read, suggested or logged.**

## Where it lives

Everything that decides anything is plain TypeScript with no network, in `src/lib/companion/`:

| File | What it holds |
| --- | --- |
| `traits.ts` | The vocabulary: one small thing it can learn ("employed", "preparing for marriage"). `chip` is the short label shown, `phrase` is how it says the trait back, `tender` marks painful or private ones. |
| `lexicon.ts` | The cues: patterns that turn words into traits, including Nigerian English and Pidgin ("I dey work for bank", "small small business", "get two pikin"). Each has a weight and may be switched off by a nearby "not", "never", "want to", "hope to". |
| `profile.ts` | `buildProfile`: what is known about one person right now, from their answers, their words and a very weak guess from their age group. Answers override words. |
| `rank.ts` | How well each community, goal, gift, time and this-or-that pair fits (`COMMUNITY_AFFINITY`, `GOAL_AFFINITY`), how sure that makes the pick (`THRESHOLDS`), and the reason in the member's own words. |
| `blend.ts` | Adds the AI service's picks to the Companion's own: agreement raises a pick, a pick only the service found is added as "likely", and its reason replaces ours. |
| `plan.ts` | `computePicks` (what each screen shows) and `fillPlan` (what may be filled in, and who owns each answer). |
| `sentences.ts` | The starting sentences by age group and the "By week 12…" pictures for each seeded goal. |

The browser side is `src/components/intake/useCompanion.ts` (state, learning, the quality log) and
`src/components/companion/Companion.tsx` (the pieces on screen). The form's own screens use them.

## The AI service

Still optional, still only with the member's agreement, still never for a young person. It is asked at three moments, so the
answers are usually back before the screen opens:

1. When the member leaves the story: community, gifts, and the "We heard…" answers.
2. When they leave "We heard…": community again, now told what the member confirmed (work, field, relationship, children), as short
   `<known>` lines. Painful options are never sent (`ai: false` in `options.ts`).
3. When there is a community: goals for that community, again with the confirmed facts.

The service can raise or add a pick, never remove one. If it is slow or fails, the Companion's own picks are already on screen.

## The quality log

Each finished form records, in `member_profiles.ai_assist`, ids only: what was shown, what was chosen or kept, where the
suggestion came from (`via`: engine, ai or both) and whether the Companion filled the answer in before the member touched it
(`auto`). No words, no quotes, nothing from the private notes. The existing Insight report's "Understand people" table reads it
and shows, for each question, how often what was suggested was kept. Two things to remember when reading it:

* a pick the Companion filled in and the member left alone counts as kept, so the rate for `auto` questions is flattering. Look at
  the questions where `auto` is rarely true, or at how often a filled answer was changed, for the harder truth;
* meeting times are rule-based, ticked for everyone, and are excluded from the rate.

## Tuning it

The office can add communities and goals. A community or goal the Companion has no affinity table for is matched by the words in its
name and description against the words the member wrote (stems, so "grow" matches "growing"). Such a match can put the item
among the good fits when the member used two or three of its words, but it can never be "sure", so it is never filled in
for anyone. To give it a table of its own, and so let it be picked with confidence:

1. Add the slug to `COMMUNITY_AFFINITY` or `GOAL_AFFINITY` in `rank.ts`, with the traits that point to it and how strongly (3 is a
   clear sign, 1 a faint one).
2. Add a story to `tests/unit/companion.test.ts` that should lead to it, and one that should not.
3. If members say things the cues do not catch, add a pattern to `lexicon.ts` and a line to the "reading a story" tests. Test the
   near misses too ("I have a cousin at the school" must not read as running a school).

`npx vitest run tests/unit/companion.test.ts` runs the 65 tests that guard all of this, including one that reads the seeded
communities and goals from the migration and fails if a new seeded one has no affinity table.

## What it does not do

* It does not store anything about how it read a member. The profile is rebuilt from the answers on every screen, and what it
  learned from corrections is forgotten when the page closes.
* It does not send anything anywhere. Only the optional AI requests above leave the phone, and only if the member agreed.
* It does not decide. Every answer it fills in is marked, explained, and one tap from being changed.

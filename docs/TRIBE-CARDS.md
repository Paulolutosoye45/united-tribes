# The 100 ready-made Tribe Cards

Every goal a leader can run has a ready-made card: who it is for, the three Success Picture lines (Loving God, Loving Others, Loving Life), the
week-12 outcome, three weekly ideas, a guardrail, the life stages and meeting rhythm that suit it, and three things **only the pastorate sees**:
what the group asks of its leader (four numbers, 0 to 3, for structure, connection, teaching and doing), a note on who leads it well, and
whether the subject is **sensitive**.

There are **100 cards in 11 communities**. 23 belong to goals that are already live; **77 are new**. All 100 are written in full and load as
drafts. **Nothing reaches a member or a leader until a pastor or director signs a card off.**

## Reading and signing off (Review leaders → Ready-made cards)

`/review/templates`, as the **pastor** or a **director** (an **administrator** can read and edit, not sign).

- The top shows how many cards are signed off, waiting, sensitive and retired.
- Each community is a box with a bar and its count. **Sign off the N waiting** signs off every unsigned, non-sensitive card in that community
  at once, after showing the list and saying it is recorded with your name. **Read the N cards** opens them one by one.
- A **sensitive** card is never in a community sign-off. Open it, read it, and tick *I have read this card, and it is right for a sensitive
  subject* before the button works.
- Open a card to edit it. Saving a signed-off card takes it **back to waiting** until it is signed off again, as a new version. A card that
  still has the words *To be written by the pastorate* in it cannot be signed off.
- **Retire** takes a card (and its goal) out of use. Nothing already chosen is removed.
- **Download the review sheet** (`/review/templates/sheet`) gives every card in one spreadsheet, in the order of the page, with the hidden
  columns, a column for **Your decision** and **Notes**, and where each card stands now. The file in the zip, `tribe-cards-100-review.csv`, is the same
  sheet before anything is signed off. It opens in Excel and in Google Sheets.

## What signing off does

- **For the 23 goals already live**: the card is tied to its goal. The goal's title, community and weekly ideas stay as they are (the card
  carries the same three ideas word for word, and the migration refuses to load if any differ), and the hidden profile is added so the
  compatibility test can use it.
- **For the 77 new cards**: the goal is **created at that moment**, with its three weekly ideas, in one step. Until then the goal does not exist,
  so nobody can choose it, and the existing rule that every goal has exactly three ideas is never broken. A community never goes above ten goals.
- Each sign-off is recorded with the signer's name.
- The Companion (the member-side guide) ranks the 77 new goals as well as the first 23: `src/lib/companion/goal-extras.ts` holds the life
  facts that suggest each one and the "by week 12" sentences.

## What a leader sees

On *Your Tribe Card*, a leader whose tribe is about a goal with a signed-off card sees the card under **A ready-made card for this goal**: the
public parts only (who it is for, the three lines, the week-12 outcome, the ideas, the guardrail). **Start from the ready-made card** fills the
three lines if they are empty and **never overwrites a leader's own words**. The hidden profile, the sensitive flag and the note on who
leads it well are not sent to a leader at all, not merely hidden.

The same fill is used when the owner appoints a leader (see GOD.md).

## Rules that never change

- A card is a draft until a pastor or director signs it off. Writing, editing and reading are not signing.
- Sign-off by community never includes a sensitive card.
- No goal is deleted. Retiring a card switches its goal off; signing it off again switches it back on.
- A goal the office switched off in the catalogue stays off when its card is signed off; the page says to switch it on there first.
- A leader or member never receives the hidden fields.

## Where it lives

- Database: `20261219000100_card_templates.sql` (table, functions `card_template_*`), `20261219000200_card_templates_seed.sql` (23 cards),
  `20261219000300_card_templates_seed_new.sql` (77 cards). The same 100 are in `tribe-cards-100.json` and `seed_tribe_cards.sql`.
- Website: `src/lib/cards/templates.ts`, `src/app/(app)/review/templates/`, `src/components/cards/TemplateBoard.tsx`, `TemplateEditor.tsx`.
- Tests: `tests/db/card-templates.test.ts` (50), `card-templates-all.test.ts` (signs all 100 off: 100 goals, 300 ideas, no community over ten);
  `tests/unit/card-templates.test.ts`, `goal-extras.test.ts`; journey `e2e/journeys/22-card-templates.ts`.

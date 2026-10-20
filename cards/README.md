# The 100 Tribe Cards, as files

* `tribe-cards-100-review.csv` is the sheet the pastorate reads before anyone signs a card off. It has a column for each decision and a column for notes. Open it in Excel. (The same sheet downloads live, with where each card stands now, from **Review leaders → Ready-made cards → Download the review sheet**.)
* `tribe-cards-100.json` is every card in full, hidden columns included, as data.

The cards are loaded into the database by the migrations `20261219000200_card_templates_seed.sql` and `20261219000300_card_templates_seed_new.sql`, as drafts. Nothing here is loaded separately, and nothing reaches a member or a leader until a pastor signs a card off. See `docs/TRIBE-CARDS.md`.

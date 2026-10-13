# The first check on leader applications

**What it is for.** A written answer on the leader application used to count once it had 20 characters of anything, and two
people then scored a rubric on whatever was there. Applicants typed random words into the boxes and the system scored them.
The first check reads the written answers so a pastor's time goes to real applications. It does three things only:

1. **Checks each written answer as the person writes it** (the "quick check"). Keyboard mashing, repeated words, a pasted
   question, instructions to the checker, or an answer about something else get a kind note on that screen.
2. **Scores the finished application** against the six pastorate calling questions, with the applicant's own words as proof
   for every score. That score stands in for the first human calling pass at the same 30% weight.
3. **Decides what happens next:** passes it, asks the applicant to add to specific answers, or holds it for a person.

**It never turns anyone down.** The AI proposes; the database decides; a pastor decides about people, as before. There is no
"not approved" message from a computer anywhere in this feature.

## The switch (Admin → Leader quality)

Pastors and the director can use it. The director alone can change the consent settings.

| Mode | What happens | Who notices |
|---|---|---|
| **Off** (how it ships) | Nothing runs. Applications work exactly as they did before. | Nobody. |
| **Recording only** (shadow) | New applications are read and scored behind the scenes and everything is recorded. Nobody is held up and nobody is told. Applicants see the new consent sentence. | Only the pastors, on this page and on each application. |
| **On** | Answers are checked as people write them. An application that passes goes straight on; one that does not is sent back with a kind note, or held for a pastor. Referee links and interview invitations wait for a passed first check. | Everyone, as described below. |

**Recommended order:** Off → Recording only for one to two weeks → look at "What the recording-only run found" and run the
comparison script (below) with a real key → set the thresholds → On.

Switching **On** takes in applications that were already sent and that no reviewer has scored yet. Applicants who agreed to the
earlier wording are asked to agree to one new sentence first (see Consent). Applications a reviewer has already scored stay with
people: the AI never replaces a person's score. Switching **Off** stops checking, and applications already held stay held until a
person reads them. The switch, and every threshold change, is recorded with the person's name.

## What each person sees

**The applicant** sees only kind notes, never a score, a flag or a quote:

- On the apply screens, a note under an answer ("Not quite yet…") with how many tries are left. After the last try the answer
  goes through anyway, so nobody is stuck on a question, and the application is marked for a person to read.
- After sending: "We are reading your application" (a few minutes), then one of three outcomes on the Lead page and by
  by message (where the applicant has a message channel): *passed* (referee links open), *a little more would help* (one note per answer, with **Add to my answers**),
  or *a person is reading it* (nothing to do).
- When asked to add to answers they get up to two updates, with a gap between them (24 hours by default). They can always say
  **Hand it to a person**. An update goes through the same quick check, so an answer cannot be swapped for filler.

**Pastors and coaches** see a **First check** card on each application: six scores each with the applicant's own words that
justify it (the app confirms every quote really is in the answer and drops any that is not), the flags, "Let through after
several tries" fields, and "Same words as…" when another application uses the same sentences. Earlier versions of rewritten
answers are kept. A coach sees the card only **after scoring the application themselves**, so it cannot steer their score. A
pastor can **let a held application through** (with an optional note, recorded with their name; the applicant is then told their
referee links are open) or **ask the applicant to add to an answer** (in the
pastor's own words; the applicant never sees the reading).

**The held list** (Admin → Leader quality) shows who is waiting for a pastor, longest first, with tiles for held, with the
applicant, being read and passed. It warns if an application has waited over an hour for its reading, or if readings failed in
the last day.

## States

`not_applicable` (the first check does not apply: people scored it, or it predates the switch) · `consent_needed` ·
`checking` · `clear` · `strengthen` · `held` · `cleared_by_person`.

An application is **held** when any of these is true: an instruction aimed at the checker; copied or templated text; the same
words as another application or used twice in one application; a quote the AI gave that is not in the answer; an answer let
through only on the last try; a poor fit (no track, community or goal); confidence below the bar; or the AI could not run
(no key, outage, ten failed attempts). Failures **never** pass an application: they hold it for a person.

## Thresholds (all editable on the page, from the next application onward)

| Setting | Starting value | Meaning |
|---|---|---|
| Clear needs a mean of | 2.5 of 5 | Mean of the six scores must reach this |
| No written question below | 2 | A written answer scoring lower asks the applicant to add to it |
| Minimum confidence | 60% | Below this the AI's own score is not trusted and a person looks |
| Minimum words per answer | 8 | Words, not characters |
| Tries per answer | 3 | Then it goes through and is marked for a person |
| Updates after sending | 2, 24 hours apart | |
| Audit share | 10% | Share of passed applications a person also scores, to compare the AI with people |

The starting values are guesses. **Set them from the recording-only results**, not before.

## Consent and the lawyer check

Two wordings exist (`src/lib/leaders/consent.ts`):

- `2026-10-l1`: what applicants agreed to before this feature. It does not mention an AI service.
- `2026-12-l2`: adds that a computer program (an AI service) may read the written answers, with phone numbers and email
  addresses removed and without the applicant's name, to check them and give the panel a first score; that a person makes every
  decision; and that no application is turned down by a computer.

The second wording shows from **Recording only** onward, so agreement is collected before anything is read. The database sends
answers to an AI service **only for applicants who agreed to the new wording** (or, if you set it, an older wording your lawyer
says already covers it: Thresholds → consent settings, director only).

> **Have a lawyer check the `l2` sentence against the Nigeria Data Protection Act before real applicants see it.** If they
> change the words, change the text in `consent.ts` and bump the version label. Do not edit the text under the same label.

What the AI service receives: the five written answers (personal details scrubbed; at most 1,600 characters each), the track,
community and goal names, and the walk rating. Not the name, contact details, referees or any other application. Answers are
fenced as data, so instructions inside them are not obeyed.

## What must be set on the site

| Setting | Why |
|---|---|
| `WORKER_TOKEN` | Already set for messaging. The checks use the same sending service. The switch page refuses to turn on without it. |
| An AI key (`ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` with `AI_PROVIDER=openai`) | Without one, only the plain checks run and every application is held for a person. The switch page refuses to turn on. |
| The heartbeat (`/api/cron/tick`, every few minutes) | Does the reading. Already needed for messages. |
| `AI_PROVIDER=mock` | **Rehearsal only.** A word-matching stand-in: it proves the plumbing, not judgement. The switch page warns when it is in use. |

## Be honest about the limits

- **The offline stand-in cannot judge.** It reads word patterns. It lets well-spelled off-topic text through the quick check.
  Never use it for real applicants.
- **A model can be wrong in both directions.** It may under-score honest answers in Pidgin, Yoruba, or brief English, or over-score
  smooth boilerplate. The fairness bar is that good applications in those styles clear.
- **A first reading is not a verdict.** It saves reading time. It is never shown to the applicant and never the final word.
- The gold set of 14 applications (70 answers) is **made up**. Have a Yoruba speaker and a Pidgin speaker read their cases and
  replace any that read wrong. Add real, anonymised applications from your own pastors' decisions as they accumulate.

## Trying a model before the switch moves

```
npm run bakeoff:leaders -- --providers anthropic,openai --runs 3     # needs the keys in .env.local
npm run bakeoff:leaders -- --providers mock                          # offline: checks the plumbing only
```

It runs the gold applications, prints what each model would have done next to what a pastor would accept, and checks the
starting bars: **nothing that must not pass is passed** (zero tolerance), at least 80% of the good applications clear, 85%
agreement with a pastor's accepted outcomes, 95% of quotes found in the answers, under 2% failures, and 95th-percentile time under 20
seconds. Run it again whenever the model or the thresholds change.

## Rolling back

Switch to **Off** on the page. Nothing is dropped or rewritten by this feature: the database file only adds tables and
functions, and everything it adds does nothing while the switch is Off. To remove the screens as well, deploy the previous
version of the app; the database file can stay.

## Where things are

- Database: `supabase/migrations/20261211000100_leader_ai_scoring.sql` (settings, states, checks, fingerprints, scores, jobs; the
  decision is made here, in `leader_ai_decide`).
- Library: `src/lib/leaders/quality/` (`instant.ts` plain checks · `scorer.ts` the readings · `decide.ts` the same rules as the
  database, tested to agree · `quotes.ts` evidence checking · `print.ts` fingerprints · `prompts.ts` · `mock-judge.ts`).
- Screens: apply screens (`ApplyFlow`, `ApplySteps`), `/lead` and `/lead/update`, review page (`AiScorecard`), `/admin/leader-quality`.
- Tests: `tests/unit/leader-quality.test.ts`, `tests/unit/leader-gold.test.ts`, `tests/db/leader-ai.test.ts`, browser journey
  `e2e/journeys/12-leader-quality.ts`.

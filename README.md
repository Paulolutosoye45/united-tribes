# United Tribes — Phase 7

The United Tribes small-group platform at The Covenant Nation, Iganmu. Phase 0 laid the foundation (sign-in, roles, database, assistant layer). Phase 1 added **the six-minute find-your-circle form** and a **premium, mobile-first redesign**. Phase 2 added **the Leader Portal**: apply to lead, referees, a scoring panel, interviews, and a pastor's decision. Phase 3 added **the Leader Academy and Circle Cards**: six modules with quizzes, a safeguarding declaration, two live workshops, a coach's practice sign-off, and the card a leader's circle is published from. Phase 4 added **matching**: every member sees their three best-fit circles, each with its own Degree of Compatibility, chooses one, agrees to its Success Picture and Covenant, and is welcomed by the leader. Phase 5 adds **the weekly rhythm**: a guide for each of the twelve weeks, a small step every member chooses and checks in on, the leader's two-minute log, call lists so nobody misses twice without a call, three check-ins, testimonies, and a weekly report for the pastorate. Phase 6 adds **dashboards and KPIs**: the Thriving Rate and the numbers behind it for the pastorate, the data lead and coaches; "the season so far" for each leader; and a private progress card for each member. Phase 7 adds **sign-in with a six-digit code on WhatsApp**, for people who have added their number to their account, behind a switch and a choice of two ways to deliver the code.

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, row level security).

## What works in Phase 7: sign-in with a code on WhatsApp

**The rule: one person, one account.** A WhatsApp number is *added* to an account that began with Google or an email code. It never makes an account of its own. If it could, someone who signed up by email and later tried WhatsApp would land in a second, empty account and appear to have lost their circle. So:

- **Sign-in** (`/sign-in` → "Continue with WhatsApp"): type the number (Nigerian numbers may start with 0), receive a six-digit code on WhatsApp, type it, and you are in. The screen asks the sign-in service **not** to create an account.
- **A number with no account looks exactly like one with an account.** The screen moves on to the code step either way, so the page cannot be used to find out whose number is on the platform. The code screen tells someone who is waiting for a message that WhatsApp sign-in works once the number is added.
- **Adding or changing the number** (`/profile`, "How you sign in"): the code goes to the *new* number and must be typed back before it counts, so nobody can attach a number that is not theirs. A number another person already has is refused. After a change, the old number stops working at once.
- **The number is shown masked** (`+234 ••• ••• 4567`) and is never shown to a leader, a circle or the office. It is held by the sign-in service and read from the person's own token; it is not copied into any table of ours.
- Nothing changes for Google or email sign-in. If WhatsApp is switched off, the button and the Profile card are not shown.

**Switching it on** needs three things, in this order:

1. Choose how the code is delivered (A or B below) and finish that set-up.
2. In Supabase: Authentication → Sign In / Providers → **Phone**: enable it. Leave "Allow new users to sign up" on (the app asks for no new account itself).
3. Set `WHATSAPP_SIGNIN=on` where the app runs. Until then nobody sees the button.

**A. Twilio inside Supabase (no extra code).** Choose Twilio (or Twilio Verify) as the Phone provider and set it up with a WhatsApp sender, following Supabase's phone sign-in guide. The app already asks for the `whatsapp` channel. Not yet checked: whether an *add or change* request is delivered on WhatsApp rather than as a text message depends on the provider; test it first. Option B avoids the question.

**B. Direct through Meta's WhatsApp Business Cloud API (included).** Supabase's **Send SMS hook** calls `POST /api/auth/send-code` instead of sending a text, and this app puts the code on WhatsApp.

1. In Meta's business tools: a WhatsApp Business account and phone number; an **authentication** message template with a "copy code" button, approved by Meta; a system-user access token.
2. In Supabase: Authentication → Hooks → **Send SMS** → HTTPS → `https://YOUR-DOMAIN/api/auth/send-code`. Copy the secret it shows.
3. Set `SEND_SMS_HOOK_SECRET`, `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_NAME` (and, if not `en` or `v23.0`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_GRAPH_VERSION`). See `.env.example`.

How the hook is kept safe: it does nothing without a valid signature (the scheme Supabase uses for its hooks) made with the secret, within five minutes, so an old request cannot be replayed; it refuses a large body before reading it; the code and the full number are never written to a log (only the last four digits and Meta's numeric reason); a failure is answered in the shape Supabase expects with no detail. Another carrier or provider is one more small class next to `src/lib/whatsapp/meta.ts`, chosen by `WHATSAPP_PROVIDER`.

**Database change** (one migration, `20261129000100_whatsapp_signin.sql`): a new account with no email address is refused with a readable reason instead of an obscure constraint error. This also means nobody can make a phone-only account by calling the sign-in service directly.

**Not checked against real services (Phase 7).** I could not reach Meta, Twilio or a real Supabase project. What is verified is our own side: the signature check, reading the hook's request, the exact message body we build, the screens and flows against a stand-in. Three things to confirm on a real project before launch, in this order: (1) a WhatsApp sign-in code arrives and works; (2) *adding a number* sends the code to the new number; (3) *changing* a number sends it to the new number, not the old. Meta's template format for the copy-code button (the code appears in the message body and again in the button) is as documented by Meta's partners; confirm it against your approved template. If Supabase's hook payload names the new number differently on your version, `src/lib/whatsapp/payload.ts` is the one place to change.

## What works in Phase 6: dashboards and KPIs

Every number is worked out from the live records when someone opens the page, so it is always current. There is no stored copy to drift.

**Who sees what**

| Page | Who | What |
| --- | --- | --- |
| `/dashboard` ("Results") | Admin, director, pastor, data lead: the whole church. Coach: only their own circles | The Thriving Rate, the weekly rhythm, every circle's verdict, and (church only) the journey funnel, supply and demand, tribes, matching accuracy, care and testimonies |
| `/lead/progress` ("The season so far") | The circle's leader, assistant, coach, pastor, director | Meetings held, attendance, steps done, week by week, and a verdict on the circle once it has five or more members |
| `/circle` ("Your season so far") | Each member, for themselves only | Meetings attended, steps, and how their own Success Picture has moved |

The care lead has no dashboard (they have the weekly report). Tribe champions have no tribe scope in the data, so they have none either: see the limits below.

**How the numbers are defined.** All the thresholds sit in one database function, `kpi_targets()`, and are changed by a new migration.

- **Thriving**: a member who has attended at least two thirds of the meetings (8 of 12) **and** whose latest belonging answer is 4 or 5. While a season is running, it is measured only after three weeks have passed, and attendance is compared with the share expected so far, so nobody is called "not thriving" in week 1.
- **Thriving Rate**: thriving members divided by active members. The target is **85%**. Released members are not counted.
- **Success Picture score**: the three 1 to 5 answers (God, others, life) added together, 3 to 15. A member is **gaining** when their latest check-in is 2 or more points above their first (week 1).
- **A circle is effective** at the end of a season when at least 80% of its members are thriving **and** at least 70% of those with two check-ins are gaining. While the season runs, the verdict is *on course* (80% or more thriving), *close* (60% or more) or *at risk* (below 60%); *too early* before three weeks have passed, and *before* until it starts.
- **Matching accuracy**: how a member's Degree of Compatibility lines up with how they went, and which rank of recommendation they chose. The weights are marked ready to retrain after **300** finished placements, not before.
- **The funnel**: started the form, finished it, were shown circles, chose a circle, came to a meeting, and are thriving.
- **Supply and demand**: seats and people wanting a place, by life-stage track and tribe, with the unmet number. This is what tells you where to recruit the next leader.

**Privacy rules built in**

- A group of fewer than **5** is never broken out (tribe, track or any rate by a small cell). An average of belonging needs at least **3** answers.
- A leader sees the circle-wide verdict only with 5 or more members. The per-member rows show meetings and steps only. **A member's belonging and Success Picture answers are never shown to their leader.**
- A member sees only their own progress. Nobody else's numbers appear on their page.
- A coach sees only circles they coach. The functions check this in the database, not just on the page.

**Not in Phase 6**: history snapshots (see limits), email or WhatsApp reports.

## What works in Phase 5: the weekly rhythm

Weeks count from the season's start date (Lagos time). Week 1 is the first seven days; the season is `weeks` long (12).

**For a member** (`/circle` once the season has begun; Home leads with "Your week")

- **The week's guide**: a title, a passage reference, the big idea, three questions to come ready to talk about, a practice and a prayer. Earlier weeks can be read again (`/circle?week=3`).
- **A step, in a sentence.** "When ___, I will ___." Three to 140 characters each, the current week only. The member can change it until they check in. The app tidies "When…" and "I will…" if they type them, and gives an idea for the week.
- **A check-in on the step**: done, partly or not yet, plus a line for themselves. It opens on the Friday and closes the Tuesday after. It needs a step. Once answered it cannot be changed. "Not yet" is allowed and treated kindly.
- **Three short check-ins** (weeks 1, 6 and 12): how much they belong, and how close the circle is to each line of its Success Picture (God, others, life), 1 to 5. They stay open for 14 days. A belonging answer of 1 or 2 opens a follow-up for the leader.
- **The Success Picture can be refined in weeks 1 and 2.** The leader saves the final wording and members see it. The words each member agreed to when they joined are never changed.
- **Testimonies** (`/circle/testimony`): 20 to 600 characters, shared with the circle or the whole church, credited by full name, first name or no name. A leader reads it first; for the church a pastor reads it too. The member can withdraw it. If it is not shared, only the author sees the leader's note.
- **Nudges** on Home and the week page say the one next thing to do. They are in the app only.

**For a leader** (`/lead/week`, "This week" on the Lead page and Home)

- **The meeting plan**, 75 minutes in five parts (arrive and check in 10, the Word 15, talk it through 25, choose the step 15, pray 10), and a word for the leader. A leader can read week 1 before the season starts.
- **People to call first.** Two meetings missed in a row, two check-ins of "not yet", a belonging answer of 1 or 2, or a concern the leader raises, each put one person on the list with a ready-written WhatsApp message (only if the member said yes to WhatsApp). "I spoke with them" closes it. "I could not reach them" counts the attempt, and after three it goes to the care team. "They need more help than I can give" goes straight to the care team.
- **The two-minute log.** Did the circle meet, who was here, away or excused, and one line about the week. A leader can log any week that has started until 13 days after it began. A pastor or director can correct a log at any time.
- **What the leader does not see.** Whether someone did their step, never what the step or their reflection said. Belonging averages show only when three or more members have answered. A member's pulse answers are not shown to the circle.
- **Celebrations**: birthdays (if given), everyone who has been to every meeting, anyone who has done their step three weeks running.

**For the care team, coaches and pastorate** (`/review/rhythm`, "Weekly report")

- A **weekly report for each circle**: attendance, whether it was logged, steps done, people to call, belonging averages when there is enough to show, and a status: on track, keep an eye, needs attention, not logged yet, or upcoming. It is computed when read, so it is always current.
- A **care queue** (care lead, pastor, director) of follow-ups sent to the care team, and any older than three days. The care lead records the call and closes it.
- **Testimonies for the church** for a pastor or director to approve. A coach sees only their own circles.

**The twelve weekly guides are drafts** for the pastorate: begin with the end in view (Habakkuk 2:2–3), hear Him every day, pray with expectation, better together, honest words, halfway, time and money, work as worship, courage for the next step, serve someone, give thanks and tell it, finish well and send. Passages are references only; no scripture text is copied. Change the wording in `supabase/migrations/20261115000200_rhythm_content.sql` (before it is run) or with an update.

**Not in Phase 5**: dashboards and KPIs (added in Phase 6), WhatsApp sign-in (added in Phase 7), anything emailed or sent on WhatsApp.

## What works in Phase 4: matching, choosing and onboarding

**For a member** (`/circle`, "My circle" in the menu; Home leads to it)

- **Three circles, each with its own percentage.** Once the form is finished, the database ranks every published circle against the member and shows the best three that score 60% or more. Each card shows the Degree of Compatibility (a ring, with the words Excellent, Strong or Good), three plain reasons ("Everyone here is working on the same goal as you", "It meets on your evenings"), the leader's first name and a line of their story, when and where it meets, seats left, and the circle's Success Picture. The percentages are per circle, so two circles can both score high.
- **Hard rules first.** A circle is never shown if it is for another stage of life, for the other gender only, full, not approved, led by someone not yet certified, on a day the member cannot meet, in person in a zone the member cannot reach (or abroad), or the member's own circle.
- **Choose and commit** (`/circle/choose/…`): the Success Picture, the Circle Covenant (four promises) and one tick. The seat is locked in the database the moment the member agrees, even if two people tap the last seat together. The covenant text the member agreed to is stored with their seat.
- **Placement view**: the circle, a "what happens next" list (the leader welcomes you, join the WhatsApp group, your first meeting), what they agreed to, and a way to change their mind until the season starts.
- **No fit yet?** Fewer than three good circles is said plainly. The member can join the Starter Circle list, and the gap (stage of life, tribe, goal, mixed or single-gender) is logged for recruiting.
- Withdrawing matching consent erases the member's results and demand record.

**For a leader** (the top of the Circle Card page, once the card is approved)

- **A roster of members who chose the circle:** first and last name, a tap-to-chat WhatsApp button with the welcome message ready (only if the member said yes to WhatsApp), a "welcomed" toggle, and the seat count.
- **The WhatsApp group invite link** (checked to be a real `chat.whatsapp.com` invite) and **the first meeting date**. Members see both on their page.
- A leader sees only the people in their own circle (an assistant leader too). A coach, pastor or director can open any roster.

**For the office** (Admin, "Matching and placement"): who is placed, waiting, seats open, who needs a leader, which card members chose (first, second or third), the average compatibility, and where leaders are needed (stage of life, tribe, goal and circle mix, largest first).

**How the score works** (a first version chosen by judgement; weights live in the `match_models` table so the office can change them without code)

| Part | Weight | What it compares |
| --- | --- | --- |
| Season Goal | 30% | Same goal 100%; a goal in the same family 60%; otherwise 20% |
| Stage of life | 20% | A hard filter, so every circle shown is a full match on this |
| Tribe | 15% | Same tribe 100%; a different tribe whose goal is in the member's goal family 30%; otherwise 10% |
| Place | 10% | Online or the same zone 100%; a neighbouring zone 60%; otherwise 20% |
| Leading style | 10% | Half: how well the leader's way of leading suits the member's six "this or that" answers. Half: whether adding the member keeps the circle's mix of quiet and lively people balanced |
| Rhythm | 10% | Whether the format is the one the member named (80% if they said "either" and it differs) and whether they gave meeting times |
| Faith journey | 5% | 100% when few in the circle are at the member's stage of faith, 60% when many are |

**Circle health is a rule, not a score.** A circle drops out of someone's list if adding them would give it more than two members who asked for heavy support, if it could no longer reach two established believers with the seats left, or if it could no longer have both quiet and lively members. A circle with no seats left is never shown. The weights live in the `match_models` table, so the office can change them without code. Retrain them from real outcomes only after about 300 completed placements: until then there is not enough data to tell a better formula from a lucky one.

## What works in Phase 3: the Leader Academy and Circle Cards

An approved leader is not yet a ready leader. This phase turns one into the other, and gives each ready leader a page members can choose from in Phase 4.

**For a leader or assistant leader in training** (`/lead/academy`, linked from Home and "Lead")

- **Six modules, each a short lesson and a quiz:** the why, the Success Picture, hosting the 75 minutes, knowing your people, care and safeguarding, using the platform. 80% passes, five tries a day, and the explanations of what was missed are shown at once. The answer key lives in a table nobody can read from the app: the database marks the quiz.
- **A safeguarding declaration** of eight plain promises, signed by typing a first and last name. It opens only after the care module is passed. The wording version is stored with each signature.
- **Two live workshops** (a practice workshop and a commissioning workshop), booked from dates the office adds. One booking per workshop, seats counted, cancel up to 24 hours before.
- **A practice session** marked by a coach: ready, or not yet with a note the leader reads.
- **Certification is automatic.** Modules, declaration, a "ready" practice session and, for a leader, an approved Circle Card. Nobody has to click "certify", and nobody can certify around a missing condition. Workshops are tracked and shown but are not a gate, as in the blueprint.

**The Circle Card** (`/lead/circle`): the page members choose from. Circle name, who it is for (mixed, women, men), seats (4 to 12), the tribe and Season Goal it is built on (taken from the approved application and locked), the leader's story with the goal, the day, time, format and zone, and a draft Success Picture (Loving God, Loving Others, Loving Life). It saves as you type, shows a live preview of what members will see, offers only meeting times that avoid rush hour (weeknights from 7:30 pm, Saturday mornings, Sunday afternoons and evenings), and cannot be sent until the Success Picture module is passed.

**For the pastorate** (`/review`, tabs for Applications, Interviews, Academy and Circle Cards)

- **Academy:** every approved leader and where they stand on the four conditions, the workshop registers (Came or Absent once a workshop has started), a form to mark the practice session, and the dates office staff add.
- **Circle Cards:** a queue, then each card with the leader's training status. A pastor or director approves it (published) or asks for changes with a note the leader reads; the card is locked while it is being read.
- **Assistant leader pairing:** suggestions ranked by how well the assistant's way of leading complements the leader's (70% of the fit), then track and tribe (15% each). The pastorate pairs or unpairs. Pairing a style that matches the leader's own is allowed, and the reason is stated.
- **Coach assignment** by a pastor or director, with each coach's circle count shown.
- **Admin** shows the Academy funnel (in training, certified, cards waiting).

**Drafts for the pastorate to approve.** The lesson text, the 35 quiz questions, the eight safeguarding promises and the practice-session guidance are drafts. Module 1 deliberately leaves the church's official vision and mission wording to the pastorate. The care module names 112 as Nigeria's emergency number and refers to the Nigeria Data Protection Act 2023; have counsel review both. The content is in `supabase/migrations/20261101000200_academy_content.sql` (generated and safe to re-run: it adds nothing that already exists), and the declaration is in `src/lib/academy/declaration.ts`.

## What works in Phase 2: the Leader Portal

Circles need leaders before members can be matched, and leaders are chosen and trained first. This phase covers the choosing.

**For someone applying** (`/lead`, "Lead a circle" in the menu)

- **Seven eligibility questions first** (six months in the church, Foundation of Faith done, serving now, 21 or older, 75 minutes a week plus about 10 hours of training, safeguarding course and code of conduct, keeping confidences). A "not yet" gets kind, specific advice and other ways to serve, and the application is not kept.
- **The application**, about fifteen minutes, one question per screen: WhatsApp number, stage of life, tribe, the Season Goal they could lead and whether they have reached it or are in it now, four written answers (their story with the goal, why they want to lead, a time they walked with someone, what could get in the way), their walk with God from 1 to 5 with a note, six situations (choose the best and the worst response), six "this or that" style pairs and "I lead best by…" (used only to pair them with an assistant leader), and two referees, one a pastor or unit head. Save and resume, speak instead of typing, a review screen with "Change" on everything.
- **A status page** with a five-stage tracker (application, references, panel review, interview, decision). They get a private link per referee to send by WhatsApp or copy, choose and cancel an interview time, withdraw and delete before a decision, and read the result with the pastor's note.

**For referees** (no sign-in): a private link that works once and expires in 30 days. Four ratings (reliability, warmth, trustworthiness, spiritual maturity) and one question: any concern about this person leading others? A concern goes to a pastor and the applicant never sees it.

**For the panel** (`/review`, pastors, directors and coaches)

- A queue with tabs (to score, in review, decided, all) and four tiles.
- Each application: the written answers, the situations score, the references, and a six-question calling rubric with "what 1, 3 and 5 look like" under each question.
- **Independent scoring:** colleagues' scores and notes stay hidden until you submit your own.
- Readiness card, an "Invite to interview" button (pastor or director), an interview times page (pastor, director, admin), a five-question interview rubric, and the decision, which only a pastor makes, with a confirm step. Approving grants the leader or assistant-leader role and records who did it.
- A pastor clears a referee's concern by writing what they did to follow it up. Approval stays blocked until then.

**For the office:** Admin shows the leader funnel (started, sent, interviews booked, approved).

**How the score works** (all of this is a proposal for the pastorate to approve, in `src/lib/leaders/` and the migration)

| Part | Weight | Where it comes from |
| --- | --- | --- |
| Calling and goal fit | 30% | Two reviewers score six questions from 1 to 5 |
| Situations | 25% | Scored by the database against an answer key applicants cannot read |
| References | 25% | Average of the four ratings from both referees |
| Interview | 20% | Two panelists score five questions |

75 or more can be approved as a leader, 60 to 74 as an assistant leader, below 60 is not approved. Two gates apply whatever the score: a Season Goal is declared, and the reference check is clean (both answered, at least one a pastor or unit head, no uncleared concern).

## What works in Phase 1

**The form** (`/join`, "Find my circle" in the menu)

- Thirteen short screens, one question each, about four minutes. Age range, name, circle mix, area, a few words about the person's season, tribe, walk with God, season goal, what success looks like, when and how to meet, six "this or that" style pairs, and optional extras.
- **Assistant suggestions** (Claude or ChatGPT): from the person's own words it suggests a tribe and goals, shown above the full list with the reason ("You mentioned 'independent'"). It only picks from options the database holds, never invents one, and the person can always tap any other option or type their own. If the assistant is off, slow or fails, the form carries on with plain options.
- **Consent first.** Matching consent is required. Assistant consent is separate and optional. WhatsApp contact is a third, separate tick.
- **Save and resume.** Every screen saves as the person goes. "Finish later" or closing the tab loses nothing, and Home offers to pick up where they stopped.
- **Review, edit, delete.** A review screen with "Change" on every answer. Finished people can edit their answers or delete them from **Privacy and my data**.
- Speak instead of typing, where the phone's browser supports it (see limits).
- Teens (13–17) get a kind message and nothing is saved. Circles for them open in a later release.
- Birthday is optional, day and month only, used only for celebration. Age is a range.

**The look and feel**

- A quiet stone canvas, white raised cards, and charcoal "night" panels lit by an ember glow, in the Covenant Nation crest colours. The quartered shield is the progress meter: each of the four sections fills a quarter.
- Built for phones first: one question per screen, large tap targets, a sticky Continue bar that respects the phone's safe areas, springy taps, screen transitions, a celebration screen, light and dark mode, and reduced-motion respected. On a laptop the same form gets a side rail showing progress.
- Native inputs under custom styling, so screen readers and keyboards work. Text contrast meets WCAG AA.

**Office tools**: the Admin page now shows form statistics: how many signed in, how many finished, the typical time, how many finish under six minutes, and who is joining by stage of life and tribe. No personal details.

Everything from Phase 0 still works: Google or six-digit-code sign-in (no passwords), roles and invitations, Admin, season on Home.


## What has and has not been verified

Run in a build environment with no access to Supabase, Google, an email sender or AI providers:

| Checked | How |
| --- | --- |
| Database rules: 263 tests (own-rows-only, consent ledger, withdrawal erases data, applications, referee links, scoring, independent review, interview booking, decisions and role grants, erasure, locked-down defaults, allow-list of callable functions; Phase 3 adds the answer key staying hidden, quiz scoring and limits, the declaration, workshop booking rules, the practice sign-off, automatic certification, the Circle Card rules, pairing and coaches, and meeting-time parity with the app; Phase 4 adds the matching hard rules, scoring and ordering, hidden below 60%, demand logging, the single-seat race between two people, release, the roster and who may open it, first-name-only exposure, and erasure on withdrawal; Phase 5 adds the calendar, the step and check-in windows, pulses, the leader's log, missed-twice and not-yet-twice follow-ups, calls and escalation, the care queue, the Success Picture refinement, testimonies and who may read them, the weekly report, what a leader cannot see, and erasure; Phase 6 adds the thresholds, who thrives and who gains, the circle verdicts before, during and after a season, the minimum group sizes, what a coach, a leader and a member can and cannot read, the church-wide funnel and supply map, and released members being left out; Phase 7 adds that an account cannot begin without an email address and that adding a number later changes nothing else) | Real Postgres 17 started locally, all eleven migrations applied |
| Validation, steps, progress, roles, scoring wording, dates, redirects, assistant layer, Academy checklist and card helpers, matching wording, dashboard wording and rounding, phone numbers, the hook's signature check, request reading, the Meta message body and the hook route: 157 tests | Unit tests, with the AI providers replaced by stand-ins |
| The member form (Phase 1): 42 checks on a phone-sized screen, re-run after Phase 2 changed the shared screens | Browser run against a stand-in for the Supabase Auth and data API |
| The whole leader journey (Phase 2): 132 checks. Not-eligible branch, every application screen on a 390 px phone, save and resume, both referees on fresh links (and a used and a made-up link), coach, pastor and director accounts on a laptop scoring, inviting, adding times, the applicant booking, the interview scored, a concern cleared, the pastor approving, and the applicant seeing the result. No sideways scrolling, no browser errors | Browser run against the same stand-in, backed this time by the real Postgres with every migration |
| The whole Academy journey (Phase 3), 96 checks: a leader reads and fails then passes the first module and passes all six, signs the declaration, books and cancels workshops the office added (a date inside the hour refused), a pastor marks the register, a coach marks "not yet" with a note then "ready", the leader builds the card (locked fields, Sunday times, autosave, reload), a pastor asks for changes, the leader resends, the pastor pairs an assistant, assigns a coach and approves, and the leader is certified. A member is kept out of every page. Phone and laptop, no sideways scrolling, no browser errors | Browser run against the same stand-in |
| The WhatsApp sign-in journey (Phase 7), 44 checks: the button on a phone, a short number refused before anything is sent, adding a number in Profile (masked, the full number never shown, a wrong code refused, the right one accepted, the same number refused), signing out and in again with it to the same account with no second account made, an unknown number looking identical to a known one and failing at the code, a number held by another person refused, a number from another country, changing number (the old one stops working, the new one works), the delivery hook reachable without sign-in and answering that it is not set up, laptop layout, and the button gone when the switch is off. No sideways scrolling, no browser errors | Browser run against the same stand-in, which now imitates phone codes |
| The dashboard journey (Phase 6), 52 checks: a seeded season with circles that are thriving, close and at risk; the church dashboard for a director on a laptop (headline ring, weekly bars, funnel, supply and demand, circle verdicts, matching accuracy), the same page on a 390 px phone, a data lead, a coach who sees only their own circles, a pastor, the care lead and a member refused; a leader's season page with the verdict hidden below five members and no belonging shown; a member's own progress card; the not-yet-started and finished seasons worded correctly. No sideways scrolling, no browser errors | Browser run against the same stand-in |
| The weekly-rhythm journey (Phase 5), 94 checks: before the season (a member can still change her mind, a leader can read week 1), week 1 (the check-in is refused until all four are answered, the step is tidied and can be changed, twelve weeks shown), the leader settles the Success Picture and logs the meeting with one member away and cannot read a step, week 2 (the Friday check-in, a second absence puts the member on the call list with a WhatsApp message, an unanswered call is counted, a concern is raised and escalated to the care team, a call that reached closes it), the care lead closes a follow-up and sees no church testimonies, week 6 (the halfway check-in, a low belonging answer opens a follow-up for the leader), testimonies (written, held until the leader approves, shown by first or full name, declined with a note only the author sees, approved for the church by a pastor), the weekly report for pastor and coach and refused to a member, and the finished season. Phone and laptop, no sideways scrolling, no browser errors | Browser run against the same stand-in |
| The matching journey (Phase 4), 58 checks: a member sees three cards with their own percentages, three reasons each and first names only, opens a Success Picture, cannot join before agreeing, joins, and the seat is stored with the card number and agreement; the leader sees the roster, gets a working WhatsApp chat link, is refused a link that is not a WhatsApp invite, saves the group link and first meeting and marks the member welcomed; the member sees all of it, gives the seat up and chooses the second card; a member with no fit joins and leaves the Starter list and the demand is logged; the office sees the gap and which card members chose. Phone and laptop, no sideways scrolling, no browser errors | Browser run against the same stand-in |
| Production build, type-check, lint | `npm run build`, `npm run typecheck`, `npm run lint` |

**Not yet checked against the real services.** Your technical lead needs to confirm on a real Supabase project: Google sign-in end to end, emailed codes arriving, the Supabase settings below, and the assistant with real API keys (run `npm run bakeoff` first). The stand-in is not Supabase, so a difference in how real Supabase answers could still surface. It already caught two such differences in my own test setup, so expect a small one or two. Not yet tested on real phones or with real screen readers: do a pass on a mid-range Android phone on mobile data before launch. Budget a day for this and for a security review before any real member data goes in.

**The consent and privacy wording is a draft.** `src/lib/intake/consent.ts` and `/privacy` need review by your counsel against the Nigeria Data Protection Act (lawful basis, retention, cross-border transfer to the AI provider, the data controller's name and contact). The version string there (`2026-10-v1`) is stored with every consent; change it whenever the wording changes.

## Set up

Needs Node 20.9 or newer (22 recommended) and a Supabase project.

```bash
npm install
cp .env.example .env.local      # then fill in the Supabase values (and AI keys, optional)
npm run dev                     # http://localhost:3000
```

### 1. Create the database

In Supabase, open **SQL editor** and run the eleven files in `supabase/migrations/` **in order**:

1. `20261012000100_foundation.sql` (tables, access rules, functions)
2. `20261012000200_reference_data.sql` (tracks, tribes, goals, a provisional Season 1)
3. `20261013000100_intake.sql` (consents, drafts, member profiles, assistant usage log, statistics)
4. `20261020000100_leaders.sql` (leader applications, referees, scoring, reviews, interviews, decisions, leader statistics)
5. `20261101000100_academy.sql` (modules and quizzes, declaration, workshops, practice sessions, certification, Circle Cards, pairing, coaches, Academy statistics)
6. `20261101000200_academy_content.sql` (the six lessons and 35 quiz questions; draft wording for the pastorate)
7. `20261108000100_matching.sql` (the matching model and weights, the engine, recommendations, placements, the Starter list, rosters, onboarding, matching statistics)
8. `20261115000100_rhythm.sql` (the calendar, weekly guides, steps, check-ins, the leader's log and attendance, pulses, care flags, testimonies, the weekly report, the care queue)
9. `20261115000200_rhythm_content.sql` (the twelve weekly guides; draft wording for the pastorate)
10. `20261122000100_dashboards.sql` (the KPI thresholds, member and circle measures, the dashboard, a circle's progress, a member's own progress)
11. `20261129000100_whatsapp_signin.sql` (a new account must have an email address, with a readable reason)

Or, with the Supabase CLI linked to your project: `supabase db push`. Review the third, fourth, fifth, seventh, eighth and tenth files before running them: they hold the access rules for personal answers, the leader review, the Academy, who may see a circle's members, what a leader may see of a member's week, and who may see which numbers.

Already on Phase 6? Run only the eleventh file. On Phase 5? Run the tenth and eleventh. On Phase 4? Run the eighth to the eleventh. On an earlier phase? Run the missing files in order. Never skip one.

### 2. Turn on sign-in

**Email code** (Authentication → Sign In / Providers → Email)

- Enable the Email provider. Turn off "Confirm email" only if you want the code to sign people in directly; leave it on otherwise.
- Email OTP length: **6**. Email OTP expiry: **600** seconds.
- **Use your own email sender** (Authentication → SMTP Settings) with a domain you control and have verified (SPF, DKIM, DMARC). Supabase's built-in sender is limited to a few emails an hour and is meant for testing, so codes will not reach a congregation.
- Paste `supabase/templates/sign-in-code.html` into both the **Magic link** and **Confirm signup** email templates. It shows the code and has no link, on purpose: email security scanners open links and use up the one-time code.

**Google** (Authentication → Sign In / Providers → Google)

1. In Google Cloud Console, create an OAuth client ID of type *Web application*.
2. Authorised redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. Paste the client ID and secret into the Supabase Google provider and enable it.

**URL configuration** (Authentication → URL Configuration)

- Site URL: your production address.
- Redirect URLs: `https://YOUR-DOMAIN/auth/callback`, `https://YOUR-DOMAIN/auth/confirm`, and for local work `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/confirm`.

**Abuse protection.** Keep Supabase's default rate limits, and raise the hourly limit for sending codes to suit a Sunday-morning rush. Do **not** turn on Supabase's Auth CAPTCHA yet unless the sign-in screens send the CAPTCHA token (see "Add before launch" below); with it on and no token, every sign-in is refused.

### 3. Make the first admin

Sign in once (so your account exists), then in the Supabase SQL editor run:

```sql
select public.bootstrap_first_admin('your.email@example.org');
```

This works once, only from the SQL editor, and only while there is no admin. After that, admins and directors use the **Admin** page.

### 4. Give the panel their roles

Only people with a role can review. In **Admin**, invite or grant **Pastor** (the only role that can decide), **Director** (can invite to interview, add times, see everything the panel sees) and **Coach** (scores). Nobody can review their own application, whatever their role, so have at least two pastors before applications open.

### 5. Environment

See `.env.example`.

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required.
- The assistant is optional. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (and the matching `*_MODEL`), or choose with `AI_PROVIDER=anthropic|openai|none`. With no key, or `none`, the form works with plain options and the consent screen hides the assistant tick. Keys are server-side only.
- `NEXT_PUBLIC_SITE_URL` (optional locally, **set it in production**) is the public address used to build the private referee links. Without it the links are built from the request's host.
- There is no service-role key anywhere in the app: every query runs as the signed-in person, and the database decides what they may see. Keep it that way.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | Lint |
| `npm run test:unit` | Fast tests, no database |
| `npm run test:db` | Database tests: starts a throwaway Postgres, applies every migration, checks the access rules. Postgres will not start as root, so run as a normal user |
| `npm test` | Both |
| `npm run bakeoff -- --providers mock` | Dry run of the Claude-versus-ChatGPT comparison, no keys needed |

## Comparing Claude and ChatGPT

```bash
# keys and models in .env.local
npm run bakeoff -- --providers anthropic,openai --runs 3
```

It runs 31 invented stories (Nigerian English and Pidgin, tribe and goal questions, and cases where the right answer is to suggest nothing) through each provider and scores them against starting bars you can change in `scripts/bakeoff/score.ts`: right first suggestion 80% or more, a right option anywhere in the list 95% or more, stays quiet when it should 75% or more, invented options 1% or less, errors 2% or less, slowest 1 in 20 replies 3 seconds or less. It also writes a blind review sheet (providers shown as A and B) for two team members to rate how natural the suggestions feel. The bars and the model names in `.env.example` are proposals to agree with the team, not a standard.

How the assistant is kept safe:

- It can only pick from options it is given. The schema lists the valid ids and anything else is dropped after the call. Options are read from the database on the server, never from the browser.
- It is called only for signed-in people who ticked the assistant consent, from our own pages, at most 20 times in ten minutes.
- Only the person's own story text is sent. Support needs, notes to a leader, name, age, area and contact details are never sent, and emails and phone numbers are stripped from the text first.
- The text is passed as data, not instructions.
- A failure or slow reply (4.5 seconds) returns nothing and the form carries on.
- The usage log keeps counts and timings only, never the text. The record of which suggestions were shown and chosen stores option ids only.

## Where things are

```
supabase/migrations/       Database: tables, rules, functions, reference data, intake
supabase/templates/        Sign-in email template
src/app/(public)/          Sign-in
src/app/(app)/             Signed-in screens: home, admin, profile
src/app/(focus)/join/      The member form (no menu while answering) and its server actions
src/app/(focus)/lead/apply The leader application and its server actions
src/app/(app)/lead/        Applicant status page, referee links, interview booking
src/app/(app)/review/      The panel: queue, application, interview times, Academy, Circle Cards
src/app/(app)/lead/academy The leader's training, modules, declaration, workshops
src/app/(app)/lead/circle  The Circle Card builder and the roster
src/app/(app)/circle/      The member's three circles, choose and commit, placement
src/app/(app)/circle/testimony  A member's testimonies
src/app/(app)/lead/week    The leader's week: plan, log, calls
src/app/(app)/review/rhythm  The weekly report, care queue and church testimonies
src/app/(app)/rhythm/      Server actions for the weekly rhythm
src/app/(app)/dashboard    The Results dashboard
src/app/(app)/lead/progress  A circle's season so far (for its leader)
src/app/(public)/reference The referee's private page (no sign-in, no-index)
src/app/api/intake/        Assistant suggestions endpoint
src/app/api/auth/send-code The WhatsApp delivery hook (called by Supabase, signed)
src/app/privacy/           Privacy notice (draft wording)
src/app/auth/              Google and email-link return routes
src/app/design/            Style guide (development, or ENABLE_STYLE_PAGE=true at build)
src/proxy.ts               Refreshes the session; sends signed-out visitors to sign-in
src/lib/auth/              Roles, session, safe redirects, plain-language errors
src/lib/intake/            Options, answers and validation, steps and progress, consent wording
src/lib/leaders/           Leader questions, situations, rubrics, steps, status wording, errors
src/lib/academy/           Training types, checklist, card helpers, declaration, meeting times
src/lib/matching/          Match types, wording, server reads
src/lib/rhythm/            Weekly types, wording, server reads
src/lib/dashboard/         Dashboard types, wording, server reads
src/lib/whatsapp/          The hook's signature check, request reading, the sender (Meta)
src/lib/ai/                Assistant layer (Claude, ChatGPT, mock)
src/components/intake/     The member form screens and the finished views
src/components/flow/       The shared frame for both forms (progress, bottom bar) and the celebration
src/components/leaders/    Leader application, status, referee and review screens
src/components/academy/    Training hub, modules and quiz, workshops, Circle Card builder, panel screens
src/components/matching/   Degree ring, circle cards, choose form, placement, roster, office panel
src/components/auth/       Sign-in screens (email, Google, WhatsApp)
src/components/profile/    Delete answers; add or change the sign-in number
src/components/dashboard/  Rate ring, headline, weekly bars, circle results, church views, leader and member progress
src/components/rhythm/    Week view, step, check-ins, guide, log, call list, testimonies, weekly report
src/components/ui/         Buttons, fields, choices, badges
src/components/brand/      Crest and shield progress
src/app/globals.css        Colours, type scale, motion
scripts/bakeoff/           Comparison script, stories, scoring
tests/unit, tests/db       Tests
```

To change a question's options, edit `src/lib/intake/options.ts` (meeting times, zones, faith journeys) or the catalogue tables (tribes and goals). To change the colours or motion, edit `src/app/globals.css`.

## Security and privacy notes for the reviewer

- **Row level security is on for every table**, and the migrations revoke default broad grants and grant back only what is needed. A test fails if any table lacks RLS, if a visitor can read or call anything, or if a function is exposed that the app does not call.
- **A person sees and changes only their own answers.** Nobody else can read a member's profile, draft or consents in this phase, admins included. Leaders will see only what circle members share, added with circles.
- **Consent is an append-only ledger** (what, which wording version, when). Withdrawing matching consent deletes the profile and draft in the database itself, and withdrawing WhatsApp consent removes the number. Deleting answers from the profile page uses the same path.
- **The server re-checks everything.** The browser's checks are for convenience: the save action validates again, looks options up in the database, and rejects teens.
- **Drafts are saved from the browser as the signed-in person** under the same rules, so there is no server queue to block them and no extra privilege.
- **The assistant endpoint** checks origin, sign-in, consent, a per-person limit and size limits before anything leaves the server.
- **Roles cannot be self-assigned**, every elevated function pins its search path, sign-in identity is verified with `getClaims()`, redirects stay inside the app, and pages behind sign-in render per request. These are unchanged from Phase 0.
- **Leader applications (Phase 2).** An applicant can write only their answers and current step while the application is a draft (column-level grants). Status, scores, references and decisions change only through database functions.
- **The answer key for the six situations lives in a table with no API access.** The database scores them, and the applicant never learns which response counted as best.
- **Referee links:** 64 random hex characters, only a SHA-256 hash is stored, 30-day expiry, single use. Making a new link cancels the old one. The page is marked no-index and sends no referrer.
- **Reviewers read through two functions only,** never a table. They cannot see their own application, cannot see colleagues' scores for a stage until they have scored it, and cannot decide unless they are a pastor. Approval grants the role and records who granted it. Every step is written to the events log.
- **Interview times:** one applicant per time. Applicants are offered only times more than 24 hours away and cannot cancel inside 24 hours.
- **Academy and Circle Cards (Phase 3).** No Academy table is readable through the API: people read and act through functions that check who is asking. The quiz key is never sent to the browser; scores come from the database. A trainee can write only through functions (attempts are limited per day), cannot sign the declaration before passing the care module, cannot book a second workshop of the same kind or cancel inside 24 hours, and cannot mark their own register or practice session. Only the pastorate marks registers, practice sessions and cards. A Circle Card is readable only by its leader, its assistant, its coach and the pastorate; fields locked by the application cannot be changed by the leader; certification is computed by the database, not set by anyone.
- **The weekly rhythm (Phase 5).** No rhythm table is readable through the API: members and leaders act through functions that check who is asking and which week it is. A member can write only their own step, check-in, pulse and testimony, and only in the windows above. A leader gets, for each member, only whether the step was done, never its words or the reflection, and pulse answers are never shown to the circle (only an average once three have answered). Only a leader or assistant of the circle, a pastor or a director can log a week; a coach reads their own circles; the care queue and church testimonies are for the care lead, pastor and director. A testimony reaches the circle only after the leader approves it and the church only after a pastor does; a withdrawn testimony disappears for everyone, and the leader's note on a declined one is visible only to its author. Deleting a person deletes their steps, check-ins, pulses, testimonies and follow-ups.
- **WhatsApp sign-in (Phase 7).** A number is added only after a code typed back from that number, and one number belongs to one account. The sign-in screen never creates an account and gives the same answer for a number with no account, so it cannot be used to find who is on the platform. The number is never copied into our tables and never shown to a leader or the office (the Profile page shows it masked). The delivery hook accepts only requests signed with a shared secret within five minutes, caps the body size, never logs the code or the whole number, and is reachable without sign-in because Supabase, not a person, calls it. A database rule refuses an account with no email address, so a phone-only account cannot be made by calling the sign-in service directly.
- **Dashboards (Phase 6).** Three functions only (`dashboard`, `circle_progress`, `my_progress`), each checking who is asking inside the database. The church-wide view needs admin, director, pastor or data lead; a coach is restricted to circles where they are the assigned coach; a leader or assistant reads only their own circle; a member reads only themselves. No member's name appears on the church-wide view: only counts, and the leader and coach named beside each circle. Small groups are suppressed (fewer than 5 for a breakdown, fewer than 3 answers for an average). A leader never sees a member's belonging or Success Picture answers, only meetings and whether a step was done.
- **Matching and placement (Phase 4).** The matching tables have no API access at all. A member runs the engine and reads results only through functions that act for the signed-in person, so nobody can read another member's recommendations or answers. The engine returns a leader's first name, never an email or number. A seat is taken under a row lock after the circle is checked again, so a full circle cannot be oversold. A leader's roster is readable only by that circle's leader and assistant, a coach, a pastor or a director, and a member's WhatsApp number appears there only while their WhatsApp consent stands. A published circle cannot be pulled back to draft while members are seated in it. The office statistics hold no names.
- **Add before launch:** a Content Security Policy header (the security headers in `next.config.ts` cover the rest), **CAPTCHA** (the app does not send a CAPTCHA token yet, so Supabase's Auth CAPTCHA must stay off until it does), counsel's review of the consent and privacy wording, and a retention rule for abandoned drafts.
- **Adding migrations:** new tables start locked, but Postgres lets everyone run a new function by default. End any migration that adds a function with `revoke execute on function … from public, anon, authenticated;` then grant to the roles that need it. The test "exposes only the functions the app calls" fails until you add the new function to its allow-list.

## Notes and limits

- **Speaking instead of typing** uses the browser's built-in speech recognition. It works in Chrome on Android and in Safari on recent iPhones, depends on the phone and the network, and how well it handles Nigerian English and Pidgin has not been tested. The audio goes to the browser vendor, not to us. A server-side transcription option is a later decision.
- The assistant's model choice is open. Run the comparison with real keys and agree the bars with the team before choosing.
- **Nothing is emailed or sent on WhatsApp yet.** Invitations: tell the person to sign in with the exact address. Referee links: the applicant sends them by WhatsApp (a button opens the chat with the message ready) or copies them. Status changes appear on the applicant's Lead page, and the panel sees the applicant's WhatsApp number as a tap-to-chat link.
- **The scoring is a proposal.** The six situations and which response is best, the rubric wording, the weights and the 75 and 60 thresholds need the pastorate's approval. Change the wording in `src/lib/leaders/` and the key and thresholds in the fourth migration (before it is run, or in a new migration after).
- **The leader consent and referee notice are drafts for counsel** (`src/lib/leaders/consent.ts`), as with the member consent. An applicant can withdraw and delete any time before they are approved. After approval the record is kept for safeguarding. How long is an open decision.
- **The Academy content is a draft** (see above). Workshops are tracked, not gates. The office adds workshop dates; nothing is emailed, so tell leaders when dates are up. A women-only or men-only circle is set by the leader and checked by the pastor when approving: the app does not hold the leader's gender.
- **Any coach, director or pastor can mark any leader's practice session** (not their own). The coach for a particular circle is assigned at card review; marking practice does not depend on it.
- **Matching limits (Phase 4).** The weights are a first version chosen by judgement, not trained on outcomes. Stage of life is a hard filter, because the form has no "open to an adjacent stage" question; adding one is a small change. No second-choice tribe is collected, so a related tribe scores 30% through its goal family. "Needs heavy support" is guessed from whether the member wrote anything in the support-needs box. The Starter Circle is a waiting list and a demand log: who hosts it is an open decision. Capacity counts members, with the leader and assistant extra. A women-only or men-only circle is shown only to a member whose form gives that gender and says "my own gender only"; a member who chose "prefer not to say" is shown mixed circles only. The app does not hold the leader's gender, so the pastor checks that a women's circle has a woman leading it. Withdrawing matching consent erases results and demand, but an active placement stays, and the member must release their seat first. The covenant wording and the Success Picture prompts are drafts for the pastorate. Pastors must be granted in Admin before they can review.
- **Weekly rhythm limits (Phase 5).** Nothing is sent: nudges are in the app and a leader's follow-up is a WhatsApp link they tap. Reports are worked out when someone opens them, not pushed. The season must be 12 weeks for the twelve guides to line up. The check-in window is the Friday to the Tuesday after the week starts, so the label "Friday" assumes a season that starts on a Sunday. A member cannot leave a circle once the season has started: ask the care team. "Missed twice" compares a member with the previous meeting that was logged as held, so a week the leader did not log, or a week the circle did not meet, is skipped rather than counted as a miss. The twelve guides, their meeting plans and the prompts are drafts for the pastorate.
- **WhatsApp sign-in limits (Phase 7).** Not tested against Meta, Twilio or a real Supabase project (see above). A person cannot start with WhatsApp: they begin with Google or email and add the number in Profile. Removing a number is not possible from the app (the sign-in service has no way to clear one); an admin can do it in Supabase under Authentication → Users, and changing to a new number takes the old one away. **A recycled phone number is a real risk** (a number reassigned by the network could reach the previous owner's account): ask people to change their number in Profile when they change SIM, and keep pastors, directors and admins on Google or email sign-in. If someone started adding a number and never finished, a later sign-in code could go to that unfinished number, so they should finish or change it. Anyone signed in can ask for a code to be sent to any number they type when adding one; Supabase's own limits cap how often, and nothing stronger is built (see CAPTCHA below). Codes are only ever sent on WhatsApp; there is no text-message fallback.
- **Dashboard limits (Phase 6).** The thresholds (85% thriving, two thirds attendance, belonging 4, 80% and 70% for an effective circle, a gain of 2 points) are my reading of the programme and are held in `kpi_targets()` for the pastorate to confirm. "Gain" is points on the 3 to 15 sum of the three Success Picture answers, which is an interpretation. Numbers are worked out live, so there is no history: you cannot ask what the rate was on a given week of a past season. A tribe champion has no tribe in the data, so has no dashboard until that is added. Rates by tribe use the circle's tribe. The funnel's "shown circles" step counts people for whom a match was run. Retraining the matching weights is only flagged, not done: it needs 300 finished placements and a decision by a person.
- Interview times and the applicant's "choose a time" screen use Lagos time. The office types the meeting link or place for each time.
- **Not built yet from the blueprint's full list:** relationship, children and work chips, group roles, an assistant-drafted success sentence, a separate note-to-leader, meeting-time suggestions. These add to the form without changing it.
- The Admin people list shows the newest 200.
- The form's time (shown as "about four minutes") is an estimate from a fixed time per screen. The Admin statistics show real times once members use it.
- The provisional Season 1 (14 February 2027, 12 weeks) is a placeholder. The office confirms the real dates before launch.
- Cache Components (a Next.js 16 option) is off, because every signed-in screen is personal.
- The `/design` page is built statically, so `ENABLE_STYLE_PAGE` must be set when you build, not only when you run.

## Next

A full end-to-end pass, the CAPTCHA token on the sign-in screens, and the consolidated hand-over notes.

# "Let them choose": how to apply this package

**What was missing.** When you appoint a leader in God Mode, their Tribe Card is started on one goal and **the goal is locked**. If you started
the leader on the wrong one, there was no way for the leader to change it, and nobody to ask.

**What this does.** On each leader you appointed (one at a time, or in a bulk run) there is now a button, **Let them choose**. It hands the leader
one decision, the goal on their own Tribe Card, and nothing else. It is for the owner only, and **everything that is not switched on works exactly
as before**: a leader you have not unlocked sees the same locked card, a leader who applied the ordinary way is untouched, and the pastor's approval,
the Academy and the safeguarding promises still apply exactly as the switchboard has them.

- **You** press **Let them choose** on a leader, or tick several leaders (or a whole bulk run) and press it once. Each leader shows one plain line, for example
  *"Their goal is set by the church and they cannot change it."*, *"They can choose their goal. They have not yet."* or *"They chose … You started
  them on …"* (with how many members were waiting for it). **Lock it again** puts the lock back and keeps what they already picked.
- **The leader** sees, on their own card, a list of goals instead of a fixed box. The goal you started them on is first and marked, then the ones
  with the most members waiting (*No one is waiting yet* when none are). Only goals with a signed-off ready-made card, in an open community, are
  offered. Sensitive goals are left off unless you said a pastor cleared that leader; the one you started them on is always allowed. When they pick
  one, their three Success Picture lines refill from that goal's ready-made card, **except any line they wrote themselves**.
- **It stops by itself** when the leader sends the card, or a member joins. The community stays fixed unless you tick *Let them choose the community
  too* (off by default).
- **The pastor** reviewing the card sees: *"This leader chose their own goal. The church had started them on a different one."* Your name is never shown.
- **Your private record** gets a plain line for each unlock, lock, pick and welcome email (it names the goal, not the person).
- **A welcome email**, signed *Wale Ekundayo, Pastor TCN Iganmu Center*, explains the choice and the steps that follow, with a picture of each screen.
  **It is never sent until you press "Wale Ekundayo has approved this wording"** on a new tab, **Appointments → Welcome email**.

This zip holds **only the files that changed** since the last package (the invitation-email one). Unzip it so its `united-tribes` folder merges into
your project (say yes to replacing files). **No new packages and no new settings.**

## Deploy

1. **Database**, one file, once: `supabase/migrations/20261228000100_goal_unlock.sql` (`supabase db push`, or paste it in the SQL editor and press
   **Run**). It adds three small tables, **one trigger** (on a tribe's goal, which returns at once for any tribe you have not unlocked) and the functions
   behind the buttons. **No existing function, table, column or setting is changed.** Everything up to `20261227000100_invitation_email.sql` must
   already be applied.
2. **Then the app**: deploy the website. The eight pictures for the email are in `public/email/leader-guide/` and go out with it.
3. **Check `NEXT_PUBLIC_SITE_URL`** on the host. It must be the public address of the site (for example `https://app.yourchurch.org`), because the
   pictures in the email are loaded from it. If it is wrong the email still reads fine (every step is written out), but the pictures will not show.

## Check it works (about ten minutes)

1. Unlock God Mode, open **Appointments → One at a time**. Each leader you appointed now shows a status line, a **Let them choose** button and a **Select** box.
2. **Appointments → Welcome email.** Read both versions. The page says *Not approved*. Back on a leader, the *Send the welcome email* tick is greyed with
   the reason. Letting them choose works without it.
3. Press **Let them choose** on a test leader, then **Yes, let them choose**. The line changes to *They can choose their goal.*
4. Sign in as that leader on a phone. The Tribe Card shows the list, their original goal first and marked. Pick another goal: the card saves, and the
   three lines refill unless they were edited.
5. As a pastor, open that card in review (it is listed there once the leader sends it): the note says they chose their own goal and does not name you.
6. **God Mode → Your record** shows the lines. **Lock it again** and the leader's card is a fixed box again, with their pick kept.
7. When Pastor Wale agrees the wording, press **Wale Ekundayo has approved this wording**. Then **send the welcome email to one leader first**
   (the button on that leader), and read it in the real inbox, on a phone, before sending to anyone else.

## If something looks wrong

- **The button is not there for a leader.** The line beside them says why: their card was sent, a member has joined, or they applied and were approved
  in the ordinary way (this is for leaders you appointed).
- **The welcome email did not go.** The page says why: the wording is not approved, they have no email address, or they already had it (press
  *Send again*). Nothing goes between **10 pm and 6 am Lagos time**; it waits until 6 am. Whether it then arrives is the same question as for the
  invitation email: see `docs/APPLY-INVITATION-EMAIL.md`.
- **A picture is missing in the email.** See step 3 under *Deploy*. Some mail apps also hide pictures until the reader taps *show images*.
- **The pictures show an out-of-date screen.** They were taken on the day this package was made. To take them again after the screens change, run
  `bash scripts/leader-guide-pictures.sh` (it needs a normal user, not root, and builds a throwaway copy of the site).
- **Changing the wording of the email.** The wording is locked by a test, so a change cannot slip in. If you change it on purpose, raise
  `WELCOME_WORDING_VERSION` in `src/lib/messaging/templates-leader-welcome.ts` and regenerate with `UPDATE_GOLDEN=1 npx vitest run
  tests/unit/leader-welcome-template.test.ts`. A new version needs approving again, and leaders who had the old one can be sent the new one.

## Existing files this package changes

- `src/lib/messaging/types.ts`, `render.ts`, `templates.ts`: the shared email layout can now carry numbered steps with pictures, bullet lists and a
  signature. **The 131 emails that already exist are byte-for-byte unchanged**, which a new test proves: it holds a fingerprint of each one taken before
  the change, and the same fingerprints come out of the previous package's code and of this one.
- `src/app/(app)/god/appointments/page.tsx`, `bulk/page.tsx`, `src/components/god/AppointBoard.tsx`, `BulkLeaders.tsx`, `AppointTabs.tsx`: the
  buttons and status line on each leader, the unlock-the-whole-run button, and the third tab. Appointing itself is untouched.
- `src/app/(app)/lead/tribe/page.tsx`, `src/components/academy/TribeBuilder.tsx`: the leader's list. **One extra database read** on a leader's own editable
  card, and it returns nothing for every leader who has not been unlocked, so the card is as it was.
- `src/app/(app)/review/cards/[id]/page.tsx`: the pastor's note.
- `src/lib/god/wording.ts`, `src/app/(app)/god/record/page.tsx`: the private-record lines.
- `tests/db/foundation.test.ts`: the list of functions the database may expose now includes the eleven new ones (it is a guard, so it must know them).
- `tests/db/notices-rollback.test.ts` (disclosed): it runs the way back of every feature built after the notices, and held each of them to "no row is
  touched". The way back from this feature has to touch one thing on purpose: it puts the list of locked parts back on the tribes it unlocked, so a
  leader cannot be left with an unguarded goal. The test now holds only the notices' own two files to "no row is touched". Every file is still held to
  no delete, truncate, insert, table drop or table change, and the test still proves the database ends with exactly the functions and triggers it began with.
- `tests/unit/fixtures/message-params.ts`: includes the new email's sample fields (the shared email tests run on it).
- `scripts/rehearse-rollback.sh`: not a test; `goal-unlock` and `goal-unlock-rollback` are added to the list of new tests.
- `README.md`, `docs/GOD.md`: a row and a section.

New: `src/lib/messaging/templates-leader-welcome.ts`, `src/lib/god/goal-unlock.ts`, `goal-unlock-server.ts`, `src/lib/academy/goal-choice.ts`,
`src/components/god/GoalChoice.tsx`, `WelcomePanel.tsx`, `src/components/academy/GoalPicker.tsx`, `src/app/(app)/god/appointments/choose-actions.ts`,
`welcome/page.tsx`, `src/app/(app)/lead/tribe/choice-actions.ts`, `supabase/migrations/20261228000100_goal_unlock.sql`,
`supabase/rollback/20261228000100_goal_unlock.down.sql`, `public/email/leader-guide/*.png` (8), `scripts/leader-guide-pictures.sh`,
`e2e/pictures/leader-guide.ts`, `e2e/owner-door.ts`, `e2e/journeys/33-let-them-choose.ts`, and the tests listed below.

## Choices to know about

- **One zip, one migration.** The blueprint could have been three drops; it is one, because the pieces share the same list and the same email.
- **"Let them choose", not "let her choose".** The wording is the same for every leader.
- **Goal only.** The community stays fixed unless you tick it. Life stage is always fixed.
- **No reminder email** to a leader who has not chosen yet. The welcome email is the only message.
- **The email is email-only**, never put to Meta for approval, sent once per leader per version unless you press *Send again*, and it cancels a short
  "you have been appointed" email for the same leader that has not gone yet (this one covers it).
- **The pastor's name and title are two lines you can change** on the Welcome email tab. Changing either takes the approval away until you press it again.
- **The private record names the goal, not the leader.** Your own pages show the leader's name live.
- **The Academy and promises steps follow the switchboard at the time it is sent.** Academy Required: "Do the Academy"; Optional: "The Academy, when you
  are ready", said not to be required; Off: no Academy step. The promises step is left out when the declaration is not Required.
- **A fault never undoes an unlock.** If the email cannot be queued, the leader can still choose and the page says why it did not go.

## The way back

Run `supabase/rollback/20261228000100_goal_unlock.down.sql` as the database owner. Every goal lock goes back on exactly as it was, **keeping the goals
leaders have already picked**, then the trigger and the functions are removed. **The three tables and every row in them stay** (no unlock, pick or
welcome-email record is lost), as the way back from the earlier features does; the top of the file says how to drop them too. Emails already queued
or sent stay. Running it twice changes nothing. Then restore the application files listed above from the previous package.

## What was checked, and what was not

Checked on a throwaway database built from the migration files, and in a test browser (Chromium):

- **Type check and lint** of the whole project: clean.
- **Unit tests**: 2,151 tests (45 of them new: the email's wording and its lock, both versions, the Academy and promises left out or softened when the
  switchboard has them Off or Optional, no owner or administrator named, no link that works as a key, the email whole without its pictures, the
  pictures all present, the right size and under 100 KB, the old emails unchanged, and the private-record wording). The long email goes by email only;
  WhatsApp and text have only a short pointer.
- **Database tests**: 57 files, 1,686 tests (82 of them new). They cover: who may unlock (the owner while unlocked, and nobody else, including a
  pastor and the admin); which cards may be unlocked; the guard on the goal (draft only, no member, signed-off cards only, same community, sensitive goals
  only when cleared, community only when ticked); the three lines refilling only where unedited; the tribe name following the community only when it was
  the generated one; lock again keeping the pick; bulk runs; the leader's list and its order; the pastor's note without any name; the private record;
  the welcome email (approval needed, tied to a version, once per version, again on request, quiet hours, email only, cancels the short email); and the
  way back, run twice.
- **Browser journeys**: the new journey 33 (63 checks): the owner unlocks one leader and several, the leader picks on a phone with nothing running off the
  screen, the pastor's note has no name, the private record lines read right, lock again, approve and withdraw the wording, the bulk-run button, the
  right messages queued by email only, and the email arriving. The other 30 pass, each on at least one run; see the note below.
- **The way back, rehearsed**: the original suite (958 tests) gives the same answer, test by test, on a database with every migration and every rollback file run as it does on one that never had them (958 of 958 on both).

**Not** checked, and worth doing yourself:

- **Delivery of the welcome email to a real inbox**, and how it looks in Gmail, Outlook and on a phone. The test sender is a stand-in. This is why step 7
  above says to send to one leader first. Whether a message reaches an inbox depends on the mail setup; it is the same open question as the
  invitation email.
- **Pastor Wale's approval of the wording.** The email's wording is a draft written for him to read. Nothing is sent until he has.
- **Timing on your own server and data.**

Two things you may notice:

- **One older journey is not steady on this two-processor test machine.** Journey 4 (the member sign-up form) failed one check in the full run and one of five later runs on its own, then passed the other four: *"0 meeting times are suggested and already ticked"*. The journey reads the ticked times a moment after they are suggested, and the ticking comes from a step that finishes a little later. Nothing this package changes is on that screen. If it fails on your own pipeline, run it again, and tell me if it keeps failing.
- **Two older database test files fail if you run the suite between 10 pm and 6 am Lagos time** (`messaging.test.ts` and `referee-trust.test.ts`),
  because the platform sends nothing in those hours. This is unchanged; run them in the daytime.

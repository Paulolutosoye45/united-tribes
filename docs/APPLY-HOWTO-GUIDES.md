# The "How to use this app" button, and three new guides: how to apply this package

This zip holds **only the files that changed** since the WhatsApp and removal-requests package. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied.

**No database change. No new packages. No new settings. Nothing to switch on.** The button is on for everyone the moment the website is deployed. The pictures are ordinary files inside the project.

**One file is removed:** delete `src/components/guides/HelpLink.tsx` from your project. It was the small "?" in the page header, which the new button replaces. Nothing refers to it any more, so leaving it does no harm, but the project's checks will say it is unused.

## What it is

The guides were there, but hidden: the only way in was a small "?" in the header that showed on some pages, or knowing to go to `/guides`. Now **every screen of the app carries a round gold button, "How to use this app"**, at the bottom right (above the menu on a phone). On the two full-screen forms it is a small round button in the form's own header instead, so it never covers a question. It is for every kind of person: member, leader, assistant leader, pastor, director, coach, care lead, admin, and a visitor on the sign-in page and the three pages people reach from an email.

What makes it different from a help link:

| | |
|---|---|
| **It pulses until it has been used** | To someone who has never pressed it, it ripples with gold (six slow ripples on each page, then it rests; the next page ripples again) and says its words. The ripple is a thin ring that grows and fades, drawn by the browser without repainting the page, so it costs a phone almost nothing. On their Home page only, a welcome bubble ("New here?") offers a tour once, a moment after the page loads, and goes away when put away; it is never put in front of the sign-in page, a form, or a page with buttons to press. After the person has opened it, it shrinks to a quiet "?" mark. It pulses softly again only on a page whose guide they have not looked at. "Stop the pulse" (in the sheet) makes it still for good. With the phone's "reduce motion" setting on, nothing moves: a still gold ring does the same job. |
| **It knows the page** | Pressed, it opens a sheet with the guide for the page the person is on, **for their own role**: a leader and an assistant leader, on the same page, are offered different guides. A page with no guide says so plainly and offers everything else. |
| **It points at the real buttons** | Under the page's guide are chips named after the buttons the guide tells the person to press. Tapping one scrolls the page to that button and draws a gold ring round it, with its name. Escape, or a tap anywhere, puts the ring away. It reads the names off the screen, so it cannot point at something that is not there. |
| **A one-minute tour of the menu** | "Take the one-minute tour of the menu" walks along the person's own menu, a ring on each place and a line on what it is for, with Back, Next and Stop. |
| **Search in plain words** | "What do you want to do?" finds guides by ordinary words ("testimony", "pause whatsapp"). It only ever finds guides that person may open. |
| **Where to start** | A short list in the order of the person's own responsibility (a leader's starts with the Tribe Card guide). |
| **Everything in one place** | "Where things are" lists the menu with a line for each; "All how-to guides" opens the library. |

It reads from the guides themselves. The wording, the pictures and the pointing therefore cannot drift apart: when a button is renamed, the guide's check fails, and the button's pointing follows the guide.

**What it remembers** (on the person's own phone or computer, never sent anywhere): whether it has been opened, whether the tour was finished, which pages' guides were looked at, and whether the pulse was stopped. If the browser will not keep it, the button behaves as it does for someone new and nothing breaks.

**Where it is not:** inside the guides themselves, on the Tribe Card guide, on the owner's passphrase screen and on pages made for printing. On the full-screen forms (Find your tribe, the leader application) it is not floating: it is a small round button in the form's own header, beside the progress shield, with no welcome bubble, so it cannot cover a question or the Continue bar and nobody is interrupted mid-question. Its sheet opens outside the form, so pressing Enter in its search never moves the form on.

## Three new guides, and three brought up to date

| Code | Guide | For | Steps |
|---|---|---|---|
| A1 | Watch WhatsApp, pause it, and find out why it stopped | the admin (the director and data lead can open it too) | 10, with pictures of the Message log, the pause and the WhatsApp health page |
| L8 | Ask the church about a member's place in your tribe | tribe leaders | 6 |
| C1 | Decide a request about a member's place | coaches and the Care Lead (pastors, directors and admins read it too) | 5 |
| M1 | Find your tribe: the form | **new step**: giving a WhatsApp number | 13 (was 12) |
| M6 | Your information | **new step**: "Add your WhatsApp number, if we ask"; the number box and the "You have two numbers" note | 9 (was 8) |
| L4 | Run your week | a line about the note that names tribe members with no phone number yet | 13 |

The pictures for the new and changed steps were made from the real screens with the owner's switches **On**, because those screens exist only once the owner opens them. Every other picture is as it was. The A1, L8 and C1 guides say what to do if the screen is missing (the owner has not opened it yet).

## Before you start

1. **Back up** if you wish; there is nothing in the database to change.
2. **Nothing to decide.** One default you may want to change later: the button pulses for new people, and softly on pages whose guide has not been looked at. If you would rather it **always pulse** for everyone, it is one line: in `src/components/guides/pilot-state.ts`, in `pulseFor`, return `"strong"` instead of `"still"` at the end.

## Deploy

1. Unzip into the project, say yes to replacing, and **delete `src/components/guides/HelpLink.tsx`**.
2. Deploy the website. That is all.

## Check it works (about fifteen minutes)

1. **As a new member on a phone:** the gold button is at the bottom right, above the menu, and pulses. After a moment a bubble says "New here?". Press **Show me around**: the menu is toured, a ring on each place, and the button comes back at the end with no ring left behind.
2. **Press the button on your profile page.** The sheet names "Your information", and under it there are chips such as **Save** and **Download my data**. Tap one: the page scrolls to the real button and rings it. Press Escape and it goes.
3. **Type "testimony"** in "What do you want to do?": "Share a testimony" is offered. Type "run your week": nothing for a member.
4. **As a leader** on This week: the guide is "Run your week". Search "tribe card": the Tribe Card guide is offered.
5. **As an assistant leader** on the same page: the guide is "Assistant leader: your part".
6. **As the admin** on Admin → Messages: the guide is A1. As a coach on Growth → Removal requests: the guide is C1.
7. **On the Find your tribe form** (`/join`) and the leader application (`/lead/apply`): the button is a small round one in the header, right of the progress shield; it pulses for someone new; there is no bubble; the Continue bar is clear. Press it and type a word in its search, then press Enter: the form stays where it was.
8. **The welcome bubble** appears only on Home, for someone who has never pressed the button. Open the sign-in page in a private window: the button is there, the bubble is not.
9. **Press "Stop the pulse"**: the button is still on every page, even after you sign out and back in on the same phone.
10. **Open `/guides/whatsapp-health`** as the admin and read it against the Message log with the safety net On.

## Way back

Put the previous application files back and put `src/components/guides/HelpLink.tsx` back. There is no database to undo and nothing stored on the server: the only thing remembered is on each person's own device (the key `ut-howto-v1`), and an old version simply ignores it.

## Existing files this package changes

Only additive edits, listed so nothing is a surprise:

- `src/components/shell/AppShell.tsx`: the button replaces the old "?" link; it is drawn after the menu so it knows whether to sit above the phone's tabs.
- `src/components/flow/FlowFrame.tsx`, `src/components/intake/IntakeFlow.tsx`, `src/components/leaders/ApplyFlow.tsx`, `src/app/(focus)/join/page.tsx`, `src/app/(focus)/lead/apply/page.tsx`: a `help` slot in the form's header that carries the button (nothing else about the forms changes). `src/app/(focus)/layout.tsx` no longer floats a button over them. **New:** `src/app/(public)/layout.tsx` (the button on the sign-in page and the pages reached from an email, only where a guide exists).
- **New:** `src/components/guides/HowToPilot.tsx`, `pilot.css`, `pilot-state.ts`, `pointer.ts`; `src/lib/guides/pilot.ts`, `match.ts`, `tribe-card.ts`; `src/app/guides/find/route.ts` (the search; answers only with guides the person may open, never cached).
- `src/lib/guides/context.ts`: which guide belongs to which page, including the new pages. `src/lib/guides/catalogue.ts`: the three new guides. `src/lib/guides/types.ts`: a picture may now say which switches are On (`features`) and whether WhatsApp is paused (`whatsapp`).
- `src/lib/guides/content/*`: three new guides and the three updated ones. `content/guides/pictures/*` and `src/lib/guides/pictures.generated.json`: the new and retaken pictures.
- `src/app/guides/page.tsx`: the Tribe Card entry moved to its own file.
- `e2e/pictures/*`: the picture maker can now take pictures of screens that need a switch On, a paused WhatsApp, a pending request, and the admin and coach roles.
- Tests: `tests/unit/pilot.test.ts` (new), `tests/unit/guides.test.ts`, `e2e/journeys/43-howto.ts` (new), `e2e/journeys/34-guides.ts`, and one wait in `e2e/journeys/39-my-page-for-everyone.ts` (see the browser journeys above).

## For whoever adds the next guide

Nothing else to do: add the guide to `src/lib/guides/catalogue.ts` and, if it belongs to a page, one line to `HELP_LINES` in `src/lib/guides/context.ts`. The button, its search, its start list and its pointing pick it up. A test fails if a page points at a guide that does not exist, if a person would be offered a guide they may not open, or if a menu place has no line saying what it is for (`AREA_ABOUT` in `src/lib/guides/pilot.ts`).

To make its pictures, add `features: ["switch_key"]` to a shot when the screen exists only while a switch is On, and run `bash scripts/guide-pictures.sh <code>`. The maker stops, naming the step, if a word in the guide is not on the real screen.

## What was checked, and what was not

**Checked, on the stand-in backend (a real Postgres with every migration):**

- **Types and lint:** clean.
- **Unit tests:** 2,626 tests in 94 files pass.
- **Database tests:** 2,178 tests in 80 files pass. (Nothing in the database changed; they are the same tests, run again.)
- **Browser journeys:** **All 41 journeys pass: 2,442 checks.** The full run passed 40 of them (2,367 checks). The 41st, journey 39, was changed in one place and then passed on its own (75 checks): it waited for a "Thanks" line on Home that the refreshed page can replace within a tenth of a second (nothing to do with this package; the new button only changed the timing), so it now waits for the answer to be saved and the database check proves it was kept. The new journey 43 tries the button as a visitor and as each of eight kinds of signed-in person: it is on the screen, pulses for a new person and settles, never sits on the phone's menu, opens a sheet that fits the screen on a phone and a computer, offers only guides that person can open, names the right guide on a page (and a different one for an assistant leader), points at a real button and lets go on Escape, tours the menu, searches, honours "reduce motion", and stays out of the guides.
- **Pictures:** 22 new or retaken, each looked at. The picture maker, and then the full browser run, found real faults along the way, all fixed before this package: the button covered the Continue bar and the Companion's buttons on the full-screen forms (it now sits in the form's header); the welcome bubble sat over sign-in, reminders and form screens (it is now on Home only, and cannot be pressed in its first second); the progress line under the form's header was squeezed (it now wraps to two lines); and a ripple that never stopped kept every page repainting, which slowed the tests and would have cost phones battery (it now ripples six times and rests).

**Not checked:**

- **A real phone.** The browser used is a phone-sized Chrome, not an iPhone or a low-end Android; the button's position above the phone's menu uses the standard safe-area setting and should be looked at once on each.
- **The Tribe Card guide** (`/tutorial`) is a page the church serves outside this project; the button offers it to leaders and cannot open it in the test site.
- **Whether people use it.** The first read of that is how many people press it in a week; nothing here counts presses, by design.

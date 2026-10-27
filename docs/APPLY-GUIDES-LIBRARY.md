# The How-to Library, stage A: how to apply this package

This zip holds **only the files that changed** since the package you last applied (the appointed leader's Lead page). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20261230000100_my_appointment.sql`.

**No database change. No new packages. No new settings.** The pictures are ordinary files inside the project, so nothing is uploaded anywhere.

## What it is

A library of short how-to guides at **`/guides`**, with a picture of the real screen for every step. Stage A holds the guides for members, tribe leaders, assistant leaders, and the three pages people reach from an email. The office guides (pastors, directors, admins, coaches, care leads, community champions, data leads) are the next stages.

| Code | Guide | For | Steps |
|---|---|---|---|
| L0 | Fill in your Tribe Card, and your first 21 days | tribe leaders | 10 (already live at `/tutorial`; the library lists it and links to it) |
| M5 | Sign in with a code | everyone, signed in or not | 8 |
| M1 | Find your tribe: the form | members | 12 |
| M2 | Join your tribe | members | 8 |
| M3 | Your week in your tribe | members | 9 |
| M4 | Share a testimony | members | 6 |
| M6 | Your information: see it, take it, or ask for it to be deleted | members | 8 |
| L1 | Apply to lead a tribe | members (so they can see what applying is) | 19 |
| L2 | After you apply: your referees, the interview, the decision | members | 9 |
| L3 | Your training: the Academy and the safeguarding declaration | tribe leaders | 15 |
| L4 | Run your week | tribe leaders | 13 |
| L5 | Your tribe's season | tribe leaders | 6 |
| L6 | Appointed or invited to lead? Start here | tribe leaders | 13 |
| L7 | Assistant leader: your part | assistant leaders | 10 |
| O1 | Give a reference | anyone with the referee's link | 7 |
| O2 | Give permission for a young person | anyone with the parent's link | 9 |
| O3 | You have been placed in a tribe | anyone with the placement link | 9 |

161 steps, 154 pictures (6 MB in all).

## Who sees what (the gate)

One rule, in `src/lib/guides/access.ts`, used by the library page, the guide page and the picture route, so a picture can never be fetched by someone who may not read its guide.

- **Everyone with an account holds the member role**, so a member sees the member guides and nothing else. A **tribe leader** sees the member guides and the leader guides. An **assistant leader** sees the member guides and the assistant's. A **pastor** sees the member guides (their own come in the office stage). The hidden owner can open everything.
- **A guide for someone else** says, politely, *"This guide is for someone else."* It shows nothing of what is in it, and its pictures answer with the same plain 404 as a picture that does not exist. A visitor is sent to sign in and brought back to the guide.
- **Tribe leaders also see "What other people see"**: what their assistant reads, and the three pages a referee, a parent and a placed member are shown from an email. Assistants see the leader's week the same way. Pastors see the email pages. **Members do not**, so they are never shown a leader's screens.
- **The email pages and sign-in are open to anyone with the link**, signed in or not, because the person they are for has no account yet. A visitor to `/guides` sees only those four, on one shelf, with a **Sign in** button.
- The shelves come in order of responsibility (a person with several roles sees the most senior shelf first), and each guide appears once.

## What the person sees

- **Library**: a hero, search ("What do you want to do?"), a chip for each shelf, and a card for each guide that shows a phone with its first picture, the steps and the minutes.
- **Reader**: one step at a time. A numbered list of the steps on the left on a computer; a bar of steps across the top on a phone. On each step: what to do in one to three short lines, the picture of the real screen with a ring around what to press (the ring is placed from where the control really was when the picture was taken), and where it helps a *Tip*, a *Why*, a *Be careful* or an *Example*. Arrow keys and swiping move between steps. A picture opens large.
- **It remembers where you stopped**, on that phone only (a small note in the browser, nothing sent to the church). **See every step** shows the whole guide on one page, and the same page prints cleanly.
- **A small "?" in the header** of the app takes each person, from the page they are on, to the guide for it. A leader on *This week* is offered *Run your week*; their assistant, on the same page, is offered *Assistant leader: your part*; a member on *Your information* is offered that guide. A page with no guide shows nothing, and a member is never pointed at a leader's guide.
- **Account menu → How-to guides** opens the library.

## How the pictures are made, and why they can be trusted

The guides are typed data, and the **same data feeds the website and the picture maker**, so the words and the pictures cannot drift apart. The picture maker (`bash scripts/guide-pictures.sh`) builds the site on a throwaway database, makes up a cast of people ("Ngozi Example", "Kemi Example"), walks the real screens in a real browser, and photographs each step.

- Every control a step tells the person to press is written `[[like this]]` and the maker **fails the picture if that control is not on the pictured screen**. A unit test also fails if the words are not in the app's source, so a renamed button breaks the build instead of leaving a stale guide.
- It **refuses any page that shows a name or email that is not made up** (emails must end in `@example.org` or `@example.com`). No real person is in a picture.
- It refuses a ring that is outside the window, or an area too tall to show ("Ring less of it").
- When you change a screen, run it for that guide again (`bash scripts/guide-pictures.sh L4`), then rebuild. It needs a normal user (Postgres will not run as root) and Chromium.

## Before you start

1. Nothing to back up (no database change).
2. Nothing to tell the office.

## Deploy

1. **Deploy the website.** That is all. The pictures are included in it (`next.config.ts` makes sure they travel with the page that serves them).
2. If your host asks, the pictures are in `content/guides/pictures/`, 6 MB.

## Check it works (ten minutes)

1. Signed out, open `/guides`. You should see four guides on one shelf and a **Sign in** button. Open **Give a reference**; it opens with no sign-in. Open `/guides/run-your-week`; it should send you to sign in and bring you back.
2. Sign in as a member. **Account menu → How-to guides.** You should see **For every member** and nothing for leaders. Open `/guides/run-your-week` by hand: *"This guide is for someone else."*
3. Sign in as a tribe leader. **For tribe leaders** comes first, starting with the Tribe Card guide, then **For every member**, then **What other people see**.
4. On the leader's **This week**, press the small **?**. It should open *Run your week* on a matching step.
5. Open a guide on a phone. Swipe, press **Next**, press a picture to open it large, press **See every step**. Nothing should scroll sideways.

## Existing files this package changes

- `src/components/shell/AppShell.tsx`: the small "?" in the header. It shows only when the page has a guide for that person.
- `src/components/shell/AccountMenu.tsx`: a **How-to guides** link.
- `src/proxy.ts`: `/guides` is let through for signed-out visitors (each guide still checks its own door).
- `next.config.ts`: the pictures are bundled with the picture route.

Everything else is new: `src/app/guides/**`, `src/components/guides/**`, `src/lib/guides/**`, `content/guides/pictures/**`, `e2e/pictures/**`, `scripts/guide-pictures.sh`, and the tests below.

## Tests

- `tests/unit/guides.test.ts` (31 tests): the gate for every role, every guide once, no email page on an ordinary shelf, short lines in each step, every `[[control]]` is spelled somewhere in the app, every step that shows a screen has its picture at the size the page was told, no leftover pictures, none over 250 KB, no real person's name in the words, and the help button only ever points at a guide its person may open.
- `e2e/journeys/34-guides.ts` (the browser journey, 43 checks): a visitor, a member, a tribe leader, an assistant leader and a pastor each open the library and see only theirs; a member opening a leader's guide is told it is for someone else and its pictures are a 404; the "?" takes each person to the right guide; the reader shows its picture, moves with the arrow key, and shows every step; nothing scrolls sideways on a phone.

## The way back

There is no database change, so there is nothing to undo there. To take the library out, remove the files this package adds (the folders above) and put back the four existing files from your last package. The rest of the app does not depend on any of it.

## What was checked, and what was not

Checked on a throwaway database built from the files, with a test browser:

- Type-check and lint clean. Unit tests: **2,207 pass** (71 files), 31 of them the guides' own.
- **All 154 pictures were taken again from the final build, with no failures, and every one was looked at** (contact sheets, one guide at a time) for a wrong crop, a ring on the wrong thing, a real name or email, and text cut off.
- Browser journeys: the whole suite was run on the final build. **31 of 32 passed on the first run**, including `34-guides` (the new one, 43 checks) and every journey that draws the app's header (the "?" button is new there).
- The one that did not pass is `29-admin-menu`: the check *"the / key opens the sheet with the search ready"* read the focused box immediately, but `AdminShell.tsx` puts focus in the search box 30 ms after the sheet opens. It failed once and passed on the next two runs (68 of 68). This package does not touch that file or that journey; the check is a timing race that already existed, and it shows up when the machine is busy. It is worth a one-line fix to wait for the focus, and it is left alone here so that this package changes only what it says.
- The library and the reader were opened on a phone and on a computer, for a visitor, a member, a tribe leader and an assistant leader. Nothing scrolls sideways.
- **Not** checked: a real phone, a real person following a guide from start to finish, and the way a printed guide looks on paper. Please have one member and one leader try theirs.

## Found while photographing the screens (not changed)

1. **An assistant leader has no button to the tribe page.** `/lead/tribe` opens when typed by hand, but the **Lead** tab says *Lead another tribe*. The assistant guide therefore sends them to **This week** and **Care tasks**, which do have buttons.
2. **An assistant's Home shows "Find your tribe"** until the church puts them in a tribe. It is correct, but a new assistant may read it as an instruction to apply as a member.

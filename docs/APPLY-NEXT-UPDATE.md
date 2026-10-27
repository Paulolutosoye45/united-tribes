# Next.js 16.4.3 security update: how to apply this package

This zip holds **only three files**: `package.json`, `package-lock.json` and this note. Unzip it so its `united-tribes` folder merges into your project (say yes to replacing the two package files). It changes **no application code and no database**, and it is deliberately separate from any feature, so that if anything ever looks different afterwards you know which of the two to look at.

## What it does

| Package | Was | Now | Why |
| --- | --- | --- | --- |
| `next` | 16.4.0 | **16.4.3** | The latest stable release. 16.4.0 is affected by three published advisories (below). |
| `eslint-config-next` | 16.4.0 | **16.4.3** | Kept in step with `next`. |
| `zod` | ^4.6.5 | **^4.6.7** | A published high-severity advisory for versions before 4.6.6. |

`sharp` (used by Next's image optimiser) moves with it to 0.35.5 inside the lock file, which is the version the SVG advisory asks for.

The three Next.js advisories, and what they meant for this app:

- **Server Actions denial of service (GHSA-p3m5-59mp-jv5r).** This one applied. Most buttons in the app are Server Actions (57 files). It is fixed from 16.4.1.
- **`use cache` remote code execution (GHSA-673q-mjm6-r5xr).** The app does not use `use cache`, so it was not exposed. Closed anyway.
- **SVG image optimiser remote code execution (GHSA-2464-fhr4-w9xw, CVE-2026-96889).** The app's only use of the image optimiser is the sign-in page and it serves no SVG, so it was not exposed. Closed anyway.

`npm audit` now reports **0 vulnerabilities**.

## Before you start

1. Nothing needs backing up in the database: it is not touched. Keep the two package files you have now so you can go back (see the way back).
2. Node 22 or newer, as before (the project's `engines` already says so; Next 16.4.3 itself needs 20.9 or newer).

## Deploy

1. Unzip over the project.
2. Install exactly what the lock file says: `npm ci`
3. Deploy the website as usual. **No new settings, no database file.**

## Check it works (five minutes)

1. Open the sign-in page. It loads, with its picture.
2. Sign in as yourself. The home page loads and the menu works.
3. Press any button that saves something (for example, change a note and save). It saves and says so. Buttons are Server Actions, which is the part of Next.js the update touches most.
4. Open **God Mode** and its tabs. Each opens.
5. Open one of the links the platform sent you earlier (a "Your tribe" link, an invitation). It opens as before.

## The way back

Put your two old package files back (`package.json`, `package-lock.json`), run `npm ci`, deploy. Nothing else changed, so nothing else needs undoing.

## What was checked, and what was not

Checked on the project as it stands now (the app with every release applied up to Exports and Reports, release one):

- **Type check and lint**: clean on 16.4.3.
- **Unit tests**: 78 files, 2,288 tests, all passing.
- **A production build**: succeeds.
- **All 33 browser journeys** (Chromium, against that production build): every journey passes (1,901 checks, no problems). They cover sign-in, every role's pages, God Mode, the messaging pages, placement, exports and the guides.
- **`npm audit`**: 0 vulnerabilities.

**Not** checked: your own hosting (a preview deployment first is the safe way, `docs/RELEASE.md`); a real phone.

If your host offers a build cache, it is worth clearing it for this one deployment, because the lock file moved a compiler binary with the version.

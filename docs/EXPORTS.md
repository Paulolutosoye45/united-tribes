# Exports and Reports (release one)

Tribe leaders, community champions, coaches, the office and the pastorate can take **a spreadsheet or a printed page** with them. The same data can feed the church's other reporting tools, as coded tables with no names.

**Everything ships Off. Every switch for this feature is in God Mode and nowhere else.** An administrator, a director and a pastor cannot move any of them, and the database refuses them if they try to call it directly.

## Two lanes

| | Insight | People |
|---|---|---|
| What it holds | Counted or coded figures. No names of members, and no names of leaders either. | Named people. |
| Where it may go | May feed other reporting tools (the Open Data Pack, a standing link). | The church's own use only. Never sent to another platform. |
| What a person is asked | Nothing. | Why they need it (Pastoral care, Planning or Reporting) and a promise to look after it. |
| How it opens | Rehearsal, then Limited or On. | Rehearsal first, **and** the impact assessment recorded as signed, then Limited or On. |

## The packs

Fourteen packs, one switch each. Twelve are in this release.

| Pack | Lane | For | Formats | What it is |
|---|---|---|---|---|
| Tribe sheet | People | Leader, assistant leader (own tribe) | Excel | The members, how to reach them, where each stands. |
| Attendance register | People | Leader, assistant leader (own tribe) | Excel, printed page | Members against the season's weeks, to tick on paper or a tablet. |
| Leaders roster | People | Pastor, director | Excel | Each tribe with its leader, assistant and coach, and who is certified. |
| People and roles | People | Admin | Excel | Names, roles and since when. No contact detail. |
| My tribes at a glance | Insight | Coach | Excel, printed page | Each tribe with attendance, the thriving rate and where it stands. |
| Community report | Insight | Community champion (own community) | Printed page, Excel | One community's season. |
| Pastorate one-pager | Insight | Pastor | Printed page | How it is going, the targets, where care is needed. |
| Programme report | Insight | Director | Printed page, Excel | Every figure for the season. |
| Tribes health sheet | Insight | Director, admin, pastor | Excel | Every tribe's numbers, no names. |
| Supply and demand | Insight | Director, pastor | Excel | Where members want to be and where the seats are. |
| Message volumes | Insight | Admin | Excel | How many messages went out each day, by kind and outcome. Never the wording. |
| Insight feeds | Insight | Data lead, director, admin | The Open Data Pack (a zip of CSV files) and standing links | Seven coded tables with a dictionary and checksums. |
| Know your tribe | People | Leader | Printed page | **Second release.** |
| My data pack | People | Member | Excel, printed page | **Second release.** |

A pack that is Off, or not for a person's role, is not listed for them at all: the Studio hides it, and the database refuses it if asked directly.

## The switchboard (God Mode → Exports)

`/god/exports`. Every control is here and only the unlocked owner can move it.

- **Each pack has a position.** *Off* (nobody can make it), *Rehearsal* (the named testers only, and every page says REHEARSAL), *Limited* (the roles, communities or tribes you choose, and the testers), *On* (everyone whose role includes it).
- **Opening beyond the testers needs a reason** (at least eight characters, kept in the log), and **shows how many people the position would reach before it is saved**. Save waits until you have looked.
- **A People pack must have been in Rehearsal**, and **the impact assessment must be recorded as signed** (the day, and who signed it), before it can go to Limited or On.
- **Formats**: Excel, CSV, printed pages. A format that is off cannot be made by anyone, whatever the packs say.
- **Ways to receive a file**: *Download from the Studio* (the only one in this release).
- **Doors for reporting tools**: *Open Data Pack* and *Standing links*.
- **Pause all exports**: every file at once. Every pack acts as Off, links already made stop opening, the Studio shows nothing. Switching it back returns everything as it was.
- **Stop all People files**: every named file at once. The coded reports keep running.
- **Testers**: add by name. A good first group is one director, the data lead and three tribe leaders. The owner does not need to be one.
- **Unusual use**: more named files than this number from one person in an hour (it starts at 5) is flagged in the log and sends the data lead a notice. The detail is on the owner's page; the data lead is told only that it happened.
- **Every change** is written to a log of changes, with the reason, kept two years, and to the owner's record.

**Fail closed.** If a switch cannot be read, it is Off. A pack's position, the format, the delivery and the pause are all checked every time a file is asked for and **again every time a link is opened**, so switching something off stops links that were already made.

Sending files to a named destination (another system, a form, a folder) is **not in this release**, and there is no switch for it, because nothing leaves the church that way.

## How a file is made

1. The person chooses a file, checks it (which tribe, which season, which format, and for a People file why they need it), and presses **Make**.
2. The database checks their role, the pack's position for them, the format, the delivery and the pause, writes one line to the log, and gives back a private link. The link is shown once. **Only its fingerprint is kept.**
3. The link works for **24 hours, for that one account only**. Another signed-in person, or someone not signed in, is refused with the same words as a link that never existed.
4. When it is opened, the database checks the person and the pack again, and then every figure in the file is read **as that same person**, so the database's own rules apply a second time.
5. The file is **built when it is opened and sent. Nothing is stored.** The log gets the number of rows.
6. **Delete now** ends the link at once. "My files" lists the last 30 days, with the status of each.

A printed page is made the same way, as a page in the browser with a button to print or save as a PDF. It is made from the same typed tables as the spreadsheet, so the page and the spreadsheet cannot say different things. Each page of the printout has a footer naming the file.

## What is left out, and why

- **Members under 18 are counted and never listed.** The About tab or the page says how many were left out.
- **A number a member asked to withhold is left out.** A WhatsApp number is in a file only if the member agreed to be messaged on WhatsApp and did not ask for their details to be withheld.
- **Insight files hold no leader or member names**; where a leader matters it says whether a tribe has a coach and whether its leader is certified.
- **CSV files hold no free text** (nothing a person wrote), and every text is guarded so that a spreadsheet cannot read it as a formula.
- **The log holds facts about a file, never its contents**: who, as which role, which pack and format, why, how many rows, and the tribe, community or season chosen. It is kept **two years**; the daily clean-up (`worker_export_sweep`) removes older lines and standing links a month after they ended.

## The Excel files

Real Excel, not a text file in disguise: one Excel Table per data table (filters, banded rows), typed columns (dates as dates, percentages as percentages, phone numbers always as text so a leading zero is never lost), a frozen header row, print set-up (landscape, fit to width, header repeated on every page, a header and footer naming the file), an **About** tab (what is in the file, what was left out and why, the file's id) and a **Dictionary** tab (every column and what it means). No formulas, so nothing in a file runs. The same data always gives the same bytes.

## The Open Data Pack and standing links

- **Open Data Pack**: a zip made on request: seven coded tables (members, tribes, weekly, care weekly, messages daily, AI fields, KPI daily), `dictionary.csv`, `README.txt` with the rules for using it, and `manifest.json` with a SHA-256 for every file. Member rows carry a code that cannot be turned back into a name.
- **Standing link**: a secret web address a reporting tool reads on a schedule. One table, read only, **90 days**, renewable, revocable at once. It is shown once. Anyone with the address can read that table, so it is treated like a password. Making one needs the pack to be Limited or On, and the *Standing links* door open. It works with no sign-in; every fault (wrong secret, ended, wrong table, switched off) gives the same plain "Not found".

## Files

| Piece | File |
|---|---|
| Tables, switches, functions, log | `supabase/migrations/20261231000100_exports.sql` (34 functions; changes no existing function) |
| Way back | `supabase/rollback/20261231000100_exports.down.sql` (drops the functions only; keeps the tables and the log) |
| Typed model, Excel writer, CSV writer, text guard | `src/lib/exports/` (`model`, `xlsx`, `csv`, `guard`, `display`) |
| What each pack puts in its tables | `src/lib/exports/builders.ts`, `load.ts`, `feeds.ts` |
| The file route (as the person, nothing stored) | `src/app/(app)/exports/file/[token]/route.ts` |
| The printed page | `src/app/(focus)/exports/print/[token]/page.tsx`, `src/components/exports/PrintSheet.tsx` |
| The standing link route (public) | `src/app/feeds/[token]/[table]/route.ts` (and `/feeds` in `src/proxy.ts`) |
| The Studio, My files, standing links | `src/app/(app)/exports/`, `src/components/exports/` |
| Entrances (shown only when a pack is open to the person) | `src/components/exports/ExportEntrance.tsx` on the tribe, dashboard, reports, community and admin pages |
| **The switchboard** | `src/app/(app)/god/exports/`, `src/components/god/ExportBoard.tsx`, `ExportPacks.tsx`, `ExportLog.tsx` |
| Tests | `tests/db/exports.test.ts` (50), `tests/db/exports-rollback.test.ts` (8), `tests/unit/exports-*.test.ts`, `tests/unit/messaging-hooks.test.ts`, `e2e/journeys/35-exports.ts` |

## Not in release one

- **Second release**: a server-made PDF, the *Know your tribe* cards, a member's *My data pack*, and links sent by email.
- **A later release**: sending to a named destination with the member's consent (and its switches). A live connection is not a switch.
- Message volumes use the last 90 days; choosing dates is not offered, because dates are not among the choices the log keeps.
- The sample workbooks have been checked with a spreadsheet reader and LibreOffice. **A person should open one in real Excel before the first leader is given access.**

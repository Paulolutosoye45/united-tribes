# Contact gaps: find the members a leader cannot reach, and ask them (how to apply this package)

This zip holds **only the files that changed** since the WhatsApp mode package (`united-tribes-whatsapp-mode.zip`). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). Everything from before must already be applied, up to and including `20270105000100_whatsapp_mode.sql`. No new packages. **No new settings, and nothing to add on your hosting for this one.** Nothing here goes to Meta: the only message it sends is an ordinary email.

## What was wrong

Leaders told us they could not find their members' WhatsApp numbers. A leader sees a number only when a number is saved, the member has said **yes to WhatsApp**, and the contact is open. There was no way for the office to see who was missing which, and no way to ask.

## What it does

- **Admin → People → Contact gaps**: counts by reason, the people (name, tribe, leader, reason, when last asked), filters, a trend, a download with no phone numbers, and **Write to the people who can be asked**.
- **Announcements**: a new choice, **Cannot be reached on WhatsApp**, with three ready notes (**How would you like to be reached?** for everyone; **Add your number**; **Tick WhatsApp if you are happy**).
- **A leader's button** on the Lead page: **Ask Femi to add it**, one email, in the leader's name, no more than 20 a day, never to the same person twice in 14 days or more than three times.
- **A member's note** on Home, My page and Profile, with **Not now** (a week), and a button that offers the number they sign in with, which only fills the box.
- Two guides: **Find the members a leader cannot reach, and ask them** (office) and **Choose how you are reached** (everyone, with a part for leaders).

It never ticks WhatsApp or saves a number for anyone. Read `docs/CONTACT-GAPS.md` for the full list.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone. It starts **Off**.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270106000100_contact_gaps.sql`

   It adds one Switchboard function (**Contact gaps**, Off), three small tables (asks, prompts put away, daily counts) and the functions behind the screens, and redefines four functions (`audience_clean`, `audience_base`, `audience_members`, `broadcasts_release`) so Announcements knows the new audience. No member, number, consent, seat or email is changed or deleted. The way back is `supabase/rollback/20270106000100_contact_gaps.down.sql`: it puts the four functions back exactly as they stood and drops everything it added. Put the application files back **before** running it.
2. **Check**, in the SQL editor: `select count(*) from pg_proc where proname in ('contact_gaps_state','contact_gaps_report','contact_gaps_export','tribe_reach_gaps','contact_ask_send','my_reach','reach_prompt_dismiss');` returns `7`.
3. **Then the app**: deploy the website.

Run the database file **first**. If the website goes out first, every new screen answers "Off" and everything else is exactly as before, so nothing breaks.

## Check it works (ten minutes)

1. **God Mode → Features → Contact gaps**: it says Off. Move it to **Rehearsal** (give a reason). **Admin → People → Contact gaps** now lists people with the reason beside each; the note at the top says nobody is asked yet. A leader and a member see nothing new.
2. Move it to **On**. Open **Contact gaps** again: press a reason box to narrow the list; press **Download the whole list** and open it (names, tribe, leader, reason: no numbers).
3. On the **Contact gaps** page itself (not on Announcements), press **Write to the people who can be asked**. It is under the boxes, and it shows only when Contact gaps is **On** (not Rehearsal) and you are an admin, a director or a pastor; when it is hidden, a line beside the download says why. The composer opens on **Cannot be reached on WhatsApp** and counts who will get it. On the next step, **Add your number** fills a note. Do not send it unless you mean to.
4. As a leader with someone in the list, open **Lead**: **People whose number you cannot see**, with **Ask … to add it**. (This sends a real email: use a tribe where that is fine, or a test member.)
5. As a member with no number, open **Home**: the note appears; **Not now** removes it for a week; **Choose how I am reached** opens the contact card.

## Things to know

- **It starts Off, and Rehearsal sends nothing.** Rehearsal shows the office page only; leaders, members and Announcements see nothing new until On.
- **The download is on the page, not one of the 14 export packs.** It is for the admin, director and data lead only, and is logged.
- **The trend fills in as the page is opened.** A day's count is saved the first time the page is opened that day, so the line has a point only for days someone looked.
- **The member's button opens the Profile**, where the note also sits above the contact card.
- **Someone placed by the church who has not yet answered** (their contact is held) is shown as "Contact not open yet" and is never asked; their contact opens by itself.
- **The care lead is shown the page in the Admin menu, but has no Admin entry in the main menu,** so for now they open it at `/admin/people/contact-gaps`. Tell me if you want a link on their Care page.
- **A person put right after the list is made is skipped** when an announcement is released, with the reason "put it right since the list was made".
- **The guides have no pictures** (the screens appear only when the function is On), like the WhatsApp mode guides.

## Existing files this package changes

- **Database:** one new migration and its way back (above).
- **Announcements:** `src/lib/outreach/labels.ts` and `types.ts` (the audience, three left-out reasons, three notes), `src/components/outreach/AudiencePicker.tsx` and `Composer.tsx`, `src/app/(app)/admin/announcements/new/page.tsx` and `[id]/page.tsx`.
- **Leader:** `src/components/leaders/LeadingTribe.tsx`, `src/app/(app)/lead/page.tsx`. New: `src/components/leaders/ReachAsk.tsx`, `src/app/(app)/lead/reach-actions.ts`.
- **Member:** `src/components/profile/ContactCard.tsx`, `src/app/(app)/profile/page.tsx` and `actions.ts`, `src/app/(app)/home/page.tsx`, `src/app/(app)/my/page.tsx`. New: `src/components/profile/ReachNotice.tsx`.
- **Office:** `src/lib/admin/nav.ts`, `src/lib/auth/roles.ts`. New: `src/app/(app)/admin/people/contact-gaps/page.tsx` and `download/route.ts`, `src/components/contact-gaps/GapTrend.tsx`, `src/lib/contact-gaps/gaps.ts` and `server.ts`.
- **Email and switch:** `src/lib/messaging/templates.ts` (registers the one new email). New: `src/lib/messaging/templates-reach.ts`. `src/lib/features/types.ts`.
- **Guides:** `src/lib/guides/catalogue.ts`, `context.ts`. New: `content/contact-gaps.ts`, `content/be-reached.ts`.
- **Docs:** `docs/MESSAGES-AUDIT.md` (regenerated: one more message). New: `docs/CONTACT-GAPS.md`, this file.

## Existing tests this package changes (all disclosed)

- `tests/db/foundation.test.ts`: the seven new screen functions are added to the list the app may call. Nothing checks less than before.
- `tests/unit/admin-nav.test.ts`: the Admin menu now has 28 pages (was 27), and a care lead's menu lists Contact gaps.
- `tests/unit/features-switchboard.test.ts`: `contact_gaps` is added to the list of functions.
- `e2e/journeys/36-profiles.ts` and `39-my-page-for-everyone.ts`: thirteen functions can be moved on the Features page (was twelve).
- `tests/unit/fixtures/message-params.ts`: the new email's sample fields.
- `scripts/rehearse-rollback.sh`: the two new test files are on the list of new tests.
- No existing rollback test, email golden file or other test changed.

# Contact gaps: the members a leader cannot reach on WhatsApp

A leader sees a member's number only when **three** things are true: a number is saved, the member has said **yes to WhatsApp**, and the member's contact is **open** (not held back, not "Don't share"). Most leaders who "can't find a member's number" are missing one of these. This function finds those members, says which one is missing, and lets the church ask them, kindly, by email. **It never saves a number or ticks WhatsApp for anyone.**

It is on the owner's Features page (God Mode → Features) as **Contact gaps**, for the whole church only, with three positions: **Off** (the start), **Rehearsal** (the office list and counts only; nobody is asked and no member sees anything) and **On**.

Migration: `supabase/migrations/20270106000100_contact_gaps.sql`. Way back: `supabase/rollback/20270106000100_contact_gaps.down.sql`. Tests: `tests/db/contact-gaps.test.ts` (38), `tests/db/contact-gaps-rollback.test.ts` (9), `tests/unit/contact-gaps.test.ts` (24), browser journey `e2e/journeys/46-contact-gaps.ts`.

## The reasons

| Reason | What it means | Can the church ask? |
|---|---|---|
| **No number saved** | Nothing for a leader to use. | Yes, by email |
| **Number saved, WhatsApp not agreed** | The leader sees nothing, because the person has not said yes. | Yes, by email |
| **Number looks made up** | The last seven digits are one digit repeated. | Yes, by email |
| **No way to be reached** | No number, and email is switched off or bounces. | No. Only a person can ask, in person |
| **Contact not open yet** | A church placement waiting for the person's answer. It opens by itself. | No |
| **Said "Don't share"** | Their choice. | No, never |

Teenagers (under 18) and anyone with an open deletion request are never listed and never asked.

## What each person sees

| Who | Where | What |
|---|---|---|
| Admin, director, data lead | **Admin → People → Contact gaps** | The counts by reason, the people (name, tribe, leader, reason, when last asked), a filter by reason and community, a trend, a download (spreadsheet; no phone numbers), and **Write to the people who can be asked**. |
| Pastor, care lead | the same page | They can read the list. They cannot download it or ask. (A pastor can write an announcement as usual.) |
| Admin, director, pastor | **Announcements → Write → Who is this for?** | One more choice, **Cannot be reached on WhatsApp**: both groups, only no number, or only a number without a yes. The usual left-out rules apply, plus three of its own (below). Three ready notes: **How would you like to be reached?** (everyone), **Add your number**, **Tick WhatsApp if you are happy**. |
| A tribe leader | **Lead → Who has joined** | "People whose number you cannot see": first names only, never a number, never why. **Ask Femi to add it** sends one short email in the leader's name. Then "Femi was asked". If the person cannot be emailed, "Please ask in person". |
| A member with a gap | **Home, My page, Profile** | One quiet note: "Tell us how to reach you" (no number) or "Your leader cannot message you on WhatsApp" (number, no yes). **Choose how I am reached** goes to the contact card. **Not now** puts it away for a week. On the card: who can see the number, and, if they sign in with a phone number, a button that only fills the box with it. |

## The limits (kept in the database, not the page)

- A person is asked **at most three times**, and **not twice within 14 days**. This counts a leader's asks and an announcement's together.
- A leader asks only people **in their own tribe** (the leader, the assistant and the coach), and at most **20 a day**.
- An announcement leaves out, with a stated reason: anyone asked in the last two weeks (**asked recently**), anyone asked three times (**asked enough**), and anyone who has put it right between the count and the release (**put it right since the list was made**).
- The email says who can see a number (the tribe's leader, their assistant and the person's coach, and only if WhatsApp is ticked), that other members never do, that the choice is the person's, and that they can change it any time. It does not say they did anything wrong, and it has no number in it.

## What it never does

It never ticks WhatsApp, saves a number, changes a channel choice, or shows a leader a number they could not already see. "Use the number I sign in with" only fills the box; nothing is saved until the person presses Save, and WhatsApp stays unticked until they tick it. Off, every page, email and list is exactly as before.

## Kept

The event log records that the list was opened (the first page, unfiltered), that it was downloaded, and every ask by a leader (who asked whom, which kind). A daily count (by reason) is kept for the trend line; it holds no names.

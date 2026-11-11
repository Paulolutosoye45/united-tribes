# Fix 7, the heads-of-department list: how to apply

Everything before must already be applied, up to and including Fix 8 (`20270123000100_guide_release.sql`). It needs the leader cards package (`20270110000100_leader_cards.sql`) and the referee package (`20261214000100_referee_trust.sql`, for the phone reader), both long since in place.

**It has no switch, because it does nothing by itself.** Making a report sends nothing and changes nobody. Each thing that can be done from a report is its own button that an admin, a director or a pastor has to press.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270124000100_hod_reconcile.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('hod_email_norm','hod_results','hod_reconcile_run','hod_reconcile_get','hod_reconcile_list','hod_reconcile_tag','hod_reconcile_invite','hod_reconcile_delete');`
   It should say **8**. `select count(*) from pg_tables where tablename in ('hod_reconciles','hod_reconcile_rows');` should say **2**.
3. **Then the website.** It adds **Check the list of heads of department against the platform** to **Admin → People → Leader cards**, and the page behind it.

Run the database file **first**. If the website goes out first, the page says it is not available yet and nothing else changes.

The file replaces no function, adds no column to a table that already exists and adds no setting.

## What it does

Open **Admin → People → Leader cards → Check the list of heads of department against the platform**.

1. **Upload the church's list** (Excel or CSV) or paste it, titles first: Name, Email, Phone, Department, Goal (Goal is optional; each person needs an email or a number). It reads the usual alternative titles (Head of Department, E-mail Address, Mobile Number, Dept, and so on), a first name and a surname in two columns, two addresses in one cell, and a number a spreadsheet has turned into 2.348E+12. Up to 500 people at a time.
2. **Read the list** shows how many rows were understood before anything is saved. **Make the report** saves the list and works out where each person stands. Nothing is sent and nobody is changed.
3. **The report** says, for each row:
   - **Already a leader**: on the platform with a tribe this season, or an active appointment.
   - **Has an account, not appointed**: signed up, not leading a tribe. If they already hold the leader role the note says so.
   - **No account yet**: nobody has this email or number. If there is no email address the note says there is none to invite.
   - **On the list twice**: the same person as an earlier line (the note says which). Found the same way, so a person on two lines by email on one and number on the other is still one person.
   - **Could not tell**: an empty row, an email or number that is not valid, or an email and a number that belong to two different people.
   A person is found by their email, or by any number the platform holds for them (the one they gave for contact, the one they gave for WhatsApp, or the one they signed in with), written in any usual way (0803…, +234 803…, 2348031234567).
4. **Leaders the list left out.** Every leader on the platform this season who nobody on the list matched, with their tribe, department and where their card is. They may be on the list under another address.
5. **Read again every time.** The report is not frozen: a person who has since signed up or been appointed shows as they are now. The first line says how many of each, in words.
6. **Downloads**: the list with where each person stands (with the list's own emails and numbers, for the office only), the leaders not on the list (no numbers, no addresses), and **one Excel workbook with a sheet for each department** (a Summary first, then each department's people from the list together with the leaders the platform has in that department that the list left out, and a "No department" sheet last), so each head of department can be handed their own sheet. A report stays on the page, so it can be reopened and downloaded again later. The report also links to the **Leader cards board**, where the same leaders sit under their department with where each card is.

Then, each its own tap:

- **Put the departments on** puts the department on your list on each appointed leader who has none. A label only; **a department already set is never changed** (the page says how many differ). It can be run again.
- **Invite them** sends the existing leader invitation (the same email as inviting someone in People) to each person with no account who gave a usable email address, once per report. Admin or director only, as inviting anyone is. It shows how many first and asks you to confirm.
- **Delete the report** removes the report and the names, emails and numbers it holds. Nobody on the platform is changed.

The data lead can read a report and download the lists and the workbook, with the names, departments and results but not the list's emails or numbers. They cannot make, tag, invite or delete.

## Check it works (ten minutes)

1. As an admin, open the page and download the template. Fill in four rows: a leader you know is on the platform (by email), a leader by phone number only, someone you know has no account, and a row with a made-up email.
2. **Read the list**: it says 4 rows. **Make the report**: the first two say **Already a leader**, the third **No account yet**, the fourth **No account yet** too (an address that looks real but belongs to nobody), and an email like `not-an-email` says **Could not tell**.
3. Check **Leaders the list left out**: it names leaders you did not put on the list.
4. Check **Messages** and **People**: nothing was sent and nothing changed.
5. **Put the departments on**: the leader rows get their department. Run it again: it says there is nothing left. Change one department on the list and run again: the leader keeps the one they have.
6. As a pastor, open the report: **Invite them** is not shown. As a data lead, the page shows no buttons and no emails or numbers.
7. **Delete the report**: it is gone from the list.

## What it never does

Never sends anything when a report is made. Never appoints anyone, gives anyone a role or changes a tribe, a card or a seat. Never changes a department that is already set. Never shows an email or a number from the list to anyone but the office. Never finds the platform owner or anyone in another church. Never invites the same report twice, and never invites a person who already has an account. The log holds how many rows and how many of each, never a name, an email or a number.

## Known limits (so nobody is surprised)

- A person is found only by an email or a number the platform already holds. Someone on the platform with a different address from the list shows as **No account yet**, and is probably on **Leaders the list left out**: read the two together.
- **Invite them** sends to a person with no account. It does not appoint them: when they sign in they hold the leader role, as with any invitation, and the Leader Desk takes them from there.
- A person who has an account and is not appointed is only counted; this does not invite or appoint them. Appoint them from **God Mode → Appointments**.
- A department on the list shorter than 2 characters or longer than 60 is not put on a leader.
- The page shows the newest 20 reports. An older one can still be opened from a link you kept.
- Downloads of a report are not written to the log (they carry only what was uploaded, not what the platform holds).

## Go back

Run `supabase/rollback/20270124000100_hod_reconcile.down.sql`. It drops the eight functions and the two tables (the reports, and the contacts they hold). Departments already put on leaders stay (they are ordinary labels), invitations already sent stay sent, and nobody's role changes. Put the website files back before you run it.

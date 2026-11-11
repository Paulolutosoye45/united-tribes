# The Leader Desk extras: how to apply

Everything before must already be applied, up to and including the Leader Desk, Phase 2b-2 (`20270119000100_desk_open.sql`), the assistant recommendations (`20261226000200`) and WhatsApp mode (`20270105000100`). The file stops with a clear message if one is missing.

**Nothing changes for anyone until you act.** "Yes, as assistant" and "Recommend as leader" on a row work inside the Desk's own Rehearsal / On switch, exactly as the offers do. **WhatsApp for the Desk is Off** until you switch it on (Desk → Sending → WhatsApp), and while it is Off every Desk message goes by email as it does now.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270125000100_desk_extras.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname in ('desk_assistant_put_forward','desk_person_lead_options','desk_whatsapp_on','desk_whatsapp_set','desk_whatsapp_state');`
   It should say **5**.
3. **Then the website.** It adds the "Yes, as assistant" button on the offer page, "Recommend as leader" on a waiting member's row, the WhatsApp switch on the Sending tab, one new email and one new wording (see below) in Admin → Messages, and four Desk messages in WhatsApp mode's table of classes.

Run the database file **first**. If the website goes out first, the new button on the offer page will say the answer is not open yet and nothing is recorded.

The file replaces seven functions (`desk_offer_complete`, `worker_desk_offer_info`, `worker_desk_offer_answer`, `desk_group_leader`, `desk_mail_send`, `desk_offer_open`, `desk_offer_tick`). Their old text is in the rollback file, so you can go back exactly.

## One new email, and one that says a little more

* **Desk: someone offered to assist** (new; to the leader who said yes, naming the member who offered). It says the church office decides and a pastor decides every application.
* **A leader recommended an assistant leader** (the office's existing email) now has a second wording, used only when the recommendation came from a Desk offer: it says a member who was asked to lead said they would rather assist, that the leader has been told and can withdraw it, and that nothing is decided until someone in the office does. A recommendation made the usual way reads exactly as before.

Look at both in **Admin → Messages**. Neither carries a phone number.

## The one WhatsApp template (do this before switching WhatsApp on)

The Desk's four messages share one wording, `desk_proposal`. Meta must approve it before WhatsApp can carry them:

1. `npm run templates` (as for earlier templates).
2. Wait for Meta to approve it. Until then a Desk message that would go by WhatsApp falls back to email, and nothing is lost.
3. Switch **Desk → Sending → WhatsApp** to **On** with a reason. Start while the Desk itself is on **Rehearsal**: a Rehearsal sends nothing, so you can look at who it *would* reach and how.

## Check it works (fifteen minutes)

1. As a member you are offering a group to, open the offer page: it now has **Yes, as assistant** beside Yes and No. Say it on a test offer: the page says it is recorded as a no to leading, that the church office decides, and that a pastor decides every application. The group's card shows "Offered to assist".
2. Let the next backup say yes to leading. The new leader gets the "someone offered to assist" email, and the tribe's **Assistants** list shows the recommendation for the church office.
3. **Waiting for a tribe**: each row has **Recommend as leader**. A member who cannot be offered any group shows why in words.
4. **Sending → WhatsApp** is **Off**. Send a Rehearsal: no WhatsApp, no email. Turn it **On** (with a reason), and check one test member who has agreed to WhatsApp: the message is queued as WhatsApp; a member who has not agreed gets email. Turn it **Off**: anything still waiting goes back to email.

## What it never does

* Appoint anyone as an assistant. It only passes a name to the church office's list.
* Send anything to a person under 18, to someone who stopped messages, to someone with a care flag or a bounced address. The Desk's blocks are the same as before.
* Write a phone number, a note or a reason to a message, a row or a log line.

## Undo

`supabase/rollback/20270125000100_desk_extras.down.sql`. Switch WhatsApp for the Desk **Off** first. Put the website files back before you run it. Messages already sent stay sent. A recommendation already put forward to the church office stays. An offer answered "Yes, as assistant" keeps its place in the list but loses the answer word (it was a no to leading). See `tests/db/leader-desk-extras-rollback.test.ts`.

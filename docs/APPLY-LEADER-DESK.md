# Leader Desk, Phase 1 (how to apply)

Only the files that changed since the Owner requests fix. Everything before must already be applied, up to and including `20270115000100_owner_requests.sql`, and Package 6b (`20270114000100_placed_answers.sql`).

**It has a switch and starts Off.** Until you move **Leader Desk** to **Rehearsal** or **On** in God Mode → Features, the page says it is switched off. **Phase 1 sends nothing in any position, and there is nothing to add to your hosting settings.**

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone.

## Deploy, in this order

1. **Database**, one file, once (`supabase db push`, or paste it in the SQL editor and press **Run**):
   `supabase/migrations/20270116000100_leader_desk.sql`
2. **Check**, in the SQL editor:
   `select count(*) from public.feature_registry where key = 'leader_desk';`
   It should say **1**.
3. **Then the website.**

Run the database file **first**. If the website goes out first, **Leader Desk** shows "switched off" until the file is run.

## Check it works (ten minutes)

1. **God Mode → Features → Leader Desk** is **Off**. Open **Leader Desk**: it says it is switched off, with a link to Features.
2. Set it to **Rehearsal**. Open it: three tabs, a note that nothing is sent, and the season line.
3. **Waiting**: pick a person. They show days waiting, one reason no tribe fits (or none), and a masked number.
4. Press **Show number** between 8 am and 8 pm Lagos time. The number appears and hides again after a minute. Outside those hours the page says to try in calling hours.
5. **Proposals → Start a draft group**, make one, press **Who would suit it**, **Add** a person. The group shows its checks and average score.
6. **Leaders**: the three pools, each person with their signal and the five parts.
7. As an admin, a pastor and a member, open `/god/leader-desk`: none of them can see it.

## Go back

Run `supabase/rollback/20270116000100_leader_desk.down.sql`. It removes only the Desk's functions, three tables and Switchboard entry. Nothing else changes.

---

# Leader Desk, Phase 2a (emails): how to apply

Apply this **after** Phase 1 is in and working. Leader Desk stays on **Rehearsal** for this: nothing is sent.

## Before you start

1. **Back up**: Supabase → Database → Backups → manual backup.
2. Nothing to tell anyone. No member hears anything while the switch is on Rehearsal.

## Deploy, in this order

1. **Database**, one file, once:
   `supabase/migrations/20270117000100_desk_proposals.sql`
2. **Check**, in the SQL editor:
   `select count(*) from pg_proc where proname like 'desk\_%' or proname like 'worker\_desk\_%';`
   It should be **44** (21 from Phase 1 plus 23 from this file; Phase 1 also added `leader_desk_any`, which this does not count).
3. **Then the website.** It adds the **Sending** tab, **Email a proposed group**, **Check interest**, the private page `/d/…`, and the extra call in `/api/cron/tick`.

Run the database file **first**. If the website goes out first, the Sending tab says the Desk's email is not available yet, and the private page says it is not open.

## Check it works (fifteen minutes, on Rehearsal)

1. **God Mode → Leader Desk → Sending**: it says **Rehearsal. Nothing is sent**, today's count, the four limits.
2. Change a limit with a reason; the reason is required and the new number shows.
3. **Waiting**: press **Email a proposed group** on a member. It shows the tribe and says nothing is sent. Press **Write it down**. The Sending tab lists it as "Would have been sent". Check **Messages** (or the queue): no email was made.
4. **Proposals**: put two waiting members in a draft, press **Check interest**, then **Write it down**. The card says "Written down for 2. Nothing was sent." and each member shows "Would be asked".
5. Press **Check interest** again: it says both were already asked.
6. As an admin, a pastor and a member, open `/god/leader-desk?tab=sending`: none of them can see it.

When you go on **On** (after the one-week Phase 1 check and the pastor's approval of the Lead signal), start with one member you know, press **Email a proposed group**, and open the email on your phone: three buttons, **Stop these emails** at the bottom, nothing that sounds like a seat has been given.

## Go back

Run `supabase/rollback/20270117000100_desk_proposals.down.sql`. It removes the Desk's email functions and four tables and puts the Phase 1 Switchboard text back. Nothing else changes: no member, seat, tribe, message or notice. Emails already queued stay in the queue; their link will say it cannot be opened. Switch Leader Desk to **Off** first if you want nothing more to go. Put the website files back before you run it.

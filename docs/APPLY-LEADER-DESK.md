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

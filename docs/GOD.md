# The platform owner

One account, set once by whoever installs the platform, that can open every page, see what everyone is doing and change
anything. Nobody below it can see it, find it, count it, name it or promote it. This guide calls it **the owner**.

It is built on one migration, `supabase/migrations/20261209000100_superadmin.sql`, and one console at `/god`.

## Why there is no password in the code

The request was for credentials that are "hard-coded" and unique. A literal password written into the source would be readable
by everyone who ever sees the code, would sit in every copy and backup of it, and could not be changed without a new release.
So the owner is fixed in a different way, which gives the same uniqueness without the exposure:

* **One account.** `platform_owner` is a table that can only ever hold one row. It names one sign-in address. No page, API,
  invitation or role can create, change or remove it.
* **A passphrase only the owner knows.** Signing in is not enough. After signing in the owner is asked for a passphrase, which
  is checked in the database against a bcrypt hash. The passphrase itself is never stored, logged or sent anywhere. It is
  chosen once, in the SQL editor, by the person installing the platform.

Until the passphrase is given, the account has no powers at all.

## Setting it up (once)

1. Pick an email address used for nothing else (not a staff or member address). Turn on two-step verification for it.
2. Apply the migration (`supabase db push`, or paste the file into the SQL editor).
3. Sign in to United Tribes once with that address, so the account exists and is verified. Do not fill in the form.
4. In the Supabase SQL editor, as the database owner, run:

   ```sql
   select public.bootstrap_platform_owner('owner@example.com', 'four unrelated words make a good passphrase');
   ```

   The passphrase needs at least 12 characters. It is hashed on the spot and the hash is all that is kept. Do not keep the
   statement in a ticket, chat or shell history.
5. Sign in with that address. You are taken to an unlock step. Give the passphrase and the console opens.

The account has to be new to the programme: no role, no tribe, no form. The function refuses otherwise.

## What the owner sees and does

| | |
| --- | --- |
| **Every page** | `/admin`, `/review`, `/care`, `/dashboard`, `/reports`, `/growth`, privacy requests and the rest open for the owner. Every "may this person do that?" question in the platform is answered by `has_any_role()` or `my_roles()`, and both say yes to every role while the owner is unlocked. Nothing else had to change. |
| **The console, `/god`** | An overview with live numbers; a **live feed** of what is happening (it can be kept live and filtered); every person, with their tribe and form, and the power to give or take away any role; every tribe, with its members and weeks; the owner's own record. |
| **A bar on every page** | Says the owner's access is on and when it ends, with a **Lock now** button. |
| **Changing the passphrase** | From the owner's record: the current passphrase and the new one twice. |

Everything the owner does is written to `god_log`, which only the owner can read. It also records every unlock, every wrong
passphrase and every time someone who is not the owner tried to reach the unlock page (at most one note an hour per person).
It never records a passphrase.

## Invisible to everyone else

* The owner's row in `people` has `hidden = true`. The people policy hides it from every other account.
* People search, the intake totals and every count leave it out. A lookup of its name gives "The office".
* The owner cannot be given a role, invited or promoted (`keep_owner_roleless()`).
* What the owner does is not in the office's event log under their name. It is in `god_log`.
* For anyone else, `/god`, `/god/unlock` and everything under them are plain 404s, and no menu item points at them.
* Before the account became the owner, anything the shared event log said about it was removed.

## Guarding it

| Rule | Detail |
| --- | --- |
| Two steps | Signing in, then the passphrase. |
| One sign-in | An unlock belongs to the sign-in session it was given on. A second sign-in of the same account is held at the unlock step, while the first stays open. |
| Four hours | The powers end by themselves. Then it is the bare account again. |
| Lockout | Five wrong tries lock it for 15 minutes. Each wrong try after that locks again, and the lock doubles every five tries, up to 24 hours. A correct passphrase during a lock is refused too. |
| No hints | A wrong passphrase from the owner and a try by anyone else get the same answer: "That did not work." |

## If the passphrase is lost, or the owner has to change

In the SQL editor:

```sql
select public.remove_platform_owner();   -- the account becomes an ordinary member again
select public.bootstrap_platform_owner('new-address@example.com', 'a new passphrase of twelve or more characters');
```

Only the database owner can do this. It is the one way in, and it is deliberate.

## What the owner cannot read

The two private notes a member writes (what would help a tribe care for them, and the note to their leader) are sealed with a
key held outside the database. The console shows a reminder that they stay sealed, and it does not open them. That is
deliberate: the promise to members is that nobody reads those notes except their leader and the member. If you ever decide the
owner should be able to, it needs a decision from the pastoral leadership first, and a change to the privacy notice.

## Residual exposure, plainly

* Anyone with access to the Supabase dashboard (the database owner) can already read and change everything, and can replace the
  owner. Protect that login with two-step verification and keep it to as few people as possible.
* Whoever controls the owner's sign-in address, and knows the passphrase, is the owner. Treat both as one secret held by one
  person.
* The privacy notice says that one platform administrator account exists and what it can and cannot see. Have counsel review
  that wording.

## How it is checked

`tests/db/superadmin.test.ts` (26 tests, against a real Postgres with every migration) covers one-owner-only, the bootstrap
refusals, the lockout schedule, session scoping, expiry, hiding, role immunity and the log. Journey `10-owner` (60 checks) walks it in
a browser: an admin cannot see it, the unlock step, every page opening, the feed, roles, a second sign-in, a changed
passphrase, a lockout, and the powers ending.

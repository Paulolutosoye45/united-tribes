# Invitation emails: how to apply this package

**What was wrong.** Inviting someone (Admin → People → *Send invitation*, or God Mode → give a role) saved the invitation and, if the person already had an account, gave them the role. It never queued an email, so nobody was ever told. The form said so in small print: "We don't email invitations yet."

**What this does.** Every invitation now queues one email, from the church office:

- **An address with no account yet:** "You are invited to serve on United Tribes as a tribe leader. Sign in with this email address." The role is added the first time they sign in with that address, exactly as before.
- **An address that already has an account:** the role is already on it; the email says so.
- Inviting the same address for the same role again sends it again, at most once a day. **This is how you re-send to people you invited before this package**: invite them again.
- The email never names the person who invited, and never the owner. It carries no secret and no link that works as a key.

This zip holds **only the files that changed** since the last package (the automatic-placement one). Unzip it so its `united-tribes` folder merges into your project (say yes to replacing files). No new packages and no new settings.

## Deploy

1. **Database**, one file, once: `supabase/migrations/20261227000100_invitation_email.sql` (`supabase db push`, or paste it in the SQL editor and press **Run**). It adds one trigger on the invitations table and one function. **No existing function body is changed**, and no table. Everything up to `20261226000200_assistant_recommendations.sql` must already be applied.
2. **Then the app**: deploy the website.

## Check it works (five minutes)

1. **Admin → People → Invite someone.** The small print now says "We email them the invitation."
2. Invite an address you can read, as a tribe leader. The page says an email is on its way.
3. **Admin → Message log** shows a row to that address, `role_invitation`, as *queued*, then *sent* within a few minutes (the heartbeat sends it).
4. Open the email: it says to sign in with that address. Sign in with it; the person is a tribe leader.

## If the email still does not arrive

The invitation is now queued, so what is left is the sending side. Look in this order:

1. **Admin → Message log.** Is there a `role_invitation` row?
   - *No row:* the database file was not run (step 1 above).
   - *Queued, never sent:* the heartbeat is not running (`/api/cron/tick`, every few minutes), or it is between **10 pm and 6 am Lagos time**, when nothing but urgent messages goes out. It goes at 6 am.
   - *Failed or skipped, with a reason:* the reason is on the row. "email is not set up" means no email provider is configured on the host.
2. **Admin → Sending and email** shows whether an email provider is set up (SMTP or Resend). `docs/EMAIL-SMTP.md` has the settings. If it says no provider, no email of any kind leaves the platform, not just invitations.
3. **Spam folder** for the address you invited. A new mail server has no reputation yet (`docs/EMAIL-SMTP.md`, "Warm up").
4. The **six-digit sign-in code** is a different email: it is sent by Supabase, and is set in Supabase → Authentication → SMTP settings.

## Existing files this package changes

- `src/app/(app)/admin/actions.ts`: the two confirmation lines now add "An email is on its way." Nothing else in `inviteAction` changed.
- `src/components/admin/InviteForm.tsx`: the small print under the form.
- `src/lib/messaging/templates.ts`: registers the new email. No existing email changes. `types.ts`: one new audience, `invitee`. `render.ts`: the footer for that audience (no "change how we reach you" link, because they have no account yet).
- `tests/unit/fixtures/message-params.ts`: includes the new email's sample fields (the shared template tests run on it).
- `tests/db/placement-rollback.test.ts` (disclosed): its way-back rehearsal now takes anything built after the placement migrations back first (newest first, found by name), as `notices-rollback.test.ts` already does. Before, it expected the database to hold nothing newer, so the new migration made three of its tests fail.
- `scripts/rehearse-rollback.sh`: not a test; `invitation-email` is added to the list of new tests, so the original suite is run without it on the rolled-back database.

New: `src/lib/messaging/templates-invitation.ts`, `supabase/migrations/20261227000100_invitation_email.sql`, `supabase/rollback/20261227000100_invitation_email.down.sql`, `tests/db/invitation-email.test.ts`, `tests/unit/invitation-template.test.ts`, `e2e/journeys/32-invitation-email.ts`.

## Choices to know about

- **Quiet hours.** The email goes out between 6 am and 10 pm Lagos time like most messages. An invitation made at 11 pm leaves at 6 am. It is not marked urgent on purpose.
- **A fault never blocks an invitation.** If the email cannot be queued, the invitation and the role still happen, and the fault is written to the notice faults.
- **The first administrator's own invitation**, made when the platform is first set up, sends nothing: no one invited them.
- **Inviting the owner's address** looks exactly like inviting any other address that has not signed in, and sends the same email to that address. Nothing tells the person inviting that the account exists.
- **Email only.** It is never put to Meta for approval.

## The way back

Run `supabase/rollback/20261227000100_invitation_email.down.sql` as the database owner. It drops the trigger and the function. Every invitation, role and email already queued stays. Running it twice changes nothing. Then restore the application files listed above from the previous package.

## What was checked, and what was not

Checked on a throwaway database built from the migration files, and in a test browser (Chromium):

- **Type check and lint** of the whole project: clean.
- **Unit tests**: 2,102 (12 of them new: the email's wording, the article in front of every role, the footer, no secret, no name, all three channels).
- **Database tests**: 55 files, 1,604 tests (16 of them new). They cover: one email queued to a new address, by email only, with only the role in it; the person who invited and the owner never named; the same invitation made again the same day sends nothing more, and the next day sends again; a separate role is a separate email; an address whose account has not verified it is written to by address; an account that exists is told the role is already theirs (also when the owner gives it); a system-made invitation sends nothing; a fault in queueing never stops the invitation; the trigger function cannot be called by anyone; signing in still gives the role and sends nothing more; the way back, run twice.
- **Browser journeys**: the new journey 32 passes (20 checks): the administrator invites a new address and an existing account from Admin → People, the page confirms, the right messages are queued, the heartbeat sends them, the received emails read correctly and do not name the administrator, and the invited person signs in and has the role. The other 29 pass, each on at least one run; see the note below.
- **The way back, rehearsed**: the original suite (958 tests) gives the same answer, test by test, on a database with every migration and every rollback file run as it does on one that never had them.

Two things you may notice:

- **No single full browser run had all 30 journeys pass.** On this two-processor test machine, three older journeys each failed on a wait that is only about timing, and then passed: 25 (the page not answering in 15 seconds, in two of three full runs), 28 (once) and 11 (once, a wait on a client-side step). Each passes on its own, 25 passed in the last full run, and 25 also passed in a partial run with this migration held out and in another with it in place. I could not tie any of them to this change, but I cannot rule it out from these runs either; if one of them fails on your own pipeline, tell me which.
- **Two older test files fail if you run the database tests between 10 pm and 6 am Lagos time** (`messaging.test.ts` and `referee-trust.test.ts`), because the platform sends nothing in those hours. This is unchanged from before; run them in the daytime.

**Not** checked: delivery of the invitation to a real inbox through your mail server (the test sender is a stand-in); the full 324-combination matrix of switches was not run again, because inviting does not depend on any switch; timing on your own server and data.

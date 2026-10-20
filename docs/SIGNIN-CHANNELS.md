# Signing in with a code on WhatsApp or email

People sign in with Google, or with a six-digit code sent to them. This page covers the code: how it reaches a person (email or
WhatsApp), the limits around it, what pauses it, who can switch it, and what is honestly not known yet.

**The one thing to remember:** email can never be switched off, paused or limited by anything described here. Everything on this
page is about WhatsApp, and every WhatsApp failure ends with "use email".

## What a person sees

The sign-in screen: **Google** on top, then **or get a code**, then an **Email | WhatsApp** switch, one field and one button.

- **Email** is exactly as it was: the address, "Email me a code", six boxes.
- **WhatsApp** asks for the number (with +234 in front; "0803 123 4567", "803 123 4567" and "+234 803 123 4567" all work). The
  button says "Send code on WhatsApp". Everyone is told: *WhatsApp sign-in works once your number is added to your account. Add it
  in Privacy and my data after signing in with Google or email.* When the number to message is known, the screen also says
  *save this number as United Tribes* and shows it.
- The screen starts on **Email** on a first visit and **remembers the last choice on that device** (never required, and never
  shared with another device).
- After the code is asked for: six boxes (autofill works, and the sixth digit signs in), an **Open WhatsApp** button, a resend
  countdown, **Use email instead** in one tap, and a line that the code lasts 10 minutes.
- If WhatsApp is switched off or has paused itself: the WhatsApp tab stays but is greyed out, **Email is selected**, and one line
  says *WhatsApp codes are paused today. Use email.* Someone who last used WhatsApp is not stuck on a dead tab.
- Every error says what to do next. It works at 320 px wide, every tap target is at least 44 px, and the tabs work with the
  arrow keys and a screen reader.

**Resend wait on WhatsApp is 60, then 120, then 300 seconds** (email stays at 30). This is deliberate, and a change from the
earlier 30 seconds: the database refuses a code to the same number sooner than that (see "The limits"), and a refused request
would look to the person like a code that never came. The screen counts down the same wait the database enforces. The numbers
can be changed on the office page.

## Three ways the code can travel

| | What it is | Effort | Risk |
| --- | --- | --- | --- |
| **A. Official (Meta)** | WhatsApp Business Cloud API, with an approved "authentication" template. Supabase's *Send SMS* hook calls this site, and this site sends. | Meta business account, number, template approval. | None to the number. Costs a little per code. |
| **B. Ordinary number** | A normal WhatsApp number run by a small always-on service (`sender/`), linked like WhatsApp Web. | A spare SIM, a phone that stays online, a tiny server. About an hour. | **WhatsApp does not allow automated messages from an ordinary number. It can restrict or ban the number at any time, and no one can promise it will not.** |
| **C. Ordinary number, reply first** | B, but the code is only sent as a *reply* after the person has messaged the number. | The same as B. It is the default mode for B. | Smaller than B (a reply to someone who just wrote is how a number is meant to be used), but not zero. |

Which road is used is one setting, `SIGNIN_WHATSAPP_ROUTE` (`official` or `linked`). When it is not set, `WHATSAPP_PROVIDER`
decides as before (Meta, or none). The site's *other* WhatsApp messages (check-ins, reminders) always go through the official API
whatever this says. The ordinary number is only for sign-in codes.

Nothing about B and C hides that the messages are automatic: no rotating numbers, no pretend typing, no random pauses. They send
one short fixed message to people who asked, and they stop and say so when WhatsApp says the number is restricted.

**The message:** `United Tribes sign-in code: 123456`, a blank line, `Ignore this if you did not ask. Reply STOP to stop these.`
No link. The sender service refuses to send anything else, even if its secret leaked.

## Reply first (C), step by step

1. The person types their number and presses *Send code on WhatsApp*.
2. The sign-in service makes a code and asks this site's hook to send it. The hook **seals the code and keeps it** (it is not sent).
3. The screen says *Message us on WhatsApp* with a button that opens a chat with the number, message ready ("Send my code").
4. The person sends it. The sender service passes the message on, signed. The site finds the held code for that number, and the
   number **replies with the code**. Anyone else who messages the number gets silence.
5. The person types the code. A held code that is never collected is thrown away after ten minutes.

## The limits (all of them are enforced in the database, under one lock)

Every number below is a default that the director, a super admin or the data lead can change on **/admin/signin**.

| Barrier | Default |
| --- | --- |
| Bot check on the screen (Turnstile), passed straight through to the sign-in service | on |
| The hook only acts on a correctly **signed** request, within five minutes | always |
| Codes only to numbers **already on an account** | always |
| The same answer whether or not a number has an account | always (see "What is not hidden") |
| Per number | 3 in 15 minutes, 8 in a day, and a wait of 1, then 2, then 5 minutes between codes |
| Per connection (a network address, kept only as a salted hash) | 12 an hour |
| Whole channel | 20 an hour and 150 a day (only the director can **raise** these; anyone here can lower them) |
| Code lifetime | 10 minutes (set in Supabase, see "Set-up") |
| Wrong guesses | 15 code checks per five minutes per connection (Supabase's own limit, tightened from 30) |
| **STOP** or **not me** (B and C) | the number is blocked for 30 days and the data lead is emailed |

A code that goes past a limit is refused **silently and identically**: the hook answers `200 {}`, exactly as for a code that was
sent, so the screen cannot tell the difference. (A genuine failure to send still says so: the person is told, and offered email.)

The per-connection limit is only real if requests come through our own screen, which is where connections are counted. So the
sign-in service's phone sign-in is only used through `/api/auth/request-code`; a code asked for straight from the sign-in
service's address is refused by the hook (the "require our screen" setting, on by default). A person adding a number from
*Privacy and my data* is exempt from that one rule, because they are already signed in, but is still counted.

Numbers and connections are never stored. Only a salted hash of each is, made with `SIGNIN_HASH_SALT` (or, if you set none, a
salt derived from `WORKER_TOKEN`), so the log can count "the same number" without being able to say which.

**Lifting a block.** There is no button for it: a number that said STOP or "not me" stays blocked for WhatsApp codes for 30 days
(its owner can still sign in by email or Google). That is deliberate, so that a person who asked us to stop is not messaged
again by someone's mistake. Before launch, while you are testing with your own number, `delete from public.signin_blocks;` in
the Supabase SQL editor clears every block. Do not run it once real people are using the site: it clears everyone's.

## The circuit breaker

It watches the last half hour (set on the office page) and **pauses WhatsApp by itself** when:

- half or more of the codes failed to send, or were refused by WhatsApp (at least five codes before it judges);
- most codes sent from the ordinary number show **no delivery receipt** after three minutes;
- three or more people replied **STOP** or **not me**;
- the sender service reports **logged out**, **restricted**, or has not answered for a while.

When it trips: WhatsApp pauses (everyone sees the paused screen above), email carries on, and the **director and data lead are
emailed** (never on WhatsApp). **It never starts again on its own.** Not time, not the sender coming back. A person opens
**/admin/signin**, reads why, and restarts it with a note that is kept with their name. After a restart it ignores what it has
already seen, so the same failures cannot trip it again at once.

## The office page: /admin/signin

For the director, a super admin (the admin role) and the data lead. A pastor cannot open it.

- **Right now:** On, Paused or Switched off; if paused, why, what to look at first, and the restart button.
- **Kill switch:** one button. Off stops every WhatsApp code at once; email is untouched.
- **How the code reaches people:** reply first, or send at once (ordinary number only).
- **Limits:** every number in the table above, each with its allowed range, and what makes the breaker trip.
- **The last 30 days:** a bar for each day (asked / arrived / failed), with the numbers in a table underneath.
- **Pauses and changes:** every trip, restart, switch and change, with who did it. The last 50.

Every change is checked by the database again (ranges, who may raise the ceilings) and recorded with the person's name.

## Set-up

Order matters: **database first, then Supabase, then the site, then (optional) the sender.**

1. **Database.** Apply `supabase/migrations/20261212000100_signin_channels.sql` (additive; nothing is dropped or changed).
2. **Supabase dashboard**, project settings:
   - Authentication → Sign In / Providers → **Phone**: enabled. Set **SMS OTP Expiry to 600** seconds (the CLI has no key for this;
     email's is in `supabase/config.toml` as `otp_expiry = 600`, and the same for local work).
   - Authentication → **Hooks → Send SMS** → HTTPS → `https://YOUR-DOMAIN/api/auth/send-code`. Copy the secret it shows. (This is
     the same hook the earlier set-up used. If it is already there, it stays.)
   - Authentication → Rate Limits: "Rate limit for token verifications" → **15** (config.toml has it for local work).
   - CAPTCHA protection on, with the Turnstile secret (it already is if the bot check was set up).
3. **The site**, settings (names are in `.env.example`):
   - `WHATSAPP_SIGNIN=on` (the master switch for the screens), `SEND_SMS_HOOK_SECRET`, `WORKER_TOKEN`, `DATA_ENCRYPTION_KEYS`
     (holds sealed codes in reply-first), optionally `SIGNIN_HASH_SALT`.
   - Route A: `WHATSAPP_PROVIDER=meta` with the Meta settings as before.
   - Route B/C: `SIGNIN_WHATSAPP_ROUTE=linked`, `LINKED_SENDER_URL`, `LINKED_SENDER_SECRET`, `WHATSAPP_SIGNIN_NUMBER`.
4. **The sender** (B and C only): follow `sender/README.md`.
5. Run the **first-hour check with a real number** in `DEPLOY.md`. Nothing here has been run against a real WhatsApp, Meta or
   Supabase project.

If you set up Twilio *inside* Supabase in the earlier release: that set-up cannot have these limits (the hook is never called),
so WhatsApp sign-in stays off for it until you move to the hook (route A or B). Email is unaffected.

## What is not hidden

- **Same answer, different speed.** A number with an account takes slightly longer to answer than one without, because a message
  is actually being sent. Nobody has to know to look, but someone measuring response times could tell. The wording and the
  screen are identical.
- **A shared connection.** A church hall on one wifi shares one connection. 12 codes an hour and 15 code checks per five minutes
  can be too low for an event where a hundred people sign in at once. Raise them for the day on the office page and in Supabase.
- **A number that gets a code it did not ask for.** Anyone who knows a member's number can ask for a code for it (up to the
  limits). They cannot use it, but the member gets a message. The "not me" reply blocks that number for 30 days and warns the
  data lead, and the number's limits stop it being a flood.

## What this cannot promise

- **The ordinary number can be restricted or banned by WhatsApp**, with no warning. That is the cost of B and C. Use a SIM that
  is used for nothing else. If it happens, the breaker pauses WhatsApp and email carries on.
- **Recent WhatsApp changes** sometimes show a sender under a private identifier instead of their number. The sender service then
  cannot match the message to the number on the account, and does not guess: that person gets no WhatsApp code and sees *Use
  email instead*. Reply first is the most affected.
- **A linked phone must be opened about once a week**, or WhatsApp unlinks it (two weeks without contact). The breaker will
  say so ("logged out").
- **Not verified against real services.** The hook, the limits, the breaker, the screens and the sender's rules are tested (see
  below) against stand-ins. Whether a real WhatsApp delivers, how a real Supabase words its errors, and whether Meta approves
  the template have not been tested.

## Not built in this release

Phase 5 of the plan describes a "Messages and sign-in" tab. It is not part of this release; everything it would show is on
`/admin/signin` and in the existing message log.

## Rolling back

- **Fastest:** the kill switch on `/admin/signin`. Or unset `WHATSAPP_SIGNIN`. Email is untouched either way.
- **Remove the screens:** deploy the previous version of the site. The database file can stay; it does nothing without the new site.
- **Stop the number:** stop the sender service. The breaker notices within minutes, pauses WhatsApp and emails the director.

## What is tested

- Database (`tests/db/signin.test.ts`): the limits under simultaneous requests, the breaker's every trigger and its "never
  restarts itself", the STOP list, held codes, who may use the office functions, that no number or address is stored.
- Unit (`tests/unit/signin-*.test.ts`, `sender-core.test.ts`, `whatsapp.test.ts`): the signature on the hook and the sender, that a
  refused code looks exactly like a sent one, the request route, the sender's own limits and that it never logs a code or number,
  the wording, the remembered choice, the office page's reading of the database.
- Browser (`e2e/journeys/17-signin.ts`, on a phone, at 320 px): the panel and its states, reply first end to end, a number with no
  account, send at once, STOP, a busy connection, the kill switch, the breaker tripping and being restarted, the roles, and adding
  a number from *Privacy and my data*. The sender is replaced by a stand-in that makes the same checks the real one does.

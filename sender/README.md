# The sender: WhatsApp sign-in codes from an ordinary number

This is a small service you can run **instead of** the official WhatsApp Business route (route A). It is **optional**.
United Tribes works without it: email sign-in never needs it, and the official route keeps working next to it.

Read `docs/SIGNIN-CHANNELS.md` first. The short version of the risk: **WhatsApp does not allow automated messages from
an ordinary number, and no one can promise that this number will not be restricted.** It is built to keep that risk
small and the damage contained (see "How it keeps the risk small"), not to remove it. Use a SIM that is used for
nothing else. Nothing here hides that the messages are automatic: no rotating numbers, no fake "typing".

## What it is

One small Node service (about 500 lines, plus the WhatsApp library [Baileys](https://github.com/WhiskeySockets/Baileys)) that:

- **sends** one short message when the website asks (signed, one at a time, never more than its own limit);
- **passes on** what people send to the number, and delivery receipts, so the website can see "STOP" / "not me" and
  whether codes arrive;
- reports how the number is (`open`, `connecting`, `logged_out`, `restricted`) so the website's breaker can pause
  WhatsApp by itself.

It holds no database, no account data and no code history. A code exists in its memory only while it is being sent.

## What you need

- A **dedicated SIM** with its own number, on a phone that **stays charged and online**. That phone has WhatsApp on it
  and the service links to it as a "linked device" (like WhatsApp Web).
- A small always-on server that can run Node 22+ or Docker. A 512 MB machine is enough.
- **HTTPS** in front of it (a Cloudflare Tunnel, Caddy, or your host's own HTTPS). The sign-in code travels in the request.
- A long random secret, made once: `openssl rand -hex 32`. The **same text** goes in two places:
  `SENDER_SECRET` here and `LINKED_SENDER_SECRET` on the website.

## Set it up

1. **Settings.** Copy `.env.example` to `.env` and fill it in (`SENDER_SECRET`, `APP_URL`, `PORT`, `AUTH_DIR`).
2. **Link the number (once).** On the server run `npm install` then `npm run link`. A QR code appears in the terminal.
   On the SIM's phone open WhatsApp → Settings → Linked devices → Link a device, and scan it. When it says
   `linked`, stop it (Ctrl+C).
3. **Run it.** `npm start` (there is no build step), kept alive by your server's usual way (systemd, pm2, a hosting service's
   "always on" setting). Or with Docker: link the number once with `docker run -it --rm --env-file .env -v ut-sender-data:/data ut-sender npx tsx src/link.ts`,
   then `docker run -d --restart=always --env-file .env -p 8080:8080 -v ut-sender-data:/data ut-sender`. With Docker, leave
   `AUTH_DIR` out of `.env` (the image keeps the login in the `/data` volume).
   The `auth` folder (or volume) is the WhatsApp login. **Back it up and keep it private.** Anyone holding it can send as this number.
4. **Point the website at it.** On the website set `SIGNIN_WHATSAPP_ROUTE=linked`, `LINKED_SENDER_URL` (the https
   address), `LINKED_SENDER_SECRET` (same text), `WHATSAPP_SIGNIN_NUMBER` (the number, digits only with country code).
   Redeploy.
5. **Check it** with the ten-minute check in `APPLY.md`. Start in **reply-first** mode (the default): the code is held
   until the person messages the number first, which is how WhatsApp expects a number to be used.

## Keeping the link alive

- **Open WhatsApp on the SIM's phone at least once a week**, and keep it online. If a linked device is not heard from
  for about two weeks, WhatsApp unlinks it and the service reports `logged_out`. The website then pauses WhatsApp by
  itself, email carries on, and the director and data lead are told.
- If the phone is lost, off or its SIM lapses, the same thing happens. Relink with step 2 (delete the `auth` folder first).
- Changing the phone's WhatsApp version or number does not need anything here; changing the **SIM** means linking again.

## How it keeps the risk small

- **Replies first (default).** A code is only sent after the person has messaged the number, and the website answers that
  message. An unsolicited, repeated message from a number is what gets numbers restricted.
- **One short fixed message**: your name, the code, and "ignore this if it wasn't you". No links, no marketing. The
  service refuses to send anything else, even if the secret leaked (text over 200 characters, or containing a link, is refused).
- **Limits of its own**: at most 10 messages a minute and 60 an hour from the number, and at most 3 replies a minute to
  one person. The website has its own, stricter limits (per number, per network, per channel) before a request gets here.
- **Only known numbers.** The website only asks for a code for a number already on an account.
- **STOP and "not me"** from anyone blocks that number for 30 days and tells the data lead.
- **Circuit breaker on the website.** Failed sends, rejections, missing delivery receipts, `logged_out`/`restricted`, or a
  spike of STOP/"not me" pause WhatsApp. It never restarts on its own: a person restarts it at `/admin/signin`.
- **Nothing in the log.** The service never writes a code, a message or a full number to its log (only `***4567`), and a test checks that.

## What it cannot do

- It cannot make this safe from WhatsApp's own rules. Meta can restrict or ban the number at any time, with no warning.
  Then WhatsApp codes stop and email carries on. That is the cost of the choice, and why email can never be switched off.
- Recent WhatsApp changes (hidden "LID" identities) mean a message from a person's number is sometimes shown to the
  service under a different identity. The service then cannot match it to the number on the account and does not guess:
  that person sees no WhatsApp code and is shown "Use email instead". Reply-first is the mode most affected.
- It does not receive messages when `logged_out`, and it cannot read old messages.

## The pieces

| File | What it does |
| --- | --- |
| `src/core.ts` | The rules: who may ask, what may be sent, limits, passing messages and receipts on. No WhatsApp inside, so it is fully tested. |
| `src/baileys.ts` | The only file that talks to WhatsApp. |
| `src/auth.ts` | Signing and checking requests (the website has the same, a test checks they agree). |
| `src/link.ts` | The one-time QR link. |
| `src/main.ts` | Starts everything. |

Requests: `POST /send` `{ "to": "2348031234567", "text": "…" }` and `GET /health`, both signed with `x-ut-timestamp` and
`x-ut-signature` (HMAC-SHA256 of `timestamp.body`).

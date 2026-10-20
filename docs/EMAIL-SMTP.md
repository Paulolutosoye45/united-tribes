# Sending email through your own mail server (SMTP)

Until now the platform sent email only through Resend, whose free and low plans cap the number of emails a day. This adds a second choice:
**your own SMTP server**. The platform's own limits are gone; what remains is whatever your server and the receiving mail companies
(Gmail, Yahoo, Microsoft) allow, and that depends mostly on your server's reputation. Read "Warm up" before the first big announcement.

Two different emails leave the platform, and each is set in its own place:

| Email | Sent by | Where you point it at your server |
| --- | --- | --- |
| Everything the platform itself sends: welcome, reminders, announcements, referee requests, approvals, leader offers, care alerts | The platform's heartbeat | **The host's settings** (Step 5 below) |
| The six-digit **sign-in code** | Supabase | **Supabase → Authentication → SMTP settings** (Step 8 below) |

Do both, or members will still fail to get their sign-in code.

## Step by step

### 1. What you need from your server

* A **host name** for it, such as `mail.your-domain.org`, with a DNS `A` record to the server's fixed IP address.
* A **valid TLS certificate for that host name** (Let's Encrypt is free). A self-signed or mismatched certificate is refused on purpose, so
  nobody can listen in on the password.
* The **submission port open to the internet**: 587 (starts plain, then upgrades to encrypted) or 465 (encrypted from the first byte).
  Check with your hosting company that outbound mail is allowed. Many block port 25.
* A **mailbox and password for the platform**, for example `hello@your-domain.org`. Use a long random password; it is typed once, into the host.
* Your server must **sign outgoing mail with DKIM** (Postfix with OpenDKIM, Mailcow, Mailu, Stalwart and similar do this once enabled).

### 2. Publish the DNS records for the sending domain

| Record | Value | Why |
| --- | --- | --- |
| `A` | `mail.your-domain.org` → the server's IP | The name members' mail systems look up |
| **PTR** (reverse DNS) | The server's IP → `mail.your-domain.org` | Ask your hosting company to set it; Gmail and Microsoft distrust a server without it |
| **SPF** (`TXT` on `your-domain.org`) | `v=spf1 ip4:YOUR.SERVER.IP -all` (add `include:` for any other service that sends as this domain) | Says which servers may send as you |
| **DKIM** (`TXT` on `selector._domainkey.your-domain.org`) | The public key your server shows when you create the signing key | Proves a message was not altered and came from you |
| **DMARC** (`TXT` on `_dmarc.your-domain.org`) | `v=DMARC1; p=none; rua=mailto:dmarc@your-domain.org` | Tells receivers what to do when the above fail, and sends you reports. Start with `p=none`; after two clean weeks change to `p=quarantine` |

Wait for DNS to settle (minutes to a few hours). Then check the domain at <https://www.mail-tester.com> (send it the test email from Step 6)
and at <https://mxtoolbox.com/SuperTool.aspx>. Aim for 9 or 10 out of 10.

### 3. Let the platform send without being throttled by your own server

* Allow the platform's login to send at least **300 messages a minute** (the platform sends about 25 at a time, up to 200 every five
  minutes). Postfix: `smtpd_client_message_rate_limit`, `smtpd_client_connection_rate_limit`; Mailcow: the mailbox's rate limit.
* If you use fail2ban or similar, **do not ban the host's addresses**: a wrong password typed once in the host's settings repeats every
  five minutes until fixed and would lock the platform out.
* The `From` address (`EMAIL_FROM`) should be the same address as the login, or on the same domain. Many servers refuse to send as an address
  that does not belong to the logged-in mailbox ("relay access denied" or "sender not owned by user").

### 4. Make the settings (nothing changes yet)

Write them down; you will paste them in Step 5.

| Setting | Example | What it is |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `smtp` | Chooses your server instead of Resend |
| `SMTP_HOST` | `mail.your-domain.org` | **Exactly the name on the server's certificate** |
| `SMTP_PORT` | `587` | 587 or 465 (default 587) |
| `SMTP_SECURITY` | `starttls` | `starttls` for 587, `tls` for 465. Port 465 is read as `tls` unless you say otherwise. `none` is only for a server on the same machine. |
| `SMTP_USER` | `hello@your-domain.org` | The login. Some servers want the full address, some only the part before `@` |
| `SMTP_PASSWORD` | (the password) | |
| `EMAIL_FROM` | `United Tribes <hello@your-domain.org>` | The name and address members see |
| `EMAIL_REPLY_TO` | `pastoral@your-domain.org` | Optional. Where replies go |
| `SMTP_BOUNCE_ADDRESS` | `bounces@your-domain.org` | Optional. Where "could not be delivered" notices go. Defaults to the `EMAIL_FROM` address |
| `SMTP_HELO_NAME` | `mail.your-domain.org` | Optional. The name the platform greets your server with |

You can delete `RESEND_API_KEY` and `EMAIL_WEBHOOK_SECRET`; they do nothing with your own server.

### 5. Try it from a computer first (nothing is sent to members)

On a computer with the project and `npm install` done, put the lines from Step 4 in a file called `.env.local` in the project folder, then:

```bash
npm run email:test -- your.own.address@gmail.com
```

It sends the real "welcome" email to you alone and says what happened. If it is accepted, open the message **and the spam folder**; then in
Gmail choose the three dots → **Show original** and look for `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. If any is not PASS, go back to Step 2.

| It says | Meaning and fix |
| --- | --- |
| `smtp login refused` | Wrong `SMTP_USER` or `SMTP_PASSWORD` (try the full address as the user) |
| `email server unreachable` | Wrong `SMTP_HOST` or port, the port is blocked, or the certificate does not match `SMTP_HOST` |
| `smtp 550 … relay access denied` or `sender … not owned` | `EMAIL_FROM` is not the logged-in mailbox or its domain (Step 3) |
| `smtp 550 5.7.x … SPF / DKIM / not authenticated` (from Gmail or Microsoft, on a later send) | The DNS records in Step 2 are missing or wrong |
| `smtp 451` or `smtp 421` | The receiver or your server said "not now". The platform tries again by itself (see "When your server is down" below) |

### 6. Switch the platform over

In the host (Vercel: Project → Settings → Environment Variables; Docker: the container's environment; elsewhere: wherever `.env` lives),
set the Step 4 settings and **redeploy**. Then:

1. Confirm it took: `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-SITE/api/health` should show `"email":"smtp"` under `channels`.
   `"email":null` means a setting is missing or unreadable: run `npm run email:test` with the host's values and it names the one.
2. In **Admin → Announcements**, send a test announcement to yourself (the page lets you preview and test before anything goes out).
3. Messages that failed while Resend was refusing them stay failed. In **Admin → Message log**, press **Try again** on each (admins and directors).

### 7. Warm up (do not skip this)

A new server has no reputation, and receivers treat a sudden large volume from it as spam. Increase gradually:

| Days | Emails a day at most | What to send |
| --- | --- | --- |
| 1 to 3 | 20 to 50 | Sign-in codes, welcome emails, your own test messages |
| 4 to 7 | 100 | Add one small reminder journey |
| Week 2 | 300 to 500 | Announcements to one community at a time |
| Week 3 on | double each few days while bounces stay under 2% | Then the whole church |

Watch Google Postmaster Tools (<https://postmaster.google.com>) for the domain, and your DMARC reports. If Gmail starts putting mail in spam,
stop increasing for a few days; do not push through.

### 8. Sign-in codes (Supabase)

Sign-in codes do not use the settings above. In the Supabase dashboard:

1. **Authentication → Emails → SMTP Settings** (older dashboards: Authentication → Settings → SMTP Settings). Turn on **custom SMTP**.
2. Sender email `hello@your-domain.org`, sender name `United Tribes`, host `mail.your-domain.org`, port `587` (or `465`), username and password as in Step 4.
3. Save. Under **Authentication → Rate Limits**, raise the **emails per hour** so a Sunday morning is not blocked.
4. Sign in with a fresh email address and see that the code arrives. Keep the code-only template from `supabase/templates/sign-in-code.html`.

Supabase must be able to reach your server from the internet, so the port must be open to everyone, not only to your host's IP.

### 9. If you need to go back

Set `EMAIL_PROVIDER=resend` (and `RESEND_API_KEY`) in the host and redeploy. In Supabase, turn custom SMTP off. Nothing else changes.

## When your server is down

The platform tries a message **three times** on a channel, about 5 and then 10 minutes apart. If your server is still unreachable after
that, the message is marked **failed** (or goes to the person's next channel, WhatsApp or text, if they agreed to one). When the server is
back, open **Admin → Message log** and press **Try again** on the failed ones. Put an uptime monitor on the mail server's submission port so
you hear about it before members do.

## What is different from Resend

* **No automatic bounce or complaint report.** Resend told the platform about hard bounces and spam complaints (`/api/webhooks/email`) so
  it could leave bad addresses out of reminders and announcements and pause a reminder journey that annoyed people. A self-hosted server
  cannot do that. A message your server **refuses on the spot** (for example "no such mailbox") is marked failed with your server's own
  words in the message log, or goes to the person's WhatsApp or text if they agreed to one; the address is not marked bad. A message your
  server accepts and the far side refuses later comes back as a notice in the bounce mailbox (`SMTP_BOUNCE_ADDRESS`). **Read that mailbox
  every week** and correct or remove dead addresses in Admin → People. **Unsubscribing still works** (the one-click link is the platform's
  own), but a spam complaint reaches you only through Gmail's Postmaster Tools, not the platform's self-pause.
* **No second copy protection.** If your server accepts a message and the connection drops before it says so, the platform tries again and
  the person can receive two copies. It is rare; the other choice is losing messages.
* **A connection per message.** Each message opens its own encrypted connection (a fraction of a second). At the platform's pace this is
  fine; servers with strict connection limits should allow about five at once.

## What was and was not tested

Tested here: the new sender against a real SMTP server running on the same computer (login, wrong password, unknown mailbox, "try later", server down,
refusal to send without encryption or to a server whose certificate cannot be trusted, the one-click unsubscribe and urgent headers, accented
names), the settings reader, the production build, and the `email:test` tool.

**Not tested: your server.** Nothing here has been run against your mail server, your DNS, Gmail, Yahoo or Microsoft. Whether a message
reaches the inbox depends on Step 2 and on your server's reputation, which only Step 5 and a gradual Step 7 can show.

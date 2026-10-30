# WhatsApp that cannot fail quietly

Three functions on the owner's Features page (God Mode → Features), all for the whole church only, all starting **Off**. With all three Off, the platform sends WhatsApp exactly as it did before.

| Function (key) | What it gives you | Positions |
|---|---|---|
| **WhatsApp safety net** (`whatsapp_guard`) | A pause for every WhatsApp message, an automatic pause when Meta refuses the church's *account*, and a count of messages Meta took but never confirmed. | Off · Rehearsal · On |
| **WhatsApp health** (`whatsapp_health`) | A page that asks Meta whether the account is set up properly, says what is wrong in plain words, and sends the office a test message. | Off · On |
| **WhatsApp number required** (`number_required`) | A phone number is compulsory on the join form and in an adult member's contact details. | Off · On |

A fourth function, [Leader removal requests](REMOVAL-REQUESTS.md), came in the same package and has nothing to do with WhatsApp.

Migrations: `20270103000100_whatsapp_safety.sql`, `…0200_whatsapp_health.sql`, `…0300_number_required.sql`. Ways back: the same names in `supabase/rollback/`, ending `.down.sql`. Tests: `tests/db/whatsapp-safety.test.ts`, `whatsapp-health.test.ts`, `number-required.test.ts` and their rollback tests, and the unit tests `tests/unit/whatsapp*.test.ts` and `number-rule.test.ts`.

## Why you saw "meta 131030"

**Meta refuses any recipient that is not on the allowed list of a *test number*.** The site reached Meta, and Meta turned the message away. A test number can message at most five phones, each verified by hand with a code. The cure is not in the code: register the church's own number (steps below). Once a real number is the sender, 131030 cannot occur.

What the site does with it, today and after this package: the message is marked as tried on WhatsApp and is sent on the next channel the member agreed to (email, then text), so nobody loses the message; they only lose WhatsApp.

Two minutes to confirm it: in Meta Business Suite → WhatsApp Manager → **Phone numbers**, look at the number whose ID is in `WHATSAPP_PHONE_NUMBER_ID`. A "+1 555…" number, or one labelled as a test number, is the cause. After the safety net is On, the same answer is on **Admin → Messages → WhatsApp health**, under *Sending number*.

## What each function does

### 1. WhatsApp safety net

* **Pause.** An admin, a director or the data lead pauses *all* WhatsApp messages from **Admin → Messages**, with a reason (kept in the log with their name). While paused, every message skips WhatsApp and goes to the member's next channel. **Nothing is lost.** Only a person restarts it, with a note.
* **Automatic pause.** When Meta refuses the account itself (an expired or wrong token, a test number, a locked account, a payment or policy problem; the codes are `10, 190, 200, 368, 401, 403, 131030, 131031, 131037, 131042, 131045`) **5 times in 30 minutes**, WhatsApp pauses itself and the director and the admin are told **by email**, never by WhatsApp. Both numbers can be changed on the same card (2–50 refusals, 5–240 minutes). A refusal about one member (not on WhatsApp, too many messages to one person) never counts.
* **Missed receipts.** A count of messages Meta accepted but never confirmed within 24 hours (changeable, 2–168), with the oldest, on the same card.
* **Expired token.** Code `190` and the other account-level codes are now "give up on WhatsApp for this message", where before an expired token was an unknown error.
* **Rehearsal** writes down when it *would* have paused. Nothing is held back and nobody is emailed. Start here.
* **The sign-in switch.** The button on Admin → Sign-in is now called "Turn WhatsApp **sign-in codes** off". It always stopped only sign-in codes; the new pause is the one for everything else.

### 2. WhatsApp health

**Admin → Messages → WhatsApp health** (director, admin, data lead). It asks Meta, read-only, and keeps the last answer for everyone in the office, so opening the page costs nothing. It never keeps or shows the token or a member's number.

| It checks | Plain-words outcomes |
|---|---|
| Settings on the website | Which of the `WHATSAPP_*` settings are missing; whether `MESSAGING_MODE=log` is switching sending off. |
| Access token | Accepted, expired, or missing a permission (with the fix). |
| Sending number | Its name and whether it is a **test number** (the 131030 cause). |
| Number quality and daily limit | Meta's rating and how many different people it may start talking to a day. |
| Delivery receipts | Whether the app is subscribed to the account, so receipts can arrive. |
| Message wording | Every template's approval and category, and any filed as Marketing. |
| Sign-in code wording | The hand-made authentication template, by `WHATSAPP_TEMPLATE_NAME`. |
| The last 7 days | Messages received, waiting for a receipt, and given up on, **by cause in words**. |
| What Meta told us | Template approvals and rejections, quality changes, account restrictions (kept 90 days; bad news is emailed to the director and the admin). |

**Send me a test message** sends the new office template `ut_whatsapp_test` to the number on *your own* profile, so you can see a real message arrive. It needs your own number saved on your profile and the template approved; it goes out at once (quiet hours do not hold it), is sent on WhatsApp only, and is limited to five a day.

### 3. WhatsApp number required

* The join form's contact step asks for the number, shows it back ("We will use +234 …"), and will not go on without it. A number whose last seven digits are one repeated digit is refused as made up.
* **Consent stays separate.** The number is compulsory; the WhatsApp **yes** is not, and is never pre-ticked. A leader sees the number only if the member chose WhatsApp, and the form says so next to the field.
* The database refuses to save an adult member's contact details without a number (`save_contact`), as well as the form.
* **Nobody is locked out.** A member who joined without a number sees a gentle prompt on Home and My page; "Not now" hides it for a week. Leaders see how many of their people have none.
* If the number a member signs in with differs from the number we message, My page says so, with both.
* Teenagers, and anyone without a member profile, are never asked.

## Meta activation, step by step (yours, before you open the switches)

About two hours of your time plus Meta's waiting. Business verification can take days; templates take minutes to a day. Do these in order: later steps need values from earlier ones. **Never paste the token in chat or email. Put it only in the hosting settings.**

**Before you start:** a SIM that can receive one SMS or call and is not signed in to the WhatsApp or WhatsApp Business app (a new SIM, used for nothing else); the church's registration papers; a payment card; two people who can act as business administrators.

1. **Business portfolio.** business.facebook.com → Business settings → "The Covenant Nation". Make a second person an administrator.
2. **Business verification, now.** Business settings → Security centre → Start verification (registration document and address proof). It is not needed for the first messages, but it lifts the daily limit from about 250 to about 2,000 different people, and it is the slow step.
3. **The Meta app.** developers.facebook.com → My Apps → Create app → use case "Connect with customers through WhatsApp" → choose the portfolio.
4. **The church's own number.** In the app: WhatsApp → API Setup → "From" → add a number. Enter the SIM's number, a display name that carries the church's name (for example "The Covenant Nation – United Tribes"), and the code Meta sends. Copy the **Phone number ID** and the **WhatsApp Business Account ID**.
5. **Payment.** WhatsApp Manager → Payment settings → add the card.
6. **A token that does not expire.** Business settings → System users → Add → assign the app (Manage app) and the WhatsApp account (Full control) → Generate token with `business_management`, `whatsapp_business_messaging`, `whatsapp_business_management`; choose "never expires" if offered. A token copied from the API Setup page is temporary and dies within hours (code 190).
7. **The settings on the host, then redeploy:**
   * `WHATSAPP_PROVIDER=meta`
   * `WHATSAPP_PHONE_NUMBER_ID` (step 4) and `WHATSAPP_ACCESS_TOKEN` (step 6)
   * `WHATSAPP_BUSINESS_ACCOUNT_ID` (step 4)
   * `WHATSAPP_APP_SECRET`: the app's Settings → Basic → App secret
   * `WHATSAPP_VERIFY_TOKEN`: any long random text; you paste the same text in step 8
   * `WHATSAPP_TEMPLATE_NAME`: the exact name of the sign-in template (step 9)
   * leave `WHATSAPP_TEMPLATE_SUFFIX` empty
8. **The webhook.** In the app: WhatsApp → Configuration. Callback URL `https://YOUR-SITE/api/webhooks/whatsapp` and the verify token from step 7 → Verify and save. Subscribe the field `messages`, and also `message_template_status_update`, `phone_number_quality_update` and `account_update` (the health page uses the last three).
9. **Templates.** On a computer with the settings from step 7: `npm run templates -- --submit`, then `npm run templates -- --status` until every line says APPROVED (57 templates, including the new office test message). Reword and resubmit any rejected one under a new suffix (for example `_v2`). In WhatsApp Manager → Message templates, look for any shown as Marketing. Separately create the sign-in template **by hand**: category Authentication, named exactly as in `WHATSAPP_TEMPLATE_NAME`.
10. **Set the app to Live** (top of the app dashboard; it asks for a privacy-policy address, and the site has `/privacy`). Some receipts are not sent while an app is in Development.

### Prove it, in this order

1. Open **WhatsApp health**: every line good, *Sending number* not a test number.
2. Press **Send me a test message** and watch it arrive.
3. Ask for a WhatsApp sign-in code to your own number.
4. Let one real message go out to yourself as a test member and watch Admin → Messages go from sent to delivered to read.
5. Reply STOP from your phone and check your WhatsApp consent is withdrawn.
6. Press the sign-in switch and the new pause, and check no WhatsApp arrives while each is on. Restart both.

Then roll out in three rings: staff and leaders for a week, then one tribe, then everyone. Submit business verification before "everyone": the Friday check-in goes to every active member on one day.

## Opening the switches (the order)

1. **Safety net → Rehearsal** for a few days, then **On**. It is the one that makes the next failure visible.
2. **WhatsApp health → On.** Use it to check everything after step 10 above.
3. **WhatsApp number required → On** whenever you want the form to insist. Ask counsel to read the line that says why the number is asked for, in the same pass as the Profiles wording.

Each switch is whole-church only. Turning one Off puts the platform back exactly as it was; the data they kept stays until you run the way back.

## Why a message may still not arrive

| # | Cause | What the log shows | Where to look |
|---|---|---|---|
| 1 | Test number | `meta 131030` again and again | Health → Sending number |
| 2 | Expired or temporary token | code 190, or every attempt refused in the same minutes | Health → Access token |
| 3 | Template not submitted, approved, paused or recategorised | 132001, 132015, 132016 | Health → Message wording |
| 4 | Receipts not wired | status stays "sent", never "delivered" | Health → Delivery receipts; step 8 and 10 |
| 5 | The member side | "skipped… no channel the person has agreed to"; 131026 (not on WhatsApp) | the query below |
| 6 | Meta's limits and quality | 131049, 131056, 130429 | Health → quality and limit |

Two rules look like failure and are not: non-urgent messages wait until 06:00 Lagos if they are due between 22:00 and 06:00, and a member who never ticked WhatsApp is written to by email, by design.

## Queries for the Supabase SQL editor

What happened to WhatsApp in the last 14 days, by outcome:

```sql
select status, coalesce(channel, '-') as channel,
       left(coalesce(error, ''), 60) as error, count(*) as n
  from public.messages
 where created_at > now() - interval '14 days'
   and ('whatsapp' = any(tried) or channel = 'whatsapp')
 group by 1, 2, 3
 order by n desc;
```

Many `meta 131030` / 190 / 132001 rows: causes 1 to 3. Many `sent` on WhatsApp and no `delivered`: cause 4. Many `skipped`: cause 5.

How many members have no number, and how many have said yes to WhatsApp:

```sql
select count(*) filter (where cp.phone is null) as without_number,
       count(*) filter (where public.consent_granted(mp.person_id, 'whatsapp')) as said_yes_to_whatsapp,
       count(*) as members
  from public.member_profiles mp
  left join public.contact_preferences cp on cp.person_id = mp.person_id;
```

Is WhatsApp paused, and why:

```sql
select * from public.whatsapp_guard;
select at, kind, reason, detail from public.whatsapp_guard_log order by at desc limit 10;
```

(Those two are readable only by the database owner; the same answer is on the Messages page for the office.)

## What I could not check

* **Your Meta account.** The tests stand in for Meta, and everything up to Meta's door is proven. Nothing here has been tried against a live WhatsApp account; step "Prove it" is the first real proof.
* **Your limits and prices.** The 250 and 2,000 figures come from a guide written in August 2026 from Meta's July rules. WhatsApp Manager shows your real tier and the Nigerian rates.
* **Template category.** Whether Meta keeps every template as Utility is known only after you submit them; the health page shows it.
* **Meta's wording for 131030.** Its error-code page does not list it; the meaning comes from Meta's Get Started page (5 recipients) and two third-party references.

## The way back

Each function has its own file in `supabase/rollback/`, to be run as the database owner, newest first (`…0300`, then `…0200`, then `…0100`), after putting the previous application files back. `scripts/rehearse-rollback.sh` rehearses all of them. The safety net's file restores `message_channels` and `god_feature_board` exactly as they were, drops the pause, its log and the watch on faults, and gives the Switchboard back its six groups (the log of who moved a switch is kept); a message already sent, skipped or failed stays as it is, and the messages a pause held back already went on by the next channel.

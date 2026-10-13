/**
 * Messages end to end: a member chooses how to be reached; the heartbeat sends through
 * WhatsApp, email and text stand-ins; receipts, button taps and STOP come back through
 * the signed webhooks; the one-tap page works with no sign-in; a failing channel falls
 * through to the next; and a leader sets the meeting link.
 */
import { createHmac } from "node:crypto";
import { signWebhook } from "../../src/lib/whatsapp/webhook";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";

type Row = Record<string, unknown>;
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

const sign = (body: string) => `sha256=${createHmac("sha256", MESSAGING.appSecret).update(body).digest("hex")}`;
const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; retried: number; rejected: number; problems: string[] } };
};
const stub = async (channel: string) => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Received[];
async function hook(path: string, body: string, headers: Record<string, string>) {
  return fetch(`${BASE}${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row;
  const id = async (email: string) => (await one("select id from public.people where email = $1", [email])).id as string;

  // --- arrange: Friday of week 1, a tribe with Ngozi leading and Chidi in it --------------------------------
  await q.query("update public.seasons set starts_on = public.today_lagos() - 5, ends_on = public.today_lagos() - 5 + 84");
  const ngozi = await id("ngozi@example.org");
  const chidi = await id("member@example.org");
  const tribe = (await one(
    `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time, slot,
        meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     select (select id from public.seasons order by starts_on limit 1), $1, 'approved', 'E2E Builders', (select id from public.tracks where slug = 'builders'),
        (select id from public.communities where slug = 'professionals'), (select id from public.season_goals where slug = 'step-into-a-leadership-role'),
        '{}', 'mixed', 'A tribe for the journeys, long enough to be a real story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland', 'Online', 12,
        'Pray daily for each other.', 'Call each other weekly.', 'Take one step a week.', now()
     returning id`, [ngozi])).id as string;
  await q.query(
    `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     select $1, $2, season_id, 1, 90, 'e2e', '{}'::jsonb, current_date + 14 from public.tribes where id = $1`, [tribe, chidi]);
  await q.query("insert into public.week_steps (person_id, tribe_id, week, when_text, will_text) values ($1, $2, 1, 'when I wake up', 'pray for five minutes')", [chidi, tribe]);

  // --- 1. a member chooses how to be reached ---------------------------------------------------------------
  const browser = await launch();
  const { page } = await newPage(browser);
  await signIn(page, "member@example.org", "/profile");
  await open(page, "/profile");
  check(await page.getByRole("heading", { name: "How we reach you" }).isVisible(), "the profile page has a “How we reach you” card");
  await page.getByLabel("Phone number").fill("0803 123 4567");
  await page.locator(`label.choice:has(input[name="whatsapp"])`).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved. We’ll use these from now on.").waitFor({ timeout: 10000 });
  check(true, "saving the contact card confirms it");
  const cp = await one("select phone, preferred from public.contact_preferences where person_id = $1", [chidi]);
  check(cp?.phone === "+2348031234567" && cp.preferred === "whatsapp", "the number is stored in international form, with WhatsApp preferred");
  const ledger = await one("select granted from public.consents where person_id = $1 and purpose = 'whatsapp' order by id desc limit 1", [chidi]);
  check(ledger?.granted === true, "agreeing to WhatsApp is recorded in the consent ledger");

  // an invalid number is explained, not saved
  await page.getByLabel("Phone number").fill("12");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("doesn’t look right").waitFor({ timeout: 10000 });
  check((await one("select phone from public.contact_preferences where person_id = $1", [chidi])).phone === "+2348031234567", "a number that does not look right is explained and nothing changes");
  await noOverflow(page, "profile on a phone");

  // --- 2. the heartbeat sends --------------------------------------------------------------------------------
  const friday = (await one(
    "select public.enqueue_message($1, 'friday_checkin', $2::jsonb, $3, 'e2e:fri:1', null) as id",
    [chidi, JSON.stringify({ week: 1, step_set: true, when: "when I wake up", will: "pray for five minutes", near_end: false }), tribe],
  )).id as string;
  const token = (await one("select reply_token from public.messages where id = $1", [friday])).reply_token as string;

  const denied = await fetch(`${BASE}/api/cron/tick`);
  check(denied.status === 401, "the heartbeat refuses a caller without the secret");
  const first = await tick();
  check(first.status === 200 && first.body.problems.length === 0 && first.body.sent >= 2, `the heartbeat sends what is due (${first.body.sent} sent, ${first.body.problems.length} problems)`);

  const wa = await stub("whatsapp");
  const fri = wa.find((r) => (r.body.template as { name: string }).name === "ut_friday_checkin");
  check(fri?.body.to === "2348031234567", "the Friday check-in went to the member’s WhatsApp number, digits only");
  const comps = (fri?.body.template as { components: { type: string; sub_type?: string; parameters: { payload?: string; text?: string }[] }[] } | undefined)?.components ?? [];
  const payloads = comps.filter((c) => c.sub_type === "quick_reply").map((c) => c.parameters[0].payload);
  check(JSON.stringify(payloads) === JSON.stringify([`ck:${token}:done`, `ck:${token}:partly`, `ck:${token}:not_yet`]), "its three buttons carry this message’s own secret");
  check(wa.some((r) => (r.body.template as { name: string }).name === "ut_welcome" && r.body.to === "2348031234567"), "the welcome message also went to WhatsApp");
  const emails = await stub("email");
  const toLeader = emails.find((r) => (r.body.to as string[])[0] === "ngozi@example.org");
  check(Boolean(toLeader) && /<html/.test(String(toLeader?.body.html)) && String(toLeader?.body.text).includes("Hi Ngozi"), "the leader, with no phone on file, was emailed (html and plain text)");
  check(String(toLeader?.body.html).includes(BASE), "its links point at this site");
  const sentRow = await one("select status, channel, provider_id from public.messages where id = $1", [friday]);
  check(sentRow.status === "sent" && sentRow.channel === "whatsapp" && String(sentRow.provider_id).startsWith("wamid."), "the log records the channel and the provider’s id");

  // --- 3. receipts, a tap on a button, and STOP come back through the signed webhook --------------------------
  const wamid = String(fri?.id);
  const receipt = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status: "delivered" }] } }] }] });
  check((await hook("/api/webhooks/whatsapp", receipt, {})).status === 401, "a webhook call without Meta’s signature is refused");
  check((await hook("/api/webhooks/whatsapp", receipt, { "x-hub-signature-256": sign(`${receipt} `) })).status === 401, "a signature for different bytes is refused");
  check((await hook("/api/webhooks/whatsapp", receipt, { "x-hub-signature-256": sign(receipt) })).status === 200, "a correctly signed delivery receipt is accepted");
  check((await one("select status, delivered_at from public.messages where id = $1", [friday])).status === "delivered", "the message shows as delivered");

  const tap = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "2348031234567", type: "button", button: { payload: `ck:${token}:done`, text: "Done" } }] } }] }] });
  check((await hook("/api/webhooks/whatsapp", tap, { "x-hub-signature-256": sign(tap) })).status === 200, "a tap on “Done” is accepted");
  check((await one("select outcome from public.week_steps where person_id = $1 and week = 1", [chidi])).outcome === "done", "…and marks the member’s step as done");

  const verify = await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${MESSAGING.verifyToken}&hub.challenge=777`);
  check(verify.status === 200 && (await verify.text()) === "777", "Meta’s one-time check is answered");
  check((await fetch(`${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=777`)).status === 403, "…and refused with the wrong verify token");

  // --- 4. the one-tap page works with no account -----------------------------------------------------------
  const guest = await newPage(browser);
  await open(guest.page, `/r/${token}?o=not_yet`);
  check(/how did your week go/i.test(await text(guest.page)), "the one-tap page greets the member by name, signed out");
  check((await one("select outcome from public.week_steps where person_id = $1 and week = 1", [chidi])).outcome === "done", "opening a link does not record an answer (scanners open links too)");
  await guest.page.getByRole("button", { name: /Partly/ }).click();
  await guest.page.getByText(/Marked “Partly”/).waitFor({ timeout: 10000 });
  check((await one("select outcome from public.week_steps where person_id = $1 and week = 1", [chidi])).outcome === "partly", "pressing a button records the answer");
  await noOverflow(guest.page, "one-tap page on a phone");
  await open(guest.page, `/r/${"0".repeat(64)}`);
  check(/isn’t valid/.test(await text(guest.page)), "a made-up link says it isn’t valid");

  // --- 5. a channel that fails falls through to the next -------------------------------------------------------
  const efe = (await one("insert into auth.users (email, email_confirmed_at) values ('efe@example.org', now()) returning id")).id as string;
  await q.query("update public.people set full_name = 'Efe Obi', preferred_name = 'Efe' where id = $1", [efe]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348030000000', 'whatsapp')", [efe]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [efe]);
  const season = (await one("select public.enqueue_message($1, 'season_complete', $2::jsonb, $3, 'e2e:complete', null) as id", [efe, JSON.stringify({ tribe: "E2E Builders", season: "Season 1" }), tribe])).id as string;
  await tick();
  const mid = await one("select status, channel, tried, error from public.messages where id = $1", [season]);
  check(mid.status === "queued" && (mid.tried as string[]).includes("whatsapp") && /131026/.test(String(mid.error)), "WhatsApp said the number is not on it, so the message was queued for the next channel");
  await tick();
  const end = await one("select status, channel, provider_id from public.messages where id = $1", [season]);
  check(end.status === "sent" && end.channel === "email", "…and went out by email on the next pass");

  // a bounce reported by the email provider is recorded, and with no channel left the message is marked failed
  const emailId = String(end.provider_id);
  const bounce = JSON.stringify({ type: "email.bounced", data: { email_id: emailId, bounce: { type: "Permanent" } } });
  const stamp = String(Math.floor(Date.now() / 1000));
  const svix = (body: string) => ({ "svix-id": "msg_e2e_1", "svix-timestamp": stamp, "svix-signature": signWebhook(MESSAGING.emailWebhookSecret, "msg_e2e_1", stamp, body) });
  check((await hook("/api/webhooks/email", bounce, { "svix-id": "x", "svix-timestamp": stamp, "svix-signature": "v1,AAAA" })).status === 401, "an email receipt with a bad signature is refused");
  check((await hook("/api/webhooks/email", bounce, svix(bounce))).status === 200, "a signed bounce is accepted");
  check((await one("select status from public.messages where id = $1", [season])).status === "failed", "…and, with no other channel agreed, the message shows as failed");

  // STOP on WhatsApp withdraws that channel
  const stop = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "2348031234567", type: "text", text: { body: "STOP" } }] } }] }] });
  check((await hook("/api/webhooks/whatsapp", stop, { "x-hub-signature-256": sign(stop) })).status === 200, "a STOP reply is accepted");
  check((await one("select granted from public.consents where person_id = $1 and purpose = 'whatsapp' order by id desc limit 1", [chidi])).granted === false, "…and withdraws WhatsApp for that person");

  // --- 6. text messages ------------------------------------------------------------------------------------------
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'sms', true, 'e2e')", [efe]);
  await q.query("update public.contact_preferences set preferred = 'sms', phone = '+2348035551234' where person_id = $1", [efe]);
  await q.query("select public.enqueue_message($1, 'season_complete', $2::jsonb, $3, 'e2e:complete:sms', null)", [efe, JSON.stringify({ tribe: "E2E Builders", season: "Season 1" }), tribe]);
  await tick();
  const texts = await stub("sms");
  check(texts.some((r) => r.body.to === "2348035551234" && r.body.channel === "dnd" && String(r.body.sms).includes("E2E Builders")), "a text message went out on the do-not-disturb route");

  // --- 7. monitoring ---------------------------------------------------------------------------------------------
  const plain = await (await fetch(`${BASE}/api/health`)).json();
  check(JSON.stringify(plain) === JSON.stringify({ ok: true, database: true }), "the health check tells anyone only that things are up");
  const detailed = await (await fetch(`${BASE}/api/health`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } })).json();
  check(detailed.channels?.whatsapp === "meta" && detailed.channels?.email === "resend" && detailed.channels?.sms === "termii", "with the secret it also reports which channels are set up");
  check(typeof detailed.queue?.due === "number", "…and how the queue is doing");

  // --- 8. a leader sets the meeting link --------------------------------------------------------------------------
  const lead = await newPage(browser, "desktop");
  await signIn(lead.page, "ngozi@example.org", "/lead/tribe");
  await open(lead.page, "/lead/tribe");
  const meeting = lead.page.locator('section[aria-labelledby="meeting-heading"]');
  await meeting.getByLabel("Meeting link").fill("https://meet.example.org/e2e-tribe");
  await meeting.getByRole("button", { name: "Save", exact: true }).click();
  await lead.page.getByText("Saved. Members get this in their reminders.").waitFor({ timeout: 10000 });
  check((await one("select meeting_link from public.tribes where id = $1", [tribe])).meeting_link === "https://meet.example.org/e2e-tribe", "the leader’s meeting link is saved");
  await meeting.getByLabel("Meeting link").fill("http://insecure.example");
  await meeting.getByRole("button", { name: "Save", exact: true }).click();
  await lead.page.getByText(/starts with https/).waitFor({ timeout: 10000 });
  check(true, "a link that is not https is explained, not saved");

  // leave the season as the other journeys expect it
  await q.query("update public.seasons set starts_on = current_date - 9, ends_on = current_date - 9 + 84");
  await q.end();
  await browser.close();
  finish("messaging");
}
void main();

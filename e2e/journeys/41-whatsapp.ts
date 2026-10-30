/**
 * WhatsApp that cannot fail quietly, stages 1 and 2 (the safety net and the health page), end to end.
 *
 *  - Everything starts Off: the Messages page has no WhatsApp card and no link to a health page, and the health page itself is "not found".
 *  - The owner (alone, on the console's Features page) opens the safety net as Rehearsal and then On. The admin pauses WhatsApp from the Messages page with
 *    a reason: a member who agreed to WhatsApp is written to by email instead and nothing reaches Meta. The admin restarts it and the next message goes
 *    to WhatsApp.
 *  - Meta then refuses the account (the stand-in says the access token has expired): five refusals and WhatsApp pauses itself, the director and the admin
 *    are queued an email, and nothing turns it back on until a person does.
 *  - The owner opens the health page. The admin asks Meta: with the free test number the page says so in words (and says what to do), with the church's
 *    own number it says nothing is stopping WhatsApp, and with an expired token it says the token. Meta's news (a template refused) arrives through the
 *    signed webhook and is listed. The admin sends themselves a test message; it reaches the stand-in, and a signed receipt turns it to "arrived".
 *  - Nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a member with a number, a staff number) is arranged in the database the way the database tests do it; everything a person
 * does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import { createHmac } from "node:crypto";
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { expectedTemplates } from "../../src/lib/whatsapp/health";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function eventually(label: string, read: () => Promise<boolean>, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; retried: number; rejected: number; problems: string[] } };
};
const stub = async (channel: string) => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Received[];
const meta = (mode: Record<string, unknown>) =>
  fetch(`${state().stubUrl}/__meta/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mode) });
const sign = (body: string) => `sha256=${createHmac("sha256", MESSAGING.appSecret).update(body).digest("hex")}`;
const hook = (body: string) =>
  fetch(`${BASE}/api/webhooks/whatsapp`, { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) } });

const WEEK = JSON.stringify({ week: 3, tribe: "E2E Tribe", title: "Pray with expectation", passage: "Philippians 4:6-7", big_idea: "Prayer is a conversation.", will: "pray for five minutes", when: "when I wake up" });

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);

  // ---- Arranging: everything Off, a member who agreed to WhatsApp, staff with a number ------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  await q.query("update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = null, would_pause_at = null, trip_count = 5, trip_minutes = 30, unconfirmed_hours = 24");
  for (const t of ["whatsapp_faults", "whatsapp_guard_log", "whatsapp_signals", "whatsapp_outcomes"]) await q.query(`delete from public.${t}`);
  await q.query("insert into public.whatsapp_checks (id) values (true) on conflict do nothing");
  await q.query("update public.whatsapp_checks set checked_at = null, checked_by = null, result = '{}'::jsonb"); // one row, kept
  await fetch(`${state().stubUrl}/__reset`, { method: "POST" });
  await meta({ templates: expectedTemplates() });
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "wa.owner@example.org"); // the shared e2e database may already hold owner@example.org from another journey
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const wanda = await adapter.createUser({ email: "wa.wanda@example.org" });
  await q.query("update public.people set full_name = 'Wanda Eze', preferred_name = 'Wanda' where id = $1", [wanda.id]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031230001', 'whatsapp')", [wanda.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [wanda.id]);
  const ADMIN = "admin.mary@example.org";
  const admin = (await one("select id from public.people where email = $1", [ADMIN]))!.id as string;
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031230002', 'email') on conflict (person_id) do update set phone = excluded.phone", [admin]);
  const queue = async (key: string) =>
    (await one("select public.enqueue_message($1, 'week_start', $2::jsonb, null, $3, null, 'urgent') as id", [wanda.id, WEEK, `e2e:wa:${key}`]))!.id as string;
  const row = async (id: string) => (await one("select status, channel, tried, error from public.messages where id = $1", [id]))!;
  const toWanda = (list: Received[]) => list.filter((r) => String(r.body.to) === "2348031230001" || ((r.body.to as string[] | undefined)?.[0] === "wa.wanda@example.org"));

  const browser = await launch();

  // ---- Everything Off: nobody finds anything -----------------------------------------------------------------------------------------------
  const { ctx: actx, page: staff } = await newPage(browser, "desktop");
  await signIn(staff, ADMIN, "/admin/messages");
  await open(staff, "/admin/messages");
  await staff.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  check((await staff.getByTestId("wa-guard").count()) === 0, "with the switches Off, the Messages page has no WhatsApp card");
  check((await staff.getByTestId("wa-health-link").count()) === 0, "…and no link to a health page");
  await open(staff, "/admin/messages/whatsapp");
  has("…and the health page is not found", /find that page/i, await text(staff));

  // ---- God Mode: the owner opens the safety net as Rehearsal, then On -------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await owner.getByRole("link", { name: "Features", exact: true }).first().click();
  await owner.waitForURL(/\/god\/features/, { timeout: 15000 });
  await owner.getByTestId("features-board").waitFor({ timeout: 20000 });
  for (const key of ["whatsapp_guard", "whatsapp_health", "number_required"]) {
    check(/Off/.test(await owner.getByTestId(`feature-${key}`).innerText()), `${key} starts Off on the owner's Features page`);
  }

  async function moveSwitch(key: string, position: "rehearsal" | "on", reason = "") {
    const box = owner.getByTestId(`feature-${key}-editor`);
    if ((await box.count()) === 0) await owner.getByTestId(`feature-${key}-open`).click();
    await box.waitFor({ timeout: 15000 });
    check((await owner.getByTestId(`feature-${key}-whole-church`).count()) === 1, `${key} is for the whole church only: there is no place or role to choose`);
    await owner.getByTestId(`feature-${key}-${position}`).click();
    if (reason) await box.getByLabel(/Why open it for the whole church/).fill(reason);
    await owner.getByTestId(`feature-${key}-save`).click();
  }
  const stateOf = async (key: string) => (await one("select public.feature_platform_state($1) as s", [key]))?.s;

  await moveSwitch("whatsapp_guard", "rehearsal");
  await eventually("the safety net is in Rehearsal", async () => (await stateOf("whatsapp_guard")) === "rehearsal");

  // ---- Rehearsal: it watches and says so, and holds nothing back ---------------------------------------------------------------------------
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-guard").waitFor({ timeout: 20000 });
  has("in Rehearsal the card says so", /Rehearsal/, await staff.getByTestId("wa-guard-now").innerText());
  check((await staff.getByRole("button", { name: "Pause all WhatsApp messages" }).count()) === 0, "…and there is no stop button yet (a pause does nothing in Rehearsal)");

  await moveSwitch("whatsapp_guard", "on", "Opening the safety net for the whole church in the rehearsal of this journey.");
  await eventually("the safety net is On", async () => (await stateOf("whatsapp_guard")) === "on");

  // ---- On: a person pauses WhatsApp; the message goes by email, nothing reaches Meta --------------------------------------------------------
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-guard").waitFor({ timeout: 20000 });
  has("the card says WhatsApp is running", /Running/, await staff.getByTestId("wa-guard-now").innerText());
  await shot(staff, "41-guard-running");
  await staff.getByRole("button", { name: "Pause all WhatsApp messages" }).click();
  const reason = staff.getByLabel(/Why are you pausing WhatsApp/);
  await reason.fill("Short");
  check(await staff.getByRole("button", { name: "Pause WhatsApp messages" }).isDisabled(), "a reason shorter than 8 characters keeps it from being paused");
  await reason.fill("Looking into a Meta notice, back soon.");
  await staff.getByRole("button", { name: "Pause WhatsApp messages" }).click();
  await staff.getByTestId("wa-guard-paused").waitFor({ timeout: 15000 });
  has("paused: the card says who and why", /Paused[\s\S]*Looking into a Meta notice, back soon\./, await staff.getByTestId("wa-guard-paused").innerText());
  check((await one("select paused, auto from public.whatsapp_guard"))?.paused === true, "the pause is recorded");

  const m1 = await queue("1");
  await tick();
  const r1 = await row(m1);
  check(r1.channel === "email" && r1.status === "sent", "while it is paused the member is written to by email");
  check(toWanda(await stub("whatsapp")).length === 0, "…and nothing reached Meta");

  await staff.getByRole("button", { name: "I have looked into it: restart" }).click();
  await staff.getByLabel(/A note for the log/).fill("Fine now");
  await staff.getByRole("button", { name: "Restart WhatsApp messages" }).click();
  await eventually("WhatsApp is restarted", async () => (await one("select paused from public.whatsapp_guard"))?.paused === false);
  const m2 = await queue("2");
  await tick();
  check((await row(m2)).channel === "whatsapp", "after the restart the next message goes to WhatsApp");
  check(toWanda(await stub("whatsapp")).length === 1, "…and reached Meta");
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-guard").waitFor({ timeout: 20000 });
  await staff.getByText("What happened lately").click();
  has("the log says who paused it and who restarted it", /paused by a person[\s\S]*restarted by a person/, await staff.getByTestId("wa-guard-log").innerText().then((t) => t.split("\n").reverse().join(" ")));

  // ---- Meta refuses the account: five refusals and it pauses itself ------------------------------------------------------------------------
  await meta({ token: "expired" });
  const ids: string[] = [];
  for (let i = 3; i < 8; i += 1) ids.push(await queue(String(i)));
  await tick();
  await eventually("WhatsApp paused itself", async () => (await one("select paused, auto from public.whatsapp_guard"))?.auto === true);
  const refused = await row(ids[0]!);
  check(refused.channel !== "whatsapp" || (refused.tried as string[]).includes("whatsapp"), "the refused messages were turned away from WhatsApp, not lost");
  check((await n("select count(*)::int n from public.messages where template = 'whatsapp_paused' and force_channel = 'email'")) >= 2, "the director and the admin are emailed, and never by WhatsApp");
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-guard-paused").waitFor({ timeout: 20000 });
  has("the card says it paused itself, and why", /It paused itself/, await staff.getByTestId("wa-guard-paused").innerText());
  has("…and what Meta said, in words", /access token has expired/i, await staff.getByTestId("wa-guard-advice").innerText());
  await shot(staff, "41-guard-auto-paused");
  await tick();
  check((await one("select paused from public.whatsapp_guard"))?.paused === true, "it does not start again by itself");
  await meta({ token: "ok" });
  await staff.getByRole("button", { name: "I have looked into it: restart" }).click();
  await staff.getByLabel(/A note for the log/).fill("Token replaced");
  await staff.getByRole("button", { name: "Restart WhatsApp messages" }).click();
  await eventually("a person restarts it", async () => (await one("select paused from public.whatsapp_guard"))?.paused === false);

  // ---- The health page --------------------------------------------------------------------------------------------------------------------
  await moveSwitch("whatsapp_health", "on", "Opening the health page for the whole church in the rehearsal of this journey.");
  await eventually("the health page is On", async () => (await stateOf("whatsapp_health")) === "on");
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-health-link").waitFor({ timeout: 20000 });
  await staff.getByTestId("wa-health-link").getByRole("link", { name: "WhatsApp health" }).click();
  await staff.waitForURL(/\/admin\/messages\/whatsapp/, { timeout: 15000 });
  await staff.getByTestId("wa-checks").waitFor({ timeout: 20000 });
  has("nobody has asked Meta yet, and the page says so", /Nobody has asked yet/, await staff.getByTestId("wa-checks").innerText());

  // 1. Meta's free test number: the cause of error 131030
  await meta({ sender: "test" });
  await staff.getByRole("button", { name: "Check now" }).click();
  await staff.getByTestId("wa-checks-summary").waitFor({ timeout: 20000 });
  has("a test number is named for what it is", /Something needs fixing/, await staff.getByTestId("wa-checks-summary").innerText());
  const number = staff.getByTestId("wa-check-number");
  check((await number.getAttribute("data-state")) === "bad", "the sending number is marked as a problem");
  has("…in plain words, with 131030 and what to do", /free test number[\s\S]*131030[\s\S]*Register the church.s own number/, await number.innerText());
  await shot(staff, "41-health-test-number");

  // 2. The church's own number
  await meta({ sender: "own" });
  await staff.getByRole("button", { name: "Check again" }).click();
  await eventually("the page reads the new answer", async () => (await staff.getByTestId("wa-checks-summary").innerText()) === "Nothing is stopping WhatsApp.");
  check((await staff.getByTestId("wa-check-number").getAttribute("data-state")) === "good", "with the church's own number the sending number is good");
  check((await staff.getByTestId("wa-check-token").getAttribute("data-state")) === "good", "…and so is the access token");
  check((await staff.getByTestId("wa-check-subscription").getAttribute("data-state")) === "good", "…and the delivery receipts");
  has("…and every message has approved wording", new RegExp(`${expectedTemplates().length} of ${expectedTemplates().length} messages have approved wording`), await staff.getByTestId("wa-check-templates").innerText());
  await noOverflow(staff, "the health page on a desktop");
  await shot(staff, "41-health-good");

  // 3. An expired token
  await meta({ token: "expired" });
  await staff.getByRole("button", { name: "Check again" }).click();
  await eventually("the page reads the expired token", async () => (await staff.getByTestId("wa-check-token").getAttribute("data-state")) === "bad");
  has("an expired token is named, with the fix", /expired[\s\S]*never expires/i, await staff.getByTestId("wa-check-token").innerText());
  await meta({ token: "ok" });
  await staff.getByRole("button", { name: "Check again" }).click();
  await eventually("the page is good again", async () => (await staff.getByTestId("wa-checks-summary").innerText()) === "Nothing is stopping WhatsApp.");

  // 4. Meta's news, through the signed webhook
  const news = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "900800700", changes: [{ field: "message_template_status_update", value: { event: "REJECTED", message_template_name: "ut_welcome", message_template_language: "en", reason: "INVALID_FORMAT" } }] }] });
  check((await fetch(`${BASE}/api/webhooks/whatsapp`, { method: "POST", body: news, headers: { "content-type": "application/json" } })).status === 401, "Meta's news without its signature is refused");
  check((await hook(news)).status === 200, "Meta's news with its signature is accepted");
  check((await n("select count(*)::int n from public.messages where template = 'whatsapp_signal' and force_channel = 'email'")) >= 1, "the director and the admin are emailed that a template was refused");
  await open(staff, "/admin/messages/whatsapp");
  await staff.getByTestId("wa-signals").waitFor({ timeout: 20000 });
  has("the page lists what Meta told the site", /ut_welcome is rejected \(invalid format\)/, await staff.getByTestId("wa-signals").innerText());

  // 5. A test message to the admin's own number
  await staff.getByRole("button", { name: "Send me a test message" }).click();
  await eventually("the test message is queued", async () => (await n("select count(*)::int n from public.messages where template = 'whatsapp_test' and person_id = $1", [admin])) === 1);
  await tick();
  const tests = (await stub("whatsapp")).filter((r) => (r.body.template as { name: string }).name === "ut_whatsapp_test");
  check(tests.length === 1 && tests[0]?.body.to === "2348031230002", "the test reached Meta, addressed to the number on the admin's own profile");
  await open(staff, "/admin/messages/whatsapp");
  await staff.getByTestId("wa-test-status").waitFor({ timeout: 20000 });
  has("the page says Meta accepted it and it is waiting for a receipt", /Meta accepted it/, await staff.getByTestId("wa-test-status").innerText());
  const receipt = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: String(tests[0]?.id), status: "delivered" }] } }] }] });
  check((await hook(receipt)).status === 200, "a signed delivery receipt is accepted");
  await open(staff, "/admin/messages/whatsapp");
  await staff.getByTestId("wa-test-status").waitFor({ timeout: 20000 });
  has("…and the page says it arrived", /It arrived on your phone\. WhatsApp is working\./, await staff.getByTestId("wa-test-status").innerText());
  check((await staff.getByTestId("wa-test-status").getAttribute("data-state")) === "good", "…marked as good");

  // ---- On a phone, nothing scrolls sideways --------------------------------------------------------------------------------------------------
  const { ctx: pctx, page: phone } = await newPage(browser, "phone");
  await signIn(phone, ADMIN, "/admin/messages/whatsapp");
  await open(phone, "/admin/messages/whatsapp");
  await phone.getByTestId("wa-checks").waitFor({ timeout: 20000 });
  await noOverflow(phone, "the health page on a phone");
  await open(phone, "/admin/messages");
  await phone.getByTestId("wa-guard").waitFor({ timeout: 20000 });
  await noOverflow(phone, "the Messages page with the safety net on a phone");

  await pctx.close();
  await octx.close();
  await actx.close();
  await browser.close();
  await q.end();
  finish("41-whatsapp");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

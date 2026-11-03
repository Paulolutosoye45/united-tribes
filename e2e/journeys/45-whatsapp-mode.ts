/**
 * WhatsApp mode (Full, Saver, Free) and WhatsApp sent by hand, end to end.
 *
 *  - Everything starts Off: the Messages page has no link to WhatsApp mode, the mode page is "not found", and a leader's Send-by-WhatsApp page says it is
 *    not switched on yet.
 *  - The owner (alone, on the console's Features page) opens the safety net and then WhatsApp mode. The admin opens the mode page: it says Full.
 *  - The admin chooses Free, with a reason. From then on a member who agreed to WhatsApp and to email is written to by email, and the Meta stand-in is
 *    never asked for anything. A member who agreed to WhatsApp only is not sent anything: the message says it is to be sent by hand.
 *  - The leader opens Send by WhatsApp on a phone. The page says the church is not sending from the site, names the member who could not be reached, and
 *    lets the leader copy the words and open the tribe's group, and message a member on their own phone. The leader never sees a number. What was sent and
 *    what was left is marked, and the log says so.
 *  - The office opens "Message a leader by hand", and the cost page, which says nothing is being paid to Meta.
 *  - The admin chooses Full again with a reason: the next message goes through the Meta stand-in. Nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a running season, a tribe with a group link, members with numbers and consents) is arranged in the database the way the
 * database tests do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
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

const WEEK = JSON.stringify({ week: 3, tribe: "E2E Tribe", title: "Pray with expectation", passage: "Philippians 4:6-7", big_idea: "Prayer is a conversation.", will: "pray for five minutes", when: "when I wake up" });
const GROUP = "https://chat.whatsapp.com/ABCDEFGH12";

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off, a running season, a tribe with a group link, three members with numbers -----------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  await q.query("update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = null, would_pause_at = null");
  for (const t of ["whatsapp_faults", "whatsapp_guard_log", "whatsapp_signals", "whatsapp_outcomes", "whatsapp_hand_log", "whatsapp_mode_log", "whatsapp_marketing"]) {
    await q.query(`delete from public.${t}`);
  }
  await q.query(
    `update public.whatsapp_mode set mode = 'full', reason = null, changed_at = null, changed_by = null, auto = false, ceiling_usd = 100, warn_pct = 80, pace_per_hour = 300,
            reach_pct = 80, weekly_cap = 2, window_from = 0, window_to = 24, quality_guard = true, ceiling_warned_month = null, ceiling_tripped_month = null`,
  );
  await q.query("delete from public.whatsapp_rates where added_by is not null");
  await fetch(`${state().stubUrl}/__reset`, { method: "POST" });
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "wamode.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  await k.moveSeason(S, 9);
  const t = await k.tribe(S, { name: "Hand Tribe", track: "builders" });
  await q.query("update public.tribes set whatsapp_group_url = $2 where id = $1", [t.tribe, GROUP]);
  await q.query("update public.people set full_name = 'Lara Hand', preferred_name = 'Lara' where id = $1", [t.leader.id]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031240000', 'whatsapp') on conflict (person_id) do update set phone = excluded.phone", [t.leader.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [t.leader.id]);

  // Wanda: agreed to WhatsApp and email. Quiet Qin: agreed to WhatsApp only (email refused). Plain Pat: has not agreed to WhatsApp.
  const person = async (name: string, first: string, phone: string | null, wa: boolean, email: boolean) => {
    const s = await k.seat(t.tribe, S, name, { profile: false });
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [s.id, `${first} ${name}`, first]);
    if (phone) await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp') on conflict (person_id) do update set phone = excluded.phone", [s.id, phone]);
    if (wa) await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [s.id]);
    if (!email) await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'e2e')", [s.id]);
    return s;
  };
  const wanda = await person("Wanda", "Wanda", "+2348031240001", true, true);
  const qin = await person("Qin", "Qin", "+2348031240002", true, false);
  const pat = await person("Pat", "Pat", null, false, true);
  const ADMIN = "admin.mary@example.org";

  const queue = async (who: string, key: string) =>
    (await one("select public.enqueue_message($1, 'week_start', $2::jsonb, null, $3, null, 'urgent') as id", [who, WEEK, `e2e:wamode:${key}`]))!.id as string;
  const row = async (id: string) => (await one("select status, channel, tried, error from public.messages where id = $1", [id]))!;

  const browser = await launch();

  // ---- Everything Off: nobody finds anything -----------------------------------------------------------------------------------------------
  const { ctx: actx, page: staff } = await newPage(browser, "desktop");
  await signIn(staff, ADMIN, "/admin/messages");
  await open(staff, "/admin/messages");
  await staff.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  check((await staff.getByTestId("wa-mode-link").count()) === 0, "with the switches Off, the Messages page has no link to WhatsApp mode");
  await open(staff, "/admin/messages/whatsapp-mode");
  has("…and the mode page is not found", /find that page/i, await text(staff));

  const lead = await newPage(browser, "phone", { permissions: ["clipboard-read", "clipboard-write"] });
  await lead.ctx.route(/chat\.whatsapp\.com|wa\.me/, (r) => r.abort());
  await signIn(lead.page, t.leader.email, "/lead/hand");
  await open(lead.page, "/lead/hand");
  await lead.page.getByTestId("hand-none").waitFor({ timeout: 20000 });
  has("a leader's Send-by-WhatsApp page says it is not switched on yet", /not switched on yet/, await text(lead.page));

  // ---- God Mode: the owner opens the safety net, then WhatsApp mode ------------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await owner.getByRole("link", { name: "Features", exact: true }).first().click();
  await owner.waitForURL(/\/god\/features/, { timeout: 15000 });
  await owner.getByTestId("features-board").waitFor({ timeout: 20000 });
  check(/Off/.test(await owner.getByTestId("feature-whatsapp_mode").innerText()), "WhatsApp mode starts Off on the owner's Features page");

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
  await moveSwitch("whatsapp_guard", "on", "Opening the safety net for the whole church in this journey.");
  await eventually("the safety net is On", async () => (await stateOf("whatsapp_guard")) === "on");
  await moveSwitch("whatsapp_mode", "on", "Opening WhatsApp mode for the whole church in this journey.");
  await eventually("WhatsApp mode is On", async () => (await stateOf("whatsapp_mode")) === "on");
  await octx.close();

  // ---- The admin: the mode page says Full -----------------------------------------------------------------------------------------------------
  await open(staff, "/admin/messages");
  await staff.getByTestId("wa-mode-link").waitFor({ timeout: 20000 });
  await open(staff, "/admin/messages/whatsapp-mode");
  await staff.getByTestId("wa-mode").waitFor({ timeout: 20000 });
  has("the mode page says WhatsApp is in Full mode", /Full/, await staff.getByTestId("wa-mode-now").innerText());
  check((await staff.getByTestId("wa-mode-free-note").count()) === 0, "…and carries no Free-mode warning");
  await shot(staff, "45-mode-full");

  // ---- The admin chooses Free, with a reason ------------------------------------------------------------------------------------------------
  await staff.getByTestId("wa-mode-choose-free").click();
  await staff.getByTestId("wa-mode-reason").fill("Meta bills too much this month");
  await staff.getByTestId("wa-mode-apply").click();
  await eventually("the church is in Free mode", async () => (await one("select mode from public.whatsapp_mode"))?.mode === "free");
  await staff.getByTestId("wa-mode-free-note").waitFor({ timeout: 20000 });
  has("the page says Free sends nothing through Meta", /nothing is sent through Meta|no request to Meta/i, await text(staff));
  check(
    (await one("select count(*)::int n from public.whatsapp_mode_log where kind = 'mode' and reason like '%bills too much%'"))?.n === 1,
    "the reason and the change are in the log",
  );
  await shot(staff, "45-mode-free");

  // ---- Free mode: email only, and Meta is never asked ---------------------------------------------------------------------------------------
  const toWanda = await queue(wanda.id, "free-wanda");
  const toQin = await queue(qin.id, "free-qin");
  const ticked = await tick();
  check(ticked.status === 200, "the sender ran");
  await eventually("Wanda's message goes by email", async () => (await row(toWanda)).status === "sent");
  const w = await row(toWanda);
  check(w.channel === "email", "a member who agreed to WhatsApp and email gets the message by email in Free mode");
  await eventually("Qin's message is dealt with", async () => (await row(toQin)).status !== "queued" && (await row(toQin)).status !== "claimed");
  const qr = await row(toQin);
  check(qr.status !== "sent" && qr.channel !== "whatsapp", "a member who agreed to WhatsApp only is sent nothing");
  has("…and the message says to send it by hand", /send this one by hand/, String(qr.error ?? ""));
  check((await stub("whatsapp")).length === 0, "the Meta stand-in was never asked to send anything");

  // ---- The cost page and the by-hand page for the office ----------------------------------------------------------------------------------------
  await open(staff, "/admin/messages/whatsapp-cost");
  await staff.getByTestId("wa-cost").waitFor({ timeout: 20000 });
  check((await staff.getByTestId("wa-cost-free").count()) === 1, "the cost page says nothing is being paid to Meta in Free mode");
  await shot(staff, "45-cost");
  await open(staff, "/admin/messages/by-hand");
  await staff.getByTestId("hand-staff").waitFor({ timeout: 20000 });
  check((await staff.getByTestId(`hand-staff-${t.leader.id}`).count()) === 1, "the office can message a leader who agreed to WhatsApp, by hand");
  await staff.getByTestId(`hand-staff-open-${t.leader.id}`).click();
  await staff.getByTestId("hand-staff-opened").waitFor({ timeout: 20000 });
  check((await one("select count(*)::int n from public.whatsapp_hand_log where person_id = $1 and scope = 'person'", [t.leader.id]))?.n === 1, "…and it is logged");
  await shot(staff, "45-by-hand-office");

  // ---- The leader, on a phone ----------------------------------------------------------------------------------------------------------------
  const lp = lead.page;
  await open(lp, "/lead/hand");
  await lp.getByTestId("send-by-hand").waitFor({ timeout: 20000 });
  check((await lp.getByTestId("hand-free").count()) === 1, "the leader's page says the church is not sending WhatsApp from the site");
  has("…and names the member who could not be reached by email either", /Qin/, await lp.getByTestId("hand-unsent").innerText());
  await noOverflow(lp, "the Send-by-WhatsApp page on a phone");
  await shot(lp, "45-leader-hand");

  // Post to the tribe's group
  check((await lp.getByTestId("hand-group-text").inputValue()).length > 20, "the words for the group are ready");
  const group = lp.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
  await lp.getByTestId("hand-group-open").click();
  await lp.getByTestId("hand-opened").waitFor({ timeout: 20000 });
  (await group)?.close().catch(() => undefined);
  check((await one("select count(*)::int n from public.whatsapp_hand_log where tribe_id = $1 and scope = 'group' and outcome = 'opened'", [t.tribe]))?.n === 1, "opening the group is logged");
  await lp.getByTestId("hand-sent").click();
  await eventually("the group post is marked sent", async () => (await one("select outcome from public.whatsapp_hand_log where scope = 'group' and tribe_id = $1", [t.tribe]))?.outcome === "sent");

  // Message a member
  check((await lp.getByTestId(`hand-open-${wanda.id}`).count()) === 1, "Wanda, who said yes to WhatsApp, can be messaged");
  check((await lp.getByTestId(`hand-open-${pat.id}`).count()) === 0, "…Pat, who did not, cannot");
  const body = await text(lp);
  check(!/\+?234\d{8,}|0803\d{7}/.test(body), "the page never shows a phone number");
  const chat = lp.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
  await lp.getByTestId(`hand-open-${wanda.id}`).click();
  await lp.getByTestId("hand-opened").waitFor({ timeout: 20000 });
  (await chat)?.close().catch(() => undefined);
  await lp.getByTestId("hand-skipped").click();
  await eventually("the member message is marked left", async () => (await one("select outcome from public.whatsapp_hand_log where scope = 'person' and person_id = $1", [wanda.id]))?.outcome === "skipped");
  await lp.getByText("What you have sent lately").click();
  has("the leader's list shows what was sent and what was left", /to the group[\s\S]*sent|to Wanda[\s\S]*left/, await lp.getByTestId("hand-recent").innerText());
  await shot(lp, "45-leader-hand-done");
  await lead.ctx.close();

  // ---- The admin chooses Full again: the next message goes through Meta ------------------------------------------------------------------------
  await open(staff, "/admin/messages/whatsapp-mode");
  await staff.getByTestId("wa-mode").waitFor({ timeout: 20000 });
  await staff.getByTestId("wa-mode-choose-full").click();
  await staff.getByTestId("wa-mode-reason").fill("The bill is under control again");
  await staff.getByTestId("wa-mode-apply").click();
  await eventually("the church is back in Full mode", async () => (await one("select mode from public.whatsapp_mode"))?.mode === "full");
  const again = await queue(wanda.id, "full-wanda");
  await tick();
  await eventually("Wanda's next message goes by WhatsApp", async () => (await row(again)).status === "sent" || (await row(again)).status === "delivered");
  check((await row(again)).channel === "whatsapp", "in Full mode the message goes by WhatsApp");
  const reached = (await stub("whatsapp")).filter((r) => String(r.body.to) === "2348031240001");
  check(reached.length === 1, "…and the Meta stand-in received it, addressed to Wanda");
  await noOverflow(staff, "the mode page");
  await actx.close();

  // Put the shared database back the way this journey found it
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.whatsapp_mode set mode = 'full'");
  await q.query("delete from public.feature_settings");

  await browser.close();
  await q.end();
  finish("45-whatsapp-mode");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

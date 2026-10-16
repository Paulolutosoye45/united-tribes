/**
 * The activity log and decision dashboard (Phase 5), end to end, and for the owner alone.
 *
 * A member and an admin use the app and are recorded by screen name, device and time, never by what they write. To the admin,
 * the leader, the member and everyone else the dashboard is a page that does not exist (not one menu item, link or number).
 * The owner, after the passphrase, opens all seven tabs, reads the numbers, drills into a bar of a funnel (names only when five
 * or more; a young member never), downloads the audit trail safely, changes a flag and pauses recording, and every one of those
 * looks is written in their own record. Nothing the owner does is itself recorded as activity.
 */
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const TABS = ["", "/funnels", "/stakeholders", "/quality", "/messages", "/audit", "/settings"].map((t) => `/god/activity${t}`);

/** Set E2E_SHOTS=<folder> to keep a picture of each screen as it is reached (for looking at, not for checking). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  const adapter = {
    admin: q,
    async createUser(opts: { email?: string } = {}) {
      const email = (opts.email ?? `e2e${Math.random().toString(16).slice(2, 10)}@example.org`).toLowerCase();
      const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
      return { id: made, email };
    },
    async grant(userId: string, role: string) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [userId, role]);
    },
  };
  const k = await kit(adapter as unknown as TestDb);
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const browser = await launch();

  // --- the people ----------------------------------------------------------------------------------------------------------
  const { tribe, leader } = await k.tribe(S, { name: "Yaba Builders" });
  const bisi = await k.seat(tribe, S, "Bisi");
  await k.meetings(tribe, leader.id, 2, [[bisi.id, 2]]);
  // The journeys share one database, and an earlier one (10) leaves its owner in place; there can only be one, so replace it.
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "activity.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);
  const adminId = (await one("select id from public.people where email = 'admin.mary@example.org'"))!.id as string;
  const chidiId = (await one("select id from public.people where email = 'member@example.org'"))!.id as string;

  // Who the dashboard will count: eight people who registered and did nothing more (so one bar of the funnel holds them),
  // and one young member (counted, never named).
  const seeded: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const p = await adapter.createUser({ email: `seed${i}@example.org` });
    await q.query("update public.people set full_name = $2, preferred_name = $2 where id = $1", [p.id, `Seed Person ${i}`]);
    seeded.push(p.id);
  }
  const young = await adapter.createUser({ email: "youngster@example.org" });
  await q.query("update public.people set full_name = 'Tobi Youngster', preferred_name = 'Tobi' where id = $1", [young.id]);
  await k.profile(young.id, S);
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [young.id]);
  await q.query("commit");
  // Some history, so the charts have a shape: the eight were each seen on a few days in the last three weeks.
  for (const [i, id] of seeded.entries()) {
    for (const d of [1 + (i % 3), 4 + (i % 5), 9 + (i % 4), 16]) {
      await q.query(
        `insert into public.activity_events (at, day, person_id, kind, meta)
         values (((public.today_lagos() - $2::int)::timestamp + interval '18 hours') at time zone 'Africa/Lagos', public.today_lagos() - $2::int, $1, 'screen', '{"screen":"home","device":"phone","speed":"ok"}'::jsonb)`,
        [id, d],
      );
    }
  }
  await q.query("update public.people set created_at = now() - interval '12 days' where id = any($1::uuid[])", [seeded]);
  // Five more who sent the form and stopped there, so that bar is big enough to show names (and counts the young member).
  for (let i = 1; i <= 5; i++) {
    const p = await adapter.createUser({ email: `sent${i}@example.org` });
    await q.query("update public.people set full_name = $2, preferred_name = $2 where id = $1", [p.id, `Sent Person ${i}`]);
    await k.profile(p.id, S);
  }

  // --- 1. real use is recorded, by name and never by content --------------------------------------------------------------
  // Bisi's form was saved by the setup (which the log noted); begin from nothing, as on a first visit after the log was switched on.
  await q.query("delete from public.activity_events where person_id = $1", [bisi.id]);
  const member = await newPage(browser, "phone");
  await signIn(member.page, bisi.email, "/home");
  await open(member.page, "/home");
  await open(member.page, "/tribe");
  await member.page.waitForTimeout(1500);
  const bisiId = bisi.id as string;
  const signins = await all("select meta from public.activity_events where person_id = $1 and kind = 'signin'", [bisiId]);
  check(signins.length === 1 && (signins[0].meta as Row).method === "email", "a typed email code is recorded once as a sign-in, by method only");
  const screens = (await all("select meta from public.activity_events where person_id = $1 and kind = 'screen'", [bisiId])).map((r) => r.meta as Row);
  check(screens.some((m) => m.screen === "home") && screens.some((m) => m.screen === "tribe"), "the member’s screens are recorded by name");
  check(screens.every((m) => m.device === "phone"), "…on a phone");
  check((await all("select 1 from public.activity_events where person_id = $1 and kind = 'visit'", [bisiId])).length >= 1, "…and the visit");
  const allowed = new Set(["screen", "device", "speed", "method"]);
  const stored = await all("select meta from public.activity_events where person_id = $1", [bisiId]);
  check(stored.every((r) => Object.keys(r.meta as Row).every((key) => allowed.has(key))), "an event carries only a screen, a device, a speed or a method: never an address or a word");
  const memberText = await text(member.page);
  check(!/Activity and decisions|\/god|Console/.test(memberText), "the member sees nothing about it on any page they use");
  const memberLinks = await member.page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  check(!memberLinks.some((h) => h.startsWith("/god")), "…not one link");

  // --- 2. to everyone else it does not exist ------------------------------------------------------------------------------
  // Earlier journeys signed this admin in many times; begin from nothing so the count below is this visit's alone.
  await q.query("delete from public.activity_events where person_id = $1", [adminId]);
  const office = await newPage(browser, "desktop");
  await signIn(office.page, "admin.mary@example.org", "/admin/people");
  await office.page.waitForTimeout(1200);
  check((await all("select 1 from public.activity_events where person_id = $1 and kind = 'screen' and meta ->> 'screen' = 'admin_people'", [adminId])).length >= 1, "an admin’s own screens are recorded the same way");
  for (const path of TABS) {
    await open(office.page, path);
    const page = await text(office.page);
    check(/We can.t find that page/.test(page) && !/Activity and decisions|Needs a decision|The member journey|Download as a spreadsheet|Exactly what is recorded/.test(page), `${path} does not exist for an admin`);
  }
  const csvTry = await office.page.request.get(`${BASE}/god/activity/audit/export`);
  check(csvTry.status() === 404 && !(csvTry.headers()["content-type"] ?? "").includes("csv"), "…and no file can be downloaded");
  await open(office.page, "/admin");
  const adminLinks = await office.page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  check(!adminLinks.some((h) => h.startsWith("/god")) && !/Activity and decisions/.test(await text(office.page)), "no menu item, link or number about it on the admin’s pages");

  const lead = await newPage(browser, "phone");
  await signIn(lead.page, "ngozi@example.org", "/lead");
  for (const path of ["/god/activity", "/god/activity/funnels"]) {
    await open(lead.page, path);
    check(/We can.t find that page/.test(await text(lead.page)), `${path} does not exist for a leader`);
  }
  await lead.ctx.close();
  const outside = await newPage(browser, "desktop");
  await open(outside.page, "/god/activity");
  check(/\/sign-in/.test(outside.page.url()), "a stranger who is not signed in is sent to sign in, and learns nothing");
  const beacon = await outside.page.request.post(`${BASE}/api/track`, { data: { kind: "visit" } });
  check(beacon.status() === 401, "the quiet door answers a stranger with “sign in”");
  await outside.ctx.close();

  // --- 3. the owner signs in and unlocks ----------------------------------------------------------------------------------
  const me = await newPage(browser, "desktop", { permissions: ["clipboard-read", "clipboard-write"] });
  await signIn(me.page, owner.email, "/home");
  await me.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await open(me.page, "/god/activity");
  check(/\/god\/unlock/.test(me.page.url()), "before the passphrase even the owner is held at the unlock");
  await me.page.getByLabel("Passphrase").fill(PHRASE);
  await me.page.getByRole("button", { name: "Unlock" }).click();
  await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  check(await me.page.getByRole("link", { name: "Activity", exact: true }).first().isVisible(), "the owner’s console has an Activity room");

  // rebuild the summaries from the start, as the heartbeat does
  await q.query("select public.activity_refresh(now(), true)");

  // --- 4. Pulse ----------------------------------------------------------------------------------------------------------
  await me.page.getByRole("link", { name: "Activity", exact: true }).first().click();
  await me.page.waitForURL((u) => u.pathname === "/god/activity", { timeout: 15000 });
  check(await heading(me.page, "Activity and decisions").isVisible(), "the Activity room opens");
  const tabNames = await me.page.getByRole("navigation", { name: "Activity" }).getByRole("link").allInnerTexts();
  check(
    JSON.stringify(tabNames) === JSON.stringify(["Pulse", "Funnels", "Stakeholders", "Quality and integrity", "Messages and sign-in", "Audit trail", "Settings"]),
    "…with the six tabs and its settings",
  );
  const pulse = await text(me.page);
  check(/Needs a decision/.test(pulse) && /This week at a glance/.test(pulse) && /People active/.test(pulse), "Pulse shows what needs a decision, and the week at a glance");
  check(/Recording since/.test(await me.page.getByTestId("activity-status").innerText()), "…and says since when it has been recording");
  check(/Over 30 days/.test(pulse) && (await me.page.getByRole("img", { name: /Active people, by day/ }).isVisible()), "…a 30-day line with the month before behind it");
  check((await me.page.getByRole("img", { name: /by weekday and hour/ }).count()) === 1, "…and when people are active");
  check(/Young members/.test(pulse) && /never named/.test(pulse), "…young members counted, never named");
  const brief = await me.page.getByTestId("weekly-brief").innerText();
  check(/United Tribes: weekly brief/.test(brief) && /People active:/.test(brief) && /Counts only/.test(brief), "the weekly brief is on the page, written by fixed rules");
  await me.page.getByRole("button", { name: "Copy as text" }).click();
  await me.page.getByText("Copied.").waitFor({ timeout: 5000 });
  const copied = await me.page.evaluate(() => navigator.clipboard.readText());
  check(copied.replace(/\s+/g, " ") === brief.replace(/\s+/g, " "), "…and “Copy as text” copies exactly it (nothing is sent anywhere)");
  const firstChart = me.page.locator("figure").first();
  await firstChart.getByRole("button", { name: "Show as table" }).click();
  check(await firstChart.getByRole("table").first().isVisible(), "every chart can be shown as a table");
  await me.page.getByRole("link", { name: "Visits", exact: true }).click();
  await me.page.waitForURL(/series=visits/, { timeout: 10000 });
  check(await heading(me.page, "Visits").isVisible(), "another line can be chosen");
  await shot(me.page, "activity-pulse");

  // --- 5. Funnels --------------------------------------------------------------------------------------------------------
  await open(me.page, "/god/activity/funnels");
  const funnels = await text(me.page);
  check(/The member journey/.test(funnels) && /Registered/.test(funnels) && /Week 12/.test(funnels), "Funnels shows the member journey from registering to week 12");
  check(/Time to finish/.test(funnels) || /How long the form takes/.test(funnels), "…the time to finish the form");
  check(/Weekly retention/.test(funnels) && /Side by side/.test(funnels), "…the retention grid and the side-by-side comparison");
  await me.page.getByRole("link", { name: /^Registered/ }).first().click();
  await me.page.waitForURL(/stage=1/, { timeout: 10000 });
  const people = await text(me.page);
  check(/Who stopped at/.test(people) && /Seed Person 1/.test(people) && /Seed Person 8/.test(people), "pressing a bar lists the people who stopped there (five or more, so named)");
  check(!/Tobi Youngster/.test(people) && !people.includes("youngster@example.org"), "…never a young member");
  check((await me.page.locator("a[href^='/god/people/']").count()) >= 8, "…each name opens that person");
  await open(me.page, "/god/activity/funnels?which=member&stage=3&mode=stopped");
  const sent = await text(me.page);
  check(/Who stopped at/.test(sent) && /Sent Person 1/.test(sent) && /Sent Person 5/.test(sent), "a bar of five or more at the next step lists its people");
  check(/including fewer than 5 young members, who are counted but never named/.test(sent), "…and says that a young member is counted but never named");
  check(!/Tobi Youngster/.test(sent) && !sent.includes("youngster@example.org"), "…and the young member is nowhere in the list");
  await open(me.page, "/god/activity/funnels?which=member&stage=4&mode=stopped");
  check(/Fewer than 5 people are in this group, so no names are shown\.|No one is in this group\./.test(await text(me.page)), "a bar with fewer than five people shows no names at all");
  await me.page.getByRole("link", { name: "Leader applicants" }).click();
  await me.page.waitForURL(/which=leader/, { timeout: 10000 });
  check(/The leader application/.test(await text(me.page)) && /Started/.test(await text(me.page)), "the leader journey has its own funnel");
  await open(me.page, "/god/activity/funnels?which=member&split=zone");
  check(/Split by zone/.test(await text(me.page)), "a funnel can be split by zone");
  await open(me.page, "/god/activity/funnels?from=2999-01-01&to=nonsense&stage=abc&mode=x&which=x");
  check(/The member journey/.test(await text(me.page)), "nonsense in the address is ignored, not trusted");
  await shot(me.page, "activity-funnels");

  // --- 6. the other tabs --------------------------------------------------------------------------------------------------
  for (const [path, title] of [
    ["/god/activity/stakeholders", /Members/],
    ["/god/activity/quality", /Cases to look at/],
    ["/god/activity/messages", /Sign-in codes/],
    ["/god/activity/audit", /Filter the audit trail|Who did what/],
    ["/god/activity/settings", /Exactly what is recorded/],
  ] as const) {
    await open(me.page, path);
    check(new URL(me.page.url()).pathname === path && (await heading(me.page, title).isVisible().catch(() => false)) || title.test(await text(me.page)), `${path} opens for the owner`);
  }
  await open(me.page, "/god/activity/stakeholders");
  const panels = await me.page.locator("[data-panel]").evaluateAll((els) => els.map((e) => e.getAttribute("data-panel")));
  check(["members", "applicants", "referees", "leaders", "team", "pastoral", "platform"].every((p) => panels.includes(p)), "Stakeholders has a panel for each group");
  await open(me.page, "/god/activity/messages");
  check(/WhatsApp and the breaker/.test(await text(me.page)) && (await me.page.locator("a[href='/admin/signin']").count()) >= 1, "Messages and sign-in shows the breaker and points to the sign-in screen");

  // --- 7. the audit trail and its download -------------------------------------------------------------------------------
  await open(me.page, "/god/activity/audit");
  const audit = await text(me.page);
  check(/Young member|Mary Ogedengbe|Bisi/.test(audit) || /Nothing matches/.test(audit), "the audit trail lists who did what");
  check(!audit.includes("Platform Owner") && !audit.includes(owner.email), "…without the owner’s name (their own looks read “You”)");
  check(!audit.includes("Tobi Youngster"), "…and never a young member’s name");
  await me.page.getByLabel("Who").selectOption({ label: "You" });
  await me.page.getByRole("button", { name: "Filter" }).click();
  await me.page.waitForURL(/group=you/, { timeout: 10000 });
  // The address changes before the filtered list arrives; wait for the list itself.
  await me.page.getByText(/looked at a tab of the activity dashboard/).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const yours = await text(me.page);
  if (!/looked at a tab of the activity dashboard/.test(yours)) console.log("the filtered audit page said:", yours.slice(0, 700));
  check(/looked at a tab of the activity dashboard/.test(yours), "filtering to “You” shows the owner’s own looks at the dashboard");
  const file = await me.page.request.get(`${BASE}/god/activity/audit/export?group=you`);
  const csv = await file.text();
  check(file.status() === 200 && (file.headers()["content-type"] ?? "").includes("text/csv") && /attachment; filename="united-tribes-audit-\d{4}-\d{2}-\d{2}\.csv"/.test(file.headers()["content-disposition"] ?? ""), "the audit trail downloads as a spreadsheet file");
  check(csv.startsWith("﻿When (Lagos time),Who,Group,What happened,Action,Area,Item,Reference") && /\bYou\b/.test(csv), "…with a header and plain words");
  check(csv.split("\r\n").slice(1).every((line) => !/^[=+\-@]/.test(line.split(",")[1] ?? "")), "…and no cell a spreadsheet could run as a formula");
  check(((await one("select count(*)::int as n from public.god_log where kind = 'exported' and action = 'audit'"))?.n as number) >= 1, "the download itself is in the owner’s record");

  // --- 8. settings: a flag, and pausing --------------------------------------------------------------------------------------
  await open(me.page, "/god/activity/settings");
  const flag = me.page.locator("[data-threshold='member_wait_days']");
  await flag.getByRole("spinbutton").fill("7");
  await flag.getByRole("button", { name: "Save" }).click();
  await flag.getByText("Saved.").waitFor({ timeout: 10000 });
  check(Number((await one("select value from public.activity_thresholds where key = 'member_wait_days'"))?.value) === 7, "a flag can be changed");
  check(((await one("select count(*)::int as n from public.god_log where kind = 'activity_setting' and action = 'member_wait_days'"))?.n as number) === 1, "…and the change is in the owner’s record");
  const before = Number((await one("select count(*) as n from public.activity_events where person_id = $1", [chidiId]))?.n);
  await me.page.getByRole("button", { name: "Pause recording" }).click();
  await me.page.getByText("Recording is off.", { exact: true }).waitFor({ timeout: 10000 });
  const quiet = await newPage(browser, "phone");
  await signIn(quiet.page, "member@example.org", "/home");
  await open(quiet.page, "/tribe");
  await quiet.page.waitForTimeout(1500);
  check(Number((await one("select count(*) as n from public.activity_events where person_id = $1", [chidiId]))?.n) === before, "while recording is paused nothing new is counted");
  await open(me.page, "/god/activity");
  check(/Recording is switched off/.test(await text(me.page)), "…and Pulse says so");
  await open(me.page, "/god/activity/settings");
  await me.page.getByRole("button", { name: "Resume recording" }).click();
  await me.page.getByText("Recording is on.", { exact: true }).waitFor({ timeout: 10000 });
  await open(quiet.page, "/community");
  await quiet.page.waitForTimeout(1500);
  check(Number((await one("select count(*) as n from public.activity_events where person_id = $1", [chidiId]))?.n) > before, "…and counting starts again when it is resumed");
  await quiet.ctx.close();
  const rules = await text(me.page);
  check(/fewer than 5 people is shown as/.test(rules) && /never named, listed or filtered on/.test(rules), "the rules that cannot be changed are written on the settings page");

  // --- 9. the owner is never recorded; their looks are in their own record ----------------------------------------------------
  check(((await one("select count(*)::int as n from public.activity_events where person_id = $1", [owner.id]))?.n as number) === 0, "nothing the owner did was recorded as activity");
  check(((await one("select count(*)::int as n from public.event_log where actor_id = $1", [owner.id]))?.n as number) === 0, "…and nothing under their name in the office’s log");
  await open(me.page, "/god/record");
  const record = await text(me.page);
  check(/You looked at the Pulse tab of the activity dashboard/.test(record) && /You looked at the Funnels tab/.test(record), "their record shows each tab they opened");
  check(/You exported the audit trail as a spreadsheet file/.test(record), "…the download");
  check(/You changed the flag for members waiting for a tribe, from 14 to 7/.test(record) && /You changed recording, from true to false/.test(record), "…and each setting they changed");

  // --- 10. a phone ----------------------------------------------------------------------------------------------------------
  const phone = await newPage(browser, "phone");
  await signIn(phone.page, owner.email, "/home");
  await phone.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await phone.page.getByLabel("Passphrase").fill(PHRASE);
  await phone.page.getByRole("button", { name: "Unlock" }).click();
  await phone.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  for (const path of [...TABS, "/god/activity/funnels?stage=1"]) {
    await open(phone.page, path);
    await noOverflow(phone.page, `${path} on a phone`);
  }
  await shot(phone.page, "activity-phone");
  await phone.ctx.close();

  // --- 11. locked again, it is closed ------------------------------------------------------------------------------------------
  // Unlocking on the phone moved the one open window to that sign-in; give the passphrase again here.
  await open(me.page, "/god");
  if (/\/god\/unlock/.test(me.page.url())) {
    await me.page.getByLabel("Passphrase").fill(PHRASE);
    await me.page.getByRole("button", { name: "Unlock" }).click();
    await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  }
  await me.page.getByRole("button", { name: "Lock now" }).click();
  await me.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await open(me.page, "/god/activity/funnels");
  check(/\/god\/unlock/.test(me.page.url()), "once the owner locks the console the dashboard closes with it");
  const locked = await me.page.request.get(`${BASE}/god/activity/audit/export`);
  check(locked.status() === 404 || locked.status() === 200 && !(locked.headers()["content-type"] ?? "").includes("csv"), "…and no file can be downloaded");

  await member.ctx.close();
  await office.ctx.close();
  await me.ctx.close();
  await q.end();
  await browser.close();
  finish("16-activity");
}
void main();

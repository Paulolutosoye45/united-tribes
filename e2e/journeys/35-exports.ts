/**
 * Exports and Reports, release one, end to end.
 *
 *  - Everything starts Off. Nobody finds a file, an entrance, or the switchboard; a link that was never made says so; a standing link that
 *    was never made gives "not found" to someone with no account.
 *  - Only the platform owner moves a switch, on the console's Exports page: an administrator does not find it. The owner opens the formats,
 *    adds a tester, tries a People pack in Rehearsal, cannot open it wider until the impact assessment is recorded and a reason is given,
 *    sees how many people it would reach before saving, and opens it.
 *  - A tribe leader, from the entrance on their tribe page, makes the Tribe sheet: a real Excel file with the members the leader may see,
 *    a number a member asked to withhold left out, a member under 18 counted and not listed, and a log line that holds facts only.
 *  - The link belongs to that account: another signed-in person and someone with no sign-in are refused, and "Delete now" ends it.
 *  - The attendance register as a printed page: names, the People notice, a footer for every page, and a real PDF from the browser.
 *  - "Stop all People files" and "Pause all exports" act at once, on links already made, and are undone again.
 *  - A director makes an Insight sheet that has no leader or member name in any cell; the Open Data Pack is a zip with a checksum list;
 *    a standing link is read by someone with no account, then revoked and no longer read.
 *
 * What is only arranged here (a season with a tribe, members and a young member) is arranged in the database the way the database tests
 * do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import fs from "node:fs";
import type { Page } from "playwright-core";
import { makeYoung } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { readXlsx } from "../../src/lib/leaders/referee/sheet/xlsx";
import { readZip } from "../../src/lib/leaders/referee/sheet/zip";
import { testDbFor } from "../dbkit";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const GOD = "/god/exports";
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
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

/** Every cell of every sheet as one string, for "this name is nowhere in the file". */
const everything = (buffer: Buffer) => readXlsx(buffer).flatMap((s) => s.rows.flatMap((r) => r.cells)).join("\n");

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off, one season with a tribe, three members and a young member --------------------------------------------
  await q.query("update public.export_switches set position = 'off', limited_roles = '{}', limited_communities = '{}', limited_tribes = '{}', rehearsed_at = null");
  await q.query("update public.export_settings set paused = false, people_stopped = false, unusual_per_hour = 50, formats = '{}', deliveries = '{}', doors = '{}', people_cleared_on = null");
  await q.query("delete from public.export_testers");
  await q.query("delete from public.export_log");
  await q.query("delete from public.export_feed_links");
  await q.query("delete from public.export_switch_log");

  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
  const A = await k.tribe(S, { name: "Journey Export Tribe" });
  await q.query("update public.people set full_name = 'Lanre Exportleader', preferred_name = 'Lanre' where id = $1", [A.leader.id]);
  const ada = await k.seat(A.tribe, S, "Ada");
  const bola = await k.seat(A.tribe, S, "Bola");
  const yaw = await k.seat(A.tribe, S, "Yaw", { profile: false });
  await makeYoung(adapter, k, yaw.id, S);
  await q.query("update public.member_profiles set whatsapp = '+2348031234567' where person_id = $1", [ada.id]);
  await q.query("update public.member_profiles set whatsapp = '+2348039999999' where person_id = $1", [bola.id]);
  await q.query("update public.tribe_members set contact_withheld = true where person_id = $1 and tribe_id = $2", [bola.id, A.tribe]);
  for (const p of [ada.id, bola.id]) await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'journey-v1')", [p]);

  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "exports.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);

  const browser = await launch();
  const DIRECTOR = "director.bola@example.org";
  const ADMIN = "admin.mary@example.org";

  // ---- Everything Off: nobody finds anything --------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByRole("heading", { name: /Your Tribe Card/ }).waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("export-entrance").count()) === 0, "with every pack Off, the leader's tribe page has no entrance to exports");
    await open(l.page, "/exports");
    check((await l.page.getByTestId("exports-closed").count()) === 1 && /Nothing to export yet/.test(await text(l.page)), "…and the Exports page says nothing is open to them yet");
    check((await l.page.getByTestId("export-studio").count()) === 0, "…and shows no file to choose");
    await l.page.goto(`${BASE}/exports/feeds`);
    await l.page.getByRole("heading", { name: /find that page/ }).waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("feeds-panel").count()) === 0 && !/Standing links/.test(await text(l.page)), "…and the standing links page does not exist for them");
    const none = await l.ctx.request.get(`${BASE}/exports/file/${"a".repeat(64)}`);
    check(none.status() === 404 && /could not find that file/.test(await none.text()), "a link that was never made says so, in words");
    const shape = await l.ctx.request.get(`${BASE}/exports/file/not-a-link`);
    check(shape.status() === 404, "…and so does one that is not even the right shape");
    await l.ctx.close();
  }
  {
    const anon = await fetch(`${BASE}/feeds/${"b".repeat(64)}/kpi_daily`, { redirect: "manual" });
    check(anon.status === 404 && (await anon.text()) === "Not found", "a standing link that was never made gives 'Not found' to someone with no account (and does not ask them to sign in)");
    const typo = await fetch(`${BASE}/feeds/${"b".repeat(64)}/not_a_table`, { redirect: "manual" });
    check(typo.status === 404, "…and so does a table that does not exist");
  }
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, ADMIN, GOD);
    await open(a.page, GOD);
    check(/We can.t find that page/.test(await text(a.page)), "to an administrator the Exports switchboard does not exist");
    await open(a.page, "/exports");
    check((await a.page.getByTestId("exports-closed").count()) === 1, "…and their Exports page is empty while everything is Off");
    await a.ctx.close();
  }

  // ---- God Mode: the switchboard -----------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await page.getByRole("link", { name: "Exports", exact: true }).first().click();
  await page.waitForURL(/\/god\/exports/, { timeout: 15000 });
  await page.getByTestId("export-board").waitFor({ timeout: 20000 });
  check(true, "God Mode finds Exports in its menu");
  await noOverflow(page, "the Exports switchboard on a desktop");
  check((await page.locator('[data-testid^="pack-"][data-testid$="-off"][aria-pressed="true"]').count()) === 14, "all fourteen packs are Off");
  check(/Not stopped/.test(await page.getByTestId("export-stops").innerText()), "neither stop is on");
  check((await page.getByTestId("pack-know_your_tribe-rehearsal").isDisabled()) && (await page.getByTestId("pack-my_data_pack-on").isDisabled()), "the two packs of a later release can only be Off");
  await shot(page, "35-board");

  // The doors: open Excel, CSV, printed pages, downloading, and the two ways in for reporting tools
  const ways = page.getByTestId("export-ways");
  for (const name of ["Excel files", "CSV files", "Printed pages", "Download from the Studio", "Open Data Pack", "Standing links"]) await ways.getByText(name, { exact: true }).click();
  await ways.getByLabel(/Why\? \(optional/).fill("Opening for the first trial");
  await page.getByTestId("ways-save").click();
  await eventually("the doors are open", async () => {
    const s = await one("select formats, deliveries, doors from public.export_settings");
    return (s?.formats as string[]).length === 3 && (s?.deliveries as string[]).length === 1 && (s?.doors as string[]).length === 2;
  });
  check(true, "the owner opens the formats, downloading and both ways in");
  check((await n("select count(*)::int n from public.export_switch_log where what like 'setting:%'")) === 3, "…and each of the three is written to the log of changes");

  // A tester
  const testers = page.getByTestId("export-testers");
  await testers.getByLabel("Find a person to add").fill("Exportleader");
  await testers.getByRole("button", { name: "Search" }).click();
  await testers.getByRole("button", { name: "Add as tester" }).first().click();
  await eventually("the leader is a tester", async () => (await n("select count(*)::int n from public.export_testers where person_id = $1", [A.leader.id])) === 1);
  await testers.getByTestId("tester").first().waitFor({ timeout: 15000 });
  check(/Lanre Exportleader/.test(await testers.innerText()), "a tester is added by name and listed");

  // Rehearsal first
  const tribeSheet = page.getByTestId("pack-tribe_sheet");
  await page.getByTestId("pack-tribe_sheet-rehearsal").click();
  await page.getByTestId("pack-tribe_sheet-save").click();
  await eventually("the Tribe sheet is in Rehearsal", async () => (await one("select position from public.export_switches where pack = 'tribe_sheet'"))?.position === "rehearsal");
  check(true, "the owner puts the Tribe sheet into Rehearsal");

  // The tester, in Rehearsal, makes a file that says so
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByTestId("export-entrance").waitFor({ timeout: 20000 });
    check(/Tribe sheet/.test(await l.page.getByTestId("export-entrance").innerText()) && /Rehearsal/.test(await l.page.getByTestId("export-entrance").innerText()), "the tester sees the entrance on their tribe page, marked Rehearsal");
    await l.ctx.close();
  }

  // Opening it wider is refused until the impact assessment is recorded
  await page.getByTestId("pack-tribe_sheet-on").click();
  const gate = page.getByTestId("pack-tribe_sheet-gate");
  await gate.waitFor({ timeout: 10000 });
  check(/impact assessment/.test(await gate.innerText()), "to open a People pack wider, the page first asks for the impact assessment");
  check(await page.getByTestId("pack-tribe_sheet-save").isDisabled(), "…and Save waits");
  const assessment = page.getByTestId("export-assessment");
  await assessment.getByLabel("Day it was signed").fill(YESTERDAY);
  await assessment.getByLabel("Who signed it?").fill("Pastor and data lead");
  await page.getByTestId("dpia-save").click();
  await eventually("the assessment is recorded", async () => String((await one("select people_cleared_on::text d from public.export_settings"))?.d ?? "") === YESTERDAY);
  check(true, "the owner records the day the assessment was signed");

  // The reason and the number it reaches, before it is saved
  await page.getByTestId("pack-tribe_sheet-on").click();
  await tribeSheet.getByLabel(/Why open it/).fill("short");
  check(await page.getByTestId("pack-tribe_sheet-save").isDisabled(), "a reason shorter than eight characters keeps Save waiting");
  await tribeSheet.getByLabel(/Why open it/).fill("Trial with the first leaders");
  check(await page.getByTestId("pack-tribe_sheet-save").isDisabled(), "…and so does not having looked at who it reaches");
  await tribeSheet.getByRole("button", { name: "Check who this reaches" }).click();
  await page.getByTestId("pack-tribe_sheet-reach").waitFor({ timeout: 15000 });
  const reach = await page.getByTestId("pack-tribe_sheet-reach").innerText();
  check(/Reaches \d+ (person|people)/.test(reach), `the page says how many people it would reach (${reach})`);
  await page.getByTestId("pack-tribe_sheet-save").click();
  await eventually("the Tribe sheet is On", async () => (await one("select position, reason from public.export_switches where pack = 'tribe_sheet'"))?.position === "on");
  check((await one("select reason from public.export_switches where pack = 'tribe_sheet'"))?.reason === "Trial with the first leaders", "the Tribe sheet is On, and the reason is kept");
  check((await n("select count(*)::int n from public.export_switch_log where what = 'pack:tribe_sheet'")) === 2, "…and both moves are in the log of changes");
  await shot(page, "35-board-on");

  // The attendance register (People, both formats) and an Insight pack: arranged as the owner would, one is enough to test through the screen
  await q.query("update public.export_switches set position = 'on', rehearsed_at = now() where pack in ('attendance_register', 'insight_feeds')");
  await page.getByTestId("pack-tribes_health-on").click();
  await page.getByTestId("pack-tribes_health").getByLabel(/Why open it/).fill("Directors read the same numbers");
  await page.getByTestId("pack-tribes_health").getByRole("button", { name: "Check who this reaches" }).click();
  await page.getByTestId("pack-tribes_health-reach").waitFor({ timeout: 15000 });
  await page.getByTestId("pack-tribes_health-save").click();
  await eventually("the Tribes health sheet is On", async () => (await one("select position from public.export_switches where pack = 'tribes_health'"))?.position === "on");
  check(true, "an Insight pack needs no Rehearsal or assessment: reason, number reached, save");

  // ---- A tribe leader makes the Tribe sheet ---------------------------------------------------------------------------------------------------
  let sheetToken = "";
  {
    const l = await newPage(browser, "desktop", { expectStatuses: [403, 404] });
    l.page.on("request", (r) => {
      const m = r.url().match(/\/exports\/file\/([a-f0-9]{64})/);
      if (m) sheetToken = m[1];
    });
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    const entrance = l.page.getByTestId("export-entrance");
    await entrance.waitFor({ timeout: 20000 });
    check(/Tribe sheet/.test(await entrance.innerText()) && /Attendance register/.test(await entrance.innerText()) && !/Rehearsal/.test(await entrance.innerText()), "a leader sees the entrance on their tribe page: the Tribe sheet is On, and the register");
    await entrance.getByRole("link", { name: /^Tribe sheet/ }).click();
    await l.page.waitForURL(/\/exports\?pack=tribe_sheet/, { timeout: 15000 });
    await l.page.getByTestId("export-studio").waitFor({ timeout: 20000 });
    check(/Named people/.test(await l.page.getByTestId("export-check").innerText()) && /church’s own use/.test(await text(l.page)), "the Studio says what a People file is");
    check((await l.page.getByTestId("export-target").inputValue()) === A.tribe, "…and has the tribe chosen already");
    check(await l.page.getByTestId("export-make").isDisabled(), "…and 'Make my file' waits for a reason and a promise");
    await l.page.getByTestId("export-purpose").selectOption("planning");
    await l.page.getByText("I will look after this file", { exact: true }).click();
    check(!(await l.page.getByTestId("export-make").isDisabled()), "…until both are given");
    await shot(l.page, "35-studio");
    const [download] = await Promise.all([l.page.waitForEvent("download", { timeout: 30000 }), l.page.getByTestId("export-make").click()]);
    const file = fs.readFileSync((await download.path())!);
    const name = download.suggestedFilename();
    check(/^united-tribes-tribe-sheet-journey-export-tribe-\d{4}-\d{2}-\d{2}\.xlsx$/.test(name), `the file is named for what it is and when, not for a person (${name})`);
    await l.page.getByTestId("export-result").waitFor({ timeout: 15000 });
    check(/Your file is saved/.test(await l.page.getByTestId("export-result").innerText()) && !/Rehearsal/.test(await l.page.getByTestId("export-result").innerText()), "the page says the file was saved");

    const sheets = readXlsx(file);
    check(sheets.map((s) => s.name).join(",") === "About,Members,Dictionary", `the workbook has About, Members and Dictionary (${sheets.map((s) => s.name).join(", ")})`);
    const all = everything(file);
    check(all.includes("Ada Test") && all.includes("Bola Test"), "the members the leader may see are in the file");
    check(all.includes("+2348031234567"), "…with the number of the member who agreed to be messaged on WhatsApp");
    check(!all.includes("8039999999"), "…and not the number of the member who asked for hers to be withheld");
    check(!all.includes("Yaw Test") && !all.includes("Yaw"), "a member under 18 is not listed");
    check(/under 18|young/i.test(sheets[0].rows.map((r) => r.cells.join(" ")).join(" ")), "…and the About tab says how many were left out, and why");
    check(/People file|church's own use|church’s own use/.test(sheets[0].rows.map((r) => r.cells.join(" ")).join(" ")), "…and says it names people and is for the church's own use");

    const log = await one("select role, pack, lane, format, purpose, status, row_count, filters, flagged from public.export_log order by at desc limit 1");
    check(log?.role === "leader" && log?.pack === "tribe_sheet" && log?.lane === "people" && log?.format === "xlsx" && log?.purpose === "planning" && log?.status === "delivered", "the log holds who, as which role, which pack, which format and why");
    check(Number(log?.row_count) === 2 && JSON.stringify(log?.filters) === JSON.stringify({ tribe: A.tribe }), "…and how many rows, and the tribe (which is all it says about the file's contents)");
    check(!/Ada|Bola|2348/.test(JSON.stringify(log)), "…and nothing that is in the file");
    await noOverflow(l.page, "the Studio on a desktop");

    // The link is for this account only
    check(/^[a-f0-9]{64}$/.test(sheetToken), "the page fetched the file from a private link");
    const again = await l.ctx.request.get(`${BASE}/exports/file/${sheetToken}`);
    check(again.status() === 200 && again.headers()["content-disposition"]?.startsWith("attachment;") && again.headers()["cache-control"] === "no-store" && again.headers()["x-content-type-options"] === "nosniff", "the link opens again in the same account, as a download that is never kept by a cache");
    {
      const other = await newPage(browser, "desktop", { expectStatuses: [403, 404] });
      await signIn(other.page, DIRECTOR, "/home");
      const r = await other.ctx.request.get(`${BASE}/exports/file/${sheetToken}`);
      check(r.status() === 404 && /could not find that file/.test(await r.text()), "another signed-in person cannot use the link");
      await other.ctx.close();
      const anon = await fetch(`${BASE}/exports/file/${sheetToken}`, { redirect: "manual" });
      check(anon.status !== 200 && !(await anon.text()).includes("PK"), "…and neither can someone who is not signed in");
    }

    // My files, then Delete now
    await open(l.page, "/exports/mine");
    await l.page.getByTestId("my-exports").waitFor({ timeout: 15000 });
    check((await l.page.getByTestId("my-export").count()) === 1 && /Tribe sheet/.test(await l.page.getByTestId("my-export").innerText()) && /2 rows/.test(await l.page.getByTestId("my-export").innerText()), "My files lists it, with how many rows");
    check(/Link still open|Made/.test(await l.page.getByTestId("my-export").innerText()) && (await l.page.getByRole("button", { name: "Delete now" }).count()) === 1, "…and offers Delete now while the link is open");
    await l.page.getByRole("button", { name: "Delete now" }).click();
    await eventually("the link is withdrawn", async () => (await n("select count(*)::int n from public.export_links where withdrawn_at is not null")) >= 1);
    const ended = await l.ctx.request.get(`${BASE}/exports/file/${sheetToken}`);
    check(ended.status() === 404 && /ended|could not find/.test(await ended.text()), "after Delete now the link no longer opens");
    await open(l.page, "/exports/mine");
    check(/Deleted by you/.test(await text(l.page)) && (await l.page.getByRole("button", { name: "Delete now" }).count()) === 0, "My files says it was deleted");
    await shot(l.page, "35-mine");
    await l.ctx.close();
  }

  // ---- The attendance register as a printed page ------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "phone", { expectStatuses: [403, 404] });
    await signIn(l.page, A.leader.email, "/exports");
    await open(l.page, `/exports?pack=attendance_register&tribe=${A.tribe}`);
    await l.page.getByTestId("export-studio").waitFor({ timeout: 20000 });
    await l.page.getByText("Printed page (save as PDF)", { exact: true }).click();
    await l.page.getByTestId("export-purpose").selectOption("pastoral_care");
    await l.page.getByText("I will look after this file", { exact: true }).click();
    await noOverflow(l.page, "the Studio on a phone");
    await l.page.getByTestId("export-make").click();
    const link = l.page.getByTestId("export-open-print");
    await link.waitFor({ timeout: 20000 });
    const href = (await link.getAttribute("href"))!;
    check(/^\/exports\/print\/[a-f0-9]{64}$/.test(href), "a printed page is a link to a page, not a download");
    await open(l.page, href);
    await l.page.getByTestId("print-sheet").waitFor({ timeout: 20000 });
    const body = await text(l.page);
    check(body.includes("Ada Test") && body.includes("Bola Test") && !body.includes("Yaw"), "the page lists the members the leader may see, and not the one under 18");
    check(/names people/.test(body) && /Print or save as PDF/.test(body), "…says it names people, and offers to print or save it");
    check(!body.includes("8031234567"), "…and carries no phone number (the register has none)");
    await noOverflow(l.page, "the print page on a phone");
    await l.page.emulateMedia({ media: "print" });
    check((await l.page.locator(".print-foot").evaluate((el) => getComputedStyle(el).display)) === "flex" && (await l.page.getByTestId("print-now").evaluate((el) => getComputedStyle(el.parentElement!).display)) === "none", "on paper the button is gone and every page has a footer naming the file");
    const pdf = await l.page.pdf({ format: "A4" });
    check(pdf.length > 4000 && pdf.subarray(0, 4).toString() === "%PDF", `the browser makes a real PDF from it (${pdf.length} bytes)`);
    await l.page.emulateMedia({ media: "screen" });
    check((await n("select count(*)::int n from public.export_log where pack = 'attendance_register' and status = 'delivered' and format = 'pdf'")) === 1, "the log says the page was made, in PDF");
    await l.ctx.close();
  }

  // ---- The two stops act at once -------------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop", { expectStatuses: [403, 404] });
    let held = "";
    l.page.on("request", (r) => {
      const m = r.url().match(/\/exports\/file\/([a-f0-9]{64})/);
      if (m) held = m[1];
    });
    await signIn(l.page, A.leader.email, "/exports");
    await open(l.page, `/exports?pack=tribe_sheet&tribe=${A.tribe}`);
    await l.page.getByTestId("export-studio").waitFor({ timeout: 20000 });
    await l.page.getByTestId("export-purpose").selectOption("reporting");
    await l.page.getByText("I will look after this file", { exact: true }).click();
    await Promise.all([l.page.waitForEvent("download", { timeout: 30000 }), l.page.getByTestId("export-make").click()]);
    check(/^[a-f0-9]{64}$/.test(held), "(a second link is made, to try the stops on)");

    await page.getByTestId("stop-people_stopped").click();
    await eventually("People files are stopped", async () => (await one("select people_stopped from public.export_settings"))?.people_stopped === true);
    const stopped = await l.ctx.request.get(`${BASE}/exports/file/${held}`);
    check(stopped.status() === 403, "'Stop all People files' ends a link that was already made, at once");
    await open(l.page, "/exports");
    check((await l.page.getByTestId("exports-closed").count()) === 1, "…and the leader's Studio is empty again");
    await page.getByTestId("stop-people_stopped").click();
    await eventually("People files are allowed again", async () => (await one("select people_stopped from public.export_settings"))?.people_stopped === false);
    const back = await l.ctx.request.get(`${BASE}/exports/file/${held}`);
    check(back.status() === 200, "switching the stop off brings the same link back (nothing was lost)");

    await page.getByTestId("stop-paused").click();
    await eventually("everything is paused", async () => (await one("select paused from public.export_settings"))?.paused === true);
    const paused = await l.ctx.request.get(`${BASE}/exports/file/${held}`);
    check(paused.status() === 403, "'Pause all exports' ends every link at once");
    const feedCheck = await newPage(browser, "desktop", { expectStatuses: [403, 404] });
    await signIn(feedCheck.page, DIRECTOR, "/exports");
    await open(feedCheck.page, "/exports");
    check((await feedCheck.page.getByTestId("exports-closed").count()) === 1, "…and a director's Studio is empty too");
    await feedCheck.ctx.close();
    await page.getByTestId("stop-paused").click();
    await eventually("exports are resumed", async () => (await one("select paused from public.export_settings"))?.paused === false);
    check((await n("select count(*)::int n from public.export_switch_log where what in ('setting:paused', 'setting:people_stopped')")) === 4, "every stop and every resume is in the log of changes");
    await l.ctx.close();
  }

  // ---- A director: an Insight sheet, the Open Data Pack, a standing link ---------------------------------------------------------------------------
  {
    const d = await newPage(browser, "desktop", { expectStatuses: [403, 404] });
    await signIn(d.page, DIRECTOR, "/dashboard");
    await open(d.page, "/dashboard");
    await d.page.getByTestId("export-entrance").waitFor({ timeout: 20000 });
    check(/Tribes health sheet/.test(await d.page.getByTestId("export-entrance").innerText()), "on the dashboard a director sees the entrance, for the Insight pack that is On");
    await d.page.getByTestId("export-entrance").getByRole("link", { name: /Tribes health sheet/ }).click();
    await d.page.getByTestId("export-studio").waitFor({ timeout: 20000 });
    check((await d.page.getByTestId("export-people-check").count()) === 0, "an Insight file asks for no reason and no promise");
    const [download] = await Promise.all([d.page.waitForEvent("download", { timeout: 30000 }), d.page.getByTestId("export-make").click()]);
    const file = fs.readFileSync((await download.path())!);
    const text1 = everything(file);
    check(readXlsx(file).some((s) => s.name === "About") && !/Lanre|Exportleader|Ada Test|Bola Test|Ngozi|Kemi|Okafor|@/.test(text1), "the Tribes health sheet holds no leader's or member's name, and no email address");
    check(/^united-tribes-tribes-health-\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()), `…and is named for what it is (${download.suggestedFilename()})`);

    // The Open Data Pack
    await open(d.page, "/exports?pack=insight_feeds");
    await d.page.getByTestId("export-studio").waitFor({ timeout: 20000 });
    const [zip] = await Promise.all([d.page.waitForEvent("download", { timeout: 60000 }), d.page.getByTestId("export-make").click()]);
    const files = readZip(fs.readFileSync((await zip.path())!));
    const names = [...files.keys()].sort();
    check(names.includes("manifest.json") && names.includes("dictionary.csv") && names.includes("README.txt") && ["members", "tribes", "weekly", "care_weekly", "messages_daily", "ai_fields", "kpi_daily"].every((t) => names.includes(`${t}.csv`)), `the Open Data Pack has the seven tables, a dictionary, a read-me and a manifest (${names.length} files)`);
    const members = files.get("members.csv")!.toString("utf8");
    check(members.charCodeAt(0) === 0xfeff && /^\uFEFF[a-z0-9_,]+\r\n/.test(members) && !/Ada Test|Bola Test|Yaw|@|\+234/.test(members), "…and members.csv has a header, a byte-order mark for Excel, and no name, email or number");
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { files?: { name: string; sha256: string }[] };
    check(Array.isArray(manifest.files) && manifest.files.length >= 8 && manifest.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)), "…and the manifest carries a SHA-256 for each file");

    // A standing link
    await open(d.page, "/exports/feeds");
    await d.page.getByTestId("feeds-panel").waitFor({ timeout: 20000 });
    await d.page.getByLabel("What is it for?").fill("Board dashboard");
    await d.page.getByRole("button", { name: "Make the link" }).click();
    const made = d.page.getByTestId("feed-made");
    await made.waitFor({ timeout: 20000 });
    const address = (await made.locator("code").innerText()).trim();
    check(/^http:\/\/127\.0\.0\.1:\d+\/feeds\/[a-f0-9]{64}\/kpi_daily$/.test(address), `the standing link is shown once, as an address (${address.replace(/[a-f0-9]{64}/, "…")})`);
    const got = await fetch(address, { redirect: "manual" });
    const body = await got.text();
    check(got.status === 200 && /text\/csv/.test(got.headers.get("content-type") ?? "") && got.headers.get("cache-control") === "no-store" && /noindex/.test(got.headers.get("x-robots-tag") ?? ""), "someone with no account can read it as a CSV that is not cached or indexed");
    check(/^\uFEFF?[a-z0-9_,]+\r\n/.test(body) && !/@|\+234/.test(body), "…and it has a header row and no contact detail");
    const other = await fetch(address.replace("kpi_daily", "members"), { redirect: "manual" });
    check(other.status === 404, "the same secret does not open a different table");
    check(/Board dashboard/.test(await d.page.getByTestId("feed-link").first().innerText()) && /Live/.test(await d.page.getByTestId("feed-link").first().innerText()), "the link is listed as Live, without its address");
    await d.page.getByTestId("feed-link").first().getByRole("button", { name: "Revoke" }).click();
    await eventually("the link is revoked", async () => (await n("select count(*)::int n from public.export_feed_links where revoked_at is not null")) === 1);
    const gone = await fetch(address, { redirect: "manual" });
    check(gone.status === 404, "after Revoke the address stops working at once");
    check((await n("select count(*)::int n from public.export_feed_links where token_hash like '%' || $1 || '%'", [address.split("/")[4]])) === 0, "…and the secret itself is stored nowhere (only its fingerprint)");
    await shot(d.page, "35-feeds");
    await d.ctx.close();
  }

  // ---- The owner's log and the record ------------------------------------------------------------------------------------------------------------
  await open(page, GOD);
  await page.getByTestId("export-log").waitFor({ timeout: 20000 });
  const logText = await page.getByTestId("export-log").innerText();
  check(/Tribe sheet/.test(logText) && /Tribes health sheet/.test(logText) && /Attendance register/.test(logText), "the owner's log lists the files that were made");
  check(!/Ada Test|Bola Test|Yaw/.test(logText), "…and never what was in them");
  check(/Lanre Exportleader/.test(logText), "…but does name who made each");
  const changes = await page.getByTestId("export-changes").innerText();
  check(/Tribe sheet pack: off →\s+(to\s+)?rehearsal/.test(changes) && /Tribe sheet pack: rehearsal →\s+(to\s+)?on/.test(changes), "every change to a switch is listed, in words");
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, GOD);
  await page.getByTestId("export-board").waitFor({ timeout: 20000 });
  await noOverflow(page, "the Exports switchboard on a phone");
  await shot(page, "35-board-phone");
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "/god/record");
  check(/moved an export switch/.test(await text(page)), "the owner's record says that a switch was moved");
  await shot(page, "35-end");

  // ---- The database itself refuses a switch from anyone but the owner (a direct call, not the screen) ---------------------------------------------------
  const directorId = (await one("select id from public.people where lower(email) = $1", [DIRECTOR]))!.id as string;
  let refused = false;
  try {
    await adapter.asUser(directorId, (run) => run("select public.export_pack_set('people_roles', 'on', '{}', 'trying it from the director')"));
  } catch {
    refused = true;
  }
  check(refused && (await one("select position from public.export_switches where pack = 'people_roles'"))?.position === "off", "a director who calls the database directly still cannot move a switch");

  await ctx.close();
  await browser.close();
  await q.end();
  finish("35-exports");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

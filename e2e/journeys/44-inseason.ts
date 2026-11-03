/**
 * Placing people while a season is running, placing one person, and the explanation a person gets on a leaders' page, end to end.
 *
 *  - A person who is not a leader opens a leaders' page and is told, in words, who they are signed in as, why the page is not theirs, and how to switch
 *    account. They are not sent home without a word.
 *  - The season has started (week 1). The owner's Placement page says so, says when joining closes, and lists what is different for a running season.
 *  - The owner opens a member's page, chooses a tribe and places them. The database writes a run of one; the member has the same "Your tribe" email and
 *    private link as for a church run.
 *  - The member opens the private link on a phone, sees the tribe, and asks for other tribes: inside the joining window that is allowed, and the seat
 *    is released. Nothing scrolls sideways.
 *
 * What is only arranged here (a season already running, a tribe, a member with a finished form) is arranged in the database the way the database tests
 * do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

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

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: the season began two days ago, Placement is On, one open tribe, one member with a finished form -------------------------------
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "inseason.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);
  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasMode = (await one("select mode from public.placement_settings"))!.mode as string;
  // The season rule picks the first season that has started and is still inside its joining window. Other journeys leave other seasons about, so for
  // this one they are set aside, and the season under test is the running one.
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);
  await q.query("update public.tribes set status = 'closed' where status = 'approved'");
  await q.query("update public.placement_settings set mode = 'on'");
  await k.tribe(S, { name: "Running Tribe", track: "builders" });
  const tobi = await k.person("Tobi Running");
  await k.profile(tobi.id, S, { times: ["weeknight-evening"] });
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')", [tobi.id]);
  await q.query("update public.people set full_name = 'Tobi Running', preferred_name = 'Tobi' where id = $1", [tobi.id]);
  const visitor = await k.person("Visiting Member");

  const browser = await launch();

  // ---- A person who is not a leader opens a leaders' page ---------------------------------------------------------------------------------
  {
    const v = await newPage(browser, "phone");
    await signIn(v.page, visitor.email, "/lead/tribe");
    await open(v.page, "/lead/tribe");
    await v.page.getByTestId("no-access").waitFor({ timeout: 20000 });
    const body = await text(v.page);
    has("the page says who they are signed in as", new RegExp(`signed in as .*${visitor.email.replace(/[.+]/g, "\\$&")}`), body);
    has("…why it is not theirs", /This page is for tribe leaders/, body);
    has("…and who to tell if they were appointed", /tell the church office/, body);
    check((await v.page.getByTestId("no-access-switch").count()) === 1, "…with a way to sign out and use another account");
    await noOverflow(v.page, "the explanation page on a phone");
    await shot(v.page, "44-no-access");
    await v.page.getByTestId("no-access-home").click();
    await v.page.waitForURL((u) => u.pathname === "/home", { timeout: 15000 });
    await v.ctx.close();
  }

  // ---- The owner: the Placement page in a running season ------------------------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await open(owner, "/god/placement");
  await owner.getByTestId("placement-home").waitFor({ timeout: 20000 });
  const home = await text(owner);
  has("the Placement page says the season is running, in week 1", /is running, in week 1 of/, home);
  has("…and when joining closes", /Joining is open until/, home);
  check((await owner.getByTestId("in-season").count()) === 1, "…and lists what is different for a running season");
  check((await owner.getByTestId("after-cutoff").count()) === 0, "…and offers no 'place after the cut-off' while joining is open");
  await shot(owner, "44-placement-running");

  // ---- The owner places one person ----------------------------------------------------------------------------------------------------------
  await open(owner, `/god/people/${tobi.id}`);
  await owner.getByTestId("place-one").waitFor({ timeout: 20000 });
  const tribeValue = await owner.locator('[data-testid="place-one-tribe"] option', { hasText: "Running Tribe" }).first().getAttribute("value");
  check(Boolean(tribeValue), "the tribe is on the list");
  await owner.getByTestId("place-one-tribe").selectOption(tribeValue ?? "");
  await owner.getByTestId("place-one-check").waitFor({ timeout: 20000 });
  has("the check shows the fit and the seats", /Fit with Running Tribe: \d+%/, await text(owner));
  check((await owner.getByTestId("place-one-blockers").count()) === 0, "…and nothing stops it");
  await shot(owner, "44-place-one");
  // Any warning the database raises is read and accepted, as a person would
  const warned = (await owner.getByTestId("place-one-warnings").count()) > 0;
  if (warned) {
    await owner.getByTestId("place-one-warnings").locator('input[type="checkbox"]').first().check();
    if ((await owner.getByTestId("place-one-agreed").count()) > 0) await owner.getByTestId("place-one-agreed").locator('input[type="checkbox"]').check();
    await owner.getByTestId("place-one-reason").fill("Spoke to them after church");
  }
  await owner.getByTestId("place-one-go").click();
  const finished = await owner.getByTestId("place-one-done").waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (!finished) console.log(`    saw: ${(await text(owner)).slice(0, 900).replace(/\n/g, " | ")}`);
  check(finished, "the person is placed");
  const seat = await one(
    `select tm.status, tm.placement_source, r.single, r.in_season
       from public.tribe_members tm join public.placement_runs r on r.id = tm.placed_by_run where tm.person_id = $1`,
    [tobi.id],
  );
  check(seat?.status === "active" && seat?.placement_source === "auto" && seat?.single === true && seat?.in_season === true, "Tobi has a seat, placed as a run of one in a running season");
  await open(owner, "/god/placement");
  has("the run list shows it as a single placement", /Single placement/, await text(owner));
  await octx.close();

  // ---- The member's private link ------------------------------------------------------------------------------------------------------------
  const link = (await one("select reply_token as t from public.messages where template = 'placement_your_tribe' and person_id = $1", [tobi.id]))?.t as string | undefined;
  check(typeof link === "string" && link.length === 64, "Tobi was sent the 'Your tribe' email with a private link");
  const m = await newPage(browser, "phone");
  await open(m.page, `/placed/${link}`);
  await m.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  const placed = await text(m.page);
  has("the page names the tribe", /Running Tribe/, placed);
  check(/Show me other tribes/.test(placed), "…and, inside the joining window, still offers 'Show me other tribes'");
  await noOverflow(m.page, "the private link page on a phone");
  await shot(m.page, "44-placed-link");
  await m.page.getByRole("button", { name: "Show me other tribes" }).first().click();
  await eventually("Tobi's seat is released", async () => (await one("select status from public.tribe_members where person_id = $1", [tobi.id]))?.status === "released");
  await m.ctx.close();

  // Put the shared database back the way this journey found it
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.seasons set status = $2::public.season_status where id = $1", [S, wasStatus]);
  for (const o of setAside) await q.query("update public.seasons set status = $2::public.season_status where id = $1", [o.id, o.status]);
  await q.query("update public.tribes set status = 'approved' where id = any($1::uuid[])", [wasApproved]);
  await q.query("update public.placement_settings set mode = $1", [wasMode]);

  await browser.close();
  await q.end();
  finish("44-inseason");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

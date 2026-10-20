/**
 * The Leader pipeline page, end to end.
 *
 * The director opens the page and finds the twelve switches where the process started, every one of them connected (Find your tribe
 * was the last, connected in the compatibility-test phase) and Find your tribe Off. They press the open door preset (a few questions, no referees, no interview), move the Academy to Optional with a
 * reason, then switch the Academy and the declaration both Off, which asks them to confirm they understand before it can be saved.
 * Every change is in the log with their name. The pastor can read the page but not change it, a member cannot open it, and the
 * Admin page's Academy figures say the Academy is off rather than showing zeros. The page fits a phone.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const PAGE = "/admin/leader-pipeline";
const card = (page: Page, id: string) => page.locator(`[data-testid="switch-${id}"]`);
const pick = (page: Page, id: string, value: string) => card(page, id).locator(`label.choice:has(input[value="${value}"])`);
const now = (page: Page, id: string) => page.locator(`[data-testid="now-${id}"]`);

/** Waits for something to become true, so a slow screen does not fail a good check. */
async function eventually(label: string, read: () => Promise<boolean>, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];

  async function person(email: string, name: string, role?: string) {
    const id = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [id, name, name.split(" ")[0]]);
    if (role) await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [id, role]);
    return id;
  }
  const settings = async () => (await one("select * from public.leader_pipeline_settings"))!;
  /** Back to today's process, so the journeys after this one start where they always do. */
  const reset = () =>
    q.query(`update public.leader_pipeline_settings set elig_member6='required', elig_foundation='required', elig_serving='required', elig_age21='required',
      elig_time='required', elig_safeguarding='required', elig_confidentiality='required', references_mode='required', interview_mode='required',
      academy_mode='required', declaration_mode='required', tribe_fit='off', preset='full'`);

  await reset();
  const director = await person("director.switch@example.org", "Dayo Director", "director");
  await person("pastor.switch@example.org", "Pastor Seyi", "pastor");
  await person("member.switch@example.org", "Mary Member");
  void director;

  const browser = await launch();

  // ---- The director, at a desk ------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "director.switch@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("pipeline-switchboard").waitFor({ timeout: 20000 });
    await shot(page, "19-page");

    check((await page.getByRole("heading", { level: 1 }).first().innerText()).length > 3, "the page has a heading");
    check((await page.locator('[data-testid^="switch-"]').count()) === 12, "there are twelve switches");
    check((await page.locator('[data-testid^="not-connected-"]').count()) === 0, "no switch says it is not connected yet");
    check((await now(page, "tribe_fit").innerText()) === "Off", "Find your tribe starts Off");
    check((await page.getByTestId("preset-now").innerText()) === "Full process", "the process starts as the full process");
    check((await now(page, "academy_mode").innerText()) === "Required" && (await now(page, "declaration_mode").innerText()) === "Required", "the Academy and the declaration start Required");
    check((await card(page, "tribe_fit").locator('input[type="radio"]').count()) === 2, "Find your tribe offers Off and On");
    check((await card(page, "academy_mode").locator('input[type="radio"]').count()) === 3, "the Academy offers Required, Optional and Off");
    check((await card(page, "declaration_mode").locator('input[type="radio"]').count()) === 2, "the declaration offers Required and Off");
    check((await page.getByTestId("pipeline-log").innerText()).includes("Nothing has been changed yet"), "the log starts empty");

    // The open door preset
    await page.getByRole("button", { name: "Use open door" }).click();
    await page.getByRole("button", { name: "Yes, set it" }).click();
    await eventually("the preset is in use", async () => (await page.getByTestId("preset-now").innerText()) === "Open door");
    let s = await settings();
    check(s.references_mode === "off" && s.interview_mode === "off" && s.elig_member6 === "off" && s.elig_foundation === "off" && s.elig_serving === "off", "the open door asks fewer questions and no referees or interview");
    check(s.elig_age21 === "required" && s.elig_safeguarding === "required" && s.elig_confidentiality === "required" && s.elig_time === "required", "…and keeps age, time, safeguarding and confidentiality");
    check(s.academy_mode === "required" && s.declaration_mode === "required", "…and keeps the Academy and the declaration Required");
    check((await text(page)).includes("Find your tribe stays off for now"), "it says Find your tribe stays off until it is ready");
    check((await text(page)).includes("set to Required"), "the preset says it sets the Academy and the declaration to Required");

    // The Academy, Optional, with a reason
    await pick(page, "academy_mode", "optional").click();
    check(await page.getByTestId("change-academy_mode").isVisible(), "the pending change is listed before it is saved");
    check((await settings()).academy_mode === "required", "nothing changes until it is saved");
    await page.getByTestId("pipeline-reason").fill("The pastorate agreed this at the October meeting");
    await page.getByTestId("pipeline-review").click();
    check(await page.getByTestId("training-change-note").isVisible(), "saving asks you to read what a training change means for people already in training");
    check((await page.getByTestId("training-change-note").innerText()).includes("Nobody’s certificate is ever withdrawn"), "…and says no certificate is ever withdrawn");
    await page.getByRole("button", { name: "Yes, save" }).click();
    await eventually("the Academy shows Optional", async () => (await now(page, "academy_mode").innerText()) === "Optional");
    s = await settings();
    check(s.academy_mode === "optional" && s.preset === "empty", "the Academy is Optional in the database, and the preset is now ‘Set by hand’");
    check((await page.getByTestId("preset-now").innerText()) === "Set by hand", "the page says ‘Set by hand’");
    let log = await all("select setting, old_value, new_value, reason, shown_as from public.leader_pipeline_log where setting = 'academy_mode' order by at");
    check(log.length === 1 && log[0].old_value === "required" && log[0].new_value === "optional" && log[0].reason === "The pastorate agreed this at the October meeting", "the log holds the change with its reason");
    check((await page.getByTestId("pipeline-log").innerText()).includes("Dayo"), "the log page shows who made it");
    await shot(page, "19-optional");

    // Both off: a warning, and a box to tick first
    await pick(page, "academy_mode", "off").click();
    await pick(page, "declaration_mode", "off").click();
    check(await page.getByTestId("no-training-warning").isVisible(), "turning both off shows a warning");
    check(await page.getByTestId("pipeline-review").isDisabled(), "…and saving waits until it is understood");
    await page.getByTestId("no-training-confirm").check();
    check(await page.getByTestId("pipeline-review").isEnabled(), "…which the box allows");
    await shot(page, "19-warning");
    await page.getByTestId("pipeline-review").click();
    await page.getByRole("button", { name: "Yes, save" }).click();
    await eventually("both show Off", async () => (await now(page, "academy_mode").innerText()) === "Off" && (await now(page, "declaration_mode").innerText()) === "Off");
    s = await settings();
    check(s.academy_mode === "off" && s.declaration_mode === "off", "both are Off in the database");
    log = await all("select setting from public.leader_pipeline_log where setting in ('academy_mode','declaration_mode')");
    check(log.length === 3, "the log has all three training changes");

    // The Admin page says so rather than showing zeros
    await open(page, "/admin");
    const hub = await text(page);
    check(hub.includes("Leader Academy"), "the Admin page still has its Academy figures");
    check(hub.includes("certification needs only an approved Tribe Card"), "…and says the Academy is off and what certification needs");
    await shot(page, "19-admin-off");

    // A preset never leaves training off by accident: pressing one puts both back to Required, and the figures return
    await open(page, PAGE);
    await page.getByRole("button", { name: "Use open door" }).click();
    await page.getByRole("button", { name: "Yes, set it" }).click();
    await eventually("both show Required again", async () => (await now(page, "academy_mode").innerText()) === "Required" && (await now(page, "declaration_mode").innerText()) === "Required");
    s = await settings();
    check(s.academy_mode === "required" && s.declaration_mode === "required" && s.preset === "open_door", "pressing a preset sets the Academy and the declaration back to Required");
    log = await all("select setting, new_value, preset from public.leader_pipeline_log where setting in ('academy_mode','declaration_mode') order by id desc limit 2");
    check(log.length === 2 && log.every((r) => r.new_value === "required" && r.preset === "open_door"), "…and the log says the preset did it");
    await open(page, "/admin");
    check(!(await text(page)).includes("certification needs only an approved Tribe Card"), "the Admin page goes back to the training figures");
    await ctx.close();
  }

  // ---- The pastor reads, and cannot change ------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "pastor.switch@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("pipeline-switchboard").waitFor({ timeout: 20000 });
    check(await page.getByTestId("pipeline-readonly").isVisible(), "the pastor is told the page is theirs to read");
    check((await page.locator('input[type="radio"]').count()) === 0, "…with nothing to move");
    check((await page.getByRole("button", { name: /Use open door|Use full process/ }).count()) === 0, "…and no preset to press");
    check((await page.getByTestId("pipeline-log").innerText()).includes("What has been changed"), "…but the log is theirs to read");
    await ctx.close();
  }

  // ---- A member cannot open it ------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "member.switch@example.org", "/home");
    await open(page, PAGE);
    check((await page.getByTestId("pipeline-switchboard").count()) === 0, "a member does not see the page");
    await ctx.close();
  }

  // ---- On a phone -------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, "director.switch@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("pipeline-switchboard").waitFor({ timeout: 20000 });
    await noOverflow(page, "the pipeline page on a phone");
    await pick(page, "academy_mode", "off").click();
    await pick(page, "declaration_mode", "off").click();
    await page.getByTestId("no-training-warning").waitFor();
    await noOverflow(page, "the warning on a phone");
    await shot(page, "19-phone");
    await ctx.close();
  }

  await reset();
  await browser.close();
  await q.end();
  finish("19-pipeline");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

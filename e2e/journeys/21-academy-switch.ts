/**
 * The Academy and the declaration switches, end to end: what a leader sees, and what certification then needs.
 *
 * 1. Academy Off, declaration Required: a newly approved leader's Lead page offers only the declaration; the Academy page says it is
 *    switched off and lists what certification needs without any module; a module link is closed; signing the declaration leaves
 *    the leader one short (the Tribe Card), while an assistant leader who signs is certified on the spot.
 * 2. Both Off: an assistant leader is certified the moment they are approved; a leader is shown no training anywhere and is told
 *    the Tribe Card is next; the declaration page says it is not being asked for.
 * 3. Academy Optional, declaration Off: the Academy stays open, says it is optional, and is not what the leader is sent to next.
 * 4. Moving the Academy back to Required asks for the modules again of anyone not yet certified, and takes nothing from the certified.
 * 5. The panel's Academy page says when the Academy is off.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { OPEN_DOOR, pipelineKit, setPositions } from "../../tests/db/pipeline-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const kit = pipelineKit(adapter);
  // Journey 12 leaves the first check on written answers switched On; these journeys are about the switchboard, so they start with it Off, as it ships
  await q.query("update public.leader_ai_settings set mode = 'off'");
  const staff = await kit.panel();
  const certified = async (id: string) => Boolean((await one("select 1 as x from public.leader_certifications where person_id = $1", [id]))?.x);
  const switches = (academy: string, declaration: string) => q.query("update public.leader_pipeline_settings set academy_mode = $1, declaration_mode = $2", [academy, declaration]);
  /** A whole application run to approval under the switches given (the database tests' own walk). */
  const approved = async (academy: "required" | "optional" | "off", declaration: "required" | "off", decision: "leader" | "assistant_leader" = "leader") => {
    const r = await kit.walk({ ...OPEN_DOOR, academy, declaration }, { staff, decision });
    return r.user;
  };

  const browser = await launch();

  // ---- 1. Academy off, declaration required ------------------------------------------------------------------------
  const lola = await approved("off", "required");
  const ade = await approved("off", "required", "assistant_leader");
  check(!(await certified(lola.id)) && !(await certified(ade.id)), "nobody is certified before they have signed");
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, lola.email, "/lead");
    await page.getByText("Welcome. A short safeguarding declaration is next.").waitFor({ timeout: 20000 });
    check(true, "the Lead page says the declaration is next");
    check(await page.getByRole("link", { name: "Sign the safeguarding declaration" }).isVisible(), "…and offers the declaration, not the Academy");
    check(!(await page.getByRole("link", { name: "Open my training" }).count()), "…with no ‘Open my training’");
    await noOverflow(page, "the Lead page on a phone");
    await shot(page, "21-lead-declaration-only");

    await open(page, "/lead/academy");
    await page.getByTestId("academy-off").waitFor({ timeout: 20000 });
    let body = await text(page);
    check(body.includes("The Academy is switched off"), "the Academy page says it is switched off");
    check(body.includes("Becoming certified") && /0 of 2 done/.test(body), "…and counts only the declaration and the Tribe Card (0 of 2)");
    check((await page.getByTestId("cert-modules").count()) === 0 && (await page.getByTestId("cert-practice").count()) === 0, "…with no module or practice row");
    check((await page.getByTestId("cert-declaration").count()) === 1 && (await page.getByTestId("cert-card").count()) === 1, "…and the declaration and the Tribe Card as the two things asked");
    await noOverflow(page, "the Academy page, Academy off, on a phone");
    await shot(page, "21-academy-off");

    await open(page, "/lead/academy/care-and-safeguarding");
    check((await text(page)).includes("The modules are closed for now"), "a module link is closed to the leader");

    await open(page, "/lead/academy/declaration");
    await page.getByRole("button", { name: "Sign the declaration" }).waitFor({ timeout: 20000 });
    check(true, "the declaration opens at once, without the care and safeguarding module first");
    await page.locator('label:has(input[type="checkbox"])').click();
    await page.getByLabel("Type your first and last name to sign").fill("Lola Okoye");
    await page.getByRole("button", { name: "Sign the declaration" }).click();
    await page.getByRole("heading", { name: "Signed. Thank you." }).waitFor({ timeout: 20000 });
    check(true, "she signs");
    check(!(await certified(lola.id)), "a leader who has signed is not yet certified: the Tribe Card is still to come");
    await open(page, "/lead/academy");
    body = await text(page);
    check(/1 of 2 done/.test(body), "the Academy page now says 1 of 2");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, ade.email, "/lead/academy/declaration");
    await page.getByRole("button", { name: "Sign the declaration" }).waitFor({ timeout: 20000 });
    await page.locator('label:has(input[type="checkbox"])').click();
    await page.getByLabel("Type your first and last name to sign").fill("Ade Bello");
    await page.getByRole("button", { name: "Sign the declaration" }).click();
    await page.getByRole("heading", { name: "Signed. Thank you." }).waitFor({ timeout: 20000 });
    const done = await (async () => {
      for (let i = 0; i < 40; i++) {
        if (await certified(ade.id)) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    })();
    check(done, "an assistant leader who signs is certified on the spot");
    await open(page, "/lead/academy");
    await page.getByRole("heading", { name: "You are certified." }).waitFor({ timeout: 20000 });
    check(true, "…and the page says so");
    await ctx.close();
  }

  // ---- 2. Both off ------------------------------------------------------------------------------------------------
  const bola = await approved("off", "off");
  const chidi = await approved("off", "off", "assistant_leader");
  check(await certified(chidi.id), "an assistant leader is certified the moment they are approved when both are off");
  check(!(await certified(bola.id)), "a leader is not: the Tribe Card is still needed");
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, bola.email, "/lead");
    await page.getByText("Welcome. Your Tribe Card is next.").waitFor({ timeout: 20000 });
    check(true, "the Lead page says the Tribe Card is next");
    check(!(await page.getByRole("link", { name: /Open my training|declaration/ }).count()), "…and offers no training and no declaration");
    await shot(page, "21-lead-nothing");
    await open(page, "/lead/academy");
    await page.getByTestId("academy-off").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(body.includes("There are no modules, workshops or declaration to do right now"), "the Academy page says there is nothing to do");
    check((await page.getByTestId("cert-checklist").count()) === 0, "…and shows no checklist");
    await open(page, "/lead/academy/declaration");
    await page.getByTestId("declaration-off").waitFor({ timeout: 20000 });
    check(true, "the declaration page says it is not being asked for");
    await noOverflow(page, "the declaration page, switched off, on a phone");
    await shot(page, "21-declaration-off");
    await ctx.close();
  }

  // ---- 3. Academy optional, declaration off ------------------------------------------------------------------------
  await switches("optional", "off");
  const dayo = await approved("optional", "off");
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, dayo.email, "/lead/academy");
    await page.getByTestId("academy-optional-note").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(body.includes("Certification does not wait for them"), "the Academy says certification does not wait for it");
    check((await page.getByTestId("cert-modules").getAttribute("data-needed")) === "no", "the modules row is marked not needed");
    check((await page.getByTestId("cert-practice").getAttribute("data-needed")) === "no", "…and so is the practice row");
    check((await page.getByTestId("cert-card").getAttribute("data-needed")) === "yes", "…while the Tribe Card is");
    check((await page.getByRole("link", { name: "Open my Tribe Card" }).count()) >= 1, "the leader is sent to the Tribe Card, not to a module");
    check(/0 of 1 done/.test(body), "…and the count is 0 of 1");
    await noOverflow(page, "the Academy page, Academy optional, on a phone");
    await shot(page, "21-academy-optional");
    await open(page, "/lead/academy/care-and-safeguarding");
    check(!(await text(page)).includes("The modules are closed for now") && (await page.locator("h1").count()) > 0, "a module is still open to read");
    await ctx.close();
  }

  // ---- 4. Back to Required: asks again of the uncertified, takes nothing from the certified --------------------------
  await switches("required", "required");
  check(await certified(ade.id) && await certified(chidi.id), "moving training back on takes no certificate away");
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, bola.email, "/lead/academy");
    await page.getByTestId("cert-modules").waitFor({ timeout: 20000 });
    check((await page.getByTestId("cert-modules").getAttribute("data-needed")) === "yes" && (await page.getByTestId("cert-practice").getAttribute("data-needed")) === "yes", "the modules and the practice session are asked for again");
    check((await page.getByTestId("cert-declaration").getAttribute("data-needed")) === "yes", "…and the declaration");
    check(/0 of 4 done/.test(await text(page)), "…so the count is 0 of 4 for a leader");
    await shot(page, "21-academy-required-again");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, chidi.email, "/lead/academy");
    await page.getByRole("heading", { name: "You are certified." }).waitFor({ timeout: 20000 });
    check(true, "an assistant leader certified while training was off is still certified");
    await ctx.close();
  }

  // ---- 5. The panel's page says so ----------------------------------------------------------------------------------
  await switches("off", "required");
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, staff.pastor.email, "/review/academy");
    await page.getByTestId("academy-off").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(body.includes("The Academy is switched off"), "the review page says the Academy is switched off");
    check(body.includes("not needed for certification") || body.includes("Off"), "…and its figure reads Off rather than zero");
    await shot(page, "21-review-academy-off");
    await ctx.close();
  }

  await setPositions(adapter, {});
  await browser.close();
  await q.end();
  finish("21-academy-switch");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

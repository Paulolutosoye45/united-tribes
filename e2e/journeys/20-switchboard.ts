/**
 * An application under the open door, end to end: the form, the tracker, the review screen and the decision follow the switches.
 *
 * With the open door pressed (age, time, safeguarding and confidentiality only; no referees; no interview):
 *  - Ife starts an application and the first screen lists only the steps that apply, with four questions to answer.
 *  - Tobi, whose draft has everything in, reads the review screen (no referees mentioned), sends it, and his tracker on a
 *    phone shows Application, Panel review and Decision only.
 *  - Two reviewers score him; the pastor opens the application, sees a readiness score resting on the parts that exist,
 *    and approves him as a leader. He is told, and his Lead page says training is next.
 * Then the Academy and the declaration are switched off and a new person sees a first screen that promises no training.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { OPEN_DOOR, answers, pipelineKit, setPositions } from "../../tests/db/pipeline-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

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
  const adapter = testDbFor(q);
  const kit = pipelineKit(adapter);
  // Journey 12 leaves the first check on written answers switched On; these journeys are about the switchboard, so they start with it Off, as it ships
  await q.query("update public.leader_ai_settings set mode = 'off'");

  await setPositions(adapter, OPEN_DOOR);
  const staff = await kit.panel();
  const ife = await kit.person(undefined, "Ife");
  const tobi = await kit.person(undefined, "Tobi");
  const FOUR = { age21: true, time: true, safeguarding: true, confidentiality: true };
  const appId = await kit.startDraft(tobi.id, answers(FOUR), "review");

  const browser = await launch();

  // ---- Ife starts: the first screen and the questions follow the switches ---------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, ife.email, "/lead/apply");
    await heading(page, /Lead a tribe/).waitFor({ timeout: 20000 });
    const welcome = await text(page);
    check(welcome.includes("Panel review") && welcome.includes("A pastor decides"), "the first screen lists the panel and the pastor");
    check(!/Two referees|Panel and interview|Referees, if you like/.test(welcome), "…and no referees and no interview");
    check(welcome.includes("Training follows."), "…and says training follows, because the Academy is required");
    check(welcome.includes("plus about 10 hours of training before your tribe begins"), "…and what it asks of her, as it always has");
    await shot(page, "20-welcome");
    await noOverflow(page, "the first screen on a phone");
    await page.locator('label:has(input[name="consent-leader"])').click();
    await page.getByRole("button", { name: "I agree, start my application" }).click();
    await heading(page, /four quick questions/).waitFor({ timeout: 20000 });
    check(true, "the questions screen says there are four");
    const asked = await page.locator('[data-testid^="elig-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    check(JSON.stringify(asked) === JSON.stringify(["elig-age21", "elig-time", "elig-safeguarding", "elig-confidentiality"]), "…and they are age, time, safeguarding and confidentiality");
    await shot(page, "20-questions");
    await ctx.close();
  }

  // ---- Tobi: review, send, tracker ------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, tobi.email, "/lead/apply");
    await page.getByRole("button", { name: "Send my application" }).waitFor({ timeout: 20000 });
    const review = await text(page);
    check(!/referee/i.test(review), "the review screen mentions no referees");
    check(/pastor decides/i.test(review) && !/20-minute interview/.test(review), "…and says a pastor decides, with no interview");
    await shot(page, "20-review");
    await noOverflow(page, "the review screen on a phone");
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, /^Sent, Tobi/).waitFor({ timeout: 30000 });
    check(true, "the application is sent");
    const sent = await text(page);
    check(!/referee|interview/i.test(sent), "the screen after sending mentions no referees or interview");
    const app = (await one("select status from public.leader_applications where id = $1", [appId]))!;
    check(app.status === "submitted", "it is in the database as sent");
    const modes = await kit.modes(appId);
    check(modes.references === "off" && modes.interview === "off", "it was sent with no references and no interview");

    await open(page, "/lead");
    await page.locator('section[aria-labelledby="stages-heading"]').waitFor({ timeout: 20000 });
    const stages = (await page.locator('section[aria-labelledby="stages-heading"] li p.font-semibold').allInnerTexts()).map((t) => t.replace(/\s*\((done|in progress|not started)\)\s*$/, "").trim());
    check(JSON.stringify(stages) === JSON.stringify(["Application", "Panel review", "Decision"]), `the tracker shows Application, Panel review and Decision only (saw ${stages.join(", ")})`);
    await shot(page, "20-tracker");
    await noOverflow(page, "the tracker on a phone");
    await ctx.close();
  }

  // ---- The panel and the pastor ---------------------------------------------------------------------------------------
  await kit.review(staff.coach.id, appId, "calling", 5);
  await kit.review(staff.scorer.id, appId, "calling", 5);
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, staff.pastor.email, `/review/${appId}`);
    await heading(page, "Leader Readiness Score").waitFor({ timeout: 20000 });
    const body = await text(page);
    check(/Calling and goal fit/.test(body) && /Situations/.test(body), "the readiness score shows the calling and the situations");
    check(!/\bReferences\b/.test(await page.locator('section[aria-labelledby="readiness-heading"]').innerText()), "…and no bar for references that were never asked");
    check(!/\bInterview\b/.test(await page.locator('section[aria-labelledby="readiness-heading"]').innerText()), "…or for an interview that was never held");
    const score = Number((await page.locator('section[aria-labelledby="readiness-heading"] .t-figure').innerText()).trim());
    check(score >= 75, `the score is a leader's score (${score})`);
    await shot(page, "20-review-panel");
    await page.locator('label.choice:has(input[value="leader"])').click();
    await page.getByRole("button", { name: "Record decision" }).click();
    await page.getByRole("button", { name: "Yes, record it" }).click();
    await eventually("the decision is recorded", async () => (await one("select status from public.leader_applications where id = $1", [appId]))!.status === "approved_leader");
    check(await kit.hasRole(tobi.id, "leader"), "Tobi has the leader role");
    await ctx.close();
  }

  // ---- Tobi hears --------------------------------------------------------------------------------------------------------
  {
    const msg = await one("select template, params from public.messages where person_id = $1 and template like 'application_approved%'", [tobi.id]);
    check(msg?.template === "application_approved", "the approval message is the one it has always been");
    const params = msg?.params as Row;
    check(params.declaration === undefined && params.academy === undefined, "…with nothing added for the Academy and the declaration");
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, tobi.email, "/lead");
    await page.getByText("Welcome. Leader training is next.").waitFor({ timeout: 20000 });
    check(true, "his Lead page says training is next");
    await noOverflow(page, "the approved Lead page on a phone");
    await ctx.close();
  }

  // ---- With the Academy and the declaration off, the first screen promises no training -----------------------------
  {
    await q.query("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
    const newcomer = await kit.person(undefined, "Kemi");
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, newcomer.email, "/lead/apply");
    await heading(page, /Lead a tribe/).waitFor({ timeout: 20000 });
    const welcome = await text(page);
    check(welcome.includes("What it asks of you: 75 minutes a week for 12 weeks."), "the first screen asks only for the weekly time");
    check(!/10 hours|Training follows|Academy|declaration/.test(welcome), "…and promises no training");
    await shot(page, "20-welcome-no-training");
    await noOverflow(page, "the first screen with no training, on a phone");
    await ctx.close();
  }

  await setPositions(adapter, {});
  await browser.close();
  await q.end();
  finish("20-switchboard");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

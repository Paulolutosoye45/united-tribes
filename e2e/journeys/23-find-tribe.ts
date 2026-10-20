/**
 * "Find your tribe", end to end, with the leaders' first check on the written answers still in force.
 *
 *  - The director cannot switch it On while no model is approved. The pastor approves the model on the Admin page; then she can.
 *  - Zainab applies on a phone with the first check On. Keyboard mashing in a written box still gets the kind note, the good
 *    answers pass, and only then does the new screen appear after "I lead best by". She sees her three best tribes with a match
 *    word and reasons, nothing hidden, chooses one, names two backups (a third is refused), goes back and forward, and sends.
 *  - Kayode's draft was started before the switch was On. Pressing Send takes him to the screen instead of sending; he chooses and
 *    sends. A pastor and a coach read the "Tribe fit" panel (the coach only after scoring), and the pastor still decides.
 *  - The pastor proposes a second version of the model, approves it, and the leaders we already have are looked at quietly: nobody
 *    is told, and a leader's own page lists the tribes they could lead next season.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { answers, calling, OPEN_DOOR, pipelineKit, SCENARIOS_POOR, setPositions } from "../../tests/db/pipeline-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const announce = (page: Page) => page.locator("main p.sr-only[aria-live=polite]");
const ADMIN = "/admin/leader-pipeline";
const switchCard = (page: Page, id: string) => page.locator(`[data-testid="switch-${id}"]`);

async function eventually(label: string, read: () => Promise<boolean>, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

async function next(page: Page, label: string | RegExp, arrivesAt: string | RegExp) {
  await page.getByRole("button", { name: label }).click();
  await heading(page, arrivesAt).waitFor({ timeout: 20000 });
}

async function carryOn(page: Page, until: string | RegExp) {
  for (let i = 0; i < 24; i++) {
    if (await heading(page, until).isVisible().catch(() => false)) return true;
    const before = await announce(page).textContent();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await page.waitForFunction((b) => document.querySelector("main p.sr-only[aria-live=polite]")?.textContent !== b, before, { timeout: 15000 }).catch(() => {});
  }
  return heading(page, until).isVisible().catch(() => false);
}

// Answers that pass the first check. They are Zainab's own words: the check also looks for the same words used by someone else's
// application, so these must not be copied from another journey.
const GOOD = {
  goalStory:
    "Two years ago I started a small tailoring business from my flat in Surulere with one sewing machine and a loan from my aunt. The first year I took every order, worked nights and almost closed in November. A friend from church sat with me, helped me price my work properly and taught me to say no. The shop now employs three women, and I learned that growing something means letting go of the habit of doing everything myself.",
  why: "A woman in my cell group once drove forty minutes to pray with me the week my mother was admitted to hospital, and she asked nothing in return. That kindness changed how I see church. I want other people in their thirties to feel that someone is on their side, and I am hoping that leading a tribe will teach me patience, which I clearly lack.",
  walked:
    "My cousin Ada was retrenched from her bank job last March. I called her every Tuesday evening, brought food when money was tight, and helped her rewrite her CV without telling her what she should do next. When she wanted to give up the search I simply listened. In September she found work, and she told me the calls were what kept her going.",
  walkNote: "I would give it a 4. I pray every morning before work and fast on Fridays, but I struggle to rest on Sundays because I am always thinking about orders. I know that is something I need to bring to God honestly.",
  obstacles:
    "December is my busiest month because of weddings and Christmas orders, and I lose most of my evenings. I would ask my assistant leader to hold the sessions for those weeks, and I would plan the weekly ideas in November so nothing depends on me being free. I would also tell my tribe at the start so nobody is surprised.",
};
const MASH = "asdkjh qwlkej zxmnbv poiuyt lkjhgf mnbvcx qazwsx edcrfv tgbyhn ujmikl";

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const kit = pipelineKit(adapter);

  await setPositions(adapter, OPEN_DOOR);
  // The first check on written answers is On for the first half: Find your tribe must not undo it
  await q.query("update public.leader_ai_settings set mode = 'on', activated_at = coalesce(activated_at, now())");

  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  const staff = await kit.panel();
  const zainab = await kit.person(undefined, "Zainab");
  const kayode = await kit.person(undefined, "Kayode");
  const FOUR = { age21: true, time: true, safeguarding: true, confidentiality: true };
  const kayodeApp = await kit.startDraft(kayode.id, answers(FOUR), "review");
  // A leader we already have, whose saved application is complete (the six situations and how she leads best are in it). The leaders the
  // journeys were seeded with have thin applications, and the quiet run says so rather than guessing for them.
  const amaka = await kit.person("leader", "Amaka");
  await q.query(
    "insert into public.leader_applications (person_id, status, answers, consent_version, decided_at) values ($1, 'approved_leader', $2::jsonb, '2026-10-v1', now())",
    [amaka.id, JSON.stringify(answers(FOUR))],
  );

  // The cards: every community's non-sensitive cards are signed off by the pastor, as she would on the ready-made cards page
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  const signed = await n("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'");
  check(signed >= 23, `the cards are signed off (${signed})`);
  check((await one("select tribe_fit from public.leader_pipeline_settings"))?.tribe_fit === "off", "Find your tribe starts Off");
  check(!(await one("select 1 as there from public.leader_fit_models where active")), "and no model has been approved yet");

  const browser = await launch();

  // ---- The Admin page: not ready, then ready ----------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "director.bola@example.org", ADMIN);
    await open(page, ADMIN);
    await page.getByTestId("fit-board").waitFor({ timeout: 20000 });
    const board = await text(page);
    check(board.includes("Switched off") && board.includes("Not ready"), "the Tribe fit card says it is off and not ready");
    check(/No model approved yet/.test(board), "…because no model is approved");
    check((await page.getByTestId("fit-missing").count()) === 1, "…and lists what is missing, in words");
    check(/of \d+ tribe cards are signed off/.test(await page.getByTestId("fit-cards").innerText()), "…with how many cards are signed off");
    check((await page.getByTestId("model-lf-1").innerText()).includes("Waiting for the pastor"), "the proposed model lf-1 waits for the pastor");
    check((await page.getByRole("button", { name: /^Approve lf-1$/ }).count()) === 0 && /Only the pastor can approve a version/.test(board), "a director cannot approve it");
    await shot(page, "23-admin-not-ready");

    await switchCard(page, "tribe_fit").locator('label.choice:has(input[value="on"])').click();
    await page.getByTestId("pipeline-review").click();
    await page.getByRole("button", { name: "Yes, save" }).click();
    await eventually("the refusal is shown", async () => /cannot be switched on/.test(await text(page)));
    check((await one("select tribe_fit from public.leader_pipeline_settings"))?.tribe_fit === "off", "switching it On is refused while it is not ready, and nothing changes");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "pastor.ife@example.org", ADMIN);
    await open(page, ADMIN);
    await page.getByTestId("fit-board").waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Approve lf-1" }).click();
    await eventually("lf-1 is in use", async () => (await one("select active from public.leader_fit_models where version = 'lf-1'"))?.active === true);
    await eventually("the board says so", async () => /lf-1 is now the model in use/.test(await text(page)));
    check(true, "the pastor approves lf-1");
    const log = await n("select count(*)::int n from public.event_log where action = 'leader_fit.model_approved' and actor_id = $1", [pastorId]);
    check(log === 1, "…and it is recorded with her name");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "director.bola@example.org", ADMIN);
    await open(page, ADMIN);
    await page.getByTestId("fit-board").waitFor({ timeout: 20000 });
    check(await page.getByTestId("fit-board").getByText("Ready", { exact: true }).isVisible(), "with a model and signed-off cards the card says Ready");
    await switchCard(page, "tribe_fit").locator('label.choice:has(input[value="on"])').click();
    await page.getByTestId("pipeline-reason").fill("The pastorate approved lf-1 and the first cards");
    await page.getByTestId("pipeline-review").click();
    await page.getByRole("button", { name: "Yes, save" }).click();
    await eventually("Find your tribe is On", async () => (await one("select tribe_fit from public.leader_pipeline_settings"))?.tribe_fit === "on");
    check(true, "now the director can switch Find your tribe On");
    await shot(page, "23-admin-on");
    await ctx.close();
  }

  // ---- Zainab, on a phone, with the first check On ------------------------------------------------------------------------
  let zainabGoal = "";
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, zainab.email, "/lead/apply");
    await heading(page, "Lead a tribe.").waitFor({ timeout: 20000 });
    await choice(page, "consent-leader", "yes").click();
    await next(page, "I agree, start my application", /four quick questions/);
    const yes = page.locator(".segmented label", { hasText: /^Yes$/ });
    for (let i = 0; i < (await yes.count()); i++) await yes.nth(i).click();
    await next(page, /^Continue$/, "How can the panel reach you?");
    await page.getByLabel("WhatsApp number").fill("0803 987 6543");
    await next(page, /^Continue$/, "Which stage of life are you in?");
    await choice(page, "track", "builders").click();
    await next(page, /^Continue$/, "Which community is home for you?");
    await choice(page, "community", "professionals").click();
    await next(page, /^Continue$/, "Which Season Goal could you lead a tribe toward?");
    await choice(page, "goal", "step-into-a-leadership-role").click();
    await choice(page, "goalRelation", "pursuing").click();
    await next(page, /^Continue$/, "Tell us your story with this goal.");
    await page.locator("textarea[name=goalStory]").fill(GOOD.goalStory);
    await next(page, /^Continue$/, "Why do you want to lead a tribe?");

    // The first check is still there: a mash in a written box gets the kind note and she stays where she is
    await page.locator("textarea[name=why]").fill(MASH);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await page.getByTestId("answer-feedback").waitFor({ timeout: 20000 });
    check(/Not quite yet/.test(await page.getByTestId("answer-feedback").innerText()), "with Find your tribe On, keyboard mashing in a written box still gets the kind note");
    check(await heading(page, "Why do you want to lead a tribe?").isVisible(), "…and she stays on the same screen");
    check((await n("select count(*)::int n from public.leader_answer_checks where application_id = (select id from public.leader_applications where person_id = $1)", [zainab.id])) >= 1, "…and the answer was checked");
    await page.locator("textarea[name=why]").fill(GOOD.why);
    await next(page, /^Continue$/, "Tell us about a time you walked with someone through a hard season.");
    await page.locator("textarea[name=walked]").fill(GOOD.walked);
    await next(page, /^Continue$/, "How is your walk with God right now?");
    await page.locator('label:has(input[name="walkRating"][value="4"])').click();
    await page.locator("textarea[name=walkNote]").fill(GOOD.walkNote);
    await next(page, /^Continue$/, "What could get in the way of leading well for twelve weeks?");
    await page.locator("textarea[name=obstacles]").fill(GOOD.obstacles);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await page.getByText("Situation 1 of 6").waitFor({ timeout: 20000 });
    const checks = (await one("select count(*)::int as total, count(*) filter (where passes)::int as passed from public.leader_answer_checks where application_id = (select id from public.leader_applications where person_id = $1)", [zainab.id]))!;
    check(Number(checks.total) >= 6 && Number(checks.passed) >= 5, `all five written answers were checked before the new screen could appear (${checks.passed} passed of ${checks.total})`);
    for (let s = 1; s <= 6; s++) {
      await page.getByText(`Situation ${s} of 6`).waitFor({ timeout: 10000 });
      await page.locator("ul.stagger > li").nth(0).getByRole("button", { name: "Best" }).click();
      await page.locator("ul.stagger > li").nth(1).getByRole("button", { name: "Worst" }).click();
      const before = await announce(page).textContent();
      await page.getByRole("button", { name: /^Continue$/ }).click();
      await page.waitForFunction((b) => document.querySelector("main p.sr-only[aria-live=polite]")?.textContent !== b, before, { timeout: 15000 });
    }
    await carryOn(page, "I lead best by");
    await choice(page, "leadBest", "connection").click();
    await page.getByRole("button", { name: /^Continue$/ }).click();

    // ---- The new screen -----------------------------------------------------------------------------------------------------
    await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
    const best = page.getByRole("radiogroup", { name: "Your best matches" });
    await best.waitFor({ timeout: 25000 });
    const cards = best.locator("label.choice");
    const count = await cards.count();
    check(count >= 1 && count <= 3, `she sees her best tribes, at most three (${count})`);
    const screen = await text(page);
    check(/(Excellent|Strong|Good) match, \d{2,3}%/.test(screen), "each has a match word and a percentage");
    check(/Based on what you told us/.test(screen), "…and says what it is based on");
    // "Your judgement" is the name of the step the leader has just finished, in the progress line at the top; it has always been there
    const hidden = screen.replace(/Your judgement/g, "").match(/care bar|judgement|demand|sensitive|structure|weights?|model/i);
    check(!hidden, `…and shows nothing about the model, the weights or the hidden profile${hidden ? ` (it says “${hidden[0]}”: …${screen.slice(Math.max(0, (hidden.index ?? 0) - 60), (hidden.index ?? 0) + 60).replace(/\s+/g, " ")}…)` : ""}`);
    check((await best.locator("li").count()) >= 1, "…with a few plain reasons for each");
    const continueButton = page.getByRole("button", { name: /^Continue$/ });
    check(await continueButton.isDisabled(), "she cannot go on until she has chosen");
    await shot(page, "23-fit-phone");
    await noOverflow(page, "Find your tribe on a phone");

    await cards.first().click();
    check(await continueButton.isEnabled(), "choosing a tribe lets her go on");
    check(/Add up to two backups/.test(await text(page)) && /change your choice until you send/.test(await text(page)), "…and tells her about backups, and that she can change her mind");
    const boxes = page.locator('input[name="fitBackup"]');
    check((await boxes.count()) >= 1, "every other tribe now offers a backup box");
    // Open every community so the boxes can be reached, then tick three: the third is refused
    const sections = page.locator("details");
    for (let i = 0; i < (await sections.count()); i++) await sections.nth(i).evaluate((d) => ((d as HTMLDetailsElement).open = true));
    const free = page.locator('input[name="fitBackup"]:not(:disabled)');
    await free.nth(0).check();
    await page.locator('input[name="fitBackup"]:not(:disabled):not(:checked)').nth(0).check();
    const ticked = await page.locator('input[name="fitBackup"]:checked').count();
    check(ticked === 2, `two backups can be named (${ticked})`);
    const loose = await page.locator('input[name="fitBackup"]:not(:checked)').evaluateAll((els) => els.every((e) => (e as HTMLInputElement).disabled));
    check(loose, "…and every other box is then closed: a third is refused");
    zainabGoal = (await page.locator('input[name="fitGoal"]:checked').getAttribute("value")) ?? "";
    await shot(page, "23-fit-chosen");

    await next(page, /^Continue$/, "Here is your application.");
    const app = (await one("select id, answers from public.leader_applications where person_id = $1", [zainab.id]))!;
    const run = (await one("select chosen_goal_id, cardinality(backup_goal_ids) as backups, model_version, source from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [app.id]))!;
    check(run.chosen_goal_id === zainabGoal && Number(run.backups) === 2 && run.source === "application", "the choice and two backups are recorded against her application");
    const slug = (await one("select slug from public.season_goals where id = $1", [zainabGoal]))!.slug;
    check(((app.answers as Row).calling as Row).goal === slug && ((app.answers as Row).calling as Row).goalOther === undefined, "her saved application now names the tribe she chose");
    check(/Send my application/.test(await text(page)), "she is at the review, ready to send");
    await shot(page, "23-review");

    // Back to the screen: the choice is where she left it
    await page.getByRole("button", { name: "Back" }).click();
    await heading(page, "Find your tribe").waitFor({ timeout: 20000 });
    await best.waitFor({ timeout: 20000 });
    check((await page.locator('input[name="fitGoal"]:checked').getAttribute("value")) === zainabGoal, "going back, her choice is still chosen");
    check((await page.locator('input[name="fitBackup"]:checked').count()) === 2, "…and so are her two backups");

    // The page, as she sees it and as it was sent to her, carries nothing the comparison keeps to itself
    const SECRET = /care_bar|care_flag|careBar|leadership_profile|who_leads_well|demand_structure|demand_connection|demand_teaching|demand_doing|signed_off_by|model_version|first_goal_id|chosen_flags|"weights"/i;
    const shownHtml = await page.content();
    const sentHtml = await (await page.request.get(page.url())).text();
    check(!SECRET.test(shownHtml), `the page as she sees it carries none of the words the comparison keeps to itself${SECRET.test(shownHtml) ? ` (${shownHtml.match(SECRET)?.[0]})` : ""}`);
    check(!SECRET.test(sentHtml), `…nor the page as it was sent to her${SECRET.test(sentHtml) ? ` (${sentHtml.match(SECRET)?.[0]})` : ""}`);

    // Reloading on the review brings her back to the review, and going back finds her choice and her backups
    await next(page, /^Continue$/, "Here is your application.");
    await page.reload();
    await heading(page, "Here is your application.").waitFor({ timeout: 25000 });
    check(true, "reloading the page on the review brings her back to the review");
    await page.getByRole("button", { name: "Back" }).click();
    await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
    await best.waitFor({ timeout: 25000 });
    check((await page.locator('input[name="fitGoal"]:checked').getAttribute("value")) === zainabGoal, "after a reload, her choice is still chosen");
    check((await page.locator('input[name="fitBackup"]:checked').count()) === 2, "…and so are her two backups");
    await next(page, /^Continue$/, "Here is your application.");

    // She changes her mind about the goal from the review: the tribes are worked out again before she can send
    const runsBefore = await n("select count(*)::int n from public.leader_fit_runs where application_id = $1", [app.id]);
    const otherGoal = (await one(
      `select g.slug from public.season_goals g join public.communities c on c.id = g.community_id
         join public.tribe_card_templates t on t.season_goal_id = g.id and t.status = 'signed_off'
        where c.slug = 'professionals' and g.active and g.slug <> $1 order by g.slug limit 1`,
      [slug],
    ))!.slug as string;
    await page.getByRole("button", { name: "Change Season Goal" }).click();
    await heading(page, "Which Season Goal could you lead a tribe toward?").waitFor({ timeout: 20000 });
    await choice(page, "goal", otherGoal).click();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
    check(true, "changing the goal from the review takes her back to Find your tribe, not straight to Send");
    await page.locator('input[name="fitGoal"]').first().waitFor({ state: "attached", timeout: 25000 });
    check((await n("select count(*)::int n from public.leader_fit_runs where application_id = $1", [app.id])) === runsBefore + 1, "…and the tribes were worked out again from her new answer");
    check((await page.locator('input[name="fitGoal"]:checked').count()) === 0 && (await page.getByRole("button", { name: /^Continue$/ }).isDisabled()), "…with nothing chosen yet, so she chooses again");
    // A different goal can suit her less: when nothing reaches a good match the screen says so and still lets her choose any tribe
    if ((await best.locator("label.choice").count()) === 0) {
      check(/None reached a good match yet\. You can still choose any tribe below\./.test(await text(page)), "…and if none of the tribes reaches a good match, the screen says so and still lets her choose");
    }
    const every = page.locator("details");
    for (let i = 0; i < (await every.count()); i++) await every.nth(i).evaluate((d) => ((d as HTMLDetailsElement).open = true));
    await page.locator("label.choice").first().click();
    zainabGoal = (await page.locator('input[name="fitGoal"]:checked').getAttribute("value")) ?? "";
    await next(page, /^Continue$/, "Here is your application.");
    const again = (await one("select chosen_goal_id, cardinality(backup_goal_ids) as backups, source from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [app.id]))!;
    check(again.chosen_goal_id === zainabGoal && again.source === "application", "the new choice is the one recorded against her application");
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, /^Sent, Zainab/).waitFor({ timeout: 30000 });
    check((await one("select status from public.leader_applications where person_id = $1", [zainab.id]))?.status === "submitted", "she sends it");
    await ctx.close();
  }

  // ---- Kayode: his draft was started before the switch was On ---------------------------------------------------------------
  await q.query("update public.leader_ai_settings set mode = 'off'");
  let kayodeTitle = "";
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, kayode.email, "/lead/apply");
    await page.getByRole("button", { name: "Send my application" }).waitFor({ timeout: 20000 });
    check((await n("select count(*)::int n from public.leader_fit_runs where application_id = $1", [kayodeApp])) === 0, "Kayode has not seen the new screen");
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
    check(true, "pressing Send takes him to the new screen instead of sending");
    check((await one("select status from public.leader_applications where id = $1", [kayodeApp]))?.status === "draft", "…his application is still a draft");
    const best = page.getByRole("radiogroup", { name: "Your best matches" });
    await best.waitFor({ timeout: 25000 });
    const cards = best.locator("label.choice");
    const pick = cards.nth((await cards.count()) - 1);
    kayodeTitle = (await pick.locator("span.font-semibold").first().innerText()).trim();
    await pick.click();
    const backup = page.locator('input[name="fitBackup"]:not(:disabled)').first();
    if (await backup.count()) await backup.check();
    await next(page, /^Continue$/, "Here is your application.");
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, /^Sent, Kayode/).waitFor({ timeout: 30000 });
    check((await one("select status from public.leader_applications where id = $1", [kayodeApp]))?.status === "submitted", "he chooses, and then it sends");
    await ctx.close();
  }

  // ---- The panel: a coach after scoring, the pastor at once ----------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, staff.coach.email, `/review/${kayodeApp}`);
    const before = page.getByTestId("tribe-fit");
    await before.waitFor({ timeout: 20000 });
    check((await before.count()) === 1 && /once you have scored the application yourself/.test(await before.innerText()), "a coach is told the panel appears once they have scored");
    check(!(await before.innerText()).includes(kayodeTitle), "…and it does not show the tribe before they have");
    await kit.review(staff.coach.id, kayodeApp, "calling", 5);
    await open(page, `/review/${kayodeApp}`);
    await page.getByTestId("tribe-fit").waitFor({ timeout: 20000 });
    check((await page.getByTestId("tribe-fit").innerText()).includes(`Chose ${kayodeTitle}`), "after scoring, the coach sees the tribe he chose");
    await ctx.close();
  }
  await kit.review(staff.scorer.id, kayodeApp, "calling", 5);
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, staff.pastor.email, `/review/${kayodeApp}`);
    await heading(page, "Leader Readiness Score").waitFor({ timeout: 20000 });
    const panel = page.getByTestId("tribe-fit");
    await panel.waitFor({ timeout: 20000 });
    const body = await panel.innerText();
    check(body.includes(`Chose ${kayodeTitle}`) && /(Excellent|Strong|Good) match, \d+%/.test(body), "the pastor sees the tribe he chose and how well his answers match it");
    check(/Backups they named/.test(body) || (await n("select cardinality(backup_goal_ids)::int n from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [kayodeApp])) === 0, "…and the backups he named");
    check(/A note to help the conversation\. It does not change a score, and you decide\./.test(body), "…and is told it changes no score");
    check(/Calling and goal fit/.test(await text(page)), "the readiness score is the one it always was");
    await shot(page, "23-panel");
    await page.locator('label.choice:has(input[value="leader"])').click();
    await page.getByRole("button", { name: "Record decision" }).click();
    await page.getByRole("button", { name: "Yes, record it" }).click();
    await eventually("the decision is recorded", async () => (await one("select status from public.leader_applications where id = $1", [kayodeApp]))?.status === "approved_leader");
    check(true, "a pastor still decides, and Kayode is approved");
    await ctx.close();
  }

  // ---- A sensitive tribe that suits her badly: offered with a gentle note, and the pastor is told if she picks it ----------------------------
  {
    const sens = (await one(
      `select t.slug, t.title, c.slug as community, t.track_slugs as tracks
         from public.tribe_card_templates t join public.communities c on c.id = t.community_id and c.active
        where t.sensitive and t.status = 'draft' order by c.sort, t.slug limit 1`,
    ))!;
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off($1)", [sens.slug]));
    const goalSlug = (await one("select g.slug from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id where t.slug = $1", [sens.slug]))!.slug as string;
    const lola = await kit.person(undefined, "Lola");
    const lolaApp = await kit.startDraft(
      lola.id,
      answers(FOUR, { calling: calling({ track: (sens.tracks as string[])[0], community: sens.community, goal: goalSlug }), scenarios: SCENARIOS_POOR }),
      "review",
    );
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, lola.email, "/lead/apply");
    await page.getByRole("button", { name: "Send my application" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
    const best = page.getByRole("radiogroup", { name: "Your best matches" });
    await page.locator("details").first().waitFor({ state: "attached", timeout: 25000 });
    const sections = page.locator("details");
    for (let i = 0; i < (await sections.count()); i++) await sections.nth(i).evaluate((d) => ((d as HTMLDetailsElement).open = true));
    const flagged = page.locator("label.choice", { hasText: String(sens.title) }).first();
    await flagged.waitFor({ timeout: 15000 });
    check(/A pastor will talk with you about this one/.test(await flagged.innerText()), "a sensitive tribe that her answers do not yet suit is still offered, with a gentle note");
    check((await best.locator("label.choice", { hasText: String(sens.title) }).count()) === 0, "…but never among her best matches");
    const words = await text(page);
    check(!/care bar|below the bar|sensitive/i.test(words), "…and nothing on the screen says why, in the test's words");
    await flagged.click();
    await next(page, /^Continue$/, "Here is your application.");
    const flags = (await one("select chosen_flags from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [lolaApp]))?.chosen_flags as string[] | undefined;
    check(Boolean(flags?.includes("sensitive_below_bar")), `choosing it is recorded for the pastor (${(flags ?? []).join(", ")})`);
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, /^Sent, Lola/).waitFor({ timeout: 30000 });
    await ctx.close();
    {
      const p = await newPage(browser, "desktop");
      await signIn(p.page, staff.pastor.email, `/review/${lolaApp}`);
      await p.page.getByTestId("tribe-fit").waitFor({ timeout: 20000 });
      const body = await p.page.getByTestId("tribe-fit").innerText();
      const wording = String((await one("select public.leader_fit_flag_text('sensitive_below_bar') as t"))?.t);
      check(body.includes(wording), "the pastor is told in words: “" + wording + "”");
      check(/things? to talk about/i.test(body), "…as something to talk about, not a mark against her");
      await p.ctx.close();
    }
  }

  // ---- Nothing to choose from: no approved model, so the screen is passed over and she can send ---------------------------------------------
  {
    await q.query("update public.leader_fit_models set active = false where version = 'lf-1'");
    const nia = await kit.person(undefined, "Nia");
    const niaApp = await kit.startDraft(nia.id, answers(FOUR), "review");
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, nia.email, "/lead/apply");
    await page.getByRole("button", { name: "Send my application" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Send my application" }).click();
    await heading(page, /^Sent, Nia/).waitFor({ timeout: 30000 });
    check(true, "with nothing approved to compare against, the screen is passed over and her application sends");
    check((await n("select count(*)::int n from public.leader_fit_runs where application_id = $1", [niaApp])) === 0, "…and nothing was worked out or asked of her");
    await ctx.close();
    await q.query("update public.leader_fit_models set active = true where version = 'lf-1'");
  }

  // ---- The model: a second version, and the leaders we already have -------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "pastor.ife@example.org", ADMIN);
    await open(page, ADMIN);
    await page.getByTestId("fit-board").waitFor({ timeout: 20000 });
    const need = page.getByTestId("fit-need");
    const stage = page.getByTestId("fit-stage");
    await need.fill(String(Number(await need.inputValue()) + 5));
    check(/^The five parts add up to \d+\. They must add up to 100\.$/.test((await page.getByTestId("fit-sum").innerText()).trim()), "five more on need and nothing taken off: the page says the parts no longer add up");
    check(await page.getByRole("button", { name: "Save as a new version" }).isDisabled(), "…and will not save it");
    await stage.fill(String(Number(await stage.inputValue()) - 5));
    check((await page.getByTestId("fit-sum").innerText()).trim() === "The five parts add up to 100.", "taking five off stage makes them add up again");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await eventually("lf-2 is saved", async () => (await n("select count(*)::int n from public.leader_fit_models where version = 'lf-2'")) === 1);
    check((await one("select active from public.leader_fit_models where version = 'lf-2'"))?.active === false, "the new version is saved but not in use");
    check((await one("select active from public.leader_fit_models where version = 'lf-1'"))?.active === true, "…lf-1 is still the one in use");
    await open(page, ADMIN);
    await page.getByRole("button", { name: "Approve lf-2" }).click();
    await eventually("lf-2 is in use", async () => (await one("select active from public.leader_fit_models where version = 'lf-2'"))?.active === true);
    check((await one("select active from public.leader_fit_models where version = 'lf-1'"))?.active === false, "approving lf-2 retires lf-1 from use, and keeps it on record");
    check((await n("select count(*)::int n from public.leader_fit_runs where model_version = 'lf-1'")) >= 2, "…and the runs made with lf-1 stay with lf-1");

    const messages = await n("select count(*)::int n from public.messages");
    await open(page, ADMIN);
    await page.getByRole("button", { name: "Look at the leaders now" }).click();
    await eventually("the leaders are looked at", async () => (await n("select count(*)::int n from public.leader_fit_runs where source = 'quiet'")) >= 1);
    check((await n("select count(*)::int n from public.messages")) === messages, "the leaders we already have are looked at and nobody is messaged");
    check((await n("select count(*)::int n from public.leader_fit_runs where source = 'quiet' and person_id = $1", [amaka.id])) === 1, "Amaka, whose saved answers are complete, was looked at");
    check((await n("select count(*)::int n from public.leader_fit_runs where source = 'quiet' and person_id = $1", [(await one("select id from public.people where email = 'ngozi@example.org'"))!.id]))=== 0, "…and a leader whose saved answers are thin is left out, and the page says how many could not be done");
    check(/could not be done because their saved answers are not complete/.test(await text(page)), "(the board says so in words)");
    await shot(page, "23-admin-model");
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, amaka.email, "/lead/tribe");
    await open(page, "/lead/tribe");
    const next = page.getByTestId("next-season-tribes");
    await next.waitFor({ timeout: 20000 });
    const body = await next.innerText();
    check(body.includes("Tribes you could lead next season") && body.includes("does not change"), "an approved leader's page lists the tribes they could lead next season, and says this season's tribe does not change");
    const items = await next.locator("ul.stagger > li").count();
    check(items >= 1 && items <= 3, `…at most three (${items})`);
    check(!/Stretch/.test(body), "…and none is a stretch");
    await noOverflow(page, "Tribes you could lead next season on a phone");
    await shot(page, "23-next-season");
    await ctx.close();
  }

  // Leave the shipped positions
  await q.query("update public.leader_pipeline_settings set tribe_fit = 'off'");
  await setPositions(adapter, {});
  await browser.close();
  await q.end();
  finish("23-find-tribe");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

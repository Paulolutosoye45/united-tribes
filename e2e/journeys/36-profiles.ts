/**
 * Profiles and the Weekly Rhythm, stage 1, end to end.
 *
 *  - Everything starts Off. Nobody finds My page, the strip on the Lead page, the Stage changes tab or the owner's switchboard; a private link
 *    that was never made says so.
 *  - Only the platform owner moves a switch, on the console's Features page: an administrator does not find it. The Details Check cannot be
 *    opened before My page; both are opened for tribe leaders only, and then only leaders find My page.
 *  - The owner rehearses a run: it writes what would be sent, sends nothing, and shows where each person stands, never what they answered.
 *    A live run cannot be made while the switch is only in Rehearsal.
 *  - An appointed leader finds the strip on her Lead page and My page behind it. She is asked with a private link: with no sign-in the page
 *    shows nothing about her until a six-digit code (sent to the email the church holds, never to anything typed) opens it. She answers, and
 *    My page then shows the stage as confirmed.
 *  - A leader whose tribe has members asks to change her stage: nothing changes and nobody is moved until a pastor decides. The pastor sees
 *    the request on the Stage changes tab and beside the Tribe Card, approves one and keeps the other as it was, with a note the leader reads.
 *  - The Master pause acts at once, and is undone again.
 *
 * What is only arranged here (a season, tribes with members, an appointed leader) is arranged in the database the way the database tests do
 * it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const NOT_FOUND = /We can.t find that page/;
const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
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

/** A check on what a page says; when it fails, shows what the page did say. */
function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

/** Opens a function's switch editor unless it is already open (the card keeps it open after a refusal). */
async function editor(page: Page, key: string) {
  const box = page.getByTestId(`feature-${key}-editor`);
  if ((await box.count()) === 0) await page.getByTestId(`feature-${key}-open`).click();
  await box.waitFor({ timeout: 15000 });
  return box;
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off, a season, an appointed leader, two leaders whose tribes have members -------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");

  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  for (const t of (await q.query("select slug from public.tribe_card_templates where status <> 'signed_off'")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off($1)", [t.slug]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;

  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter);
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  // The office appoints Ada (a draft tribe, nobody in it)
  const ada = await adapter.createUser({ email: "ada.appointed@example.org" });
  await q.query("update public.people set full_name = 'Ada Appointed', preferred_name = 'Ada' where id = $1", [ada.id]);
  const goal = (await one("select id from public.season_goals where slug = $1", [FORM.goal]))!.id as string;
  const appointed = await o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), goal, "Known to the church for years.");
  check(appointed?.ok === true, "Ada is appointed by the office (arranged in the database)");
  const adaTribe = (await one("select tribe_id from public.leader_appointments where person_id = $1 and status = 'active'", [ada.id]))!.tribe_id as string;

  // Lanre and Femi lead approved tribes with members, on the Stewards track
  const lanre = await k.tribe(S, { name: "Seasoned Lanre Tribe", track: "stewards" });
  await q.query("update public.people set full_name = 'Lanre Seasoned', preferred_name = 'Lanre' where id = $1", [lanre.leader.id]);
  await k.seat(lanre.tribe, S, "Bola");
  await k.seat(lanre.tribe, S, "Chidi");
  const femi = await k.tribe(S, { name: "Seasoned Femi Tribe", track: "stewards" });
  await q.query("update public.people set full_name = 'Femi Seasoned', preferred_name = 'Femi' where id = $1", [femi.leader.id]);
  await k.seat(femi.tribe, S, "Dayo");
  const plain = await adapter.createUser({ email: "plain.member36@example.org" });
  await q.query("update public.people set full_name = 'Plain Member', preferred_name = 'Plain' where id = $1", [plain.id]);
  const trackOf = async (tribe: string) => (await one("select tr.slug from public.tribes t join public.tracks tr on tr.id = t.track_id where t.id = $1", [tribe]))!.slug as string;
  const membersOf = async (tribe: string) => n("select count(*)::int n from public.tribe_members where tribe_id = $1", [tribe]);

  const browser = await launch();
  const DIRECTOR = "director.bola@example.org";
  const ADMIN = "admin.mary@example.org";
  const PASTOR = "pastor.ife@example.org";
  const FAKE = "c".repeat(64);

  // ---- Everything Off: nobody finds anything --------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "phone");
    await signIn(a.page, ada.email, "/lead");
    await open(a.page, "/lead");
    await a.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("details-strip").count()) === 0, "with everything Off, an appointed leader's Lead page has no strip about her details");
    await open(a.page, "/my");
    check(NOT_FOUND.test(await text(a.page)), "…and My page does not exist for her");
    await a.ctx.close();
  }
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, PASTOR, "/review/cards");
    await open(p.page, "/review/cards");
    check((await p.page.getByRole("link", { name: "Stage changes" }).count()) === 0, "with everything Off, the pastor's review panel has no Stage changes tab");
    await p.ctx.close();
  }
  {
    const a = await newPage(browser, "phone");
    await open(a.page, `/details/${FAKE}`);
    check((await a.page.getByTestId("details-ended").count()) === 1 && /This link isn.t working/.test(await text(a.page)), "a private link that was never made says so, in words, and shows nothing else");
    await open(a.page, "/details/not-a-link");
    check((await a.page.getByTestId("details-ended").count()) === 1, "…and so does one that is not even the right shape");
    await a.ctx.close();
  }
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, ADMIN, "/god/features");
    for (const path of ["/god/features", "/god/details"]) {
      await open(a.page, path);
      check(NOT_FOUND.test(await text(a.page)), `to an administrator ${path} does not exist`);
    }
    await a.ctx.close();
  }

  // ---- God Mode: the switchboard ---------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, o.owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await page.getByRole("link", { name: "Features", exact: true }).first().click();
  await page.waitForURL(/\/god\/features/, { timeout: 15000 });
  await page.getByTestId("features-board").waitFor({ timeout: 20000 });
  check(true, "God Mode finds Features in its menu");
  await noOverflow(page, "the Features switchboard on a desktop");
  await shot(page, "36-board-off");
  check((await page.locator('[data-testid^="feature-"][data-testid$="-open"]').count()) === 3, "three functions can be moved in stage 1; the rest can be read and not moved");
  for (const key of ["my_page", "details_check", "hold_card"]) {
    check(/Off/.test(await page.getByTestId(`feature-${key}`).innerText()), `${key} starts Off`);
  }
  check(/arrives in stage 3/i.test(await page.getByTestId("features-board").innerText()), "the later stages are listed, with when they arrive");
  check(/Nothing is paused/.test(await page.getByTestId("features-board").innerText()), "nothing is paused");

  // The Details Check needs My page: refused, in words, and nothing is saved
  await editor(page, "details_check");
  await page.getByTestId("feature-details_check-save").click();
  const notice = page.getByTestId("feature-details_check").getByRole("alert");
  await notice.waitFor({ timeout: 15000 });
  const refusal = await notice.innerText();
  check(/Open My page.* first/i.test(refusal), `the Details Check cannot be opened before My page: the owner is told what to open first (${refusal})`);
  check((await n("select count(*)::int n from public.feature_settings")) === 0, "…and nothing was saved");

  // My page, for tribe leaders only (a note is not needed when roles are chosen)
  const mine = await editor(page, "my_page");
  await page.getByTestId("feature-my_page-on").click();
  await mine.getByText("Tribe leader", { exact: true }).click();
  await page.getByTestId("feature-my_page-save").click();
  await page.getByTestId("feature-my_page-rules").waitFor({ timeout: 15000 });
  const rule = await one("select scope, position, roles from public.feature_settings where feature = 'my_page'");
  check(rule?.scope === "platform" && rule?.position === "on" && JSON.stringify(rule?.roles) === JSON.stringify(["leader"]), "My page is On for tribe leaders, across the platform (one rule)");
  check(/tribe leader/i.test(await page.getByTestId("feature-my_page-rules").innerText()), "…and the board says whom it reaches");

  // The Details Check, in Rehearsal for tribe leaders
  const rehearsing = await editor(page, "details_check");
  await rehearsing.getByText("Tribe leader", { exact: true }).click();
  await page.getByTestId("feature-details_check-save").click();
  await page.getByTestId("feature-details_check-rules").waitFor({ timeout: 15000 });
  check((await one("select position from public.feature_settings where feature = 'details_check'"))?.position === "rehearsal", "the Details Check is in Rehearsal for tribe leaders");
  check((await n("select count(*)::int n from public.feature_log")) === 2, "each change has one line in the log");
  await shot(page, "36-board-rehearsal");

  // Only leaders find My page now
  {
    const a = await newPage(browser, "phone");
    await signIn(a.page, plain.email, "/my");
    await open(a.page, "/my");
    check(NOT_FOUND.test(await text(a.page)), "a person who is not a leader still has no My page");
    await a.ctx.close();
  }

  // ---- The Details check: a rehearsal ------------------------------------------------------------------------------------------------------
  await page.getByRole("link", { name: "Details check", exact: true }).first().click();
  await page.waitForURL(/\/god\/details/, { timeout: 15000 });
  await page.getByTestId("details-console").waitFor({ timeout: 20000 });
  await noOverflow(page, "the Details check console on a desktop");
  check(/in Rehearsal/.test(await page.getByTestId("details-console").innerText()), "the console says the switch is in Rehearsal");
  check(/Nothing has been asked yet/.test(await page.getByTestId("details-runs").innerText()), "nothing has been asked yet");
  await page.getByTestId("details-plan").click();
  await page.getByTestId("details-plan-result").waitFor({ timeout: 15000 });
  check(/\d+ (person|people) would be asked/.test(await page.getByTestId("details-plan-result").innerText()), "the owner sees how many would be asked before anything happens");
  await page.getByTestId("details-send").click();
  await page.getByTestId("details-done").waitFor({ timeout: 20000 });
  check(/Rehearsed for \d+ (person|people)\. Nothing was sent\./.test(await page.getByTestId("details-done").innerText()), "a rehearsal says nothing was sent");
  check((await n("select count(*)::int n from public.details_checks where mode = 'rehearsal'")) === 1, "one rehearsal is recorded");
  check((await n("select count(*)::int n from public.messages where template in ('details_check_request', 'details_check_reminder', 'details_check_code')")) === 0, "…no message was queued");
  check((await n("select count(*)::int n from public.details_check_tokens")) === 0, "…and no private link was made");
  await page.getByRole("link", { name: "See who" }).first().click();
  await page.getByTestId("details-run").waitFor({ timeout: 20000 });
  const run = await page.getByTestId("details-run").innerText();
  check(/Ada Appointed/.test(run) && /None made/.test(run), "the run shows Ada, and that no link was made for her");
  check(!/builders|Builders|26 to 40/.test(run), "…and never what anyone has down or answered");
  await shot(page, "36-run-rehearsal");

  // A live run cannot be made while the switch is only in Rehearsal
  await page.getByTestId("details-mode-live").click();
  await page.getByTestId("details-plan").click();
  await page.getByTestId("details-plan-result").waitFor({ timeout: 15000 });
  check(/0 people would be asked/.test(await page.getByTestId("details-plan-result").innerText()) && (await page.getByTestId("details-send").count()) === 0, "a live run cannot be made while the switch is only in Rehearsal: nobody would be asked, and there is nothing to press");

  // ---- Open the Details check for tribe leaders -----------------------------------------------------------------------------------------
  await page.getByRole("link", { name: "Open Features" }).click();
  await page.waitForURL(/\/god\/features/, { timeout: 15000 });
  const dc = await editor(page, "details_check");
  await page.getByTestId("feature-details_check-on").click();
  await dc.getByText("Tribe leader", { exact: true }).click();
  await page.getByTestId("feature-details_check-save").click();
  await eventually("the Details check is On", async () => (await one("select position from public.feature_settings where feature = 'details_check'"))?.position === "on");
  check((await n("select count(*)::int n from public.feature_settings where feature = 'details_check'")) === 1, "moving it again replaces the rule (one rule for one place)");

  // ---- Ada: the strip on her Lead page, then My page ----------------------------------------------------------------------------------------
  const adaPage = await newPage(browser, "phone");
  await signIn(adaPage.page, ada.email, "/lead");
  await open(adaPage.page, "/lead");
  await adaPage.page.getByTestId("details-strip").waitFor({ timeout: 20000 });
  check(/one detail/.test(await adaPage.page.getByTestId("details-strip").innerText()), "Ada's Lead page says one detail waits for her");
  await noOverflow(adaPage.page, "the Lead page with the strip, on a phone");
  await shot(adaPage.page, "36-lead-strip");
  await adaPage.page.getByTestId("details-strip").getByRole("link", { name: "Confirm your details" }).click();
  await adaPage.page.waitForURL(/\/my$/, { timeout: 15000 });
  await adaPage.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  const mineText = await text(adaPage.page);
  has("My page asks Ada to check what the office suggested, and says who suggested it", /The church office suggested this\. Please check it\./, mineText);
  check(/We have you down as 26 to 40, the Builders stage\. Is that right\?/.test(mineText) && !/\{value\}/.test(mineText), "…in a question with her stage in it, not a gap");
  const answers = await Promise.all(["yes", "change", "notme", "later"].map((a) => adaPage.page.getByTestId(`my-life_stage-${a}`).count()));
  check(answers.every((c) => c === 1), "…with the four answers (right, change it, not me, later)");
  await noOverflow(adaPage.page, "My page on a phone");
  await shot(adaPage.page, "36-my-page");

  // ---- A live run, for two named leaders ------------------------------------------------------------------------------------------------------
  await open(page, "/god/details");
  await page.getByTestId("details-console").waitFor({ timeout: 20000 });
  await page.getByTestId("details-audience-list").click();
  for (const who of ["Ada Appointed", "Lanre Seasoned", "Femi Seasoned"]) {
    await page.getByLabel(/Find a person/).fill(who);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(who) }).first().click();
  }
  await page.getByTestId("details-mode-live").click();
  await page.getByTestId("details-plan").click();
  await page.getByTestId("details-plan-result").waitFor({ timeout: 15000 });
  check(/3 people would be asked/.test(await page.getByTestId("details-plan-result").innerText()), "the owner sees that three people would be asked");
  check((await page.getByTestId("details-send").isDisabled()) === true, "a live run cannot be sent until the owner says they understand");
  await page.getByTestId("details-sure").check();
  await page.getByTestId("details-send").click();
  await page.getByTestId("details-done").waitFor({ timeout: 20000 });
  check(/Asked 3 people/.test(await page.getByTestId("details-done").innerText()), "the live run asks three people");
  await shot(page, "36-run-live");
  const request = async (person: string) => one("select reply_token, params, status from public.messages where person_id = $1 and template = 'details_check_request' order by created_at desc limit 1", [person]);
  const tokens: Record<string, string> = {};
  for (const [name, id] of [["ada", ada.id], ["lanre", lanre.leader.id], ["femi", femi.leader.id]] as const) {
    const m = await request(id);
    tokens[name] = String(m?.reply_token ?? "");
    check(/^[a-f0-9]{64}$/.test(tokens[name]), `${name} has a message with a private link`);
    check(!/builders|stewards|rising|sages/i.test(JSON.stringify(m?.params ?? {})), `…and the message carries no fact about ${name}`);
  }
  check((await n("select count(*)::int n from public.details_check_tokens")) === 3, "three links were made, each stored as a hash");
  check((await n("select count(*)::int n from public.details_check_tokens where token_hash = any($1)", [Object.values(tokens)])) === 0, "…and the link itself is nowhere in the database but the message");
  await page.getByTestId("details-runs").getByText("Live").first().waitFor({ timeout: 15000 });

  // ---- Ada, with no sign-in: a code first, then the question -----------------------------------------------------------------------------
  {
    const v = await newPage(browser, "phone");
    await open(v.page, `/details/${tokens.ada}`);
    await v.page.getByTestId("details-code-ask").waitFor({ timeout: 20000 });
    const first = await text(v.page);
    check(!/Ada|Builders|Seasoned|ada\.appointed/.test(first), "with no sign-in the page shows nothing about her: not her name, not what the church holds");
    await noOverflow(v.page, "the private link on a phone");
    await shot(v.page, "36-link-code");
    await v.page.getByTestId("details-send-code").click();
    await v.page.getByTestId("details-code").waitFor({ timeout: 20000 });
    const sent = await one("select template, force_channel, params from public.messages where person_id = $1 and template = 'details_check_code' order by created_at desc limit 1", [ada.id]);
    check(sent?.force_channel === "email" && /^\d{6}$/.test(String((sent?.params as Row)?.code)), "the code goes by email to Ada's own address, and is six digits");
    const where = await v.page.getByTestId("details-code").innerText();
    check(/a\*\*\*@example\.org/.test(where) && !/ada\.appointed/.test(where), "the page says where the code went, with the address half hidden");
    // a wrong code first
    await v.page.getByLabel("Six-digit code").fill("000000");
    await v.page.getByTestId("details-code-error").waitFor({ timeout: 15000 });
    check(/code|tries/i.test(await v.page.getByTestId("details-code-error").innerText()), "a wrong code is refused, in words");
    await v.page.getByLabel("Six-digit code").fill(String((sent?.params as Row).code));
    await v.page.getByTestId("details-question").waitFor({ timeout: 30000 });
    const ask = await text(v.page);
    has("the right code opens the page, and now it knows her", /Hello, Ada[\s\S]*stage of life/i, ask);
    await noOverflow(v.page, "the question on a phone");
    await shot(v.page, "36-link-question");
    await v.page.getByTestId("details-question-yes").click();
    await v.page.getByTestId("details-question-outcome").waitFor({ timeout: 20000 });
    check((await v.page.getByTestId("details-question-outcome").getAttribute("data-outcome")) === "confirmed", "“Yes, that is right” confirms it");
    await v.page.getByTestId("details-next").click();
    await v.page.getByTestId("details-done").waitFor({ timeout: 20000 });
    check(/That is all/.test(await text(v.page)), "and then there is nothing else to check");
    const fact = await one("select value, confirmed_via from public.profile_facts where person_id = $1 and key = 'life_stage'", [ada.id]);
    check(fact?.value === "builders" && fact?.confirmed_via === "details_check", "Ada's stage is recorded as confirmed by her, through the Details check");
    check((await trackOf(adaTribe)) === "builders", "…and nothing about her tribe changed");
    await v.ctx.close();
  }
  await open(adaPage.page, "/my");
  await adaPage.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  has("Ada's My page now shows her stage as confirmed", /Your stage of life is 26 to 40, the Builders stage[\s\S]*You (told us|confirmed) this/, await text(adaPage.page));
  check((await adaPage.page.getByTestId("my-life_stage-change").count()) === 1 && (await adaPage.page.getByTestId("my-life_stage-yes").count()) === 0, "…and offers only “Change it”");
  await open(adaPage.page, "/lead");
  await adaPage.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  check((await adaPage.page.getByTestId("details-strip").count()) === 0, "…and the strip on her Lead page is gone");
  await adaPage.ctx.close();

  // ---- Lanre and Femi: a change that touches members waits for a pastor -----------------------------------------------------------------
  async function askChange(who: { leader: { email: string; id: string } }, token: string, pick: RegExp, name: string) {
    const l = await newPage(browser, "phone");
    await signIn(l.page, who.leader.email, "/lead");
    await open(l.page, `/details/${token}`);
    await l.page.getByTestId("details-question").waitFor({ timeout: 30000 });
    check((await l.page.getByTestId("details-code-ask").count()) === 0, `${name}, signed in as the person the link was made for, is not asked for a code`);
    await l.page.getByTestId("details-question-change").click();
    await l.page.getByTestId("details-question-options").getByText(pick).first().click();
    await l.page.getByTestId("details-question-save").click();
    await l.page.getByTestId("details-question-outcome").waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("details-question-outcome").getAttribute("data-outcome")) === "pending_review", `${name}'s change goes to a pastor, and she is told so`);
    await l.page.getByTestId("details-next").click();
    await l.page.getByTestId("details-done").waitFor({ timeout: 20000 });
    check(/A pastor will look at the change/.test(await text(l.page)), `…and ${name} is told that until then everything stays as it is`);
    await noOverflow(l.page, `${name}'s answer on a phone`);
    return l;
  }
  const lanreSession = await askChange(lanre, tokens.lanre, /Rising/, "Lanre");
  const femiSession = await askChange(femi, tokens.femi, /Sages/, "Femi");
  const lanreChange = (await one("select id, status, old_value, new_value from public.profile_changes where person_id = $1 and key = 'life_stage'", [lanre.leader.id]))!;
  const femiChange = (await one("select id, status from public.profile_changes where person_id = $1 and key = 'life_stage'", [femi.leader.id]))!;
  check(lanreChange.status === "pending" && lanreChange.new_value === "rising" && femiChange.status === "pending", "both changes are waiting for a pastor");
  check((await trackOf(lanre.tribe)) === "stewards" && (await trackOf(femi.tribe)) === "stewards", "…and both tribes are still on the track they were on");
  check((await membersOf(lanre.tribe)) === 2 && (await membersOf(femi.tribe)) === 1, "…and nobody was moved");
  await open(lanreSession.page, "/my");
  await lanreSession.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  check((await lanreSession.page.getByTestId("my-life_stage-pending").count()) === 1 && (await lanreSession.page.getByTestId("my-life_stage-waiting").count()) === 1, "Lanre's My page says her request is waiting, and by when");
  await noOverflow(lanreSession.page, "My page with a waiting request, on a phone");
  await shot(lanreSession.page, "36-my-waiting");

  // The pastor
  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, PASTOR, "/review/stages");
  await open(pastor.page, "/review/stages");
  await pastor.page.getByTestId("stage-reviews").waitFor({ timeout: 20000 });
  check((await pastor.page.getByRole("link", { name: "Stage changes" }).count()) === 1, "the pastor now has a Stage changes tab");
  const lanreCard = pastor.page.getByTestId(`stage-review-${lanreChange.id}`);
  check(/Lanre Seasoned/.test(await lanreCard.innerText()) && /Rising/.test(await lanreCard.innerText()) && /2 members/.test(await lanreCard.innerText()), "the pastor sees who asked, from what to what, and how many members the tribe has");
  await noOverflow(pastor.page, "the stage changes list on a desktop");
  await shot(pastor.page, "36-stage-changes");
  // beside the Tribe Card
  await open(pastor.page, `/review/cards/${lanre.tribe}`);
  const banner = pastor.page.getByTestId("stage-banner");
  if (await banner.count()) {
    check((await pastor.page.getByTestId("stage-pending").count()) === 1 && /not yet confirmed/.test(await banner.innerText()), "beside Lanre's Tribe Card the pastor is told her stage is not yet confirmed and that she asked to change it");
    check(!/Ada|owner|office asked/i.test(await banner.innerText()), "…and not who asked her");
  } else {
    check(false, "the Tribe Card shows the stage banner while the Details check is open");
  }
  await open(pastor.page, "/review/stages");
  await pastor.page.getByTestId(`stage-approve-${lanreChange.id}`).click();
  await eventually("Lanre's change is approved", async () => (await one("select status from public.profile_changes where id = $1", [lanreChange.id]))?.status === "approved");
  check((await trackOf(lanre.tribe)) === "rising", "approved: Lanre's tribe is now on the Rising track");
  check((await membersOf(lanre.tribe)) === 2, "…and nobody was moved");
  await pastor.page.getByTestId(`stage-review-${femiChange.id}`).getByLabel(/note for the leader/i).fill("Keep for this season");
  await pastor.page.getByTestId(`stage-decline-${femiChange.id}`).click();
  await eventually("Femi's change is declined", async () => (await one("select status from public.profile_changes where id = $1", [femiChange.id]))?.status === "declined");
  check((await trackOf(femi.tribe)) === "stewards", "kept as it is: Femi's tribe stays on the Stewards track");
  await pastor.ctx.close();

  // What each leader reads afterwards
  await open(lanreSession.page, "/my");
  await lanreSession.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  check(/A pastor agreed to the change/.test(await text(lanreSession.page)), "Lanre reads that a pastor agreed");
  await open(femiSession.page, "/my");
  await femiSession.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  check((await femiSession.page.getByTestId("my-life_stage-declined").count()) === 1 && /Keep for this season/.test(await femiSession.page.getByTestId("my-life_stage-declined").innerText()), "Femi reads that a pastor kept it as it was, with the pastor's note");
  await lanreSession.ctx.close();

  // Directors read the list; an administrator can too, and neither can decide
  {
    const d = await newPage(browser, "desktop");
    await signIn(d.page, DIRECTOR, "/review/stages");
    await open(d.page, "/review/stages");
    await d.page.getByTestId("stage-reviews").waitFor({ timeout: 20000 });
    check((await d.page.locator('[data-testid^="stage-approve-"]').count()) === 0, "a director reads the list and cannot decide it (nothing is waiting, and the buttons are a pastor's)");
    await d.ctx.close();
  }

  // ---- The Master pause --------------------------------------------------------------------------------------------------------------------
  await open(page, "/god/features");
  await page.getByTestId("features-board").waitFor({ timeout: 20000 });
  await page.getByTestId("master-toggle").click();
  await eventually("everything is paused", async () => (await one("select paused from public.feature_master"))?.paused === true);
  check(/Paused/.test(await page.getByTestId("features-master").innerText()), "the board says everything is paused");
  await open(femiSession.page, "/my");
  check(NOT_FOUND.test(await text(femiSession.page)), "paused: My page acts as if it were Off, at once");
  await open(page, "/god/features");
  await page.getByTestId("master-toggle").click();
  await eventually("everything is resumed", async () => (await one("select paused from public.feature_master"))?.paused === false);
  await open(femiSession.page, "/my");
  await femiSession.page.getByTestId("my-life_stage").waitFor({ timeout: 20000 });
  check(true, "resumed: My page is back as it was");
  await femiSession.ctx.close();

  // ---- The board on a phone ---------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, o.owner.email, "/god");
    await m.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
    await m.page.getByLabel("Passphrase").fill(PHRASE);
    await m.page.getByRole("button", { name: "Unlock" }).click();
    await m.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
    for (const path of ["/god/features", "/god/details"]) {
      await open(m.page, path);
      await m.page.getByTestId(path === "/god/features" ? "features-board" : "details-console").waitFor({ timeout: 20000 });
      await noOverflow(m.page, `${path} on a phone`);
    }
    await open(m.page, "/god/details?run=" + (await one("select id from public.details_checks where mode = 'live' order by created_at desc limit 1"))!.id);
    await m.page.getByTestId("details-run").waitFor({ timeout: 20000 });
    await noOverflow(m.page, "a run's table on a phone");
    await m.ctx.close();
  }

  await ctx.close();
  await browser.close();
  await q.end();
  finish("36-profiles");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

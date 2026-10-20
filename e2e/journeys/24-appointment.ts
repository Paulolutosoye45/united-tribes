/**
 * The owner appoints a leader, end to end. Owner-only: to everyone else the page does not exist.
 *
 *  - An administrator does not find the page. The owner signs in, unlocks, and finds "Appointments" in the console menu.
 *  - The owner searches (two letters at least; never herself), picks Chiamaka, answers five short questions, sees the tribes that
 *    suit her (best fits, and where members are waiting, with the five parts of the match), and appoints her to one.
 *  - Chiamaka has the leader role and a Tribe Card with the goal locked and the three lines from the ready-made card. She is not
 *    certified; nothing is certified for her. The log names no one.
 *  - The pastor opening that Tribe Card is told it was appointed by an administrator, and there is no application behind it.
 *  - Stepping Chiamaka down closes her empty tribe and takes back the role the appointment gave her.
 *  - Funke is appointed too; when members have joined her tribe, stepping her down is refused, in words, and nothing changes.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const PAGE = "/god/appointments";
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
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- What an appointment needs: an approved model, signed-off cards, a season -------------------------------------------------
  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;

  // The owner (journeys share one database, so replace any earlier owner)
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "appoint.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);

  const chiamaka = await adapter.createUser({ email: "chiamaka.eze@example.org" });
  await q.query("update public.people set full_name = 'Chiamaka Eze', preferred_name = 'Chiamaka' where id = $1", [chiamaka.id]);
  const funke = await adapter.createUser({ email: "funke.bello@example.org" });
  await q.query("update public.people set full_name = 'Funke Bello', preferred_name = 'Funke' where id = $1", [funke.id]);
  const busy = await k.tribe(S, { status: "approved", name: "Already led" });

  const browser = await launch();

  // ---- An administrator does not find it -------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "admin.mary@example.org", PAGE);
    await open(page, PAGE);
    check(/We can.t find that page/.test(await text(page)), "to an administrator the appointments page does not exist");
    await ctx.close();
  }

  // ---- The owner ------------------------------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await page.getByRole("link", { name: "Appointments", exact: true }).first().click();
  await page.waitForURL(/\/god\/appointments/, { timeout: 15000 });
  await heading(page, "Appointments").waitFor();
  await page.getByTestId("appoint-board").waitFor({ timeout: 20000 });
  check(true, "the owner finds Appointments in the console menu");
  check(/Nobody has been appointed yet/.test(await text(page)), "nobody has been appointed yet");
  await shot(page, "24-start");
  await noOverflow(page, "the appointments page on a desktop");

  // Find a person
  const search = page.getByLabel("Search for a person");
  await search.fill("c");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(500);
  check((await page.getByRole("button", { name: "Choose", exact: true }).count()) === 0, "one letter finds nobody");
  await search.fill("appoint.owner");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText("Nobody matches").waitFor({ timeout: 10000 });
  check(true, "the owner never finds herself");
  await search.fill(busy.leader.email.slice(0, 12));
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Already leads" }).waitFor({ timeout: 10000 });
  check(await page.getByRole("button", { name: "Already leads" }).isDisabled(), "someone who already leads a tribe cannot be chosen");
  await search.fill("Chiamaka");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Choose", exact: true }).first().click();
  await page.getByTestId("chosen-person").waitFor();
  check((await page.getByTestId("chosen-person").innerText()).includes("Chiamaka Eze"), "the owner chooses Chiamaka");

  // The short fit form: five questions, nothing saved
  const show = page.getByRole("button", { name: "Show me the tribes" });
  check(await show.isDisabled(), "the button waits until the stage of life and how she leads best are answered");
  await page.getByLabel("Stage of life").selectOption("builders");
  await page.getByLabel("How they lead best").selectOption("connection");
  await page.getByLabel("A community they have lived in (optional)").selectOption("professionals");
  await page.getByLabel("A goal they have walked (optional)").selectOption("step-into-a-leadership-role");
  await page.getByLabel("That goal is").selectOption("achieved");
  check(await show.isEnabled(), "…and then asks for the tribes");
  check((await n("select count(*)::int n from public.leader_appointments")) === 0, "nothing is saved yet");
  await show.click();
  const suggestions = page.getByTestId("suggestions");
  await suggestions.waitFor({ timeout: 25000 });
  check(/Model lf-\d/.test(await suggestions.innerText()), "the suggestions say which model made them");
  check((await page.locator('[data-testid^="suggestion-"]').count()) >= 1, "the owner sees the tribes that suit her");
  const sBody = await suggestions.innerText();
  check(/Best fits for them/.test(sBody) && /Where members are waiting/.test(sBody), "…in two lists: best fits, and where members are waiting");
  check(/Calling/.test(sBody) && /Judgement/.test(sBody) && /Need/.test(sBody) && /Stage/.test(sBody) && /Style/.test(sBody), "…each with the five parts of the match, which only the owner sees");
  check((await n("select count(*)::int n from public.leader_appointments")) === 0, "asking is not appointing: still nothing saved");
  await shot(page, "24-suggestions");

  // Pick the first tribe that needs no clearance
  const options = page.locator('[data-testid^="suggestion-"]');
  let chosenTitle = "";
  let chosenGoal = "";
  for (let i = 0; i < (await options.count()); i++) {
    const li = options.nth(i);
    if ((await li.getByText("Needs a pastor’s clearance").count()) === 0) {
      chosenTitle = (await li.locator("p.font-semibold").first().innerText()).trim();
      chosenGoal = ((await li.getAttribute("data-testid")) ?? "").replace("suggestion-", "");
      await li.getByRole("button", { name: "Appoint here" }).click();
      break;
    }
  }
  check(chosenTitle !== "", `she picks a tribe (${chosenTitle})`);
  const confirm = page.getByTestId("appoint-confirm");
  await confirm.waitFor();
  const cBody = await confirm.innerText();
  check(cBody.includes("Chiamaka Eze") && cBody.includes(chosenTitle), "the page asks the owner to confirm, naming the person and the tribe");
  check(/A pastor still approves the card, and the Academy still certifies them/.test(cBody), "…and says a pastor still approves the card and the Academy still certifies");
  check(/The office sees “appointed by an administrator” and no name/.test(cBody), "…and what the office will see");
  await confirm.getByPlaceholder(/asked by the pastor/).fill("Asked by the pastor in October");
  await shot(page, "24-confirm");
  await confirm.getByRole("button", { name: "Yes, appoint" }).click();
  await page.getByTestId("appointed").getByText("Chiamaka Eze").waitFor({ timeout: 20000 });

  // What the appointment did
  const appt = (await one("select id, tribe_id, season_goal_id, granted_role, status, note, appointed_by from public.leader_appointments where person_id = $1", [chiamaka.id]))!;
  check(appt.status === "active" && appt.season_goal_id === chosenGoal && appt.note === "Asked by the pastor in October", "the appointment is recorded for the tribe she was appointed to, with the owner's note");
  check(await q.query("select 1 from public.person_roles where person_id = $1 and role = 'leader'", [chiamaka.id]).then((r) => r.rowCount === 1), "Chiamaka has the leader role");
  check((await one("select granted_by from public.person_roles where person_id = $1 and role = 'leader'", [chiamaka.id]))?.granted_by === null, "…granted with no name on it");
  const tribe = (await one("select status, season_goal_id, fixed, loving_god, loving_others, loving_life, name from public.tribes where id = $1", [appt.tribe_id]))!;
  check(tribe.status === "draft" && tribe.season_goal_id === chosenGoal && (tribe.fixed as string[]).includes("goal"), "her Tribe Card is started, as a draft, with the goal locked");
  check(String(tribe.loving_god).length > 10 && String(tribe.loving_others).length > 10 && String(tribe.loving_life).length > 10, "…and the three lines come from the ready-made card");
  check((await n("select count(*)::int n from public.leader_certifications where person_id = $1", [chiamaka.id])) === 0, "she is not certified, and nothing certifies her");
  check((await n("select count(*)::int n from public.leader_applications where person_id = $1", [chiamaka.id])) === 0, "there is no application behind it");
  check((await n("select count(*)::int n from public.event_log where action = 'leader.appointed' and actor_id is null")) >= 1, "the office's log has the appointment with no name");
  const row = page.getByTestId(`appointment-${appt.id}`);
  const rBody = await row.innerText();
  check(/Active/.test(rBody) && /Not certified yet/.test(rBody) && /Your note: Asked by the pastor in October/.test(rBody), "the owner's list shows her as active, not certified yet, with the note");
  await shot(page, "24-appointed");

  // ---- The pastor opening the card ------------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, "pastor.ife@example.org", `/review/cards/${appt.tribe_id}`);
    await open(p.page, `/review/cards/${appt.tribe_id}`);
    const note = p.page.getByTestId("appointed-note");
    await note.waitFor({ timeout: 20000 });
    const nBody = await note.innerText();
    check(/appointed by an administrator/.test(nBody) && /no application behind this card/i.test(nBody), "the pastor is told the leader was appointed by an administrator, with no application behind the card");
    const all = await text(p.page);
    check(!all.includes("Platform Owner") && !all.includes(owner.email) && !/appoint\.owner/.test(all), "…and the owner is not named anywhere on the page");
    await p.ctx.close();
  }
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, chiamaka.email, "/lead/tribe");
    await open(p.page, "/lead/tribe");
    check(await heading(p.page, "Your Tribe Card").isVisible(), "Chiamaka opens her Tribe Card");
    await noOverflow(p.page, "an appointed leader's Tribe Card on a phone");
    await p.ctx.close();
  }

  // ---- Stepping down ------------------------------------------------------------------------------------------------------------------------
  await row.getByRole("button", { name: "Step down", exact: true }).click();
  const pop = row.locator(".pop-in");
  await pop.waitFor();
  check(/A certificate is never withdrawn/.test(await pop.innerText()), "stepping down asks first, and says a certificate is never withdrawn");
  await pop.getByLabel("Why? (optional)").fill("Changed jobs");
  await pop.getByRole("button", { name: "Yes, step down" }).click();
  await eventually("she has stepped down", async () => (await one("select status from public.leader_appointments where id = $1", [appt.id]))?.status === "stepped_down");
  check(/Stepped down\./.test(await text(page)) && /empty tribe is closed/.test(await text(page)) && /leader role is taken back/.test(await text(page)), "the page says what happened: the empty tribe is closed and the role is taken back");
  check((await one("select status from public.tribes where id = $1", [appt.tribe_id]))?.status === "closed", "her empty tribe is closed");
  check((await n("select count(*)::int n from public.person_roles where person_id = $1 and role = 'leader'", [chiamaka.id])) === 0, "the role the appointment gave her is taken back");
  check((await n("select count(*)::int n from public.leader_certifications where person_id = $1", [chiamaka.id])) === 0, "no certificate was touched");
  check(/Stepped down/.test(await page.getByTestId(`appointment-${appt.id}`).innerText()) && /Changed jobs/.test(await page.getByTestId(`appointment-${appt.id}`).innerText()), "the list shows her as stepped down, with the reason");
  await shot(page, "24-stepped-down");

  // ---- Funke: members have joined, so stepping down is refused -------------------------------------------------------------------------------
  await search.waitFor();
  await search.fill("Funke");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Choose", exact: true }).first().click();
  await page.getByLabel("Stage of life").selectOption("builders");
  await page.getByLabel("How they lead best").selectOption("teaching");
  await page.getByLabel("A community they have lived in (optional)").selectOption("professionals");
  await page.getByLabel("A goal they have walked (optional)").selectOption("step-into-a-leadership-role");
  await page.getByLabel("That goal is").selectOption("achieved");
  await page.getByRole("button", { name: "Show me the tribes" }).click();
  await page.getByTestId("suggestions").waitFor({ timeout: 25000 });
  const second = page.locator('[data-testid^="suggestion-"]');
  let secondPicked = false;
  for (let i = 0; i < (await second.count()); i++) {
    const li = second.nth(i);
    if ((await li.getByText("Needs a pastor’s clearance").count()) === 0) {
      await li.getByRole("button", { name: "Appoint here" }).click();
      secondPicked = true;
      break;
    }
  }
  check(secondPicked, `Funke is offered a tribe that needs no clearance (${secondPicked ? "yes" : (await page.getByTestId("suggestions").innerText()).replace(/\s+/g, " ").slice(0, 300)})`);
  await page.getByTestId("appoint-confirm").getByRole("button", { name: "Yes, appoint" }).click({ timeout: 10000 });
  await eventually("Funke is appointed", async () => (await n("select count(*)::int n from public.leader_appointments where person_id = $1 and status = 'active'", [funke.id])) === 1);
  const fa = (await one("select id, tribe_id from public.leader_appointments where person_id = $1", [funke.id]))!;
  // A member has joined: the card is approved (as a pastor would have done), and someone is seated in it
  await q.query(
    "update public.tribes set status = 'approved', name = 'Funke tribe', story = 'x', meeting_day = 3, meeting_time = '20:00', slot = 'weeknight-evening', meeting_mode = 'in_person', zone = 'mainland' where id = $1",
    [fa.tribe_id],
  );
  await k.seat(fa.tribe_id as string, S, "Joined", { profile: false });
  await open(page, PAGE);
  const frow = page.getByTestId(`appointment-${fa.id}`);
  await frow.waitFor({ timeout: 20000 });
  await frow.getByRole("button", { name: "Step down", exact: true }).click();
  await frow.locator(".pop-in").getByRole("button", { name: "Yes, step down" }).click();
  await eventually("the refusal is shown", async () => /members? (have|has) joined this tribe/.test(await text(page)));
  check(true, "with a member joined, stepping down is refused, in words");
  check((await one("select status from public.leader_appointments where id = $1", [fa.id]))?.status === "active", "…and nothing changes");
  check((await one("select status from public.tribes where id = $1", [fa.tribe_id]))?.status !== "closed", "…the tribe stays open");

  await ctx.close();
  await browser.close();
  await q.end();
  finish("24-appointment");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

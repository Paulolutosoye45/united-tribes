/**
 * Automatic placement, end to end: God Mode plans a run, a member answers from the private link in their email, and the leader sees
 * the team only when they should.
 *
 *  - Placement starts Off: the plan button waits. Rehearsal: a plan is made and walked through, nobody is seated, no email is sent.
 *  - On (after reading what it promises): a new plan; one person is taken out of it; it is approved and the members are seated, each
 *    marked as placed by the church and not yet confirmed. Their emails are queued, the leader's is not.
 *  - Opening a member's private link changes nothing. Then, on a phone and with no sign-in: one member says yes, one asks that her
 *    details are not shared, one gives up the place. A fourth, signed in, says yes from the banner on her tribe page.
 *  - The leader's tribe page: a member who agreed on the form has WhatsApp at once; one who has not agreed has none yet; the one who
 *    held back says so. A day after the last member was told the leader and assistant are emailed the team, and the leader now sees the
 *    number. The run page says the leader has been told, and no longer offers Undo.
 *
 * The things that are only arranged here (members with finished forms, the clock moved on by a day) are arranged in the database
 * the way the database tests do it; everything a person does is done in the browser.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { linkFor, markSent, readyMember } from "../../tests/db/placement-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const PAGE = "/god/placement";
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

async function eventually(label: string, read: () => Promise<boolean>, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
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

  // ---- Arranging: a season that has not started, one tribe with room and a certified assistant, six members ready to be placed ------------
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  await k.moveSeason(S, -30); // starts in 30 days: placement is for members waiting before a season begins
  await q.query("update public.tribes set status = 'closed' where status = 'approved'");
  const A = await k.tribe(S, { capacity: 12, name: "Journey Placement Tribe", assistant: "certified" });

  const adaeze = await readyMember(adapter, k, S, "Adaeze", { daysAgo: 20, whatsapp: "+2348031230001", share: true });
  const bolu = await readyMember(adapter, k, S, "Bolu", { daysAgo: 21, whatsapp: "+2348031230002" });
  const chidi = await readyMember(adapter, k, S, "Chidi", { daysAgo: 22, whatsapp: "+2348031230003" });
  const dami = await readyMember(adapter, k, S, "Dami", { daysAgo: 23, whatsapp: "+2348031230004" });
  const efe = await readyMember(adapter, k, S, "Efe", { daysAgo: 24, whatsapp: "+2348031230005" });
  const folu = await readyMember(adapter, k, S, "Folu", { daysAgo: 25, whatsapp: "+2348031230006" });
  const mine = [adaeze, bolu, chidi, dami, efe, folu].map((p) => p.id);
  // Journeys share one database: set everyone else aside so that the run is only these six
  await q.query("delete from public.placement_holds");
  await q.query("insert into public.placement_holds (person_id, note) select person_id, 'journey' from public.member_profiles where person_id <> all($1::uuid[]) on conflict do nothing", [mine]);
  await q.query("update public.placement_settings set mode = 'off'");

  // The owner (replace any earlier one)
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "placement.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);

  const browser = await launch();

  // ---- An administrator does not find it --------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "admin.mary@example.org", PAGE);
    await open(page, PAGE);
    check(/We can.t find that page/.test(await text(page)), "to an administrator the Placement page does not exist");
    await ctx.close();
  }

  // ---- God Mode ----------------------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await page.getByRole("link", { name: "Placement", exact: true }).first().click();
  await page.waitForURL(/\/god\/placement/, { timeout: 15000 });
  await page.getByTestId("placement-home").waitFor({ timeout: 20000 });
  check(true, "God Mode finds Placement in its menu");
  await noOverflow(page, "the Placement overview on a desktop");

  // Off
  check((await page.getByTestId("mode-off").getAttribute("aria-pressed")) === "true", "Placement starts Off");
  const planButton = page.getByTestId("new-run").getByRole("button", { name: "Plan a run" });
  check(await planButton.isDisabled(), "…and while it is Off no run can be planned");
  check(/Switch to Rehearsal or On first/.test(await text(page)), "…and the page says why");
  const supply = await text(page);
  check(/Members waiting for a tribe/.test(supply) && /Seats open in approved tribes/.test(supply), "the overview says who there is to place and where there is room");
  await shot(page, "30-off");

  // ---- Rehearsal ------------------------------------------------------------------------------------------------------------------------
  await page.getByTestId("mode-rehearsal").click();
  await eventually("the switch is on Rehearsal", async () => (await one("select mode from public.placement_settings"))?.mode === "rehearsal");
  check(/Placement is Rehearsal/.test(await text(page)), "the page says the switch has changed");
  await page.getByTestId("new-run").getByLabel("Emails an hour").fill("50");
  await planButton.click();
  await page.waitForURL(/\/god\/placement\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByTestId("plan-numbers").waitFor({ timeout: 90000 });
  check(/Rehearsal: nobody is seated, nothing is sent/.test(await text(page)), "a rehearsal run says so at the top");
  check((await page.getByTestId("plan-proposed").innerText()).trim() === "6", "the plan places the six members who are ready");
  check(/Tribe by tribe/.test(await text(page)) && (await page.getByTestId("plan-teams").innerText()).includes("Journey Placement Tribe"), "…all in the tribe with room");
  check(/50 emails an hour, 9am to 7pm/.test(await text(page)), "…at the pace asked for");
  await shot(page, "30-rehearsal-plan");
  await page.getByTestId("approve").getByRole("button", { name: /^Walk through/ }).click();
  await page.getByRole("button", { name: "Yes, walk through it" }).click();
  await eventually("the rehearsal is closed", async () => (await one("select status from public.placement_runs order by seq desc limit 1"))?.status === "closed", 60);
  await page.reload();
  await page.getByTestId("run-results").waitFor({ timeout: 20000 });
  check(/What the rehearsal showed/.test(await text(page)) && /Would have been placed/.test(await text(page)), "the rehearsal shows what would have happened");
  check((await n("select count(*)::int n from public.tribe_members where placement_source = 'auto'")) === 0, "…and nobody was seated");
  check((await n("select count(*)::int n from public.messages where template = 'placement_your_tribe' and person_id = any($1::uuid[]) and status <> 'skipped'", [mine])) === 0, "…and no member was emailed");
  check((await n("select count(*)::int n from public.messages where template = 'placement_your_team' and status <> 'skipped'")) === 0, "…and no leader was emailed");
  check((await n("select count(*)::int n from public.messages where template = 'placement_your_tribe' and person_id = any($1::uuid[]) and status = 'skipped'", [mine])) === 6, "…the six emails are in the message log, marked as not sent");
  await shot(page, "30-rehearsal-results");

  // ---- On: read what it promises first ----------------------------------------------------------------------------------------------------
  await page.getByRole("link", { name: /Placement$/ }).first().click();
  await page.getByTestId("placement-home").waitFor();
  check(/Runs so far/.test(await text(page)) && /Rehearsal/.test(await page.getByTestId("past-runs").innerText()), "the rehearsal is listed under runs so far");
  await page.getByTestId("mode-on").click();
  const sure = page.getByTestId("switch-on-confirm");
  await sure.waitFor();
  const promises = await sure.innerText();
  check(/Nobody under 18 is placed/.test(promises) && /undo the whole run until a tribe’s leader has been told/.test(promises), "switching On first says what it promises, including that nobody under 18 is placed");
  check((await one("select mode from public.placement_settings"))?.mode === "rehearsal", "…and nothing changes until it is confirmed");
  await sure.getByRole("button", { name: "Yes, switch it On" }).click();
  await eventually("the switch is On", async () => (await one("select mode from public.placement_settings"))?.mode === "on");

  // ---- A real run ---------------------------------------------------------------------------------------------------------------------------
  await page.getByTestId("new-run").getByLabel("Emails an hour").fill("50");
  await page.getByTestId("new-run").getByRole("button", { name: "Plan a run" }).click();
  await page.waitForURL(/\/god\/placement\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByTestId("plan-numbers").waitFor({ timeout: 90000 });
  const runId = page.url().split("/").pop()!;
  check((await page.getByTestId("plan-proposed").innerText()).trim() === "6", "the new plan has the six members");
  check(!/Rehearsal: nobody is seated/.test(await text(page)), "…and is not a rehearsal");
  check((await n("select count(*)::int n from public.tribe_members where placement_source = 'auto'")) === 0, "reading a plan seats nobody");

  // Take one person out
  await page.getByTestId(`person-${folu.id}`).getByRole("button", { name: "Take out" }).click();
  await eventually("Folu is out of the plan", async () => (await page.getByTestId("plan-proposed").innerText()).trim() === "5");
  await page.getByRole("button", { name: /^Taken out · 1/ }).waitFor({ timeout: 15000 });
  check(true, "a person taken out of the plan is counted and can be found under Taken out");
  // …and look at the other tribes one of them suits
  await page.getByTestId(`person-${efe.id}`).getByRole("button", { name: "Other tribes" }).click();
  await page.getByTestId(`person-${efe.id}`).getByText(/No other tribe fits|Move here/).first().waitFor({ timeout: 15000 });
  check(true, "the other tribes a person suits can be looked at (and she is moved only if the button is pressed)");
  await shot(page, "30-plan");

  const approve = page.getByTestId("approve");
  check(/Nobody under 18 is placed/.test(await approve.innerText()), "the approval says what it promises");
  await approve.getByRole("button", { name: /^Approve \(5\)$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, approve" }).click();
  await eventually("the five are seated", async () => (await n("select count(*)::int n from public.tribe_members where placed_by_run = $1", [runId])) === 5, 90);
  await eventually("the run has finished placing", async () => (await one("select status from public.placement_runs where id = $1", [runId]))?.status === "placed", 90);
  const seats = (await q.query("select person_id, status, placement_source, agreement_version, confirmed_at, tribe_id, contact_withheld from public.tribe_members where placed_by_run = $1", [runId])).rows as Row[];
  check(seats.every((s) => s.status === "active" && s.placement_source === "auto" && s.confirmed_at === null && s.tribe_id === A.tribe), "each is seated in the tribe, marked as placed by the church, and not yet confirmed");
  check(!seats.some((s) => s.person_id === folu.id), "…and the one taken out is not seated");
  check((await n("select count(*)::int n from public.messages where template = 'placement_your_tribe' and person_id = any($1::uuid[]) and status in ('queued','sending','sent')", [mine])) === 5, "five member emails are waiting for their hour");
  check((await n("select count(*)::int n from public.messages where template = 'placement_your_team' and status <> 'skipped'")) === 0, "…and the leader has not been emailed");
  await page.reload();
  await page.getByTestId("run-results").waitFor({ timeout: 20000 });
  const results = await text(page);
  check(/How it is going/.test(results) && /Leaders told: 0\. Still to be told: 1\./.test(results), "the run page says no leader has been told yet");
  check(await page.getByTestId("undo").isVisible(), "…and offers Undo, because no leader has been told");
  await shot(page, "30-results");

  // ---- The members answer, from the private link ---------------------------------------------------------------------------------------------
  const linkOf = async (id: string) => (await linkFor(adapter, id))!;
  const tokens = { adaeze: await linkOf(adaeze.id), bolu: await linkOf(bolu.id), chidi: await linkOf(chidi.id) };
  check(/^[a-f0-9]{64}$/.test(tokens.adaeze), "each member's email carries a private link made by the database");

  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${tokens.adaeze}?a=confirm`);
    check((await heading(m.page, /Adaeze, your tribe/).count()) === 1, "the link opens with no sign-in and greets the member by name");
    const body = await text(m.page);
    check(body.includes("Journey Placement Tribe") && /Led by:/.test(body) && /Meets:/.test(body), "…names the tribe, its leader and when it meets");
    check(/Yes, I.m in/.test(body) && /Show me other tribes/.test(body) && /Don.t share my details/.test(body), "…offers the three answers");
    check(!body.includes(owner.email) && !/Platform Owner/.test(body), "…and does not name the owner");
    await noOverflow(m.page, "the private page on a phone");
    await shot(m.page, "30-private-page");
    check((await one("select confirmed_at from public.tribe_members where person_id = $1 and placed_by_run = $2", [adaeze.id, runId]))?.confirmed_at === null, "opening the link changes nothing");
    await m.page.getByRole("button", { name: /Yes, I.m in/ }).click();
    await m.page.getByText(/Thank you\. You are in/).waitFor({ timeout: 15000 });
    check((await one("select confirmed_at from public.tribe_members where person_id = $1 and placed_by_run = $2", [adaeze.id, runId]))?.confirmed_at !== null, "pressing Yes confirms the seat");
    await m.ctx.close();
  }
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${tokens.bolu}?a=withhold`);
    await m.page.getByRole("button", { name: /Don.t share my details/ }).click();
    await m.page.getByText(/Your leader will not be given your email or your WhatsApp number/).first().waitFor({ timeout: 15000 });
    check((await one("select contact_withheld from public.tribe_members where person_id = $1 and placed_by_run = $2", [bolu.id, runId]))?.contact_withheld === true, "pressing Don’t share my details is recorded");
    check((await n("select count(*)::int n from public.consents where person_id = $1 and purpose = 'team_contact' and granted = false", [bolu.id])) === 1, "…as a refusal that stays on her record");
    await m.ctx.close();
  }
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${tokens.chidi}?a=change`);
    await m.page.getByRole("button", { name: /Show me other tribes/ }).click();
    await m.page.getByText(/You have given up that place/).waitFor({ timeout: 15000 });
    check((await n("select count(*)::int n from public.tribe_members where person_id = $1 and status = 'active'", [chidi.id])) === 0, "pressing Show me other tribes gives the seat up");
    await m.ctx.close();
    // …and the same link now says so
    const again = await newPage(browser, "phone");
    await open(again.page, `/placed/${tokens.chidi}`);
    check(/not in this tribe now|isn.t valid/.test(await text(again.page)), "…and the link no longer opens the tribe");
    await again.ctx.close();
  }
  {
    // A made-up link, and a link with a letter wrong
    const bad = await newPage(browser, "phone");
    await open(bad.page, `/placed/${"a".repeat(64)}`);
    check(/This link isn.t valid/.test(await text(bad.page)), "a link that was never made says it is not valid");
    await open(bad.page, "/placed/not-a-link");
    check(/This link isn.t valid/.test(await text(bad.page)), "…and so does one that is not even the right shape");
    await bad.ctx.close();
  }
  {
    // Dami is signed in, and answers from the banner on her tribe page
    const m = await newPage(browser, "phone");
    await signIn(m.page, dami.email, "/tribe");
    await open(m.page, "/tribe");
    const banner = m.page.getByTestId("placed-banner");
    await banner.waitFor({ timeout: 20000 });
    check(/The church placed you in Journey Placement Tribe/.test(await banner.innerText()), "a placed member who signs in sees it above her tribe");
    await noOverflow(m.page, "the placed banner on a phone");
    await banner.getByRole("button", { name: /Yes, I.m in/ }).click();
    await m.page.getByText(/Thank you\. You are in/).first().waitFor({ timeout: 15000 });
    check((await one("select confirmed_at from public.tribe_members where person_id = $1 and placed_by_run = $2", [dami.id, runId]))?.confirmed_at !== null, "saying yes there confirms the seat too");
    await m.ctx.close();
  }

  // ---- The leader, before they have been told --------------------------------------------------------------------------------------------------
  const memberRow = (p: Page, name: string) => p.getByRole("listitem").filter({ hasText: name }).first();
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByText("No one has joined yet").waitFor({ timeout: 20000 });
    const all = await text(l.page);
    check(!/Adaeze|Bolu|Dami|Efe/.test(all), "until the leader has been told, the members the church placed are not on their page (they have had no chance to hold back yet)");
    check(!all.includes("8031230001") && !all.includes("8031230002") && !all.includes("8031230004") && !all.includes("8031230005"), "…nor anyone’s number");
    await shot(l.page, "30-leader-before");
    await l.ctx.close();
  }

  // ---- A day after the last member was told ------------------------------------------------------------------------------------------------------
  await markSent(adapter, 26);
  const told = Number((await one("select public.placement_team_mail($1) as r", [runId]))?.r ?? 0);
  check(told === 1, "a day after the last member was told, the tribe’s leader is told");
  const team = (await q.query("select person_id, params, force_channel from public.messages where template = 'placement_your_team' and status <> 'skipped' order by created_at")).rows as Row[];
  check(team.length === 2 && team.every((m) => m.force_channel === "email") && [A.leader.id, A.assistant!.id].every((id) => team.some((m) => m.person_id === id)), "…and so is the assistant, both by email");
  const listed = ((team[0].params as { members?: Row[] }).members ?? []).map((m) => `${m.name}${m.withheld ? " (withheld)" : ""}`).sort();
  check(listed.length === 4 && listed.some((s) => s.startsWith("Bolu") && s.endsWith("(withheld)")) && !listed.some((s) => s.startsWith("Chidi") || s.startsWith("Folu")), `the team lists the four who stayed, with Bolu’s details withheld (${listed.join(", ")})`);
  const bolusEntry = ((team[0].params as { members?: Row[] }).members ?? []).find((m) => String(m.name).startsWith("Bolu"));
  check(bolusEntry && !bolusEntry.email && !bolusEntry.whatsapp, "…with no email or number for her");
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByText("Dami Test").first().waitFor({ timeout: 20000 });
    const all = await text(l.page);
    check(/Placed by the church · said yes/.test(all) && /Placed by the church · yet to answer/.test(all), "once the leader has been told, the page lists who the church placed and who has said yes");
    check(!all.includes("Chidi Test") && !all.includes("Folu Test"), "…and not the one who gave the place up, nor the one taken out");
    for (const who of ["Adaeze Test", "Dami Test", "Efe Test"]) {
      check((await memberRow(l.page, who).getByRole("link", { name: "Message on WhatsApp" }).count()) === 1, `…${who.split(" ")[0]} can be messaged on WhatsApp, as the "Your team" email said`);
    }
    check((await memberRow(l.page, "Bolu Test").getByRole("link", { name: "Message on WhatsApp" }).count()) === 0, "…but the member who held back cannot");
    check(/asked that their number is not shared/.test(await memberRow(l.page, "Bolu Test").innerText()) && !all.includes("8031230002"), "…and the page says she asked, with no number");
    await shot(l.page, "30-leader-after");
    await l.ctx.close();
  }
  await open(page, `${PAGE}/${runId}`);
  await page.getByTestId("run-results").waitFor({ timeout: 20000 });
  const after = await text(page);
  check(/Leaders told: 1\. Still to be told: 0\./.test(after), "the run page says the leader has been told");
  check((await page.getByTestId("undo").count()) === 0, "…and no longer offers Undo");
  check(/2\s+Said yes/.test(after) && /1\s+Chose to look elsewhere/.test(after) && /1\s+Kept their details private/.test(after), "…and counts who said yes, who looked elsewhere and who kept their details private");
  await shot(page, "30-after");

  await ctx.close();
  await browser.close();
  await q.end();
  finish("30-placement");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

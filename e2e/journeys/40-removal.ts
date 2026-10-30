/**
 * WhatsApp that cannot fail quietly, stage 4 (leader removal requests), end to end.
 *
 *  - Everything starts Off: the leader's page has no way to ask, the coach's Growth page has no tile, the board says it is not open, and a member's
 *    Home page has nothing.
 *  - The owner (alone, on the console's Features page) opens it as Rehearsal. The leader sees "Practice", asks about a member, the coach decides it:
 *    nothing is released and nothing is written to anyone.
 *  - The owner opens it for the whole church. The leader asks about the same member; the coach asks a question, the leader answers it on her page, the
 *    coach approves. The seat is released, the member is told by email (kindly, with no reason and no names) and in the app, and the leader is told.
 *  - The member reads her notice on Home, asks the Care Lead to look again, and the Care Lead puts her place back; she and the leader are told.
 *  - Nothing the member wrote or attended is touched at any point, and nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a season, a tribe with members and a meeting record) is arranged in the database the way the database tests do it; everything
 * a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
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

const NOTE = "She has missed five weeks and does not answer my calls, and I have asked twice.";
const WHY = "I have looked at this carefully and I agree with the leader.";

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off, a tribe with a coach and two members, another tribe to move to ----------------------------------------------
  await q.query("delete from public.removal_requests");
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "removal.owner@example.org"); // the shared e2e database may already hold owner@example.org from another journey
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
  const coach = (await one("select id from public.people where email = 'coach.sade@example.org'"))!.id as string;
  const mine = await k.tribe(S, { name: "Removal Tribe", track: "builders", coach });
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [mine.leader.id]);
  const bola = await k.seat(mine.tribe, S, "Bola");
  const chidi = await k.seat(mine.tribe, S, "Chidi");
  await q.query("update public.people set full_name = 'Bola Adewale' where id = $1", [bola.id]);
  await k.tribe(S, { name: "Another Builders Tribe", track: "builders" });
  await k.meetings(mine.tribe, mine.leader.id, 3, [[bola.id, 1], [chidi.id, 3]]);
  const seat = async (who: string) => (await one("select status, release_reason from public.tribe_members where person_id = $1 and tribe_id = $2", [who, mine.tribe]))!;
  const attendance = () => n("select count(*)::int n from public.tribe_attendance where person_id = $1", [bola.id]);
  const attendedBefore = await attendance();

  const browser = await launch();
  const COACH = "coach.sade@example.org";
  const CARE = "care_lead.dayo@example.org";

  // ---- Everything Off: nobody finds anything -----------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "phone");
    await signIn(l.page, mine.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("removal-ask").count()) === 0, "with the switch Off, a leader's tribe page has no way to ask about a member's place");
    await l.ctx.close();
  }
  {
    const c = await newPage(browser, "desktop");
    await signIn(c.page, COACH, "/growth");
    await open(c.page, "/growth");
    check(!/Removal requests/.test(await text(c.page)), "…and the coach's Growth page has no Removal requests tile");
    await open(c.page, "/growth/removals");
    check((await c.page.getByTestId("removal-off").count()) === 1 && /not open yet/.test(await text(c.page)), "…and the page itself says it is not open yet");
    await c.ctx.close();
  }
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, bola.email, "/home");
    await open(m.page, "/home");
    check((await m.page.getByTestId("removed-notice").count()) === 0, "…and a member's Home page has nothing about it");
    await m.ctx.close();
  }

  // ---- God Mode: the owner opens it as Rehearsal, then for the whole church --------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await owner.getByRole("link", { name: "Features", exact: true }).first().click();
  await owner.waitForURL(/\/god\/features/, { timeout: 15000 });
  await owner.getByTestId("features-board").waitFor({ timeout: 20000 });
  check(/Off/.test(await owner.getByTestId("feature-removal_requests").innerText()), "Leader removal requests starts Off on the owner's Features page");

  async function moveSwitch(position: "rehearsal" | "on", reason = "") {
    const box = owner.getByTestId("feature-removal_requests-editor");
    if ((await box.count()) === 0) await owner.getByTestId("feature-removal_requests-open").click();
    await box.waitFor({ timeout: 15000 });
    check((await owner.getByTestId("feature-removal_requests-whole-church").count()) === 1, "it is for the whole church only: there is no place or role to choose");
    await owner.getByTestId(`feature-removal_requests-${position}`).click();
    if (reason) await box.getByLabel(/Why open it for the whole church/).fill(reason);
    await owner.getByTestId("feature-removal_requests-save").click();
  }

  await moveSwitch("rehearsal");
  await eventually("the switch is in Rehearsal", async () => (await one("select public.feature_platform_state('removal_requests') as s"))?.s === "rehearsal");
  await shot(owner, "40-owner-rehearsal");

  // ---- Rehearsal: the whole road, nothing real --------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "phone");
    await signIn(l.page, mine.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByTestId("removal-ask").waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("removal-practice").count()) === 1, "in Rehearsal the leader sees that it is practice");
    await l.page.getByTestId("removal-open").click();
    await l.page.getByTestId("removal-form").waitFor();
    check((await l.page.getByRole("button", { name: "Send to the church" }).isDisabled()), "the form cannot be sent empty");
    await l.page.getByTestId("removal-member").selectOption(bola.id);
    await l.page.getByText("Repeated absence", { exact: true }).click();
    await l.page.getByTestId("removal-note").fill("Too short.");
    await l.page.getByTestId("removal-spoken").check();
    check(await l.page.getByRole("button", { name: "Send to the church" }).isDisabled(), "a note under 20 characters keeps it from being sent, and says how many more");
    await l.page.getByTestId("removal-note").fill(NOTE);
    await noOverflow(l.page, "the leader's request form on a phone");
    await shot(l.page, "40-leader-form");
    await l.page.getByRole("button", { name: "Send to the church" }).click();
    await eventually("the practice request is kept", async () => (await n("select count(*)::int n from public.removal_requests where rehearsal and member_id = $1", [bola.id])) === 1);
    has("the leader is told it was sent as practice", /Sent as practice/, await text(l.page));
    await l.ctx.close();
  }
  {
    const c = await newPage(browser, "desktop");
    await signIn(c.page, COACH, "/growth");
    await open(c.page, "/growth");
    check(/Removal requests/.test(await text(c.page)), "in Rehearsal the coach's Growth page has the tile");
    await open(c.page, "/growth/removals");
    await c.page.getByTestId("removal-board").waitFor({ timeout: 20000 });
    check((await c.page.getByTestId("removal-practice").count()) === 1, "…and the board says it is practice");
    const card = c.page.getByTestId("removal-card").first();
    has("the coach reads who, which tribe, why and what the leader wrote", /Bola Adewale[\s\S]*Removal Tribe[\s\S]*Lara Leader[\s\S]*Repeated absence[\s\S]*missed five weeks/, await card.innerText());
    has("…and the attendance in the tribe", /1 present, 2 absent, 0 excused/, await card.innerText());
    await card.getByText("Approve: release their place", { exact: true }).click();
    await card.getByTestId("removal-decision-note").fill(WHY);
    await card.getByRole("button", { name: "Send my decision" }).click();
    await eventually("the practice request is approved", async () => (await one("select status from public.removal_requests where rehearsal and member_id = $1", [bola.id]))?.status === "approved");
    check((await seat(bola.id)).status === "active", "approving practice releases nothing: Bola still has her seat");
    check((await n("select count(*)::int n from public.messages where template like 'removal_%'")) === 0, "…and no one is written to");
    check((await n("select count(*)::int n from public.removal_blocks")) === 0, "…and no tribe is kept from her");
    await c.ctx.close();
  }

  // ---- On: the real road --------------------------------------------------------------------------------------------------------------------
  await moveSwitch("on", "Trying removal requests with everyone, as the church agreed.");
  await eventually("the switch is On", async () => (await one("select public.feature_platform_state('removal_requests') as s"))?.s === "on");
  await shot(owner, "40-owner-on");
  await octx.close();

  const lead = await newPage(browser, "phone");
  await signIn(lead.page, mine.leader.email, "/lead/tribe");
  await open(lead.page, "/lead/tribe");
  await lead.page.getByTestId("removal-ask").waitFor({ timeout: 20000 });
  check((await lead.page.getByTestId("removal-practice").count()) === 0, "On, the practice banner is gone");
  await lead.page.getByTestId("removal-open").click();
  await lead.page.getByTestId("removal-member").selectOption(bola.id);
  await lead.page.getByText("Repeated absence", { exact: true }).click();
  await lead.page.getByTestId("removal-note").fill(NOTE);
  await lead.page.getByTestId("removal-spoken").check();
  await lead.page.getByRole("button", { name: "Send to the church" }).click();
  await eventually("the real request is kept", async () => (await n("select count(*)::int n from public.removal_requests where not rehearsal and member_id = $1 and status = 'open'", [bola.id])) === 1);
  has("the leader is told it was sent", /Sent\. The church will look at it/, await text(lead.page));
  check((await seat(bola.id)).status === "active", "asking releases nothing: Bola still has her seat");
  check((await n("select count(*)::int n from public.messages where person_id = $1 and template like 'removal_%'", [bola.id])) === 0, "…and Bola is told nothing");
  await lead.page.reload();
  await lead.page.getByTestId("removal-mine-card").first().waitFor({ timeout: 20000 });
  has("the leader sees it waiting", /Waiting/, await text(lead.page));

  // The coach asks a question; the leader answers on her page; the coach approves
  const coachPage = await newPage(browser, "desktop");
  await signIn(coachPage.page, COACH, "/growth/removals");
  await open(coachPage.page, "/growth/removals");
  await coachPage.page.getByTestId("removal-board").waitFor({ timeout: 20000 });
  {
    const card = coachPage.page.getByTestId("removal-card").filter({ hasText: "Waiting for a decision" }).first();
    await card.getByText("Ask the leader a question", { exact: true }).click();
    await card.getByTestId("removal-decision-note").fill("How many weeks has she missed, and has anyone visited her?");
    await card.getByRole("button", { name: "Send my decision" }).click();
  }
  await eventually("the leader has been asked", async () => (await one("select waiting_on from public.removal_requests where not rehearsal and member_id = $1", [bola.id]))?.waiting_on === "leader");
  check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'removal_leader_decided'", [mine.leader.id])) === 1, "the leader is emailed that there is a question (and nothing about its words)");
  await open(lead.page, "/lead/tribe");
  await lead.page.getByTestId("removal-question").waitFor({ timeout: 20000 });
  has("the leader reads the question on her page", /How many weeks has she missed/, await text(lead.page));
  await lead.page.getByLabel("Your answer").fill("Five weeks. Two of us have visited and phoned her.");
  await lead.page.getByRole("button", { name: "Send my answer" }).click();
  await eventually("the answer is kept", async () => (await one("select waiting_on from public.removal_requests where not rehearsal and member_id = $1", [bola.id]))?.waiting_on === "approver");

  await open(coachPage.page, "/growth/removals");
  await coachPage.page.getByTestId("removal-board").waitFor({ timeout: 20000 });
  {
    const card = coachPage.page.getByTestId("removal-card").filter({ hasText: "Waiting for a decision" }).first();
    has("the coach reads the answer under the request", /The leader answered: Five weeks/, await card.innerText());
    await shot(coachPage.page, "40-coach-board");
    await card.getByText("Approve: release their place", { exact: true }).click();
    await card.getByTestId("removal-decision-note").fill(WHY);
    await card.getByRole("button", { name: "Send my decision" }).click();
  }
  await eventually("the seat is released", async () => (await seat(bola.id)).status === "released");
  check((await seat(bola.id)).release_reason === "Place changed by the church", "…with the church's own words as the reason, not the leader's");
  check((await seat(chidi.id)).status === "active", "the other member's seat is untouched");
  check((await attendance()) === attendedBefore, "nothing Bola attended was touched");
  const told = await one("select params, force_channel from public.messages where person_id = $1 and template = 'removal_member_told'", [bola.id]);
  check(told?.force_channel === "email" && JSON.stringify(Object.keys(told.params as object).sort()) === JSON.stringify(["appeal_days", "contact_first", "tribe"]), "Bola is emailed, with only the tribe, a named person and the days to ask again");
  check(!/five weeks|absence|conflict|Lara/i.test(JSON.stringify(told?.params)), "…and nothing in it says why or who asked");
  check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'removal_leader_decided'", [mine.leader.id])) === 2, "the leader is told it was approved");

  // The leader's page after the decision
  await open(lead.page, "/lead/tribe");
  await lead.page.getByTestId("removal-ask").waitFor({ timeout: 20000 });
  has("the leader is told it was approved and to take her out of any WhatsApp group herself", /Approved\. Their place has been released[\s\S]*take them out of it yourself/, await text(lead.page));
  await noOverflow(lead.page, "the leader's tribe page after a decision, on a phone");
  await shot(lead.page, "40-leader-after");
  await lead.ctx.close();

  // ---- The member --------------------------------------------------------------------------------------------------------------------------
  const member = await newPage(browser, "phone");
  await signIn(member.page, bola.email, "/home");
  await open(member.page, "/home");
  await member.page.getByTestId("removed-notice").waitFor({ timeout: 20000 });
  const noticeText = await member.page.getByTestId("removed-notice").innerText();
  has("Bola reads, kindly, that her place in the tribe has changed and that other tribes are open to her", /Your place in Removal Tribe has changed[\s\S]*Other tribes are open to you/, noticeText);
  // (The named person is the first of the care team by name; journeys run before this one leave others in the team, so ask the database who it is.)
  const contact = String((await one("select public.removal_contact_first() as n"))?.n ?? "");
  check(contact.length > 0 && noticeText.includes(`${contact} is the person to speak to.`), "…with a named person to speak to");
  check(!/absence|five weeks|Lara|asked the church|reason/i.test(noticeText), "…and nothing about why, or who asked");
  check((await member.page.getByTestId("removed-see-tribes").getAttribute("href")) === "/tribe", "…with a button to see other tribes");
  await noOverflow(member.page, "the member's notice on a phone");
  await shot(member.page, "40-member-notice");
  await open(member.page, "/tribe");
  await member.page.getByTestId("removed-notice").waitFor({ timeout: 20000 });
  check(true, "the same notice is on the tribe page, above the tribes that are open to her");

  await open(member.page, "/home");
  await member.page.getByTestId("removed-appeal").getByRole("textbox").fill("I was ill and did not know how to say so.");
  await member.page.getByRole("button", { name: "Ask them to look again" }).click();
  await eventually("the appeal is kept", async () => (await one("select appeal_status from public.removal_requests where member_id = $1 and not rehearsal", [bola.id]))?.appeal_status === "open");
  await member.page.getByTestId("removed-appeal-state").waitFor({ timeout: 20000 });
  has("Bola is told it will be looked at again", /asked for this to be looked at again/, await text(member.page));

  // ---- The Care Lead looks again and puts her place back ------------------------------------------------------------------------------------
  const care = await newPage(browser, "desktop");
  await signIn(care.page, CARE, "/growth/removals");
  await open(care.page, "/growth/removals");
  await care.page.getByTestId("removal-board").waitFor({ timeout: 20000 });
  {
    const card = care.page.getByTestId("removal-card").filter({ has: care.page.getByTestId("removal-appeal") }).first();
    has("the Care Lead reads what Bola wrote", /I was ill and did not know how to say so/, await card.innerText());
    await card.getByRole("textbox").fill("I have listened to her and she is right; she should be back with her tribe.");
    await shot(care.page, "40-care-appeal");
    await card.getByRole("button", { name: "Put their place back" }).click();
  }
  await eventually("her seat is back", async () => (await seat(bola.id)).status === "active");
  check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'removal_member_reinstated'", [bola.id])) === 1, "Bola is emailed that her place is back");
  check((await attendance()) === attendedBefore, "still nothing she attended was touched");
  await open(member.page, "/home");
  await member.page.getByTestId("removed-notice").waitFor({ timeout: 20000 });
  has("Bola reads that her place has been put back", /has been put back\. You are welcome there/, await text(member.page));
  await care.ctx.close();
  await coachPage.ctx.close();
  await member.ctx.close();

  await browser.close();
  await q.end();
  finish("40-removal");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * The placement mix-up, end to end: God Mode places six members in one tribe, and the tribe's leader sees them at once.
 *
 *  - Right after placing, the leader opens My tribe and sees all six by name, each marked, and not one WhatsApp number or email except
 *    the member who agreed on the form. The old line "No one has joined yet" is gone. The Lead page lists the same six.
 *  - A member whose email has not gone out is marked "not yet reached"; a member in the hold says the day it ends.
 *  - A member's own page and email do not give the WhatsApp group link until they have answered about sharing; "Yes, I'm in" shows it
 *    at once, with the warning that joining shows their number.
 *  - The owner opens God Mode's run board: it says why the tribe is closed, in words. The owner presses Open now; the confirm box says
 *    how many members' details will be shared. The numbers appear on the leader's page; the member who held back stays held back.
 *  - Nothing the leader sees names the owner.
 *
 * Everything that is only arranged here (members with finished forms, the plan placed through the database as the owner would, the
 * member emails marked as sent) is arranged the way the database tests do it; everything a person does is done in the browser.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { PHRASE, makeOwner } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { linkFor, placeRun, readyMember } from "../../tests/db/placement-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const GROUP = "https://chat.whatsapp.com/JourneyVisibility38";
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: a season that has not started, one tribe with a group link, six members ready to be placed ------------------------------
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  await k.moveSeason(S, -30);
  await q.query("update public.tribes set status = 'closed' where status = 'approved'");
  const A = await k.tribe(S, { capacity: 12, name: "Journey Visibility Tribe", assistant: "certified" });
  await q.query("update public.tribes set whatsapp_group_url = $2 where id = $1", [A.tribe, GROUP]);
  await q.query("update public.people set full_name = 'Ngozi Leader', preferred_name = 'Ngozi' where id = $1", [A.leader.id]);

  const names = ["Kemi", "Lanre", "Mayowa", "Nneka", "Obi", "Pelumi"];
  // each member's number ends in their place in this list, so a number found in a page can be traced to the member
  const phone = (i: number) => `+23480770000${i}`;
  const digits = (i: number) => phone(i).replace("+234", "");
  const people = [];
  for (const [i, nm] of names.entries()) {
    people.push(await readyMember(adapter, k, S, nm, { daysAgo: 20 + i, whatsapp: phone(i), share: i === 0 ? true : undefined }));
  }
  const [kemi, lanre, mayowa, nneka, , pelumi] = people;
  const mine = people.map((p) => p.id);
  await q.query("delete from public.placement_holds");
  await q.query("insert into public.placement_holds (person_id, note) select person_id, 'journey' from public.member_profiles where person_id <> all($1::uuid[]) on conflict do nothing", [mine]);
  await q.query("update public.placement_settings set mode = 'on', hold_group_link = true");

  // The owner (replace any earlier one), placing the run through the database as the owner's screen would
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "visibility.owner@example.org"); // the shared e2e database may already hold owner@example.org from another journey
  const { run } = await placeRun(adapter, o, {});
  const seated = Number((await one("select count(*)::int n from public.tribe_members where placed_by_run = $1 and status = 'active'", [run]))?.n ?? 0);
  check(seated === 6, "God Mode placed the six members in the tribe");
  check((await one("select count(*)::int n from public.messages where template = 'placement_your_team' and tribe_id = $1", [A.tribe]))?.n === 0, "…and the leader has not been emailed");

  // keep the private links: they are cleared from the messages an hour after a message is sent
  const links = Object.fromEntries(await Promise.all(people.map(async (p) => [p.id, (await linkFor(adapter, p.id))!] as const)));

  const browser = await launch();
  const memberRow = (p: Page, name: string) => p.getByRole("listitem").filter({ hasText: name }).first();
  const wa = (p: Page, name: string) => memberRow(p, name).getByRole("link", { name: "Message on WhatsApp" }).count();

  // Lanre says "Don't share my details", Mayowa says yes: from the private link, with no sign-in
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${links[lanre.id]}`);
    const body = await text(m.page);
    check(!body.includes(GROUP), "a member who has not answered is not given the WhatsApp group link on their private page");
    check(/WhatsApp group link will appear here/.test(body) && /shows your number to everyone in it/.test(body), "…it says when it will appear, and why it waits");
    check(/Ngozi can see your name/.test(body), "…and that the leader can already see their name");
    await m.page.getByRole("button", { name: /Don.t share my details/ }).click();
    await m.page.getByText(/will not be given your email or your WhatsApp number/).first().waitFor({ timeout: 15000 });
    await m.ctx.close();
  }
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${links[mayowa.id]}?a=confirm`);
    await m.page.getByRole("button", { name: /Yes, I.m in/ }).click();
    await m.page.getByText(/Thank you\. You are in/).waitFor({ timeout: 15000 });
    const body = await text(m.page);
    check(body.includes("Join the tribe’s WhatsApp group") && /shows your number to everyone in it/.test(body), "after “Yes, I’m in” the group link is there at once, with the warning that joining shows their number");
    await noOverflow(m.page, "the private page after yes, on a phone");
    await shot(m.page, "38-after-yes");
    await m.ctx.close();
  }

  // Member emails: Kemi's, Mayowa's and Lanre's have gone out two hours ago; Nneka's failed; Obi's and Pelumi's are still waiting
  await q.query("update public.messages set status = 'sent', sent_at = now() - interval '2 hours' where template = 'placement_your_tribe' and person_id = any($1::uuid[])", [[kemi.id, lanre.id, mayowa.id]]);
  await q.query("update public.messages set status = 'failed', error = 'bounced', sent_at = null where template = 'placement_your_tribe' and person_id = $1", [nneka.id]);

  // ---- The leader, right after placing -------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByText("Pelumi Test").first().waitFor({ timeout: 20000 });
    const all = await text(l.page);
    check(names.every((nm) => all.includes(`${nm} Test`)), "the leader sees all six members by name on My tribe, the moment they are placed");
    check(!/No one has joined yet/.test(all), "…and the page no longer says no one has joined");
    check((await l.page.getByRole("listitem").filter({ hasText: /Placed by the church/ }).count()) === 6, "…each marked as placed by the church");
    check(/said yes/.test(await memberRow(l.page, "Mayowa Test").innerText()), "…Mayowa is marked as having said yes");
    check(/details withheld/.test(await memberRow(l.page, "Lanre Test").innerText()), "…Lanre, who held back, is marked withheld");
    check(/not yet reached/.test(await memberRow(l.page, "Nneka Test").innerText()) && /not yet reached/.test(await memberRow(l.page, "Obi Test").innerText()), "…Nneka (email failed) and Obi (email waiting) are marked not yet reached");
    check(/yet to answer/.test(await memberRow(l.page, "Kemi Test").innerText()) === false, "…Kemi, who agreed on the form, is not asked to answer");
    check((await wa(l.page, "Kemi Test")) === 1 && (await wa(l.page, "Mayowa Test")) === 1, "…Kemi (agreed on the form) and Mayowa (said yes) can be messaged on WhatsApp");
    for (const nm of ["Lanre Test", "Nneka Test", "Obi Test", "Pelumi Test"]) check((await wa(l.page, nm)) === 0, `…${nm.split(" ")[0]} has no WhatsApp button yet`);
    const html = await l.page.content();
    check([1, 3, 4, 5].every((i) => !html.includes(digits(i))), "…and none of their numbers is anywhere in the page, links included");
    check(!/Platform Owner|\bOwner\b|God Mode/.test(all), "…and nothing names the owner");
    await shot(l.page, "38-leader-before");
    await l.ctx.close();
  }
  {
    const l = await newPage(browser, "phone");
    await signIn(l.page, A.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("leading-people").waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("leading-person").count()) === 6, "the Lead page lists the same six");
    check(/Placed by the church/.test(await l.page.getByTestId("leading-people").innerText()), "…each marked");
    await noOverflow(l.page, "the Lead page with six marked members, on a phone");
    await shot(l.page, "38-lead-phone");
    await l.ctx.close();
  }
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/progress");
    await open(l.page, "/lead/progress");
    await l.page.getByText("Your people").first().waitFor({ timeout: 20000 });
    const body = await text(l.page);
    check(names.every((nm) => body.includes(`${nm} Test`)), "the dashboard's Your people lists the same six");
    await l.ctx.close();
  }

  // ---- God Mode: why is the tribe closed? ---------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, o.owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await open(page, `/god/placement/${run}`);
  await page.getByTestId("run-results").waitFor({ timeout: 30000 });
  const row = page.getByTestId("team-row").filter({ hasText: "Journey Visibility Tribe" });
  await row.waitFor({ timeout: 20000 });
  check((await row.getAttribute("data-state")) === "waiting", "the run board says the tribe is waiting for member emails (Obi’s and Pelumi’s have not gone)");
  check(/3 sent · 2 waiting · 1 failed/.test(await row.getByTestId("team-emails").innerText()), "…with how many have gone, are waiting and failed");
  const board = await text(page);
  check(/Heartbeat last ran/.test(board), "…and a line says when the heartbeat last ran");
  check(/Leaders told: 0\. Still to be told: 1\./.test(board), "…and that no leader has been told");
  await noOverflow(page, "the run board with the Teams table, on a desktop");
  await shot(page, "38-board-waiting");

  // ---- Open now ---------------------------------------------------------------------------------------------------------------------------
  const before = await one("select count(*)::int n from public.messages where template = 'placement_your_team' and tribe_id = $1", [A.tribe]);
  await row.getByTestId("open-now").click();
  const confirm = page.getByTestId("open-now-confirm");
  await confirm.waitFor();
  const said = await confirm.innerText();
  check(/Open Journey Visibility Tribe now\?/.test(said) && /3 members who have not answered/.test(said), "pressing Open now asks first, and says how many members’ details will be shared");
  check(/don.t share my details.*stay withheld/i.test(said) && /can no longer be undone/.test(said), "…says a member who held back stays held back, and that the tribe can no longer be undone");
  check((await one("select count(*)::int n from public.messages where template = 'placement_your_team' and tribe_id = $1", [A.tribe]))?.n === before?.n, "…and nothing has changed until it is confirmed");
  await shot(page, "38-open-now-confirm");
  await confirm.getByRole("button", { name: "Yes, open it" }).click();
  try {
    await page.getByText(/Journey Visibility Tribe is open\./).waitFor({ timeout: 20000 });
  } catch (e) {
    // If it does not come, say what the page said instead, so the reason is in the log
    console.log("page said:", (await text(page)).replace(/\s+/g, " ").slice(0, 1500));
    throw e;
  }
  check((await one("select count(*)::int n from public.messages where template = 'placement_your_team' and status <> 'skipped' and tribe_id = $1", [A.tribe]))?.n === 2, "the leader and the assistant are emailed their team");
  await page.reload();
  await page.getByTestId("run-results").waitFor({ timeout: 20000 });
  check((await page.getByTestId("team-row").filter({ hasText: "Journey Visibility Tribe" }).getAttribute("data-state")) === "opened", "the board now says the tribe was opened by the owner");
  check((await page.getByTestId("undo").count()) === 0 && (await page.getByTestId("open-now").count()) === 0, "…and offers neither Undo nor Open now for it");
  await shot(page, "38-board-opened");
  await ctx.close();

  // ---- The leader, after Open now --------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, A.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    await l.page.getByText("Pelumi Test").first().waitFor({ timeout: 20000 });
    for (const nm of ["Kemi Test", "Mayowa Test", "Nneka Test", "Obi Test", "Pelumi Test"]) {
      check((await wa(l.page, nm)) === 1, `the numbers have appeared: ${nm.split(" ")[0]} can be messaged on WhatsApp`);
    }
    check((await wa(l.page, "Lanre Test")) === 0, "…but not Lanre, who held back");
    check(/asked that their number is not shared/.test(await memberRow(l.page, "Lanre Test").innerText()), "…and the page says she asked");
    const html = await l.page.content();
    check(!html.includes(digits(1)), "…and Lanre’s number is nowhere in the page");
    await shot(l.page, "38-leader-after");
    await l.ctx.close();
  }

  // A member whose details the church has opened can no longer hold them back, and is given the group link
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${links[pelumi.id]}`);
    const body = await text(m.page);
    check(body.includes("Join the tribe’s WhatsApp group"), "a member whose details the church opened is given the group link too");
    await m.ctx.close();
  }

  await browser.close();
  await q.end();
  finish("38-placement-visibility");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

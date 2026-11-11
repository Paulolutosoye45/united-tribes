/**
 * Appointing leaders in bulk, and assistant leaders, end to end.
 *
 *  - The owner opens Appointments, then the Bulk tab. She pastes a short list (one good row, one that is not an email address, one more
 *    person she will change her mind about), reads it, and sees the one row that cannot be used with its line number.
 *  - She makes the plan: an approved leader with no tribe yet and the person from the list are each paired with a goal that needs a leader.
 *    She looks at another goal for one of them, takes the third person out, and applies. Each is appointed: a Tribe Card started as a
 *    draft. Nobody is certified, no application is made up, the owner is not named, and each person is emailed.
 *  - The person from the list signs in on a phone and finds her Tribe Card.
 *  - A leader recommends an assistant by email address. The administrator sees it on the Assistants page and approves it: the person is
 *    the assistant. The leader then recommends a different person; the administrator must choose Replace, and the swap is one step.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { answers, calling } from "../../tests/db/pipeline-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
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

  // ---- What bulk appointment needs: an approved model, signed-off cards, a season, and members waiting for a leader -------------------------
  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const goal = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug]))!.id as string;
  const waiting = async (slug: string, howMany: number, tag: string) => {
    await q.query(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       select 'wait-${tag}-' || x || '@example.org', now(), '{}'::jsonb from generate_series(1, $1::int) x`,
      [howMany],
    );
    await q.query(
      `insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown)
       select p.id, $1, sg.id, sg.community_id, 'any', 0 from public.people p, public.season_goals sg where sg.id = $2 and p.email like $3`,
      [S, await goal(slug), `wait-${tag}-%@example.org`],
    );
  };
  await waiting("build-a-steady-client-pipeline", 14, "j31a");
  await waiting("land-my-first-three-clients", 5, "j31b");

  // The owner (journeys share one database, so replace any earlier owner)
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "bulk.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);

  // An approved leader with no tribe yet, and two people who will be on the pasted list
  const approved = await k.person("Approved");
  await adapter.grant(approved.id, "leader");
  await q.query(
    "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())",
    [approved.id, JSON.stringify(answers(undefined, { calling: calling({ community: "consulting", goal: "build-a-steady-client-pipeline", goalRelation: "achieved" }) }))],
  );
  const listed = await adapter.createUser({ email: "listed.leader@example.org" });
  await q.query("update public.people set full_name = 'Listed Leader', preferred_name = 'Listed' where id = $1", [listed.id]);
  const changed = await adapter.createUser({ email: "changed.mind@example.org" });
  await q.query("update public.people set full_name = 'Changed Mind', preferred_name = 'Changed' where id = $1", [changed.id]);

  const browser = await launch();

  // ---- The owner: the Bulk tab ------------------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await page.getByRole("link", { name: "Appointments", exact: true }).first().click();
  await page.waitForURL(/\/god\/appointments/, { timeout: 15000 });
  await page.getByRole("link", { name: "Bulk", exact: true }).click();
  await page.waitForURL(/\/god\/appointments\/bulk/, { timeout: 15000 });
  await page.getByTestId("bulk-start").waitFor({ timeout: 20000 });
  check(true, "the owner finds Bulk beside One at a time");
  check(/A pastor still approves every card and the Academy still certifies every leader/.test(await text(page)), "the page says a pastor still approves every card and the Academy certifies every leader");
  await noOverflow(page, "the Bulk tab on a desktop");

  const rows = [
    "Email\tStage of life\tHow they lead best\tCommunity\tGoal\tRelation\tCleared",
    "listed.leader@example.org\tBuilders\tconnection\tConsulting\tBuild a steady client pipeline\tReached it\tno",
    "not-an-email\tBuilders\tconnection\t\t\t\t",
    "changed.mind@example.org\tBuilders\tteaching\tConsulting\tLand my first three clients\tReached it\tno",
  ].join("\n");
  await page.getByLabel("Or paste the rows, titles first").fill(rows);
  await page.getByRole("button", { name: "Read the list" }).click();
  const read = page.getByTestId("sheet-read");
  await read.waitFor({ timeout: 20000 });
  check(/2 people read from the list/.test(await read.innerText()), "the list is read: two people");
  await read.locator("summary").click();
  check(/Line 3: This is not an email address\./.test(await read.innerText()), "…and the row that cannot be used is listed with its line and a plain reason");
  check((await n("select count(*)::int n from public.placement_leader_runs")) === 0, "nothing is saved yet");
  await shot(page, "31-read");

  await page.getByRole("button", { name: "Make the plan" }).click();
  const plan = page.getByTestId("bulk-plan");
  await plan.waitFor({ timeout: 30000 });
  const listedItem = page.getByTestId(`bulk-item-${listed.id}`);
  const approvedItem = page.getByTestId(`bulk-item-${approved.id}`);
  const changedItem = page.getByTestId(`bulk-item-${changed.id}`);
  await listedItem.waitFor({ timeout: 15000 });
  check(await approvedItem.isVisible(), "the approved leader with no tribe is in the plan");
  check(/From your list/.test(await listedItem.innerText()) && /Approved leader/.test(await approvedItem.innerText()), "…and the person from the list, each marked for where they came from");
  check(/\d+%/.test(await listedItem.innerText()), "each is paired with a goal that needs a leader, with the fit shown to the owner");
  check((await n("select count(*)::int n from public.leader_appointments where person_id = any($1::uuid[])", [[approved.id, listed.id, changed.id]])) === 0, "reading a plan appoints nobody");
  await shot(page, "31-plan");

  await changedItem.getByRole("button", { name: "Take out" }).click();
  await eventually("the third person is out of the plan", async () => /taken out/.test(await page.getByTestId(`bulk-item-${changed.id}`).innerText()));
  check(true, "a person taken out of the plan is marked as taken out");
  await listedItem.getByRole("button", { name: "Other goals" }).click();
  await listedItem.getByText(/Pair here|No other goal suits them/).first().waitFor({ timeout: 15000 });
  check(true, "the other goals one person suits can be looked at");
  await listedItem.getByRole("button", { name: "Close" }).click();

  const approve = page.getByTestId("bulk-approve");
  check(/A pastor still reviews every card/.test(await approve.innerText()) && /Academy still certifies every leader/.test(await approve.innerText()), "the approval repeats that a pastor reviews every card and the Academy certifies every leader");
  await approve.getByRole("button", { name: /^Appoint \(\d+\)$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, appoint" }).click();
  await page.getByTestId("bulk-done").waitFor({ timeout: 90000 });
  check(true, "the page says when it is done");
  await shot(page, "31-done");

  // What it did
  for (const [who, label] of [[listed, "the person from the list"], [approved, "the approved leader"]] as const) {
    const t = await one("select t.status, t.season_goal_id, t.fixed from public.tribes t where t.leader_id = $1 order by t.created_at desc limit 1", [who.id]);
    check(!!t && t.status === "draft" && (t.fixed as string[]).includes("goal"), `${label} has a Tribe Card started as a draft, with the goal fixed`);
    check((await n("select count(*)::int n from public.leader_certifications where person_id = $1", [who.id])) === 0, `…is not certified, and nothing certifies them`);
    check((await n("select count(*)::int n from public.person_roles where person_id = $1 and role = 'leader'", [who.id])) === 1, `…has the leader role`);
    check((await n("select count(*)::int n from public.messages where template = 'placement_leader_appointed' and person_id = $1", [who.id])) === 1, `…is emailed once`);
  }
  check((await n("select count(*)::int n from public.leader_applications where person_id = $1", [listed.id])) === 0, "no application is made up for the person from the list");
  check((await n("select count(*)::int n from public.tribes where leader_id = $1", [changed.id])) === 0 && (await n("select count(*)::int n from public.person_roles where person_id = $1 and role = 'leader'", [changed.id])) === 0, "the one taken out was not appointed");
  check((await n("select count(*)::int n from public.tribes where status = 'approved' and leader_id = any($1::uuid[])", [[listed.id, approved.id]])) === 0, "no card was approved");
  check((await n("select count(*)::int n from public.messages where person_id = $1", [owner.id])) === 0, "the owner is not a recipient of anything");
  const mailText = ((await q.query("select params::text t from public.messages where template = 'placement_leader_appointed' and person_id = any($1::uuid[])", [[listed.id, approved.id]])).rows as Row[]).map((r) => String(r.t)).join(" ");
  check(!/Platform Owner|bulk\.owner/.test(mailText) && !/\d{2,3}\s?%/.test(mailText), "the emails carry no score and do not name the owner");

  // The person from the list finds her Tribe Card
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, listed.email, "/lead/tribe");
    await open(p.page, "/lead/tribe");
    check(await heading(p.page, "Your Tribe Card").isVisible(), "the person from the list opens her Tribe Card");
    await noOverflow(p.page, "a bulk-appointed leader's Tribe Card on a phone");
    await p.ctx.close();
  }

  // ---- An assistant leader: the leader recommends, the office decides ------------------------------------------------------------------------------
  const T = await k.tribe(S, { community: "professionals", name: "Journey Assistant Tribe" });
  const first = await k.staff("Nia", "assistant_leader");
  const second = await k.staff("Ola", "assistant_leader");
  const recommend = async (email: string, reason: string) => {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, T.leader.email, "/lead/tribe");
    await open(l.page, "/lead/tribe");
    const card = l.page.getByTestId("assistant-recommend");
    await card.waitFor({ timeout: 20000 });
    await card.getByLabel("Their email address").fill(email);
    await card.getByLabel("Why them? (optional)").fill(reason);
    await card.getByRole("button", { name: /^Recommend (an|a different) assistant$/ }).click();
    await l.page.getByText(/Sent to the church office/).waitFor({ timeout: 15000 });
    await l.ctx.close();
  };

  await recommend(first.email, "Steady, kind and always early.");
  const rec1 = (await one("select id, status from public.assistant_recommendations where tribe_id = $1 order by created_at desc limit 1", [T.tribe]))!;
  check(rec1.status === "requested", "the leader’s recommendation reaches the office");
  // (The office's own email follows the Notifications switch for its group, which starts Off; the Assistants page below always lists it.)
  check((await n("select count(*)::int n from public.tribes where id = $1 and assistant_id is not null", [T.tribe])) === 0, "…and nobody is the assistant yet");

  const admin = await newPage(browser, "desktop");
  await signIn(admin.page, "admin.mary@example.org", "/admin/assistants");
  await open(admin.page, "/admin/assistants");
  await heading(admin.page, "Assistant leaders").waitFor();
  const row1 = admin.page.getByTestId(`assistant-${rec1.id}`);
  await row1.waitFor({ timeout: 20000 });
  const body1 = await row1.innerText();
  check(/Journey Assistant Tribe/.test(body1) && /Steady, kind and always early/.test(body1) && /Approved assistant leader/.test(body1), "the administrator sees the tribe, the reason, and that the person is an approved assistant leader");
  await noOverflow(admin.page, "the Assistants page on a desktop");
  await shot(admin.page, "31-assistants");
  await row1.getByLabel(/A note for yourself/).fill("Known to us");
  await row1.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.page.getByTestId("assistant-said").getByText(/They are now the assistant/).waitFor({ timeout: 15000 });
  check((await one("select assistant_id from public.tribes where id = $1", [T.tribe]))?.assistant_id === first.id, "approving pairs the person at once, because they are already an approved assistant leader");
  check((await n("select count(*)::int n from public.messages where template = 'assistant_decided' and person_id = $1", [T.leader.id])) >= 1, "…and the leader is told in a line");
  check(!JSON.stringify((await q.query("select params from public.messages where template = 'assistant_decided' and person_id = $1", [T.leader.id])).rows).includes("Known to us"), "…without the office’s own note");

  // A different assistant: the office must choose Replace, and the swap is one step
  await recommend(second.email, "Has led a group before.");
  const rec2 = (await one("select id from public.assistant_recommendations where tribe_id = $1 and status = 'requested' order by created_at desc limit 1", [T.tribe]))!;
  await open(admin.page, "/admin/assistants");
  const row2 = admin.page.getByTestId(`assistant-${rec2.id}`);
  await row2.waitFor({ timeout: 20000 });
  check((await row2.getByRole("button", { name: "Approve", exact: true }).count()) === 0, "with an assistant already in place there is no plain Approve");
  check(/Current assistant: /.test(await row2.innerText()), "…the page names the one who would be replaced");
  await row2.getByRole("button", { name: /^Replace / }).click();
  await admin.page.getByTestId("assistant-said").getByText(/They are now the assistant/).waitFor({ timeout: 15000 });
  check((await one("select assistant_id from public.tribes where id = $1", [T.tribe]))?.assistant_id === second.id, "Replace makes the new person the assistant in one step");
  check((await n("select count(*)::int n from public.tribes where id = $1 and assistant_id is null", [T.tribe])) === 0, "…the tribe is never without one");
  check((await n("select count(*)::int n from public.messages where template = 'assistant_replaced' and person_id = $1", [first.id])) >= 1, "…and the one replaced is told");
  await admin.ctx.close();

  await ctx.close();
  await browser.close();
  await q.end();
  finish("31-bulk-and-assistants");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

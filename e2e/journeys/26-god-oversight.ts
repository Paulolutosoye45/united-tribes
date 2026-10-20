/**
 * God Mode oversight, end to end: a desk for every kind of person on the platform, and the conversations the platform has had.
 *
 *  - An administrator never finds /god/desks or /god/conversations: to everyone else they are pages that do not exist.
 *  - The owner unlocks and finds Desks and Conversations in the console menu.
 *  - Desks: ten of them, one for each role, each with how many hold it and the numbers that person would be looking at. The pastor's desk
 *    agrees with the database. Every screen listed on every desk opens for the owner (none is a "not found" and none sends her home).
 *  - A desk lists the people who hold it, each with a link to their messages.
 *  - Conversations: what was sent, with the wording for ordinary messages, and never the words of a care message, a request for help, a
 *    message to a young member or a referee's link. Codes and links are taken out. Failed messages say why. The answers that come back
 *    for a person are shown. Chats staff opened show who and when, and nothing more.
 *  - What the owner looked at is in her own record, in plain words, and not in the office's log.
 *  - Everything works on a phone.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { makeYoung } from "../../tests/db/activity-kit";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const ROLES = [
  { role: "member", label: "Member" },
  { role: "leader", label: "Tribe leader" },
  { role: "assistant_leader", label: "Assistant leader" },
  { role: "coach", label: "Coach" },
  { role: "community_champion", label: "Community champion" },
  { role: "care_lead", label: "Care lead" },
  { role: "data_lead", label: "Data lead" },
  { role: "director", label: "Director" },
  { role: "pastor", label: "Pastor" },
  { role: "admin", label: "Admin" },
];
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;

  // The owner (journeys share one database, so replace any earlier owner)
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email: "oversight.owner@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);

  // The conversations: ordinary messages, held ones, a failure, a young member, a referee, a reply, a chat opened, an announcement
  const ada = await adapter.createUser({ email: "ada.conversation@example.org" });
  await q.query("update public.people set full_name = 'Ada Conversation', preferred_name = 'Ada' where id = $1", [ada.id]);
  const careLead = (await k.staff("Carol", "care_lead")).id;
  const youngster = await adapter.createUser({ email: "young.member@example.org" });
  await q.query("update public.people set full_name = 'Yemi Young', preferred_name = 'Yemi' where id = $1", [youngster.id]);
  await makeYoung(adapter, k, youngster.id, S);
  // The conversations page lists the newest sixty first. Journeys 01 to 25 share this database and leave messages behind, so these are stamped a
  // few seconds ago to be the newest, which is how a person using the page would meet them.
  const insert = (person: string | null, template: string, params: Record<string, unknown>, status = "sent", error: string | null = null, ago = "5 seconds", toName: string | null = null) =>
    q.query(
      "insert into public.messages (person_id, to_email, to_name, template, params, status, error, created_at, channel) values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() - $8::interval, case when $6 = 'queued' then null else 'email' end)",
      [person, person ? null : "referee@example.org", toName, template, JSON.stringify(params), status, error, ago],
    );
  await insert(ada.id, "welcome", { first: "Ada", tribe: "Yaba Builders" }, "delivered", null, "55 seconds");
  await insert(ada.id, "meeting_reminder", {}, "failed", "No phone on file", "20 seconds");
  await insert(ada.id, "leader_log_link", { week: 4, link: "https://x.example/log?t=SECRETLINK", token: "SECRETTOKEN", tribe: "Pillars" }, "sent", null, "40 seconds");
  await insert(careLead, "care_urgent", { member: "Chidi Hidden", note: "He said he could not cope anymore" }, "sent", null, "10 seconds");
  await insert(ada.id, "coach_help", { leader: "Ada", note: "A member is struggling at home" }, "sent", null, "15 seconds");
  await insert(youngster.id, "welcome", { first: "Yemi", tribe: "TeenSecretTribe" }, "sent", null, "25 seconds");
  await insert(null, "referee_request", { secret: "r".repeat(43), applicant: "Ada Conversation", referee: "Pastor Femi", kind: "email", days: 30 }, "sent", null, "50 seconds", "Pastor Femi");
  await q.query("insert into public.event_log (actor_id, action, entity, meta, at) values ($1, 'checkin.by_reply', 'tribe', $2::jsonb, now() - interval '30 seconds')", [ada.id, JSON.stringify({ week: 3, outcome: "partly", channel: "whatsapp" })]);
  await q.query("insert into public.chat_opens (opened_by, person_id, context) values ($1, $2, 'welcome_call')", [careLead, ada.id]);
  await q.query(
    "insert into public.broadcasts (centre_id, title, audience, audience_label, subject, paragraphs, status, recipient_count, created_by) values ((select id from public.centres limit 1), 'Season starts', '{}'::jsonb, 'Everyone', 'The season begins on Sunday', array['Come early.'], 'sent', 42, $1)",
    [careLead],
  );

  const browser = await launch();

  // ---- An administrator does not find it --------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "admin.mary@example.org", "/god/desks");
    for (const path of ["/god/desks", "/god/desks/pastor", "/god/conversations"]) {
      await open(page, path);
      check(/We can.t find that page/.test(await text(page)), `to an administrator ${path} does not exist`);
    }
    await ctx.close();
  }

  // ---- The owner ------------------------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  check((await page.getByRole("link", { name: "Desks", exact: true }).count()) >= 1 && (await page.getByRole("link", { name: "Conversations", exact: true }).count()) >= 1, "the console menu has Desks and Conversations");

  // Desks
  await page.getByRole("link", { name: "Desks", exact: true }).first().click();
  await page.waitForURL(/\/god\/desks$/, { timeout: 15000 });
  await page.getByRole("heading", { name: "Every desk" }).waitFor({ timeout: 20000 });
  check((await page.locator("[data-desk]").count()) === 10, "ten desks, one for each role");
  check((await n("select count(*)::int n from unnest(enum_range(null::public.app_role))")) === 10, "…as many as there are roles");
  for (const d of ROLES) check((await page.locator(`[data-desk="${d.role}"]`).count()) === 1, `the ${d.label.toLowerCase()} desk is there`);
  const pastorDesk = page.locator('[data-desk="pastor"]');
  const dbCount = async (sql: string) => String(await n(sql));
  check((await pastorDesk.locator('[data-count="applications_in_review"]').innerText()) === (await dbCount("select count(*)::int n from public.leader_applications where status in ('submitted','interview_invited','interview_booked','interviewed')")), "the pastor’s desk shows the same number of applications in review as the database");
  check((await pastorDesk.locator('[data-count="cards_waiting_sign_off"]').innerText()) === (await dbCount("select count(*)::int n from public.tribe_card_templates where status = 'draft'")), "…and the same number of ready-made cards waiting");
  const careDesk = page.locator('[data-desk="care_lead"]');
  const careHolders = await n("select count(distinct person_id)::int n from public.person_roles where role = 'care_lead'");
  check((await careDesk.innerText()).includes(`${careHolders} ${careHolders === 1 ? "person" : "people"}`), "the care lead desk counts the people who hold the role");
  check(!(await page.locator("body").innerText()).includes("Platform Owner"), "the owner is nowhere on the desks");
  check(/Where the analysis lives/.test(await text(page)) && (await page.getByRole("link", { name: /Pulse/ }).count()) >= 1, "…and a map of where the analysis lives");
  await shot(page, "26-desks");
  await noOverflow(page, "the desks on a desktop");

  // A desk
  await page.getByTestId("open-desk-pastor").click();
  await page.waitForURL(/\/god\/desks\/pastor/, { timeout: 15000 });
  await page.getByRole("heading", { name: "Pastor", exact: true }).first().waitFor({ timeout: 20000 });
  const deskText = await text(page);
  check(/The numbers they would be looking at/.test(deskText) && /The screens they work from/.test(deskText) && /Who holds it/.test(deskText), "a desk shows the numbers, the screens and the people");
  check((await page.getByTestId("desk-people").locator("li").count()) >= 1, "…with the people who hold it");
  check((await page.getByRole("link", { name: "Their messages" }).count()) >= 1, "…each with a link to their messages");
  await shot(page, "26-desk-pastor");
  await open(page, "/god/desks/wizard");
  check(/We can.t find that page/.test(await text(page)), "a desk that does not exist is not found");

  // Every screen on every desk opens for the owner: take the links from each desk page itself
  const seen = new Set<string>();
  const problems: string[] = [];
  const hrefs: string[] = [];
  for (const d of ROLES) {
    await open(page, `/god/desks/${d.role}`);
    for (const h of await page.locator('[data-testid^="screen-"]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""))) {
      if (h && !hrefs.includes(h)) hrefs.push(h);
    }
  }
  check(hrefs.length >= 30, `the desks list ${hrefs.length} different screens`);
  for (const href of hrefs) {
    seen.add(href);
    const res = await open(page, href);
    const body = await text(page);
    const path = new URL(page.url()).pathname;
    if (!res || res.status() >= 400) problems.push(`${href}: status ${res?.status()}`);
    else if (/We can.t find that page/.test(body)) problems.push(`${href}: not found`);
    else if (path === "/home" && href !== "/home") problems.push(`${href}: sent home`);
    else if (/Something went wrong|Application error/i.test(body)) problems.push(`${href}: an error page`);
  }
  check(problems.length === 0, `all ${seen.size} screens on the desks open for the owner${problems.length ? `: ${problems.join("; ")}` : ""}`);

  // ---- Conversations ----------------------------------------------------------------------------------------------------------------------
  await open(page, "/god");
  await page.getByRole("link", { name: "Conversations", exact: true }).first().click();
  await page.waitForURL(/\/god\/conversations/, { timeout: 15000 });
  await page.getByTestId("message-list").waitFor({ timeout: 20000 });
  const all = await page.getByTestId("message-list").innerText();
  check(/does not keep free-text chat/.test(await page.getByTestId("chat-note").innerText()), "the page says plainly that no free-text chat is kept");
  check(/Ada Conversation/.test(all) && /Welcome/i.test(all), "the messages sent are listed, with who they went to");
  check(/No phone on file/.test(all) && /Failed/.test(all), "a failed message says why");
  const welcome = page.locator('[data-message="welcome"]').filter({ hasText: "Ada Conversation" });
  await welcome.locator("summary").click();
  check(/Yaba Builders/.test(await welcome.innerText()), "an ordinary message can be read as it was worded");
  check((await page.getByTestId("held").count()) >= 4, "care, help, young-member and referee messages are held back");
  const everything = await text(page);
  for (const secret of ["could not cope", "Chidi Hidden", "struggling at home", "TeenSecretTribe", "r".repeat(43), "SECRETLINK", "SECRETTOKEN"]) {
    check(!everything.includes(secret), `“${secret.slice(0, 20)}” is nowhere on the page`);
  }
  check(/Sent to a young member/.test(everything) && /A care message/.test(everything) && /A message to a referee/.test(everything), "…and each says why the words are not shown");
  await shot(page, "26-conversations");

  // Failed only
  await page.getByLabel("How it went").selectOption("failed");
  await page.getByRole("button", { name: "Show" }).click();
  await page.waitForURL(/status=failed/, { timeout: 15000 });
  const failed = page.locator("[data-message]");
  check((await failed.count()) >= 1 && (await failed.evaluateAll((els) => els.every((e) => e.getAttribute("data-status") === "failed"))), "filtering by “Failed” shows only failed messages");

  // One person, with their answers
  await open(page, `/god/conversations?person=${ada.id}`);
  await page.getByTestId("message-list").waitFor({ timeout: 20000 });
  check(/Conversations with Ada Conversation/.test(await text(page)), "one person’s conversations have their name on top");
  check((await page.locator("[data-message]").evaluateAll((els) => els.length)) >= 4, "…and every message sent to them");
  check(/Checked in by pressing a button on WhatsApp: partly/.test(await page.getByTestId("replies").innerText()), "…and the answers that came back");
  await open(page, `/god/people/${ada.id}`);
  check((await page.getByRole("link", { name: /Read every message sent to them/ }).count()) === 1, "a person’s page links to their messages");

  // Chats and announcements
  await open(page, "/god/conversations?view=chats");
  await page.getByTestId("chat-list").waitFor({ timeout: 20000 });
  const chats = await page.getByTestId("chat-list").innerText();
  check(/Carol/.test(chats) && /Ada Conversation/.test(chats) && /welcome call/.test(chats), "a chat staff opened shows who opened it, with whom, and why");
  check(/The words happen in WhatsApp/.test(await text(page)), "…and says the words are not here");
  await open(page, "/god/conversations?view=announcements");
  await page.getByTestId("announcement-list").waitFor({ timeout: 20000 });
  check(/Season starts/.test(await text(page)) && /42 reached/.test(await text(page)), "an announcement shows what it said and how many it reached");

  // ---- The owner's record ---------------------------------------------------------------------------------------------------------
  await open(page, "/god/record");
  const record = await text(page);
  check(/You looked at every desk/.test(record) && /You looked at the pastor desk/.test(record), "the owner’s record says which desks she looked at");
  check(/You looked at the messages the platform has sent/.test(record) && /You read the messages sent to one person/.test(record) && /You looked at the chats staff opened/.test(record), "…and which conversations");
  check((await n("select count(*)::int n from public.event_log where actor_id = $1", [owner.id])) === 0, "none of it is in the office’s log under her name");

  // Phone width
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, owner.email, "/god/unlock");
    await p.page.getByLabel("Passphrase").fill(PHRASE);
    await p.page.getByRole("button", { name: "Unlock" }).click();
    await p.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
    for (const path of ["/god/desks", "/god/desks/care_lead", "/god/conversations", `/god/conversations?person=${ada.id}`, "/god/conversations?view=chats"]) {
      await open(p.page, path);
      await noOverflow(p.page, `${path} on a phone`);
    }
    await shot(p.page, "26-phone-conversations");
    await p.ctx.close();
  }

  await ctx.close();
  await browser.close();
  await q.end();
  finish("26-god-oversight");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

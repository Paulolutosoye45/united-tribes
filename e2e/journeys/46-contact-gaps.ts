/**
 * Contact gaps (fix 13): the members a leader cannot reach on WhatsApp, end to end.
 *
 *  - Off: the office page says it is switched Off, a leader's list has no ask buttons, a member with no number is not prompted, and the announcement
 *    composer does not offer the new audience. The download is "not found".
 *  - The owner (alone, on the console's Features page) opens "Contact gaps" for the whole church.
 *  - The admin opens the page: the member with no number, the one with a number but no WhatsApp yes and the one with no way to be reached are listed with
 *    the reason each; the member who is reachable is not. A box narrows the list. The download has names and no phone numbers, and a leader cannot open it.
 *  - "Write to the people who can be asked" opens the composer already pointed at them, and the count it gives is the count the database gives.
 *  - The leader sees first names only, with "Ask Femi to add it". One press sends one email from the office, in the leader's name, that says who can see a
 *    number and that the choice is the member's. The button then says she was asked, and the person with no way to be emailed says "Please ask in person".
 *  - The member who was asked is prompted on Home ("Not now" puts it away for a week), is offered the number she signs in with, and using it only fills the
 *    box: nothing is saved and WhatsApp stays unticked until she saves.
 *  - Nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a season, a tribe with four members in four situations) is arranged in the database the way the database tests do it;
 * everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state } from "../lib";

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

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[] } };
};
const stub = async (channel: string) => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Received[];

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off; a tribe whose four members are in four situations -------------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  await q.query("delete from public.contact_asks");
  await q.query("delete from public.reach_prompts");
  await q.query("delete from public.contact_gap_days");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "gaps.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
  const mine = await k.tribe(S, { name: "Gap Tribe", track: "builders" });
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [mine.leader.id]);
  const femi = await k.seat(mine.tribe, S, "Femi"); //  no number
  const gozie = await k.seat(mine.tribe, S, "Gozie"); // a number, but no yes to WhatsApp
  const hauwa = await k.seat(mine.tribe, S, "Hauwa"); // a number and a yes: nothing to put right
  const ify = await k.seat(mine.tribe, S, "Ify"); //     no number, and email is off
  const admin = await k.staff("Gap Admin", "admin");
  const mineIds = [femi.id, gozie.id, hauwa.id, ify.id];
  await q.query("delete from public.contact_preferences where person_id = any($1)", [mineIds]);
  await q.query("delete from public.consents where person_id = any($1) and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [mineIds]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348034561122', 'email')", [gozie.id]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035672233', 'whatsapp')", [hauwa.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [hauwa.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'e2e')", [ify.id]);
  const centre = (await one("select centre_id from public.people where id = $1", [femi.id]))!.centre_id as string;
  // Femi signs in with a phone number, so the profile can offer it to her
  await q.query("update auth.users set phone = '2348037778899' where id = $1", [femi.id]);

  const browser = await launch();

  // ---- Off: today's app, nothing asked ---------------------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin/people/contact-gaps");
    await a.page.getByTestId("gaps-off").waitFor({ timeout: 20000 });
    check(true, "Off: the office page says it is switched Off and lists nobody");
    const res = await a.page.request.get(`${BASE}/admin/people/contact-gaps/download`);
    check(res.status() === 404, "…and the download is not found");
    await open(a.page, "/admin/announcements/new");
    await a.page.getByText("Who is this for?", { exact: true }).waitFor({ timeout: 20000 });
    check((await a.page.getByText("Cannot be reached on WhatsApp").count()) === 0, "…and the composer does not offer the new audience");
    await a.ctx.close();
  }
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, mine.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("leading-people").waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("reach-gaps").count()) === 0, "…and the leader has no list of people to ask");
    await l.ctx.close();
  }
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, femi.email, "/home");
    await open(m.page, "/home");
    await m.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("reach-prompt").count()) === 0, "…and a member with no number is not prompted");
    await m.ctx.close();
  }

  // ---- God Mode: the owner opens it for the whole church ----------------------------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await owner.getByRole("link", { name: "Features", exact: true }).first().click();
  await owner.waitForURL(/\/god\/features/, { timeout: 15000 });
  await owner.getByTestId("features-board").waitFor({ timeout: 20000 });
  check(/Off/.test(await owner.getByTestId("feature-contact_gaps").innerText()), "Contact gaps starts Off on the owner's Features page");
  await owner.getByTestId("feature-contact_gaps-open").click();
  const box = owner.getByTestId("feature-contact_gaps-editor");
  await box.waitFor({ timeout: 15000 });
  check((await owner.getByTestId("feature-contact_gaps-whole-church").count()) === 1, "it is for the whole church only: there is no place or role to choose");
  await owner.getByTestId("feature-contact_gaps-on").click();
  await box.getByLabel(/Why open it for the whole church/).fill("Opening contact gaps for the whole church in the rehearsal of this journey.");
  await owner.getByTestId("feature-contact_gaps-save").click();
  await eventually("contact gaps is On", async () => (await one("select public.feature_platform_state('contact_gaps') as s"))?.s === "on");

  // ---- On: the office page ----------------------------------------------------------------------------------------------------------------------
  let askable = 0;
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin/people/contact-gaps");
    await page.getByTestId("gaps-table").waitFor({ timeout: 20000 });
    // other journeys share this database and have members of their own: look only at this tribe
    const row = (name: string) => page.locator("tr[data-cause]").filter({ hasText: "Gap Tribe" }).filter({ hasText: name });
    check((await row("Femi").getAttribute("data-cause")) === "no_number", "Femi, with no number, is listed as “No number saved”");
    check((await row("Gozie").getAttribute("data-cause")) === "no_yes", "Gozie, with a number but no WhatsApp yes, is listed as “Number saved, WhatsApp not agreed”");
    check((await row("Ify").getAttribute("data-cause")) === "unreachable", "Ify, with no number and email off, is listed as “No way to be reached”");
    check((await row("Hauwa").count()) === 0, "Hauwa, who can be reached, is not listed");
    has("each row names its tribe and its leader", /Gap Tribe[\s\S]*Lara/, await row("Femi").innerText());
    const count = async (c: string) => Number(await page.getByTestId(`count-${c}`).innerText());
    askable = (await count("no_number")) + (await count("no_yes")) + (await count("made_up"));
    check((await count("no_number")) >= 1 && (await count("no_yes")) >= 1 && (await count("unreachable")) >= 1, "the boxes at the top count each reason");
    await shot(page, "46-office-list");

    await page.locator('a[data-cause="no_yes"]').click();
    await page.waitForURL(/cause=no_yes/, { timeout: 15000 });
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });
    check((await page.locator("tr[data-cause]:not([data-cause=no_yes])").count()) === 0, "pressing a box shows only that reason");
    check((await row("Gozie").count()) === 1 && (await row("Femi").count()) === 0, "…Gozie stays and Femi goes");
    await open(page, "/admin/people/contact-gaps");
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });

    // the download: names, no numbers
    const res = await page.request.get(`${BASE}/admin/people/contact-gaps/download`);
    const csv = await res.text();
    check(res.status() === 200 && /text\/csv/.test(res.headers()["content-type"] ?? "") && /attachment/.test(res.headers()["content-disposition"] ?? ""), "the download is a spreadsheet file");
    check(/Femi/.test(csv) && /Gozie/.test(csv) && /Ify/.test(csv) && !/Hauwa/.test(csv), "…with the three people, and not the one who can be reached");
    check(!/\+?234\d{6,}|0803\d{6,}|8034561122/.test(csv), "…and no phone number in it");
    check((await n("select count(*)::int n from public.event_log where action = 'contact_gaps.exported'")) >= 1, "…and the download is logged");

    // the composer opens already pointed at them, and counts what the database counts
    await page.getByTestId("gaps-write").click();
    await page.waitForURL(/\/admin\/announcements\/new\?audience=cannot_reach/, { timeout: 15000 });
    await page.getByText("Who is this for?", { exact: true }).waitFor({ timeout: 20000 });
    check((await page.getByRole("button", { name: /Cannot be reached on WhatsApp/ }).getAttribute("aria-pressed")) === "true", "“Write to the people who can be asked” opens the composer on that audience");
    const counted = page.getByTestId("audience-count");
    await counted.getByText(/will get this/).waitFor({ timeout: 20000 });
    const shown = Number(((await counted.innerText()).match(/^\s*([\d,]+)/) ?? [])[1]?.replace(/,/g, ""));
    const fromDb = await n(
      `select count(*)::int n from public.audience_members('{"kind":"cannot_reach","cause":"either"}'::jsonb, $1) m where m.blocker is null`,
      [centre],
    );
    check(shown === fromDb && shown >= 2 && shown <= askable, `the count in the composer (${shown}) is the count the database gives (${fromDb}), and no more than the list says can be asked (${askable})`);
    await shot(page, "46-composer");
    await page.getByRole("button", { name: "Next: write it" }).click();
    await page.getByRole("button", { name: "Add your number" }).waitFor({ timeout: 15000 });
    check((await page.getByRole("button", { name: "Tick WhatsApp if you are happy" }).count()) === 1, "…and offers the notes written for them");
    await a.ctx.close();
  }
  {
    const l = await newPage(browser, "desktop");
    const res = await (async () => {
      await signIn(l.page, mine.leader.email, "/lead");
      return l.page.request.get(`${BASE}/admin/people/contact-gaps/download`);
    })();
    check(res.status() === 404, "a leader cannot open the download");
    await l.ctx.close();
  }

  // ---- The leader asks one person ---------------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    const page = l.page;
    await signIn(page, mine.leader.email, "/lead");
    await open(page, "/lead");
    await page.getByTestId("reach-gaps").waitFor({ timeout: 20000 });
    const listed = (name: string) => page.getByTestId("reach-person").filter({ hasText: name });
    check((await listed("Femi").getAttribute("data-state")) === "ask" && (await listed("Gozie").getAttribute("data-state")) === "ask", "the leader can ask Femi and Gozie");
    check((await listed("Ify").getAttribute("data-state")) === "in_person", "…Ify, who cannot be emailed, says “Please ask in person”");
    check((await listed("Hauwa").count()) === 0, "…and Hauwa is not on the list");
    const body = await page.getByTestId("reach-gaps").innerText();
    check(!/\+?234\d{6,}|0803\d{6,}|8034561122|Test\b/.test(body), "…by first name only, and no number");
    await shot(page, "46-leader-list");
    await page.getByRole("button", { name: "Ask Femi to add it" }).click();
    await page.getByText("Femi has been emailed. They choose what to share.").waitFor({ timeout: 15000 });
    await eventually("the list says she was asked", async () => (await listed("Femi").getAttribute("data-state")) === "asked");
    check((await page.getByRole("button", { name: "Ask Femi to add it" }).count()) === 0, "pressing it once sends one email, and the button is gone");
    check((await n("select count(*)::int n from public.contact_asks where person_id = $1", [femi.id])) === 1, "the ask is recorded once");

    const t = await tick();
    check(t.status === 200 && t.body.problems.length === 0, `the heartbeat sends it (${t.body.sent} sent, ${t.body.problems.length} problems)`);
    const mail = (await stub("email")).find((r) => (r.body.to as string[])[0] === femi.email && /Lara would like to reach you/.test(String(r.body.subject)));
    check(Boolean(mail), "Femi was emailed, and the subject names the leader");
    const mailText = String(mail?.body.text ?? "");
    has("…it says who can see a number and that the choice is hers", /tribe.s leader, their assistant and your coach[\s\S]*Other members never see it[\s\S]*entirely your choice/, mailText);
    check(!/\+?234\d{6,}/.test(mailText), "…and carries no number");
    await l.ctx.close();
  }

  // ---- The member puts it right, or puts it away --------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    const page = m.page;
    await signIn(page, femi.email, "/home");
    await open(page, "/home");
    await page.getByTestId("reach-prompt").waitFor({ timeout: 20000 });
    has("Home asks how she would like to be reached, kindly", /Tell us how to reach you[\s\S]*you can say no to any of it/, await page.getByTestId("reach-prompt").innerText());
    await noOverflow(page, "Home with the prompt on a phone");
    await shot(page, "46-home-prompt");
    await page.getByTestId("reach-prompt-later").click();
    await page.getByTestId("reach-prompt").waitFor({ state: "detached", timeout: 15000 });
    check((await n("select count(*)::int n from public.reach_prompts where person_id = $1", [femi.id])) === 1, "“Not now” puts it away and the database remembers");
    await open(page, "/home");
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await page.getByTestId("reach-prompt").count()) === 0, "…and it stays away when she comes back");

    await q.query("update public.reach_prompts set dismissed_at = now() - interval '8 days' where person_id = $1", [femi.id]);
    await open(page, "/home");
    await page.getByTestId("reach-prompt-open").waitFor({ timeout: 20000 });
    check(true, "after a week it asks again");
    await page.getByTestId("reach-prompt-open").click();
    await page.waitForURL(/\/profile/, { timeout: 15000 });
    const card = page.getByLabel("How we reach you");
    const field = card.locator('input[name="phone"]');
    await field.waitFor({ timeout: 15000 });
    has("the card says who can see a number", /Only your tribe.s leader, their assistant and your coach can see your number, and only if WhatsApp is ticked/, await card.innerText());
    await card.getByTestId("reach-use-signin").click();
    check((await field.inputValue()) === "+2348037778899", "“Use … the number I sign in with” fills the box");
    check((await n("select count(*)::int n from public.contact_preferences where person_id = $1", [femi.id])) === 0, "…and saves nothing");
    check(!(await card.locator('input[name="whatsapp"]').isChecked()), "…and does not tick WhatsApp");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved. We’ll use these from now on.").waitFor({ timeout: 15000 });
    check((await one("select phone from public.contact_preferences where person_id = $1", [femi.id]))?.phone === "+2348037778899", "she saves the number herself");
    check((await one("select public.consent_granted($1, 'whatsapp') as g", [femi.id]))?.g === false, "…and she has not said yes to WhatsApp: the number is hers to give, the yes is hers to give");
    await noOverflow(page, "the profile contact card on a phone");
    await m.ctx.close();
  }
  {
    // she now has a number and no yes, so the leader still cannot see it and the list says so, in the same words as before
    const l = await newPage(browser, "desktop");
    await signIn(l.page, mine.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("reach-gaps").waitFor({ timeout: 20000 });
    const femiRow = l.page.getByTestId("reach-person").filter({ hasText: "Femi" });
    check((await femiRow.count()) === 1 && (await femiRow.getAttribute("data-state")) === "asked", "the leader's list still says Femi was asked, and does not ask again");
    await l.ctx.close();
  }

  await octx.close();
  await browser.close();
  await q.end();
  finish("46-contact-gaps");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

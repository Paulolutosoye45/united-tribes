/**
 * The link in the Tribe Card email (fix 6, the rest of it), end to end in a browser.
 *
 *  - The office presses "Send again" for an appointed leader who has not started; the heartbeat sends the email; the email carries one link,
 *    to the leader's Tribe Card, and nothing else that opens on the site.
 *  - The leader opens that link in a browser where nobody is signed in. She is taken to sign in, and after the email code she lands on
 *    her Tribe Card, not on Home.
 *  - The same link, opened in a fresh browser, with the WhatsApp code: she lands on her Tribe Card too.
 *  - She fills the card on a phone and sends it to the pastorate. The card becomes "submitted"; the board counts it as sent in.
 *  - Someone else, signed in with another account, who opens the same link, is told whose account they are in and why the page is not theirs, with a
 *    way to sign out and use another account. They are not shown the leader's card.
 *  - Nothing scrolls sideways on a phone at any step.
 *
 * What is only arranged here (the season, the owner who appoints, the settings that let a card be sent) is arranged in the database the way the
 * database tests do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, settle, state, text } from "../lib";

type Row = Record<string, unknown>;

/** What the owner answers when appointing: the same short form the database tests use. */
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

function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[] } };
};
const stub = async (channel: string) => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Received[];
const stubPost = (path: string, body: object) => fetch(`${state().stubUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const CLOCK = (hour: number) => `
  create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$;`;
const UNCLOCK = `
  create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$;`;

/** Signs in on the screen the link sent her to, with the email code. */
async function emailCode(page: Page, email: string) {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Six-digit code").fill("123456");
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const ready: { restore: () => Promise<void> }[] = [];

  try {
    // ---- Arranging: the pastorate has signed off the cards, a fit model is approved, an owner appoints, and a card can be sent -------------------
    const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
    for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
      await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
    }
    if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
      await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
    }
    const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
    await q.query("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
    await q.query("delete from public.feature_settings");
    await q.query("delete from public.feature_log");
    await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
    await q.query("delete from public.leader_card_log");
    await q.query("update public.leader_card_settings set reminder_mode = 'off'");
    if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
    const o = await makeOwner(adapter, "cardlink.owner@example.org");

    const lead = await adapter.createUser({ email: "ada.newlead@example.org" });
    await q.query("update public.people set full_name = 'Ada Newlead', preferred_name = 'Ada' where id = $1", [lead.id]);
    await q.query("update auth.users set phone = '2348031234571' where id = $1", [lead.id]);
    const goal = (await one("select id from public.season_goals where slug = $1", [FORM.goal]))!.id as string;
    const appointed = await o.call("god_appoint_leader", lead.id, JSON.stringify(FORM), goal, "Asked by the pastor");
    check((appointed as Row | undefined)?.ok === true, "Ada is appointed to lead a tribe, with her Tribe Card started");
    const tribe = (await one("select tribe_id from public.leader_appointments where person_id = $1 and status = 'active'", [lead.id]))!.tribe_id as string;
    // an appointed card begins with the goal and the three lines; she has put nothing of her own on it
    await q.query(
      "update public.tribes set name = null, story = null, meeting_day = null, meeting_time = null, slot = null, meeting_mode = null, zone = null, place_note = null where id = $1",
      [tribe],
    );
    await q.query("delete from public.messages where person_id = $1", [lead.id]);

    // somebody else, who is not a leader, to open the same link
    const stranger = await k.person("Sam Stranger");
    const admin = await k.staff("Link Admin", "admin");

    // the messages are sent inside the send window whatever the hour the journey runs at
    await q.query(CLOCK(10));
    ready.push({ restore: async () => void (await q.query(UNCLOCK)) });
    // WhatsApp codes go straight to the number, with no link, for this journey
    const signin = (await one("select mode, whatsapp_on from public.signin_settings"))!;
    await q.query("update public.signin_settings set mode = 'normal', whatsapp_on = true");
    ready.push({ restore: async () => void (await q.query("update public.signin_settings set mode = $1, whatsapp_on = $2", [signin.mode, signin.whatsapp_on])) });
    await stubPost("/__reset", {});

    const browser = await launch();

    // ---- The office sends the card again; the email goes -------------------------------------------------------------------------------------
    {
      const a = await newPage(browser, "desktop");
      await a.page.goto(`${BASE}/sign-in?next=${encodeURIComponent("/admin/people/leader-cards")}`);
      await emailCode(a.page, admin.email);
      await a.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await open(a.page, "/admin/people/leader-cards");
      const row = a.page.getByTestId(`lc-row-${lead.id}`);
      await row.waitFor({ timeout: 20000 });
      check((await row.getAttribute("data-state")) === "not_started" && (await row.getAttribute("data-invite")) === "not_sent", "the board shows Ada: not started, and no email has gone");
      await a.page.getByTestId(`lc-resend-${lead.id}`).click();
      await a.page.getByTestId("lc-sent").waitFor({ timeout: 15000 });
      check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'leader_card_reminder' and status = 'queued'", [lead.id])) === 1, "pressing Send again queues one email");
      await a.ctx.close();
    }
    const t = await tick();
    check(t.status === 200 && t.body.problems.length === 0, `the heartbeat sends it (${t.body.sent} sent, ${t.body.problems.length} problems)`);
    const mail = (await stub("email")).find((r) => (r.body.to as string[])[0] === lead.email && /Tribe Card/.test(String(r.body.subject)));
    check(Boolean(mail), "Ada was emailed about her Tribe Card");
    const mailText = String(mail?.body.text ?? "");
    const links = mailText.match(/https?:\/\/\S+/g) ?? [];
    const cardLink = links.find((l) => /\/lead\/tribe/.test(l)) ?? "";
    check(cardLink !== "", "the email carries a link to her Tribe Card");
    check(links.every((l) => ["/lead/tribe", "/profile"].includes(new URL(l).pathname.replace(/[.,;:!?)]+$/, ""))), "…and no other link than the one to the card and the usual “Change how we reach you”");
    has("…it says a pastor reviews the card before members see the tribe", /A pastor reviews your card before members can see your tribe/, mailText);
    check(!/\+?234\d{6,}/.test(mailText), "…and carries no number");

    // The link in the email points at the address the app is served from in this stack; open it on the stack the journey runs against
    const go = new URL(cardLink || `${BASE}/lead/tribe`);
    const entry = `${BASE}${go.pathname}${go.search}`;

    // ---- She opens it where nobody is signed in: sign in, and land on the card -----------------------------------------------------------------
    {
      const m = await newPage(browser, "phone");
      const page = m.page;
      await page.goto(entry);
      await page.waitForURL((u) => u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      check(new URL(page.url()).searchParams.get("next") === "/lead/tribe", "signed out, the link takes her to sign in and remembers where she was going");
      await noOverflow(page, "the sign-in screen she is sent to");
      await shot(page, "48-sign-in");
      await emailCode(page, lead.email);
      await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await settle(page);
      check(new URL(page.url()).pathname === "/lead/tribe", "after the code she is on her Tribe Card, not Home");
      await page.getByRole("heading", { name: "Your Tribe Card" }).first().waitFor({ timeout: 20000 });
      await noOverflow(page, "her Tribe Card on a phone");
      await shot(page, "48-card-empty");
      check((await n("select count(*)::int n from public.leader_card_log where person_id = $1 and kind = 'resend'", [lead.id])) === 1, "the database recorded one send, for the board's count");
      await m.ctx.close();
    }

    // ---- The same link, in a fresh browser, with a code on WhatsApp ----------------------------------------------------------------------------
    {
      const m = await newPage(browser, "phone");
      const page = m.page;
      await page.goto(entry);
      await page.waitForURL((u) => u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await page.getByRole("tab", { name: "WhatsApp" }).click();
      await page.getByLabel("WhatsApp number").fill("08031234571");
      await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
      await page.getByRole("heading", { name: "Check WhatsApp" }).waitFor({ timeout: 15000 });
      await noOverflow(page, "the WhatsApp code screen");
      await page.getByLabel("Six-digit code").fill("123456");
      await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await settle(page);
      check(new URL(page.url()).pathname === "/lead/tribe", "with a WhatsApp code she lands on her Tribe Card too");
      await m.ctx.close();
    }

    // ---- She fills the card on her phone and sends it --------------------------------------------------------------------------------------------
    {
      const m = await newPage(browser, "phone");
      const page = m.page;
      await page.goto(`${BASE}/sign-in?next=${encodeURIComponent("/lead/tribe")}`);
      await emailCode(page, lead.email);
      await page.waitForURL((u) => u.pathname === "/lead/tribe", { timeout: 15000 });
      await page.getByLabel("Tribe name").waitFor({ timeout: 20000 });
      check(await page.getByRole("button", { name: "Send my Tribe Card" }).isDisabled(), "the send button waits until the card is filled in");
      await page.getByLabel("Tribe name").fill("Ada’s Evening Tribe");
      await page.getByLabel("In a couple of sentences").fill("I lead because someone once made room for me, and I would like to do the same for others in the week.");
      await page.getByRole("button", { name: "Wednesday" }).click();
      const time = page.getByLabel("Start time");
      await time.selectOption({ index: 1 });
      await page.getByRole("radiogroup", { name: "Format" }).getByText("Online").click();
      await page.getByLabel("Zone").selectOption({ index: 1 });
      await eventually("her words are saved as she writes", async () => (await one("select story from public.tribes where id = $1", [tribe]))?.story != null);
      // the three lines came from the ready-made card; make sure each has words
      for (const label of ["Loving God", "Loving Others", "Loving Life"]) {
        const box = page.getByLabel(new RegExp(label));
        if ((await box.inputValue()) === "") await box.fill(`${label}: something the whole tribe could see happen.`);
      }
      await page.getByLabel("Tribe name").blur();
      await shot(page, "48-card-filled");
      await noOverflow(page, "the filled card on a phone");
      const send = page.getByRole("button", { name: "Send my Tribe Card" });
      await eventually("the send button is ready", async () => await send.isEnabled());
      await send.click();
      await eventually("the card is sent in", async () => (await one("select status::text s from public.tribes where id = $1", [tribe]))?.s === "submitted");
      check(true, "she sends her Tribe Card to the pastorate");
      await m.ctx.close();
    }

    // ---- The office board counts it as sent in; the next reminder will not go to her ---------------------------------------------------------------
    {
      const a = await newPage(browser, "desktop");
      await a.page.goto(`${BASE}/sign-in?next=${encodeURIComponent("/admin/people/leader-cards?filter=submitted")}`);
      await emailCode(a.page, admin.email);
      await a.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await open(a.page, "/admin/people/leader-cards?filter=submitted");
      const row = a.page.getByTestId(`lc-row-${lead.id}`);
      await row.waitFor({ timeout: 20000 });
      check((await row.getAttribute("data-state")) === "submitted", "the board now shows Ada’s card as sent in");
      check((await a.page.getByTestId(`lc-resend-${lead.id}`).count()) === 0, "…with no Send again button, because there is nothing left to ask");
      await shot(a.page, "48-board-sent-in");
      await a.ctx.close();
    }

    // ---- Somebody else opens the same link ----------------------------------------------------------------------------------------------------
    {
      const m = await newPage(browser, "phone");
      const page = m.page;
      await page.goto(`${BASE}/sign-in?next=${encodeURIComponent("/lead/tribe")}`);
      await emailCode(page, stranger.email);
      await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      await open(page, "/lead/tribe");
      await page.getByTestId("no-access").waitFor({ timeout: 20000 });
      const body = await text(page);
      has("another account is told whose it is", new RegExp(`signed in as .*${stranger.email.replace(/[.+]/g, "\\$&")}`), body);
      has("…and why the page is not theirs", /This page is for tribe leaders/, body);
      check(!body.includes("Ada’s Evening Tribe") && !body.includes("Ada Newlead"), "…and nothing of Ada’s card is shown");
      check((await page.getByTestId("no-access-switch").count()) === 1, "…with a way to sign out and use another account");
      await noOverflow(page, "the explanation page on a phone");
      await shot(page, "48-wrong-account");
      await page.getByTestId("no-access-switch").click();
      await page.waitForURL((u) => u.pathname.startsWith("/sign-in"), { timeout: 15000 });
      check(true, "signing out takes them to sign in, where Ada’s own account can be used");
      await m.ctx.close();
    }

    await browser.close();
  } finally {
    for (const r of ready.reverse()) await r.restore().catch(() => {});
    await q.end();
  }
  finish("48-leader-card-link");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

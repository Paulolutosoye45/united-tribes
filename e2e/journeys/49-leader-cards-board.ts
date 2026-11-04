/**
 * Leader cards (fix 5 and fix 4): the office's board, end to end.
 *
 *  - Four leaders are in four situations: Ben has not started and his email failed ("Mailbox is full"), Chi has started and was emailed, Dayo has sent
 *    his card in, Efe's is approved. The admin opens the board: the headline and the counts agree with the people, "Email did not arrive" narrows the
 *    list to Ben, and his card says why in words and shows the address the email was sent to (the office can act on it).
 *  - Sending and email lists the leader whose email did not arrive.
 *  - A department can be written beside a leader, and the filter by department narrows the board.
 *  - "Send the email again" for Ben queues one email; pressing the bulk button afterwards sends nothing more that day and the board says why.
 *  - WhatsApp can be opened for a leader whose email failed and whose number the church may use, and the office marks it sent.
 *  - The list for the heads of department downloads as a spreadsheet with no numbers and no addresses; the call sheet has both.
 *  - The reminder control starts Off; Rehearsal saved for today only writes down who it would have written to, and sends nothing.
 *  - The data lead can read the board and download the list for the heads of department, and cannot send, tag, see an address or download the call sheet.
 *  - A leader opening the page is told it is not theirs.
 *  - Nothing scrolls sideways at 320 px.
 *
 * What is only arranged here (the leaders and the state of their cards and emails) is arranged in the database the way the database tests do it;
 * everything the office does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, settle } from "../lib";

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

const CLOCK = (hour: number) => `create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$;`;
const UNCLOCK = `create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$;`;

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[] } };
};

async function signInTo(page: Page, email: string, next: string) {
  await page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const undo: (() => Promise<unknown>)[] = [];

  try {
    // ---- Arranging --------------------------------------------------------------------------------------------------------------------------
    const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
    for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
      await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
    }
    if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
      await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
    }
    await q.query("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
    await q.query("delete from public.feature_settings");
    await q.query("delete from public.feature_log");
    await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
    await q.query("delete from public.leader_card_log");
    await q.query("delete from public.leader_departments");
    await q.query("update public.leader_card_settings set reminder_mode = 'off', days = '{4,5,6}', start_hour = 9, max_total = 12, reason = null");
    // journeys share one database: every earlier tribe is put away so the board holds only the four leaders below
    await q.query("update public.tribes set status = 'closed' where status::text <> 'closed'");
    if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
    const o = await makeOwner(adapter, "board.owner@example.org");
    const goal = (await one("select id from public.season_goals where slug = $1", [FORM.goal]))!.id as string;

    const appoint = async (full: string, preferred: string, email: string) => {
      const u = await adapter.createUser({ email });
      await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, full, preferred]);
      const r = (await o.call("god_appoint_leader", u.id, JSON.stringify(FORM), goal, "Asked by the pastor")) as Row | undefined;
      check(r?.ok === true, `${full} is appointed`);
      const t = (await one("select tribe_id from public.leader_appointments where person_id = $1 and status = 'active'", [u.id]))!.tribe_id as string;
      await q.query("update public.tribes set name = $2, story = null, meeting_day = null, meeting_time = null, slot = null, meeting_mode = null, zone = null where id = $1", [t, `${preferred}’s tribe`]);
      await q.query("delete from public.messages where person_id = $1", [u.id]);
      return { id: u.id, email, tribe: t, name: full };
    };
    const ben = await appoint("Ben Adeyemi", "Ben", "ben.lead@example.org");
    const chi = await appoint("Chi Okafor", "Chi", "chi.lead@example.org");
    const dayo = await appoint("Dayo Bello", "Dayo", "dayo.lead@example.org");
    const efe = await appoint("Efe Idowu", "Efe", "efe.lead@example.org");

    const FULL = `story = 'We meet to build one another up in the week.', meeting_day = 3, meeting_time = time '19:00', slot = 'weeknight-evening', meeting_mode = 'online', zone = 'mainland'`;
    await q.query(`update public.tribes set story = 'We meet to build one another up in the week.' where id = $1`, [chi.tribe]);
    await q.query(`update public.tribes set status = 'submitted', submitted_at = now(), ${FULL} where id = $1`, [dayo.tribe]);
    await q.query(`update public.tribes set status = 'approved', submitted_at = now(), ${FULL} where id = $1`, [efe.tribe]);
    const queue = async (person: string, status: string, error: string | null) => {
      const id = (await one("select public.enqueue_message($1, 'placement_leader_appointed', '{}'::jsonb, null, $2, now(), 'normal', 'email') as id", [person, `e2e-${person}`]))!.id as string;
      if (status === "failed") await q.query("update public.messages set status = 'failed', error = $2 where id = $1", [id, error]);
      else await q.query("update public.messages set status = 'sent', sent_at = now() where id = $1", [id]);
    };
    await queue(ben.id, "failed", "Mailbox is full");
    for (const p of [chi, dayo, efe]) await queue(p.id, "sent", null);
    // everyone but Ben has signed in; Ben has never opened the link
    await q.query("update auth.users set last_sign_in_at = now() where id = any($1)", [[chi.id, dayo.id, efe.id]]);
    // Ben's WhatsApp number may be used by the church, so the office can message him by hand
    await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035550101', 'email') on conflict (person_id) do update set phone = excluded.phone", [ben.id]);
    await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [ben.id]);

    const admin = await k.staff("Board Admin", "admin");
    const dataLead = await k.staff("Board Data", "data_lead");
    const lead = ben; // a leader, to open the page that is not theirs
    await q.query(CLOCK(10));
    undo.push(() => q.query(UNCLOCK));
    const dow = Number((await one("select public.lagos_dow() as d"))!.d);

    const browser = await launch();

    // ---- The admin opens the board ---------------------------------------------------------------------------------------------------------
    const a = await newPage(browser, "desktop", { permissions: [] });
    await signInTo(a.page, admin.email, "/admin/people/leader-cards");
    await open(a.page, "/admin/people/leader-cards");
    await a.page.getByTestId("lc-board").waitFor({ timeout: 20000 });
    has("the headline says how many cards are not finished", /2 of 4 cards are not finished/, await a.page.locator("#lc-counts").innerText());
    const count = async (key: string) => Number(await a.page.getByTestId(`lc-count-${key}`).innerText());
    const got = {
      unfinished: await count("unfinished"), not_started: await count("not_started"), in_progress: await count("in_progress"), submitted: await count("submitted"),
      approved: await count("approved"), email_failed: await count("email_failed"), never_signed_in: await count("never_signed_in"),
    };
    check(
      got.unfinished === 2 && got.not_started === 1 && got.in_progress === 1 && got.submitted === 1 && got.approved === 1 && got.email_failed === 1 && got.never_signed_in === 1,
      `the counts agree with the four leaders (${JSON.stringify(got)})`,
    );
    check((await a.page.locator('[data-testid^="lc-row-"]').count()) === 2, "the board starts on the cards that are not finished: Ben and Chi");
    await shot(a.page, "49-board");

    // The failed email, in words, with the address
    await a.page.locator('[data-filter="email_failed"]').click();
    await a.page.waitForURL(/filter=email_failed/, { timeout: 15000 });
    const benRow = a.page.getByTestId(`lc-row-${ben.id}`);
    await benRow.waitFor({ timeout: 20000 });
    check((await a.page.locator('[data-testid^="lc-row-"]').count()) === 1, "“Email did not arrive” narrows the board to Ben");
    has("his card says the email did not arrive, and why", /Did not arrive: Mailbox is full/, await a.page.getByTestId(`lc-invite-${ben.id}`).innerText());
    check((await a.page.getByTestId(`lc-address-${ben.id}`).innerText()).trim() === ben.email, "…and shows the address the email was sent to, so the office can check it");
    check((await benRow.getAttribute("data-state")) === "not_started" && (await benRow.getAttribute("data-invite")) === "failed", "…and that he has not started");
    await shot(a.page, "49-board-failed");

    // Sending and email lists him
    await open(a.page, "/admin/system");
    const failures = a.page.getByTestId("lc-failures");
    await failures.waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("lc-failures-count").innerText()).trim() === "1", "Sending and email counts one leader who did not get the email");
    has("…and names him", /Ben Adeyemi/, await failures.innerText());

    // A department
    await open(a.page, "/admin/people/leader-cards?filter=all");
    const dept = a.page.getByTestId(`lc-dept-${chi.id}`);
    await dept.waitFor({ timeout: 20000 });
    await dept.fill("Ushers");
    await a.page.getByTestId(`lc-row-${chi.id}`).getByRole("button", { name: "Save", exact: true }).click();
    await eventually("the department is saved", async () => (await one("select department from public.leader_departments where person_id = $1", [chi.id]))?.department === "Ushers");
    check(true, "the office writes “Ushers” beside Chi, and it is saved");
    await open(a.page, "/admin/people/leader-cards?filter=all&department=Ushers");
    await a.page.getByTestId(`lc-row-${chi.id}`).waitFor({ timeout: 20000 });
    check((await a.page.locator('[data-testid^="lc-row-"]').count()) === 1, "the department filter narrows the board to her");

    // WhatsApp by hand: while the email has not arrived
    await open(a.page, "/admin/people/leader-cards?filter=email_failed");
    const chat = a.page.getByTestId(`lc-chat-${ben.id}`);
    if (await chat.count()) {
      const popup = a.ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
      await chat.click();
      await a.page.getByTestId("lc-chat-opened").waitFor({ timeout: 15000 });
      const p2 = await popup;
      if (p2) await p2.close().catch(() => {});
      await a.page.getByRole("button", { name: "Yes, I sent it" }).click();
      await a.page.getByText("Marked as sent.").waitFor({ timeout: 15000 });
      check(true, "the office can message Ben on WhatsApp, and marks it sent");
    } else {
      check(false, "the office is offered WhatsApp for a leader whose email failed and whose number the church may use");
    }

    // Send again
    await open(a.page, "/admin/people/leader-cards?filter=email_failed");
    await a.page.getByTestId(`lc-resend-${ben.id}`).waitFor({ timeout: 20000 });
    check((await a.page.getByTestId(`lc-resend-${dayo.id}`).count()) === 0, "there is no Send again for a card already sent in");
    await a.page.getByTestId(`lc-resend-${ben.id}`).click();
    const sent = a.page.getByTestId("lc-sent");
    await sent.waitFor({ timeout: 15000 });
    has("pressing it says one email is on its way", /1 email is on its way/, await sent.innerText());
    check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'leader_card_reminder' and status = 'queued'", [ben.id])) === 1, "…and one email is queued");
    check((await n("select count(*)::int n from public.leader_card_log where person_id = $1 and kind = 'resend'", [ben.id])) === 1, "…and the database counts it as send number one");
    // the bulk button, pressed after that, sends nothing more today
    await open(a.page, "/admin/people/leader-cards?filter=email_failed");
    const bulk = a.page.getByTestId("lc-bulk");
    if (await bulk.count()) {
      await bulk.click();
      await a.page.getByTestId("lc-bulk-confirm").click();
      has("the bulk button, pressed again the same day, says nothing was sent and why", /Nothing was sent[\s\S]*Ben Adeyemi/, await a.page.getByTestId("lc-sent").innerText());
    } else {
      check(true, "after one is queued the bulk button no longer offers him");
    }
    check((await n("select count(*)::int n from public.messages where person_id = $1 and template = 'leader_card_reminder'", [ben.id])) === 1, "…so there is still only the one email");
    const t = await tick();
    check(t.status === 200 && t.body.problems.length === 0, `the heartbeat sends it (${t.body.sent} sent, ${t.body.problems.length} problems)`);

    // The downloads
    const hod = await a.page.request.get(`${BASE}/admin/people/leader-cards/download?sheet=hod`);
    const hodBody = (await hod.body()).toString("utf8");
    check(hod.status() === 200 && /text\/csv/.test(hod.headers()["content-type"] ?? "") && hodBody.startsWith("﻿"), "the list for the heads of department downloads as a spreadsheet");
    check(!/\+234|@example|Phone|Email address/.test(hodBody) && hodBody.includes("Ben Adeyemi") && hodBody.includes("Ushers"), "…with names and departments, and no number and no address");
    const call = await a.page.request.get(`${BASE}/admin/people/leader-cards/download?sheet=call`);
    const callBody = (await call.body()).toString("utf8");
    check(call.status() === 200 && callBody.includes("2348035550101") && callBody.includes(ben.email), "the call sheet has the number and the address");
    check((await n("select count(*)::int n from public.event_log where action = 'leader_cards.call_sheet'")) >= 1, "…and the office’s log recorded that it was downloaded");

    // Reminders: Off, then Rehearsal for today
    await open(a.page, "/admin/people/leader-cards");
    const rem = a.page.getByTestId("lc-reminders");
    await rem.waitFor({ timeout: 20000 });
    has("the reminders say they are Off", /Off/, await a.page.getByTestId("lc-reminders-line").innerText());
    await a.page.getByTestId("lc-mode-rehearsal").click();
    for (const day of [4, 5, 6]) {
      const box = a.page.getByTestId(`lc-day-${day}`);
      if ((await box.isChecked()) && day !== dow) await box.uncheck();
    }
    const today = a.page.getByTestId(`lc-day-${dow}`);
    if (!(await today.isChecked())) await today.check();
    await a.page.getByTestId("lc-reason").fill("Trying it for the first week");
    await a.page.getByTestId("lc-save-reminders").click();
    await eventually("Rehearsal is saved", async () => (await one("select reminder_mode from public.leader_card_settings"))?.reminder_mode === "rehearsal");
    check((await one("select days from public.leader_card_settings"))?.days?.toString() === String(dow), "Rehearsal is saved for today only");
    const beforeMail = await n("select count(*)::int n from public.messages where template = 'leader_card_reminder'");
    await q.query("update public.leader_card_settings set start_hour = 6");
    await q.query("delete from public.leader_card_log where kind in ('reminder', 'would_send')");
    const t2 = await tick();
    check(t2.status === 200 && t2.body.problems.length === 0, "the next heartbeat runs");
    check((await n("select count(*)::int n from public.leader_card_log where kind = 'would_send'")) >= 1, "Rehearsal wrote down who it would have emailed");
    check((await n("select count(*)::int n from public.messages where template = 'leader_card_reminder'")) === beforeMail, "…and sent nothing");
    await open(a.page, "/admin/people/leader-cards");
    has("the page shows what Rehearsal would have done this week", /would have/i, await a.page.getByTestId("lc-reminders-week").innerText());
    await shot(a.page, "49-reminders");
    await a.ctx.close();

    // ---- The data lead reads, and cannot act ---------------------------------------------------------------------------------------------------
    {
      const d = await newPage(browser, "desktop");
      await signInTo(d.page, dataLead.email, "/admin/people/leader-cards?filter=email_failed");
      await open(d.page, "/admin/people/leader-cards?filter=all");
      await d.page.getByTestId("lc-board").waitFor({ timeout: 20000 });
      check((await d.page.locator('[data-testid^="lc-row-"]').count()) === 4, "the data lead sees the whole board");
      check(
        (await d.page.locator('[data-testid^="lc-resend-"]').count()) === 0 && (await d.page.locator('[data-testid^="lc-dept-"]').count()) === 0 && (await d.page.locator('[data-testid^="lc-address-"]').count()) === 0,
        "…with no Send again, no department box and no address",
      );
      check((await d.page.getByTestId("lc-download-hod").count()) === 1 && (await d.page.getByTestId("lc-download-call").count()) === 0, "…and the list for the heads of department, but not the call sheet");
      const call2 = await d.page.request.get(`${BASE}/admin/people/leader-cards/download?sheet=call`);
      check(call2.status() === 404 || call2.status() === 403 || call2.url().includes("no-access"), "…and the call sheet is refused if she asks for it by address");
      await d.ctx.close();
    }

    // ---- A leader is told it is not theirs --------------------------------------------------------------------------------------------------------
    {
      const l = await newPage(browser, "phone");
      await signInTo(l.page, lead.email, "/admin/people/leader-cards");
      await open(l.page, "/admin/people/leader-cards");
      await l.page.waitForURL((u) => u.pathname === "/home", { timeout: 15000 });
      check((await l.page.getByTestId("lc-board").count()) === 0, "a leader who opens the board is sent back to Home, and sees nobody");
      await l.ctx.close();
    }

    // ---- A phone ---------------------------------------------------------------------------------------------------------------------------------------
    {
      const p = await newPage(browser, "phone");
      await p.page.setViewportSize({ width: 320, height: 740 });
      await signInTo(p.page, admin.email, "/admin/people/leader-cards?filter=all");
      await open(p.page, "/admin/people/leader-cards?filter=all");
      await p.page.getByTestId("lc-board").waitFor({ timeout: 20000 });
      await settle(p.page);
      await noOverflow(p.page, "the board at 320 px");
      await shot(p.page, "49-board-320");
      await p.ctx.close();
    }

    await browser.close();
  } finally {
    for (const u of undo.reverse()) await Promise.resolve(u()).catch(() => {});
    await q.query("update public.leader_card_settings set reminder_mode = 'off', days = '{4,5,6}', start_hour = 9, reason = null").catch(() => {});
    await q.end();
  }
  finish("49-leader-cards-board");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * The placed answer sequence, the board and the call desk, end to end.
 *
 *  - Off: a member's private page is today's page, Today has no line, and the board says the sequence is Off.
 *  - Rehearsal: the board counts what each step would send, and no email goes.
 *  - On: the heartbeat writes to the members who are waiting (a member whose page was not opened gets "Did this reach you?", one whose page was opened gets
 *    "Anything stopping you from joining?"), never to one placed a few hours ago; each email has the day, five buttons, the sentence about the office calling and no number.
 *  - The private page on a phone: opening saves nothing; Call me (a wrong number stops it; a good one saves it, with no yes to WhatsApp), Not this season, Remind me tonight,
 *    Stop these reminders and Don't call me each do exactly that, and a seat that is released has a link that no longer opens.
 *  - The board: Today's line, the tiles, the rows with names and never a number, a hold on one seat and the pause.
 *  - The call desk: the asked-for calls with their numbers hidden, a number shown only on a press (written down, never the number), the outcome of a call, and a pastor who
 *    can read the board and nothing more. The download with numbers is off until the owner switches it on, and then it is logged.
 *  - The owner changes the numbers with a reason; a leader writes the one line; Off again: today's page, and a Stop link in an old email still stops.
 *
 * What is only arranged here (a running season, a tribe, placed members and their placement emails) is arranged in the database the way the database tests do it;
 * everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

type Row = Record<string, unknown>;
type Mail = { to: string[]; subject: string; html: string; text: string; headers?: Record<string, string> };

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
const emails = async () => ((await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as Received[]).map((e) => e.body as unknown as Mail);
const SEQ = /Did this reach you|Anything stopping you|seats in .* are answered|Last call|Your reminder/;
const mailsTo = async (address: string, subject: RegExp = SEQ) => (await emails()).filter((m) => m.to.includes(address) && subject.test(m.subject));
const linkOf = (m: Mail | undefined, a: string) => new RegExp(`/placed/([a-f0-9]{64})\\?a=${a}`).exec(m?.text ?? "")?.[1] ?? "";
const beats = async () => {
  for (let i = 0; i < 5; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 400));
  }
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off; a running season; one tribe whose members are in eight situations ---------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  for (const t of ["placed_calls", "placed_answers", "placed_holds", "placed_reveals", "placed_downloads", "placed_seq_sends", "placed_seq"]) await q.query(`delete from public.${t}`);
  await q.query("update public.placed_answers_settings set second_after_hours = 24, step3_days = 3, last_call_hours = 24, pace_hours = 20, max_emails = 6, call_tries = 3, numbers_download = false, paused = false, paused_reason = null, swept_at = null, reason = null");
  await q.query("update public.reminder_settings set joining_closes_days = 14, cap_nonessential_week = 3");
  // the heartbeat sends only between 9 am and 7 pm Lagos time, and calls are made from 8 am to 8 pm: hold the clock at noon for this journey (put back at the end)
  await q.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "answers.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);

  const T = await k.tribe(S, { name: "Answer Alpha", track: "builders", capacity: 12 });
  // seats that earlier journeys left marked as placed by the church would show on the board and be written to: set them aside for this journey (put back at the end)
  const stray = (await q.query("select id from public.tribe_members where placement_source = 'auto' and tribe_id <> $1", [T.tribe])).rows.map((r) => r.id as string);
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.tribe_members set placement_source = 'self' where id = any($1::uuid[])", [stray]);
  await q.query("commit");
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [T.leader.id]);
  const named = async <P extends { id: string }>(p: P, name: string): Promise<P> => {
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [p.id, name, name.split(" ")[0]]);
    return p;
  };
  const ada = await named(await k.seat(T.tribe, S, "Ada Caller"), "Ada Caller"); //      page not opened; no number; will ask for a call (a wrong number first)
  const bola = await named(await k.seat(T.tribe, S, "Bola Opened"), "Bola Opened"); //   page opened; will ask for a reminder tonight
  const chika = await named(await k.seat(T.tribe, S, "Chika Notnow"), "Chika Notnow"); // will say not this season
  const dayo = await named(await k.seat(T.tribe, S, "Dayo Number"), "Dayo Number"); //    holds a number; will ask for a call with it
  const efe = await named(await k.seat(T.tribe, S, "Efe Stopper"), "Efe Stopper"); //     will stop the reminders
  const fola = await named(await k.seat(T.tribe, S, "Fola Recent"), "Fola Recent"); //    placed two hours ago
  const gina = await named(await k.seat(T.tribe, S, "Gina Nocall"), "Gina Nocall"); //    will say don't call me
  const hauwa = await named(await k.seat(T.tribe, S, "Hauwa Held"), "Hauwa Held"); //     the office holds her seat
  const people = [ada, bola, chika, dayo, efe, fola, gina, hauwa];
  const ids = people.map((p) => p.id);
  const admin = await k.staff("Answers Admin", "admin");
  await q.query("update public.people set full_name = 'Answers Admin', preferred_name = 'Ada Admin' where id = $1", [admin.id]);
  const pastor = await k.staff("Answers Pastor", "pastor");
  await q.query("delete from public.messages where person_id = any($1::uuid[])", [[...ids, T.leader.id, admin.id, pastor.id]]);
  await q.query("delete from public.contact_preferences where person_id = any($1)", [ids]);
  await q.query("delete from public.consents where person_id = any($1) and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [ids]);
  await q.query("delete from public.care_flags where person_id = any($1)", [ids]);
  await q.query("delete from public.placement_holds where person_id = any($1)", [ids]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035672233', 'whatsapp')", [dayo.id]);

  // the church placed all eight (the seat says so), and told each by email: seven of them a day and a half ago, Fola two hours ago
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null, contact_withheld = false where tribe_id = $1 and person_id = any($2::uuid[])", [T.tribe, ids]);
  await q.query("commit");
  const tms: Record<string, string> = {};
  for (const p of people) {
    tms[p.id] = (await one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [p.id, T.tribe]))!.id as string;
    const hours = p.id === fola.id ? 2 : 30;
    await q.query(
      "insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', $2, 'sent', $3, now(), now() - $4::interval)",
      [p.id, JSON.stringify({ tribe: "Answer Alpha", leader_first: "Lara" }), `placement:${tms[p.id]}`, `${hours} hours`],
    );
  }
  // Bola opened her page (a click on the link in the placement email)
  const bolaLink = (await one("select public.placement_token_mint($1, $2, 60) as t", [tms[bola.id], bola.id]))!.t as string;
  await q.query("update public.placement_tokens set clicks = 1 where placement_id = $1", [tms[bola.id]]);
  const mint = async (person: string) => (await one("select public.placement_token_mint($1, $2, 60) as t", [tms[person], person]))!.t as string;
  const seat = async (person: string) => (await one("select status::text as status, release_reason, confirmed_at from public.tribe_members where id = $1", [tms[person]]))!;
  const answers = async (person: string) => (await q.query("select kind, window_pref, reason, topic from public.placed_answers where tm_id = $1 order by id", [tms[person]])).rows as Row[];
  const owner = (feature: string, position: string) => o.call("god_feature_set", feature, "platform", null, position, [], "Trying the placed answers in the journey", null);
  const goOn = async () => {
    await q.query("update public.placed_answers_settings set swept_at = null");
    await beats();
  };

  const browser = await launch();

  // ---- Off: nothing is offered, and the member's page is today's page --------------------------------------------------------------------------------------
  const offLink = await mint(hauwa.id);
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin");
    await open(a.page, "/admin");
    await a.page.getByRole("heading", { name: "Today" }).waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("placed-answers-card").count()) === 0, "Off: Today has no line for the placed members");
    await open(a.page, "/admin/placed");
    await a.page.getByTestId("placed-off").waitFor({ timeout: 20000 });
    has("…and the board says the sequence is Off, while it still shows where people stand", /Off/, await a.page.getByTestId("placed-off").innerText());
    check((await a.page.getByTestId("tile-placed").innerText()).trim() === "8", "…with all eight placed members counted");
    await a.ctx.close();

    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${offLink}`);
    await m.page.getByRole("button", { name: /Yes, I.m in/ }).first().waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("placed-more").count()) === 0, "…and a member's private page is today's page (no new answers)");
    await m.ctx.close();
  }
  await beats();
  check((await emails()).filter((m) => SEQ.test(m.subject)).length === 0, "Off: the heartbeat sends nothing from the sequence");

  // ---- Rehearsal: counts, and no email ---------------------------------------------------------------------------------------------------------------------
  await owner("placed_answers", "rehearsal");
  await goOn();
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin/placed");
    await open(a.page, "/admin/placed");
    await a.page.getByTestId("placed-rehearsal").waitFor({ timeout: 20000 });
    const practice = await a.page.getByTestId("placed-rehearsal").innerText();
    has("Rehearsal: the board says how many seats are in the practice run, and that nothing is sent", /\d+ seats? (is|are) in the practice run\. Nothing is sent\./, practice);
    has("…and what each step would send", /Did this reach you|Anything stopping you/, practice);
    await shot(a.page, "53-board-rehearsal");
    await a.ctx.close();
  }
  check((await emails()).filter((m) => SEQ.test(m.subject)).length === 0, "…and no email went to anyone");
  check((await n("select count(*)::int as n from public.messages where template = 'placed_seq'")) === 0, "…and none is waiting to go");

  // ---- On: the heartbeat writes to the members who are waiting -----------------------------------------------------------------------------------------------
  await owner("placed_answers", "on");
  await goOn();
  await eventually("the heartbeat sends the sequence email to the waiting members", async () => {
    await tick();
    return (await Promise.all([ada, bola, chika, dayo, efe, gina, hauwa].map((p) => mailsTo(p.email)))).every((m) => m.length >= 1);
  }, 60);
  const mail: Record<string, Mail> = {};
  for (const p of [ada, bola, chika, dayo, efe, gina, hauwa]) mail[p.id] = (await mailsTo(p.email))[0];
  check((await mailsTo(fola.email)).length === 0, "Fola, placed two hours ago, gets nothing yet");
  check((await mailsTo(T.leader.email)).length === 0, "…and neither does the leader");
  check(mail[ada.id].subject === "Did this reach you, Ada?", `a member whose page was not opened gets "Did this reach you?" ("${mail[ada.id].subject}")`);
  check(/^Anything stopping you from joining Answer Alpha\?/.test(mail[bola.id].subject), `…one whose page was opened gets "Anything stopping you from joining?" ("${mail[bola.id].subject}")`);
  check(Object.values(mail).every((m) => m.subject.length <= 60), "every subject fits a phone's lock screen");
  const secrets = Object.values(mail).map((m) => linkOf(m, "confirm"));
  check(secrets.every((s) => s.length === 64) && new Set(secrets).size === 7, "each has a private link of their own");
  check(Object.values(mail).every((m) => ["change", "notnow", "call", "remind", "stop"].every((a) => linkOf(m, a) === linkOf(m, "confirm"))), "…and all six buttons in one email use it");
  check(Object.values(mail).every((m) => /\w+day \d+ \w+/.test(m.text) && /The church office may also call you about your place/.test(m.text)), "every email names the day and says the office may call");
  check(!/\d{7,}/.test(mail[dayo.id].text.replace(/https?:\/\/\S+/g, "")), "…and Dayo’s number is nowhere in the words");
  let kept = 0;
  for (const s of secrets) kept += await n("select count(*)::int as n from public.messages where params::text like $1", [`%${s}%`]);
  for (const s of secrets) kept += await n("select count(*)::int as n from public.event_log where meta::text like $1", [`%${s}%`]);
  check(kept === 0, "no private link is kept in a message's fields or the log");

  // ---- The member's page, on a phone -----------------------------------------------------------------------------------------------------------------------
  {
    // Ada: Call me, a wrong number first
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[ada.id], "call")}?a=call`);
    await page.getByTestId("placed-more").waitFor({ timeout: 20000 });
    has("the page says the seat is held and until when", /Your seat is held for you\. You can switch tribes until \w+day \d+ \w+\./, await page.getByTestId("placed-deadline").innerText());
    check((await page.getByTestId("placed-call-box").getAttribute("open")) !== null, "the email's Call me button opens the call box");
    has("…which says we hold no number", /We have no number for you yet/, await page.getByTestId("placed-call-number-line").innerText());
    has("…and the office calling is said in plain words", /The church office may also call you about your place/, await page.getByTestId("placed-may-call").innerText());
    check((await answers(ada.id)).length === 0, "opening the page saved nothing");
    await noOverflow(page, "the answers page on a phone");
    await page.setViewportSize({ width: 320, height: 700 });
    await noOverflow(page, "the answers page at 320 px");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "53-page-phone");
    await page.getByLabel("Evening", { exact: false }).first().check();
    await page.locator("#call-phone").fill("12345");
    await page.getByTestId("placed-call-confirm").click();
    await page.getByTestId("placed-call-number-problem").waitFor({ timeout: 20000 });
    check((await answers(ada.id)).length === 0 && !(await one("select 1 as x from public.contact_preferences where person_id = $1 and phone is not null", [ada.id])), "a wrong number stops the request and nothing is saved");
    await page.locator("#call-phone").fill("+234 803 555 1212");
    await page.getByLabel("Evening", { exact: false }).first().check();
    await page.getByTestId("placed-call-confirm").click();
    await page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    has("a good number asks for a call, in the time she chose", /Someone from the church office will call you[\s\S]*evening/, await page.getByTestId("placed-answer-done").innerText());
    const got = await answers(ada.id);
    check(got.length === 1 && got[0].kind === "call_me" && got[0].window_pref === "evening", "…and it is written down with her time of day");
    check((await one("select phone from public.contact_preferences where person_id = $1", [ada.id]))?.phone === "+2348035551212", "…with her number saved");
    check((await n("select count(*)::int as n from public.consents where person_id = $1 and purpose = 'whatsapp'", [ada.id])) === 0, "…and no yes to WhatsApp");
    check((await seat(ada.id)).status === "active" && (await seat(ada.id)).confirmed_at === null, "…and her seat is still held, not confirmed");
    await shot(page, "53-page-call-done");
    await m.ctx.close();
  }
  {
    // Bola: Remind me tonight
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${bolaLink}?a=remind`);
    await page.getByTestId("placed-remind").waitFor({ timeout: 20000 });
    await page.getByTestId("placed-remind").click();
    await page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    has("Bola asks for a reminder: one email at 6 pm, and the day has not moved", /We will remind you at 6 pm[\s\S]*has not moved/, await page.getByTestId("placed-answer-done").innerText());
    check((await answers(bola.id)).some((a) => a.kind === "remind_tonight"), "…and it is written down");
    await page.reload();
    check((await page.getByTestId("placed-remind-set").count()) === 1 && (await page.getByTestId("placed-remind").count()) === 0, "…and the button is gone, so it is asked once");
    await m.ctx.close();
  }
  {
    // Chika: Not this season, with a reason
    const link = linkOf(mail[chika.id], "notnow");
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${link}?a=notnow`);
    await page.getByTestId("placed-notnow-box").waitFor({ timeout: 20000 });
    check((await page.getByTestId("placed-notnow-box").getAttribute("open")) !== null, "the email's Not this season button opens its box");
    await page.getByLabel("The time does not suit me").check();
    await page.getByTestId("placed-notnow-confirm").click();
    await page.getByTestId("placed-notnow").waitFor({ timeout: 20000 });
    has("Chika says not this season: the door stays open, and she is not placed again this season", /The door stays open[\s\S]*not place you in a tribe again this season/, await text(page));
    const s = await seat(chika.id);
    check(s.status === "released" && s.release_reason === "Not this season", "her seat is released, marked Not this season");
    check((await answers(chika.id))[0]?.reason === "timing", "…with the reason she gave");
    check((await n("select count(*)::int as n from public.placement_holds where person_id = $1 and source = 'not_season'", [chika.id])) === 1, "…and she is kept out of the automatic placement until the season ends");
    await open(page, `/placed/${link}`);
    await page.getByRole("heading", { name: /Your tribe|, your tribe/ }).first().waitFor({ timeout: 20000 });
    check((await page.getByRole("button", { name: /Yes, I.m in/ }).count()) === 0 && (await page.getByTestId("placed-more").count()) === 0, "…and her link no longer offers her the seat");
    await m.ctx.close();
  }
  {
    // Efe: Stop these reminders
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[efe.id], "stop")}?a=stop`);
    await page.getByTestId("placed-stop").waitFor({ timeout: 20000 });
    await page.getByTestId("placed-stop").click();
    await page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    has("Efe stops the reminders: the seat is still hers", /We have stopped the reminders[\s\S]*seat is still held/, await page.getByTestId("placed-answer-done").innerText());
    check((await seat(efe.id)).status === "active", "her seat is not touched");
    check((await n("select count(*)::int as n from public.placed_seq where tm_id = $1 and status = 'ended' and outcome = 'stopped' and not rehearsal", [tms[efe.id]])) === 1, "…and her sequence has ended");
    await m.ctx.close();
  }
  {
    // Gina: Don't call me. Dayo: Call me with the number we hold
    const g = await newPage(browser, "phone");
    await open(g.page, `/placed/${linkOf(mail[gina.id], "confirm")}`);
    await g.page.getByTestId("placed-dont-call").click();
    await g.page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    check((await answers(gina.id)).some((a) => a.kind === "dont_call"), "Gina presses Don’t call me, and it is written down");
    await g.ctx.close();

    const d = await newPage(browser, "phone");
    await open(d.page, `/placed/${linkOf(mail[dayo.id], "call")}?a=call`);
    await d.page.getByTestId("placed-call-box").waitFor({ timeout: 20000 });
    const line = await d.page.getByTestId("placed-call-number-line").innerText();
    check(/•/.test(line) && !/2348035672233|803 567 2233/.test(line), "Dayo is shown the number we hold with its middle hidden, never whole");
    await d.page.getByTestId("placed-call-confirm").click();
    await d.page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    check((await answers(dayo.id)).some((a) => a.kind === "call_me") && (await one("select phone from public.contact_preferences where person_id = $1", [dayo.id]))?.phone === "+2348035672233", "…and he asks for a call without typing anything, his number as it was");
    await d.ctx.close();
  }
  await beats();
  check((await mailsTo(efe.email)).length === 1 && (await mailsTo(chika.email)).length === 1, "after answering, Efe and Chika are sent nothing more");

  // ---- The board --------------------------------------------------------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin");
    await open(page, "/admin");
    await page.getByTestId("placed-answers-card").waitFor({ timeout: 20000 });
    has("On: Today says how many placed members need a call", /2 placed members need a call, 2 asked for one/, await page.getByTestId("placed-answers-card").innerText());
    await shot(page, "53-today");
    await page.getByTestId("placed-answers-go").click();
    await page.getByTestId("placed-table").waitFor({ timeout: 20000 });
    check((await page.getByTestId("tile-placed").innerText()).trim() === "8" && (await page.getByTestId("tile-needs_call").innerText()).trim() === "2", "the board counts eight placed and two who need a call");
    check((await page.getByTestId("tile-answered").innerText()).trim() === "1", "…and one answered (Chika, not this season)");
    const body = await text(page);
    check(!/\+?234\s?8\d\d|2348035|08035/.test(body), "the board shows names and steps and never a phone number");
    has("…and says that page opened is not read", /Page opened.{0,6}is not.{0,6}read/, body);
    await shot(page, "53-board");
    await page.locator('[data-tile="needs_call"]').first().click();
    await page.waitForURL(/tile=needs_call/, { timeout: 15000 });
    await page.getByTestId("placed-table").waitFor({ timeout: 20000 });
    check((await page.locator('[data-testid="placed-table"] tbody tr').count()) === 2, "a tile opens exactly the rows it counts");

    // hold Hauwa's seat
    await open(page, "/admin/placed?tile=waiting");
    const row = page.locator(`tr[data-tm="${tms[hauwa.id]}"]`);
    await row.getByRole("button", { name: /Hold this seat/ }).click();
    await row.getByLabel(/Why are you holding it/).fill("The office is speaking to her family");
    await row.getByRole("button", { name: "Hold this seat" }).last().click();
    await eventually("the hold is saved", async () => (await n("select count(*)::int as n from public.placed_holds where tm_id = $1 and held_until > now()", [tms[hauwa.id]])) === 1);
    await open(page, "/admin/placed?tile=waiting");
    check((await page.locator(`tr[data-tm="${tms[hauwa.id]}"]`).getByText("Seat held").count()) === 1, "Hold this seat marks the row, and pauses her emails");

    // pause and resume
    await open(page, "/admin/placed");
    await page.getByTestId("placed-pause").getByRole("button", { name: "Pause the sequence" }).click();
    await page.getByLabel(/Why are you pausing it/).fill("Checking the wording with the pastor");
    await page.getByTestId("placed-pause").getByRole("button", { name: "Pause the sequence" }).last().click();
    await page.getByTestId("placed-paused").waitFor({ timeout: 20000 });
    check(true, "Pause the sequence shows a banner on the board");
    await page.getByTestId("placed-pause").getByRole("button", { name: "Resume the sequence" }).click();
    await page.getByTestId("placed-pause").getByRole("button", { name: "Resume the sequence" }).last().click();
    await eventually("the sequence resumes", async () => (await page.getByTestId("placed-paused").count()) === 0 && !(await one("select paused from public.placed_answers_settings"))?.paused);
    await a.ctx.close();
  }
  {
    // By tribe
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin/placed/tribes");
    await open(a.page, "/admin/placed/tribes");
    await a.page.getByTestId("tribes-table").waitFor({ timeout: 20000 });
    const rowText = await a.page.locator('[data-testid="tribes-table"] tbody tr', { hasText: "Answer Alpha" }).innerText();
    has("By tribe lists Answer Alpha, its leader and who is waiting", /Answer Alpha[\s\S]*Lara/, rowText);
    check((await a.page.locator('[data-testid="tribes-table"] tbody tr', { hasText: "Answer Alpha" }).getAttribute("data-thin")) === "true", "…and marks it thin (fewer than five have said yes)");
    await a.ctx.close();
  }

  // ---- The call desk ----------------------------------------------------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin/placed/desk");
    await open(page, "/admin/placed/desk");
    await page.getByTestId("desk-asked").waitFor({ timeout: 20000 });
    const asked = page.getByTestId("desk-asked").locator('[data-testid="desk-row"]');
    check((await asked.count()) === 2, "the desk lists the two who asked for a call");
    const masks = await page.getByTestId("desk-mask").allInnerTexts();
    check(masks.length >= 2 && masks.every((x) => /•/.test(x)), "…each number with its middle hidden");
    check(!/2348035551212|2348035672233/.test(await text(page)), "…and no number whole anywhere on the page");
    await shot(page, "53-desk");
    const adaRow = page.locator(`[data-tm="${tms[ada.id]}"]`);
    has("Ada asked for the evening, and the desk says so", /evening/, await adaRow.innerText());
    await adaRow.getByTestId("desk-show").click();
    const shown = await adaRow.getByTestId("desk-number").innerText();
    check(shown.replace(/\D/g, "") === "2348035551212", "Show number shows her number, once she is chosen");
    check((await n("select count(*)::int as n from public.placed_reveals where tm_id = $1", [tms[ada.id]])) === 1, "…and the press is written down");
    const loggedWithNumber = await n("select count(*)::int as n from public.event_log where meta::text like '%2348035551212%'") + (await n("select count(*)::int as n from public.placed_reveals where row_to_json(placed_reveals)::text like '%2348035551212%'"));
    check(loggedWithNumber === 0, "…without the number");
    await adaRow.getByLabel("Reached, said yes").check();
    await adaRow.getByTestId("desk-save").click();
    await eventually("the call is saved and the seat confirmed", async () => (await seat(ada.id)).confirmed_at !== null);
    check((await n("select count(*)::int as n from public.consents where person_id = $1 and purpose = 'whatsapp'", [ada.id])) === 0, "Reached, said yes confirms the place and saves no yes to WhatsApp");
    await open(page, "/admin/placed/desk");
    check((await page.locator(`[data-tm="${tms[ada.id]}"]`).count()) === 0, "…and she leaves the desk");

    const dayoRow = page.locator(`[data-tm="${tms[dayo.id]}"]`);
    await dayoRow.getByTestId("desk-show").click();
    await dayoRow.getByTestId("desk-number").waitFor({ timeout: 15000 });
    await dayoRow.getByLabel("No answer").check();
    await dayoRow.getByTestId("desk-save").click();
    await eventually("the try is written down", async () => (await n("select count(*)::int as n from public.placed_calls where tm_id = $1 and outcome = 'no_answer'", [tms[dayo.id]])) === 1);
    await open(page, "/admin/placed/desk");
    has("a no answer counts as a try, and he stays on the desk", /Tried 1 of 3/, await page.locator(`[data-tm="${tms[dayo.id]}"]`).innerText());
    await a.ctx.close();
  }
  {
    // A pastor reads the board and nothing more
    const p = await newPage(browser, "desktop");
    await signIn(p.page, pastor.email, "/admin/placed");
    await open(p.page, "/admin/placed");
    await p.page.getByTestId("placed-table").waitFor({ timeout: 20000 });
    check((await p.page.getByTestId("placed-tabs").getByRole("link", { name: "Call desk" }).count()) === 0, "a pastor reads the board, with no Call desk tab");
    check((await p.page.getByRole("button", { name: /Hold this seat/ }).count()) === 0 && (await p.page.getByRole("button", { name: /Pause the sequence/ }).count()) === 0, "…no hold and no pause");
    await open(p.page, "/admin/placed/desk");
    await p.page.getByTestId("desk-readonly").waitFor({ timeout: 20000 });
    check((await p.page.getByTestId("desk-row").count()) === 0, "…and the desk page shows no one and no number");
    const res = await p.page.request.get(`${BASE}/admin/placed/desk/download`);
    check(res.status() === 404, "…and the download is not there for a pastor");
    await p.ctx.close();
  }

  // ---- The owner: the download switch and the numbers --------------------------------------------------------------------------------------------------------
  const download = async () => {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin/placed/desk");
    await open(a.page, "/admin/placed/desk");
    await a.page.getByTestId("desk-download").waitFor({ timeout: 20000 });
    const off = (await a.page.getByTestId("desk-download-off").count()) === 1;
    const res = await a.page.request.get(`${BASE}/admin/placed/desk/download`);
    const out = { off, status: res.status(), body: res.status() === 200 ? await res.text() : "" };
    await a.ctx.close();
    return out;
  };
  {
    const d = await download();
    check(d.off && d.status === 404, "the download with numbers is off, and there is no file");
  }
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, o.owner.email, "/home");
    await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
    await page.getByLabel("Passphrase").fill(PHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
    await open(page, "/god/features");
    const card = page.getByTestId("placed-answers-settings");
    await card.waitFor({ timeout: 20000 });
    await card.getByLabel(/Hours to wait after the placement email/).fill("30");
    await card.getByTestId("answers-download-switch").check();
    check(await card.getByRole("button", { name: "Save" }).isDisabled(), "a change cannot be saved without a reason");
    await card.getByLabel(/Why are you changing it/).fill("Switching the call desk download on for the follow-up week");
    await shot(page, "53-owner-settings");
    await card.getByRole("button", { name: "Save" }).click();
    await eventually("the setting is saved", async () => {
      const r = await one("select second_after_hours as h, numbers_download as d from public.placed_answers_settings");
      return Number(r?.h) === 30 && r?.d === true;
    });
    check((await n("select count(*)::int as n from public.event_log where action = 'placed_answers.settings'")) >= 1, "…and the change is logged");
    await ctx.close();
  }
  {
    const d = await download();
    check(!d.off && d.status === 200, "with the switch on, an admin can download the desk");
    const lines = d.body.split("\r\n");
    check(lines[0] === "Name,Tribe,List,Time of day,Tries,Last outcome,Number", "…a file with its heading");
    check(d.body.includes("2348035672233"), "…and the number of the member still waiting");
    has("…whose last line says who downloaded it and when", /^"?Downloaded by .* on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\. \d+ members?\. Private: call only, then delete\."?$/, lines[lines.length - 1]);
    check((await n("select count(*)::int as n from public.placed_downloads")) === 1, "…and the download is on the record");
    check((await n("select count(*)::int as n from public.placed_downloads where row_to_json(placed_downloads)::text like '%2348035672233%'")) === 0, "…without the numbers");
  }
  await q.query("update public.placed_answers_settings set numbers_download = false, second_after_hours = 24, reason = null");

  // ---- A leader writes the one line --------------------------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    const page = l.page;
    await signIn(page, T.leader.email, "/lead/tribe");
    await open(page, "/lead/tribe");
    await page.getByTestId("seat-line").waitFor({ timeout: 30000 });
    await page.locator("#seat-line-input").fill("Come and see: https://example.org/win");
    await page.getByRole("button", { name: "Save my line" }).click();
    await page.getByTestId("seat-line").getByRole("alert").waitFor({ timeout: 15000 });
    check((await one("select seat_line from public.tribes where id = $1", [T.tribe]))?.seat_line === null, "a line with a web address is refused, and nothing is saved");
    await page.locator("#seat-line-input").fill("I am praying for this tribe, and I cannot wait to meet you.");
    await page.getByRole("button", { name: "Save my line" }).click();
    await eventually("the line is saved", async () => (await one("select seat_line from public.tribes where id = $1", [T.tribe]))?.seat_line === "I am praying for this tribe, and I cannot wait to meet you.");
    await shot(page, "53-leader-line");
    await l.ctx.close();
  }

  // ---- Off again: today's page, and an old email's Stop link still stops -----------------------------------------------------------------------------------
  await o.call("god_unlock", PHRASE); // the owner's sign-in above unlocked a session of its own
  await owner("placed_answers", "off");
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${linkOf(mail[hauwa.id], "confirm")}`);
    await m.page.getByRole("button", { name: /Yes, I.m in/ }).first().waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("placed-more").count()) === 0, "Off again: the member’s page is today’s page, and a link already sent still works");
    await open(m.page, `/placed/${linkOf(mail[hauwa.id], "stop")}?a=stop`);
    await m.page.getByTestId("placed-stop-only").waitFor({ timeout: 20000 });
    await m.page.getByTestId("placed-stop").click();
    await m.page.getByTestId("placed-answer-done").waitFor({ timeout: 20000 });
    check((await answers(hauwa.id)).some((a) => a.kind === "stop_reminders"), "…and the Stop link in an old email still stops the reminders");
    await m.ctx.close();
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin");
    await open(a.page, "/admin");
    await a.page.getByRole("heading", { name: "Today" }).waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("placed-answers-card").count()) === 0, "…and Today has no line");
    await a.ctx.close();
  }

  // ---- Put everything back ----------------------------------------------------------------------------------------------------------------------------------
  await q.query("create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$");
  await q.query("delete from public.feature_settings");
  for (const t of ["placed_calls", "placed_answers", "placed_holds", "placed_reveals", "placed_downloads", "placed_seq_sends", "placed_seq"]) await q.query(`delete from public.${t}`);
  await q.query("delete from public.placement_holds where person_id = any($1)", [ids]);
  await q.query("update public.tribes set seat_line = null where id = $1", [T.tribe]);
  await q.query("update public.placed_answers_settings set second_after_hours = 24, numbers_download = false, paused = false, swept_at = null, reason = null");
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.seasons set status = $2::public.season_status where id = $1", [S, wasStatus]);
  for (const s of setAside) await q.query("update public.seasons set status = $2::public.season_status where id = $1", [s.id, s.status]);
  await q.query("update public.tribes set status = 'approved' where id = any($1::uuid[])", [wasApproved]);
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.tribe_members set placement_source = 'auto' where id = any($1::uuid[])", [stray]);
  await q.query("commit");
  await browser.close();
  await q.end();
  finish("53-placed-answers");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

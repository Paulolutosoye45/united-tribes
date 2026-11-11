/**
 * The placed-member nudge, end to end: the church writes to the members it placed who have not yet said yes, and each member answers from a private page.
 *
 *  - Off: the office is not offered the audience, there is no card on Today, and a member's private page is today's page (three buttons, no "message me on WhatsApp").
 *  - Rehearsal: the composer counts who would get it and why the rest are left out, the wording and the locked line about who sees a number are there, a test goes to the
 *    writer alone (three links, the locked line, no number), and the Send button is off.
 *  - On: Today carries the card, the office sends, and exactly the members who are waiting get one email each, each with its own private links that are not kept in the message
 *    row. A member who pressed Don't share my details, and one placed a few hours ago, get nothing.
 *  - The private page on a phone: opening saves nothing; both buttons say yes to the tribe, and only the first agrees to WhatsApp; a number that does not look right stops the
 *    press and the place is still held; the number a member signs in with is confirmed on the spot; a member who already agreed is asked only to say yes.
 *  - A link that ran out says so and offers a fresh one, sent by email.
 *  - The leader's list says the church reminded the member who is still waiting; Contact gaps shows who is confirmed; the owner changes the three numbers with a reason.
 *  - Off again: the page is today's page again.
 *
 * What is only arranged here (a running season, a tribe, placed members with their placement emails) is arranged in the database the way the database tests do it;
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
const mailsTo = async (address: string, subject = /One tap keeps your place/) => (await emails()).filter((m) => m.to.includes(address) && subject.test(m.subject));
const linkOf = (m: Mail | undefined, a: "confirm" | "change" | "withhold") => new RegExp(`/placed/([a-f0-9]{64})\\?a=${a}`).exec(m?.text ?? "")?.[1] ?? "";
const sentOnce = async () => {
  for (let i = 0; i < 6; i++) {
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

  // ---- Arranging: everything Off; a running season; one tribe whose members are in seven situations ------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  for (const t of ["placed_nudges", "placed_links", "number_confirmations"]) await q.query(`delete from public.${t}`);
  await q.query("update public.placed_nudge_settings set first_after_hours = 24, spacing_days = 3, max_per_seat = 2, reason = null");
  // the heartbeat sends only between 9 am and 7 pm Lagos time: hold the clock at noon for this journey (put back at the end)
  await q.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "nudge.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);

  const T = await k.tribe(S, { name: "Nudge Alpha", track: "builders", capacity: 12 });
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [T.leader.id]);
  const named = async <P extends { id: string }>(p: P, name: string): Promise<P> => {
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [p.id, name, name.split(" ")[0]]);
    return p;
  };
  const ada = await named(await k.seat(T.tribe, S, "Ada Signin"), "Ada Signin"); //     no number; signs in with a phone number
  const bola = await named(await k.seat(T.tribe, S, "Bola Email"), "Bola Email"); //   no number; will choose email only
  const chika = await named(await k.seat(T.tribe, S, "Chika Typo"), "Chika Typo"); //  no number; first types one that is wrong
  const dayo = await named(await k.seat(T.tribe, S, "Dayo Agreed"), "Dayo Agreed"); //  a number and a yes to WhatsApp already
  const efe = await named(await k.seat(T.tribe, S, "Efe Private"), "Efe Private"); //  pressed Don't share my details
  const fola = await named(await k.seat(T.tribe, S, "Fola Recent"), "Fola Recent"); //  placed two hours ago
  const hauwa = await named(await k.seat(T.tribe, S, "Hauwa Waiting"), "Hauwa Waiting"); // stays waiting to the end
  const people = [ada, bola, chika, dayo, efe, fola, hauwa];
  const ids = people.map((p) => p.id);
  const admin = await k.staff("Nudge Admin", "admin");
  await q.query("update public.people set full_name = 'Nudge Admin', preferred_name = 'Ada Admin' where id = $1", [admin.id]);
  await q.query("delete from public.messages where person_id = any($1::uuid[])", [[...ids, T.leader.id, admin.id]]);
  await q.query("delete from public.contact_preferences where person_id = any($1)", [ids]);
  await q.query("delete from public.consents where person_id = any($1) and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [ids]);
  await q.query("delete from public.care_flags where person_id = any($1)", [ids]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035672233', 'whatsapp')", [dayo.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [dayo.id]);
  await q.query("update auth.users set phone = '2348037770052' where id = $1", [ada.id]);

  // the church placed all seven (the seat says so), and told each by email: five of them a day and a half ago, Fola two hours ago
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null, contact_withheld = (person_id = $3) where tribe_id = $1 and person_id = any($2::uuid[])", [T.tribe, ids, efe.id]);
  await q.query("commit");
  const seat = async (id: string) => (await one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [id, T.tribe]))!.id as string;
  const tms: Record<string, string> = {};
  for (const p of people) {
    tms[p.id] = await seat(p.id);
    const hours = p.id === fola.id ? 2 : 30;
    await q.query(
      "insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', $2, 'sent', $3, now(), now() - $4::interval)",
      [p.id, JSON.stringify({ tribe: "Nudge Alpha", leader_first: "Lara" }), `placement:${tms[p.id]}`, `${hours} hours`],
    );
  }
  const mint = async (person: string) => (await one("select public.placement_token_mint($1, $2, 60) as t", [tms[person], person]))!.t as string;
  const seatOf = async (person: string) => await one("select status::text as status, confirmed_at, contact_withheld from public.tribe_members where id = $1", [tms[person]]);
  const yes = async (person: string) => await n("select count(*)::int as n from public.consents where person_id = $1 and purpose = 'whatsapp' and granted and version = 'placed-v1'", [person]);
  const phoneOf = async (person: string) => (await one("select phone, preferred::text as preferred from public.contact_preferences where person_id = $1", [person])) ?? {};
  const confirmed = async (person: string) => (await one("select public.number_confirmed($1) as c", [person]))?.c ?? null;
  const PRESS = /Yes, I.m in/;

  const owner = (feature: string, position: string) =>
    o.call("god_feature_set", feature, "platform", null, position, [], "Trying the placed nudge in the journey", null);
  await owner("contact_gaps", "on");

  const browser = await launch();
  const composer = `/admin/announcements/new?audience=placed_waiting&tribe=${T.tribe}`;

  // ---- Off: nothing is offered, and the member's page is today's page --------------------------------------------------------------------------------------
  const offLink = await mint(hauwa.id);
  {
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin");
    await open(a.page, "/admin");
    await a.page.getByRole("heading", { name: "Today" }).waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("placed-nudge-card").count()) === 0, "Off: Today has no card for the placed members");
    await open(a.page, "/admin/announcements/new");
    await a.page.getByText("Who is this for?", { exact: true }).waitFor({ timeout: 20000 });
    check((await a.page.getByText("Placed by the church, waiting for a reply").count()) === 0, "…and the composer does not offer the new audience");
    await a.ctx.close();

    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${offLink}`);
    await m.page.getByRole("button", { name: PRESS }).first().waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("placed-two-buttons").count()) === 0, "…and a member's private page is today's page (no two-button answer)");
    check((await m.page.getByRole("button", { name: "Show me other tribes" }).count()) === 1, "…with its three buttons");
    await m.ctx.close();
  }

  // ---- Rehearsal: counts, wording, a test to the writer, and no Send ---------------------------------------------------------------------------------------
  await owner("placed_nudge", "rehearsal");
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, composer);
    await open(page, composer);
    await page.getByTestId("nudge-options").waitFor({ timeout: 20000 });
    check((await page.getByTestId("nudge-rehearsal").count()) === 1, "Rehearsal: the composer says nothing will be sent to members");
    await page.getByTestId("audience-count").getByText(/people will get this/).waitFor({ timeout: 20000 });
    const counted = await page.getByTestId("audience-count").innerText();
    has("it counts the five who are waiting and says why two are left out", /5\s*people will get this[\s\S]*2 more are left out automatically/, counted);
    has("…naming the reasons, never the people", /1 pressed don’t share my details/i, counted);
    has("…and the one placed a few hours ago", /1 placed less than a day ago/i, counted);
    check(!/Efe|Fola|Ada|Bola/.test(counted), "…and no name is shown");
    await shot(page, "52-composer-count");
    await page.getByRole("button", { name: "Next: write it" }).click();
    await page.getByTestId("nudge-wording").waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Use the nudge wording" }).click();
    check(/One tap keeps your place in \{tribe\}/.test(await page.getByLabel("Subject").inputValue()), "Use the nudge wording fills the subject");
    has("the locked line about who can see a number cannot be taken out", /line about who can see a number is added to every nudge\. It cannot be taken out/, await page.getByTestId("nudge-locked").innerText());
    check((await page.getByLabel("Add a button").count()) === 0, "…and there is no button to add or change: the three are fixed");
    const frame = page.frameLocator('iframe[title="Email preview"]');
    await frame.getByText("Show me other tribes").first().waitFor({ timeout: 20000 });
    check((await frame.getByText(/Yes, I.m in/).count()) >= 1 && (await frame.getByText(/Don.t share my details/).count()) >= 1, "the preview shows the three answers");
    check((await frame.getByText(/can see your number only if you agree/).count()) >= 1, "…and the line about who sees a number");
    await shot(page, "52-composer-write");
    await page.getByRole("button", { name: "Next: when" }).click();
    await page.getByRole("button", { name: "Send a test to me" }).click();
    await page.getByText(/Sent to you\./).waitFor({ timeout: 15000 });
    check((await n("select count(*)::int as n from public.messages where template = 'office_message' and person_id = $1 and params ? 'test'", [admin.id])) === 1, "a test is queued for the writer, and nobody else");
    await page.getByRole("button", { name: "Next: review" }).click();
    const send = page.getByRole("button", { name: /Rehearsal: nothing will be sent/ });
    await send.waitFor({ timeout: 10000 });
    check(await send.isDisabled(), "Rehearsal: the Send button is off");
    has("the review lists the three answers as the button", /Yes, I.m in · Show me other tribes · Don.t share my details/, await text(page));
    await shot(page, "52-composer-review");
    await a.ctx.close();
  }
  await sentOnce();
  {
    const test = (await mailsTo(admin.email))[0];
    check(Boolean(test), "the test reaches the writer");
    if (test) {
      check(/^\[Test\] One tap keeps your place in /.test(test.subject), `…marked as a test, with the nudge subject ("${test.subject}")`);
      const secrets = ["confirm", "change", "withhold"].map((x) => linkOf(test, x as "confirm"));
      check(secrets.every((s) => s.length === 64) && new Set(secrets).size === 1, "…and three links to one private page: yes, other tribes, don’t share");
      check(/can see your number only if you agree to WhatsApp/.test(test.text), "…and the locked line");
      check(!/\d{7,}/.test(test.text.replace(/https?:\/\/\S+/g, "")), "…and no phone number anywhere in the words");
      check(test.html.includes("prefers-color-scheme:dark") && test.text.includes("Stop announcements"), "…with a dark mode and the unsubscribe");
      // the test's page belongs to nobody
      const p = await newPage(browser, "phone");
      await open(p.page, `/placed/${secrets[0]}`);
      await p.page.getByTestId("placed-nopage").waitFor({ timeout: 20000 });
      check((await p.page.getByTestId("placed-two-buttons").count()) === 0, "…and its link opens nothing for anyone");
      await p.ctx.close();
    }
    check((await mailsTo(ada.email)).length === 0, "Rehearsal: no member was written to");
  }

  // ---- On: the card on Today, and the send -----------------------------------------------------------------------------------------------------------------
  await owner("placed_nudge", "on");
  let broadcast = "";
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin");
    await open(page, "/admin");
    await page.getByTestId("placed-nudge-card").waitFor({ timeout: 20000 });
    has("On: Today says how many placed members are waiting", /\d+ placed members are waiting for a reply/, await page.getByTestId("placed-nudge-card").innerText());
    check(((await page.getByTestId("placed-nudge-go").getAttribute("href")) ?? "").endsWith("/admin/announcements/new?audience=placed_waiting"), "…with a button to the nudge");
    await shot(page, "52-today-card");

    await open(page, composer);
    await page.getByTestId("nudge-options").waitFor({ timeout: 20000 });
    check((await page.getByTestId("nudge-rehearsal").count()) === 0, "On: the Rehearsal note is gone");
    await eventually("the count reads five", async () => /5\s*people will get this/.test(await page.getByTestId("audience-count").innerText()));
    await page.getByRole("button", { name: "Next: write it" }).click();
    await page.getByRole("button", { name: "Use the nudge wording" }).click();
    await page.getByRole("button", { name: "Next: when" }).click();
    await page.getByRole("button", { name: "Next: review" }).click();
    await page.getByRole("button", { name: "Send to 5" }).click();
    await page.waitForURL(/\/admin\/announcements\/[0-9a-f-]{36}/, { timeout: 20000 });
    broadcast = /announcements\/([0-9a-f-]{36})/.exec(page.url())![1];
    await page.getByText(/Scheduled\./).first().waitFor({ timeout: 10000 });
    check(true, "sending schedules it");
    check((await n("select count(*)::int as n from public.broadcast_recipients where broadcast_id = $1 and status <> 'skipped'", [broadcast])) === 5, "…for the five members who are waiting");
    await a.ctx.close();
  }
  await eventually("the heartbeat sends all five", async () => {
    await tick();
    return (await Promise.all([ada, bola, chika, dayo, hauwa].map((p) => mailsTo(p.email)))).every((m) => m.length >= 1);
  }, 60);
  const mail: Record<string, Mail> = {};
  for (const p of [ada, bola, chika, dayo, hauwa]) mail[p.id] = (await mailsTo(p.email))[0];
  check((await mailsTo(efe.email)).length === 0, "Efe, who pressed Don’t share my details, gets nothing");
  check((await mailsTo(fola.email)).length === 0, "…and neither does Fola, placed two hours ago");
  check((await mailsTo(T.leader.email)).length === 0, "…nor the leader");
  const secrets = Object.values(mail).map((m) => linkOf(m, "confirm"));
  check(secrets.every((s) => s.length === 64) && new Set(secrets).size === 5, "each of the five has a private link of their own");
  check(Object.values(mail).every((m) => linkOf(m, "change") === linkOf(m, "confirm") && linkOf(m, "withhold") === linkOf(m, "confirm")), "…and all three buttons in one email use it");
  check(/^One tap keeps your place in Nudge Alpha/.test(mail[ada.id].subject) && /Hi Ada,/.test(mail[ada.id].text), "…with their own name and tribe");
  check(!/\d{7,}/.test(mail[dayo.id].text.replace(/https?:\/\/\S+/g, "")), "…and Dayo’s number is nowhere in the words");
  let kept = 0;
  for (const s of secrets) kept += await n("select count(*)::int as n from public.messages where params::text like $1", [`%${s}%`]);
  for (const s of secrets) kept += await n("select count(*)::int as n from public.event_log where meta::text like $1", [`%${s}%`]);
  check(kept === 0, "no private link is kept in a message row or the log (only a fingerprint)");
  check((await n("select count(*)::int as n from public.placed_nudges where tm_id = any($1::uuid[])", [Object.values(tms)])) === 5, "…and each nudge is on the record, once");

  // ---- The member's page, on a phone -----------------------------------------------------------------------------------------------------------------------
  {
    // Ada: signs in with a number; opening saves nothing
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[ada.id], "confirm")}?a=confirm`);
    await page.getByTestId("placed-two-buttons").waitFor({ timeout: 20000 });
    has("the page leads with the answer", /Yes, I.m in Nudge Alpha/, await text(page));
    check((await page.getByTestId("placed-yes-whatsapp").count()) === 1 && (await page.getByTestId("placed-yes-email").count()) === 1, "it has two buttons: message me on WhatsApp, and email only");
    has("…the first says what it agrees to", /Yes, I.m in, and message me on WhatsApp/, await text(page));
    has("…and the second says it is email only", /Yes, I.m in, email only/, await text(page));
    check((await page.getByTestId("placed-number-box").count()) === 1, "a member with no number is offered a box for one");
    check((await page.locator("#placed-phone").inputValue()) === "", "…which is empty");
    check(!(await page.getByTestId("placed-signin").isChecked()), "…and the sign-in tick is not ticked for them");
    has("…which names the number they sign in with, middle hidden", /Use [^\n]*•[^\n]*, the number I sign in with/, await text(page));
    check(!/2348037770052|\+2348037770052|234 803 777 0052/.test(await text(page)), "…and never shows it whole");
    check((await seatOf(ada.id))?.confirmed_at === null && (await yes(ada.id)) === 0, "opening the page saved nothing");
    await noOverflow(page, "the nudge page on a phone");
    await shot(page, "52-page-phone");
    await page.setViewportSize({ width: 320, height: 700 });
    await noOverflow(page, "the nudge page at 320 px");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("placed-signin").check();
    await page.getByTestId("placed-yes-whatsapp").click();
    await page.getByTestId("placed-thanks").waitFor({ timeout: 20000 });
    has("Ada presses the first button: it thanks her, says her leader can message her, and says her number is confirmed", /You are in Nudge Alpha\. Lara can now message you on WhatsApp[\s\S]*number you sign in with, so it is confirmed/, await text(page));
    check((await seatOf(ada.id))?.confirmed_at !== null, "her place is confirmed");
    check((await yes(ada.id)) === 1, "…with her yes to WhatsApp, in the words of this answer");
    check((await phoneOf(ada.id)).phone === "+2348037770052", "…and her sign-in number saved");
    check((await confirmed(ada.id)) === "signin", "…which counts as confirmed, with no message needed");
    await shot(page, "52-page-thanks");
    await m.ctx.close();
  }
  {
    // Bola: email only
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[bola.id], "confirm")}`);
    await page.getByTestId("placed-two-buttons").waitFor({ timeout: 20000 });
    check((await page.getByTestId("placed-signin").count()) === 0, "a member who signs in with email has no sign-in number to offer");
    await page.getByTestId("placed-yes-email").click();
    await page.getByTestId("placed-thanks").waitFor({ timeout: 20000 });
    has("Bola presses email only: it says her leader will write", /You are in Nudge Alpha\. Lara will write to you by email/, await text(page));
    check((await seatOf(bola.id))?.confirmed_at !== null, "her place is confirmed");
    check((await yes(bola.id)) === 0 && !(await phoneOf(bola.id)).phone, "…and no WhatsApp yes and no number were written");
    await m.ctx.close();
  }
  {
    // Chika: a number that does not look right stops the press; a good one goes through, but it is not confirmed
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[chika.id], "confirm")}`);
    await page.getByTestId("placed-number-box").waitFor({ timeout: 20000 });
    await page.locator("#placed-phone").fill("12345");
    await page.getByTestId("placed-yes-whatsapp").click();
    await page.getByTestId("placed-number-problem").waitFor({ timeout: 20000 });
    has("Chika types a wrong number: the page says so and that her place is still held", /That number does not look right[\s\S]*Your place is still held/, await text(page));
    check((await seatOf(chika.id))?.confirmed_at === null && (await yes(chika.id)) === 0 && !(await phoneOf(chika.id)).phone, "…and nothing at all was saved");
    await shot(page, "52-page-bad-number");
    await page.locator("#placed-phone").fill("+234 803 555 1212");
    await page.getByTestId("placed-yes-whatsapp").click();
    await page.getByTestId("placed-thanks").waitFor({ timeout: 20000 });
    check((await seatOf(chika.id))?.confirmed_at !== null && (await yes(chika.id)) === 1 && (await phoneOf(chika.id)).phone === "+2348035551212", "a good number saves the place, the yes and the number together");
    check((await confirmed(chika.id)) === null, "…but it is not confirmed: it is not the one she signs in with");
    check(!(await page.getByText(/so it is confirmed/).count()), "…and the page does not say it is");
    await m.ctx.close();
  }
  {
    // Dayo: already agreed, with a number: asked only to say yes
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${linkOf(mail[dayo.id], "confirm")}`);
    await page.getByTestId("placed-two-buttons").waitFor({ timeout: 20000 });
    has("Dayo, who already agreed to WhatsApp and has a number, is only asked to say yes", /You are nearly there[\s\S]*You already agreed to WhatsApp/, await text(page));
    check((await page.getByTestId("placed-number-box").count()) === 0 && (await page.getByTestId("placed-yes-email").count()) === 0, "…with no box and no second button");
    await page.getByRole("button", { name: PRESS }).first().click();
    await page.getByTestId("placed-thanks").waitFor({ timeout: 20000 });
    check((await seatOf(dayo.id))?.confirmed_at !== null && (await phoneOf(dayo.id)).phone === "+2348035672233", "his place is confirmed and his number is as it was");
    check((await confirmed(dayo.id)) === null, "…and it is not confirmed as reaching him until a message is answered");
    await m.ctx.close();
  }

  // ---- A link that ran out ---------------------------------------------------------------------------------------------------------------------------------
  {
    const old = await mint(hauwa.id);
    const hash = (await one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [old]))!.h as string;
    await q.query("update public.placed_links set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    await q.query("update public.placement_tokens set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${old}`);
    await page.getByTestId("placed-nopage").waitFor({ timeout: 20000 });
    check((await page.getByTestId("placed-nopage").getAttribute("data-why")) === "expired", "an old link says it ran out, not that it is invalid");
    has("…and offers a fresh one", /This link has run out/, await text(page));
    await noOverflow(page, "the ran-out page on a phone");
    await shot(page, "52-page-expired");
    await page.getByTestId("placed-fresh-link").click();
    await page.getByTestId("placed-fresh-sent").waitFor({ timeout: 20000 });
    check((await n("select count(*)::int as n from public.messages where person_id = $1 and template = 'placement_reminder' and reply_token ~ '^[a-f0-9]{64}$'", [hauwa.id])) === 1, "pressing it queues one email to her, with a new link");
    await page.goto(`${BASE}/placed/${"c".repeat(64)}`);
    await page.getByTestId("placed-nopage").waitFor({ timeout: 20000 });
    check((await page.getByTestId("placed-nopage").getAttribute("data-why")) === "unknown" && (await page.getByTestId("placed-fresh-link").count()) === 0, "a link we never made says so, and offers no fresh one");
    await m.ctx.close();
  }

  // ---- The leader, and Contact gaps ------------------------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, T.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("leading-people").waitFor({ timeout: 20000 });
    await l.page.getByTestId("leading-reminded").first().waitFor({ timeout: 20000 });
    const reminded = await l.page.getByTestId("leading-reminded").allInnerTexts();
    check(reminded.length === 1 && /The church reminded Hauwa on /.test(reminded[0]), `the leader’s list says the church reminded the one who is still waiting (${reminded.length})`);
    check(!/Chika|Dayo/.test(reminded.join(" ")), "…and says nothing of those who have answered");
    await shot(l.page, "52-leader");
    await l.ctx.close();
  }
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin/people/contact-gaps");
    await open(page, `/admin/people/contact-gaps?tribe=${T.tribe}`);
    await page.getByTestId("gap-causes").waitFor({ timeout: 20000 });
    has("Contact gaps shows how many are confirmed on WhatsApp", /Confirmed on WhatsApp: \d+ of \d+/, await page.getByTestId("confirmed-counts").innerText());
    check((await page.locator("th", { hasText: "Number confirmed" }).count()) === 1, "…and a Number confirmed column");
    check(((await page.getByTestId("gaps-nudge-link").getAttribute("href")) ?? "").includes("audience=placed_waiting"), "…and a link to nudge the members the church placed");
    await shot(page, "52-gaps");
    await a.ctx.close();
  }

  // ---- The owner changes the three numbers -----------------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, o.owner.email, "/home");
    await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
    await page.getByLabel("Passphrase").fill(PHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
    await open(page, "/god/features");
    const card = page.getByTestId("placed-nudge-settings");
    await card.waitFor({ timeout: 20000 });
    await card.getByLabel(/Hours to wait after the placement email/).fill("36");
    check(await card.getByRole("button", { name: "Save" }).isDisabled(), "a change cannot be saved without a reason");
    await card.getByLabel(/Why are you changing it/).fill("Trying a longer wait before the first nudge");
    await shot(page, "52-owner-settings");
    await card.getByRole("button", { name: "Save" }).click();
    await eventually("the setting is saved", async () => Number((await one("select first_after_hours as h from public.placed_nudge_settings"))?.h) === 36);
    check((await n("select count(*)::int as n from public.event_log where action = 'placed_nudge.settings'")) >= 1, "…and the change is logged");
    await q.query("update public.placed_nudge_settings set first_after_hours = 24, reason = null");
    await ctx.close();
  }

  // ---- Off again: today's page ----------------------------------------------------------------------------------------------------------------------------
  await o.call("god_unlock", PHRASE); // the owner's sign-in above unlocked a session of its own
  await owner("placed_nudge", "off");
  {
    const m = await newPage(browser, "phone");
    await open(m.page, `/placed/${linkOf(mail[hauwa.id], "confirm")}`);
    await m.page.getByRole("button", { name: PRESS }).first().waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("placed-two-buttons").count()) === 0 && (await m.page.getByRole("button", { name: "Show me other tribes" }).count()) === 1, "Off again: the member’s page is today’s page, and a link already sent still works");
    await m.ctx.close();
    const a = await newPage(browser, "desktop");
    await signIn(a.page, admin.email, "/admin");
    await open(a.page, "/admin");
    await a.page.getByRole("heading", { name: "Today" }).waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("placed-nudge-card").count()) === 0, "…and Today has no card");
    await a.ctx.close();
  }

  // ---- Put everything back ----------------------------------------------------------------------------------------------------------------------------------
  await q.query("create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$");
  await q.query("delete from public.feature_settings");
  for (const t of ["placed_nudges", "placed_links", "number_confirmations"]) await q.query(`delete from public.${t}`);
  await q.query("update public.placed_nudge_settings set first_after_hours = 24, spacing_days = 3, max_per_seat = 2, reason = null");
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.seasons set status = $2::public.season_status where id = $1", [S, wasStatus]);
  for (const s of setAside) await q.query("update public.seasons set status = $2::public.season_status where id = $1", [s.id, s.status]);
  await q.query("update public.tribes set status = 'approved' where id = any($1::uuid[])", [wasApproved]);
  await browser.close();
  await q.end();
  finish("52-placed-nudge");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

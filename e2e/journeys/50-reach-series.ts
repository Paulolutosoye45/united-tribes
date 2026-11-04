/**
 * The contact series and the tribe note (seats and contacts, Package 5), end to end.
 *
 *  - The leader sees how many of the tribe can be messaged on WhatsApp, presses "Ask my members" with a line of their own, and the church emails each
 *    person who has a gap, in the leader's name, with the line quoted and a private link that is only theirs.
 *  - The member opens the link on a phone with no sign-in. Opening it saves nothing and ticks nothing. A number that does not look right is refused in
 *    words. The number they sign in with is offered with its middle hidden, and used only when they press the button. A member who has a number and no yes
 *    sees one tick and no number box. "I would rather be emailed" ends it for the season. A link that has run out says so and sends a new one.
 *  - The leader's strip changes with it: who can now be messaged, who chose email, who was asked how many times; "I'll follow this up myself" holds the
 *    emails to one person; the tribe note goes to everyone who can be emailed, with a button to add a number only for those who still have a gap.
 *  - The office sees where each person stands, can narrow the list by stage, pause the series for everyone and stop it for one person, each with a reason,
 *    and downloads a file with the stage and no phone number.
 *  - The owner changes the series settings on the Features page, with a reason.
 *  - "Yes, I'm in" carries the same two boxes for a placed member who has no number, and a number that does not look right stops the confirm.
 *  - Nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a season, a tribe with five members in five situations, a placed member) is arranged in the database the way the database
 * tests do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

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
const toOf = (r: Received) => String((r.body.to as string[] | string)[0] ?? r.body.to);

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off; a tribe whose five members are in five situations ---------------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  for (const t of ["reach_sends", "reach_links", "reach_leader_asks", "tribe_notes", "reach_enrolments"]) await q.query(`delete from public.${t}`);
  await q.query("update public.reach_settings set first_go_hours = 24, release_after_days = 6, note_per_week = 2, paused = false, paused_reason = null, swept_at = null");
  await q.query("delete from public.contact_asks");
  await q.query("delete from public.reach_prompts");
  // the heartbeat sends only between 9 am and 7 pm Lagos time: hold the clock at noon for this journey (put back at the end)
  await q.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "series.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
  const mine = await k.tribe(S, { name: "Series Tribe", track: "builders", capacity: 12 });
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [mine.leader.id]);
  const femi = await k.seat(mine.tribe, S, "Femi"); //   no number; signs in with a phone number
  const gozie = await k.seat(mine.tribe, S, "Gozie"); // a number, but no yes to WhatsApp
  const hauwa = await k.seat(mine.tribe, S, "Hauwa"); // a number and a yes: nothing to put right
  const ify = await k.seat(mine.tribe, S, "Ify"); //     no number; will choose email
  const jide = await k.seat(mine.tribe, S, "Jide"); //   no number; her first link will run out
  const admin = await k.staff("Series Admin", "admin");
  const ids = [femi.id, gozie.id, hauwa.id, ify.id, jide.id];
  await q.query("delete from public.contact_preferences where person_id = any($1)", [ids]);
  await q.query("delete from public.consents where person_id = any($1) and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [ids]);
  await q.query("delete from public.care_flags where person_id = any($1)", [ids]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348034561122', 'email')", [gozie.id]);
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035672233', 'whatsapp')", [hauwa.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [hauwa.id]);
  await q.query("update auth.users set phone = '2348036665544' where id = $1", [femi.id]);
  const nameOf = async (id: string) => String((await one("select preferred_name as n from public.people where id = $1", [id]))?.n);
  const gaps = (id: string) => n("select count(*)::int n from public.consents where person_id = $1 and purpose = 'whatsapp' and granted", [id]);

  const owner = (feature: string, position: string) =>
    o.call("god_feature_set", feature, "platform", null, position, [], "Trying the contact series in the journey", null);
  await owner("contact_gaps", "on");
  await owner("reach_series", "on");
  await owner("tribe_note", "on");

  const browser = await launch();

  // ---- The leader's strip, and "Ask my members" ----------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    const page = l.page;
    await signIn(page, mine.leader.email, "/lead");
    await open(page, "/lead");
    await page.getByTestId("reach-strip").waitFor({ timeout: 20000 });
    check((await page.getByTestId("reach-gaps").count()) === 0, "the one-by-one list is not shown beside the strip");
    has("the strip says how many can be messaged on WhatsApp", /1 of 5 can be messaged on WhatsApp\./, await page.getByTestId("reach-line").innerText());
    await shot(page, "50-leader-strip");
    await page.getByTestId("ask-open").click();
    await page.getByTestId("ask-panel").waitFor({ timeout: 10000 });
    has("it says who gets the email and that they choose what to share", /4 members have not added a WhatsApp number[\s\S]*Femi[\s\S]*the church sends the first email for you after a day/, await page.getByTestId("ask-panel").innerText());
    await page.getByLabel(/Add a line of your own/).fill("Please add it today, it really helps me look after you.");
    await shot(page, "50-leader-ask");
    await page.getByTestId("ask-confirm").click();
    await page.getByTestId("reach-said").waitFor({ timeout: 20000 });
    has("it says how many were emailed", /4 members have been emailed/, await page.getByTestId("reach-said").innerText());
    await eventually("the button waits three days", async () => (await page.getByTestId("ask-open").isDisabled().catch(() => false)) || (await page.getByTestId("ask-open").count()) === 0);
    check((await n("select count(*)::int n from public.reach_enrolments where tribe_id = $1 and not rehearsal and sends = 1", [mine.tribe])) === 4, "four people are in the series, each with email 1 queued");
    check((await n("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [mine.tribe])) === 5, "…and nobody has left the tribe");
    await l.ctx.close();
  }

  const t1 = await tick();
  check(t1.status === 200 && t1.body.problems.length === 0, `the heartbeat sends them (${t1.body.sent} sent, ${t1.body.problems.length} problems)`);
  let emails = await stub("email");
  const mailTo = (email: string, subject: RegExp) => [...emails].reverse().find((r) => toOf(r) === email && subject.test(String(r.body.subject)));
  const linkOf = (r: Received | undefined) => String(r?.body.text ?? "").match(/\/add-number\/([a-f0-9]{64})/)?.[1] ?? "";
  const femiMail = mailTo(femi.email, /Lara would like to message you on WhatsApp/);
  check(Boolean(femiMail), "Femi was emailed, and the subject names the leader");
  const femiText = String(femiMail?.body.text ?? "");
  has("…it quotes the leader's own line and says who can see a number", /Please add it today, it really helps me look after you\.[\s\S]*/, femiText);
  has("…and that the choice is hers", /Only your tribe.s leader, their assistant and your coach can see your number[\s\S]*It is your choice/, femiText);
  check(!/\+?234\d{6,}/.test(femiText), "…and carries no number");
  const links = {
    femi: linkOf(femiMail),
    gozie: linkOf(mailTo(gozie.email, /cannot use your number yet/)),
    ify: linkOf(mailTo(ify.email, /would like to message you/)),
    jide: linkOf(mailTo(jide.email, /would like to message you/)),
  };
  check(Object.values(links).every((l) => /^[a-f0-9]{64}$/.test(l)), "each of the four has a private link of its own");
  check(new Set(Object.values(links)).size === 4, "…and no two are the same");
  check(!emails.some((r) => toOf(r) === hauwa.email && /reach|WhatsApp/i.test(String(r.body.subject))), "Hauwa, who can be messaged, was not emailed");

  // ---- Femi: opens the link on a phone; nothing is saved by opening; a wrong number is refused; the sign-in number is used on request ---------------
  {
    const m = await newPage(browser, "phone", { expectStatuses: [] });
    const page = m.page;
    const before = await gaps(femi.id);
    await open(page, `/add-number/${links.femi}`);
    await page.getByTestId("reach-form").waitFor({ timeout: 20000 });
    has("the page greets her by name and says what is missing", /Femi, add your WhatsApp number/, await text(page));
    has("…in the leader's name", /Lara cannot message you on WhatsApp yet, because we have no number for you/, await page.getByTestId("reach-body").innerText());
    check(!(await page.getByTestId("reach-agree").isChecked()), "the WhatsApp box is not ticked for her");
    check((await gaps(femi.id)) === before && (await n("select count(*)::int n from public.contact_preferences where person_id = $1", [femi.id])) === 0, "opening the page saved nothing");
    check((await n("select coalesce(sum(clicks), 0)::int n from public.reach_links where person_id = $1", [femi.id])) >= 1, "…it only counted that the link was opened");
    const html = await page.content();
    check(!html.includes("8036665544") && /\+234•+44/.test(await page.getByTestId("reach-signin").innerText()), "the number she signs in with is shown with its middle hidden, and the page does not hold the whole of it");
    await noOverflow(page, "the add-number page on a phone");
    await shot(page, "50-member-page");

    await page.locator("#phone").fill("12345");
    await page.getByTestId("reach-agree").check();
    await page.getByTestId("reach-save").click();
    await page.getByRole("alert").filter({ hasText: /does not look right/ }).waitFor({ timeout: 15000 });
    check((await n("select count(*)::int n from public.contact_preferences where person_id = $1", [femi.id])) === 0, "a number that does not look right is refused in words, and nothing is saved");

    await page.getByTestId("reach-agree").check();
    await page.getByTestId("reach-signin").click();
    await page.getByTestId("reach-done").waitFor({ timeout: 20000 });
    has("using the sign-in number finishes it", /Thank you, Femi\.[\s\S]*Lara can now reach you on WhatsApp/, await page.getByTestId("reach-done").innerText());
    check((await one("select phone from public.contact_preferences where person_id = $1", [femi.id]))?.phone === "+2348036665544", "her sign-in number was saved, in full, on the server");
    check((await gaps(femi.id)) === 1, "…and her yes to WhatsApp, because she ticked it");
    check((await one("select outcome, fixed_by_email from public.reach_enrolments where person_id = $1 order by started_at desc limit 1", [femi.id]))?.outcome === "fixed", "…and her series ended as fixed");
    await shot(page, "50-member-done");
    await m.ctx.close();
  }

  // ---- Gozie has a number and no yes: one tick, no number box ----------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/add-number/${links.gozie}`);
    await page.getByTestId("reach-form").waitFor({ timeout: 20000 });
    has("the page asks for one tick", /Gozie, one tick to finish/, await text(page));
    check((await page.locator("#phone").count()) === 0, "…with no number box");
    has("…and shows her number with its middle hidden", /\+234•+22/, await page.getByTestId("reach-body").innerText());
    await noOverflow(page, "the one-tick page on a phone");
    await page.getByTestId("reach-save").click();
    await page.getByTestId("reach-partial").waitFor({ timeout: 15000 });
    check((await gaps(gozie.id)) === 0, "pressing the button without the tick does not give a yes, and the page says so");
    await page.getByTestId("reach-agree").check();
    await page.getByTestId("reach-save").click();
    await page.getByTestId("reach-done").waitFor({ timeout: 20000 });
    check((await gaps(gozie.id)) === 1, "ticking and pressing it gives the yes");
    await m.ctx.close();
  }

  // ---- Ify would rather be emailed ----------------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/add-number/${links.ify}`);
    await page.getByTestId("reach-email").waitFor({ timeout: 20000 });
    has("the page says what choosing email means", /We will not ask again this season/, await text(page));
    await page.getByTestId("reach-email").click();
    await page.getByText("We will email you.").waitFor({ timeout: 20000 });
    check((await one("select outcome from public.reach_enrolments where person_id = $1 order by started_at desc limit 1", [ify.id]))?.outcome === "email_only", "her series ended as “email only”");
    await open(page, `/add-number/${links.ify}`);
    await page.getByText("We will email you.").waitFor({ timeout: 20000 });
    check(true, "…and the link keeps saying so");
    await m.ctx.close();
  }

  // ---- Jide's link runs out, and she is sent a new one ----------------------------------------------------------------------------------------------------
  let jideNew = "";
  {
    await q.query("update public.reach_links set expires_at = now() - interval '1 day' where person_id = $1", [jide.id]);
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/add-number/${links.jide}`);
    await page.getByTestId("reach-expired").waitFor({ timeout: 20000 });
    has("an old link says it has run out", /This link has run out/, await text(page));
    await page.getByRole("button", { name: "Send me a new link" }).click();
    await page.getByTestId("link-sent").waitFor({ timeout: 20000 });
    await tick();
    emails = await stub("email");
    const fresh = mailTo(jide.email, /Your new link/);
    jideNew = linkOf(fresh);
    check(/^[a-f0-9]{64}$/.test(jideNew) && jideNew !== links.jide, "a new link is emailed, and it is a different one");
    await open(page, `/add-number/${jideNew}`);
    await page.getByTestId("reach-form").waitFor({ timeout: 20000 });
    check(true, "…and it opens the form");
    await open(page, `/add-number/${"0".repeat(64)}`);
    await page.getByTestId("reach-invalid").waitFor({ timeout: 20000 });
    check(true, "a link that was never made says “This link isn’t valid.”");
    await m.ctx.close();
  }

  // ---- The leader again: the strip has moved; follow-up; the tribe note --------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    const page = l.page;
    await signIn(page, mine.leader.email, "/lead");
    await open(page, "/lead");
    await page.getByTestId("reach-strip").waitFor({ timeout: 20000 });
    has("the strip counts the ones who put it right", /3 of 5 can be messaged on WhatsApp\./, await page.getByTestId("reach-line").innerText());
    const who = (name: string) => page.getByTestId("reach-person").filter({ hasText: name });
    check((await who("Ify").getAttribute("data-status")) === "email_only" && /Wants email only/.test(await who("Ify").innerText()), "Ify shows as wanting email only");
    check((await who("Jide").getAttribute("data-status")) === "asked" && /Email 1 of 4 sent/.test(await who("Jide").innerText()), "Jide shows as asked once");
    check((await who("Femi").count()) === 0 && (await who("Gozie").count()) === 0, "…and those who put it right are off the list");
    const body = await page.getByTestId("reach-strip").innerText();
    check(!/\+?234\d{6,}|8036665544|8034561122|@/.test(body), "first names only, and no number");
    await shot(page, "50-leader-strip-after");

    await who("Jide").getByRole("button", { name: "I’ll follow this up myself" }).click();
    await page.getByText("Fine. Jide will not be emailed for three days.").waitFor({ timeout: 15000 });
    await eventually("Jide shows as followed up", async () => (await who("Jide").getAttribute("data-status")) === "follow_up");
    check((await who("Jide").getByRole("button").count()) === 0, "…and the button is gone");

    await page.getByTestId("note-open").click();
    await page.getByLabel("Your note").fill("Hello, tribe.\nWe meet as usual on Wednesday. Bring a friend.");
    await shot(page, "50-leader-note");
    await page.getByTestId("note-send").click();
    await page.getByTestId("reach-said").waitFor({ timeout: 20000 });
    has("the note says how many it went to", /Sent to 5 members\./, await page.getByTestId("reach-said").innerText());
    await l.ctx.close();
  }
  await tick();
  {
    const mails = await stub("email");
    const noteTo = (email: string) => [...mails].reverse().find((r) => toOf(r) === email && /A note from Lara/.test(String(r.body.subject)));
    const jideNote = String(noteTo(jide.email)?.body.text ?? "");
    has("Jide, who still has a gap, gets the note with a button to add her number", /Hello, tribe\.[\s\S]*Bring a friend\.[\s\S]*Add my number: .*\/add-number\/[a-f0-9]{64}/, jideNote);
    const hauwaNote = String(noteTo(hauwa.email)?.body.text ?? "");
    check(/Bring a friend\./.test(hauwaNote) && !/add-number/.test(hauwaNote), "Hauwa gets the same words and no button");
    check(Boolean(noteTo(ify.email)), "Ify, who chose email, is still sent the note");
  }

  // ---- The office ---------------------------------------------------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "desktop");
    const page = a.page;
    await signIn(page, admin.email, "/admin/people/contact-gaps");
    await page.getByTestId("series-section").waitFor({ timeout: 20000 });
    const row = (name: string) => page.locator("tr[data-cause]").filter({ hasText: "Series Tribe" }).filter({ hasText: name });
    await page.getByTestId("gaps-table").waitFor({ timeout: 20000 });
    check(/Chose email/.test(await row("Ify").innerText()), "the list says Ify chose email");
    check(/Leader is following up/.test(await row("Jide").innerText()), "…and that Jide's leader is following up");
    check((await row("Femi").count()) === 0 && (await row("Gozie").count()) === 0, "…and Femi and Gozie, who put it right, are not on it");
    const stats = await page.getByTestId("series-stats").innerText();
    has("the page says how it is going", /put it right/, stats);
    await shot(page, "50-office-list");

    await page.locator('[data-series="email_only"]').first().click();
    await page.waitForURL(/series=email_only/, { timeout: 15000 });
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });
    check((await page.locator('td[data-series-state]:not([data-series-state="email_only"])').count()) === 0, "pressing a stage shows only that stage");
    await open(page, "/admin/people/contact-gaps");
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });

    // pause for everyone, with a reason
    await page.getByTestId("series-pause").getByRole("button", { name: "Pause the series for everyone" }).click();
    const reason = page.getByLabel(/Why\? \(kept in the log\)/);
    await reason.fill("Checking the wording first");
    await page.getByTestId("series-pause").getByRole("button", { name: "Pause the series for everyone" }).click();
    await page.getByText(/The series is paused for everyone/).waitFor({ timeout: 20000 });
    check((await one("select paused from public.reach_settings"))?.paused === true, "pausing needs a reason and pauses the series for everyone");
    await page.getByTestId("series-pause").getByRole("button", { name: "Resume the series" }).click();
    await page.getByTestId("series-pause").getByRole("button", { name: "Resume the series" }).click();
    await eventually("the series is running again", async () => (await one("select paused from public.reach_settings"))?.paused === false);

    // stop it for one person, with a reason
    await open(page, "/admin/people/contact-gaps");
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });
    await row("Jide").getByRole("button", { name: "Stop" }).click();
    await row("Jide").getByLabel(/Why\?/).fill("She asked us to leave her be");
    await row("Jide").getByRole("button", { name: "Stop the series for this person" }).click();
    await eventually("Jide's series is stopped", async () => (await one("select outcome from public.reach_enrolments where person_id = $1 order by started_at desc limit 1", [jide.id]))?.outcome === "stopped");
    await open(page, "/admin/people/contact-gaps");
    await page.getByTestId("gaps-table").waitFor({ timeout: 15000 });
    check(/Stopped by the office/.test(await row("Jide").innerText()), "the list says Jide's series was stopped");

    const res = await page.request.get(`${BASE}/admin/people/contact-gaps/download`);
    const csv = await res.text();
    check(res.status() === 200 && /Contact series,Series emails sent/.test(csv), "the download has the stage and the number of emails");
    check(/Ify[^\n]*Chose email/.test(csv) && /Jide[^\n]*Stopped by the office/.test(csv), "…and says what each person chose");
    check(!/\+?234\d{6,}|0803\d{6,}|8034561122|8036665544/.test(csv), "…and no phone number in it");
    await a.ctx.close();
  }
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, mine.leader.email, "/lead");
    const res = await l.page.request.get(`${BASE}/admin/people/contact-gaps/download`);
    check(res.status() === 404, "a leader cannot open the download");
    await l.ctx.close();
  }

  // ---- The owner changes the settings ------------------------------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, o.owner.email, "/home");
    await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
    await page.getByLabel("Passphrase").fill(PHRASE);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
    await open(page, "/god/features");
    await page.getByTestId("reach-settings").waitFor({ timeout: 20000 });
    has("the card says when the emails go", /Emails go on day 0, 2, 4, 5 after the first\./, await page.getByTestId("reach-settings").innerText());
    const card = page.getByTestId("reach-settings");
    await card.getByLabel(/Hours the leader has/).fill("12");
    check(await card.getByRole("button", { name: "Save the settings" }).isDisabled(), "a change cannot be saved without a reason");
    await card.getByLabel(/Why are you changing it/).fill("Trying a shorter wait for leaders");
    await shot(page, "50-owner-settings");
    await card.getByRole("button", { name: "Save the settings" }).click();
    await eventually("the setting is saved", async () => Number((await one("select first_go_hours as h from public.reach_settings"))?.h) === 12);
    check((await n("select count(*)::int n from public.event_log where action = 'reach.settings'")) >= 1, "…and the change is logged");
    await ctx.close();
  }

  // ---- "Yes, I'm in" with the two boxes ---------------------------------------------------------------------------------------------------------------------------
  {
    const kemi = await k.seat(mine.tribe, S, "Kemi");
    await q.query("delete from public.contact_preferences where person_id = $1", [kemi.id]);
    await q.query("delete from public.consents where person_id = $1 and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [kemi.id]);
    await q.query("begin");
    await q.query("set local session_replication_role = replica");
    await q.query("update public.tribe_members set placement_source = 'auto', confirmed_at = null where person_id = $1 and tribe_id = $2", [kemi.id, mine.tribe]);
    await q.query("commit");
    const tm = (await one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [kemi.id, mine.tribe]))!.id as string;
    const raw = (await one("select public.placement_token_mint($1, $2, 60) as t", [tm, kemi.id]))!.t as string;
    const m = await newPage(browser, "phone");
    const page = m.page;
    await open(page, `/placed/${raw}`);
    const boxes = page.getByTestId("placed-reach");
    const reached = await boxes.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check(reached, "the placement page offers the two boxes to a member with no number");
    if (reached) {
      has("…as optional", /Add your WhatsApp number \(optional\)/, await boxes.innerText());
      check(!(await page.getByTestId("placed-agree").isChecked()), "…and the tick is not ticked for her");
      await noOverflow(page, "the placement page with the boxes on a phone");
      await shot(page, "50-placed-boxes");
      await page.locator("#placed-phone").fill("12345");
      await page.getByRole("button", { name: /Yes, I.m in/ }).click();
      await page.getByTestId("placed-number-problem").waitFor({ timeout: 20000 });
      check((await one("select confirmed_at from public.tribe_members where id = $1", [tm]))?.confirmed_at === null, "a number that does not look right stops “Yes, I’m in”, and the place waits");
      await page.locator("#placed-phone").fill("+234 803 999 8877");
      await page.getByTestId("placed-agree").check();
      await page.getByRole("button", { name: /Yes, I.m in/ }).click();
      await page.getByText(/Thank you\. You are in/).waitFor({ timeout: 20000 });
      check((await one("select phone from public.contact_preferences where person_id = $1", [kemi.id]))?.phone === "+2348039998877", "a good number is saved first");
      check((await gaps(kemi.id)) === 1 && (await one("select confirmed_at from public.tribe_members where id = $1", [tm]))?.confirmed_at !== null, "…and her yes, and then the place is confirmed");
    }
    await m.ctx.close();
  }

  // ---- Put everything back ---------------------------------------------------------------------------------------------------------------------------------------------
  await q.query("create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$");
  await q.query("delete from public.feature_settings");
  for (const t of ["reach_sends", "reach_links", "reach_leader_asks", "tribe_notes", "reach_enrolments"]) await q.query(`delete from public.${t}`);
  await q.query("update public.reach_settings set first_go_hours = 24, paused = false, paused_reason = null, swept_at = null");
  await browser.close();
  await q.end();
  void nameOf;
  finish("50-reach-series");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

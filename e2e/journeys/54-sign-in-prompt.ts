/**
 * The sign-in prompt, end to end.
 *
 *  - Off: signing in is today's page, with no screen, and nothing is remembered or logged.
 *  - Rehearsal: still no screen; the log counts who would have seen which task.
 *  - On: a member the church placed sees the placement first on top of the page they asked for ("1 of 2"), says yes (the same answer the email's button records), and goes on
 *    to the second task, a WhatsApp number, which is saved with the yes to WhatsApp unticked. The seat is confirmed, the number is on file, and the log says answered.
 *  - The next sign-in asks the one question that is left (may we message you on WhatsApp), and a No is final: the sign-in after that shows nothing.
 *  - Not now closes a task for the visit only: a reload in the same sign-in does not bring it back, and a new sign-in does. The seat is untouched.
 *  - Not this season (with its confirmation step) is the private page's answer: the seat is released, the member is kept out of the automatic placement.
 *  - A task that opens its own page (the joining form) goes there with "Open it", and no second screen covers the page.
 *  - A leader with no number is asked for one too, and on a phone nothing scrolls sideways.
 *  - The switch off again: no screen, and the answers given stay where they are.
 *
 * What is only arranged here (a running season, a tribe, placed members) is arranged in the database the way the database tests do it; everything a person does is done in
 * the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
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

const SCREEN = "signin-prompt";
const screen = (page: Page) => page.getByTestId(SCREEN);
const kindOf = async (page: Page) => (await screen(page).getAttribute("data-kind")) ?? "";
/** The screen is drawn when the page has settled; nothing owed means it never appears. */
async function appears(page: Page, ms = 12000) {
  return screen(page)
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
}
async function stays(page: Page) {
  // Give the page time to draw, then look: a screen that is going to appear has appeared
  await page.waitForLoadState("networkidle").catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  return screen(page).isVisible();
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off; a running season; one tribe whose members are in several situations ---------------------------------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  for (const t of ["prompt_log", "prompt_visits", "prompt_streaks"]) await q.query(`delete from public.${t}`);
  await q.query("update public.prompt_settings set visit_hours = 4, max_tasks = 3, last_hours = 6, worth_call_after = 5, kinds_off = '{}'");
  for (const t of ["placed_calls", "placed_answers", "placed_holds", "placed_reveals", "placed_downloads", "placed_seq_sends", "placed_seq"]) await q.query(`delete from public.${t}`);
  await q.query("delete from public.seat_clocks");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "prompt.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);

  const T = await k.tribe(S, { name: "Prompt Alpha", track: "builders", capacity: 12 });
  // seats that earlier journeys left marked as placed by the church would be prompted too: set them aside for this journey (put back at the end)
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
  const ada = await named(await k.seat(T.tribe, S, "Ada Yes"), "Ada Yes"); //            placed, no number: says yes, then adds a number, then answers WhatsApp next time
  const bola = await named(await k.seat(T.tribe, S, "Bola Later"), "Bola Later"); //     placed, number and WhatsApp agreed: Not now, twice
  const chika = await named(await k.seat(T.tribe, S, "Chika Season"), "Chika Season"); // placed, number and WhatsApp agreed: Not this season
  const people = [ada, bola, chika];
  const ids = people.map((p) => p.id);
  const joy = await named(await k.person("Joy Joiner"), "Joy Joiner"); //                 has started the joining form and not sent it
  await q.query("delete from public.messages where person_id = any($1::uuid[])", [[...ids, joy.id, T.leader.id]]);
  await q.query("delete from public.contact_preferences where person_id = any($1)", [[...ids, T.leader.id]]);
  await q.query("delete from public.consents where person_id = any($1) and purpose in ('whatsapp', 'sms', 'email', 'announcements')", [[...ids, T.leader.id]]);
  await q.query("delete from public.care_flags where person_id = any($1)", [ids]);
  await q.query("delete from public.placement_holds where person_id = any($1)", [ids]);
  for (const p of [bola, chika]) {
    await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [p.id, p === bola ? "+2348035670001" : "+2348035670002"]);
    await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [p.id]);
  }
  await q.query("insert into public.intake_drafts (person_id, step) values ($1, 'story') on conflict (person_id) do nothing", [joy.id]);

  // the church placed all three (the seat says so)
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null, contact_withheld = false where tribe_id = $1 and person_id = any($2::uuid[])", [T.tribe, ids]);
  await q.query("commit");
  const tms: Record<string, string> = {};
  for (const p of people) {
    tms[p.id] = (await one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [p.id, T.tribe]))!.id as string;
    await q.query(
      "insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', $2, 'sent', $3, now(), now() - interval '30 hours')",
      [p.id, JSON.stringify({ tribe: "Prompt Alpha", leader_first: "Lara" }), `placement:${tms[p.id]}`],
    );
  }
  const seat = async (person: string) => (await one("select status::text as status, release_reason, confirmed_at from public.tribe_members where id = $1", [tms[person]]))!;
  const logOf = async (person: string) => (await q.query("select kind, outcome from public.prompt_log where person_id = $1 order by id", [person])).rows as Row[];
  const owner = (feature: string, position: string) => o.call("god_feature_set", feature, "platform", null, position, [], "Trying the sign-in prompt in the journey", null);

  const browser = await launch();

  // ---- Off: today's page ------------------------------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, ada.email, "/home");
    await open(m.page, "/home");
    check(!(await stays(m.page)), "Off: signing in is today's page, with no screen over it");
    check((await n("select count(*)::int as n from public.prompt_visits")) === 0 && (await n("select count(*)::int as n from public.prompt_log")) === 0, "…and nothing is remembered or logged");
    await m.ctx.close();
  }

  // ---- Rehearsal: no screen, and the log counts who would have seen what ----------------------------------------------------------------------------------
  await owner("sign_in_prompt", "rehearsal");
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, ada.email, "/home");
    await open(m.page, "/home");
    check(!(await stays(m.page)), "Rehearsal: still no screen");
    const log = (await logOf(ada.id)).map((r) => `${r.kind}:${r.outcome}`);
    check(log.includes("placement:would_show") && log.includes("number:would_show") && !log.some((l) => l.endsWith(":shown")), "…and the log says what she would have seen (the placement and the number), not that she saw it");
    await m.ctx.close();
  }

  // ---- On: Ada says yes, then adds a number ---------------------------------------------------------------------------------------------------------------
  await q.query("delete from public.prompt_visits");
  await q.query("delete from public.prompt_log");
  await owner("placed_answers", "on"); // "Not this season" and "Call me" are offered where the placed answers are On
  await owner("sign_in_prompt", "on");
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, ada.email, "/home");
    check(await appears(m.page), "On: Ada signs in and a screen opens on top of the page she asked for");
    check((await kindOf(m.page)) === "placement", "…the first thing it asks is the placement");
    const body = await text(m.page);
    check(/Prompt Alpha/.test(body) && /Lara/.test(body), "…it names her tribe and her leader");
    check(/1 of 2/.test(await screen(m.page).getByTestId("signin-prompt-step").innerText()), "…and says where she is: 1 of 2");
    check((await screen(m.page).getByTestId("signin-prompt-later").count()) === 1, "…with a Not now");
    await noOverflow(m.page, "the placement screen on a phone");
    await shot(m.page, "54-placement-phone");
    await screen(m.page).getByTestId("signin-prompt-yes").click();
    await eventually("the seat is confirmed", async () => (await seat(ada.id)).confirmed_at !== null);
    check((await seat(ada.id)).status === "active", "Yes, I’m in: the seat is hers, confirmed");
    await eventually("the screen moves on to the number", async () => (await kindOf(m.page)) === "number");
    check(/saved/i.test(await screen(m.page).getByTestId("signin-prompt-flash").innerText()), "…it says that was saved, and asks the second thing");
    check((await screen(m.page).getByTestId("signin-prompt-whatsapp-tick").isChecked()) === false, "…the yes to WhatsApp is not ticked for her");
    await shot(m.page, "54-number-phone");
    await screen(m.page).getByTestId("signin-prompt-phone").fill("0803 111 2233");
    await screen(m.page).getByTestId("signin-prompt-save-number").click();
    await screen(m.page).getByTestId("signin-prompt-finished").waitFor({ timeout: 20000 });
    check((await one("select phone from public.contact_preferences where person_id = $1", [ada.id]))?.phone === "+2348031112233", "Her number is saved in full, with its country code");
    check((await n("select count(*)::int as n from public.consents where person_id = $1 and purpose = 'whatsapp'", [ada.id])) === 0, "…and no yes to WhatsApp is recorded: she did not tick it");
    const log = (await logOf(ada.id)).map((r) => `${r.kind}:${r.outcome}`);
    check(log.includes("placement:shown") && log.includes("placement:answered") && log.includes("number:answered"), "…the log says what was shown and what was answered, and no more");
    await shot(m.page, "54-thanks-phone");
    await screen(m.page).getByTestId("signin-prompt-continue").click();
    check(!(await screen(m.page).isVisible()), "Continue gives her the page back");
    await open(m.page, "/home");
    check(!(await stays(m.page)), "A reload in the same sign-in does not bring anything back");
    // the page itself already knows: her tribe page has no question left on it
    await open(m.page, "/tribe");
    check(!/Yes, I.m in/.test(await text(m.page)), "Her tribe page agrees: there is no question left on it");
    await m.ctx.close();
  }

  // ---- The next sign-in asks the one question that is left; a No is final -----------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, ada.email, "/home");
    check(await appears(m.page), "The next sign-in opens the screen again");
    check((await kindOf(m.page)) === "whatsapp", "…with the one question left: may we message you on WhatsApp");
    check((await screen(m.page).getByTestId("signin-prompt-step").count()) === 0, "…and with a single task there is no count");
    await shot(m.page, "54-whatsapp-phone");
    await screen(m.page).getByTestId("signin-prompt-wa-no").click();
    await screen(m.page).getByTestId("signin-prompt-finished").waitFor({ timeout: 20000 });
    check((await one("select granted from public.consents where person_id = $1 and purpose = 'whatsapp'", [ada.id]))?.granted === false, "No thanks is recorded as a No");
    await m.ctx.close();
    const again = await newPage(browser, "phone");
    await signIn(again.page, ada.email, "/home");
    check(!(await stays(again.page)), "…and the sign-in after that shows nothing: a No is final");
    await again.ctx.close();
  }

  // ---- Not now is for this visit only ------------------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, bola.email, "/home");
    check((await appears(m.page)) && (await kindOf(m.page)) === "placement", "Bola signs in and is asked to answer her placement");
    await screen(m.page).getByTestId("signin-prompt-later").click();
    await eventually("the screen closes", async () => !(await screen(m.page).isVisible()));
    check(!(await screen(m.page).isVisible()), "Not now closes it");
    const s = await seat(bola.id);
    check(s.status === "active" && s.confirmed_at === null, "…and decides nothing: her seat is as it was");
    check((await logOf(bola.id)).some((r) => r.kind === "placement" && r.outcome === "not_now"), "…the log says she put it off");
    await open(m.page, "/home");
    check(!(await stays(m.page)), "A reload in the same sign-in does not bring it back");
    await m.ctx.close();
    const next = await newPage(browser, "phone");
    await signIn(next.page, bola.email, "/home");
    check((await appears(next.page)) && (await kindOf(next.page)) === "placement", "A new sign-in does: it comes back");
    await next.ctx.close();
  }

  // ---- Not this season, with its confirmation ---------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, chika.email, "/home");
    check((await appears(m.page)) && (await kindOf(m.page)) === "placement", "Chika signs in and is asked to answer her placement");
    check((await screen(m.page).getByTestId("signin-prompt-season").count()) === 1 && (await screen(m.page).getByTestId("signin-prompt-call").count()) === 1, "…with all three answers: yes, not this season, call me");
    await screen(m.page).getByTestId("signin-prompt-season").click();
    await screen(m.page).getByTestId("signin-prompt-season-confirm").waitFor({ timeout: 10000 });
    check((await seat(chika.id)).status === "active", "Not this season asks first: nothing has happened yet");
    await shot(m.page, "54-season-confirm-phone");
    await screen(m.page).getByTestId("signin-prompt-season-yes").click();
    await eventually("her seat is released", async () => (await seat(chika.id)).status === "released");
    check((await seat(chika.id)).release_reason === "Not this season", "Her seat is released, marked Not this season");
    check((await n("select count(*)::int as n from public.placement_holds where person_id = $1 and source = 'not_season'", [chika.id])) === 1, "…and she is kept out of the automatic placement until the season ends");
    await m.ctx.close();
  }

  // ---- A task with its own page: Open it goes there, and nothing covers the page ---------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, joy.email, "/home");
    check((await appears(m.page)) && (await kindOf(m.page)) === "joining_form", "Joy has started the joining form: the screen asks her to finish it");
    await shot(m.page, "54-joining-form-phone");
    await screen(m.page).getByTestId("signin-prompt-open").click();
    await m.page.waitForURL((u) => u.pathname === "/join", { timeout: 20000 });
    check(!(await stays(m.page)), "Open it takes her to the form, and no second screen covers it");
    check((await n("select count(*)::int as n from public.prompt_log where person_id = $1 and kind = 'joining_form' and outcome = 'opened'", [joy.id])) === 1, "…the log says she went to do it");
    await m.ctx.close();
  }

  // ---- A leader with no number is asked for one too -----------------------------------------------------------------------------------------------------------
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, T.leader.email, "/lead");
    check(await appears(l.page), "A leader signs in and the screen opens");
    check((await kindOf(l.page)) === "number", "…a leader with no number is asked for one");
    await shot(l.page, "54-leader-number-desktop");
    await screen(l.page).getByTestId("signin-prompt-later").click();
    await eventually("the screen closes", async () => !(await screen(l.page).isVisible()));
    check(!(await screen(l.page).isVisible()), "…and Not now gives the leader board back");
    await l.ctx.close();
  }

  // ---- Off again: no screen, and the answers given stay where they are -----------------------------------------------------------------------------------------
  await owner("sign_in_prompt", "off");
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, bola.email, "/home");
    check(!(await stays(m.page)), "Off again: no screen, even for Bola, who still owes her answer");
    check((await seat(ada.id)).confirmed_at !== null && (await seat(chika.id)).status === "released", "…and the answers already given stay where they are");
    await m.ctx.close();
  }

  // ---- Put everything back ----------------------------------------------------------------------------------------------------------------------------------
  await o.call("god_unlock", PHRASE);
  await q.query("delete from public.feature_settings");
  for (const t of ["prompt_log", "prompt_visits", "prompt_streaks"]) await q.query(`delete from public.${t}`);
  await q.query("delete from public.intake_drafts where person_id = $1", [joy.id]);
  await q.query("delete from public.placement_holds where person_id = any($1)", [ids]);
  for (const t of ["placed_calls", "placed_answers", "placed_holds", "placed_reveals", "placed_downloads", "placed_seq_sends", "placed_seq"]) await q.query(`delete from public.${t}`);
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
  finish("54-sign-in-prompt");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

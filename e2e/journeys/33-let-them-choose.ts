/**
 * "Let them choose", end to end. Owner-only: the owner lets a leader she appointed choose their own goal.
 *
 *  - The owner appoints two leaders. Each card shows the goal as set by the church, with a "Let them choose" button.
 *  - Unlocking asks first, says what it does and does not do, and keeps the welcome email off while the pastor's wording is not approved.
 *  - The leader opens the Tribe Card on a phone and finds a list: the goal the church started them on first and marked, then the goals
 *    with most people waiting, "No one is waiting yet" where nobody is, and no sensitive goal. They pick one; the three lines follow the
 *    new goal; they change their mind once.
 *  - The owner's list says what the leader chose, from what, and how many were waiting. The owner's private record says so too.
 *  - The pastor reviewing the card is told the leader chose their own goal, and the owner is named nowhere.
 *  - Locking again puts the lock back and the leader's list goes away; what they picked stays.
 *  - The welcome page shows both emails, signed by the pastor; nothing can be sent until the owner presses "has approved this wording",
 *    and changing the name takes the approval away.
 *  - Two leaders ticked at once are unlocked together, with the welcome email; each is emailed once, and sending again is an explicit choice.
 *
 * Sending is held between 10 pm and 6 am in Lagos, so the checks on the received email only run in the day; the rest runs at any hour.
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";
import { ownerDoor } from "../owner-door";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const PAGE = "/god/appointments";
const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const LEADERSHIP = "step-into-a-leadership-role";
const MENTOR = "find-a-mentor-and-become-one";
const REPUTATION = "build-a-reputation-for-excellent-work";
const SENSITIVE = "handle-workplace-conflict-with-grace";

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  if (!r.ok) throw new Error(`tick answered ${r.status}`);
};
type Sent = { channel: string; body: Record<string, unknown> };
const mailTo = async (to: string) =>
  ((await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as Sent[])
    .filter((m) => (m.body.to as string[]).includes(to))
    .map((m) => ({ subject: String(m.body.subject), text: String(m.body.text), html: String(m.body.html ?? "") }));

async function eventually(label: string, read: () => Promise<boolean>, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
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
  const hour = Number((await one("select public.lagos_hour() as h"))!.h);
  const daytime = hour >= 6 && hour <= 21;

  // ---- What an appointment needs: signed-off cards, an approved fit model, a season, some members waiting ------------------------
  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  for (const t of (await q.query("select slug from public.tribe_card_templates where status <> 'signed_off'")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off($1)", [t.slug]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug]))!.id as string;
  const goalTitle = async (slug: string) => String((await one("select title from public.season_goals where slug = $1", [slug]))!.title);
  async function waiting(slug: string, howMany: number) {
    const g = await goalId(slug);
    for (let i = 0; i < howMany; i++) {
      const u = await k.person(`Waiting${slug.slice(0, 6)}${i}`);
      await q.query(
        "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3",
        [u.id, S, g],
      );
    }
  }
  await waiting(MENTOR, 5);
  await waiting(REPUTATION, 2);

  const { owner, call } = await ownerDoor(q, "choose.owner@example.org", PHRASE);

  async function appointLeader(name: string, goal: string) {
    const person = await adapter.createUser({ email: `${name.toLowerCase()}.example@example.org` });
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [person.id, `${name} Example`, name]);
    const r = await call("god_appoint_leader", person.id, JSON.stringify({ ...FORM, goal }), await goalId(goal), null);
    return { id: person.id, email: person.email, name: `${name} Example`, tribe: r.tribe as string };
  }
  const ada = await appointLeader("Ada", LEADERSHIP);
  const bayo = await appointLeader("Bayo", REPUTATION);

  const browser = await launch();
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await open(page, PAGE);
  const card = (tribe: string) => page.getByTestId(`choose-${tribe}`);
  const line = (tribe: string) => page.getByTestId(`choose-line-${tribe}`);
  await card(ada.tribe).waitFor({ timeout: 20000 });

  // ---- Before: the goal is set by the church -----------------------------------------------------------------------------------------------
  check(/Their goal is set by the church and they cannot change it\./.test(await line(ada.tribe).innerText()), "an appointed leader's goal is shown as set by the church");
  check((await page.getByTestId(`choose-open-${ada.tribe}`).count()) === 1, "…with a Let them choose button");
  check(await page.getByTestId(`welcome-send-${ada.tribe}`).isDisabled(), "…and the welcome email button is off until the pastor's wording is approved");
  check(/off until the pastor.s wording is approved/.test(await card(ada.tribe).innerText()), "…and says why");
  await shot(page, "33-before");

  // ---- Unlock one leader ---------------------------------------------------------------------------------------------------------------------
  await page.getByTestId(`choose-open-${ada.tribe}`).click();
  const panel = page.getByTestId(`choose-panel-${ada.tribe}`);
  await panel.waitFor();
  const pBody = await panel.innerText();
  check(/pick their goal from a list on their own Tribe Card/.test(pBody) && /Sensitive goals stay off the list/.test(pBody) && /Your name is never shown/.test(pBody), "unlocking asks first and says what it does");
  check(/not cleared for sensitive subjects/.test(pBody), "…and whether sensitive goals can be on their list");
  check(!(await panel.getByTestId("choose-community").isChecked()), "letting them choose the community is off");
  check(await panel.getByTestId("choose-welcome").isDisabled() && !(await panel.getByTestId("choose-welcome").isChecked()), "the welcome email cannot be ticked before approval");
  check(/wording has not been approved/.test(pBody) && /works without it/.test(pBody), "…and the panel says so");
  check((await n("select count(*)::int n from public.leader_goal_unlock")) === 0, "nothing is saved until the owner confirms");
  await shot(page, "33-panel");
  await panel.getByTestId("choose-confirm").click();
  await eventually("Ada can choose", async () => (await card(ada.tribe).getAttribute("data-state")) === "waiting");
  check(/They can choose their goal\. They have not yet\./.test(await line(ada.tribe).innerText()), "the owner's line says she can choose and has not yet");
  const unlocked = (await one("select fixed, state, community_too from public.tribes t join public.leader_goal_unlock u on u.tribe_id = t.id where t.id = $1", [ada.tribe]))!;
  check(!(unlocked.fixed as string[]).includes("goal") && (unlocked.fixed as string[]).includes("community") && unlocked.state === "open" && unlocked.community_too === false, "only the goal is unlocked: the community stays fixed");
  check((await n("select count(*)::int n from public.messages where template = 'leader_welcome'")) === 0, "no email was sent");
  check((await page.getByTestId(`lock-${ada.tribe}`).count()) === 1 && (await page.getByTestId(`choose-open-${ada.tribe}`).count()) === 0, "…and the button now offers Lock it again");
  check((await card(bayo.tribe).getAttribute("data-state")) === "none", "the other leader is untouched");
  await shot(page, "33-unlocked");

  // ---- The leader picks, on a phone ---------------------------------------------------------------------------------------------------------
  const leader = await newPage(browser, "phone");
  await signIn(leader.page, ada.email, "/lead/tribe");
  await open(leader.page, "/lead/tribe");
  const picker = leader.page.getByTestId("goal-picker");
  await picker.waitFor({ timeout: 20000 });
  check((await leader.page.getByTestId("goal-picker-line").innerText()).trim() === "The church has let you choose your goal. The one you were started on is marked.", "the leader sees the line above the list");
  const options = leader.page.locator('[data-testid^="goal-option-"]');
  const optionSlugs = (await options.evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace("goal-option-", "")))) as string[];
  check(optionSlugs.length >= 5, `the list has goals to choose from (${optionSlugs.length})`);
  check(optionSlugs[0] === LEADERSHIP, "the goal the church started her on comes first");
  const first = await options.nth(0).innerText();
  check(first.includes("The one you were started on") && first.includes("Your goal"), "…marked, and shown as her goal now");
  check(optionSlugs[1] === MENTOR && optionSlugs[2] === REPUTATION, "…then the goals with most people waiting");
  check((await leader.page.getByTestId(`goal-option-${MENTOR}`).innerText()).includes("5 people are waiting"), "each says how many are waiting");
  check(/No one is waiting yet/.test(await picker.innerText()), "…and says \"No one is waiting yet\" where nobody is");
  check(!optionSlugs.includes(SENSITIVE), "a sensitive goal is not on the list");
  check(!/\bChidi\b|\bWaiting/.test(await picker.innerText()), "…and no one who is waiting is named");
  await noOverflow(leader.page, "the Tribe Card with the list on a phone");
  await shot(leader.page, "33-leader-list");

  const before = (await one("select loving_god, loving_others, loving_life from public.tribes where id = $1", [ada.tribe]))!;
  await leader.page.getByTestId(`goal-option-${MENTOR}`).click();
  await eventually("her goal is saved", async () => (await one("select g.slug from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [ada.tribe]))?.slug === MENTOR);
  await eventually("the list shows it", async () => (await leader.page.getByTestId(`goal-option-${MENTOR}`).getAttribute("aria-checked")) === "true");
  check((await leader.page.getByTestId(`goal-option-${LEADERSHIP}`).getAttribute("aria-checked")) === "false", "the picked goal is the one marked as hers");
  const mentorCard = (await one("select loving_god, loving_others, loving_life from public.tribe_card_templates where slug = $1", [MENTOR]))!;
  const after = (await one("select loving_god, loving_others, loving_life from public.tribes where id = $1", [ada.tribe]))!;
  check(JSON.stringify(before) !== JSON.stringify(after) && after.loving_god === mentorCard.loving_god && after.loving_life === mentorCard.loving_life, "the three Success Picture lines follow the new goal");
  const lines = await leader.page.locator("textarea").evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  check(lines.includes(String(mentorCard.loving_god)) && lines.includes(String(mentorCard.loving_life)), "…and the page shows the new lines at once");
  const rec = (await one("select picks, waiting_at_pick, chosen_goal_id from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]))!;
  check(rec.picks === 1 && rec.waiting_at_pick === 5 && rec.chosen_goal_id === (await goalId(MENTOR)), "the pick is recorded with how many were waiting");
  await shot(leader.page, "33-leader-picked");

  // ---- The owner sees what she chose ---------------------------------------------------------------------------------------------------------
  await open(page, PAGE);
  const mentorTitle = await goalTitle(MENTOR);
  const leadershipTitle = await goalTitle(LEADERSHIP);
  const chosenLine = await line(ada.tribe).innerText();
  check(chosenLine.includes(`They chose “${mentorTitle}”`) && chosenLine.includes(`You started them on “${leadershipTitle}”`) && /5 members were waiting for it/.test(chosenLine), "the owner's line says what she chose, what she was started on, and how many were waiting");
  await shot(page, "33-chosen");

  // She changes her mind once
  await leader.page.getByTestId(`goal-option-${REPUTATION}`).click();
  await eventually("her second pick is saved", async () => (await one("select picks from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]))?.picks === 2);
  await open(page, PAGE);
  check(/changed their mind 1 time/.test(await line(ada.tribe).innerText()), "…and a change of mind is counted");

  // ---- The pastor ---------------------------------------------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, "pastor.ife@example.org", `/review/cards/${ada.tribe}`);
    await open(p.page, `/review/cards/${ada.tribe}`);
    const note = p.page.getByTestId("goal-choice-note");
    await note.waitFor({ timeout: 20000 });
    check((await note.innerText()).trim() === "This leader chose their own goal. The church had started them on a different one.", "the pastor is told the leader chose their own goal");
    const all = await text(p.page);
    check(!all.includes("Platform Owner") && !all.includes(owner.email) && !/choose\.owner/.test(all), "…and the owner is named nowhere on the page");
    await p.ctx.close();
  }

  // ---- The owner's private record ---------------------------------------------------------------------------------------------------------
  await open(page, "/god/record");
  const rec2 = await text(page);
  check(/You let a leader choose their own goal/.test(rec2) && /A leader chose their own goal/.test(rec2), "the owner's private record has both lines");
  check(!rec2.includes("Ada Example"), "…and the record holds goal titles, not the leader's name");

  // ---- Lock it again -------------------------------------------------------------------------------------------------------------------------------
  await open(page, PAGE);
  await page.getByTestId(`lock-${ada.tribe}`).click();
  await eventually("she is locked again", async () => /Locked again/.test(await line(ada.tribe).innerText()));
  check(/Their goal is “.+”, which they chose\./.test(await line(ada.tribe).innerText()), "locking again says the goal stays as they chose it");
  const locked = (await one("select t.fixed, g.slug from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [ada.tribe]))!;
  check((locked.fixed as string[]).includes("goal") && locked.slug === REPUTATION, "the goal is locked again and what she picked stays");
  await open(leader.page, "/lead/tribe");
  await leader.page.getByText("Season Goal").first().waitFor({ timeout: 20000 });
  check((await leader.page.getByTestId("goal-picker").count()) === 0, "her list is gone");
  check((await leader.page.locator("body").innerText()).includes(await goalTitle(REPUTATION)), "…and her card shows the goal she picked");
  await noOverflow(leader.page, "the locked Tribe Card on a phone");

  // ---- The welcome email: read it, approve it ---------------------------------------------------------------------------------------------------
  await open(page, `${PAGE}/welcome`);
  await page.getByTestId("welcome-panel").waitFor({ timeout: 20000 });
  check(/Not approved/.test(await page.getByTestId("welcome-status").innerText()), "the welcome wording starts not approved");
  const choosePreview = (await page.getByTestId("welcome-preview-choose").locator("iframe").getAttribute("srcdoc")) ?? "";
  const fixedPreview = (await page.getByTestId("welcome-preview-fixed").locator("iframe").getAttribute("srcdoc")) ?? "";
  check(/Welcome to leading a tribe/.test(choosePreview) && /let you choose your goal/.test(choosePreview), "the page shows the email for a leader who may choose");
  check(/chosen for you/.test(fixedPreview), "…and the one for a leader whose goal was chosen for them");
  check(/<strong>Wale Ekundayo<\/strong><br>Pastor TCN Iganmu Center/.test(choosePreview), "…signed Wale Ekundayo, Pastor TCN Iganmu Center");
  check(!/Platform Owner|choose\.owner|god mode/i.test(choosePreview + fixedPreview), "…and it names no owner");
  check((choosePreview.match(/<img /g) ?? []).length >= 5, "…with a picture for each step");
  await shot(page, "33-welcome");

  await page.getByTestId("welcome-name").fill("Pastor Wale E.");
  check(await page.getByTestId("welcome-approve").isDisabled(), "approving waits until a changed name is saved");
  await page.getByTestId("welcome-name").fill("Wale Ekundayo");
  await page.getByTestId("welcome-approve").click();
  await eventually("the wording is approved", async () => /^Approved/.test((await page.getByTestId("welcome-status").innerText()).trim()));
  const version = String((await one("select approved_version from public.leader_welcome_settings"))!.approved_version);
  check(/^[a-z0-9-]{3,40}$/.test(version), `the approval is tied to a version of the wording (${version})`);
  await page.getByTestId("welcome-name").fill("Wale Ekundayo Jr");
  await page.getByTestId("welcome-save").click();
  await eventually("the approval is taken away", async () => /Not approved/.test(await page.getByTestId("welcome-status").innerText()));
  check((await one("select approved_version from public.leader_welcome_settings"))?.approved_version === null, "changing the name takes the approval away");
  await page.getByTestId("welcome-name").fill("Wale Ekundayo");
  await page.getByTestId("welcome-save").click();
  await eventually("the name is back", async () => (await one("select signature_name from public.leader_welcome_settings"))?.signature_name === "Wale Ekundayo");
  await page.getByTestId("welcome-approve").click();
  await eventually("approved again", async () => /^Approved/.test((await page.getByTestId("welcome-status").innerText()).trim()));

  // ---- Several at once, with the welcome email ---------------------------------------------------------------------------------------------------
  await open(page, PAGE);
  await page.getByLabel(`Select ${ada.name} for several at once`).check();
  await page.getByLabel(`Select ${bayo.name} for several at once`).check();
  const bar = page.getByTestId("choose-bar");
  await bar.waitFor();
  check(/2 selected/.test(await bar.innerText()), "ticking two leaders shows a bar");
  await bar.getByTestId("choose-bar-unlock").click();
  const barPanel = page.getByTestId("choose-bar-panel");
  await barPanel.waitFor();
  check(await barPanel.getByTestId("choose-welcome").isChecked() && (await barPanel.getByTestId("choose-welcome").isEnabled()), "now the welcome email can be ticked, and is on");
  await barPanel.getByTestId("choose-confirm").click();
  await eventually("both can choose", async () => (await n("select count(*)::int n from public.leader_goal_unlock where state = 'open'")) === 2);
  check(/2 leaders can now choose their goal\./.test(await text(page)) && /2 welcome emails are on its way/.test(await text(page)), "the page says both can choose and both welcome emails are on their way");
  check((await n("select count(*)::int n from public.messages where template = 'leader_welcome' and force_channel = 'email'")) === 2, "two welcome emails are queued, by email only");
  const queued = (await one("select params from public.messages where template = 'leader_welcome' and person_id = $1", [ada.id]))!.params as Record<string, unknown>;
  check(queued.choose === true && queued.signature_name === "Wale Ekundayo" && queued.signature_title === "Pastor TCN Iganmu Center" && queued.version === version, "…the 'may choose' version, with the pastor's name and the approved version");
  check(/welcome email \(they may choose\) is/.test(await text(page)), "each leader's line says the welcome email has been queued");
  check(/Send the welcome email again/.test(await page.getByTestId(`welcome-send-${ada.tribe}`).innerText()), "…and sending it again is a separate, explicit button");
  await shot(page, "33-several");

  // Pressing the button for the same version again sends a second one only on purpose
  await page.getByTestId(`welcome-send-${bayo.tribe}`).click();
  await eventually("the second welcome is queued", async () => (await n("select count(*)::int n from public.messages where template = 'leader_welcome' and person_id = $1", [bayo.id])) === 2);
  check(true, "sending it again, on purpose, queues a second one");

  // ---- The email arrives ------------------------------------------------------------------------------------------------------------------------------
  if (daytime) {
    await tick();
    await tick();
    await eventually("Ada is emailed", async () => (await mailTo(ada.email)).length >= 1, 40);
    const mail = await mailTo(ada.email);
    check(mail.length === 1, `Ada is emailed once (${mail.length})`);
    if (mail[0]) {
      check(mail[0].subject === "Welcome to leading a tribe", "the subject is Welcome to leading a tribe");
      check(/Wale Ekundayo\nPastor TCN Iganmu Center/.test(mail[0].text), "it is signed by the pastor");
      check(/Hi Ada,/.test(mail[0].text) && mail[0].text.includes(`${BASE}/lead/tribe`), "…greets her by first name and links to her Tribe Card");
      check(!/Platform Owner|choose\.owner|god mode/i.test(mail[0].text + mail[0].html), "…and names no owner");
      check(mail[0].html.includes(`${BASE}/email/leader-guide/`), "…with its pictures from the church's own site");
    }
  } else {
    check(true, "the received-email checks are skipped at night (sending is held until 6 am Lagos)");
  }

  // ---- Everything else was left alone --------------------------------------------------------------------------------------------------------------
  check((await n("select count(*)::int n from public.leader_certifications where person_id = any($1)", [[ada.id, bayo.id]])) === 0, "nobody was certified by any of this");
  check((await one("select status from public.tribes where id = $1", [ada.tribe]))?.status === "draft", "and no card was sent or approved for them");

  await leader.ctx.close();
  await ctx.close();
  await browser.close();
  await q.end();
  finish("33-let-them-choose");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

/**
 * The supply-and-demand board for leaders, end to end (Phase 7).
 *
 *  - Five members are waiting for a goal with no tribe. The pastor finds "Leader supply" on the Admin page and sees the gap in words.
 *  - She asks who could lead it. The suggestion is a leader whose saved answers fit, with a degree and one sentence, and none of the
 *    words the compatibility test keeps to itself. She offers the tribe; the leader is sent one message that says how many, never who.
 *  - A data lead reads the board but cannot offer or withdraw. A member and a coach never find the page.
 *  - The leader opens her Lead page on a phone: the offer says how many are waiting. She says yes and lands on a Tribe Card that has the
 *    goal locked and the three lines from the ready-made card. The offer is closed and she is not suggested again.
 *  - A second leader says no: nothing changes for her. A third has her offer withdrawn: her page shows nothing.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { testDbFor } from "../dbkit";
import { answers, calling, OPEN_DOOR, pipelineKit, setPositions } from "../../tests/db/pipeline-kit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const BOARD = "/admin/leader-supply";
const FOUR = { age21: true, time: true, safeguarding: true, confidentiality: true };
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

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
  const kit = pipelineKit(adapter);
  await setPositions(adapter, OPEN_DOOR);

  // ---- What the board needs: signed-off cards, an approved model, a season ------------------------------------------------------------
  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Row[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1"))!.id as string;

  // A goal nobody is waiting for yet, whose card is signed off and not sensitive
  const g = (await one(
    `select g.id, g.slug, g.title, c.slug as community, c.id as community_id, t.track_slugs as tracks
       from public.season_goals g join public.communities c on c.id = g.community_id and c.active
       join public.tribe_card_templates t on t.season_goal_id = g.id and t.status = 'signed_off' and not t.sensitive
      where g.active and not exists (select 1 from public.goal_demand_rows($1) d where d.goal_id = g.id and (d.waiting > 0 or d.seats_open > 0))
      order by g.slug limit 1`,
    [S],
  ))!;
  const title = String(g.title);
  const tracks = g.tracks as string[];

  const waiting = ["Adaeze", "Bayo", "Chinwe", "Dele", "Efe"];
  for (const name of waiting) {
    const u = await adapter.createUser();
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Waiting`, name]);
    await q.query("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) values ($1, $2, $3, $4, 'any', 0)", [u.id, S, g.id, g.community_id]);
  }

  // Three leaders with complete saved answers that point at this goal, a data lead, and a member
  async function leader(name: string) {
    const p = await kit.person("leader", name);
    await q.query(
      "insert into public.leader_applications (person_id, status, answers, consent_version, decided_at, submitted_at) values ($1, 'approved_leader', $2::jsonb, '2026-10-v1', now(), now())",
      [p.id, JSON.stringify(answers(FOUR, { calling: calling({ track: tracks[0], community: g.community, goal: g.slug, goalRelation: "achieved" }) }))],
    );
    return p;
  }
  const folake = await leader("Folake");
  const gbenga = await leader("Gbenga");
  const hauwa = await leader("Hauwa");
  const dataLead = await kit.person("data_lead", "Ireti");

  const browser = await launch();

  // ---- A member and a coach never find the page ----------------------------------------------------------------------------------------
  for (const email of ["member@example.org", "coach.sade@example.org"]) {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, email, BOARD);
    await open(page, BOARD);
    check(new URL(page.url()).pathname === "/home" && (await page.getByTestId("leader-board").count()) === 0, `${email.split("@")[0]} is sent home: the board is not theirs to see`);
    await ctx.close();
  }

  // ---- The pastor ------------------------------------------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, "pastor.ife@example.org", "/admin");
  await open(page, "/admin");
  check((await page.getByRole("link", { name: /Leaders needed/ }).count()) >= 1, "the pastor finds “Leaders needed” on the Admin page");
  await page.getByRole("link", { name: /Leaders needed/ }).first().click();
  await page.waitForURL(/\/admin\/leader-supply/, { timeout: 15000 });
  await page.getByTestId("leader-board").waitFor({ timeout: 20000 });
  await noOverflow(page, "the leader supply page on a desktop");

  const head = await page.getByTestId("leader-board").innerText();
  check(/Fit model lf-\d/.test(head), "the board says which fit model it uses");
  check(/\d+ tribe cards? (is|are) signed off/.test(await page.getByTestId("board-cards").innerText()), "…and how many cards are signed off");
  const row = page.getByTestId(`goal-${g.id}`);
  await row.waitFor({ timeout: 15000 });
  const rowText = await row.innerText();
  check(rowText.includes(title) && /5 people waiting\. 5 more seats are needed\./.test(rowText), "the goal shows five people waiting and five seats needed, in words");
  check(/5 seats needed/.test(rowText) && /No leader has chosen it\./.test(rowText), "…with the badge, and that no leader has chosen it");
  check(!waiting.some((w) => head.includes(w)), "no member who is waiting is named anywhere on the board");
  await shot(page, "25-board");

  // Suggestions
  await row.getByTestId(`suggest-${g.id}`).click();
  const box = page.getByTestId(`suggestions-${g.id}`);
  await box.waitFor({ timeout: 25000 });
  const list = page.locator(`[data-testid="suggestions-${g.id}"] [data-testid^="suggestion-"]`);
  const found = await list.count();
  check(found >= 1 && found <= 3, `up to three leaders are suggested (${found})`);
  const folakeCard = page.getByTestId(`suggestion-${folake.id}`);
  const gbengaCard = page.getByTestId(`suggestion-${gbenga.id}`);
  const hauwaCard = page.getByTestId(`suggestion-${hauwa.id}`);
  const seen = (await folakeCard.count()) + (await gbengaCard.count()) + (await hauwaCard.count());
  check(seen >= 1, `a leader whose saved answers fit is suggested (${seen} of the three we made)`);
  const sBody = await box.innerText();
  check(/(excellent|strong|good) · \d+/.test(sBody), "each suggestion has a word and a degree");
  check(!/judgement|care bar|care flag|sensitive|weight/i.test(sBody), "…and none of the words the compatibility test keeps to itself");
  await shot(page, "25-suggestions");
  check((await n("select count(*)::int n from public.leader_offers")) === 0, "asking is not offering: no offer exists yet");

  // The offer, with a confirmation first
  const target = (await folakeCard.count()) ? folake : (await gbengaCard.count()) ? gbenga : hauwa;
  const targetCard = page.getByTestId(`suggestion-${target.id}`);
  await targetCard.getByTestId(`offer-${target.id}`).click();
  await targetCard.getByText(/Send the offer to/).waitFor();
  check((await n("select count(*)::int n from public.leader_offers")) === 0, "the page asks first: still no offer");
  await targetCard.getByTestId(`confirm-offer-${target.id}`).click();
  await eventually("the offer is recorded", async () => (await n("select count(*)::int n from public.leader_offers where person_id = $1 and status = 'offered'", [target.id])) === 1);
  await page.getByText(/Offer sent to/).waitFor({ timeout: 15000 });
  const offer = (await one("select id, waiting_at_offer, goal_id, expires_at from public.leader_offers where person_id = $1", [target.id]))!;
  check(Number(offer.waiting_at_offer) === 5 && offer.goal_id === g.id, "the offer records the goal and that five were waiting");
  const msg = (await one("select params, template from public.messages where dedupe_key = $1", [`leader_offer:${offer.id}`]))!;
  check(msg.template === "leader_offer" && Number((msg.params as Row).waiting) === 5, "one message was queued, saying five are waiting");
  check(!waiting.some((w) => JSON.stringify(msg.params).includes(w)), "…and it names no member");
  check((await n("select count(*)::int n from public.messages where dedupe_key = $1", [`leader_offer:${offer.id}`])) === 1, "…exactly once");
  const offers = page.getByTestId("offers");
  await offers.getByTestId(`offer-row-${offer.id}`).waitFor({ timeout: 15000 });
  const oText = await offers.innerText();
  check(/Waiting for an answer/.test(oText) && /5 people waiting when it was sent/.test(oText), "the offers list shows it, waiting for an answer, with the count it was sent with");
  check((await page.getByTestId(`goal-${g.id}`).innerText()).includes("1 offer open"), "…and the goal says one offer is open");
  await shot(page, "25-offered");

  // Suggesting again leaves out the one who has an open offer
  await page.getByTestId(`suggest-${g.id}`).click();
  await eventually("fresh suggestions", async () => (await page.getByTestId(`suggestion-${target.id}`).count()) === 0);
  check(true, "asking again leaves out the leader who already holds an open offer");

  // ---- The data lead reads but cannot offer ---------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, String(dataLead.email), BOARD);
    await open(p.page, BOARD);
    await p.page.getByTestId("leader-board").waitFor({ timeout: 20000 });
    check((await p.page.getByTestId(`goal-${g.id}`).count()) === 1, "a data lead sees the board");
    await p.page.getByTestId(`suggest-${g.id}`).click();
    await p.page.getByTestId(`suggestions-${g.id}`).waitFor({ timeout: 25000 });
    check((await p.page.getByRole("button", { name: "Offer this tribe" }).count()) === 0 && (await p.page.getByRole("button", { name: "Withdraw" }).count()) === 0, "…but has no way to offer or withdraw");
    check(/Only the pastor, directors and the admin can make an offer/.test(await text(p.page)) || (await p.page.locator('[data-testid^="suggestion-"]').count()) === 0, "…and is told who can");
    await p.ctx.close();
  }

  // ---- The leader, on a phone ------------------------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, String(target.email), "/lead");
    await open(p.page, "/lead");
    const card = p.page.getByTestId("leader-offer");
    await card.waitFor({ timeout: 20000 });
    const cBody = await card.innerText();
    check(/Five people are waiting for/.test(cBody) && cBody.includes(title), "the leader’s page says five people are waiting, and for which goal");
    check(/A pastor still approves the card/.test(cBody), "…and that a pastor still approves the card");
    check(!waiting.some((w) => cBody.includes(w)), "…and names no member");
    await noOverflow(p.page, "the offer on a phone");
    await shot(p.page, "25-offer-phone");
    await p.page.getByTestId("offer-accept").click();
    await p.page.waitForURL(/\/lead\/tribe/, { timeout: 20000 });
    await p.page.getByRole("heading", { name: "Your Tribe Card" }).first().waitFor({ timeout: 20000 });
    check(true, "she says yes and lands on her Tribe Card");

    const t = (await one("select id, status, season_goal_id, community_id, fixed, loving_god, loving_others, loving_life from public.tribes where leader_id = $1", [target.id]))!;
    check(t.status === "draft" && t.season_goal_id === g.id && t.community_id === g.community_id, "the card is a draft for the goal and community of the offer");
    check((t.fixed as string[]).includes("goal") && (t.fixed as string[]).includes("community"), "…with the goal and community locked");
    check(String(t.loving_god).length > 10 && String(t.loving_others).length > 10 && String(t.loving_life).length > 10, "…and the three lines come from the ready-made card");
    check((await one("select status, tribe_id from public.leader_offers where id = $1", [offer.id]))?.status === "accepted", "the offer is closed as accepted");
    check((await n("select count(*)::int n from public.leader_certifications where person_id = $1", [target.id])) === 0, "nobody is certified by saying yes");
    await open(p.page, "/lead");
    check((await p.page.getByTestId("leader-offer").count()) === 0, "back on her Lead page, the offer is gone");
    await noOverflow(p.page, "the Tribe Card after accepting, on a phone");
    await p.ctx.close();
  }

  // ---- A leader who says no ------------------------------------------------------------------------------------------------------------
  const others = [folake, gbenga, hauwa].filter((x) => x.id !== target.id);
  const nay = others[0];
  const withdrawn = others[1];
  await adapter.asUser(pastorId, (run) => run("select public.leader_offer_send($1, $2)", [g.id, nay.id]));
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, String(nay.email), "/lead");
    await open(p.page, "/lead");
    await p.page.getByTestId("leader-offer").waitFor({ timeout: 20000 });
    check(/Five people are waiting|Four people are waiting/.test(await p.page.getByTestId("leader-offer").innerText()), "the second leader sees the offer with the count as it is now");
    await p.page.getByTestId("offer-decline").click();
    await p.page.getByTestId("offer-declined").waitFor({ timeout: 15000 });
    check(/Nothing changes for you/.test(await p.page.getByTestId("offer-declined").innerText()), "saying no is answered kindly: nothing changes for her");
    check((await n("select count(*)::int n from public.tribes where leader_id = $1", [nay.id])) === 0, "…and no Tribe Card is started");
    check((await one("select status from public.leader_offers where person_id = $1", [nay.id]))?.status === "declined", "…and the offer is closed as declined");
    await p.ctx.close();
  }

  // ---- An offer withdrawn ---------------------------------------------------------------------------------------------------------------
  const third = (await adapter.asUser(pastorId, (run) => run("select public.leader_offer_send($1, $2) as r", [g.id, withdrawn.id]))).rows[0].r as Row;
  await open(page, BOARD);
  const wrow = page.getByTestId(`offer-row-${third.offer}`);
  await wrow.waitFor({ timeout: 20000 });
  await wrow.getByTestId(`withdraw-${third.offer}`).click();
  await eventually("the offer is withdrawn", async () => (await one("select status from public.leader_offers where id = $1", [third.offer]))?.status === "withdrawn");
  await page.getByText(/was withdrawn/).waitFor({ timeout: 15000 });
  check(true, "the pastor withdraws an open offer from the list");
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, String(withdrawn.email), "/lead");
    await open(p.page, "/lead");
    check((await p.page.getByTestId("leader-offer").count()) === 0, "the leader whose offer was withdrawn sees nothing");
    await p.ctx.close();
  }

  // ---- The board after all this ------------------------------------------------------------------------------------------------------------
  await open(page, BOARD);
  await page.getByTestId("offers").waitFor({ timeout: 20000 });
  const after = await page.getByTestId("offers").innerText();
  check(/Answered, withdrawn or expired in the last 90 days \(3\)/.test(after), "the three answered offers are kept in the list for 90 days");
  check((await n("select count(*)::int n from public.event_log where action in ('leader.offer_sent','leader.offer_accepted','leader.offer_declined','leader.offer_withdrawn')")) >= 6, "every step is in the log: three offers, one accepted, one declined, one withdrawn");
  await shot(page, "25-after");

  await ctx.close();
  await browser.close();
  await q.end();
  finish("25-leader-board");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

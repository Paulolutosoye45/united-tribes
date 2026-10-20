/**
 * The ready-made cards, end to end: the page where the pastorate reads them, signs them off community by community, and
 * the leader's button.
 *
 *  - The pastor opens "Ready-made cards" and sees all 100 cards, none signed off, 23 of them already tied to a live goal.
 *  - She signs off a whole community in one go. The 77 cards with no goal yet get their goal at that moment, and only then.
 *  - A sensitive card is left out of that bulk sign-off. She opens it, and the sign-off will not go ahead until she says she has
 *    read it.
 *  - A card she edits after sign-off goes back to waiting; she signs it off again.
 *  - The review sheet downloads with every card, the hidden columns and where each card stands.
 *  - A director can sign off; an administrator can read and write but not sign; a coach and a member do not see the page.
 *  - A leader with an empty Tribe Card sees the ready-made card for their goal, with no hidden column on it, and starts from it.
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const PAGE = "/review/templates";

async function eventually(label: string, read: () => Promise<boolean>, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

/** Reads a CSV the way a spreadsheet does: quoted cells may hold commas, quotes and line breaks. */
function parseCsv(body: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = body.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- What is in the database before anyone opens the page ----------------------------------------------------------
  const total = await n("select count(*)::int n from public.tribe_card_templates");
  const tied = await n("select count(*)::int n from public.tribe_card_templates where season_goal_id is not null");
  const signedAtStart = await n("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'");
  check(total === 100, `there are 100 ready-made cards (${total})`);
  check(tied === 23, `23 of them are tied to the goals already live (${tied})`);
  check(signedAtStart === 0, "none is signed off yet");
  const communities = await n("select count(*)::int n from public.communities where active");

  // The community the pastor signs off whole, and the community with a sensitive card she must read herself
  const first = (await one(
    `select c.slug, c.name, c.id from public.communities c
      where c.active and exists (select 1 from public.tribe_card_templates t where t.community_id = c.id and not t.sensitive and t.season_goal_id is null)
      order by c.sort, c.name limit 1`,
  ))!;
  const sens = (await one(
    `select t.slug, t.title, t.community_id, c.slug as cslug, c.name as cname
       from public.tribe_card_templates t join public.communities c on c.id = t.community_id
      where t.sensitive and c.active order by c.sort, t.sort limit 1`,
  ))!;
  check(Boolean(first && sens), "there is a community to sign off whole and a sensitive card to read");
  const waiting = await n(
    "select count(*)::int n from public.tribe_card_templates where community_id = $1 and status = 'draft' and not sensitive",
    [first.id],
  );
  const newInFirst = await n(
    "select count(*)::int n from public.tribe_card_templates where community_id = $1 and status = 'draft' and not sensitive and season_goal_id is null",
    [first.id],
  );
  const goalsBefore = await n("select count(*)::int n from public.season_goals");

  const browser = await launch();

  // ---- The pastor reads and signs off a community --------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "pastor.ife@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("template-board").waitFor({ timeout: 20000 });
    await heading(page, "Review leaders").waitFor();
    const board = await text(page);
    check(/Signed off\s*\n?\s*0\s*\n?\s*of 100 cards/.test(board), "the page says 0 of 100 cards are signed off");
    check((await page.locator('[data-testid^="community-"]').count()) === communities, `every community is listed (${communities})`);
    check(await page.getByRole("link", { name: "Ready-made cards" }).first().isVisible(), "the review tabs have a Ready-made cards tab");
    await shot(page, "22-board");
    await noOverflow(page, "the ready-made cards page on a desktop");

    const box = page.getByTestId(`community-${first.slug}`);
    const bulk = box.getByRole("button", { name: `Sign off the ${waiting} waiting` });
    check(await bulk.isVisible(), `the community offers to sign off the ${waiting} that are waiting`);
    await bulk.click();
    const ask = page.getByTestId(`ask-${first.slug}`);
    await ask.waitFor();
    check((await ask.innerText()).includes("This is recorded with your name."), "it asks first, and says it is recorded with her name");
    check((await ask.innerText()).includes("Their goals become live"), "…and what it does: their goals become live");
    await shot(page, "22-ask");
    await ask.getByRole("button", { name: "Yes, sign them off" }).click();
    await eventually("the community is signed off", async () => (await n("select count(*)::int n from public.tribe_card_templates where community_id = $1 and status = 'signed_off'", [first.id])) === waiting);
    check(true, `${waiting} cards are signed off in one go`);
    const goalsAfter = await n("select count(*)::int n from public.season_goals");
    check(goalsAfter === goalsBefore + newInFirst, `${newInFirst} new goals were created at that moment, no more (${goalsAfter - goalsBefore})`);
    check((await n("select count(*)::int n from public.tribe_card_templates where season_goal_id is not null")) === tied + newInFirst, "…and each new card is now tied to its goal");
    check(
      (await n("select count(*)::int n from public.tribe_card_templates t join public.season_goals g on g.id = t.season_goal_id where t.community_id = $1 and t.status = 'signed_off' and g.active", [first.id])) === waiting,
      "every signed-off card has a live goal",
    );
    check(
      (await n("select count(*)::int n from public.event_log where action = 'card_template.signed_off' and actor_id is not null")) >= waiting,
      "each sign-off is in the log with the pastor's name",
    );
    check((await n("select count(*)::int n from public.goal_ideas gi join public.tribe_card_templates t on t.season_goal_id = gi.season_goal_id where t.community_id = $1 and t.status = 'signed_off'", [first.id])) >= waiting * 3, "…and the three weekly ideas of each card were filed for the Companion");
    check(
      (await box.innerText()).includes(`${waiting} of`) && (await box.getByRole("img", { name: /percent signed off/ }).count()) === 1,
      "the community's line and bar show the progress",
    );
    await shot(page, "22-signed");

    // The sensitive card is never in a bulk sign-off
    const sensBox = page.getByTestId(`community-${sens.cslug}`);
    const sensLeft = await n("select count(*)::int n from public.tribe_card_templates where community_id = $1 and sensitive and status <> 'signed_off'", [sens.community_id]);
    check((await sensBox.innerText()).includes(`${sensLeft} sensitive left`), `the community with a sensitive card says so (${sensLeft} left)`);
    if ((await sensBox.getByRole("button", { name: /^Sign off the \d+ waiting$/ }).count()) > 0) {
      await sensBox.getByRole("button", { name: /^Sign off the \d+ waiting$/ }).click();
      const ask2 = page.getByTestId(`ask-${sens.cslug}`);
      await ask2.waitFor();
      check(!(await ask2.innerText()).includes(String(sens.title)), "the sensitive card is not in the list that would be signed off");
      check(/not included: open each one and sign it off yourself/.test(await ask2.innerText()), "…and she is told to open each one herself");
      await ask2.getByRole("button", { name: "Not yet" }).click();
    }
    check((await n("select count(*)::int n from public.tribe_card_templates where slug = $1 and status = 'signed_off'", [sens.slug])) === 0, "the sensitive card is still waiting");

    await sensBox.getByRole("button", { name: /^Read the \d+ cards$/ }).click();
    const row = page.getByTestId(`row-${sens.slug}`);
    await row.waitFor();
    check(await row.getByText("Sensitive", { exact: true }).isVisible(), "the sensitive card carries a Sensitive mark for the pastorate");
    await row.getByRole("button", { name: "Open" }).click();
    const editor = page.getByTestId(`template-${sens.slug}`);
    await editor.waitFor();
    check(await editor.getByTestId("hidden-profile").isVisible(), "the pastorate sees the hidden profile: what the group asks of its leader");
    await editor.getByRole("button", { name: "Sign off", exact: true }).click();
    const yes = editor.getByRole("button", { name: "Yes, sign off" });
    await yes.waitFor();
    check(await yes.isDisabled(), "a sensitive card cannot be signed off until she says she has read it");
    await shot(page, "22-sensitive");
    await editor.getByLabel(/I have read this card, and it is right for a sensitive subject/).check();
    check(await yes.isEnabled(), "…which the box allows");
    await yes.click();
    await eventually("the sensitive card is signed off", async () => (await n("select count(*)::int n from public.tribe_card_templates where slug = $1 and status = 'signed_off'", [sens.slug])) === 1);
    check(true, "she signs off the sensitive card herself, on its own");

    // A signed-off card that is changed goes back to waiting
    const edit = (await one("select slug, title, version, guardrail from public.tribe_card_templates where community_id = $1 and status = 'signed_off' and season_goal_id is not null order by sort limit 1", [first.id]))!;
    await open(page, PAGE);
    const firstBox = page.getByTestId(`community-${first.slug}`);
    await firstBox.getByRole("button", { name: /^Read the \d+ cards$/ }).click();
    const editRow = page.getByTestId(`row-${edit.slug}`);
    await editRow.getByRole("button", { name: "Open" }).click();
    const editEditor = page.getByTestId(`template-${edit.slug}`);
    await editEditor.waitFor();
    check(/signed off and its goal is live/.test(await editEditor.innerText()), "a signed-off card says that saving a change takes it back to waiting");
    const newGuard = "Keep the conversation on the goal and send anything about a person's health to a pastor.";
    await editEditor.getByLabel("The guardrail").fill(newGuard);
    await editEditor.getByRole("button", { name: "Save changes" }).click();
    await eventually("the change is saved", async () => (await one("select guardrail from public.tribe_card_templates where slug = $1", [edit.slug]))?.guardrail === newGuard);
    const edited = (await one("select status, version from public.tribe_card_templates where slug = $1", [edit.slug]))!;
    check(edited.status === "draft", "the edited card is back to waiting for sign-off");
    check(Number(edited.version) === Number(edit.version) + 1, "…as a new version");
    await editEditor.getByRole("button", { name: "Sign off", exact: true }).click();
    await editEditor.getByRole("button", { name: "Yes, sign off" }).click();
    await eventually("the edited card is signed off again", async () => (await one("select status from public.tribe_card_templates where slug = $1", [edit.slug]))?.status === "signed_off");
    check(true, "she signs it off again");

    // The review sheet
    const res = await page.request.get(`${BASE}${PAGE}/sheet`);
    check(res.status() === 200 && (res.headers()["content-type"] ?? "").startsWith("text/csv"), "the review sheet downloads as a spreadsheet file");
    check((res.headers()["content-disposition"] ?? "").includes("attachment"), "…as a download");
    check((res.headers()["cache-control"] ?? "").includes("no-store"), "…read fresh each time");
    const body = await res.text();
    check(body.charCodeAt(0) === 0xfeff, "…which opens in Excel (it starts with a byte order mark)");
    const rows = parseCsv(body);
    const header = rows[0] ?? [];
    check(rows.length - 1 === total, `the sheet has a row for every card (${rows.length - 1})`);
    check(header.length === 25 && header[0] === "#" && header[header.length - 1] === "Status now", "…with the columns the pastorate asked for and where each card stands");
    check(header.includes("Your decision") || header.some((h) => /decision/i.test(h)), "…and a column for her decision");
    check(header.some((h) => /sensitive/i.test(h)) && header.some((h) => /Structure/i.test(h)), "…and the hidden columns");
    check(rows.slice(1).every((r) => r.length === header.length), "…and every row has every column");
    const signedInSheet = rows.slice(1).filter((r) => r[r.length - 1] === "Signed off").length;
    const signedInDb = await n("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'");
    check(signedInSheet === signedInDb && signedInSheet > 0, `the sheet agrees with the database about what is signed off (${signedInSheet})`);
    check(rows.slice(1).some((r) => r[2] === sens.title), "the sensitive card is in the sheet like the others");
    await ctx.close();
  }

  // ---- A director can sign off ----------------------------------------------------------------------------------------
  {
    const second = (await one(
      `select c.slug, c.id from public.communities c
        where c.active and c.id <> $1 and exists (select 1 from public.tribe_card_templates t where t.community_id = c.id and t.status = 'draft' and not t.sensitive)
        order by c.sort limit 1`,
      [first.id],
    ))!;
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "director.bola@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("template-board").waitFor({ timeout: 20000 });
    check(await page.getByTestId(`community-${second.slug}`).getByRole("button", { name: /^Sign off the \d+ waiting$/ }).isVisible(), "a director is offered the sign-off too");
    await ctx.close();
  }

  // ---- An administrator reads and writes, but cannot sign --------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, "admin.mary@example.org", PAGE);
    await open(page, PAGE);
    await page.getByTestId("template-board").waitFor({ timeout: 20000 });
    check((await page.getByRole("button", { name: /^Sign off the \d+ waiting$/ }).count()) === 0, "an administrator is offered no sign-off");
    const draft = (await one("select slug, community_id from public.tribe_card_templates where status = 'draft' and not sensitive limit 1"))!;
    const cslug = (await one("select slug from public.communities where id = $1", [draft.community_id]))!.slug as string;
    await page.getByTestId(`community-${cslug}`).getByRole("button", { name: /^Read the \d+ cards$/ }).click();
    await page.getByTestId(`row-${draft.slug}`).getByRole("button", { name: "Open" }).click();
    const ed = page.getByTestId(`template-${draft.slug}`);
    await ed.waitFor();
    check((await ed.getByRole("button", { name: "Save changes" }).count()) === 1, "…but can edit a card");
    check((await ed.getByRole("button", { name: "Sign off", exact: true }).count()) === 0 && (await ed.getByRole("button", { name: "Retire" }).count()) === 0, "…and cannot sign it off or retire it");
    const sheet = await page.request.get(`${BASE}${PAGE}/sheet`);
    check(sheet.status() === 200, "…and can download the review sheet");
    await ctx.close();
  }

  // ---- A coach and a member do not see it ------------------------------------------------------------------------------
  for (const [email, who] of [["coach.sade@example.org", "a coach"], ["member@example.org", "a member"]] as const) {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, email, "/home");
    await open(page, PAGE);
    check((await page.getByTestId("template-board").count()) === 0, `${who} does not see the page`);
    const sheet = await page.request.get(`${BASE}${PAGE}/sheet`);
    check(sheet.status() === 404, `…or the review sheet (${sheet.status()})`);
    await ctx.close();
  }

  // ---- The leader's button ------------------------------------------------------------------------------------------------
  {
    const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const made = await k.tribe(S, { status: "draft", name: "Ready-made tribe" });
    // The tribe is about a goal whose card the pastor signed off earlier in this journey
    const signedCard = (await one("select season_goal_id, community_id from public.tribe_card_templates where status = 'signed_off' and not sensitive and season_goal_id is not null order by slug limit 1"))!;
    await q.query("update public.tribes set season_goal_id = $2, community_id = $3 where id = $1", [made.tribe, signedCard.season_goal_id, signedCard.community_id]);
    const goal = (await one("select g.title, t.who_for, t.loving_god, t.week12_outcome, t.who_leads_well, t.demand_doing from public.tribes tr join public.tribe_card_templates t on t.season_goal_id = tr.season_goal_id and t.status = 'signed_off' join public.season_goals g on g.id = tr.season_goal_id where tr.id = $1", [made.tribe]));
    check(Boolean(goal), "the leader's tribe is about a goal whose ready-made card is signed off");
    // An empty card: the three lines are what the button fills
    await q.query("update public.tribes set loving_god = '', loving_others = '', loving_life = '' where id = $1", [made.tribe]);
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, made.leader.email, "/lead/tribe");
    await open(page, "/lead/tribe");
    const panel = page.getByTestId("ready-made");
    await panel.waitFor({ timeout: 20000 });
    const shown = await panel.innerText();
    check(shown.includes("A ready-made card for this goal") && shown.includes("Written and signed off by the pastorate"), "the leader sees the ready-made card for their goal");
    check(Boolean(goal) && shown.includes(String(goal?.loving_god)), "…with its three lines");
    check(!/Sensitive|What the group asks|who leads it well/i.test(shown), "…and nothing from the hidden profile");
    await shot(page, "22-leader-ready-made");
    await noOverflow(page, "the Tribe Card with the ready-made card on a phone");
    await panel.getByRole("button", { name: "Start from the ready-made card" }).click();
    await eventually("the three lines are filled", async () => {
      const t = (await one("select loving_god, loving_others, loving_life from public.tribes where id = $1", [made.tribe]))!;
      return String(t.loving_god).length > 10 && String(t.loving_others).length > 10 && String(t.loving_life).length > 10;
    });
    check(true, "pressing the button fills the three lines, and saves them");
    check((await panel.innerText()).includes("Your three lines are already written, so nothing is changed."), "…and the button goes, so a leader's own words are never overwritten");
    const html = await page.content();
    check(!html.includes(String(goal?.who_leads_well ?? "§")), "…and the hidden note on who leads it well is nowhere in the page");
    await ctx.close();
  }

  await browser.close();
  await q.end();
  finish("22-card-templates");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

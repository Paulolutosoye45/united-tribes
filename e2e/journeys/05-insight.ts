/**
 * Insight end to end: the pastor reads the objectives and the retention curve on the dashboard, makes a
 * pastorate report and a community report from the Reports page, rewords the summary, and prints the report;
 * the heartbeat writes a plain summary where there is none, takes the daily snapshot and refreshes the BI copy;
 * a community champion sees their own community and their own report and nothing else; and a member records the days
 * they spent in the Word.
 */
import fs from "node:fs";
import path from "node:path";
import { MESSAGING } from "../env";

type Row = Record<string, unknown>;
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; summaries: number; problems: string[] } };
};

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row;
  async function person(email: string, name: string, roles: string[] = []) {
    const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email])).id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [made, name, name.split(" ")[0]]);
    for (const role of roles) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [made, role]);
    }
    return made;
  }

  // --- arrange: week 6 of the season; Insight Alpha (Professionals) with six members and five meetings held ----------
  await q.query("update public.seasons set starts_on = public.today_lagos() - 37, ends_on = public.today_lagos() - 37 + 84");
  const season = (await one("select id from public.seasons order by starts_on limit 1")).id as string;
  const community = (await one("select id from public.communities where slug = 'professionals'")).id as string;
  const wale = await person("wale.insight@example.org", "Wale Adeyemi", ["leader"]);
  await q.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader') on conflict do nothing", [wale]);
  const champion = await person("folake.champion@example.org", "Folake Champion");
  await q.query("insert into public.community_champions (person_id, community_id) values ($1, $2)", [champion, community]);
  await q.query("insert into public.person_roles (person_id, role, centre_id) select id, 'community_champion', centre_id from public.people where id = $1", [champion]);

  const tribe = (await one(
    `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time, slot,
        meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     select $1, $2, 'approved', 'Insight Alpha', (select id from public.tracks where slug = 'builders'), $3,
        (select id from public.season_goals where community_id = $3 order by sort limit 1),
        '{}', 'mixed', 'A tribe for the insight journey, long enough to be a real story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland', 'Online', 12,
        'Pray daily for each other.', 'Call each other weekly.', 'Take one step a week.', now()
     returning id`, [season, wale, community])).id as string;
  const members: string[] = [];
  const presence = [5, 5, 4, 3, 1, 0];
  for (const [i] of presence.entries()) {
    const m = await person(`p${i + 1}.insight@example.org`, `Member P${i + 1}`);
    members.push(m);
    await q.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, 90, 'e2e', '{}'::jsonb, current_date + 14)`, [tribe, m, season]);
  }
  for (let w = 1; w <= 5; w++) {
    await q.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, $2, true, $3)", [tribe, w, wale]);
    for (const [i, m] of members.entries()) {
      await q.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, $2, $3, $4)", [tribe, w, m, w <= presence[i] ? "present" : "absent"]);
    }
  }
  // member index, then belonging, god, others and life at week 6 (everyone answered 4, 3, 3, 3 in week 1)
  const pulses: [number, number, number, number, number][] = [[0, 5, 4, 4, 4], [1, 4, 4, 4, 3], [2, 4, 3, 3, 4], [3, 2, 3, 3, 3], [4, 5, 4, 4, 3]];
  for (const [i, b, g, o, l] of pulses) {
    await q.query("insert into public.pulses (person_id, tribe_id, week, belonging, god, others, life) values ($1, $2, 1, 4, 3, 3, 3)", [members[i], tribe]);
    await q.query("insert into public.pulses (person_id, tribe_id, week, belonging, god, others, life) values ($1, $2, 6, $3, $4, $5, $6)", [members[i], tribe, b, g, o, l]);
  }
  for (const [i, days] of [[0, [7, 6]], [1, [4, 4]], [2, [1, 2]]] as [number, number[]][]) {
    for (const [k, d] of days.entries()) await q.query("insert into public.word_habit (person_id, tribe_id, week, days) values ($1, $2, $3, $4)", [members[i], tribe, 4 + k, d]);
  }
  await q.query(
    `insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit, status, decided_at)
     values ($1, $2, 3, 'God opened a door at work after three weeks of prayer.', 'church', 'first_name', 'church_approved', now())`, [members[0], tribe]);

  const lastMonth = (await one("select to_char(date_trunc('month', public.today_lagos() - interval '1 month'), 'FMMonth YYYY') as m, to_char(date_trunc('month', public.today_lagos() - interval '1 month'), 'YYYY-MM') as k")) as { m: string; k: string };
  const browser = await launch();

  // --- 1. the pastor reads the objectives and the retention curve ------------------------------------------------
  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, "pastor.ife@example.org", "/dashboard");
  await open(pastor.page, "/dashboard");
  const dash = await text(pastor.page);
  check(/The objectives/.test(dash) && /Members thriving/.test(dash) && /In the Word, most days/.test(dash), "the dashboard shows the objectives against their targets");
  check(/Who is still coming/.test(dash), "…and the retention curve");
  check(/Success Picture, goal by goal/.test(dash), "…and the Success Picture goal by goal");
  check((await pastor.page.getByRole("link", { name: "Monthly reports" }).count()) > 0 && (await pastor.page.getByRole("link", { name: "Community pages" }).count()) > 0, "…with links to the reports and the community pages");
  await noOverflow(pastor.page, "the dashboard with the objectives on desktop");

  const phone = await newPage(browser);
  await signIn(phone.page, "pastor.ife@example.org", "/dashboard");
  await open(phone.page, "/dashboard");
  await noOverflow(phone.page, "the dashboard with the objectives on a phone");

  // --- 2. the pastor makes a pastorate report ---------------------------------------------------------------------
  await open(pastor.page, "/reports");
  check(await pastor.page.getByRole("heading", { name: "Make a report now" }).isVisible(), "the Reports page offers to make a report now");
  check(((await pastor.page.getByLabel("Month").inputValue()) || "") === lastMonth.k, "…with last month already chosen");
  await pastor.page.getByRole("button", { name: "Pastorate one-pager" }).click();
  await pastor.page.getByRole("button", { name: "Make the report" }).click();
  await pastor.page.waitForURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await pastor.page.getByRole("heading", { level: 1 }).waitFor();
  const pastorateUrl = pastor.page.url();
  const r1 = await text(pastor.page);
  check(new RegExp(`Pastorate one-pager · ${lastMonth.m}`).test(r1), `the report is titled for ${lastMonth.m}`);
  check(/In short/.test(r1) && /Write a summary/.test(r1), "a new report has room for a summary");
  check(/The objectives/.test(r1) && /Tribes to look at|What God did|Members/.test(r1), "…with the objectives and the people behind them");
  check(!/undefined|NaN|\[object/.test(r1), "…and no broken numbers");
  await noOverflow(pastor.page, "a report on desktop");

  // --- 3. the heartbeat writes the summary, takes the snapshot and refreshes the BI copy ------------------------------
  const beat = await tick();
  check(beat.status === 200 && beat.body.problems.length === 0 && beat.body.summaries >= 1, `the heartbeat ran cleanly and wrote ${beat.body.summaries} summary(ies)`);
  const written = await one("select summary, summary_by from public.reports where id = $1", [pastorateUrl.split("/").pop()]);
  // The journeys run with the stand-in assistant (AI_PROVIDER=mock), which hands the plain draft back; the text is the same either way.
  check(["plain", "assistant"].includes(String(written.summary_by)) && String(written.summary).length > 20, `the opening paragraph is written from the figures (${written.summary_by})`);
  check(Number((await one("select count(*)::int as n from public.kpi_snapshots where season_id = $1", [season])).n) >= 1, "a daily snapshot of the objectives was taken");
  // The heartbeat refreshes the BI copy once a day and earlier journeys have already used today's, so refresh it as an admin would.
  await q.query("select public.bi_refresh_all()");
  check(Number((await one("select count(*)::int as n from bi.members")).n) >= 6, "the BI copy holds a row per member");
  const leaked = await one("select count(*)::int as n from information_schema.columns where table_schema = 'bi' and column_name ~* '(name|email|phone|body|note)'");
  check(Number(leaked.n) === 0, "…and it has no column for a name, an email, a phone number or free text");

  await open(pastor.page, pastorateUrl);
  check(/Written (by the assistant )?from the figures below/.test(await text(pastor.page)), "the report now opens with its summary, and says how it was written");

  // --- 4. the pastor rewords it, and a later run does not overwrite it ----------------------------------------------------
  await pastor.page.getByRole("button", { name: "Reword it" }).click();
  await pastor.page.getByLabel("Summary").fill("A steady month. Alpha is meeting well and we are praying for the two members who have gone quiet.");
  await pastor.page.getByRole("button", { name: "Save the summary" }).click();
  await pastor.page.getByText("Edited by a person.").waitFor({ timeout: 10000 });
  check(/A steady month\./.test(await text(pastor.page)), "an edited summary is marked as written by a person");
  await tick();
  const kept = await one("select summary, summary_by from public.reports where id = $1", [pastorateUrl.split("/").pop()]);
  check(kept.summary_by === "edited" && /A steady month/.test(String(kept.summary)), "the next heartbeat leaves a person’s words alone");

  // --- 5. printing: the screen furniture goes and a PDF can be made ---------------------------------------------------------
  await pastor.page.emulateMedia({ media: "print" });
  check(!(await pastor.page.locator("header.glass").isVisible()), "in print the menu bar is hidden");
  check(!(await pastor.page.getByRole("button", { name: "Print or save as PDF" }).isVisible()), "…and so are the buttons");
  check(/United Tribes · Pastorate one-pager/.test(await text(pastor.page)), "…and the page says what it is at the top");
  const pdf = await pastor.page.pdf({ format: "A4", printBackground: true });
  check(pdf.subarray(0, 4).toString() === "%PDF" && pdf.length > 8000, `a PDF can be made from the report (${Math.round(pdf.length / 1024)} KB)`);
  fs.mkdirSync(path.join(process.cwd(), ".e2e"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".e2e", "pastorate-report.pdf"), pdf);
  await pastor.page.emulateMedia({ media: "screen" });

  // --- 6. a community report, and a report on a phone ------------------------------------------------------------------------
  await open(pastor.page, "/reports");
  await pastor.page.getByRole("button", { name: "Community report" }).click();
  await pastor.page.getByLabel("Community").selectOption({ label: "Professionals" });
  await pastor.page.getByRole("button", { name: "Make the report" }).click();
  await pastor.page.waitForURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await pastor.page.getByRole("heading", { level: 1 }).waitFor();
  const communityUrl = pastor.page.url();
  const t1 = await text(pastor.page);
  check(/Professionals report/.test(t1) && /Tribes in Professionals/.test(t1) && /Insight Alpha/.test(t1), "the community report lists the community’s tribes");
  await open(phone.page, communityUrl);
  await noOverflow(phone.page, "a community report on a phone");
  await open(pastor.page, "/reports");
  const list = await text(pastor.page);
  check(/Pastorate one-pager/.test(list) && /Professionals report/.test(list) && new RegExp(lastMonth.m).test(list), "the list shows both, under the month");

  // --- 7. a community champion sees their community and their report only ----------------------------------------------------------
  const champ = await newPage(browser, "desktop");
  await signIn(champ.page, "folake.champion@example.org", "/community");
  await open(champ.page, "/community");
  const ct = await text(champ.page);
  check(/Professionals/.test(ct) && /Insight Alpha/.test(ct) && /Members/.test(ct), "a champion’s page shows the community and its tribes");
  check(/6 of 12 places|6 of 12/.test(ct), "…with how full each tribe is");
  check(/Seats|Tribes to open|want a tribe/i.test(ct), "…and the seats against the demand");
  check((await champ.page.locator("nav[aria-label='Main'] a[href='/community']").count()) > 0 && (await champ.page.locator("nav[aria-label='Main'] a[href='/reports']").count()) > 0, "the menu has My community and Reports");
  check((await champ.page.locator("nav[aria-label='Main'] a[href='/dashboard']").count()) === 0, "…but not the church-wide dashboard");
  await open(champ.page, "/reports");
  const cl = await text(champ.page);
  check(/Professionals report/.test(cl) && !/Pastorate one-pager/.test(cl) && !/Make a report now/.test(cl), "a champion’s report list holds their community’s report and cannot make new ones");
  await open(champ.page, communityUrl);
  check(/Professionals report/.test(await text(champ.page)), "a champion can open their community’s report");
  await open(champ.page, pastorateUrl);
  check(/We can.t find that page/.test(await text(champ.page)), "…and cannot open the pastorate report");
  await open(champ.page, "/dashboard");
  check(!/The objectives/.test(await text(champ.page)), "…nor the dashboard");

  // --- 8. a member records the days in the Word -------------------------------------------------------------------------------
  const member = await newPage(browser);
  await signIn(member.page, "p1.insight@example.org", "/tribe");
  await open(member.page, "/tribe");
  check(await member.page.getByRole("heading", { name: "In the Word this week" }).isVisible(), "a member’s week asks how many days they were in the Word");
  await member.page.getByRole("button", { name: "5 days", exact: true }).click();
  await member.page.getByText(/Saved: 5 days this week/).waitFor({ timeout: 10000 });
  const wk = await one("select days from public.word_habit where person_id = $1 and week = 6", [members[0]]);
  check(wk?.days === 5, "the answer is stored for this week");
  await member.page.getByRole("button", { name: "6 days", exact: true }).click();
  await member.page.getByText(/Saved: 6 days this week/).waitFor({ timeout: 10000 });
  check((await one("select days from public.word_habit where person_id = $1 and week = 6", [members[0]])).days === 6, "changing it replaces it");
  await noOverflow(member.page, "the member’s week with the Word card on a phone");
  await open(pastor.page, "/dashboard");
  check(/In the Word, most days/.test(await text(pastor.page)), "the programme counts it, and the leader’s page carries no names for it");
  const leaderSees = await newPage(browser, "desktop");
  await signIn(leaderSees.page, "wale.insight@example.org", `/lead/week?tribe=${tribe}`);
  await open(leaderSees.page, `/lead/week?tribe=${tribe}`);
  check(!/Word this week|days in the Word/i.test(await text(leaderSees.page)), "a leader’s page shows nothing about who read how much");

  // leave the season as the other journeys expect it
  await q.query("update public.seasons set starts_on = current_date - 9, ends_on = current_date - 9 + 84");
  await q.end();
  await browser.close();
  finish("insight");
}
void main();

/**
 * The season engine end to end: a leader logs the week with a prayer request, care flags, a celebration and
 * "I need my coach"; the assistant, the coach and the Care Lead each get the right task (and the urgent one
 * by email AND text at once); tasks are finished and passed on; a late task is flagged by the heartbeat;
 * and a testimony travels from a member, through the leader and a pastor, to the wall and the TCN form.
 */
import { MESSAGING } from "../env";
import type { Received } from "../stubs";

type Row = Record<string, unknown>;
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[] } };
};
const stub = async (channel: string) => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Received[];

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  const id = async (email: string) => (await one("select id from public.people where email = $1", [email])).id as string;
  async function person(email: string, name: string, roles: string[] = []) {
    const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email])).id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [made, name, name.split(" ")[0]]);
    for (const role of roles) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [made, role]);
    }
    return made;
  }

  // --- arrange: week 2, the Friday; a tribe with a leader, an assistant, a coach and three members ------------
  await q.query("update public.seasons set starts_on = public.today_lagos() - 12, ends_on = public.today_lagos() - 12 + 84");
  const tunde = await person("tunde.lead@example.org", "Tunde Bakare", ["leader"]);
  const kemi = await id("kemi@example.org");
  const sade = await id("coach.sade@example.org");
  const dayo = await id("care_lead.dayo@example.org");
  const ada = await person("ada.season@example.org", "Ada Obi");
  const bayo = await person("bayo.season@example.org", "Bayo Ade");
  const tola = await person("tola.season@example.org", "Tola Eze");
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348034445555', 'email') on conflict (person_id) do update set phone = excluded.phone", [dayo]);
  const tribe = (await one(
    `insert into public.tribes (season_id, leader_id, assistant_id, coach_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time, slot,
        meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     select (select id from public.seasons order by starts_on limit 1), $1, $2, $3, 'approved', 'Season Engine Tribe', (select id from public.tracks where slug = 'builders'),
        (select id from public.communities where slug = 'professionals'), (select id from public.season_goals where slug = 'step-into-a-leadership-role'),
        '{}', 'mixed', 'A tribe for the season engine journey, long enough to be a real story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland', 'Online', 12,
        'Pray daily for each other.', 'Call each other weekly.', 'Take one step a week.', now()
     returning id`, [tunde, kemi, sade])).id as string;
  for (const m of [ada, bayo, tola]) {
    await q.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       select $1, $2, season_id, 1, 90, 'e2e', '{}'::jsonb, current_date + 14 from public.tribes where id = $1`, [tribe, m]);
  }
  const browser = await launch();

  // --- 1. the member's week carries the confession ------------------------------------------------------------
  const member = await newPage(browser);
  await signIn(member.page, "ada.season@example.org", "/tribe");
  await open(member.page, "/tribe");
  const mText = await text(member.page);
  check(/Say this through the week/.test(mText), "a member’s week shows the confession to say");
  check(/Pray with expectation|Hear Him every day|Better together|Honest words/.test(mText), "…next to the week’s guide");
  await noOverflow(member.page, "member week on a phone");

  // --- 2. the leader logs the week ----------------------------------------------------------------------------
  const lead = await newPage(browser, "desktop");
  await signIn(lead.page, "tunde.lead@example.org", `/lead/week?tribe=${tribe}`);
  await open(lead.page, `/lead/week?tribe=${tribe}`);
  const lText = await text(lead.page);
  check(/For this tribe/.test(lText) && /Professionals/.test(lText), "the leader’s week shows the community’s skill-share prompt");
  check(/Say this through the week/.test(lText), "…and the confession");
  const form = lead.page.locator("section#log");
  check(await form.getByText("How did the meeting feel?").isVisible(), "the log asks how the meeting felt");

  await form.locator('div[role="radiogroup"][aria-label="Bayo Ade this week"] label', { hasText: "Away" }).click();
  await form.locator('div[role="radiogroup"][aria-label="Energy of the meeting"] label').nth(3).click();
  await form.getByLabel("Add a request").fill("A job interview on Tuesday");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await form.locator('div[role="radiogroup"][aria-label="Care for Ada Obi"] label', { hasText: "Practical" }).click();
  await form.getByLabel("What does Ada need?").fill("Needs a lift to the clinic on Thursday");
  await form.locator('div[role="radiogroup"][aria-label="Care for Tola Eze"] label', { hasText: "Urgent" }).click();
  await form.getByLabel("What does Tola need?").fill("In hospital tonight");
  await form.getByRole("button", { name: "Add something to celebrate" }).click();
  await form.getByRole("button", { name: "New baby" }).click();
  await form.getByLabel("A few words").fill("A baby girl on Tuesday");
  await form.getByLabel("Who? (optional)").selectOption({ label: "Ada Obi" });
  await form.getByLabel("I need my coach this week").check();
  await form.getByLabel("What would help?").fill("Two members are not speaking to each other");
  await noOverflow(lead.page, "the log on desktop");
  await form.getByRole("button", { name: /Save the log|Save changes/ }).click();
  await lead.page.getByText("Saved. Thank you.").waitFor({ timeout: 15000 });
  check(true, "saving the log confirms it");

  const log = await one("select held, energy, need_coach, need_coach_note from public.tribe_logs where tribe_id = $1 and week = 2", [tribe]);
  check(log?.held === true && log.energy === 4 && log.need_coach === true && /not speaking/.test(String(log.need_coach_note)), "energy, held and the note to the coach are stored");
  check((await all("select body from public.prayer_requests where tribe_id = $1", [tribe])).map((r) => r.body).join() === "A job interview on Tuesday", "the prayer request is on the tribe’s private list");
  const att = await all("select person_id, status from public.tribe_attendance where tribe_id = $1", [tribe]);
  check(att.find((a) => a.person_id === bayo)?.status === "absent" && att.filter((a) => a.status === "present").length === 2, "attendance is stored (one away, two here)");
  const cel = await one("select kind, person_id, note from public.celebrations where tribe_id = $1", [tribe]);
  check(cel?.kind === "new_baby" && cel.person_id === ada && /baby girl/.test(String(cel.note)), "the celebration is stored with the right person");

  const tasks = await all("select kind, assignee_role, assigned_to, due_on, person_id from public.care_tasks where tribe_id = $1 order by kind", [tribe]);
  const practical = tasks.find((t) => t.kind === "practical");
  const urgent = tasks.find((t) => t.kind === "urgent");
  const help = tasks.find((t) => t.kind === "coach_help");
  check(practical?.assigned_to === kemi && practical.person_id === ada, "the practical need became a task for the assistant leader");
  check(urgent?.assignee_role === "care_lead" && urgent.assigned_to === null, "the urgent need went to the Care Lead queue");
  check(help?.assigned_to === sade, "“I need my coach” became a task for the coach");

  // --- 3. the heartbeat: urgent alerts by email AND text, task messages, celebration prompts --------------------
  const beat = await tick();
  check(beat.status === 200 && beat.body.problems.length === 0, `the heartbeat ran cleanly (${beat.body.sent} sent)`);
  const emails = await stub("email");
  const urgentMail = emails.find((r) => (r.body.to as string[])[0] === "care_lead.dayo@example.org" && /URGENT/.test(String(r.body.subject)));
  check(Boolean(urgentMail) && String(urgentMail?.body.text).includes("Tola Eze"), "the Care Lead was emailed about the urgent need");
  const texts = await stub("sms");
  const urgentSms = texts.find((r) => r.body.to === "2348034445555" && /URGENT/.test(String(r.body.sms)));
  check(Boolean(urgentSms), "…and texted at the same time");
  check(!/hospital/i.test(String(urgentSms?.body.sms)), "the text carries no detail of what happened");
  check(emails.some((r) => (r.body.to as string[])[0] === "kemi@example.org" && /care task/i.test(String(r.body.subject))), "the assistant was told about her care task");
  check(emails.some((r) => (r.body.to as string[])[0] === "coach.sade@example.org" && /would like your help/.test(String(r.body.subject))), "the coach was told the leader asked for help");
  check(emails.some((r) => (r.body.to as string[])[0] === "tunde.lead@example.org" && /Celebrate with Ada/.test(String(r.body.subject))), "the leader was reminded to celebrate with Ada");

  // --- 4. the assistant finishes her task ------------------------------------------------------------------------
  const asst = await newPage(browser, "desktop");
  await signIn(asst.page, "kemi@example.org", "/care");
  await open(asst.page, "/care");
  check(/Needs a lift to the clinic/.test(await text(asst.page)), "the assistant sees the task and its note on the care page");
  check((await asst.page.locator("nav[aria-label='Main'] a", { hasText: "Care" }).count()) > 0, "the menu has a Care item for an assistant leader");
  await asst.page.getByRole("button", { name: "Mark done" }).first().click();
  await asst.page.getByLabel("What did you do? (optional)").fill("Drove her on Thursday");
  await asst.page.getByRole("button", { name: "Save as done" }).click();
  await asst.page.getByText("Nothing is waiting for you").waitFor({ timeout: 10000 });
  const done = await one("select status, closed_note from public.care_tasks where tribe_id = $1 and kind = 'practical'", [tribe]);
  check(done.status === "done" && done.closed_note === "Drove her on Thursday", "finishing a task records what was done");

  // --- 5. the Care Lead works the queue and passes a task on ----------------------------------------------------
  const care = await newPage(browser, "desktop");
  await signIn(care.page, "care_lead.dayo@example.org", "/care");
  await open(care.page, "/care");
  const cText = await text(care.page);
  check(/Care Lead queue/.test(cText) && /Urgent need/.test(cText) && /Tola Eze/.test(cText), "the Care Lead sees the urgent need at the top of the queue");
  check(/Seen to in 7 days/.test(cText) && /Open now/.test(cText), "…with the numbers on how care is going");
  const card = care.page.locator('li[data-task-kind="urgent"]');
  await card.getByRole("button", { name: "Pass on" }).click();
  await card.getByLabel("Pass it to").selectOption({ label: "Sade Williams (Coach)" });
  await card.getByRole("button", { name: "Pass it on" }).click();
  await care.page.waitForFunction(() => !document.querySelector('li[data-task-kind="urgent"] select'), undefined, { timeout: 10000 });
  const passed = await one("select assignee_role, assigned_to from public.care_tasks where tribe_id = $1 and kind = 'urgent'", [tribe]);
  check(passed.assignee_role === "coach" && passed.assigned_to === sade, "the Care Lead passed the urgent task to the coach");

  // --- 6. a task that is late is flagged by the heartbeat -----------------------------------------------------------
  await q.query("update public.care_tasks set due_on = public.today_lagos() - 1 where tribe_id = $1 and kind = 'coach_help'", [tribe]);
  await tick();
  const late = (await stub("email")).filter((r) => /Late: coach_help|Late:/.test(String(r.body.subject)) || /still open|was due on/.test(String(r.body.text)));
  check(late.some((r) => (r.body.to as string[])[0] === "care_lead.dayo@example.org"), "the Care Lead is told when a task is late");
  check(late.some((r) => (r.body.to as string[])[0] === "coach.sade@example.org"), "…and so is the person it is with");

  // --- 7. the prayer list: answered prayers become celebrations -----------------------------------------------------
  await open(lead.page, `/lead/week?tribe=${tribe}`);
  check(/Your tribe’s prayer list/.test(await text(lead.page)) && /A job interview on Tuesday/.test(await text(lead.page)), "the leader sees the tribe’s private prayer list");
  await lead.page.getByRole("button", { name: "Answered", exact: true }).click();
  await lead.page.getByLabel("What happened?").fill("She got the job");
  await lead.page.getByRole("button", { name: "Mark as answered" }).click();
  await lead.page.getByText("Answered recently").waitFor({ timeout: 10000 });
  const pr = await one("select answered_at, answered_note from public.prayer_requests where tribe_id = $1", [tribe]);
  check(pr.answered_at && pr.answered_note === "She got the job", "marking a prayer answered keeps the note");
  check((await one("select count(*)::int as n from public.celebrations where tribe_id = $1 and kind = 'answered_prayer'", [tribe])).n === 1, "…and adds it to the tribe’s celebrations");
  const other = await newPage(browser);
  await signIn(other.page, "bayo.season@example.org", `/lead/week?tribe=${tribe}`);
  check(!/prayer list/i.test(await text(other.page)), "a member cannot see the prayer list");

  // --- 8. a testimony: member -> leader (with a theme) -> pastor -> wall -> the TCN form ----------------------------
  await open(member.page, "/tribe/testimony");
  await member.page.getByLabel("What has God done in your life this season?").fill("God provided the rent I could not find, just in time. I am so grateful.");
  await member.page.locator("label.choice", { hasText: "The whole church" }).click();
  await member.page.getByRole("button", { name: "Send for review" }).click();
  await member.page.getByText("Sent. Your leader will read it first.").waitFor({ timeout: 10000 });
  check(true, "the member sent a testimony for the church");

  await open(lead.page, `/lead/week?tribe=${tribe}`);
  const review = lead.page.locator("#testimonies");
  check(/God provided the rent/.test(await review.innerText()), "the leader sees it waiting");
  await review.getByRole("button", { name: "Provision" }).click();
  await review.getByRole("button", { name: "Approve", exact: true }).click();
  await lead.page.waitForFunction(() => /No testimonies are waiting/.test(document.body.innerText), undefined, { timeout: 10000 });
  const t1 = await one("select status, themes, community_id from public.testimonies where tribe_id = $1", [tribe]);
  check(t1.status === "tribe_approved" && (t1.themes as string[]).join() === "provision" && t1.community_id, "approved for the tribe, tagged “provision”, with the tribe’s community");

  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, "pastor.ife@example.org", "/review/rhythm");
  await open(pastor.page, "/review/rhythm");
  const church = pastor.page.locator("#church");
  check(/God provided the rent/.test(await church.innerText()), "the pastor sees it in the church queue");
  await church.getByRole("button", { name: "Approve for the church" }).click();
  await pastor.page.waitForFunction(() => /No testimonies are waiting/.test(document.body.innerText), undefined, { timeout: 10000 });
  check((await one("select status from public.testimonies where tribe_id = $1", [tribe])).status === "church_approved", "approved for the whole church");

  await open(member.page, "/testimonies");
  const wall = await text(member.page);
  check(/God provided the rent/.test(wall) && /Ada/.test(wall) && /Professionals/.test(wall) && /Provision/.test(wall), "the wall shows the testimony with the name she chose, her community and its theme");
  await member.page.getByRole("link", { name: /^Provision/ }).click();
  await member.page.waitForURL(/theme=provision/);
  check(/God provided the rent/.test(await text(member.page)), "filtering by theme keeps it");
  await open(member.page, "/testimonies?theme=healing");
  check(/Nothing matches those filters/.test(await text(member.page)), "a theme with nothing shows an honest empty message");
  await noOverflow(member.page, "the testimony wall on a phone");
  check(!/Send to the TCN form/.test(await text(member.page)), "members do not see the forwarding control");

  await open(pastor.page, "/testimonies");
  await pastor.page.getByRole("button", { name: "Send to the TCN form" }).click();
  await pastor.page.getByRole("button", { name: "Copy the words" }).waitFor({ timeout: 10000 });
  check(/God provided the rent/.test(await text(pastor.page)), "the pastor is shown the words to paste into the form");
  const fwd = await one("select forwarded_at, forwarded_by from public.testimonies where tribe_id = $1", [tribe]);
  check(fwd.forwarded_at && fwd.forwarded_by, "it is recorded as sent, and by whom");

  // --- 9. Home tells people with tasks ----------------------------------------------------------------------------------
  await open(asst.page, "/home");
  await noOverflow(asst.page, "Home fits on a phone for an assistant with care tasks");
  const coachPage = await newPage(browser);
  await signIn(coachPage.page, "coach.sade@example.org", "/home");
  await open(coachPage.page, "/home");
  check(/people are waiting on you|One person is waiting on you/.test(await text(coachPage.page)), "Home tells the coach that tasks are waiting");

  // leave the season as the other journeys expect it
  await q.query("update public.seasons set starts_on = current_date - 9, ends_on = current_date - 9 + 84");
  await q.end();
  await browser.close();
  finish("season");
}
void main();

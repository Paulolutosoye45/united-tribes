/**
 * Profiles and the Weekly Rhythm, stage 2 (My page for everyone), end to end.
 *
 *  - Everything starts Off: nobody finds My page, a link to it, a strip on Home, or a Care Team list.
 *  - The owner opens My page for everyone and then the four new functions, one by one, on the console's Features page, with a reason for each.
 *  - A member finds My page in her account menu. She types her name, picks her area and her birthday (the database refuses a name that is not a name),
 *    writes her story and chooses up to three gifts (a fourth cannot be chosen), and sees one panel for the role she holds.
 *  - Her Home page asks "Still right?" about her age range once; "Not now" puts it away for the season. A leader answers "Yes, still right".
 *  - She tells the Care Team her age range is wrong in a way the list cannot fix. Nothing is changed for her. The care lead hears, reads it on the
 *    young people's page, marks it looked at with a note, and she reads the note on her page.
 *  - Her data file holds what she wrote and what she told the Care Team, and only hers.
 *  - Someone under 18 is never shown My page, a link to it or the strip.
 *  - The Master pause turns every part Off at once, keeps everything written, and one more press puts it back.
 *
 * What is only arranged here (a season, a member's joining form, an appointed leader, a young person) is arranged in the database the way the database
 * tests do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const NOT_FOUND = /We can.t find that page/;
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

/** A check on what a page says; when it fails, shows what the page did say. */
function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off, a season under way, a member, a young person, an appointed leader, a care lead -----------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");

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
  const S = await k.season("Stage 2 season", 10);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);

  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "mypage.owner@example.org"); // the shared e2e database may already hold owner@example.org from another journey
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const eze = await adapter.createUser({ email: "eze.member39@example.org" });
  await q.query("update public.people set full_name = 'Eze Member', preferred_name = 'Eze' where id = $1", [eze.id]);
  await k.profile(eze.id, S, { zone: "mainland", age: "26-32" });
  // her joining form was filled in long before this season began
  await q.query("update public.member_profiles set submitted_at = now() - interval '90 days' where person_id = $1", [eze.id]);

  const teen = await adapter.createUser({ email: "teen.member39@example.org" });
  await q.query("update public.people set full_name = 'Teen Member', preferred_name = 'Teen' where id = $1", [teen.id]);
  await k.profile(teen.id, S, { age: "33-40" });
  await q.query("begin");
  await q.query("set local session_replication_role = replica");
  await q.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [teen.id]);
  await q.query("commit");

  const ada = await adapter.createUser({ email: "ada.appointed39@example.org" });
  await q.query("update public.people set full_name = 'Ada Appointed', preferred_name = 'Ada' where id = $1", [ada.id]);
  const goal = (await one("select id from public.season_goals where slug = $1", [FORM.goal]))!.id as string;
  const appointed = await o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), goal, "Known to the church for years.");
  check(appointed?.ok === true, "Ada is appointed by the office (arranged in the database)");

  const care = await k.staff("Care Lead", "care_lead");
  const byAda = async (sql: string) => adapter.asUser(ada.id, (run) => run(sql));

  const browser = await launch();
  const PASTOR = "pastor.ife@example.org";

  // ---- Everything Off: nobody finds anything --------------------------------------------------------------------------------------------
  {
    const a = await newPage(browser, "phone");
    await signIn(a.page, eze.email, "/home");
    await open(a.page, "/home");
    await a.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("still-right").count()) === 0, "with everything Off, Eze's Home has no \"Still right?\" strip");
    await a.page.getByRole("button", { name: "Your account" }).click();
    await a.page.getByRole("region", { name: "Account" }).waitFor({ timeout: 10000 });
    check((await a.page.getByTestId("menu-my-page").count()) === 0, "…her account menu has no link to My page");
    await open(a.page, "/my");
    check(NOT_FOUND.test(await text(a.page)), "…and My page does not exist for her");
    await a.ctx.close();
  }
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, care.email, "/care/teens");
    await open(p.page, "/care/teens");
    await p.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await p.page.getByTestId("office-asks").count()) === 0, "with everything Off, the young people's page has no list of age-range messages");
    await p.ctx.close();
  }

  // ---- God Mode: the four new functions, one by one ---------------------------------------------------------------------------------------
  const { ctx, page } = await newPage(browser, "desktop");
  await signIn(page, o.owner.email, "/home");
  await page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await page.getByLabel("Passphrase").fill(PHRASE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });

  async function switchOn(key: string) {
    await open(page, "/god/features");
    await page.getByTestId("features-board").waitFor({ timeout: 20000 });
    const box = page.getByTestId(`feature-${key}-editor`);
    if ((await box.count()) === 0) await page.getByTestId(`feature-${key}-open`).click();
    await box.waitFor({ timeout: 15000 });
    await page.getByTestId(`feature-${key}-on`).click();
    await box.getByLabel(/Why open it for the whole church/).fill("Trying stage 2 with everyone");
    await page.getByTestId(`feature-${key}-save`).click();
    await eventually(`${key} is On`, async () => (await one("select position from public.feature_settings where feature = $1 and scope = 'platform'", [key]))?.position === "on");
  }

  await open(page, "/god/features");
  await page.getByTestId("features-board").waitFor({ timeout: 20000 });
  await shot(page, "39-board-off");
  const board = await page.getByTestId("features-board").innerText();
  has("the board lists the four functions of stage 2, each Off", /More facts on My page[\s\S]*Off/, board);
  for (const key of ["my_details", "my_story", "role_panels", "still_right"]) {
    check(/Off/.test(await page.getByTestId(`feature-${key}`).innerText()), `${key} starts Off`);
  }
  check((await page.locator('[data-testid^="feature-"][data-testid$="-open"]').count()) === 17, "seventeen functions can be moved: the three of stage 1 and the four of stage 2 of Profiles, the four whole-church functions of WhatsApp reliability, WhatsApp mode and Contact gaps, the two of the contact series, Reach series and Tribe note, the Placed nudge, and the Placed answers");
  has("the board says what each does and who sees it", /Nobody else sees them in this release/, board);

  // A new function cannot be opened before My page
  {
    const box = page.getByTestId("feature-my_details-editor");
    if ((await box.count()) === 0) await page.getByTestId("feature-my_details-open").click();
    await box.waitFor({ timeout: 15000 });
    await page.getByTestId("feature-my_details-on").click();
    await box.getByLabel(/Why open it for the whole church/).fill("Trying stage 2 with everyone");
    await page.getByTestId("feature-my_details-save").click();
    const notice = page.getByTestId("feature-my_details").getByRole("alert");
    await notice.waitFor({ timeout: 15000 });
    check(/Open My page.* first/i.test(await notice.innerText()), "More facts cannot be opened before My page: the owner is told what to open first");
    check((await n("select count(*)::int n from public.feature_settings")) === 0, "…and nothing was saved");
  }

  for (const key of ["my_page", "my_details", "my_story", "role_panels", "still_right"]) await switchOn(key);
  check((await n("select count(*)::int n from public.feature_settings where position = 'on' and scope = 'platform'")) === 5, "My page and the four new functions are On for everyone (five rules)");
  check((await n("select count(*)::int n from public.feature_log")) >= 5, "each move has its line in the log");
  await open(page, "/god/features");
  await page.getByTestId("features-board").waitFor({ timeout: 20000 });
  await shot(page, "39-board-on");

  // ---- Eze: the account menu, then My page ---------------------------------------------------------------------------------------------------
  const m = await newPage(browser, "phone");
  await signIn(m.page, eze.email, "/home");
  await open(m.page, "/home");
  await m.page.getByTestId("still-right").waitFor({ timeout: 20000 });
  const strip = await m.page.getByTestId("still-right").innerText();
  has("Home asks \"Still right?\" about her age range, and names the season", /Still right\?[\s\S]*Stage 2 season[\s\S]*Age range[\s\S]*26/, strip);
  check((await m.page.getByTestId("still-age_range-yes").count()) === 1 && (await m.page.getByTestId("still-age_range-change").count()) === 1 && (await m.page.getByTestId("still-age_range-later").count()) === 1, "…with three answers: still right, it has changed, not now");
  await noOverflow(m.page, "Home with the strip, on a phone");
  await shot(m.page, "39-home-strip");
  const before = await n("select count(*)::int n from public.messages where person_id = $1", [eze.id]);
  await m.page.getByTestId("still-age_range-later").click();
  await m.page.getByTestId("still-age_range-done").waitFor({ timeout: 15000 });
  check(/We will not ask again this season/.test(await text(m.page)), "\"Not now\" says it will not ask again this season");
  check((await n("select count(*)::int n from public.profile_prompts where person_id = $1", [eze.id])) === 1, "…and the database keeps that for the season");
  check((await n("select count(*)::int n from public.messages where person_id = $1", [eze.id])) === before, "…nothing was sent to anyone");
  await open(m.page, "/home");
  await m.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
  check((await m.page.getByTestId("still-right").count()) === 0, "after \"Not now\" the strip does not come back");
  check((await one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [eze.id]))?.slug === "26-32", "…and her age range is what it was");

  await m.page.getByRole("button", { name: "Your account" }).click();
  await m.page.getByTestId("menu-my-page").waitFor({ timeout: 10000 });
  check(true, "her account menu now has a link to My page");
  await m.page.getByTestId("menu-my-page").click();
  await m.page.waitForURL(/\/my$/, { timeout: 15000 });
  await m.page.getByTestId("my-preferred_name").waitFor({ timeout: 20000 });
  const mine = await text(m.page);
  has("My page greets her and has an About you part and a My story part", /Eze, this is your page[\s\S]*About you[\s\S]*My story/, mine);
  has("…which says who sees her story: nobody else, for now", /nobody else sees them/i, mine);
  check((await m.page.getByTestId("my-age_range").count()) === 1, "…the question about her age range is still there");
  await noOverflow(m.page, "My page on a phone");
  await shot(m.page, "39-my-page");

  // The name: refused when it is not a name, saved when it is
  const nameBox = m.page.getByTestId("my-preferred_name-input");
  check((await nameBox.inputValue()) === "Eze", "her name box starts with the name we use for her");
  await nameBox.fill("12345");
  await m.page.getByTestId("my-preferred_name-save").click();
  await m.page.getByTestId("my-preferred_name-error").waitFor({ timeout: 15000 });
  has("a name with no letter is refused in words", /at least one letter/i, await m.page.getByTestId("my-preferred_name-error").innerText());
  check((await one("select preferred_name from public.people where id = $1", [eze.id]))?.preferred_name === "Eze", "…and nothing was saved");
  await nameBox.fill("Ezinne");
  await m.page.getByTestId("my-preferred_name-save").click();
  await m.page.getByTestId("my-preferred_name-saved").waitFor({ timeout: 15000 });
  check((await one("select preferred_name from public.people where id = $1", [eze.id]))?.preferred_name === "Ezinne", "a name is saved the moment she presses Save");
  check((await n("select count(*)::int n from public.profile_fact_history where person_id = $1 and key = 'preferred_name'", [eze.id])) === 1, "…with its step kept");

  // The area (saved at once, nobody is moved) and the birthday
  has("the area says what saving does: suggested tribes are worked out again, nobody is moved", /Nobody is moved/, await m.page.getByTestId("my-area").innerText());
  await m.page.getByTestId("my-area-input").selectOption("island-lekki");
  await m.page.getByTestId("my-area-save").click();
  await m.page.getByTestId("my-area-saved").waitFor({ timeout: 15000 });
  check((await one("select zone from public.member_profiles where person_id = $1", [eze.id]))?.zone === "island-lekki", "her area is saved");
  await m.page.getByTestId("my-birthday-month").selectOption("03");
  await m.page.getByTestId("my-birthday-day").selectOption("14");
  await m.page.getByTestId("my-birthday-save").click();
  await m.page.getByTestId("my-birthday-saved").waitFor({ timeout: 15000 });
  const bd = await one("select birthday_month m, birthday_day d from public.member_profiles where person_id = $1", [eze.id]);
  check(Number(bd?.m) === 3 && Number(bd?.d) === 14, "her birthday is saved as a day and a month (14 March)");
  await eventually("the birthday card says what it kept", async () => /Saved as 14 March\. Only the day and the month are kept, never the year/.test(await m.page.getByTestId("my-birthday").innerText()));
  check(!/\b(19|20)\d\d\b/.test(await m.page.getByTestId("my-birthday").innerText()), "…and no year appears anywhere on the card");

  // The story: a line, up to three gifts
  await m.page.getByTestId("my-about_me-input").fill("I love Sunday mornings and long walks.");
  await m.page.getByTestId("my-about_me-save").click();
  await m.page.getByTestId("my-about_me-saved").waitFor({ timeout: 15000 });
  check((await one("select value from public.profile_story where person_id = $1 and key = 'about_me'", [eze.id]))?.value === "I love Sunday mornings and long walks.", "a line about her is kept for her");
  const gifts = m.page.getByTestId("my-gifts");
  for (const g of ["Teaching", "Prayer", "Giving"]) await gifts.locator("label", { hasText: g }).first().click();
  check((await gifts.locator('input[type="checkbox"]:not(:checked)').first().isDisabled()), "three gifts are chosen and a fourth cannot be");
  await m.page.getByTestId("my-gifts-save").click();
  await m.page.getByTestId("my-gifts-saved").waitFor({ timeout: 15000 });
  check((await one("select value from public.profile_story where person_id = $1 and key = 'gifts'", [eze.id]))?.value === "teaching,prayer,giving", "her gifts are saved in the order she chose them");
  await shot(m.page, "39-my-story");
  await open(m.page, "/my");
  await m.page.getByTestId("my-preferred_name").waitFor({ timeout: 20000 });
  check((await m.page.getByTestId("my-preferred_name-input").inputValue()) === "Ezinne" && (await m.page.getByTestId("my-about_me-input").inputValue()) === "I love Sunday mornings and long walks.", "after a reload, what she wrote is what is shown");
  has("her role panel names her tribe and her goal, and links to My tribe", /Your season[\s\S]*Not placed yet/, await m.page.getByTestId("my-panel-member").innerText());
  check((await m.page.getByTestId("my-panel-member").getByRole("link", { name: "Open My tribe" }).count()) === 1, "…with the way to the place that has the whole of it");

  // The Care Team's notices are their own switch (every group starts Off; an admin moves it in Admin). The message lands on the young people's page either
  // way; the notice is only written once the group is on, so it is switched on here as an admin would.
  await q.query("update public.notice_settings set mode = 'on' where group_key = 'care'");

  // ---- Tell the Care Team: nothing changes for her ----------------------------------------------------------------------------------------------
  await m.page.getByTestId("my-office-open").click();
  await m.page.getByTestId("my-office-note").fill("I am really 16 and put the wrong range by mistake.");
  await m.page.getByTestId("my-office-send").click();
  await m.page.getByTestId("my-office-status").waitFor({ timeout: 15000 });
  has("she is told the Care Team has her message", /Care Team has your message/, await m.page.getByTestId("my-office-status").innerText());
  const ask = await one("select id, status, held_value, note from public.profile_office_asks where person_id = $1", [eze.id]);
  check(ask?.status === "open" && ask?.held_value === "26-32", "the message is kept, with the range the church held");
  check((await one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [eze.id]))?.slug === "26-32", "…and her age range is exactly what it was");
  check((await n("select count(*)::int n from public.profile_changes where person_id = $1", [eze.id])) === 0, "…and no change was started");
  const notices = (await q.query("select n.person_id, n.label, n.path from public.notice_items n where n.kind = 'care_age_ask' and n.event = $1", [`ageask:${ask!.id}`])).rows as Row[];
  // The notice goes to the centre's care leads (the shared database may hold more than one), each once, found by its event.
  check(notices.length >= 1 && notices.some((x) => x.person_id === care.id), "the Care Team's care lead has a notice about it");
  check(notices.every((x) => x.path === "/care/teens" && !/Ezinne|Eze|Member|16/.test(String(x.label ?? ""))), "…which names nobody, gives no reason, and links to the young people's page");
  check((await n("select count(*)::int n from public.person_roles where role = 'care_lead' and person_id = any($1::uuid[])", [notices.map((x) => x.person_id)])) === notices.length, "…and everyone told is a care lead");

  // ---- The care lead replies --------------------------------------------------------------------------------------------------------------------
  {
    const c = await newPage(browser, "desktop");
    await signIn(c.page, care.email, "/care/teens");
    await open(c.page, "/care/teens");
    await c.page.getByTestId("office-asks").waitFor({ timeout: 20000 });
    const list = await c.page.getByTestId("office-asks").innerText();
    has("the young people's page lists her, what the church holds and what she wrote", /Ezinne|Eze[\s\S]*26[\s\S]*I am really 16/, list);
    has("…and says nothing has been changed for her", /Nothing has been changed for them/, list);
    await shot(c.page, "39-care-list");
    await c.page.getByTestId(`office-ask-note-${ask!.id}`).fill("We will phone you and your parent on Monday.");
    await c.page.getByTestId(`office-ask-close-${ask!.id}`).click();
    await eventually("the message is closed", async () => (await one("select status from public.profile_office_asks where id = $1", [ask!.id]))?.status === "done");
    check((await one("select a.slug from public.member_profiles m join public.age_ranges a on a.id = m.age_range_id where m.person_id = $1", [eze.id]))?.slug === "26-32", "closing it changes nothing about her age range");
    await c.ctx.close();
  }
  await open(m.page, "/my");
  await m.page.getByTestId("my-office-status").waitFor({ timeout: 20000 });
  has("she reads the Care Team's note on her own page", /looked at your message[\s\S]*We will phone you and your parent on Monday/, await m.page.getByTestId("my-office-status").innerText());

  // ---- Her data file ----------------------------------------------------------------------------------------------------------------------------
  {
    const res = await m.ctx.request.get(`${BASE}/profile/data`);
    check(res.status() === 200, "she can download her data");
    const file = (await res.json()) as Record<string, unknown>;
    const story = file.your_story as Record<string, string> | undefined;
    check(story?.["About me"] === "I love Sunday mornings and long walks." && story?.Gifts === "Teaching, Prayer, Giving", "…it holds her story, with the gifts in words");
    check(Array.isArray(file.how_a_fact_changed) && (file.how_a_fact_changed as unknown[]).length >= 3, "…how her name, area and birthday changed");
    check(Array.isArray(file.what_you_told_the_care_team) && /really 16/.test(JSON.stringify(file.what_you_told_the_care_team)), "…what she told the Care Team");
    check(Array.isArray(file.still_right_not_now), "…and the strip she put away");
    check(!/Ada|Teen Member/.test(JSON.stringify(file.how_a_fact_changed)), "…and only hers");
  }

  // ---- Ada, a leader: "Yes, still right" --------------------------------------------------------------------------------------------------------
  await byAda("select public.my_page_answer('life_stage', 'yes', null)");
  await q.query("update public.profile_facts set confirmed_at = now() - interval '90 days' where person_id = $1", [ada.id]);
  {
    const a = await newPage(browser, "phone");
    await signIn(a.page, ada.email, "/home");
    await open(a.page, "/home");
    await a.page.getByTestId("still-right").waitFor({ timeout: 20000 });
    has("Ada's Home asks her about her stage of life", /Stage of life[\s\S]*26 to 40, the Builders stage/, await a.page.getByTestId("still-right").innerText());
    await a.page.getByTestId("still-life_stage-yes").click();
    // Saving the answer also refreshes Home, which has no strip once nothing is due, so the "Thanks" line can be replaced within a tenth of a second.
    // The answer is done when either the line or the gap where the strip was is on the screen; the database check below is what proves it was kept.
    await a.page.waitForFunction(() => Boolean(document.querySelector("[data-testid='still-life_stage-done']")) || !document.querySelector("[data-testid='still-life_stage-yes']"), undefined, { timeout: 15000 });
    check((await one("select confirmed_at > now() - interval '1 hour' as fresh from public.profile_facts where person_id = $1 and key = 'life_stage'", [ada.id]))?.fresh === true, "\"Yes, still right\" is her confirmation, stamped today");
    await open(a.page, "/my");
    await a.page.getByTestId("my-preferred_name").waitFor({ timeout: 20000 });
    check((await a.page.getByTestId("my-area").count()) === 0 && (await a.page.getByTestId("my-birthday").count()) === 0, "a leader with no joining form is not asked for an area or a birthday");
    check((await a.page.getByTestId("my-office").count()) === 0, "…nor shown the age-range message, which is for members");
    has("…her panel is about the tribe she leads", /Your tribe[\s\S]*Tribe Card/, await a.page.getByTestId("my-panel-leader").innerText());
    await a.ctx.close();
  }

  // ---- A young person is never shown any of it -------------------------------------------------------------------------------------------------
  {
    const t = await newPage(browser, "phone");
    await signIn(t.page, teen.email, "/home");
    await open(t.page, "/home");
    await t.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await t.page.getByTestId("still-right").count()) === 0, "someone under 18 has no \"Still right?\" strip");
    await t.page.getByRole("button", { name: "Your account" }).click();
    await t.page.getByRole("region", { name: "Account" }).waitFor({ timeout: 10000 });
    check((await t.page.getByTestId("menu-my-page").count()) === 0, "…no link to My page");
    await open(t.page, "/my");
    check(NOT_FOUND.test(await text(t.page)), "…and My page does not exist for them");
    await t.ctx.close();
  }

  // ---- Nobody else can read her story ----------------------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "desktop");
    await signIn(p.page, PASTOR, "/my");
    await open(p.page, "/my");
    await p.page.getByTestId("my-preferred_name").waitFor({ timeout: 20000 });
    check(!/Sunday mornings|really 16|Ezinne/.test(await text(p.page)), "the pastor's own My page shows nothing of Eze's story, name or message");
    check(
      (await p.page.getByTestId("my-about_me-input").inputValue()) === "" && (await p.page.getByTestId("my-gifts").locator('input[type="checkbox"]:checked').count()) === 0,
      "…and his own cards for them are empty (the list of gifts is the church's; the ticks are hers alone)",
    );
    await p.ctx.close();
  }

  // ---- The Master pause --------------------------------------------------------------------------------------------------------------------------
  await open(page, "/god/features");
  await page.getByTestId("features-board").waitFor({ timeout: 20000 });
  await page.getByTestId("master-toggle").click();
  await eventually("everything is paused", async () => (await one("select paused from public.feature_master"))?.paused === true);
  await open(m.page, "/my");
  check(NOT_FOUND.test(await text(m.page)), "paused: My page acts as if it were Off, at once");
  check((await n("select count(*)::int n from public.profile_story where person_id = $1", [eze.id])) === 2, "…and nothing she wrote is lost");
  await open(page, "/god/features");
  await page.getByTestId("master-toggle").click();
  await eventually("everything is resumed", async () => (await one("select paused from public.feature_master"))?.paused === false);
  await open(m.page, "/my");
  await m.page.getByTestId("my-about_me").waitFor({ timeout: 20000 });
  check((await m.page.getByTestId("my-about_me-input").inputValue()) === "I love Sunday mornings and long walks.", "resumed: My page is back, with what she wrote");

  // Putting one function back Off takes only its part away
  {
    await open(page, "/god/features");
    await page.getByTestId("features-board").waitFor({ timeout: 20000 });
    const box = page.getByTestId("feature-my_story-editor");
    if ((await box.count()) === 0) await page.getByTestId("feature-my_story-open").click();
    await box.waitFor({ timeout: 15000 });
    await page.getByTestId("feature-my_story-off").click();
    await page.getByTestId("feature-my_story-save").click();
    await eventually("My story is Off", async () => (await one("select position from public.feature_settings where feature = 'my_story' and scope = 'platform'"))?.position === "off");
    await open(m.page, "/my");
    await m.page.getByTestId("my-preferred_name").waitFor({ timeout: 20000 });
    check((await m.page.getByTestId("my-about_me").count()) === 0 && (await m.page.getByTestId("my-part-story").count()) === 0, "with My story Off, only that part is gone");
    check((await m.page.getByTestId("my-part-details").count()) === 1, "…About you is still there");
    check((await n("select count(*)::int n from public.profile_story where person_id = $1", [eze.id])) === 2, "…and what she wrote is kept");
  }

  await q.query("update public.notice_settings set mode = 'off' where group_key = 'care'");
  await m.ctx.close();
  await ctx.close();
  await browser.close();
  await q.end();
  finish("39-my-page-for-everyone");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

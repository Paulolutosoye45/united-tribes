/**
 * The admin hub, end to end. The admin reads the launch checklist, writes the church's vision and mission and the
 * testimony form address (leaders read them in the Academy), changes and resets a target, adds a goal and retires
 * another (the member form stops offering it, yet a member who chose it keeps it), edits a weekly guide (a member's
 * tribe shows the change), appoints and removes a community champion, refreshes the reporting copy, makes and revokes a
 * sending token, reads the message log, and plans a season (refused unless it starts on a Sunday) and moves it
 * through its stages. The pastor, the data lead, a coach and a member each see only what their role allows.
 */
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const link = (page: Page, name: RegExp) => page.getByRole("link", { name });

/** Set E2E_SHOTS=<folder> to keep a picture of each screen as it is reached (for looking at, not for checking). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The first day with this weekday (0 = Sunday) at least `minDays` days from now. */
function weekdayAfter(weekday: number, minDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDays);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = {
    admin: q,
    async createUser(opts: { email?: string } = {}) {
      const email = (opts.email ?? `e2e${Math.random().toString(16).slice(2, 10)}@example.org`).toLowerCase();
      const made = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
      return { id: made, email };
    },
    async grant(userId: string, role: string) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [userId, role]);
    },
  };
  const k = await kit(adapter as unknown as TestDb);
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const seasonName = (await one("select name from public.seasons where id = $1", [S]))!.name as string;
  const dataLead = await k.staff("Dara", "data_lead");

  // People who will be looked at before anything changes
  const keeper = await k.person("Keeper");
  await k.profile(keeper.id, S, { community: "professionals" });
  await q.query("update public.member_profiles set season_goal_id = (select id from public.season_goals where slug = 'step-into-a-leadership-role') where person_id = $1", [keeper.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 'e2e')", [keeper.id]);

  // A tribe with a member in it, made before any goal is retired (a retired goal cannot be chosen by a new profile)
  const sade = (await one("select id from public.people where email = 'coach.sade@example.org'"))!.id as string;
  const tribe = await k.tribe(S, { name: "Guide Journey Tribe", coach: sade });
  const folake = await k.seat(tribe.tribe, S, "Folake");

  const browser = await launch();

  // --- 1. the hub --------------------------------------------------------------------------------------------------------
  const admin = await newPage(browser, "desktop");
  await signIn(admin.page, "admin.mary@example.org", "/admin");
  await open(admin.page, "/admin");
  const hub = await text(admin.page);
  check(await heading(admin.page, "Admin").isVisible(), "the admin reaches the hub");
  check(/Before the season opens/.test(hub) && /\d of 9 ready/.test(hub), "…which opens with what is still missing before a season can open");
  check(/Write the vision and mission/.test(hub) && /Add the testimony form address/.test(hub), "…and says plainly that the church’s words and the testimony form are not written yet");
  for (const t of ["Seasons", "Weekly guides", "Communities and goals", "Community champions", "People and roles", "Targets", "Settings", "Sending and reporting", "Message log", "Tribe changes", "Multiply", "Matching model"]) {
    check((await link(admin.page, new RegExp(`^${t}`)).count()) === 1, `the hub links to ${t}`);
  }
  check(/At a glance/.test(hub), "the numbers are still on the hub, under “At a glance”");
  await noOverflow(admin.page, "the hub on desktop");
  await shot(admin.page, "admin-hub");
  const phoneHub = await newPage(browser);
  await signIn(phoneHub.page, "admin.mary@example.org", "/admin");
  await open(phoneHub.page, "/admin");
  await noOverflow(phoneHub.page, "the hub on a phone");
  await shot(phoneHub.page, "admin-hub-phone");
  await phoneHub.ctx.close();

  // --- 2. the church's words and the testimony form ----------------------------------------------------------------
  await open(admin.page, "/admin/settings");
  const form = admin.page.getByRole("form", { name: /The church’s words/ });
  await admin.page.getByLabel("Vision").fill("A church where every member belongs to a tribe and is thriving.");
  await admin.page.getByLabel("Mission").fill("To raise people who know God and make Him known.");
  await admin.page.getByLabel("Address of the testimony form").fill("http://forms.example.org/testimony");
  await form.getByRole("button", { name: "Save" }).click();
  const badAddress = form.getByRole("alert");
  await badAddress.waitFor({ timeout: 15000 });
  const badAddressText = (await badAddress.innerText()).trim();
  check(/must start with https:\/\//.test(badAddressText), `an address that does not start with https:// is refused in plain words: “${badAddressText}”`);
  await admin.page.getByLabel("Address of the testimony form").fill("https://forms.example.org/testimony");
  await form.getByRole("button", { name: "Save" }).click();
  await admin.page.getByText("Saved.", { exact: true }).waitFor({ timeout: 15000 });
  const stored = await one("select (select value from public.centre_settings where key = 'vision') as vision, (select value from public.centre_settings where key = 'testimony_form_url') as url");
  check(/thriving/.test(String(stored?.vision)) && stored?.url === "https://forms.example.org/testimony", "the words and the address are saved");
  check((await admin.page.getByText("Tribes for ages 13 to 17").count()) === 1 && (await admin.page.getByText("More than one centre").count()) === 1, "the platform switches are listed with what each does");
  await noOverflow(admin.page, "settings on desktop");
  await shot(admin.page, "admin-settings");

  const leader = await newPage(browser);
  await signIn(leader.page, "ngozi@example.org", "/lead/academy");
  await open(leader.page, "/lead/academy");
  const academy = await text(leader.page);
  check(/In the church’s own words/.test(academy) && /belongs to a tribe and is thriving/.test(academy) && /make Him known/.test(academy), "a leader reads the church’s vision and mission in the Academy");
  await shot(leader.page, "academy-words");
  await leader.ctx.close();

  await open(admin.page, "/admin");
  const afterWords = await text(admin.page);
  check(!/Write the vision and mission/.test(afterWords) && !/Add the testimony form address/.test(afterWords), "the checklist no longer asks for them");

  // --- 3. a target ------------------------------------------------------------------------------------------------------
  await open(admin.page, "/admin/targets");
  const row = admin.page.locator("li:has(#target-thriving_rate)");
  check((await admin.page.locator("#target-thriving_rate").inputValue()) === "85", "the thriving target is shown as 85, not 0.85");
  await admin.page.locator("#target-thriving_rate").fill("5");
  await row.getByRole("button", { name: "Save" }).click();
  await row.getByRole("alert").waitFor({ timeout: 5000 });
  const outOfRange = (await row.getByRole("alert").innerText()).trim();
  check(/Choose a number from \d+% to 100%/.test(outOfRange), `a target out of range is refused in the units the box uses: “${outOfRange}”`);
  await admin.page.locator("#target-thriving_rate").fill("80");
  await row.getByRole("button", { name: "Save" }).click();
  await row.getByText("Saved.", { exact: true }).waitFor({ timeout: 15000 });
  check(Number((await one("select value from public.kpi_settings where key = 'thriving_rate'"))?.value) === 0.8, "80 is stored as 0.8");
  await admin.page.locator("li:has(#target-thriving_rate)").getByText("Changed", { exact: true }).waitFor({ timeout: 15000 });
  check(true, "the target is marked as changed");
  await admin.page.locator("li:has(#target-thriving_rate)").getByRole("button", { name: "Go back to 85%" }).click();
  await admin.page.waitForFunction(() => (document.querySelector("#target-thriving_rate") as HTMLInputElement | null)?.value === "85", null, { timeout: 15000 });
  check((await one("select count(*)::int as n from public.kpi_settings where key = 'thriving_rate'"))?.n === 0, "going back removes the change");
  await noOverflow(admin.page, "targets on desktop");
  await shot(admin.page, "admin-targets");

  // --- 4. the catalogue ----------------------------------------------------------------------------------------------------
  await open(admin.page, "/admin/catalogue");
  const professionals = admin.page.getByRole("article", { name: "Professionals", exact: true });
  await professionals.getByRole("button", { name: "Add a goal to Professionals" }).click();
  await professionals.getByLabel("The goal, as a member would say it").fill("Learn to manage money well");
  await professionals.getByRole("button", { name: "Add the goal" }).click();
  await professionals.getByText("Learn to manage money well", { exact: true }).waitFor({ timeout: 15000 });
  const added = await one("select slug, active from public.season_goals where title = 'Learn to manage money well'");
  check(added?.slug === "learn-to-manage-money-well" && added.active === true, "a new goal is added to the community, with a name the form can use");

  const lead = professionals.locator("li:not(:has(li))", { hasText: /Step into a leadership role/i });
  await lead.getByRole("button", { name: "Retire" }).click();
  await professionals.getByText("1 retired goal").waitFor({ timeout: 15000 });
  check((await one("select active from public.season_goals where slug = 'step-into-a-leadership-role'"))?.active === false, "a goal is retired");
  await noOverflow(admin.page, "the catalogue on desktop");
  await shot(admin.page, "admin-catalogue");

  // A member who has not finished the form is no longer offered it; a member who chose it keeps it
  const joiner = await k.person("Dapo");
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 'e2e')", [joiner.id]);
  await q.query("insert into public.intake_drafts (person_id, step, answers) values ($1, 'goal', $2::jsonb)", [joiner.id, JSON.stringify({ community: "professionals" })]);
  const member = await newPage(browser);
  await signIn(member.page, joiner.email, "/join");
  await open(member.page, "/join");
  await heading(member.page, "What do you want to move forward this season?").waitFor({ timeout: 15000 });
  check((await choice(member.page, "goal", "step-into-a-leadership-role").count()) === 0, "the member form no longer offers the retired goal");
  check(await choice(member.page, "goal", "learn-to-manage-money-well").isVisible(), "…and offers the new one");
  await member.ctx.close();

  const kept = await newPage(browser);
  await signIn(kept.page, keeper.email, "/join");
  await open(kept.page, "/join");
  check(/leadership role/i.test(await text(kept.page)), "a member who chose the goal before it was retired still sees it as theirs");
  await kept.ctx.close();

  // --- 5. a weekly guide ------------------------------------------------------------------------------------------------
  const week = Number((await one("select public.season_week(starts_on, weeks, public.today_lagos()) as w from public.seasons where id = $1", [S]))?.w ?? 0) || 2;

  await open(admin.page, "/admin/guides");
  check(/\d+ of 12/.test(await text(admin.page)) && (await admin.page.locator("ol > li").count()) === 12, "the office sees the twelve weekly guides and how many are approved");
  await open(admin.page, `/admin/guides/${week}`);
  check(/Nobody has read and approved/.test(await text(admin.page)), "an untouched guide is a draft");
  const idea = "Faith turns a plan into a step you can take this week, together.";
  await admin.page.getByLabel("The big idea").fill(idea);
  await admin.page.getByRole("button", { name: "Save and approve" }).click();
  await admin.page.getByText(/Every tribe sees it now/).waitFor({ timeout: 15000 });
  await admin.page.getByText("Approved", { exact: true }).first().waitFor({ timeout: 15000 });
  check(true, "saving an edit approves the week");
  await noOverflow(admin.page, "a guide on desktop");
  await shot(admin.page, "admin-guide");

  const tribePage = await newPage(browser);
  await signIn(tribePage.page, folake.email, "/tribe");
  await open(tribePage.page, "/tribe");
  check((await text(tribePage.page)).includes(idea), "a member of a tribe sees the edited guide straight away");
  await tribePage.ctx.close();

  await open(admin.page, "/admin/guides/layers");
  check(/skill|prompt|idea/i.test(await text(admin.page)), "the community and goal layer has its own screen");
  await noOverflow(admin.page, "the guide layer on desktop");

  // --- 6. a community champion -----------------------------------------------------------------------------------------------
  const candidate = await k.person("Folasade");
  await open(admin.page, "/admin/champions");
  const pro = admin.page.getByRole("article", { name: "Professionals", exact: true });
  await pro.getByLabel("Appoint a champion").fill("Folasade");
  await pro.getByRole("button", { name: "Find" }).click();
  await pro.getByRole("button", { name: "Appoint" }).waitFor({ timeout: 15000 });
  check(/Folasade Test/.test(await pro.innerText()), "searching finds the person by part of their name");
  await pro.getByRole("button", { name: "Appoint" }).click();
  const appointed = pro.locator("li", { hasText: /Folasade Test[\s\S]*Since / });
  await appointed.waitFor({ timeout: 15000 });
  check((await one("select count(*)::int as n from public.person_roles where person_id = $1 and role = 'community_champion'", [candidate.id]))?.n === 1, "appointing makes them a community champion");
  admin.page.once("dialog", (d) => void d.accept());
  await appointed.getByRole("button", { name: "Remove" }).click();
  await appointed.waitFor({ state: "detached", timeout: 15000 });
  const gone = await one(
    "select (select count(*) from public.community_champions where person_id = $1)::int as appointed, (select count(*) from public.person_roles where person_id = $1 and role = 'community_champion')::int as holds",
    [candidate.id],
  );
  check(gone?.appointed === 0 && gone.holds === 0, "removing them takes the role away again");
  await noOverflow(admin.page, "champions on desktop");

  // --- 7. sending and reporting -----------------------------------------------------------------------------------------
  await open(admin.page, "/admin/system");
  check(/It has never been filled|Last refreshed/.test(await text(admin.page)), "the reporting copy says whether it has been filled");
  await admin.page.getByRole("button", { name: "Refresh now" }).click();
  await admin.page.getByText("Refreshed.", { exact: true }).waitFor({ timeout: 30000 });
  // The notice shows at once; the "Last refreshed" line follows when the page's data has been reloaded.
  const filled = await admin.page.getByText(/Last refreshed/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(filled, "refreshing fills the reporting copy");
  check((await admin.page.locator("code", { hasText: /^bi_/ }).count()) > 0 || (await admin.page.locator("li code").count()) > 0, "…and lists the views a reporting tool reads");

  await admin.page.getByLabel("Make a new token").fill("e2e second token");
  await admin.page.getByRole("button", { name: "Make the token" }).click();
  const secret = admin.page.getByTestId("new-token");
  await secret.waitFor({ timeout: 15000 });
  const shown = (await secret.innerText()).trim();
  check(shown.length >= 24, "a new sending token is shown once");
  const tokenRow = await one("select revoked_at from public.worker_tokens where label = 'e2e second token'");
  check(tokenRow !== undefined && tokenRow.revoked_at === null, "…and the database holds it");
  check(!JSON.stringify(await q.query("select * from public.worker_tokens")).includes(shown), "…but only a fingerprint of it, never the token itself");
  await admin.page.getByRole("button", { name: "I have copied it" }).click();
  check((await admin.page.getByTestId("new-token").count()) === 0, "once copied it is gone from the screen");
  admin.page.once("dialog", (d) => void d.accept());
  await admin.page.locator("li", { hasText: "e2e second token" }).getByRole("button", { name: "Revoke" }).click();
  await admin.page.getByText("1 revoked").waitFor({ timeout: 15000 });
  check((await one("select revoked_at from public.worker_tokens where label = 'e2e second token'"))?.revoked_at !== null, "revoking it stops it working");
  await noOverflow(admin.page, "sending and reporting on desktop");
  await shot(admin.page, "admin-system");

  await q.query("insert into public.messages (person_id, template, status, channel, centre_id) values ($1, 'e2e_welcome', 'sent', 'email', $2)", [folake.id, k.centreId]);
  await q.query("insert into public.messages (person_id, template, status, channel, error, centre_id) values ($1, 'e2e_notice', 'failed', 'whatsapp', 'That number is not on WhatsApp', $2)", [folake.id, k.centreId]);
  await open(admin.page, "/admin/messages");
  const table = admin.page.getByRole("table", { name: "The most recent messages" });
  const log = await table.innerText();
  check(/E2e welcome/.test(log) && /E2e notice/.test(log) && /not on WhatsApp/.test(log), "the message log shows each message and why one failed");
  await admin.page.getByLabel("Status").selectOption("failed");
  await admin.page.getByRole("button", { name: "Filter" }).click();
  await admin.page.waitForURL(/status=failed/, { timeout: 15000 });
  const filtered = await table.innerText();
  check(/E2e notice/.test(filtered) && !/E2e welcome/.test(filtered), "filtering by status shows only the failed ones");
  await noOverflow(admin.page, "the message log on desktop");
  await shot(admin.page, "admin-messages");
  // A failed message can be put back in the queue. (Other journeys leave messages in the same log, so look at this one's row.)
  const noticeRow = table.getByRole("row", { name: /E2e notice/ });
  check((await noticeRow.getByRole("button", { name: /Try again/ }).count()) === 1, "a failed message has a Try again button");
  await noticeRow.getByRole("button", { name: /Try again/ }).click();
  await noticeRow.waitFor({ state: "detached", timeout: 15000 }); // it leaves the "failed" list once queued
  const retried = await one("select status, attempts, error from public.messages where template = 'e2e_notice'");
  check(retried?.status === "queued" && retried.attempts === 0 && retried.error === null, "trying again puts it back in the queue, as new");
  check((await one("select 1 from public.event_log where action = 'message.retried'")) !== undefined, "…and the log records that someone did it");
  await admin.page.getByLabel("Status").selectOption("");
  await admin.page.getByRole("button", { name: "Filter" }).click();
  await admin.page.waitForURL((u) => !u.search.includes("status=failed"), { timeout: 15000 });
  check((await table.getByRole("row", { name: /E2e notice/ }).getByRole("button", { name: /Try again/ }).count()) === 0, "…and once queued it has none");
  check((await table.getByRole("row", { name: /E2e welcome/ }).getByRole("button", { name: /Try again/ }).count()) === 0, "…nor does one that was sent");
  const phoneLog = await newPage(browser);
  await signIn(phoneLog.page, "admin.mary@example.org", "/admin/messages");
  await open(phoneLog.page, "/admin/messages");
  await noOverflow(phoneLog.page, "the message log on a phone");
  await phoneLog.ctx.close();

  // --- 8. each role sees what it may ---------------------------------------------------------------------------------
  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, "pastor.ife@example.org", "/admin");
  await open(pastor.page, "/admin");
  check((await link(pastor.page, /^Settings/).count()) === 1 && (await link(pastor.page, /^Weekly guides/).count()) === 1, "the pastor reaches the settings and the guides");
  check((await link(pastor.page, /^People and roles/).count()) === 0 && (await link(pastor.page, /^Sending and reporting/).count()) === 0, "…but is not shown the people or the sending service");
  await open(pastor.page, "/admin/guides/1");
  check((await pastor.page.getByRole("button", { name: "Save and approve" }).count()) === 1, "the pastor can edit and approve a guide");
  await open(pastor.page, "/admin/targets");
  check((await pastor.page.getByRole("button", { name: "Save" }).count()) === 0 && (await pastor.page.locator("#target-thriving_rate").isDisabled()), "…but can only read the targets");
  await open(pastor.page, "/admin/seasons");
  check((await pastor.page.getByRole("button", { name: /Open registration|Start the season|Close the season/ }).count()) === 0 && (await pastor.page.getByRole("form", { name: "Plan a season" }).count()) === 0, "…and can only read the seasons");
  await open(pastor.page, "/admin/system");
  check(/\/home$/.test(pastor.page.url()), "the pastor is sent home from the sending service");
  await pastor.ctx.close();

  const data = await newPage(browser, "desktop");
  await signIn(data.page, dataLead.email, "/admin/system");
  await open(data.page, "/admin/system");
  check(/Only an admin makes or revokes sending tokens/.test(await text(data.page)) && (await data.page.getByRole("button", { name: "Refresh now" }).count()) === 1, "the data lead refreshes the reporting copy but cannot make tokens");
  await open(data.page, "/admin/messages");
  check(/Message log/.test(await text(data.page)), "…and reads the message log");
  await q.query("update public.messages set status = 'failed', error = 'Try later' where template = 'e2e_notice'");
  await open(data.page, "/admin/messages");
  check((await data.page.getByRole("row", { name: /E2e notice/ }).count()) >= 1 && (await data.page.getByRole("button", { name: /Try again/ }).count()) === 0, "…but cannot put a failed message back in the queue");
  await open(data.page, "/admin/guides/1");
  check(/You can read the guides/.test(await text(data.page)) && (await data.page.getByRole("button", { name: "Save and approve" }).count()) === 0, "…and reads the guides without being able to change them");
  await data.ctx.close();

  for (const [email, label] of [["coach.sade@example.org", "a coach"], ["member@example.org", "a member"]] as const) {
    const who = await newPage(browser, "desktop");
    await signIn(who.page, email, "/admin");
    await open(who.page, "/admin");
    check(/\/home$/.test(who.page.url()), `${label} who opens the admin hub is sent home`);
    await open(who.page, "/admin/seasons");
    check(/\/home$/.test(who.page.url()), `…and from the seasons`);
    await who.ctx.close();
  }

  // --- 9. seasons -------------------------------------------------------------------------------------------------------
  await open(admin.page, "/admin/seasons");
  const first = admin.page.getByRole("article", { name: seasonName, exact: true });
  check(/Planning/.test(await first.innerText()), "the season that was set up starts as Planning");
  check(/is still being prepared/.test(await text(admin.page)) && (await admin.page.getByRole("form", { name: "Plan a season" }).count()) === 0, "while one season is being prepared, another cannot be planned");
  await first.getByRole("button", { name: "Open registration" }).click();
  await first.getByText("Open", { exact: true }).waitFor({ timeout: 15000 });
  await first.getByRole("button", { name: "Start the season" }).click();
  await first.getByText("Running", { exact: true }).waitFor({ timeout: 15000 });
  check(true, "a season moves from Planning to Open to Running");

  const planForm = admin.page.getByRole("form", { name: "Plan a season" });
  await planForm.waitFor({ timeout: 15000 });
  const monday = weekdayAfter(1, 120);
  const sunday = weekdayAfter(0, 126);
  await planForm.getByLabel("Name").fill("Season 2, 2027");
  await planForm.getByLabel("Starts on").fill(monday);
  check(/A season starts on a Sunday/.test(await planForm.innerText()), "choosing a Monday is called out as soon as it is chosen");
  await planForm.getByRole("button", { name: "Plan the season" }).click();
  const refusal = planForm.getByRole("alert").filter({ hasText: /Choose a Sunday/ });
  await refusal.waitFor({ timeout: 15000 });
  check(/starts on a Sunday/i.test(await refusal.innerText()), "…and the database refuses it too, in the same words");
  await planForm.getByLabel("Starts on").fill(sunday);
  check(/It ends on Saturday/.test(await planForm.innerText()), "a Sunday shows the Saturday it ends on");
  await planForm.getByRole("button", { name: "Plan the season" }).click();
  const second = admin.page.getByRole("article", { name: "Season 2, 2027", exact: true });
  await second.waitFor({ timeout: 15000 });
  check(/Planning/.test(await second.innerText()) && /Starts in/.test(await second.innerText()), "a season planned for a Sunday appears, with how long until it starts");
  check(/is still being prepared/.test(await text(admin.page)), "…and the next season cannot be planned on top of it");
  await shot(admin.page, "admin-seasons");

  await second.getByRole("button", { name: "Edit" }).click();
  await second.getByRole("form", { name: "Edit Season 2, 2027" }).getByLabel("Weeks").fill("10");
  await second.getByRole("button", { name: "Save changes" }).click();
  await second.getByText(/10 weeks/).waitFor({ timeout: 15000 });
  check((await one("select weeks, ends_on - starts_on as span from public.seasons where name = 'Season 2, 2027'"))?.span === 69, "changing the weeks moves the end date to match");

  admin.page.once("dialog", (d) => void d.accept());
  await first.getByRole("button", { name: "Close the season" }).click();
  await first.getByText("Closed", { exact: true }).waitFor({ timeout: 15000 });
  check((await first.getByRole("button", { name: /Open registration|Start the season|Close the season/ }).count()) === 0, "a closed season has nothing more to do");
  await noOverflow(admin.page, "seasons on desktop");
  const phoneSeasons = await newPage(browser);
  await signIn(phoneSeasons.page, "admin.mary@example.org", "/admin/seasons");
  await open(phoneSeasons.page, "/admin/seasons");
  await noOverflow(phoneSeasons.page, "seasons on a phone");
  await phoneSeasons.ctx.close();

  // Put the season back as the other journeys expect it
  await q.query("delete from public.seasons where name = 'Season 2, 2027'");
  await q.query("update public.seasons set status = 'planning' where id = $1", [S]);
  await q.query("update public.season_goals set active = true where slug = 'step-into-a-leadership-role'");
  await q.query("update public.season_goals set active = false where slug = 'learn-to-manage-money-well'");

  await admin.ctx.close();
  finish("07-admin");
}
void main();

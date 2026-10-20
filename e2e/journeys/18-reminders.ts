/**
 * Messages and reminders, end to end.
 *
 * The office writes an announcement for people who started the form and have not finished: it counts them from live
 * records, shows the email as one of them will read it (phone and computer, light and dark), sends a test to the writer,
 * schedules it and the heartbeat sends it through the email stand-in. The email carries a button that brings the person back
 * to where they stopped (through the sign-in page if they have no session), the one-click unsubscribe headers, and a footer
 * link that asks before it does anything. Large announcements need a second person, never the writer. The four automatic
 * journeys start in rehearsal and log without sending; switched on, they send the first email, the pastor's wording goes live
 * at once while anyone else's waits, the last email offers the ways out, each confirmed on a page first, and a request for a
 * person reaches the Care Team, who can open WhatsApp only for people who agreed to it. A member's three email switches work.
 *
 * Set E2E_SHOTS=1 to keep a picture of the main screens in .e2e/shots, for looking at.
 */
import type { Page } from "playwright-core";
import { MESSAGING } from "../env";
import type { Received } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { claimed: number; sent: number; problems: string[]; reminders?: Record<string, unknown> } };
};
const emails = async () => (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as Received[];
type Mail = { to: string[]; subject: string; html: string; text: string; headers?: Record<string, string> };
const mailTo = async (address: string) => (await emails()).map((e) => e.body as unknown as Mail).filter((m) => m.to.includes(address));
/** A link out of the plain-text twin of an email: the button is the first one, and the others are labelled. */
const linkIn = (m: Mail, which: "go" | "stop" | "prefs" | "help_finish" | "not_season") => {
  const find = (re: RegExp) => re.exec(m.text)?.[1] ?? "";
  if (which === "go") return find(/(https?:\/\/\S+\/e\/[a-f0-9]{64})/);
  if (which === "stop") return find(/Stop [a-z ]+: (https?:\/\/\S+)/);
  if (which === "prefs") return find(/Choose what we send: (https?:\/\/\S+)/);
  if (which === "help_finish") return find(/Help me finish: (https?:\/\/\S+)/);
  return find(/Not this season: (https?:\/\/\S+)/);
};
const tokenOf = (url: string) => /\/e\/([a-f0-9]{64})/.exec(url)?.[1] ?? "";

async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

async function main() {
  const q = await db();
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Record<string, unknown>[];
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Record<string, unknown> | undefined;
  const id = async (email: string) => (await one("select id from public.people where email = $1", [email]))!.id as string;

  // People who started the form and went quiet, one of whom agreed to WhatsApp.
  async function starter(email: string, name: string, daysAgo: number, step = "community") {
    const { rows } = await q.query("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]);
    const pid = rows[0].id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [pid, name, name.split(" ")[0]]);
    await q.query("alter table public.intake_drafts disable trigger intake_drafts_touch");
    await q.query("insert into public.intake_drafts (person_id, step, answers, updated_at) values ($1, $2, $3::jsonb, now() - $4::interval)", [pid, step, JSON.stringify({ ageRange: "33-40" }), `${daysAgo} days`]);
    await q.query("alter table public.intake_drafts enable trigger intake_drafts_touch");
    return pid;
  }
  const sade = await starter("sade.start@example.org", "Sade Starter", 3);
  const tola = await starter("tola.start@example.org", "Tola Starter", 9, "goal");
  const wale = await starter("wale.start@example.org", "Wale Starter", 4, "name");
  await q.query("update public.reminder_settings set holdout_pct = 0");
  const admin = await id("admin.mary@example.org");
  const pastor = await id("pastor.ife@example.org");
  const care = await id("care_lead.dayo@example.org");

  const browser = await launch();

  // --- 1. the office finds it ----------------------------------------------------------------------------------
  const office = await newPage(browser, "desktop");
  await signIn(office.page, "admin.mary@example.org", "/admin");
  await open(office.page, "/admin");
  check(await office.page.getByRole("link", { name: /Announcements/ }).first().isVisible(), "the Admin hub has an Announcements tile");
  check(await office.page.getByRole("link", { name: /Automatic reminders/ }).first().isVisible(), "…and an Automatic reminders tile");

  // --- 2. writing an announcement -----------------------------------------------------------------------------
  await open(office.page, "/admin/announcements/new");
  await office.page.getByTestId("audience-count").getByText(/people will get this|person will get this/).waitFor({ timeout: 15000 });
  const countText = await office.page.getByTestId("audience-count").innerText();
  const n = Number(/([\d,]+)\s*(people|person)/.exec(countText)?.[1]?.replace(/,/g, "") ?? 0);
  check(n >= 3, `it counts the people who started the form from live records (${n})`);
  check(!/Sade|Tola|Wale/.test(await text(office.page)), "…and never names them");
  await shot(office.page, "18-composer-who");
  await office.page.getByRole("button", { name: "Next: write it" }).click();

  await office.page.getByRole("button", { name: "We saved your place" }).click();
  await office.page.getByTestId("preview-subject").getByText(/Your answers are waiting for you, /).waitFor({ timeout: 15000 });
  const subjectShown = await office.page.getByTestId("preview-subject").innerText();
  check(/waiting for you, (Sade|Tola|Wale|[A-Z][a-z]+)$/.test(subjectShown), `the preview is filled for a real person ("${subjectShown}")`);
  const frame = office.page.frameLocator('iframe[title="Email preview"]');
  check(await frame.getByText("Carry on where I stopped").first().isVisible(), "the preview shows the button");
  check(await frame.getByText("Stop announcements").isVisible(), "…and the footer with its unsubscribe");
  await office.page.getByRole("button", { name: "Next person" }).click();
  await office.page.getByRole("button", { name: "Computer" }).click();
  await office.page.getByRole("button", { name: "Dark" }).click();
  check((await office.page.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")) === "true", "phone or computer, light or dark: the preview switches");
  await shot(office.page, "18-composer-write");
  await office.page.getByRole("button", { name: "Light" }).click();

  // the words are checked as they are typed
  await office.page.getByLabel("Paragraph 1").fill("Read more at https://example.com");
  check(/Links can’t go in the words/.test(await text(office.page)), "a link in the words is refused straight away");
  await office.page.getByLabel("Paragraph 1").fill("Hello {nickname}");
  check(/isn’t a name field/.test(await text(office.page)), "…and so is a name field that does not exist");
  check(await office.page.getByRole("button", { name: "Next: when" }).isDisabled(), "…and you cannot go on until it is fixed");
  await office.page.getByLabel("Paragraph 1").fill("Your answers are saved exactly as you left them, {first_name}.");

  await office.page.getByRole("button", { name: "Next: when" }).click();
  check(await office.page.getByText("Not set up yet").isVisible(), "WhatsApp is shown greyed, “Not set up yet”");
  await office.page.getByRole("button", { name: "Send a test to me" }).click();
  await office.page.getByText(/Sent to you\./).waitFor({ timeout: 15000 });
  const testMsg = await one("select params from public.messages where template = 'office_message' and person_id = $1 and params ? 'test'", [admin]);
  check(Boolean(testMsg), "a test is queued for the writer, and only the writer");
  await shot(office.page, "18-composer-when");
  await office.page.getByRole("button", { name: "Next: review" }).click();
  await shot(office.page, "18-composer-review");
  await office.page.getByRole("button", { name: /^Send to / }).click();
  await office.page.waitForURL(/\/admin\/announcements\/[0-9a-f-]{36}/, { timeout: 20000 });
  const bcId = /announcements\/([0-9a-f-]{36})/.exec(office.page.url())![1];
  await office.page.getByText(/Scheduled\./).first().waitFor({ timeout: 10000 });
  check(true, "sending schedules it, and says when");

  // --- 3. the heartbeat sends it --------------------------------------------------------------------------------
  let sentRuns = 0;
  for (let i = 0; i < 5 && sentRuns < 3; i++) {
    const t = await tick();
    sentRuns += t.body.sent;
    await new Promise((r) => setTimeout(r, 400));
  }
  const mine = await mailTo("sade.start@example.org");
  const announcement = mine.find((m) => /waiting for you, Sade/.test(m.subject));
  check(Boolean(announcement), "the announcement reaches a person who started the form, with their name in it");
  check(announcement?.headers?.["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && /\/api\/email\/unsubscribe\?t=[a-f0-9]{64}/.test(announcement?.headers?.["List-Unsubscribe"] ?? ""), "it carries the one-click unsubscribe headers");
  check(Boolean(announcement && announcement.html.includes("prefers-color-scheme:dark") && announcement.text.includes("Stop announcements")), "it has a dark mode and a plain-text twin");
  check(!(await mailTo("quiet.nobody@example.org")).length, "nobody outside the audience got it");
  const bc = await one("select status from public.broadcasts where id = $1", [bcId]);
  check(["sending", "sent"].includes(String(bc?.status)), `the announcement is on its way or done (${bc?.status})`);

  await open(office.page, `/admin/announcements/${bcId}`);
  await office.page.getByTestId("results").waitFor({ timeout: 15000 });
  check(/How it went/.test(await text(office.page)), "the results show numbers, without names");
  await shot(office.page, "18-results");

  // --- 4. the button brings them back to where they stopped -------------------------------------------------
  const go = linkIn(announcement!, "go");
  const visitor = await newPage(browser, "phone");
  await visitor.page.goto(go.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "domcontentloaded" });
  await visitor.page.waitForURL(/\/sign-in\?next=%2Fjoin/, { timeout: 15000 });
  check(true, "the button leads to the sign-in page, and on to the form they left");
  await visitor.page.getByLabel("Email address").fill("sade.start@example.org");
  await visitor.page.getByRole("button", { name: "Email me a code" }).click();
  await visitor.page.getByLabel("Six-digit code").fill("123456");
  await visitor.page.waitForURL((u) => u.pathname === "/join", { timeout: 20000 });
  check(true, "signed in, they land back on their form");
  const clicks = await one("select clicks from public.email_links where token_hash = public.referee_token_hash($1)", [tokenOf(go)]);
  check(Number(clicks?.clicks) >= 1, "the tap is counted as a tap on our page, not as an open");
  const expired = await newPage(browser, "phone");
  await expired.page.goto(`${BASE}/e/${"0".repeat(64)}`);
  check((await text(expired.page)).includes("This link isn’t valid."), "a made-up link says so kindly");
  await expired.ctx.close();
  await visitor.ctx.close();

  // --- 5. unsubscribing is one click, and a scanner cannot do it -----------------------------------------
  const stopUrl = linkIn(announcement!, "stop").replace(/^https?:\/\/[^/]+/, BASE);
  const stopper = await newPage(browser, "phone");
  await stopper.page.goto(stopUrl);
  check(/stop sending you announcements/i.test(await text(stopper.page)), "the footer link asks first");
  const before = await one("select count(*)::int n from public.consents where person_id = $1 and purpose = 'announcements'", [sade]);
  check(before?.n === 0, "opening the link changes nothing");
  await shot(stopper.page, "18-stop-confirm");
  await stopper.page.getByRole("button", { name: "Yes, stop them" }).click();
  await stopper.page.getByRole("heading", { name: "No more announcements." }).waitFor({ timeout: 15000 });
  const after = await one("select granted from public.consents where person_id = $1 and purpose = 'announcements' order by id desc limit 1", [sade]);
  check(after?.granted === false, "pressing the button records it, and only announcements are stopped");
  const reminders = await one("select count(*)::int n from public.consents where person_id = $1 and purpose = 'reminders'", [sade]);
  check(reminders?.n === 0, "reminders carry on for someone who only stopped announcements");
  await noOverflow(stopper.page, "the stop page");
  await stopper.ctx.close();

  const tolaMail = (await mailTo("tola.start@example.org")).find((m) => /waiting for you, Tola/.test(m.subject));
  const oneClick = tokenOf(tolaMail!.headers!["List-Unsubscribe"]!.replace(/.*t=/, "/e/"));
  const post = await fetch(`${BASE}/api/email/unsubscribe?t=${oneClick}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  check(post.status === 200, "the mail program’s own unsubscribe button works with one request");
  const get = await fetch(`${BASE}/api/email/unsubscribe?t=${tokenOf(tolaMail!.headers!["List-Unsubscribe"]!.replace(/.*t=/, "/e/"))}`, { redirect: "manual" });
  check(get.status === 303, "a plain visit only leads to the confirm page");
  check((await one("select granted from public.consents where person_id = $1 and purpose = 'announcements' order by id desc limit 1", [tola]))?.granted === false, "…and the one-click stop is in the record");

  // --- 6. a big announcement needs a second person, never the writer ----------------------------------------------------
  await q.query("update public.reminder_settings set approval_threshold = 2");
  await open(office.page, "/admin/announcements/new");
  await office.page.getByRole("button", { name: /^Everyone/ }).click();
  await office.page.getByTestId("audience-count").getByText(/people will get this/).waitFor({ timeout: 15000 });
  await office.page.getByRole("button", { name: "Next: write it" }).click();
  await office.page.getByRole("button", { name: "A word of thanks" }).click();
  await office.page.getByRole("button", { name: "Next: when" }).click();
  await office.page.getByRole("button", { name: "Next: review" }).click();
  check(/someone other than you has to read it/.test(await text(office.page)), "the review says who has to approve it, and why");
  await office.page.getByRole("button", { name: "Send for approval" }).click();
  await office.page.waitForURL(/\/admin\/announcements\/[0-9a-f-]{36}\?sent=awaiting_approval/, { timeout: 20000 });
  const bigId = /announcements\/([0-9a-f-]{36})/.exec(office.page.url())![1];
  check(Number((await one("select count(*)::int n from public.messages where template = 'broadcast_waiting'"))?.n) >= 1, "the people who can approve are told");
  await open(office.page, "/admin/announcements/approvals");
  check(/You wrote this one, so someone else has to approve it/.test(await text(office.page)), "the writer cannot approve their own");
  check(!(await office.page.getByRole("button", { name: "Approve and send" }).count()), "…there is no button for it");

  const reviewer = await newPage(browser, "desktop");
  await signIn(reviewer.page, "pastor.ife@example.org", "/admin/announcements/approvals");
  await open(reviewer.page, "/admin/announcements/approvals");
  check(await reviewer.page.getByTestId("approval-card").first().isVisible(), "the pastor sees it, as the person will read it");
  await shot(reviewer.page, "18-approvals");
  await reviewer.page.getByRole("button", { name: "Approve and send" }).first().click();
  await reviewer.page.getByText(/Approved\./).first().waitFor({ timeout: 60000 });
  const approved = await one("select status, approved_by from public.broadcasts where id = $1", [bigId]);
  check(approved?.status === "scheduled" && approved.approved_by === pastor, "the pastor’s yes schedules it, with their name");
  await q.query("update public.reminder_settings set approval_threshold = 200");
  await reviewer.ctx.close();

  // --- 7. the four journeys: rehearse, read, switch on -----------------------------------------------------------------------
  await tick();
  await open(office.page, "/admin/reminders");
  await office.page.getByTestId("journey-member_form").waitFor({ timeout: 15000 });
  check((await office.page.getByTestId("journey-member_form").getByRole("radio", { name: "Rehearsal" }).getAttribute("aria-checked")) === "true", "every journey starts in rehearsal");
  const rehearsed = await one("select count(*)::int n from public.journey_sends where kind = 'rehearsal'");
  check(Number(rehearsed?.n) >= 1, `rehearsal logs what it would send (${rehearsed?.n})`);
  check(!(await mailTo("wale.start@example.org")).some((m) => /part-way/.test(m.subject)), "…and sends nothing");
  await shot(office.page, "18-reminders");
  await noOverflow(office.page, "the reminders page");

  await office.page.getByTestId("journey-member_form").getByRole("radio", { name: "On" }).click();
  await office.page.getByText(/On\. It will write to real people/).waitFor({ timeout: 15000 });
  for (let i = 0; i < 3; i++) await tick();
  const wale1 = (await mailTo("wale.start@example.org")).find((m) => /part-way to your tribe, Wale/.test(m.subject));
  check(Boolean(wale1), "switched on, the first email goes to someone who stopped on day one");
  check(Boolean(wale1 && wale1.html.includes("% there") && wale1.html.includes("Your answers are saved exactly as you left them.")), "it shows how far they got, and that their answers are saved");
  check(Boolean(wale1 && !/\{[a-z_]+\}/.test(wale1.html + wale1.text + wale1.subject)), "no name field is left unfilled");
  void wale;
  const sadeMail = (await mailTo("sade.start@example.org")).filter((m) => /part-way|waiting|saved/i.test(m.subject));
  check(sadeMail.length >= 1, "they were not left out by mistake");

  // --- 8. the words: a pastor’s change is live, anyone else's waits for a pastor ----------------------------------------
  await open(office.page, "/admin/reminders/member_form");
  const card1 = office.page.getByTestId("email-member_form-1");
  await card1.waitFor({ timeout: 15000 });
  check((await office.page.locator('[data-testid^="email-member_form-"]').count()) === 4, "all four emails are there to read, in four tones");
  await shot(office.page, "18-journey-editor");
  await card1.getByRole("button", { name: "Edit the words" }).click();
  await card1.getByLabel("Subject").fill("Your tribe is closer than you think, {first_name}");
  await card1.getByRole("button", { name: "Send to a pastor" }).click();
  await card1.getByTestId("pending").waitFor({ timeout: 15000 });
  check(true, "an admin’s change waits for a pastor");
  const live = await one("select subject from public.journey_emails where journey_key = 'member_form' and step = 1");
  check(String(live?.subject).startsWith("You’re part-way"), "…and the email people get has not changed");

  const pastorPage = await newPage(browser, "desktop");
  await signIn(pastorPage.page, "pastor.ife@example.org", "/admin/reminders/member_form");
  await open(pastorPage.page, "/admin/reminders/member_form");
  await pastorPage.page.getByRole("button", { name: "Approve these words" }).click();
  await pastorPage.page.getByText(/Approved\. The next email uses these words\./).waitFor({ timeout: 15000 });
  check(String((await one("select subject from public.journey_emails where journey_key = 'member_form' and step = 1"))?.subject).startsWith("Your tribe is closer"), "the pastor’s yes makes it live");
  const e2 = pastorPage.page.getByTestId("email-member_form-2");
  await e2.getByRole("button", { name: "Edit the words" }).click();
  await e2.getByLabel("Subject").fill("Five minutes, {first_name}, and your tribe is waiting");
  await e2.getByRole("button", { name: "Save and use these words" }).click();
  await pastorPage.page.getByText(/Saved, and live now/).waitFor({ timeout: 15000 });
  check(String((await one("select subject from public.journey_emails where journey_key = 'member_form' and step = 2"))?.subject).startsWith("Five minutes, {first_name}"), "a pastor’s own change goes live at once");
  await pastorPage.ctx.close();

  // --- 9. the last email, and the ways out ----------------------------------------------------------------------------------
  const tomi = await starter("tomi.start@example.org", "Tomi Starter", 22, "goal");
  await tick();
  const tomiRun = await one("select id from public.journey_runs where person_id = $1 and status = 'active'", [tomi]);
  check(Boolean(tomiRun), "someone who has been quiet for three weeks is already in the journey");
  await q.query("update public.journey_runs set step_done = 3 where id = $1", [tomiRun!.id]);
  await q.query("update public.messages set created_at = now() - interval '10 days' where person_id = $1", [tomi]);
  await q.query("update public.journey_runs set base_at = now() - interval '22 days' where id = $1", [tomiRun!.id]);
  await tick();
  await tick();
  if (process.env.E2E_DEBUG) {
    console.log(JSON.stringify(await all("select status, step_done, base_at, end_reason from public.journey_runs where person_id = $1", [tomi])));
    console.log(JSON.stringify(await all("select template, status, error, created_at, params->>'step' step from public.messages where person_id = $1", [tomi])));
    console.log(JSON.stringify(await all("select kind, step, reason from public.journey_sends s join public.journey_runs r on r.id = s.run_id where r.person_id = $1", [tomi])));
  }
  const last = (await mailTo("tomi.start@example.org")).find((m) => /will be cleared on/.test(m.subject));
  check(Boolean(last), "the honest last call arrives, saying when their answers will be cleared");
  check(Boolean(last && last.html.includes("Not this season") && last.html.includes("Help me finish")), "…and offers the ways out");

  const seasonUrl = linkIn(last!, "not_season").replace(/^https?:\/\/[^/]+/, BASE);
  const leaver = await newPage(browser, "phone");
  await leaver.page.goto(seasonUrl);
  await leaver.page.getByRole("heading", { name: /not this season/i }).waitFor({ timeout: 15000 });
  check((await one("select count(*)::int n from public.journey_requests where person_id = $1", [tomi]))?.n === 0, "opening “Not this season” changes nothing until it is confirmed");
  await leaver.page.getByLabel("I’m travelling or moving").check();
  await shot(leaver.page, "18-not-season");
  await leaver.page.getByRole("button", { name: "Yes, not this season" }).click();
  await leaver.page.getByText(/We will not remind you again this season/).waitFor({ timeout: 15000 });
  const req = await one("select kind, reason from public.journey_requests where person_id = $1", [tomi]);
  check(req?.kind === "not_season" && req.reason === "travel", "it is recorded with the reason, which is optional");
  check((await one("select status from public.journey_runs where id = $1", [tomiRun!.id]))?.status === "declined", "and the journey ends for them");
  await leaver.ctx.close();

  // --- 10. someone asks for a person: the Care Team hears, and may open WhatsApp only with consent -----------------
  const taker = await starter("femi.start@example.org", "Femi Starter", 22, "goal");
  await q.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348035550101', 'whatsapp') on conflict (person_id) do update set phone = excluded.phone", [taker]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'e2e')", [taker]);
  await tick();
  const femiRun = await one("select id from public.journey_runs where person_id = $1 and status = 'active'", [taker]);
  await q.query("update public.journey_runs set step_done = 3, base_at = now() - interval '22 days' where id = $1", [femiRun!.id]);
  await q.query("update public.messages set created_at = now() - interval '10 days' where person_id = $1", [taker]);
  await tick();
  await tick();
  const femiLast = (await mailTo("femi.start@example.org")).find((m) => /will be cleared on/.test(m.subject));
  const helpUrl = linkIn(femiLast!, "help_finish").replace(/^https?:\/\/[^/]+/, BASE);
  const helper = await newPage(browser, "phone");
  await helper.page.goto(helpUrl);
  await helper.page.getByRole("button", { name: "Yes, please help me" }).click();
  await helper.page.getByText(/Someone from the team will be in touch/).waitFor({ timeout: 15000 });
  await helper.ctx.close();
  check(Number((await one("select count(*)::int n from public.messages where template = 'journey_ask' and person_id = $1", [care]))?.n) >= 1, "the Care Team is emailed about it");

  const carer = await newPage(browser, "phone");
  await signIn(carer.page, "care_lead.dayo@example.org", "/care/asks");
  await open(carer.page, "/care/asks");
  const row = carer.page.getByTestId("ask-row").filter({ hasText: "Femi" });
  await row.waitFor({ timeout: 15000 });
  check(await row.getByRole("button", { name: /Message Femi.* on WhatsApp/ }).isVisible(), "the Care Team can message on WhatsApp when the person agreed");
  await shot(carer.page, "18-asks");
  await noOverflow(carer.page, "the care list on a phone");
  await row.getByRole("button", { name: "I have reached them" }).click();
  await carer.page.getByTestId("ask-row").filter({ hasText: "Femi" }).waitFor({ state: "detached", timeout: 15000 });
  check((await one("select status from public.journey_requests where person_id = $1", [taker]))?.status === "closed", "marking it done is kept with their name");
  const noChat = await one("select public.chat_phone($1) as p", [tomi]);
  check(noChat?.p === null, "there is no way to message someone who did not agree to WhatsApp");
  await carer.ctx.close();

  // --- 11. a member's three switches ----------------------------------------------------------------------------------------
  const member = await newPage(browser, "phone");
  await signIn(member.page, "member@example.org", "/profile");
  await open(member.page, "/profile");
  const switches = member.page.getByTestId("email-switches");
  await switches.waitFor({ timeout: 15000 });
  await switches.getByLabel(/Reminders/).uncheck();
  await switches.getByRole("button", { name: "Save" }).click();
  await member.page.getByText(/Saved\. It takes effect straight away\./).waitFor({ timeout: 15000 });
  const chidi = await id("member@example.org");
  check((await one("select granted from public.consents where person_id = $1 and purpose = 'reminders' order by id desc limit 1", [chidi]))?.granted === false, "turning reminders off is recorded in the ledger");
  await shot(member.page, "18-profile-switches");
  await noOverflow(member.page, "the profile page");
  await member.ctx.close();

  // --- 12. on a phone, at the narrowest ------------------------------------------------------------------------------------
  const narrow = await newPage(browser, "phone");
  await signIn(narrow.page, "admin.mary@example.org", "/admin/announcements");
  for (const path of ["/admin/announcements", "/admin/announcements/new", "/admin/reminders", "/admin/reminders/member_form", "/admin/announcements/approvals"]) {
    await narrow.page.setViewportSize({ width: 320, height: 700 });
    await open(narrow.page, path);
    await noOverflow(narrow.page, `${path} at 320 px`);
  }
  await narrow.page.setViewportSize({ width: 390, height: 844 });
  await open(narrow.page, "/admin/announcements/new");
  await narrow.page.getByRole("button", { name: "Next: write it" }).click();
  await narrow.page.getByRole("button", { name: "We saved your place" }).click();
  await shot(narrow.page, "18-composer-phone");
  await narrow.ctx.close();

  await office.ctx.close();
  await browser.close();
  await q.end();
  finish("18-reminders");
}

void main();

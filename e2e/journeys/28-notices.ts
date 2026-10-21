/**
 * The team's emails, end to end, for people who hold more than one role.
 *
 * An admin switches the "Pastors" group to Rehearsal, then On, from the Notifications page (every group starts Off). Things happen: two
 * applications reach "interviewed", a deletion request is recorded. Someone who is both an admin and a pastor gets ONE summary with a
 * part for each role; a pastor gets only the pastor part; nothing in either names the applicants or the person who asked to be deleted.
 * The same person's Today page shows the work of both roles in one list, with a chip for each hat that is remembered on the device, and
 * "My notices" in their profile lists the two groups they receive and nothing else. When the pastor role is taken away, the page, the
 * menu and the next summary follow the same day.
 *
 * Sending is held between 10 pm and 6 am in Lagos, so the checks on the received email only run in the day; the rest runs at any hour.
 */
import fs from "node:fs";
import type { Page } from "playwright-core";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, settle, signIn, state } from "../lib";

type Row = Record<string, unknown>;
type Sent = { channel: string; body: Record<string, unknown> };

const tid = (page: Page, id: string) => page.getByTestId(id);

/** Set E2E_SHOTS=1 to keep a picture of each screen in .e2e/shots (for looking at, not for checking). */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(".e2e/shots", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  if (!r.ok) throw new Error(`tick answered ${r.status}`);
  return (await r.json()) as { problems?: string[]; notices?: unknown };
};
const sent = async () => (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as Sent[];
const mailTo = async (to: string) =>
  (await sent())
    .filter((m) => (m.body.to as string[]).includes(to))
    .map((m) => ({ subject: String(m.body.subject), text: String(m.body.text), html: String(m.body.html ?? "") }));

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];

  async function person(email: string, name: string, roles: string[]) {
    const id = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]))!.id as string;
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [id, name, name.split(" ")[0]]);
    for (const role of roles) {
      await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [id, role]);
    }
    return id;
  }
  const application = async (personId: string, status: string) =>
    (await one("insert into public.leader_applications (person_id, consent_version, status) values ($1, 'v1', $2) returning id", [personId, status]))!.id as string;
  const interview = (applicationId: string) => q.query("update public.leader_applications set status = 'interviewed' where id = $1", [applicationId]);
  /** Nine o'clock this morning, Lagos time: inside the hours summaries are built, whatever the clock says now. */
  const nineAm = async () => ((await one("select ((public.today_lagos() + make_interval(hours => 9)) at time zone 'Africa/Lagos') as t"))!.t as Date).toISOString();
  const sweep = async () => (await one("select public.notice_sweep($1::timestamptz) as r", [await nineAm()]))!.r as { queued: number; digests: number; problems: string[] };
  const modeOf = async (group: string) => (await one("select mode from public.notice_settings where group_key = $1", [group]))!.mode as string;
  const hour = Number((await one("select public.lagos_hour() as h"))!.h);
  const daytime = hour >= 6 && hour <= 21;

  const tobiEmail = "tobi.both@example.org";
  const tobi = await person(tobiEmail, "Tobi Both", ["admin", "pastor"]);
  const ada = await person("ada.applicant@example.org", "Ada Applicant", []);
  const bisi = await person("bisi.applicant@example.org", "Bisi Applicant", []);
  const gone = await person("gone.member@example.org", "Gone Member", []);
  const adaApp = await application(ada, "submitted");
  const bisiApp = await application(bisi, "submitted");

  const browser = await launch();
  try {
    // --- 1. every group starts Off ------------------------------------------------------------------------------------------
    const admin = await newPage(browser, "desktop");
    await signIn(admin.page, "admin.mary@example.org", "/admin/notifications");
    await open(admin.page, "/admin/notifications");
    check(await heading(admin.page, "Notifications").isVisible(), "the admin reaches the Notifications page");
    check((await admin.page.locator('[data-testid^="group-"]').count()) === 11, "eleven groups are listed");
    const stillOn = await all("select group_key from public.notice_settings where mode <> 'off'");
    check(stillOn.length === 0, "every group starts Off");
    check((await admin.page.locator('[data-testid$="-off"][aria-checked="true"]').count()) === 11, "…and the page shows all eleven as Off");
    check(await tid(admin.page, "log-empty").isVisible(), "the log is empty before anything is switched on");
    await admin.page.locator('[data-testid="group-pastors"] summary').first().click();
    await admin.page.locator('[data-testid="notice-pastor_decision_ready"] summary').click();
    const preview = await tid(admin.page, "notice-pastor_decision_ready").getByTestId("notice-preview").innerText();
    check(/Subject:/.test(preview) && /decision/i.test(preview), "a notice can be read as the recipient would read it, before it is switched on");
    await noOverflow(admin.page, "Notifications on desktop");
    await shot(admin.page, "28-notifications-desktop");

    await open(admin.page, "/admin");
    check(await tid(admin.page, "notice-warnings").isVisible(), "Today warns the admin that groups are still Off");

    // --- 2. Rehearsal: written to the log, nobody is emailed ------------------------------------------------------------------
    await open(admin.page, "/admin/notifications");
    await tid(admin.page, "mode-pastors-rehearsal").click();
    await admin.page.waitForFunction(() => document.querySelector('[data-testid="mode-pastors-rehearsal"]')?.getAttribute("aria-checked") === "true", null, { timeout: 15000 });
    check((await modeOf("pastors")) === "rehearsal", "Rehearsal is saved");
    check((await one("select count(*)::int n from public.event_log where action = 'notices.mode_changed'"))!.n === 1, "…and the change is written to the audit log");
    await interview(adaApp);
    const rehearsed = await sweep();
    check(rehearsed.problems.length === 0, "the sweep reports no problems");
    check((await one("select count(*)::int n from public.messages where template = 'staff_digest' and status = 'queued'"))!.n === 0, "in Rehearsal nothing is queued to be sent");
    await open(admin.page, "/admin/notifications");
    const rehearsalRow = tid(admin.page, "log-staff_digest").first();
    await rehearsalRow.waitFor({ timeout: 10000 }).catch(() => {});
    check(await rehearsalRow.isVisible(), "the log shows the summary that would have gone");
    const peoplePastors = await tid(admin.page, "people-pastors").innerText();
    check(/Tobi/.test(peoplePastors) && /person|people receive/.test(peoplePastors), "…and the group lists who would receive it");
    await shot(admin.page, "28-notifications-rehearsal-log");
    check(/Rehearsal: not sent/.test(await rehearsalRow.innerText().catch(() => "")), "…marked as a rehearsal, not sent");
    await tick();
    check((await mailTo(tobiEmail)).length === 0, "nobody was emailed in Rehearsal");
    const logText = await tid(admin.page, "notice-log").innerText();
    check(!/@/.test(logText) && !/Ada/.test(logText), "the log shows no address and no applicant's name");

    // --- 3. On: one summary for someone who holds two roles -----------------------------------------------------------------
    await tid(admin.page, "mode-pastors-on").click();
    await admin.page.waitForFunction(() => document.querySelector('[data-testid="mode-pastors-on"]')?.getAttribute("aria-checked") === "true", null, { timeout: 15000 });
    await tid(admin.page, "mode-admin-on").click();
    await admin.page.waitForFunction(() => document.querySelector('[data-testid="mode-admin-on"]')?.getAttribute("aria-checked") === "true", null, { timeout: 15000 });
    check((await modeOf("pastors")) === "on" && (await modeOf("admin")) === "on", "Pastors and Admin are On");
    await interview(bisiApp);
    await q.query("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [gone]);
    // The test inbox keeps everything sent since the stack started (sign-in emails from other journeys included),
    // so what this journey sends is whatever arrives after this point.
    const ifeBefore = (await mailTo("pastor.ife@example.org")).length;
    const live = await sweep();
    check(live.problems.length === 0, "the sweep that builds the summaries reports no problems");

    const digests = await all(
      `select m.person_id, m.status, m.params, p.email from public.messages m join public.people p on p.id = m.person_id
        where m.template = 'staff_digest' and m.status in ('queued', 'sending', 'sent') order by p.email`,
    );
    const tobiDigests = digests.filter((d) => d.person_id === tobi);
    check(tobiDigests.length === 1, "someone who is an admin and a pastor has one summary, not two");
    const sections = ((tobiDigests[0]?.params as { sections?: { title: string; items: unknown[] }[] })?.sections ?? []).map((s) => s.title);
    check(sections.length === 2 && sections.includes("Admin") && sections.includes("Pastor"), `…with a part for each role (${sections.join(", ")})`);
    const ife = digests.find((d) => d.email === "pastor.ife@example.org");
    check(Boolean(ife) && ((ife?.params as { sections: unknown[] }).sections.length === 1), "a pastor who is only a pastor has one part");
    const perEvent = await all("select event, count(*)::int n from public.notice_items where person_id = $1 group by event having count(*) > 1", [tobi]);
    check(perEvent.length === 0, "no event is queued twice for the same person");

    const ticked = await tick();
    check(ticked.notices !== undefined, "the heartbeat runs the notice sweep");
    check(!(ticked.problems ?? []).some((p) => /notice/i.test(p)), "…and reports no notice problem");

    if (daytime) {
      let mine = await mailTo(tobiEmail);
      for (let i = 0; i < 10 && mine.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        await tick();
        mine = await mailTo(tobiEmail);
      }
      check(mine.length === 1, `one email reached the admin who is also a pastor (${mine.length})`);
      const mail = mine[0];
      if (mail) {
        check(/ADMIN/i.test(mail.text) && /PASTOR/i.test(mail.text), "it has a part for Admin and a part for Pastor");
        check(/more than one role/i.test(mail.text), "…and says so in a sentence");
        check(mail.text.includes(`${BASE}/review`) && mail.text.includes(`${BASE}/admin/privacy`), "…with a link to each page where the work is done");
        check(mail.text.includes(`${BASE}/profile`), "…and a link to My notices");
        check(!/Ada|Bisi|Applicant|Gone|Member/.test(mail.text + mail.html), "it names neither the applicants nor the person who asked to be deleted");
        check(!/@example\.org/.test(mail.text.replace(tobiEmail, "")), "it carries no one else's address");
        check(mail.subject.length > 0 && mail.subject.length < 80, `the subject is short (“${mail.subject}”)`);
      }
      const ifeMail = (await mailTo("pastor.ife@example.org")).slice(ifeBefore);
      check(ifeMail.length === 1 && /PASTOR/i.test(ifeMail[0].text) && !/PRIVACY|deletion/i.test(ifeMail[0].text), "the pastor’s email has the pastor part only");
      await tick();
      await tick();
      check((await mailTo(tobiEmail)).length === 1, "more heartbeats send nothing more");
    } else {
      console.log(`  (it is ${hour}:00 in Lagos: sending is held until 6 am, so the received-email checks are skipped)`);
      check((await one("select count(*)::int n from public.messages where template = 'staff_digest' and status = 'sent'"))!.n === 0, "at night nothing is sent");
    }

    // --- 4. Today for someone with two hats ----------------------------------------------------------------------------------------
    const both = await newPage(browser, "desktop");
    await signIn(both.page, tobiEmail, "/admin");
    await open(both.page, "/admin");
    check(await heading(both.page, "Today").isVisible(), "the admin who is also a pastor reaches Today");
    check(/as admin and pastor/i.test(await tid(both.page, "needs-attention").evaluate((el) => el.parentElement?.innerText ?? "")), "the page says whose work it shows");
    for (const h of ["all", "admin", "pastor"]) check(await tid(both.page, `hat-${h}`).isVisible(), `a chip for ${h === "all" ? "Everything" : h}`);
    check((await tid(both.page, "hat-all").getAttribute("aria-pressed")) === "true", "Everything is chosen to begin with");
    check(await tid(both.page, "attention-decisions").isVisible() && await tid(both.page, "attention-data_requests").isVisible(), "the pastor’s work and the admin’s work are in one list");
    check(/Pastor/.test(await tid(both.page, "attention-decisions").innerText()) && /Admin/.test(await tid(both.page, "attention-data_requests").innerText()), "…each tagged with its role");
    check((await both.page.locator('[data-testid="attention-decisions"]').count()) === 1, "a kind of work is listed once");

    await tid(both.page, "hat-pastor").click();
    check((await tid(both.page, "attention-decisions").count()) === 1 && (await tid(both.page, "attention-data_requests").count()) === 0, "the Pastor chip shows only the pastor’s work");
    await both.page.reload();
    await settle(both.page);
    check((await tid(both.page, "hat-pastor").getAttribute("aria-pressed")) === "true" && (await tid(both.page, "attention-data_requests").count()) === 0, "…and is remembered on this device after a reload");
    await tid(both.page, "hat-admin").click();
    check((await tid(both.page, "attention-data_requests").count()) === 1 && (await tid(both.page, "attention-decisions").count()) === 0, "the Admin chip shows only the admin’s work");
    await tid(both.page, "hat-all").click();
    check((await tid(both.page, "attention-decisions").count()) === 1 && (await tid(both.page, "attention-data_requests").count()) === 1, "Everything shows both again");

    // The menu: the pages of both roles, each once
    for (const label of ["People and roles", "Message log", "Data requests", "Answer checks", "Church referee list", "Notifications"]) {
      check((await both.page.locator('nav[aria-label="Admin menu"]').first().getByRole("link", { name: new RegExp(`^${label}`) }).count()) === 1, `the menu has ${label} once`);
    }
    const waiting = await tid(both.page, "menu-admin-privacy").first().innerText();
    check(/waiting/.test(waiting) || /\d/.test(waiting), "the count of deletion requests is beside Data requests");
    await noOverflow(both.page, "Today for two hats, desktop");
    await shot(both.page, "28-today-two-hats-desktop");
    await tid(both.page, "hat-pastor").click();
    await shot(both.page, "28-today-pastor-hat-desktop");
    await tid(both.page, "hat-all").click();

    // On a phone: the same list, the same chips, the shortcuts of both roles
    const phone = await newPage(browser);
    await signIn(phone.page, tobiEmail, "/admin");
    await open(phone.page, "/admin");
    await noOverflow(phone.page, "Today for two hats, phone");
    await shot(phone.page, "28-today-two-hats-phone");
    const chip = await tid(phone.page, "hat-pastor").boundingBox();
    check(Boolean(chip) && chip!.height >= 40, `the chips are large enough to tap (${Math.round(chip?.height ?? 0)}px)`);
    const shortcuts = await tid(phone.page, "shortcuts").innerText();
    check(/People and roles/.test(shortcuts) && /Applications to decide/.test(shortcuts), "the shortcuts mix the admin’s and the pastor’s");
    await tid(phone.page, "admin-bar").tap();
    await tid(phone.page, "admin-sheet").waitFor({ state: "visible", timeout: 5000 });
    await shot(phone.page, "28-menu-sheet-two-hats-phone");
    await phone.ctx.close();

    // --- 5. My notices -------------------------------------------------------------------------------------------------------------
    await open(both.page, "/profile");
    check(await tid(both.page, "my-notices").isVisible(), "My notices is in the profile");
    check((await tid(both.page, "pref-admin").count()) === 1 && (await tid(both.page, "pref-pastors").count()) === 1 && (await tid(both.page, "pref-directors").count()) === 0, "it lists the two groups this person receives and no others");
    await tid(both.page, "pref-admin-weekly").click();
    await both.page.waitForFunction(() => document.querySelector('[data-testid="pref-admin-weekly"]')?.getAttribute("aria-checked") === "true" || document.querySelector('[data-testid="pref-admin-weekly"]')?.getAttribute("aria-pressed") === "true" || (document.querySelector('[data-testid="pref-admin-weekly"]') as HTMLInputElement | null)?.checked === true, null, { timeout: 15000 });
    const pref = await one("select delivery from public.notice_prefs where person_id = $1 and group_key = 'admin'", [tobi]);
    check(pref?.delivery === "weekly", "a weekly summary for the admin part is saved");
    const other = await one("select count(*)::int n from public.notice_prefs where person_id = $1 and group_key = 'pastors'", [tobi]);
    check(other?.n === 0, "…and the pastor part is left as it was");
    await noOverflow(both.page, "My notices on desktop");
    await shot(both.page, "28-my-notices");

    const member = await newPage(browser);
    await signIn(member.page, "member@example.org", "/profile");
    await open(member.page, "/profile");
    check((await tid(member.page, "my-notices").count()) === 0, "someone with no staff role has no My notices");
    await member.ctx.close();

    // --- 6. The pastor role is taken away: the page, the menu and the summaries follow ----------------------------------------------------
    await q.query("delete from public.person_roles where person_id = $1 and role = 'pastor'", [tobi]);
    await open(both.page, "/admin");
    check((await tid(both.page, "hat-pastor").count()) === 0 && (await tid(both.page, "hat-all").count()) === 0, "with one role left there are no chips");
    check((await tid(both.page, "attention-decisions").count()) === 0 && (await tid(both.page, "attention-data_requests").count()) === 1, "the pastor’s work is gone from Today, the admin’s is still there (the remembered Admin hat does not hide it)");
    check((await both.page.locator('nav[aria-label="Admin menu"]').first().getByRole("link", { name: /^Answer checks/ }).count()) === 0, "…and so is the pastor’s page from the menu");
    await open(both.page, "/admin/leader-quality");
    check((await heading(both.page, "Answer checks").count()) === 0, "…and the page itself is closed to them");
    const gone2 = await one("select count(*)::int n from public.notice_items where person_id = $1 and group_key = 'pastors' and sent_at is null", [tobi]);
    check(gone2?.n === 0, "nothing for the pastor part is left waiting for them");
    await both.ctx.close();
    await admin.ctx.close();
  } finally {
    // Leave the stack as other journeys expect it: everything Off, and what this journey made removed.
    await q.query("update public.notice_settings set mode = 'off'");
    await q.query("delete from public.notice_items");
    await q.query("delete from public.notice_pending");
    await q.query("delete from public.notice_prefs");
    await q.query("delete from public.messages where params ? 'notice_group' or template = 'staff_digest'");
    await q.query("delete from public.erasure_requests where person_id = $1", [gone]);
    await q.query("delete from public.leader_applications where person_id = any($1::uuid[])", [[ada, bisi]]);
    await q.query("delete from public.person_roles where person_id = $1", [tobi]);
    await browser.close();
    await q.end();
  }
  finish("28-notices");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

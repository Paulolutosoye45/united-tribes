/**
 * Inviting someone sends them an email, end to end.
 *
 * An administrator opens Admin → People and invites an address that has no account, then invites an address that already has one. The
 * form no longer says invitations are not emailed. Each invitation queues one email; when the heartbeat runs, the first person gets an
 * invitation (sign in with this address) and the second is told the role is already theirs. Neither email names the administrator.
 * The invited person then signs in with the address and has the role. Asking again the same day does not send a second email.
 *
 * Sending is held between 10 pm and 6 am in Lagos, so the checks on the received email only run in the day; the rest runs at any hour.
 */
import type { Page } from "playwright-core";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

type Row = Record<string, unknown>;
type Sent = { channel: string; body: Record<string, unknown> };

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  if (!r.ok) throw new Error(`tick answered ${r.status}`);
};
const sent = async () => (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as Sent[];
const mailTo = async (to: string) =>
  (await sent())
    .filter((m) => (m.body.to as string[]).includes(to))
    .map((m) => ({ subject: String(m.body.subject), text: String(m.body.text), html: String(m.body.html ?? "") }));

async function invite(page: Page, email: string, role: string) {
  await open(page, "/admin/people");
  await page.getByLabel("Email address").fill(email);
  await page.locator("#invite-role").selectOption({ label: role });
  await page.getByRole("button", { name: "Send invitation" }).click();
  const status = page.getByRole("status").filter({ hasText: /invited as|already has an account/ });
  await status.waitFor({ timeout: 20000 });
  return status.innerText();
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const hour = Number((await one("select public.lagos_hour() as h"))!.h);
  const daytime = hour >= 6 && hour <= 21;

  const newcomer = "journey.newcomer@example.org";
  const existing = "journey.existing@example.org";
  const adminEmail = "invite.admin@example.org";
  const adminId = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [adminEmail]))!.id as string;
  await q.query("update public.people set full_name = 'Invite Administrator', preferred_name = 'Administrator' where id = $1", [adminId]);
  await q.query("insert into public.person_roles (person_id, role, centre_id) select id, 'admin', centre_id from public.people where id = $1 on conflict do nothing", [adminId]);
  const existingId = (await one("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [existing]))!.id as string;
  await q.query("update public.people set full_name = 'Existing Person', preferred_name = 'Existing' where id = $1", [existingId]);

  const browser = await launch();
  try {
    const { ctx, page } = await newPage(browser, "desktop");
    await signIn(page, adminEmail, "/admin/people");
    await open(page, "/admin/people");
    const body = await text(page);
    check(!/don.t email invitations/i.test(body), "the form no longer says invitations are not emailed");
    check(/We email them the invitation/.test(body), "…it says they are emailed");
    await noOverflow(page, "Admin → People on a desktop");

    // ---- An address with no account ------------------------------------------------------------------------------------------------------
    const first = await invite(page, newcomer, "Tribe leader");
    check(/is invited as tribe leader/.test(first) && /email is on its way/i.test(first), `the page confirms the invitation and the email (“${first}”)`);
    check((await n("select count(*)::int n from public.invitations where email = $1 and status = 'pending'", [newcomer])) === 1, "the invitation is saved, as before");
    check((await n("select count(*)::int n from public.messages where template = 'role_invitation' and to_email = $1 and status = 'queued'", [newcomer])) === 1, "one email is queued to that address");
    check((await n("select count(*)::int n from public.messages where template = 'role_invitation' and to_email = $1 and force_channel = 'email'", [newcomer])) === 1, "…by email only");

    // ---- An address that already has an account -------------------------------------------------------------------------------------------
    const second = await invite(page, existing, "Coach");
    check(/already has an account/.test(second) && /email is on its way/i.test(second), `the page says the role is given at once, and that they are told (“${second}”)`);
    check((await n("select count(*)::int n from public.person_roles where person_id = $1 and role = 'coach'", [existingId])) === 1, "the role is on their account at once");
    check((await n("select count(*)::int n from public.messages where template = 'role_invitation' and person_id = $1", [existingId])) === 1, "one email is queued to them");

    // ---- Asking again the same day sends nothing more ---------------------------------------------------------------------------------------
    await invite(page, newcomer, "Tribe leader");
    check((await n("select count(*)::int n from public.messages where template = 'role_invitation' and to_email = $1", [newcomer])) === 1, "inviting the same address for the same role again the same day does not send a second email");

    // ---- What arrives ---------------------------------------------------------------------------------------------------------------------
    if (daytime) {
      let a = await mailTo(newcomer);
      let b = await mailTo(existing);
      for (let i = 0; i < 10 && (a.length === 0 || b.length === 0); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        await tick();
        a = await mailTo(newcomer);
        b = await mailTo(existing);
      }
      check(a.length === 1, `the invited person is emailed once (${a.length})`);
      check(b.length === 1, `the person with an account is emailed once (${b.length})`);
      if (a[0]) {
        check(/tribe leader/.test(a[0].subject) && a[0].subject.length < 80, `the subject names the role and fits a phone (“${a[0].subject}”)`);
        check(/sign in with this email address/i.test(a[0].text) && a[0].text.includes(`${BASE}/sign-in`), "it says to sign in with that address, and links to sign-in");
        check(!/Invite Administrator|Administrator/.test(a[0].text + a[0].html), "it does not name the administrator");
        check(!/profile/i.test(a[0].html), "it has no link to a profile the person does not have yet");
      }
      if (b[0]) {
        check(/You are now a coach/.test(b[0].subject) && /already on your account/i.test(b[0].text), "the existing account is told the role is already theirs");
        check(b[0].text.includes("Hi Existing,"), "…by first name");
      }
    } else {
      check(true, "the received-email checks are skipped at night (sending is held until 6 am Lagos)");
    }

    // ---- The invited person signs in with the address -------------------------------------------------------------------------------------
    const newPerson = await newPage(browser, "phone");
    await signIn(newPerson.page, newcomer, "/home");
    const id = (await one("select id from public.people where email = $1", [newcomer]))!.id as string;
    check((await n("select count(*)::int n from public.person_roles where person_id = $1 and role = 'leader'", [id])) === 1, "signing in with the address gives the role, as before");
    check((await n("select count(*)::int n from public.messages where template = 'role_invitation' and to_email = $1", [newcomer])) === 1, "signing in sends no further invitation");
    await newPerson.ctx.close();
    await ctx.close();
  } finally {
    await q.query("delete from public.person_roles where person_id in (select id from public.people where email = any($1::text[]))", [[adminEmail, newcomer, existing]]);
    await browser.close();
    await q.end();
  }
  finish("32-invitation-email");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * WhatsApp that cannot fail quietly, stage 3 (the WhatsApp number is compulsory), end to end.
 *
 *  - Off: the join form's contact step is exactly today's (the phone number is optional and can be skipped), no member is asked for a number, and a
 *    leader is told nothing about missing numbers.
 *  - The owner (alone, on the console's Features page) opens "WhatsApp number required" for the whole church.
 *  - A new member, on the contact step of the join form, cannot go on without a number: the field says why we ask, a number made of one repeated digit is
 *    refused, a good number is shown back as we will use it, and the WhatsApp yes is not ticked for her. She finishes, and her consent to WhatsApp is not
 *    in the ledger because she did not give it.
 *  - A member who joined without a number is asked gently on Home: "Not now" puts it away for a week, "Add my number" takes her to her contact card, and
 *    once she has saved a number the prompt is gone. The contact card will not save with the number taken away.
 *  - A leader is told how many of the people in the tribe have no number yet, by first name.
 *  - Nothing scrolls sideways on a phone.
 *
 * What is only arranged here (a season, a tribe with a member who has no number, the new member's saved draft up to the contact step) is arranged in the
 * database the way the database tests do it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

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

function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

/** A finished form up to the contact step, as the form saves it on the way. */
const DRAFT = { ageRange: "33-40", preferredName: "Nkem", fullName: "Nkem Obi", gender: "female", tribeMix: "mixed", zone: "mainland", community: "professionals", faith: "growing", goal: "step-into-a-leadership-role", baseline: 3, meetingMode: "online", times: ["sunday-afternoon"] };

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: everything Off; a tribe whose member has no number; a new member waiting at the contact step --------------------------------
  await q.query("delete from public.feature_settings");
  await q.query("delete from public.feature_log");
  await q.query("update public.feature_master set paused = false, reason = null, changed_by = null, changed_at = null");
  await q.query("delete from public.number_prompts");
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "number.owner@example.org"); // the shared e2e database may already hold owner@example.org from another journey
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);

  const S = (await one("select id from public.seasons order by starts_on desc limit 1"))!.id as string;
  const mine = await k.tribe(S, { name: "Number Tribe", track: "builders" });
  await q.query("update public.people set full_name = 'Lara Leader', preferred_name = 'Lara' where id = $1", [mine.leader.id]);
  const femi = await k.seat(mine.tribe, S, "Femi");
  await q.query("delete from public.contact_preferences where person_id = $1", [femi.id]);

  const nkem = await adapter.createUser({ email: "num.nkem@example.org" });
  await q.query("update public.people set full_name = 'Nkem Obi', preferred_name = 'Nkem' where id = $1", [nkem.id]);
  await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 'e2e')", [nkem.id]);
  await q.query("insert into public.intake_drafts (person_id, step, answers, active_seconds) values ($1, 'contact', $2::jsonb, 120)", [nkem.id, JSON.stringify(DRAFT)]);

  const browser = await launch();
  const joinTo = async (page: Page) => {
    await open(page, "/join");
    await page.getByRole("heading", { name: "How should we reach you?" }).waitFor({ timeout: 20000 });
  };

  // ---- Off: today's form, nobody asked -------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    await signIn(m.page, nkem.email, "/join");
    await joinTo(m.page);
    check((await m.page.getByLabel("WhatsApp number").count()) === 0, "with the switch Off, the contact step still calls the field \"Phone number\"");
    has("…says it is optional", /Phone number[\s\S]*optional/i, await text(m.page));
    check(await m.page.getByRole("button", { name: "Skip for now" }).isEnabled(), "…and the step can be skipped without a number");
    await noOverflow(m.page, "the contact step on a phone, Off");
    await m.ctx.close();
  }
  {
    const l = await newPage(browser, "phone");
    await signIn(l.page, femi.email, "/home");
    await open(l.page, "/home");
    await l.page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("number-prompt").count()) === 0, "…and a member with no number is not asked for one on Home");
    await l.ctx.close();
  }
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, mine.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("leading-people").waitFor({ timeout: 20000 });
    check((await l.page.getByTestId("number-gaps").count()) === 0, "…and the leader is told nothing about missing numbers");
    await l.ctx.close();
  }

  // ---- God Mode: the owner opens it for the whole church ----------------------------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await owner.getByRole("link", { name: "Features", exact: true }).first().click();
  await owner.waitForURL(/\/god\/features/, { timeout: 15000 });
  await owner.getByTestId("features-board").waitFor({ timeout: 20000 });
  check(/Off/.test(await owner.getByTestId("feature-number_required").innerText()), "WhatsApp number required starts Off on the owner's Features page");
  await owner.getByTestId("feature-number_required-open").click();
  const box = owner.getByTestId("feature-number_required-editor");
  await box.waitFor({ timeout: 15000 });
  check((await owner.getByTestId("feature-number_required-whole-church").count()) === 1, "it is for the whole church only: there is no place or role to choose");
  await owner.getByTestId("feature-number_required-on").click();
  await box.getByLabel(/Why open it for the whole church/).fill("Opening the compulsory number for the whole church in the rehearsal of this journey.");
  await owner.getByTestId("feature-number_required-save").click();
  await eventually("the rule is On", async () => (await one("select public.feature_platform_state('number_required') as s"))?.s === "on");

  // ---- On: the join form insists ---------------------------------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    const page = m.page;
    await signIn(page, nkem.email, "/join");
    await joinTo(page);
    const field = page.getByLabel("WhatsApp number");
    await field.waitFor({ timeout: 10000 });
    has("the field is now \"WhatsApp number\" and says why we ask", /We need a number to reach you about your tribe/, await text(page));
    check(await page.getByRole("button", { name: "Continue" }).isDisabled(), "the step cannot go on without a number");
    check((await page.getByRole("button", { name: "Skip for now" }).count()) === 0, "…and cannot be skipped");
    await shot(page, "42-contact-required");

    await field.fill("0800 000 0000");
    has("a number made of one repeated digit is refused in words", /That number looks made up/, await text(page));
    check(await page.getByRole("button", { name: "Continue" }).isDisabled(), "…and still cannot go on");

    await field.fill("0803 123 4567");
    has("a good number is shown back as we will use it", /We.ll use \+234[\s\d]*803[\s\d]*123[\s\d]*4567/, await text(page));
    check(!(await page.locator('input[name="whatsappOk"]').isChecked()), "…and the WhatsApp yes is not ticked for her");
    check(await page.getByRole("button", { name: "Continue" }).isEnabled(), "…and she can go on");
    await noOverflow(page, "the contact step on a phone, On");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Here is what we have." }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Save my answers" }).click();
    await page.getByRole("heading", { name: /You’re in, Nkem/ }).waitFor({ timeout: 20000 });
    check(true, "she finishes the form");
    const cp = await one("select phone from public.contact_preferences where person_id = $1", [nkem.id]);
    check(cp?.phone === "+2348031234567", "her number is kept in international form");
    check((await one("select public.consent_granted($1, 'whatsapp') as g", [nkem.id]))?.g === false, "…and she has not said yes to WhatsApp: the number is compulsory, the yes is not");
    await m.ctx.close();
  }

  // ---- A member who joined without a number is asked gently ------------------------------------------------------------------------------------
  {
    const m = await newPage(browser, "phone");
    const page = m.page;
    await signIn(page, femi.email, "/home");
    await open(page, "/home");
    await page.getByTestId("number-prompt").waitFor({ timeout: 20000 });
    has("Home asks for the number, kindly", /Add your WhatsApp number[\s\S]*We need a number to reach you about your tribe/, await page.getByTestId("number-prompt").innerText());
    await noOverflow(page, "Home with the prompt on a phone");
    await shot(page, "42-home-prompt");
    await page.getByTestId("number-prompt-later").click();
    await page.getByTestId("number-prompt").waitFor({ state: "detached", timeout: 15000 });
    check((await n("select count(*)::int n from public.number_prompts where person_id = $1", [femi.id])) === 1, "\"Not now\" puts it away and the database remembers");
    await open(page, "/home");
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await page.getByTestId("number-prompt").count()) === 0, "…and it stays away when she comes back");

    // after a week it may come back; she follows it to her contact card
    await q.query("update public.number_prompts set dismissed_at = now() - interval '8 days' where person_id = $1", [femi.id]);
    await open(page, "/home");
    await page.getByTestId("number-prompt-add").waitFor({ timeout: 20000 });
    check(true, "after a week it asks again");
    await page.getByTestId("number-prompt-add").click();
    await page.waitForURL(/\/profile/, { timeout: 15000 });
    const field = page.getByLabel("How we reach you").locator('input[name="phone"]');
    await field.waitFor({ timeout: 15000 });
    await field.fill("0805 222 3344");
    await page.getByLabel("How we reach you").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved. We’ll use these from now on.").waitFor({ timeout: 15000 });
    check((await one("select phone from public.contact_preferences where person_id = $1", [femi.id]))?.phone === "+2348052223344", "she adds her number from her contact card");
    await open(page, "/home");
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 20000 });
    check((await page.getByTestId("number-prompt").count()) === 0, "…and the prompt is gone");

    // the card will not save with the number taken away
    await open(page, "/profile");
    await field.waitFor({ timeout: 15000 });
    await field.fill("");
    await page.getByLabel("How we reach you").getByRole("button", { name: "Save", exact: true }).click();
    const refusal = page.getByLabel("How we reach you").locator("p[role=alert]");
    await refusal.waitFor({ timeout: 15000 });
    has("taking the number away is refused, in words", /Add your WhatsApp number/, await refusal.innerText());
    check((await one("select phone from public.contact_preferences where person_id = $1", [femi.id]))?.phone === "+2348052223344", "…and her number is unchanged");
    await m.ctx.close();
  }

  // ---- The leader is told how many have none ---------------------------------------------------------------------------------------------------
  await q.query("delete from public.contact_preferences where person_id = $1", [femi.id]);
  await q.query("delete from public.number_prompts where person_id = $1", [femi.id]);
  {
    const l = await newPage(browser, "desktop");
    await signIn(l.page, mine.leader.email, "/lead");
    await open(l.page, "/lead");
    await l.page.getByTestId("number-gaps").waitFor({ timeout: 20000 });
    has("the leader is told who in the tribe has no number yet, by first name", /1 person in your tribe has not added a phone number yet: Femi/, await l.page.getByTestId("number-gaps").innerText());
    await shot(l.page, "42-leader-gaps");
    await l.ctx.close();
  }

  await octx.close();
  await browser.close();
  await q.end();
  finish("42-number-required");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Signing in with a code on WhatsApp or email, end to end on a phone, with a stand-in for the ordinary-number sender.
 *
 * The sign-in panel: Google on top, "or get a code", an Email | WhatsApp switch, one field, one button. It starts on Email,
 * remembers the choice on the device, works at 320 px with tap targets of 44 px or more, and the arrow keys move between
 * the tabs. In reply-first mode (the way to start) a person is asked to message the number first: the code is held, the
 * number's reply carries it, and a stranger's message gets nothing. A number with no account is told exactly what a
 * number with one is. Send-at-once mode sends one short message with no link. STOP blocks the number. The per-connection
 * limit says what to do next. The director's kill switch turns WhatsApp grey for everyone, with Email still working.
 * Five failed sends trip the breaker by themselves: WhatsApp pauses, the director is emailed, and only a person can restart
 * it, with a note that is kept with their name. The data lead may lower the limits but not raise the channel's ceiling.
 * Adding a number from "Privacy and my data" works the same reply-first way.
 *
 * Set E2E_SHOTS=1 to keep a picture of the main screens in .e2e/shots, for looking at.
 */
import type { Page } from "playwright-core";
import { signHeaders } from "../../sender/src/auth";
import { MESSAGING, SIGNIN } from "../env";
import { TURNSTILE } from "../stubs";
import { BASE, check, db, finish, launch, newPage, noOverflow, signIn, state, text } from "../lib";

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

/** The office page's status pill, once it has caught up with what was just saved. */
async function statusIs(page: Page, label: string) {
  await page.getByTestId("signin-status-now").filter({ hasText: label }).waitFor({ timeout: 15000 });
  return true;
}

/** What the ordinary-number stand-in was asked to send. */
async function sentByNumber(): Promise<{ body: { to: string; text: string } }[]> {
  return (await (await fetch(`${state().stubUrl}/__sent?channel=linked`)).json()) as { body: { to: string; text: string } }[];
}
const stub = (path: string, body: object) => fetch(`${state().stubUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The sender service, passing on a message someone sent to the number. */
async function inbound(from: string, message: string, secret: string = SIGNIN.linkedSecret) {
  const body = JSON.stringify({ from, text: message, id: `m${Date.now()}${Math.random().toString(36).slice(2, 6)}` });
  const r = await fetch(`${BASE}/api/auth/whatsapp-inbound`, { method: "POST", headers: signHeaders(secret, body), body });
  return { status: r.status, json: (await r.json().catch(() => null)) as { reply?: string | null } | null };
}

/** Asks for a code the way the screen does, without the screen (a different person on the same connection, say). */
async function askDirect(phone: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${BASE}/api/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ phone, captchaToken: `${TURNSTILE.tokenPrefix}direct-${Math.random().toString(36).slice(2, 8)}` }),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null };
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Record<string, unknown> | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Record<string, unknown>[];
  const settings = async () => (await one("select * from public.signin_settings"))!;
  /** A clean slate for the limits and the stand-in, so one section does not use up another's room. */
  async function fresh() {
    await q.query("delete from public.signin_attempts");
    await q.query("delete from public.signin_blocks");
    await stub("/__reset", {});
  }

  // People with a number on their account (the only people WhatsApp codes go to).
  const NUMBERS = ["2348031234501", "2348031234502", "2348031234503", "2348031234504", "2348031234505"];
  for (const [i, phone] of NUMBERS.entries()) {
    await q.query("insert into auth.users (email, phone, email_confirmed_at) values ($1, $2, now()) on conflict do nothing", [`wa${i + 1}@example.org`, phone]);
  }
  await q.query("update public.signin_settings set mode = 'reply_first', whatsapp_on = true, cap_network_hour = 12");
  await fresh();

  const browser = await launch();

  // --- 1. The panel -----------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage(browser, "phone");
    await page.goto(`${BASE}/sign-in`);
    const emailTab = page.getByRole("tab", { name: "Email" });
    const waTab = page.getByRole("tab", { name: "WhatsApp" });
    await emailTab.waitFor({ timeout: 15000 });
    check((await emailTab.getAttribute("aria-selected")) === "true" && (await waTab.getAttribute("aria-selected")) === "false", "a first visit starts on Email");
    check(await page.getByRole("button", { name: "Continue with Google" }).isVisible(), "Google is on top");
    check((await text(page)).includes("or get a code"), "…then “or get a code”");
    check(!(await page.getByRole("button", { name: "Continue with WhatsApp" }).count()), "the separate “Continue with WhatsApp” button is gone");
    check(await page.getByLabel("Email address").isVisible(), "Email: one field…");
    check(await page.getByRole("button", { name: "Email me a code" }).isVisible(), "…and one button, as before");

    for (const [label, loc] of [
      ["Email tab", emailTab],
      ["WhatsApp tab", waTab],
      ["Google button", page.getByRole("button", { name: "Continue with Google" })],
      ["email field", page.getByLabel("Email address")],
      ["email button", page.getByRole("button", { name: "Email me a code" })],
    ] as const) {
      const box = await loc.boundingBox();
      check(box && box.height >= 44, `${label} is at least 44 px tall (${Math.round(box?.height ?? 0)})`);
    }

    await waTab.click();
    check(await page.getByLabel("WhatsApp number").isVisible(), "WhatsApp: a number field…");
    check((await page.locator("main").innerText()).includes("+234"), "…with +234 in front of it");
    check(await page.getByRole("button", { name: "Send code on WhatsApp" }).isVisible(), "…and “Send code on WhatsApp”");
    const body = await text(page);
    check(body.includes("WhatsApp sign-in works once your number is added to your account. Add it in Privacy and my data after signing in with Google or email."), "everyone is told that WhatsApp sign-in needs the number added first");
    check(/save this number as\s+United Tribes/i.test(body) && body.includes("+234 800 000 0001"), "the number to save as United Tribes is shown");
    check(body.includes("Your code comes as a reply"), "reply-first says that the code comes as a reply");
    await shot(page, "17-signin-whatsapp");

    await page.getByLabel("WhatsApp number").fill("803 123 4501");
    check((await text(page)).includes("+234 803 123 4501"), "a number typed without its first zero is read as the Nigerian number it is");

    // The keyboard: arrow keys move between the tabs.
    await waTab.focus();
    await page.keyboard.press("ArrowLeft");
    check((await emailTab.getAttribute("aria-selected")) === "true", "the left arrow key moves from WhatsApp to Email");
    await page.keyboard.press("ArrowRight");
    check((await waTab.getAttribute("aria-selected")) === "true", "the right arrow key moves back");

    // Remembered on this device.
    await page.reload();
    await waTab.waitFor();
    check((await waTab.getAttribute("aria-selected")) === "true", "the choice (WhatsApp) is remembered on this device");
    await emailTab.click();
    await page.reload();
    await emailTab.waitFor();
    check((await emailTab.getAttribute("aria-selected")) === "true", "…and so is a change back to Email");

    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload();
    await noOverflow(page, "sign-in at 320 px (email)");
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await noOverflow(page, "sign-in at 320 px (WhatsApp)");
    await ctx.close();

    const other = await newPage(browser, "phone");
    await other.page.goto(`${BASE}/sign-in`);
    await other.page.getByRole("tab", { name: "Email" }).waitFor();
    check((await other.page.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")) === "true", "another device starts on Email: nothing is shared between devices");
    await other.ctx.close();
  }

  // --- 2. Reply first: the code is held until the person messages the number --------------------------------------
  {
    await fresh();
    const { ctx, page } = await newPage(browser, "phone");
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill("0803 123 4501");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await heading(page, "Message us on WhatsApp").waitFor({ timeout: 15000 });
    const link = page.getByRole("link", { name: "Open WhatsApp and send the message" });
    const href = (await link.getAttribute("href")) ?? "";
    check(href.startsWith(`https://wa.me/${SIGNIN.number}?text=`), "“Open WhatsApp and send the message” opens a chat with the number, message ready");
    check(await page.getByLabel("Six-digit code").count() === 1, "the six boxes are there to type the code into");
    check(/Send a new code in (5\d|60)s/.test(await text(page)), "a new code can be asked for after a minute, with a countdown");
    check(await page.getByRole("button", { name: /Send a new code in/ }).isDisabled(), "…and the button waits until then");
    check((await text(page)).includes("The code works for 10 minutes."), "the code lasts ten minutes, and the screen says so");
    check((await sentByNumber()).length === 0, "nothing has been sent yet: the code is held");
    const held = await one("select count(*)::int as n from public.signin_pending");
    check(held?.n === 1, "…and held in the database, sealed");
    check(!JSON.stringify(await all("select * from public.signin_pending")).includes("123456"), "the held code is not stored in the clear");
    await shot(page, "17-signin-reply-first");
    await noOverflow(page, "message-us screen");

    // Someone who is not the sender service cannot collect it.
    const forged = await inbound("2348031234501", "Send my code", "not-the-real-secret-not-the-real-secret");
    check(forged.status === 401, "a request that is not signed by the sender service is refused");
    check((await one("select count(*)::int as n from public.signin_pending"))?.n === 1, "…and the code is still waiting");
    // A stranger messaging the number gets nothing.
    const stranger = await inbound("2348099999999", "Send my code");
    check(stranger.status === 200 && stranger.json?.reply === null, "someone who has not asked for a code gets no reply");
    // The person messages the number: the reply carries the code.
    const reply = await inbound("2348031234501", "Send my code");
    check(reply.status === 200 && typeof reply.json?.reply === "string" && reply.json.reply.includes("123456"), "the person messages the number and the reply carries the code");
    check(/United Tribes sign-in code/.test(reply.json?.reply ?? "") && !/https?:|www\./i.test(reply.json?.reply ?? ""), "…one short message, with the name, the code and no link");
    check((await one("select count(*)::int as n from public.signin_pending"))?.n === 0, "the held code is gone once collected");
    const again = await inbound("2348031234501", "Send my code");
    check(again.json?.reply === null, "messaging again does not hand the same code out twice");

    await page.getByLabel("Six-digit code").fill("123456");
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
    check(true, "the person types the code and is signed in");
    await ctx.close();
  }

  // --- 3. A number with no account is told exactly what a number with one is --------------------------------------
  {
    await fresh();
    const { ctx, page } = await newPage(browser, "phone");
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill("0809 999 9999");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await heading(page, "Message us on WhatsApp").waitFor({ timeout: 15000 });
    check(true, "a number with no account reaches the same screen as one with an account");
    check((await sentByNumber()).length === 0 && (await one("select count(*)::int as n from public.signin_pending"))?.n === 0, "…and nothing is sent or held for it");
    check((await inbound("2348099999999", "Send my code")).json?.reply === null, "…and messaging the number from it gets nothing back");
    await ctx.close();
  }

  // --- 4. Send at once: one short message, and the same answer every time -----------------------------------------
  {
    await fresh();
    const a = await newPage(browser, "phone");
    await signIn(a.page, "admin.mary@example.org", "/admin/signin");
    await heading(a.page, "WhatsApp sign-in").waitFor({ timeout: 15000 });
    check((await a.page.getByTestId("signin-status-now").innerText()).trim() === "On", "the office page says WhatsApp is On");
    await a.page.locator('label.choice:has(input[value="normal"])').click();
    await a.page.getByRole("button", { name: "Change how the code is sent" }).click();
    await a.page.getByRole("button", { name: "Yes, change it" }).click();
    await a.page.getByText("Saved. It applies to the next code.").waitFor({ timeout: 15000 });
    check((await settings()).mode === "normal", "the director changes the way of sending to “send at once”, and it is saved");
    await a.ctx.close();

    const { ctx, page } = await newPage(browser, "phone");
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    check(!(await text(page)).includes("Your code comes as a reply"), "the screen no longer says the code comes as a reply");
    await page.getByLabel("WhatsApp number").fill("08031234502");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await heading(page, "Check WhatsApp").waitFor({ timeout: 15000 });
    const sent = await sentByNumber();
    check(sent.length === 1 && sent[0].body.to === "2348031234502", "the code goes to the number on the account");
    check(sent[0].body.text.includes("123456") && /ignore this if you did not ask/i.test(sent[0].body.text) && !/https?:|www\./i.test(sent[0].body.text), "…one short message: the code, an ignore line, no link");
    check((await page.getByRole("link", { name: "Open WhatsApp" }).getAttribute("href")) === `https://wa.me/${SIGNIN.number}`, "“Open WhatsApp” opens the chat with the number");
    await noOverflow(page, "check WhatsApp screen");
    await shot(page, "17-signin-code-sent");

    // The same person asks again straight away (not through the screen, which would make them wait).
    const again = await askDirect("08031234502");
    check(again.status === 200 && again.json?.ok === true, "asking again at once gets the same answer…");
    check((await sentByNumber()).length === 1, "…but no second message goes out, because the wait between codes has not passed");
    check((await one("select count(*)::int as n from public.signin_attempts where outcome = 'declined_wait'"))?.n === 1, "…and the database recorded why");

    await page.getByLabel("Six-digit code").fill("123456");
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
    check(true, "the code works and signs the person in");
    await ctx.close();
  }

  // --- 5. STOP ----------------------------------------------------------------------------------------------------
  {
    await fresh();
    const stop = await inbound("2348031234503", "STOP");
    check(stop.status === 200 && /30 days/.test(stop.json?.reply ?? "") && /Google or email/.test(stop.json?.reply ?? ""), "STOP gets one polite line back, and says email still works");
    check((await one("select count(*)::int as n from public.signin_blocks where blocked_until > now() + interval '29 days'"))?.n === 1, "the number is blocked for 30 days");
    const { ctx, page } = await newPage(browser, "phone");
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill("08031234503");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await heading(page, "Check WhatsApp").waitFor({ timeout: 15000 });
    check(true, "the blocked number sees the ordinary screen, so nothing shows that it is blocked");
    check((await sentByNumber()).length === 0, "…and nothing is sent");
    check(((await one("select count(*)::int as n from public.signin_attempts where outcome = 'declined_blocked'"))?.n as number) >= 1, "…and the database recorded why");
    check((await settings()).breaker_state === "ok", "one STOP does not pause WhatsApp");
    await ctx.close();
    check(((await one("select count(*)::int as n from public.messages where template = 'signin_stop_alert'"))?.n as number) >= 1, "the data lead (or the director) is emailed that someone said STOP");
  }

  // --- 6. A busy connection ---------------------------------------------------------------------------------------
  {
    await fresh();
    await q.query("update public.signin_settings set cap_network_hour = 2");
    const first = await askDirect("08031234504");
    const second = await askDirect("08031234505");
    const third = await askDirect("08031234501");
    check(first.status === 200 && second.status === 200 && third.status === 429, "from one connection, the third ask in an hour is turned away");
    check(/Too many codes have been asked for from this connection/.test(third.json?.message ?? ""), "…in words that say what to do");
    const { ctx, page } = await newPage(browser, "phone", { expectStatuses: [429] });
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill("08031234501");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await page.getByText(/Too many codes have been asked for from this connection/).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Use email instead" }).click();
    check((await page.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")) === "true", "the screen says so, and “Use email instead” is one tap away");
    await ctx.close();
    await q.query("update public.signin_settings set cap_network_hour = 12");
  }

  // --- 7. The kill switch -----------------------------------------------------------------------------------------
  {
    await fresh();
    const a = await newPage(browser, "phone");
    await signIn(a.page, "admin.mary@example.org", "/admin/signin");
    await heading(a.page, "WhatsApp sign-in").waitFor({ timeout: 15000 });
    await a.page.getByRole("button", { name: "Turn WhatsApp codes off" }).click();
    await a.page.getByText("Switched off. No more WhatsApp codes will be sent.").waitFor({ timeout: 15000 });
    check(await statusIs(a.page, "Switched off"), "the kill switch switches WhatsApp off");
    check((await settings()).whatsapp_on === false, "…and the database says so");

    const { ctx, page } = await newPage(browser, "phone");
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("ut.signin.tab", "whatsapp");
      } catch {
        // storage unavailable
      }
    });
    await page.goto(`${BASE}/sign-in`);
    const waTab = page.getByRole("tab", { name: "WhatsApp" });
    await waTab.waitFor();
    check((await waTab.getAttribute("aria-disabled")) === "true", "WhatsApp is greyed out");
    check((await page.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")) === "true", "…Email is selected, even for someone who last used WhatsApp");
    check((await text(page)).includes("WhatsApp codes are paused today. Use email."), "…and one line says WhatsApp codes are paused");
    await waTab.click({ force: true });
    check((await page.getByRole("tab", { name: "Email" }).getAttribute("aria-selected")) === "true", "tapping the greyed tab changes nothing");
    await shot(page, "17-signin-paused");
    const direct = await askDirect("08031234501");
    check(direct.status === 503 && direct.json?.error === "paused", "a request made without the screen is turned away too");
    await ctx.close();

    const e = await newPage(browser, "phone");
    await signIn(e.page, "member@example.org", "/profile");
    await heading(e.page, "Privacy and my data").waitFor({ timeout: 15000 });
    const addButton = e.page.locator('section[aria-labelledby="signin-heading"]').getByRole("button", { name: "Add my WhatsApp number" });
    await addButton.waitFor();
    check(await addButton.isDisabled(), "email still signs people in while WhatsApp is off; their profile page greys out “Add my WhatsApp number”…");
    check((await text(e.page)).includes("WhatsApp codes are paused today. Use email."), "…and says why");
    await e.ctx.close();

    await a.page.getByRole("button", { name: "Turn WhatsApp codes on" }).click();
    await a.page.getByText("Switched on.").waitFor({ timeout: 15000 });
    check((await settings()).whatsapp_on === true, "turning it back on works");
    await a.ctx.close();
  }

  // --- 8. The breaker ---------------------------------------------------------------------------------------------
  {
    await fresh();
    await stub("/__linked/mode", { fail: true });
    const { ctx, page } = await newPage(browser, "phone", { expectStatuses: [400] });
    await page.goto(`${BASE}/sign-in`);
    await page.getByRole("tab", { name: "WhatsApp" }).click();
    await page.getByLabel("WhatsApp number").fill("08031234501");
    await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
    await page.getByText(/couldn.t send the WhatsApp message/i).waitFor({ timeout: 15000 });
    check(await page.getByRole("button", { name: "Use email instead" }).isVisible(), "when a code cannot be sent, the screen says so and offers email");
    for (const number of ["08031234502", "08031234503", "08031234504", "08031234505"]) await askDirect(number);
    await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
    const s = await settings();
    check(s.breaker_state === "tripped" && s.breaker_reason === "failed_sends", "five failed sends trip the breaker by themselves");
    const status = (await (await fetch(`${BASE}/api/auth/channel-status`)).json()) as { status: string };
    check(status.status === "paused", "the website now says WhatsApp is paused");
    check(((await one("select count(*)::int as n from public.messages where template = 'signin_paused'"))?.n as number) >= 1, "the director is emailed");
    await page.reload();
    await page.getByRole("tab", { name: "WhatsApp" }).waitFor();
    check((await page.getByRole("tab", { name: "WhatsApp" }).getAttribute("aria-disabled")) === "true" && (await text(page)).includes("WhatsApp codes are paused today. Use email."), "everyone sees the paused state at once");
    await ctx.close();

    // Nothing restarts it: not time, not the heartbeat, not the sender coming back.
    await stub("/__linked/mode", { fail: false });
    await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
    check((await settings()).breaker_state === "tripped", "the sender coming back does not restart it: only a person can");

    const a = await newPage(browser, "phone");
    await signIn(a.page, "admin.mary@example.org", "/admin/signin");
    await heading(a.page, "WhatsApp sign-in").waitFor({ timeout: 15000 });
    check(await statusIs(a.page, "Paused"), "the office page says Paused…");
    const tripped = await a.page.getByTestId("signin-tripped").innerText();
    check(/too many WhatsApp codes failed to send/.test(tripped) && /It will not start again on its own/.test(tripped), "…says why, and that it will not start again by itself");
    await shot(a.page, "17-signin-admin-paused");
    await a.page.getByRole("button", { name: "I have looked into it: restart" }).click();
    await a.page.getByLabel(/A note for the log/).fill("Sender back up");
    await a.page.getByRole("button", { name: "Restart WhatsApp codes" }).click();
    await a.page.getByText(/WhatsApp restarted/).first().waitFor({ timeout: 15000 });
    check((await settings()).breaker_state === "ok", "a person restarts it");
    check(await statusIs(a.page, "On"), "the page says On again");
    const log = await a.page.getByTestId("signin-log").innerText();
    check(/WhatsApp paused itself/.test(log) && /WhatsApp restarted by Mary/.test(log) && /Sender back up/.test(log), "the log lists the pause, and the restart with Mary’s name and her note");
    const chart = await a.page.getByTestId("signin-chart").innerText();
    check(/asked for/.test(chart) && (await a.page.getByTestId("signin-chart").locator("tbody tr").count()) === 30, "the 30-day chart is there, with its numbers by day");
    await noOverflow(a.page, "admin sign-in page (phone)");
    await a.ctx.close();
  }

  // --- 9. Who may use the office page -----------------------------------------------------------------------------
  {
    await fresh();
    const d = await newPage(browser, "phone");
    await signIn(d.page, "data_lead.chioma@example.org", "/admin");
    await d.page.getByRole("link", { name: /WhatsApp sign-in/ }).first().waitFor({ timeout: 15000 });
    check(true, "the data lead sees WhatsApp sign-in in the Admin hub");
    await d.page.goto(`${BASE}/admin/signin`);
    await heading(d.page, "WhatsApp sign-in").waitFor({ timeout: 15000 });
    const field = d.page.getByLabel("All WhatsApp codes in an hour");
    await field.fill("30");
    await d.page.getByRole("button", { name: "Save changes" }).click();
    await d.page.getByRole("alert").filter({ hasText: /only the director can raise this/i }).waitFor({ timeout: 10000 });
    check(((await settings()).cap_channel_hour as number) === 20, "the data lead cannot raise the channel’s ceiling");
    await field.fill("15");
    await d.page.getByRole("button", { name: "Save changes" }).click();
    await d.page.getByText(/Saved\. The new limits apply/).waitFor({ timeout: 15000 });
    check(((await settings()).cap_channel_hour as number) === 15, "…but can lower it");
    await d.ctx.close();

    const b = await newPage(browser, "phone");
    await signIn(b.page, "director.bola@example.org", "/admin/signin");
    await heading(b.page, "WhatsApp sign-in").waitFor({ timeout: 15000 });
    await b.page.getByLabel("All WhatsApp codes in an hour").fill("40");
    await b.page.getByRole("button", { name: "Save changes" }).click();
    await b.page.getByText(/Saved\. The new limits apply/).waitFor({ timeout: 15000 });
    check(((await settings()).cap_channel_hour as number) === 40, "the director can raise it");
    await q.query("update public.signin_settings set cap_channel_hour = 20");
    await b.ctx.close();

    const p = await newPage(browser, "phone");
    await signIn(p.page, "pastor.ife@example.org", "/admin/signin");
    await p.page.waitForLoadState("networkidle").catch(() => {});
    check(!(await text(p.page)).includes("Turn WhatsApp codes off"), "a pastor cannot open it");
    await p.ctx.close();
  }

  // --- 10. Adding a number from “Privacy and my data” works the same reply-first way ------------------------------
  {
    await fresh();
    await q.query("update public.signin_settings set mode = 'reply_first'");
    const { ctx, page } = await newPage(browser, "phone");
    await signIn(page, "member@example.org", "/profile");
    await heading(page, "Privacy and my data").waitFor({ timeout: 15000 });
    const card = page.locator('section[aria-labelledby="signin-heading"]');
    await card.getByRole("button", { name: "Add my WhatsApp number" }).click();
    await card.getByLabel("WhatsApp number").fill("0803 123 4510");
    check((await text(page)).includes("you will send one short message from this number to ours"), "the card says what will happen before the number is sent");
    await card.getByRole("button", { name: "Send me a code" }).click();
    await card.getByRole("link", { name: "Open WhatsApp and send the message" }).waitFor({ timeout: 15000 });
    check((await text(page)).includes("Now message us from"), "the card asks them to message the number from the number they are adding");
    check((await sentByNumber()).length === 0 && (await one("select count(*)::int as n from public.signin_pending"))?.n === 1, "the code is held, not sent");
    const reply = await inbound("2348031234510", "Send my code");
    check(typeof reply.json?.reply === "string" && reply.json.reply.includes("123456"), "the reply carries the code");
    await card.getByLabel("Six-digit code").fill("123456");
    // The sixth digit sends it, as on the sign-in screen.
    await page.getByText("Done. Your WhatsApp number is added.").waitFor({ timeout: 15000 });
    const user = await one("select phone from auth.users where email = 'member@example.org'");
    check(user?.phone === "2348031234510", "the number is on the account");
    await ctx.close();
  }

  await browser.close();
  await q.end();
  finish("signin");
}
void main();

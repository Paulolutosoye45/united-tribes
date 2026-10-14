/**
 * The platform underneath everything, end to end: the app can be put on a phone's home screen and shows a plain page with
 * no signal; every page carries a fresh, strict security policy that the browser really enforces; the bot check stands in
 * front of sign-in and of the two pages anyone with a link can submit, and fails closed; and the daily clean-up of old
 * personal data runs from the heartbeat, once a day, and says so.
 *
 * (The guardian page's bot check is exercised inside journey 06, where the parent's link is made.)
 */
import crypto from "node:crypto";
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { API_PORT, MESSAGING } from "../env";
import { BASE, botCheckRefuses, check, db, finish, launch, newPage, open, signIn, state } from "../lib";
import { TURNSTILE } from "../stubs";

type Row = Record<string, unknown>;

const tick = async () => {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  return { status: r.status, body: (await r.json()) as { calendar: Row; problems: string[] } };
};
const checks = async () => (await (await fetch(`${state().stubUrl}/__turnstile`)).json()) as { token: string; ok: boolean; reason?: string }[];
const captchaSeen = async () => (await (await fetch(`http://127.0.0.1:${API_PORT}/__captcha`)).json()) as { path: string; token: string | null }[];

/** The width and height written inside a PNG file. */
const pngSize = (bytes: Buffer) => ({ ok: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) });

/** "script-src 'self' 'nonce-x'" -> { "script-src": ["'self'", "'nonce-x'"] } */
const parsePolicy = (policy: string) =>
  Object.fromEntries(
    policy
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values] as const;
      }),
  ) as Record<string, string[]>;

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
  const browser = await launch();

  // --- 1. it can be put on a phone, and it says so plainly when there is no signal --------------------------------------
  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`, { redirect: "manual" });
  check(manifestRes.status === 200, "the app’s manifest is reachable without signing in");
  const manifest = (await manifestRes.json()) as { name: string; short_name: string; start_url: string; scope: string; display: string; icons: { src: string; sizes: string; type: string; purpose: string }[] };
  check(manifest.name === "United Tribes" && manifest.display === "standalone" && manifest.start_url === "/home" && manifest.scope === "/", "…it opens as an app, at the home screen");
  check(manifest.icons.length >= 4 && manifest.icons.some((i) => i.purpose === "maskable") && manifest.icons.some((i) => i.purpose === "any"), "…with ordinary and maskable icons");
  let iconsRight = true;
  for (const icon of manifest.icons) {
    const res = await fetch(`${BASE}${icon.src}`, { redirect: "manual" });
    const png = pngSize(Buffer.from(await res.arrayBuffer()));
    const [w, h] = icon.sizes.split("x").map(Number);
    if (res.status !== 200 || !png.ok || png.w !== w || png.h !== h) iconsRight = false;
  }
  check(iconsRight, "…and every icon is there, at the size it claims");

  const worker = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
  const workerBody = await worker.text();
  check(worker.status === 200 && /javascript/.test(worker.headers.get("content-type") ?? ""), "the service worker is served as a script, without signing in");
  check(/no-store|no-cache/.test(worker.headers.get("cache-control") ?? "") && worker.headers.get("service-worker-allowed") === "/", "…never kept by the browser’s cache, and allowed to cover the whole app");
  check(!/\/home|\/tribe|\/api\//.test(workerBody.replace(/\/\*[\s\S]*?\*\//g, "")), "…and its code never names a personal page or a data address");

  const offline = await fetch(`${BASE}/offline`, { redirect: "manual" });
  const offlineHtml = await offline.text();
  check(offline.status === 200 && /You are offline/.test(offlineHtml), "the offline page opens without signing in");
  check(!/<form|<input|<textarea/.test(offlineHtml), "…and has nothing on it to fill in");

  // --- 2. every page carries a fresh, strict security policy ------------------------------------------------------------
  const visit = async () => {
    const res = await fetch(`${BASE}/sign-in`);
    return { headers: res.headers, html: await res.text(), policy: res.headers.get("content-security-policy") ?? "" };
  };
  const first = await visit();
  const second = await visit();
  const nonce = (p: string) => /'nonce-([^']+)'/.exec(p)?.[1] ?? "";
  check(nonce(first.policy).length >= 16 && nonce(second.policy).length >= 16 && nonce(first.policy) !== nonce(second.policy), "each visit is given its own one-time nonce");
  const scripts = first.html.match(/<script\b[^>]*>/g) ?? [];
  check(scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce(first.policy)}"`)), "…and every script on the page carries it");
  const csp = parsePolicy(first.policy);
  check(csp["script-src"]?.includes("'strict-dynamic'") && !csp["script-src"].includes("'unsafe-inline'") && !csp["script-src"].includes("'unsafe-eval'"), "scripts need the nonce: no inline or eval shortcuts");
  check(csp["object-src"]?.join() === "'none'" && csp["frame-ancestors"]?.join() === "'none'" && csp["base-uri"]?.join() === "'self'" && csp["form-action"]?.join() === "'self'", "…no plug-ins, no framing, forms and base address only to itself");
  check(csp["connect-src"]?.includes(`http://127.0.0.1:${API_PORT}`) && csp["connect-src"].includes(`http://127.0.0.1:${API_PORT}`.replace("http", "ws")), "the page may talk to its own database service, and nobody else");
  check(csp["connect-src"]?.some((v) => v.includes("54399")) && csp["frame-src"]?.some((v) => v.includes("54399")), "…and to the bot check, only because it is switched on");
  const h = first.headers;
  check(
    h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "DENY" && /strict-origin/.test(h.get("referrer-policy") ?? "") && /max-age=\d{7,}/.test(h.get("strict-transport-security") ?? "") && h.get("cross-origin-opener-policy") === "same-origin" && /microphone=\(self\)/.test(h.get("permissions-policy") ?? ""),
    "the other protective headers are on",
  );
  const api = await fetch(`${BASE}/api/health`);
  check(api.status === 200 && !api.headers.get("content-security-policy") && api.headers.get("x-content-type-options") === "nosniff", "the health check carries no page policy, and still the basic protections");

  // The browser really enforces it: an inline handler slipped into the page does not run.
  const raw = await browser.newContext();
  const rawPage = await raw.newPage();
  await rawPage.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__violations.push(e.violatedDirective));
  });
  await rawPage.goto(`${BASE}/sign-in`);
  await rawPage.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<img alt="" src="/icons/missing.png" onerror="window.__pwned = 1">'));
  await rawPage.waitForFunction(() => (window as unknown as { __violations: string[] }).__violations.length > 0, undefined, { timeout: 5000 }).catch(() => {});
  const enforced = await rawPage.evaluate(() => ({ pwned: (window as unknown as { __pwned?: number }).__pwned ?? null, violations: (window as unknown as { __violations: string[] }).__violations }));
  check(enforced.pwned === null && enforced.violations.some((v) => v.startsWith("script-src")), "the browser refuses an inline script that was slipped into the page");
  await raw.close();

  // --- 3. the bot check stands in front of sign-in ------------------------------------------------------------------------
  const blocked = await browser.newContext();
  const blockedPage = await blocked.newPage();
  await blockedPage.route("**/turnstile/api.js", (route) => route.abort());
  await blockedPage.goto(`${BASE}/sign-in`);
  await blockedPage.getByText(/couldn’t check that you are a person/).first().waitFor({ timeout: 15000 });
  await blockedPage.getByLabel("Email address").fill("member@example.org");
  check(await blockedPage.getByRole("button", { name: "Email me a code" }).isDisabled(), "if the bot check cannot load, sign-in explains that and stays switched off");
  await blocked.close();

  const toured = await newPage(browser);
  await toured.page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await toured.page.goto(`${BASE}/sign-in`);
  await toured.page.locator('[data-testid="bot-check"][data-widget]').first().waitFor({ state: "attached", timeout: 15000 });
  await toured.page.getByLabel("Email address").fill("member@example.org");
  await toured.page.getByRole("button", { name: "Email me a code" }).waitFor();
  check(await toured.page.getByRole("button", { name: "Email me a code" }).isEnabled({ timeout: 5000 }), "with the bot check working, sign-in is open as soon as it has confirmed a person");
  await signIn(toured.page, "member@example.org", "/home");
  const seen = await captchaSeen();
  check(seen.length > 0 && seen.every((s) => s.token !== null && s.token.startsWith(TURNSTILE.tokenPrefix)), "every request for a sign-in code reached the backend carrying a bot-check token");

  let violations: string[] = [];
  for (const path of ["/home", "/tribe", "/privacy"]) {
    await open(toured.page, path);
    violations = violations.concat(await toured.page.evaluate(() => (window as unknown as { __violations: string[] }).__violations));
  }
  check(violations.length === 0, `pages from sign-in to the privacy notice break none of the security policy (${violations.join("; ") || "none"})`);

  // --- 4. the referee’s page: the link alone is not enough, and it fails closed --------------------------------------------
  const applicant = await k.person("Ngozi");
  const app = (await one("insert into public.leader_applications (person_id, status, answers, consent_version, submitted_at) values ($1, 'submitted', '{}'::jsonb, '2026-10-v1', now()) returning id", [applicant.id]))!.id as string;
  const secrets = [crypto.randomBytes(32).toString("hex"), crypto.randomBytes(32).toString("hex")];
  for (const [i, secret] of secrets.entries()) {
    await q.query(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at)
       values ($1, $2, $3, 'Unit head', $4, $5, public.referee_token_hash($6), now() + interval '30 days')`,
      [app, i + 1, i === 0 ? "Pastor Ife Adeyemi" : "Sister Bola Ade", `referee${i + 1}@example.org`, i === 0, secret],
    );
  }
  const submitted = async (slot: number) => (await one("select submitted_at from public.leader_references where application_id = $1 and slot = $2", [app, slot]))?.submitted_at ?? null;
  const fill = async (page: Page) => {
    for (const id of ["reliability", "warmth", "confidentiality", "maturity"]) await page.locator(`label:has(input[name="rate-${id}"][value="5"])`).click();
    await page.locator("label", { hasText: "No concern" }).first().click();
  };

  // The link alone shows only a page offering a code; the code goes to the referee’s own email, and only then do the questions appear
  const unlock = async (page: Page, email: string) => {
    await page.getByTestId("referee-send-code").click();
    await page.getByTestId("referee-code").waitFor({ timeout: 15000 });
    await tick();
    const all = (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as { body: { to: string[]; subject: string } }[];
    const mine = all.filter((m) => m.body.to.includes(email)).at(-1);
    const code = /\b(\d{6})\b/.exec(mine?.body.subject ?? "")?.[1] ?? "";
    check(/^\d{6}$/.test(code), `the code reached ${email}, not the page`);
    await page.getByLabel("Six-digit code").fill(code);
    await page.getByTestId("referee-confirmed").waitFor({ timeout: 20000 });
  };

  const referee = await newPage(browser);
  const before = (await checks()).length;
  await open(referee.page, `/reference/${secrets[0]}`);
  check(await referee.page.getByRole("heading", { name: /A reference for/ }).first().isVisible(), "the referee’s private link opens without signing in");
  check((await referee.page.getByRole("button", { name: "Send my reference" }).count()) === 0, "…but the questions wait until the code sent to the referee’s own email is typed in");
  await unlock(referee.page, "referee1@example.org");
  await fill(referee.page);
  const send = referee.page.getByRole("button", { name: "Send my reference" });
  await send.click();
  await referee.page.getByRole("heading", { name: /Thank you, Pastor Ife/ }).waitFor({ timeout: 15000 });
  check((await submitted(1)) !== null, "a reference sent with the bot check passed is recorded");
  const afterFirst = (await checks()).slice(before);
  check(afterFirst.length === 1 && afterFirst[0].ok && afterFirst[0].token.startsWith(TURNSTILE.tokenPrefix), "…and the server asked the bot-check service about exactly one token, which it accepted");

  await open(referee.page, `/reference/${secrets[1]}`);
  await unlock(referee.page, "referee2@example.org");
  await fill(referee.page);
  await botCheckRefuses(true);
  await referee.page.getByRole("button", { name: "Send my reference" }).click();
  await referee.page.getByRole("alert").filter({ hasText: /couldn’t confirm you are a person/ }).waitFor({ timeout: 15000 });
  check((await submitted(2)) === null, "while the bot check cannot confirm a person, the reference is refused and nothing is recorded");
  await botCheckRefuses(false);
  await referee.page.getByRole("button", { name: "Send my reference" }).click();
  await referee.page.getByRole("heading", { name: /Thank you, Sister Bola/ }).waitFor({ timeout: 15000 });
  check((await submitted(2)) !== null, "…and once it can, the same page goes through with a fresh token");
  const used = (await checks()).filter((c) => c.ok).map((c) => c.token);
  check(new Set(used).size === used.length, "no bot-check token was ever used twice");
  await referee.ctx.close();

  // --- 5. the daily clean-up of old personal data runs from the heartbeat -------------------------------------------------
  const stale = await k.person("Stale");
  const fresh = await k.person("Fresh");
  await q.query("insert into public.intake_drafts (person_id, step, answers, updated_at) values ($1, 'goal', '{}', now() - interval '40 days'), ($2, 'goal', '{}', now() - interval '3 days')", [stale.id, fresh.id]);
  await q.query("delete from public.calendar_runs where key like 'retention:%'");
  const ran = await tick();
  check(ran.status === 200 && ran.body.calendar.retention_ran === true && Number(ran.body.calendar.drafts_removed) >= 1, "the heartbeat runs the clean-up and says how many old half-finished forms it cleared");
  check(ran.body.problems.length === 0, "…without raising a problem");
  const left = (await q.query("select person_id from public.intake_drafts where person_id in ($1, $2)", [stale.id, fresh.id])).rows.map((r) => r.person_id);
  check(left.length === 1 && left[0] === fresh.id, "the form nobody touched for 40 days is gone, and the one from three days ago is kept");
  const again = await tick();
  check(again.body.calendar.retention_ran === false, "a second heartbeat the same day does not run it again");
  const logged = (await one("select meta from public.event_log where action = 'retention.ran' order by id desc limit 1"))?.meta as Record<string, unknown> | undefined;
  check(!!logged && Object.values(logged).every((v) => typeof v === "number"), "the audit log keeps only counts, never who or what was removed");

  // A fault in the clean-up is reported by the heartbeat, and no message is held up by it.
  await q.query("create or replace function public.retention_tick(p_now timestamptz) returns jsonb language plpgsql as $$ begin raise exception 'broken for the test'; end $$");
  const faulty = await tick();
  check(faulty.status === 200 && faulty.body.problems.some((p) => /retention/.test(p)) && !faulty.body.problems.join(" ").includes("broken for the test"), "if the clean-up fails the heartbeat still answers, and lists it as a problem without the database’s own words");
  await q.query(`create or replace function public.retention_tick(p_now timestamptz) returns jsonb language plpgsql security definer set search_path = '' as $$ begin return jsonb_build_object('retention_ran', false); end $$`);

  // --- 6. on a phone: the service worker keeps only the offline page and the app’s own files ---------------------------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await phone.newPage();
  await signIn(p, "member@example.org", "/home");
  await open(p, "/home");
  const active = await p.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null);
  check(!!active && active.endsWith("/sw.js"), "the service worker installs itself in the browser");
  await p.reload();
  await open(p, "/tribe");
  const kept = await p.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
    return out;
  });
  const paths = Object.values(kept).flat();
  check(paths.includes("/offline"), "the offline page is kept on the phone");
  check(paths.length > 1 && paths.every((x) => x === "/offline" || /^\/(_next\/static|icons|brand)\//.test(x) || /\.woff2?$/.test(x)), "…beside only the app’s own fingerprinted files, never a page or data of a person");

  // No signal. (Playwright's own "offline" switch does not reach a service worker's requests, so every request is refused
  // instead; that needs PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1, which e2e/run.sh sets.)
  await phone.route("**/*", (route) => route.abort("internetdisconnected"));
  await p.goto(`${BASE}/tribe`).catch(() => {});
  const offlineText = await p.locator("body").innerText();
  check(/You are offline/.test(offlineText) && !/Ngozi|Stale|Fresh|member@example/.test(offlineText), `with no signal, opening any page shows the offline page and nothing about the last person (saw: ${offlineText.replace(/\s+/g, " ").slice(0, 80)})`);
  await phone.unroute("**/*");
  await phone.close();

  await toured.ctx.close();
  await q.end();
  await browser.close();
  finish("08-platform");
}
void main();

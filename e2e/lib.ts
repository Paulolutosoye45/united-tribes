import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { Client } from "pg";
import { APP_PORT, STATE_FILE } from "./env";

export const BASE = `http://127.0.0.1:${APP_PORT}`;
type State = { pgPort: number; stubUrl: string; workerToken: string };
export const state = (): State => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

/**
 * Makes the stand-in for Cloudflare Turnstile refuse every check (or accept them again), to prove the pages that anyone with a
 * link can submit fail closed when a person cannot be confirmed.
 */
export async function botCheckRefuses(refuse: boolean) {
  await fetch(`${state().stubUrl}/__turnstile/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refuse }) });
}

/** A superuser connection to the throwaway database, for arranging a situation or checking a result. */
export async function db() {
  const c = new Client({ host: "127.0.0.1", port: state().pgPort, user: "postgres", password: "postgres", database: "ut_dev" });
  await c.connect();
  return c;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
}

export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;
export const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;

const problems: string[] = [];
let checks = 0;
export const log = (s: string) => console.log(s);
export const fail = (s: string) => {
  problems.push(s);
  console.log("  ✗ " + s);
};
export const ok = (s: string) => {
  checks++;
  console.log("  ✓ " + s);
};
/** A named check: passes or fails with a message. */
export function check(condition: unknown, label: string) {
  if (condition) ok(label);
  else fail(label);
}
export const problemsFound = () => problems;
export const checksPassed = () => checks;

export async function newPage(
  browser: Browser,
  kind: "phone" | "desktop" = "phone",
  extra: { permissions?: string[] } = {},
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...(kind === "phone" ? PHONE : DESKTOP), ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail(`pageerror on ${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource.*(401|403|404)/.test(m.text())) fail(`console error on ${page.url()}: ${m.text().slice(0, 200)}`);
  });
  return { ctx, page };
}

export async function signIn(page: Page, email: string, next: string) {
  await page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 15000 });
}

/** Fails if the page scrolls sideways. */
export async function noOverflow(page: Page, label: string) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (w.sw > w.cw + 1) fail(`${label}: horizontal overflow (${w.sw} > ${w.cw})`);
}

export async function text(page: Page) {
  return (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n");
}

/** Opens a page and waits until the loading skeleton has gone. */
export async function open(page: Page, path: string) {
  const res = await page.goto(path.startsWith("http") ? path : BASE + path, { waitUntil: "domcontentloaded" });
  await settle(page);
  return res;
}

export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator(".skeleton").first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
}

/** Ends a journey: prints the tally and exits non-zero if anything failed. */
export function finish(name: string) {
  const bad = problemsFound();
  console.log(`\n${name}: ${checksPassed()} checks passed, ${bad.length} problem(s)`);
  process.exit(bad.length ? 1 : 0);
}

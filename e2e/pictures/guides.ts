/**
 * Makes the pictures in the How-to Library (content/guides/pictures/<guide>/<step>.webp) and writes down where each ring sits
 * (src/lib/guides/pictures.generated.json).
 *
 * It reads the same list of guides the website shows. For every step that has a picture it opens a throwaway copy of the site as a made-up
 * person, brings the page to the state the step describes, finds the thing to ring and saves a sharp picture of the page round it.
 * Nothing real is in them: every person on the throwaway site is renamed to a made-up one first, and a picture is refused if it shows
 * anything that looks real.
 *
 * It STOPS, naming the guide and the step, when
 *   - the thing a step says to ring is not on the screen,
 *   - a [[Label]] in the step's words is not on the screen it pictures (a button was renamed, a field removed),
 *   - the page shows a name, an email or a number that is not made up.
 * So a picture can never quietly show something the words do not say.
 *
 *   bash scripts/guide-pictures.sh              every guide
 *   bash scripts/guide-pictures.sh M1 M5        only these guides (by code)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import { GUIDES } from "../../src/lib/guides/catalogue";
import { labelsIn } from "../../src/lib/guides/markup";
import type { Action, Cast, Finder, Guide, GuideManifest, PictureInfo, Shot, Step } from "../../src/lib/guides/types";
import { MESSAGING } from "../env";
import { BASE, launch, open, settle, state } from "../lib";
import { ARRANGE, CAST, arrange, makeStage, pathFor } from "./guide-cast";

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "content/guides/pictures");
const MANIFEST = path.join(ROOT, "src/lib/guides/pictures.generated.json");
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;
const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 } as const;
/** The most of a page one picture shows. A taller thing is a sign the step tries to show too much. */
const MAX_HEIGHT = { phone: 760, desktop: 640 } as const;
const MIN_HEIGHT = { phone: 360, desktop: 300 } as const;

type Box = { x: number; y: number; w: number; h: number };

function locate(page: Page, f: Finder): Locator {
  if ("within" in f) return locate(page, f.within).first().getByText(f.text, { exact: f.exact });
  if ("role" in f) return page.getByRole(f.role, { name: f.name, exact: f.exact });
  if ("label" in f) return page.getByLabel(f.label, { exact: f.exact });
  if ("text" in f) return page.getByText(f.text, { exact: f.exact });
  if ("testid" in f) return page.getByTestId(f.testid);
  const l = page.locator(f.css);
  return f.nth === undefined ? l.first() : l.nth(f.nth);
}

const describe = (f: Finder) => JSON.stringify(f, (_k, v) => (v instanceof RegExp ? String(v) : v));

const usedCodes = new Set<string>();

/** The six-digit code the site just emailed to a made-up address: the heartbeat sends it, and the test mailbox keeps it. */
async function emailedCode(page: Page, to: string): Promise<string> {
  const sixDigits = (t: string | undefined) => /\b(\d{6})\b/.exec(t ?? "")?.[1];
  for (let i = 0; i < 40; i++) {
    await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
    const sent = (await (await fetch(`${state().stubUrl}/__sent?channel=email`)).json()) as { body: { to: string[]; subject?: string; text?: string } }[];
    const mine = sent.filter((m) => m.body.to.includes(to));
    for (const m of mine.reverse()) {
      const code = sixDigits(m.body.subject) ?? sixDigits(m.body.text);
      if (code && !usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no new code reached ${to}`);
}

async function run(page: Page, a: Action) {
  switch (a.do) {
    case "click":
      await locate(page, a.on).first().click({ timeout: 15000 });
      break;
    case "fill":
      await locate(page, a.on).first().fill(a.value, { timeout: 15000 });
      break;
    case "check":
      await locate(page, a.on).first().check({ timeout: 15000 });
      break;
    case "fill-code":
      await locate(page, a.on).first().fill(await emailedCode(page, a.to), { timeout: 15000 });
      break;
    case "wait":
      await locate(page, a.on).first().waitFor({ state: "visible", timeout: 20000 });
      break;
    case "open":
      await open(page, a.path);
      break;
    case "pause":
      await page.waitForTimeout(a.ms);
      break;
  }
  await page.waitForTimeout(150);
}

/** Whether the screen has something called this: a button, link, heading, field, tab or plain words. */
async function appears(page: Page, label: string): Promise<boolean> {
  const tries = [
    page.getByRole("button", { name: label }),
    page.getByRole("link", { name: label }),
    page.getByRole("heading", { name: label }),
    page.getByRole("checkbox", { name: label }),
    page.getByRole("radio", { name: label }),
    page.getByRole("tab", { name: label }),
    page.getByRole("combobox", { name: label }),
    page.getByLabel(label),
    page.getByPlaceholder(label),
    page.getByText(label),
  ];
  for (const t of tries) if ((await t.count()) > 0) return true;
  return false;
}

/** Everything the page shows that would be a real person's: not a made-up name, not an example.org address. */
async function assertNothingReal(page: Page, where: string, banned: RegExp) {
  const body = await page.locator("body").innerText();
  const m = banned.exec(body);
  if (m) throw new Error(`${where}: the page shows "${m[0]}", which is not made up`);
  const emails = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  const real = emails.filter((e) => !/@example\.(org|com)$/i.test(e));
  if (real.length) throw new Error(`${where}: the page shows an email address that is not made up (${real[0]})`);
}

async function boxOf(page: Page, finders: Finder[], where: string): Promise<Box> {
  const boxes: Box[] = [];
  for (const f of finders) {
    const l = locate(page, f).first();
    try {
      await l.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      throw new Error(`${where}: could not find what to ring on the screen: ${describe(f)}`);
    }
    const b = await l.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
    });
    boxes.push(b);
  }
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Hides every fixed bar (the menu at the bottom, a sticky button) that is not what is being ringed, so a tall crop is not cut across by it. */
async function hideFixed(page: Page, keep: Finder[]) {
  const keepHandles = await Promise.all(keep.map((f) => locate(page, f).first().elementHandle()));
  await page.evaluate((keepEls) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "sticky") continue;
      if (keepEls.some((k) => k && (el.contains(k) || k.contains(el)))) continue;
      // The header stays: it is part of what a page looks like. Only things that float over content go.
      if (el.tagName === "HEADER") continue;
      el.style.visibility = "hidden";
    }
  }, keepHandles);
}

async function saveWebp(png: Buffer, file: string): Promise<{ width: number; height: number; hash: string }> {
  const webp = await sharp(png).webp({ quality: 80, effort: 5, smartSubsample: true }).toBuffer();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, webp);
  const meta = await sharp(webp).metadata();
  return { width: meta.width!, height: meta.height!, hash: crypto.createHash("sha1").update(webp).digest("hex").slice(0, 8) };
}

async function takeShot(page: Page, guide: Guide, step: Step, shot: Shot, banned: RegExp): Promise<{ info: PictureInfo; bytes: number }> {
  const where = `${guide.code} "${guide.title}", step "${step.id}"`;
  const device = shot.device ?? "phone";
  const scale = device === "phone" ? PHONE.deviceScaleFactor : DESKTOP.deviceScaleFactor;
  const vw = device === "phone" ? PHONE.viewport.width : DESKTOP.viewport.width;
  const vh = device === "phone" ? PHONE.viewport.height : DESKTOP.viewport.height;

  // The words must match the screen: every [[Label]] in what the step says to do, and everything to be ringed
  for (const label of step.do.flatMap(labelsIn)) {
    if (!(await appears(page, label))) throw new Error(`${where}: the words say [[${label}]], but nothing on the screen is called that`);
  }
  await assertNothingReal(page, where, banned);

  // Let everything that fades or rises in finish first: a row caught half-way looks faded in the picture
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 4000))]);
  });

  // Nothing in focus: a text box left with its dark outline reads as part of the screen
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const ringFinders = shot.ring;
  let png: Buffer;
  let crop: Box;
  let ring: Box;
  let second: Box | null = null;

  if ((shot.frame ?? "crop") === "screen") {
    // The whole window, as a person holds it. The target is brought into view first, unless it is a bar that stays on screen when you scroll.
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      // "instant", said outright: the site's own style makes a plain scrollTo glide, and a glide still under way when the picture is taken puts the page in the wrong place
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForFunction(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      return window.scrollY < 1;
    }, undefined, { timeout: 5000 });
    const first = locate(page, ringFinders[0]).first();
    await first.waitFor({ state: "visible", timeout: 20000 });
    await first.evaluate((el) => {
      for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" || pos === "sticky") return;
      }
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 80) window.scrollBy({ top: r.top - window.innerHeight * 0.35, behavior: "instant" });
    });
    await page.waitForTimeout(450);
    const r = await boxOf(page, ringFinders, where);
    const sy = await page.evaluate(() => window.scrollY);
    ring = { x: r.x, y: r.y - sy, w: r.w, h: r.h };
    if (shot.second?.length) {
      const s = await boxOf(page, shot.second, where);
      second = { x: s.x, y: s.y - sy, w: s.w, h: s.h };
    }
    // What is ringed must be in the window: a ring that points off the screen is a picture that cannot work
    for (const [name, b] of [["ring", ring], ["second ring", second]] as const) {
      if (b && (b.y < 0 || b.y + b.h > vh || b.x < 0 || b.x + b.w > vw)) throw new Error(`${where}: the ${name} is not inside the window (${Math.round(b.y)}px down, ${Math.round(b.h)}px tall). Choose another frame, or ring less.`);
    }
    crop = { x: 0, y: 0, w: vw, h: vh };
    png = await page.screenshot({ type: "png" });
  } else {
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForFunction(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      return window.scrollY < 1;
    }, undefined, { timeout: 5000 });
    await page.waitForTimeout(150);
    await hideFixed(page, [...ringFinders, ...(shot.second ?? [])]);
    ring = await boxOf(page, ringFinders, where);
    if (shot.second?.length) second = await boxOf(page, shot.second, where);
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const minH = shot.minHeight ?? MIN_HEIGHT[device];
    const maxH = MAX_HEIGHT[device];
    const both = second ? { y1: Math.min(ring.y, second.y), y2: Math.max(ring.y + ring.h, second.y + second.h) } : { y1: ring.y, y2: ring.y + ring.h };
    let top: number;
    let bottom: number;
    if (shot.lead !== undefined) {
      // Said outright: this far above the ring, to a little below it
      top = Math.max(0, Math.floor(both.y1 - shot.lead));
      bottom = Math.min(docH, Math.ceil(both.y2 + 64));
    } else {
      // The natural picture of a part of a page is the smallest block that holds what is ringed and is tall enough to make sense on its own
      const handles = await Promise.all([...ringFinders, ...(shot.second ?? [])].map((f) => locate(page, f).first().elementHandle()));
      const block = await page.evaluate(
        ({ els, minH, maxH }) => {
          const targets = els.filter(Boolean) as Element[];
          let node: Element | null = targets[0];
          while (node && !targets.every((t) => node!.contains(t))) node = node.parentElement;
          const boxes: { top: number; bottom: number }[] = [];
          for (; node && node.tagName !== "BODY" && node.tagName !== "HTML"; node = node.parentElement) {
            const r = node.getBoundingClientRect();
            if (r.height < 1) continue;
            boxes.push({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY });
          }
          const fits = boxes.filter((b) => b.bottom - b.top <= maxH);
          const tall = fits.filter((b) => b.bottom - b.top >= minH);
          // smallest that is tall enough; else the biggest that fits
          return tall.length ? tall[0] : (fits[fits.length - 1] ?? null);
        },
        { els: handles, minH, maxH },
      );
      if (block) {
        top = Math.max(0, Math.floor(Math.min(block.top, both.y1 - 24) - 14));
        bottom = Math.min(docH, Math.ceil(Math.max(block.bottom, both.y2 + 24) + 14));
      } else {
        top = Math.max(0, Math.floor(both.y1 - 96));
        bottom = Math.min(docH, Math.ceil(both.y2 + 64));
      }
    }
    if (bottom - top < minH) {
      bottom = Math.min(docH, top + minH);
      if (bottom - top < minH) top = Math.max(0, bottom - minH);
    }
    if (bottom - top > maxH) {
      if (both.y2 + 16 - top > maxH) throw new Error(`${where}: what is ringed is ${Math.round(both.y2 - both.y1)}px tall, more than one picture shows (${maxH}px). Ring less of it.`);
      bottom = top + maxH;
    }
    crop = { x: 0, y: top, w: vw, h: bottom - top };
    png = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: crop.y, width: crop.w, height: crop.h } });
    // The ring is measured on the page; the picture starts at `top`
    ring = { x: ring.x, y: ring.y - top, w: ring.w, h: ring.h };
    if (second) second = { x: second.x, y: second.y - top, w: second.w, h: second.h };
  }

  const file = path.join(OUT, guide.slug, `${step.id}.webp`);
  const saved = await saveWebp(png, file);
  if (saved.width !== Math.round(crop.w * scale)) throw new Error(`${where}: the picture is ${saved.width}px wide, expected ${Math.round(crop.w * scale)}`);
  const pad = 6;
  const pct = (b: Box, tone: "main" | "second") => {
    const x = Math.max(0, b.x - pad);
    const y = Math.max(0, b.y - pad);
    const w = Math.min(crop.w - x, b.w + pad * 2);
    const h = Math.min(crop.h - y, b.h + pad * 2);
    return { x: +((x / crop.w) * 100).toFixed(2), y: +((y / crop.h) * 100).toFixed(2), w: +((w / crop.w) * 100).toFixed(2), h: +((h / crop.h) * 100).toFixed(2), tone };
  };
  const rings = [pct(ring, "main"), ...(second ? [pct(second, "second")] : [])];
  const info: PictureInfo = {
    id: step.id,
    width: saved.width,
    height: saved.height,
    hash: saved.hash,
    device,
    rings,
    ...(shot.tag ? { tag: { text: shot.tag, x: +(rings[0].x + rings[0].w).toFixed(2), y: +(rings[0].y + rings[0].h / 2).toFixed(2) } } : {}),
  };
  return { info, bytes: fs.statSync(file).size };
}

async function main() {
  // "M1" is every picture of that guide; "M1:rhythm,care" is only those steps of it
  const asked = process.argv.slice(2).map((arg) => {
    const [code, steps] = arg.split(":");
    return { code: code.toUpperCase(), steps: steps ? steps.split(",") : null };
  });
  const guides = GUIDES.filter((g) => asked.length === 0 || asked.some((a) => a.code === g.code.toUpperCase()));
  if (asked.length && guides.length !== new Set(asked.map((a) => a.code)).size) {
    const have = guides.map((g) => g.code.toUpperCase());
    throw new Error(`No guide called ${asked.filter((a) => !have.includes(a.code)).map((a) => a.code).join(", ")}`);
  }
  const onlySteps = (code: string) => asked.find((a) => a.code === code.toUpperCase())?.steps ?? null;

  const { stage, q } = await makeStage();

  const browser: Browser = await launch();
  const contexts = new Map<string, { ctx: BrowserContext; page: Page }>();
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const banned = new RegExp(["Ogedengbe", "Cerebre", "\\bMary\\b", ...(await ARRANGE.__realNames(stage)).map(esc)].join("|"), "i");

  async function pageFor(cast: Cast, device: "phone" | "desktop", firstPath: string): Promise<Page> {
    const key = `${cast}:${device}`;
    const have = contexts.get(key);
    if (cast === "visitor" || cast === "referee" || cast === "parent" || cast === "placed") {
      // A visitor, and a person who opens a link from an email, is never signed in; a fresh browser for each picture keeps what one typed out of the next
      if (have) await have.ctx.close();
      contexts.delete(key);
    } else if (have) return have.page;
    const made = await CAST[cast]!.open(stage, browser, device, firstPath);
    contexts.set(key, made);
    return made.page;
  }

  const manifest: GuideManifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  const madeOn = new Date().toISOString().slice(0, 10);
  let made = 0;
  const failures: string[] = [];
  console.log("Making the pictures");
  try {
    for (const guide of guides) {
      console.log(`${guide.code}  ${guide.title}`);
      // A picture that could not be made now keeps the one made before, so one failure never takes a guide's other pictures away
      const pictures: Record<string, PictureInfo> = { ...(manifest[guide.slug]?.pictures ?? {}) };
      const only = onlySteps(guide.code);
      for (const part of guide.parts) {
        for (const step of part.steps) {
          if (!step.shot) continue;
          if (only && !only.includes(step.id)) continue;
          const shot = step.shot;
          const device = shot.device ?? "phone";
          const where = `${guide.code} "${guide.title}", step "${step.id}"`;
          try {
            if (shot.arrange) await arrange(stage, shot.arrange);
            await CAST[shot.cast]?.fresh?.(stage);
            const where_ = await pathFor(stage, shot.path);
            const page = await pageFor(shot.cast, device, where_);
            await open(page, where_);
            for (const a of shot.before ?? []) await run(page, a);
            await settle(page);
            const { info, bytes } = await takeShot(page, guide, step, shot, banned);
            pictures[step.id] = info;
            made++;
            console.log(`  ${step.id.padEnd(26)} ${info.width}x${info.height}  ${(bytes / 1024).toFixed(0)} KB`);
          } catch (e) {
            const why = (e instanceof Error ? e.message : String(e)).split("\n")[0];
            console.log(`  ${step.id.padEnd(26)} FAILED: ${why}`);
            failures.push(why.startsWith(where) ? why : `${where}: ${why}`);
          }
        }
      }
      // Pictures of steps that no longer have one are removed, so a stale file is never served
      const kept = new Set(guide.parts.flatMap((p) => p.steps.filter((x) => x.shot).map((x) => x.id)));
      for (const id of Object.keys(pictures)) if (!kept.has(id)) delete pictures[id];
      const dir = path.join(OUT, guide.slug);
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (!kept.has(f.replace(/\.webp$/, ""))) fs.unlinkSync(path.join(dir, f));
      manifest[guide.slug] = { madeOn, pictures };
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    }
  } finally {
    for (const { ctx } of contexts.values()) await ctx.close().catch(() => {});
    await browser.close();
    await q.end();
  }
  console.log(`Done: ${made} pictures. Look at every picture before you ship them.`);
  if (failures.length) {
    console.log(`\n${failures.length} picture${failures.length === 1 ? "" : "s"} could not be made:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.log(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
void BASE;
void state;

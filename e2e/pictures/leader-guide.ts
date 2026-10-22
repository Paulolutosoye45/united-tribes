/**
 * Makes the pictures in the leader welcome email (public/email/leader-guide/*.png).
 *
 * It opens a throwaway copy of the site, signs in a made-up leader ("Ada Example") on a phone-size screen, visits each page the email
 * talks about, draws a numbered circle round the thing to press, and saves the page as a small picture. Nothing real is in them: the
 * leader, the community and the numbers of people waiting are made up for the throwaway site.
 *
 * Run it with `bash scripts/leader-guide-pictures.sh` (it builds and starts the throwaway site first). Run it again whenever a screen the
 * email shows has changed, then look at every picture before shipping them. The size of each picture must match GUIDE_PICTURES in
 * src/lib/messaging/templates-leader-welcome.ts: a test checks it.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Locator, Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { GUIDE_PICTURES, type GuidePicture } from "../../src/lib/messaging/templates-leader-welcome";
import { db, launch, newPage, open, signIn } from "../lib";
import { ownerDoor } from "../owner-door";

const OUT = path.resolve(__dirname, "../../public/email/leader-guide");
// What the email shows (CSS pixels) comes from GUIDE_PICTURES. The files are twice that, for sharp screens.
const SCALE = 2;
const FLAME = "#E8590C";

const PHRASE = "river-lantern-mango-cobalt";
const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const LEADERSHIP = "step-into-a-leadership-role";
const MENTOR = "find-a-mentor-and-become-one";
const REPUTATION = "build-a-reputation-for-excellent-work";

type Box = { x: number; y: number; width: number; height: number };

/** The box that holds all of these, in page coordinates. */
async function around(page: Page, targets: Locator[]): Promise<Box> {
  const boxes: Box[] = [];
  for (const t of targets) {
    await t.first().waitFor({ state: "visible", timeout: 20000 });
    const b = await t.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
    });
    boxes.push(b);
  }
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Draws a circle (a rounded outline) round a box, with a number on its corner, then takes the picture of a window that shows it.
 * `lead` is how far above the box the window starts, unless the whole thing fits at the top of the page, which then shows from the top.
 */
async function take(page: Page, name: GuidePicture, box: Box, o: { number?: number; lead?: number; room?: boolean } = {}) {
  const { width: W, height: H } = GUIDE_PICTURES[name];
  const { number = 1, lead = 110, room = false } = o;
  const pad = 8;
  await page.evaluate(
    ({ box, pad, number, flame, W }) => {
      document.querySelectorAll("[data-guide-mark]").forEach((e) => e.remove());
      const ring = document.createElement("div");
      ring.setAttribute("data-guide-mark", "ring");
      Object.assign(ring.style, {
        position: "absolute",
        left: `${box.x - pad}px`,
        top: `${box.y - pad}px`,
        width: `${box.width + pad * 2}px`,
        height: `${box.height + pad * 2}px`,
        border: `4px solid ${flame}`,
        borderRadius: `${Math.min(28, Math.max(14, Math.min(box.width, box.height) / 2 + pad))}px`,
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483647",
        boxShadow: "0 0 0 3px rgba(255,255,255,.85)",
      });
      // The number sits on the top right corner, where a label never is, and stays inside the picture
      const dot = document.createElement("div");
      dot.setAttribute("data-guide-mark", "number");
      dot.textContent = String(number);
      Object.assign(dot.style, {
        position: "absolute",
        left: `${Math.min(W - 40, box.x + box.width + pad - 24)}px`,
        top: `${Math.max(4, box.y - pad - 16)}px`,
        width: "32px",
        height: "32px",
        borderRadius: "16px",
        background: flame,
        color: "#fff",
        font: "700 17px/32px system-ui, sans-serif",
        textAlign: "center",
        pointerEvents: "none",
        zIndex: "2147483647",
        boxShadow: "0 0 0 3px #fff",
      });
      document.body.append(ring, dot);
    },
    { box, pad, number, flame: FLAME, W },
  );
  // A short page cannot scroll far enough for the window to start where it is asked to, which can cut a line of text in half at the top.
  // `room` adds empty space under the page for that.
  if (room) {
    await page.evaluate((h) => {
      const gap = document.createElement("div");
      gap.setAttribute("data-guide-mark", "room");
      gap.style.height = `${h}px`;
      document.body.append(gap);
    }, H);
  }
  const doc = await page.evaluate(() => ({ h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  let y = box.y + box.height + 40 <= H ? 0 : Math.max(0, Math.round(box.y - lead));
  y = Math.max(0, Math.min(y, doc.h - H));
  const height = Math.min(H, doc.h - y);
  if (height < H) throw new Error(`${name}: the page is only ${doc.h}px tall, the picture needs ${H}`);
  const png = await page.screenshot({ type: "png", fullPage: true, clip: { x: 0, y, width: W, height } });
  // Flat screens squash well. A palette keeps every picture under about 100 KB.
  let small = await sharp(png).png({ palette: true, colours: 96, effort: 10, dither: 0.6 }).toBuffer();
  if (small.length > 95_000) small = await sharp(png).png({ palette: true, colours: 48, effort: 10, dither: 0.4 }).toBuffer();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), small);
  const meta = await sharp(small).metadata();
  console.log(`  ${name}.png  ${meta.width}x${meta.height}  ${(small.length / 1024).toFixed(0)} KB`);
  if (meta.width !== W * SCALE || meta.height !== H * SCALE) throw new Error(`${name}: expected ${W * SCALE}x${H * SCALE}, got ${meta.width}x${meta.height}`);
}

async function main() {
  const q = await db();
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Record<string, unknown> | undefined;

  // The throwaway site, arranged the way a real one is: signed-off cards, an approved fit model, a season
  const pastorId = (await one("select id from public.people where email = 'pastor.ife@example.org'"))!.id as string;
  for (const c of (await q.query("select id from public.communities where active")).rows as Record<string, unknown>[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
  }
  for (const t of (await q.query("select slug from public.tribe_card_templates where status <> 'signed_off'")).rows as Record<string, unknown>[]) {
    await adapter.asUser(pastorId, (run) => run("select public.card_template_sign_off($1)", [t.slug]));
  }
  if (!(await one("select 1 as there from public.leader_fit_models where active"))) {
    await adapter.asUser(pastorId, (run) => run("select public.leader_fit_model_activate('lf-1')"));
  }
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug]))!.id as string;
  // Made-up numbers of people waiting, so the list in the picture shows what the real one shows
  for (const [slug, howMany] of [[MENTOR, 4], [REPUTATION, 2]] as const) {
    for (let i = 0; i < howMany; i++) {
      const u = await k.person(`Waiting${slug.slice(0, 5)}${i}`);
      await q.query(
        "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3",
        [u.id, S, await goalId(slug)],
      );
    }
  }

  const { call } = await ownerDoor(q, "pictures.owner@example.org", PHRASE);
  async function leader(first: string) {
    const person = await adapter.createUser({ email: `${first.toLowerCase()}.example@example.org` });
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [person.id, `${first} Example`, first]);
    const r = await call("god_appoint_leader", person.id, JSON.stringify(FORM), await goalId(LEADERSHIP), null);
    return { id: person.id, email: person.email, tribe: r.tribe as string };
  }
  const ada = await leader("Ada");
  const bayo = await leader("Bayo");
  await call("god_unlock_goal", [ada.tribe], false, false, null);
  for (const t of [ada.tribe, bayo.tribe]) {
    await q.query("update public.tribes set name = $2 where id = $1", [t, t === ada.tribe ? "Ada’s Professionals tribe" : "Bayo’s Professionals tribe"]);
  }

  const browser = await launch();
  console.log("Making the pictures");
  try {
    // 1. Sign in: nobody is signed in
    {
      const { ctx, page } = await newPage(browser, "phone");
      await open(page, "/sign-in");
      await take(page, "sign-in", await around(page, [page.getByLabel("Email address")]));
      await ctx.close();
    }
    // Ada, whose goal she may choose
    const a = await newPage(browser, "phone");
    await signIn(a.page, ada.email, "/lead/tribe");
    await open(a.page, "/lead/tribe");
    await a.page.getByTestId("goal-picker").waitFor({ timeout: 20000 });
    // 2. The card as it opens
    await take(a.page, "card", await around(a.page, [a.page.locator("h1").first()]));
    // 3. The list of goals
    await take(a.page, "goal-choose", await around(a.page, [a.page.getByTestId("goal-picker-line"), a.page.locator('[data-testid^="goal-option-"]').nth(2)]));
    // 5. The three lines of the Success Picture
    await take(a.page, "card-lines", await around(a.page, [a.page.locator('textarea[name="god"]'), a.page.locator('textarea[name="life"]')]), { lead: 56 });
    // 6. The Academy, before any module is done
    await open(a.page, "/lead/academy");
    await take(a.page, "academy", await around(a.page, [a.page.locator('a[href="/lead/academy/the-success-picture"]').first()]));
    // The leader has done the modules and written her card, so the last two pages show what she sees when she is ready
    for (const slug of ["the-success-picture", "care-and-safeguarding"]) {
      const m = await one("select id from public.academy_modules where slug = $1", [slug]);
      if (m) await q.query("insert into public.academy_progress (person_id, module_id, attempts, best_score, passed_at) values ($1, $2, 1, 100, now()) on conflict do nothing", [ada.id, m.id]);
    }
    await q.query(
      `update public.tribes set story = $2, meeting_day = 3, meeting_time = '20:00', slot = 'weeknight-evening', meeting_mode = 'in_person', zone = 'mainland' where id = $1`,
      [ada.tribe, "I stepped into leadership at work two years ago and learned a great deal the hard way. I would like to walk that road with others."],
    );
    // 8. The button that sends the card
    await open(a.page, "/lead/tribe");
    await a.page.getByRole("button", { name: "Send my Tribe Card" }).waitFor({ timeout: 20000 });
    if (await a.page.getByRole("button", { name: "Send my Tribe Card" }).isDisabled()) throw new Error("the card is not complete, so the button is not on");
    await take(a.page, "send", await around(a.page, [a.page.getByRole("button", { name: "Send my Tribe Card" })]));
    // 7. The safeguarding promises (they open once the care module is passed)
    await open(a.page, "/lead/academy/declaration");
    // Ticked and named, so the button is on (nothing is sent: the picture is taken before it is pressed)
    await a.page.getByRole("checkbox").check();
    await a.page.getByLabel("Type your first and last name to sign").fill("Ada Example");
    await a.page.getByLabel("Type your first and last name to sign").blur();
    if (await a.page.getByRole("button", { name: "Sign the declaration" }).isDisabled()) throw new Error("the signing button is not on");
    await take(
      a.page,
      "declaration",
      await around(a.page, [a.page.locator("label:has(input[type=checkbox])"), a.page.getByLabel("Type your first and last name to sign"), a.page.getByRole("button", { name: "Sign the declaration" })]),
      { lead: 28, room: true },
    );
    await a.ctx.close();

    // 4. A goal that was chosen for the leader: Bayo's is locked
    const b = await newPage(browser, "phone");
    await signIn(b.page, bayo.email, "/lead/tribe");
    await open(b.page, "/lead/tribe");
    await b.page.getByText("Season Goal", { exact: true }).first().waitFor({ timeout: 20000 });
    const fixedGoal = b.page.getByText("Season Goal", { exact: true }).first().locator("xpath=..");
    await take(b.page, "goal-fixed", await around(b.page, [fixedGoal]));
    await b.ctx.close();
  } finally {
    await browser.close();
    await q.end();
  }
  console.log("Done. Look at every picture before you ship them.");
}

main().catch((e) => {
  console.log(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});

/**
 * The browser pass (Phase 8): on the production build, at phone width, each page in a clean browser profile, the pages the rework touched are
 * opened as the people who use them, and every one is checked for three things: it does not scroll sideways, no text is cut off, and nothing
 * you are meant to tap is smaller than a thumb.
 *
 * Pages: the ready-made cards (read, ask, one card, a sensitive card); apply (Full process and the Open door); Find your tribe; the pastor's
 * review with the Tribe fit panel; the decision with a reduced-evidence reason; the Academy under each position; the declaration alone; a leader
 * starting from the ready-made card; the member's goal choice in every community with all 100 goals signed off; the leader supply board;
 * an offer, accepted; and the pipeline page as a director (can change), a pastor (read only) and a member (turned away).
 *
 * Set E2E_SHOTS=<folder> to keep a picture of each page.
 */
import type { Page } from "playwright-core";
import { kit as makeKit } from "../../tests/db/builders";
import { OPEN_DOOR, answers, calling, pipelineKit, setPositions } from "../../tests/db/pipeline-kit";
import { testDbFor } from "../dbkit";
import { check, db, fail, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const choice = (page: Page, name: string, value: string) => page.locator(`label.choice:has(input[name="${name}"][value="${value}"])`);

/** The smallest a thing you tap may be, in CSS pixels, on either side. A thumb covers about this much. */
const TAP_MIN = 40;

type Found = { cutOff: string[]; small: string[] };

/**
 * Reads the page as it stands. Text is cut off when an element hides its overflow and is narrower than its words, or runs past the screen's edge.
 * A tap target is a link, button, field or switch that is shown; a link inside a sentence is exempt, as is a checkbox whose label is the target.
 */
async function read(page: Page): Promise<Found> {
  // Pages slide and fade in; measure them where they come to rest
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(350);
  // The journeys run through a transpiler that wraps named functions in a helper which does not exist inside the page
  await page.evaluate("window.__name = window.__name || ((f) => f)");
  return page.evaluate((min) => {
    const cutOff: string[] = [];
    const small: string[] = [];
    const vw = document.documentElement.clientWidth;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && !el.closest("[hidden],[aria-hidden=true],.sr-only");
    };
    const label = (el: Element) => {
      const input = el as HTMLInputElement;
      const named = (el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.closest("[data-testid]")?.getAttribute("data-testid");
      return `${named ?? el.tagName}${input.type ? ` [${input.type}]` : ""}`.replace(/\s+/g, " ").trim().slice(0, 48);
    };
    /** A strip you swipe sideways on purpose (tabs, filters) keeps its far items off the screen until you swipe. */
    const swipes = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const x = getComputedStyle(p).overflowX;
        if ((x === "auto" || x === "scroll") && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };

    for (const el of Array.from(document.querySelectorAll("a[href], button, input, select, textarea, summary, [role=button], [role=tab], [role=switch], [role=radio]"))) {
      if (!shown(el)) continue;
      const input = el as HTMLInputElement;
      if (input.tagName === "INPUT" && ["checkbox", "radio", "hidden"].includes(input.type) && input.closest("label")) continue;
      if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li, dd, td, span, small, h1, h2, h3, label")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min || r.height < min) small.push(`${label(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    }

    for (const el of Array.from(document.querySelectorAll("main *, header *, nav *, footer *"))) {
      if (!shown(el)) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 1);
      if (!own) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const hides = ["hidden", "clip"].includes(s.overflowX) || s.textOverflow === "ellipsis";
      if (hides && el.scrollWidth > el.clientWidth + 1) cutOff.push(`${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
      else if (r.right > vw + 1 && s.position !== "fixed" && !swipes(el)) cutOff.push(`${label(el)} runs past the screen (${Math.round(r.right)} > ${vw})`);
    }
    return { cutOff, small };
  }, TAP_MIN);
}

const found: Record<string, Found> = {};
/** Overflow, cut-off text and small tap targets on the page as it stands. */
async function sweep(page: Page, name: string) {
  await noOverflow(page, `${name} on a phone`);
  const f = await read(page);
  found[name] = f;
  check(f.cutOff.length === 0, `${name}: no text cut off${f.cutOff.length ? ` — ${f.cutOff.slice(0, 4).join("; ")}` : ""}`);
  check(f.small.length === 0, `${name}: every tap target is at least ${TAP_MIN}px${f.small.length ? ` — ${f.small.slice(0, 6).join("; ")}` : ""}`);
  await shot(page, `27-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
}

async function eventually(label: string, readIt: () => Promise<boolean>, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await readIt().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

async function next(page: Page, label: string | RegExp, arrivesAt: string | RegExp) {
  await page.getByRole("button", { name: label }).click();
  await heading(page, arrivesAt).waitFor({ timeout: 20000 });
}

async function section(name: string, run: () => Promise<void>) {
  console.log(`\n— ${name}`);
  try {
    await run();
  } catch (e) {
    const where = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.includes("27-browser-pass.ts")) : undefined;
    fail(`${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}${where ? ` @ ${where.trim().replace(/^.*27-browser-pass\.ts/, "27-browser-pass.ts")}` : ""}`);
  }
}

const PASTOR = "pastor.ife@example.org";
const FOUR = { age21: true, time: true, safeguarding: true, confidentiality: true };

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  const n = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n ?? 0);
  const adapter = testDbFor(q);
  const kit = pipelineKit(adapter);
  // Only the switchboard is under test here; the first check on written answers ships Off
  await q.query("update public.leader_ai_settings set mode = 'off'");

  const staff = await kit.panel();
  const pastorId = (await one("select id from public.people where email = $1", [PASTOR]))!.id as string;
  const signAs = (sql: string, args: unknown[] = []) => adapter.asUser(pastorId, (run) => run(sql, args));

  const browser = await launch();
  /** Each page in a clean browser profile, as a person arriving for the first time. */
  const as = async (email: string, path: string, then: (page: Page) => Promise<void>) => {
    const { ctx, page } = await newPage(browser, "phone");
    try {
      await signIn(page, email, path);
      await then(page);
    } finally {
      await ctx.close();
    }
  };

  // Journeys 22 to 25 sign cards off, and they share this database. The cards are put back to the state a new project finds them in (drafts), so
  // the pastor's first look at them is read as it is on the first day. A goal a sign-off created stays, switched on, and is found again by its slug
  // when the card is signed off for the second time, which is how a card edited after sign-off already works.
  await q.query(
    `update public.tribe_card_templates t
        set season_goal_id = case when exists (select 1 from public.event_log e where e.action = 'card_template.signed_off' and e.entity_id = t.slug
                                                  and e.meta->>'new_goal' = 'true') then null else t.season_goal_id end,
            status = 'draft', signed_off_by = null, signed_off_at = null
      where t.status = 'signed_off'`,
  );

  // ---- The ready-made cards, read and asked about, before any is signed off ------------------------------------------------------------
  await section("The ready-made cards, as the pastor reads them on a phone", async () => {
    const first = (await one(
      `select c.slug, c.id from public.communities c
        where c.active and exists (select 1 from public.tribe_card_templates t where t.community_id = c.id and not t.sensitive and t.season_goal_id is null)
        order by c.sort, c.name limit 1`,
    ))!;
    const sens = (await one(
      `select t.slug, t.community_id, c.slug as cslug from public.tribe_card_templates t join public.communities c on c.id = t.community_id
        where t.sensitive and c.active order by c.sort, t.sort limit 1`,
    ))!;
    const one1 = (await one("select slug from public.tribe_card_templates where community_id = $1 and not sensitive order by sort limit 1", [first.id]))!;
    await as(PASTOR, "/review/templates", async (page) => {
      await page.getByTestId("template-board").waitFor({ timeout: 20000 });
      await sweep(page, "ready-made cards: the board");
      const box = page.getByTestId(`community-${first.slug}`);
      await box.getByRole("button", { name: /^Sign off the \d+ waiting$/ }).click();
      await page.getByTestId(`ask-${first.slug}`).waitFor();
      await sweep(page, "ready-made cards: asked before signing off a community");
      await page.getByTestId(`ask-${first.slug}`).getByRole("button", { name: "Not yet" }).click();
      await box.getByRole("button", { name: /^Read the \d+ cards$/ }).click();
      const row = page.getByTestId(`row-${one1.slug}`);
      await row.waitFor();
      await sweep(page, "ready-made cards: a community's cards");
      await row.getByRole("button", { name: "Open" }).click();
      const editor = page.getByTestId(`template-${one1.slug}`);
      await editor.waitFor();
      await sweep(page, "ready-made cards: one card open");
      await editor.getByRole("button", { name: "Sign off", exact: true }).click();
      await editor.getByRole("button", { name: "Yes, sign off" }).waitFor();
      await sweep(page, "ready-made cards: asked before signing off one card");

      const sensBox = page.getByTestId(`community-${sens.cslug}`);
      await sensBox.getByRole("button", { name: /^Read the \d+ cards$/ }).click();
      await page.getByTestId(`row-${sens.slug}`).getByRole("button", { name: "Open" }).click();
      const sensEditor = page.getByTestId(`template-${sens.slug}`);
      await sensEditor.waitFor();
      await sensEditor.getByRole("button", { name: "Sign off", exact: true }).click();
      await sensEditor.getByLabel(/I have read this card, and it is right for a sensitive subject/).waitFor();
      await sweep(page, "ready-made cards: a sensitive card, asked to be read first");
    });
    check((await n("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'")) === 0, "nothing was signed off by looking");
  });

  // All 100 cards signed off through the real functions, community by community and the sensitive ones one at a time
  for (const c of await all("select id from public.communities where active order by sort")) await signAs("select public.card_template_sign_off_community($1)", [c.id]);
  for (const s of await all("select slug from public.tribe_card_templates where status = 'draft' and sensitive order by slug")) await signAs("select public.card_template_sign_off($1)", [s.slug]);
  check((await n("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'")) === 100, "all 100 cards are signed off");
  await signAs("select public.leader_fit_model_activate('lf-1')");

  // ---- Apply, under Full process --------------------------------------------------------------------------------------------------
  await section("Apply, under Full process", async () => {
    await setPositions(adapter, {});
    const ife = await kit.person(undefined, "Ife");
    await as(ife.email, "/lead/apply", async (page) => {
      await heading(page, /Lead a tribe/).waitFor({ timeout: 20000 });
      await sweep(page, "apply, Full process: the first screen");
      await choice(page, "consent-leader", "yes").click();
      await next(page, "I agree, start my application", /seven quick questions/);
      await sweep(page, "apply, Full process: the questions");
    });
  });

  // ---- Apply, under the Open door -------------------------------------------------------------------------------------------------
  await section("Apply, under the Open door", async () => {
    await setPositions(adapter, OPEN_DOOR);
    const tobi = await kit.person(undefined, "Tobi");
    await as(tobi.email, "/lead/apply", async (page) => {
      await heading(page, /Lead a tribe/).waitFor({ timeout: 20000 });
      await sweep(page, "apply, Open door: the first screen");
      await choice(page, "consent-leader", "yes").click();
      await next(page, "I agree, start my application", /four quick questions/);
      await sweep(page, "apply, Open door: the questions");
    });
  });

  // ---- Find your tribe ------------------------------------------------------------------------------------------------------------
  const kayode = await kit.person(undefined, "Kayode");
  await setPositions(adapter, OPEN_DOOR);
  await q.query("update public.leader_pipeline_settings set tribe_fit = 'on'");
  const kayodeApp = await kit.startDraft(kayode.id, answers(FOUR), "review");
  await section("Find your tribe, on a phone", async () => {
    await as(kayode.email, "/lead/apply", async (page) => {
      await page.getByRole("button", { name: "Send my application" }).waitFor({ timeout: 20000 });
      await sweep(page, "apply: the review before sending");
      await page.getByRole("button", { name: "Send my application" }).click();
      await heading(page, "Find your tribe").waitFor({ timeout: 25000 });
      const best = page.getByRole("radiogroup", { name: "Your best matches" });
      await best.waitFor({ timeout: 25000 });
      await sweep(page, "Find your tribe: her best matches");
      await best.locator("label.choice").first().click();
      await sweep(page, "Find your tribe: one chosen");
      const sections = page.locator("details");
      for (let i = 0; i < (await sections.count()); i++) await sections.nth(i).evaluate((d) => ((d as HTMLDetailsElement).open = true));
      await page.locator('input[name="fitBackup"]:not(:disabled)').first().check();
      await sweep(page, "Find your tribe: every community open, one backup named");
      await next(page, /^Continue$/, "Here is your application.");
      await sweep(page, "apply: the review after choosing a tribe");
      await page.getByRole("button", { name: "Send my application" }).click();
      await heading(page, /^Sent, Kayode/).waitFor({ timeout: 30000 });
      await sweep(page, "apply: sent");
    });
  });

  // ---- The pastor's review and decision -------------------------------------------------------------------------------------------
  await section("The pastor's review and decision, on a phone", async () => {
    await kit.review(staff.coach.id, kayodeApp, "calling", 5);
    await kit.review(staff.scorer.id, kayodeApp, "calling", 5);
    await as(PASTOR, "/review", async (page) => {
      await heading(page, "Review leaders").waitFor({ timeout: 20000 });
      await sweep(page, "review: the list");
    });
    await as(staff.pastor.email, `/review/${kayodeApp}`, async (page) => {
      await heading(page, "Leader Readiness Score").waitFor({ timeout: 20000 });
      await page.getByTestId("tribe-fit").waitFor({ timeout: 20000 });
      await sweep(page, "review: the application with the Tribe fit panel");
      await page.locator('label.choice:has(input[value="leader"])').click();
      await page.getByTestId("thinner-evidence").waitFor({ timeout: 10000 });
      await page.getByLabel("Why you are comfortable approving on it").fill("Two scorers agree and the open door was a decision of the pastorate.");
      await sweep(page, "review: the decision with a reduced-evidence reason");
      await page.getByRole("button", { name: "Record decision" }).click();
      await page.getByRole("button", { name: "Yes, record it" }).waitFor();
      await sweep(page, "review: asked to confirm the decision");
      await page.getByRole("button", { name: "Yes, record it" }).click();
      await eventually("the decision is recorded", async () => (await one("select status from public.leader_applications where id = $1", [kayodeApp]))?.status === "approved_leader");
      await sweep(page, "review: the decision, recorded");
    });
  });

  // ---- The Academy and the declaration under each position -------------------------------------------------------------------------
  const positions = (academy: "required" | "optional" | "off", declaration: "required" | "off") => setPositions(adapter, { ...OPEN_DOOR, academy, declaration });
  await section("The Academy, under Required", async () => {
    const lola = (await kit.walk({ ...OPEN_DOOR, academy: "required", declaration: "required" }, { staff })).user;
    await as(lola.email, "/lead", async (page) => {
      await page.getByText("Welcome. Leader training is next.").waitFor({ timeout: 20000 });
      await sweep(page, "Lead page, Academy required");
      await open(page, "/lead/academy");
      await page.getByTestId("cert-modules").waitFor({ timeout: 20000 });
      await sweep(page, "the Academy, required");
      await open(page, "/lead/academy/declaration");
      await heading(page, /declaration/i).waitFor({ timeout: 20000 });
      await sweep(page, "the declaration, with the Academy required");
    });
  });
  await section("The Academy, under Optional", async () => {
    const dayo = (await kit.walk({ ...OPEN_DOOR, academy: "optional", declaration: "off" }, { staff })).user;
    await as(dayo.email, "/lead/academy", async (page) => {
      await page.getByTestId("academy-optional-note").waitFor({ timeout: 20000 });
      await sweep(page, "the Academy, optional");
    });
  });
  await section("The Academy off and the declaration alone", async () => {
    const bola = (await kit.walk({ ...OPEN_DOOR, academy: "off", declaration: "required" }, { staff })).user;
    await as(bola.email, "/lead", async (page) => {
      await page.getByText("Welcome. A short safeguarding declaration is next.").waitFor({ timeout: 20000 });
      await sweep(page, "Lead page, declaration only");
      await open(page, "/lead/academy");
      await page.getByTestId("academy-off").waitFor({ timeout: 20000 });
      await sweep(page, "the Academy, switched off");
      await open(page, "/lead/academy/care-and-safeguarding");
      await page.getByText("The modules are closed for now").waitFor({ timeout: 20000 });
      await sweep(page, "a module, closed while the Academy is off");
      await open(page, "/lead/academy/declaration");
      await page.getByRole("button", { name: "Sign the declaration" }).waitFor({ timeout: 20000 });
      await sweep(page, "the declaration, alone");
      await page.locator('label:has(input[type="checkbox"])').click();
      await page.getByLabel("Type your first and last name to sign").fill("Bola Test");
      await sweep(page, "the declaration, ready to sign");
      await page.getByRole("button", { name: "Sign the declaration" }).click();
      await page.getByRole("heading", { name: "Signed. Thank you." }).waitFor({ timeout: 20000 });
      await sweep(page, "the declaration, signed");
    });
    await as(PASTOR, "/review/academy", async (page) => {
      await page.getByTestId("academy-off").waitFor({ timeout: 20000 });
      await sweep(page, "review: the Academy page, Academy off");
    });
  });
  await section("Both off", async () => {
    await positions("off", "off");
    const chidi = await kit.person("leader", "Chidi");
    await q.query("insert into public.leader_applications (person_id, status, answers, consent_version, decided_at, submitted_at) values ($1, 'approved_leader', $2::jsonb, '2026-10-v1', now(), now())", [chidi.id, JSON.stringify(answers(FOUR))]);
    await as(chidi.email, "/lead", async (page) => {
      await page.getByText("Welcome. Your Tribe Card is next.").waitFor({ timeout: 20000 });
      await sweep(page, "Lead page, nothing but the Tribe Card");
      await open(page, "/lead/academy/declaration");
      await page.getByTestId("declaration-off").waitFor({ timeout: 20000 });
      await sweep(page, "the declaration, switched off");
    });
  });

  // ---- A leader starting from the ready-made card ----------------------------------------------------------------------------------
  await section("A leader starting from the ready-made card", async () => {
    await setPositions(adapter, {});
    const k = await makeKit(adapter);
    const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const made = await k.tribe(S, { status: "draft", name: "Ready-made tribe" });
    const signedCard = (await one("select season_goal_id, community_id from public.tribe_card_templates where status = 'signed_off' and not sensitive and season_goal_id is not null order by slug limit 1"))!;
    await q.query("update public.tribes set season_goal_id = $2, community_id = $3, loving_god = '', loving_others = '', loving_life = '' where id = $1", [made.tribe, signedCard.season_goal_id, signedCard.community_id]);
    await as(made.leader.email, "/lead/tribe", async (page) => {
      const panel = page.getByTestId("ready-made");
      await panel.waitFor({ timeout: 20000 });
      await sweep(page, "Tribe Card: the ready-made card offered");
      await panel.getByRole("button", { name: "Start from the ready-made card" }).click();
      await eventually("the three lines are filled", async () => {
        const t = (await one("select loving_god, loving_others, loving_life from public.tribes where id = $1", [made.tribe]))!;
        return String(t.loving_god).length > 10 && String(t.loving_others).length > 10 && String(t.loving_life).length > 10;
      });
      await sweep(page, "Tribe Card: started from the ready-made card");
    });
  });

  // ---- The member's goal choice, in every community, with all 100 goals signed off --------------------------------------------------
  await section("The member's goal choice, in every community", async () => {
    await setPositions(adapter, {});
    const member = await kit.person(undefined, "Wale");
    const communities = await all(
      "select c.slug, c.name, (select count(*)::int from public.season_goals g where g.community_id = c.id and g.active) as goals from public.communities c where c.active order by c.sort, c.name",
    );
    check(communities.length >= 10, `there are ${communities.length} communities to choose from`);
    check(communities.reduce((s, c) => s + Number(c.goals), 0) === 100, "…and 100 goals between them");
    await as(member.email, "/join", async (page) => {
      await heading(page, "Let’s find your tribe.").waitFor({ timeout: 20000 });
      await sweep(page, "member: the welcome screen");
      await choice(page, "consent-matching", "yes").click();
      await choice(page, "consent-ai", "yes").click();
      await next(page, "I agree, let’s begin", "How old are you?");
      await choice(page, "age", "33-40").click();
      await next(page, "Continue", "What should we call you?");
      await page.getByLabel("First name or what you go by").fill("Wale");
      await page.getByLabel("Full name").fill("Wale Test");
      await next(page, "Continue", "Which describes you?");
      await choice(page, "gender", "male").click();
      await choice(page, "tribeMix", "mixed").click();
      await next(page, "Continue", "Where are you based?");
      const area = page.getByRole("combobox");
      await area.fill("Yab");
      await page.getByRole("option", { name: /Yaba/ }).click();
      await next(page, "Continue", "Tell us about your season.");
      await page.locator("textarea[name=story]").fill("I want to grow in my faith and find people to walk with.");
      // The steps after the story ("what we heard") may be skipped when they hold nothing, and the button then says so
      const onward = page.getByRole("button", { name: /^(Continue|Skip for now)$/ });
      await onward.click();
      for (let i = 0; i < 6 && !(await heading(page, "Which community feels like home right now?").isVisible().catch(() => false)); i++) {
        await page.waitForTimeout(800);
        await onward.click({ timeout: 4000 }).catch(() => {});
      }
      await heading(page, "Which community feels like home right now?").waitFor({ timeout: 20000 });
      await sweep(page, "member: the community step");

      for (const c of communities) {
        await choice(page, "community", String(c.slug)).click();
        await heading(page, "A second choice?").waitFor({ timeout: 8000 });
        const go = page.getByRole("button", { name: "Continue" });
        if (await go.isDisabled()) await page.locator('[role=group][aria-labelledby="second-heading"] button').first().click();
        await next(page, "Continue", "Where are you on your walk with God?");
        await choice(page, "faith", "growing").click();
        await next(page, "Continue", "What do you want to move forward this season?");
        await page.locator('input[name="goal"]').first().waitFor({ timeout: 15000 });
        const shown = await page.locator('input[name="goal"]').count();
        // the goals of the community, and the one "something else" choice
        check(shown === Number(c.goals) + 1, `${c.name}: all ${c.goals} goals are offered (${shown - 1})`);
        await sweep(page, `member: goals in ${c.name}`);
        // Goal, then the faith step, then the community step again (the second choice sits on the same screen)
        for (let b = 0; b < 2; b++) await page.getByRole("button", { name: "Back" }).click();
        await heading(page, "Which community feels like home right now?").waitFor({ timeout: 15000 });
      }
    });
  });

  // ---- The leader supply board, an offer, accepted -----------------------------------------------------------------------------------
  await section("The leader supply board and an offer", async () => {
    await setPositions(adapter, OPEN_DOOR);
    const S = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1"))!.id as string;
    const g = (await one(
      `select g.id, g.slug, g.title, c.slug as community, c.id as community_id, t.track_slugs as tracks
         from public.season_goals g join public.communities c on c.id = g.community_id and c.active
         join public.tribe_card_templates t on t.season_goal_id = g.id and t.status = 'signed_off' and not t.sensitive
        where g.active and not exists (select 1 from public.goal_demand_rows($1) d where d.goal_id = g.id and (d.waiting > 0 or d.seats_open > 0))
        order by g.slug limit 1`,
      [S],
    ))!;
    for (const name of ["Adaeze", "Bayo", "Chinwe", "Dele", "Efe"]) {
      const u = await adapter.createUser();
      await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Waiting`, name]);
      await q.query("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) values ($1, $2, $3, $4, 'any', 0)", [u.id, S, g.id, g.community_id]);
    }
    const tracks = g.tracks as string[];
    const target = await kit.person("leader", "Folake");
    await q.query(
      "insert into public.leader_applications (person_id, status, answers, consent_version, decided_at, submitted_at) values ($1, 'approved_leader', $2::jsonb, '2026-10-v1', now(), now())",
      [target.id, JSON.stringify(answers(FOUR, { calling: calling({ track: tracks[0], community: g.community, goal: g.slug, goalRelation: "achieved" }) }))],
    );
    await as(PASTOR, "/admin/leader-supply", async (page) => {
      await page.getByTestId("leader-board").waitFor({ timeout: 20000 });
      await sweep(page, "the leader supply board");
      await page.getByTestId(`suggest-${g.id}`).click();
      await page.getByTestId(`suggestions-${g.id}`).waitFor({ timeout: 25000 });
      await sweep(page, "the board: leaders suggested");
      const card = page.getByTestId(`suggestion-${target.id}`);
      if ((await card.count()) === 0) throw new Error("the leader we made was not suggested, so the offer cannot be looked at");
      await card.getByTestId(`offer-${target.id}`).click();
      await card.getByText(/Send the offer to/).waitFor();
      await sweep(page, "the board: asked before an offer is sent");
      await card.getByTestId(`confirm-offer-${target.id}`).click();
      await page.getByText(/Offer sent to/).waitFor({ timeout: 15000 });
      await sweep(page, "the board: an offer sent");
    });
    await as(String(target.email), "/lead", async (page) => {
      await page.getByTestId("leader-offer").waitFor({ timeout: 20000 });
      await sweep(page, "a leader's offer");
      await page.getByTestId("offer-accept").click();
      await page.waitForURL(/\/lead\/tribe/, { timeout: 20000 });
      await page.getByRole("heading", { name: "Your Tribe Card" }).first().waitFor({ timeout: 20000 });
      await sweep(page, "the Tribe Card after accepting an offer");
    });
  });

  // ---- The pipeline page: a director, a pastor, a member -----------------------------------------------------------------------------
  await section("The pipeline page, by who is looking", async () => {
    await setPositions(adapter, {});
    await as("director.bola@example.org", "/admin/leader-pipeline", async (page) => {
      await page.getByTestId("pipeline-switchboard").waitFor({ timeout: 20000 });
      await sweep(page, "pipeline: a director, who can change it");
    });
    await as(PASTOR, "/admin/leader-pipeline", async (page) => {
      await page.getByTestId("pipeline-switchboard").waitFor({ timeout: 20000 });
      check(await page.getByTestId("pipeline-readonly").isVisible(), "a pastor is told the page is theirs to read");
      check((await page.locator('input[type="radio"]').count()) === 0, "…with nothing to move");
      await sweep(page, "pipeline: a pastor, read only");
    });
    await as("member@example.org", "/admin/leader-pipeline", async (page) => {
      await open(page, "/admin/leader-pipeline");
      check((await page.getByTestId("pipeline-switchboard").count()) === 0, "a member is turned away");
      await sweep(page, "pipeline: a member, turned away");
    });
    await as(PASTOR, "/admin", async (page) => {
      await open(page, "/admin");
      check((await text(page)).includes("Leader supply"), "the Admin page lists Leader supply");
      await sweep(page, "the Admin page");
    });
  });

  await browser.close();
  await q.end();

  // What was found, page by page, for anyone reading the log
  const bad = Object.entries(found).filter(([, f]) => f.cutOff.length || f.small.length);
  console.log(`\n${Object.keys(found).length} pages swept; ${bad.length} with something to look at.`);
  finish("27-browser-pass");
}

main().catch((e) => {
  console.log("  ✗ " + (e instanceof Error ? e.stack : String(e)));
  process.exit(1);
});

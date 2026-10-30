/**
 * The "How to use this app" button, for every kind of person, in a browser.
 *
 *  - It is on the screen for a visitor on the sign-in page and for a member, a leader, an assistant leader, a pastor, a director, a coach, a care lead and an
 *    admin on their Home page, and it is not on the guides themselves.
 *  - To someone who has never pressed it, it pulses (data-pulse "strong") and, on their Home page only, a bubble offers to show them around. The bubble is
 *    never on the sign-in page or any other page. Putting the bubble away leaves the button pulsing. Pressing the button settles it on a page with no guide of its own, and it stays settled after a reload. "Stop the pulse" makes it still for good.
 *  - On a phone it never sits on the menu at the bottom, and nothing scrolls sideways with the sheet open, on a phone or a computer.
 *  - The sheet offers each person only guides they may open: pressing the first one under "Start here" opens a real guide, never "for someone else".
 *  - On a page that has a guide it names that guide for the person's own role (a leader and an assistant leader, on the same page, are offered different
 *    ones), lists the buttons on the page that the guide names, and points at one with a ring that goes when Escape is pressed.
 *  - The one-minute tour walks the menu with a ring on each place and a word about it, can be taken back, and is remembered.
 *  - The search finds guides by plain words, finds nothing for nonsense, and never offers a member a leader's guide.
 *  - With "reduce motion" on, nothing animates.
 *  - On the full-screen forms (Find your tribe, the leader application) the button is a small round one in the form's own header: part of the page, not floating
 *    over it, so it cannot cover a question or the Continue bar; its sheet opens, and typing in its search never moves the form on.
 *
 * Everything a person does is done in the browser. Set E2E_SHOTS=1 to keep a picture of each screen in .e2e/shots.
 */
import fs from "node:fs";
import type { Page } from "playwright-core";
import { check, finish, launch, newPage, noOverflow, open, signIn } from "../lib";

const shot = async (page: Page, name: string) => {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(".e2e/shots", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.e2e/shots/${name}.png` });
};

const PEOPLE: [string, string][] = [
  ["a member", "member@example.org"],
  ["a tribe leader", "ngozi@example.org"],
  ["an assistant leader", "kemi@example.org"],
  ["a pastor", "pastor.ife@example.org"],
  ["a director", "director.bola@example.org"],
  ["a coach", "coach.sade@example.org"],
  ["a care lead", "care_lead.dayo@example.org"],
  ["an admin", "admin.mary@example.org"],
];

const button = (page: Page) => page.getByTestId("howto-button");
const pulseOf = async (page: Page) => button(page).getAttribute("data-pulse");

/** The button has been drawn by the browser, not just served: it knows what it is showing. */
async function ready(page: Page) {
  await button(page).waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("[data-testid='howto-button']")?.getAttribute("data-pulse") !== null, undefined, { timeout: 10000 });
  await page.waitForTimeout(250);
}

const sheet = (page: Page) => page.getByTestId("howto-sheet");
async function openSheet(page: Page) {
  await button(page).click();
  await sheet(page).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "How to use this app" }).waitFor({ timeout: 5000 });
}
async function closeSheet(page: Page) {
  await page.getByTestId("howto-close").click();
  await sheet(page).waitFor({ state: "hidden", timeout: 5000 });
}

/** Whether two boxes cover any of the same screen. */
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function main() {
  const browser = await launch();
  try {
    // --- 1. a visitor ---------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await open(page, "/sign-in");
      await ready(page);
      check(await button(page).isVisible(), "a visitor on the sign-in page is shown the button");
      check((await button(page).innerText()).includes("How to use this app"), "…and it says what it is for");
      await openSheet(page);
      const sign = page.getByTestId("howto-main");
      check((await sign.getAttribute("href"))?.startsWith("/guides/sign-in") === true, "…and offers the guide to signing in, on that page");
      check((await page.getByTestId("howto-start").locator("a").count()) >= 1, "…and a few guides that anyone can open");
      for (const href of await page.getByTestId("howto-start").locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
        check(!/run-your-week|whatsapp-health|decide-a-place|ask-about-a-place/.test(href ?? ""), `…never one for a role they do not have (${href})`);
      }
      await noOverflow(page, "the sheet for a visitor on a phone");
      await shot(page, "43-visitor-sheet");
      await closeSheet(page);
      await page.waitForTimeout(1800);
      check((await page.getByTestId("howto-bubble").count()) === 0, "…and no welcome bubble is put in front of someone trying to sign in");
      await ctx.close();
    }

    // --- 2. every kind of person, on a phone ------------------------------------------------------------------------------------------
    for (const [who, email] of PEOPLE) {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, email, "/home");
      await open(page, "/home");
      await ready(page);
      check(await button(page).isVisible(), `${who} is shown the button on their Home page`);
      check((await pulseOf(page)) === "strong", `…it pulses for ${who} who has never pressed it`);
      check((await button(page).getAttribute("data-new")) === "true", `…and shows its words, not just its mark`);
      if (email === "member@example.org") await shot(page, "43-pulse-member");

      // never on the menu at the bottom
      const b = (await button(page).boundingBox())!;
      const viewport = page.viewportSize()!;
      check(b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height, `…it is wholly on the screen`);
      const bars = await page.locator("nav[aria-label='Main']").evaluateAll((els) =>
        els.map((e) => ({ r: e.getBoundingClientRect(), fixed: getComputedStyle(e).position === "fixed" })).filter((x) => x.fixed && x.r.height > 0).map((x) => ({ x: x.r.x, y: x.r.y, width: x.r.width, height: x.r.height })),
      );
      for (const bar of bars) check(!overlaps(b, bar), `…and it never sits on the menu`);

      // the welcome bubble waits a moment, then offers to show around; putting it away leaves the button as it was
      await page.getByTestId("howto-bubble").waitFor({ timeout: 8000 });
      check(true, `…a bubble offers ${who} a tour`);
      await page.getByTestId("howto-bubble-no").click();
      await page.getByTestId("howto-bubble").waitFor({ state: "detached", timeout: 3000 });
      check((await pulseOf(page)) === "strong", `…putting the bubble away leaves the button pulsing`);

      // the sheet
      await openSheet(page);
      const starts = page.getByTestId("howto-start").locator("a");
      check((await starts.count()) >= 1, `…the sheet gives ${who} somewhere to start`);
      check(await page.getByTestId("howto-search").isVisible(), `…and a way to search`);
      await noOverflow(page, `the sheet for ${who} on a phone`);
      await page.waitForTimeout(500); // the sheet rises into place
      const sh = (await page.locator(".hp-panel").boundingBox())!;
      check(sh.y >= 0 && sh.y + sh.height <= viewport.height + 1, `…and the sheet fits the screen`);
      const first = (await starts.first().getAttribute("href"))!;
      await shot(page, `43-sheet-${email.split("@")[0]}`);

      // the first guide offered really opens for this person (the Tribe Card guide is a page of its own that the church serves outside this app, so it is only checked for being offered)
      if (first === "/tutorial") {
        check(/Tribe Card/.test(await starts.first().innerText()), `…and the first thing offered to ${who} is the Tribe Card guide`);
      } else {
        await starts.first().click();
        await page.waitForURL((u) => u.pathname === first.split("#")[0], { timeout: 15000 });
        const heading = await page.getByRole("heading", { level: 1 }).first().innerText();
        const fine = !/for someone else/i.test(heading) && !/can.t find that page/i.test(heading);
        check(fine, `…and the first guide offered opens for ${who} (${first})`);
        if (!fine) console.log(`    the page said: ${heading}`);
        check((await page.getByTestId("howto-button").count()) === 0, `…and the button keeps out of the way of the guides themselves`);
      }

      // back home: settled, and still settled after a reload
      await open(page, "/home");
      await ready(page);
      check((await pulseOf(page)) === "still", `…having pressed it, ${who} finds it settled on a page with no guide`);
      await page.reload();
      await ready(page);
      check((await pulseOf(page)) === "still", `…and it stays settled after a reload`);
      check((await button(page).getAttribute("data-new")) === "false", `…and shrinks to its mark`);
      await ctx.close();
    }

    // --- 3. the page's own guide, and pointing at the real buttons -------------------------------------------------------------------------
    {
      const pageGuide = async (email: string, path: string) => {
        const { ctx, page } = await newPage(browser, "phone");
        await signIn(page, email, path);
        await open(page, path);
        await ready(page);
        await openSheet(page);
        const main = page.getByTestId("howto-main");
        const href = (await main.count()) ? ((await main.first().getAttribute("href")) ?? "").split("#")[0] : null;
        return { ctx, page, href };
      };

      const leader = await pageGuide("ngozi@example.org", "/lead/week");
      check(leader.href === "/guides/run-your-week", "a leader on This week is offered the guide to running the week");
      await leader.ctx.close();

      // The member’s own information page always has the buttons its guide names
      const mine = await pageGuide("member@example.org", "/profile");
      check(mine.href === "/guides/your-information", "a member on their own information page is offered the guide to it");
      const chips = mine.page.getByTestId("howto-chip");
      await chips.first().waitFor({ timeout: 8000 });
      check((await chips.count()) >= 1, "…and a list of the buttons on that page that the guide names");
      const label = (await chips.first().innerText()).trim();
      await chips.first().click();
      await mine.page.getByTestId("howto-point").waitFor({ timeout: 5000 });
      check(true, `…pressing “${label}” rings that button on the page`);
      const ring = (await mine.page.getByTestId("howto-point").boundingBox())!;
      check(ring.width > 20 && ring.height > 20, "…the ring has a size");
      await shot(mine.page, "43-pointing");
      await mine.page.keyboard.press("Escape");
      await mine.page.getByTestId("howto-point").waitFor({ state: "detached", timeout: 3000 });
      check(true, "…and Escape puts it away");
      await mine.ctx.close();

      const assistant = await pageGuide("kemi@example.org", "/lead/week");
      check(assistant.href === "/guides/assistant-leader", "an assistant leader, on the same page, is offered their own guide");
      await assistant.ctx.close();

      const member = await pageGuide("member@example.org", "/lead/week");
      check(member.href === null, "a member is never offered a leader’s guide");
      check(await member.page.getByTestId("howto-noguide").isVisible(), "…the sheet says plainly that this page has no guide yet");
      check(await member.page.getByTestId("howto-tour-start").isVisible(), "…and still offers the tour");
      await member.ctx.close();

      const admin = await pageGuide("admin.mary@example.org", "/admin/messages");
      check(admin.href === "/guides/whatsapp-health", "an admin on the Message log is offered the guide to WhatsApp");
      await admin.ctx.close();

      const coach = await pageGuide("coach.sade@example.org", "/growth/removals");
      check(coach.href === "/guides/decide-a-place-change", "a coach on the requests about a member’s place is offered the guide to deciding them");
      await coach.ctx.close();

    }

    // --- 4. the tour --------------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "member@example.org", "/home");
      await open(page, "/home");
      await ready(page);
      await page.getByTestId("howto-bubble").waitFor({ timeout: 8000 });
      await page.getByTestId("howto-bubble-yes").click();
      const tour = page.getByTestId("howto-tour");
      await tour.waitFor({ timeout: 5000 });
      const total = Number(/of (\d+)/i.exec(await tour.innerText())?.[1] ?? 0);
      check(total >= 2, `“Show me around” starts the tour of the menu (${total} places)`);
      check((await page.getByTestId("howto-button").count()) === 0, "…and the button steps aside while it runs");
      check(/^1 of/i.test((await tour.innerText()).trim()), "…beginning at the first place");
      await page.getByTestId("howto-point").waitFor({ timeout: 3000 });
      check(true, "…a ring sits on that place in the menu");
      check(await page.getByTestId("howto-tour-back").isDisabled(), "…Back is off at the start");
      await shot(page, "43-tour");
      await page.getByTestId("howto-tour-next").click();
      await page.waitForFunction(() => /^2 of/i.test(document.querySelector("[data-testid='howto-tour']")?.textContent?.trim() ?? ""), undefined, { timeout: 3000 });
      check(true, "Next moves to the second place");
      await page.getByTestId("howto-tour-back").click();
      await page.waitForFunction(() => /^1 of/i.test(document.querySelector("[data-testid='howto-tour']")?.textContent?.trim() ?? ""), undefined, { timeout: 3000 });
      check(true, "…and Back moves back");
      for (let i = 1; i < total; i++) await page.getByTestId("howto-tour-next").click();
      check(((await page.getByTestId("howto-tour-next").innerText()) ?? "").trim() === "Done", "…the last place says Done");
      await page.getByTestId("howto-tour-next").click();
      await tour.waitFor({ state: "detached", timeout: 3000 });
      await page.getByTestId("howto-point").waitFor({ state: "detached", timeout: 3000 });
      check((await button(page).count()) === 1, "…and finishing brings the button back, with no ring left behind");
      await page.reload();
      await ready(page);
      await page.waitForTimeout(2200);
      check((await page.getByTestId("howto-bubble").count()) === 0, "…and the tour is not offered again after a reload");

      // Escape stops it part-way
      await openSheet(page);
      await page.getByTestId("howto-tour-start").click();
      await tour.waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await tour.waitFor({ state: "detached", timeout: 3000 });
      check(true, "Escape stops the tour part-way");
      await ctx.close();
    }

    // --- 5. the search ------------------------------------------------------------------------------------------------------------------
    {
      const search = async (page: Page, words: string): Promise<string[]> => {
        const box = page.getByTestId("howto-search");
        await box.fill("");
        await box.fill(words);
        await page.waitForFunction(
          () => !!document.querySelector("[data-testid='howto-results'], [data-testid='howto-nothing']"),
          undefined,
          { timeout: 8000 },
        );
        return page.getByTestId("howto-results").locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
      };

      const m = await newPage(browser, "phone");
      await signIn(m.page, "member@example.org", "/home");
      await open(m.page, "/home");
      await ready(m.page);
      await openSheet(m.page);
      const testimony = await search(m.page, "testimony");
      check(testimony[0] === "/guides/share-a-testimony", "a member who types “testimony” is offered the guide to sharing one");
      await shot(m.page, "43-search");
      const nonsense = await search(m.page, "zzzzqx qqqq").catch((): string[] => []);
      check(nonsense.length === 0 && (await m.page.getByTestId("howto-nothing").isVisible()), "…and told, kindly, when nothing matches");
      const week = await search(m.page, "run your week").catch((): string[] => []);
      check(!week.includes("/guides/run-your-week"), "…and never offered a leader’s guide");
      await m.ctx.close();

      const l = await newPage(browser, "phone");
      await signIn(l.page, "ngozi@example.org", "/home");
      await open(l.page, "/home");
      await ready(l.page);
      await openSheet(l.page);
      const card = await search(l.page, "tribe card");
      check(card.includes("/tutorial"), "a leader who types “tribe card” is offered the Tribe Card guide");
      await l.ctx.close();

      const a = await newPage(browser, "phone");
      await signIn(a.page, "admin.mary@example.org", "/home");
      await open(a.page, "/home");
      await ready(a.page);
      await openSheet(a.page);
      const wa = await search(a.page, "whatsapp health");
      check(wa[0] === "/guides/whatsapp-health", "an admin who types “whatsapp health” is offered the guide to it");
      await a.ctx.close();
    }

    // --- 6. stopping the pulse, and a page whose guide has not been looked at ------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "member@example.org", "/profile");
      await open(page, "/profile");
      await ready(page);
      await openSheet(page);
      await closeSheet(page);
      check((await pulseOf(page)) === "still", "having opened the sheet on a page with a guide, the button settles there");
      await open(page, "/tribe");
      await ready(page);
      check((await pulseOf(page)) === "soft", "…and pulses softly on another page whose guide has not been looked at");
      await openSheet(page);
      await page.getByTestId("howto-quiet").click();
      await closeSheet(page);
      check((await pulseOf(page)) === "still", "“Stop the pulse” makes it still");
      await open(page, "/join");
      await ready(page);
      check((await pulseOf(page)) === "still", "…on every page, not just this one");
      await page.reload();
      await ready(page);
      check((await pulseOf(page)) === "still", "…and after a reload");
      await openSheet(page);
      check(/pulse again/i.test(await page.getByTestId("howto-quiet").innerText()), "…and the sheet offers to let it pulse again");
      await ctx.close();
    }

    // --- 7. reduce motion ---------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page, "member@example.org", "/home");
      await open(page, "/home");
      await ready(page);
      check((await pulseOf(page)) === "strong", "with reduce motion on, the button is still marked as new");
      const names = await page.evaluate(() => {
        const el = document.querySelector("[data-testid='howto-button']")!;
        return [getComputedStyle(el, "::before").animationName, getComputedStyle(el, "::after").animationName, getComputedStyle(el).animationName];
      });
      check(names.every((n) => n === "none"), `…and nothing on it animates (${names.join(", ")})`);
      await ctx.close();
    }

    // --- 8. a computer ------------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "desktop");
      await signIn(page, "ngozi@example.org", "/lead/week");
      await open(page, "/lead/week");
      await ready(page);
      const vp = page.viewportSize()!;
      const b = (await button(page).boundingBox())!;
      check(b.x + b.width <= vp.width && b.y + b.height <= vp.height && b.x > vp.width / 2, "on a computer the button sits at the bottom right, on the screen");
      await openSheet(page);
      await page.waitForTimeout(500);
      const panel = (await page.locator(".hp-panel").boundingBox())!;
      check(panel.x + panel.width <= vp.width + 1 && panel.y >= 0 && panel.y + panel.height <= vp.height + 1, "…and the sheet fits the screen");
      check(panel.width <= 560, `…as a panel at the side, not a wall (${Math.round(panel.width)}px)`);
      await noOverflow(page, "the sheet on a computer");
      await shot(page, "43-sheet-desktop");
      await page.keyboard.press("Escape");
      await sheet(page).waitFor({ state: "hidden", timeout: 3000 });
      check(true, "…and Escape closes it");
      await ctx.close();
    }

    // --- 9. the full-screen forms ---------------------------------------------------------------------------------------------------------
    for (const [form, email, path, device] of [
      ["Find your tribe", "member@example.org", "/join", "phone"],
      ["Find your tribe", "member@example.org", "/join", "desktop"],
      ["the leader application", "member@example.org", "/lead/apply", "phone"],
    ] as const) {
      const { ctx, page } = await newPage(browser, device);
      await signIn(page, email, path);
      await open(page, path);
      await ready(page);
      const where = `${form} on a ${device}`;
      const b = (await button(page).boundingBox())!;
      const position = await button(page).evaluate((el) => getComputedStyle(el).position);
      check(position !== "fixed", `${where}: the button is part of the page, not floating over it (${position})`);
      check((await page.locator("header").getByTestId("howto-button").count()) === 1, `…it sits in the form's own header`);
      check(b.y >= 0 && b.y + b.height <= 96, `…at the top of the screen (${Math.round(b.y)}px)`);
      check((await button(page).innerText()).trim().length > 0 && (await button(page).getAttribute("data-inline")) === "true", `…as a small round button with its words kept for a screen reader`);
      check(b.width <= 56 && b.height <= 56, `…no bigger than a thumb (${Math.round(b.width)} × ${Math.round(b.height)})`);
      await page.waitForTimeout(2200);
      check((await page.getByTestId("howto-bubble").count()) === 0, `…and no bubble interrupts the form`);
      await shot(page, `43-form-${device}-${path.replace(/\W/g, "")}`);
      // nothing in the form is covered by it
      const bar = await page.locator("button[type=submit], form button:has-text('Continue'), form button:has-text('Start')").first().boundingBox().catch(() => null);
      if (bar) check(!overlaps(b, bar), `…and it does not touch the Continue bar`);

      await openSheet(page);
      check((await page.locator("form").getByTestId("howto-sheet").count()) === 0, `…its sheet opens outside the form, so its search can never submit the form`);
      const before = page.url();
      await page.getByTestId("howto-search").fill("testimony");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      check(page.url() === before && (await sheet(page).isVisible()), `…pressing Enter in its search leaves the form where it was`);
      if (device === "phone") await noOverflow(page, `the sheet on ${where}`);
      await closeSheet(page);
      check(true, `…and the sheet closes, leaving the form as it was`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  finish("43-howto");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

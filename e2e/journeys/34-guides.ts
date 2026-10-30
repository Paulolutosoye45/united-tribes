/**
 * The How-to Library, for each kind of person, in a browser.
 *
 *  - A visitor sees only the guides open to everyone (signing in, and the three pages people reach from an email). Any other guide sends
 *    them to sign in and brings them back. Its pictures are a plain 404.
 *  - A member sees the member's guides and nothing for leaders. A leader's guide says, politely, that it is for someone else, shows nothing
 *    of what is in it, and its pictures are a plain 404 for them too.
 *  - A tribe leader sees the member's guides and their own, and what their assistant and the people they speak to are shown. An
 *    assistant leader sees their own shelf, and the leader's week as what the leader reads. A pastor sees the member's guides and the
 *    pages people reach from an email.
 *  - The "How to use this app" button takes each person, on the same page, to the guide that is theirs, and offers none on a page with no guide
 *    (journey 43 tries the button itself, for every kind of person).
 *  - A guide opens as a reader: one step at a time, a picture that loads, a way to see every step at once, and nothing that scrolls
 *    sideways on a phone.
 *
 * Set E2E_SHOTS=1 to keep a picture of each screen in .e2e/shots.
 */
import fs from "node:fs";
import type { Page } from "playwright-core";
import { BASE, check, finish, launch, newPage, noOverflow, open, signIn } from "../lib";

async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(".e2e/shots", { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

/** The titles of the guides the library lists, and which shelf each sits on. */
async function library(page: Page): Promise<{ shelves: string[]; titles: string[]; byShelf: Record<string, string[]> }> {
  await page.locator("section[id^='shelf-']").first().waitFor({ timeout: 20000 });
  return page.evaluate(() => {
    const byShelf: Record<string, string[]> = {};
    const shelves: string[] = [];
    for (const s of Array.from(document.querySelectorAll("section[id^='shelf-']"))) {
      const title = s.querySelector("h2")?.textContent?.trim() ?? "";
      shelves.push(title);
      byShelf[title] = Array.from(s.querySelectorAll("a.gd-card h3")).map((h) => h.textContent?.trim() ?? "");
    }
    return { shelves, titles: Object.values(byShelf).flat(), byShelf };
  });
}

const picture = async (page: Page, slug: string, file: string) => (await page.request.get(`${BASE}/guides/p/${slug}/${file}`)).status();

async function main() {
  const browser = await launch();
  try {
    // --- 1. a visitor -------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await open(page, "/guides");
      const lib = await library(page);
      check(lib.titles.includes("Sign in with a code"), "a visitor is offered the guide to signing in");
      for (const t of ["Give a reference", "Give permission for a young person", "You have been placed in a tribe"]) check(lib.titles.includes(t), `…and “${t}”, a page people reach from an email`);
      check(!lib.titles.includes("Run your week") && !lib.titles.includes("Find your tribe: the form"), "…and none of the guides that need an account");
      check(lib.shelves.length === 1, `…all on one shelf (${lib.shelves.join(", ")})`);
      await noOverflow(page, "the library for a visitor on a phone");
      await shot(page, "34-library-visitor-phone");

      await open(page, "/guides/run-your-week");
      check(page.url().includes("/sign-in") && decodeURIComponent(page.url()).includes("next=/guides/run-your-week"), "a guide that needs an account sends a visitor to sign in, and back to it");
      await open(page, "/guides/give-a-reference");
      check(await page.getByRole("heading", { name: "Give a reference" }).first().isVisible(), "a guide open to everyone opens without signing in");
      check((await picture(page, "give-a-reference", "open")) === 200, "…and so do its pictures");
      check((await picture(page, "run-your-week", "top")) === 404, "a picture of a guide that needs an account is a plain 404 for a visitor");
      check((await picture(page, "no-such-guide", "top")) === 404, "…the same 404 as a picture that does not exist");
      await ctx.close();
    }

    // --- 2. a member ----------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "member@example.org", "/guides");
      await open(page, "/guides");
      const lib = await library(page);
      check(lib.titles.includes("Find your tribe: the form") && lib.titles.includes("Sign in with a code"), "a member is offered the member’s guides, with signing in among them");
      check(!lib.titles.some((t) => /Run your week|Assistant leader|Appointed or invited|Your training:|Your tribe’s season/.test(t)), "…and nothing for leaders");
      check(!lib.titles.includes("Give a reference"), "…and not the pages other people reach from an email");
      check(!lib.shelves.includes("What other people see"), "…so there is no shelf for them");
      await noOverflow(page, "the library for a member on a phone");
      await shot(page, "34-library-member-phone");

      await open(page, "/guides/run-your-week");
      check(await page.getByRole("heading", { name: "This guide is for someone else." }).isVisible(), "a leader’s guide, opened by a member, says it is for someone else");
      check(!(await page.locator("body").innerText()).includes("Log the meeting"), "…and shows nothing of what is in it");
      check((await picture(page, "run-your-week", "top")) === 404, "…and its pictures are a plain 404");
      check((await picture(page, "find-your-tribe", "rhythm")) === 200, "a member’s own guide’s pictures open");
      await ctx.close();
    }

    // --- 3. a tribe leader ---------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "ngozi@example.org", "/guides");
      await open(page, "/guides");
      const lib = await library(page);
      check(lib.shelves[0] === "For tribe leaders", `a leader’s own shelf comes first (${lib.shelves.join(", ")})`);
      check(lib.byShelf["For tribe leaders"]?.[0]?.startsWith("Fill in your Tribe Card"), "…and starts with the Tribe Card guide");
      for (const t of ["Run your week", "Appointed or invited to lead? Start here"]) check(lib.byShelf["For tribe leaders"]?.includes(t), `…and has “${t}”`);
      check(lib.titles.includes("Find your tribe: the form"), "…and still the member’s guides");
      check(Boolean(lib.byShelf["What other people see"]?.includes("Assistant leader: your part")), "…and what an assistant leader reads, so they know");
      check(Boolean(lib.byShelf["What other people see"]?.includes("Give permission for a young person")), "…and the page a parent is shown");
      check(!lib.titles.some((t) => /Pastor|Decide|Invite/.test(t)), "…and nothing that is for pastors or the office");
      check(new Set(lib.titles).size === lib.titles.length, "…each guide once");
      await shot(page, "34-library-leader-phone");
      await ctx.close();
    }

    // --- 4. an assistant leader -----------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "kemi@example.org", "/guides");
      await open(page, "/guides");
      const lib = await library(page);
      check(Boolean(lib.byShelf["For assistant leaders"]?.includes("Assistant leader: your part")), "an assistant leader has a shelf of their own, with their guide");
      check(Boolean(lib.byShelf["What other people see"]?.includes("Run your week")), "…and reads the leader’s week as what the leader sees");
      await ctx.close();
    }

    // --- 5. a pastor ---------------------------------------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "pastor.ife@example.org", "/guides");
      await open(page, "/guides");
      const lib = await library(page);
      check(lib.titles.includes("Find your tribe: the form"), "a pastor is offered the member’s guides");
      check(Boolean(lib.byShelf["What other people see"]?.includes("Give a reference")), "…and the pages people reach from an email, such as giving a reference");
      check(!lib.titles.includes("Run your week"), "…but not a leader’s guides");
      await open(page, "/guides/run-your-week");
      check(await page.getByRole("heading", { name: "This guide is for someone else." }).isVisible(), "…and a leader’s guide says it is for someone else");
      await ctx.close();
    }

    // --- 6. the "How to use this app" button -----------------------------------------------------------------------------------------
    {
      const help = async (email: string, path: string) => {
        const { ctx, page } = await newPage(browser, "phone");
        await signIn(page, email, path);
        await open(page, path);
        await page.getByTestId("howto-button").click();
        await page.getByTestId("howto-sheet").waitFor({ state: "visible", timeout: 10000 });
        const main = page.getByTestId("howto-main");
        const href = (await main.count()) ? await main.first().getAttribute("href") : null;
        await ctx.close();
        return href?.split("#")[0] ?? null;
      };
      check((await help("ngozi@example.org", "/lead/week")) === "/guides/run-your-week", "a leader on This week is offered the guide to running the week");
      check((await help("kemi@example.org", "/lead/week")) === "/guides/assistant-leader", "…an assistant leader, on the same page, is offered their own guide");
      check((await help("member@example.org", "/profile")) === "/guides/your-information", "a member on their own information page is offered the guide to it");
      check((await help("member@example.org", "/home")) === null, "…and no guide is named on a page that has none (the button still opens, with the tour and the search)");
      check((await help("member@example.org", "/lead/week")) === null, "…and a member is never pointed at a leader’s guide");
    }

    // --- 7. the reader, on a phone and on a computer -----------------------------------------------------------------------------------
    {
      const { ctx, page } = await newPage(browser, "phone");
      await signIn(page, "member@example.org", "/guides/find-your-tribe");
      await open(page, "/guides/find-your-tribe");
      check(await page.getByRole("heading", { name: /Find your tribe/ }).first().isVisible(), "a guide opens on its cover");
      await noOverflow(page, "the guide’s cover on a phone");
      await shot(page, "34-guide-cover-phone");
      await page.getByRole("button", { name: /Start the guide|Carry on/ }).first().click();
      await page.getByText(/Step 1 of \d+/).first().waitFor({ timeout: 10000 });
      const loaded = await page.locator(".gd-slide[data-on='true'] img").first().evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : new Promise<number>((r) => { img.onload = () => r(img.naturalWidth); img.onerror = () => r(0); })));
      check(loaded > 0, "the first step shows its picture");
      await noOverflow(page, "a step on a phone");
      await shot(page, "34-guide-step-phone");
      await page.keyboard.press("ArrowRight");
      await page.getByText(/Step 2 of \d+/).first().waitFor({ timeout: 10000 });
      check(true, "the arrow key moves to the next step");
      await open(page, "/guides/find-your-tribe?view=all");
      const steps = await page.locator("article, section[id]").count();
      check(steps > 10, `“see every step” shows the whole guide on one page (${steps} sections)`);
      await noOverflow(page, "the whole guide on a phone");
      await ctx.close();

      const desk = await newPage(browser, "desktop");
      await signIn(desk.page, "member@example.org", "/guides");
      await open(desk.page, "/guides");
      await library(desk.page);
      await noOverflow(desk.page, "the library on a computer");
      await shot(desk.page, "34-library-member-desktop");
      await desk.ctx.close();
    }
  } finally {
    await browser.close();
  }
  finish("34-guides");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

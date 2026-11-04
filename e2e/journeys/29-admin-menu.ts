/**
 * The restructured Admin, on a computer and on a phone, for one role and for two.
 *
 * On a computer: a menu down the side, grouped, with the page you are on marked, a count of what is waiting beside the pages that have
 * work in them, breadcrumbs, and no second "back" link on the pages inside. The menu stays put when you move between pages. A search
 * box finds the page for what you came to do ("delete account"), by its old names too, and the / key goes to it from anywhere.
 * On a phone: a bar that says where you are, opens the whole menu as a sheet from the bottom, closes it when you choose a page, and
 * shows a way back on a page inside a page. Nothing scrolls sideways and every target is big enough to tap.
 * For roles: a pastor sees the pastor's pages only and cannot open the others by typing the address; a person who is an admin and a
 * pastor sees the pages of both, each once.
 */
import fs from "node:fs";
import type { Page } from "playwright-core";
import { check, db, finish, launch, newPage, noOverflow, open, settle, signIn, text } from "../lib";

const tid = (page: Page, id: string) => page.getByTestId(id);

/** Set E2E_SHOTS=1 to keep a picture of each screen in .e2e/shots (for looking at, not for checking). */
async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  fs.mkdirSync(".e2e/shots", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const side = (page: Page) => page.locator("aside nav[aria-label='Admin menu']");
/** The pages in the side menu, by the address each one opens. */
const menuIds = async (page: Page) => (await side(page).locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""))).sort();

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Record<string, unknown> | undefined;
  const zainab = (await one("insert into auth.users (email, email_confirmed_at) values ('zainab.both@example.org', now()) returning id"))!.id as string;
  await q.query("update public.people set full_name = 'Zainab Both', preferred_name = 'Zainab' where id = $1", [zainab]);
  for (const role of ["admin", "pastor"]) {
    await q.query("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [zainab, role]);
  }
  // Something for the menu to count: a deletion request, open now
  const leaver = (await one("insert into auth.users (email, email_confirmed_at) values ('leaver.person@example.org', now()) returning id"))!.id as string;
  await q.query("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [leaver]);

  const browser = await launch();
  try {
    // --- 1. a computer, one role -------------------------------------------------------------------------------------------------
    const admin = await newPage(browser, "desktop");
    await signIn(admin.page, "admin.mary@example.org", "/admin");
    await open(admin.page, "/admin");
    const p = admin.page;
    check(await heading(p, "Today").isVisible(), "the admin lands on Today");
    check(await p.locator("aside[aria-label='Admin']").isVisible(), "the menu is down the side");
    check(await tid(p, "admin-bar").isHidden(), "…and the phone bar is not shown");
    const adminIds = await menuIds(p);
    check(adminIds.length === 30, `the admin’s menu has 30 pages (${adminIds.length})`);
    check(new Set(adminIds).size === adminIds.length, "…each once");
    check((await side(p).getByRole("link", { name: /^Answer checks/ }).count()) === 0, "a page only pastors and directors may open is not in the admin’s menu");
    for (const section of ["Season", "People", "Leaders", "Messages", "Programme", "System"]) {
      check((await side(p).getByRole("heading", { name: section, exact: true }).count()) === 1, `the menu has a ${section} group`);
    }
    check((await tid(p, "menu-admin").getAttribute("aria-current")) === "page", "Today is marked as the page you are on");
    check(/\bwaiting\b/.test(await tid(p, "menu-admin-privacy").innerText()), "Data requests has the number waiting beside it");
    check((await tid(p, "hat-all").count()) === 0, "someone with one role has no hat chips");
    check(await tid(p, "numbers").isVisible() && (await p.getByRole("link", { name: "More figures" }).count()) === 1, "Today ends with four numbers and a way to more");
    check(await tid(p, "shortcuts").isHidden(), "the shortcuts are for the phone: the menu is already beside the page");
    await noOverflow(p, "Today on desktop");
    await shot(p, "29-today-admin-desktop");

    // Move between pages: the menu stays, the place moves, the page’s own back link is gone
    await p.locator("aside[aria-label='Admin']").evaluate((el) => el.setAttribute("data-marker", "still-here"));
    await tid(p, "menu-admin-targets").click();
    await p.waitForURL("**/admin/targets");
    await settle(p);
    check(await heading(p, "Targets").isVisible(), "the menu opens Targets");
    check((await tid(p, "menu-admin-targets").getAttribute("aria-current")) === "page" && (await tid(p, "menu-admin").getAttribute("aria-current")) === null, "the mark moves to Targets");
    check((await p.locator("aside[aria-label='Admin']").getAttribute("data-marker")) === "still-here", "the menu was not rebuilt when the page changed");
    const crumbs = await p.getByRole("navigation", { name: "Breadcrumb" }).innerText();
    check(/Admin\s*›\s*Programme\s*›\s*Targets/.test(crumbs.replace(/\n/g, " ")), `the breadcrumbs say where you are (“${crumbs.replace(/\n/g, " ")}”)`);
    check((await p.locator("[data-back-link]").first().isVisible().catch(() => false)) === false, "the page’s own back link is not shown: the menu and breadcrumbs do that job");
    await noOverflow(p, "Targets on desktop");
    await shot(p, "29-targets-desktop");
    await p.goBack();
    await settle(p);
    check(await heading(p, "Today").isVisible() && (await tid(p, "menu-admin").getAttribute("aria-current")) === "page", "Back returns to Today with the menu in step");

    // Search
    await p.locator("body").click({ position: { x: 5, y: 5 } });
    await p.keyboard.press("/");
    check((await p.evaluate(() => document.activeElement?.id)) === "side-search", "the / key goes to the search box");
    await p.keyboard.type("delete account");
    const results = await side(p).innerText();
    check(/Data requests/.test(results) && !/Targets/.test(results), "“delete account” finds Data requests and nothing unrelated");
    await shot(p, "29-search-desktop");
    await p.keyboard.press("Enter");
    await p.waitForURL("**/admin/privacy");
    await settle(p);
    check((await p.locator("#side-search").inputValue()) === "", "Enter opens the best match and clears the box");
    await p.locator("#side-search").fill("leader supply");
    check(/Leaders needed/.test(await side(p).innerText()), "an old name (“leader supply”) still finds the page by its new name");
    await p.locator("#side-search").fill("zzzzqq");
    check(/No page matches/.test(await side(p).innerText()), "a word that matches nothing says so");
    await p.keyboard.press("Escape");
    check((await p.locator("#side-search").inputValue()) === "" && (await menuIds(p)).length === 30, "Escape clears the search and the whole menu is back");
    await p.locator("#side-search").fill("email");
    check(/Sending and email/.test(await side(p).innerText()) && /Notifications/.test(await side(p).innerText()), "“email” finds the pages about email");
    await p.locator("#side-search").fill("");

    // The renamed pages and the new ones
    for (const [path, name] of [["/admin/leader-supply", "Leaders needed"], ["/admin/system", "Sending and email"], ["/admin/referees", "Church referee list"], ["/admin/figures", "Figures"], ["/admin/notifications", "Notifications"]] as const) {
      await open(p, path);
      check(await heading(p, name).isVisible(), `${path} is headed “${name}”`);
    }
    await open(p, "/admin/leader-quality");
    check(!(await heading(p, "Answer checks").isVisible().catch(() => false)), "a page the admin’s role does not allow does not open by typing the address");

    // --- 2. a computer, a pastor --------------------------------------------------------------------------------------------------
    const pastor = await newPage(browser, "desktop");
    await signIn(pastor.page, "pastor.ife@example.org", "/admin");
    await open(pastor.page, "/admin");
    const pastorIds = await menuIds(pastor.page);
    check(pastorIds.length === 24, `the pastor’s menu has 24 pages (${pastorIds.length})`);
    check((await side(pastor.page).getByRole("link", { name: /^Answer checks/ }).count()) === 1, "the pastor has Answer checks");
    for (const gone of ["Message log", "People and roles", "Data requests", "Sending and email"]) {
      check((await side(pastor.page).getByRole("link", { name: new RegExp(`^${gone}`) }).count()) === 0, `…and not ${gone}`);
    }
    check((await tid(pastor.page, "attention-data_requests").count()) === 0, "Today shows the pastor no deletion requests");
    await open(pastor.page, "/admin/messages");
    check(!(await heading(pastor.page, "Message log").isVisible().catch(() => false)), "the pastor cannot open the Message log by typing its address");

    // --- 3. a computer, an admin who is also a pastor ----------------------------------------------------------------------------------
    const both = await newPage(browser, "desktop");
    await signIn(both.page, "zainab.both@example.org", "/admin");
    await open(both.page, "/admin");
    const bothIds = await menuIds(both.page);
    check(new Set(bothIds).size === bothIds.length, "the menu of an admin who is also a pastor lists no page twice");
    check(adminIds.every((id) => bothIds.includes(id)) && pastorIds.every((id) => bothIds.includes(id)), "…and has every page either role has");
    check(bothIds.length === 31, `…31 in all (${bothIds.length})`);
    check((await both.page.locator("aside nav[aria-label='Admin menu']").getByRole("link", { name: /^Answer checks/ }).count()) === 1, "…including the pastor-only Answer checks");
    check((await tid(both.page, "hat-all").count()) === 1 && (await tid(both.page, "hat-admin").count()) === 1 && (await tid(both.page, "hat-pastor").count()) === 1, "Today has a chip for each hat");
    await open(both.page, "/admin/leader-quality");
    check(await heading(both.page, "Answer checks").isVisible(), "…and the pastor-only page opens for them");
    await noOverflow(both.page, "a two-role menu on desktop");
    await both.ctx.close();
    await pastor.ctx.close();

    // --- 4. a phone ----------------------------------------------------------------------------------------------------------------
    const phone = await newPage(browser);
    await signIn(phone.page, "admin.mary@example.org", "/admin");
    await open(phone.page, "/admin");
    const f = phone.page;
    check(await tid(f, "admin-bar").isVisible(), "on a phone there is a bar at the top");
    check(await f.locator("aside[aria-label='Admin']").isHidden(), "…and the side menu is not shown");
    const bar = await tid(f, "admin-bar").boundingBox();
    check(Boolean(bar) && bar!.height >= 44 && bar!.height < 56, `the bar is easy to tap and does not eat the screen (${Math.round(bar?.height ?? 0)}px)`);
    check(/^Today/.test(await tid(f, "admin-bar").innerText()), "…and says where you are");
    await noOverflow(f, "Today on a phone");
    await shot(f, "29-today-admin-phone");
    await tid(f, "admin-bar").tap();
    const sheet = tid(f, "admin-sheet");
    await sheet.waitFor({ state: "visible", timeout: 5000 });
    check(await sheet.evaluate((el) => (el as HTMLDialogElement).open), "tapping the bar opens the menu as a sheet");
    check(await sheet.getByRole("heading", { name: "Admin" }).isVisible(), "…headed Admin");
    const links = sheet.locator("nav a");
    const count = await links.count();
    let smallest = Infinity;
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      if (box) smallest = Math.min(smallest, box.height);
    }
    check(count === 30 && smallest >= 40, `the sheet has all 30 pages and the smallest is ${Math.round(smallest)}px tall`);
    await shot(f, "29-sheet-phone");
    const sheetBox = await sheet.boundingBox();
    check(Boolean(sheetBox) && sheetBox!.width <= 391 && sheetBox!.y > 0, "the sheet fits the screen");
    await sheet.getByTestId("menu-admin-targets").tap();
    await f.waitForURL("**/admin/targets");
    await settle(f);
    check(!(await sheet.evaluate((el) => (el as HTMLDialogElement).open)), "choosing a page closes the sheet");
    check(/Programme\s*›\s*Targets/.test(await tid(f, "admin-bar").innerText()), "…and the bar now says Programme › Targets");
    await noOverflow(f, "Targets on a phone");

    // A page inside a page has a way back
    await open(f, "/admin/guides/1");
    const back = f.getByRole("link", { name: /Weekly guides/ }).first();
    const backBox = await back.boundingBox();
    check(Boolean(backBox) && backBox!.height >= 40, "a page inside a page shows a way back to its list, big enough to tap");
    await noOverflow(f, "a weekly guide on a phone");
    await shot(f, "29-inner-page-phone");
    await back.tap();
    await f.waitForURL("**/admin/guides");

    // Keyboard on a phone or tablet: / opens the sheet with the search ready; Escape closes it
    await f.locator("body").click({ position: { x: 5, y: 5 } });
    await f.keyboard.press("/");
    await sheet.waitFor({ state: "visible", timeout: 5000 });
    // (The page puts the cursor in the box a moment after the sheet opens, so wait for it rather than look at the instant it is drawn.)
    await f.waitForFunction(() => document.activeElement?.id === "sheet-search", null, { timeout: 3000 }).catch(() => undefined);
    check((await f.evaluate(() => document.activeElement?.id)) === "sheet-search", "the / key opens the sheet with the search ready");
    await f.keyboard.type("figures");
    await f.keyboard.press("Enter");
    await f.waitForURL("**/admin/figures");
    await settle(f);
    check(!(await sheet.evaluate((el) => (el as HTMLDialogElement).open)) && /Figures/.test(await tid(f, "admin-bar").innerText()), "Enter in the sheet’s search opens the best match and closes the sheet");
    await tid(f, "admin-bar").tap();
    await sheet.waitFor({ state: "visible", timeout: 5000 });
    await f.keyboard.press("Escape");
    await f.waitForFunction(() => !(document.querySelector('[data-testid="admin-sheet"]') as HTMLDialogElement | null)?.open, null, { timeout: 5000 });
    check(true, "Escape closes the sheet");

    // Every page, no sideways scroll
    for (const path of ["/admin", "/admin/people", "/admin/notifications", "/admin/figures", "/admin/guides", "/admin/seasons", "/admin/privacy", "/admin/system", "/admin/catalogue", "/admin/leader-pipeline"]) {
      await open(f, path);
      await noOverflow(f, `${path} on a phone`);
    }
    check(true, "ten Admin pages checked at phone width");

    // Today on a phone, in words
    await open(f, "/admin");
    check(await tid(f, "shortcuts").isVisible() && /People and roles/.test(await tid(f, "shortcuts").innerText()), "on a phone Today has shortcuts to the pages used most");
    check(/Nothing is waiting|Needs attention/.test(await text(f)), "…and says what is waiting, or that nothing is");

    // --- 5. someone who is not on the team ---------------------------------------------------------------------------------------------
    const member = await newPage(browser, "desktop");
    await signIn(member.page, "member@example.org", "/admin");
    await open(member.page, "/admin");
    check((await tid(member.page, "admin-shell").count()) === 0 && !(await heading(member.page, "Today").isVisible().catch(() => false)), "a member who types /admin gets neither the menu nor Today");
    await member.ctx.close();
    await phone.ctx.close();
    await admin.ctx.close();
  } finally {
    await q.query("delete from public.erasure_requests where person_id = $1", [leaver]);
    await q.query("delete from public.person_roles where person_id = $1", [zainab]);
    await browser.close();
    await q.end();
  }
  finish("29-admin-menu");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

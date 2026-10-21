/**
 * The platform owner, end to end. One hidden account: to everyone else the console is a page that does not exist; the owner
 * signs in like anyone, is held at an unlock step until the passphrase is given (wrong tries are counted), and then has every
 * page, a live view of what everyone is doing, every person and every tribe, and the power to give and take away any role.
 * They are never in a list the office can read, the second sign-in of the same account has no powers until it unlocks too,
 * the passphrase can be changed, and locking (or time running out) takes the powers away at once.
 */
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const PHRASE = "river-lantern-mango-cobalt";
const NEW_PHRASE = "copper-harbour-violet-ember";
const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

/** Set E2E_SHOTS=<folder> to keep a picture of each screen as it is reached (for looking at, not for checking). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function unlockWith(page: Page, phrase: string) {
  await page.getByLabel("Passphrase").fill(phrase);
  await page.getByRole("button", { name: "Unlock" }).click();
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const all = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
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
  const S = (await one("select id from public.seasons order by starts_on limit 1"))!.id as string;
  const browser = await launch();

  // --- the people ----------------------------------------------------------------------------------------------------------
  const { tribe, leader } = await k.tribe(S, { name: "Yaba Builders" });
  const bisi = await k.seat(tribe, S, "Bisi");
  await k.meetings(tribe, leader.id, 2, [[bisi.id, 2]]);
  const owner = await adapter.createUser({ email: "owner.private@example.org" });
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);
  const adminEmail = "admin.mary@example.org";

  // --- 1. to everyone else, nothing is here --------------------------------------------------------------------------------
  const office = await newPage(browser, "desktop");
  await signIn(office.page, adminEmail, "/admin/people");
  await open(office.page, "/admin/people");
  check(await heading(office.page, "People and roles").isVisible(), "the admin reaches the people page as usual");
  const peopleText = await text(office.page);
  check(!peopleText.includes("Platform Owner") && !peopleText.includes(owner.email), "the owner is not in the admin’s list of people");
  for (const path of ["/god", "/god/unlock", "/god/people", "/god/record", `/god/tribes/${tribe}`]) {
    await open(office.page, path);
    check(/We can.t find that page/.test(await text(office.page)), `${path} does not exist for an admin`);
  }
  const nav = await text(office.page);
  check(!/Console/.test(nav), "no menu item points at the console");

  // --- 2. the owner signs in and is held at the unlock ---------------------------------------------------------------------
  const me = await newPage(browser, "desktop");
  await signIn(me.page, owner.email, "/home");
  await me.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  check(await heading(me.page, "Owner access").isVisible(), "after signing in, the owner is taken to the unlock step");
  await shot(me.page, "owner-unlock");
  await open(me.page, "/admin");
  check(/\/god\/unlock/.test(me.page.url()), "…and no other page opens until the passphrase is given");
  await open(me.page, "/admin/people");
  check(/\/god\/unlock/.test(me.page.url()), "…not even the office pages");

  await unlockWith(me.page, "not-the-passphrase");
  await me.page.getByText(/That did not work\./).waitFor({ timeout: 10000 });
  check(/4 tries left/.test(await text(me.page)), "a wrong passphrase is refused, and says how many tries are left");
  check(/\/god\/unlock/.test(me.page.url()), "…and nothing opens");
  const wrong = await one("select failed_tries from public.platform_owner");
  check(wrong?.failed_tries === 1, "the wrong try is counted in the database");

  await unlockWith(me.page, PHRASE);
  await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  check(await heading(me.page, "Everything, as it happens").isVisible(), "the right passphrase opens the console");
  check((await one("select failed_tries from public.platform_owner"))?.failed_tries === 0, "…and clears the count");

  // --- 3. the console shows what is happening ------------------------------------------------------------------------------
  const consoleText = await text(me.page);
  check(/The platform right now/.test(consoleText) && /People/.test(consoleText) && /Tribes running/.test(consoleText), "the overview shows the numbers");
  check(/Owner access is on/.test(consoleText), "a bar says the owner’s access is on and when it ends");
  check(await me.page.getByRole("link", { name: "Console" }).first().isVisible(), "the owner’s menu has the console");
  check((await me.page.locator("[data-event]").count()) > 3, "the feed lists what has been happening");
  check(await me.page.getByRole("switch", { name: /Live/ }).isVisible(), "the feed can be kept live");
  await shot(me.page, "owner-console");
  await noOverflow(me.page, "the console on a desktop");

  await me.page.getByLabel("Filter the activity").fill("person");
  await me.page.getByRole("button", { name: "Filter" }).click();
  await me.page.waitForURL(/q=person/, { timeout: 10000 });
  const filtered = await me.page.locator("[data-event]").evaluateAll((els) => els.map((e) => e.getAttribute("data-event")));
  check(filtered.length > 0 && filtered.every((a) => /person/.test(a ?? "")), "the feed can be filtered by what happened");

  // --- 4. people -----------------------------------------------------------------------------------------------------------
  await open(me.page, "/god/people");
  check((await text(me.page)).includes("Bisi Test"), "every person is listed");
  check(!(await text(me.page)).includes("Platform Owner"), "…but never the owner");
  await me.page.getByLabel("Search people").fill("bisi");
  await me.page.getByRole("button", { name: "Search" }).click();
  await me.page.waitForURL(/q=bisi/, { timeout: 10000 });
  await me.page.getByRole("link", { name: /Bisi Test/ }).first().click();
  await me.page.waitForURL(/\/god\/people\/[0-9a-f-]{36}/, { timeout: 10000 });
  check(await heading(me.page, /Bisi Test/).isVisible(), "a person opens");
  const personText = await text(me.page);
  check(/Yaba Builders/.test(personText) && /Form[\s\S]*Done/.test(personText), "…with where they are: their tribe and their form");
  check(/stay sealed/.test(personText), "…and a reminder that private notes stay sealed");
  await shot(me.page, "owner-person");

  // give and take away a role
  await me.page.getByLabel("Give a role").selectOption({ label: "Coach" });
  await me.page.getByRole("button", { name: "Give", exact: true }).click();
  await me.page.getByText("Coach given.").waitFor({ timeout: 10000 });
  check(!!(await one("select 1 as x from public.person_roles where person_id = $1 and role = 'coach'", [bisi.id])), "the owner can give any role");
  await me.page.getByRole("button", { name: "Remove Coach" }).click();
  await me.page.getByText("Coach removed.").waitFor({ timeout: 10000 });
  check(!(await one("select 1 as x from public.person_roles where person_id = $1 and role = 'coach'", [bisi.id])), "…and take it away");
  const stamped = await one("select count(*)::int as n from public.event_log where actor_id = $1", [owner.id]);
  check(stamped?.n === 0, "what the owner did is not in the office’s event log under their name");
  check(((await one("select count(*)::int as n from public.god_log where kind = 'action'"))?.n as number) >= 2, "…it is in the owner’s own record");

  // --- 5. tribes ----------------------------------------------------------------------------------------------------------
  await open(me.page, "/god/tribes");
  check((await text(me.page)).includes("Yaba Builders"), "every tribe is listed");
  await me.page.getByRole("link", { name: /Yaba Builders/ }).first().click();
  await me.page.waitForURL(/\/god\/tribes\/[0-9a-f-]{36}/, { timeout: 10000 });
  const tribeText = await text(me.page);
  check(/Bisi/.test(tribeText) && /Week 1/.test(tribeText), "a tribe opens, with its members and its weeks");

  // --- 6. every page opens -------------------------------------------------------------------------------------------------
  for (const [path, title] of [
    ["/admin", /Admin/],
    ["/admin/people", /People and roles/],
    ["/admin/privacy", /./],
    ["/admin/system", /Sending and email/],
    ["/review", /./],
    ["/care", /./],
    ["/dashboard", /./],
    ["/reports", /./],
    ["/growth", /./],
  ] as const) {
    await open(me.page, path);
    check(new URL(me.page.url()).pathname === path && (await heading(me.page, title).isVisible()), `${path} opens for the owner`);
  }

  // --- 7. the same account on a second sign-in has no powers until it unlocks too -----------------------------------------
  const second = await newPage(browser, "desktop");
  await signIn(second.page, owner.email, "/god");
  await second.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  check(true, "a second sign-in of the account is held at the unlock as well");
  await open(me.page, "/god");
  check(new URL(me.page.url()).pathname === "/god", "…while the first stays open");
  await second.ctx.close();

  // --- 8. the record -------------------------------------------------------------------------------------------------------
  await open(me.page, "/god/record");
  const record = await text(me.page);
  check(/You unlocked the console/.test(record), "the owner’s record shows every unlock");
  check(/A wrong passphrase/.test(record), "…every wrong passphrase");
  check(/You changed something: (gave|invited)/.test(record) || /You changed something/.test(record), "…and what the owner changed");
  check(!record.includes(PHRASE) && !record.includes("not-the-passphrase"), "…and never a passphrase");
  await shot(me.page, "owner-record");

  // --- 9. change the passphrase, then lock ---------------------------------------------------------------------------------
  await me.page.getByLabel("Current passphrase").fill("wrong-current-phrase");
  await me.page.getByLabel("New passphrase", { exact: true }).fill(NEW_PHRASE);
  await me.page.getByLabel("New passphrase again").fill(NEW_PHRASE);
  await me.page.getByRole("button", { name: "Change passphrase" }).click();
  await me.page.getByText(/current passphrase is not right/).waitFor({ timeout: 10000 });
  check(true, "a wrong current passphrase is refused");
  await me.page.getByLabel("Current passphrase").fill(PHRASE);
  await me.page.getByLabel("New passphrase", { exact: true }).fill(NEW_PHRASE);
  await me.page.getByLabel("New passphrase again").fill("something-else-entirely");
  await me.page.getByRole("button", { name: "Change passphrase" }).click();
  await me.page.getByText(/not the same/).waitFor({ timeout: 10000 });
  check(true, "two different new passphrases are refused");
  await me.page.getByLabel("Current passphrase").fill(PHRASE);
  await me.page.getByLabel("New passphrase", { exact: true }).fill(NEW_PHRASE);
  await me.page.getByLabel("New passphrase again").fill(NEW_PHRASE);
  await me.page.getByRole("button", { name: "Change passphrase" }).click();
  await me.page.getByText(/passphrase is changed/).waitFor({ timeout: 10000 });
  check(true, "the passphrase is changed");

  await me.page.getByRole("button", { name: "Lock now" }).click();
  await me.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  check(true, "Lock now takes the owner back to the unlock step");
  await open(me.page, "/admin");
  check(/\/god\/unlock/.test(me.page.url()), "…and every page is closed again");
  await unlockWith(me.page, PHRASE);
  await me.page.getByText(/That did not work\./).waitFor({ timeout: 10000 });
  check(true, "the old passphrase no longer works");
  await unlockWith(me.page, NEW_PHRASE);
  await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  check(true, "the new one does");

  // --- 10. the lock after five wrong tries ----------------------------------------------------------------------------------
  await me.page.getByRole("button", { name: "Lock now" }).click();
  await me.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  for (let i = 0; i < 5; i++) {
    await unlockWith(me.page, `wrong-guess-${i}-xx`);
    // Wait for the database to have counted this try before making the next (the form clears itself after each answer).
    for (let wait = 0; wait < 50; wait++) {
      if ((await one("select failed_tries from public.platform_owner"))?.failed_tries === i + 1) break;
      await me.page.waitForTimeout(200);
    }
    await me.page.getByRole("button", { name: "Unlock" }).waitFor({ state: "visible" });
  }
  check((await one("select failed_tries from public.platform_owner"))?.failed_tries === 5, "five wrong tries are counted");
  await unlockWith(me.page, NEW_PHRASE);
  await me.page.getByText(/Too many tries/).waitFor({ timeout: 10000 });
  check(true, "after five wrong tries even the right passphrase is refused for a while");
  await q.query("update public.platform_owner set locked_until = null");

  // --- 11. time running out ------------------------------------------------------------------------------------------------
  await unlockWith(me.page, NEW_PHRASE);
  await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await q.query("update public.platform_owner set unlocked_until = now() - interval '1 minute'");
  await open(me.page, "/admin");
  check(/\/god\/unlock/.test(me.page.url()), "when the four hours end, the powers end with them");

  // --- 12. a phone ---------------------------------------------------------------------------------------------------------
  await unlockWith(me.page, NEW_PHRASE);
  await me.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  const phone = await newPage(browser, "phone");
  await signIn(phone.page, owner.email, "/home");
  await phone.page.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await noOverflow(phone.page, "the unlock on a phone");
  await unlockWith(phone.page, NEW_PHRASE);
  await phone.page.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await noOverflow(phone.page, "the console on a phone");
  for (const path of ["/god/people", "/god/tribes", "/god/record"]) {
    await open(phone.page, path);
    await noOverflow(phone.page, `${path} on a phone`);
  }
  await shot(phone.page, "owner-phone");
  await phone.ctx.close();

  // --- 13. the office still cannot see them --------------------------------------------------------------------------------
  await open(office.page, "/admin/people");
  const after = await text(office.page);
  check(!after.includes("Platform Owner") && !after.includes(owner.email), "after all of that, the admin still cannot see the owner anywhere");
  const intake = await all("select * from public.people where hidden");
  check(intake.length === 1, "exactly one account is hidden");

  await office.ctx.close();
  await me.ctx.close();
  await q.end();
  await browser.close();
  finish("10-owner");
}
void main();

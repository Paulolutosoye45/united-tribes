/**
 * An admin places, moves and undoes, and asks the owner for what only the owner may allow, end to end.
 *
 *  - An admin finds a member by name on People and roles, opens their page, places them in a tribe, undoes it, places them again, then moves them to
 *    another tribe and undoes the move (their old seat comes back).
 *  - A member who has not agreed to matching can be placed only after the admin ticks the warning, ticks that the member told them they agree, and gives
 *    a reason. The button stays off until then.
 *  - From a tribe's page the admin finds a member and adds them. The tribe is full: that is the owner's to allow, so the admin sees "Ask the owner" and
 *    no place button. The request is listed on the admin's page.
 *  - The owner opens Placement, sees the request, looks again, approves. The member is placed as the admin's placement, the admin is told, and the
 *    owner's count by person lists the admin.
 *  - A person who holds no staff role is sent home from the page. The pages do not scroll sideways on a phone.
 *
 * What is only arranged here (a season already running, tribes, members with finished forms) is arranged in the database the way the database tests do it;
 * everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
import { makeOwner, PHRASE } from "../../tests/db/activity-kit";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";
import { check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function eventually(label: string, read: () => Promise<boolean>, seconds = 30) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await read().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  check(false, `${label} (waited ${seconds}s)`);
  return false;
}

function has(label: string, re: RegExp, body: string) {
  check(re.test(body), label);
  if (!re.test(body)) console.log(`    saw: ${body.slice(0, 600).replace(/\n/g, " | ")}`);
}

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);

  // ---- Arranging: a running season (week 1), Placement On, three open tribes (one full), four members, an admin and a plain member ---------------------
  if (await one("select 1 as there from public.platform_owner")) await q.query("select public.remove_platform_owner()");
  const o = await makeOwner(adapter, "office.owner@example.org");
  await q.query("update public.people set full_name = 'Platform Owner', preferred_name = 'Owner' where id = $1", [o.owner.id]);
  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasMode = (await one("select mode from public.placement_settings"))!.mode as string;
  // The notices to staff start Off, as they do for the church; this journey turns the admins' group On so the owner's answer can be seen to reach the admin
  const wasNotice = (await one("select mode from public.notice_settings where group_key = 'admin'"))?.mode as string | undefined;
  await q.query("update public.notice_settings set mode = 'on' where group_key = 'admin'");
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);
  await q.query("update public.tribes set status = 'closed' where status = 'approved'");
  await q.query("update public.placement_settings set mode = 'on'");

  const A = await k.tribe(S, { name: "Office Alpha", track: "builders" });
  const B = await k.tribe(S, { name: "Office Bravo", track: "builders" });
  const F = await k.tribe(S, { name: "Office Full", track: "builders", capacity: 4 });
  for (let i = 1; i <= 4; i++) await k.seat(F.tribe, S, `Full Filler ${i}`);

  const member = async (name: string, consent = true) => {
    const p = await k.person(name);
    await k.profile(p.id, S, { times: ["weeknight-evening"] });
    if (consent) await q.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')", [p.id]);
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [p.id, name, name.split(" ")[0]]);
    return p;
  };
  const mia = await member("Mia Officeone");
  const sade = await member("Sade Noconsent", false);
  const tobi = await member("Tobi Fulltribe");
  const admin = await k.staff("Office Admin", "admin");
  await q.query("update public.people set full_name = 'Office Admin', preferred_name = 'Ada' where id = $1", [admin.id]);
  const plain = await k.person("Plain Member");

  const seatOf = async (person: string) =>
    (await one("select tm.tribe_id, tm.status, tm.placement_source, r.placed_via, r.placed_role, r.placed_by, r.single from public.tribe_members tm left join public.placement_runs r on r.id = tm.placed_by_run where tm.person_id = $1 and tm.status = 'active'", [person])) ?? null;

  const browser = await launch();

  // ---- A person with no staff role is sent home -----------------------------------------------------------------------------------------------
  {
    const v = await newPage(browser, "phone");
    await signIn(v.page, plain.email, "/home");
    await open(v.page, "/admin/tribes");
    await v.page.waitForURL((u) => u.pathname === "/home", { timeout: 15000 });
    check(!/Place or move a member/.test(await text(v.page)), "a member without a staff role is sent home from the page");
    await v.ctx.close();
  }

  // ---- The admin finds Mia and places her, undoes it, places her again ------------------------------------------------------------------------
  const { ctx: actx, page: a } = await newPage(browser, "desktop");
  await signIn(a, admin.email, "/admin/people");
  await open(a, "/admin/people");
  await a.getByTestId("find-member").waitFor({ timeout: 20000 });
  await a.getByTestId("find-member-query").fill("Mia Officeone");
  await a.getByTestId("find-member-go").click();
  await a.getByTestId("find-member-results").waitFor({ timeout: 20000 });
  await shot(a, "47-find");
  await a.getByTestId(`find-member-open-${mia.id}`).click();
  await a.waitForURL((u) => u.pathname === `/admin/people/${mia.id}`, { timeout: 15000 });
  await a.getByTestId("place-one").waitFor({ timeout: 20000 });
  has("her page offers to place her", /Place in a tribe/, await text(a));

  const alpha = await a.locator('[data-testid="place-one-tribe"] option', { hasText: "Office Alpha" }).first().getAttribute("value");
  const bravo = await a.locator('[data-testid="place-one-tribe"] option', { hasText: "Office Bravo" }).first().getAttribute("value");
  check(alpha === A.tribe && bravo === B.tribe, "the open tribes are on the list");
  await a.getByTestId("place-one-tribe").selectOption(alpha ?? "");
  await a.getByTestId("place-one-check").waitFor({ timeout: 20000 });
  has("the check shows the fit and the seats", /Fit with Office Alpha: \d+%/, await text(a));
  check((await a.getByTestId("place-one-blockers").count()) === 0 && (await a.getByTestId("place-one-warnings").count()) === 0, "…nothing stops it and nothing needs a tick");
  has("…and says what will happen", /will be placed in Office Alpha/, await text(a));
  await shot(a, "47-place");
  await a.getByTestId("place-one-go").click();
  await a.getByTestId("place-one-done").waitFor({ timeout: 20000 });
  let seat = await seatOf(mia.id);
  check(seat?.tribe_id === A.tribe && seat?.placed_via === "office" && seat?.placed_role === "admin" && seat?.placed_by === admin.id && seat?.single === true, "Mia has a seat in Alpha, recorded as the admin's placement from Admin");
  check((await one("select count(*)::int as n from public.messages where template = 'placement_your_tribe' and person_id = $1", [mia.id]))?.n === 1, "…and she was sent the 'Your tribe' email");

  await a.getByTestId("place-one-undo").click();
  await a.getByTestId("place-one-undone").waitFor({ timeout: 20000 });
  check((await seatOf(mia.id)) === null, "Undo takes her seat away again");

  // ---- Placed again, then moved, then the move is undone ---------------------------------------------------------------------------------------
  await open(a, `/admin/people/${mia.id}`);
  await a.getByTestId("place-one").waitFor({ timeout: 20000 });
  await a.getByTestId("place-one-tribe").selectOption(alpha ?? "");
  await a.getByTestId("place-one-check").waitFor({ timeout: 20000 });
  await a.getByTestId("place-one-go").click();
  await a.getByTestId("place-one-done").waitFor({ timeout: 20000 });
  check((await seatOf(mia.id))?.tribe_id === A.tribe, "placed in Alpha again");

  await open(a, `/admin/people/${mia.id}`);
  await a.getByTestId("place-one").waitFor({ timeout: 20000 });
  has("now the page offers to move her", /Move to another tribe/, await text(a));
  await a.getByTestId("place-one-tribe").selectOption(bravo ?? "");
  await a.getByTestId("place-one-check").waitFor({ timeout: 20000 });
  has("the preview says she leaves Alpha and Alpha's leader is told", /will leave Office Alpha and be placed in Office Bravo/, await text(a));
  await shot(a, "47-move");
  await a.getByTestId("place-one-go").click();
  await a.getByTestId("place-one-done").waitFor({ timeout: 20000 });
  seat = await seatOf(mia.id);
  check(seat?.tribe_id === B.tribe && seat?.placed_via === "office", "Mia now sits in Bravo");
  check(
    Boolean((await one("select 1 as there from public.tribe_members where person_id = $1 and tribe_id = $2 and status = 'released' and release_reason = 'Moved by the church'", [mia.id, A.tribe]))),
    "…her Alpha seat was released as a move",
  );
  check((await one("select count(*)::int as n from public.messages where template = 'swap_moved' and tribe_id = $1", [A.tribe]))?.n === 1, "…and Alpha's leader was told");
  await a.getByTestId("place-one-undo").click();
  await a.getByTestId("place-one-undone").waitFor({ timeout: 20000 });
  has("Undo says she is back where she was", /back in their old tribe/, await text(a));
  check((await seatOf(mia.id))?.tribe_id === A.tribe, "…and she sits in Alpha again");

  // ---- A member who has not agreed to matching ---------------------------------------------------------------------------------------------------
  await open(a, `/admin/people/${sade.id}`);
  await a.getByTestId("place-one").waitFor({ timeout: 20000 });
  await a.getByTestId("place-one-tribe").selectOption(alpha ?? "");
  await a.getByTestId("place-one-warnings").waitFor({ timeout: 20000 });
  has("the warning says she has not agreed to matching", /have not agreed to matching/, await text(a));
  const go = a.getByTestId("place-one-go");
  check(await go.isDisabled(), "the button is off until the boxes are ticked");
  await a.getByTestId("place-one-warnings").locator('input[type="checkbox"]').first().check();
  check(await go.isDisabled(), "…still off with only the first tick");
  await a.getByTestId("place-one-agreed").locator('input[type="checkbox"]').check();
  check(await go.isDisabled(), "…still off without a reason");
  await a.getByTestId("place-one-reason").fill("She told me after church");
  check(await go.isEnabled(), "…on once she has told the admin she agrees and a reason is given");
  await shot(a, "47-warning");
  await go.click();
  await a.getByTestId("place-one-done").waitFor({ timeout: 20000 });
  check((await seatOf(sade.id))?.tribe_id === A.tribe, "Sade has a seat in Alpha");
  const item = await one(
    "select i.agreed, i.override, i.override_reason from public.placement_items i join public.tribe_members tm on tm.id = i.placement_id where tm.person_id = $1",
    [sade.id],
  );
  check(item?.agreed === true && String(item?.override_reason) === "She told me after church", "…the tick and the reason are kept with the placement");
  check(
    Boolean((await one("select 1 as there from public.consents where person_id = $1 and purpose = 'matching' and granted", [sade.id]))) === false,
    "…and nothing records an agreement from her: it stays the admin's word",
  );

  // ---- From the tribe's page: the tribe is full, so the admin asks the owner -------------------------------------------------------------------------------
  await open(a, "/admin/tribes");
  await a.getByTestId("tribes-list").waitFor({ timeout: 20000 });
  await shot(a, "47-tribes");
  await a.getByTestId(`tribe-open-${F.tribe}`).click();
  await a.waitForURL((u) => u.pathname === `/admin/tribes/${F.tribe}`, { timeout: 15000 });
  await a.getByTestId("find-member-query").fill(tobi.email);
  await a.getByTestId("find-member-go").click();
  await a.getByTestId(`find-member-pick-${tobi.id}`).click();
  await a.getByTestId("place-one-check").waitFor({ timeout: 20000 });
  has("the check says the tribe is full", /This tribe is full \(4 of 4\)/, await text(a));
  has("…and that only the owner can allow it", /only the owner can allow this/, await text(a));
  check((await a.getByTestId("place-one-go").count()) === 0 && (await a.getByTestId("place-one-ask").count()) === 1, "…so the page offers 'Ask the owner' and no place button");
  await a.getByTestId("place-one-warnings").locator('input[type="checkbox"]').first().check();
  await a.getByTestId("place-one-reason").fill("The leader has room for one more");
  await a.getByTestId("place-one-ask").click();
  await a.getByTestId("place-one-asked").waitFor({ timeout: 20000 });
  const ask = await one("select id, status, asked_by, asked_role, codes from public.placement_requests where person_id = $1", [tobi.id]);
  check(ask?.status === "open" && ask?.asked_by === admin.id && ask?.asked_role === "admin" && (ask?.codes as string[]).includes("full"), "the request is open, in the admin's name");
  check((await seatOf(tobi.id)) === null, "…and Tobi has no seat yet");
  await open(a, "/admin/tribes");
  await a.getByTestId(`request-${ask?.id}`).waitFor({ timeout: 20000 });
  has("the admin sees the request on their own page", /Tobi Fulltribe/, await text(a));
  await shot(a, "47-asked");
  await actx.close();

  // ---- The owner answers -----------------------------------------------------------------------------------------------------------------------------------
  const { ctx: octx, page: owner } = await newPage(browser, "desktop");
  await signIn(owner, o.owner.email, "/home");
  await owner.waitForURL(/\/god\/unlock/, { timeout: 15000 });
  await owner.getByLabel("Passphrase").fill(PHRASE);
  await owner.getByRole("button", { name: "Unlock" }).click();
  await owner.waitForURL((u) => u.pathname === "/god", { timeout: 15000 });
  await open(owner, "/god/placement");
  await owner.getByTestId("office-placement").waitFor({ timeout: 20000 });
  has("the Placement page says a request is waiting", /1 request is waiting for you/, await text(owner));
  has("…names who asked and about whom", /Tobi Fulltribe[\s\S]*Asked by [^\n(]+\(admin\)/, await text(owner));
  await shot(owner, "47-owner-request");
  await owner.getByTestId(`request-look-${ask?.id}`).click();
  await owner.getByTestId(`request-check-${ask?.id}`).waitFor({ timeout: 20000 });
  has("the owner's second look names the warning", /This tribe is full/, await text(owner));
  await owner.getByTestId(`request-note-${ask?.id}`).fill("Fine, welcome them");
  await owner.getByTestId(`request-approve-${ask?.id}`).click();
  await eventually("the request is approved", async () => (await one("select status from public.placement_requests where id = $1", [ask?.id]))?.status === "approved");
  seat = await seatOf(tobi.id);
  check(seat?.tribe_id === F.tribe && seat?.placed_via === "office" && seat?.placed_by === admin.id, "Tobi is placed, recorded as the admin's placement");
  const approved = await one("select r.approved_by, r.placed_role from public.placement_runs r join public.tribe_members tm on tm.placed_by_run = r.id where tm.person_id = $1", [tobi.id]);
  check(approved?.approved_by === o.owner.id && approved?.placed_role === "admin", "…approved by the owner");
  await eventually("the admin is told the answer", async () =>
    Number((await one("select count(*)::int as n from public.messages where template = 'admin_placement_answer' and person_id = $1", [admin.id]))?.n) === 1,
  );
  await open(owner, "/god/placement");
  await owner.getByTestId("office-counts").waitFor({ timeout: 20000 });
  has("the count by person lists the admin", /Office Admin[\s\S]*\d+ placed/, await text(owner));
  await open(owner, `/god/people/${mia.id}`);
  await owner.getByTestId("place-one").waitFor({ timeout: 20000 });
  has("the owner's own person page offers a move for someone who has a seat", /Move to another tribe/, await text(owner));
  await octx.close();

  // ---- On a phone -------------------------------------------------------------------------------------------------------------------------------------------
  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, admin.email, "/admin/tribes");
    await open(p.page, "/admin/tribes");
    await p.page.getByTestId("tribes-list").waitFor({ timeout: 20000 });
    await noOverflow(p.page, "the tribes page on a phone");
    await open(p.page, `/admin/people/${mia.id}`);
    await p.page.getByTestId("place-one").waitFor({ timeout: 20000 });
    await p.page.getByTestId("place-one-tribe").selectOption(bravo ?? "");
    await p.page.getByTestId("place-one-check").waitFor({ timeout: 20000 });
    await noOverflow(p.page, "a person's page, with the check open, on a phone");
    await shot(p.page, "47-phone");
    await p.ctx.close();
  }

  // Put the shared database back the way this journey found it
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.seasons set status = $2::public.season_status where id = $1", [S, wasStatus]);
  for (const s of setAside) await q.query("update public.seasons set status = $2::public.season_status where id = $1", [s.id, s.status]);
  await q.query("update public.tribes set status = 'approved' where id = any($1::uuid[])", [wasApproved]);
  await q.query("update public.placement_settings set mode = $1", [wasMode]);
  if (wasNotice) await q.query("update public.notice_settings set mode = $1 where group_key = 'admin'", [wasNotice]);

  await browser.close();
  await q.end();
  finish("47-office-placement");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

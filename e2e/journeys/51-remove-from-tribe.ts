/**
 * An admin takes a member out of a tribe, and puts them back, end to end.
 *
 *  - A person who holds no staff role is sent home from a tribe's page in Admin.
 *  - The tribe's page lists its members with a Remove button each. A member with an open care matter has no button (only the Care Lead changes that place).
 *  - Remove asks for a reason of at least 10 characters (the button stays off until then) and for confirmation; "Keep them" changes nothing.
 *  - Removing releases the seat. The member goes back to the pile (a hold, so no automatic run places them for three days), is told by email with no
 *    appeal, and the leader is told too. The tribe's page lists them under "Removed here lately" with the reason the admin wrote.
 *  - The member's own page says they are in no tribe and that the church took them out of one a short while ago; it lists the removal too.
 *  - Put back (from the person's page) returns the seat, lifts the hold, and the tribe's page lists them again.
 *  - The pages do not scroll sideways on a phone, with the confirmation open.
 *
 * What is only arranged here (a season already running, a tribe, seated members, a care matter) is arranged in the database the way the database tests do
 * it; everything a person does is done in the browser. Set E2E_SHOTS=<folder> to keep a picture of each screen.
 */
import type { Page } from "playwright-core";
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

  // ---- Arranging: a running season (week 1), one open tribe with four members, an admin and a plain member --------------------------------------------
  const before = (await one("select id, starts_on::text as starts_on, ends_on::text as ends_on, weeks from public.seasons order by starts_on desc limit 1"))!;
  const S = before.id as string;
  const wasApproved = (await q.query("select id from public.tribes where status = 'approved'")).rows.map((r) => r.id as string);
  const wasStatus = (await one("select status::text as status from public.seasons where id = $1", [S]))!.status as string;
  const setAside = (await q.query("select id, status::text as status from public.seasons where id <> $1 and status in ('planning', 'open', 'running')", [S])).rows as Row[];
  await q.query("update public.seasons set status = 'closed' where id <> $1 and status in ('planning', 'open', 'running')", [S]);
  await q.query("update public.seasons set status = 'running' where id = $1", [S]);
  await k.moveSeason(S, 2);
  await q.query("update public.tribes set status = 'closed' where status = 'approved'");

  const T = await k.tribe(S, { name: "Remove Alpha", track: "builders" });
  const named = async (p: { id: string }, name: string) => {
    await q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [p.id, name, name.split(" ")[0]]);
    return p;
  };
  const amara = await named(await k.seat(T.tribe, S, "Amara Staying"), "Amara Staying");
  const bayo = await named(await k.seat(T.tribe, S, "Bayo Leaving"), "Bayo Leaving");
  const chidi = await named(await k.seat(T.tribe, S, "Chidi Careflag"), "Chidi Careflag");
  await q.query("insert into public.care_flags (tribe_id, person_id, kind, status) values ($1, $2, 'missed_twice', 'open')", [T.tribe, chidi.id]);
  const admin = await k.staff("Remove Admin", "admin");
  await q.query("update public.people set full_name = 'Remove Admin', preferred_name = 'Ada' where id = $1", [admin.id]);
  const plain = await k.person("Plain Member");
  await q.query("delete from public.messages where person_id = any($1::uuid[])", [[amara.id, bayo.id, chidi.id, T.leader.id]]);

  const seatOf = async (person: string) => await one("select status::text as status, release_reason from public.tribe_members where person_id = $1 and tribe_id = $2", [person, T.tribe]);
  const count = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n);

  const browser = await launch();

  // ---- A person with no staff role is sent home -------------------------------------------------------------------------------------------------
  {
    const v = await newPage(browser, "phone");
    await signIn(v.page, plain.email, "/home");
    await open(v.page, `/admin/tribes/${T.tribe}`);
    await v.page.waitForURL((u) => u.pathname === "/home", { timeout: 15000 });
    check(!/Removed here lately/.test(await text(v.page)), "a member without a staff role is sent home from the tribe's page");
    await v.ctx.close();
  }

  // ---- The tribe's page: members, Remove, and the care case without a button --------------------------------------------------------------------------
  const { ctx: actx, page: a } = await newPage(browser, "desktop");
  await signIn(a, admin.email, "/admin/tribes");
  await open(a, `/admin/tribes/${T.tribe}`);
  await a.getByTestId("tribe-members").waitFor({ timeout: 20000 });
  const page = await text(a);
  has("the tribe's page lists its three members", /Amara Staying[\s\S]*Bayo Leaving[\s\S]*Chidi Careflag/, page);
  check((await a.getByTestId(`remove-open-${amara.id}`).count()) === 1 && (await a.getByTestId(`remove-open-${bayo.id}`).count()) === 1, "…each has a Remove button");
  check((await a.getByTestId(`remove-open-${chidi.id}`).count()) === 0, "…except the member with an open care matter");
  has("…who is told only the Care Lead can change that place", /Only the Care Lead can change this place/, await a.getByTestId(`member-${chidi.id}`).innerText());
  has("…and nobody has been removed yet", /Nobody has been taken out of this tribe from Admin/, page);
  await shot(a, "51-members");

  // ---- Keep them: nothing changes ----------------------------------------------------------------------------------------------------------------
  await a.getByTestId(`remove-open-${amara.id}`).click();
  await a.getByTestId(`remove-panel-${amara.id}`).waitFor({ timeout: 10000 });
  has("the confirmation says what will happen", /goes back to the pile of people waiting to be placed[\s\S]*3 days[\s\S]*told kindly by email[\s\S]*put them back, which you can do for 14 days/, await a.getByTestId(`remove-panel-${amara.id}`).innerText());
  await a.getByTestId("remove-cancel").click();
  check((await a.getByTestId(`remove-panel-${amara.id}`).count()) === 0, "Keep them closes the confirmation");
  check((await seatOf(amara.id))?.status === "active", "…and Amara is still in the tribe");

  // ---- Remove Bayo -------------------------------------------------------------------------------------------------------------------------------
  await a.getByTestId(`remove-open-${bayo.id}`).click();
  await a.getByTestId(`remove-panel-${bayo.id}`).waitFor({ timeout: 10000 });
  const confirm = a.getByTestId("remove-confirm");
  check(await confirm.isDisabled(), "the Remove button is off until a reason is written");
  await a.getByTestId("remove-reason").fill("too short");
  check(await confirm.isDisabled(), "…and stays off for a reason under 10 characters");
  await a.getByTestId("remove-reason").fill("Moved to Abuja and asked to step back");
  check(await confirm.isEnabled(), "…and comes on once the reason is long enough");
  await shot(a, "51-confirm");
  await confirm.click();
  await eventually("Bayo's seat is released", async () => (await seatOf(bayo.id))?.status === "released");
  check((await seatOf(bayo.id))?.release_reason === "Removed by the church", "…with the church's own words, not the reason");
  const hold = await one("select source, (until > now() + interval '2 days 23 hours') as three_days from public.placement_holds where person_id = $1", [bayo.id]);
  check(hold?.source === "removal" && hold?.three_days === true, "Bayo is back in the pile, left alone by automatic placement for three days");
  check((await count("select count(*)::int as n from public.removal_blocks where person_id = $1 and tribe_id = $2 and lifted_at is null", [bayo.id, T.tribe])) === 1, "…and this tribe is not offered to him again");
  await a.getByTestId("removed-lately").waitFor({ timeout: 20000 });
  has("the page says it is done", /Bayo Leaving is out of Remove Alpha and back in the pile waiting to be placed/, await text(a));
  has("…lists him under Removed here lately, with the reason the admin wrote", /Bayo Leaving taken out of Remove Alpha by Remove Admin[\s\S]*Reason: Moved to Abuja and asked to step back/, await text(a));
  check((await a.getByTestId(`member-${bayo.id}`).count()) === 0, "…and he is no longer on the members list");
  await shot(a, "51-removed");

  await eventually("he and the leader are written to", async () =>
    (await count("select count(*)::int as n from public.messages where template = 'removal_member_told' and person_id = $1", [bayo.id])) === 1 &&
    (await count("select count(*)::int as n from public.messages where template = 'removal_leader_decided' and person_id = $1", [T.leader.id])) === 1,
  );
  const told = await one("select params from public.messages where template = 'removal_member_told' and person_id = $1", [bayo.id]);
  check(Number((told?.params as Row)?.appeal_days) === 0, "Bayo's email offers no appeal");
  check(!JSON.stringify(await q.query("select params from public.messages where person_id = any($1::uuid[])", [[bayo.id, T.leader.id]]).then((r) => r.rows)).includes("Abuja"), "…and neither email carries the reason");

  // ---- His page --------------------------------------------------------------------------------------------------------------------------------
  await open(a, `/admin/people/${bayo.id}`);
  await a.getByTestId("person-remove-none").waitFor({ timeout: 20000 });
  has("his page says he has no tribe and that the church took him out of one a short while ago", /No tribe yet[\s\S]*took them out of a tribe a short while ago/, await text(a));
  has("…and lists the removal, with Put back", /Taken out of Remove Alpha by Remove Admin/, await text(a));
  await shot(a, "51-person");

  // ---- Put back --------------------------------------------------------------------------------------------------------------------------------
  const removal = await one("select id from public.admin_removals where person_id = $1", [bayo.id]);
  await a.getByTestId(`put-back-${removal?.id}`).click();
  await eventually("Bayo's seat is back", async () => (await seatOf(bayo.id))?.status === "active");
  check((await count("select count(*)::int as n from public.placement_holds where person_id = $1", [bayo.id])) === 0, "Put back lifts the hold");
  check((await count("select count(*)::int as n from public.removal_blocks where person_id = $1 and lifted_at is null", [bayo.id])) === 0, "…and the block on the tribe");
  await eventually("he and the leader are told", async () =>
    (await count("select count(*)::int as n from public.messages where template = 'removal_member_reinstated' and person_id = $1", [bayo.id])) === 1,
  );
  await a.getByText(/Bayo Leaving is back in Remove Alpha/).waitFor({ timeout: 20000 });
  await open(a, `/admin/tribes/${T.tribe}`);
  await a.getByTestId(`member-${bayo.id}`).waitFor({ timeout: 20000 });
  has("the tribe's page lists him again, and says the removal was put back", /Bayo Leaving[\s\S]*Put back on/, await text(a));

  // ---- From a person's page, and on a phone -------------------------------------------------------------------------------------------------------
  await open(a, `/admin/people/${amara.id}`);
  await a.getByTestId("person-remove-open").waitFor({ timeout: 20000 });
  has("Amara's page offers Remove from this tribe", /Amara Staying is in Remove Alpha/, await text(a));
  await open(a, `/admin/people/${chidi.id}`);
  await a.getByTestId("person-remove-care").waitFor({ timeout: 20000 });
  check((await a.getByTestId("person-remove-open").count()) === 0, "the member with a care matter has no Remove on their page either");
  await actx.close();

  {
    const p = await newPage(browser, "phone");
    await signIn(p.page, admin.email, "/admin/tribes");
    await open(p.page, `/admin/tribes/${T.tribe}`);
    await p.page.getByTestId("tribe-members").waitFor({ timeout: 20000 });
    await noOverflow(p.page, "the tribe's page on a phone");
    await p.page.getByTestId(`remove-open-${amara.id}`).click();
    await p.page.getByTestId(`remove-panel-${amara.id}`).waitFor({ timeout: 10000 });
    await noOverflow(p.page, "the tribe's page with the confirmation open, on a phone");
    await shot(p.page, "51-phone");
    await p.ctx.close();
  }

  // Put the shared database back the way this journey found it
  await q.query("update public.seasons set starts_on = $2, ends_on = $3, weeks = $4 where id = $1", [S, before.starts_on, before.ends_on, before.weeks]);
  await q.query("update public.seasons set status = $2::public.season_status where id = $1", [S, wasStatus]);
  for (const s of setAside) await q.query("update public.seasons set status = $2::public.season_status where id = $1", [s.id, s.status]);
  await q.query("update public.tribes set status = 'approved' where id = any($1::uuid[])", [wasApproved]);

  await browser.close();
  await q.end();
  finish("51-remove-from-tribe");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

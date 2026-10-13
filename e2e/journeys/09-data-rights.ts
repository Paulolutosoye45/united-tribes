/**
 * A member's rights over their own data, end to end. A member downloads a copy of everything held about them (the
 * private notes, sealed with keys only the app has, are opened for them in the file and nowhere else), asks for their
 * account to be deleted and takes the request back, asks again. The office sees the request with what a deletion would
 * touch, says "not yet" with a reason the member reads, then erases the account after typing the person's address to
 * confirm. A leader cannot be erased while they lead a tribe; only the office can reach the screen; a request made by
 * email can be written down. The member's browser, which still holds a valid sign-in, is signed out cleanly instead of
 * going round in tribes, and the same address can start again as a new member.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { SEALING_KEY } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, text } from "../lib";

type Row = Record<string, unknown>;

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();

/** Set E2E_SHOTS=<folder> to keep a picture of each screen as it is reached (for looking at, not for checking). */
const shot = async (page: Page, name: string) => {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** Seals a note the way the app does (AES-256-GCM, the owner bound in), so the file can be checked against the real thing. */
function sealed(plain: string, context: string): string {
  const [id, b64] = SEALING_KEY.split(":");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(b64, "base64"), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
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
  const { tribe, leader } = await k.tribe(S, { name: "Folu’s tribe" });
  const folu = await k.seat(tribe, S, "Folu");
  const sunny = await k.seat(tribe, S, "Sunny");
  await k.meetings(tribe, leader.id, 2, [[folu.id, 2], [sunny.id, 1]]);
  await q.query("update public.member_profiles set story = 'I run a small bakery and my twins are three.' where person_id = $1", [folu.id]);
  await q.query("update public.member_profiles set story = 'SUNNY-PRIVATE-STORY' where person_id = $1", [sunny.id]);
  await q.query("update public.member_profiles set support_enc = $2, leader_note_enc = $3 where person_id = $1", [
    folu.id,
    sealed(JSON.stringify({ chips: ["quiet", "childcare"], note: "Evenings are hard with the twins." }), `support:${folu.id}`),
    sealed("Please call me Folu, not Folunsho.", `leadernote:${folu.id}`),
  ]);
  const leaderName = (await one("select full_name from public.people where id = $1", [leader.id]))!.full_name as string;

  // --- 1. a copy of everything held ----------------------------------------------------------------------------------------
  const member = await newPage(browser);
  await signIn(member.page, folu.email, "/profile");
  await open(member.page, "/profile");
  check(await heading(member.page, "Your data").isVisible(), "the profile has a section for the member’s own data");
  await noOverflow(member.page, "the profile page on a phone");
  await shot(member.page, "profile-data");

  const waiting = member.page.waitForEvent("download");
  await member.page.getByRole("link", { name: "Download my data" }).click();
  const download = await waiting;
  check(/^my-united-tribes-data-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), "the download is a dated file");
  const raw = fs.readFileSync((await download.path())!, "utf8");
  const file = JSON.parse(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  check(Object.keys(file)[0] === "about_this_file" && /copy of what United Tribes holds/.test(file.about_this_file), "the file starts by saying what it is");
  check(file.you?.email === folu.email && file.you?.name === "Folu Test", "…and is about the person who asked");
  check(/small bakery/.test(file.form_answers?.story ?? "") && file.tribes?.[0]?.tribe === "Folu’s tribe", "…with their answers and their tribe");
  check(file.attendance?.filter((a: Row) => a.status === "present").length === 2, "…and their attendance");
  check(
    file.your_private_notes?.what_would_help_care_for_you?.chosen?.includes("A quieter, smaller tribe") &&
      file.your_private_notes?.what_would_help_care_for_you?.in_your_words === "Evenings are hard with the twins." &&
      file.your_private_notes?.note_to_your_leader === "Please call me Folu, not Folunsho.",
    "the private notes are opened for them, in words",
  );
  check(!raw.includes(sunny.email) && !raw.includes("SUNNY-PRIVATE-STORY") && !raw.includes("support_enc") && !raw.includes(sealed("x", "y").split(".")[0] + "."), "…and nothing of anyone else’s, and none of the sealed text");

  const cookies = (await member.ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const crossSite = await fetch(`${BASE}/profile/data`, { headers: { cookie: cookies, "sec-fetch-site": "cross-site" }, redirect: "manual" });
  check(crossSite.status === 403, "another website cannot make a signed-in visitor’s browser fetch the file");
  const visitor = await fetch(`${BASE}/profile/data`, { redirect: "manual" });
  check([302, 303, 307, 308].includes(visitor.status) && /\/sign-in/.test(visitor.headers.get("location") ?? ""), "someone who is not signed in is sent to sign in, and gets no file");
  const same = await fetch(`${BASE}/profile/data`, { headers: { cookie: cookies, "sec-fetch-site": "same-origin" } });
  check(same.status === 200 && /no-store/.test(same.headers.get("cache-control") ?? "") && /attachment/.test(same.headers.get("content-disposition") ?? ""), "…and the file is never cached");

  // --- 2. asking for the account to be deleted --------------------------------------------------------------------------------
  await member.page.getByRole("button", { name: "Ask for my account to be deleted" }).click();
  const warning = await text(member.page);
  check(/can’t be undone/.test(warning) && /church office looks at each request first/.test(warning), "the request says it cannot be undone, and that the office answers it");
  await member.page.getByLabel("Anything you would like the office to know").fill("I am moving abroad.");
  await shot(member.page, "profile-ask");
  await member.page.getByRole("button", { name: "Send my request" }).click();
  await member.page.getByText("You have asked for your account to be deleted").waitFor({ timeout: 15000 });
  check(/The church office will look at it/.test(await text(member.page)), "once sent, the page says it is waiting");
  const asked = await one("select status, note, by_office from public.erasure_requests where person_id = $1", [folu.id]);
  check(asked?.status === "open" && asked.note === "I am moving abroad." && asked.by_office === false, "the request is recorded with their note");
  check((await one("select 1 from public.people where id = $1", [folu.id])) !== undefined, "…and nothing has been deleted yet");

  await member.page.getByRole("button", { name: "I’ve changed my mind" }).click();
  await member.page.getByRole("button", { name: "Ask for my account to be deleted" }).waitFor({ timeout: 15000 });
  check((await one("select 1 from public.erasure_requests where person_id = $1", [folu.id])) === undefined, "taking the request back removes it");
  await member.page.getByRole("button", { name: "Ask for my account to be deleted" }).click();
  await member.page.getByLabel("Anything you would like the office to know").fill("I am moving abroad.");
  await member.page.getByRole("button", { name: "Send my request" }).click();
  await member.page.getByText("You have asked for your account to be deleted").waitFor({ timeout: 15000 });

  // --- 3. the office ---------------------------------------------------------------------------------------------------------
  const office = await newPage(browser, "desktop");
  await signIn(office.page, "admin.mary@example.org", "/admin");
  await open(office.page, "/admin");
  await office.page.getByRole("link", { name: /Data requests/ }).click();
  await office.page.waitForURL(/\/admin\/privacy/, { timeout: 15000 });
  await heading(office.page, "Data requests").waitFor();
  const card = office.page.getByRole("article", { name: "Request from Folu Test" });
  await card.waitFor({ timeout: 15000 });
  const read = await card.innerText();
  check(read.includes(folu.email) && /I am moving abroad\./.test(read), "the office sees who asked, and what they wrote");
  check(/Deleting would remove/.test(read) && /1 tribe/.test(read), "…and what deleting them would take with it");
  check(await card.getByRole("button", { name: /Delete their account/ }).isEnabled(), "…and can go ahead");
  await shot(office.page, "privacy-queue");

  // not yet, with a reason
  await card.getByRole("button", { name: /Say not now/ }).click();
  const send = card.getByRole("button", { name: "Send my answer" });
  check(await send.isDisabled(), "an answer needs a reason");
  await card.getByLabel(/Why not yet/).fill("You lead a prayer team. Please hand it over first, then ask again.");
  await send.click();
  await office.page.getByText(/Your answer to Folu Test has been saved/).waitFor({ timeout: 15000 });
  // The notice shows at once; the list refreshes from the server a moment later.
  const keptBelow = await office.page.getByRole("heading", { name: "Answered: not now" }).waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(keptBelow, "the answer is kept below, out of the way");
  const declined = await one("select status, decision_note from public.erasure_requests where person_id = $1", [folu.id]);
  check(declined?.status === "declined" && /prayer team/.test(String(declined.decision_note)), "…with the reason");

  await open(member.page, "/profile");
  const said = await text(member.page);
  check(/could not delete your account yet/.test(said) && /hand it over first/.test(said), "the member reads the reason on their profile");
  await shot(member.page, "profile-declined");
  await member.page.getByRole("button", { name: "Ask again" }).click();
  await member.page.getByText("You have asked for your account to be deleted").waitFor({ timeout: 15000 });
  check(true, "…and can ask again");

  // a leader cannot be erased while they lead a tribe
  await q.query("insert into public.erasure_requests (person_id, centre_id, note) values ($1, $2, 'Stepping away')", [leader.id, k.centreId]);
  await open(office.page, "/admin/privacy");
  const leaderCard = office.page.getByRole("article", { name: `Request from ${leaderName}` });
  await leaderCard.waitFor({ timeout: 15000 });
  check(/They lead a tribe/.test(await leaderCard.innerText()), "someone who leads a tribe is shown with the reason they cannot be erased yet");
  check(await leaderCard.getByRole("button", { name: /Delete their account/ }).isDisabled(), "…and the button is switched off");
  await q.query("delete from public.erasure_requests where person_id = $1", [leader.id]);

  // a request made by email is written down
  await open(office.page, "/admin/privacy");
  await office.page.getByLabel("Their sign-in email address").fill(sunny.email);
  await office.page.getByLabel("What they said").fill("Asked by email on Monday.");
  await office.page.getByRole("button", { name: "Write it down" }).click();
  await office.page.getByText(/Written down\. It now waits above/).waitFor({ timeout: 15000 });
  const sunnyCard = office.page.getByRole("article", { name: "Request from Sunny Test" });
  await sunnyCard.waitFor({ timeout: 15000 });
  check(/Written down by the office/.test(await sunnyCard.innerText()), "a request made another way joins the same list, marked as written down by the office");
  await office.page.getByLabel("Their sign-in email address").fill("nobody.here@example.org");
  await office.page.getByRole("button", { name: "Write it down" }).click();
  await office.page.getByRole("alert").filter({ hasText: /No one in this centre has signed in with that email address/ }).waitFor({ timeout: 15000 });
  check(true, "an address nobody signed in with is explained in plain words");
  await q.query("delete from public.erasure_requests where person_id = $1", [sunny.id]);

  // only the office may open it
  const pastor = await newPage(browser, "desktop");
  await signIn(pastor.page, "pastor.ife@example.org", "/admin/privacy");
  await pastor.page.waitForURL(/\/home/, { timeout: 15000 });
  check(true, "a pastor who opens the page is sent home");
  await open(pastor.page, "/admin");
  check((await pastor.page.getByRole("link", { name: /Data requests/ }).count()) === 0, "…and the Admin hub does not offer it to them");
  await pastor.ctx.close();
  const plain = await newPage(browser);
  await signIn(plain.page, "member@example.org", "/admin/privacy");
  await plain.page.waitForURL(/\/home/, { timeout: 15000 });
  check(true, "neither does an ordinary member get in");
  await plain.ctx.close();

  // --- 4. erasing -----------------------------------------------------------------------------------------------------------
  await open(office.page, "/admin/privacy");
  const foluCard = office.page.getByRole("article", { name: "Request from Folu Test" });
  await foluCard.waitFor({ timeout: 15000 });
  await foluCard.getByRole("button", { name: /Delete their account/ }).click();
  const confirm = foluCard.getByRole("button", { name: "Delete the account" });
  check(await confirm.isDisabled(), "erasing starts switched off");
  await foluCard.getByLabel("Their email address").fill("someone.else@example.org");
  check(await confirm.isDisabled(), "…and stays off for the wrong address");
  await foluCard.getByLabel("Their email address").fill(folu.email.toUpperCase());
  await shot(office.page, "privacy-confirm");
  check(await confirm.isEnabled(), "…and comes on only once the person’s own address has been typed");
  await confirm.click();
  await office.page.getByText("Folu Test’s account has been deleted.").waitFor({ timeout: 15000 });
  // The message and the refreshed list arrive in two beats; give the list a moment to follow.
  await foluCard.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  check(await foluCard.count() === 0, "the request leaves the list");

  check((await one("select 1 from auth.users where id = $1", [folu.id])) === undefined && (await one("select 1 from public.people where id = $1", [folu.id])) === undefined, "the account and the person are gone from the database");
  check((await one("select 1 from public.member_profiles where person_id = $1", [folu.id])) === undefined && (await all("select 1 from public.tribe_attendance where person_id = $1", [folu.id])).length === 0, "…with their answers and attendance");
  check((await all("select 1 from public.tribe_attendance where person_id = $1", [sunny.id])).length === 2 && (await one("select story from public.member_profiles where person_id = $1", [sunny.id]))?.story === "SUNNY-PRIVATE-STORY", "…and nobody else’s");
  check((await one("select 1 from public.tribes where id = $1", [tribe])) !== undefined, "the tribe is still there");
  const event = await one("select actor_id, meta from public.event_log where action = 'person.erased' and entity_id = $1", [folu.id]);
  check(!!event && JSON.stringify(event.meta) === '{"asked_by_office":false}', "the log keeps that it happened, and nothing about who");
  check(!JSON.stringify(await all("select * from public.event_log")).includes(folu.email), "…and their email address is nowhere in it");

  // --- 5. the browser that still holds their sign-in ------------------------------------------------------------------------
  // With the stand-in sign-in service the deleted person's token is refused outright, so they are just asked to sign in.
  await member.page.goto(`${BASE}/profile`);
  await member.page.waitForURL(/\/sign-in/, { timeout: 15000 });
  check(await member.page.getByLabel("Email address").isVisible(), "their open browser is taken to sign in, not left going round in tribes");
  await shot(member.page, "signed-out-ended");

  // A real sign-in service keeps vouching for the token until it expires (up to an hour), so the person's browser arrives
  // with a valid sign-in and no member behind it. Simulate that: remove only the member row and keep the account.
  const ghost = await k.person("Ghost");
  const ghostCtx = await newPage(browser);
  await signIn(ghostCtx.page, ghost.email, "/home");
  await q.query("delete from public.people where id = $1", [ghost.id]);
  await ghostCtx.page.goto(`${BASE}/profile`);
  await ghostCtx.page.waitForURL(/\/sign-in\?ended=1/, { timeout: 15000 });
  check(/That account is no longer here/.test(await text(ghostCtx.page)), "a valid sign-in with no member behind it is signed out with a plain explanation");
  await ghostCtx.page.goto(`${BASE}/home`);
  await ghostCtx.page.waitForURL(/\/sign-in/, { timeout: 15000 });
  check(!/ended=1/.test(ghostCtx.page.url()), "…and is simply asked to sign in from then on");
  await ghostCtx.ctx.close();

  await signIn(member.page, folu.email, "/profile");
  await open(member.page, "/profile");
  check(/We don’t hold any answers from you yet\./.test(await text(member.page)), "the same address can start again, as a new member with nothing held");
  const again = await one("select id from public.people where lower(email) = lower($1)", [folu.email]);
  check(!!again && again.id !== folu.id, "…under a new account");

  await office.ctx.close();
  await member.ctx.close();
  await q.end();
  await browser.close();
  finish("09-data-rights");
}
void main();

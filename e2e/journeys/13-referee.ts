/**
 * Proving the referee is the person named, end to end.
 *
 * A pastor uploads the church's messy spreadsheet from the Admin page (a title row, odd column names, three sheets, a role the system
 * cannot read), sees exactly what it would change, applies it, undoes it, applies it again, and updates it with a second file.
 * An applicant presses "Send request": the link and the code go to the referee's own email or WhatsApp and are nowhere on the
 * applicant's screen. The pastor on the list is recognised once the code is right. A second referee answers on the applicant's own
 * browser: the reference is held, a pastor looks at it, and the care team's call-back closes it. A reference given before the
 * check is re-confirmed by its referee, who says it was not theirs, and the care team hears of it. A wrong code five times locks.
 *
 * Set E2E_SHOTS=1 to keep a picture of the main screens in .e2e/shots, for looking at.
 */
import path from "node:path";
import type { Browser, Page } from "playwright-core";
import { kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import { MESSAGING } from "../env";
import { BASE, check, db, finish, launch, newPage, noOverflow, open, signIn, state, text } from "../lib";

type Row = Record<string, unknown>;
type Sent = { channel: string; body: Record<string, unknown> };

const heading = (page: Page, name: string | RegExp) => page.getByRole("heading", { name }).first();
const tid = (page: Page, id: string) => page.getByTestId(id);

async function shot(page: Page, name: string) {
  if (!process.env.E2E_SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `.e2e/shots/${name}.png`, fullPage: true });
}

async function tick() {
  const r = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${MESSAGING.cronSecret}` } });
  if (!r.ok) throw new Error(`tick answered ${r.status}`);
  return (await r.json()) as { problems: string[] };
}

const sent = async (channel: "email" | "whatsapp") => (await (await fetch(`${state().stubUrl}/__sent?channel=${channel}`)).json()) as Sent[];
const mailTo = async (to: string) => (await sent("email")).filter((m) => (m.body.to as string[]).includes(to)).map((m) => ({ subject: String(m.body.subject), text: String(m.body.text) }));
const whatsappTo = async (digits: string) => (await sent("whatsapp")).filter((m) => String(m.body.to) === digits).map((m) => JSON.stringify(m.body));

const LINK = /\/reference\/([a-f0-9]{64})/;

/** The heartbeat sends what is waiting; then the newest message to this person is read. */
async function newest(kind: "email" | "phone", to: string): Promise<string> {
  await tick();
  if (kind === "email") {
    const all = await mailTo(to);
    return all.map((m) => `${m.subject}\n${m.text}`).at(-1) ?? "";
  }
  return (await whatsappTo(to)).at(-1) ?? "";
}

const csv = (lines: string[]) => ({ name: "pastors.csv", mimeType: "text/csv", buffer: Buffer.from(lines.join("\n"), "utf8") });

async function main() {
  const q = await db();
  const one = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows[0] as Row | undefined;
  const many = async (sql: string, args: unknown[] = []) => (await q.query(sql, args)).rows as Row[];
  const count = async (sql: string, args: unknown[] = []) => Number((await one(sql, args))?.n);
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
  const browser = await launch();

  const pastor = await k.staff("Pastor Wale Ojo", "pastor");
  const carer = await k.staff("Carol Care", "care_lead");

  // A referee's own browser comes from its own network, so it is not mistaken for the applicant's
  const refereeBrowser = async (b: Browser, ip: string) => {
    const r = await newPage(b);
    await r.ctx.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    return r;
  };

  // The honest referee takes their time over the four questions; the database reads the clock
  const tookTheirTime = (refId: string) => q.query("update public.referee_trust set verified_at = now() - interval '5 minutes', form_seen_at = now() - interval '5 minutes' where reference_id = $1", [refId]);
  const rate = async (page: Page) => {
    for (const id of ["reliability", "warmth", "confidentiality", "maturity"]) await page.locator(`label:has(input[name="rate-${id}"][value="4"])`).click();
    await page.locator("label", { hasText: "No concern" }).first().click();
  };
  const confirmWithCode = async (page: Page, kind: "email" | "phone", to: string) => {
    await tid(page, "referee-send-code").click();
    await tid(page, "referee-code").waitFor({ timeout: 15000 });
    const message = await newest(kind, to);
    const code = /\b(\d{6})\b/.exec(kind === "email" ? message.split("\n")[0] : message.replace(/ut_[a-z_0-9]+/g, ""))?.[1] ?? "";
    check(/^\d{6}$/.test(code), `the code arrived at the referee's own ${kind === "email" ? "email" : "WhatsApp"}`);
    return code;
  };

  // ============================================================================================================================
  // 1. The pastor uploads the church's spreadsheet
  // ============================================================================================================================
  const office = await newPage(browser, "desktop", { expectStatuses: [422] }); // a turned-back file is a 422, which the browser logs
  await signIn(office.page, pastor.email, "/admin/referees");
  await heading(office.page, "Pastors and unit heads").waitFor({ timeout: 20000 });
  check((await tid(office.page, "ov-on").textContent())?.trim() === "0", "the list starts empty");
  check(await tid(office.page, "uploader").isVisible(), "the upload box is the first thing on the page");
  check((await tid(office.page, "dl-template-xlsx").getAttribute("href"))?.includes("kind=template") === true, "a template can be downloaded");
  await shot(office.page, "referees-empty");

  // the template and the export are real files
  const dl = await office.page.request.get(`${BASE}/api/referees/file?kind=template&format=xlsx`);
  const bytes = Buffer.from(await dl.body());
  check(dl.ok() && bytes.subarray(0, 2).toString() === "PK" && /spreadsheetml/.test(dl.headers()["content-type"] ?? ""), "the template downloads as an Excel file");
  const crossSite = await office.page.request.get(`${BASE}/api/referees/file?kind=template&format=csv`, { headers: { "sec-fetch-site": "cross-site" } });
  check(crossSite.status() === 403, "another site cannot trigger a download for a signed-in pastor");

  const fixture = path.resolve("tests/fixtures/referee/excel-style.xlsx");
  await office.page.getByTestId("file-input").setInputFiles(fixture);
  await tid(office.page, "upload-review").waitFor({ timeout: 20000 });
  check((await tid(office.page, "file-name").textContent())?.includes("excel-style.xlsx") === true, "the page says which file it read");
  check((await text(office.page)).includes("Pastors & Unit Heads"), "…and which sheet it chose, out of the three in the file");
  check((await office.page.locator("#sheet-pick option").count()) === 2, "…with the other sheet one tap away (the hidden one is not offered)");
  check(Number(await tid(office.page, "count-add").textContent()) === 6 && Number(await tid(office.page, "count-error").textContent()) === 1, "six people are new and one can’t be used");
  check(await tid(office.page, "role-fallback").isVisible(), "the role it could not read gets a question, not a guess");
  check((await text(office.page)).includes("Their role says “Deacon”"), "…and the row says what the role cell said");
  check((await text(office.page)).includes("Row 7"), "…and which row of the spreadsheet it is");
  check((await count("select count(*)::int as n from public.referee_directory")) === 0, "nothing has changed yet");
  await shot(office.page, "referees-review");

  await office.page.locator("#fallback-pick").selectOption("unit_head");
  await office.page.waitForFunction(() => document.querySelector('[data-testid="count-error"]')?.textContent === "0", null, { timeout: 15000 });
  check(Number(await tid(office.page, "count-add").textContent()) === 7, "choosing what to call that role brings the seventh person in");

  await office.page.locator('label.choice:has(input[name="mode"][value="replace"])').click();
  await office.page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, { timeout: 15000 });
  check(Number(await tid(office.page, "count-retire").textContent()) === 0, "“Replace the list” on an empty list takes nobody off");
  await office.page.locator('label.choice:has(input[name="mode"][value="update"])').click();
  await office.page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, null, { timeout: 15000 });

  await tid(office.page, "upload-apply").click();
  await tid(office.page, "upload-done").waitFor({ timeout: 20000 });
  check(/7 added/.test((await tid(office.page, "done-line").textContent()) ?? ""), "applying says how many were added");
  const listed = await many("select name, standing, active from public.referee_directory order by name");
  check(listed.length === 7 && listed.every((r) => r.active), "seven people are on the church’s list");
  check(listed.find((r) => String(r.name).includes("Sam Eze"))?.standing === "unit_head", "…and the unclear role became what the pastor chose");
  check((await count("select count(*)::int as n from public.referee_directory_contacts where kind = 'email'")) >= 4, "emails and phone numbers were read from the cells, including two in one cell");
  check((await count("select count(*)::int as n from public.referee_directory_contacts where value like '+234%'")) >= 6, "…and every Nigerian number was written the one way");
  await office.page.getByTestId("person").first().waitFor({ timeout: 15000 });
  check((await office.page.getByTestId("person").count()) === 7, "the list on the page shows all seven");
  check((await text(office.page)).includes("ife@church.org"), "…with their contacts");
  await shot(office.page, "referees-done");

  await tid(office.page, "upload-undo").click();
  await office.page.getByText("The list is back as it was before that upload.").waitFor({ timeout: 15000 });
  check((await count("select count(*)::int as n from public.referee_directory")) === 0, "undo puts the list back exactly as it was");

  await office.page.getByTestId("file-input").setInputFiles(fixture);
  await tid(office.page, "upload-review").waitFor({ timeout: 20000 });
  await office.page.locator("#fallback-pick").selectOption("unit_head");
  await office.page.waitForFunction(() => document.querySelector('[data-testid="count-error"]')?.textContent === "0", null, { timeout: 15000 });
  await tid(office.page, "upload-apply").click();
  await tid(office.page, "upload-done").waitFor({ timeout: 20000 });
  check((await count("select count(*)::int as n from public.referee_directory where active")) === 7, "the same file can be uploaded again after an undo");

  // The next update: a changed number, one person taken off, one new person. Nobody is added twice.
  await tid(office.page, "upload-another").click();
  await office.page.getByTestId("file-input").setInputFiles(
    csv([
      "Name,Role,Unit,Phone,Email,Active",
      "Pastor Ife Adeyemi,Pastor,Ota Central,0803 111 2222,ife@church.org,Yes",
      "Bro Tunde Bello,Unit head,Ushers,0809 999 8888,tunde@church.org,Yes",
      "Chi Okoro,Unit head,Choir,0905 444 5555,,No",
      "Pastor Wale Ojo,Pastor,Iganmu,,wale.pastor@example.org,Yes",
    ]),
  );
  await tid(office.page, "upload-review").waitFor({ timeout: 20000 });
  const [a, u, r] = [await tid(office.page, "count-add").textContent(), await tid(office.page, "count-update").textContent(), await tid(office.page, "count-retire").textContent()];
  check(a === "1" && u === "1" && r === "1", `the preview says one new, one updated, one taken off (${a}/${u}/${r})`);
  check((await office.page.locator('[data-testid="preview-list"] [data-action="retire"]').count()) === 1, "…and shows each of them by name");
  await tid(office.page, "upload-apply").click();
  await tid(office.page, "upload-done").waitFor({ timeout: 20000 });
  check((await count("select count(*)::int as n from public.referee_directory where active")) === 7, "still seven are on the list: one taken off, one added");
  check((await one("select active from public.referee_directory where name ilike '%Chi Okoro%'"))?.active === false, "the person marked “No” is off the list, not deleted");
  check((await count("select count(*)::int as n from public.referee_directory_contacts c join public.referee_directory e on e.id = c.entry_id where e.name like 'Bro. Tunde%' or e.name like 'Bro Tunde%'")) >= 4, "Tunde kept his old numbers and gained the new one");

  // A wrong file must not empty the list: a big removal needs a tick in a box
  for (let i = 0; i < 12; i++) await q.query("insert into public.referee_directory (name, standing) values ($1, 'unit_head')", [`Filler ${i}`]);
  await tid(office.page, "upload-another").click();
  await office.page.getByTestId("file-input").setInputFiles(csv(["Name,Role,Phone", "Pastor Ife Adeyemi,Pastor,0803 111 2222"]));
  await tid(office.page, "upload-review").waitFor({ timeout: 20000 });
  await office.page.locator('label.choice:has(input[name="mode"][value="replace"])').click();
  await tid(office.page, "retire-confirm").waitFor({ timeout: 15000 });
  check(await tid(office.page, "upload-apply").isDisabled(), "a replace that would take most of the list off is held until it is ticked");
  await tid(office.page, "retire-checkbox").check();
  check(await tid(office.page, "upload-apply").isEnabled(), "…and then it can go ahead");
  await tid(office.page, "upload-cancel").click();
  await q.query("delete from public.referee_directory where name like 'Filler %'");
  check((await count("select count(*)::int as n from public.referee_directory where active")) === 7, "cancelling changed nothing");

  // the wrong kind of file is turned back with a plain reason
  await office.page.getByTestId("file-input").setInputFiles({ name: "list.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  check((await tid(office.page, "upload-error").textContent())?.includes("isn’t a spreadsheet") === true, "a PDF is turned back kindly");
  await office.page.getByTestId("file-input").setInputFiles({ name: "junk.csv", mimeType: "text/csv", buffer: Buffer.from("hello\nthere") });
  await tid(office.page, "upload-error").waitFor({ timeout: 15000 });
  check((await tid(office.page, "upload-error").textContent())?.includes("couldn’t find the columns") === true, "a sheet with no columns we know says so, and points at the template");

  // the list can be searched and a person fixed by hand
  await open(office.page, "/admin/referees?q=tunde");
  check((await office.page.getByTestId("person").count()) === 1, "searching finds a person by name");
  await office.page.getByTestId("edit-person").click();
  await office.page.getByRole("textbox", { name: /^Unit\b/ }).fill("Ushers and Protocol");
  await office.page.getByRole("button", { name: "Save", exact: true }).click();
  await office.page.getByText("Ushers and Protocol").first().waitFor({ timeout: 15000 });
  check((await one("select unit from public.referee_directory where name like '%Tunde%'"))?.unit === "Ushers and Protocol", "a person can be corrected without uploading anything");
  check((await count("select count(*)::int as n from public.referee_import_batches where status = 'applied'")) === 2 && (await count("select count(*)::int as n from public.referee_import_batches where status = 'undone'")) === 1, "each upload is on record, the undone one marked as undone");

  // the same screen on a phone
  const phoneOffice = await newPage(browser);
  await signIn(phoneOffice.page, pastor.email, "/admin/referees");
  await heading(phoneOffice.page, "Pastors and unit heads").waitFor({ timeout: 20000 });
  await noOverflow(phoneOffice.page, "the list page on a phone");
  await phoneOffice.page.getByTestId("file-input").setInputFiles(fixture);
  await tid(phoneOffice.page, "upload-review").waitFor({ timeout: 20000 });
  await noOverflow(phoneOffice.page, "the upload preview on a phone");
  await shot(phoneOffice.page, "referees-review-phone");
  await phoneOffice.ctx.close();

  // ============================================================================================================================
  // 2. An applicant asks her referees, and never holds the link
  // ============================================================================================================================
  const ngozi = await k.person("Ngozi Okafor");
  const app = (await one("insert into public.leader_applications (person_id, status, answers, consent_version, submitted_at) values ($1, 'submitted', '{}'::jsonb, '2026-10-v1', now()) returning id", [ngozi.id]))!.id as string;
  const ref = async (slot: number, name: string, contact: string, head: boolean) =>
    (await one(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at)
       values ($1, $2, $3, 'Pastor at my church', $4, $5, md5(gen_random_uuid()::text), now() + interval '30 days') returning id`,
      [app, slot, name, contact, head],
    ))!.id as string;
  const ife = await ref(1, "Pastor Ife Adeyemi", "ife@church.org", true);
  const bola = await ref(2, "Sister Bola Ade", "0805 123 9999", false);

  const me = await newPage(browser);
  await signIn(me.page, ngozi.email, "/lead");
  await tid(me.page, "referees").waitFor({ timeout: 20000 });
  check((await me.page.getByTestId("referee-1").count()) === 1 && (await me.page.getByTestId("referee-2").count()) === 1, "both referees are on her page");
  check(!(/\/reference\/[a-f0-9]{20}/.test(await me.page.content())), "no link to any referee’s page is anywhere in what she is sent");
  check((await tid(me.page, "referee-line-1").textContent())?.includes("Nothing sent to Pastor Ife yet") === true, "each card says nothing has been sent yet");
  await noOverflow(me.page, "the referee cards on a phone");
  await shot(me.page, "applicant-referees-before");

  await tid(me.page, "referee-send-1").click();
  await me.page.waitForSelector('[data-testid="referee-1"][data-stage="sending"]', { timeout: 15000 });
  check((await tid(me.page, "referee-line-1").textContent())?.includes("Sending Pastor Ife") === true, "pressing it says the request is going");
  const queued = await one("select params from public.messages where template = 'referee_request' order by created_at desc limit 1");
  check(Object.keys(queued?.params as Row).sort().join() === "contact,reference_id", "the queued message carries no link: only who it is for");
  check(!(JSON.stringify(queued).match(/[a-f0-9]{64}/)), "…and no secret of any kind");

  const first = await newest("email", "ife@church.org");
  const token1 = LINK.exec(first)?.[1] ?? "";
  check(/^[a-f0-9]{64}$/.test(token1), "the link reached the referee’s own email");
  const gone = await one("select status, params::text as params from public.messages where template = 'referee_request' order by created_at desc limit 1");
  check(gone?.status === "sent" && !String(gone.params).includes(token1), "…and once sent the outbox no longer holds it");
  await open(me.page, "/lead");
  check((await tid(me.page, "referee-badge-1").textContent())?.includes("Sent") === true, "her page now says Sent");
  check(!(await me.page.content()).includes(token1), "…and still not the link");

  // ============================================================================================================================
  // 3. Pastor Ife, who is on the church's list, answers on his own phone
  // ============================================================================================================================
  const ifeRef = await refereeBrowser(browser, "102.89.10.1");
  await open(ifeRef.page, `/reference/${token1}`);
  await tid(ifeRef.page, "referee-ask").waitFor({ timeout: 15000 });
  check((await tid(ifeRef.page, "referee-masked").textContent())?.includes("i•••@church.org") === true, "the referee sees where the code will go, with most of it hidden");
  check(!(await ifeRef.page.getByLabel("Their email").count()), "…and there is nowhere to type a different address");
  check(await heading(ifeRef.page, /A reference for Ngozi/).isVisible(), "the page names who the reference is for");
  await noOverflow(ifeRef.page, "the referee’s first page on a phone");
  await shot(ifeRef.page, "referee-ask");
  await open(me.page, "/lead");
  check((await tid(me.page, "referee-badge-1").textContent())?.includes("Opened") === true, "Ngozi’s page now says Opened");

  const code1 = await confirmWithCode(ifeRef.page, "email", "ife@church.org");
  await shot(ifeRef.page, "referee-code");
  const wrong = code1 === "000000" ? "111111" : "000000";
  await ifeRef.page.getByLabel("Six-digit code").fill(wrong);
  await tid(ifeRef.page, "referee-error").waitFor({ timeout: 15000 });
  check((await tid(ifeRef.page, "referee-error").textContent())?.includes("4 tries left") === true, "a wrong code says how many tries are left");
  await ifeRef.page.getByLabel("Six-digit code").fill(code1);
  await tid(ifeRef.page, "referee-confirmed").waitFor({ timeout: 20000 });
  check((await tid(ifeRef.page, "referee-confirmed").textContent())?.includes("Pastor Ife Adeyemi, Ota Central") === true, "the right code opens the questions, and he is known from the church’s list");
  await tookTheirTime(ife);
  await rate(ifeRef.page);
  await ifeRef.page.getByRole("button", { name: "Send my reference" }).click();
  await heading(ifeRef.page, /Thank you, Pastor Ife/).waitFor({ timeout: 20000 });
  const trust1 = await one("select verification, standing from public.referee_trust where reference_id = $1", [ife]);
  check(trust1?.verification === "directory" && trust1?.standing === true, "he counts as a pastor because the system found him on the list, not because a box was ticked");
  check((await count("select count(*)::int as n from public.leader_reference_flags where reference_id = $1", [ife])) === 0, "nothing about his answer was flagged");
  check((await one("select submitted_at from public.leader_references where id = $1", [ife]))?.submitted_at !== null, "his reference is recorded");
  await ifeRef.ctx.close();
  await open(me.page, "/lead");
  check((await tid(me.page, "referee-badge-1").textContent())?.includes("Answered") === true, "Ngozi’s page says Answered");

  // ============================================================================================================================
  // 4. Sister Bola answers on Ngozi's own browser: the reference is held
  // ============================================================================================================================
  await tid(me.page, "referee-send-2").click();
  await me.page.waitForSelector('[data-testid="referee-2"][data-stage="sending"]', { timeout: 15000 });
  const wa = await newest("phone", "2348051239999");
  const token2 = LINK.exec(wa.replace(/\\\//g, "/"))?.[1] ?? "";
  check(/^[a-f0-9]{64}$/.test(token2), "a phone number gets the request on WhatsApp");
  const bolaPage = await me.ctx.newPage();
  bolaPage.on("pageerror", () => {});
  await open(bolaPage, `/reference/${token2}`);
  await tid(bolaPage, "referee-ask").waitFor({ timeout: 15000 });
  check((await tid(bolaPage, "referee-masked").textContent())?.includes("•••") === true, "the number is hidden on the page");
  await tid(bolaPage, "referee-send-code").click();
  await tid(bolaPage, "referee-code").waitFor({ timeout: 15000 });
  const waCode = await newest("phone", "2348051239999");
  const code2 = /"text":"(\d{6})"/.exec(waCode.replace(/\\"/g, '"'))?.[1] ?? /\b(\d{6})\b/.exec(waCode)?.[1] ?? "";
  check(/^\d{6}$/.test(code2), "the code came to the same WhatsApp number");
  await bolaPage.getByLabel("Six-digit code").fill(code2);
  await tid(bolaPage, "referee-confirmed").waitFor({ timeout: 20000 });
  check((await tid(bolaPage, "referee-confirmed").textContent())?.includes("hold this phone") === true, "she is a verified contact, not someone on the church’s list");
  await tookTheirTime(bola);
  await rate(bolaPage);
  await bolaPage.getByRole("button", { name: "Send my reference" }).click();
  await heading(bolaPage, /Thank you, Sister Bola/).waitFor({ timeout: 20000 });
  const flags = (await many("select kind, severity from public.leader_reference_flags where reference_id = $1", [bola])).map((f) => `${f.kind}:${f.severity}`);
  check(flags.includes("same_browser:hold"), `answering on the applicant’s own browser holds the reference (${flags.join(", ")})`);
  const cb = await one("select reason, status from public.referee_callbacks where reference_id = $1", [bola]);
  check(cb?.reason === "flagged" && cb?.status === "open", "…and a call-back is set up for the care team");
  await bolaPage.close();

  // ============================================================================================================================
  // 5. The pastor weighs it
  // ============================================================================================================================
  await open(office.page, `/review/${app}`);
  await tid(office.page, "trust-1").waitFor({ timeout: 20000 });
  const t1 = (await tid(office.page, "trust-1").innerText()).replace(/\s+/g, " ");
  check(/On the church’s list/.test(t1) && /Counts as pastor or unit head/.test(t1), "the pastor sees Ife is on the church’s list and counts");
  const t2 = (await tid(office.page, "trust-2").innerText()).replace(/\s+/g, " ");
  check(/Verified contact/.test(t2) && /Held for a look/.test(t2), "…and Bola is only a verified contact, held for a look");
  check(await tid(office.page, "flag-same_browser").isVisible(), "…with the reason in words: the same browser as the applicant");
  await shot(office.page, "review-trust");
  await tid(office.page, "clear-2").click();
  await office.page.getByLabel("What did you check?").fill("Phoned Sister Bola, she confirmed it is hers and she was at Ngozi's house.");
  await office.page.getByRole("button", { name: "Mark as looked at" }).click();
  await office.page.getByText(/Looked at and cleared by/).waitFor({ timeout: 15000 });
  check((await count("select count(*)::int as n from public.leader_reference_flags where reference_id = $1 and cleared_at is null", [bola])) === 0, "clearing the hold needs a note and is recorded with the pastor’s name");
  check((await text(office.page)).includes("Pastor Wale Ojo") || (await text(office.page)).includes("Looked at and cleared by"), "…and the review page shows who cleared it");
  await tid(office.page, "confirm-2").click();
  await office.page.getByLabel("How do you know they are a pastor or unit head?").fill("Leads the women's ministry with me.");
  await office.page.getByRole("button", { name: "Confirm", exact: true }).click();
  await office.page.getByText(/Confirmed by/).first().waitFor({ timeout: 15000 });
  check((await one("select verification, standing from public.referee_trust where reference_id = $1", [bola]))?.verification === "pastor", "a pastor can confirm, in one tap, someone who is not on the list");

  // ============================================================================================================================
  // 6. The care team's call-back
  // ============================================================================================================================
  const care = await newPage(browser, "desktop");
  await signIn(care.page, carer.email, "/care/referees");
  // Other journeys share this database and leave their own call-backs; this one is told apart by what only it wrote
  const mine = care.page.getByTestId("callback").filter({ hasText: "Pastor at my church" });
  await mine.first().waitFor({ timeout: 20000 });
  const cardText = await mine.first().innerText();
  check(cardText.includes("Sister Bola Ade") && cardText.includes("Held back for a look"), "the care team sees the call-back with its reason");
  await shot(care.page, "care-callbacks");
  await mine.first().getByTestId("cb-confirmed").click();
  await mine.first().waitFor({ state: "detached", timeout: 15000 });
  check((await one("select status, outcome from public.referee_callbacks where reference_id = $1", [bola]))?.outcome === "confirmed", "recording the call closes it");
  await care.ctx.close();

  // ============================================================================================================================
  // 7. A reference from before the check: the referee is asked to confirm it, and says it was not theirs
  // ============================================================================================================================
  const femi = await k.person("Femi Bello");
  const app2 = (await one("insert into public.leader_applications (person_id, status, answers, consent_version, submitted_at) values ($1, 'submitted', '{}'::jsonb, '2026-10-v1', now()) returning id", [femi.id]))!.id as string;
  const old: string[] = [];
  for (const [i, contact] of ["kemi.old@example.org", "dayo.old@example.org"].entries()) {
    const id = (await one(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at)
       values ($1, $2, $3, 'Unit head', $4, false, md5(gen_random_uuid()::text), now() + interval '30 days') returning id`,
      [app2, i + 1, i === 0 ? "Mrs Kemi Old" : "Mr Dayo Old", contact],
    ))!.id as string;
    await q.query("insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern) values ($1, 4, 4, 4, 4, false)", [id]);
    await q.query("update public.leader_references set submitted_at = now() - interval '3 days', stage = 'answered' where id = $1", [id]);
    await q.query("update public.referee_trust set legacy = true where reference_id = $1", [id]);
    old.push(id);
  }
  await open(office.page, "/admin/referees");
  await tid(office.page, "confirm-list").waitFor({ timeout: 20000 });
  check((await office.page.getByTestId("unverified-row").count()) === 2, "the two references from before the check are listed, still valid");
  await shot(office.page, "referees-confirm-list");
  await office.page.getByTestId("unverified-row").first().getByRole("button", { name: "Ask to confirm" }).click();
  await office.page.getByText(/We’ve asked/).waitFor({ timeout: 15000 });
  await office.page.getByTestId("unverified-row").nth(1).getByRole("button", { name: "Ask to confirm" }).click();
  await office.page.getByText(/We’ve asked Mr Dayo Old/).waitFor({ timeout: 15000 });

  const tokens: string[] = [];
  for (const to of ["kemi.old@example.org", "dayo.old@example.org"]) tokens.push(LINK.exec(await newest("email", to))?.[1] ?? "");
  check(tokens.every((t) => /^[a-f0-9]{64}$/.test(t)), "each of them is sent a link to confirm");

  // a wrong code five times locks the page
  const lockPage = await refereeBrowser(browser, "102.89.10.2");
  await open(lockPage.page, `/reference/${tokens[0]}`);
  check(await heading(lockPage.page, "Was this reference yours?").isVisible(), "the page asks the right question for an old reference");
  await tid(lockPage.page, "referee-send-code").click();
  await tid(lockPage.page, "referee-code").waitFor({ timeout: 15000 });
  const real = /\b(\d{6})\b/.exec((await newest("email", "kemi.old@example.org")).split("\n")[0])?.[1] ?? "";
  const bad = real === "135790" ? "246810" : "135790";
  for (let i = 0; i < 5; i++) {
    await lockPage.page.getByLabel("Six-digit code").fill(bad);
    await lockPage.page.waitForFunction(() => !document.querySelector('[data-testid="referee-code"] [role="status"]'), null, { timeout: 15000 }).catch(() => {});
    await tid(lockPage.page, i < 4 ? "referee-error" : "referee-locked").waitFor({ timeout: 15000 });
  }
  check(await tid(lockPage.page, "referee-locked").isVisible(), "five wrong codes lock it, and it says for how long");
  await lockPage.page.getByLabel("Six-digit code").fill(real).catch(() => {});
  check(!(await tid(lockPage.page, "referee-confirmed").isVisible().catch(() => false)), "…and even the right code is refused while it is locked");
  check((await one("select verification from public.referee_trust where reference_id = $1", [old[0]]))?.verification === "unverified", "nothing was verified");
  await shot(lockPage.page, "referee-locked");
  await lockPage.ctx.close();

  const disown = await refereeBrowser(browser, "102.89.10.3");
  await open(disown.page, `/reference/${tokens[1]}`);
  await tid(disown.page, "referee-send-code").click();
  await tid(disown.page, "referee-code").waitFor({ timeout: 15000 });
  const code3 = /\b(\d{6})\b/.exec((await newest("email", "dayo.old@example.org")).split("\n")[0])?.[1] ?? "";
  await disown.page.getByLabel("Six-digit code").fill(code3);
  await tid(disown.page, "referee-reverify").waitFor({ timeout: 20000 });
  await shot(disown.page, "referee-reverify");
  await tid(disown.page, "referee-no").click();
  await tid(disown.page, "referee-reverified").waitFor({ timeout: 15000 });
  check((await one("select verification from public.referee_trust where reference_id = $1", [old[1]]))?.verification === "disputed", "“No, it wasn’t me” marks the reference as disowned");
  check((await one("select reason, status from public.referee_callbacks where reference_id = $1", [old[1]]))?.reason === "disowned", "…and the care team is given a call to make");
  await disown.ctx.close();

  // ============================================================================================================================
  // 8. Bad links, and the pages that must not be open to anyone
  // ============================================================================================================================
  const stray = await newPage(browser);
  await open(stray.page, `/reference/${"a".repeat(64)}`);
  check(await tid(stray.page, "referee-invalid").isVisible(), "a link that doesn’t exist says so, and gives nothing away");
  await open(stray.page, "/reference/short");
  check(await tid(stray.page, "referee-invalid").isVisible(), "…so does one that is the wrong shape");
  const anon = await stray.page.request.post(`${BASE}/api/referees/apply`, { data: { rows: [], mode: "update" } });
  check(anon.status() === 401, "the upload endpoints turn away anyone who isn’t signed in");
  await stray.ctx.close();

  const plain = await newPage(browser);
  await signIn(plain.page, ngozi.email, "/lead");
  const refused = await plain.page.request.get(`${BASE}/api/referees/file?kind=export&format=csv`);
  check(refused.status() === 403, "an applicant cannot download the church’s list");
  const refusedApply = await plain.page.request.post(`${BASE}/api/referees/apply`, { data: { rows: [{ line: 2, name: "Eve Mallory", standing: "pastor", contacts: ["0801 234 5678"] }], mode: "update" } });
  check(refusedApply.status() === 403, "…or add herself to it");
  check((await count("select count(*)::int as n from public.referee_directory where name = 'Eve Mallory'")) === 0, "…and she was not added");
  await open(plain.page, "/admin/referees");
  check(!(await text(plain.page)).includes("Upload the list"), "the screen itself is not hers to open");
  await plain.ctx.close();

  await me.ctx.close();
  await office.ctx.close();
  await browser.close();
  await q.end();
  finish("13-referee");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

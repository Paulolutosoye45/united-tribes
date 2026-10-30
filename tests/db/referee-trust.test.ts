import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { answerAs, issueCode, issueLink, listInDirectory, secret, uniqueEmail, uniquePhone, verifyReferee } from "./referee-kit";

let db: TestDb;
let token: string;

// The messages these tests look for are held until morning if they are sent between 22:00 and 06:00 in Lagos, so the clock is set to noon here: the
// tests mean the same thing at any hour. (The hold itself is tested in messaging.test.ts.)
const NOON = "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select 12 $$";

beforeAll(async () => {
  db = await createTestDb();
  await db.admin.query(NOON);
  token = (await db.admin.query("select public.bootstrap_worker_token('test') as t")).rows[0].t;
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BEST = { s1: "b", s2: "b", s3: "a", s4: "a", s5: "a", s6: "a" } as Record<string, string>;
const WORST = { s1: "d", s2: "c", s3: "d", s4: "c", s5: "b", s6: "c" } as Record<string, string>;
const picks = Object.fromEntries(Object.keys(BEST).map((k) => [k, { best: BEST[k], worst: WORST[k] }]));

function answers() {
  return {
    eligibility: { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true },
    calling: {
      track: "builders", community: "professionals", goal: "step-into-a-leadership-role", goalRelation: "pursuing",
      goalStory: "I have been stepping into leadership at work this year and I am still learning how.",
      why: "I want to help other people grow into what God has put in them, not to be seen.",
      walked: "I walked with a friend through a job loss. I listened a lot and did not give advice.",
      walkRating: 4, walkNote: "Steady, though I get tired in busy seasons and pray less than I want to.",
      obstacles: "Work travel in the second half of the season could get in the way.",
    },
    scenarios: picks,
    style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
    contact: { whatsapp: "+2348039990000" },
  };
}

async function person(role?: string) {
  const user = await db.createUser();
  if (role) await db.grant(user.id, role);
  return user;
}

const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
const one = async (text: string, params: unknown[] = []) => (await sql(text, params))[0];
const asUser = <T>(id: string, text: string, params: unknown[] = []) => db.asUser(id, async (q) => (await q(text, params)).rows[0]?.r as T);
const asAnon = <T>(text: string, params: unknown[] = []) => db.asAnon(async (q) => (await q(text, params)).rows[0]?.r as T);
const asWorker = async (text: string, params: unknown[] = []) => (await db.asAnon((q) => q(text, [token, ...params]))).rows[0]?.r;
const claim = (limit = 50) => asWorker("select public.worker_claim($1, $2) as r", [limit]) as Promise<Row[]>;

/** An applicant with a draft, two referees (unique contacts), submitted. */
async function submitted(opts: { user?: { id: string; email: string }; contacts?: [string, string]; head?: [boolean, boolean] } = {}) {
  const user = opts.user ?? (await person());
  const appId = (
    await db.asUser(user.id, (q) =>
      q("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, '2026-10-v1') returning id", [
        user.id, JSON.stringify(answers()),
      ]),
    )
  ).rows[0].id as string;
  const contacts = opts.contacts ?? [uniqueEmail("one"), uniqueEmail("two")];
  const refs: string[] = [];
  for (const slot of [1, 2]) {
    refs.push(
      (await asUser<string>(user.id, "select public.set_referee($1, $2, $3, 'Unit head', $4, $5) as r", [
        appId, slot, slot === 1 ? "Pastor Ife" : "Sister Bola", contacts[slot - 1], opts.head?.[slot - 1] ?? slot === 1,
      ])) as string,
    );
  }
  await db.asUser(user.id, (q) => q("select public.submit_leader_application($1)", [appId]));
  return { user, appId, refs, contacts };
}

const trust = (ref: string) => one("select * from public.referee_trust where reference_id = $1", [ref]);
const refRow = (ref: string) => one("select * from public.leader_references where id = $1", [ref]);
const readiness = async (appId: string) => (await one("select public.application_readiness($1) as r", [appId])).r as Row;
const flagsOf = async (ref: string) => (await sql("select kind, severity, cleared_at from public.leader_reference_flags where reference_id = $1 order by kind", [ref]));
const hex = (c: string) => c.repeat(64);

// ---------------------------------------------------------------------------

describe("reading a phone number or an email", () => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/referee-contacts.json", import.meta.url), "utf8")) as { cases: [string, string | null][] };

  it("reads every written form the same way the app does", async () => {
    for (const [input, expected] of fixture.cases) {
      const got = (await one("select public.referee_contact_norm($1) as n", [input])).n;
      expect(got, JSON.stringify(input)).toBe(expected);
    }
  });

  it("refuses throwaway inboxes, whatever the capitals", async () => {
    expect((await one("select public.referee_domain_blocked('x@mailinator.com') as b")).b).toBe(true);
    expect((await one("select public.referee_domain_blocked('x@MAILINATOR.com') as b")).b).toBe(true);
    expect((await one("select public.referee_domain_blocked('x@gmail.com') as b")).b).toBe(false);
  });

  it("hides most of the contact when it shows it back to the referee", async () => {
    expect((await one("select public.referee_mask('email', 'femi@gmail.com') as m")).m).toBe("f•••@gmail.com");
    expect((await one("select public.referee_mask('phone', '+2348031234567') as m")).m).toBe("+234 ••• ••• 567");
  });
});

describe("the applicant names a referee", () => {
  it("refuses their own email, their own number, a throwaway inbox and something that is not a contact", async () => {
    const me = await person();
    const { appId } = await submitted({ user: me });
    const set = (slot: number, contact: string) =>
      db.asUser(me.id, (q) => q("select public.set_referee($1, $2, 'Someone', 'Friend', $3, false)", [appId, slot, contact]));
    await expectCode(set(1, me.email), "22023");
    await expectCode(set(1, me.email.toUpperCase()), "22023");
    await expectCode(set(1, "0803 999 0000"), "22023"); // the WhatsApp number on their own form
    await expectCode(set(1, "+234 803 999 0000"), "22023");
    await expectCode(set(1, "someone@mailinator.com"), "22023");
    await expectCode(set(1, "not a contact"), "22023");
    await expectCode(set(1, ""), "22023");
  });

  it("refuses the same person twice, and a contact another applicant already uses", async () => {
    const a = await submitted();
    const dup = await db.asUser(a.user.id, (q) =>
      q("select public.set_referee($1, 2, 'Sister Bola', 'Friend', $2, false)", [a.appId, a.contacts[0].toUpperCase()]),
    ).then(() => null, (e) => e);
    expect(dup?.code).toBe("22023");
    expect(dup?.message).toMatch(/different people/);

    const b = await person();
    const draft = (
      await db.asUser(b.id, (q) =>
        q("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, 'v') returning id", [b.id, JSON.stringify(answers())]),
      )
    ).rows[0].id as string;
    await expectCode(
      db.asUser(b.id, (q) => q("select public.set_referee($1, 1, 'Pastor Ife', 'Pastor', $2, false)", [draft, a.contacts[0]])),
      "22023",
    );
  });

  it("lets one pastor on the church's list speak for several applicants", async () => {
    const pastor = uniqueEmail("pastor");
    await listInDirectory(db, pastor, { name: "Pastor Many" });
    const a = await submitted({ contacts: [pastor, uniqueEmail("a2")] });
    const b = await submitted({ contacts: [pastor, uniqueEmail("b2")] });
    expect(a.refs[0]).not.toBe(b.refs[0]);
  });

  it("keeps the contact in its normal form and says what kind it is", async () => {
    const a = await submitted({ contacts: ["0803 555 1234", "Chi@Example.ORG"] });
    expect(await refRow(a.refs[0])).toMatchObject({ contact_norm: "+2348035551234", contact_kind: "phone", stage: "waiting" });
    expect(await refRow(a.refs[1])).toMatchObject({ contact_norm: "chi@example.org", contact_kind: "email" });
  });

  it("allows any number of changes before a request goes out, then two, each one logged", async () => {
    const a = await submitted();
    const ref = a.refs[1];
    const change = (contact: string) =>
      db.asUser(a.user.id, (q) => q("select public.set_referee($1, 2, 'Sister Bola', 'Friend', $2, false)", [a.appId, contact]));
    // Nothing has been sent yet: change freely
    for (let i = 0; i < 4; i++) await change(uniqueEmail("free"));
    expect((await refRow(ref)).changes).toBe(0);

    await asUser(a.user.id, "select public.request_referee_send($1) as r", [ref]);
    await change(uniqueEmail("one"));
    await change(uniqueEmail("two"));
    await expectCode(change(uniqueEmail("three")), "22023");
    expect((await refRow(ref)).changes).toBe(2);
    const log = await sql("select * from public.referee_changes where application_id = $1 and slot = 2", [a.appId]);
    // Every change is written down; the two after the request are the ones that count against the limit
    expect(log).toHaveLength(6);
    expect(log.filter((l) => l.after_request === true)).toHaveLength(2);
  });

  it("cancels the old link, the old code and everything proved when the person changes", async () => {
    const a = await submitted();
    const ref = a.refs[0];
    await listInDirectory(db, a.contacts[0]);
    const v = await verifyReferee(db, ref);
    expect((await trust(ref)).verification).toBe("directory");
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [ref]);
    await db.asUser(a.user.id, (q) => q("select public.set_referee($1, 1, 'Another Pastor', 'Pastor', $2, true)", [a.appId, uniqueEmail("new")]));
    expect(await trust(ref)).toMatchObject({ verification: "unverified", standing: false, verified_at: null });
    expect(await refRow(ref)).toMatchObject({ stage: "waiting", sent_at: null });
    const old = await asAnon<Row>("select public.referee_open($1, $2, $3, $4) as r", [v.link, v.session, v.net, v.bid]);
    expect(old.state).toBe("invalid");
    const code = await asAnon<Row>("select public.referee_check_code($1, '123456', $2, $3) as r", [v.link, v.net, v.bid]);
    expect(code).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("changing only the name or how they know each other keeps the contact and what was proved", async () => {
    const a = await submitted();
    await listInDirectory(db, a.contacts[0]);
    await verifyReferee(db, a.refs[0]);
    await db.asUser(a.user.id, (q) => q("select public.set_referee($1, 1, 'Pastor Ife A.', 'My pastor', $2, true)", [a.appId, a.contacts[0]]));
    expect(await trust(a.refs[0])).toMatchObject({ verification: "directory", standing: true });
    expect((await refRow(a.refs[0])).referee_name).toBe("Pastor Ife A.");
  });
});

describe("the request goes out without the applicant ever holding the link", () => {
  it("queues a message to the referee's own contact and gives the applicant nothing but a yes", async () => {
    const a = await submitted();
    const out = await asUser<Row>(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    expect(out).toEqual({ ok: true, kind: "email" });
    const m = await one("select * from public.messages where template = 'referee_request' order by created_at desc limit 1");
    expect(m).toMatchObject({ person_id: null, to_email: a.contacts[0], status: "queued" });
    expect(Object.keys(m.params).sort()).toEqual(["contact", "reference_id"]);
    expect(await refRow(a.refs[0])).toMatchObject({ stage: "sending", requests: 1 });
  });

  it("sends a number by phone, an email by email", async () => {
    const phone = uniquePhone();
    const a = await submitted({ contacts: [phone, uniqueEmail("e")] });
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    const m = await one("select to_email, to_phone from public.messages where template = 'referee_request' and params ->> 'reference_id' = $1", [a.refs[0]]);
    expect(m).toEqual({ to_email: null, to_phone: phone });
  });

  it("is refused for someone else's referee, a draft, an answered reference, and more than three a day", async () => {
    const a = await submitted();
    const other = await person();
    await expectCode(db.asUser(other.id, (q) => q("select public.request_referee_send($1)", [a.refs[0]])), "P0002");
    await expectCode(db.asAnon((q) => q("select public.request_referee_send($1)", [a.refs[0]])), "42501");

    for (let i = 0; i < 3; i++) await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[1]]);
    await expectCode(db.asUser(a.user.id, (q) => q("select public.request_referee_send($1)", [a.refs[1]])), "22023");

    const draftUser = await person();
    const draft = (
      await db.asUser(draftUser.id, (q) =>
        q("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, 'v') returning id", [draftUser.id, JSON.stringify(answers())]),
      )
    ).rows[0].id as string;
    const dref = await asUser<string>(draftUser.id, "select public.set_referee($1, 1, 'Pastor Ife', 'Pastor', $2, false) as r", [draft, uniqueEmail("d")]);
    await expectCode(db.asUser(draftUser.id, (q) => q("select public.request_referee_send($1)", [dref])), "22023");

    const answered = await submitted();
    await answerAs(db, answered.refs[0]);
    await expectCode(db.asUser(answered.user.id, (q) => q("select public.request_referee_send($1)", [answered.refs[0]])), "22023");
  });

  it("makes the link at the moment of sending, and stores only its hash", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    const items = (await claim()).filter((i) => i.template === "referee_request" && i.params.reference_id === a.refs[0]);
    expect(items).toHaveLength(1);
    const link = items[0].params.secret as string;
    expect(link).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0].params).toMatchObject({ days: 30, referee: "Pastor Ife", kind: "referee_request" });
    expect(items[0].to).toMatchObject({ email: a.contacts[0], name: "Pastor Ife" });

    // The page opens with it
    const open = await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [link, hex("a"), hex("b")]);
    expect(open).toMatchObject({ state: "open", mode: "give", referee: "Pastor Ife", verified: false });
    // …and it is nowhere in the database in a readable form
    const everywhere = (await one(
      `select (select count(*) from public.messages where params::text like '%' || $1 || '%')
            + (select count(*) from public.leader_references where token_hash = $1 or contact like '%' || $1 || '%') as n`, [link],
    )).n;
    expect(Number(everywhere)).toBe(0);
  });

  it("makes a new link if the message has to be tried again, and the old one stops working", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    const first = (await claim()).find((i) => i.params.reference_id === a.refs[0])!;
    await asWorker("select public.worker_report($1, $2, 'retry', null, 'busy', 1)", [first.id]);
    await db.admin.query("update public.messages set scheduled_for = now() where id = $1", [first.id]);
    const second = (await claim()).find((i) => i.params.reference_id === a.refs[0])!;
    expect(second.params.secret).not.toBe(first.params.secret);
    expect((await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [first.params.secret, hex("a"), hex("b")])).state).toBe("invalid");
    expect((await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [second.params.secret, hex("a"), hex("b")])).state).toBe("open");
  });

  it("tells the applicant when it went out, and when it could not", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[1]]);
    const items = await claim();
    const ok = items.find((i) => i.params.reference_id === a.refs[0])!;
    const bad = items.find((i) => i.params.reference_id === a.refs[1])!;
    await asWorker("select public.worker_report($1, $2, 'sent', 'prov-1')", [ok.id]);
    await asWorker("select public.worker_report($1, $2, 'rejected', null, 'mailbox full')", [bad.id]);
    expect(await refRow(a.refs[0])).toMatchObject({ stage: "sent" });
    expect((await refRow(a.refs[0])).sent_at).not.toBeNull();
    expect(await refRow(a.refs[1])).toMatchObject({ stage: "unreachable" });
    // Asking again from the unreachable state goes back to "sending"
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[1]]);
    expect((await refRow(a.refs[1])).stage).toBe("sending");
  });

  it("never gives a message queued for someone the applicant has since replaced to the new person", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    await db.asUser(a.user.id, (q) => q("select public.set_referee($1, 1, 'Pastor New', 'Pastor', $2, true)", [a.appId, uniqueEmail("new")]));
    const items = await claim();
    expect(items.find((i) => i.params.reference_id === a.refs[0])).toBeUndefined();
    const m = await one("select status, error from public.messages where template = 'referee_request' and params ->> 'reference_id' = $1", [a.refs[0]]);
    expect(m).toMatchObject({ status: "skipped", error: "the referee was changed" });
  });

  it("drops a request that is no longer needed", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[1]]);
    await answerAs(db, a.refs[1]);
    expect((await claim()).find((i) => i.params.reference_id === a.refs[1])).toBeUndefined();
    expect((await one("select status from public.messages where template = 'referee_request' and params ->> 'reference_id' = $1", [a.refs[1]])).status).toBe("skipped");
  });
});

describe("the referee's page: the link, then a code", () => {
  it("says nothing about a link that is not real, expired, closed or already used", async () => {
    expect(await asAnon<Row>("select public.referee_open('nope', null, null, null) as r")).toEqual({ state: "invalid" });
    expect(await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [secret()])).toEqual({ state: "invalid" });
    expect(await asAnon<Row>("select public.referee_open(null, null, null, null) as r")).toEqual({ state: "invalid" });

    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    await db.admin.query("update public.leader_references set token_expires_at = now() - interval '1 minute' where id = $1", [a.refs[0]]);
    expect((await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [link])).state).toBe("expired");

    const b = await submitted();
    const bl = await issueLink(db, b.refs[1]);
    await db.admin.query("update public.leader_applications set status = 'not_approved' where id = $1", [b.appId]);
    expect((await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [bl])).state).toBe("closed");

    const c = await submitted();
    const done = await answerAs(db, c.refs[0]);
    expect((await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [done.link])).state).toBe("answered");
  });

  it("shows the applicant's name and a masked copy of the contact the code will go to", async () => {
    const a = await submitted({ contacts: ["femi.pastor@gmail.com", uniqueEmail("b")] });
    const link = await issueLink(db, a.refs[0]);
    const open = await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [link, hex("a"), hex("b")]);
    expect(open).toMatchObject({ state: "open", kind: "email", masked: "f•••@gmail.com", relationship: "Unit head" });
    expect(open.applicant).toBeTruthy();
    expect(open.code).toMatchObject({ live: false, tries_left: 5, minutes: 10 });
    expect(JSON.stringify(open)).not.toContain("femi.pastor@gmail.com");
  });

  it("counts a robot's look at the link as nothing, and a person's as opened", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    await asAnon("select public.referee_open($1, null, $2, $3, false) as r", [link, hex("a"), hex("b")]);
    expect((await refRow(a.refs[0])).stage).toBe("waiting");
    expect((await trust(a.refs[0])).opened_at).toBeNull();
    await asAnon("select public.referee_open($1, null, $2, $3, true) as r", [link, hex("a"), hex("b")]);
    expect((await refRow(a.refs[0])).stage).toBe("opened");
    expect((await trust(a.refs[0])).opened_at).not.toBeNull();
  });

  it("sends a code to the same contact, no more than once a minute and five times a day", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    const first = await asAnon<Row>("select public.referee_ask_code($1, $2) as r", [link, hex("a")]);
    expect(first).toMatchObject({ ok: true, kind: "email" });
    const m = await one("select * from public.messages where template = 'referee_code' and params ->> 'reference_id' = $1", [a.refs[0]]);
    expect(m).toMatchObject({ to_email: a.contacts[0], urgency: "urgent", person_id: null });
    expect(Object.keys(m.params).sort()).toEqual(["contact", "reference_id"]);

    expect(await asAnon<Row>("select public.referee_ask_code($1, $2) as r", [link, hex("a")])).toMatchObject({ ok: false, reason: "wait" });
    for (let i = 0; i < 4; i++) {
      await db.admin.query("update public.referee_access set last_code_at = now() - interval '2 minutes' where reference_id = $1", [a.refs[0]]);
      expect(await asAnon<Row>("select public.referee_ask_code($1, $2) as r", [link, hex("a")])).toMatchObject({ ok: true });
    }
    await db.admin.query("update public.referee_access set last_code_at = now() - interval '2 minutes' where reference_id = $1", [a.refs[0]]);
    expect(await asAnon<Row>("select public.referee_ask_code($1, $2) as r", [link, hex("a")])).toMatchObject({ ok: false, reason: "limit" });
    expect(await asAnon<Row>("select public.referee_ask_code('bad', null) as r")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("makes the code when its message goes out, keeps only a hash, and the code works once", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    await asAnon("select public.referee_ask_code($1, $2) as r", [link, hex("a")]);
    const item = (await claim()).find((i) => i.template === "referee_code" && i.params.reference_id === a.refs[0])!;
    const code = item.params.code as string;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(item.params.minutes).toBe(10);
    const stored = await one("select code_hash, code_salt from public.referee_access where reference_id = $1", [a.refs[0]]);
    expect(stored.code_hash).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(Number((await one("select count(*) as n from public.messages where params::text like '%' || $1 || '%'", [code])).n)).toBe(0);

    const ok = await asAnon<Row>("select public.referee_check_code($1, $2, $3, $4) as r", [link, code, hex("a"), hex("b")]);
    expect(ok.ok).toBe(true);
    expect(ok.session).toMatch(/^[a-f0-9]{64}$/);
    // The same code again: spent
    expect(await asAnon<Row>("select public.referee_check_code($1, $2, $3, $4) as r", [link, code, hex("a"), hex("b")])).toMatchObject({ ok: false, reason: "expired" });
    expect((await refRow(a.refs[0])).stage).toBe("verified");
    expect(await trust(a.refs[0])).toMatchObject({ verification: "contact", verified_kind: "email" });
  });

  it("says how many tries are left, and locks for half an hour after five wrong codes, even for the right one", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    await issueCode(db, a.refs[0], "246810");
    const wrong = (c: string) => asAnon<Row>("select public.referee_check_code($1, $2, $3, $4) as r", [link, c, hex("a"), hex("b")]);
    expect(await wrong("abc")).toMatchObject({ ok: false, reason: "format" });
    expect(await wrong("12345")).toMatchObject({ ok: false, reason: "format" });
    for (const left of [4, 3, 2, 1]) expect(await wrong("111111")).toMatchObject({ ok: false, reason: "wrong", tries_left: left });
    expect(await wrong("111111")).toMatchObject({ ok: false, reason: "locked", minutes: 30 });
    expect(await wrong("246810")).toMatchObject({ ok: false, reason: "locked" });
    const open = await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [link]);
    expect(open.code.locked_minutes).toBeGreaterThan(0);
    expect(await asAnon<Row>("select public.referee_ask_code($1, null) as r", [link])).toMatchObject({ ok: false, reason: "locked" });

    // A code made while locked is not made at all
    await db.admin.query("update public.referee_access set last_code_at = null where reference_id = $1", [a.refs[0]]);
    await db.admin.query("update public.messages set status = 'queued' where status = 'sending'");
    await db.admin.query(
      "insert into public.messages (person_id, template, params, to_email, urgency, status, dedupe_key) values (null, 'referee_code', $1::jsonb, $2, 'urgent', 'queued', $3)",
      [JSON.stringify({ reference_id: a.refs[0], contact: a.contacts[0] }), a.contacts[0], `t-${secret()}`],
    );
    const items = await claim();
    expect(items.find((i) => i.template === "referee_code" && i.params.reference_id === a.refs[0])).toBeUndefined();

    // After the half hour, a fresh code works
    await db.admin.query("update public.referee_access set locked_until = now() - interval '1 minute' where reference_id = $1", [a.refs[0]]);
    await issueCode(db, a.refs[0], "135790");
    expect((await asAnon<Row>("select public.referee_check_code($1, '135790', $2, $3) as r", [link, hex("a"), hex("b")])).ok).toBe(true);
  });

  it("refuses an expired code", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    await issueCode(db, a.refs[0], "123123", 10);
    await db.admin.query("update public.referee_access set code_expires_at = now() - interval '1 second' where reference_id = $1", [a.refs[0]]);
    expect(await asAnon<Row>("select public.referee_check_code($1, '123123', $2, $3) as r", [link, hex("a"), hex("b")])).toMatchObject({ ok: false, reason: "expired" });
  });

  it("needs the code before the ratings, and spends the session when the reference is sent", async () => {
    const a = await submitted();
    const link = await issueLink(db, a.refs[0]);
    const send = (session: string | null) =>
      db.asAnon((q) => q("select public.submit_reference($1, $2, 5, 5, 5, 5, false, null, $3, $4)", [link, session, hex("a"), hex("b")]));
    await expectCode(send(null), "22023");
    await expectCode(send(secret()), "22023");
    // Opening the link, even many times, is not enough
    await asAnon("select public.referee_open($1, null, $2, $3) as r", [link, hex("a"), hex("b")]);
    await expectCode(send(null), "22023");

    const v = await verifyReferee(db, a.refs[0]);
    const ok = (await db.asAnon((q) => q("select public.submit_reference($1, $2, 4, 4, 5, 4, false, null, $3, $4) as r", [v.link, v.session, v.net, v.bid]))).rows[0].r;
    expect(ok).toEqual({ ok: true });
    expect((await refRow(a.refs[0])).stage).toBe("answered");
    await expectCode(db.asAnon((q) => q("select public.submit_reference($1, $2, 4, 4, 5, 4, false, null, $3, $4)", [v.link, v.session, v.net, v.bid])), "22023");
    expect((await one("select session_hash from public.referee_access where reference_id = $1", [a.refs[0]])).session_hash).toBeNull();
  });

  it("shows who the church's list says this is, only once the code has been typed", async () => {
    const a = await submitted();
    await listInDirectory(db, a.contacts[0], { name: "Pastor Ife Adeyemi", standing: "pastor" });
    const v = await verifyReferee(db, a.refs[0]);
    const before = await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [v.link, v.net, v.bid]);
    expect(before.who).toBeNull();
    const after = await asAnon<Row>("select public.referee_open($1, $2, $3, $4) as r", [v.link, v.session, v.net, v.bid]);
    expect(after.verified).toBe(true);
    expect(after.who).toMatchObject({ name: "Pastor Ife Adeyemi", standing: "pastor" });
  });
});

describe("whether a referee is a pastor or unit head: the list, or a pastor, never a tick box", () => {
  it("counts a referee on the list, whatever the applicant ticked", async () => {
    // The applicant says the second referee is the pastor; the list says the first one is, and the list is what counts
    const a = await submitted({ head: [false, true] });
    await listInDirectory(db, a.contacts[0], { standing: "unit_head" });
    await answerAs(db, a.refs[0]);
    await answerAs(db, a.refs[1]);
    expect(await trust(a.refs[0])).toMatchObject({ verification: "directory", standing: true });
    expect(await trust(a.refs[1])).toMatchObject({ verification: "contact", standing: false });
    expect((await readiness(a.appId)).gates).toMatchObject({ pastor_or_unit_head_referee: true, references_clean: true });
  });

  it("does not count a referee who only says they are one", async () => {
    const a = await submitted({ head: [true, true] });
    await answerAs(db, a.refs[0]);
    await answerAs(db, a.refs[1]);
    expect(await trust(a.refs[0])).toMatchObject({ verification: "contact", standing: false });
    expect((await readiness(a.appId)).gates).toMatchObject({ pastor_or_unit_head_referee: false, references_clean: false });
  });

  it("counts them once a pastor confirms in one tap, and records who", async () => {
    const a = await submitted();
    await answerAs(db, a.refs[0]);
    await answerAs(db, a.refs[1]);
    const pastor = await person("pastor");
    const review = await asUser<Row[]>(pastor.id, "select public.referee_review($1) as r", [a.appId]);
    expect(review[0]).toMatchObject({ verification: "contact", standing: false, can_confirm: true, claimed_head: true });
    await db.asUser(pastor.id, (q) => q("select public.referee_confirm_standing($1, 'I know him: Pastor of Ota')", [a.refs[0]]));
    expect(await trust(a.refs[0])).toMatchObject({ verification: "pastor", standing: true, confirmed_by: pastor.id });
    expect((await readiness(a.appId)).gates.pastor_or_unit_head_referee).toBe(true);
    const after = await asUser<Row[]>(pastor.id, "select public.referee_review($1) as r", [a.appId]);
    expect(after[0]).toMatchObject({ standing: true, can_confirm: false, confirmed_note: "I know him: Pastor of Ota" });
  });

  it("lets only a pastor or the director confirm, never on their own application, and not before the code was typed", async () => {
    const a = await submitted();
    const coach = await person("coach");
    const leader = await person("leader");
    for (const who of [coach, leader]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.referee_confirm_standing($1)", [a.refs[0]])), "42501");
    }
    const pastor = await person("pastor");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_confirm_standing($1)", [a.refs[0]])), "22023");
    await verifyReferee(db, a.refs[0]);
    await expectCode(db.asAnon((q) => q("select public.referee_confirm_standing($1)", [a.refs[0]])), "42501");
    const mine = await submitted({ user: pastor });
    await verifyReferee(db, mine.refs[0]);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_confirm_standing($1)", [mine.refs[0]])), "42501");
    const director = await person("director");
    await db.asUser(director.id, (q) => q("select public.referee_confirm_standing($1)", [a.refs[0]]));
    expect((await trust(a.refs[0])).standing).toBe(true);
  });

  it("follows the setting for which kinds of person count, and a retired person stops matching", async () => {
    const a = await submitted();
    const e = await listInDirectory(db, a.contacts[0], { standing: "ministry_leader" });
    // A second applicant names the same listed person (allowed: they are on the list) before that person is retired
    const b = await submitted({ contacts: [a.contacts[0], uniqueEmail("b")] });
    await verifyReferee(db, a.refs[0]);
    expect(await trust(a.refs[0])).toMatchObject({ verification: "directory", standing: false });

    const admin = await person("admin");
    await db.asUser(admin.id, (q) => q("select public.referee_settings_save($1::jsonb)", [JSON.stringify({ gate_standings: ["pastor", "unit_head", "ministry_leader"] })]));
    // …which helps the reference that is already in
    expect((await trust(a.refs[0])).standing).toBe(true);
    await expectCode(db.asUser(admin.id, (q) => q("select public.referee_settings_save($1::jsonb)", [JSON.stringify({ gate_standings: [] })])), "22023");
    await expectCode(db.asUser(admin.id, (q) => q("select public.referee_settings_save($1::jsonb)", [JSON.stringify({ callback_pct: 500 })])), "22023");
    await db.asUser(admin.id, (q) => q("select public.referee_settings_save($1::jsonb)", [JSON.stringify({ gate_standings: ["pastor", "unit_head"] })]));

    // A person retired from the list no longer counts for a reference verified afterwards
    await db.asUser(admin.id, (q) => q("select public.referee_directory_set_active($1, false)", [e]));
    await verifyReferee(db, b.refs[0]);
    expect(await trust(b.refs[0])).toMatchObject({ verification: "contact", standing: false });
  });

  it("matches a reference already verified when the person is added to the list afterwards", async () => {
    const a = await submitted();
    await answerAs(db, a.refs[0]);
    await answerAs(db, a.refs[1]);
    expect((await trust(a.refs[0])).standing).toBe(false);
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) =>
      q("select public.referee_directory_save(null, $1::jsonb)", [JSON.stringify({ name: "Pastor Ife", standing: "pastor", contacts: [a.contacts[0]] })]),
    );
    expect(await trust(a.refs[0])).toMatchObject({ verification: "directory", standing: true });
    expect((await readiness(a.appId)).gates.pastor_or_unit_head_referee).toBe(true);
  });
});

describe("integrity flags hold a reference back until a pastor has looked", () => {
  async function pair(opts: { head?: boolean } = {}) {
    const a = await submitted({ head: [opts.head ?? true, false] });
    await listInDirectory(db, a.contacts[0]);
    return a;
  }

  it("holds a reference answered from a browser the applicant has signed in on", async () => {
    const a = await pair();
    await db.asUser(a.user.id, (q) => q("select public.referee_note_applicant($1, $2)", [hex("c"), hex("d")]));
    await answerAs(db, a.refs[0], { net: hex("e"), bid: hex("d") });
    expect((await flagsOf(a.refs[0])).map((f) => f.kind)).toEqual(["same_browser"]);
    expect(await one("select public.reference_held($1) as h", [a.refs[0]])).toEqual({ h: true });
    await answerAs(db, a.refs[1]);
    const r = await readiness(a.appId);
    expect(r.gates).toMatchObject({ references_held: 1 });
    expect(r.references_received).toBe(1);
    expect(r.gates.references_clean).toBe(false);
  });

  it("holds a reference finished in under forty seconds", async () => {
    const a = await pair();
    await answerAs(db, a.refs[0], { secondsAgo: 12 });
    const flags = await flagsOf(a.refs[0]);
    expect(flags).toMatchObject([{ kind: "too_fast", severity: "hold" }]);
    expect((await one("select detail from public.leader_reference_flags where reference_id = $1", [a.refs[0]])).detail).toMatch(/12 seconds/);
  });

  it("lets two referees both give straight fives, but holds the same uneven pattern from both", async () => {
    const a = await pair();
    await answerAs(db, a.refs[0], { rating: 5 });
    await answerAs(db, a.refs[1], { rating: 5 });
    expect(await flagsOf(a.refs[1])).toMatchObject([{ kind: "identical_pattern", severity: "note" }]);
    expect((await one("select public.reference_held($1) as h", [a.refs[1]])).h).toBe(false);

    const b = await pair();
    await answerAs(db, b.refs[0], { ratings: { reliability: 5, warmth: 4, confidentiality: 3, maturity: 5 } });
    await answerAs(db, b.refs[1], { ratings: { reliability: 5, warmth: 4, confidentiality: 3, maturity: 5 } });
    expect(await flagsOf(b.refs[1])).toMatchObject([{ kind: "identical_pattern", severity: "hold" }]);
  });

  it("holds a concern note that reads like the applicant's own writing, by exact match or close likeness", async () => {
    const a = await pair();
    const hash = "ab".repeat(32);
    await db.admin.query(
      "insert into public.leader_answer_prints (application_id, field, norm_hash, simhash, words) values ($1, 'why', $2, 1234567890123, 30)",
      [a.appId, hash],
    );
    // Each call rates a little differently, so the only thing that can flag is the writing
    let n = 0;
    const send = async (ref: string, normHash: string, simhash: number, words: number) => {
      const v = await verifyReferee(db, ref);
      n += 1;
      await db.asAnon((q) =>
        q("select public.submit_reference($1, $2, $3, 3, 4, 4, true, 'He has been late to a few things and hurt a friend once.', $4, $5, $6, $7, $8)", [
          v.link, v.session, 1 + (n % 5), v.net, v.bid, normHash, simhash, words,
        ]),
      );
    };
    await send(a.refs[0], hash, 99, 20);
    expect((await flagsOf(a.refs[0])).map((f) => f.kind)).toContain("text_like_applicant");

    // A different hash but nearly the same fingerprint (a few bits apart)
    await send(a.refs[1], "cd".repeat(32), 1234567890123 ^ 0b111, 20);
    expect((await flagsOf(a.refs[1])).map((f) => f.kind)).toContain("text_like_applicant");

    // A short note is not compared, and a different note is left alone
    const b = await pair();
    await db.admin.query("insert into public.leader_answer_prints (application_id, field, norm_hash, simhash, words) values ($1, 'why', $2, 1234567890123, 30)", [b.appId, hash]);
    await send(b.refs[0], hash, 1234567890123, 5);
    expect(await flagsOf(b.refs[0])).toEqual([]);
    await send(b.refs[1], "ef".repeat(32), 1234567890123 ^ -1, 20);
    expect(await flagsOf(b.refs[1])).toEqual([]);
  });

  it("holds a reference when two soft signals come together, but not for one alone", async () => {
    // Soft: same network as the applicant. Soft: the same four straight fives as the other referee.
    const a = await pair();
    await db.asUser(a.user.id, (q) => q("select public.referee_note_applicant($1, $2)", [hex("1"), hex("2")]));
    await answerAs(db, a.refs[0], { net: hex("3"), bid: hex("4") });
    expect(await flagsOf(a.refs[0])).toEqual([]);
    await answerAs(db, a.refs[1], { net: hex("1"), bid: hex("5") });
    const flags = await flagsOf(a.refs[1]);
    expect(flags.map((f) => f.kind).sort()).toEqual(["identical_pattern", "same_network"]);
    expect(flags.every((f) => f.severity === "hold")).toBe(true);

    // Only the network: a note, no hold
    const b = await pair();
    await db.asUser(b.user.id, (q) => q("select public.referee_note_applicant($1, $2)", [hex("6"), hex("7")]));
    await answerAs(db, b.refs[0], { net: hex("6"), bid: hex("8"), rating: 4 });
    expect(await flagsOf(b.refs[0])).toMatchObject([{ kind: "same_network", severity: "note" }]);
    expect((await one("select public.reference_held($1) as h", [b.refs[0]])).h).toBe(false);
  });

  it("notes a link opened from three or more networks", async () => {
    const a = await pair();
    const link = await issueLink(db, a.refs[0]);
    for (const n of ["1", "2", "3"]) await asAnon("select public.referee_open($1, null, $2, $3) as r", [link, hex(n), hex("9")]);
    await issueCode(db, a.refs[0]);
    const v = (await asAnon<Row>("select public.referee_check_code($1, '123456', $2, $3) as r", [link, hex("1"), hex("9")])).session;
    await db.admin.query("update public.referee_trust set verified_at = now() - interval '5 minutes', form_seen_at = now() - interval '5 minutes' where reference_id = $1", [a.refs[0]]);
    await db.asAnon((q) => q("select public.submit_reference($1, $2, 4, 5, 4, 5, false, null, $3, $4)", [link, v, hex("1"), hex("9")]));
    expect(await flagsOf(a.refs[0])).toMatchObject([{ kind: "many_networks", severity: "note" }]);
  });

  it("lets a pastor clear a hold with a note, and nobody else, and never on their own application", async () => {
    const a = await pair();
    await answerAs(db, a.refs[0], { secondsAgo: 5 });
    const pastor = await person("pastor");
    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.referee_flags_clear($1, 'Looked into it')", [a.refs[0]])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_flags_clear($1, '')", [a.refs[0]])), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_flags_clear($1, 'ok')", [a.refs[0]])), "22023");
    const review = await asUser<Row[]>(coach.id, "select public.referee_review($1) as r", [a.appId]);
    expect(review[0]).toMatchObject({ held: true, can_clear: false });
    expect((await asUser<Row[]>(pastor.id, "select public.referee_review($1) as r", [a.appId]))[0].can_clear).toBe(true);

    await db.asUser(pastor.id, (q) => q("select public.referee_flags_clear($1, 'Phoned Pastor Ife; it was him')", [a.refs[0]]));
    expect((await one("select public.reference_held($1) as h", [a.refs[0]])).h).toBe(false);
    const after = await asUser<Row[]>(pastor.id, "select public.referee_review($1) as r", [a.appId]);
    expect(after[0].flags[0]).toMatchObject({ kind: "too_fast", cleared: true, cleared_note: "Phoned Pastor Ife; it was him" });
    expect(after[0].held).toBe(false);

    const mine = await submitted({ user: pastor });
    await listInDirectory(db, mine.contacts[0]);
    await answerAs(db, mine.refs[0], { secondsAgo: 5 });
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_flags_clear($1, 'Looked into it')", [mine.refs[0]])), "42501");
  });

  it("lets the reviewers see the flags and the applicant see nothing but a status", async () => {
    const a = await pair();
    await answerAs(db, a.refs[0], { secondsAgo: 5 });
    const mine = await db.asUser(a.user.id, async (q) => (await q("select stage, requests, changes from public.leader_references where application_id = $1 order by slot", [a.appId])).rows);
    expect(mine[0]).toMatchObject({ stage: "answered" });
    await expectCode(db.asUser(a.user.id, (q) => q("select public.referee_review($1)", [a.appId])), "42501");
    await expectCode(db.asUser(a.user.id, (q) => q("select * from public.leader_reference_flags")), "42501");
    await expectCode(db.asUser(a.user.id, (q) => q("select token_hash from public.leader_references")), "42501");
  });
});

describe("the call-back sample", () => {
  it("always queues a call for a held reference, and for about one in five of the rest", async () => {
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.referee_settings_save('{\"callback_pct\": 0}'::jsonb)"));
    const a = await submitted();
    await answerAs(db, a.refs[0], { secondsAgo: 5 });
    await answerAs(db, a.refs[1], { rating: 3 });
    const calls = await sql("select reference_id, reason from public.referee_callbacks where reference_id = any($1::uuid[])", [a.refs]);
    expect(calls).toEqual([{ reference_id: a.refs[0], reason: "flagged" }]);

    await db.asUser(pastor.id, (q) => q("select public.referee_settings_save('{\"callback_pct\": 100}'::jsonb)"));
    const b = await submitted();
    await answerAs(db, b.refs[0], { rating: 4 });
    expect((await one("select reason, due_on - public.today_lagos() as days from public.referee_callbacks where reference_id = $1", [b.refs[0]]))).toMatchObject({ reason: "sample", days: 3 });
    await db.asUser(pastor.id, (q) => q("select public.referee_settings_save('{\"callback_pct\": 20}'::jsonb)"));
  });

  it("is seen and worked by the care team, and nobody else", async () => {
    await db.admin.query("update public.referee_settings set callback_pct = 100");
    const a = await submitted();
    await answerAs(db, a.refs[0], { rating: 4 });
    const care = await person("care_lead");
    const member = await person();
    await expectCode(db.asUser(member.id, (q) => q("select public.referee_callbacks_open()")), "42501");
    const list = await asUser<Row[]>(care.id, "select public.referee_callbacks_open() as r", []);
    const mine = list.find((c) => c.application_id === a.appId)!;
    expect(mine).toMatchObject({ referee: "Pastor Ife", reason: "sample", attempts: 0, overdue: false });
    expect(mine.contact).toBe(a.contacts[0]);

    await expectCode(db.asUser(member.id, (q) => q("select public.referee_callback_close($1, 'confirmed')", [mine.id])), "42501");
    await expectCode(db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'something else')", [mine.id])), "22023");
    await db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'confirmed', 'Spoke to him, it was his')", [mine.id]));
    expect(await one("select status, outcome, note from public.referee_callbacks where id = $1", [mine.id])).toMatchObject({ status: "done", outcome: "confirmed" });
    await expectCode(db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'confirmed')", [mine.id])), "P0002");
    await db.admin.query("update public.referee_settings set callback_pct = 20");
  });

  it("tries three times when nobody answers the phone, then stops", async () => {
    await db.admin.query("update public.referee_settings set callback_pct = 100");
    const a = await submitted();
    await answerAs(db, a.refs[1]);
    const care = await person("care_lead");
    const id = (await one("select id from public.referee_callbacks where reference_id = $1", [a.refs[1]])).id as string;
    for (let i = 1; i <= 2; i++) {
      await db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'not_reached')", [id]));
      expect(await one("select status, attempts from public.referee_callbacks where id = $1", [id])).toEqual({ status: "open", attempts: i });
    }
    await db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'not_reached', 'No answer 3 times')", [id]));
    expect(await one("select status, outcome, attempts from public.referee_callbacks where id = $1", [id])).toEqual({ status: "dismissed", outcome: "not_reached", attempts: 3 });
    await db.admin.query("update public.referee_settings set callback_pct = 20");
  });

  it("takes the reference out of the scores when the person on the phone says it was not them", async () => {
    await db.admin.query("update public.referee_settings set callback_pct = 100");
    const a = await submitted();
    await listInDirectory(db, a.contacts[0]);
    await answerAs(db, a.refs[0], { rating: 5 });
    await answerAs(db, a.refs[1], { rating: 3 });
    expect((await readiness(a.appId)).references_received).toBe(2);
    const care = await person("care_lead");
    const id = (await one("select id from public.referee_callbacks where reference_id = $1", [a.refs[0]])).id as string;
    await db.asUser(care.id, (q) => q("select public.referee_callback_close($1, 'not_them', 'Says he never wrote it')", [id]));
    expect(await trust(a.refs[0])).toMatchObject({ verification: "disputed" });
    expect((await flagsOf(a.refs[0]))[0]).toMatchObject({ kind: "disowned", severity: "hold" });
    const r = await readiness(a.appId);
    expect(r.references_received).toBe(1);
    expect(r.gates.pastor_or_unit_head_referee).toBe(false);
    const pastor = await person("pastor");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_flags_clear($1, 'Looked into it')", [a.refs[0]])), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_confirm_standing($1)", [a.refs[0]])), "22023");
    await db.admin.query("update public.referee_settings set callback_pct = 20");
  });
});

describe("the pastors' list: uploading a spreadsheet", () => {
  const row = (name: string, contacts: string[], extra: Row = {}) => ({ name, standing: "pastor", contacts, ...extra });
  let pastor: { id: string; email: string };

  beforeAll(async () => {
    pastor = await person("pastor");
  });

  const preview = (rows: Row[], mode = "update") => asUser<Row>(pastor.id, "select public.referee_import_preview($1::jsonb, $2) as r", [JSON.stringify(rows), mode]);
  const apply = (rows: Row[], mode = "update", file = "pastors.xlsx", force = false) =>
    asUser<Row>(pastor.id, "select public.referee_import_apply($1::jsonb, $2, $3, $4) as r", [JSON.stringify(rows), mode, file, force]);
  const listAll = async () => (await sql("select e.name, e.standing, e.unit, e.active, (select array_agg(c.value order by c.value) from public.referee_directory_contacts c where c.entry_id = e.id) as contacts from public.referee_directory e order by lower(e.name)"));
  const clearList = async () => {
    await db.admin.query("delete from public.referee_directory_history");
    await db.admin.query("delete from public.referee_import_batches");
    await db.admin.query("delete from public.referee_directory");
  };

  it("shows what would happen and changes nothing until it is confirmed", async () => {
    await clearList();
    const rows = [
      row("Pastor Ife Adeyemi", ["0803 111 2222", "ife@church.org"], { unit: "Ota" }),
      row("Bro Tunde", ["tunde@church.org"], { standing: "Unit Head", unit: "Ushers" }),
      row("Sis Chi", ["8051112233"], { standing: "ministry-leader" }),
    ];
    const p = await preview(rows);
    expect(p.counts).toEqual({ add: 3, update: 0, unchanged: 0, retire: 0, error: 0, total: 3 });
    expect(p.active_now).toBe(0);
    expect(await listAll()).toEqual([]);

    const done = await apply(rows);
    expect(done).toMatchObject({ ok: true, counts: { add: 3 } });
    expect(await listAll()).toEqual([
      { name: "Bro Tunde", standing: "unit_head", unit: "Ushers", active: true, contacts: ["tunde@church.org"] },
      { name: "Pastor Ife Adeyemi", standing: "pastor", unit: "Ota", active: true, contacts: ["+2348031112222", "ife@church.org"] },
      { name: "Sis Chi", standing: "ministry_leader", unit: null, active: true, contacts: ["+2348051112233"] },
    ]);
  });

  it("does nothing, and records nothing, when the same file is uploaded again", async () => {
    const rows = [row("Pastor Ife Adeyemi", ["08031112222", "ife@church.org"], { unit: "Ota" }), row("Bro Tunde", ["TUNDE@church.org"], { standing: "unit_head", unit: "Ushers" })];
    const before = Number((await one("select count(*) as n from public.referee_import_batches")).n);
    const p = await preview(rows);
    expect(p.counts).toMatchObject({ add: 0, update: 0, unchanged: 2, error: 0 });
    expect(p.rows).toEqual([]);
    expect(await apply(rows)).toMatchObject({ ok: true, nothing: true });
    expect(Number((await one("select count(*) as n from public.referee_import_batches")).n)).toBe(before);
  });

  it("finds a person by any phone or email they share with the list, and updates them", async () => {
    const rows = [
      // new email, same phone, new unit and a corrected name
      row("Pastor Ifeoluwa Adeyemi", ["0803 111 2222", "ifeoluwa@church.org"], { unit: "Ota Central" }),
    ];
    const p = await preview(rows);
    expect(p.counts).toMatchObject({ add: 0, update: 1 });
    expect(p.rows[0]).toMatchObject({ action: "update", name: "Pastor Ifeoluwa Adeyemi" });
    expect(p.rows[0].changes).toEqual(expect.arrayContaining(["name", "unit", "+1 contact"]));
    await apply(rows);
    const ife = (await listAll()).find((e) => e.name === "Pastor Ifeoluwa Adeyemi")!;
    expect(ife).toMatchObject({ unit: "Ota Central", contacts: ["+2348031112222", "ife@church.org", "ifeoluwa@church.org"] });
    // "Add and update" never removes anyone: Tunde and Chi are still there
    expect((await listAll()).filter((e) => e.active)).toHaveLength(3);
  });

  it("keeps a blank unit or note in the file from wiping the one on the list, unless the whole list is being replaced", async () => {
    await apply([row("Bro Tunde", ["tunde@church.org"], { standing: "unit_head", unit: "" })]);
    expect((await listAll()).find((e) => e.name === "Bro Tunde")!.unit).toBe("Ushers");
  });

  it("explains a row it cannot use, by line, and still adds the others", async () => {
    const rows = [
      { line: 2, name: "", standing: "pastor", contacts: ["a@church.org"] },
      { line: 3, name: "Pastor Kemi", standing: "bishop", contacts: ["kemi@church.org"] },
      { line: 4, name: "Pastor Dayo", standing: "pastor", contacts: [] },
      { line: 5, name: "Pastor Gbenga", standing: "pastor", contacts: ["call him"] },
      { line: 6, name: "Pastor Ayo", standing: "pastor", contacts: ["ayo@church.org"] },
      { line: 7, name: "Pastor Ayo Again", standing: "pastor", contacts: ["AYO@church.org"] },
      { line: 8, name: "Pastor Zainab", standing: "pastor", contacts: ["zainab@church.org", "not a number"] },
    ];
    const p = await preview(rows);
    const byLine = Object.fromEntries((p.rows as Row[]).map((r) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ action: "error", message: "Add a name" });
    expect(byLine[3].message).toMatch(/Role must be/);
    expect(byLine[4].message).toBe("Add a phone number or an email");
    expect(byLine[5].message).toMatch(/Could not read "call him"/);
    expect(byLine[6].action).toBe("add");
    expect(byLine[7].message).toMatch(/Shares a phone or email with row 6/);
    expect(byLine[8]).toMatchObject({ action: "add" });
    expect(byLine[8].warn[0]).toMatch(/Ignored "not a number"/);
    expect(p.counts).toMatchObject({ add: 2, error: 5 });

    await apply(rows);
    const names = (await listAll()).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["Pastor Ayo", "Pastor Zainab"]));
    expect(names).not.toContain("Pastor Kemi");
  });

  it("refuses a row whose contacts belong to two different people on the list", async () => {
    const p = await preview([row("Mixed Up", ["0803 111 2222", "tunde@church.org"])]);
    expect(p.rows[0]).toMatchObject({ action: "error" });
    expect(p.rows[0].message).toMatch(/already belong to two different people/);
  });

  it("warns about the same name with different contacts, and adds them as a new person", async () => {
    const p = await preview([row("Bro Tunde", ["tunde2@church.org"], { standing: "unit_head" })]);
    expect(p.rows[0]).toMatchObject({ action: "add" });
    expect(p.rows[0].warn[0]).toMatch(/Same name as someone already listed/);
  });

  it("takes someone off the list when their row says Active: No, found by phone or email", async () => {
    await clearList();
    await apply([row("Pastor A", ["a@church.org"]), row("Pastor B", ["0803 555 0001"]), row("Pastor C", ["c@church.org"])]);
    const rows = [
      { line: 2, name: "", standing: "", contacts: ["08035550001"], active: false },
      { line: 3, name: "Someone Unknown", standing: "pastor", contacts: ["nobody@church.org"], active: false },
      { line: 4, name: "No contact", standing: "pastor", contacts: [], active: false },
      { line: 5, name: "Pastor C", standing: "pastor", contacts: ["c@church.org"] },
    ];
    const p = await preview(rows);
    expect(p.counts).toMatchObject({ retire: 1, error: 1, unchanged: 2, add: 0 });
    expect((p.rows as Row[]).find((r) => r.action === "retire")).toMatchObject({ line: 2, name: "Pastor B" });
    expect((p.rows as Row[]).find((r) => r.action === "error")).toMatchObject({ line: 4 });
    await apply(rows);
    const all = await listAll();
    expect(all.find((e) => e.name === "Pastor B")).toMatchObject({ active: false });
    expect(all.filter((e) => e.active).map((e) => e.name)).toEqual(["Pastor A", "Pastor C"]);
    // Saying so again changes nothing
    expect((await preview(rows)).counts).toMatchObject({ retire: 0 });
  });

  it("undoes the latest upload, and only the latest", async () => {
    await clearList();
    await apply([row("Pastor A", ["a@church.org"]), row("Pastor B", ["b@church.org"], { unit: "Old unit" })], "update", "first.xlsx");
    const first = (await sql("select id from public.referee_import_batches order by created_at desc limit 1"))[0].id as string;
    await apply([row("Pastor B", ["b@church.org", "b2@church.org"], { unit: "New unit" }), row("Pastor C", ["c@church.org"])], "update", "second.csv");
    const second = (await sql("select id from public.referee_import_batches order by created_at desc limit 1"))[0].id as string;

    const history = await asUser<Row[]>(pastor.id, "select public.referee_import_history() as r");
    expect(history.map((h) => [h.filename, h.can_undo])).toEqual([["second.csv", true], ["first.xlsx", false]]);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [first])), "22023");

    await db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [second]));
    expect(await listAll()).toEqual([
      { name: "Pastor A", standing: "pastor", unit: null, active: true, contacts: ["a@church.org"] },
      { name: "Pastor B", standing: "pastor", unit: "Old unit", active: true, contacts: ["b@church.org"] },
    ]);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [second])), "22023");
    // now the first one is the latest
    await db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [first]));
    expect(await listAll()).toEqual([]);
  });

  it("treats a replace upload as the whole list: people not in the file are retired, never deleted", async () => {
    await clearList();
    await apply([row("Pastor A", ["a@church.org", "a2@church.org"]), row("Pastor B", ["b@church.org"]), row("Pastor C", ["c@church.org"]), row("Pastor D", ["d@church.org"])]);
    const rows = [row("Pastor A", ["a@church.org"], { unit: "Main" }), row("Pastor B", ["b@church.org"]), row("Pastor C", ["c@church.org"])];
    const p = await preview(rows, "replace");
    expect(p.counts).toMatchObject({ retire: 1, update: 1, unchanged: 2 });
    expect(p.rows.find((r: Row) => r.action === "retire")).toMatchObject({ name: "Pastor D" });
    await apply(rows, "replace");
    const all = await listAll();
    expect(all.find((e) => e.name === "Pastor D")).toMatchObject({ active: false });
    expect(all.find((e) => e.name === "Pastor A")).toMatchObject({ unit: "Main", contacts: ["a@church.org"] });

    // The same file as "add and update" would have removed nothing
    const batch = (await sql("select id from public.referee_import_batches order by created_at desc limit 1"))[0].id as string;
    await db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [batch]));
    expect((await listAll()).find((e) => e.name === "Pastor D")).toMatchObject({ active: true });
    expect((await listAll()).find((e) => e.name === "Pastor A")!.contacts).toEqual(["a2@church.org", "a@church.org"]);
  });

  it("stops a replace that would empty most of the list unless that was meant", async () => {
    await clearList();
    const people = Array.from({ length: 12 }, (_, i) => row(`Pastor ${String.fromCharCode(65 + i)}`, [`p${i}@church.org`]));
    await apply(people);
    const wrongFile = people.slice(0, 2);
    const p = await preview(wrongFile, "replace");
    expect(p.counts.retire).toBe(10);
    await expectCode(apply(wrongFile, "replace"), "22023");
    expect((await listAll()).filter((e) => e.active)).toHaveLength(12);
    await apply(wrongFile, "replace", "whole-list.xlsx", true);
    expect((await listAll()).filter((e) => e.active)).toHaveLength(2);
    // The same guard does not get in the way of a normal tidy-up
    await apply(people);
    await apply(people.slice(0, 11), "replace");
    expect((await listAll()).filter((e) => e.active)).toHaveLength(11);
  });

  it("refuses an unknown mode and a file of more than five thousand people", async () => {
    await expectCode(preview([row("Pastor X", ["x@church.org"])], "merge"), "22023");
    const huge = Array.from({ length: 5001 }, (_, i) => row(`Pastor ${i}`, [`h${i}@church.org`]));
    await expectCode(preview(huge), "22023");
  });

  it("searches by name, unit, phone in any form, or email, filters by role, pages and shows retired people", async () => {
    await clearList();
    await apply([
      row("Pastor Ife Adeyemi", ["0803 111 2222", "ife@church.org"], { unit: "Ota" }),
      row("Bro Tunde Bello", ["tunde@church.org"], { standing: "unit_head", unit: "Ushers" }),
      row("Sis Chi Okoro", ["8051112233"], { standing: "ministry_leader", unit: "Choir" }),
    ]);
    const list = (args: unknown[]) => asUser<Row>(pastor.id, "select public.referee_directory_list($1, $2, $3, $4, $5) as r", args);
    expect((await list([null, null, "active", 25, 0])).total).toBe(3);
    expect(((await list(["tunde", null, "active", 25, 0])).rows as Row[]).map((r) => r.name)).toEqual(["Bro Tunde Bello"]);
    expect(((await list(["choir", null, "active", 25, 0])).rows as Row[]).map((r) => r.name)).toEqual(["Sis Chi Okoro"]);
    expect(((await list(["0803-111-2222", null, "active", 25, 0])).rows as Row[]).map((r) => r.name)).toEqual(["Pastor Ife Adeyemi"]);
    expect(((await list(["IFE@church.org", null, "active", 25, 0])).rows as Row[]).map((r) => r.name)).toEqual(["Pastor Ife Adeyemi"]);
    expect(((await list(["church.org", null, "active", 25, 0])).rows as Row[])).toHaveLength(2);
    expect((await list([null, "unit_head", "active", 25, 0])).total).toBe(1);
    const paged = await list([null, null, "active", 2, 2]);
    expect(paged.total).toBe(3);
    expect(paged.rows).toHaveLength(1);
    expect(((await list(["100%", null, "active", 25, 0])).rows as Row[])).toEqual([]); // a % is not a wildcard
    const chi = (await one("select id from public.referee_directory where name like 'Sis Chi%'")).id as string;
    await db.asUser(pastor.id, (q) => q("select public.referee_directory_set_active($1, false)", [chi]));
    expect((await list([null, null, "retired", 25, 0])).total).toBe(1);
    expect((await list([null, null, "all", 25, 0])).total).toBe(3);
    expect((await list([null, null, "active", 25, 0])).total).toBe(2);
  });

  it("exports the whole list in the shape it is uploaded in", async () => {
    const out = await asUser<Row[]>(pastor.id, "select public.referee_directory_export() as r");
    expect(out.find((e) => e.name === "Pastor Ife Adeyemi")).toMatchObject({
      standing: "pastor", unit: "Ota", active: true, phones: ["+2348031112222"], emails: ["ife@church.org"],
    });
    expect(out.map((e) => e.active)).toEqual([true, true, false]);
  });

  it("adds, edits, retires, restores and deletes one person by hand, and refuses a contact that is someone else's", async () => {
    await clearList();
    const save = (id: string | null, f: Row) => asUser<string>(pastor.id, "select public.referee_directory_save($1, $2::jsonb) as r", [id, JSON.stringify(f)]);
    const id = await save(null, { name: "  Pastor   Kemi  ", standing: "pastor", unit: "Yaba", contacts: ["0803 222 3333", "kemi@church.org"] });
    expect(await one("select name, unit from public.referee_directory where id = $1", [id])).toEqual({ name: "Pastor Kemi", unit: "Yaba" });
    const other = await save(null, { name: "Pastor Seyi", standing: "unit_head", contacts: ["seyi@church.org"] });

    await expectCode(save(null, { name: "Pastor Copy", standing: "pastor", contacts: ["KEMI@church.org"] }), "22023");
    await expectCode(save(other, { name: "Pastor Seyi", standing: "unit_head", contacts: ["08032223333"] }), "22023");
    await expectCode(save(id, { name: "Pastor Kemi", standing: "pastor", contacts: [] }), "22023");
    await expectCode(save(id, { name: "P", standing: "pastor", contacts: ["k@church.org"] }), "22023");
    await expectCode(save(id, { name: "Pastor Kemi", standing: "elder", contacts: ["k@church.org"] }), "22023");
    await expectCode(save(id, { name: "Pastor Kemi", standing: "pastor", contacts: ["nonsense"] }), "22023");
    await expectCode(save("00000000-0000-0000-0000-000000000000", { name: "Pastor Kemi", standing: "pastor", contacts: ["k@church.org"] }), "P0002");

    await save(id, { name: "Pastor Kemi O.", standing: "unit_head", unit: "Yaba", contacts: ["0803 222 3333"] });
    expect(await one("select name, standing from public.referee_directory where id = $1", [id])).toEqual({ name: "Pastor Kemi O.", standing: "unit_head" });
    expect(await sql("select value from public.referee_directory_contacts where entry_id = $1", [id])).toEqual([{ value: "+2348032223333" }]);

    await db.asUser(pastor.id, (q) => q("select public.referee_directory_set_active($1, false)", [id]));
    expect((await one("select public.referee_directory_match('+2348032223333') as m")).m).toBeNull();
    await db.asUser(pastor.id, (q) => q("select public.referee_directory_set_active($1, true)", [id]));
    expect((await one("select public.referee_directory_match('+2348032223333') as m")).m).toBe(id);
    await db.asUser(pastor.id, (q) => q("select public.referee_directory_delete($1)", [id]));
    expect((await one("select public.referee_directory_match('+2348032223333') as m")).m).toBeNull();
    await expectCode(db.asUser(pastor.id, (q) => q("select public.referee_directory_delete($1)", [id])), "P0002");
  });

  it("is for pastors, the director and admins only", async () => {
    const rows = JSON.stringify([row("Pastor Z", ["z@church.org"])]);
    for (const role of ["coach", "leader", "care_lead", "tribe_leader"] as const) {
      const who = await person(role === "tribe_leader" ? undefined : role);
      for (const call of [
        ["select public.referee_import_preview($1::jsonb, 'update')", [rows]],
        ["select public.referee_import_apply($1::jsonb, 'update', 'f.csv', false)", [rows]],
        ["select public.referee_directory_list(null, null, 'active', 25, 0)", []],
        ["select public.referee_directory_export()", []],
        ["select public.referee_import_history(5)", []],
        ["select public.referee_overview()", []],
        ["select public.referee_unverified_list(5, 0)", []],
        ["select public.referee_reverify_all()", []],
        ["select public.referee_settings_save('{}'::jsonb)", []],
      ] as [string, unknown[]][]) {
        await expectCode(db.asUser(who.id, (q) => q(call[0], call[1])), "42501");
      }
    }
    await expectCode(db.asAnon((q) => q("select public.referee_directory_list(null, null, 'active', 25, 0)")), "42501");
    for (const role of ["director", "admin"]) {
      const who = await person(role);
      expect((await asUser<Row>(who.id, "select public.referee_import_preview($1::jsonb, 'update') as r", [rows])).counts.add).toBe(1);
    }
  });

  it("helps a reference that was already in the moment its person is uploaded", async () => {
    await clearList();
    const a = await submitted();
    await answerAs(db, a.refs[0]);
    expect((await trust(a.refs[0])).standing).toBe(false);
    await apply([row("Pastor Ife", [a.contacts[0]])]);
    expect(await trust(a.refs[0])).toMatchObject({ verification: "directory", standing: true });
    const batch = (await sql("select id from public.referee_import_batches order by created_at desc limit 1"))[0].id as string;
    // Undoing the upload does not take away what was proved while it stood
    await db.asUser(pastor.id, (q) => q("select public.referee_import_undo($1)", [batch]));
    expect(await trust(a.refs[0])).toMatchObject({ standing: true });
  });

  it("shows the pastorate where things stand", async () => {
    const o = await asUser<Row>(pastor.id, "select public.referee_overview() as r");
    expect(o.settings).toMatchObject({ callback_pct: 20, min_seconds: 40, max_tries: 5, max_changes: 2, gate_standings: expect.arrayContaining(["pastor", "unit_head"]) });
    expect(o.directory).toMatchObject({ active: expect.any(Number), retired: expect.any(Number) });
    expect(o.references).toMatchObject({ unverified: expect.any(Number), held: expect.any(Number), asked: expect.any(Number), to_confirm: expect.any(Number) });
    expect(o.callbacks_open).toEqual(expect.any(Number));
  });
});

describe("references that were already in: asking the referee to confirm", () => {
  /** A reference answered before this release: a row that arrives already answered is grandfathered as valid and not verified. */
  async function legacy() {
    const a = await submitted();
    await db.admin.query(
      "insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern) values ($1, 4, 4, 5, 4, false)",
      [a.refs[0]],
    );
    await db.admin.query("update public.leader_references set submitted_at = now() - interval '3 days', stage = 'answered' where id = $1", [a.refs[0]]);
    await db.admin.query("update public.referee_trust set legacy = true, standing = true where reference_id = $1", [a.refs[0]]);
    return a;
  }

  it("keeps an answered reference valid, marked not verified, and nothing is deleted", async () => {
    const a = await legacy();
    expect(await trust(a.refs[0])).toMatchObject({ legacy: true, verification: "unverified" });
    expect((await readiness(a.appId)).references_received).toBe(1);
    expect((await readiness(a.appId)).gates).toMatchObject({ references_unverified: 1 });
    expect(Number((await one("select count(*) as n from public.leader_reference_answers where reference_id = $1", [a.refs[0]])).n)).toBe(1);
  });

  it("lets a pastor ask one referee, or all of them, and not over and over", async () => {
    const a = await legacy();
    const pastor = await person("pastor");
    const list = await asUser<Row>(pastor.id, "select public.referee_unverified_list(25, 0) as r");
    expect(list.rows.find((r: Row) => r.id === a.refs[0])).toMatchObject({ referee: "Pastor Ife", kind: "email", reachable: true, asked_at: null });
    expect(JSON.stringify(list)).not.toContain(a.contacts[0]);

    expect(await asUser<Row>(pastor.id, "select public.referee_reverify_send($1) as r", [a.refs[0]])).toEqual({ ok: true });
    expect(await asUser<Row>(pastor.id, "select public.referee_reverify_send($1) as r", [a.refs[0]])).toEqual({ ok: false, reason: "recent" });
    expect(await asUser<Row>(pastor.id, "select public.referee_reverify_send($1) as r", [a.refs[1]])).toEqual({ ok: false, reason: "not needed" });
    expect((await asUser<Row>(pastor.id, "select public.referee_overview() as r")).references.asked).toBeGreaterThanOrEqual(1);

    const b = await legacy();
    const all = await asUser<Row>(pastor.id, "select public.referee_reverify_all() as r");
    expect(all.sent).toBeGreaterThanOrEqual(1);
    expect(await refRow(b.refs[0])).toBeTruthy();
    expect((await trust(b.refs[0])).reverify_sent_at).not.toBeNull();
  });

  it("sends a link that opens a one-minute confirmation, and a code to the same contact", async () => {
    const a = await legacy();
    const pastor = await person("pastor");
    await asUser(pastor.id, "select public.referee_reverify_send($1) as r", [a.refs[0]]);
    const item = (await claim()).find((i) => i.template === "referee_reverify" && i.params.reference_id === a.refs[0])!;
    expect(item.params).toMatchObject({ kind: "referee_reverify", referee: "Pastor Ife" });
    const link = item.params.secret as string;
    const open = await asAnon<Row>("select public.referee_open($1, null, $2, $3) as r", [link, hex("a"), hex("b")]);
    expect(open).toMatchObject({ state: "open", mode: "reverify", referee: "Pastor Ife" });

    await asAnon("select public.referee_ask_code($1, $2) as r", [link, hex("a")]);
    const codeMsg = (await claim()).find((i) => i.template === "referee_code" && i.params.reference_id === a.refs[0])!;
    const session = (await asAnon<Row>("select public.referee_check_code($1, $2, $3, $4) as r", [link, codeMsg.params.code, hex("a"), hex("b")])).session as string;
    // The right code verifies the contact, and the page must still be asking "was this yours?" rather than saying it is already sent
    expect(await asAnon<Row>("select public.referee_open($1, $2, $3, $4) as r", [link, session, hex("a"), hex("b")])).toMatchObject({ state: "open", mode: "reverify", verified: true });
    await expectCode(db.asAnon((q) => q("select public.referee_reverify_answer($1, $2, true)", [link, secret()])), "22023");
    await db.asAnon((q) => q("select public.referee_reverify_answer($1, $2, true)", [link, session]));
    expect(await trust(a.refs[0])).toMatchObject({ verification: "contact" });
    expect((await trust(a.refs[0])).reverified_at).not.toBeNull();
    expect((await asAnon<Row>("select public.referee_open($1, null, null, null) as r", [link])).state).toBe("answered");
    // And it cannot be confirmed twice
    await expectCode(db.asAnon((q) => q("select public.referee_reverify_answer($1, $2, true)", [link, session])), "22023");
    expect((await readiness(a.appId)).gates.references_unverified).toBe(0);
  });

  it("takes a disowned reference out of the scores and sends it to the care team", async () => {
    const a = await legacy();
    const pastor = await person("pastor");
    await asUser(pastor.id, "select public.referee_reverify_send($1) as r", [a.refs[0]]);
    const link = (await claim()).find((i) => i.template === "referee_reverify" && i.params.reference_id === a.refs[0])!.params.secret as string;
    await asAnon("select public.referee_ask_code($1, null) as r", [link]);
    const code = (await claim()).find((i) => i.template === "referee_code" && i.params.reference_id === a.refs[0])!.params.code;
    const session = (await asAnon<Row>("select public.referee_check_code($1, $2, null, null) as r", [link, code])).session as string;
    await db.asAnon((q) => q("select public.referee_reverify_answer($1, $2, false)", [link, session]));
    expect(await trust(a.refs[0])).toMatchObject({ verification: "disputed" });
    expect((await flagsOf(a.refs[0]))[0]).toMatchObject({ kind: "disowned", severity: "hold" });
    expect((await one("select reason, status from public.referee_callbacks where reference_id = $1", [a.refs[0]]))).toEqual({ reason: "disowned", status: "open" });
    expect((await readiness(a.appId)).references_received).toBe(0);
  });
});

describe("what the sending service can and cannot do", () => {
  it("is the only way to claim messages, with its own token", async () => {
    await expectCode(db.asAnon((q) => q("select public.worker_claim('utw_not_a_real_token_0000000000000000000000', 5)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_referee_tick('short')")), "42501");
  });

  it("forgets old hashes, spent codes and sessions on the heartbeat", async () => {
    const a = await submitted();
    await db.asUser(a.user.id, (q) => q("select public.referee_note_applicant($1, $2)", [hex("a"), hex("b")]));
    await db.admin.query("update public.applicant_sessions set seen_at = now() - interval '50 days'");
    await issueCode(db, a.refs[0], "999999");
    await db.admin.query("update public.referee_access set code_expires_at = now() - interval '1 minute', session_hash = 'x', session_expires_at = now() - interval '1 minute' where reference_id = $1", [a.refs[0]]);
    const out = await asWorker("select public.worker_referee_tick($1) as r");
    expect(out.hashes_forgotten).toBeGreaterThanOrEqual(1);
    expect(out.codes_expired).toBeGreaterThanOrEqual(1);
    expect(await one("select code_hash, session_hash from public.referee_access where reference_id = $1", [a.refs[0]])).toEqual({ code_hash: null, session_hash: null });
    expect(Number((await one("select count(*) as n from public.applicant_sessions")).n)).toBe(0);
  });

  it("calls a request that never found a channel unreachable instead of leaving it sending", async () => {
    const a = await submitted();
    await asUser(a.user.id, "select public.request_referee_send($1) as r", [a.refs[0]]);
    await db.admin.query("update public.leader_references set last_request_at = now() - interval '3 hours' where id = $1", [a.refs[0]]);
    await asWorker("select public.worker_referee_tick($1) as r");
    expect((await refRow(a.refs[0])).stage).toBe("unreachable");
  });
});

describe("the people who were already in the system", () => {
  it("gave every reference a trust and access row, so nothing reads empty", async () => {
    const a = await submitted();
    for (const ref of a.refs) {
      expect(await trust(ref)).toBeTruthy();
      expect(await one("select 1 as x from public.referee_access where reference_id = $1", [ref])).toBeTruthy();
    }
    expect(Number((await one("select count(*) as n from public.leader_references r where not exists (select 1 from public.referee_trust t where t.reference_id = r.id)")).n)).toBe(0);
  });

  it("treats a row that arrives already answered like the ones that were here: valid, not verified", async () => {
    const user = await person();
    const appId = (await one("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, 'v') returning id", [user.id, JSON.stringify(answers())])).id as string;
    const id = (await one(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, token_hash, token_expires_at, submitted_at, is_pastor_or_unit_head)
       values ($1, 1, 'Old Referee', 'Pastor', $2, $3, now(), now(), true) returning id`,
      [appId, uniqueEmail("old"), "e".repeat(64)],
    )).id as string;
    expect(await trust(id)).toMatchObject({ legacy: true, verification: "unverified", standing: true });
    expect(await refRow(id)).toMatchObject({ stage: "answered", contact_kind: "email" });
  });
});

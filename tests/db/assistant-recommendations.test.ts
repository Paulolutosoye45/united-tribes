import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, makeYoung, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// A leader recommends an assistant leader; the office decides. One assistant for a tribe, never a gap, a tribe with young members is
// decided by a pastor or a director, and the leader is told the outcome in a line (the office's reason stays with the office).

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let seasonId: string;
let admin: string;
let director: string;
let pastor: string;
let n = 0;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> =>
  (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> =>
  (await sql(text, params))[0];
const as = async (uid: string, fn: string, ...args: unknown[]) =>
  (
    await db.asUser(uid, (q) =>
      q(
        `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`,
        args,
      ),
    )
  ).rows[0]?.r;
const mail = (template: string, person: string, dedupe?: string) =>
  sql(
    "select * from public.messages where template = $1 and person_id = $2 and ($3::text is null or dedupe_key like $3 || '%') order by created_at",
    [template, person, dedupe ?? null],
  );
const tribeRow = (id: string) =>
  one(
    "select assistant_id, status, leader_id from public.tribes where id = $1",
    [id],
  );
const rec = (id: string) =>
  one("select * from public.assistant_recommendations where id = $1", [id]);

/** A tribe with a leader (certified), with or without a certified assistant already. */
async function tribe(
  o2: { assistant?: boolean; status?: string; track?: string } = {},
) {
  return k.tribe(seasonId, {
    community: "professionals",
    assistant: o2.assistant ? "certified" : undefined,
    status: o2.status,
    track: o2.track,
  });
}
/** Someone who is an approved assistant leader and is not yet the assistant of any tribe. */
async function approvedAssistant(name = `Asst${++n}`) {
  return k.staff(name, "assistant_leader");
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  seasonId = await k.season("Assistants", -30);
  admin = (await k.staff("Admin", "admin")).id;
  director = (await k.staff("Director", "director")).id;
  pastor = (await k.staff("Pastor", "pastor")).id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("recommending", () => {
  it("is only for the leader of the tribe: a stranger, another leader, the office and a signed-out visitor are all refused", async () => {
    const t = await tribe();
    const other = await tribe();
    const nominee = await approvedAssistant();
    for (const who of [
      (await k.person("Stranger")).id,
      other.leader.id,
      admin,
      pastor,
      t.assistant?.id ?? other.leader.id,
    ]) {
      await expectCode(
        as(who, "assistant_recommend", t.tribe, nominee.id, null, "Good."),
        "42501",
      );
    }
    await expectCode(
      db.asAnon((q) =>
        q("select public.assistant_recommend($1, $2, null, null)", [
          t.tribe,
          nominee.id,
        ]),
      ),
      "42501",
    );
    await expectCode(
      as(other.leader.id, "assistant_my_state", t.tribe),
      "42501",
    );
  });

  it("asks for a name, a real address, someone other than the leader, an adult, and a short reason", async () => {
    const t = await tribe();
    const lead = t.leader.id;
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, null, null, null),
      "22023",
    );
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, null, "not-an-address", null),
      "22023",
    );
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, lead, null, null),
      "22023",
    );
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, null, t.leader.email, null),
      "22023",
    );
    await expectCode(
      as(
        lead,
        "assistant_recommend",
        t.tribe,
        (await approvedAssistant()).id,
        null,
        "x".repeat(401),
      ),
      "22023",
    );
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, o.owner.id, null, null),
      "P0002",
    );
    const young = await k.person("Young");
    await makeYoung(db, k, young.id, seasonId);
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, young.id, null, null),
      "22023",
    );
    await expectCode(
      as(lead, "assistant_recommend", t.tribe, null, young.email, null),
      "22023",
    );
    expect(
      await one(
        "select count(*)::int c from public.assistant_recommendations where tribe_id = $1",
        [t.tribe],
      ),
    ).toEqual({ c: 0 });
  });

  it("refuses the person who is already the assistant, and a tribe that is closed", async () => {
    const t = await tribe({ assistant: true });
    await expectCode(
      as(
        t.leader.id,
        "assistant_recommend",
        t.tribe,
        t.assistant!.id,
        null,
        null,
      ),
      "22023",
    );
    const closed = await tribe({ status: "closed" });
    await expectCode(
      as(
        closed.leader.id,
        "assistant_recommend",
        closed.tribe,
        (await approvedAssistant()).id,
        null,
        null,
      ),
      "22023",
    );
    expect(
      (await as(closed.leader.id, "assistant_my_state", closed.tribe)).closed,
    ).toBe(true);
  });

  it("records a person by account or an address by itself, in the leader's words, and says so on the tribe page", async () => {
    const t = await tribe();
    const m = await approvedAssistant("Rita");
    const res = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      null,
      `  ${m.email.toUpperCase()} `,
      "  Faithful and kind  ",
    );
    expect(res).toMatchObject({ ok: true });
    expect(await rec(res.id)).toMatchObject({
      status: "requested",
      nominee_id: m.id,
      nominee_email: m.email.toLowerCase(),
      reason: "Faithful and kind",
      recommended_by: t.leader.id,
    });
    const state = await as(t.leader.id, "assistant_my_state", t.tribe);
    expect(state.assistant).toBeNull();
    expect(state.open).toMatchObject({
      id: res.id,
      status: "requested",
      name: "Rita Test",
    });
    expect(state.closed).toBe(false);

    const t2 = await tribe();
    const r2 = await as(
      t2.leader.id,
      "assistant_recommend",
      t2.tribe,
      null,
      "Someone.New@Example.org",
      null,
    );
    expect(await rec(r2.id)).toMatchObject({
      nominee_id: null,
      nominee_email: "someone.new@example.org",
      reason: null,
    });
    expect(
      (await as(t2.leader.id, "assistant_my_state", t2.tribe)).open.name,
    ).toBe("someone.new@example.org");
  });

  it("allows one waiting recommendation at a time, and the leader can withdraw it and think again", async () => {
    const t = await tribe();
    const a = await approvedAssistant();
    const b = await approvedAssistant();
    const first = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      a.id,
      null,
      null,
    );
    await expectCode(
      as(t.leader.id, "assistant_recommend", t.tribe, b.id, null, null),
      "22023",
    );
    // no one else can withdraw it
    await expectCode(as(admin, "assistant_withdraw", first.id), "P0002");
    await expectCode(
      as((await tribe()).leader.id, "assistant_withdraw", first.id),
      "P0002",
    );
    expect(await as(t.leader.id, "assistant_withdraw", first.id)).toEqual({
      ok: true,
      status: "withdrawn",
    });
    expect(await as(t.leader.id, "assistant_withdraw", first.id)).toEqual({
      ok: true,
      already: true,
      status: "withdrawn",
    });
    const second = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      b.id,
      null,
      null,
    );
    expect(second.ok).toBe(true);
    // a withdrawn recommendation cannot be decided
    expect(
      await as(pastor, "assistant_decide", first.id, true, null, false),
    ).toMatchObject({ already: true, status: "withdrawn" });
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
  });

  it("tells the office in its own notices, the pastors and directors alone for a tribe with young members", async () => {
    await db.admin.query(
      "update public.notice_settings set mode = 'on' where group_key in ('pastors', 'directors', 'admin')",
    );
    const t = await tribe();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      (await approvedAssistant()).id,
      null,
      null,
    );
    const items = await sql(
      "select person_id, kind, label, path from public.notice_items where event = $1",
      ["assistantrec:" + r.id],
    );
    expect(
      items.every(
        (i) =>
          i.kind === "office_assistant_recommended" &&
          i.path === "/admin/assistants",
      ),
    ).toBe(true);
    const told = items.map((i) => i.person_id);
    expect(told).toEqual(expect.arrayContaining([admin, director, pastor]));

    const youngTribe = await tribe();
    const kid = await k.seat(youngTribe.tribe, seasonId, "Kid", {
      profile: false,
    });
    await makeYoung(db, k, kid.id, seasonId);
    const r2 = await as(
      youngTribe.leader.id,
      "assistant_recommend",
      youngTribe.tribe,
      (await approvedAssistant()).id,
      null,
      null,
    );
    const told2 = (
      await sql("select person_id from public.notice_items where event = $1", [
        "assistantrec:" + r2.id,
      ])
    ).map((i) => i.person_id);
    expect(told2).toEqual(expect.arrayContaining([director, pastor]));
    expect(told2).not.toContain(admin);
    expect(JSON.stringify(items)).not.toMatch(/Faithful|young|minor/i);
  });
});

describe("the office", () => {
  it("lists the requests for the office only, with what the office needs to decide", async () => {
    const t = await tribe();
    const m = await approvedAssistant();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      "She runs our prayer chain.",
    );
    await expectCode(as(t.leader.id, "assistant_requests"), "42501");
    await expectCode(
      as((await k.person("Nobody")).id, "assistant_requests"),
      "42501",
    );
    for (const who of [admin, director, pastor])
      expect(
        (await as(who, "assistant_requests")).open.map((x: Row) => x.id),
      ).toContain(r.id);
    const row = (await o.call("assistant_requests")).open.find(
      (x: Row) => x.id === r.id,
    );
    expect(row).toMatchObject({
      status: "requested",
      reason: "She runs our prayer chain.",
      young: false,
      can_decide: true,
      nominee: {
        is_assistant: true,
        certified: false,
        has_account: true,
        paired_elsewhere: false,
      },
    });
    expect(row.tribe).toMatchObject({ id: t.tribe, assistant: null });
    await as(admin, "assistant_decide", r.id, false, null, false);
    const after = await as(admin, "assistant_requests");
    expect(after.open.map((x: Row) => x.id)).not.toContain(r.id);
    expect(after.recent.map((x: Row) => x.id)).toContain(r.id);
  });

  it("is decided by an admin, a director, a pastor or God Mode; only a pastor or a director decides for young members", async () => {
    const mk = async (young: boolean) => {
      const t = await tribe();
      if (young) {
        const kid = await k.seat(t.tribe, seasonId, "Kid", { profile: false });
        await makeYoung(db, k, kid.id, seasonId);
      }
      const m = await approvedAssistant();
      const r = await as(
        t.leader.id,
        "assistant_recommend",
        t.tribe,
        m.id,
        null,
        null,
      );
      return { t, m, r: r.id as string };
    };
    // an ordinary tribe
    const plain = await mk(false);
    await expectCode(
      as(
        (await k.person("Random")).id,
        "assistant_decide",
        plain.r,
        true,
        null,
        false,
      ),
      "42501",
    );
    await expectCode(
      as(plain.t.leader.id, "assistant_decide", plain.r, true, null, false),
      "42501",
    ); // not even the leader
    expect(
      await as(admin, "assistant_decide", plain.r, true, null, false),
    ).toEqual({ ok: true, status: "paired" });
    // a tribe with a young member
    const kids = await mk(true);
    expect(
      (await as(admin, "assistant_requests")).open.find(
        (x: Row) => x.id === kids.r,
      ),
    ).toMatchObject({ young: true, can_decide: false });
    await expect(
      as(admin, "assistant_decide", kids.r, true, null, false),
    ).rejects.toThrow(/pastor or a director decides/);
    await expectCode(
      as(admin, "assistant_decide", kids.r, false, null, false),
      "42501",
    );
    expect((await rec(kids.r)).status).toBe("requested");
    expect(
      await as(director, "assistant_decide", kids.r, true, null, false),
    ).toEqual({ ok: true, status: "paired" });
    const kids2 = await mk(true);
    expect(
      await as(pastor, "assistant_decide", kids2.r, true, null, false),
    ).toEqual({ ok: true, status: "paired" });
    const kids3 = await mk(true);
    expect(
      await o.call("assistant_decide", kids3.r, true, null, false),
    ).toEqual({ ok: true, status: "paired" });
    // a teens tribe is young whoever is in it
    const teens = await tribe({ track: "teens" });
    const tr = await as(
      teens.leader.id,
      "assistant_recommend",
      teens.tribe,
      (await approvedAssistant()).id,
      null,
      null,
    );
    await expectCode(
      as(admin, "assistant_decide", tr.id, true, null, false),
      "42501",
    );
    await as(pastor, "assistant_decide", tr.id, false, null, false);
    // a say-nothing call is refused
    const bad = await mk(false);
    await expectCode(
      as(admin, "assistant_decide", bad.r, null, null, false),
      "22023",
    );
    await expectCode(
      as(admin, "assistant_decide", bad.r, true, "x".repeat(301), false),
      "22023",
    );
    await expectCode(
      as(
        admin,
        "assistant_decide",
        "00000000-0000-0000-0000-000000000000",
        true,
        null,
        false,
      ),
      "P0002",
    );
  });

  it("pairs an approved assistant leader at once, and tells them and the leader by email", async () => {
    const t = await tribe();
    const m = await approvedAssistant("Ada");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      "Dependable.",
    );
    expect(
      await as(
        director,
        "assistant_decide",
        r.id,
        true,
        "Welcome aboard.",
        false,
      ),
    ).toEqual({ ok: true, status: "paired" });
    expect((await tribeRow(t.tribe)).assistant_id).toBe(m.id);
    expect(await rec(r.id)).toMatchObject({
      status: "paired",
      decided_by: director,
      decision_note: "Welcome aboard.",
    });
    expect((await rec(r.id)).paired_at).not.toBeNull();
    const toNominee = await mail(
      "assistant_paired",
      m.id,
      "assistant-paired:" + r.id,
    );
    const toLeader = await mail(
      "assistant_decided",
      t.leader.id,
      "assistant-decided:" + r.id,
    );
    expect(toNominee).toHaveLength(1);
    expect(toLeader).toHaveLength(1);
    expect(toNominee[0].force_channel).toBe("email");
    expect(Object.keys(toNominee[0].params).sort()).toEqual([
      "leader_first",
      "tribe",
    ]);
    expect(toLeader[0].params).toMatchObject({
      outcome: "approved",
      assistant_first: "Ada",
    });
    expect(Object.keys(toLeader[0].params).sort()).toEqual([
      "assistant_first",
      "outcome",
      "tribe",
    ]);
    // the office's note never goes to the leader or the nominee
    expect(JSON.stringify([toNominee, toLeader])).not.toContain(
      "Welcome aboard",
    );
    // deciding again changes nothing and sends nothing more
    expect(
      await as(director, "assistant_decide", r.id, false, null, false),
    ).toMatchObject({ ok: true, already: true, status: "paired" });
    expect(
      await mail("assistant_decided", t.leader.id, "assistant-decided:" + r.id),
    ).toHaveLength(1);
    expect(
      (await as(t.leader.id, "assistant_my_state", t.tribe)).assistant,
    ).toEqual({ name: "Ada Test" });
  });

  it("invites someone who is not yet an approved assistant leader to apply, and pairs them from the heartbeat once approved", async () => {
    const t = await tribe();
    const m = await k.person("Newcomer");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    expect(
      await as(admin, "assistant_decide", r.id, true, null, false),
    ).toEqual({ ok: true, status: "invited" });
    expect((await rec(r.id)).status).toBe("invited");
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
    expect(
      await mail("assistant_invited", m.id, "assistant-invited:" + r.id),
    ).toHaveLength(1);
    expect(
      (
        await mail(
          "assistant_decided",
          t.leader.id,
          "assistant-decided:" + r.id,
        )
      )[0].params,
    ).toMatchObject({ outcome: "invited" });
    // the invitation still counts as the one open recommendation
    await expectCode(
      as(
        t.leader.id,
        "assistant_recommend",
        t.tribe,
        (await approvedAssistant()).id,
        null,
        null,
      ),
      "22023",
    );
    // nothing happens until they hold the role
    const token = (
      await one("select public.bootstrap_worker_token('assistant-test') as t")
    ).t as string;
    expect(
      await db
        .asAnon((q) =>
          q("select public.worker_assistant_tick($1) as r", [token]),
        )
        .then((x) => x.rows[0].r),
    ).toEqual({ paired: 0, expired: 0 });
    expect((await rec(r.id)).status).toBe("invited");
    await db.grant(m.id, "assistant_leader");
    const tick = await one("select public.assistant_tick() as r");
    expect(tick.r).toEqual({ paired: 1, expired: 0 });
    expect((await tribeRow(t.tribe)).assistant_id).toBe(m.id);
    expect((await rec(r.id)).status).toBe("paired");
    expect(
      await mail("assistant_paired", m.id, "assistant-paired:" + r.id),
    ).toHaveLength(1);
    expect(
      await mail(
        "assistant_decided",
        t.leader.id,
        "assistant-paired-leader:" + r.id,
      ),
    ).toHaveLength(1);
    // running it again pairs nobody twice
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 0,
    });
  });

  it("invites a person named by email alone, by email only, and finds them when they sign in", async () => {
    const t = await tribe();
    const address = `walk.in${++n}@example.org`;
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      null,
      address,
      null,
    );
    expect(
      await as(pastor, "assistant_decide", r.id, true, null, false),
    ).toEqual({ ok: true, status: "invited" });
    const invite = await one(
      "select person_id, to_email, force_channel, params from public.messages where template = 'assistant_invited' and dedupe_key = $1",
      ["assistant-invited:" + r.id],
    );
    expect(invite).toMatchObject({
      person_id: null,
      to_email: address,
      force_channel: "email",
    });
    expect(Object.keys(invite.params).sort()).toEqual([
      "leader_first",
      "tribe",
    ]);
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 0,
    });
    // they sign up with that address and are approved
    const person = await db.createUser({ email: address });
    await db.grant(person.id, "assistant_leader");
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 1,
      expired: 0,
    });
    expect(await rec(r.id)).toMatchObject({
      status: "paired",
      nominee_id: person.id,
    });
    expect((await tribeRow(t.tribe)).assistant_id).toBe(person.id);
  });

  it("changes the assistant in one step with Replace, and tells the one who was replaced", async () => {
    const t = await tribe({ assistant: true });
    const old = t.assistant!.id;
    const m = await approvedAssistant("Newer");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    await expect(
      as(admin, "assistant_decide", r.id, true, null, false),
    ).rejects.toThrow(/Choose Replace/);
    expect((await tribeRow(t.tribe)).assistant_id).toBe(old); // still has the one assistant
    expect((await rec(r.id)).status).toBe("requested");
    expect(await as(admin, "assistant_decide", r.id, true, null, true)).toEqual(
      { ok: true, status: "paired" },
    );
    expect((await tribeRow(t.tribe)).assistant_id).toBe(m.id);
    const told = await mail(
      "assistant_replaced",
      old,
      "assistant-replaced:" + r.id,
    );
    expect(told).toHaveLength(1);
    expect(told[0].params).toEqual({ tribe: expect.any(String) });
    expect(
      await one(
        "select count(*)::int c from public.tribes where assistant_id = $1",
        [old],
      ),
    ).toEqual({ c: 0 });
    // a recommendation for the person already there is simply refused
    await expectCode(
      as(t.leader.id, "assistant_recommend", t.tribe, m.id, null, null),
      "22023",
    );
  });

  it("keeps the old assistant when the new one cannot be paired: the change is all or nothing", async () => {
    const t = await tribe({ assistant: true });
    const old = t.assistant!.id;
    const busy = await approvedAssistant("Busy");
    const elsewhere = await tribe();
    await db.admin.query(
      "update public.tribes set assistant_id = $1 where id = $2",
      [busy.id, elsewhere.tribe],
    );
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      busy.id,
      null,
      null,
    );
    expect(
      (await as(admin, "assistant_requests")).open.find(
        (x: Row) => x.id === r.id,
      ).nominee.paired_elsewhere,
    ).toBe(true);
    await expect(
      as(admin, "assistant_decide", r.id, true, null, true),
    ).rejects.toThrow(/already the assistant of another tribe/);
    expect((await tribeRow(t.tribe)).assistant_id).toBe(old);
    expect((await rec(r.id)).status).toBe("requested");
    expect(await mail("assistant_replaced", old)).toHaveLength(0);
    expect((await rec(r.id)).decided_at).toBeNull(); // the failed attempt left no half decision behind
  });

  it("carries Replace through an invitation: the new person takes the place when approved, and the old assistant is told", async () => {
    const t = await tribe({ assistant: true });
    const old = t.assistant!.id;
    const m = await k.person("Applicant");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    expect(
      await as(pastor, "assistant_decide", r.id, true, null, true),
    ).toEqual({ ok: true, status: "invited" });
    expect((await rec(r.id)).replace_existing).toBe(true);
    expect((await tribeRow(t.tribe)).assistant_id).toBe(old); // until they are approved, the tribe keeps the one it has
    await db.grant(m.id, "assistant_leader");
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 1,
      expired: 0,
    });
    expect((await tribeRow(t.tribe)).assistant_id).toBe(m.id);
    expect(
      await mail("assistant_replaced", old, "assistant-replaced:" + r.id),
    ).toHaveLength(1);
  });

  it("does not take the place of an assistant who arrived meanwhile unless Replace was chosen", async () => {
    const t = await tribe();
    const m = await k.person("Slow");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    await as(admin, "assistant_decide", r.id, true, null, false);
    // the review panel pairs another assistant in the meantime
    const other = await approvedAssistant("Panel");
    await db.admin.query(
      "update public.tribes set assistant_id = $1 where id = $2",
      [other.id, t.tribe],
    );
    await db.grant(m.id, "assistant_leader");
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 0,
    });
    expect((await tribeRow(t.tribe)).assistant_id).toBe(other.id);
    expect((await rec(r.id)).status).toBe("invited");
  });

  it("does not pair a nominee who turned out to be under 18", async () => {
    const t = await tribe();
    const m = await approvedAssistant("Later");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    await makeYoung(db, k, m.id, seasonId);
    await expectCode(
      as(admin, "assistant_decide", r.id, true, null, false),
      "22023",
    );
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
    expect(await mail("assistant_paired", m.id)).toHaveLength(0);
  });

  it("declines with a note that stays with the office, and tells the leader in a line", async () => {
    const t = await tribe();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      (await approvedAssistant()).id,
      null,
      "A friend.",
    );
    expect(
      await as(
        pastor,
        "assistant_decide",
        r.id,
        false,
        "  Not this season, we are waiting on references.  ",
        false,
      ),
    ).toEqual({ ok: true, status: "declined" });
    expect(await rec(r.id)).toMatchObject({
      status: "declined",
      decided_by: pastor,
      decision_note: "Not this season, we are waiting on references.",
    });
    const told = await mail(
      "assistant_decided",
      t.leader.id,
      "assistant-decided:" + r.id,
    );
    expect(told).toHaveLength(1);
    expect(told[0].params).toEqual({
      tribe: expect.any(String),
      outcome: "declined",
    });
    const state = await as(t.leader.id, "assistant_my_state", t.tribe);
    expect(state.open).toBeNull();
    expect(state.last).toMatchObject({ status: "declined" });
    expect(JSON.stringify(state)).not.toMatch(/references|Not this season/);
    // the leader may then recommend someone else
    expect(
      (
        await as(
          t.leader.id,
          "assistant_recommend",
          t.tribe,
          (await approvedAssistant()).id,
          null,
          null,
        )
      ).ok,
    ).toBe(true);
    // the office still sees its note
    expect(
      (await as(admin, "assistant_requests")).recent.find(
        (x: Row) => x.id === r.id,
      ).note,
    ).toBe("Not this season, we are waiting on references.");
  });

  it("never names the owner: a decision by God Mode has no decider on record, and the events carry no actor", async () => {
    const t = await tribe();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      (await approvedAssistant()).id,
      null,
      null,
    );
    expect(await o.call("assistant_decide", r.id, true, null, false)).toEqual({
      ok: true,
      status: "paired",
    });
    expect((await rec(r.id)).decided_by).toBeNull();
    const events = await sql(
      "select actor_id from public.event_log where action like 'assistant.%' and entity_id = $1",
      [t.tribe],
    );
    expect(events.length).toBeGreaterThan(0);
    expect(
      events.every((e) => e.actor_id === null || e.actor_id === t.leader.id),
    ).toBe(true);
    expect(
      await count(
        "select count(*)::int c from public.messages where params::text like '%' || $1 || '%'",
        [o.owner.email],
      ),
    ).toBe(0);
  });

  it("treats the hidden owner's address like any address nobody can pair: nothing is sent to it and nobody is paired", async () => {
    const t = await tribe();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      null,
      o.owner.email,
      null,
    );
    expect(r.ok).toBe(true);
    expect(
      (
        await one(
          "select nominee_id from public.assistant_recommendations where id = $1",
          [r.id],
        )
      ).nominee_id,
    ).toBeNull();
    expect(
      await as(admin, "assistant_decide", r.id, true, null, false),
    ).toEqual({ ok: true, status: "invited" });
    expect(
      await sql(
        "select 1 from public.messages where lower(to_email) = $1 or person_id = $2",
        [o.owner.email.toLowerCase(), o.owner.id],
      ),
    ).toHaveLength(0);
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 0,
    });
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
  });

  it("closes an invitation nobody took up in 60 days, or one for a tribe that has closed, and tells the leader", async () => {
    const t = await tribe();
    const m = await k.person("Silent");
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    await as(admin, "assistant_decide", r.id, true, null, false);
    await db.admin.query(
      "update public.assistant_recommendations set created_at = now() - interval '61 days' where id = $1",
      [r.id],
    );
    await db.grant(m.id, "assistant_leader"); // even an approved person is too late once it has expired
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 1,
    });
    expect((await rec(r.id)).status).toBe("expired");
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
    expect(
      (
        await mail(
          "assistant_decided",
          t.leader.id,
          "assistant-expired:" + r.id,
        )
      )[0].params,
    ).toMatchObject({ outcome: "expired" });
    expect(
      (await as(t.leader.id, "assistant_my_state", t.tribe)).last,
    ).toMatchObject({ status: "expired" });

    const t2 = await tribe();
    const r2 = await as(
      t2.leader.id,
      "assistant_recommend",
      t2.tribe,
      (await k.person("Waits")).id,
      null,
      null,
    );
    await as(admin, "assistant_decide", r2.id, true, null, false);
    await db.admin.query(
      "update public.tribes set status = 'closed' where id = $1",
      [t2.tribe],
    );
    expect((await one("select public.assistant_tick() as r")).r).toEqual({
      paired: 0,
      expired: 1,
    });
    expect((await rec(r2.id)).status).toBe("expired");
  });

  it("leaves a request about a tribe that has closed for the office to decline, and pairs no one in it", async () => {
    const t = await tribe();
    const m = await approvedAssistant();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      m.id,
      null,
      null,
    );
    await db.admin.query(
      "update public.tribes set status = 'closed' where id = $1",
      [t.tribe],
    );
    await expectCode(
      as(admin, "assistant_decide", r.id, true, null, false),
      "22023",
    );
    expect((await tribeRow(t.tribe)).assistant_id).toBeNull();
  });
});

describe("who can reach what", () => {
  it("keeps the table and the inner steps closed to everyone with an account", async () => {
    const t = await tribe();
    const r = await as(
      t.leader.id,
      "assistant_recommend",
      t.tribe,
      (await approvedAssistant()).id,
      null,
      null,
    );
    for (const who of [t.leader.id, admin, pastor]) {
      await expectCode(
        db.asUser(who, (q) =>
          q("select * from public.assistant_recommendations"),
        ),
        "42501",
      );
      await expectCode(
        db.asUser(who, (q) =>
          q("select public.assistant_apply_pair($1, true)", [r.id]),
        ),
        "42501",
      );
      await expectCode(
        db.asUser(who, (q) => q("select public.assistant_tick()")),
        "42501",
      );
      await expectCode(
        db.asUser(who, (q) => q("select public.assistant_row($1)", [r.id])),
        "42501",
      );
      await expectCode(
        db.asUser(who, (q) =>
          q("select public.assistant_can_decide($1)", [t.tribe]),
        ),
        "42501",
      );
      await expectCode(
        db.asUser(who, (q) => q("select public.worker_assistant_tick('x')")),
        "42501",
      );
    }
    const rls = await one(
      "select relrowsecurity as on from pg_class where oid = 'public.assistant_recommendations'::regclass",
    );
    expect(rls.on).toBe(true);
    expect(
      await count(
        "select count(*)::int c from information_schema.role_table_grants where table_name = 'assistant_recommendations' and grantee in ('anon', 'authenticated', 'public')",
      ),
    ).toBe(0);
  });

  it("lets only the sending service run the heartbeat, with its token", async () => {
    await expectCode(
      db.asAnon((q) =>
        q("select public.worker_assistant_tick($1)", [
          "not-a-real-token-at-all",
        ]),
      ),
      "42501",
    );
    await expectCode(
      db.asAnon((q) => q("select public.worker_assistant_tick($1)", ["short"])),
      "42501",
    );
  });
});

async function count(text: string, params: unknown[] = []): Promise<number> {
  return (await one(text, params)).c as number;
}

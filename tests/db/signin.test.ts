import { createHash } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from "vitest";
import { breakerVerdict, DEFAULT_BREAKER } from "@/lib/signin/breaker";
import { DEFAULT_LIMITS, limitsVerdict, type Verdict } from "@/lib/signin/caps";
import { wordingProblems } from "./contract";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase 6: sign in with a code on WhatsApp or email. These tests drive the database the way the website does: the
// website's server through the sending token, the Admin page through a signed-in person.

let db: TestDb;
let token: string;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const NUMBER = sha("number:2348031234567");
const NET = sha("network:203.0.113.7");
const num = (i: number) => sha(`number:${i}`);
const net = (i: number) => sha(`network:${i}`);

beforeAll(async () => {
  db = await createTestDb();
  token = (await db.admin.query("select public.bootstrap_worker_token('test') as t")).rows[0].t;
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Whoever a test made a director, data lead or admin is not one in the next test
  await db.admin.query("delete from public.person_roles where person_id = any($1::uuid[])", [made]);
  await db.admin.query("delete from public.signin_attempts");
  await db.admin.query("delete from public.signin_blocks");
  await db.admin.query("delete from public.signin_events");
  await db.admin.query("delete from public.messages where template like 'signin_%'");
  await db.admin.query(
    `update public.signin_settings set whatsapp_on = true, mode = 'reply_first', cap_number_15m = 3, cap_number_day = 8,
       gap_1_s = 60, gap_2_s = 120, gap_3_s = 300, cap_network_hour = 12, cap_channel_hour = 20, cap_channel_day = 150,
       require_screen = true, breaker_window_min = 30, breaker_min_sends = 5, breaker_fail_pct = 50,
       breaker_receipt_grace_min = 3, breaker_no_receipt_pct = 70, breaker_stop_count = 3, code_minutes = 10,
       breaker_state = 'ok', breaker_reason = null, breaker_tripped_at = null, breaker_cleared_at = null,
       sender_signal = 'unknown', sender_checked_at = null, sender_bad_since = null`,
  );
});

// ---------------------------------------------------------------------------------------------------- helpers

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Calls a worker function the way the website does: with the public key and the token. */
async function worker(fn: string, args: unknown[]): Promise<Json> {
  const marks = args.map((_, i) => `$${i + 2}`).join(", ");
  return db.asAnon(async (q) => (await q(`select public.${fn}($1${marks ? `, ${marks}` : ""}) as r`, [token, ...args])).rows[0].r as Json);
}

const networkGate = (network: string, number: string) => worker("worker_signin_network_gate", [network, number]);
const gate = (number: string, flow = "sign_in", route = "official") => worker("worker_signin_gate", [number, flow, route]);
const record = (attempt: number, outcome: string, detail: string | null = null) => worker("worker_signin_record", [attempt, outcome, detail]);

/** The sign-in screen asks, then the hook asks: what happens for one code to one number. */
async function ask(number: string, opts: { network?: string; route?: string } = {}): Promise<Json> {
  await networkGate(opts.network ?? NET, number);
  return gate(number, "sign_in", opts.route ?? "official");
}

const attempts = async (where = "true") => (await db.admin.query(`select * from public.signin_attempts where ${where} order by id`)).rows as Row[];
const settings = async () => (await db.admin.query("select * from public.signin_settings")).rows[0] as Row;
/** Pretend everything recorded so far happened this many minutes earlier. */
const ageAll = (minutes: number) => db.admin.query("update public.signin_attempts set at = at - make_interval(secs => $1::float8 * 60), decided_at = decided_at - make_interval(secs => $1::float8 * 60)", [minutes]);

const made: string[] = [];
async function manager(role: "director" | "data_lead" | "admin" | "pastor" | null) {
  const user = await db.createUser();
  made.push(user.id);
  if (role) await db.grant(user.id, role);
  return user;
}

const overview = (userId: string) => db.asUser(userId, async (q) => (await q("select public.signin_admin_overview() as r")).rows[0].r as Json);
const update = (userId: string, changes: Json) => db.asUser(userId, async (q) => (await q("select public.signin_admin_update($1::jsonb) as r", [JSON.stringify(changes)])).rows[0].r as Json);
const reset = (userId: string, note: string | null = null) => db.asUser(userId, async (q) => (await q("select public.signin_admin_reset($1) as r", [note])).rows[0].r as Json);

// ---------------------------------------------------------------------------------------------------- who can do what

describe("who can see and change what", () => {
  it("lets anyone ask whether WhatsApp sign-in is on, and tells them nothing else", async () => {
    const answer = await db.asAnon(async (q) => (await q("select public.signin_channel_status() as r")).rows[0].r);
    expect(answer).toBe("on");
    await db.admin.query("update public.signin_settings set whatsapp_on = false");
    expect(await db.asAnon(async (q) => (await q("select public.signin_channel_status() as r")).rows[0].r)).toBe("off");
    await db.admin.query("update public.signin_settings set whatsapp_on = true, breaker_state = 'tripped'");
    expect(await db.asAnon(async (q) => (await q("select public.signin_channel_status() as r")).rows[0].r)).toBe("paused");
  });

  it("keeps every table out of reach of the public key and of signed-in people", async () => {
    const member = await manager(null);
    for (const table of ["signin_settings", "signin_attempts", "signin_pending", "signin_blocks", "signin_events"]) {
      await expectCode(db.asAnon((q) => q(`select * from public.${table}`)), "42501");
      await expectCode(db.asUser(member.id, (q) => q(`select * from public.${table}`)), "42501");
      await expectCode(db.asUser(member.id, (q) => q(`delete from public.${table}`)), "42501");
    }
  });

  it("refuses every worker function without the sending token", async () => {
    const bad = "x".repeat(40);
    const calls: [string, unknown[]][] = [
      ["worker_signin_network_gate", [NET, NUMBER]],
      ["worker_signin_gate", [NUMBER, "sign_in", "official"]],
      ["worker_signin_record", [1, "sent", null]],
      ["worker_signin_hold", [1, "a".repeat(30)]],
      ["worker_signin_release", [NUMBER]],
      ["worker_signin_receipt", [NUMBER, "delivered"]],
      ["worker_signin_stop", [NUMBER, "stop"]],
      ["worker_signin_sender_signal", ["ok"]],
      ["worker_signin_status", []],
      ["worker_signin_tick", []],
    ];
    for (const [fn, args] of calls) {
      const marks = args.map((_, i) => `$${i + 2}`).join(", ");
      await expectCode(db.asAnon((q) => q(`select public.${fn}($1${marks ? `, ${marks}` : ""})`, [bad, ...args])), "42501");
      await expectCode(db.asAnon((q) => q(`select public.${fn}($1${marks ? `, ${marks}` : ""})`, [null, ...args])), "42501");
    }
  });

  it("opens the Admin page's functions to the director, the super admin and the data lead, and nobody else", async () => {
    for (const role of ["director", "data_lead", "admin"] as const) {
      const person = await manager(role);
      expect((await overview(person.id)).status).toBe("on");
    }
    for (const role of ["pastor", null] as const) {
      const person = await manager(role);
      await expectCode(overview(person.id), "42501");
      await expectCode(update(person.id, { whatsapp_on: false }), "42501");
      await expectCode(reset(person.id), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.signin_admin_overview()")), "42501");
  });
});

// ---------------------------------------------------------------------------------------------------- the network limit

describe("the network limit", () => {
  it("lets a network ask 12 times an hour and turns the 13th away, without touching anyone else", async () => {
    for (let i = 0; i < 12; i++) expect((await networkGate(NET, num(i))).decision).toBe("allow");
    expect(await networkGate(NET, num(99))).toEqual({ decision: "decline", reason: "network" });
    expect((await networkGate(net(2), num(99))).decision).toBe("allow");
    const rows = await attempts("outcome = 'declined_network'");
    expect(rows).toHaveLength(1);
    expect(rows[0].network_hash).toBe(NET);
  });

  it("forgets a network after an hour", async () => {
    for (let i = 0; i < 12; i++) await networkGate(NET, num(i));
    expect((await networkGate(NET, num(50))).decision).toBe("decline");
    await ageAll(61);
    expect((await networkGate(NET, num(51))).decision).toBe("allow");
  });

  it("turns everyone away while WhatsApp is off or paused, and records nothing", async () => {
    await db.admin.query("update public.signin_settings set whatsapp_on = false");
    expect(await networkGate(NET, NUMBER)).toEqual({ decision: "decline", reason: "off" });
    await db.admin.query("update public.signin_settings set whatsapp_on = true, breaker_state = 'tripped'");
    expect(await networkGate(NET, NUMBER)).toEqual({ decision: "decline", reason: "paused" });
    expect(await attempts()).toHaveLength(0);
  });

  it("holds only hashes: a plain number or address is refused", async () => {
    await expectCode(worker("worker_signin_network_gate", ["203.0.113.7", NUMBER]), "22023");
    await expectCode(worker("worker_signin_network_gate", [NET, "2348031234567"]), "22023");
    await expectCode(worker("worker_signin_gate", ["2348031234567", "sign_in", "official"]), "22023");
    await expectCode(worker("worker_signin_gate", [NUMBER, "other", "official"]), "22023");
    await expectCode(db.admin.query("insert into public.signin_attempts (number_hash) values ('2348031234567')"), "23514");
  });
});

// ---------------------------------------------------------------------------------------------------- the number limits

describe("the limits on one number", () => {
  it("lets the first code through, and uses a place for it", async () => {
    const g = await ask(NUMBER);
    expect(g).toMatchObject({ decision: "allow", mode: "reply_first" });
    const [row] = await attempts();
    expect(row).toMatchObject({ outcome: "accepted", counted: true, flow: "sign_in", route: "official" });
    expect(row.number_hash).toBe(NUMBER);
  });

  it("makes the next code wait 1 minute, then 2, then 5, and a declined request uses no place", async () => {
    expect((await ask(NUMBER)).decision).toBe("allow");
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "wait" });
    expect(await attempts("counted")).toHaveLength(1);

    await ageAll(1.1); // a little over a minute
    expect((await ask(NUMBER)).decision).toBe("allow");
    // after the second code the wait is 2 minutes: a minute and a bit is not enough
    await ageAll(1.1);
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "wait" });
    await ageAll(1);
    expect((await ask(NUMBER)).decision).toBe("allow"); // third code, 15-minute count is now 3
    // the fourth is stopped by the 15-minute limit, whatever the wait
    await ageAll(6);
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "number_15m" });
    // once the first has aged out of the 15 minutes it can go again, after the 5-minute wait
    await ageAll(10);
    expect((await ask(NUMBER)).decision).toBe("allow");
  });

  it("stops at 3 in 15 minutes and 8 in a day", async () => {
    await db.admin.query("update public.signin_settings set gap_1_s = 0, gap_2_s = 0, gap_3_s = 0, cap_channel_hour = 500, cap_channel_day = 5000, cap_network_hour = 500");
    for (let i = 0; i < 3; i++) expect((await ask(NUMBER)).decision).toBe("allow");
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "number_15m" });
    // spread the day: 4 more, each outside the last 15 minutes
    for (let i = 0; i < 5; i++) {
      await ageAll(16);
      const g = await ask(NUMBER);
      if (i < 5) expect(g.decision, `code ${i + 4}`).toBe("allow");
    }
    await ageAll(16);
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "number_day" });
    await ageAll(24 * 60);
    expect((await ask(NUMBER)).decision).toBe("allow");
  });

  it("counts each number on its own", async () => {
    expect((await ask(NUMBER)).decision).toBe("allow");
    expect((await ask(num(1))).decision).toBe("allow");
    expect((await ask(NUMBER)).reason).toBe("wait");
    expect((await ask(num(2))).decision).toBe("allow");
  });

  it("only takes a code that came through the sign-in screen", async () => {
    expect(await gate(NUMBER)).toEqual({ decision: "decline", reason: "direct" });
    expect((await attempts())[0].outcome).toBe("declined_direct");
    // a request is good for one code, within three minutes
    await networkGate(NET, NUMBER);
    expect((await gate(NUMBER)).decision).toBe("allow");
    await ageAll(2);
    expect((await gate(NUMBER)).reason).toBe("direct");
    await ageAll(24 * 60);
    await networkGate(NET, NUMBER);
    await ageAll(4);
    expect((await gate(NUMBER)).reason).toBe("direct");
  });

  it("can be told to take codes from anywhere, and still checks every other limit", async () => {
    await db.admin.query("update public.signin_settings set require_screen = false");
    expect((await gate(NUMBER)).decision).toBe("allow");
    expect((await gate(NUMBER)).reason).toBe("wait");
  });

  it("does not need the screen for a signed-in person adding a number, but still counts it", async () => {
    expect((await gate(NUMBER, "add_number", "linked")).decision).toBe("allow");
    expect((await gate(NUMBER, "add_number", "linked")).reason).toBe("wait");
    expect((await attempts())[0]).toMatchObject({ flow: "add_number", route: "linked" });
  });

  it("answers the same way for a number that has no account: the database never knows", async () => {
    // The hook is only ever called for a number on an account; a number with no account leaves a request that nothing
    // matched, which the heartbeat then marks. Nothing in the answer or the log says which kind a number is.
    await networkGate(NET, num(7));
    await ageAll(6);
    const tick = await worker("worker_signin_tick", []);
    expect(tick.unmatched).toBe(1);
    expect((await attempts())[0]).toMatchObject({ outcome: "unmatched", counted: false });
  });
});

// ---------------------------------------------------------------------------------------------------- the whole channel

describe("the ceiling for the whole channel", () => {
  it("allows 20 codes an hour across everyone, then turns the rest away", async () => {
    for (let i = 0; i < 20; i++) expect((await ask(num(i), { network: net(i) })).decision, `code ${i + 1}`).toBe("allow");
    expect(await ask(num(100), { network: net(100) })).toEqual({ decision: "decline", reason: "channel_hour" });
    await ageAll(61);
    expect((await ask(num(101), { network: net(101) })).decision).toBe("allow");
  });

  it("allows 150 a day", async () => {
    await db.admin.query("update public.signin_settings set cap_channel_day = 6, cap_network_hour = 500");
    for (let i = 0; i < 6; i++) {
      await ageAll(61);
      expect((await ask(num(i), { network: net(i) })).decision).toBe("allow");
    }
    await ageAll(61);
    expect(await ask(num(50), { network: net(50) })).toEqual({ decision: "decline", reason: "channel_day" });
  });

  it("keeps the limits when a crowd asks at the same moment", async () => {
    await db.admin.query("update public.signin_settings set cap_channel_hour = 5, cap_network_hour = 500, gap_1_s = 0");
    const port = inject("pgPort");
    const clients = await Promise.all(
      Array.from({ length: 14 }, async () => {
        const c = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: db.name });
        await c.connect();
        return c;
      }),
    );
    try {
      // 14 different numbers each asked on the screen, and now all 14 hooks arrive together
      for (let i = 0; i < 14; i++) await networkGate(net(i), num(i));
      const answers = await Promise.all(clients.map((c, i) => c.query("select public.worker_signin_gate($1, $2, 'sign_in', 'official') as r", [token, num(i)])));
      const decisions = answers.map((a) => (a.rows[0].r as Json).decision);
      expect(decisions.filter((d) => d === "allow")).toHaveLength(5);
      expect(decisions.filter((d) => d === "decline")).toHaveLength(9);
      expect(await attempts("counted")).toHaveLength(5);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("keeps one number to its limit when its requests arrive together", async () => {
    await db.admin.query("update public.signin_settings set gap_1_s = 0, gap_2_s = 0, gap_3_s = 0, cap_network_hour = 500");
    const port = inject("pgPort");
    const clients = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const c = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: db.name });
        await c.connect();
        return c;
      }),
    );
    try {
      for (let i = 0; i < 8; i++) await networkGate(NET, NUMBER);
      const answers = await Promise.all(clients.map((c) => c.query("select public.worker_signin_gate($1, $2, 'sign_in', 'official') as r", [token, NUMBER])));
      expect(answers.filter((a) => (a.rows[0].r as Json).decision === "allow")).toHaveLength(3);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

// ---------------------------------------------------------------------------------------------------- the same rule in code

describe("the limits in code agree with the database", () => {
  const MIN = 60_000;
  // Each case: when the number's earlier codes were asked (minutes ago) and how many other codes the channel has had (minutes ago).
  const cases: { name: string; mine: number[]; others: number[]; limits?: Partial<typeof DEFAULT_LIMITS> }[] = [
    { name: "nothing yet", mine: [], others: [] },
    { name: "one just now", mine: [0.2], others: [] },
    { name: "one 90 seconds ago", mine: [1.5], others: [] },
    { name: "two, the last 90 seconds ago", mine: [10, 1.5], others: [] },
    { name: "two, the last 3 minutes ago", mine: [10, 3], others: [] },
    { name: "three in 15 minutes", mine: [12, 8, 6], others: [] },
    { name: "three, the oldest just aged out of 15 minutes", mine: [16, 8, 6], others: [] },
    { name: "three, 5 minutes since the last", mine: [40, 30, 5.5], others: [] },
    { name: "three, 4 minutes since the last", mine: [40, 30, 4], others: [] },
    { name: "eight today", mine: [900, 800, 700, 600, 500, 400, 300, 200], others: [] },
    { name: "seven today, the last 6 minutes ago", mine: [900, 800, 700, 600, 500, 400, 300, 6], others: [] },
    { name: "channel at its hourly ceiling", mine: [], others: Array.from({ length: 20 }, (_, i) => 1 + i) },
    { name: "channel just under its hourly ceiling", mine: [], others: Array.from({ length: 19 }, (_, i) => 1 + i) },
    { name: "channel busy but spread over the day", mine: [], others: Array.from({ length: 30 }, (_, i) => 70 + i * 40) },
    { name: "channel at its daily ceiling", mine: [], others: Array.from({ length: 150 }, (_, i) => 61 + i * 9) },
    { name: "quick gaps allowed", mine: [0.2], others: [], limits: { gaps: [0, 0, 0] } },
    { name: "a tight channel", mine: [], others: [5, 4, 3], limits: { capChannelHour: 3 } },
  ];

  it.each(cases)("$name", async ({ mine, others, limits }) => {
    const l = { ...DEFAULT_LIMITS, ...limits };
    await db.admin.query(
      `update public.signin_settings set cap_number_15m = $1, cap_number_day = $2, gap_1_s = $3, gap_2_s = $4, gap_3_s = $5,
         cap_channel_hour = $6, cap_channel_day = $7, require_screen = false`,
      [l.cap15m, l.capDay, l.gaps[0], l.gaps[1], l.gaps[2], l.capChannelHour, l.capChannelDay],
    );
    const insert = (hash: string, minutesAgo: number) =>
      db.admin.query("insert into public.signin_attempts (number_hash, outcome, counted, at, decided_at) values ($1, 'sent', true, now() - make_interval(secs => $2), now())", [hash, minutesAgo * 60]);
    for (const m of mine) await insert(NUMBER, m);
    for (const [i, m] of others.entries()) await insert(num(1000 + i), m);

    const now = Date.now();
    const expected: Verdict = limitsVerdict(mine.map((m) => now - m * MIN), [...mine, ...others].map((m) => now - m * MIN), now, l);
    const got = await gate(NUMBER);
    const reason = got.decision === "allow" ? "ok" : (got.reason as string);
    expect(reason).toBe(expected === "ok" ? "ok" : expected);
  });
});

// ---------------------------------------------------------------------------------------------------- STOP and "not me"

describe("STOP and “not me”", () => {
  it("blocks the number for 30 days, quietly, and tells the data lead once", async () => {
    const lead = await manager("data_lead");
    expect((await ask(NUMBER)).decision).toBe("allow");
    await ageAll(10);
    const stopped = await worker("worker_signin_stop", [NUMBER, "stop"]);
    expect(stopped.ok).toBe(true);
    const block = (await db.admin.query("select reason, blocked_until - blocked_at as span from public.signin_blocks")).rows[0];
    expect(block.reason).toBe("stop");
    expect(block.span).toMatchObject({ days: 30 });

    // a later request for a code is declined, without the screen being able to tell
    expect(await ask(NUMBER)).toEqual({ decision: "decline", reason: "blocked" });
    expect((await attempts("outcome = 'declined_blocked'")).length).toBe(1);
    // a held code is gone and cannot be collected
    expect(await worker("worker_signin_release", [NUMBER])).toBeNull();

    const alerts = (await db.admin.query("select * from public.messages where template = 'signin_stop_alert'")).rows as Row[];
    expect(alerts).toHaveLength(1);
    expect(alerts[0].person_id).toBe(lead.id);
    expect(alerts[0].force_channel).toBe("email");
    expect(alerts[0].params).toEqual({ kind: "stop" });
    expect(await wordingProblems(alerts)).toEqual([]);

    // the same number saying it again the same day adds nothing
    await worker("worker_signin_stop", [NUMBER, "not_me"]);
    expect((await db.admin.query("select count(*)::int as n from public.messages where template = 'signin_stop_alert'")).rows[0].n).toBe(1);
    expect((await db.admin.query("select reason from public.signin_blocks")).rows[0].reason).toBe("not_me");
  });

  it("lifts the block after 30 days", async () => {
    await worker("worker_signin_stop", [NUMBER, "not_me"]);
    await db.admin.query("update public.signin_blocks set blocked_until = now() - interval '1 minute'");
    expect((await ask(NUMBER)).decision).toBe("allow");
    await worker("worker_signin_tick", []);
    expect((await db.admin.query("select count(*)::int as n from public.signin_blocks")).rows[0].n).toBe(0);
  });

  it("blocks a number that is only being added to an account too", async () => {
    await worker("worker_signin_stop", [NUMBER, "stop"]);
    expect((await gate(NUMBER, "add_number", "linked")).reason).toBe("blocked");
  });

  it("emails the director instead when there is no data lead, and an admin when there is neither", async () => {
    const director = await manager("director");
    await worker("worker_signin_stop", [NUMBER, "stop"]);
    let to = (await db.admin.query("select person_id from public.messages where template = 'signin_stop_alert'")).rows.map((r) => r.person_id);
    expect(to).toEqual([director.id]);
    await db.admin.query("delete from public.person_roles where person_id = $1", [director.id]);
    await db.admin.query("delete from public.messages where template = 'signin_stop_alert'");
    const admin = await manager("admin");
    await worker("worker_signin_stop", [num(5), "stop"]);
    to = (await db.admin.query("select person_id from public.messages where template = 'signin_stop_alert'")).rows.map((r) => r.person_id);
    expect(to).toContain(admin.id);
    await db.admin.query("delete from public.person_roles where person_id = $1", [admin.id]);
  });
});

// ---------------------------------------------------------------------------------------------------- reply-first

describe("reply-first: the code waits for the person's message", () => {
  const SEALED = "k1.aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccccccccc";

  async function held(number = NUMBER) {
    const g = await ask(number, { route: "linked" });
    expect(g.decision).toBe("allow");
    const out = await worker("worker_signin_hold", [g.attempt, SEALED]);
    expect(out.ok).toBe(true);
    return g.attempt as number;
  }

  it("keeps the code sealed, and hands it over once", async () => {
    const id = await held();
    expect((await attempts(`id = ${id}`))[0].outcome).toBe("held");
    const pending = (await db.admin.query("select * from public.signin_pending")).rows[0];
    expect(pending.sealed).toBe(SEALED);
    expect(new Date(pending.expires_at).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    expect(await worker("worker_signin_release", [NUMBER])).toEqual({ attempt: id, sealed: SEALED });
    expect((await attempts(`id = ${id}`))[0]).toMatchObject({ outcome: "sent", detail: "reply" });
    expect(await worker("worker_signin_release", [NUMBER])).toBeNull();
    expect((await db.admin.query("select count(*)::int as n from public.signin_pending")).rows[0].n).toBe(0);
  });

  it("gives nothing to a number that has not asked, or asked more than 10 minutes ago", async () => {
    expect(await worker("worker_signin_release", [num(9)])).toBeNull();
    await held();
    await db.admin.query("update public.signin_pending set expires_at = now() - interval '1 second'");
    expect(await worker("worker_signin_release", [NUMBER])).toBeNull();
    await worker("worker_signin_tick", []);
    expect((await attempts())[0].outcome).toBe("expired");
    expect((await db.admin.query("select count(*)::int as n from public.signin_pending")).rows[0].n).toBe(0);
  });

  it("keeps only the newest code for a number, because the sign-in service honours only the newest", async () => {
    const first = await held();
    await ageAll(2);
    const second = await held();
    expect((await attempts(`id = ${first}`))[0]).toMatchObject({ outcome: "expired", detail: "replaced" });
    const out = await worker("worker_signin_release", [NUMBER]);
    expect(out.attempt).toBe(second);
  });

  it("will not hold a code that was never accepted, or hold one twice", async () => {
    const g = await ask(NUMBER, { route: "linked" });
    expect((await worker("worker_signin_hold", [g.attempt + 100, SEALED])).ok).toBe(false);
    expect((await worker("worker_signin_hold", [g.attempt, SEALED])).ok).toBe(true);
    expect((await worker("worker_signin_hold", [g.attempt, SEALED])).ok).toBe(false);
    const other = await ask(num(4), { route: "linked", network: net(4) });
    await expectCode(worker("worker_signin_hold", [other.attempt, "short"]), "23514");
  });

  it("stops handing codes over when WhatsApp is switched off or paused", async () => {
    await held();
    await db.admin.query("update public.signin_settings set whatsapp_on = false");
    expect(await worker("worker_signin_release", [NUMBER])).toBeNull();
    await db.admin.query("update public.signin_settings set whatsapp_on = true, breaker_state = 'tripped'");
    expect(await worker("worker_signin_release", [NUMBER])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------- recording what happened

describe("recording what happened to a code", () => {
  it("accepts sensible moves and refuses the rest", async () => {
    const g = await ask(NUMBER, { route: "linked" });
    expect((await record(g.attempt, "sent")).ok).toBe(true);
    expect((await record(g.attempt, "delivered")).ok).toBe(true);
    expect(await record(g.attempt, "failed")).toMatchObject({ ok: false, outcome: "delivered" });
    expect(await record(g.attempt, "sent")).toMatchObject({ ok: false });
    expect(await record(99999, "sent")).toEqual({ ok: false });
  });

  it("never keeps more than a short reason", async () => {
    const g = await ask(NUMBER);
    await record(g.attempt, "failed", "x".repeat(200));
    expect((await attempts())[0].detail).toHaveLength(80);
  });

  it("turns a delivery receipt into delivered, or into failed", async () => {
    const g1 = await ask(NUMBER, { route: "linked" });
    await record(g1.attempt, "sent");
    expect(await worker("worker_signin_receipt", [NUMBER, "delivered"])).toEqual({ ok: true });
    expect((await attempts())[0].outcome).toBe("delivered");

    const g2 = await ask(num(2), { route: "linked" });
    await record(g2.attempt, "sent");
    await worker("worker_signin_receipt", [num(2), "failed"]);
    expect((await attempts(`id = ${g2.attempt}`))[0]).toMatchObject({ outcome: "failed", detail: "receipt_failed" });

    // a receipt for a number with nothing waiting changes nothing
    expect(await worker("worker_signin_receipt", [num(3), "delivered"])).toEqual({ ok: false });
  });

  it("marks a send that never reported back as failed, so the breaker can see it", async () => {
    await ask(NUMBER);
    await db.admin.query("update public.signin_attempts set decided_at = now() - interval '3 minutes'");
    const tick = await worker("worker_signin_tick", []);
    expect(tick.lost).toBe(1);
    expect((await attempts())[0]).toMatchObject({ outcome: "failed", detail: "no_result" });
  });

  it("forgets attempts after 30 days", async () => {
    await ask(NUMBER);
    await db.admin.query("update public.signin_attempts set at = now() - interval '31 days'");
    expect((await worker("worker_signin_tick", [])).purged).toBe(1);
    expect(await attempts()).toHaveLength(0);
  });

  it("holds no number and no code, only hashes and outcomes", async () => {
    const g = await ask("a".repeat(64), { route: "linked" });
    await worker("worker_signin_hold", [g.attempt, "k1.aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb.cccccccccc"]);
    const columns = (await db.admin.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('signin_attempts', 'signin_blocks', 'signin_events', 'signin_settings')`,
    )).rows.map((r) => `${r.table_name}.${r.column_name}`);
    expect(columns.filter((c) => /^(phone|number|code|otp|email|ip|address|network|sealed)$/.test(c.split(".")[1]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------- the circuit breaker

describe("the circuit breaker", () => {
  async function send(i: number, outcome: "sent" | "failed" | "rejected" | "delivered", route = "official") {
    const g = await ask(num(i), { route, network: net(i) });
    expect(g.decision, `request ${i}`).toBe("allow");
    await record(g.attempt, outcome === "delivered" ? "sent" : outcome, null);
    if (outcome === "delivered") await record(g.attempt, "delivered");
  }
  const state = async () => (await settings()).breaker_state as string;

  beforeEach(async () => {
    await db.admin.query("update public.signin_settings set cap_channel_hour = 500, cap_channel_day = 5000");
    await manager("director");
    await manager("data_lead");
  });

  it("stays quiet while sends go well, and while there are too few to judge", async () => {
    for (let i = 0; i < 4; i++) await send(i, "failed");
    expect(await state()).toBe("ok");
    await db.admin.query("delete from public.signin_attempts");
    for (let i = 4; i < 16; i++) await send(i, "sent");
    expect(await state()).toBe("ok");
  });

  it("trips on failed sends, pauses WhatsApp, and emails the director and the data lead", async () => {
    for (let i = 0; i < 2; i++) await send(i, "sent");
    for (let i = 2; i < 5; i++) await send(i, "failed");
    const s = await settings();
    expect(s.breaker_state).toBe("tripped");
    expect(s.breaker_reason).toBe("failed_sends");
    expect(await db.asAnon(async (q) => (await q("select public.signin_channel_status() as r")).rows[0].r)).toBe("paused");

    const events = (await db.admin.query("select * from public.signin_events")).rows as Row[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "tripped", reason: "failed_sends", actor: null });
    expect(events[0].detail).toMatchObject({ sends: 5, failed: 3 });

    const alerts = (await db.admin.query("select * from public.messages where template = 'signin_paused'")).rows as Row[];
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.force_channel === "email")).toBe(true);
    expect(await wordingProblems(alerts)).toEqual([]);

    // from now on nothing is sent, and the answer for every request is the same
    expect(await networkGate(net(77), num(77))).toEqual({ decision: "decline", reason: "paused" });
    expect(await gate(num(78), "add_number")).toEqual({ decision: "decline", reason: "paused" });
  });

  it("does not trip twice, and does not email twice", async () => {
    for (let i = 0; i < 5; i++) await send(i, "failed").catch(() => {});
    expect(await state()).toBe("tripped");
    expect((await db.admin.query("select count(*)::int as n from public.signin_events")).rows[0].n).toBe(1);
    expect((await db.admin.query("select count(*)::int as n from public.messages where template = 'signin_paused'")).rows[0].n).toBe(2);
  });

  it("trips when WhatsApp refuses too many codes", async () => {
    for (let i = 0; i < 2; i++) await send(i, "sent");
    for (let i = 2; i < 5; i++) await send(i, "rejected");
    expect((await settings()).breaker_reason).toBe("rejections");
  });

  it("trips when most ordinary-number codes show no sign of arriving", async () => {
    for (let i = 0; i < 6; i++) await send(i, "sent", "linked");
    expect(await state()).toBe("ok"); // too recent for a receipt to be expected
    await ageAll(5);
    await worker("worker_signin_tick", []);
    expect((await settings()).breaker_reason).toBe("no_receipts");
  });

  it("does not trip on missing receipts when most did arrive", async () => {
    for (let i = 0; i < 4; i++) await send(i, "delivered", "linked");
    for (let i = 4; i < 6; i++) await send(i, "sent", "linked");
    await ageAll(5);
    await worker("worker_signin_tick", []);
    expect(await state()).toBe("ok");
  });

  it("trips on a run of STOP and “not me”", async () => {
    await worker("worker_signin_stop", [num(1), "stop"]);
    await worker("worker_signin_stop", [num(2), "not_me"]);
    expect(await state()).toBe("ok");
    await worker("worker_signin_stop", [num(3), "stop"]);
    expect((await settings()).breaker_reason).toBe("stop_spike");
  });

  it("trips at once when the sending number says it is logged out or restricted", async () => {
    expect(await worker("worker_signin_sender_signal", ["ok"])).toMatchObject({ ok: true, status: "on" });
    expect(await worker("worker_signin_sender_signal", ["logged_out"])).toMatchObject({ status: "paused" });
    expect((await settings()).breaker_reason).toBe("sender_logged_out");
    await db.admin.query("update public.signin_settings set breaker_state = 'ok', breaker_reason = null");
    await worker("worker_signin_sender_signal", ["restricted"]);
    expect((await settings()).breaker_reason).toBe("sender_restricted");
  });

  it("trips when the sending service cannot be reached for a quarter of an hour, not before", async () => {
    await worker("worker_signin_sender_signal", ["unreachable"]);
    await worker("worker_signin_sender_signal", ["unreachable"]);
    expect(await state()).toBe("ok");
    await db.admin.query("update public.signin_settings set sender_bad_since = now() - interval '16 minutes'");
    await worker("worker_signin_sender_signal", ["unreachable"]);
    expect((await settings()).breaker_reason).toBe("sender_unreachable");
  });

  it("forgets a bad moment that has passed", async () => {
    await db.admin.query("update public.signin_settings set sender_bad_since = now() - interval '10 minutes'");
    await worker("worker_signin_sender_signal", ["ok"]);
    expect((await settings()).sender_bad_since).toBeNull();
  });

  it("never turns itself back on, however long it waits", async () => {
    for (let i = 0; i < 5; i++) await send(i, "failed");
    expect(await state()).toBe("tripped");
    await ageAll(24 * 60);
    await worker("worker_signin_tick", []);
    await worker("worker_signin_sender_signal", ["ok"]);
    expect(await state()).toBe("tripped");
  });

  it("agrees with the same rule in code", async () => {
    const scenarios: { sends: number; failed: number; rejected: number; linkedSent: number; noReceipt: number; stops: number }[] = [
      { sends: 4, failed: 4, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 0 },
      { sends: 5, failed: 2, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 0 },
      { sends: 5, failed: 3, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 0 },
      { sends: 10, failed: 5, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 0 },
      { sends: 10, failed: 0, rejected: 6, linkedSent: 0, noReceipt: 0, stops: 0 },
      { sends: 6, failed: 0, rejected: 0, linkedSent: 6, noReceipt: 5, stops: 0 },
      { sends: 6, failed: 0, rejected: 0, linkedSent: 6, noReceipt: 4, stops: 0 },
      { sends: 3, failed: 0, rejected: 0, linkedSent: 3, noReceipt: 3, stops: 0 },
      { sends: 0, failed: 0, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 3 },
      { sends: 0, failed: 0, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 2 },
    ];
    for (const sc of scenarios) {
      await db.admin.query("delete from public.signin_attempts");
      await db.admin.query("delete from public.signin_blocks");
      await db.admin.query("delete from public.signin_events");
      await db.admin.query("update public.signin_settings set breaker_state = 'ok', breaker_reason = null, breaker_cleared_at = null");
      let n = 0;
      const row = (outcome: string, route: string, minutesAgo: number) =>
        db.admin.query(
          "insert into public.signin_attempts (number_hash, route, outcome, counted, at, decided_at) values ($1, $2, $3, true, now() - make_interval(mins => $4), now())",
          [num(5000 + n++), route, outcome, minutesAgo],
        );
      // ordinary sends that count towards the first two rules
      const plain = sc.sends - sc.linkedSent;
      for (let i = 0; i < sc.failed; i++) await row("failed", "official", 5);
      for (let i = 0; i < sc.rejected; i++) await row("rejected", "official", 5);
      for (let i = 0; i < plain - sc.failed - sc.rejected; i++) await row("sent", "official", 5);
      // ordinary-number sends, old enough for a receipt: 'sent' means none came
      for (let i = 0; i < sc.noReceipt; i++) await row("sent", "linked", 10);
      for (let i = 0; i < sc.linkedSent - sc.noReceipt; i++) await row("delivered", "linked", 10);
      for (let i = 0; i < sc.stops; i++) await db.admin.query("insert into public.signin_blocks (number_hash, reason, blocked_until) values ($1, 'stop', now() + interval '30 days')", [num(7000 + i)]);

      const expected = breakerVerdict(sc, DEFAULT_BREAKER);
      const tripped = (await worker("worker_signin_tick", [])).status === "paused";
      expect(tripped, JSON.stringify(sc)).toBe(expected !== null);
      if (expected) expect((await settings()).breaker_reason, JSON.stringify(sc)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------------------------------- the Admin page

describe("the Admin page", () => {
  it("shows the settings, the day-by-day chart and the log of trips", async () => {
    const director = await manager("director");
    for (let i = 0; i < 3; i++) {
      const g = await ask(num(i), { network: net(i) });
      await record(g.attempt, i === 2 ? "failed" : "sent");
    }
    await ask(num(0), { network: net(0) }); // declined: wait
    const o = await overview(director.id);
    expect(o.status).toBe("on");
    expect(o.settings).toMatchObject({ whatsapp_on: true, mode: "reply_first", cap_number_15m: 3, cap_channel_hour: 20, breaker_state: "ok" });
    expect(o.can_raise).toBe(true);
    expect(o.now).toEqual({ hour: 3, day: 3 });
    expect(o.daily).toHaveLength(30);
    // A plain date, which is what the page reads (a timestamp's text would not parse there)
    for (const d of o.daily) expect(d.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = o.daily[o.daily.length - 1];
    expect(today).toMatchObject({ asked: 4, delivered: 2, failed: 1, declined: 1 });
    expect(Object.keys(o.settings)).not.toContain("updated_by");
  });

  it("lets the director raise the channel limits and refuses the data lead, who may lower them", async () => {
    const director = await manager("director");
    const lead = await manager("data_lead");
    expect((await update(director.id, { cap_channel_hour: 40, cap_channel_day: 300 })).settings).toMatchObject({ cap_channel_hour: 40, cap_channel_day: 300 });
    await expectCode(update(lead.id, { cap_channel_hour: 60 }), "42501");
    expect((await settings()).cap_channel_hour).toBe(40);
    expect((await update(lead.id, { cap_channel_hour: 10 })).settings).toMatchObject({ cap_channel_hour: 10 });
    expect((await update(lead.id, { cap_number_15m: 2, mode: "normal" })).settings).toMatchObject({ cap_number_15m: 2, mode: "normal" });
  });

  it("is the kill switch: off means no WhatsApp codes, and says so", async () => {
    const director = await manager("director");
    const out = await update(director.id, { whatsapp_on: false });
    expect(out.status).toBe("off");
    expect(await networkGate(NET, NUMBER)).toEqual({ decision: "decline", reason: "off" });
    expect(await gate(NUMBER, "add_number")).toEqual({ decision: "decline", reason: "off" });
    expect((await update(director.id, { whatsapp_on: true })).status).toBe("on");
    const kinds = (await overview(director.id)).events.map((e: Json) => e.kind);
    expect(kinds).toEqual(["switch_on", "switch_off"]);
  });

  it("records each change with the person's name", async () => {
    const director = await db.createUser({ email: "ngozi.director@example.org" });
    await db.grant(director.id, "director");
    await db.admin.query("update public.people set preferred_name = 'Ngozi' where id = $1", [director.id]);
    await update(director.id, { cap_number_day: 6, gap_1_s: 90 });
    await update(director.id, { mode: "normal" });
    const events = (await overview(director.id)).events as Json[];
    expect(events.map((e) => e.kind)).toEqual(["mode", "settings"]);
    expect(events.every((e) => e.by === "Ngozi")).toBe(true);
    expect(events[1].detail).toEqual({ cap_number_day: { from: 8, to: 6 }, gap_1_s: { from: 60, to: 90 } });
    expect(events[0].detail).toEqual({ from: "reply_first", to: "normal" });
  });

  it("changes nothing when a value is out of range, and says so kindly", async () => {
    const director = await manager("director");
    for (const bad of [{ cap_number_15m: 0 }, { cap_number_day: 500 }, { mode: "sometimes" }, { gap_1_s: -1 }, { cap_channel_hour: "lots" }, { whatsapp_on: "maybe" }]) {
      await expect(update(director.id, bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/outside what is allowed/) });
    }
    await expect(update(director.id, { nonsense: 1 })).rejects.toMatchObject({ code: "22023" });
    await expect(update(director.id, {})).resolves.toBeTruthy();
    await expect(db.asUser(director.id, (q) => q("select public.signin_admin_update('[]'::jsonb)"))).rejects.toMatchObject({ code: "22023" });
    expect((await settings()).cap_number_15m).toBe(3);
    expect((await overview(director.id)).events).toEqual([]);
  });

  it("is the only way to turn the breaker back on, and the same failures do not trip it again at once", async () => {
    const director = await manager("director");
    await manager("data_lead");
    await db.admin.query("update public.signin_settings set cap_channel_hour = 500, cap_network_hour = 500");
    for (let i = 0; i < 5; i++) {
      const g = await ask(num(i), { network: net(i) });
      await record(g.attempt, "failed");
    }
    expect((await settings()).breaker_state).toBe("tripped");

    const out = await reset(director.id, "The sender was logged out; I linked it again.");
    expect(out.status).toBe("on");
    expect(out.settings.breaker_state).toBe("ok");
    expect(out.events.map((e: Json) => e.kind)).toEqual(["reset", "tripped"]);
    expect(out.events[0]).toMatchObject({ reason: "The sender was logged out; I linked it again." });

    // the five failures are still in the last 30 minutes, but they have been looked at
    await worker("worker_signin_tick", []);
    expect((await settings()).breaker_state).toBe("ok");
    // new trouble after the reset does trip it again
    for (let i = 10; i < 15; i++) {
      const g = await ask(num(i), { network: net(i) });
      await record(g.attempt, "failed");
    }
    expect((await settings()).breaker_state).toBe("tripped");
    expect((await db.admin.query("select count(*)::int as n from public.signin_events where kind = 'tripped'")).rows[0].n).toBe(2);
  });

  it("does nothing, and logs nothing, when the breaker was not tripped", async () => {
    const director = await manager("director");
    const out = await reset(director.id);
    expect(out.events).toEqual([]);
  });

  it("charts each day in Lagos time, and a quiet day shows zeros", async () => {
    const director = await manager("director");
    await db.admin.query(
      `insert into public.signin_attempts (number_hash, outcome, counted, at, decided_at) values
         ($1, 'sent', true, now() - interval '3 days', now()),
         ($2, 'failed', true, now() - interval '3 days', now()),
         ($3, 'declined_number', false, now() - interval '3 days', now()),
         ($4, 'held', true, now() - interval '3 days', now())`,
      [num(1), num(2), num(3), num(4)],
    );
    const o = await overview(director.id);
    const day = o.daily.find((d: Json) => d.asked === 4);
    expect(day).toMatchObject({ asked: 4, delivered: 1, failed: 1, declined: 1, not_collected: 1 });
    expect(o.daily.filter((d: Json) => d.asked === 0)).toHaveLength(29);
    expect(o.daily[0].day < o.daily[29].day).toBe(true);
  });

  it("counts an ordinary-number code as delivered only when a receipt says so", async () => {
    const director = await manager("director");
    const a = await ask(num(1), { route: "linked", network: net(1) });
    const b = await ask(num(2), { route: "linked", network: net(2) });
    const c = await ask(num(3), { route: "official", network: net(3) });
    await record(a.attempt, "sent");
    await record(b.attempt, "sent");
    await record(b.attempt, "delivered");
    await record(c.attempt, "sent");
    const today = (await overview(director.id)).daily.at(-1);
    expect(today).toMatchObject({ asked: 3, delivered: 2, not_collected: 1 });
  });
});

describe("the status for the website", () => {
  it("gives the website the status and the mode, and nothing about who or why", async () => {
    expect(await worker("worker_signin_status", [])).toEqual({ status: "on", mode: "reply_first" });
    await db.admin.query("update public.signin_settings set mode = 'normal', breaker_state = 'tripped', breaker_reason = 'stop_spike'");
    expect(await worker("worker_signin_status", [])).toEqual({ status: "paused", mode: "normal" });
  });
});

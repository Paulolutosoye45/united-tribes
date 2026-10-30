import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// WhatsApp that cannot fail quietly, stage 2: the health page. What these prove:
//   * it ships Off, and Off means nothing is kept, nothing is counted, no one is emailed and no function answers
//   * On: what Meta tells the site is kept (latest per matter), bad news emails the director and the admin once a day, good news does not
//   * a message given up on is counted by cause for the last seven days, a member's name or number is never kept
//   * the last week's receipts are counted: reached, read, waiting, silent, in the queue
//   * the office and the pastor read; the admin, a director and the data lead run the checks and send the test; nobody else does anything
//   * the test goes to the number on the asker's own profile, on WhatsApp only, through a pause, and no more than five a day

let c: Cast;
let token: string;
let phoneN = 0;

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('test-whatsapp-health') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = null, would_pause_at = null");
  await c.sql("delete from public.whatsapp_faults");
  await c.sql("delete from public.whatsapp_guard_log");
  await c.sql("delete from public.whatsapp_signals");
  await c.sql("delete from public.whatsapp_outcomes");
  await c.sql("update public.whatsapp_checks set checked_at = null, checked_by = null, result = '{}'::jsonb");
  await c.sql("delete from public.messages");
});

const REASON = "Trying the health page with everyone";
const on = () => c.set("whatsapp_health", "on", { reason: REASON });
const overview = (who: string) => c.as(who, "whatsapp_health_overview");
const signal = (kind: string, subject: string, status: string, detail: string | null = null) =>
  c.one("select public.worker_whatsapp_signal($1, $2, $3, $4, $5) as r", [token, kind, subject, status, detail]).then((r) => r.r as boolean);
const mails = (template: string) => c.sql("select person_id, force_channel from public.messages where template = $1 order by person_id", [template]);

async function somebody(name: string) {
  const p = await c.k.person(name);
  phoneN += 1;
  await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp') on conflict (person_id) do update set phone = $2", [p.id, `+2348032${String(100000 + phoneN)}`]);
  await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [p.id]);
  return p.id;
}

/** A WhatsApp message in a state, as the sender would have left it. */
async function whatsapp(person: string, status: string, over: { sentHoursAgo?: number; delivered?: boolean } = {}) {
  const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, $2) as id", [person, `h-${Math.random()}`])).id as string;
  await c.sql(
    `update public.messages set status = $2, channel = 'whatsapp', attempts = 1,
            sent_at = case when $2 in ('sent', 'delivered', 'read') then now() - make_interval(hours => $3::int) else null end,
            delivered_at = case when $4 then now() - make_interval(hours => $3::int) + interval '1 minute' else null end
      where id = $1`,
    [id, status, over.sentHoursAgo ?? 1, over.delivered ?? false],
  );
  return id;
}

/** A message that is out with the sender on WhatsApp, given up on with an error. */
async function giveUp(error: string) {
  const who = await somebody(`Member-${Math.random().toString(36).slice(2, 8)}`);
  const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, $2) as id", [who, `g-${Math.random()}`])).id as string;
  await c.sql("update public.messages set status = 'sending', channel = 'whatsapp', attempts = 1, claimed_at = now() where id = $1", [id]);
  await c.sql("select public.worker_report($1, $2, 'rejected', null, $3)", [token, id, error]);
  return id;
}

describe("it ships Off, and Off keeps and counts nothing", () => {
  it("is in the registry for the whole church only, Off, with nothing stored", async () => {
    const f = await c.one("select * from public.feature_registry where key = 'whatsapp_health'");
    expect(f).toMatchObject({ available: true, platform_only: true, stage: 7, default_mode: "off", modes: ["off", "on"], sort: 23 });
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'whatsapp_health'")).n).toBe(0);
    for (const t of ["whatsapp_signals", "whatsapp_outcomes"]) expect((await c.one(`select count(*)::int n from public.${t}`)).n, t).toBe(0);
  });

  it("answers only 'off' to the office, and refuses everyone else", async () => {
    expect(await overview(c.admin)).toEqual({ state: "off" });
    expect(await overview(c.pastor)).toEqual({ state: "off" });
    await expectCode(c.as(c.member, "whatsapp_health_overview"), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.whatsapp_health_overview()")), "42501");
  });

  it("keeps no notice from Meta, counts no refusal and emails no one", async () => {
    expect(await signal("template", "ut_welcome", "REJECTED", "INVALID_FORMAT")).toBe(false);
    await giveUp("meta 131026: (#131026) Message undeliverable");
    await giveUp("meta 190: (#190) Access token has expired");
    expect((await c.one("select count(*)::int n from public.whatsapp_signals")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.whatsapp_outcomes")).n).toBe(0);
    expect((await mails("whatsapp_signal")).length).toBe(0);
  });

  it("will not run a check or send a test", async () => {
    await expectCode(c.as(c.admin, "whatsapp_check_save", { ok: true }), "22023");
    await expectCode(c.as(c.admin, "whatsapp_test_send"), "22023");
  });

  it("still moves a refused message to the next channel exactly as before", async () => {
    const id = await giveUp("meta 131026: (#131026) Message undeliverable");
    expect(await c.one("select status, tried from public.messages where id = $1", [id])).toMatchObject({ status: "queued", tried: ["whatsapp"] });
  });
});

describe("what Meta tells the site", () => {
  it("is kept, newest per matter, and read back by the office", async () => {
    await on();
    expect(await signal("template", "ut_welcome", "pending", null)).toBe(true);
    expect(await signal("template", "ut_welcome", "approved", null)).toBe(true);
    expect(await signal("quality", "+234 803 000 0000", "UPGRADE", "TIER_1K")).toBe(true);
    const view = await overview(c.pastor);
    expect(view.signals).toHaveLength(2);
    expect(view.signals.find((s: { kind: string }) => s.kind === "template")).toMatchObject({ subject: "ut_welcome", status: "APPROVED" });
    expect(view.signals.find((s: { kind: string }) => s.kind === "quality")).toMatchObject({ status: "UPGRADE", detail: "TIER_1K" });
  });

  it("emails bad news to the director and the admin by email only, once a day for the same matter, and good news to no one", async () => {
    await on();
    await signal("template", "ut_welcome", "APPROVED");
    expect((await mails("whatsapp_signal")).length).toBe(0);
    await signal("template", "ut_welcome", "REJECTED", "INVALID_FORMAT");
    await signal("template", "ut_welcome", "REJECTED", "INVALID_FORMAT");
    const sent = await mails("whatsapp_signal");
    expect(sent.map((m) => m.person_id).sort()).toEqual([c.admin, c.director].sort());
    expect(sent.every((m) => m.force_channel === "email")).toBe(true);
    await signal("account", "account", "ACCOUNT_RESTRICTION", "RESTRICTED_BIZ_INITIATED_MESSAGING");
    expect((await mails("whatsapp_signal")).length).toBe(4);
    const params = await c.sql("select params from public.messages where template = 'whatsapp_signal' limit 1");
    expect(String(params[0].params.what)).toContain("ut_welcome");
  });

  it("refuses a wrong token, an unknown kind and an empty matter", async () => {
    await on();
    await expectCode(c.sql("select public.worker_whatsapp_signal('not-the-token-not-the-token-not-the-token', 'template', 'x', 'APPROVED', null)"), "42501");
    expect(await signal("whatever", "x", "APPROVED")).toBe(false);
    expect(await signal("template", "  ", "APPROVED")).toBe(false);
    expect(await signal("template", "x", "")).toBe(false);
    expect((await c.one("select count(*)::int n from public.whatsapp_signals")).n).toBe(0);
  });

  it("is forgotten after ninety days", async () => {
    await on();
    await signal("template", "ut_old", "APPROVED");
    await c.sql("update public.whatsapp_signals set at = now() - interval '91 days'");
    await signal("template", "ut_new", "APPROVED");
    expect((await c.sql("select subject from public.whatsapp_signals")).map((r) => r.subject)).toEqual(["ut_new"]);
  });
});

describe("the last week", () => {
  it("counts a message given up on by cause, in a word, with no name or number kept", async () => {
    await on();
    await giveUp("meta 131030: (#131030) Recipient phone number not in allowed list");
    await giveUp("meta 131030: (#131030) Recipient phone number not in allowed list");
    await giveUp("meta 131026: (#131026) Message undeliverable");
    await giveUp("meta 190: (#190) Access token has expired");
    await giveUp("http 401");
    await giveUp("meta 132001: (#132001) Template name does not exist");
    await giveUp("something unexpected");
    const view = await overview(c.admin);
    const by = Object.fromEntries(view.movedOn.map((x: { cause: string; n: number }) => [x.cause, x.n]));
    expect(by).toEqual({ test_number: 2, not_on_whatsapp: 1, token: 2, template_missing: 1, other: 1 });
    expect(view.movedOn[0]).toEqual({ cause: "test_number", n: 2 });
    expect(view.countedSince).not.toBeNull();
    const cols = (await c.sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_outcomes'")).map((r) => r.column_name).sort();
    expect(cols).toEqual(["at", "cause", "id", "message_id"]);
  });

  it("counts a message once, when it first gives up on WhatsApp, and not again for later updates", async () => {
    await on();
    const id = await giveUp("meta 131026: (#131026) Message undeliverable");
    await c.sql("update public.messages set error = 'changed' where id = $1", [id]);
    await c.sql("update public.messages set status = 'sent', channel = 'email' where id = $1", [id]);
    expect((await c.one("select count(*)::int n from public.whatsapp_outcomes")).n).toBe(1);
  });

  it("counts a refusal Meta reports afterwards in a receipt, too", async () => {
    await on();
    const who = await somebody("Receipt");
    const id = await whatsapp(who, "sent");
    await c.sql("update public.messages set provider_id = 'wamid.A1' where id = $1", [id]);
    await c.sql("select public.worker_provider_event($1, 'wamid.A1', 'failed', 'meta 131026: Message undeliverable')", [token]);
    expect((await c.sql("select cause from public.whatsapp_outcomes")).map((r) => r.cause)).toEqual(["not_on_whatsapp"]);
  });

  it("forgets a cause after thirty days and does not count it in the week", async () => {
    await on();
    await giveUp("meta 190: (#190) Access token has expired");
    await c.sql("update public.whatsapp_outcomes set at = now() - interval '8 days'");
    expect((await overview(c.admin)).movedOn).toEqual([]);
    await c.sql("update public.whatsapp_outcomes set at = now() - interval '31 days'");
    await giveUp("meta 190: (#190) Access token has expired");
    expect((await c.one("select count(*)::int n from public.whatsapp_outcomes")).n).toBe(1);
  });

  it("counts what reached, what was read, what waits for a receipt, what is silent and what is queued", async () => {
    await on();
    const w = [await somebody("W1"), await somebody("W2"), await somebody("W3"), await somebody("W4"), await somebody("W5"), await somebody("W6")];
    await whatsapp(w[0], "delivered", { delivered: true });
    await whatsapp(w[1], "read", { delivered: true });
    await whatsapp(w[2], "sent", { sentHoursAgo: 2 });
    await whatsapp(w[3], "sent", { sentHoursAgo: 30 });
    await whatsapp(w[4], "queued");
    const other = await whatsapp(w[5], "delivered", { delivered: true });
    await c.sql("update public.messages set channel = 'email' where id = $1", [other]);
    const week = (await overview(c.admin)).week;
    expect(week).toEqual({ reached: 2, read: 1, waiting: 1, silent: 1, inQueue: 1 });
    const view = await overview(c.admin);
    expect(view.lastReceiptAt).not.toBeNull();
    expect(view.lastSentAt).not.toBeNull();
    expect(view.unconfirmedHours).toBe(24);
  });

  it("says whether WhatsApp is paused", async () => {
    await on();
    expect((await overview(c.admin)).paused).toBe(false);
    await c.set("whatsapp_guard", "on", { reason: REASON });
    await c.sql("update public.whatsapp_guard set paused = true, paused_at = now(), reason = 'Because'");
    expect((await overview(c.admin)).paused).toBe(true);
  });
});

describe("who may do what", () => {
  it("lets the office and the pastor read, and the admin, a director and the data lead run the checks and send the test", async () => {
    await on();
    const dataLead = (await c.k.staff("Data lead", "data_lead")).id;
    for (const who of [c.admin, c.director, dataLead, c.pastor]) expect(await overview(who)).toMatchObject({ state: "on" });
    expect(await overview(c.pastor)).toMatchObject({ canCheck: false, canTest: false });
    expect(await overview(c.admin)).toMatchObject({ canCheck: true });
    for (const who of [c.member, c.seasoned.id]) await expectCode(c.as(who, "whatsapp_health_overview"), "42501");
    for (const who of [c.pastor, c.member, c.seasoned.id]) {
      await expectCode(c.as(who, "whatsapp_check_save", { ok: true }), "42501");
      await expectCode(c.as(who, "whatsapp_test_send"), "42501");
    }
    for (const who of [c.admin, c.director, dataLead]) expect(await c.as(who, "whatsapp_check_save", { ok: true })).toEqual({ ok: true });
  });

  it("is closed to the sending service's call from anyone without its token", async () => {
    await on();
    await expectCode(c.as(c.admin, "worker_whatsapp_signal", "short", "template", "x", "APPROVED", null), "42501");
  });
});

describe("the checks", () => {
  it("keeps the last answer, who asked and when, for everyone in the office to read", async () => {
    await on();
    expect((await overview(c.admin)).check).toBeNull();
    const answer = { ok: false, items: [{ key: "token", state: "bad", words: "The access token has expired" }] };
    await c.as(c.director, "whatsapp_check_save", answer);
    for (const who of [c.admin, c.pastor]) {
      const seen = (await overview(who)).check;
      expect(seen.result).toEqual(answer);
      expect(seen.at).toBeTruthy();
      expect(seen.by).toBeTruthy();
    }
  });

  it("shows the platform owner, if they ran it, only as an administrator", async () => {
    await on();
    await c.sql("update public.whatsapp_checks set checked_at = now(), checked_by = $1, result = '{}'::jsonb", [c.o.owner.id]);
    const seen = await overview(c.pastor);
    expect(seen.check.by).toBe("an administrator");
    expect(JSON.stringify(seen)).not.toContain(c.o.owner.id);
  });

  it("refuses a result that is not an object or is far too large", async () => {
    await on();
    await expectCode(c.as(c.admin, "whatsapp_check_save", JSON.stringify([1, 2])), "22023");
    await expectCode(c.as(c.admin, "whatsapp_check_save", null), "22023");
    await expectCode(c.as(c.admin, "whatsapp_check_save", { big: "x".repeat(60000) }), "22023");
  });
});

describe("the test message", () => {
  it("goes to the number on the asker's own profile, on WhatsApp only, as an urgent message, through a pause and without a consent", async () => {
    await on();
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348039990001', 'email') on conflict (person_id) do update set phone = '+2348039990001', preferred = 'email'", [c.admin]);
    expect((await overview(c.admin)).canTest).toBe(true);
    const r = await c.as(c.admin, "whatsapp_test_send");
    expect(r.ok).toBe(true);
    const m = await c.one("select person_id, template, force_channel, urgency, status from public.messages where id = $1", [r.id]);
    expect(m).toEqual({ person_id: c.admin, template: "whatsapp_test", force_channel: "whatsapp", urgency: "urgent", status: "queued" });
    expect((await c.one("select public.message_channels($1) as ch", [r.id])).ch).toEqual(["whatsapp"]);
    // a pause holds every other WhatsApp message back, and lets the test through
    await c.set("whatsapp_guard", "on", { reason: REASON });
    await c.sql("update public.whatsapp_guard set paused = true, paused_at = now(), reason = 'Because'");
    expect((await c.one("select public.message_channels($1) as ch", [r.id])).ch).toEqual(["whatsapp"]);
  });

  it("is refused for someone with no number saved, in words that say what to do", async () => {
    await on();
    await c.sql("delete from public.contact_preferences where person_id = $1", [c.director]);
    expect((await overview(c.director)).canTest).toBe(false);
    const error = await c.as(c.director, "whatsapp_test_send").catch((e: Error) => e.message);
    expect(String(error)).toContain("Save your own phone number");
  });

  it("is limited to one every half minute and five a day", async () => {
    await on();
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348039990002', 'email') on conflict (person_id) do update set phone = '+2348039990002'", [c.admin]);
    await c.as(c.admin, "whatsapp_test_send");
    const again = await c.as(c.admin, "whatsapp_test_send").catch((e: Error) => e.message);
    expect(String(again)).toContain("Wait half a minute");
    await c.sql("update public.messages set dedupe_key = dedupe_key || ':old' where template = 'whatsapp_test'");
    for (let i = 0; i < 4; i += 1) {
      await c.sql("select public.enqueue_message($1, 'whatsapp_test', '{}'::jsonb, null, $2, null, 'urgent', 'whatsapp')", [c.admin, `more-${i}`]);
    }
    const sixth = await c.as(c.admin, "whatsapp_test_send").catch((e: Error) => e.message);
    expect(String(sixth)).toContain("Five test messages a day");
  });

  it("shows its progress and, if it failed, the cause in a word", async () => {
    await on();
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348039990003', 'email') on conflict (person_id) do update set phone = '+2348039990003'", [c.admin]);
    const r = await c.as(c.admin, "whatsapp_test_send");
    expect((await overview(c.admin)).test).toMatchObject({ id: r.id, status: "queued", cause: null });
    await c.sql("update public.messages set status = 'sending', channel = 'whatsapp', attempts = 1 where id = $1", [r.id]);
    await c.sql("select public.worker_report($1, $2, 'rejected', null, 'meta 131030: (#131030) Recipient phone number not in allowed list')", [token, r.id]);
    expect((await overview(c.admin)).test).toMatchObject({ id: r.id, status: "failed", cause: "test_number" });
    // someone else's test is not shown to this person
    expect((await overview(c.director)).test).toBeNull();
  });
});

describe("it is for the whole church only", () => {
  it("refuses a rule for one centre or one role, and only the platform owner moves it", async () => {
    const centre = (await c.one("select id from public.centres limit 1")).id as string;
    await expect(c.set("whatsapp_health", "on", { scope: "centre", id: centre, reason: REASON })).rejects.toMatchObject({ code: "22023" });
    await expect(c.set("whatsapp_health", "on", { roles: ["leader"], reason: REASON })).rejects.toMatchObject({ code: "22023" });
    await expectCode(c.as(c.admin, "god_feature_set", "whatsapp_health", "platform", null, "on", [], REASON, null), "42501");
    const board = await c.o.call("god_feature_board");
    expect(board.features.find((f: { key: string }) => f.key === "whatsapp_health")).toMatchObject({ platformOnly: true, stage: 7, summary: "off" });
  });

  it("is Off again for everything when the Master pause is on", async () => {
    await on();
    expect(await overview(c.admin)).toMatchObject({ state: "on" });
    await c.o.call("god_feature_master", true, "Something looks wrong");
    expect(await overview(c.admin)).toEqual({ state: "off" });
    expect(await signal("template", "ut_x", "REJECTED")).toBe(false);
    await c.o.call("god_feature_master", false, "All clear");
  });
});

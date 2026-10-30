import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// WhatsApp that cannot fail quietly, stage 1: the safety net. What these prove:
//   * it ships Off, and Off means the outbox is exactly what it was: no fault is counted, nothing pauses, no email goes
//   * in Rehearsal the rule counts and says when it WOULD have paused, and holds nothing back
//   * On: five rejections of the account itself in thirty minutes pause WhatsApp, the director and the admin are emailed, a person restarts it
//   * a rejection about one member (not on WhatsApp, too many messages) never counts; neither does a rejection older than the window
//   * a paused message is not lost: it goes to the member's next channel; a test message is the one exception
//   * a person can pause and restart, only the office can, only while the net is On, and the Master pause makes it Off
//   * the function is for the whole church only

let c: Cast;
let token: string;
let phoneN = 0;

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('test-whatsapp-safety') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = null, would_pause_at = null, trip_count = 5, trip_minutes = 30, unconfirmed_hours = 24");
  await c.sql("delete from public.whatsapp_faults");
  await c.sql("delete from public.whatsapp_guard_log");
  await c.sql("delete from public.messages");
});

const REASON = "Trying the safety net with everyone";
const on = () => c.set("whatsapp_guard", "on", { reason: REASON });
const rehearse = () => c.set("whatsapp_guard", "rehearsal");

/** A member who agreed to WhatsApp and email, with a number. */
async function somebody(name: string, whatsapp = true) {
  const p = await c.k.person(name);
  phoneN += 1;
  await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp') on conflict (person_id) do update set phone = $2", [p.id, `+2348031${String(100000 + phoneN)}`]);
  await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', $2, 'test')", [p.id, whatsapp]);
  return p.id;
}

/** A message that is out with the sender on WhatsApp, as worker_claim leaves it (the clock of the day does not matter here). */
async function sending(person: string, template = "week_start") {
  const id = (await c.one("select public.enqueue_message($1, $2, '{}'::jsonb, null, $3) as id", [person, template, `t-${Math.random()}`])).id as string;
  await c.sql("update public.messages set status = 'sending', channel = 'whatsapp', attempts = 1, claimed_at = now() where id = $1", [id]);
  return id;
}

const report = (id: string, outcome: string, error: string | null) => c.sql("select public.worker_report($1, $2, $3, null, $4)", [token, id, outcome, error]);
const channels = async (id: string) => (await c.one("select public.message_channels($1) as ch", [id])).ch as string[];
const guard = () => c.one("select * from public.whatsapp_guard");
const faults = async () => (await c.one("select count(*)::int n from public.whatsapp_faults")).n as number;
const logKinds = async () => (await c.sql("select kind from public.whatsapp_guard_log order by id")).map((r) => r.kind as string);
const TEST_NUMBER = "meta 131030: (#131030) Recipient phone number not in allowed list";

async function reject(n: number, error = TEST_NUMBER) {
  for (let i = 0; i < n; i++) {
    const who = await somebody(`Member${i}-${Math.random().toString(36).slice(2, 7)}`);
    await report(await sending(who), "rejected", error);
  }
}

describe("it ships Off, and Off is the outbox as it was", () => {
  it("is in the registry for the whole church only, Off, with one row to pause and a log that is empty", async () => {
    const f = await c.one("select * from public.feature_registry where key = 'whatsapp_guard'");
    expect(f).toMatchObject({ available: true, platform_only: true, stage: 7, default_mode: "off", modes: ["off", "rehearsal", "on"] });
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'whatsapp_guard'")).n).toBe(0);
    expect(await guard()).toMatchObject({ paused: false, auto: false, trip_count: 5, trip_minutes: 30, unconfirmed_hours: 24 });
    expect((await c.one("select public.feature_platform_state('whatsapp_guard') as s")).s).toBe("off");
    expect((await c.one("select public.whatsapp_paused() as p")).p).toBe(false);
  });

  it("counts nothing and pauses nothing however many rejections come, and emails no one", async () => {
    await reject(8);
    expect(await faults()).toBe(0);
    expect((await guard()).paused).toBe(false);
    expect(await logKinds()).toEqual([]);
    expect((await c.one("select count(*)::int n from public.messages where template = 'whatsapp_paused'")).n).toBe(0);
  });

  it("still uses WhatsApp first for a member who agreed to it", async () => {
    const who = await somebody("Agreed");
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'a') as id", [who])).id as string;
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
  });

  it("falls to email after a refusal exactly as before (a refused message goes to the next channel)", async () => {
    const who = await somebody("Refused");
    const id = await sending(who);
    await report(id, "rejected", "meta 131026: (#131026) Message undeliverable");
    expect(await c.one("select status, tried from public.messages where id = $1", [id])).toMatchObject({ status: "queued", tried: ["whatsapp"] });
    expect(await channels(id)).toEqual(["email"]);
  });
});

describe("Rehearsal", () => {
  it("counts the faults and says it would have paused, and holds nothing back", async () => {
    await rehearse();
    await reject(5);
    expect(await faults()).toBe(5);
    expect((await guard()).paused).toBe(false);
    expect(await logKinds()).toEqual(["would_pause"]);
    expect((await c.one("select count(*)::int n from public.messages where template = 'whatsapp_paused'")).n).toBe(0);
    const who = await somebody("Still sent");
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'b') as id", [who])).id as string;
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
  });

  it("does not repeat itself inside the window, and a manual pause is refused (nothing would happen)", async () => {
    await rehearse();
    await reject(7);
    expect(await logKinds()).toEqual(["would_pause"]);
    await expectCode(c.as(c.admin, "whatsapp_pause", "Because I want to test it"), "22023");
  });
});

describe("On: the rule", () => {
  it("pauses WhatsApp on the fifth rejection of the account in thirty minutes, and tells the director and the admin by email", async () => {
    await on();
    await reject(4);
    expect(await faults()).toBe(4);
    expect((await guard()).paused).toBe(false);
    await reject(1);
    const g = await guard();
    expect(g).toMatchObject({ paused: true, auto: true, paused_by: null });
    expect(g.reason).toContain("5 times in 30 minutes");
    expect(g.reason).toContain("131030");
    expect(await logKinds()).toEqual(["auto_paused"]);
    const mails = await c.sql("select person_id, force_channel, params from public.messages where template = 'whatsapp_paused' order by person_id");
    expect(mails.map((m) => m.person_id).sort()).toEqual([c.director, c.admin].sort());
    expect(mails.every((m) => m.force_channel === "email")).toBe(true);
    expect(mails[0].params).toMatchObject({ code: 131030, count: 5, minutes: 30 });
  });

  it("sends the paused message on its next channel instead of losing it", async () => {
    await on();
    await reject(5);
    const who = await somebody("After the pause");
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'c') as id", [who])).id as string;
    expect(await channels(id)).toEqual(["email"]);
    const sent = await sending(who, "meeting_reminder");
    await report(sent, "rejected", TEST_NUMBER);
    expect((await c.one("select status, tried from public.messages where id = $1", [sent])).status).toBe("queued");
    expect(await channels(sent)).toEqual(["email"]);
  });

  it("counts only the account's own faults: a number that is not on WhatsApp, too many messages, and a hiccup never do", async () => {
    await on();
    await reject(3, "meta 131026: (#131026) Message undeliverable");
    await reject(3, "meta 131049: (#131049) This message was not delivered to maintain healthy ecosystem engagement");
    await reject(3, "meta 131056: (#131056) pair rate limit");
    await reject(3, "whatsapp unreachable");
    await reject(3, "no phone number");
    expect(await faults()).toBe(0);
    expect((await guard()).paused).toBe(false);
  });

  it("counts an expired token (190) and a refusal without a code (401), and only inside the window", async () => {
    await on();
    await reject(2, "meta 190: Error validating access token: Session has expired");
    await reject(2, "http 401");
    expect(await faults()).toBe(4);
    await c.sql("update public.whatsapp_faults set at = now() - interval '45 minutes'");
    await reject(1, "meta 190: Error validating access token");
    expect((await guard()).paused).toBe(false);
    await reject(4, "meta 190: Error validating access token");
    expect((await guard()).paused).toBe(true);
  });

  it("uses the numbers the office chose", async () => {
    await on();
    await c.sql("update public.whatsapp_guard set trip_count = 2, trip_minutes = 10");
    await reject(1);
    expect((await guard()).paused).toBe(false);
    await reject(1);
    expect((await guard()).paused).toBe(true);
  });

  it("does not pause twice, and a restart forgets the faults it was paused for", async () => {
    await on();
    await reject(5);
    await reject(3);
    expect(await logKinds()).toEqual(["auto_paused"]);
    await c.as(c.admin, "whatsapp_resume", "Replaced the token");
    expect(await guard()).toMatchObject({ paused: false, auto: false });
    await reject(4);
    expect((await guard()).paused).toBe(false);
    await reject(1);
    expect((await guard()).paused).toBe(true);
  });

  it("never stops a message because the watch itself failed", async () => {
    await on();
    await c.sql("alter table public.whatsapp_guard rename to whatsapp_guard_x");
    try {
      const who = await somebody("Watch broken");
      const id = await sending(who);
      await report(id, "rejected", TEST_NUMBER);
      expect((await c.one("select status from public.messages where id = $1", [id])).status).toBe("queued");
    } finally {
      await c.sql("alter table public.whatsapp_guard_x rename to whatsapp_guard");
    }
  });
});

describe("a person pauses and restarts", () => {
  it("lets the admin, a director and the data lead pause with a reason, and nobody else", async () => {
    await on();
    const dataLead = (await c.k.staff("Data lead", "data_lead")).id;
    for (const who of [c.member, c.pastor, c.seasoned.id]) await expectCode(c.as(who, "whatsapp_pause", "A good enough reason"), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.whatsapp_pause('A good enough reason')")), "42501");
    await expectCode(c.as(c.admin, "whatsapp_pause", "short"), "22023");
    await expectCode(c.as(c.admin, "whatsapp_pause", null), "22023");
    expect(await c.as(dataLead, "whatsapp_pause", "Meta is down for everyone")).toEqual({ ok: true, changed: true });
    expect(await guard()).toMatchObject({ paused: true, auto: false, paused_by: dataLead, reason: "Meta is down for everyone" });
    expect(await c.as(c.director, "whatsapp_pause", "Already stopped by Ada")).toEqual({ ok: true, changed: false });
    expect(await logKinds()).toEqual(["paused"]);
  });

  it("is refused while the safety net is Off, with words that say what to do", async () => {
    const error = await c.as(c.admin, "whatsapp_pause", "A good enough reason").catch((e: Error) => e.message);
    expect(String(error)).toContain("not switched On in God Mode");
  });

  it("holds WhatsApp back for every member while paused, and a restart brings it back", async () => {
    await on();
    const who = await somebody("Held");
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'd') as id", [who])).id as string;
    await c.as(c.admin, "whatsapp_pause", "Meta is down for everyone");
    expect(await channels(id)).toEqual(["email"]);
    const forced = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'e', null, 'normal', 'whatsapp') as id", [who])).id as string;
    expect(await channels(forced)).toEqual([]);
    await c.as(c.director, "whatsapp_resume", "Meta is back");
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
    expect(await channels(forced)).toEqual(["whatsapp"]);
    expect(await logKinds()).toEqual(["paused", "resumed"]);
  });

  it("lets a test message through a pause, so the account can be tried before it is restarted", async () => {
    await on();
    const who = await somebody("Tester");
    await c.as(c.admin, "whatsapp_pause", "Replacing the token");
    const test = (await c.one("select public.enqueue_message($1, 'whatsapp_test', '{}'::jsonb, null, 'f', null, 'normal', 'whatsapp') as id", [who])).id as string;
    expect(await channels(test)).toEqual(["whatsapp"]);
  });

  it("lets only a person restart, and says nothing happened when it is not paused", async () => {
    await on();
    expect(await c.as(c.admin, "whatsapp_resume", null)).toEqual({ ok: true, changed: false });
    await expectCode(c.as(c.member, "whatsapp_resume", null), "42501");
    await expectCode(c.as(c.pastor, "whatsapp_resume", null), "42501");
  });

  it("is Off for everything again when the Master pause is on, and back when it is lifted", async () => {
    await on();
    await c.as(c.admin, "whatsapp_pause", "Meta is down for everyone");
    expect((await c.one("select public.whatsapp_paused() as p")).p).toBe(true);
    await c.o.call("god_feature_master", true, "Everything stops");
    expect((await c.one("select public.whatsapp_paused() as p")).p).toBe(false);
    await c.o.call("god_feature_master", false, null);
    expect((await c.one("select public.whatsapp_paused() as p")).p).toBe(true);
  });
});

describe("the three numbers and the page", () => {
  it("lets the admin or a director change them within bounds, and writes down what they were", async () => {
    expect(await c.as(c.director, "whatsapp_guard_settings_save", 3, 15, 48)).toEqual({ ok: true, changed: true });
    expect(await guard()).toMatchObject({ trip_count: 3, trip_minutes: 15, unconfirmed_hours: 48 });
    expect(await c.as(c.admin, "whatsapp_guard_settings_save", 3, 15, 48)).toEqual({ ok: true, changed: false });
    const dataLead = (await c.k.staff("Data lead 2", "data_lead")).id;
    for (const who of [dataLead, c.pastor, c.member]) await expectCode(c.as(who, "whatsapp_guard_settings_save", 3, 15, 48), "42501");
    for (const bad of [[1, 15, 48], [51, 15, 48], [3, 4, 48], [3, 241, 48], [3, 15, 1], [3, 15, 169]]) {
      await expectCode(c.as(c.admin, "whatsapp_guard_settings_save", ...bad), "22023");
    }
    const row = await c.one("select detail from public.whatsapp_guard_log where kind = 'settings'");
    expect(row.detail).toMatchObject({ from: { tripCount: 5 }, to: { tripCount: 3 } });
  });

  it("is read by the office and the pastor and nobody else, and shows the platform owner only as an administrator", async () => {
    await on();
    for (const who of [c.admin, c.director, c.pastor]) expect(await c.as(who, "whatsapp_guard_overview")).toMatchObject({ state: "on", paused: false });
    await expectCode(c.as(c.member, "whatsapp_guard_overview"), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.whatsapp_guard_overview()")), "42501");
    const view = await c.as(c.pastor, "whatsapp_guard_overview");
    expect(view).toMatchObject({ canChange: false, canSettings: false, settings: { tripCount: 5, tripMinutes: 30, unconfirmedHours: 24 } });
    expect(await c.as(c.admin, "whatsapp_guard_overview")).toMatchObject({ canChange: true, canSettings: true });
    // the owner's name is never printed
    await c.sql("update public.whatsapp_guard set paused = true, paused_by = $1, paused_at = now(), reason = 'Because'", [c.o.owner.id]);
    await c.sql("insert into public.whatsapp_guard_log (kind, by_person, reason) values ('paused', $1, 'Because')", [c.o.owner.id]);
    const seen = await c.as(c.pastor, "whatsapp_guard_overview");
    expect(seen.pausedBy).toBe("an administrator");
    expect(seen.log[0].by).toBe("an administrator");
    expect(JSON.stringify(seen)).not.toContain(c.o.owner.id);
  });

  it("counts a message Meta accepted that never got a receipt, but not a recent one, a delivered one or another channel", async () => {
    await on();
    const who = await somebody("Unconfirmed");
    const make = async (hoursAgo: number, o: { delivered?: boolean; channel?: string } = {}) => {
      const id = await sending(who);
      await c.sql(
        "update public.messages set status = $4, provider_id = $2, sent_at = now() - make_interval(hours => $3), delivered_at = case when $5 then now() else null end, channel = $6 where id = $1",
        [id, `wamid.${Math.random()}`, hoursAgo, o.delivered ? "delivered" : "sent", Boolean(o.delivered), o.channel ?? "whatsapp"],
      );
      return id;
    };
    await make(30);
    await make(50);
    await make(2);
    await make(30, { delivered: true });
    await make(30, { channel: "email" });
    const view = await c.as(c.admin, "whatsapp_guard_overview");
    expect(view.unconfirmed.count).toBe(2);
    expect(view.unconfirmed.oldest).toBeTruthy();
  });

  it("reads which codes failed in the last day", async () => {
    await on();
    await reject(2, "meta 190: Error validating access token");
    await reject(1, TEST_NUMBER);
    const view = await c.as(c.admin, "whatsapp_guard_overview");
    expect(view.faultCodes).toEqual([{ code: 190, n: 2 }, { code: 131030, n: 1 }]);
    expect(view.faultsNow).toBe(3);
  });
});

describe("it is for the whole church only", () => {
  it("refuses a rule for one centre, one role or a hold-out, in the function and in the table", async () => {
    const centre = (await c.one("select id from public.centres limit 1")).id as string;
    await expect(c.set("whatsapp_guard", "on", { scope: "centre", id: centre, reason: REASON })).rejects.toMatchObject({ code: "22023" });
    await expect(c.set("whatsapp_guard", "on", { roles: ["leader"], reason: REASON })).rejects.toMatchObject({ code: "22023" });
    await expect(c.set("whatsapp_guard", "on", { holdout: "2030-01-01", reason: REASON })).rejects.toMatchObject({ code: "22023" });
    await expectCode(c.db.admin.query("insert into public.feature_settings (feature, scope, scope_id, position) values ('whatsapp_guard', 'centre', $1, 'on')", [centre]), "22023");
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'whatsapp_guard'")).n).toBe(0);
  });

  it("is moved only by the platform owner, and the board says it is for the whole church only", async () => {
    await expectCode(c.as(c.admin, "god_feature_set", "whatsapp_guard", "platform", null, "on", [], REASON, null), "42501");
    const board = await c.o.call("god_feature_board");
    expect(board.features.find((f: { key: string }) => f.key === "whatsapp_guard")).toMatchObject({ platformOnly: true, stage: 7, summary: "off" });
    expect(board.features.find((f: { key: string }) => f.key === "my_page")).toMatchObject({ platformOnly: false });
  });
});

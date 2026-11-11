import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// WhatsApp mode: Full, Saver and Free, the cost page, the number-health guards, and WhatsApp sent by people. What these prove:
//   * it ships Off, and Off is the outbox as it was; it does nothing until the safety net is On as well
//   * Free: no message of any kind is for WhatsApp (the office test included), the website is told it may not speak to Meta, and a member only
//     WhatsApp can reach is listed to be messaged by hand
//   * Saver: class A stays on WhatsApp, B and C go by email, a person with no other channel still gets the message
//   * the Marketing guard, the weekly cap, the hour's pace, the window and the daily reach hold the number back from trouble
//   * the quality guard drops Full to Saver at Medium and pauses at Low; the monthly ceiling warns, then drops Full to Saver, once a month
//   * the pages are for the office only, each change keeps a reason, and the cost estimate matches a hand count
//   * a leader posts to the group and messages their own members who said yes, nobody else's; the office messages leaders

let c: Cast;
let token: string;
let phoneN = 0;

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('test-whatsapp-mode') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("update public.whatsapp_guard set paused = false, auto = false, reason = null, paused_at = null, paused_by = null, cleared_at = null, would_pause_at = null");
  await c.sql("delete from public.whatsapp_faults");
  await c.sql("delete from public.whatsapp_guard_log");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.whatsapp_marketing");
  await c.sql("delete from public.whatsapp_hand_log");
  await c.sql("delete from public.whatsapp_mode_log");
  await c.sql("update public.whatsapp_checks set checked_at = null, result = '{}'::jsonb");
  await c.sql(
    `update public.whatsapp_mode set mode = 'full', reason = null, changed_at = null, changed_by = null, auto = false, ceiling_usd = 100, warn_pct = 80, pace_per_hour = 300,
            reach_pct = 80, weekly_cap = 2, window_from = 0, window_to = 24, quality_guard = true, ceiling_warned_month = null, ceiling_tripped_month = null`,
  );
  await c.sql("delete from public.whatsapp_rates where added_by is not null");
  await c.sql("delete from public.person_roles where role in ('data_lead') and person_id <> $1", [c.admin]).catch(() => undefined);
});

const REASON = "Trying the mode with everyone";
const guardOn = () => c.set("whatsapp_guard", "on", { reason: REASON });
const healthOn = () => c.set("whatsapp_health", "on", { reason: REASON });
/** The safety net On and WhatsApp mode On, in the chosen mode. */
async function mode(m: "full" | "saver" | "free") {
  await guardOn();
  await c.set("whatsapp_mode", "on", { reason: REASON });
  await c.as(c.admin, "whatsapp_mode_set", m, "Testing this mode");
}

async function somebody(name: string, opts: { whatsapp?: boolean; email?: boolean; sms?: boolean } = {}) {
  const p = await c.k.person(name);
  phoneN += 1;
  await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp') on conflict (person_id) do update set phone = $2", [p.id, `+2348032${String(100000 + phoneN)}`]);
  await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', $2, 'test')", [p.id, opts.whatsapp ?? true]);
  if (opts.sms) await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'sms', true, 'test')", [p.id]);
  if (opts.email === false) {
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'test')", [p.id]);
  }
  return p.id;
}
const queue = async (person: string, template: string, extra = "") =>
  (await c.one(`select public.enqueue_message($1, $2, '{}'::jsonb, null, $3${extra}) as id`, [person, template, `t-${Math.random()}`])).id as string;
const channels = async (id: string) => (await c.one("select public.message_channels($1) as ch", [id])).ch as string[];
const modeNow = async () => (await c.one("select public.whatsapp_mode_now() as m")).m as string;
const row = () => c.one("select * from public.whatsapp_mode");
const logKinds = async () => (await c.sql("select kind from public.whatsapp_mode_log order by id")).map((r) => r.kind as string);
const alerts = async () => (await c.sql("select person_id, force_channel, params from public.messages where template = 'whatsapp_mode_alert'"));
/** Messages that already went by WhatsApp to this person, as the sender leaves them. */
async function wentBy(person: string, n: number, template = "week_start", ago = "1 hour") {
  for (let i = 0; i < n; i++) {
    const id = await queue(person, template);
    await c.sql(`update public.messages set status = 'delivered', channel = 'whatsapp', claimed_at = now() - interval '${ago}', sent_at = now() - interval '${ago}' where id = $1`, [id]);
  }
}
const pressure = async (id: string) => (await c.one("select public.whatsapp_pressure($1) as p", [id])).p as string;

describe("it ships Off, and Off is the outbox as it was", () => {
  it("is on the Switchboard for the whole church only, Off, after the safety net", async () => {
    const f = await c.one("select * from public.feature_registry where key = 'whatsapp_mode'");
    expect(f).toMatchObject({ available: true, platform_only: true, stage: 7, default_mode: "off", modes: ["off", "rehearsal", "on"], depends: ["whatsapp_guard"] });
    expect((await c.one("select public.feature_platform_state('whatsapp_mode') as s")).s).toBe("off");
    expect(await row()).toMatchObject({ mode: "full", weekly_cap: 2, pace_per_hour: 300, reach_pct: 80, window_from: 0, window_to: 24, quality_guard: true });
  });

  it("starts with a class for every message that can go by WhatsApp, the starting rates and a ceiling of US$100", async () => {
    const n = await c.one("select count(*)::int n, count(*) filter (where class = 'A')::int a, count(*) filter (where class = 'B')::int b, count(*) filter (where class = 'C')::int c from public.whatsapp_message_class");
    expect(n).toMatchObject({ n: 62, a: 9, b: 33, c: 20 });
    expect((await c.sql("select category, usd::float from public.whatsapp_rates order by category")).map((r) => `${r.category}:${r.usd}`)).toEqual(["marketing:0.0516", "utility:0.0101"]);
    expect(Number((await row()).ceiling_usd)).toBe(100);
  });

  it("uses WhatsApp first for a member who agreed to it, whatever mode is chosen, and tells the website it may speak to Meta", async () => {
    await c.sql("update public.whatsapp_mode set mode = 'free'");
    const who = await somebody("Agreed");
    expect(await channels(await queue(who, "week_start"))).toEqual(["whatsapp", "email"]);
    expect(await modeNow()).toBe("full");
    expect((await c.one("select public.worker_whatsapp_allowed($1) as a", [token])).a).toEqual({ mode: "full", meta: true });
  });

  it("does nothing in Rehearsal either, and nothing at all until the safety net is On as well", async () => {
    await c.set("whatsapp_mode", "rehearsal", { reason: REASON }).catch(() => undefined);
    await c.sql("update public.whatsapp_mode set mode = 'free'");
    expect(await modeNow()).toBe("full");
    await c.set("whatsapp_mode", "on", { reason: REASON }).catch(() => undefined);
    // the safety net is Off, so the function cannot be On: the Switchboard answers Off
    expect((await c.one("select public.feature_platform_state('whatsapp_mode') as s")).s).toBe("off");
    expect(await modeNow()).toBe("full");
    const who = await somebody("Still on WhatsApp");
    expect(await channels(await queue(who, "week_start"))).toEqual(["whatsapp", "email"]);
  });

  it("counts nothing and changes nothing when the heartbeat step runs", async () => {
    expect((await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t).toEqual({ state: "off" });
    expect(await logKinds()).toEqual([]);
  });
});

describe("Free: nothing goes through Meta", () => {
  it("leaves WhatsApp out of every message: it goes by email, and the website is told it may not speak to Meta", async () => {
    await mode("free");
    expect(await modeNow()).toBe("free");
    expect((await c.one("select public.worker_whatsapp_allowed($1) as a", [token])).a).toEqual({ mode: "free", meta: false });
    const who = await somebody("Free member");
    expect(await channels(await queue(who, "week_start"))).toEqual(["email"]);
    expect(await channels(await queue(who, "swap_offered"))).toEqual(["email"]);
    expect(await channels(await queue(who, "care_urgent"))).toEqual(["email"]);
  });

  it("does not even send the office test message, and the health page's test button says why", async () => {
    await mode("free");
    await healthOn();
    const who = await somebody("The office");
    const id = await queue(who, "whatsapp_test", ", null, 'urgent', 'whatsapp'");
    expect(await channels(id)).toEqual([]);
    await c.db.grant(who, "data_lead");
    await expect(c.as(who, "whatsapp_test_send")).rejects.toThrow(/Free mode/);
  });

  it("gives a member only WhatsApp can reach no automatic message, and says so on the message, so a leader can send it by hand", async () => {
    await mode("free");
    const only = await somebody("Only WhatsApp", { email: false });
    await c.sql("update public.people set email = null where id = $1", [only]).catch(() => undefined);
    const id = await queue(only, "week_start", ", null, 'urgent'");
    expect(await channels(id)).toEqual([]);
    const claimed = (await c.one("select public.worker_claim($1, 50) as r", [token])).r as unknown[];
    expect(claimed.length).toBe(0);
    expect(await c.one("select status, error from public.messages where id = $1", [id])).toMatchObject({ status: "failed", error: "WhatsApp is in Free mode: send this one by hand" });
  });

  it("leaves a forced email alone and a forced WhatsApp message unsent", async () => {
    await mode("free");
    const who = await somebody("Forced");
    const email = await queue(who, "week_start", ", null, 'normal', 'email'");
    const wa = await queue(who, "week_start", ", null, 'normal', 'whatsapp'");
    expect(await channels(email)).toEqual(["email"]);
    expect(await channels(wa)).toEqual([]);
  });

  it("goes back to WhatsApp first the moment the mode is changed, with no redeploy", async () => {
    await mode("free");
    const who = await somebody("Back");
    const id = await queue(who, "week_start");
    expect(await channels(id)).toEqual(["email"]);
    await c.as(c.admin, "whatsapp_mode_set", "full", "Back to Full for a test");
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
  });
});

describe("Saver", () => {
  it("keeps class A on WhatsApp and sends B and C by email", async () => {
    await mode("saver");
    const who = await somebody("Saver member");
    expect(await channels(await queue(who, "swap_offered"))).toEqual(["whatsapp", "email"]);
    expect(await channels(await queue(who, "care_urgent"))).toEqual(["whatsapp", "email"]);
    expect(await channels(await queue(who, "week_start"))).toEqual(["email"]);
    expect(await channels(await queue(who, "friday_checkin"))).toEqual(["email"]);
    expect(await channels(await queue(who, "application_received"))).toEqual(["email"]);
  });

  it("leaves nobody out: a person with no other channel still gets a class B message by WhatsApp", async () => {
    await mode("saver");
    const only = await somebody("Only WhatsApp", { email: false });
    await c.sql("update public.people set email = null where id = $1", [only]).catch(() => undefined);
    const ch = await channels(await queue(only, "week_start"));
    expect(ch).toEqual(["whatsapp"]);
  });

  it("uses a person's text consent as a channel too", async () => {
    await mode("saver");
    const who = await somebody("Text member", { email: false, sms: true });
    await c.sql("update public.people set email = null where id = $1", [who]).catch(() => undefined);
    expect(await channels(await queue(who, "week_start"))).toEqual(["sms"]);
  });

  it("follows a class the director changes, at once", async () => {
    await mode("saver");
    const who = await somebody("Changed");
    const id = await queue(who, "week_start");
    expect(await channels(id)).toEqual(["email"]);
    await c.as(c.director, "whatsapp_class_set", "week_start", "A");
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
    await c.as(c.director, "whatsapp_class_set", "week_start", "B");
    expect(await channels(id)).toEqual(["email"]);
  });

  it("keeps a message the table does not know on WhatsApp, as today, and leaves the office test message alone", async () => {
    await mode("saver");
    const who = await somebody("Unknown");
    expect((await c.one("select public.whatsapp_class('no_such_message') as c")).c).toBe("A");
    expect(await channels(await queue(who, "whatsapp_test", ", null, 'urgent'"))).toEqual(["whatsapp", "email"]);
  });

  it("works the same for a member who prefers email, and for a pause (the pause still wins)", async () => {
    await mode("saver");
    const who = await somebody("Paused");
    await c.sql("update public.whatsapp_guard set paused = true");
    expect(await channels(await queue(who, "swap_offered"))).toEqual(["email"]);
  });
});

describe("the number-health guards", () => {
  it("sends a message by email when Meta has filed its wording as Marketing, in Full mode too, unless the person has nothing else", async () => {
    await mode("full");
    const who = await somebody("Marketing");
    const id = await queue(who, "week_start");
    expect(await channels(id)).toEqual(["whatsapp", "email"]);
    await c.sql("insert into public.whatsapp_marketing (template_key) values ('week_start')");
    expect(await channels(id)).toEqual(["email"]);
    const only = await somebody("Only WhatsApp", { email: false });
    await c.sql("update public.people set email = null where id = $1", [only]).catch(() => undefined);
    expect(await channels(await queue(only, "week_start"))).toEqual(["whatsapp"]);
  });

  it("stops class B and C at the weekly cap but never class A", async () => {
    await mode("full");
    const who = await somebody("Capped");
    await wentBy(who, 2);
    expect(await channels(await queue(who, "meeting_reminder"))).toEqual(["email"]);
    expect(await channels(await queue(who, "swap_offered"))).toEqual(["whatsapp", "email"]);
    await c.sql("update public.whatsapp_mode set weekly_cap = 3");
    expect(await channels(await queue(who, "meeting_reminder"))).toEqual(["whatsapp", "email"]);
    // messages older than a week do not count
    const old = await somebody("Old");
    await wentBy(old, 4, "week_start", "9 days");
    expect(await channels(await queue(old, "meeting_reminder"))).toEqual(["whatsapp", "email"]);
  });

  it("holds the weekly rhythm outside the window and the pace, but never class A, an urgent message or the test message", async () => {
    await mode("full");
    const who = await somebody("Window");
    const hour = (await c.one("select public.lagos_hour() as h")).h as number;
    await c.sql("update public.whatsapp_mode set window_from = $1, window_to = $2", [(hour + 2) % 22, ((hour + 2) % 22) + 1]);
    const b = await queue(who, "meeting_reminder");
    expect(await pressure(b)).toBe("window");
    expect(await pressure(await queue(who, "swap_offered"))).toBe("ok");
    expect(await pressure(await queue(who, "meeting_reminder", ", null, 'urgent'"))).toBe("ok");
    expect(await pressure(await queue(who, "whatsapp_test", ", null, 'urgent', 'whatsapp'"))).toBe("ok");
    await c.sql("update public.whatsapp_mode set window_from = 0, window_to = 24, pace_per_hour = 10");
    expect(await pressure(b)).toBe("ok");
    for (let i = 0; i < 10; i++) {
      const p = await somebody(`Pace${i}`);
      const id = await queue(p, "week_start");
      await c.sql("update public.messages set status = 'sent', channel = 'whatsapp', claimed_at = now() where id = $1", [id]);
    }
    expect(await pressure(b)).toBe("pace");
    expect(await pressure(await queue(who, "swap_offered"))).toBe("ok");
  });

  it("holds the pace and the reach in the claim: a message waits for the next hour or day, or goes by its next channel", async () => {
    await mode("full");
    await c.sql("update public.whatsapp_mode set reach_pct = 10");
    await c.sql("update public.whatsapp_checks set checked_at = now(), result = '{\"facts\": {\"limit\": 20}}'::jsonb");
    // today's limit of different people is 10% of 20 = 2
    for (const name of ["Reach1", "Reach2"]) {
      const p = await somebody(name);
      const id = await queue(p, "swap_offered");
      await c.sql("update public.messages set status = 'sent', channel = 'whatsapp', claimed_at = now() where id = $1", [id]);
    }
    const third = await somebody("Reach3");
    const id = await queue(third, "swap_offered", ", null, 'urgent'");
    expect(await pressure(id)).toBe("reach");
    // another channel exists: it goes by that one
    const claimed = (await c.one("select public.worker_claim($1, 50) as r", [token])).r as { id: string; channel: string }[];
    expect(claimed.find((m) => m.id === id)?.channel).toBe("email");
    // a person who already had a WhatsApp message today is not a new person
    const again = await queue(await somebody("Reach1b"), "swap_offered");
    await c.sql("update public.messages set status = 'sent', channel = 'whatsapp', claimed_at = now() where id = $1", [again]);
    // a person with no other channel waits until tomorrow
    const only = await somebody("Only WhatsApp", { email: false });
    await c.sql("update public.people set email = null where id = $1", [only]).catch(() => undefined);
    const wait = await queue(only, "swap_offered", ", null, 'urgent'");
    const claimed2 = (await c.one("select public.worker_claim($1, 50) as r", [token])).r as { id: string }[];
    expect(claimed2.find((m) => m.id === wait)).toBeUndefined();
    const held = await c.one("select status, scheduled_for > now() + interval '1 hour' as later from public.messages where id = $1", [wait]);
    expect(held).toMatchObject({ status: "queued", later: true });
  });

  it("does nothing about reach when the limit is not known", async () => {
    await mode("full");
    const p = await somebody("Unknown limit");
    expect(await pressure(await queue(p, "swap_offered"))).toBe("ok");
  });
});

describe("the quality guard", () => {
  it("drops Full to Saver when Meta flags the number, tells the director and the admin by email, and does it once", async () => {
    await mode("full");
    await c.sql("delete from public.whatsapp_mode_log");
    expect((await c.one("select public.worker_whatsapp_signal($1, 'quality', '+234 803 000 0000', 'FLAGGED', null) as r", [token])).r).toBe(false);
    expect(await row()).toMatchObject({ mode: "saver", auto: true, changed_by: null });
    expect(await logKinds()).toEqual(["quality_drop"]);
    const mails = await alerts();
    expect(mails.map((m) => m.person_id).sort()).toEqual([c.director, c.admin].sort());
    expect(mails.every((m) => m.force_channel === "email")).toBe(true);
    await c.sql("select public.worker_whatsapp_signal($1, 'quality', '+234 803 000 0000', 'DOWNGRADE', null)", [token]);
    expect(await logKinds()).toEqual(["quality_drop"]);
  });

  it("does nothing in Free or Saver, when the guard is switched off, or when the mode is not On", async () => {
    await mode("free");
    await c.sql("select public.worker_whatsapp_signal($1, 'quality', 'n', 'FLAGGED', null)", [token]);
    expect((await row()).mode).toBe("free");
    await c.as(c.admin, "whatsapp_mode_set", "full", "Back to Full");
    await c.as(c.admin, "whatsapp_mode_settings", { qualityGuard: false });
    await c.sql("select public.worker_whatsapp_signal($1, 'quality', 'n', 'FLAGGED', null)", [token]);
    expect((await row()).mode).toBe("full");
    await c.reset();
    await c.sql("update public.whatsapp_mode set mode = 'full'");
    await c.sql("select public.worker_whatsapp_signal($1, 'quality', 'n', 'FLAGGED', null)", [token]);
    expect((await row()).mode).toBe("full");
    expect(await logKinds()).not.toContain("quality_drop");
  });

  it("pauses WhatsApp itself when a check reads the number as Low, and drops to Saver when it reads Medium", async () => {
    await mode("full");
    await healthOn();
    await c.as(c.admin, "whatsapp_check_save", { ok: true, items: [], facts: { quality: "YELLOW", limit: 1000 } });
    expect((await row()).mode).toBe("saver");
    await c.as(c.admin, "whatsapp_mode_set", "full", "Back to Full");
    await c.as(c.admin, "whatsapp_check_save", { ok: true, items: [], facts: { quality: "RED", limit: 1000 } });
    const g = await c.one("select paused, auto, reason from public.whatsapp_guard");
    expect(g).toMatchObject({ paused: true, auto: true });
    expect(g.reason).toContain("Low");
    expect(await logKinds()).toContain("quality_pause");
    expect((await c.one("select kind from public.whatsapp_guard_log order by id desc limit 1")).kind).toBe("auto_paused");
  });

  it("keeps the message types Meta filed as Marketing from a saved check, replacing the list each time", async () => {
    await mode("full");
    await healthOn();
    await c.as(c.admin, "whatsapp_check_save", { ok: true, items: [], facts: { marketing: ["week_start", "meeting_reminder"] } });
    expect((await c.sql("select template_key from public.whatsapp_marketing order by 1")).map((r) => r.template_key)).toEqual(["meeting_reminder", "week_start"]);
    await c.as(c.admin, "whatsapp_check_save", { ok: true, items: [], facts: { marketing: ["week_start"] } });
    expect((await c.sql("select template_key from public.whatsapp_marketing order by 1")).map((r) => r.template_key)).toEqual(["week_start"]);
    await c.as(c.admin, "whatsapp_check_save", { ok: true, items: [] });
    expect((await c.one("select count(*)::int n from public.whatsapp_marketing")).n).toBe(1);
  });

  it("takes a Marketing notice from Meta by message type, and clears it when the category goes back", async () => {
    expect((await c.one("select public.worker_whatsapp_marketing($1, 'week_start', true) as r", [token])).r).toBe(true);
    expect((await c.one("select count(*)::int n from public.whatsapp_marketing")).n).toBe(1);
    expect((await c.one("select public.worker_whatsapp_marketing($1, 'week_start', false) as r", [token])).r).toBe(true);
    expect((await c.one("select count(*)::int n from public.whatsapp_marketing")).n).toBe(0);
    expect((await c.one("select public.worker_whatsapp_marketing($1, 'Not a key!', true) as r", [token])).r).toBe(false);
    await expect(c.sql("select public.worker_whatsapp_marketing('wrong', 'week_start', true)")).rejects.toThrow();
  });
});

describe("the monthly ceiling", () => {
  /** n WhatsApp messages sent this month at the Utility rate of US$0.0101 */
  async function spent(n: number) {
    const who = await somebody(`Spender${Math.random()}`);
    for (let i = 0; i < n; i++) {
      const id = await queue(who, "week_start");
      await c.sql("update public.messages set status = 'delivered', channel = 'whatsapp', sent_at = now() where id = $1", [id]);
    }
  }

  it("estimates the month from the rates, matching a hand count", async () => {
    await mode("full");
    await spent(50);
    const est = (await c.one("select public.whatsapp_month_estimate() as e")).e as { sent: number; usd: number };
    expect(est.sent).toBe(50);
    expect(est.usd).toBe(0.51);
    await c.sql("insert into public.whatsapp_marketing (template_key) values ('week_start')");
    expect(((await c.one("select public.whatsapp_month_estimate() as e")).e as { usd: number }).usd).toBe(2.58);
  });

  it("warns at the warning percentage, once a month, and does not change the mode", async () => {
    await mode("full");
    await spent(100); // US$1.01
    await c.as(c.admin, "whatsapp_mode_settings", { ceilingUsd: 1.2 });
    const r = (await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t as { action: string };
    expect(r.action).toBe("warned");
    expect((await row()).mode).toBe("full");
    expect(await logKinds()).toContain("ceiling_warn");
    expect((await alerts()).length).toBe(2);
    const again = (await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t as { action?: string };
    expect(again.action).toBeUndefined();
    expect((await alerts()).length).toBe(2);
  });

  it("drops Full to Saver at the ceiling, once a month, and emails the director and the admin", async () => {
    await mode("full");
    await spent(100);
    await c.as(c.admin, "whatsapp_mode_settings", { ceilingUsd: 1 });
    const r = (await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t as { action: string; pct: number };
    expect(r).toMatchObject({ action: "saver" });
    expect(await row()).toMatchObject({ mode: "saver", auto: true });
    expect(await logKinds()).toContain("ceiling_drop");
    expect((await alerts()).length).toBe(2);
    // a person who then chooses Full again is not overruled until next month
    await c.as(c.admin, "whatsapp_mode_set", "full", "We have the budget this month");
    expect((await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t).not.toMatchObject({ action: "saver" });
    expect((await row()).mode).toBe("full");
  });

  it("never touches Saver or Free, never class A, and does nothing with no ceiling", async () => {
    await mode("saver");
    await spent(100);
    await c.as(c.admin, "whatsapp_mode_settings", { ceilingUsd: 1 });
    await c.sql("select public.worker_whatsapp_tick($1)", [token]);
    expect((await row()).mode).toBe("saver");
    const who = await somebody("Class A");
    expect(await channels(await queue(who, "swap_offered"))).toEqual(["whatsapp", "email"]);
    await c.as(c.admin, "whatsapp_mode_settings", { ceilingUsd: null });
    expect((await c.one("select public.worker_whatsapp_tick($1) as t", [token])).t).toEqual({ state: "no_ceiling" });
  });
});

describe("the pages for the office", () => {
  it("lets the admin, a director and the data lead change the mode with a reason, and nobody else", async () => {
    await guardOn();
    await c.set("whatsapp_mode", "on", { reason: REASON });
    const lead = await c.k.staff("Data", "data_lead");
    for (const who of [c.admin, c.director, lead.id]) {
      expect((await c.as(who, "whatsapp_mode_set", "saver", "Saving the weekly messages")).mode).toBe("saver");
    }
    await expectCode(c.as(c.pastor, "whatsapp_mode_set", "free", "I would like to"), "42501");
    await expectCode(c.as(c.member, "whatsapp_mode_set", "free", "I would like to"), "42501");
    await expectCode(c.anon("whatsapp_mode_set", "free", "Hello there"), "42501");
    await expectCode(c.as(c.admin, "whatsapp_mode_set", "turbo", "Not a mode really"), "22023");
    await expectCode(c.as(c.admin, "whatsapp_mode_set", "free", "no"), "22023");
    await expectCode(c.as(c.admin, "whatsapp_mode_set", "free", null), "22023");
    expect(await logKinds()).toEqual(["mode", "mode", "mode"]);
    expect((await c.one("select reason, by_person from public.whatsapp_mode_log order by id limit 1")).by_person).toBe(c.admin);
  });

  it("lets the office read the page, the pastor too, and nobody else", async () => {
    const view = await c.as(c.pastor, "whatsapp_mode_overview");
    expect(view).toMatchObject({ state: "off", guard: "off", chosen: "full", effective: "full", canChange: false });
    expect(Object.keys(view).sort()).toEqual(
      ["auto", "canChange", "changedAt", "changedBy", "chosen", "classes", "effective", "guard", "hand", "log", "marketing", "month", "paused", "rates", "reason", "settings", "state", "week"].sort(),
    );
    expect(view.classes).toHaveLength(62);
    expect((await c.as(c.admin, "whatsapp_mode_overview")).canChange).toBe(true);
    await expectCode(c.as(c.member, "whatsapp_mode_overview"), "42501");
    await expectCode(c.as(c.member, "whatsapp_cost_report"), "42501");
    await expectCode(c.anon("whatsapp_mode_overview"), "42501");
  });

  it("validates the numbers, keeps what is allowed and says what is not", async () => {
    await c.as(c.admin, "whatsapp_mode_settings", { pacePerHour: 120, reachPct: 70, weeklyCap: 3, windowFrom: 8, windowTo: 20, warnPct: 90, ceilingUsd: 250 });
    expect(await row()).toMatchObject({ pace_per_hour: 120, reach_pct: 70, weekly_cap: 3, window_from: 8, window_to: 20, warn_pct: 90 });
    expect(Number((await row()).ceiling_usd)).toBe(250);
    await expectCode(c.as(c.admin, "whatsapp_mode_settings", { pacePerHour: 5 }), "22023");
    await expectCode(c.as(c.admin, "whatsapp_mode_settings", { windowFrom: 20, windowTo: 8 }), "22023");
    await expectCode(c.as(c.admin, "whatsapp_mode_settings", { ceilingUsd: -1 }), "22023");
    await expectCode(c.as(c.admin, "whatsapp_mode_settings", { nonsense: 1 }), "22023");
    await expectCode(c.as(c.pastor, "whatsapp_mode_settings", { pacePerHour: 100 }), "42501");
    expect((await row()).pace_per_hour).toBe(120);
  });

  it("changes a class and enters a rate, with a log of each, and the newest rate in force is the one used", async () => {
    await c.as(c.director, "whatsapp_class_set", "friday_checkin", "A");
    expect((await c.one("select public.whatsapp_class('friday_checkin') as c")).c).toBe("A");
    await expectCode(c.as(c.director, "whatsapp_class_set", "friday_checkin", "Z"), "22023");
    await expectCode(c.as(c.director, "whatsapp_class_set", "no_such_message", "A"), "22023");
    await c.as(c.director, "whatsapp_rate_add", "utility", 0.02, "2020-01-01", "Rate card");
    expect(Number((await c.one("select public.whatsapp_rate('utility') as r")).r)).toBeCloseTo(0.0101, 4);
    await c.as(c.director, "whatsapp_rate_add", "utility", 0.02, "2026-11-02", "Rate card, November");
    expect(Number((await c.one("select public.whatsapp_rate('utility') as r")).r)).toBeCloseTo(0.02, 4);
    await expectCode(c.as(c.director, "whatsapp_rate_add", "gold", 0.02, "2026-11-02", null), "22023");
    await expectCode(c.as(c.pastor, "whatsapp_rate_add", "utility", 0.02, "2026-11-02", null), "42501");
    expect(await logKinds()).toEqual(["class", "rate", "rate"]);
  });

  it("reports the cost by message type with the saving Saver would make, as an estimate", async () => {
    const a = await somebody("Cost A");
    await wentBy(a, 3, "week_start");
    await wentBy(a, 2, "swap_offered");
    await wentBy(a, 1, "application_received");
    await c.sql("insert into public.whatsapp_marketing (template_key) values ('application_received')");
    const r = await c.as(c.admin, "whatsapp_cost_report");
    expect(r.sum).toMatchObject({ n7: 6, n30: 6, marketing30: 1, saverN30: 4 });
    expect(r.sum.usd30).toBeCloseTo(5 * 0.0101 + 0.0516, 2);
    expect(r.sum.saver30).toBeCloseTo(3 * 0.0101 + 0.0516, 2);
    expect(r.templates[0]).toMatchObject({ template: "week_start", class: "B", n30: 3, marketing: false });
    expect(r.rates).toEqual({ utility: 0.0101, marketing: 0.0516 });
    await expectCode(c.as(c.member, "whatsapp_cost_report"), "42501");
  });

  it("shows, from the last seven days, what each class would have moved", async () => {
    const a = await somebody("Week");
    await wentBy(a, 4, "week_start");
    await wentBy(a, 1, "swap_offered");
    const v = await c.as(c.admin, "whatsapp_mode_overview");
    expect(v.week).toMatchObject({ a: 1, b: 4, c: 0, total: 5 });
    expect(v.week.usdBC).toBeCloseTo(4 * 0.0101, 2);
  });
});

describe("WhatsApp sent by people", () => {
  const lead = () => c.seasoned.id;
  const tribe = () => c.seasoned.tribe;

  async function agree(person: string, number = true) {
    phoneN += 1;
    if (number) await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp') on conflict (person_id) do update set phone = $2", [person, `+2348033${String(100000 + phoneN)}`]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [person]);
  }

  it("shows a leader their own members with who can be messaged, and never a number", async () => {
    await agree(c.seasoned.members[0]);
    const v = await c.as(lead(), "hand_context", tribe());
    expect(v.tribe.id).toBe(tribe());
    expect(v.members.map((m: { person: string }) => m.person).sort()).toEqual([...c.seasoned.members].sort());
    const first = v.members.find((m: { person: string }) => m.person === c.seasoned.members[0]);
    expect(first).toMatchObject({ wa: true, open: true });
    expect(v.members.find((m: { person: string }) => m.person === c.seasoned.members[1])).toMatchObject({ wa: false });
    expect(JSON.stringify(v)).not.toMatch(/\+234803/);
    expect(v.free).toBe(false);
  });

  it("refuses a leader of another tribe, a plain member and a visitor", async () => {
    await expectCode(c.as(c.appointed.id, "hand_context", tribe()), "42501");
    await expectCode(c.as(c.member, "hand_context", tribe()), "42501");
    await expectCode(c.anon("hand_context", tribe()), "42501");
    await expectCode(c.as(c.member, "hand_open", c.seasoned.members[0], tribe(), "welcome"), "42501");
    await expectCode(c.as(c.member, "hand_group", tribe(), "week_start"), "42501");
  });

  it("opens a chat for a member who said yes, logs it, and lets the leader mark it sent or left", async () => {
    await agree(c.seasoned.members[0]);
    const open = await c.as(lead(), "hand_open", c.seasoned.members[0], tribe(), "missed_two");
    expect(open.phone).toMatch(/^\+2348033/);
    expect(open.first).toBeTruthy();
    expect(await c.one("select outcome, scope, kind from public.whatsapp_hand_log where id = $1", [open.log])).toMatchObject({ outcome: "opened", scope: "person", kind: "missed_two" });
    expect(await c.as(lead(), "hand_mark", open.log, "sent")).toBe(true);
    expect((await c.one("select outcome from public.whatsapp_hand_log where id = $1", [open.log])).outcome).toBe("sent");
    // only your own line
    expect(await c.as(c.admin, "hand_mark", open.log, "skipped")).toBe(false);
    await expectCode(c.as(lead(), "hand_mark", open.log, "maybe"), "22023");
    const ctx = await c.as(lead(), "hand_context", tribe());
    expect(ctx.recent[0]).toMatchObject({ scope: "person", kind: "missed_two", outcome: "sent" });
  });

  it("refuses a member who did not say yes to WhatsApp, a member with no number, someone not in the tribe, and a bad kind", async () => {
    await expectCode(c.as(lead(), "hand_open", c.seasoned.members[1], tribe(), "welcome"), "42501");
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [c.seasoned.members[1]]);
    await expectCode(c.as(lead(), "hand_open", c.seasoned.members[1], tribe(), "welcome"), "42501");
    await agree(c.member);
    await expectCode(c.as(lead(), "hand_open", c.member, tribe(), "welcome"), "42501");
    await expectCode(c.as(lead(), "hand_open", c.seasoned.members[0], tribe(), "Not Good!"), "22023");
    expect((await c.one("select count(*)::int n from public.whatsapp_hand_log")).n).toBe(0);
  });

  it("does not open a church-placed member's number while it is held back from the leader", async () => {
    const m = c.seasoned.members[0];
    await agree(m);
    const run = (await c.one("select id from public.placement_runs limit 1"))?.id as string | undefined;
    if (!run) return;
    await c.sql("update public.tribe_members set placement_source = 'auto', placed_by_run = $2, contact_withheld = true where person_id = $1", [m, run]);
    const v = await c.as(lead(), "hand_context", tribe());
    expect(v.members.find((x: { person: string }) => x.person === m)).toMatchObject({ open: false });
    await expectCode(c.as(lead(), "hand_open", m, tribe(), "welcome"), "42501");
    // the office sees what it always saw
    expect((await c.as(c.admin, "hand_open", m, tribe(), "welcome")).phone).toBeTruthy();
  });

  it("logs a post to the tribe's group and gives the leader the group's address, only for a text kind it knows", async () => {
    await c.sql("update public.tribes set whatsapp_group_url = 'https://chat.whatsapp.com/ABCDEFGH12' where id = $1", [tribe()]);
    const g = await c.as(lead(), "hand_group", tribe(), "week_start");
    expect(g.groupUrl).toBe("https://chat.whatsapp.com/ABCDEFGH12");
    expect(await c.one("select scope, kind, person_id from public.whatsapp_hand_log where id = $1", [g.log])).toMatchObject({ scope: "group", kind: "week_start", person_id: null });
    await expectCode(c.as(lead(), "hand_group", tribe(), "everything"), "22023");
  });

  it("lists the members Free mode left without a message, by first name, so the leader can write to them", async () => {
    await mode("free");
    const only = c.seasoned.members[0];
    await agree(only);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'test')", [only]);
    const id = await queue(only, "week_start", ", null, 'urgent'");
    await c.sql("select public.worker_claim($1, 50)", [token]);
    expect((await c.one("select error from public.messages where id = $1", [id])).error).toBe("WhatsApp is in Free mode: send this one by hand");
    const v = await c.as(lead(), "hand_context", tribe());
    expect(v.free).toBe(true);
    expect(v.unsent).toHaveLength(1);
    expect(v.members.find((m: { person: string }) => m.person === only)).toMatchObject({ onlyWa: true });
  });

  it("lets the office message a leader, a coach or an assistant by hand who said yes, and nobody else", async () => {
    await agree(lead());
    const list = await c.as(c.admin, "hand_staff_list");
    expect(list.people.map((p: { person: string }) => p.person)).toContain(lead());
    expect(list.people.map((p: { person: string }) => p.person)).not.toContain(c.member);
    expect(JSON.stringify(list)).not.toMatch(/\+234803/);
    const open = await c.as(c.admin, "hand_open", lead(), null, "leader_note");
    expect(open.phone).toMatch(/^\+2348033/);
    await expectCode(c.as(c.admin, "hand_open", c.seasoned.members[0], null, "leader_note"), "42501");
    await expectCode(c.as(lead(), "hand_open", lead(), null, "leader_note"), "42501");
    await expectCode(c.as(c.member, "hand_staff_list"), "42501");
    await expectCode(c.as(lead(), "hand_staff_list"), "42501");
    const after = await c.as(c.admin, "hand_staff_list");
    expect(after.recent[0]).toMatchObject({ kind: "leader_note", outcome: "opened" });
  });

  it("shows the office how much was done by hand this week", async () => {
    await agree(c.seasoned.members[0]);
    const open = await c.as(lead(), "hand_open", c.seasoned.members[0], tribe(), "welcome");
    await c.as(lead(), "hand_mark", open.log, "sent");
    await c.as(lead(), "hand_group", tribe(), "week_start");
    expect((await c.as(c.admin, "whatsapp_mode_overview")).hand).toEqual({ opened: 2, sent: 1, skipped: 0 });
  });
});

describe("who may call what", () => {
  it("keeps the internal helpers closed to every client", async () => {
    for (const [fn, args] of [
      ["whatsapp_mode_now", []],
      ["whatsapp_class", ["week_start"]],
      ["whatsapp_pressure", [c.member]],
      ["whatsapp_mode_quality", ["low", "x"]],
      ["hand_can", [c.member]],
    ] as [string, unknown[]][]) {
      await expectCode(c.as(c.admin, fn, ...args), "42501");
    }
  });

  it("makes the sending service's three calls need the token", async () => {
    await expect(c.sql("select public.worker_whatsapp_tick('nope')")).rejects.toThrow();
    await expect(c.sql("select public.worker_whatsapp_allowed('nope')")).rejects.toThrow();
  });
});

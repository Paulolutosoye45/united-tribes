import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// Profiles and the Weekly Rhythm, stage 1: the Details Check. What these prove:
//   * only the owner can ask; a Rehearsal writes what would be sent and sends nothing, mints no link and records nothing a person's record shows
//   * a live run sends one message to each person who would be asked, which carries no personal fact, and a private link whose raw value is kept
//     only in the message until it is sent (the database holds its fingerprint)
//   * people who are left out are counted by reason and never named: under 18, already confirmed, already asked, messages off, no way to reach
//   * a link answers for one person; someone else's link says nothing about whose it is; a link ends, stops when the run is stopped, and says
//     nothing while the function is Off or paused
//   * with no account, a six-digit code opens a short sign-in: ten minutes, five tries, a lock for half an hour, never sent by WhatsApp
//   * the heartbeat reminds once by the other channel, asks the coach (or a director) once, and forgets links and codes when they have done their work
//   * the office sees where each person stands and never what they answered

let c: Cast;
let token: string;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const aud = (...people: string[]) => ({ kind: "list", people });
const ask = (audience: unknown, facts: string[] = ["life_stage"], mode = "live") => c.o.call("god_details_send", JSON.stringify(audience), facts, mode);
const plan = (audience: unknown, facts: string[] = ["life_stage"], mode = "live") => c.o.call("god_details_plan", JSON.stringify(audience), facts, mode);
const link = async (person: string, template = "details_check_request") =>
  (await c.one("select reply_token from public.messages where person_id = $1 and template = $2 order by created_at desc limit 1", [person, template])).reply_token as string;
const latestCode = async (person: string) => (await c.one("select params ->> 'code' as code from public.messages where person_id = $1 and template = 'details_check_code' order by created_at desc limit 1", [person])).code as string;
const worker = (fn: string, ...args: unknown[]) => c.db.asAnon((q) => q(`select public.${fn}(${["$1", ...args.map((_, i) => `$${i + 2}`)].join(", ")}) as r`, [token, ...args])).then((r) => r.rows[0].r);
const item = (person: string) => c.one("select i.* from public.details_check_items i where i.person_id = $1 order by i.created_at desc limit 1", [person]);
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
let n = 0;
/** A fresh appointed leader, asked once, with a link in hand. */
async function asked(name = "Lead") {
  await c.open();
  const a = await c.appoint(`${name}${++n}`);
  const r = await ask(aud(a.id));
  expect(r.asked).toBe(1);
  return { ...a, link: await link(a.id), check: r.check as string };
}

beforeAll(async () => {
  c = await makeCast();
  await c.noticesOn();
  token = (await c.one("select public.bootstrap_worker_token('details') as t")).t as string;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

describe("only the owner asks, and only the sending service answers for a visitor", () => {
  it("refuses every other role the whole console, and a visitor", async () => {
    await c.open();
    for (const who of [c.admin, c.director, c.pastor, c.appointed.id, c.member]) {
      for (const [fn, args] of [
        ["god_details_plan", [JSON.stringify({ kind: "appointed" }), ["life_stage"], "live"]],
        ["god_details_send", [JSON.stringify({ kind: "appointed" }), ["life_stage"], "live"]],
        ["god_details_checks", []],
        ["god_details_status", [NOBODY]],
        ["god_details_close", [NOBODY]],
      ] as const) expect(await code(c.as(who, fn, ...args)), `${fn}`).toBe("42501");
    }
    await expectCode(c.db.asAnon((q) => q("select public.god_details_checks()")), "42501");
    expect((await c.one("select count(*)::int n from public.details_checks")).n).toBe(0);
  });

  it("gives a visitor nothing without the sending token, and a signed-in person nothing of the visitor's door", async () => {
    for (const bad of ["x".repeat(40), "short"]) {
      for (const fn of ["worker_details_info", "worker_details_code_send", "worker_details_tick"]) {
        const args = fn === "worker_details_tick" ? [bad] : [bad, "a".repeat(64)];
        await expectCode(c.db.asAnon((q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
      }
    }
    await expectCode(c.db.asAnon((q) => q("select public.worker_details_tick(null)")), "42501");
    for (const fn of ["worker_details_info(text, text, text)", "worker_details_tick(text)", "worker_details_answer(text, text, text, text, text, text)"]) {
      expect((await c.one(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as ok`)).ok, fn).toBe(false);
    }
    for (const fn of ["details_check_info(text)", "details_check_answer(text, text, text, text)"]) {
      expect((await c.one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as ok`)).ok, fn).toBe(false);
      expect((await c.one(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as ok`)).ok, fn).toBe(true);
    }
  });
});

describe("who would be asked, and who is left out and why", () => {
  it("takes one to three facts that the church holds, and a real audience", async () => {
    await c.open();
    await expect(plan({ kind: "appointed" }, [])).rejects.toThrow(/between one and three facts/);
    await expect(plan({ kind: "appointed" }, ["life_stage", "age_range", "x", "y"])).rejects.toThrow(/between one and three facts/);
    await expect(plan({ kind: "appointed" }, ["favourite_colour"])).rejects.toThrow(/not a fact we hold/);
    await expect(plan({ kind: "everyone" })).rejects.toThrow(/Choose who to ask/);
    await expect(plan({ kind: "appointed" }, ["life_stage"], "maybe")).rejects.toThrow(/Rehearsal or live/);
    expect(await plan({ kind: "tribe", tribe: NOBODY })).toEqual({ asked: 0, leftOut: {}, facts: ["life_stage"] });
  });

  it("counts the leaders the office appointed, then all leaders, and leaves out those who have confirmed", async () => {
    await c.open();
    const appointed = await plan({ kind: "appointed" });
    expect(appointed).toEqual({ asked: 1, leftOut: {}, facts: ["life_stage"] });
    const leaders = await plan({ kind: "leaders" });
    expect(leaders).toEqual({ asked: 2, leftOut: {}, facts: ["life_stage"] });
    await c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null);
    expect(await plan({ kind: "appointed" })).toEqual({ asked: 0, leftOut: { already_confirmed: 1 }, facts: ["life_stage"] });
    expect(await plan({ kind: "leaders" })).toEqual({ asked: 1, leftOut: { already_confirmed: 1 }, facts: ["life_stage"] });
    expect(await plan({ kind: "unconfirmed" })).toEqual({ asked: 1, leftOut: { already_confirmed: 1 }, facts: ["life_stage"] });
    expect(await plan({ kind: "tribe", tribe: c.seasoned.tribe })).toMatchObject({ asked: 1 });
    await c.db.admin.query("delete from public.profile_facts where person_id = $1", [c.appointed.id]);
  });

  it("never asks the owner, someone hidden, a person with nothing recorded, or a young person", async () => {
    await c.open();
    const hidden = await c.appoint("Hidden");
    await c.db.admin.query("update public.people set hidden = true where id = $1", [hidden.id]);
    const none = await c.k.staff("Nothing", "leader");
    const young = await c.appoint("Young");
    await c.db.admin.query("insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, token_hash, token_expires_at) values ($1, 'Parent Name', 'mother', 'parent@example.org', $2, now() + interval '7 days')", [young.id, sha(`young-${young.id}`)]);
    const r = await plan(aud(hidden.id, c.o.owner.id, none.id, young.id));
    // the hidden person and the owner are not counted anywhere, not even as left out
    expect(r).toEqual({ asked: 0, leftOut: { no_fact: 1, under_18: 1 }, facts: ["life_stage"] });
    await c.db.admin.query("update public.people set hidden = false where id = $1", [hidden.id]);
    await c.db.admin.query("delete from public.guardian_consents where person_id = $1", [young.id]);
  });

  it("leaves out people the function is not On for, those with messages off, and those nobody can reach", async () => {
    await c.reset();
    const a = await c.appoint("Reach");
    const b = await c.appoint("Opted");
    const d = await c.appoint("Lost");
    await c.set("my_page", "on", { scope: "person", id: a.id });
    await c.set("details_check", "on", { scope: "person", id: a.id });
    expect(await plan(aud(a.id, b.id))).toEqual({ asked: 1, leftOut: { switch_off: 1 }, facts: ["life_stage"] });
    await c.open();
    await c.db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'test')", [b.id]);
    expect(await plan(aud(b.id))).toEqual({ asked: 0, leftOut: { messages_off: 1 }, facts: ["life_stage"] });
    await c.db.admin.query("update public.people set email = 'not-an-address' where id = $1", [d.id]);
    expect(await plan(aud(d.id))).toEqual({ asked: 0, leftOut: { no_channel: 1 }, facts: ["life_stage"] });
    await expect(ask(aud(b.id, d.id))).rejects.toThrow(/Nobody would be asked/);
    await c.db.admin.query("update public.people set email = $2 where id = $1", [d.id, `${d.id.slice(0, 8)}@example.org`]);
  });

  it("caps a run at two thousand people", async () => {
    await expect(plan({ kind: "list", people: Array.from({ length: 2001 }, () => randomUUID()) })).rejects.toThrow(/more than 2,000/);
  });
});

describe("a Rehearsal writes what would be sent, and sends nothing", () => {
  it("runs while the function is only in Rehearsal, makes no message and no link, and changes no one's record", async () => {
    await c.reset();
    await c.set("my_page", "rehearsal");
    await c.set("details_check", "rehearsal");
    const a = await c.appoint("Rehearse");
    const before = (await c.one("select (select count(*) from public.messages)::int m, (select count(*) from public.details_check_tokens)::int t, (select count(*) from public.profile_fact_history)::int h, (select count(*) from public.profile_facts)::int f")) as Record<string, number>;
    expect(await plan(aud(a.id), ["life_stage"], "rehearsal")).toMatchObject({ asked: 1 });
    expect(await plan(aud(a.id), ["life_stage"], "live")).toEqual({ asked: 0, leftOut: { switch_off: 1 }, facts: ["life_stage"] });
    await expect(ask(aud(a.id), ["life_stage"], "live")).rejects.toThrow(/Nobody would be asked/);
    const r = await ask(aud(a.id), ["life_stage"], "rehearsal");
    expect(r).toMatchObject({ ok: true, asked: 1, mode: "rehearsal" });
    const it = await item(a.id);
    expect(it).toMatchObject({ status: "rehearsal", message_id: null });
    expect(it.would_send).toMatch(/^Email: "Hello Rehearse\d+, please check the details we hold for your tribe\. It takes under a minute\." with a private link$/);
    expect(it.would_send).not.toMatch(/builders|Builders|26 to 40|https?:/);
    const after = (await c.one("select (select count(*) from public.messages)::int m, (select count(*) from public.details_check_tokens)::int t, (select count(*) from public.profile_fact_history)::int h, (select count(*) from public.profile_facts)::int f")) as Record<string, number>;
    expect(after).toEqual(before);
    expect((await c.o.call("god_details_checks"))[0]).toMatchObject({ mode: "rehearsal", asked: 1, counts: { rehearsal: 1 } });
  });

  it("opens no link: there is nothing to open, and a made-up one says nothing", async () => {
    const a = await c.one("select person_id from public.details_check_items i join public.details_checks k on k.id = i.check_id where k.mode = 'rehearsal' limit 1");
    expect((await c.as(a.person_id, "details_check_info", "a".repeat(64))).found).toBe(false);
  });

  it("says in words which way each person would have been reached, and the status shows it", async () => {
    const run = (await c.o.call("god_details_checks"))[0];
    const status = await c.o.call("god_details_status", run.id);
    expect(status.people).toHaveLength(1);
    expect(status.people[0]).toMatchObject({ status: "rehearsal", sent: false, channel: null, opened: false, reminded: false });
    expect(status.people[0].wouldSend).toMatch(/^Email: /);
  });
});

describe("a live run", () => {
  let a: { id: string; tribe: string; link: string; check: string };

  it("sends one message to each person asked, with no personal fact in it, by the platform's usual rules", async () => {
    a = await asked("Sent");
    const msgs = await c.sql("select template, params, force_channel, status, dedupe_key, urgency from public.messages where person_id = $1", [a.id]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ template: "details_check_request", params: { facts: 1 }, force_channel: null, status: "queued", urgency: "normal" });
    expect(Object.keys(msgs[0].params)).toEqual(["facts"]);
    expect(JSON.stringify(msgs[0])).not.toMatch(/builders|Builders|stage|26 to 40/);
    expect(msgs[0].dedupe_key).toMatch(/^details-check:[0-9a-f-]{36}:request$/);
  });

  it("keeps the link in the message and only its fingerprint in the database", async () => {
    expect(a.link).toMatch(/^[a-f0-9]{64}$/);
    const t = await c.sql("select token_hash, expires_at > now() + interval '13 days' as long from public.details_check_tokens where item_id = (select id from public.details_check_items where person_id = $1)", [a.id]);
    expect(t).toEqual([{ token_hash: sha(a.link), long: true }]);
    for (const [table, column] of [["details_check_tokens", "token_hash"], ["details_check_access", "session_hash"]] as const) {
      expect((await c.one(`select count(*)::int n from public.${table} where ${column} = $1`, [a.link])).n, table).toBe(0);
    }
    expect((await c.one("select count(*)::int n from public.details_check_items i where i.id::text = $1 or i.would_send like '%' || $1 || '%'", [a.link])).n).toBe(0);
  });

  it("sets the day-three reminder and the day-seven call, and writes who proposed the value", async () => {
    const it = await item(a.id);
    expect(it.status).toBe("queued");
    const gaps = await c.one("select round(extract(epoch from (remind_at - created_at)) / 86400)::int r, round(extract(epoch from (escalate_at - created_at)) / 86400)::int e from public.details_check_items where id = $1", [it.id]);
    expect(gaps).toEqual({ r: 3, e: 7 });
    const h = await c.sql("select event, new_value, by_kind, via, note from public.profile_fact_history where person_id = $1", [a.id]);
    expect(h).toEqual([{ event: "proposed", new_value: "builders", by_kind: "office", via: "appointment", note: "The value came from the church office, not from the person" }]);
    expect((await c.one("select count(*)::int n from public.event_log where action = 'details.sent'")).n).toBeGreaterThanOrEqual(1);
  });

  it("does not ask the same person again while an ask is open, and counts them as already asked", async () => {
    expect(await plan(aud(a.id))).toEqual({ asked: 0, leftOut: { already_asked: 1 }, facts: ["life_stage"] });
    await expect(ask(aud(a.id))).rejects.toThrow(/Nobody would be asked/);
  });

  it("lets the owner see where each person stands and never what they answered", async () => {
    const run = await c.o.call("god_details_status", a.check);
    expect(run).toMatchObject({ mode: "live", asked: 1, audience: "list", closed: false, corrected: 0 });
    expect(run.people).toHaveLength(1);
    expect(Object.keys(run.people[0]).sort()).toEqual(["asked", "at", "channel", "id", "name", "opened", "reminded", "sent", "status", "wouldSend"]);
    expect(run.people[0]).toMatchObject({ status: "queued", sent: false, opened: false });
    expect(JSON.stringify(run)).not.toMatch(/builders|Builders|rising|stewards/);
    expect((await c.o.call("god_details_checks"))[0]).toMatchObject({ audience: "list", facts: ["life_stage"], counts: { queued: 1 } });
    await expectCode(c.o.call("god_details_status", NOBODY), "P0002");
  });
});

describe("one tap, when signed in", () => {
  it("asks the signed-in person the one question, in words, with the real choices", async () => {
    const a = await asked();
    const info = await c.as(a.id, "details_check_info", a.link);
    expect(info).toMatchObject({ found: true, done: false, key: "life_stage", label: "Stage of life", valueLabel: "26 to 40, the Builders stage", left: 1 });
    expect(info.question).toBe("We have you down as 26 to 40, the Builders stage. Is that right?");
    expect(info.first).toMatch(/^Lead\d+$/);
    expect(info.options.map((o: { value: string }) => o.value)).toEqual(["rising", "builders", "stewards", "sages"]);
    expect((await item(a.id)).opened_at).not.toBeNull();
  });

  it("says nothing about whose a link is when it is someone else's, or made up, or malformed", async () => {
    const a = await asked();
    expect(await c.as(c.seasoned.id, "details_check_info", a.link)).toEqual({ found: false, reason: "other_account" });
    expect(await c.as(a.id, "details_check_info", "f".repeat(64))).toEqual({ found: false });
    expect(await c.as(a.id, "details_check_info", a.link.toUpperCase())).toEqual({ found: false });
    expect(await c.as(a.id, "details_check_info", "short")).toEqual({ found: false });
    expect(await c.as(c.seasoned.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: false, reason: "invalid" });
    expect((await item(a.id)).status).toBe("queued");
  });

  it("takes the answer, settles the item, and does not take a second one", async () => {
    const a = await asked();
    expect(await c.as(a.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
    expect(await item(a.id)).toMatchObject({ status: "confirmed", answers: { life_stage: "confirmed" } });
    expect((await item(a.id)).answered_at).not.toBeNull();
    expect(await c.as(a.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: false, reason: "not_asked" });
    expect(await c.as(a.id, "details_check_info", a.link)).toMatchObject({ found: true, done: true, waiting: false });
    expect(await c.as(a.id, "details_check_answer", a.link, "age_range", "yes", null)).toEqual({ ok: false, reason: "not_asked" });
    const h = await c.sql("select event, via from public.profile_fact_history where person_id = $1 order by id", [a.id]);
    expect(h).toEqual([{ event: "proposed", via: "appointment" }, { event: "confirmed", via: "details_check" }]);
  });

  it("corrects at once when the leader's card is not approved and nobody has joined, and the office sees only that it was corrected", async () => {
    const a = await asked();
    const r = await c.as(a.id, "details_check_answer", a.link, "life_stage", "change", "rising");
    expect(r).toMatchObject({ ok: true, outcome: "applied_now" });
    expect((await c.one("select k.slug from public.tribes t join public.tracks k on k.id = t.track_id where t.id = $1", [a.tribe])).slug).toBe("rising");
    expect(await item(a.id)).toMatchObject({ status: "changed" });
    const status = await c.o.call("god_details_status", a.check);
    expect(status.corrected).toBe(1);
    expect(status.people[0].status).toBe("changed");
    expect(JSON.stringify(status)).not.toMatch(/rising|Rising|builders|Builders/);
  });

  it("sends a change that touches others to a pastor, and the item says so", async () => {
    await c.open();
    const r = await ask(aud(c.seasoned.id));
    expect(r.asked).toBe(1);
    const l = await link(c.seasoned.id);
    const ans = await c.as(c.seasoned.id, "details_check_answer", l, "life_stage", "change", "sages");
    expect(ans).toMatchObject({ ok: true, outcome: "pending_review" });
    expect(await item(c.seasoned.id)).toMatchObject({ status: "pending_review" });
    expect(await c.as(c.seasoned.id, "details_check_info", l)).toMatchObject({ found: true, done: true, waiting: true });
    await c.as(c.pastor, "stage_review_decide", ans.change, false, "Please keep the card as it is for this season");
    await c.db.admin.query("delete from public.profile_changes");
  });

  it("records 'not me' and 'later' without changing anything, and a later answer is asked again after a few days", async () => {
    const a = await asked();
    const r = await c.as(a.id, "details_check_answer", a.link, "life_stage", "later", null);
    expect(r).toEqual({ ok: true, outcome: "later" });
    const it = await c.one("select status, snoozed_until > now() + interval '2 days' as snoozed, remind_at > now() + interval '5 days' as remind, escalate_at > now() + interval '9 days' as esc from public.details_check_items where person_id = $1", [a.id]);
    expect(it).toEqual({ status: "later", snoozed: true, remind: true, esc: true });
    const b = await asked();
    expect(await c.as(b.id, "details_check_answer", b.link, "life_stage", "not_me", null)).toEqual({ ok: true, outcome: "not_me" });
    expect((await item(b.id)).status).toBe("not_me");
    expect((await c.one("select value from public.profile_facts where person_id = $1 and key = 'life_stage'", [b.id]).catch(() => undefined))).toBeUndefined();
    expect((await c.sql("select event from public.profile_fact_history where person_id = $1 order by id", [b.id])).map((h) => h.event)).toEqual(["proposed", "not_me"]);
  });

  it("stops saying anything the moment the function is switched Off or paused", async () => {
    const a = await asked();
    // the hold on the Tribe Card leans on this function, so it is let go first
    await c.set("hold_card", "off");
    await c.set("details_check", "off");
    expect(await c.as(a.id, "details_check_info", a.link)).toEqual({ found: false });
    await c.set("details_check", "on", { reason: "Back on, for everyone" });
    expect(await c.as(a.id, "details_check_info", a.link)).toMatchObject({ found: true, done: false });
    await c.o.call("god_feature_master", true, "A pause");
    expect(await c.as(a.id, "details_check_info", a.link)).toEqual({ found: false });
    expect(await c.as(a.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: false, reason: "invalid" });
    await c.o.call("god_feature_master", false, null);
    expect(await c.as(a.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
  });

  it("stops a run: links stop opening, what has not gone out is not sent, and what people answered stays", async () => {
    const a = await asked();
    const b = await asked("Done");
    await c.as(b.id, "details_check_answer", b.link, "life_stage", "yes", null);
    expect(await c.o.call("god_details_close", a.check)).toEqual({ ok: true, changed: true });
    expect(await c.o.call("god_details_close", a.check)).toEqual({ ok: true, changed: false });
    expect(await c.as(a.id, "details_check_info", a.link)).toEqual({ found: false });
    expect(await item(a.id)).toMatchObject({ status: "closed" });
    expect((await c.one("select status, reply_token, error from public.messages where person_id = $1 and template = 'details_check_request'", [a.id]))).toEqual({ status: "skipped", reply_token: null, error: "The run was stopped" });
    expect((await c.one("select count(*)::int n from public.details_check_tokens where item_id = $1", [(await item(a.id)).id])).n).toBe(0);
    expect(await item(b.id)).toMatchObject({ status: "confirmed" });
    expect((await c.o.call("god_details_checks")).find((r: { id: string }) => r.id === a.check)).toMatchObject({ closed: true });
  });

  it("ends a link after fourteen days", async () => {
    const a = await asked();
    await c.db.admin.query("update public.details_check_tokens set expires_at = now() - interval '1 minute' where item_id = (select id from public.details_check_items where person_id = $1)", [a.id]);
    expect(await c.as(a.id, "details_check_info", a.link)).toEqual({ found: false });
  });
});

describe("with no account: the code", () => {
  it("asks for a code first, and tells the visitor nothing else", async () => {
    const a = await asked();
    expect(await worker("worker_details_info", a.link, null)).toEqual({ found: true, needsCode: true });
    expect(await worker("worker_details_info", "e".repeat(64), null)).toEqual({ found: false });
    expect(await worker("worker_details_info", "nonsense", null)).toEqual({ found: false });
    expect(await worker("worker_details_answer", a.link, null, "life_stage", "yes", null)).toEqual({ ok: false, reason: "invalid" });
    expect(await worker("worker_details_answer", a.link, "f".repeat(64), "life_stage", "yes", null)).toEqual({ ok: false, reason: "invalid" });
    expect((await item(a.id)).status).toBe("queued");
  });

  it("sends a six-digit code by email, never by WhatsApp, and does not hand it back", async () => {
    const a = await asked();
    await c.db.admin.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031234567', 'whatsapp') on conflict (person_id) do update set phone = '+2348031234567', preferred = 'whatsapp'", [a.id]);
    await c.db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [a.id]);
    const sent = await worker("worker_details_code_send", a.link);
    expect(sent.ok).toBe(true);
    expect(sent.via).toBe("email");
    expect(sent.to).toMatch(/^.\*\*\*@example\.org$/);
    expect(JSON.stringify(sent)).not.toMatch(/\d{6}/);
    const m = await c.one("select template, force_channel, urgency, params from public.messages where person_id = $1 and template = 'details_check_code'", [a.id]);
    expect(m).toMatchObject({ template: "details_check_code", force_channel: "email", urgency: "urgent", params: { minutes: 10 } });
    expect(m.params.code).toMatch(/^\d{6}$/);
    // and the usual request still goes by the person's usual way
    expect((await c.one("select force_channel from public.messages where person_id = $1 and template = 'details_check_request'", [a.id])).force_channel).toBeNull();
    const acc = await c.one("select code_hash, code_salt, code_expires_at > now() + interval '9 minutes' as ten from public.details_check_access where item_id = $1", [(await item(a.id)).id]);
    expect(acc.ten).toBe(true);
    expect(acc.code_hash).toBe(sha(`${acc.code_salt}${m.params.code}`));
    expect(JSON.stringify(acc)).not.toContain(m.params.code);
  });

  it("opens a short sign-in with the right code, for that link only, for three hours", async () => {
    const a = await asked();
    const b = await asked();
    await worker("worker_details_code_send", a.link);
    const good = await worker("worker_details_code_check", a.link, await latestCode(a.id));
    expect(good.ok).toBe(true);
    expect(good.session).toMatch(/^[a-f0-9]{64}$/);
    const info = await worker("worker_details_info", a.link, good.session);
    expect(info).toMatchObject({ found: true, done: false, key: "life_stage", valueLabel: "26 to 40, the Builders stage" });
    expect(await worker("worker_details_info", b.link, good.session)).toEqual({ found: true, needsCode: true });
    expect(await worker("worker_details_answer", b.link, good.session, "life_stage", "yes", null)).toEqual({ ok: false, reason: "invalid" });
    // the code works once
    expect(await worker("worker_details_code_check", a.link, await latestCode(a.id))).toMatchObject({ ok: false, reason: "expired" });
    // the answer
    expect(await worker("worker_details_answer", a.link, good.session, "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
    expect((await item(a.id)).status).toBe("confirmed");
    expect(await worker("worker_details_answer", a.link, good.session, "life_stage", "yes", null)).toEqual({ ok: false, reason: "not_asked" });
    // three hours, no more
    const c2 = await asked();
    await worker("worker_details_code_send", c2.link);
    const s2 = await worker("worker_details_code_check", c2.link, await latestCode(c2.id));
    await c.db.admin.query("update public.details_check_access set session_expires_at = now() - interval '1 minute' where item_id = $1", [(await item(c2.id)).id]);
    expect(await worker("worker_details_info", c2.link, s2.session)).toEqual({ found: true, needsCode: true });
  });

  it("gives five tries, then locks for half an hour and forgets the code", async () => {
    const a = await asked();
    await worker("worker_details_code_send", a.link);
    const right = await latestCode(a.id);
    const wrong = right === "000000" ? "111111" : "000000";
    expect(await worker("worker_details_code_check", a.link, "12ab")).toEqual({ ok: false, reason: "format" });
    for (let i = 1; i <= 4; i++) expect(await worker("worker_details_code_check", a.link, wrong)).toEqual({ ok: false, reason: "wrong", triesLeft: 5 - i });
    expect(await worker("worker_details_code_check", a.link, wrong)).toEqual({ ok: false, reason: "locked", minutes: 30 });
    expect(await worker("worker_details_code_check", a.link, right)).toMatchObject({ ok: false, reason: "locked" });
    expect(await worker("worker_details_code_send", a.link)).toMatchObject({ ok: false, reason: "locked" });
    const acc = await c.one("select code_hash, locked_until > now() + interval '29 minutes' as locked from public.details_check_access where item_id = $1", [(await item(a.id)).id]);
    expect(acc).toEqual({ code_hash: null, locked: true });
    await c.db.admin.query("update public.details_check_access set locked_until = now() - interval '1 minute' where item_id = $1", [(await item(a.id)).id]);
    expect((await worker("worker_details_code_send", a.link)).ok).toBe(true);
  });

  it("ends a code after ten minutes and sends at most three in an hour", async () => {
    const a = await asked();
    await worker("worker_details_code_send", a.link);
    await c.db.admin.query("update public.details_check_access set code_expires_at = now() - interval '1 minute' where item_id = $1", [(await item(a.id)).id]);
    expect(await worker("worker_details_code_check", a.link, await latestCode(a.id))).toEqual({ ok: false, reason: "expired" });
    expect((await worker("worker_details_code_send", a.link)).ok).toBe(true);
    expect((await worker("worker_details_code_send", a.link)).ok).toBe(true);
    expect(await worker("worker_details_code_send", a.link)).toEqual({ ok: false, reason: "too_many", minutes: undefined });
  });

  it("sends nothing for a link that is not valid, and has no way to send when the person has none", async () => {
    expect(await worker("worker_details_code_send", "d".repeat(64))).toEqual({ ok: false, reason: "invalid" });
    const a = await asked();
    await c.db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'test')", [a.id]);
    expect(await worker("worker_details_code_send", a.link)).toEqual({ ok: false, reason: "no_way" });
  });
});

describe("the heartbeat", () => {
  const due = (person: string, col: "remind_at" | "escalate_at") =>
    c.db.admin.query(`update public.details_check_items set ${col} = now() - interval '1 minute' where person_id = $1`, [person]);

  it("forgets a link once its message has gone, and a code once it has been used, and keeps both while they are needed", async () => {
    const a = await asked();
    const b = await asked();
    const msg = (p: string) => c.one("select reply_token, status, params from public.messages where person_id = $1 and template = 'details_check_request'", [p]);
    await c.db.admin.query("update public.messages set status = 'sent', sent_at = now() where person_id = $1 and template = 'details_check_request'", [a.id]);
    await worker("worker_details_tick");
    expect((await msg(a.id)).reply_token).toBe(a.link);
    await c.db.admin.query("update public.messages set sent_at = now() - interval '2 hours' where person_id = $1 and template = 'details_check_request'", [a.id]);
    expect((await worker("worker_details_tick")).scrubbed).toBeGreaterThanOrEqual(1);
    expect((await msg(a.id)).reply_token).toBeNull();
    expect((await msg(b.id)).reply_token).toBe(b.link);
    // a message that failed forgets at once
    await c.db.admin.query("update public.messages set status = 'failed' where person_id = $1 and template = 'details_check_request'", [b.id]);
    await worker("worker_details_tick");
    expect((await msg(b.id)).reply_token).toBeNull();
    // the code
    await worker("worker_details_code_send", a.link).catch(() => undefined);
    const e = await asked();
    await worker("worker_details_code_send", e.link);
    await c.db.admin.query("update public.messages set status = 'sent', sent_at = now() - interval '1 hour' where person_id = $1 and template = 'details_check_code'", [e.id]);
    await worker("worker_details_tick");
    expect((await c.one("select params from public.messages where person_id = $1 and template = 'details_check_code'", [e.id])).params).toEqual({ minutes: 10 });
  });

  it("clears expired links, codes and sessions", async () => {
    const a = await asked();
    await worker("worker_details_code_send", a.link);
    await c.db.admin.query("update public.details_check_access set code_expires_at = now() - interval '1 minute'");
    await c.db.admin.query("update public.details_check_tokens set expires_at = now() - interval '1 minute' where item_id = $1", [(await item(a.id)).id]);
    await worker("worker_details_tick");
    expect((await c.one("select count(*)::int n from public.details_check_tokens where item_id = $1", [(await item(a.id)).id])).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.details_check_access where code_hash is not null")).n).toBe(0);
  });

  it("reminds once, by the other channel when there is one, with a new link, and not again", async () => {
    const a = await asked();
    await c.db.admin.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031234568', 'whatsapp') on conflict (person_id) do update set phone = '+2348031234568', preferred = 'whatsapp'", [a.id]);
    await c.db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [a.id]);
    await c.db.admin.query("update public.messages set channel = 'whatsapp', status = 'sent', sent_at = now() where person_id = $1", [a.id]);
    expect((await worker("worker_details_tick")).reminded).toBe(0);
    await due(a.id, "remind_at");
    expect((await worker("worker_details_tick")).reminded).toBeGreaterThanOrEqual(1);
    const rem = await c.one("select template, params, force_channel, reply_token from public.messages where person_id = $1 and template = 'details_check_reminder'", [a.id]);
    expect(rem).toMatchObject({ template: "details_check_reminder", params: { facts: 1 }, force_channel: "email" });
    expect(rem.reply_token).toMatch(/^[a-f0-9]{64}$/);
    expect(rem.reply_token).not.toBe(a.link);
    // both links work until they end
    expect(await c.as(a.id, "details_check_info", a.link)).toMatchObject({ found: true });
    expect(await c.as(a.id, "details_check_info", rem.reply_token)).toMatchObject({ found: true });
    expect((await item(a.id)).reminded_at).not.toBeNull();
    expect((await worker("worker_details_tick")).reminded).toBe(0);
    expect((await c.one("select count(*)::int n from public.messages where person_id = $1 and template = 'details_check_reminder'", [a.id])).n).toBe(1);
  });

  it("does not remind someone who answered, asked to be asked later, or whose run was stopped", async () => {
    const done = await asked();
    await c.as(done.id, "details_check_answer", done.link, "life_stage", "yes", null);
    const later = await asked();
    await c.as(later.id, "details_check_answer", later.link, "life_stage", "later", null);
    const stopped = await asked();
    await c.o.call("god_details_close", stopped.check);
    for (const p of [done.id, later.id, stopped.id]) await due(p, "remind_at");
    await worker("worker_details_tick");
    for (const p of [done.id, later.id, stopped.id]) expect((await c.one("select count(*)::int n from public.messages where person_id = $1 and template = 'details_check_reminder'", [p])).n, p).toBe(0);
  });

  it("asks the leader's coach to speak to them on day seven, once, and nobody else", async () => {
    const a = await asked();
    const coach = (await c.k.staff("Coach", "coach")).id;
    await c.db.admin.query("update public.tribes set coach_id = $2 where id = $1", [a.tribe, coach]);
    await due(a.id, "escalate_at");
    expect((await worker("worker_details_tick")).called).toBeGreaterThanOrEqual(1);
    const lines = await c.sql("select p.id as person, i.label, i.path from public.notice_items i join public.people p on p.id = i.person_id where i.kind = 'coach_details_unanswered' and i.event = $1", [`details:${(await item(a.id)).id}`]);
    expect(lines).toHaveLength(1);
    expect(lines[0].person).toBe(coach);
    expect(lines[0].label).toMatch(/^Please speak to Lead\d+ about their details$/);
    expect(lines[0].path).toBe("/coach");
    expect(await item(a.id)).toMatchObject({ status: "no_reply" });
    expect((await item(a.id)).escalated_at).not.toBeNull();
    expect((await c.o.call("god_details_status", a.check)).people[0]).toMatchObject({ status: "no_reply", asked: true });
    expect((await worker("worker_details_tick")).called).toBe(0);
  });

  it("asks a director when the leader has no coach", async () => {
    const a = await asked();
    await due(a.id, "escalate_at");
    await worker("worker_details_tick");
    const lines = await c.sql("select p.id as person, i.kind from public.notice_items i join public.people p on p.id = i.person_id where i.event = $1", [`details:${(await item(a.id)).id}`]);
    expect(lines).toEqual([{ person: c.director, kind: "staff_escalation" }]);
  });

  it("still lets a person who has not answered do so after the call, until their link ends", async () => {
    const a = await asked();
    await due(a.id, "escalate_at");
    await worker("worker_details_tick");
    expect((await item(a.id)).status).toBe("no_reply");
    expect(await c.as(a.id, "details_check_answer", a.link, "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
    expect((await item(a.id)).status).toBe("confirmed");
  });

  it("marks the unanswered 'no reply' once every link has run out", async () => {
    const a = await asked();
    await c.db.admin.query("update public.details_check_items set created_at = now() - interval '15 days' where person_id = $1", [a.id]);
    await c.db.admin.query("update public.details_check_tokens set expires_at = now() - interval '1 day' where item_id = $1", [(await item(a.id)).id]);
    await worker("worker_details_tick");
    expect((await item(a.id)).status).toBe("no_reply");
  });

  it("does nothing at all while the function is Off or paused", async () => {
    const a = await asked();
    await due(a.id, "remind_at");
    await due(a.id, "escalate_at");
    await c.o.call("god_feature_master", true, "A pause");
    expect(await worker("worker_details_tick")).toMatchObject({ reminded: 0, called: 0 });
    await c.o.call("god_feature_master", false, null);
    await c.set("hold_card", "off");
    await c.set("details_check", "off");
    expect(await worker("worker_details_tick")).toMatchObject({ reminded: 0, called: 0 });
    expect((await item(a.id)).reminded_at).toBeNull();
    await c.open();
  });
});

describe("the leader's welcome email", () => {
  const welcome = async (person: string) => {
    const id = await c.one("select public.enqueue_message($1, 'leader_welcome', $2::jsonb, null, $3) as id", [person, JSON.stringify({ goal: "Grow", choose: false }), `welcome-test:${person}:${Math.random()}`]);
    return (await c.one("select params from public.messages where id = $1", [id.id])).params as Record<string, unknown>;
  };

  it("carries 'Confirm your details' only while the Details Check is On for the leader and the stage is not yet confirmed", async () => {
    await c.reset();
    const a = await c.appoint("Welcome");
    const off = await welcome(a.id);
    expect(off).toEqual({ goal: "Grow", choose: false });
    await c.open();
    expect(await welcome(a.id)).toEqual({ goal: "Grow", choose: false, confirm_details: true });
    await c.as(a.id, "my_page_answer", "life_stage", "yes", null);
    expect(await welcome(a.id)).toEqual({ goal: "Grow", choose: false });
    await c.reset();
    expect(await welcome(c.seasoned.id)).toEqual({ goal: "Grow", choose: false });
  });

  it("leaves every other message exactly as it was", async () => {
    await c.open();
    const a = await c.appoint("Other");
    const id = await c.one("select public.enqueue_message($1, 'welcome', $2::jsonb, null, $3) as id", [a.id, JSON.stringify({ tribe: "T" }), `other-test:${a.id}`]);
    expect((await c.one("select params from public.messages where id = $1", [id.id])).params).toEqual({ tribe: "T" });
  });
});

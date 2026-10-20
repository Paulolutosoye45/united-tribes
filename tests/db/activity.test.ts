import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEvent, makeOwner, noon, sqlOf, type OwnerKit } from "./activity-kit";
import { newKit, type Kit, type Person } from "./builders";
import { expectCode, type TestDb } from "./helpers";

// Phase 5: the activity log and decision dashboard, for the platform owner only.
//
// What these tests hold to: nobody but the unlocked owner can read any of it, through a table or a function; the new events
// are written where the office cannot read them; a person's activity never carries what they wrote; the owner is never
// recorded; and a fault in recording can never stop someone saving their form.

let db: TestDb;
let k: Kit;
let S: string;
let ok: OwnerKit;
let sql: ReturnType<typeof sqlOf>;

let admin: Person;
let director: Person;
let pastor: Person;
let dataLead: Person;
let careLead: Person;
let coach: Person;
let champion: Person;
let leader: Person;
let assistant: Person;
let member: Person;
let other: Person;

const TABLES = [
  "activity_catalogue", "activity_screens", "activity_steps", "activity_action_groups", "activity_settings",
  "activity_thresholds", "activity_events", "activity_people", "activity_person_day", "activity_daily", "activity_hourly",
];

const REPORTS: [string, unknown[]][] = [
  ["activity_pulse", []],
  ["activity_brief", []],
  ["activity_funnels", ["member", null, null, null]],
  ["activity_funnels", ["leader", null, null, null]],
  ["activity_funnel_people", ["member", 3, "stopped", null, null, 50]],
  ["activity_compare", ["community"]],
  ["activity_compare", ["tribe"]],
  ["activity_retention", [12]],
  ["activity_heatmap", [28]],
  ["activity_stakeholders", []],
  ["activity_integrity", []],
  ["activity_messages", []],
  ["activity_audit", [null, null, null, null, null, null, 50]],
  ["activity_audit_areas", []],
  ["activity_settings_get", []],
  ["activity_threshold_set", ["quiet_days", 30]],
  ["activity_settings_set", [null, null]],
  ["activity_viewed", ["pulse", "viewed"]],
];

const INTERNAL: [string, string][] = [
  ["activity_note", "'11111111-1111-1111-1111-111111111111', 'visit'"],
  ["activity_refresh", "now(), true"],
  ["activity_build_people", ""],
  ["activity_build_days", "current_date, current_date"],
  ["activity_decisions", ""],
  ["activity_member_rows", "current_date, current_date"],
  ["activity_prune", "now()"],
];

const say = (name: string, params: unknown[]) => `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`;
const ev = (person: string, kind?: string) =>
  sql(`select kind, meta, session_hash, day from public.activity_events where person_id = $1 ${kind ? "and kind = $2" : ""} order by id`, kind ? [person, kind] : [person]);
const count = async (text: string, params: unknown[] = []) => Number((await sql(text, params))[0].n);
const track = (who: Person, args: [string, (string | null)?, (string | null)?, (string | null)?, (string | null)?], session = randomUUID()) =>
  db.asUser(who.id, (q) => q("select public.activity_track($1, $2, $3, $4, $5)", [args[0], args[1] ?? null, args[2] ?? null, args[3] ?? null, args[4] ?? null]), { session });

beforeAll(async () => {
  ({ db, k } = await newKit());
  sql = sqlOf(db);
  S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id;
  admin = await k.staff("Adaeze", "admin");
  director = await k.staff("Dayo", "director");
  pastor = await k.staff("Pastor", "pastor");
  dataLead = await k.staff("Data", "data_lead");
  careLead = await k.staff("Care", "care_lead");
  coach = await k.staff("Coach", "coach");
  champion = await k.staff("Champ", "community_champion");
  leader = await k.staff("Lead", "leader");
  assistant = await k.staff("Assist", "assistant_leader");
  member = await k.person("Ngozi");
  other = await k.person("Tunde");
  ok = await makeOwner(db);
});

afterAll(async () => {
  await db?.close();
});

describe("nobody but the unlocked owner can reach any of it", () => {
  const everyone = () => [admin, director, pastor, dataLead, careLead, coach, champion, leader, assistant, member];

  it("closes every table to every role, and to a visitor", async () => {
    for (const who of everyone()) {
      for (const t of TABLES) {
        await expectCode(db.asUser(who.id, (q) => q(`select * from public.${t}`)), "42501");
        await expectCode(db.asUser(who.id, (q) => q(`delete from public.${t}`)), "42501");
      }
      await expectCode(db.asUser(who.id, (q) => q("insert into public.activity_events (day, person_id, kind) values (current_date, $1, 'visit')", [who.id])), "42501");
      await expectCode(db.asUser(who.id, (q) => q("update public.activity_thresholds set value = 1")), "42501");
    }
    for (const t of TABLES) await expectCode(db.asAnon((q) => q(`select * from public.${t}`)), "42501");
  });

  it("closes the tables to the unlocked owner too: they are read through the owner's functions, not queried", async () => {
    for (const t of TABLES) await expectCode(ok.run((q) => q(`select * from public.${t}`)), "42501");
  });

  it("refuses every report to every other role, to a visitor, and to the owner before the passphrase", async () => {
    for (const who of everyone()) {
      for (const [name, params] of REPORTS) {
        await expectCode(db.asUser(who.id, (q) => q(say(name, params), params)), "42501");
      }
    }
    for (const [name, params] of REPORTS) {
      await expectCode(db.asAnon((q) => q(say(name, params), params)), "42501");
    }
    // The owner on a sign-in session that was never unlocked is nobody, even with the right person.
    const fresh = randomUUID();
    for (const [name, params] of REPORTS) {
      await expectCode(db.asUser(ok.owner.id, (q) => q(say(name, params), params), { session: fresh }), "42501");
    }
  });

  it("opens every report to the unlocked owner", async () => {
    for (const [name, params] of REPORTS) {
      const r = await ok.call(name, ...params);
      if (name !== "activity_viewed" && name !== "activity_settings_set" && name !== "activity_threshold_set") expect(r).toBeTruthy();
    }
    // Put the changed flag back.
    await ok.call("activity_threshold_set", "quiet_days", 21);
  });

  it("says the same plain words to a stranger as for a page that does not exist", async () => {
    for (const who of [admin, member]) {
      await expect(db.asUser(who.id, (q) => q("select public.activity_pulse()"))).rejects.toThrow(/not available/i);
    }
    await expect(db.asUser(ok.owner.id, (q) => q("select public.activity_pulse()"), { session: randomUUID() })).rejects.toThrow(/not available/i);
  });

  it("keeps the writers, builders and helpers out of reach of the API, owner included", async () => {
    for (const [name, args] of INTERNAL) {
      await expectCode(db.asUser(admin.id, (q) => q(`select public.${name}(${args})`)), "42501");
      await expectCode(ok.run((q) => q(`select public.${name}(${args})`)), "42501");
      await expectCode(db.asAnon((q) => q(`select public.${name}(${args})`)), "42501");
    }
  });

  it("lets a signed-in person use only the one narrow door, and keeps it shut to a visitor", async () => {
    await track(member, ["visit"]);
    await expectCode(db.asAnon((q) => q("select public.activity_track('visit')")), "42501");
  });

  it("lets only the sending service's token run the refresh", async () => {
    const token = randomUUID() + randomUUID();
    await expectCode(db.asAnon((q) => q("select public.worker_activity_refresh('short')")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_activity_refresh($1)", [token])), "42501");
    await sql("insert into public.worker_tokens (label, token_hash) values ('Test sender', public.referee_token_hash($1))", [token]);
    const r = (await db.asAnon((q) => q("select public.worker_activity_refresh($1) as r", [token]))).rows[0].r;
    expect(r.activity_days).toBeGreaterThanOrEqual(1);
    expect(r.activity_full).toBe(false);
  });
});

describe("the one narrow door", () => {
  it("records a visit and a screen, for a named screen and a device class only, with the session as a hash", async () => {
    const session = randomUUID();
    await track(other, ["screen", "home", "phone", null, "fast"], session);
    const rows = await ev(other.id);
    expect(rows.map((r) => r.kind)).toEqual(["visit", "screen"]);
    expect(rows[0].meta).toEqual({ device: "phone" });
    expect(rows[1].meta).toEqual({ screen: "home", device: "phone", speed: "fast" });
    for (const r of rows) {
      expect(r.session_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain(session);
    }
    // The hash is of the session and the person, so the same session gives the same hash and another gives another.
    await track(other, ["screen", "tribe", "phone"], session);
    const again = await ev(other.id, "screen");
    expect(again[1].session_hash).toBe(again[0].session_hash);
    await track(other, ["screen", "profile", "phone"], randomUUID());
    const third = await ev(other.id, "screen");
    expect(third[2].session_hash).not.toBe(third[0].session_hash);
  });

  it("does not repeat the same screen within 20 seconds, and starts a new visit only after 30 quiet minutes", async () => {
    const who = await k.person("Quiet");
    await track(who, ["screen", "home", "desktop"]);
    await track(who, ["screen", "home", "desktop"]);
    expect(await ev(who.id, "screen")).toHaveLength(1);
    await track(who, ["screen", "profile", "desktop"]);
    expect(await ev(who.id, "screen")).toHaveLength(2);
    expect(await ev(who.id, "visit")).toHaveLength(1);

    await sql("update public.activity_events set at = at - interval '40 minutes' where person_id = $1", [who.id]);
    await track(who, ["screen", "home", "desktop"]);
    expect(await ev(who.id, "visit")).toHaveLength(2);
  });

  it("refuses what is not a screen, a device, a method or a speed it knows", async () => {
    await expectCode(track(member, ["screen", "private_notes", "phone"]), "22023");
    await expectCode(track(member, ["screen", null, "phone"]), "22023");
    await expectCode(track(member, ["form.step", null, "phone"]), "22023");
    await expectCode(track(member, ["directory.exported"]), "22023");
    await expectCode(track(member, ["screen", "home", "watch"]), "22023");
    await expectCode(track(member, ["signin", null, "phone", "sms"]), "22023");
    await expectCode(track(member, ["screen", "home", "phone", null, "turbo"]), "22023");
    // Every one of the screens in the list is accepted.
    for (const s of (await sql("select screen from public.activity_screens"))) {
      await track(await k.person("Screen"), ["screen", s.screen, "tablet"]);
    }
  });

  it("records one sign-in per session, with the method", async () => {
    const who = await k.person("Signer");
    const s1 = randomUUID();
    await track(who, ["signin", null, "phone", "whatsapp"], s1);
    await track(who, ["signin", null, "phone", "whatsapp"], s1);
    await track(who, ["signin", null, "desktop", "google"], randomUUID());
    const rows = await ev(who.id, "signin");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.meta.method)).toEqual(["whatsapp", "google"]);
  });

  it("caps one person at 1,500 events a day", async () => {
    const who = await k.person("Busy");
    await sql(
      `insert into public.activity_events (at, day, person_id, kind, meta)
       select now() - (g || ' seconds')::interval, public.today_lagos(), $1, 'screen', '{"screen":"home"}'::jsonb from generate_series(60, 1559) g`,
      [who.id],
    );
    await track(who, ["screen", "profile", "phone"]);
    expect(await count("select count(*) as n from public.activity_events where person_id = $1", [who.id])).toBe(1500);
  });

  it("ignores the owner without a word, unlocked or not, and never records a hidden account", async () => {
    const before = await count("select count(*) as n from public.activity_events where person_id = $1", [ok.owner.id]);
    await expect(ok.run((q) => q("select public.activity_track('screen', 'home', 'phone')"))).resolves.toBeTruthy();
    await expect(db.asUser(ok.owner.id, (q) => q("select public.activity_track('visit')"), { session: randomUUID() })).resolves.toBeTruthy();
    await sql("select public.activity_note($1, 'visit')", [ok.owner.id]);
    expect(await count("select count(*) as n from public.activity_events where person_id = $1", [ok.owner.id])).toBe(before);
    expect(before).toBe(0);

    const hidden = await k.person("Hidden");
    await sql("update public.people set hidden = true where id = $1", [hidden.id]);
    await track(hidden, ["visit"]);
    await sql("select public.activity_note($1, 'visit')", [hidden.id]);
    expect(await ev(hidden.id)).toHaveLength(0);
    await sql("update public.people set hidden = false where id = $1", [hidden.id]);
  });

  it("returns nothing, so a caller learns nothing, including whether they are the owner", async () => {
    const asMember = (await track(member, ["screen", "home", "phone"])).rows[0].activity_track;
    const asOwnerRow = (await ok.run((q) => q("select public.activity_track('screen', 'home', 'phone')"))).rows[0].activity_track;
    expect(asMember).toBe(asOwnerRow);
  });

  it("stops recording when the owner switches it off, and says so in the owner's record", async () => {
    const who = await k.person("Paused");
    await ok.call("activity_settings_set", false, null);
    await track(who, ["screen", "home", "phone"]);
    expect(await ev(who.id)).toHaveLength(0);
    await ok.call("activity_settings_set", true, null);
    await track(who, ["screen", "home", "phone"]);
    expect((await ev(who.id)).length).toBeGreaterThan(0);
    const rows = await sql("select detail from public.god_log where kind = 'activity_setting' and action = 'recording' order by id");
    expect(rows.map((r) => r.detail.to)).toEqual([false, true]);
  });
});

describe("what is recorded is what, when and who, never what a person wrote", () => {
  it("refuses a kind that is not in the catalogue, and any field or value that could carry wording", async () => {
    const note = (kind: string, meta: unknown) => sql("select public.activity_note($1, $2, $3::jsonb)", [member.id, kind, JSON.stringify(meta)]);
    await expectCode(note("form.answer_text", {}), "22023");
    await expectCode(note("screen_text", {}), "22023");
    await expectCode(note("form.step", { form: "member", step: "age", answer: "yes" }), "22023");
    await expectCode(note("form.step", { form: "member", step: "I want to tell you my story" }), "22023");
    await expectCode(note("form.step", { form: "member", step: "Goal" }), "22023");
    await expectCode(note("form.step", { form: "member", step: "abcdefghijklmnopqrstuvwxy" }), "22023");
    await expectCode(note("form.step", { form: "member", step: "me@example.org" }), "22023");
    await expectCode(note("form.step", { form: "member", step: "a b" }), "22023");
    await expectCode(note("form.step", { form: { x: 1 } }), "22023");
    await expectCode(note("form.step", { form: ["member"] }), "22023");
    await expectCode(note("form.step", { form: null }), "22023");
    await expectCode(sql("select public.activity_note($1, 'form.step', '\"text\"'::jsonb)", [member.id]), "22023");
    // 24 characters of identifier is the most.
    await note("form.step", { form: "member", step: "abcdefghijklmnopqrstuvwx" });
    await note("directory.exported", { rows: 12 });
  });

  it("carries no wording from the form into the log, whatever the form holds", async () => {
    const who = await k.person("Writer");
    await sql("insert into public.intake_drafts (person_id, step, answers) values ($1, 'age', '{}'::jsonb)", [who.id]);
    await sql(
      "update public.intake_drafts set step = 'story', answers = $2::jsonb where person_id = $1",
      [who.id, JSON.stringify({ story: "My private story about my marriage", preferredName: "Secret Name" })],
    );
    await sql("update public.intake_drafts set step = 'goal' where person_id = $1", [who.id]);
    const rows = await ev(who.id);
    expect(rows.map((r) => r.kind)).toEqual(["form.started", "form.step", "form.step", "form.step"]);
    expect(rows.map((r) => r.meta.step ?? null)).toEqual([null, "age", "story", "goal"]);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/private|marriage|Secret/);
    expect(await count("select count(*) as n from public.activity_events where meta::text ~* 'private|marriage|secret'")).toBe(0);
  });

  it("records form progress without touching the office's event log", async () => {
    const who = await k.person("Progress");
    const before = await count("select count(*) as n from public.event_log");
    await sql("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [who.id]);
    await sql("update public.intake_drafts set step = 'name' where person_id = $1", [who.id]);
    await track(who, ["screen", "join", "phone"]);
    expect(await count("select count(*) as n from public.event_log")).toBe(before);
    // And what the office can read of the log shows nothing of it.
    const seen = await db.asUser(admin.id, (q) => q("select count(*) as n from public.event_log where action in ('visit', 'screen', 'signin') or action like 'form.%' or action like 'activity%'"));
    expect(Number(seen.rows[0].n)).toBe(0);
  });

  it("notes the member's submission and later changes, and the leader application's steps", async () => {
    const who = await k.person("Submitter");
    await k.profile(who.id, S);
    expect((await ev(who.id, "form.submitted")).map((r) => r.meta)).toEqual([{ form: "member" }]);
    await sql("update public.member_profiles set zone = 'island-lekki' where person_id = $1", [who.id]);
    expect((await ev(who.id, "form.profile_changed")).map((r) => r.meta)).toEqual([{ form: "member" }]);
    // A save that changes nothing a person wrote (the assistant's own bookkeeping) is not a change they made.
    await sql("update public.member_profiles set ai_assist = '{\"x\":1}'::jsonb where person_id = $1", [who.id]);
    expect(await ev(who.id, "form.profile_changed")).toHaveLength(1);

    const applicant = await k.person("Applicant");
    const app = (await sql("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'eligibility', '{}'::jsonb, 'test') returning id", [applicant.id]))[0].id;
    await sql("update public.leader_applications set step = 'contact' where id = $1", [app]);
    await sql("update public.leader_applications set status = 'submitted', submitted_at = now() where id = $1", [app]);
    const rows = await ev(applicant.id);
    expect(rows.map((r) => `${r.kind}:${r.meta.step ?? r.meta.form}`)).toEqual([
      "form.started:leader", "form.step:eligibility", "form.step:contact", "form.submitted:leader",
    ]);
  });

  it("never lets a fault in recording stop someone saving their form", async () => {
    const who = await k.person("Resilient");
    await sql("update public.activity_catalogue set active = false where kind in ('form.started', 'form.step', 'form.submitted')");
    await sql("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [who.id]);
    await sql("update public.intake_drafts set step = 'name' where person_id = $1", [who.id]);
    await k.profile(who.id, S);
    expect((await sql("select 1 from public.member_profiles where person_id = $1", [who.id])).length).toBe(1);
    expect(await ev(who.id)).toHaveLength(0);
    await sql("update public.activity_catalogue set active = true where kind in ('form.started', 'form.step', 'form.submitted')");
  });

  it("is erased with the person", async () => {
    const who = await k.person("Leaving");
    await track(who, ["screen", "home", "phone"]);
    await sql("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [who.id]);
    await sql("select public.activity_refresh(now(), false)");
    expect((await ev(who.id)).length).toBeGreaterThan(0);
    expect(await count("select count(*) as n from public.activity_person_day where person_id = $1", [who.id])).toBeGreaterThan(0);
    await sql("delete from auth.users where id = $1", [who.id]);
    expect(await count("select count(*) as n from public.activity_events where person_id = $1", [who.id])).toBe(0);
    expect(await count("select count(*) as n from public.activity_person_day where person_id = $1", [who.id])).toBe(0);
    expect(await count("select count(*) as n from public.activity_people where person_id = $1", [who.id])).toBe(0);
  });
});

describe("the owner's own looking is the owner's record alone", () => {
  it("writes each look to the owner's own record, once a minute at most, and nowhere the office can read", async () => {
    const before = await count("select count(*) as n from public.event_log");
    await ok.call("activity_viewed", "funnels", "viewed");
    await ok.call("activity_viewed", "funnels", "viewed");
    await ok.call("activity_viewed", "audit", "exported");
    expect(await count("select count(*) as n from public.god_log where kind = 'viewed' and action = 'funnels'")).toBe(1);
    expect(await count("select count(*) as n from public.god_log where kind = 'exported' and action = 'audit'")).toBe(1);
    expect(await count("select count(*) as n from public.event_log")).toBe(before);
    await expectCode(db.asUser(admin.id, (q) => q("select * from public.god_log")), "42501");
    await expectCode(ok.run((q) => q("select public.activity_viewed('secrets', 'viewed')")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_viewed('pulse', 'copied')")), "22023");
    // The owner can read it back in their own record.
    const log = (await ok.call("god_log_list", 50)) as { kind: string }[];
    expect(log.some((r) => r.kind === "viewed")).toBe(true);
  });

  it("keeps the thresholds the owner's to change, with each change in the owner's record", async () => {
    await ok.call("activity_threshold_set", "member_wait_days", 20);
    const settings = (await ok.call("activity_settings_get")) as { thresholds: { key: string; value: string; label: string }[] };
    const one = settings.thresholds.find((t) => t.key === "member_wait_days")!;
    expect(Number(one.value)).toBe(20);
    expect(one.label).toContain("20 days");
    const log = await sql("select detail from public.god_log where kind = 'activity_setting' and action = 'member_wait_days'");
    expect(log[0].detail).toEqual({ from: 14, to: 20 });
    await ok.call("activity_threshold_set", "member_wait_days", 14);
    await expectCode(ok.run((q) => q("select public.activity_threshold_set('member_wait_days', 0)")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_threshold_set('member_wait_days', 400)")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_threshold_set('no_such_flag', 3)")), "P0002");
    await expectCode(db.asUser(admin.id, (q) => q("select public.activity_threshold_set('member_wait_days', 3)")), "42501");
    expect(Number((await sql("select value from public.activity_thresholds where key = 'member_wait_days'"))[0].value)).toBe(14);
  });
});

describe("the catalogue, and what later phases hook into", () => {
  it("lists every kind, the fields it may carry, and how long it is kept, marking the ones no phase writes yet", async () => {
    const settings = (await ok.call("activity_settings_get")) as {
      min_group: number; retention_months: number;
      catalogue: { kind: string; fields: string[]; keep_months: number; reserved: boolean }[];
    };
    expect(settings.min_group).toBe(5);
    expect(settings.retention_months).toBe(13);
    const kinds = settings.catalogue.map((c) => c.kind).sort();
    expect(kinds).toEqual([
      "directory.exported", "directory.opened", "form.answer_changed", "form.profile_changed", "form.started",
      "form.step", "form.submitted", "screen", "signin", "visit",
    ]);
    expect(settings.catalogue.filter((c) => c.reserved).map((c) => c.kind).sort()).toEqual(["directory.exported", "directory.opened", "form.answer_changed"]);
    expect(settings.catalogue.every((c) => c.keep_months === 13)).toBe(true);
  });

  it("takes Phase 3 and Phase 4's events later through the internal writer, without touching 'last active'", async () => {
    const who = await k.person("Browser");
    await sql("select public.write_event($1, 'testimony.submitted', 'testimony', 'x', '{}'::jsonb)", [who.id]);
    const lastBefore = (await sql("select max(at) as at from public.event_log where actor_id = $1", [who.id]))[0].at;
    const logBefore = await count("select count(*) as n from public.event_log");

    await sql("select public.activity_note($1, 'directory.opened')", [who.id]);
    await sql("select public.activity_note($1, 'directory.exported', '{\"rows\": 40}'::jsonb)", [who.id]);
    for (let i = 0; i < 3; i++) await sql("select public.activity_note($1, 'form.answer_changed', '{\"form\": \"member\", \"field\": \"goal\"}'::jsonb)", [who.id]);

    expect((await ev(who.id)).map((r) => r.kind)).toEqual(["directory.opened", "directory.exported", "form.answer_changed", "form.answer_changed", "form.answer_changed"]);
    // The office's "last active" is the last recorded action in the office's own log. Phase 5 leaves it exactly as it was.
    expect((await sql("select max(at) as at from public.event_log where actor_id = $1", [who.id]))[0].at).toEqual(lastBefore);
    expect(await count("select count(*) as n from public.event_log")).toBe(logBefore);
  });

  it("shows repeated answer changes on the integrity tab once Phase 4 writes them, with small groups hidden", async () => {
    const people: Person[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await k.person(`Changer${i}`);
      people.push(p);
      for (let j = 0; j < 3; j++) await addEvent(db, p.id, "form.answer_changed", 1, { form: "member", field: "goal" });
    }
    const r = (await ok.call("activity_integrity")) as { changes: { answer_changes_30d: number; repeat_answer_changers: number | string } };
    expect(Number(r.changes.answer_changes_30d)).toBeGreaterThanOrEqual(15);
    // The five made here and the one who changed three answers in the test before.
    expect(r.changes.repeat_answer_changers).toBe(6);
  });

  it("shows the same breaker state as the sign-in screen, which does not depend on this phase", async () => {
    await sql("update public.signin_settings set breaker_state = 'tripped', breaker_reason = 'test', breaker_tripped_at = now()");
    const m = (await ok.call("activity_messages")) as { breaker: { state: string; reason: string } };
    expect(m.breaker.state).toBe("tripped");
    expect(m.breaker.reason).toBe("test");
    await sql("update public.signin_settings set breaker_state = 'ok', breaker_reason = null, breaker_tripped_at = null");
  });
});

describe("retention and the back-dated fill", () => {
  it("fills the summaries once from the tables where things already live, and counts sign-ins from today only", async () => {
    const who = await k.person("Old");
    await sql(`update public.people set created_at = ${noon(50)} where id = $1`, [who.id]);
    await k.profile(who.id, S);
    await sql(`update public.member_profiles set submitted_at = ${noon(20)} where person_id = $1`, [who.id]);
    await sql(`insert into public.event_log (at, actor_id, action, entity, entity_id) values (${noon(30)}, $1, 'testimony.submitted', 'testimony', 'x')`, [who.id]);
    await sql("update public.activity_settings set last_backfill = null");
    await sql("select public.activity_refresh(now(), false)");
    const day = async (n: number, metric: string) =>
      Number((await sql("select coalesce(sum(n), 0) as n from public.activity_daily where metric = $1 and grp = 'all' and day = public.today_lagos() - $2::int", [metric, n]))[0].n);
    expect(await day(50, "registered")).toBeGreaterThanOrEqual(1);
    expect(await day(20, "form_submitted")).toBeGreaterThanOrEqual(1);
    expect(await count("select count(*) as n from public.activity_person_day where person_id = $1 and day = public.today_lagos() - 30", [who.id])).toBe(1);
    // Nothing about sign-ins or screens before this phase was ever recorded, so none is invented.
    expect(await count("select count(*) as n from public.activity_events where kind in ('visit', 'signin', 'screen') and day < public.today_lagos()")).toBe(0);
  });

  it("deletes detail older than the retention months and keeps the daily counts", async () => {
    const who = await k.person("Retained");
    await sql("insert into public.activity_events (at, day, person_id, kind) values (now() - interval '14 months', public.today_lagos() - 425, $1, 'visit'), (now() - interval '12 months', public.today_lagos() - 365, $1, 'visit')", [who.id]);
    await sql("insert into public.activity_person_day (person_id, day, events) values ($1, public.today_lagos() - 425, 3)", [who.id]);
    await sql("insert into public.activity_daily (day, metric, grp, n, people) values (public.today_lagos() - 425, 'active', 'all', 7, 7) on conflict do nothing");
    await sql("update public.activity_settings set last_prune = null");
    await sql("select public.activity_refresh(now(), false)");
    expect((await ev(who.id, "visit")).map((r) => r.day).length).toBe(1);
    expect(await count("select count(*) as n from public.activity_person_day where person_id = $1 and day = public.today_lagos() - 425", [who.id])).toBe(0);
    expect(await count("select count(*) as n from public.activity_daily where day = public.today_lagos() - 425 and metric = 'active'")).toBe(1);
  });

  it("lets the owner shorten the retention, within limits", async () => {
    await expectCode(ok.run((q) => q("select public.activity_settings_set(null, 2)")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_settings_set(null, 40)")), "22023");
    const who = await k.person("Short");
    await sql("insert into public.activity_events (at, day, person_id, kind) values (now() - interval '8 months', public.today_lagos() - 240, $1, 'visit'), (now() - interval '2 months', public.today_lagos() - 60, $1, 'visit')", [who.id]);
    await ok.call("activity_settings_set", null, 6);
    const settings = (await ok.call("activity_settings_get")) as { retention_months: number; catalogue: { keep_months: number }[] };
    expect(settings.retention_months).toBe(6);
    expect(settings.catalogue.every((c) => c.keep_months <= 6)).toBe(true);
    await sql("update public.activity_settings set last_prune = null");
    await sql("select public.activity_refresh(now(), false)");
    expect((await ev(who.id, "visit"))).toHaveLength(1);
    await ok.call("activity_settings_set", null, 13);
  });
});

describe("the owner's console lists activity without it ever reaching the office", () => {
  it("shows the owner's own looks and settings in the audit trail as 'You', and no one else can", async () => {
    const r = (await ok.call("activity_audit", "you", null, null, null, null, null, 50)) as { rows: { who: string; group: string; action: string }[] };
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.who === "You" && x.group === "you")).toBe(true);
    expect(r.rows.some((x) => x.action === "activity.viewed")).toBe(true);
    expect(r.rows.some((x) => x.action === "activity.activity_setting")).toBe(true);
  });

  it("marks an office action the owner took as 'You', not 'The system', and shows no wording", async () => {
    await sql("select public.write_event($1, 'care.call', 'person', 'abc123456789', '{\"note\": \"private wording here\"}'::jsonb)", [ok.owner.id]);
    const r = (await ok.call("activity_audit", null, "care", null, null, null, null, 20)) as { rows: Record<string, unknown>[] };
    const mine = r.rows.find((x) => x.action === "care.call");
    expect(mine).toBeTruthy();
    expect(mine!.who).toBe("You");
    expect(mine!.person_id).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/private wording/);
    for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(["action", "area", "at", "entity", "group", "person_id", "ref", "who"]);
    expect(mine!.ref).toBe("abc12345");
  });

  it("refuses a made-up group or an area that is not a word", async () => {
    await expectCode(ok.run((q) => q("select public.activity_audit('everyone')")), "22023");
  });
});


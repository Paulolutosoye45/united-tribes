import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, makeYoung, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type Row, type TestDb } from "./helpers";

// Exports and Reports, release one. What these prove:
//   * everything ships Off, and Off gives nothing, even to a direct call of a source function
//   * every switch lives with the platform owner: nobody else can move one or read the switchboard
//   * a People pack cannot leave Rehearsal until it has been tried and the impact assessment is recorded
//   * a link belongs to one account, ends in 24 hours, is checked again each time it is opened, and stops when the pack is switched off
//   * members under 18 are counted and never listed, and a number a member withheld is not in the file
//   * the log holds facts about a file, never its contents, and is kept for two years

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let t1: string;
let t2: string;
let leader1: string;
let assistant1: string;
let leader2: string;
let coach: string;
let champion: string;
let admin: string;
let director: string;
let pastor: string;
let dataLead: string;
let community: string;
let ada: string;
let bola: string;
let yaw: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const as = (who: string, fn: string, ...params: unknown[]) => k.call(who, fn, params);
const json = (v: unknown) => JSON.stringify(v);
/** Yesterday, in UTC: never a day in the future for Lagos, which is an hour ahead. */
const SIGNED = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** The church opens for downloads in every format; no pack is moved. */
async function openDoors() {
  await o.call("export_settings_save", json({ formats: ["xlsx", "csv", "pdf"], deliveries: ["download"], doors: ["open_data_pack", "standing_link"] }), null);
}
const put = (pack: string, position: string, limits: unknown = {}, reason: string | null = "Testing this pack with the people who use it") =>
  o.call("export_pack_set", pack, position, json(limits), reason);
/** Rehearsal first, then the recorded assessment, then the position: the only road a People pack has. */
async function openPeoplePack(pack: string, position: "limited" | "on", limits: unknown = {}) {
  await put(pack, "rehearsal");
  await o.call("export_settings_save", json({ people_cleared_on: SIGNED }), "Signed by the pastor and the data lead");
  await put(pack, position, limits);
}
const reset = async () => {
  await db.admin.query("update public.export_switches set position = 'off', limited_roles = '{}', limited_communities = '{}', limited_tribes = '{}', rehearsed_at = null");
  await db.admin.query("update public.export_settings set paused = false, people_stopped = false, unusual_per_hour = 5, formats = '{}', deliveries = '{}', doors = '{}', people_cleared_on = null");
  await db.admin.query("delete from public.export_testers");
  await db.admin.query("delete from public.export_log");
  await db.admin.query("delete from public.export_feed_links");
  await db.admin.query("delete from public.export_switch_log");
};

beforeAll(async () => {
  ({ db, k } = await newKit());
  o = await makeOwner(db);
  season = await k.season("Test season", 30);
  const a = await k.tribe(season, { name: "Alpha Tribe" });
  const b = await k.tribe(season, { name: "Beta Tribe", assistant: "certified" });
  t1 = a.tribe;
  t2 = b.tribe;
  leader1 = a.leader.id;
  leader2 = b.leader.id;
  assistant1 = (await k.person("Helper")).id;
  await k.sql("update public.tribes set assistant_id = $2 where id = $1", [t1, assistant1]);
  await db.grant(assistant1, "assistant_leader");
  coach = (await k.staff("Coach", "coach")).id;
  await k.sql("update public.tribes set coach_id = $2 where id = $1", [t1, coach]);
  admin = (await k.staff("Admin", "admin")).id;
  director = (await k.staff("Director", "director")).id;
  pastor = (await k.staff("Pastor", "pastor")).id;
  dataLead = (await k.staff("DataLead", "data_lead")).id;
  champion = (await k.staff("Champion", "community_champion")).id;
  community = (await sql("select community_id as c from public.tribes where id = $1", [t1]))[0].c;
  await k.sql("insert into public.community_champions (person_id, community_id) values ($1, $2)", [champion, community]);

  ada = (await k.seat(t1, season, "Ada")).id;
  await k.sql("update public.member_profiles set whatsapp = '+2348031234567' where person_id = $1", [ada]);
  const bolaSeat = await k.seat(t1, season, "Bola");
  bola = bolaSeat.id;
  await k.sql("update public.member_profiles set whatsapp = '+2348039999999' where person_id = $1", [bola]);
  // Bola asked for her number to be withheld
  await k.sql("update public.tribe_members set contact_withheld = true where person_id = $1 and tribe_id = $2", [bola, t1]);
  // A young member sits in the tribe too
  const young = await k.seat(t1, season, "Yaw", { profile: false });
  yaw = young.id;
  await makeYoung(db, k, yaw, season);
  await k.seat(t2, season, "Chidi");
});

afterAll(async () => {
  await db?.close();
});

describe("everything ships Off", () => {
  it("has fourteen packs, every one Off, and no format, delivery or door on", async () => {
    const packs = await sql("select p.id, w.position from public.export_packs p join public.export_switches w on w.pack = p.id order by p.sort");
    expect(packs).toHaveLength(14);
    expect(packs.every((p) => p.position === "off")).toBe(true);
    const s = (await sql("select * from public.export_settings"))[0];
    expect(s).toMatchObject({ paused: false, people_stopped: false, unusual_per_hour: 5, formats: [], deliveries: [], doors: [], people_cleared_on: null });
  });

  it("offers nobody anything, and refuses a file to every role", async () => {
    for (const who of [leader1, assistant1, coach, champion, admin, director, pastor, dataLead]) {
      const opts = await as(who, "export_options");
      expect(opts.packs, who).toEqual([]);
      expect(opts.open).toBe(false);
    }
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
  });

  it("gives nothing from a source function while its pack is Off, even to the person it is for", async () => {
    await expectCode(as(leader1, "export_tribe_sheet", t1), "42501");
    await expectCode(as(leader1, "export_attendance_register", t1), "42501");
    await expectCode(as(pastor, "export_leaders_roster", null), "42501");
    await expectCode(as(admin, "export_people_roles"), "42501");
    await expectCode(as(admin, "export_message_volumes", null, null), "42501");
    await expectCode(as(dataLead, "export_insight_table", "tribes"), "42501");
  });

  it("does not offer the second release's packs, and will not open them", async () => {
    await openDoors();
    await expectCode(put("know_your_tribe", "rehearsal"), "22023");
    await expectCode(put("my_data_pack", "on"), "22023");
    const board = await o.call("export_board");
    expect(board.packs.filter((p: Row) => !p.released).map((p: Row) => p.id).sort()).toEqual(["know_your_tribe", "my_data_pack"]);
    await reset();
  });
});

describe("the switchboard is the owner's alone", () => {
  const FUNCS: [string, unknown[]][] = [
    ["export_board", []],
    ["export_pack_preview", ["tribe_sheet", "on", "{}"]],
    ["export_pack_set", ["tribe_sheet", "rehearsal", "{}", "a reason here"]],
    ["export_settings_save", [json({ paused: true }), null]],
    ["export_tester_set", [randomUUID(), true]],
    ["export_log_list", [10, null, null]],
  ];

  it("refuses every other signed-in person, whatever their role", async () => {
    for (const who of [admin, director, pastor, dataLead, leader1, coach, champion, ada]) {
      for (const [fn, args] of FUNCS) await expectCode(as(who, fn, ...args), "42501");
    }
  });

  it("refuses a visitor who is not signed in", async () => {
    for (const [fn, args] of FUNCS) {
      await expectCode(
        db.asAnon((q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)),
        "42501",
      );
    }
  });

  it("refuses the owner too until they have unlocked this sign-in", async () => {
    const locked = await db.createUser({ email: "locked@example.org" });
    for (const [fn, args] of FUNCS) await expectCode(as(locked.id, fn, ...args), "42501");
    // The owner's own session, not unlocked: a different session id
    await expectCode(
      db.asUser(o.owner.id, (q) => q("select public.export_board()"), { session: randomUUID() }),
      "42501",
    );
  });

  it("lets the unlocked owner read the board, with the packs, the testers and nobody else's data", async () => {
    const board = await o.call("export_board");
    expect(board.packs).toHaveLength(14);
    expect(board.settings.paused).toBe(false);
    expect(board.testers).toEqual([]);
  });

  it("has no function that changes a switch which a signed-in role can call and which is not owner-only", async () => {
    // Every function that writes the switchboard tables begins god_only(): found by reading the bodies
    const rows = await sql(
      `select p.proname, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        and p.prosrc ~* 'update public\\.export_(switches|settings)|insert into public\\.export_testers|delete from public\\.export_testers'`,
    );
    const names = rows.map((r) => r.proname).sort();
    expect(names).toEqual(["export_pack_set", "export_settings_save", "export_tester_set"]);
    for (const r of rows) expect(r.prosrc, r.proname).toMatch(/perform public\.god_only\(\)/);
  });
});

describe("moving a pack", () => {
  beforeAll(async () => {
    await reset();
    await openDoors();
  });

  it("needs a reason to open a pack beyond the testers", async () => {
    await expectCode(put("tribes_health", "on", {}, null), "22023");
    await expectCode(put("tribes_health", "on", {}, "ok"), "22023");
    const board = await put("tribes_health", "on", {}, "Directors asked for it after the pilot");
    expect(board.packs.find((p: Row) => p.id === "tribes_health").position).toBe("on");
    await put("tribes_health", "off", {}, null);
  });

  it("will not let a People pack go to Limited or On before it has been in Rehearsal", async () => {
    await o.call("export_settings_save", json({ people_cleared_on: SIGNED }), "Signed by the pastor and the data lead");
    await expectCode(put("tribe_sheet", "on"), "22023");
    await put("tribe_sheet", "rehearsal");
    await put("tribe_sheet", "on");
    await put("tribe_sheet", "off", {}, null);
    // It was rehearsed once, and that stays on record
    const w = (await sql("select rehearsed_at from public.export_switches where pack = 'tribe_sheet'"))[0];
    expect(w.rehearsed_at).not.toBeNull();
    await reset();
    await openDoors();
  });

  it("will not let a People pack leave Rehearsal until the impact assessment is recorded as signed", async () => {
    await put("tribe_sheet", "rehearsal");
    await expectCode(put("tribe_sheet", "limited", { tribes: [t1] }), "22023");
    await expectCode(o.call("export_settings_save", json({ people_cleared_on: SIGNED }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ people_cleared_on: "2999-01-01" }), "Signed by the pastor"), "22023");
    await o.call("export_settings_save", json({ people_cleared_on: SIGNED }), "Signed by the pastor and the data lead");
    await put("tribe_sheet", "limited", { tribes: [t1] });
    // Clearing it again (it was a mistake) is allowed and closes the road for the next pack
    await o.call("export_settings_save", json({ people_cleared_on: null }), null);
    await put("leaders_roster", "rehearsal");
    await expectCode(put("leaders_roster", "on"), "22023");
    await reset();
    await openDoors();
  });

  it("needs a choice of who for Limited, and only the choices that fit the pack", async () => {
    await expectCode(put("tribes_health", "limited", {}), "22023");
    await expectCode(put("tribes_health", "limited", { roles: ["coach"] }), "22023");
    await expectCode(put("tribes_health", "limited", { tribes: [t1] }), "22023");
    await expectCode(put("community_report", "limited", { tribes: [t1] }), "22023");
    await put("tribes_health", "limited", { roles: ["director"] });
    await put("community_report", "limited", { communities: [community] });
    await expectCode(put("tribes_health", "limited", { roles: ["not_a_role"] }), "22P02");
    await reset();
    await openDoors();
  });

  it("shows how many people a position would reach before it is saved", async () => {
    // The director, the admin and the pastor
    expect((await o.call("export_pack_preview", "tribes_health", "on", "{}")).people).toBe(3);
    expect((await o.call("export_pack_preview", "tribes_health", "off", "{}")).people).toBe(0);
    expect((await o.call("export_pack_preview", "tribes_health", "limited", json({ roles: ["director"] }))).people).toBe(1);
    expect((await o.call("export_pack_preview", "tribes_health", "rehearsal", "{}")).people).toBe(0);
  });

  it("logs every change with who, from, to and why", async () => {
    await reset();
    await openDoors();
    await put("tribes_health", "rehearsal");
    await put("tribes_health", "on", {}, "Opened for the directors and the admins");
    const log = await sql("select what, was, now_is, reason, by_person from public.export_switch_log order by id");
    expect(log.map((l) => l.what)).toEqual(["setting:formats", "setting:deliveries", "setting:doors", "pack:tribes_health", "pack:tribes_health"]);
    const last = log[log.length - 1];
    expect(last).toMatchObject({ was: "rehearsal", now_is: "on", reason: "Opened for the directors and the admins", by_person: o.owner.id });
    // And in the owner's own record, never the staff log
    const god = await sql("select action from public.god_log where action = 'export.switch'");
    expect(god.length).toBeGreaterThanOrEqual(4);
    expect((await sql("select 1 from public.event_log where actor_id = $1 and action = 'export.switch'", [o.owner.id])).length).toBe(0);
    await reset();
    await openDoors();
  });

  it("will not take a format, delivery or door that this release does not have", async () => {
    await expectCode(o.call("export_settings_save", json({ formats: ["docx"] }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ deliveries: ["email_link"] }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ doors: ["live_connection"] }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ colour: "red" }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ unusual_per_hour: 0 }), null), "22023");
    await expectCode(o.call("export_settings_save", json({ paused: "yes" }), null), "22023");
    const board = await o.call("export_settings_save", json({ unusual_per_hour: 8 }), null);
    expect(board.settings.unusual_per_hour).toBe(8);
    await o.call("export_settings_save", json({ unusual_per_hour: 5 }), null);
  });
});

describe("who can make which file, and for what", () => {
  beforeAll(async () => {
    await reset();
    await openDoors();
    await openPeoplePack("tribe_sheet", "on");
    await put("attendance_register", "rehearsal");
    await put("tribes_health", "on");
    await put("my_tribes_glance", "on");
    await put("community_report", "on");
  });

  it("shows each person only what is theirs: a leader their tribe, a coach the glance, a champion their community", async () => {
    const lead = await as(leader1, "export_options");
    expect(lead.packs.map((p: Row) => p.id)).toEqual(["tribe_sheet"]);
    expect(lead.packs[0].targets.map((t: Row) => t.id)).toEqual([t1]);
    expect(lead.formats.sort()).toEqual(["csv", "pdf", "xlsx"]);
    expect(lead.open).toBe(true);
    // The assistant is on the same tribe
    expect((await as(assistant1, "export_options")).packs[0].targets.map((t: Row) => t.id)).toEqual([t1]);
    // The other leader sees theirs, not Alpha
    expect((await as(leader2, "export_options")).packs[0].targets.map((t: Row) => t.id)).toEqual([t2]);
    expect((await as(coach, "export_options")).packs.map((p: Row) => p.id)).toEqual(["my_tribes_glance"]);
    const champ = await as(champion, "export_options");
    expect(champ.packs.map((p: Row) => p.id)).toEqual(["community_report"]);
    expect(champ.packs[0].targets.map((t: Row) => t.id)).toEqual([community]);
    expect((await as(director, "export_options")).packs.map((p: Row) => p.id)).toEqual(["tribes_health"]);
    expect((await as(admin, "export_options")).packs.map((p: Row) => p.id)).toEqual(["tribes_health"]);
    // A plain member sees nothing
    expect((await as(ada, "export_options")).packs).toEqual([]);
  });

  it("hides a pack that is only in Rehearsal from everyone but the testers, and stamps it", async () => {
    expect((await as(leader1, "export_options")).packs.map((p: Row) => p.id)).not.toContain("attendance_register");
    await o.call("export_tester_set", leader1, true);
    const opts = await as(leader1, "export_options");
    expect(opts.packs.map((p: Row) => p.id)).toContain("attendance_register");
    expect(opts.packs.find((p: Row) => p.id === "attendance_register").rehearsal).toBe(true);
    const made = await as(leader1, "export_prepare", "attendance_register", "xlsx", "planning", json({ tribe: t1 }));
    expect(made.rehearsal).toBe(true);
    const opened = await as(leader1, "export_open", made.token);
    expect(opened.rehearsal).toBe(true);
    // The leader of the other tribe is not a tester
    await expectCode(as(leader2, "export_prepare", "attendance_register", "xlsx", "planning", json({ tribe: t2 })), "42501");
    await o.call("export_tester_set", leader1, false);
    await expectCode(as(leader1, "export_open", made.token), "42501");
  });

  it("refuses a leader another leader's tribe, a coach the tribe sheet, and a role the pack is not for", async () => {
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t2 })), "42501");
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", "{}"), "42501");
    await expectCode(as(coach, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    await expectCode(as(director, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    await expectCode(as(admin, "export_tribe_sheet", t1), "42501");
    await expectCode(as(pastor, "export_tribe_sheet", t1), "42501");
    await expectCode(as(leader2, "export_tribe_sheet", t1), "42501");
    await expectCode(as(champion, "export_prepare", "community_report", "pdf", null, json({ community: randomUUID() })), "42501");
  });

  it("asks a People file for its reason and a coded file for none", async () => {
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", null, json({ tribe: t1 })), "22023");
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "curiosity", json({ tribe: t1 })), "22023");
    const coded = await as(director, "export_prepare", "tribes_health", "xlsx", null, "{}");
    expect(coded.export_id).toBeTruthy();
  });

  it("refuses a format the pack does not make, and a format that is switched off", async () => {
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "pdf", "planning", json({ tribe: t1 })), "22023");
    await o.call("export_settings_save", json({ formats: ["csv", "pdf"] }), null);
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    await o.call("export_settings_save", json({ formats: ["xlsx", "csv", "pdf"] }), null);
    await o.call("export_settings_save", json({ deliveries: [] }), null);
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    await o.call("export_settings_save", json({ deliveries: ["download"] }), null);
    expect((await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }))).token).toBeTruthy();
  });

  it("limits a pack to chosen tribes, communities and roles", async () => {
    await put("tribe_sheet", "limited", { tribes: [t1] });
    expect((await as(leader1, "export_options")).packs.map((p: Row) => p.id)).toContain("tribe_sheet");
    expect((await as(leader2, "export_options")).packs.map((p: Row) => p.id)).not.toContain("tribe_sheet");
    await expectCode(as(leader2, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t2 })), "42501");
    expect((await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }))).token).toBeTruthy();
    await put("tribe_sheet", "limited", { roles: ["assistant_leader"] });
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    expect((await as(assistant1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }))).token).toBeTruthy();
    await put("tribe_sheet", "limited", { communities: [community] });
    expect((await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }))).token).toBeTruthy();
    await put("tribe_sheet", "on");
  });

  it("puts only the known choices in the log, and nothing from the file", async () => {
    const made = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1, success: true, secret: "x", note: "Ada is struggling" }));
    const row = (await sql("select * from public.export_log where id = $1", [made.export_id]))[0];
    expect(row.filters).toEqual({ tribe: t1, success: true });
    expect(JSON.stringify(row)).not.toMatch(/Ada|struggling|2348/);
    expect(row).toMatchObject({ pack: "tribe_sheet", lane: "people", role: "leader", purpose: "planning", status: "prepared", rehearsal: false });
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: "not-a-uuid" })), "22023");
  });

  it("keeps no personal data in the log: no table holds a name, a number or a file", async () => {
    const cols = await sql(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('export_log', 'export_links', 'export_feed_links', 'export_switch_log') order by 1, ordinal_position`,
    );
    const text = cols.filter((c) => c.data_type === "text").map((c) => `${c.table_name}.${c.column_name}`);
    // Every free text column is a short fact, never a body: bounded by a check or an enum-like value
    expect(text.sort()).toEqual(
      [
        "export_feed_links.label", "export_feed_links.tbl", "export_feed_links.token_hash",
        "export_links.token_hash",
        "export_log.flagged", "export_log.format", "export_log.lane", "export_log.note", "export_log.pack", "export_log.position",
        "export_log.purpose", "export_log.role", "export_log.status",
        "export_switch_log.now_is", "export_switch_log.reason", "export_switch_log.was", "export_switch_log.what",
      ].sort(),
    );
    expect(cols.filter((c) => /bytea|json/.test(c.data_type)).map((c) => `${c.table_name}.${c.column_name}`)).toEqual(["export_log.filters"]);
  });
});

describe("a private link", () => {
  let made: Row;
  beforeAll(async () => {
    await reset();
    await openDoors();
    await openPeoplePack("tribe_sheet", "on");
    made = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
  });

  it("stores only a fingerprint of the link, and the link works for 24 hours", async () => {
    expect(made.token).toMatch(/^[a-f0-9]{64}$/);
    const l = (await sql("select * from public.export_links where export_id = $1", [made.export_id]))[0];
    expect(l.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(l.token_hash).not.toBe(made.token);
    expect(JSON.stringify(await sql("select * from public.export_links"))).not.toContain(made.token);
    const hours = (new Date(l.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });

  it("opens for the one account it was made for, and for nobody else, even a colleague with the same role", async () => {
    const opened = await as(leader1, "export_open", made.token);
    expect(opened).toMatchObject({ pack: "tribe_sheet", format: "xlsx", lane: "people", purpose: "planning", role: "leader", rehearsal: false });
    expect(opened.who).toMatch(/Leader/);
    await expectCode(as(assistant1, "export_open", made.token), "P0002");
    await expectCode(as(leader2, "export_open", made.token), "P0002");
    await expectCode(as(admin, "export_open", made.token), "P0002");
    await expectCode(db.asAnon((q) => q("select public.export_open($1)", [made.token])), "42501");
    await expectCode(as(leader1, "export_open", "x".repeat(64)), "P0002");
    await expectCode(as(leader1, "export_open", "short"), "P0002");
  });

  it("records the rows once the file is made, and counts each time the link is opened", async () => {
    await as(leader1, "export_done", made.export_id, 3, true, null);
    const row = (await sql("select status, row_count, delivered_at from public.export_log where id = $1", [made.export_id]))[0];
    expect(row).toMatchObject({ status: "delivered", row_count: 3 });
    expect(row.delivered_at).not.toBeNull();
    expect((await sql("select opens from public.export_links where export_id = $1", [made.export_id]))[0].opens).toBeGreaterThanOrEqual(1);
    // Nobody else can write to someone's log line
    await as(leader2, "export_done", made.export_id, 999, true, null);
    expect((await sql("select row_count from public.export_log where id = $1", [made.export_id]))[0].row_count).toBe(3);
  });

  it("ends after 24 hours", async () => {
    const fresh = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    await as(leader1, "export_open", fresh.token);
    await k.sql("update public.export_links set expires_at = now() - interval '1 second' where export_id = $1", [fresh.export_id]);
    await expectCode(as(leader1, "export_open", fresh.token), "P0002");
  });

  it("is checked again each time it is opened: a role lost, a tribe handed on, a pack switched off", async () => {
    const a = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    // Handed on to someone who leads no other tribe (a leader may lead only one)
    await k.sql("update public.tribes set leader_id = $2 where id = $1", [t1, pastor]);
    await expectCode(as(leader1, "export_open", a.token), "42501");
    await k.sql("update public.tribes set leader_id = $2 where id = $1", [t1, leader1]);
    await as(leader1, "export_open", a.token);

    await put("tribe_sheet", "off", {}, null);
    await expectCode(as(leader1, "export_open", a.token), "42501");
    await expectCode(as(leader1, "export_tribe_sheet", t1), "42501");
    await put("tribe_sheet", "on");
    await as(leader1, "export_open", a.token);

    await o.call("export_settings_save", json({ paused: true }), "Stopping everything while we check");
    await expectCode(as(leader1, "export_open", a.token), "42501");
    expect((await as(leader1, "export_options")).packs).toEqual([]);
    await o.call("export_settings_save", json({ paused: false }), null);
    await as(leader1, "export_open", a.token);
  });

  it("is withdrawn at once by Delete now, and only by its owner", async () => {
    const a = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    await expectCode(as(leader2, "export_withdraw", a.export_id), "P0002");
    await as(leader1, "export_withdraw", a.export_id);
    await expectCode(as(leader1, "export_open", a.token), "P0002");
    const mine = await as(leader1, "my_exports");
    const row = mine.find((m: Row) => m.id === a.export_id);
    expect(row).toMatchObject({ status: "withdrawn", active: false });
    expect(mine.find((m: Row) => m.id === made.export_id).active).toBe(true);
    expect(await as(leader2, "my_exports")).toEqual([]);
  });

  it("stops every named file at once with Stop all People files, and leaves the coded reports running", async () => {
    await put("tribes_health", "on");
    const named = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    await o.call("export_settings_save", json({ people_stopped: true }), "Stopping named files while we look into it");
    await expectCode(as(leader1, "export_open", named.token), "42501");
    await expectCode(as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 })), "42501");
    expect((await as(director, "export_prepare", "tribes_health", "xlsx", null, "{}")).token).toBeTruthy();
    await o.call("export_settings_save", json({ people_stopped: false }), null);
    await as(leader1, "export_open", named.token);
  });
});

describe("the unusual-use notice", () => {
  beforeAll(async () => {
    await reset();
    await openDoors();
    await openPeoplePack("tribe_sheet", "on");
    await k.sql("update public.notice_settings set mode = 'on' where group_key = 'data_lead'");
    await k.sql("delete from public.notice_items");
  });

  it("notes the sixth named file in an hour and tells the data lead once", async () => {
    for (let i = 0; i < 5; i++) await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    expect((await sql("select count(*)::int n from public.export_log where flagged = 'unusual'"))[0].n).toBe(0);
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    expect((await sql("select count(*)::int n from public.export_log where flagged = 'unusual'"))[0].n).toBe(2);
    const notices = await sql("select person_id, kind, label from public.notice_items where kind = 'data_unusual_export'");
    expect(notices).toHaveLength(1);
    expect(notices[0].person_id).toBe(dataLead);
    expect(JSON.stringify(notices)).not.toMatch(/Leader|Ada/);
  });

  it("uses the number the owner sets, and coded files never count", async () => {
    await k.sql("delete from public.export_log");
    await o.call("export_settings_save", json({ unusual_per_hour: 2 }), null);
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    expect((await sql("select count(*)::int n from public.export_log where flagged = 'unusual'"))[0].n).toBe(0);
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    expect((await sql("select count(*)::int n from public.export_log where flagged = 'unusual'"))[0].n).toBe(1);
    await put("tribes_health", "on");
    for (let i = 0; i < 6; i++) await as(director, "export_prepare", "tribes_health", "xlsx", null, "{}");
    expect((await sql("select count(*)::int n from public.export_log where pack = 'tribes_health' and flagged is not null"))[0].n).toBe(0);
  });

  it("does not stop the file if the notice cannot be queued", async () => {
    await k.sql("delete from public.export_log");
    await o.call("export_settings_save", json({ unusual_per_hour: 1 }), null);
    await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
    // Break the notice engine for a moment: the file must still be made, and still be noted
    await k.sql("alter table public.notice_items rename to notice_items_away");
    try {
      const second = await as(leader1, "export_prepare", "tribe_sheet", "xlsx", "planning", json({ tribe: t1 }));
      expect(second.token).toBeTruthy();
      expect((await sql("select count(*)::int n from public.export_log where flagged = 'unusual'"))[0].n).toBe(1);
    } finally {
      await k.sql("alter table public.notice_items_away rename to notice_items");
    }
  });
});

describe("the People packs", () => {
  beforeAll(async () => {
    await reset();
    await openDoors();
    await openPeoplePack("tribe_sheet", "on");
    await openPeoplePack("attendance_register", "on");
    await put("leaders_roster", "rehearsal");
    await put("leaders_roster", "on");
    await openPeoplePack("people_roles", "on");
  });

  it("lists a tribe's members as the roster shows them: young members counted not listed, a withheld number left out", async () => {
    // Both agreed to WhatsApp; Bola then asked for her number to be withheld
    for (const p of [ada, bola]) await k.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test-v1')", [p]);
    const sheet = await as(leader1, "export_tribe_sheet", t1);
    const names = sheet.members.map((m: Row) => m.first_name).sort();
    expect(names).toEqual(["Ada", "Bola"]);
    expect(names).not.toContain("Yaw");
    expect(sheet.young_count).toBe(1);
    const bolaRow = sheet.members.find((m: Row) => m.first_name === "Bola");
    const adaRow = sheet.members.find((m: Row) => m.first_name === "Ada");
    expect(bolaRow.whatsapp).toBeNull();
    expect(adaRow.whatsapp).toBe("+2348031234567");
    // A member who has not agreed to WhatsApp (or has taken the agreement back) has no number in the file
    await k.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', false, 'test-v2')", [ada]);
    const after = await as(leader1, "export_tribe_sheet", t1);
    expect(after.members.find((m: Row) => m.first_name === "Ada").whatsapp).toBeNull();
    await k.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test-v3')", [ada]);
    // Nobody's id and no sealed note leave in the file
    for (const m of sheet.members) {
      expect(m).not.toHaveProperty("person_id");
      expect(m).not.toHaveProperty("note_enc");
    }
    expect(JSON.stringify(sheet)).not.toContain(yaw);
    expect(sheet.tribe).toMatchObject({ name: "Alpha Tribe" });
  });

  it("gives the assistant the same sheet and a stranger nothing", async () => {
    expect((await as(assistant1, "export_tribe_sheet", t1)).members).toHaveLength(2);
    await expectCode(as(leader2, "export_tribe_sheet", t1), "42501");
  });

  it("makes the register from the same names, without the young member, with the season's weeks", async () => {
    const reg = await as(leader1, "export_attendance_register", t1);
    expect(reg.members.map((m: Row) => m.first_name).sort()).toEqual(["Ada", "Bola"]);
    expect(reg.young_count).toBe(1);
    expect(reg.tribe).toMatchObject({ name: "Alpha Tribe", weeks: 12 });
    expect(reg.tribe.season_starts_on).toBeTruthy();
    expect(reg.members[0]).not.toHaveProperty("whatsapp");
  });

  it("never holds more than the screen does: the sheet is the roster the leader opens, minus members under 18", async () => {
    const roster = await as(leader1, "tribe_roster_marked", t1);
    const sheet = await as(leader1, "export_tribe_sheet", t1);
    const screen = roster.members.filter((m: Row) => m.person_id !== yaw).map((m: Row) => m.first_name).sort();
    expect(sheet.members.map((m: Row) => m.first_name).sort()).toEqual(screen);
    // Where the roster hides a number, the sheet hides it
    for (const m of roster.members) {
      const mine = sheet.members.find((x: Row) => x.first_name === m.first_name);
      if (mine) expect(mine.whatsapp ?? null).toEqual(m.whatsapp ?? null);
    }
  });

  it("lists the leaders for the pastors and directors, and the people with roles for the admin, never the owner", async () => {
    const leaders = await as(pastor, "export_leaders_roster", season);
    expect(leaders.rows.map((r: Row) => r.tribe).sort()).toEqual(["Alpha Tribe", "Beta Tribe"]);
    const alpha = leaders.rows.find((r: Row) => r.tribe === "Alpha Tribe");
    expect(alpha.coach).toMatch(/Coach/);
    expect(alpha.leader_certified).toBe(true);
    expect((await as(director, "export_leaders_roster", season)).rows).toHaveLength(2);
    await expectCode(as(admin, "export_leaders_roster", season), "42501");
    await expectCode(as(leader1, "export_leaders_roster", season), "42501");

    const people = await as(admin, "export_people_roles");
    const names = people.rows.map((r: Row) => r.name);
    expect(names.some((n: string) => /Admin/.test(n))).toBe(true);
    expect(names).not.toContain("The Owner");
    expect(names.some((n: string) => /Ada/.test(n))).toBe(false);
    for (const r of people.rows) expect(Object.keys(r).sort()).toEqual(["name", "roles", "since"]);
    await expectCode(as(director, "export_people_roles"), "42501");
  });
});

describe("the coded tables and the feeds", () => {
  beforeAll(async () => {
    await reset();
    await openDoors();
    await db.admin.query("select public.bi_refresh_all()");
  });

  it("gives the Open Data Pack tables to the data lead only while the pack and the door are open", async () => {
    await put("insight_feeds", "on");
    const tribes = await as(dataLead, "export_insight_table", "tribes");
    expect(tribes.rows.length).toBe(2);
    expect(tribes.refreshed_at).not.toBeNull();
    await expectCode(as(dataLead, "export_insight_table", "people"), "22023");
    await expectCode(as(leader1, "export_insight_table", "tribes"), "42501");
    await expectCode(as(pastor, "export_insight_table", "tribes"), "42501");
    await o.call("export_settings_save", json({ doors: ["standing_link"] }), null);
    await expectCode(as(dataLead, "export_insight_table", "tribes"), "42501");
    await o.call("export_settings_save", json({ doors: ["open_data_pack", "standing_link"] }), null);
  });

  it("leaves members under 18 out of the member table and counts them instead", async () => {
    const members = await as(dataLead, "export_insight_table", "members");
    const direct = await sql("select count(*)::int n from bi.members");
    expect(members.rows.length).toBe(direct[0].n - 1);
    expect(members.young_not_listed).toBe(1);
    const salt = (await sql("select salt from bi.config"))[0].salt;
    const youngKey = (await sql("select md5($1 || $2::text) k", [salt, yaw]))[0].k;
    expect(members.rows.map((r: Row) => r.member_key)).not.toContain(youngKey);
    expect(JSON.stringify(members)).not.toContain(yaw);
  });

  it("carries no name, email or free text in any of the seven tables", async () => {
    for (const t of ["members", "tribes", "weekly", "care_weekly", "messages_daily", "ai_fields", "kpi_daily"]) {
      const res = await as(dataLead, "export_insight_table", t);
      const text = JSON.stringify(res.rows);
      expect(text, t).not.toMatch(/Ada|Bola|Yaw|Chidi|@example\.org|Leader\d|Coach/);
    }
  });

  it("makes a standing link for one table, shown once, readable with no account, for 90 days", async () => {
    const made = await as(dataLead, "export_feed_create", "tribes", "Funder's sheet");
    expect(made.token).toMatch(/^[a-f0-9]{64}$/);
    const days = (new Date(made.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(JSON.stringify(await sql("select * from public.export_feed_links"))).not.toContain(made.token);

    const read = await db.asAnon((q) => q("select public.export_feed_read($1, $2) as r", [made.token, "tribes"]));
    expect(read.rows[0].r.rows.length).toBe(2);
    expect((await sql("select reads from public.export_feed_links"))[0].reads).toBe(1);
    // One table: the same secret does not open another
    const other = await db.asAnon((q) => q("select public.export_feed_read($1, $2) as r", [made.token, "members"]));
    expect(other.rows[0].r).toBeNull();
    // A guess learns nothing
    const guess = await db.asAnon((q) => q("select public.export_feed_read($1, $2) as r", ["a".repeat(64), "tribes"]));
    expect(guess.rows[0].r).toBeNull();
    expect((await db.asAnon((q) => q("select public.export_feed_read($1, $2) as r", ["nope", "tribes"]))).rows[0].r).toBeNull();

    const list = await as(dataLead, "export_feed_list");
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(made.token);
    expect(list[0]).toMatchObject({ table: "tribes", label: "Funder's sheet", live: true, reads: 1 });
  });

  it("stops at once when revoked, when the door or the pack is switched off, or after 90 days; renewing gives another 90", async () => {
    const link = await as(dataLead, "export_feed_create", "weekly", "Weekly");
    const read = async () => (await db.asAnon((q) => q("select public.export_feed_read($1, $2) as r", [link.token, "weekly"]))).rows[0].r;
    expect(await read()).not.toBeNull();

    await o.call("export_settings_save", json({ doors: ["open_data_pack"] }), null);
    expect(await read()).toBeNull();
    await o.call("export_settings_save", json({ doors: ["open_data_pack", "standing_link"] }), null);
    expect(await read()).not.toBeNull();
    await put("insight_feeds", "off", {}, null);
    expect(await read()).toBeNull();
    await put("insight_feeds", "on");
    expect(await read()).not.toBeNull();

    await k.sql("update public.export_feed_links set expires_at = now() - interval '1 hour' where id = $1", [link.id]);
    expect(await read()).toBeNull();
    await as(dataLead, "export_feed_renew", link.id);
    expect(await read()).not.toBeNull();
    const renewed = (await sql("select expires_at from public.export_feed_links where id = $1", [link.id]))[0];
    expect((new Date(renewed.expires_at).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(89.9);

    await as(dataLead, "export_feed_revoke", link.id);
    expect(await read()).toBeNull();
    await expectCode(as(dataLead, "export_feed_renew", link.id), "P0002");
  });

  it("lets a revoke through even when the pack is Off, and only for the roles that may make the pack", async () => {
    const link = await as(dataLead, "export_feed_create", "kpi_daily", "KPIs");
    await put("insight_feeds", "off", {}, null);
    await expectCode(as(leader1, "export_feed_revoke", link.id), "42501");
    await as(dataLead, "export_feed_revoke", link.id);
    await expectCode(as(pastor, "export_feed_create", "kpi_daily", "KPIs"), "42501");
    await put("insight_feeds", "on");
  });

  it("makes a standing link only once the pack is open beyond the testers", async () => {
    await put("insight_feeds", "rehearsal");
    await o.call("export_tester_set", dataLead, true);
    await expect(as(dataLead, "export_insight_table", "tribes")).resolves.toBeTruthy();
    await expectCode(as(dataLead, "export_feed_create", "tribes", "Try"), "42501");
    await put("insight_feeds", "on");
    await o.call("export_tester_set", dataLead, false);
  });

  it("gives the admin the message volumes from the reporting copy, counts only", async () => {
    await put("message_volumes", "on");
    const res = await as(admin, "export_message_volumes", null, null);
    expect(Object.keys(res).sort()).toEqual(["from", "refreshed_at", "rows", "to"]);
    for (const r of res.rows) expect(Object.keys(r).sort()).toEqual(["channel", "day", "messages", "status", "template"]);
    await expectCode(as(admin, "export_message_volumes", "2026-01-01", "2027-06-01"), "22023");
    await expectCode(as(director, "export_message_volumes", null, null), "42501");
  });
});

describe("how long the log is kept", () => {
  let token: string;
  const sweep = async (tok: string | null) => (await db.asAnon((q) => q("select public.worker_export_sweep($1) as r", [tok]))).rows[0]?.r;

  beforeAll(async () => {
    token = (await sql("select public.bootstrap_worker_token('exports') as t"))[0].t as string;
  });

  it("is cleared by the heartbeat's own door, which needs the sending token and no one else", async () => {
    await expectCode(db.asAnon((q) => q("select public.worker_export_sweep($1)", ["x".repeat(40)])), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_export_sweep(null)")), "42501");
    await expectCode(as(director, "worker_export_sweep", token), "42501");
    expect((await sql("select has_function_privilege('authenticated', 'public.worker_export_sweep(text)'::regprocedure, 'execute') as ok"))[0].ok).toBe(false);
    expect((await sql("select has_function_privilege('anon', 'public.export_retention(timestamptz, integer)'::regprocedure, 'execute') as ok"))[0].ok).toBe(false);
  });

  it("keeps the export log for two years and no longer, with the link of a removed line going too", async () => {
    await reset();
    await openDoors();
    await put("tribes_health", "on");
    const a = await as(director, "export_prepare", "tribes_health", "xlsx", null, "{}");
    const b = await as(director, "export_prepare", "tribes_health", "xlsx", null, "{}");
    await k.sql("update public.export_log set at = now() - interval '731 days' where id = $1", [a.export_id]);
    await k.sql("update public.export_switch_log set at = now() - interval '731 days' where id = (select min(id) from public.export_switch_log)");
    await k.sql("delete from public.calendar_runs where key like 'export-retention:%'");
    const out = await sweep(token);
    expect(out.export_retention_ran).toBe(true);
    expect(out.export_log_removed).toBeGreaterThanOrEqual(2);
    expect((await sql("select id from public.export_log")).map((r) => r.id)).toEqual([b.export_id]);
    expect((await sql("select count(*)::int n from public.export_links where export_id = $1", [a.export_id]))[0].n).toBe(0);
    expect((await sql("select count(*)::int n from public.export_links where export_id = $1", [b.export_id]))[0].n).toBe(1);
    // It says only how many it removed
    const ev = (await sql("select meta from public.event_log where action = 'retention.export_log' order by id desc limit 1"))[0];
    expect(Object.keys(ev.meta)).toEqual(["removed"]);
  });

  it("runs once a day, and leaves the platform's own clean-up as it was", async () => {
    expect(await sweep(token)).toEqual({ export_retention_ran: false });
    expect((await sql("select public.retention_periods() as p"))[0].p).toEqual({ guardian_days: 90, draft_days: 30, message_days: 90 });
    await k.sql("delete from public.calendar_runs where key like 'retention:%'");
    const out = (await sql("select public.retention_tick(now()) as r"))[0].r;
    for (const key of ["guardians_removed", "drafts_removed", "stories_cleared", "bare_messages_removed", "message_wording_cleared"]) expect(out).toHaveProperty(key);
    expect(out).not.toHaveProperty("export_log_removed");
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// Profiles and the Weekly Rhythm, stage 1: the Switchboard. What these prove:
//   * everything ships Off, and if the settings cannot be read, everything is Off
//   * every switch lives with the platform owner: nobody else can move one, in the function and not only on the screen
//   * the narrowest rule wins, a role filter narrows it, a function cannot be further open than the ones it needs (and cannot be closed
//     under one that needs it), a function whose stage has not shipped cannot be moved, and the hold-out never touches a tribe of young people
//   * the Master pause turns everything Off at once and putting it back puts everything back
//   * the log says who moved what and why, and everyone but the owner reads the owner as "an administrator"

let c: Cast;
let leader: string;
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (e: { code?: string }) => e.code ?? "error");

beforeAll(async () => {
  c = await makeCast();
  leader = c.seasoned.id;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

const state = (who: string, key: string) => c.as(who, "feature_state", key, null);
const PROFILE_KEYS = ["my_page", "details_check", "hold_card", "my_details", "my_story", "role_panels", "still_right"];
/** What the person is told for the functions of the profile stages (the ones added after them are checked on their own, below). */
const all = async (who: string) => {
  const everything = (await c.as(who, "my_features")) as Record<string, string>;
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, everything[k]]));
};
/** What every function of the profile stages says on a fresh board: Off, the four of stage 2 included. */
const OFF = { my_page: "off", details_check: "off", hold_card: "off", my_details: "off", my_story: "off", role_panels: "off", still_right: "off" };

describe("everything ships Off", () => {
  it("lists twenty-one functions, and only the seven that stages 1 and 2 build can be moved", async () => {
    const rows = await c.sql("select key, available, stage from public.feature_registry where stage <= 6 order by sort");
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.available).map((r) => r.key)).toEqual(["my_page", "details_check", "hold_card", "my_details", "my_story", "role_panels", "still_right"]);
    expect(rows.filter((r) => r.available).map((r) => r.stage)).toEqual([1, 1, 1, 2, 2, 2, 2]);
    expect(rows.filter((r) => !r.available).every((r) => r.stage >= 3)).toBe(true);
  });

  it("has no rule, no pause and no log, and everyone is told Off", async () => {
    expect((await c.one("select count(*)::int n from public.feature_settings")).n).toBe(0);
    expect((await c.one("select paused from public.feature_master")).paused).toBe(false);
    expect((await c.one("select count(*)::int n from public.feature_log")).n).toBe(0);
    for (const who of [leader, c.appointed.id, c.member, c.pastor, c.director, c.admin]) {
      expect(await all(who)).toEqual(OFF);
    }
    expect(await state(leader, "my_page")).toBe("off");
  });

  it("tells everyone Off for every function added after the profile stages too", async () => {
    for (const who of [leader, c.member, c.director, c.admin]) {
      const everything = (await c.as(who, "my_features")) as Record<string, string>;
      for (const [key, position] of Object.entries(everything)) expect(position, key).toBe("off");
    }
  });

  it("tells a visitor Off and a person only about themselves", async () => {
    expect(await c.as(leader, "feature_state", "my_page", c.member)).toBe("off");
    await c.open();
    expect(await c.as(leader, "feature_state", "my_page", c.member)).toBe("off");
    expect(await c.as(leader, "feature_state", "my_page", leader)).toBe("on");
    await expectCode(c.db.asAnon((q) => q("select public.my_features()")), "42501");
  });

  it("is Off when the settings cannot be read: the pause row gone, the registry row gone, a made-up name", async () => {
    await c.open();
    expect(await state(leader, "details_check")).toBe("on");
    // The pause row is gone: the platform cannot tell whether it is paused, so it says Off
    await c.db.admin.query("delete from public.feature_master");
    try {
      expect(await all(leader)).toEqual(OFF);
    } finally {
      await c.db.admin.query("insert into public.feature_master (id) values (true)");
    }
    expect(await state(leader, "my_page")).toBe("on");
    expect(await state(leader, "not_a_function")).toBe("off");
    expect((await c.one("select public.feature_state_of('my_page', null) as s")).s).toBe("off");
    // the registry row gone for one function
    await c.db.admin.query("update public.feature_registry set available = false where key = 'my_page'");
    try {
      expect(await state(leader, "my_page")).toBe("off");
    } finally {
      await c.db.admin.query("update public.feature_registry set available = true where key = 'my_page'");
    }
    expect(await state(leader, "my_page")).toBe("on");
  });

  it("keeps every table out of the API's reach, and every inner function out of every client's", async () => {
    const tables = ["feature_registry", "feature_settings", "feature_master", "feature_log", "profile_fact_registry", "profile_facts", "profile_fact_history", "profile_changes", "details_checks", "details_check_items", "details_check_tokens", "details_check_access"];
    for (const t of tables) {
      const r = await c.one(
        `select has_table_privilege('authenticated', 'public.${t}', 'select') a, has_table_privilege('anon', 'public.${t}', 'select') b,
                has_table_privilege('authenticated', 'public.${t}', 'insert') c, (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass) rls`,
      );
      expect(r, t).toEqual({ a: false, b: false, c: false, rls: true });
    }
    const inner = [
      "feature_state_of(text, uuid, integer)", "feature_rule_for(text, uuid)", "feature_held_back(uuid)", "feature_rank(text)", "feature_summary(text)",
      "profile_fact_answer(uuid, text, text, text, text)", "profile_fact_current(uuid, text)", "details_item_for_link(text)", "details_item_answer(uuid, text, text, text)",
      "details_token_mint(uuid, integer)", "details_plan_rows(jsonb, text[], boolean)", "tribes_hold_for_stage()", "messages_welcome_confirm()",
    ];
    for (const f of inner) {
      const r = await c.one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a, has_function_privilege('anon', 'public.${f}', 'execute') b`);
      expect(r, f).toEqual({ a: false, b: false });
    }
  });
});

describe("only the owner moves a switch", () => {
  it("refuses every other role, the owner's own sign-in that has not been unlocked, and a visitor", async () => {
    await c.reset();
    for (const who of [c.admin, c.director, c.pastor, leader, c.member]) {
      expect(await code(c.as(who, "god_feature_set", "my_page", "platform", null, "on", [], "Trying it with everyone", null)), "set").toBe("42501");
      expect(await code(c.as(who, "god_feature_master", true, null)), "master").toBe("42501");
      expect(await code(c.as(who, "god_feature_board")), "board").toBe("42501");
      expect(await code(c.as(who, "god_feature_log", 10)), "log").toBe("42501");
      expect(await code(c.as(who, "god_feature_find", "centre", "")), "find").toBe("42501");
    }
    const locked = await c.db.asUser(c.o.owner.id, (q) => q("select public.god_feature_board() as r"), { session: randomUUID() }).then(() => "ok", (e: { code?: string }) => e.code);
    expect(locked).toBe("42501");
    await expectCode(c.db.asAnon((q) => q("select public.god_feature_master(true, null)")), "42501");
    expect((await c.one("select count(*)::int n from public.feature_settings")).n).toBe(0);
    expect((await c.one("select paused from public.feature_master")).paused).toBe(false);
  });

  it("lets the unlocked owner read the whole page", async () => {
    const board = await c.o.call("god_feature_board");
    expect(board.paused).toBe(false);
    expect(board.features.filter((f: { stage: number }) => f.stage <= 6)).toHaveLength(21);
    const mine = board.features.find((f: { key: string }) => f.key === "details_check");
    expect(mine).toMatchObject({ available: true, summary: "off", depends: ["my_page"], rules: [] });
    // Every function reads Off on a fresh board, the hold too (its own default of Optional only means something once the Details check is open)
    expect(board.features.filter((f: { summary: string }) => f.summary !== "off")).toEqual([]);
  });

  it("says Off for the hold until the Details check is open, then follows its default, and never says Optional while nothing is held", async () => {
    const summary = async () => (await c.o.call("god_feature_board")).features.find((f: { key: string }) => f.key === "hold_card").summary;
    await c.reset();
    expect(await summary()).toBe("off");
    await c.set("my_page", "rehearsal");
    await c.set("details_check", "rehearsal");
    expect(await summary(), "only a rehearsal: nobody is held").toBe("off");
    await c.set("my_page", "on", { roles: ["leader"] });
    await c.set("details_check", "on", { roles: ["leader"] });
    expect(await summary(), "open for leaders: the hold's default now applies").toBe("optional");
    await c.set("hold_card", "off");
    expect(await summary(), "a rule that says Off is Off").toBe("off");
    await c.reset();
  });

  it("lets the pastor, a director and the admin read what is on and what moved, and nobody else", async () => {
    await c.open();
    for (const who of [c.pastor, c.director, c.admin]) {
      const r = await c.as(who, "features_overview");
      expect(r.features.find((f: { key: string }) => f.key === "my_page").summary).toBe("on");
      expect(r.log.length).toBeGreaterThanOrEqual(3);
    }
    for (const who of [leader, c.member]) expect(await code(c.as(who, "features_overview")), "overview").toBe("42501");
    await expectCode(c.db.asAnon((q) => q("select public.features_overview()")), "42501");
  });

  it("says 'an administrator' to everyone else, never the owner's name, and gives no way to move anything", async () => {
    const r = await c.as(c.admin, "features_overview");
    expect(new Set(r.log.map((l: { by: string }) => l.by))).toEqual(new Set(["an administrator"]));
    expect(JSON.stringify(r)).not.toMatch(/Owner|owner@/);
    const raw = await c.sql("select actor from public.feature_log limit 1");
    expect(raw[0].actor).toBe(c.o.owner.id);
  });
});

describe("what can be moved, and where", () => {
  it("cannot move a function whose stage has not shipped, and says when it arrives", async () => {
    await c.reset();
    await expect(c.set("photos", "on", { reason: "Everyone should have a face" })).rejects.toThrow(/arrives in stage 3/);
    await expect(c.set("weekly_rhythm", "rehearsal")).rejects.toThrow(/arrives in stage 5/);
    await expect(c.set("not_a_function", "on")).rejects.toThrow(/do not have that function/);
    expect((await c.one("select count(*)::int n from public.feature_settings")).n).toBe(0);
  });

  it("takes only the positions a function can hold", async () => {
    await c.reset();
    await expect(c.set("my_page", "optional")).rejects.toThrow(/That position is not one/);
    await expect(c.set("my_page", "required")).rejects.toThrow(/That position is not one/);
    await c.set("my_page", "rehearsal");
    await c.set("my_page", "on", { reason: "Everyone, from today" });
    await expect(c.set("details_check", "optional")).rejects.toThrow(/That position is not one/);
    await c.set("details_check", "rehearsal");
    await expect(c.set("hold_card", "rehearsal")).rejects.toThrow(/not one .* can take/);
    await expect(c.set("my_page", "on", { scope: "moon", reason: "Everyone, from today" })).rejects.toThrow(/Choose the whole church/);
    await expect(c.set("my_page", "on", { scope: "tribe", id: null })).rejects.toThrow(/Name the tribe/);
    await expect(c.set("my_page", "on", { scope: "platform", id: c.seasoned.tribe, reason: "Everyone, from today" })).rejects.toThrow(/church by leaving the scope empty/);
    await expect(c.set("my_page", "on", { scope: "tribe", id: NOBODY })).rejects.toThrow(/could not find that tribe/);
    await expect(c.set("my_page", "on", { roles: ["wizard"] })).rejects.toThrow(/not a role we have/);
    await expect(c.set("my_page", "on", { reason: "x".repeat(301), roles: ["leader"] })).rejects.toThrow(/under 300/);
  });

  it("asks for a reason, of at least eight characters, to open a function for the whole church, and for nothing narrower", async () => {
    await c.reset();
    await expect(c.set("my_page", "on")).rejects.toThrow(/Say why you are opening this for the whole church/);
    await expect(c.set("my_page", "on", { reason: "short" })).rejects.toThrow(/at least eight/);
    await c.set("my_page", "rehearsal");
    await c.set("my_page", "on", { roles: ["leader"] });
    await c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe });
    await c.set("my_page", "on", { reason: "Eight is enough" });
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'my_page'")).n).toBe(2);
  });

  it("does not let a function be further open than the ones it needs, at the same place, nor close one under another that needs it", async () => {
    await c.reset();
    await expect(c.set("details_check", "rehearsal")).rejects.toThrow(/Open My page .* first/);
    await c.set("my_page", "rehearsal");
    await c.set("details_check", "rehearsal");
    await expect(c.set("details_check", "on", { reason: "Everyone, from today" })).rejects.toThrow(/Open My page .* first/);
    await c.set("my_page", "on", { reason: "Everyone, from today" });
    await c.set("details_check", "on", { reason: "Everyone, from today" });
    await expect(c.set("hold_card", "required", { reason: "Everyone, from today" })).resolves.toMatchObject({ ok: true });
    await expect(c.set("my_page", "rehearsal")).rejects.toThrow(/Close Details Check from God Mode first/);
    await expect(c.set("details_check", "off")).rejects.toThrow(/Close .* first/);
    await c.set("hold_card", "off");
    await c.set("details_check", "off");
    await c.set("my_page", "rehearsal");
    expect(await state(leader, "my_page")).toBe("rehearsal");
  });

  it("checks a narrower rule against the same place: a tribe cannot open a function its own page does not have", async () => {
    await c.reset();
    await c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe });
    await c.set("details_check", "on", { scope: "tribe", id: c.seasoned.tribe });
    await expect(c.set("details_check", "on", { scope: "tribe", id: c.appointed.tribe })).rejects.toThrow(/Open My page .* first/);
    expect(await state(leader, "details_check")).toBe("on");
    expect(await state(c.appointed.id, "details_check")).toBe("off");
  });
});

describe("who a rule reaches", () => {
  it("lets the narrowest rule win: a person over a tribe over a community over a centre over the whole church", async () => {
    await c.reset();
    const centre = (await c.one("select centre_id from public.people where id = $1", [leader])).centre_id;
    const community = (await c.one("select community_id from public.tribes where id = $1", [c.seasoned.tribe])).community_id;
    await c.set("my_page", "on", { reason: "The whole church can see it" });
    expect(await state(leader, "my_page")).toBe("on");
    await c.set("my_page", "off", { scope: "centre", id: centre });
    expect(await state(leader, "my_page")).toBe("off");
    await c.set("my_page", "on", { scope: "community", id: community });
    expect(await state(leader, "my_page")).toBe("on");
    await c.set("my_page", "rehearsal", { scope: "tribe", id: c.seasoned.tribe });
    expect(await state(leader, "my_page")).toBe("rehearsal");
    await c.set("my_page", "on", { scope: "person", id: leader });
    expect(await state(leader, "my_page")).toBe("on");
    // the same rules for someone else
    expect(await state(c.member, "my_page")).toBe("off");
    expect(await state(c.seasoned.members[0], "my_page")).toBe("rehearsal");
  });

  it("narrows a rule to a role: On for leaders is On for leaders and nobody else", async () => {
    await c.reset();
    await c.set("my_page", "on", { roles: ["leader"] });
    expect(await state(leader, "my_page")).toBe("on");
    expect(await state(c.appointed.id, "my_page")).toBe("on");
    for (const who of [c.member, c.pastor, c.admin, c.seasoned.members[0]]) expect(await state(who, "my_page"), who).toBe("off");
    await c.set("my_page", "on", { roles: ["leader", "pastor"] });
    expect(await state(c.pastor, "my_page")).toBe("on");
    expect(await state(c.admin, "my_page")).toBe("off");
    expect(await state(c.member, "my_page")).toBe("off");
  });

  it("lets a rehearsal follow a rehearsal, and holds a function at the pace of the one it needs", async () => {
    await c.reset();
    await c.set("my_page", "rehearsal");
    await c.set("details_check", "rehearsal");
    expect(await all(leader)).toEqual({ ...OFF, my_page: "rehearsal", details_check: "rehearsal" });
    // a rule that is wider elsewhere cannot make a function more open than the one it needs for this person
    await c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe });
    await c.set("details_check", "on", { scope: "tribe", id: c.seasoned.tribe });
    await c.db.admin.query("update public.feature_settings set position = 'rehearsal' where feature = 'my_page' and scope = 'tribe'");
    expect(await state(leader, "details_check")).toBe("rehearsal");
    await c.db.admin.query("update public.feature_settings set position = 'off' where feature = 'my_page' and scope = 'tribe'");
    expect(await state(leader, "details_check")).toBe("off");
  });

  it("holds back one tribe in ten, by a fixed rule, until the day set, and never a tribe of young people", async () => {
    await c.reset();
    // Find a tribe the rule holds back and one it does not: tribes are made until both exist
    const held: { id: string; leader: string }[] = [];
    const free: { id: string; leader: string }[] = [];
    for (let i = 0; i < 80 && (held.length === 0 || free.length === 0); i++) {
      const t = await c.k.tribe(c.season, { name: `Held ${i}`, community: "professionals" });
      const h = (await c.one("select abs(hashtextextended($1::text, 0)) % 10 = 0 as h", [t.tribe])).h as boolean;
      (h ? held : free).push({ id: t.tribe, leader: t.leader.id });
    }
    expect(held.length).toBeGreaterThan(0);
    expect(free.length).toBeGreaterThan(0);
    const community = (await c.one("select community_id from public.tribes where id = $1", [held[0].id])).community_id;
    const tomorrow = (await c.one("select (public.today_lagos() + 1)::text as d")).d;
    await c.set("my_page", "on", { scope: "community", id: community, reason: "One community first", holdout: tomorrow });
    expect(await state(held[0].leader, "my_page")).toBe("off");
    expect(await state(free[0].leader, "my_page")).toBe("on");
    // a tribe of young people is never the one held back
    await c.db.admin.query("update public.tribes set track_id = (select id from public.tracks where slug = 'teens') where id = $1", [held[0].id]);
    expect(await state(held[0].leader, "my_page")).toBe("on");
    await c.db.admin.query("update public.tribes set track_id = (select id from public.tracks where slug = 'builders') where id = $1", [held[0].id]);
    expect(await state(held[0].leader, "my_page")).toBe("off");
    // the day passes
    await c.set("my_page", "on", { scope: "community", id: community, reason: "One community first", holdout: (await c.one("select (public.today_lagos() - 1)::text as d")).d });
    expect(await state(held[0].leader, "my_page")).toBe("on");
  });

  it("holds back only for the whole church or one community, and only when the function is open", async () => {
    await c.reset();
    await expect(c.set("my_page", "rehearsal", { holdout: "2030-01-01" })).rejects.toThrow(/only for a function opened for the whole church or a community/);
    await expect(c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe, holdout: "2030-01-01" })).rejects.toThrow(/only for a function opened/);
    await expect(c.set("my_page", "on", { scope: "person", id: leader, holdout: "2030-01-01" })).rejects.toThrow(/only for a function opened/);
  });

  it("shows the hold function Off while the Details Check is, however it is set", async () => {
    await c.open("required");
    expect(await state(leader, "hold_card")).toBe("required");
    await c.db.admin.query("update public.feature_settings set position = 'rehearsal' where feature = 'details_check'");
    expect(await state(leader, "hold_card")).toBe("off");
    await c.db.admin.query("update public.feature_settings set position = 'off' where feature = 'details_check'");
    expect(await state(leader, "hold_card")).toBe("off");
  });
});

describe("the Master pause", () => {
  it("turns every function Off at once, deletes nothing, and puts everything back with one more press", async () => {
    await c.open("required");
    const before = await c.sql("select feature, scope, position from public.feature_settings order by feature");
    expect(await all(leader)).toEqual({ ...OFF, my_page: "on", details_check: "on", hold_card: "required" });
    expect(await c.o.call("god_feature_master", true, "Something looks wrong")).toEqual({ ok: true, changed: true });
    expect(await all(leader)).toEqual(OFF);
    expect(await state(c.appointed.id, "my_page")).toBe("off");
    expect(await c.sql("select feature, scope, position from public.feature_settings order by feature")).toEqual(before);
    expect(await c.o.call("god_feature_master", true, "Pressed twice")).toEqual({ ok: true, changed: false });
    expect(await c.o.call("god_feature_master", false, "All is well")).toEqual({ ok: true, changed: true });
    expect(await all(leader)).toEqual({ ...OFF, my_page: "on", details_check: "on", hold_card: "required" });
  });

  it("stops a function that is being used: a private link says nothing while it is paused", async () => {
    await c.open();
    await c.o.call("god_feature_master", true, "Paused to look at something");
    expect(await c.o.call("god_feature_board")).toMatchObject({ paused: true, pausedReason: "Paused to look at something" });
    await expect(c.o.call("god_details_send", JSON.stringify({ kind: "appointed" }), ["life_stage"], "live")).rejects.toThrow(/Master pause is on/);
    await c.o.call("god_feature_master", false, null);
  });

  it("logs each press, and takes a reason of at most 300 characters", async () => {
    await c.reset();
    await c.o.call("god_feature_master", true, "First press");
    await c.o.call("god_feature_master", false, null);
    const log = await c.o.call("god_feature_log", 10);
    expect(log.map((l: { from: string; to: string }) => [l.from, l.to])).toEqual([["paused", "running"], ["running", "paused"]]);
    expect(log[1]).toMatchObject({ feature: null, name: null, label: "Every new function", reason: "First press" });
    await expect(c.o.call("god_feature_master", true, "x".repeat(301))).rejects.toThrow(/under 300/);
    await expect(c.o.call("god_feature_master", null, null)).rejects.toThrow(/Say whether to pause/);
  });
});

describe("the log and taking a rule away", () => {
  it("writes who, what, where and why for every move, and nothing when nothing changed", async () => {
    await c.reset();
    await c.set("my_page", "rehearsal", { reason: "A quiet start" });
    expect(await c.set("my_page", "rehearsal", { reason: "A quiet start" })).toEqual({ ok: true, changed: false });
    await c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe, reason: "One tribe first" });
    await c.set("my_page", "on", { scope: "person", id: leader, roles: ["leader"] });
    const log = await c.o.call("god_feature_log", 50);
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ name: "My page (facts and role panels)", scope: "person", to: "on", roles: ["leader"] });
    expect(log[1]).toMatchObject({ scope: "tribe", label: "Seasoned Tribe", from: "off", to: "on", reason: "One tribe first" });
    expect(log[2]).toMatchObject({ scope: "platform", label: "The whole church", from: "off", to: "rehearsal", reason: "A quiet start" });
    const raw = await c.sql("select actor from public.feature_log");
    expect(raw.every((r) => r.actor === c.o.owner.id)).toBe(true);
  });

  it("takes one rule away so the function goes back to what the wider rule says, and refuses while another needs it", async () => {
    await c.reset();
    await c.set("my_page", "on", { reason: "The whole church" });
    await c.set("my_page", "off", { scope: "tribe", id: c.seasoned.tribe });
    expect(await state(leader, "my_page")).toBe("off");
    const rule = (await c.one("select id from public.feature_settings where scope = 'tribe'")).id;
    expect(await c.o.call("god_feature_remove", rule, "Back to the church-wide rule")).toEqual({ ok: true });
    expect(await state(leader, "my_page")).toBe("on");
    await c.set("details_check", "on", { reason: "The whole church" });
    const base = (await c.one("select id from public.feature_settings where feature = 'my_page'")).id;
    await expect(c.o.call("god_feature_remove", base, null)).rejects.toThrow(/Close Details Check from God Mode first/);
    await expectCode(c.o.call("god_feature_remove", NOBODY, null), "P0002");
    const log = await c.o.call("god_feature_log", 10);
    expect(log[0]).toMatchObject({ to: "on", scope: "platform" });
    // taking a rule away is logged as what the function became at that place
    expect(log.find((l: { reason: string }) => l.reason === "Back to the church-wide rule")).toMatchObject({ scope: "tribe", from: "off", to: "on" });
  });

  it("finds a centre, a community, a tribe or a person to name, never more than eight, and never the owner", async () => {
    expect((await c.o.call("god_feature_find", "centre", "")).length).toBeGreaterThanOrEqual(1);
    expect((await c.o.call("god_feature_find", "community", "")).length).toBeGreaterThanOrEqual(1);
    expect(await c.o.call("god_feature_find", "tribe", "S")).toEqual([]);
    expect((await c.o.call("god_feature_find", "tribe", "Seasoned"))[0]).toMatchObject({ id: c.seasoned.tribe });
    const people = await c.o.call("god_feature_find", "person", "Test");
    expect(people.length).toBeGreaterThan(0);
    expect(people.length).toBeLessThanOrEqual(8);
    expect(JSON.stringify(people)).not.toMatch(/The Owner/);
    expect(await c.o.call("god_feature_find", "person", "Owner")).toEqual([]);
    await expect(c.o.call("god_feature_find", "planet", "x")).rejects.toThrow(/Choose centre, community, tribe or person/);
  });

  it("tells the board what each function needs, and lists each rule in order from the whole church down", async () => {
    await c.reset();
    await c.set("my_page", "on", { scope: "person", id: leader });
    await c.set("my_page", "rehearsal", { reason: "A quiet start" });
    await c.set("my_page", "on", { scope: "tribe", id: c.seasoned.tribe });
    const board = await c.o.call("god_feature_board");
    const row = board.features.find((f: { key: string }) => f.key === "my_page");
    expect(row.rules.map((r: { scope: string }) => r.scope)).toEqual(["platform", "tribe", "person"]);
    expect(row.summary).toBe("limited");
    expect(board.features.find((f: { key: string }) => f.key === "details_check").depends).toEqual(["my_page"]);
    expect(board.features.find((f: { key: string }) => f.key === "hold_card").modes).toEqual(["off", "optional", "required"]);
  });
});

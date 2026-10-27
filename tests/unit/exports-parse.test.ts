import { describe, expect, it } from "vitest";
import { feedPath, feedUrl, fileHref, isToken, nameFromDisposition, printHref } from "@/lib/exports/links";
import { isPackId, parseBoard, parseFeedLinks, parseLog, parseMyExports, parseOpened, parseOptions, parsePrepared } from "@/lib/exports/parse";
import { describeSwitch, lagosWhen, roleName } from "@/lib/exports/wording";

const TOKEN = "0123456789abcdef".repeat(4);

describe("reading what the database says", () => {
  it("reads the Studio's options, and drops anything it does not recognise", () => {
    const o = parseOptions({
      open: true,
      formats: ["xlsx", "pdf", "docx"],
      purposes: [{ key: "planning", label: "Planning" }, { key: "gossip", label: "No" }],
      seasons: [{ id: "s1", name: "Season 3", starts_on: "2026-09-01" }, { name: "no id" }],
      packs: [
        { id: "tribe_sheet", name: "Tribe sheet", lane: "people", scope: "tribe", formats: ["xlsx"], rehearsal: false, targets: [{ id: "t1", name: "Alpha", community: "Gospel" }, { name: "no id" }] },
        { id: "made_up_pack", name: "Nope", lane: "people", scope: "tribe", formats: ["xlsx"] },
        { id: "tribes_health", name: "Tribes health", lane: "weird", scope: "church", formats: ["xlsx"] },
      ],
    });
    expect(o?.packs.map((p) => p.id)).toEqual(["tribe_sheet"]);
    expect(o?.packs[0].targets).toEqual([{ id: "t1", name: "Alpha", community: "Gospel" }]);
    expect(o?.formats).toEqual(["xlsx", "pdf"]);
    expect(o?.purposes).toEqual([{ key: "planning", label: "Planning" }]);
    expect(o?.seasons).toHaveLength(1);
    expect(o?.open).toBe(true);
  });

  it("treats anything that is not an object as nothing", () => {
    for (const v of [null, undefined, 3, "x", []]) {
      expect(parseOptions(v)).toBeNull();
      expect(parseBoard(v)).toBeNull();
      expect(parseOpened(v)).toBeNull();
      expect(parsePrepared(v)).toBeNull();
    }
    expect(parseMyExports("nope")).toEqual([]);
    expect(parseFeedLinks(null)).toEqual([]);
    expect(parseLog({})).toEqual([]);
  });

  it("accepts a prepared link only when its secret has the right shape", () => {
    expect(parsePrepared({ export_id: "e1", token: TOKEN, expires_at: "2026-10-28T00:00:00Z", rehearsal: true })).toEqual({ export_id: "e1", token: TOKEN, expires_at: "2026-10-28T00:00:00Z", rehearsal: true });
    expect(parsePrepared({ export_id: "e1", token: "short" })).toBeNull();
    expect(parsePrepared({ export_id: "e1", token: TOKEN.toUpperCase() })).toBeNull();
  });

  it("reads the files a person made, the links that exist and the owner's log", () => {
    const mine = parseMyExports([
      { id: "a", at: "2026-10-27T01:00:00Z", pack: "tribe_sheet", name: "Tribe sheet", lane: "people", format: "xlsx", purpose: "planning", rows: 12, status: "delivered", rehearsal: false, active: true, expires_at: "2026-10-28T01:00:00Z" },
      { id: "b", pack: "tribe_sheet", lane: "people", format: "xlsx", status: "melted" },
    ]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ rows: 12, active: true, purpose: "planning" });
    const feeds = parseFeedLinks([
      { id: "f", table: "kpi_daily", label: "Board", by: "A", created_at: "x", expires_at: "y", revoked_at: null, last_read_at: null, reads: 3, live: true },
      { id: "g", table: "secrets", label: "x" },
    ]);
    expect(feeds.map((f) => f.id)).toEqual(["f"]);
    const log = parseLog([{ id: "l", at: "x", who: "Ada", role: "leader", pack: "tribe_sheet", name: "Tribe sheet", lane: "people", format: "xlsx", position: "on", rehearsal: false, purpose: "planning", rows: 2, status: "delivered", flagged: null, filters: { tribe: "t1", extra: "dropped" } }]);
    expect(log[0].filters).toEqual({ tribe: "t1", community: undefined, season: undefined, report: undefined, success: undefined });
  });

  it("reads the switchboard, and refuses an answer with no settings", () => {
    expect(parseBoard({ packs: [] })).toBeNull();
    const b = parseBoard({
      settings: { paused: true, people_stopped: false, unusual_per_hour: 7, formats: ["xlsx", "tiff"], deliveries: ["download"], doors: [], people_cleared_on: "2026-10-26", updated_at: null },
      packs: [
        { id: "tribe_sheet", name: "Tribe sheet", lane: "people", scope: "tribe", roles: ["leader"], formats: ["xlsx"], released: true, position: "limited", in_force: "off", limited_roles: ["leader"], limited_communities: [], limited_tribes: ["t1"], rehearsed_at: "x", changed_at: "y", reason: "why not", made_30d: 4, by_role: { leader: 4, bad: "x" } },
        { id: "tribe_sheet", position: "sideways", lane: "people", scope: "tribe" },
      ],
      testers: [{ person_id: "p", name: "Ada", roles: "leader", added_at: "z" }, { name: "no id" }],
      changes: [{ at: "t", what: "setting:paused", was: "false", now: "true", reason: null }],
      unusual: [{ at: "t", who: "Ada", pack: "tribe_sheet", role: "leader" }, { at: "t", who: "X", pack: "not_a_pack", role: "r" }],
      feeds_live: 1,
      links_live: 2,
      communities: [{ id: "c", name: "Gospel" }],
      tribes: [{ id: "t1", name: "Alpha", community: "Gospel" }],
    });
    expect(b?.settings).toMatchObject({ paused: true, unusual_per_hour: 7, formats: ["xlsx"], people_cleared_on: "2026-10-26" });
    expect(b?.packs).toHaveLength(1);
    expect(b?.packs[0]).toMatchObject({ position: "limited", in_force: "off", by_role: { leader: 4 }, made_30d: 4 });
    expect(b?.testers).toHaveLength(1);
    expect(b?.unusual).toHaveLength(1);
    expect(b).toMatchObject({ feeds_live: 1, links_live: 2 });
  });

  it("knows a pack's name when it sees one", () => {
    expect(isPackId("tribe_sheet")).toBe(true);
    expect(isPackId("TRIBE_SHEET")).toBe(false);
    expect(isPackId(null)).toBe(false);
  });
});

describe("links", () => {
  it("accepts only a secret of 64 lower-case hexadecimal characters", () => {
    expect(isToken(TOKEN)).toBe(true);
    for (const bad of ["", "abc", TOKEN + "0", TOKEN.slice(1), TOKEN.toUpperCase(), `${TOKEN.slice(1)}g`, null, 12]) expect(isToken(bad)).toBe(false);
  });

  it("builds the addresses, and never a double slash", () => {
    expect(fileHref(TOKEN)).toBe(`/exports/file/${TOKEN}`);
    expect(printHref(TOKEN)).toBe(`/exports/print/${TOKEN}`);
    expect(feedPath(TOKEN, "kpi_daily")).toBe(`/feeds/${TOKEN}/kpi_daily`);
    expect(feedUrl("https://app.example.org/", TOKEN, "members")).toBe(`https://app.example.org/feeds/${TOKEN}/members`);
  });

  it("takes a file's name from the header only when it is a plain name", () => {
    expect(nameFromDisposition('attachment; filename="united-tribes-tribe-sheet-2026-10-27.xlsx"', "x")).toBe("united-tribes-tribe-sheet-2026-10-27.xlsx");
    expect(nameFromDisposition('attachment; filename="../../etc/passwd"', "fallback.xlsx")).toBe("fallback.xlsx");
    expect(nameFromDisposition('attachment; filename="a b.xlsx"', "fallback.xlsx")).toBe("fallback.xlsx");
    expect(nameFromDisposition(null, "fallback.xlsx")).toBe("fallback.xlsx");
  });
});

describe("words", () => {
  it("says a log line in words, and never shows a person's id", () => {
    expect(describeSwitch("pack:tribe_sheet", { tribe_sheet: "Tribe sheet" })).toBe("Tribe sheet pack");
    expect(describeSwitch("pack:people_roles")).toBe("people roles pack");
    expect(describeSwitch("setting:paused")).toBe("Pause all exports");
    expect(describeSwitch("tester:3f2c0c9e-0000-4000-8000-000000000000")).toBe("Tester");
    expect(describeSwitch("setting:something_new")).toBe("setting something new");
  });

  it("shows Lagos time and a role's name", () => {
    expect(lagosWhen("2026-10-27T01:30:00Z")).toBe("Tue 27 Oct, 2:30 am");
    expect(lagosWhen("2026-10-27T01:30:00Z", true)).toBe("Tue 27 Oct 2026, 2:30 am");
    expect(roleName("data_lead")).toBe("Data lead");
    expect(roleName("something_else")).toBe("something else");
  });
});

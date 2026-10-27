import { describe, expect, it } from "vitest";
import { ExportError, fileName, loadWorkbook, makeFile, XLSX_TYPE, type Rpc } from "@/lib/exports/load";
import { FEED_TABLES, type Opened, type PackId } from "@/lib/exports/types";
import { readXlsx } from "@/lib/leaders/referee/sheet/xlsx";
import { readZip } from "@/lib/leaders/referee/sheet/zip";

const opened = (pack: PackId, extra: Partial<Opened> = {}): Opened => ({
  export_id: "0b1f6c7a-1111-4222-8333-444455556666", pack, pack_name: pack, lane: "people", format: "xlsx", purpose: "planning", filters: {}, role: "leader",
  rehearsal: false, made_at: "2026-10-27T03:07:00Z", expires_at: "2026-10-28T03:07:00Z", who: "Ada Okafor", ...extra,
});

const made = new Date("2026-10-27T03:07:00Z");

function fake(answers: Record<string, unknown>, errors: Record<string, { message: string; code?: string }> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args = {}) => {
    calls.push({ fn, args });
    return errors[fn] ? { data: null, error: errors[fn] } : { data: answers[fn] ?? null, error: null };
  };
  return { rpc, calls };
}

const TRIBE = "11111111-1111-4111-8111-111111111111";
const sheet = { tribe: { name: "Alpha Tribe", community: "Gospel", season: "Season 3" }, members: [{ name: "Ada Okafor", first_name: "Ada", whatsapp: null, joined_at: "2026-09-14T10:00:00Z" }], young_count: 0 };

describe("making a file from an opened link", () => {
  it("asks the database for the tribe the link was made for, as the person, and makes an Excel file", async () => {
    const { rpc, calls } = fake({ export_tribe_sheet: sheet });
    const f = await makeFile(rpc, opened("tribe_sheet", { filters: { tribe: TRIBE } }), made);
    expect(calls).toEqual([{ fn: "export_tribe_sheet", args: { p_tribe: TRIBE } }]);
    expect(f.contentType).toBe(XLSX_TYPE);
    expect(f.filename).toBe("united-tribes-tribe-sheet-alpha-tribe-2026-10-27.xlsx");
    expect(f.rows).toBe(1);
    expect(readXlsx(f.body).map((s) => s.name)).toEqual(["About", "Members", "Dictionary"]);
  });

  it("marks a rehearsal file in its name", async () => {
    const { rpc } = fake({ export_tribe_sheet: sheet });
    const f = await makeFile(rpc, opened("tribe_sheet", { filters: { tribe: TRIBE }, rehearsal: true }), made);
    expect(f.filename.startsWith("REHEARSAL-united-tribes-")).toBe(true);
  });

  it("will not ask for a tribe, a community or a season the link was not made for", async () => {
    const { rpc, calls } = fake({});
    await expect(makeFile(rpc, opened("tribe_sheet"), made)).rejects.toMatchObject({ status: 400, message: "Choose a tribe first." });
    await expect(makeFile(rpc, opened("community_report", { lane: "insight", format: "xlsx" }), made)).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("turns the database's refusals into the right status, with its own words", async () => {
    for (const [code, status] of [["42501", 403], ["P0002", 404], ["XX000", 502]] as const) {
      const { rpc } = fake({}, { export_people_roles: { message: "Your role does not include this file", code } });
      await expect(makeFile(rpc, opened("people_roles", { role: "admin" }), made)).rejects.toMatchObject({ status, message: "Your role does not include this file" });
    }
    await expect(makeFile(fake({}, { export_people_roles: { message: "" } }).rpc, opened("people_roles"), made)).rejects.toThrow(/could not be made just now/);
    expect(new ExportError("x", 418).status).toBe(418);
  });

  it("calls the same functions the screens call for the packs that are the screens as a file", async () => {
    const dash = { state: "none", targets: {} };
    const cases: [PackId, string[]][] = [
      ["my_tribes_glance", ["dashboard"]],
      ["tribes_health", ["dashboard"]],
      ["supply_demand", ["dashboard"]],
      ["programme_report", ["dashboard", "insight"]],
      ["pastorate_one_pager", ["dashboard", "insight"]],
      ["leaders_roster", ["export_leaders_roster"]],
      ["message_volumes", ["export_message_volumes"]],
    ];
    for (const [pack, fns] of cases) {
      const { rpc, calls } = fake({ dashboard: dash, insight: { state: "none", targets: {} }, export_leaders_roster: { rows: [] }, export_message_volumes: { rows: [] } });
      await loadWorkbook(rpc, opened(pack, { lane: "insight", filters: { season: "s1" } }), made);
      expect(calls.map((c) => c.fn).sort(), pack).toEqual(fns.sort());
      if (fns.includes("dashboard")) expect(calls.find((c) => c.fn === "dashboard")!.args).toEqual({ p_season: "s1" });
    }
    const { rpc, calls } = fake({ community_dashboard: { state: "none", community: { id: "c", name: "Gospel" } } });
    await loadWorkbook(rpc, opened("community_report", { lane: "insight", filters: { community: "c" } }), made);
    expect(calls).toEqual([{ fn: "community_dashboard", args: { p_community: "c", p_season: null } }]);
  });

  it("makes the Open Data Pack from the seven tables, as a zip", async () => {
    const answers: Record<string, unknown> = {};
    const { rpc, calls } = fake(answers);
    const wrapped: Rpc = (fn, args) => (fn === "export_insight_table" ? Promise.resolve({ data: { table: args?.p_table, rows: [], young_not_listed: 0, refreshed_at: null }, error: null }).then((r) => { calls.push({ fn, args: args ?? {} }); return r; }) : rpc(fn, args));
    const f = await makeFile(wrapped, opened("insight_feeds", { lane: "insight", format: "csv", role: "data_lead", purpose: null }), made);
    expect(f.contentType).toBe("application/zip");
    expect(f.filename).toBe("united-tribes-open-data-pack-2026-10-27.zip");
    expect(calls.map((c) => c.args.p_table)).toEqual(FEED_TABLES);
    expect([...readZip(f.body).keys()]).toContain("manifest.json");
  });

  it("does not make a printed page or a pack of a later release as a download", async () => {
    const { rpc } = fake({});
    await expect(makeFile(rpc, opened("attendance_register", { format: "pdf", filters: { tribe: TRIBE } }), made)).rejects.toMatchObject({ status: 400 });
    await expect(makeFile(rpc, opened("know_your_tribe", { format: "xlsx" }), made)).rejects.toMatchObject({ status: 404 });
    await expect(makeFile(rpc, opened("my_data_pack", { format: "xlsx" }), made)).rejects.toMatchObject({ status: 404 });
  });

  it("names a file after what it is and when, never after a person", () => {
    expect(fileName(opened("people_roles"), null, made, "xlsx")).toBe("united-tribes-people-and-roles-2026-10-27.xlsx");
    expect(fileName(opened("tribe_sheet"), "Ọmọ's Tribe / 2", made, "xlsx")).toBe("united-tribes-tribe-sheet-omo-s-tribe-2-2026-10-27.xlsx");
  });
});

import { buildXlsx } from "./xlsx";
import {
  buildAttendanceRegister, buildCommunityReport, buildLeadersRoster, buildMessageVolumes, buildPastorateOnePager, buildPeopleRoles,
  buildProgrammeReport, buildSupplyDemand, buildTribesGlance, buildTribesHealth, buildTribeSheet, type Ctx,
} from "./builders";
import { openDataPack } from "./feeds";
import { lagosDay, slug, type Workbook } from "./model";
import { packInfo } from "./registry";
import { FEED_TABLES, type Opened, type TableRows } from "./types";
import type { CommunityPage, Insight } from "@/lib/dashboard/insight";
import type { Dashboard } from "@/lib/dashboard/types";

/**
 * From a link that has been opened to the file. The database has already checked who is asking and that the pack is open; every
 * source below is called as that same person, so the database applies its own rules to each one a second time.
 */

export type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

export class ExportError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

async function call<T>(rpc: Rpc, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 502;
    throw new ExportError(error.message || "The file could not be made just now. Try again in a moment.", status);
  }
  return data as T;
}

const need = (v: string | undefined, what: string): string => {
  if (!v) throw new ExportError(`Choose ${what} first.`, 400);
  return v;
};

/** The typed tables of every pack that is a spreadsheet or a printed page. */
export async function loadWorkbook(rpc: Rpc, o: Opened, made: Date): Promise<Workbook> {
  const ctx: Ctx = { opened: o, made };
  const season = o.filters.season ?? null;
  switch (o.pack) {
    case "tribe_sheet":
      return buildTribeSheet(ctx, await call(rpc, "export_tribe_sheet", { p_tribe: need(o.filters.tribe, "a tribe") }));
    case "attendance_register":
      return buildAttendanceRegister(ctx, await call(rpc, "export_attendance_register", { p_tribe: need(o.filters.tribe, "a tribe") }));
    case "leaders_roster":
      return buildLeadersRoster(ctx, await call(rpc, "export_leaders_roster", { p_season: season }));
    case "people_roles":
      return buildPeopleRoles(ctx, await call(rpc, "export_people_roles"));
    case "message_volumes":
      return buildMessageVolumes(ctx, await call(rpc, "export_message_volumes", { p_from: null, p_to: null }));
    case "my_tribes_glance":
      return buildTribesGlance(ctx, await call<Dashboard | null>(rpc, "dashboard", { p_season: season }));
    case "tribes_health":
      return buildTribesHealth(ctx, await call<Dashboard | null>(rpc, "dashboard", { p_season: season }));
    case "supply_demand":
      return buildSupplyDemand(ctx, await call<Dashboard | null>(rpc, "dashboard", { p_season: season }));
    case "programme_report": {
      const [d, i] = await Promise.all([call<Dashboard | null>(rpc, "dashboard", { p_season: season }), call<Insight | null>(rpc, "insight", { p_season: season })]);
      return buildProgrammeReport(ctx, d, i);
    }
    case "pastorate_one_pager": {
      const [d, i] = await Promise.all([call<Dashboard | null>(rpc, "dashboard", { p_season: season }), call<Insight | null>(rpc, "insight", { p_season: season })]);
      return buildPastorateOnePager(ctx, d, i);
    }
    case "community_report":
      return buildCommunityReport(ctx, await call<CommunityPage | null>(rpc, "community_dashboard", { p_community: need(o.filters.community, "a community"), p_season: season }));
    default:
      throw new ExportError("This file is not available yet.", 404);
  }
}

export const rowTotal = (w: Workbook): number => w.tables.reduce((n, t) => n + t.rows.length, 0);

export type MadeFile = { filename: string; contentType: string; body: Buffer; rows: number };

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A name for the file a person saves: says what it is and when, and never a name of a person. */
export function fileName(o: Opened, scope: string | null, made: Date, ext: string): string {
  const info = packInfo(o.pack);
  const parts = [o.rehearsal ? "REHEARSAL" : null, "united-tribes", info?.stem ?? slug(o.pack_name), scope ? slug(scope, 30) : null, lagosDay(made)].filter(Boolean);
  return `${parts.join("-")}.${ext}`;
}

/** The scope of a file for its name: the tribe, community or season it is about. */
const scopeOf = (w: Workbook): string | null => w.facts.find(([k]) => k === "Tribe" || k === "Community")?.[1] ?? null;

/** Makes the downloadable file (Excel, or the Open Data Pack's zip). A printed page is made by the print view, not here. */
export async function makeFile(rpc: Rpc, o: Opened, made: Date = new Date()): Promise<MadeFile> {
  if (o.pack === "insight_feeds") {
    const tables: TableRows[] = [];
    for (const t of FEED_TABLES) tables.push(await call<TableRows>(rpc, "export_insight_table", { p_table: t }));
    return {
      filename: fileName(o, null, made, "zip"),
      contentType: "application/zip",
      body: openDataPack(tables, made, o.export_id),
      rows: tables.reduce((n, t) => n + t.rows.length, 0),
    };
  }
  if (o.format !== "xlsx") throw new ExportError("This file is not made as a download.", 400);
  const w = await loadWorkbook(rpc, o, made);
  return { filename: fileName(o, scopeOf(w), made, "xlsx"), contentType: XLSX_TYPE, body: buildXlsx(w), rows: rowTotal(w) };
}

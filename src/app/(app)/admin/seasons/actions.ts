"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { SEASON_STATUSES } from "@/lib/admin/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/seasons", "/admin"];

/** Plans a season (id null) or edits one. The database checks that it starts on a Sunday, does not overlap, and may still move. */
export async function saveSeasonAction(id: string | null, name: string, starts: string, weeks: number, series: string): Promise<Result> {
  if (id !== null && !isUuid(id)) return { ok: false, message: TRY_AGAIN };
  if (typeof starts !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(starts)) return { ok: false, message: "Choose the date the season starts." };
  if (!Number.isInteger(weeks)) return { ok: false, message: "Say how many weeks the season runs." };
  return plain(await run("save_season", { p_id: id, p_name: text(name, 200), p_starts: starts, p_weeks: weeks, p_series: text(series, 300) }, PAGES));
}

export async function setSeasonStatusAction(id: string, status: string): Promise<Result> {
  if (!isUuid(id) || !(SEASON_STATUSES as readonly string[]).includes(status)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("set_season_status", { p_season: id, p_status: status }, PAGES));
}

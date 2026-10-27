import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBoard, parseFeedLinks, parseLog, parseMyExports, parseOptions } from "./parse";
import type { Board, FeedLink, LogLine, MyExport, Options } from "./types";

// Each loader returns null (or an empty list) when the database refuses or cannot be reached. The pages treat that as "not available":
// the database has already decided who may see what.

async function load(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  return error ? null : data;
}

/** What this person may make now. A pack that is Off, or not theirs, is not in the answer. */
export const loadExportOptions = async (s: SupabaseClient): Promise<Options | null> => parseOptions(await load(s, "export_options"));
export const loadMyExports = async (s: SupabaseClient): Promise<MyExport[]> => parseMyExports(await load(s, "my_exports"));
export const loadFeedLinks = async (s: SupabaseClient): Promise<FeedLink[]> => parseFeedLinks(await load(s, "export_feed_list"));

// The switchboard. These begin god_only() in the database, so for anyone but the unlocked owner they are null.
export const loadExportBoard = async (s: SupabaseClient): Promise<Board | null> => parseBoard(await load(s, "export_board"));
export const loadExportLog = async (s: SupabaseClient, opts: { limit?: number; before?: string | null; pack?: string | null } = {}): Promise<LogLine[]> =>
  parseLog(await load(s, "export_log_list", { p_limit: opts.limit ?? 60, p_before: opts.before ?? null, p_pack: opts.pack ?? null }));

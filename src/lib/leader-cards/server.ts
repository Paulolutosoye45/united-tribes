import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BOARD_OFF,
  NO_FAILURES,
  REMINDERS_OFF,
  parseBoard,
  parseFailures,
  parseReminders,
  parseSheet,
  type Board,
  type CardFilter,
  type Failures,
  type Reminders,
  type SheetKind,
  type SheetRow,
} from "./cards";

// Each loader answers "not available" when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the
// database file is applied behaves exactly as it always did.

export type BoardQuery = { filter?: CardFilter; department?: string | null; limit?: number; offset?: number };

/** The board: counts for the whole church, and the leaders the filters leave. */
export async function loadBoard(supabase: SupabaseClient, q: BoardQuery = {}): Promise<Board> {
  try {
    const { data, error } = await supabase.rpc("leader_cards_board", {
      p_filter: q.filter ?? "unfinished",
      p_department: q.department ?? null,
      p_limit: q.limit ?? 100,
      p_offset: q.offset ?? 0,
    });
    return error ? BOARD_OFF : parseBoard(data);
  } catch {
    return BOARD_OFF;
  }
}

/** The leaders whose email did not arrive, with the reason, for Admin -> Sending and email. Empty when the person may not see it. */
export async function loadFailures(supabase: SupabaseClient): Promise<Failures> {
  try {
    const { data, error } = await supabase.rpc("leader_cards_failures");
    return error ? NO_FAILURES : parseFailures(data);
  } catch {
    return NO_FAILURES;
  }
}

/** The reminder setting and what it did this week. */
export async function loadReminders(supabase: SupabaseClient): Promise<Reminders> {
  try {
    const { data, error } = await supabase.rpc("leader_card_reminders_get");
    return error ? REMINDERS_OFF : parseReminders(data);
  } catch {
    return REMINDERS_OFF;
  }
}

/** One of the two sheets, for the download. Empty when the person may not have it. */
export async function loadSheet(supabase: SupabaseClient, kind: SheetKind): Promise<SheetRow[]> {
  try {
    const { data, error } = await supabase.rpc("leader_cards_sheet", { p_kind: kind });
    return error ? [] : parseSheet(data);
  } catch {
    return [];
  }
}

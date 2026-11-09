import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseAnswersOverview,
  parseAnswersSettings,
  parseBoardRows,
  parseBoardSummary,
  parseDeskList,
  parseSeatLine,
  parseTribeRows,
  type AnswersOverview,
  type AnswersSettings,
  type BoardRows,
  type BoardSummary,
  type DeskList,
  type SeatLine,
  type TribeRow,
} from "./answers";

// Each loader answers nothing (or Off) when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the database
// file is applied behaves exactly as it always did.

/** The board's top: the funnel tiles, the health strip and the state. Null for anyone who may not read it, and when the database does not have 6b yet. */
export async function loadBoardSummary(supabase: SupabaseClient): Promise<BoardSummary | null> {
  try {
    const { data, error } = await supabase.rpc("placed_board_summary");
    return error ? null : parseBoardSummary(data);
  } catch {
    return null;
  }
}

export type BoardFilter = { tile: string | null; tribe: string | null; step: string | null; answer: string | null; flag: string | null; call: string | null; opened: string | null };

/** One page of the board's rows. Names, tribes and steps; never a phone number. */
export async function loadBoardRows(supabase: SupabaseClient, f: BoardFilter, limit: number, offset: number): Promise<BoardRows> {
  try {
    const { data, error } = await supabase.rpc("placed_board_rows", {
      p_tile: f.tile,
      p_tribe: f.tribe,
      p_step: f.step,
      p_answer: f.answer,
      p_flag: f.flag,
      p_call: f.call,
      p_opened: f.opened,
      p_limit: limit,
      p_offset: offset,
    });
    return error ? { total: 0, rows: [] } : parseBoardRows(data);
  } catch {
    return { total: 0, rows: [] };
  }
}

export async function loadBoardTribes(supabase: SupabaseClient): Promise<TribeRow[]> {
  try {
    const { data, error } = await supabase.rpc("placed_board_tribes");
    return error ? [] : parseTribeRows(data);
  } catch {
    return [];
  }
}

/** The Admin home card: how many placed members wait and how many need a call. Off for anyone who may not read it. */
export async function loadAnswersOverview(supabase: SupabaseClient): Promise<AnswersOverview> {
  try {
    const { data, error } = await supabase.rpc("placed_answers_overview");
    return error ? { state: "off", waiting: 0, needsCall: 0, asked: 0 } : parseAnswersOverview(data);
  } catch {
    return { state: "off", waiting: 0, needsCall: 0, asked: 0 };
  }
}

/** The call desk's two lists, with every number's middle hidden. Null for anyone but an admin or a director. */
export async function loadDeskList(supabase: SupabaseClient): Promise<DeskList | null> {
  try {
    const { data, error } = await supabase.rpc("placed_desk_list");
    return error ? null : parseDeskList(data);
  } catch {
    return null;
  }
}

/** God Mode: the numbers behind the sequence. Null for anyone but the unlocked owner, and when the database does not have 6b yet. */
export async function loadAnswersSettings(supabase: SupabaseClient): Promise<AnswersSettings | null> {
  try {
    const { data, error } = await supabase.rpc("god_placed_answers_settings");
    return error ? null : parseAnswersSettings(data);
  } catch {
    return null;
  }
}

/** A leader's one line for new members, with whether the person may change it. Null when it cannot be read. */
export async function loadSeatLine(supabase: SupabaseClient, tribe: string): Promise<SeatLine | null> {
  try {
    const { data, error } = await supabase.rpc("tribe_seat_line_get", { p_tribe: tribe });
    return error ? null : parseSeatLine(data);
  } catch {
    return null;
  }
}

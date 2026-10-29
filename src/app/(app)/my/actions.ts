"use server";

import { run } from "@/lib/admin/rpc";
import { parseAnswered, parseOfficeAsked, parseSaved } from "@/lib/profile/parse";
import { DETAIL_KEYS, STORY_KEYS, type AnswerAction, type Answered, type OfficeAsked, type Saved } from "@/lib/profile/types";

const KEYS = ["life_stage", "age_range"];
const ACTIONS = ["yes", "change", "not_me", "later"];
const TYPED_KEYS: readonly string[] = [...DETAIL_KEYS, ...STORY_KEYS];
const UNAVAILABLE = "We couldn’t save that. Please try again in a moment.";

/**
 * One answer on My page, as the signed-in person. The database checks that it is theirs and that the function is open for them.
 * `fromHome` is the "Still right?" strip: Home is the page the person is on, and it asks to be drawn again itself a few seconds later, so the thanks is
 * read first (drawing Home again here would take the strip, and its thanks, away at once).
 */
export async function myPageAnswerAction(key: string, action: AnswerAction, value: string | null, fromHome = false): Promise<Answered> {
  if (!KEYS.includes(key) || !ACTIONS.includes(action)) return { ok: false, reason: "invalid", message: UNAVAILABLE };
  const choice = action === "change" ? (typeof value === "string" && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null) : null;
  if (action === "change" && choice === null) return { ok: false, reason: "bad_value", message: null };
  const done = await run("my_page_answer", { p_key: key, p_action: action, p_value: choice }, fromHome ? ["/my", "/lead"] : ["/my", "/lead", "/home"]);
  if (!done.ok) return { ok: false, reason: "unknown", message: done.message };
  return parseAnswered(done.data);
}

/**
 * A typed fact or a line of the person's own story, as the signed-in person. An empty value clears it. The database checks the length, the list
 * a choice must come from, and that the function holding the fact is open for them; nothing here decides any of that.
 */
export async function myPageSaveAction(key: string, value: string | null): Promise<Saved> {
  if (!TYPED_KEYS.includes(key)) return { ok: false, reason: "invalid", message: UNAVAILABLE };
  const text = typeof value === "string" ? value.slice(0, 400) : "";
  const done = await run("my_page_save", { p_key: key, p_value: text === "" ? null : text }, ["/my"]);
  if (!done.ok) return { ok: false, reason: "unknown", message: done.message };
  return parseSaved(done.data);
}

/** "Tell the Care Team": an age range that is wrong in a way the list cannot fix. Changes nothing for the person; the Care Team hears. */
export async function myOfficeAskAction(note: string): Promise<OfficeAsked> {
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const done = await run("my_office_ask", { p_note: text === "" ? null : text }, ["/my", "/care/teens"]);
  if (!done.ok) return { ok: false, reason: "unknown", message: done.message };
  return parseOfficeAsked(done.data);
}

/** "Not now" on the Home strip: hides that one question for the rest of the season. (The strip draws Home again itself, a few seconds later.) */
export async function stillRightLaterAction(key: string): Promise<{ ok: boolean; message: string | null }> {
  if (!KEYS.includes(key)) return { ok: false, message: UNAVAILABLE };
  const done = await run("still_right_later", { p_key: key }, []);
  if (!done.ok) return { ok: false, message: done.message };
  const out = done.data as { ok?: unknown } | null;
  return { ok: out?.ok === true, message: out?.ok === true ? null : UNAVAILABLE };
}

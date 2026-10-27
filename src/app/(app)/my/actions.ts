"use server";

import { run } from "@/lib/admin/rpc";
import { parseAnswered } from "@/lib/profile/parse";
import type { AnswerAction, Answered } from "@/lib/profile/types";

const KEYS = ["life_stage", "age_range"];
const ACTIONS = ["yes", "change", "not_me", "later"];
const UNAVAILABLE = "We couldn’t save that. Please try again in a moment.";

/** One answer on My page, as the signed-in person. The database checks that it is theirs and that the function is open for them. */
export async function myPageAnswerAction(key: string, action: AnswerAction, value: string | null): Promise<Answered> {
  if (!KEYS.includes(key) || !ACTIONS.includes(action)) return { ok: false, reason: "invalid", message: UNAVAILABLE };
  const choice = action === "change" ? (typeof value === "string" && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null) : null;
  if (action === "change" && choice === null) return { ok: false, reason: "bad_value", message: null };
  const done = await run("my_page_answer", { p_key: key, p_action: action, p_value: choice }, ["/my", "/lead"]);
  if (!done.ok) return { ok: false, reason: "unknown", message: done.message };
  return parseAnswered(done.data);
}

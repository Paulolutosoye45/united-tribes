"use server";

import { getSession } from "@/lib/auth/session";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { parseAnswered, parseCodeChecked, parseCodeSent } from "@/lib/profile/parse";
import { keepDetailsSession, readDetailsSession } from "@/lib/profile/session";
import type { Answered, CodeChecked, CodeSent } from "@/lib/profile/types";
import { createClient } from "@/lib/supabase/server";

const TOKEN = /^[a-f0-9]{64}$/;
const KEYS = ["life_stage", "age_range"];
const ACTIONS = ["yes", "change", "not_me", "later"];
const UNAVAILABLE = "We couldn’t do that just now. Please try again in a moment.";

/**
 * The page behind "Confirm your details". The private link is the first credential and is checked as 64 hex characters here and again,
 * hashed, in the database. A signed-in person who owns the link answers with one tap. Anyone else proves they hold the contact the church
 * has for the person: a six-digit code to that email or phone (never anything typed here), then a three-hour session in a cookie for this
 * link only. The sending service's token is what lets these functions run for a visitor, and it never leaves the server.
 */
const bad = { ok: false as const, reason: "invalid" as const, minutes: null };

/** "Send me a code": to the contact the church holds, never to anything the visitor types. The database spaces them out. */
export async function askCodeAction(token: string): Promise<CodeSent> {
  if (!TOKEN.test(token)) return bad;
  const secret = workerToken();
  if (!secret) return { ok: false, reason: "no_way", minutes: null };
  try {
    const { data, error } = await workerRpc(secret)("worker_details_code_send", { p_link: token });
    return error ? { ok: false, reason: "no_way", minutes: null } : parseCodeSent(data);
  } catch {
    return { ok: false, reason: "no_way", minutes: null };
  }
}

/** The six numbers. Right: a three-hour session opens, kept in a cookie that only this link's page receives. */
export async function checkCodeAction(token: string, code: string): Promise<CodeChecked> {
  if (!TOKEN.test(token)) return { ...bad, triesLeft: null };
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, reason: "format", minutes: null, triesLeft: null };
  const secret = workerToken();
  if (!secret) return { ok: false, reason: "invalid", minutes: null, triesLeft: null };
  try {
    const { data, error } = await workerRpc(secret)("worker_details_code_check", { p_link: token, p_code: digits });
    if (error) return { ok: false, reason: "invalid", minutes: null, triesLeft: null };
    const out = parseCodeChecked(data);
    if (out.ok) await keepDetailsSession(token, out.session);
    return out;
  } catch {
    return { ok: false, reason: "invalid", minutes: null, triesLeft: null };
  }
}

const fail = (reason = "unknown"): Answered => ({ ok: false, reason, message: UNAVAILABLE });

/** One answer. A signed-in owner of the link answers as themselves; anyone else needs the session a code opened. */
export async function answerAction(token: string, key: string, action: string, value: string | null): Promise<Answered> {
  if (!TOKEN.test(token) || !KEYS.includes(key) || !ACTIONS.includes(action)) return fail("invalid");
  const choice = action === "change" ? (typeof value === "string" && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null) : null;
  if (action === "change" && choice === null) return fail("bad_value");

  if (await getSession()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("details_check_answer", { p_link: token, p_key: key, p_action: action, p_value: choice });
      if (!error) {
        const out = parseAnswered(data);
        // Not their link: fall through to the visitor's way in (the code), which proves who holds it
        if (out.ok || !(out.reason === "invalid")) return out;
      }
    } catch {
      // fall through
    }
  }

  const secret = workerToken();
  if (!secret) return fail();
  try {
    const { data, error } = await workerRpc(secret)("worker_details_answer", { p_link: token, p_session: await readDetailsSession(token), p_key: key, p_action: action, p_value: choice });
    return error ? fail() : parseAnswered(data);
  } catch {
    return fail();
  }
}

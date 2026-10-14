"use server";

import { cookies, headers } from "next/headers";
import { friendly } from "@/lib/leaders/errors";
import { printOf } from "@/lib/leaders/quality/print";
import { BROWSER_COOKIE, traceOf, type Trace } from "@/lib/leaders/referee/trace";
import { askOutcome, checkOutcome, type AskOutcome, type CheckOutcome } from "@/lib/leaders/referee/outcome";
import { keepRefereeSession, readRefereeSession } from "@/lib/leaders/referee/session";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";

export type ReferenceResult = { ok: true } | { ok: false; message: string; restart?: boolean };

const TOKEN = /^[a-f0-9]{64}$/;
const BAD_LINK = "This link isn’t valid. Check you copied all of it.";
const rating = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

async function whereFrom(): Promise<Trace> {
  return traceOf(await headers(), (await cookies()).get(BROWSER_COOKIE)?.value);
}

/** "Send me a code": a message to the contact the applicant gave, never to anything the visitor types. The database spaces them out. */
export async function askCodeAction(token: string): Promise<AskOutcome> {
  if (!TOKEN.test(token)) return { ok: false, reason: "invalid", message: BAD_LINK };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("referee_ask_code", { p_token: token, p_net: (await whereFrom()).net });
  if (error) return { ok: false, reason: "error", message: "We couldn’t send the code. Please try again in a moment." };
  return askOutcome(data);
}

/** The six numbers. Right: a three-hour session opens, kept in a cookie that only this link's page receives. */
export async function checkCodeAction(token: string, code: string): Promise<CheckOutcome> {
  if (!TOKEN.test(token)) return { ok: false, reason: "invalid", message: BAD_LINK };
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, reason: "format", message: "Type the six numbers from the message." };
  const trace = await whereFrom();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("referee_check_code", { p_token: token, p_code: digits, p_net: trace.net, p_bid: trace.bid });
  if (error) return { ok: false, reason: "error", message: "We couldn’t check that code. Please try again in a moment." };
  const out = checkOutcome(data);
  const secret = (data as { session?: unknown } | null)?.session;
  if (out.ok) {
    if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) return { ok: false, reason: "error", message: "We couldn’t check that code. Please try again in a moment." };
    await keepRefereeSession(token, secret);
  }
  return out;
}

/**
 * The ratings. Two keys are needed: the link, and the session the code opened. When the bot check is switched on, the visitor
 * must have passed it too. The note is never sent along with the fingerprint the database compares: only its hashes are.
 */
export async function submitReferenceAction(
  token: string,
  ratings: { reliability: number; warmth: number; confidentiality: number; maturity: number },
  concern: boolean,
  note: string,
  captcha = "",
): Promise<ReferenceResult> {
  if (!TOKEN.test(token)) return { ok: false, message: BAD_LINK };
  if (![ratings?.reliability, ratings?.warmth, ratings?.confidentiality, ratings?.maturity].every(rating)) {
    return { ok: false, message: "Rate all four, from 1 to 5." };
  }
  const text = String(note ?? "").trim().slice(0, 600);
  if (concern && text.length < 3) return { ok: false, message: "Please say a little about your concern." };

  const session = await readRefereeSession(token);
  if (!session) return { ok: false, restart: true, message: "Your confirmation has run out. Reload this page and we’ll send a new code." };

  const forwarded = (await headers()).get("x-forwarded-for");
  const human = await verifyTurnstile(captcha, { ip: forwarded?.split(",")[0]?.trim() ?? null });
  if (!human.ok) return { ok: false, message: human.message };

  const trace = await whereFrom();
  const print = concern ? printOf(text) : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_reference", {
    p_token: token,
    p_session: session,
    p_reliability: ratings.reliability,
    p_warmth: ratings.warmth,
    p_confidentiality: ratings.confidentiality,
    p_maturity: ratings.maturity,
    p_concern: concern === true,
    p_note: concern ? text : null,
    p_net: trace.net,
    p_bid: trace.bid,
    p_norm_hash: print?.normHash ?? null,
    p_simhash: print?.simhash ?? null,
    p_words: print?.words ?? null,
  });
  if (error) {
    const message = friendly(error);
    return { ok: false, restart: /confirm the code/i.test(message), message };
  }
  // The database has already ended the session. The cookie is left alone on purpose: changing a cookie in an action makes the page
  // reload from the server, which would replace the thank-you the referee is looking at with the plain "already sent" page.
  return { ok: true };
}

/** For a reference given before referees were checked: "Was this yours?" */
export async function reverifyAction(token: string, mine: boolean): Promise<ReferenceResult> {
  if (!TOKEN.test(token)) return { ok: false, message: BAD_LINK };
  const session = await readRefereeSession(token);
  if (!session) return { ok: false, restart: true, message: "Your confirmation has run out. Reload this page and we’ll send a new code." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("referee_reverify_answer", { p_token: token, p_session: session, p_mine: mine === true });
  if (error) {
    const message = friendly(error);
    return { ok: false, restart: /confirm the code/i.test(message), message };
  }
  return { ok: true }; // as above: the database ended the session; the page is not reloaded under the referee
}

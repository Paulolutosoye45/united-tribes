"use server";

import { friendly } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export type ReferenceResult = { ok: true } | { ok: false; message: string };

const rating = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

/**
 * A referee answering by their private link. No sign-in: the secret in the link
 * is the key, and the database spends it on first use.
 */
export async function submitReferenceAction(
  token: string,
  ratings: { reliability: number; warmth: number; confidentiality: number; maturity: number },
  concern: boolean,
  note: string,
): Promise<ReferenceResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return { ok: false, message: "This link is not valid." };
  if (![ratings.reliability, ratings.warmth, ratings.confidentiality, ratings.maturity].every(rating)) {
    return { ok: false, message: "Rate all four, from 1 to 5." };
  }
  const text = String(note ?? "").trim().slice(0, 600);
  if (concern && text.length < 3) return { ok: false, message: "Please say a little about your concern." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_reference", {
    p_token: token,
    p_reliability: ratings.reliability,
    p_warmth: ratings.warmth,
    p_confidentiality: ratings.confidentiality,
    p_maturity: ratings.maturity,
    p_concern: concern === true,
    p_note: concern ? text : null,
  });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true };
}

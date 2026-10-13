import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const NO_STORE = { "cache-control": "no-store" } as const;

/** At most this many assistant requests per person in ten minutes. A real form needs a dozen. */
export const LIMIT = 40;
export const WINDOW_MS = 10 * 60 * 1000;

export const none = (reason: string) => NextResponse.json({ suggestions: [], fallback: true, reason }, { headers: NO_STORE });
export const refuse = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

/** Only our own pages may call the assistant's routes. */
export function sameOrigin(request: Request): boolean {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return ["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"));
}

export type Guarded =
  | { ok: true; supabase: SupabaseClient; personId: string }
  | { ok: false; response: NextResponse };

/**
 * Everything an assistant route decides before it does any work, so no route can forget one:
 * who is asking, whether they agreed to the assistant, and how often they may ask.
 * The browser decides none of it.
 */
export async function guard(request: Request, kind: "json" | "multipart"): Promise<Guarded> {
  if (!sameOrigin(request)) return { ok: false, response: refuse("forbidden", 403) };
  const type = request.headers.get("content-type") ?? "";
  if (kind === "json" ? !type.includes("application/json") : !type.includes("multipart/form-data")) {
    return { ok: false, response: refuse("unsupported", 415) };
  }
  if (!getSupabaseEnv()) return { ok: false, response: none("error") };

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase.auth.getClaims();
  const personId = data?.claims?.sub;
  if (!personId) return { ok: false, response: refuse("sign in", 401) };

  const { data: agreed } = await supabase.rpc("has_consent", { p_purpose: "ai_assist" });
  if (agreed !== true) return { ok: false, response: none("no_consent") };

  // A young person's words never go to an outside AI service, whatever they ticked. Only the database knows their age range.
  const { data: guardian } = await supabase.rpc("my_guardian");
  if ((guardian as { needed?: boolean } | null)?.needed === true) return { ok: false, response: none("minor") };

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await supabase.from("ai_calls").select("id", { count: "exact", head: true }).eq("person_id", personId).gte("at", since);
  if ((count ?? 0) >= LIMIT) return { ok: false, response: none("rate_limited") };

  return { ok: true, supabase, personId };
}

/** Counts and timings only. The words never go in the log. */
export async function logCall(
  supabase: SupabaseClient,
  personId: string,
  field: string,
  r: { provider: string; model: string; latencyMs: number; fallback: boolean; reason?: string; suggested?: number; dropped?: number },
) {
  await supabase.from("ai_calls").insert({
    person_id: personId,
    field,
    provider: r.provider.slice(0, 24),
    model: r.model.slice(0, 64),
    latency_ms: Math.max(0, Math.round(r.latencyMs)),
    fallback: r.fallback,
    reason: r.reason ?? null,
    suggested: Math.min(r.suggested ?? 0, 10),
    dropped: Math.min(r.dropped ?? 0, 100),
  });
}

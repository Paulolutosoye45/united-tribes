import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestOptions } from "@/lib/ai/suggest";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const body = z.object({
  field: z.enum(["tribe", "season_goal"]),
  story: z.string().max(1500),
  tribe: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
});

/** At most this many requests per person in ten minutes. A real form needs two or three. */
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

const NO_STORE = { "cache-control": "no-store" };
const none = (reason: string) => NextResponse.json({ suggestions: [], fallback: true, reason }, { headers: NO_STORE });

/**
 * Suggests tribes or goals from what a person wrote. Everything is decided
 * here, not by the browser: who is asking, whether they agreed to the
 * assistant, which options exist, and how often they may ask.
 */
export async function POST(request: Request) {
  // Only our own pages may call this.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  } else if (!["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "unsupported" }, { status: 415, headers: NO_STORE });
  }

  const text = await request.text();
  if (text.length > 8000) return NextResponse.json({ error: "too large" }, { status: 413, headers: NO_STORE });
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(text));
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }

  if (!getSupabaseEnv()) return none("error");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const personId = data?.claims?.sub;
  if (!personId) return NextResponse.json({ error: "sign in" }, { status: 401, headers: NO_STORE });

  const { data: agreed } = await supabase.rpc("has_consent", { p_purpose: "ai_assist" });
  if (agreed !== true) return none("no_consent");

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("ai_calls")
    .select("id", { count: "exact", head: true })
    .eq("person_id", personId)
    .gte("at", since);
  if ((count ?? 0) >= LIMIT) return none("rate_limited");

  // Options come from the database, never from the browser.
  let question: string;
  let options: { id: string; label: string }[];
  if (parsed.field === "tribe") {
    const { data: tribes } = await supabase.from("tribes").select("slug, name, description, sort").order("sort");
    options = (tribes ?? []).map((t) => ({ id: t.slug, label: `${t.name} (${t.description})` }));
    question = "Which tribe, meaning a group of people in a similar field or stage of life, fits this person best right now?";
  } else {
    if (!parsed.tribe) return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
    const { data: tribe } = await supabase
      .from("tribes")
      .select("name, season_goals(slug, title, sort)")
      .eq("slug", parsed.tribe)
      .maybeSingle();
    const goals = [...((tribe?.season_goals as { slug: string; title: string; sort: number }[] | undefined) ?? [])].sort((a, b) => a.sort - b.sort);
    options = goals.map((g) => ({ id: g.slug, label: g.title }));
    question = `This person belongs to the ${tribe?.name ?? "chosen"} tribe. Which goal would they most want to work on with a small group over twelve weeks?`;
  }
  if (options.length === 0) return none("error");

  const result = await suggestOptions({ field: parsed.field, question, options, story: parsed.story, max: 3 });

  // Counts and timings only. The text never goes in the log.
  await supabase.from("ai_calls").insert({
    person_id: personId,
    field: parsed.field,
    provider: result.provider.slice(0, 24),
    model: result.model.slice(0, 64),
    latency_ms: result.latencyMs,
    fallback: result.fallback,
    reason: result.reason ?? null,
    suggested: result.suggestions.length,
    dropped: Math.min(result.dropped, 100),
  });

  return NextResponse.json(
    { suggestions: result.suggestions, fallback: result.fallback, reason: result.reason ?? null },
    { headers: NO_STORE },
  );
}

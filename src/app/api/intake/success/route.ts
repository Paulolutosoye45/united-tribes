import { NextResponse } from "next/server";
import { z } from "zod";
import { NO_STORE, guard, logCall, refuse } from "@/lib/ai/route";
import { SUCCESS_MAX, SUCCESS_WRITER_SYSTEM, plainSuccessDraft, successFacts } from "@/lib/intake/success";
import { writeText } from "@/lib/ai/write";

export const dynamic = "force-dynamic";

const body = z
  .object({
    story: z.string().max(1500).optional(),
    goal: z.string().regex(/^[a-z0-9-]{1,96}$/).optional(),
    goalOther: z.string().max(160).optional(),
  })
  .refine((b) => b.goal || b.goalOther?.trim(), "A goal is needed");

/**
 * Drafts the week-12 success sentence from a person's goal and, if they wrote one, their story. The plain draft is
 * always there as a fallback, so the person always gets something to edit. Only the story and the goal are used:
 * support notes and notes to a leader never reach this route (the form does not send them, and the writer's
 * facts are built here from just these two).
 */
export async function POST(request: Request) {
  const checked = await guard(request, "json");
  if (!checked.ok) return checked.response;
  const { supabase, personId } = checked;

  const text = await request.text();
  if (text.length > 6000) return refuse("too large", 413);
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(text));
  } catch {
    return refuse("bad request", 400);
  }

  let title: string | null = null;
  if (parsed.goal) {
    const { data } = await supabase.from("season_goals").select("title").eq("slug", parsed.goal).maybeSingle();
    title = (data?.title as string | undefined) ?? null;
    if (!title) return refuse("bad request", 400);
  }
  const own = title ? null : parsed.goalOther?.trim() || null;

  const started = Date.now();
  const draft = plainSuccessDraft({ title, own });
  const written = await writeText({
    purpose: "success_sentence",
    system: SUCCESS_WRITER_SYSTEM,
    facts: successFacts({ goalTitle: title, goalOwn: own, story: parsed.story }),
    draft,
    maxChars: Math.min(SUCCESS_MAX, 220),
  });
  await logCall(supabase, personId, "success_sentence", {
    provider: written.ai ? "assistant" : "plain",
    model: written.ai ? "writer" : "draft",
    latencyMs: Date.now() - started,
    fallback: !written.ai,
    reason: written.reason,
    suggested: 1,
  });
  return NextResponse.json({ text: written.text, ai: written.ai }, { headers: NO_STORE });
}

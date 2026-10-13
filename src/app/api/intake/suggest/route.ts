import { NextResponse } from "next/server";
import { z } from "zod";
import { NO_STORE, guard, logCall, none, refuse } from "@/lib/ai/route";
import { suggestOptions } from "@/lib/ai/suggest";
import { HEARD_FIELDS, knownLines, specFor, type HeardField } from "@/lib/intake/heard";
import { CHILDREN, RELATIONSHIPS, WORK_FIELDS, WORK_STATUSES } from "@/lib/intake/options";

const idsOf = (list: readonly { id: string }[]) => list.map((o) => o.id) as [string, ...string[]];

export const dynamic = "force-dynamic";

const body = z.object({
  field: z.enum(["community", "season_goal", "heard", "group_roles"]),
  story: z.string().max(1500),
  community: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  /** What the person has already confirmed, so later questions are asked with more to go on. Checked against the form's own lists. */
  known: z
    .object({
      workStatus: z.enum(idsOf(WORK_STATUSES)).optional(),
      workField: z.enum(idsOf(WORK_FIELDS)).optional(),
      relationship: z.enum(idsOf(RELATIONSHIPS)).optional(),
      children: z.array(z.enum(idsOf(CHILDREN))).max(CHILDREN.length).optional(),
    })
    .optional(),
});

/**
 * Suggests communities, goals, the "We heard…" chips or group roles from what a person wrote. Everything is decided
 * here, not by the browser: who is asking, whether they agreed to the assistant, which options exist, and how
 * often they may ask. The options come from the database or from the form's own vocabulary, never from the request.
 */
export async function POST(request: Request) {
  const checked = await guard(request, "json");
  if (!checked.ok) return checked.response;
  const { supabase, personId } = checked;

  const text = await request.text();
  if (text.length > 8000) return refuse("too large", 413);
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(text));
  } catch {
    return refuse("bad request", 400);
  }

  const known = parsed.known ? knownLines(parsed.known) : [];

  async function ask(field: string, question: string, options: { id: string; label: string }[], max: number) {
    const result = await suggestOptions({ field, question, options, story: parsed.story, known, max });
    await logCall(supabase, personId, field, { ...result, suggested: result.suggestions.length });
    return result;
  }

  // Several small questions about the same story, asked together.
  if (parsed.field === "heard") {
    const answers = await Promise.all(
      HEARD_FIELDS.map(async (field: HeardField) => {
        const spec = specFor(field);
        return [field, await ask(field, spec.question, spec.options, spec.max)] as const;
      }),
    );
    const fields = Object.fromEntries(answers.map(([field, r]) => [field, r.suggestions]));
    const allFell = answers.every(([, r]) => r.fallback);
    return NextResponse.json({ fields, fallback: allFell, reason: allFell ? (answers[0][1].reason ?? "error") : null }, { headers: NO_STORE });
  }

  if (parsed.field === "group_roles") {
    const spec = specFor("group_roles");
    const result = await ask("group_roles", spec.question, spec.options, spec.max);
    return NextResponse.json({ suggestions: result.suggestions, fallback: result.fallback, reason: result.reason ?? null }, { headers: NO_STORE });
  }

  // Options come from the database, never from the browser.
  let question: string;
  let options: { id: string; label: string }[];
  if (parsed.field === "community") {
    const { data: communities } = await supabase.from("communities").select("slug, name, description, sort").eq("active", true).order("sort");
    options = (communities ?? []).map((t) => ({ id: t.slug, label: `${t.name} (${t.description})` }));
    question = "Which community, meaning a group of people in a similar field or stage of life, fits this person best right now? Give the best fit first and a second choice if one clearly fits.";
  } else {
    if (!parsed.community) return refuse("bad request", 400);
    const { data: community } = await supabase
      .from("communities")
      .select("name, season_goals(slug, title, sort, active)")
      .eq("slug", parsed.community)
      .maybeSingle();
    const goals = [...((community?.season_goals as { slug: string; title: string; sort: number; active: boolean }[] | undefined) ?? [])]
      .filter((g) => g.active)
      .sort((a, b) => a.sort - b.sort);
    options = goals.map((g) => ({ id: g.slug, label: g.title }));
    question = `This person belongs to the ${community?.name ?? "chosen"} community. Which goal would they most want to work on with a small group over twelve weeks?`;
  }
  if (options.length === 0) return none("error");

  const result = await ask(parsed.field, question, options, 3);
  return NextResponse.json(
    { suggestions: result.suggestions, fallback: result.fallback, reason: result.reason ?? null },
    { headers: NO_STORE },
  );
}

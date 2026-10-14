import { revalidatePath } from "next/cache";
import { guard, json, problem, refusal } from "@/lib/leaders/referee/api";
import { readCounts } from "@/lib/leaders/referee/read";
import { cleanRows, isMode } from "@/lib/leaders/referee/rows";

export const dynamic = "force-dynamic";

/** Step two: do it. The database makes the plan again from these people, so what is applied is what it checks now, not what was previewed. */
export async function POST(request: Request) {
  const allowed = await guard(request);
  if (allowed instanceof Response) return allowed;
  let body: { rows?: unknown; mode?: unknown; filename?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return problem("We couldn’t read that request. Try again.", 400);
  }
  if (!isMode(body.mode)) return problem("Choose “Add and update” or “Replace the list”.", 400);
  const cleaned = cleanRows(body.rows);
  if (!cleaned.ok) return problem(cleaned.message, 422);
  const filename = typeof body.filename === "string" ? body.filename.slice(0, 120) : null;

  const { data, error } = await allowed.supabase.rpc("referee_import_apply", {
    p_rows: cleaned.rows,
    p_mode: body.mode,
    p_filename: filename,
    p_force: body.force === true,
  });
  if (error) return refusal(error);
  const d = (data ?? {}) as { batch?: unknown; nothing?: unknown; counts?: unknown };
  revalidatePath("/admin/referees");
  revalidatePath("/admin");
  return json({ ok: true, nothing: d.nothing === true, batch: typeof d.batch === "string" ? d.batch : null, counts: readCounts(d.counts) });
}

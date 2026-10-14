import { guard, json, problem, refusal } from "@/lib/leaders/referee/api";
import { readPreview } from "@/lib/leaders/referee/read";
import { cleanRows, isMode } from "@/lib/leaders/referee/rows";

export const dynamic = "force-dynamic";

/** What the same people would do under the other way of uploading ("Add and update" or "Replace the list"). Nothing is changed. */
export async function POST(request: Request) {
  const allowed = await guard(request);
  if (allowed instanceof Response) return allowed;
  let body: { rows?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return problem("We couldn’t read that request. Try again.", 400);
  }
  if (!isMode(body.mode)) return problem("Choose “Add and update” or “Replace the list”.", 400);
  const cleaned = cleanRows(body.rows);
  if (!cleaned.ok) return problem(cleaned.message, 422);
  const { data, error } = await allowed.supabase.rpc("referee_import_preview", { p_rows: cleaned.rows, p_mode: body.mode });
  if (error) return refusal(error);
  const preview = readPreview(data);
  return preview ? json({ ok: true, preview }) : problem("We couldn’t check that list. Try again in a moment.", 502);
}

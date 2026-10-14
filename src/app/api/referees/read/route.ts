import { guard, json, problem, refusal } from "@/lib/leaders/referee/api";
import { readPreview } from "@/lib/leaders/referee/read";
import { STANDINGS, type Standing } from "@/lib/leaders/referee/labels";
import { cleanRows } from "@/lib/leaders/referee/rows";
import { MAX_BYTES, parseDirectoryFile } from "@/lib/leaders/referee/sheet/parse";

export const dynamic = "force-dynamic";

/**
 * Step one of an upload: read the spreadsheet and say what the database would do with it. Nothing is changed. The page
 * keeps the people it gets back and sends them to /apply when the person says go, so the file is read only once.
 */
export async function POST(request: Request) {
  const allowed = await guard(request);
  if (allowed instanceof Response) return allowed;
  const { supabase } = allowed;

  // Refuse a large request before reading it
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return problem("That file is too large. A list of people should be well under 4 MB.", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return problem("We couldn’t receive that file. Check your connection and try again.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return problem("Choose a spreadsheet to upload.", 400);
  const modeRaw = form.get("mode");
  const mode = modeRaw === "replace" ? "replace" : "update";
  const sheet = typeof form.get("sheet") === "string" && form.get("sheet") ? String(form.get("sheet")).slice(0, 80) : null;
  const fb = String(form.get("fallback") ?? "");
  const fallback: Standing | "" = (STANDINGS as readonly string[]).includes(fb) ? (fb as Standing) : "";

  const parsed = parseDirectoryFile({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()), sheet, fallback });
  if (!parsed.ok) return problem(parsed.message, 422);

  const cleaned = cleanRows(parsed.rows);
  if (!cleaned.ok) return problem(cleaned.message, 422);
  const { data, error } = await supabase.rpc("referee_import_preview", { p_rows: cleaned.rows, p_mode: mode });
  if (error) return refusal(error);
  const preview = readPreview(data);
  if (!preview) return problem("We couldn’t check that list against the church’s. Try again in a moment.", 502);

  return json({
    ok: true,
    file: {
      name: file.name,
      type: parsed.fileType,
      sheet: parsed.sheet,
      sheets: parsed.sheets,
      headerLine: parsed.headerLine,
      columns: parsed.columns.map((c) => ({ header: c.header, field: c.field })),
      ignored: parsed.ignored,
      skipped: parsed.skipped,
      rolesMissing: parsed.rolesMissing,
      people: parsed.rows.length,
    },
    // What a role cell said when it could not be read, by row, so the screen can quote it. The database never sees it.
    roleTexts: Object.fromEntries(parsed.rows.filter((r) => r.roleText && !r.standing).map((r) => [r.line, r.roleText.slice(0, 60)])),
    clean: cleaned.rows,
    mode,
    preview,
  });
}

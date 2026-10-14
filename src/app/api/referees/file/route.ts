import { lagosDateKey } from "@/lib/dates";
import { guard, problem, refusal } from "@/lib/leaders/referee/api";
import { buildExport, buildTemplate, type ExportPerson } from "@/lib/leaders/referee/sheet/build";

export const dynamic = "force-dynamic";

/**
 * Two downloads: the blank form to fill in (?kind=template) and the whole list as it stands (?kind=export), in Excel or CSV.
 * The export has the shape that is uploaded, so the list can be edited and put straight back.
 */
export async function GET(request: Request) {
  const allowed = await guard(request);
  if (allowed instanceof Response) return allowed;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (kind !== "template" && kind !== "export") return problem("Choose the template or the list.", 400);

  let file;
  if (kind === "template") {
    file = buildTemplate(format);
  } else {
    const { data, error } = await allowed.supabase.rpc("referee_directory_export");
    if (error) return refusal(error);
    const people: ExportPerson[] = (Array.isArray(data) ? data : []).map((p: Record<string, unknown>) => ({
      name: String(p.name ?? ""),
      standing: String(p.standing ?? ""),
      unit: typeof p.unit === "string" ? p.unit : null,
      note: typeof p.note === "string" ? p.note : null,
      active: p.active !== false,
      phones: Array.isArray(p.phones) ? p.phones.map(String) : [],
      emails: Array.isArray(p.emails) ? p.emails.map(String) : [],
    }));
    file = buildExport(people, format, lagosDateKey(new Date().toISOString()));
  }
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": file.type,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

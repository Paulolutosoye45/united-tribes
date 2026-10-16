import { NextResponse, type NextRequest } from "next/server";
import { auditCsv, auditFileName } from "@/lib/activity/csv";
import { isDay } from "@/lib/activity/format";
import { loadAudit, markViewed } from "@/lib/activity/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GROUPS = ["member", "young", "leader", "team", "pastoral", "system", "you"];

/**
 * The audit trail as a spreadsheet file, for the owner only. The database decides who the owner is; to anyone else this is
 * the same "no such page" as the rest of the console. The export is itself logged in the owner's record.
 */
export async function GET(request: NextRequest) {
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const p = request.nextUrl.searchParams;
  const group = p.get("group");
  const area = p.get("area");
  const from = p.get("from");
  const to = p.get("to");

  const supabase = await createClient();
  const audit = await loadAudit(supabase, {
    group: group && GROUPS.includes(group) ? group : null,
    area: area && /^[a-z_]{1,32}$/.test(area) ? area : null,
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    limit: 5000,
  });
  if (!audit) return notFound();
  await markViewed(supabase, "audit", "exported");

  return new NextResponse(auditCsv(audit.rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${auditFileName(new Date().toISOString())}"`,
      "cache-control": "no-store",
    },
  });
}

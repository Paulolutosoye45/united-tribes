import { NextResponse } from "next/server";
import { CONTACT_GAP_ACT_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { gapsCsv } from "@/lib/contact-gaps/gaps";
import { loadGapExport } from "@/lib/contact-gaps/server";
import { createClient } from "@/lib/supabase/server";

// Read from the database each time, never kept. Names, tribe, leader, the reason and how often they were asked: never a phone number.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !hasAnyRole(session.roles, CONTACT_GAP_ACT_ROLES)) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const supabase = await createClient();
  const rows = await loadGapExport(supabase);
  // Off, or the database refused: the same "no such file" as for anyone else
  if (rows.length === 0) return new NextResponse("There is nobody on the list, or the function is switched Off.", { status: 404, headers: { "cache-control": "no-store" } });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(gapsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contact-gaps-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

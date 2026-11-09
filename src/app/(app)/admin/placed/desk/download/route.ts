import { NextResponse } from "next/server";
import { PLACED_DESK_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { deskCsv, parseDeskDownload } from "@/lib/placement/answers";
import { createClient } from "@/lib/supabase/server";

// Read from the database each time, never kept. The call desk with numbers: only when the owner has switched it on, only for an admin or a director, and each
// download is written down by the database. The last line of the file says who downloaded it and when.
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET() {
  const session = await getSession();
  if (!session || !hasAnyRole(session.roles, PLACED_DESK_ROLES)) return NOT_FOUND();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("placed_desk_download");
  // Switched off, a limit reached, or anything else the database refuses: the same "no such file" as for anyone else
  if (error) return NOT_FOUND();
  const file = parseDeskDownload(data);
  if (!file) return NOT_FOUND();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(deskCsv(file), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="call-desk-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

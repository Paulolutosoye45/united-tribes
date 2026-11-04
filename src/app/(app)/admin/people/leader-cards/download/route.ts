import { NextResponse } from "next/server";
import { LEADER_CARD_ACT_ROLES, LEADER_CARD_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { sheetCsv, type SheetKind } from "@/lib/leader-cards/cards";
import { loadSheet } from "@/lib/leader-cards/server";
import { createClient } from "@/lib/supabase/server";

// Read from the database each time, never kept. "hod": names, tribe, department and where each card is, with no number and no address, for the heads of
// department. "call": adds the number and the address, for those who act. Each download is written to the log by the database.
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const sheet = new URL(request.url).searchParams.get("sheet");
  const kind: SheetKind | null = sheet === "call" ? "call" : sheet === "hod" ? "hod" : null;
  if (!kind) return NOT_FOUND();
  const session = await getSession();
  if (!session || !hasAnyRole(session.roles, kind === "call" ? LEADER_CARD_ACT_ROLES : LEADER_CARD_ROLES)) return NOT_FOUND();
  const supabase = await createClient();
  const rows = await loadSheet(supabase, kind);
  if (rows.length === 0) return new NextResponse("There is nobody on the list.", { status: 404, headers: { "cache-control": "no-store" } });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(sheetCsv(kind, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${kind === "call" ? "leader-call-sheet" : "leaders-by-department"}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

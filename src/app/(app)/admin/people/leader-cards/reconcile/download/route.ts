import { NextResponse } from "next/server";
import { LEADER_CARD_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { hodListCsv, hodMissingCsv } from "@/lib/leader-cards/hod";
import { loadHodReport } from "@/lib/leader-cards/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

// Read from the database each time, never kept. "list": every row of the list and where that person stands, with the email and number from the list for those who
// act (they are the ones that were uploaded, not the platform's). "missing": the leaders on the platform who are not on the list, with no number and no address.
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const run = params.get("run");
  const part = params.get("part");
  if (!isUuid(run) || (part !== "list" && part !== "missing")) return NOT_FOUND();
  const session = await getSession();
  if (!session || !hasAnyRole(session.roles, LEADER_CARD_ROLES)) return NOT_FOUND();
  const report = await loadHodReport(await createClient(), run);
  if (!report.ok) return NOT_FOUND();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(part === "list" ? hodListCsv(report) : hodMissingCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${part === "list" ? "hod-list-report" : "leaders-not-on-the-list"}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

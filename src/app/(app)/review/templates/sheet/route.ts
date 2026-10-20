import { NextResponse } from "next/server";
import { TEMPLATE_VIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { parseTemplateList, reviewSheet } from "@/lib/cards/templates";
import { createClient } from "@/lib/supabase/server";

// The review sheet is read from the database each time, so it always shows the cards as they stand. It is never cached.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !hasAnyRole(session.roles, TEMPLATE_VIEW_ROLES)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("card_template_list");
  const list = error ? null : parseTemplateList(data);
  if (!list) return new NextResponse("We could not make the sheet just now. Try again in a moment.", { status: 503 });
  return new NextResponse(reviewSheet(list), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tribe-cards-review.csv"',
      "Cache-Control": "no-store",
    },
  });
}

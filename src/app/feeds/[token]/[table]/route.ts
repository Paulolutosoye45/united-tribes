import { NextResponse } from "next/server";
import { feedCsv, isFeedTable } from "@/lib/exports/feeds";
import { isToken } from "@/lib/exports/links";
import { createClient } from "@/lib/supabase/server";
import type { TableRows } from "@/lib/exports/types";

export const dynamic = "force-dynamic";

const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

/** Every fault looks the same, so a guess learns nothing: a link that never existed, one that ended, one for another table, a pack switched off. */
const notFound = () => new NextResponse("Not found", { status: 404, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });

/**
 * A standing link: one coded table, read only, as a CSV, for a reporting tool that fetches a web address on a schedule. No account is
 * involved. The long secret in the address is the credential, and the database checks it, the table it was made for, how long it
 * has left, and that the pack and this way in are still switched on. Coded tables only: there is no name in any of them.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string; table: string }> }) {
  const { token, table } = await ctx.params;
  if (!isToken(token) || !isFeedTable(table)) return notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_feed_read", { p_token: token, p_table: table });
  if (error || !data || typeof data !== "object") return notFound();
  const body = feedCsv(data as TableRows);
  return new NextResponse(body, {
    status: 200,
    headers: { ...HEADERS, "content-type": "text/csv; charset=utf-8", "content-disposition": `inline; filename="united-tribes-${table}.csv"`, "content-security-policy": "default-src 'none'; sandbox" },
  });
}

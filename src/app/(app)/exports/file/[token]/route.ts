import { NextResponse } from "next/server";
import { ExportError, makeFile } from "@/lib/exports/load";
import { isToken, printHref } from "@/lib/exports/links";
import { parseOpened } from "@/lib/exports/parse";
import { friendly, TRY_AGAIN } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Building a large workbook takes a moment; this is well above the time it needs.
export const maxDuration = 30;

const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } as const;

const refuse = (message: string, status: number) => NextResponse.json({ message }, { status, headers: HEADERS });
const clip = (message: string) => (message.length <= 200 ? message : TRY_AGAIN);

/**
 * A prepared file, made now, for the one account its link belongs to. The database opens the link (and says why not if it has
 * ended, belongs to someone else, or the pack is no longer open to this person); every figure in the file is then read as that same
 * person, so the database applies its own rules a second time. Nothing is stored: the file is built from the answer and sent.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Anything that is not a link gets the same answer as a link that does not exist.
  if (!isToken(token)) return refuse("We could not find that file.", 404);

  const supabase = await createClient();
  const open = await supabase.rpc("export_open", { p_token: token });
  if (open.error) return refuse(friendly(open.error), open.error.code === "42501" ? 403 : open.error.code === "P0002" ? 404 : 502);
  const opened = parseOpened(open.data);
  if (!opened) return refuse("We could not find that file.", 404);

  // A printed page is made by the print view, in the browser.
  if (opened.format === "pdf") return new NextResponse(null, { status: 303, headers: { location: printHref(token), ...HEADERS } });

  try {
    const file = await makeFile((fn, args) => supabase.rpc(fn, args), opened, new Date());
    await supabase.rpc("export_done", { p_export: opened.export_id, p_rows: file.rows, p_ok: true });
    return new NextResponse(new Uint8Array(file.body), {
      status: 200,
      headers: {
        ...HEADERS,
        "content-type": file.contentType,
        "content-length": String(file.body.length),
        "content-disposition": `attachment; filename="${file.filename}"`,
        // Whatever the file is, the browser saves it and never runs it
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    const known = error instanceof ExportError ? error : null;
    await supabase.rpc("export_done", { p_export: opened.export_id, p_rows: 0, p_ok: false, p_note: known ? known.message : "The file could not be made" });
    if (!known) console.error("export failed", error instanceof Error ? error.message : "unknown");
    return refuse(known && known.status < 500 ? clip(known.message) : TRY_AGAIN, known && known.status < 500 ? known.status : 500);
  }
}

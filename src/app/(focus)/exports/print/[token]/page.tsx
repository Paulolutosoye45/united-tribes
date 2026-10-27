import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PrintButton } from "@/components/exports/PrintButton";
import { PrintSheet } from "@/components/exports/PrintSheet";
import { ExportError, loadWorkbook, rowTotal } from "@/lib/exports/load";
import { fileHref, isToken } from "@/lib/exports/links";
import { parseOpened } from "@/lib/exports/parse";
import { friendly, TRY_AGAIN } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Print", robots: { index: false, follow: false } };

function Problem({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5 py-10" data-testid="print-problem">
      <h1 className="t-title">This page can’t be made</h1>
      <p className="t-body text-soft" role="alert">
        {message}
      </p>
      <Link href="/exports" className="btn btn-solid inline-flex h-12 w-fit items-center rounded-[var(--radius-control)] px-5 font-semibold">
        Back to Exports
      </Link>
    </main>
  );
}

/**
 * A printed page, made now for the one account its link belongs to. The link is opened in the database exactly as the file route does
 * (the person, the link's life and the pack's position are all checked again), and the page is built from the same typed tables as the
 * spreadsheet. Nothing is stored. The page shows a button to print or save it as a PDF; the browser does the rest.
 */
export default async function PrintPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!isToken(token)) return <Problem message="We could not find that page." />;

  const supabase = await createClient();
  const open = await supabase.rpc("export_open", { p_token: token });
  if (open.error) return <Problem message={friendly(open.error)} />;
  const opened = parseOpened(open.data);
  if (!opened) return <Problem message="We could not find that page." />;
  // A link made for a spreadsheet downloads it instead
  if (opened.format !== "pdf") redirect(fileHref(token));

  let workbook;
  try {
    workbook = await loadWorkbook((fn, args) => supabase.rpc(fn, args), opened, new Date());
  } catch (error) {
    const known = error instanceof ExportError ? error : null;
    await supabase.rpc("export_done", { p_export: opened.export_id, p_rows: 0, p_ok: false, p_note: known ? known.message : "The page could not be made" });
    return <Problem message={known && known.status < 500 && known.message.length <= 200 ? known.message : TRY_AGAIN} />;
  }
  // Said once for this link (opening it again only repeats the same count)
  await supabase.rpc("export_done", { p_export: opened.export_id, p_rows: rowTotal(workbook), p_ok: true });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 sm:px-8 print:max-w-none print:p-0" data-testid="print-page">
      <PrintButton />
      <PrintSheet workbook={workbook} />
    </main>
  );
}

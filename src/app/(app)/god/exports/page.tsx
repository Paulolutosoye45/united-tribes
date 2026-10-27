import type { Metadata } from "next";
import { connection } from "next/server";
import { ExportBoard } from "@/components/god/ExportBoard";
import { loadExportBoard, loadExportLog } from "@/lib/exports/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Exports" };

/**
 * The switchboard for Exports and Reports. Every switch of this feature is here and nowhere else. The console's layout already shows
 * this to nobody but the unlocked owner, and every function behind it checks again.
 */
export default async function GodExportsPage() {
  await connection();
  const supabase = await createClient();
  const [board, log] = await Promise.all([loadExportBoard(supabase), loadExportLog(supabase, { limit: 40 })]);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Exports</h1>
        <p className="t-body measure text-soft">
          Spreadsheets and printed pages for tribe leaders, community champions, the office and the pastorate. Every switch for this feature is on this page and only you can move it. It starts Off.
        </p>
      </header>
      {board ? <ExportBoard board={board} log={log} /> : <p className="card t-body p-5 text-soft">The exports switchboard is not available right now. Reload the page, or unlock the console again.</p>}
    </div>
  );
}

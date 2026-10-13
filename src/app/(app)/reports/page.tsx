import type { Metadata } from "next";
import Link from "next/link";
import { MakeReportForm } from "@/components/reports/MakeReportForm";
import { Badge } from "@/components/ui/Badge";
import { formatShortDate, lagosDateKey } from "@/lib/dates";
import { REPORT_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { REPORT_KINDS, reportPeriod, reportTitle, type ReportListItem } from "@/lib/dashboard/insight";
import { loadReports } from "@/lib/dashboard/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

const OFFICE = ["admin", "director", "pastor", "data_lead"] as const;

/** "2026-09" for the month before the one we are in. */
function previousMonth(todayKey: string): string {
  const [y, m] = todayKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function ReportsPage() {
  const session = await requireRole(REPORT_ROLES, "/reports");
  const supabase = await createClient();
  const office = session.roles.some((r) => (OFFICE as readonly string[]).includes(r));
  const today = lagosDateKey(new Date().toISOString());

  const [reports, communities] = await Promise.all([
    loadReports(supabase),
    office
      ? supabase
          .from("communities")
          .select("id, name, sort")
          .eq("active", true)
          .order("sort")
          .then((r) => ((r.data as { id: string; name: string }[] | null) ?? []).map((t) => ({ id: t.id, name: t.name })))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // Newest month first, then the kinds in a steady order
  const groups = new Map<string, ReportListItem[]>();
  for (const r of reports) {
    const key = r.kind === "season" ? `season|${r.season}` : r.period_start;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Reports</h1>
        <p className="t-body measure text-soft">
          {office
            ? "A report is made for each month, and for each season once it ends. Open one to read it, reword its summary, or print it as a PDF."
            : "The monthly report for your community. Open one to read it, reword its summary, or print it as a PDF."}
        </p>
      </header>

      {office ? <MakeReportForm communities={communities} defaultMonth={previousMonth(today)} maxMonth={today.slice(0, 7)} /> : null}

      {reports.length === 0 ? (
        <p className="t-body measure text-soft">
          No report has been made yet. The first ones appear in the first days of next month{office ? ", or make one above" : ""}.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([key, items]) => (
            <section key={key} aria-labelledby={`g-${key}`} className="flex flex-col gap-2">
              <h2 id={`g-${key}`} className="t-heading">
                {reportPeriod(items[0])}
              </h2>
              <ul className="card flex flex-col divide-y divide-line p-0">
                {items.map((r) => (
                  <li key={r.id}>
                    <Link href={`/reports/${r.id}`} className="press flex flex-wrap items-center justify-between gap-2 px-5 py-4 hover:bg-surface">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{reportTitle(r)}</span>
                        <span className="t-small text-soft">
                          {REPORT_KINDS[r.kind].title} · {r.season} · made {formatShortDate(r.generated_at)}
                        </span>
                      </span>
                      {r.has_summary ? <Badge tone="outline">Has a summary</Badge> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

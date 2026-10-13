import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/reports/PrintButton";
import { ReportView } from "@/components/reports/ReportView";
import { buttonClasses } from "@/components/ui/Button";
import { REPORT_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { reportPeriod, reportTitle } from "@/lib/dashboard/insight";
import { loadReport } from "@/lib/dashboard/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Report" };

type Params = Promise<{ id: string }>;

export default async function ReportPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(REPORT_ROLES, `/reports/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const report = await loadReport(supabase, id);
  if (!report) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href="/reports" className={buttonClasses({ variant: "quiet", size: "sm" })}>
          <span className="relative">All reports</span>
        </Link>
        <PrintButton />
      </div>
      <p className="print-only t-small">
        United Tribes · {reportTitle(report)} · {reportPeriod(report)}
      </p>
      <ReportView report={report} />
    </div>
  );
}

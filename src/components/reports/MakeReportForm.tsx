"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { makeReportAction } from "@/app/(app)/reports/actions";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Input, Select } from "@/components/ui/Input";
import { REPORT_KINDS, type ReportKind } from "@/lib/dashboard/insight";

const ORDER: ReportKind[] = ["programme", "pastorate", "community", "season"];

/** For the office: make a report now instead of waiting for the monthly run. The same month made twice replaces the figures and keeps any summary a person wrote. */
export function MakeReportForm({ communities, defaultMonth, maxMonth }: { communities: { id: string; name: string }[]; defaultMonth: string; maxMonth: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<ReportKind>("programme");
  const [month, setMonth] = useState(defaultMonth);
  const [community, setCommunity] = useState(communities[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await makeReportAction(kind, month, kind === "community" ? community : null);
    if (!result.ok) {
      setBusy(false);
      return setError(result.message);
    }
    router.push(`/reports/${result.id}`);
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-5 p-5 sm:p-7" aria-labelledby="make-report-heading">
      <div className="flex flex-col gap-1">
        <h2 id="make-report-heading" className="t-heading">
          Make a report now
        </h2>
        <p className="t-small text-soft">Reports are made on their own in the first days of each month. Make one here for another month, or to see today’s figures.</p>
      </div>

      <div role="group" aria-label="Kind of report" className="flex flex-wrap gap-2">
        {ORDER.map((k) => (
          <Chip key={k} selected={kind === k} onClick={() => setKind(k)} disabled={busy}>
            {REPORT_KINDS[k].title}
          </Chip>
        ))}
      </div>
      <p className="t-small text-soft" aria-live="polite">
        {REPORT_KINDS[kind].line}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {kind !== "season" ? (
          <Input label="Month" type="month" value={month} max={maxMonth} min="2024-01" onChange={(e) => setMonth(e.target.value)} disabled={busy} required />
        ) : null}
        {kind === "community" ? (
          <Select label="Community" value={community} onChange={(e) => setCommunity(e.target.value)} disabled={busy}>
            {communities.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="md" loading={busy} disabled={kind === "community" && !community}>
          Make the report
        </Button>
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

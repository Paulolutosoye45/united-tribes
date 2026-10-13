"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSummaryAction } from "@/app/(app)/reports/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { SUMMARY_BY, type ReportDetail } from "@/lib/dashboard/insight";

const MAX = 2400;

/** The few sentences at the top of a report: written for you, and yours to reword. Hidden on paper when empty. */
export function SummaryEditor({ id, summary, by }: { id: string; summary: string | null; by: ReportDetail["summary_by"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await saveSummaryAction(id, text);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <section aria-labelledby="summary-heading" className="card flex flex-col gap-4 p-5 sm:p-7 no-print">
        <h2 id="summary-heading" className="t-heading">
          In short
        </h2>
        <Textarea
          label="Summary"
          hint={`${text.length} of ${MAX} characters. Leave it empty to remove it; the next monthly run will write a new one.`}
          value={text}
          maxLength={MAX}
          rows={7}
          onChange={(e) => setText(e.target.value)}
          error={error}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-3">
          <Button size="md" onClick={() => void save()} loading={busy}>
            Save the summary
          </Button>
          <Button
            size="md"
            variant="quiet"
            onClick={() => {
              setEditing(false);
              setText(summary ?? "");
              setError(null);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="summary-heading" className={`card flex flex-col gap-3 p-5 sm:p-7 ${summary ? "" : "no-print"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="summary-heading" className="t-heading">
          In short
        </h2>
        <button type="button" onClick={() => setEditing(true)} className="no-print press min-h-10 rounded-lg px-2 text-[0.9rem] font-medium underline underline-offset-4">
          {summary ? "Reword it" : "Write a summary"}
        </button>
      </div>
      {summary ? (
        <>
          <p className="t-body measure whitespace-pre-line">{summary}</p>
          {by ? <p className="t-small text-soft no-print">{SUMMARY_BY[by]}</p> : null}
        </>
      ) : (
        <p className="t-body text-soft no-print">The summary is written when the monthly run reaches this report. You can write your own now.</p>
      )}
    </section>
  );
}

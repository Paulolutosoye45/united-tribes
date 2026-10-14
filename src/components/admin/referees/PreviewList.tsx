"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { prettyPhone } from "@/lib/leaders/referee/contact";
import { standingLabel } from "@/lib/leaders/referee/labels";
import type { PlanCounts, PlanRow } from "@/lib/leaders/referee/types";
import { ACTION_WORD, filterRows, orderRows, type PreviewFilter } from "@/lib/leaders/referee/upload";

export const showContact = (value: string) => (value.includes("@") ? value : prettyPhone(value));

const TONE: Record<string, string> = {
  add: "bg-gold/30 text-ink",
  update: "bg-surface-strong text-ink",
  revive: "bg-gold/30 text-ink",
  unchanged: "bg-surface-strong text-soft",
  retire: "bg-flame/20 text-ink",
  error: "bg-danger/10 text-danger",
};

const STEP = 10;

/**
 * Exactly what an upload would do, person by person, before anything is changed. What needs attention comes first. Each row says
 * which line of the spreadsheet it came from, so a mistake can be found and fixed there.
 */
export function PreviewList({ rows, counts, roleTexts }: { rows: PlanRow[]; counts: PlanCounts; roleTexts: Record<string, string> }) {
  const [filter, setFilter] = useState<PreviewFilter>(counts.error > 0 ? "problems" : "all");
  const [shown, setShown] = useState(STEP);
  const ordered = orderRows(filterRows(rows, filter));
  const visible = ordered.slice(0, shown);

  const tabs: { id: PreviewFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: rows.length },
    { id: "problems", label: "Can’t use", n: counts.error },
    { id: "add", label: "New", n: counts.add },
    { id: "update", label: "Updated", n: counts.update },
    { id: "retire", label: "Taken off", n: counts.retire },
  ];

  if (rows.length === 0) return <p className="t-small text-soft">Everyone in this file is already on the list exactly as written. Nothing to change.</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="preview-list">
      <div role="tablist" aria-label="Show" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {tabs
          .filter((t) => t.id === "all" || t.n > 0)
          .map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={filter === t.id}
              onClick={() => {
                setFilter(t.id);
                setShown(STEP);
              }}
              className={cn(
                "press inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-3.5 text-[0.9rem] transition-colors",
                filter === t.id ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-2 text-[0.78rem] tabular-nums", filter === t.id ? "bg-page/20" : "bg-surface-strong")}>{t.n}</span>
            </button>
          ))}
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((r, i) => (
          <li key={`${r.line ?? "x"}-${i}`} className="rounded-[var(--radius-control)] border border-line bg-raised p-3.5" data-action={r.action}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn("rounded-full px-2.5 py-0.5 text-[0.78rem] font-semibold", TONE[r.action])}>{ACTION_WORD[r.action]}</span>
              <span className="min-w-0 break-words font-semibold">{r.name || "No name"}</span>
              {r.standing ? <span className="t-small text-soft">· {standingLabel(r.standing)}</span> : null}
              {r.unit ? <span className="t-small text-soft">· {r.unit}</span> : null}
              {r.line ? <span className="t-small ml-auto text-soft">Row {r.line}</span> : null}
            </div>
            {r.action === "error" ? (
              <p className="t-small mt-1.5 text-danger" role="note">
                {/^.*[.!?”]$/.test(r.message ?? "") ? r.message : `${r.message}.`}
                {r.line !== null && roleTexts[String(r.line)] && /^Role must be/.test(r.message ?? "") ? ` Their role says “${roleTexts[String(r.line)]}”.` : ""}
              </p>
            ) : (
              <>
                {r.contacts.length > 0 ? <p className="t-small mt-1.5 break-words text-soft">{r.contacts.map(showContact).join(" · ")}</p> : null}
                {r.changes.length > 0 ? (
                  <p className="t-small mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-soft">Changes:</span>
                    {r.changes.map((c) => (
                      <span key={c} className="rounded-full bg-surface-strong px-2 py-0.5 text-[0.78rem]">
                        {c}
                      </span>
                    ))}
                  </p>
                ) : null}
              </>
            )}
            {r.warn.map((w) => (
              <p key={w} className="t-small mt-1.5 text-soft">
                <span aria-hidden="true">• </span>
                {w}
              </p>
            ))}
          </li>
        ))}
      </ul>

      {ordered.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + 25)} className="t-small self-start font-semibold text-accent underline underline-offset-4">
          Show {Math.min(25, ordered.length - shown)} more ({ordered.length - shown} left)
        </button>
      ) : null}
    </div>
  );
}

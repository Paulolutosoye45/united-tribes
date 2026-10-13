"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import { REVIEW_STATUS } from "@/lib/leaders/options";
import type { QueueAi, QueueItem } from "@/lib/leaders/review-types";
import { STATE_SHORT } from "@/lib/leaders/quality/wording";
import { isDecided, isInReview } from "@/lib/leaders/status";

type Filter = "todo" | "review" | "decided" | "all";

/**
 * With the first check on, an application still being read, waiting for the applicant, or already scored by the first
 * check does not need a reviewer's score yet. One held for a person does. An application picked for audit does too:
 * a person scores it so the first check can be compared with them.
 */
function waitingOnFirstCheck(ai: QueueAi | undefined, on: boolean) {
  if (!on || !ai) return false;
  if (ai.state === "consent_needed" || ai.state === "checking" || ai.state === "strengthen") return true;
  return ai.state === "clear" && ai.basis === "ai" && !ai.audit;
}

function needsMe(i: QueueItem, ai: QueueAi | undefined, on: boolean) {
  if (!isInReview(i.status)) return false;
  if (waitingOnFirstCheck(ai, on)) return false;
  if (!i.i_reviewed_calling) return true;
  return (i.status === "interview_booked" || i.status === "interviewed") && !i.i_reviewed_interview;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export function ReviewQueue({ items, names, ai = {}, firstCheckOn = false }: { items: QueueItem[]; names: Record<string, string>; ai?: Record<string, QueueAi>; firstCheckOn?: boolean }) {
  const todo = items.filter((i) => needsMe(i, ai[i.id], firstCheckOn));
  const [filter, setFilter] = useState<Filter>(todo.length > 0 ? "todo" : "review");

  const lists: Record<Filter, QueueItem[]> = {
    todo,
    review: items.filter((i) => isInReview(i.status)),
    decided: items.filter((i) => isDecided(i.status)),
    all: items,
  };
  const tabs: { id: Filter; label: string }[] = [
    { id: "todo", label: "To score" },
    { id: "review", label: "In review" },
    { id: "decided", label: "Decided" },
    { id: "all", label: "All" },
  ];
  const shown = lists[filter];

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Applications" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={filter === t.id}
            onClick={() => setFilter(t.id)}
            className={cn(
              "press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.95rem] transition-colors",
              filter === t.id ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-2 text-[0.8rem] tabular-nums", filter === t.id ? "bg-page/20" : "bg-surface-strong")}>{lists[t.id].length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card t-body p-6 text-soft">
          {filter === "todo" ? "You are all caught up. New applications appear here as they come in." : "Nothing here yet."}
        </p>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {shown.map((i, n) => {
            const st = REVIEW_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
            return (
              <li key={i.id} style={{ ["--i" as string]: Math.min(n, 8) }}>
                <Link href={`/review/${i.id}`} className="card press flex items-start gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-5">
                  <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-strong text-[0.9rem] font-bold">
                    {initials(i.applicant)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className="truncate font-semibold">{i.applicant}</span>
                      <Badge tone={st.tone} className="shrink-0">
                        {st.label}
                      </Badge>
                    </span>
                    <span className="t-small block text-soft">
                      {[i.track && names[i.track], i.community && names[i.community]].filter(Boolean).join(" · ") || "Track and community not set"}
                    </span>
                    <span className="t-small mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>References {i.references_received} of 2</span>
                      <span>Scored by {i.calling_reviews}</span>
                      {isInReview(i.status) && !waitingOnFirstCheck(ai[i.id], firstCheckOn) ? (
                        <span className={cn("font-semibold", i.i_reviewed_calling ? "text-success" : "text-accent")}>
                          {i.i_reviewed_calling ? "You scored it" : "Needs your score"}
                        </span>
                      ) : null}
                      {firstCheckOn && ai[i.id] && isInReview(i.status) ? (
                        <span className={cn("font-semibold", ai[i.id].state === "held" ? "text-danger" : "text-soft")} data-testid="queue-first-check">
                          {STATE_SHORT[ai[i.id].state] ?? ai[i.id].state}
                          {ai[i.id].audit ? ", audit: score it too" : ""}
                        </span>
                      ) : null}
                      {i.open_concern ? <span className="font-semibold text-danger">Open concern</span> : null}
                    </span>
                    <span className="t-small mt-1 block text-soft">
                      {i.interview_at ? `Interview ${formatLagosDay(i.interview_at)}, ${formatLagosTime(i.interview_at)}` : i.submitted_at ? `Sent ${formatShortDate(i.submitted_at)}` : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

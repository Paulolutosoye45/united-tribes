import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { LeaderCardsBoard } from "@/components/leader-cards/LeaderCardsBoard";
import { ReminderControl } from "@/components/leader-cards/ReminderControl";
import { Button } from "@/components/ui/Button";
import { LEADER_CARD_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { FILTERS, asFilter, type CardFilter } from "@/lib/leader-cards/cards";
import { loadBoard, loadReminders } from "@/lib/leader-cards/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader cards" };

const PAGE = 100;

type SearchParams = Promise<{ filter?: string; department?: string; page?: string }>;

export default async function LeaderCardsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(LEADER_CARD_ROLES, "/admin/people/leader-cards");
  const q = await searchParams;
  const filter = asFilter(q.filter);
  const department = q.department ? q.department.slice(0, 60) : null;
  const page = Math.max(1, Math.min(500, Number.parseInt(q.page ?? "1", 10) || 1));
  const supabase = await createClient();
  const [board, reminders] = await Promise.all([loadBoard(supabase, { filter, department, limit: PAGE, offset: (page - 1) * PAGE }), loadReminders(supabase)]);

  if (!board.ok) {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title="Leader cards">Where each leader’s Tribe Card is, and whether their email arrived.</PageHead>
        <p className="card t-body p-6 text-soft" data-testid="lc-unavailable">
          This page is not available yet. If you were told it should be, the database file for it has not been applied.
        </p>
      </div>
    );
  }

  const act = board.role === "act";
  const href = (over: Record<string, string | null>): string => {
    const p = new URLSearchParams();
    const next: Record<string, string | null> = { filter: filter === "unfinished" ? null : filter, department, page: null, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/people/leader-cards${s ? `?${s}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(board.total / PAGE));
  const shown: readonly CardFilter[] = ["unfinished", "not_started", "in_progress", "changes_asked", "submitted", "approved", "email_failed", "never_signed_in"];

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Leader cards">
        One card for each leader this season: where their Tribe Card is, whether the email with its link arrived, and a kind way to send it again. Nothing here changes a card.
      </PageHead>

      <section aria-labelledby="lc-counts" className="flex flex-col gap-3">
        <h2 id="lc-counts" className="t-heading">
          {board.counts.all === 0
            ? "No leader has a card yet"
            : board.counts.unfinished === 0
              ? `All ${board.counts.all} cards are sent in`
              : `${board.counts.unfinished} of ${board.counts.all} cards are not finished`}
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="lc-filters">
          {FILTERS.filter((f) => shown.includes(f.key)).map((f) => {
            const on = filter === f.key;
            return (
              <li key={f.key} className={`card flex flex-col gap-1 p-4 ${on ? "border-ink" : ""}`}>
                <Link href={href({ filter: f.key === "unfinished" ? null : f.key })} className="flex flex-col gap-0.5" aria-current={on ? "true" : undefined} data-filter={f.key}>
                  <span className="text-2xl font-semibold" data-testid={`lc-count-${f.key}`}>{board.counts[f.key]}</span>
                  <span className="font-medium underline">{f.label}</span>
                </Link>
                <span className="t-small text-soft">{f.line}</span>
              </li>
            );
          })}
        </ul>
        <p className="t-small text-soft">
          <Link href={href({ filter: "all" })} className="underline">Show everyone</Link>
        </p>
      </section>

      <section aria-label="Lists to download" className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href="/admin/people/leader-cards/download?sheet=hod" data-testid="lc-download-hod" className="t-body font-medium underline">
          Download the list for the heads of department (spreadsheet)
        </a>
        <Link href="/admin/people/leader-cards/reconcile" data-testid="lc-reconcile" className="t-body font-medium underline">
          Check the list of heads of department against the platform
        </Link>
        {act ? (
          <a href="/admin/people/leader-cards/download?sheet=call" data-testid="lc-download-call" className="t-body font-medium underline">
            Download the call sheet, with numbers and addresses (spreadsheet)
          </a>
        ) : (
          <span className="t-small text-soft">You can read this board and download the list for the heads of department.</span>
        )}
      </section>

      <form method="get" role="search" aria-label="Filter the leaders" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Show
          <select name="filter" defaultValue={filter} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Department
          <select name="department" defaultValue={department ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">Every department</option>
            <option value="none">No department yet</option>
            {board.departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" variant="quiet">Filter</Button>
        {filter !== "unfinished" || department ? (
          <Link href="/admin/people/leader-cards" className="t-small inline-flex min-h-12 items-center underline">Clear</Link>
        ) : null}
      </form>

      <LeaderCardsBoard board={board} />

      {pages > 1 ? (
        <nav aria-label="Pages" className="t-body flex items-center gap-4">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="underline">Earlier</Link> : null}
          <span className="text-soft">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="underline">Next</Link> : null}
        </nav>
      ) : null}

      <ReminderControl reminders={reminders} />
    </div>
  );
}

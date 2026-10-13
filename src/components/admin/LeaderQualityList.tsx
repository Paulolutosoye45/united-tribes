import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/dates";
import { LIST_FILTERS, LIST_LABEL, PAGE_SIZE, type LeaderAiList, type LeaderAiOverview, type ListFilter } from "@/lib/leaders/quality/admin";
import { FLAG_LABEL, type Flag } from "@/lib/leaders/quality/fields";
import { OUTCOME_LABEL, STATE_SHORT } from "@/lib/leaders/quality/wording";
import { REVIEW_STATUS } from "@/lib/leaders/options";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where everyone stands, and whether the reading is keeping up. Counts only: no names, no answers. */
export function OverviewTiles({ overview }: { overview: LeaderAiOverview }) {
  const c = overview.counts;
  const tiles = [
    { label: "Held for a person", value: c.held ?? 0, note: "Waiting for a pastor", key: "held" },
    { label: "With the applicant", value: c.strengthen ?? 0, note: "Asked to add to answers", key: "strengthen" },
    { label: "Being read", value: (c.checking ?? 0) + (c.consent_needed ?? 0), note: `${c.consent_needed ?? 0} waiting for agreement`, key: "checking" },
    { label: "Passed", value: c.clear ?? 0, note: "Cleared by the check or a person", key: "clear" },
  ];
  const q = overview.queue;
  const late = q.oldest_minutes !== null && q.oldest_minutes >= 60;
  return (
    <div className="flex flex-col gap-4" data-testid="overview">
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.key} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]" data-testid={`count-${t.key}`}>
              {t.value}
            </dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>
      {late || q.failed_24h > 0 ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid="queue-warning">
          {late ? `An application has been waiting ${Math.round((q.oldest_minutes ?? 0) / 60)} hours for its reading. ` : ""}
          {q.failed_24h > 0 ? `${plural(q.failed_24h, "reading")} failed in the last day. ` : ""}
          Check the AI service key and the sending service. Nobody is turned away while this is wrong: those applications are held for a person.
        </p>
      ) : null}
      <p className="t-small text-soft">
        Last 30 days: {plural(overview.usage.ai_runs_30d, "AI reading")}
        {overview.usage.avg_latency_ms ? `, about ${Math.round(overview.usage.avg_latency_ms / 100) / 10} seconds each` : ""}.
        {overview.audit.pairs > 0
          ? ` Where a person also scored an application the check passed (${plural(overview.audit.pairs, "case")}), the two were ${overview.audit.mean_gap ?? "–"} points apart on average out of 100.`
          : " No passed application has been scored by a person yet, so there is nothing to compare."}
        {q.queued + q.running > 0 ? ` ${plural(q.queued + q.running, "reading")} waiting now.` : ""}
      </p>
    </div>
  );
}

const href = (list: ListFilter, q: string, page = 1) => {
  const p = new URLSearchParams();
  if (list !== "held") p.set("list", list);
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return `/admin/leader-quality${s ? `?${s}` : ""}`;
};

/** The held list and its siblings. Paged and searchable by name; every step is a plain link so it works without scripts. */
export function HeldList({ list, filter, search, page, names }: { list: LeaderAiList; filter: ListFilter; search: string; page: number; names: Record<string, string> }) {
  const countOf = (f: ListFilter) => (f === "all" ? Object.values(list.counts).reduce((a, b) => a + b, 0) : (list.counts[f] ?? 0));
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  return (
    <section aria-labelledby="list-heading" className="flex flex-col gap-4" data-testid="held-list">
      <div>
        <h2 id="list-heading" className="t-heading">
          Applications
        </h2>
        <p className="t-small text-soft">The ones held for a person come first, longest waiting at the top. Open one to read it, let it through, or ask the applicant to add to an answer.</p>
      </div>

      <nav aria-label="Applications" className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        {LIST_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f, search)}
            aria-current={filter === f ? "page" : undefined}
            className={cn(
              "press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border-[1.5px] px-4 text-[0.95rem] transition-colors",
              filter === f ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft",
            )}
          >
            {LIST_LABEL[f]}
            <span className={cn("rounded-full px-2 text-[0.8rem] tabular-nums", filter === f ? "bg-page/20" : "bg-surface-strong")}>{countOf(f)}</span>
          </Link>
        ))}
      </nav>

      <form action="/admin/leader-quality" method="get" role="search" className="flex flex-wrap items-center gap-3">
        {filter !== "held" ? <input type="hidden" name="list" value={filter} /> : null}
        <label htmlFor="lq-search" className="sr-only">
          Search by name
        </label>
        <input
          id="lq-search"
          name="q"
          defaultValue={search}
          placeholder="Search by name"
          maxLength={80}
          className="h-12 w-full max-w-xs rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base focus:border-ink focus:outline-none"
        />
        <button type="submit" className={buttonClasses({ variant: "quiet", size: "md" })}>
          Search
        </button>
        {search ? (
          <Link href={href(filter, "")} className="t-small text-soft underline underline-offset-4">
            Clear search
          </Link>
        ) : null}
      </form>

      {list.rows.length === 0 ? (
        <p className="card t-body p-6 text-soft">{search ? "No one matches that name here." : filter === "held" ? "Nothing is held for a person. New ones appear here." : "Nothing here yet."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.rows.map((r) => {
            const st = REVIEW_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };
            return (
              <li key={r.id}>
                <Link href={`/review/${r.id}`} className="card press flex flex-col gap-2 p-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-5">
                  <span className="flex flex-wrap items-start justify-between gap-3">
                    <span className="font-semibold">{r.applicant}</span>
                    <span className="flex flex-wrap gap-2">
                      <Badge tone={r.state === "held" ? "flame" : "outline"}>{STATE_SHORT[r.state] ?? r.state}</Badge>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                  </span>
                  <span className="t-small text-soft">
                    {[r.track && names[r.track], r.community && names[r.community]].filter(Boolean).join(" · ") || "Track and community not set"}
                    {r.submitted_at ? ` · Sent ${formatShortDate(r.submitted_at)}` : ""}
                    {` · ${r.waiting_days <= 0 ? "since today" : `${plural(r.waiting_days, "day")} here`}`}
                  </span>
                  <span className="t-small flex flex-wrap items-center gap-x-3 gap-y-1">
                    {r.asked_person_at ? <span className="font-semibold text-accent">Asked for a person to read it</span> : null}
                    {r.rewrites_used > 0 ? <span>Updated {plural(r.rewrites_used, "time")}</span> : null}
                    {r.calling_pct !== null ? <span>Reading {Math.round(Number(r.calling_pct))}%</span> : null}
                    {r.confidence !== null ? <span>Confidence {Math.round(Number(r.confidence) * 100)}%</span> : null}
                    {r.outcome && r.shadow ? <span>Recording only: {OUTCOME_LABEL[r.outcome] ?? r.outcome}</span> : null}
                  </span>
                  {(r.flags ?? []).length > 0 ? (
                    <span className="flex flex-wrap gap-2">
                      {(r.flags ?? []).map((f) => (
                        <Badge key={f} tone="flame">
                          {FLAG_LABEL[f as Flag] ?? f}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={href(filter, search, page - 1)} className={buttonClasses({ variant: "quiet", size: "md" })}>
              <span className="relative">Earlier</span>
            </Link>
          ) : (
            <span />
          )}
          <span className="t-small text-soft">
            Page {page} of {pages} · {plural(list.total, "application")}
          </span>
          {page < pages ? (
            <Link href={href(filter, search, page + 1)} className={buttonClasses({ variant: "quiet", size: "md" })}>
              <span className="relative">Later</span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

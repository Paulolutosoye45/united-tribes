import Link from "next/link";
import { DeskReveal } from "@/components/god/DeskReveal";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { DESK_WORDS as W, FAITH, PAGE_SIZE, POOLS, SERVING, SIGNAL_PARTS, type LeaderRow, type LeadersPage, type Overview, type Pool } from "@/lib/god/desk";

const href = (pool: Pool, page = 1) => {
  const q = new URLSearchParams({ tab: "leaders", pool });
  if (page > 1) q.set("page", String(page));
  return `/god/leader-desk?${q.toString()}`;
};

function Parts({ parts }: { parts: LeaderRow["parts"] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" aria-label="What the signal is made of">
      {SIGNAL_PARTS.map((p) => (
        <div key={p.key} className="flex items-center justify-between gap-3">
          <dt className="t-small text-soft">{p.label}</dt>
          <dd className="t-small tabular-nums">
            {parts[p.key]} of {p.max}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ r }: { r: LeaderRow }) {
  return (
    <li className="card flex flex-col gap-3 p-4" data-testid="desk-leader-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-semibold">{r.name}</p>
          <p className="t-small text-soft">
            {r.tribe ? `In ${r.tribe}` : "Waiting for a tribe"}
            {r.community ? ` · ${r.community}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={r.pool === "ready" ? "flame" : "neutral"}>Signal {r.score} of 100</Badge>
          {r.serving ? <Badge tone="outline">{SERVING[r.serving] ?? r.serving}</Badge> : <Badge tone="outline">{SERVING.none}</Badge>}
          {r.faith ? <Badge tone="outline">{FAITH[r.faith] ?? r.faith}</Badge> : null}
        </div>
      </div>
      <ul className="t-small flex list-disc flex-col gap-0.5 pl-5 text-soft">
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <Parts parts={r.parts} />
      <DeskReveal person={r.personId} masked={r.phone} hasNumber={r.hasNumber} />
    </li>
  );
}

/** The Leaders tab: members by leadership signal, in three pools. It shows and scores; recommending someone and forming a tribe come next. */
export function DeskLeaders({ overview, page, pool, pageNo }: { overview: Overview; page: LeadersPage; pool: Pool; pageNo: number }) {
  const pages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const current = POOLS.find((p) => p.key === pool) ?? POOLS[0];
  return (
    <section aria-labelledby="desk-leaders-h" className="flex flex-col gap-4">
      <h2 id="desk-leaders-h" className="sr-only">
        Members by leadership signal
      </h2>
      <p className="t-body measure text-soft">{W.signalHelp}</p>
      <nav aria-label="Pools of possible leaders" className="flex flex-wrap gap-2">
        {POOLS.map((p) => (
          <Link
            key={p.key}
            href={href(p.key)}
            title={p.help}
            aria-current={pool === p.key ? "page" : undefined}
            className={cn("press rounded-full px-4 py-2 text-[0.92rem] font-medium", pool === p.key ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
          >
            {p.label}
            <span className="ml-2 tabular-nums">{overview.leaders[p.key]}</span>
          </Link>
        ))}
      </nav>
      <p className="t-small text-soft">{current.help}</p>

      {page.rows.length === 0 ? (
        <p className="card t-body p-5 text-soft">{W.leadersEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.rows.map((r) => (
            <Row key={r.personId} r={r} />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          {pageNo > 1 ? (
            <Link href={href(pool, pageNo - 1)} className="t-body underline">
              Earlier
            </Link>
          ) : (
            <span />
          )}
          <span className="t-small text-soft">
            Page {pageNo} of {pages}
          </span>
          {pageNo < pages ? (
            <Link href={href(pool, pageNo + 1)} className="t-body underline">
              Later
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}

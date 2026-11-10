import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { SeatPause, SeatRowActions, SeatTestSend } from "@/components/seat/SeatControls";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SEAT_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { SEAT_FILTERS, SEAT_FLAGS, SEAT_WORDS as W, hoursWords, isSeatFilter, lagosWhen, type SeatFilter } from "@/lib/seat/seat";
import { loadSeatBoard } from "@/lib/seat/seat-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seats" };

const PAGE = 50;
type SearchParams = Promise<{ show?: string; page?: string }>;
const TILE_ORDER = ["waiting", "under24", "blocked", "not_reached", "kept", "released", "hard"] as const;

/**
 * Seats: every seat the church placed that has a clock, and where the clock stands. Every number above the list is computed from the same rows as the list, so
 * they cannot disagree, and each tile opens the rows it counts. Names, tribes and times only: never a phone number, a note or a reason a member gave.
 * The admin, a director and a pastor act on a row; a data lead only looks. The database checks the same.
 */
export default async function SeatsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(SEAT_ROLES, "/admin/seats");
  const q = await searchParams;
  const filter: SeatFilter | null = isSeatFilter(q.show) ? q.show : null;
  const page = Math.max(1, Math.min(500, Number.parseInt(q.page ?? "1", 10) || 1));
  const supabase = await createClient();
  const board = await loadSeatBoard(supabase, filter, PAGE, (page - 1) * PAGE);

  if (!board) {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title={W.title}>{W.intro}</PageHead>
        <p className="card t-body p-6 text-soft" role="alert" data-testid="seats-unavailable">{W.unavailable}</p>
      </div>
    );
  }

  const href = (over: Record<string, string | null>): string => {
    const p = new URLSearchParams();
    const next: Record<string, string | null> = { show: filter, page: null, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/seats${s ? `?${s}` : ""}`;
  };
  const h = board.health;
  const canAct = board.role === "act";
  const pages = Math.max(1, Math.ceil(board.total / PAGE));

  return (
    <div className="flex flex-col gap-8">
      <PageHead title={W.title}>{W.intro}</PageHead>

      {h.mode === "off" && !h.paused ? (
        <p className="card t-body p-5 text-soft" role="status" data-testid="seats-off">{W.off}</p>
      ) : board.rehearsal ? (
        <p className="card t-body p-5 text-soft" role="status" data-testid="seats-rehearsal">{W.rehearsal}</p>
      ) : null}
      {h.paused ? <p className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium" role="status" data-testid="seats-paused">{W.paused}</p> : null}

      <section aria-labelledby="seat-health-h" className="flex flex-col gap-2" data-testid="seats-health">
        <h2 id="seat-health-h" className="t-heading">{W.health}</h2>
        {h.problems.length === 0 ? <p className="t-body text-soft">{W.healthOk}</p> : (
          <ul className="t-body flex list-disc flex-col gap-1 pl-5" role="status">
            {h.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="t-small text-soft">
          {W.lastBeat(h.lastBeatAt ? lagosWhen(h.lastBeatAt) : "")} · Emails today: {h.sentToday} sent, {h.deliveredToday} delivered, {h.failedToday} failed · Releases today: {h.releasesToday} of {h.dayCap}
          {h.overCapacity > 0 ? ` · ${h.overCapacity} ${h.overCapacity === 1 ? "tribe holds" : "tribes hold"} more people than it has seats` : ""}
        </p>
        {canAct ? (
          <div className="flex flex-wrap gap-4">
            <SeatPause paused={h.paused} />
            <SeatTestSend />
          </div>
        ) : null}
      </section>

      <section aria-label="Where the seats stand" className="flex flex-col gap-3">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="seats-tiles">
          {TILE_ORDER.map((k) => {
            const on = filter === k;
            return (
              <li key={k} className={`card flex flex-col gap-0.5 p-4 ${on ? "border-ink" : ""}`}>
                <Link href={on ? href({ show: null }) : href({ show: k })} aria-current={on ? "true" : undefined} data-tile={k} className="flex flex-col gap-0.5">
                  <span className="text-2xl font-semibold tabular-nums" data-testid={`seat-tile-${k}`}>{board.tiles[k] ?? 0}</span>
                  <span className="font-medium underline">{W.tiles[k]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <form method="get" role="search" aria-label="Filter the seats" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          {W.filters.label}
          <select name="show" defaultValue={filter ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">{W.filters.any}</option>
            {SEAT_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" variant="quiet">{W.filters.apply}</Button>
        {filter ? <Link href="/admin/seats" className="t-small inline-flex min-h-12 items-center underline">{W.filters.clear}</Link> : null}
      </form>

      {board.rows.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="seats-empty">{W.none}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] text-left" data-testid="seats-table">
            <caption className="sr-only">Seats and where their clocks stand ({board.total})</caption>
            <thead>
              <tr className="t-small border-b border-line text-soft">
                {W.columns.map((c, i) => (
                  <th key={`${c}${i}`} scope="col" className="px-4 py-3 font-medium">{c || <span className="sr-only">Actions</span>}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.rows.map((r) => (
                <tr key={r.tmId} className="align-top" data-tm={r.tmId} data-flag={r.flag}>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3">
                    <p>{r.tribe}</p>
                    {r.leader ? <p className="t-small text-soft">{r.leader}</p> : null}
                  </td>
                  <td className="t-small px-4 py-3">
                    {r.flag === "released" || r.flag === "hard" ? (r.retakeUntil ? W.until(lagosWhen(r.retakeUntil)) : "–") : r.hoursLeft !== null ? `${W.left(r.hoursLeft)}${r.deadlineAt ? `, until ${lagosWhen(r.deadlineAt)}` : ""}` : `${hoursWords(r.hoursIn)} in`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={r.flag === "not_reached" || r.flag === "blocked" ? "flame" : r.flag === "kept" ? "gold" : "outline"}>{SEAT_FLAGS[r.flag] ?? r.flag}</Badge>
                      {r.extended ? <Badge tone="outline">{W.extended}</Badge> : null}
                      {r.chain > 1 ? <Badge tone="outline">{W.chain(r.chain)}</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <SeatRowActions clock={r.clockId} name={r.name} flag={r.flag} extended={r.extended} canAct={canAct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-4">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="t-body min-h-11 font-medium underline">← Earlier</Link> : <span />}
          <span className="t-small text-soft">Page {page} of {pages} · {board.total} seats</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="t-body min-h-11 font-medium underline">{W.more} →</Link> : <span />}
        </nav>
      ) : (
        <p className="t-small text-soft">{board.total} {board.total === 1 ? "seat" : "seats"}</p>
      )}
    </div>
  );
}

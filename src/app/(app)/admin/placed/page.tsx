import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { HoldControl, PlacedPause } from "@/components/placed/PlacedControls";
import { PlacedTabs } from "@/components/placed/PlacedTabs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PLACED_BOARD_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatLagosDay } from "@/lib/dates";
import {
  ANSWER_LABELS,
  BOARD_WORDS as W,
  CALL_LABELS,
  EXTRA_TILES,
  FLAG_LABELS,
  TILES,
  isTile,
  stepLabel,
  timeLeft,
  type TileKey,
} from "@/lib/placement/answers";
import { loadBoardRows, loadBoardSummary, loadBoardTribes } from "@/lib/placement/answers-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Placed members" };

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = ["none", "2a", "2b", "3", "4", "remind"] as const;
const ANSWERS = ["none", "yes", "not_season", "other_tribe", "call_me", "remind"] as const;
const CALLS = ["not_needed", "asked", "waiting", "tried", "reached", "wrong_number", "dont_call"] as const;

type SearchParams = Promise<{ tile?: string; tribe?: string; step?: string; answer?: string; flag?: string; call?: string; opened?: string; page?: string }>;
const pick = <T extends string>(v: string | undefined, list: readonly T[]): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

/**
 * Placed members: every member the church placed this season and where they stand, from "placed" to "answered", with the ones who need a call at the top. The
 * admin, a director and a pastor read it; the admin and a director also hold a seat and use the call desk. It lists names, tribes and steps, and never a phone number.
 */
export default async function PlacedBoardPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(PLACED_BOARD_ROLES, "/admin/placed");
  const q = await searchParams;
  const tile: TileKey | null = isTile(q.tile) ? q.tile : null;
  const tribe = q.tribe && UUID.test(q.tribe) ? q.tribe : null;
  const step = pick(q.step, STEPS);
  const answer = pick(q.answer, ANSWERS);
  const flag = pick(q.flag, Object.keys(FLAG_LABELS) as string[]);
  const call = pick(q.call, CALLS);
  const opened = pick(q.opened, ["yes", "no"] as const);
  const page = Math.max(1, Math.min(500, Number.parseInt(q.page ?? "1", 10) || 1));
  const supabase = await createClient();
  const [summary, tribes, board] = await Promise.all([
    loadBoardSummary(supabase),
    loadBoardTribes(supabase),
    loadBoardRows(supabase, { tile, tribe, step, answer, flag, call, opened }, PAGE, (page - 1) * PAGE),
  ]);

  if (!summary) {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title="Placed members">Where each placed member stands.</PageHead>
        <p className="card t-body p-6 text-soft" role="alert" data-testid="placed-unavailable">
          The board is not available right now. Reload the page. If the database has not had the Package 6b file applied yet, there is nothing to show.
        </p>
      </div>
    );
  }

  const href = (over: Record<string, string | null>): string => {
    const p = new URLSearchParams();
    const next: Record<string, string | null> = { tile, tribe, step, answer, flag, call, opened, page: null, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/placed${s ? `?${s}` : ""}`;
  };
  const filtered = Boolean(tile || tribe || step || answer || flag || call || opened);
  const pages = Math.max(1, Math.ceil(board.total / PAGE));
  const tiles = summary.tiles;
  const count: Record<TileKey, number> = { placed: tiles.placed, emailed: tiles.emailed, opened: tiles.opened, answered: tiles.answered, needs_call: tiles.needsCall, waiting: tiles.waiting, asked: tiles.asked, under48: tiles.under48 };
  const h = summary.health;

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Placed members">{W.intro}</PageHead>
      <PlacedTabs current="board" canDesk={summary.canDesk} />

      {summary.state === "off" ? (
        <p className="card t-body p-5 text-soft" role="status" data-testid="placed-off">{W.off}</p>
      ) : summary.state === "rehearsal" ? (
        <p className="card t-body p-5 text-soft" role="status" data-testid="placed-rehearsal">
          {W.rehearsal(summary.rehearsal.enrolled)}
          {Object.keys(summary.rehearsal.wouldSend).length > 0 ? ` ${W.rehearsalSteps(summary.rehearsal.wouldSend)}` : ""}
        </p>
      ) : null}
      {summary.paused ? (
        <p className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium" role="status" data-testid="placed-paused">{W.paused(summary.pausedReason)}</p>
      ) : null}

      <section aria-labelledby="funnel-h" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="funnel-h" className="t-heading">{W.funnel}</h2>
          {summary.hoursLeft !== null ? <p className="t-small text-soft" data-testid="placed-left">{W.left(summary.hoursLeft, summary.deadline)}</p> : null}
        </div>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="placed-tiles">
          {TILES.map((t) => {
            const on = tile === t.key;
            return (
              <li key={t.key} className={`card flex flex-col gap-0.5 p-4 ${on ? "border-ink" : ""}`}>
                <Link href={on ? href({ tile: null }) : href({ tile: t.key })} aria-current={on ? "true" : undefined} data-tile={t.key} className="flex flex-col gap-0.5">
                  <span className="text-2xl font-semibold tabular-nums" data-testid={`tile-${t.key}`}>{count[t.key]}</span>
                  <span className="font-medium underline">{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <ul className="flex flex-wrap gap-2" data-testid="placed-extra-tiles">
          {EXTRA_TILES.map((t) => {
            const on = tile === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={on ? href({ tile: null }) : href({ tile: t.key })}
                  aria-current={on ? "true" : undefined}
                  data-tile={t.key}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[0.9rem] ${on ? "border-ink bg-ink text-page" : "border-line bg-raised"}`}
                >
                  <span className="font-semibold tabular-nums" data-testid={`tile-${t.key}`}>{count[t.key]}</span>
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="t-small max-w-[64ch] text-soft">{W.honest}</p>
      </section>

      <section aria-labelledby="health-h" className="flex flex-col gap-2" data-testid="placed-health">
        <h2 id="health-h" className="t-heading">{W.health}</h2>
        <p className="t-body text-soft">{h.sent === 0 ? W.noHealth : W.healthLine(h)}</p>
        {summary.canDesk && summary.state !== "off" ? <PlacedPause paused={summary.paused} /> : null}
      </section>

      <form method="get" role="search" aria-label="Filter the board" className="flex flex-wrap items-end gap-3">
        {tile ? <input type="hidden" name="tile" value={tile} /> : null}
        <Select name="tribe" label={W.filters.tribe} value={tribe} options={tribes.map((t) => [t.tribe, t.name] as const)} />
        <Select name="step" label={W.filters.step} value={step} options={STEPS.map((s) => [s, stepLabel(s)] as const)} />
        <Select name="opened" label={W.columns[4]} value={opened} options={[["yes", W.filters.yes], ["no", W.filters.no]]} />
        <Select name="answer" label={W.filters.answer} value={answer} options={ANSWERS.map((a) => [a, ANSWER_LABELS[a]] as const)} />
        <Select name="flag" label={W.filters.flag} value={flag} options={Object.entries(FLAG_LABELS)} />
        <Select name="call" label={W.filters.call} value={call} options={CALLS.map((c) => [c, CALL_LABELS[c]] as const)} />
        <Button type="submit" size="md" variant="quiet">{W.filters.apply}</Button>
        {filtered ? <Link href="/admin/placed" className="t-small inline-flex min-h-12 items-center underline">{W.filters.clear}</Link> : null}
      </form>

      {board.rows.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="placed-empty">{filtered ? W.none : "No one has been placed yet this season."}</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[60rem] text-left" data-testid="placed-table">
            <caption className="sr-only">Placed members and where they stand ({board.total})</caption>
            <thead>
              <tr className="t-small border-b border-line text-soft">
                {W.columns.map((c) => (
                  <th key={c} scope="col" className="px-4 py-3 font-medium">{c}</th>
                ))}
                {summary.canDesk ? <th scope="col" className="px-4 py-3 font-medium">Seat</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.rows.map((r) => (
                <tr key={r.tm} className="align-top" data-tm={r.tm} data-answer={r.answer} data-desk={r.desk ?? ""}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.name}</p>
                    <Link href={href({ tribe: r.tribeId })} className="t-small text-soft underline">{r.tribe}</Link>
                  </td>
                  <td className="t-small px-4 py-3 text-soft">{r.placedAt ? formatLagosDay(r.placedAt) : "–"}</td>
                  <td className="t-small px-4 py-3">{stepLabel(r.step)}{r.sends > 0 ? ` (${r.sends})` : ""}</td>
                  <td className="t-small px-4 py-3 text-soft">
                    {r.lastTouchAt ? `${formatLagosDay(r.lastTouchAt)}${r.lastTouch ? `, ${r.lastTouch}` : ""}` : "–"}
                  </td>
                  <td className="px-4 py-3">{r.opened ? "Yes" : r.emailed ? "No" : "–"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.answer === "yes" ? "gold" : r.answered ? "neutral" : r.answer === "call_me" ? "flame" : "outline"}>{ANSWER_LABELS[r.answer] ?? r.answer}</Badge>
                  </td>
                  <td className="t-small px-4 py-3">{r.answered ? "–" : timeLeft(r.hoursLeft) || "–"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <Badge key={f} tone="outline">{FLAG_LABELS[f] ?? f}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="t-small px-4 py-3">
                    {r.desk && summary.canDesk ? (
                      <Link href="/admin/placed/desk" className="underline">{CALL_LABELS[r.call] ?? r.call}</Link>
                    ) : (
                      CALL_LABELS[r.call] ?? r.call
                    )}
                    {r.tries > 0 ? ` · ${r.tries}` : ""}
                  </td>
                  {summary.canDesk ? (
                    <td className="px-4 py-3">{r.answered ? "–" : <HoldControl tm={r.tm} name={r.name} held={r.flags.includes("held")} />}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-4">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="t-body min-h-11 font-medium underline">← Earlier</Link> : <span />}
          <span className="t-small text-soft">Page {page} of {pages} · {board.total} members</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="t-body min-h-11 font-medium underline">{W.more} →</Link> : <span />}
        </nav>
      ) : (
        <p className="t-small text-soft">{board.total} {board.total === 1 ? "member" : "members"}</p>
      )}
    </div>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value: string | null; options: readonly (readonly [string, string])[] }) {
  return (
    <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
      {label}
      <select name={name} defaultValue={value ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
        <option value="">{W.filters.any}</option>
        {options.map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </label>
  );
}

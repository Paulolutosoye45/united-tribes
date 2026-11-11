"use client";

import { seatMoreTimeAction } from "@/app/(app)/lead/tribe/seat-window-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { LEADER_SEAT_WORDS as W, hoursWords, type LeaderStrip } from "@/lib/seat/seat";

/**
 * First names and where each seat in this tribe stands while the seat window runs. No phone, no email, no reason: a leader sees who is waiting, how long is left
 * and, if they lead the tribe, can give one person 48 hours more, once. The office and the database decide everything else.
 */
export function LeaderSeatStrip({ strip, canAsk }: { strip: LeaderStrip; canAsk: boolean }) {
  const d = useDo();
  return (
    <section aria-labelledby="seat-strip-h" className="card flex flex-col gap-3 p-5" data-testid="leader-seat-strip">
      <div className="flex flex-col gap-1">
        <h2 id="seat-strip-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.intro}</p>
        {strip.mode === "rehearsal" ? <p className="t-small font-medium text-soft">{W.rehearsal}</p> : null}
      </div>
      {strip.rows.length === 0 ? (
        <p className="t-body text-soft">{W.none}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {strip.rows.map((r, i) => (
            <li key={r.clockId ?? `${r.first}-${i}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex flex-col">
                <span className="t-body font-medium">{r.first}</span>
                <span className="t-small text-soft">
                  {r.flag === "waiting" ? W.waiting(hoursWords(r.hoursLeft)) : r.flag === "released" ? W.released : r.flag === "kept" ? W.kept : W.blocked}
                  {r.extended ? ` · ${W.moreDone}` : ""}
                </span>
              </div>
              {canAsk && r.flag === "waiting" && !r.extended && r.clockId ? (
                <Button
                  size="md"
                  variant="quiet"
                  loading={d.busy === r.clockId}
                  aria-label={`${W.more}: ${r.first}`}
                  onClick={() => void d.go(r.clockId as string, () => seatMoreTimeAction(r.clockId as string), { saved: W.moreDone })}
                >
                  {W.more}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bookSessionAction, cancelBookingAction } from "@/app/(app)/lead/academy/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SESSION_KINDS } from "@/lib/academy/options";
import type { SessionKind, SessionSummary } from "@/lib/academy/types";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";

const KINDS = Object.keys(SESSION_KINDS) as SessionKind[];

export function Workshops({ sessions, attended, optional = false }: { sessions: SessionSummary[]; attended: Record<SessionKind, boolean>; optional?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function act(id: string, run: () => ReturnType<typeof bookSessionAction>) {
    setBusy(id);
    setError(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) return setError({ id, message: result.message });
    router.refresh();
  }

  return (
    <section id="workshops" aria-labelledby="workshops-heading" className="flex scroll-mt-24 flex-col gap-3">
      <h2 id="workshops-heading" className="t-heading">
        Two live workshops
      </h2>
      {optional ? (
        <p className="t-small measure text-soft" data-testid="workshops-optional">
          Optional. You can book them, and certification does not wait for them.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {KINDS.map((kind) => {
          const info = SESSION_KINDS[kind];
          const list = sessions.filter((s) => s.kind === kind);
          const mine = list.find((s) => s.booked);
          return (
            <div key={kind} className="card flex flex-col gap-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-small text-soft">{info.short} · about 2 hours</p>
                  <h3 className="font-semibold leading-snug">{info.label}</h3>
                </div>
                {attended[kind] ? <Badge tone="gold">Attended</Badge> : mine ? <Badge tone="charcoal">Booked</Badge> : null}
              </div>
              <p className="t-small text-soft">{info.blurb}</p>

              {attended[kind] ? null : list.length === 0 ? (
                <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3 text-soft">No dates yet. The office adds them, and they will appear here.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {list.map((s) => {
                    const other = mine && mine.id !== s.id;
                    return (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {formatLagosDay(s.starts_at)}, {formatLagosTime(s.starts_at)}
                          </p>
                          <p className="t-small text-soft">
                            {s.mode === "online" ? "Online" : "In person"}
                            {s.booked && s.place ? ` · ${s.place}` : ""}
                            {!s.booked ? ` · ${s.seats_left === 0 ? "Full" : `${s.seats_left} ${s.seats_left === 1 ? "seat" : "seats"} left`}` : ""}
                          </p>
                          {error?.id === s.id ? (
                            <p role="alert" className="t-small mt-1 text-danger">
                              {error.message}
                            </p>
                          ) : null}
                        </div>
                        {s.booked ? (
                          s.can_cancel ? (
                            <Button variant="quiet" size="sm" loading={busy === s.id} onClick={() => void act(s.id, () => cancelBookingAction(s.id))}>
                              Cancel
                            </Button>
                          ) : (
                            <span className="t-small text-soft">Message the office to change</span>
                          )
                        ) : (
                          <Button size="sm" disabled={other || s.seats_left === 0} loading={busy === s.id} onClick={() => void act(s.id, () => bookSessionAction(s.id))}>
                            Book
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

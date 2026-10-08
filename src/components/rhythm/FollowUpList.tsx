"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { recordCallAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/leaders/status";
import { formatShortDate, plural } from "@/lib/dates";
import type { CallOutcome, FlagKind, FlagStatus } from "@/lib/rhythm/types";
import { CALL_LABELS, FLAG_ADVICE, FLAG_LABELS, followUpMessage } from "@/lib/rhythm/wording";

export interface FollowUpRow {
  id: string;
  name: string;
  firstName: string;
  whatsapp: string | null;
  kind: FlagKind;
  status: FlagStatus;
  attempts: number;
  lastOutcome: CallOutcome | null;
  note: string | null;
  openedAt: string;
  circle: string;
  /** Who is making the call: the leader's first name, or the care team's. */
  caller: string;
  /** Shown on the care queue, where the leader is somebody else. */
  leader?: string;
}

const OUTCOMES: CallOutcome[] = ["reached", "not_reached", "needs_care_lead"];

/** People who need a call. “Nobody misses twice without a call.” */
export function FollowUpList({ rows, canAct = true, emptyText }: { rows: FollowUpRow[]; canAct?: boolean; emptyText: string }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(id: string) {
    if (!outcome) return setError("Choose how the call went.");
    setBusy(true);
    setError(null);
    const result = await recordCallAction(id, outcome, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpenId(null);
    setOutcome(null);
    setNote("");
    router.refresh();
  }

  if (rows.length === 0) return <p className="t-body text-soft">{emptyText}</p>;

  return (
    <ul className="stagger flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{r.name}</p>
              <p className="t-small text-soft">
                {FLAG_LABELS[r.kind]}
                {r.leader ? ` · ${r.circle}, led by ${r.leader}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.status === "escalated" ? <Badge tone="flame">With the care team</Badge> : <Badge tone="neutral">To call</Badge>}
              {r.attempts > 0 ? <Badge tone="outline">{plural(r.attempts, "call")}</Badge> : null}
            </div>
          </div>
          <p className="t-small text-soft">{FLAG_ADVICE[r.kind]}</p>
          {r.note ? <p className="t-small">Note: {r.note}</p> : null}
          <p className="t-small text-soft">Raised {formatShortDate(r.openedAt)}.</p>

          {canAct ? (
            <div className="flex flex-wrap items-center gap-2.5">
              {r.whatsapp ? (
                <>
                  <a
                    href={whatsappLink(r.whatsapp, followUpMessage({ memberFirst: r.firstName, leaderFirst: r.caller, circle: r.circle, kind: r.kind }))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-solid inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-semibold"
                  >
                    Message on WhatsApp
                  </a>
                  <a href={`tel:${r.whatsapp}`} className="btn btn-quiet inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium">
                    Call
                  </a>
                </>
              ) : (
                <p className="t-small text-soft">No number shared. Ask your coach how to reach {r.firstName}.</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={openId === r.id}
                onClick={() => {
                  setOpenId(openId === r.id ? null : r.id);
                  setOutcome(null);
                  setNote("");
                  setError(null);
                }}
              >
                Record the call
              </Button>
            </div>
          ) : null}

          {openId === r.id ? (
            <form
              noValidate
              className="flex flex-col gap-3 border-t border-line pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save(r.id);
              }}
            >
              <div role="radiogroup" aria-label="How the call went" className="flex flex-col gap-2">
                {OUTCOMES.map((o) => (
                  <label
                    key={o}
                    className={cn(
                      "press flex min-h-12 cursor-pointer items-center rounded-[var(--radius-control)] border-[1.5px] px-4 py-2.5 transition-[background-color,border-color] duration-200",
                      outcome === o ? "border-ink bg-gold/30" : "border-line bg-raised hover:border-soft",
                    )}
                  >
                    <input type="radio" name={`call-${r.id}`} value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="sr-only" />
                    <span className="font-medium">{CALL_LABELS[o]}</span>
                  </label>
                ))}
              </div>
              <Input label="A line for your records" name={`note-${r.id}`} optional maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="Only you, your coach and the care team can read this. Keep it short." />
              {error ? (
                <p role="alert" className="t-small text-danger">
                  {error}
                </p>
              ) : null}
              <div>
                <Button type="submit" size="md" loading={busy}>
                  Save
                </Button>
              </div>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

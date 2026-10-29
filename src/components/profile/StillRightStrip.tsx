"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { myPageAnswerAction, stillRightLaterAction } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import type { Outcome, StillRightItem } from "@/lib/profile/types";
import { OUTCOME_WORDS, STILL_RIGHT } from "@/lib/profile/wording";
import { failureText } from "./FactQuestion";

/**
 * Once a season, on Home: one line for each fact the person confirms that has not been confirmed since the season began. Nothing is sent to anyone. A
 * person who ignores it keeps what they have, and "Not now" hides that one question for the season.
 */
export function StillRightStrip({ season, items }: { season: string; items: StillRightItem[] }) {
  return (
    <section aria-labelledby="still-right-h" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="still-right">
      <div className="flex flex-col gap-1">
        <h2 id="still-right-h" className="t-heading">
          {STILL_RIGHT.heading}
        </h2>
        <p className="t-small text-soft">{STILL_RIGHT.line(season)}</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {items.map((i) => (
          <Row key={i.key} item={i} />
        ))}
      </ul>
    </section>
  );
}

function Row({ item }: { item: StillRightItem }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<"yes" | "change" | "later" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ title: string; body: string | null } | null>(null);
  const id = `still-${item.key}`;

  async function go(kind: "yes" | "change" | "later") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "later") {
        const out = await stillRightLaterAction(item.key);
        if (!out.ok) return setError(out.message ?? "We couldn’t save that. Please try again in a moment.");
        setDone({ title: STILL_RIGHT.hidden, body: null });
      } else {
        const out = await myPageAnswerAction(item.key, kind, kind === "change" ? pick : null, true);
        if (!out.ok) return setError(failureText(out));
        const words = OUTCOME_WORDS[out.outcome as Outcome];
        setDone({ title: out.outcome === "confirmed" ? STILL_RIGHT.thanks : words.title, body: out.outcome === "confirmed" ? null : words.body });
      }
      window.setTimeout(() => router.refresh(), 3000);
    } catch {
      setError("We couldn’t save that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <li className="flex flex-col gap-1 py-4" role="status" data-testid={`${id}-done`}>
        <p className="font-semibold">{done.title}</p>
        {done.body ? <p className="t-small text-soft">{done.body}</p> : null}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 py-4" data-testid={id}>
      <p className="t-body">
        <span className="text-soft">{item.label}: </span>
        <strong>{item.valueLabel}</strong>
      </p>
      {changing ? (
        <fieldset className="flex flex-col gap-2" data-testid={`${id}-options`}>
          <legend className="mb-1 text-[0.95rem] font-medium">Which is right?</legend>
          {item.options.map((o) => (
            <Choice key={o.value} name={`${id}-pick`} value={o.value} checked={pick === o.value} onChange={() => setPick(o.value)} title={o.label} description={o.detail ?? undefined} badge={o.label === item.valueLabel ? "What we have" : undefined} />
          ))}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="md" loading={busy === "change"} disabled={pick === null || busy !== null} onClick={() => void go("change")} data-testid={`${id}-save`}>
              Save this
            </Button>
            <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => { setChanging(false); setPick(null); setError(null); }}>
              Back
            </Button>
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="md" loading={busy === "yes"} disabled={busy !== null} onClick={() => void go("yes")} data-testid={`${id}-yes`}>
            {STILL_RIGHT.yes}
          </Button>
          <Button size="md" variant="quiet" disabled={busy !== null} onClick={() => setChanging(true)} data-testid={`${id}-change`}>
            {STILL_RIGHT.change}
          </Button>
          <Button size="md" variant="ghost" loading={busy === "later"} disabled={busy !== null} onClick={() => void go("later")} data-testid={`${id}-later`}>
            {STILL_RIGHT.later}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </li>
  );
}

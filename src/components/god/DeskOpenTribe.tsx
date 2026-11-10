"use client";

import { useState } from "react";
import { openTribeAction, previewOpenAction } from "@/app/(app)/god/leader-desk/open-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { OPEN_WORDS as O, type OpenPreview, type OpenResult } from "@/lib/god/desk-open";

/**
 * "Open the tribe" for a draft group that has a leader. The first tap only looks: who is already in, who would be placed, who could not be and why. The second
 * tap places each person who can be placed, one at a time, by the office's own function; the Desk makes no seat of its own and accepts no warning for anyone. In
 * Rehearsal nobody is placed. Whoever could not be placed is named with the reason, to be placed by hand.
 */
export function DeskOpenTribe({ group, rehearsal }: { group: string; rehearsal: boolean }) {
  const d = useDo();
  const [looking, setLooking] = useState(false);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [sure, setSure] = useState(false);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [lookError, setLookError] = useState<string | null>(null);

  async function look() {
    if (looking) return;
    setLooking(true);
    setLookError(null);
    setResult(null);
    try {
      const r = await previewOpenAction(group);
      if (r.ok) {
        setPreview(r.preview);
        setSure(false);
      } else setLookError(r.message);
    } catch {
      setLookError("We couldn’t look that up. Try again.");
    }
    setLooking(false);
  }

  const canOpen = preview !== null && preview.ok && preview.counts.ready > 0 && (rehearsal || preview.placementOn);

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3" data-testid="desk-open-tribe">
      <p className="t-small font-medium">{O.title}</p>
      <p className="t-small measure text-soft">{O.intro}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="solid" loading={looking} onClick={() => void look()}>
          {rehearsal ? O.buttonRehearsal : O.button}
        </Button>
      </div>
      {looking ? <p className="t-small text-soft">{O.looking}</p> : null}

      {preview ? (
        !preview.ok ? (
          <p className="t-small text-soft" data-testid="desk-open-problem">
            {O.waiting} {preview.problem}.
          </p>
        ) : (
          <div className="flex flex-col gap-3" data-testid="desk-open-plan">
            {preview.tribe ? <p className="t-small text-soft">{O.tribe(preview.tribe.name, preview.tribe.active, preview.tribe.capacity)}</p> : null}
            <p className="t-small">{O.counts(preview.counts.ready, preview.counts.seated, preview.counts.notPlaced)}.</p>
            <ul className="flex flex-col gap-2" aria-label="Members of this draft">
              {preview.members.map((m) => (
                <li key={m.personId} className="flex flex-col gap-0.5 border-t border-line pt-2" data-testid="desk-open-member" data-state={m.state}>
                  <p className="font-medium">
                    {m.name}{" "}
                    <Badge tone={m.state === "ready" ? "flame" : m.state === "seated" ? "neutral" : "outline"}>{O.states[m.state]}</Badge>
                    {m.saidYes ? <span className="t-small text-soft"> · {O.yes}</span> : null}
                  </p>
                  {m.text ? <p className="t-small text-soft">{m.text}</p> : null}
                </li>
              ))}
            </ul>
            {!rehearsal && !preview.placementOn ? (
              <p className="t-small rounded-[var(--radius-control)] border border-gold px-3 py-2" role="status" data-testid="desk-open-placement-off">
                {O.placementOff}
              </p>
            ) : null}
            {canOpen ? (
              sure ? (
                <div className="flex flex-col gap-2">
                  <p className="t-small text-soft">{rehearsal ? O.rehearsal : O.on}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="solid"
                      loading={d.busy === "open"}
                      onClick={() =>
                        void d.go(
                          "open",
                          async () => {
                            const r = await openTribeAction(group);
                            if (r.ok) setResult(r.result);
                            return r.ok ? { ok: true as const } : r;
                          },
                          { after: () => { setSure(false); setPreview(null); } },
                        )
                      }
                    >
                      {rehearsal ? O.confirmRehearsal : O.confirm}
                    </Button>
                    <Button type="button" size="sm" variant="quiet" onClick={() => setSure(false)}>
                      {O.cancel}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button type="button" size="sm" variant="solid" onClick={() => setSure(true)}>
                    {preview.counts.ready === 1 ? "Place 1 person" : `Place ${preview.counts.ready} people`}
                  </Button>
                </div>
              )
            ) : null}
          </div>
        )
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2" role="status" data-testid="desk-open-result">
          <p className="t-small">{result.rehearsal ? O.would(result.would) : O.placed(result.placed)}</p>
          {result.closed ? <p className="t-small text-soft">{O.closed}</p> : null}
          {result.notPlaced.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="desk-open-left">
              <p className="t-small font-medium">{O.left}</p>
              <ul className="flex flex-col gap-1">
                {result.notPlaced.map((n) => (
                  <li key={n.personId} className="t-small text-soft">
                    {n.name}: {n.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <Notice error={d.error ?? lookError} saved={d.saved} />
    </div>
  );
}

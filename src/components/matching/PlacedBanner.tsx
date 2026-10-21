"use client";

import { useState } from "react";
import { confirmPlacementAction, withholdPlacementAction } from "@/app/(app)/tribe/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { AGREEMENT_SENTENCE } from "@/lib/matching/wording";
import type { PlacedState } from "@/lib/placement/types";
import { PLACED_PROMISES } from "@/lib/placement/wording";

/**
 * Shown above the tribe page of a member the church placed. The seat is already theirs; this is where they say yes, or ask that their
 * email and WhatsApp number are not given to the leader. Changing tribe is the button further down the page, as for any member.
 */
export function PlacedBanner({ state }: { state: PlacedState }) {
  const d = useDo();
  const [said, setSaid] = useState<string | null>(null);
  const showYes = !state.confirmed;
  const showHold = !state.withheld && !state.leaderTold;
  if (!showYes && !showHold) return null;

  return (
    <section className="card rise-in flex flex-col gap-4 p-5 sm:p-6" aria-labelledby="placed-heading" data-testid="placed-banner">
      <div>
        <h2 id="placed-heading" className="t-heading">
          The church placed you in {state.tribe.name}
        </h2>
        <p className="t-body text-soft">
          This place is yours. {showYes ? "Say yes to confirm it, or change tribe below. " : ""}
          {showHold ? `A day after you were told, ${state.tribe.leaderFirst} is given your name, your email${state.hasWhatsapp ? " and your WhatsApp number" : ""}. You can stop that here.` : ""}
        </p>
      </div>
      <Notice error={d.error} saved={said ?? d.saved} />
      <div className="flex flex-wrap gap-3">
        {showYes ? (
          <div className="flex max-w-prose flex-col gap-2">
            <Button size="md" variant="primary" loading={d.busy === "confirm"} onClick={() => void d.go("confirm", confirmPlacementAction, { saved: "Thank you. You are in." })}>
              Yes, I’m in
            </Button>
            <p className="t-small text-soft">{PLACED_PROMISES.confirm} {AGREEMENT_SENTENCE}</p>
          </div>
        ) : null}
        {showHold ? (
          <div className="flex max-w-prose flex-col gap-2">
            <Button
              size="md"
              variant="quiet"
              loading={d.busy === "withhold"}
              onClick={() =>
                void d.go(
                  "withhold",
                  async () => {
                    const r = await withholdPlacementAction();
                    if (r.ok) setSaid(r.late ? "Your leader has already been given your details, so this could not be undone." : "Understood. Your leader will not be given your email or your WhatsApp number.");
                    return r.ok ? { ok: true as const } : r;
                  },
                )
              }
            >
              Don’t share my details
            </Button>
            <p className="t-small text-soft">{PLACED_PROMISES.withhold}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

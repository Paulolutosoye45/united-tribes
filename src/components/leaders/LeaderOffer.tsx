"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { answerOfferAction } from "@/app/(app)/lead/offer-actions";
import { Notice } from "@/components/admin/Notice";
import { Button } from "@/components/ui/Button";
import { dayOf, offerFootnote, waitingLine, type MyOffer } from "@/lib/leaders/board";

/**
 * An offer to lead a tribe where members are waiting. It says how many, never who. Yes starts the Tribe Card with the goal,
 * community and stage already chosen; a pastor still approves it. No changes nothing about the leader.
 */
export function LeaderOffer({ offer }: { offer: MyOffer }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const note = offerFootnote(offer);

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "yes" : "no");
    setError(null);
    let result: Awaited<ReturnType<typeof answerOfferAction>>;
    try {
      result = await answerOfferAction(offer.offerId, accept);
    } catch {
      result = { ok: false, message: "We couldn’t save that. Check your connection and try again." };
    }
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (accept) {
      router.push("/lead/tribe");
      return;
    }
    setDeclined(true);
    router.refresh();
  }

  if (declined) {
    return (
      <section className="card flex flex-col gap-2 p-6" aria-live="polite" data-testid="offer-declined">
        <p className="t-body">Thank you for answering. Nothing changes for you.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="offer-heading" className="card flex flex-col gap-4 border-l-4 border-gold p-6" data-testid="leader-offer">
      <div className="flex flex-col gap-1">
        <p className="t-small text-soft">An offer for you{offer.community ? ` · ${offer.community}` : ""}</p>
        <h2 id="offer-heading" className="t-heading">
          {waitingLine(offer.waiting)} for “{offer.goal}”
        </h2>
        <p className="t-body text-soft">
          Would you lead it this season? If you say yes, your Tribe Card starts with the goal already chosen and the three lines of the Success Picture written for you to make your own. A pastor still approves the card, as always.
        </p>
        {note ? <p className="t-small text-soft">{note}</p> : null}
        {offer.expiresAt ? <p className="t-small text-soft">The offer stays open until {dayOf(offer.expiresAt)}.</p> : null}
      </div>
      <Notice error={error} />
      <div className="flex flex-wrap gap-3">
        <Button size="md" loading={busy === "yes"} disabled={busy === "no"} onClick={() => void answer(true)} data-testid="offer-accept">
          Yes, I’ll lead it
        </Button>
        <Button variant="quiet" size="md" loading={busy === "no"} disabled={busy === "yes"} onClick={() => void answer(false)} data-testid="offer-decline">
          Not this time
        </Button>
      </div>
    </section>
  );
}

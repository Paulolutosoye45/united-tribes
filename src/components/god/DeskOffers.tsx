import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { OWNER_OFFER_WORDS as O, offerLine, type OffersPage } from "@/lib/god/desk-offers";

/** Every leader offer, newest first, with the counts and, apart, how many people gave each reason for "Not this season". Nobody's own reason is shown. */
export function DeskOffers({ page }: { page: OffersPage }) {
  const c = page.counts;
  const reasons = Object.entries(page.reasons).filter(([, n]) => n > 0);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="offers-title" data-testid="desk-offers-list">
      <h2 id="offers-title" className="t-heading">
        {O.title}
      </h2>
      <p className="t-small measure text-soft">{O.intro}</p>
      <div className="flex flex-wrap gap-2">
        <Badge tone={c.open > 0 ? "flame" : "outline"}>Waiting for an answer {c.open}</Badge>
        <Badge tone={c.review > 0 ? "flame" : "outline"}>For your decision {c.review}</Badge>
        <Badge tone="neutral">Now leading {c.accepted}</Badge>
        <Badge tone="neutral">Said no {c.declined}</Badge>
        <Badge tone="neutral">No answer {c.expired}</Badge>
        {c.callMe > 0 ? <Badge tone="gold">Asked for a call {c.callMe}</Badge> : null}
        {c.wouldSend > 0 ? <Badge tone="outline">Written down in Rehearsal {c.wouldSend}</Badge> : null}
      </div>
      {reasons.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="desk-offer-reasons">
          <p className="t-small font-medium">{O.reasonsTitle}</p>
          <p className="t-small text-soft">
            {reasons.map(([k, n]) => `${O.reasonLabels[k]} ${n}`).join(" · ")}. {O.reasonsHelp}
          </p>
        </div>
      ) : null}
      {page.rows.length === 0 ? (
        <p className="card t-body p-5 text-soft">{O.listEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.rows.map((r) => (
            <li key={r.id} className="card flex flex-col gap-1 p-4" data-testid="desk-offer-row">
              <p className="font-medium">
                {r.name} <span className="t-small text-soft">for</span> {r.group}
                {r.rehearsal ? <span className="t-small text-soft"> (Rehearsal)</span> : null}
              </p>
              <p className="t-small text-soft">{offerLine(r)}</p>
              <p className="t-small">
                <Link href="/god/leader-desk?tab=proposals" className="underline underline-offset-4">
                  Open the group
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

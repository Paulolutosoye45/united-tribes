import Link from "next/link";
import type { StageStatus } from "@/lib/profile/types";

/**
 * Beside a Tribe Card: has the leader confirmed their stage of life, and does the card agree with it? Shown only when the Details check is
 * open for that leader, so with it Off a card looks as it always has. It never says who asked the leader, and never a reason.
 */
export function StageBanner({ status }: { status: StageStatus }) {
  const confirmed = status.state === "confirmed";
  const hold = status.hold === "required" ? "required" : status.hold === "optional" ? "optional" : null;
  return (
    <section aria-label="The leader’s stage of life" className="card flex flex-col gap-2 p-5" data-testid="stage-banner" data-state={status.state}>
      <h2 className="font-semibold">{confirmed ? "The leader has confirmed their stage of life." : "The leader has not yet confirmed their stage of life."}</h2>
      <p className="t-body text-soft">
        {confirmed ? `They say ${status.leader ?? "—"}.` : `The church holds ${status.leader ?? "—"} for them, and they have not yet said it is right.`}
        {status.card ? ` This card is built for ${status.card}.` : ""}
      </p>
      {status.differs ? (
        <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/25 px-4 py-3" data-testid="stage-differs">
          The card’s stage and the leader’s stage are not the same. The members offered to this tribe follow the card.
        </p>
      ) : null}
      {status.pending ? (
        <p className="t-small text-soft" data-testid="stage-pending">
          They have asked to change it to {status.pending}. <Link href="/review/stages" className="font-semibold underline underline-offset-4">See the request</Link>.
        </p>
      ) : null}
      {!confirmed && hold === "required" ? <p className="t-small text-soft">A card cannot be approved until the leader has confirmed their stage.</p> : null}
      {!confirmed && hold === "optional" ? <p className="t-small text-soft">You may still approve the card. It is better to wait for the leader to confirm.</p> : null}
    </section>
  );
}

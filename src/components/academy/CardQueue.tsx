import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CARD_STATUS } from "@/lib/academy/options";
import type { CardQueueItem } from "@/lib/academy/types";
import { formatShortDate } from "@/lib/dates";

export function CardQueue({ items }: { items: CardQueueItem[] }) {
  if (items.length === 0) {
    return <p className="card t-body p-6 text-soft">No Tribe Cards have been sent yet. They appear here as leaders finish the Success Picture module and send theirs.</p>;
  }
  return (
    <ul className="stagger flex flex-col gap-3">
      {items.map((c, i) => {
        const status = CARD_STATUS[c.status];
        return (
          <li key={c.id} style={{ ["--i" as string]: Math.min(i, 8) }}>
            <Link
              href={`/review/cards/${c.id}`}
              className="card press flex flex-col gap-2 p-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold leading-snug">{c.name ?? "Unnamed tribe"}</h3>
                  <p className="t-small text-soft">
                    {c.leader}
                    {c.community ? ` · ${c.community}` : ""}
                    {c.track ? ` · ${c.track}` : ""}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <p className="t-small text-soft">{c.goal ?? "No goal chosen"}</p>
              <p className="t-small text-soft">
                {c.submitted_at ? `Sent ${formatShortDate(c.submitted_at)}` : "Not sent"}
                {" · "}
                {c.assistant ? `Assistant: ${c.assistant}` : "No assistant yet"}
                {" · "}
                {c.coach ? `Coach: ${c.coach}` : "No coach yet"}
                {c.certified ? " · Leader certified" : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

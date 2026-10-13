import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import type { FeedEvent } from "@/lib/god/types";
import { ago, areaOf, describeAction, roleWords } from "@/lib/god/wording";

const DOT: Record<ReturnType<typeof areaOf>, string> = {
  people: "bg-[var(--crest-gold)]",
  tribes: "bg-flame",
  leaders: "bg-charcoal",
  care: "bg-danger",
  office: "bg-soft",
  privacy: "bg-ink",
};

/** A few of the facts an event carries, as short words (never anything a person wrote). */
function facts(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .slice(0, 3)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v).replace(/_/g, " ")}`)
    .join(" · ");
}

/** Everything that happened, newest first. Names link to the person's page. */
export function Feed({ events, now }: { events: FeedEvent[]; now: number }) {
  if (events.length === 0) return <p className="card t-body p-6 text-soft">Nothing has happened that matches.</p>;
  return (
    <ul className="card divide-y divide-line overflow-hidden" aria-label="Activity">
      {events.map((e) => {
        const who = e.actor_name ?? "The platform";
        const extra = facts(e.meta);
        const when = ago(e.at, now) || `${formatLagosDay(e.at)}, ${formatLagosTime(e.at)}`;
        return (
          <li key={e.id} data-event={e.action} className="flex items-start gap-3.5 p-4">
            <Avatar name={who} size={36} />
            <div className="min-w-0 flex-1">
              <p className="t-body">
                {e.actor_id ? (
                  <Link href={`/god/people/${e.actor_id}`} className="font-semibold underline-offset-2 hover:underline">
                    {who}
                  </Link>
                ) : (
                  <span className="font-semibold">{who}</span>
                )}{" "}
                {describeAction(e.action)}
                {e.subject_name && e.entity_id && e.entity_id !== e.actor_id ? (
                  <>
                    {" · "}
                    <Link href={`/god/people/${e.entity_id}`} className="underline-offset-2 hover:underline">
                      {e.subject_name}
                    </Link>
                  </>
                ) : null}
              </p>
              <p className="t-small mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-soft">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[areaOf(e.action)]}`} />
                <span>{when}</span>
                {e.actor_roles && e.actor_roles.length > 0 ? <Badge tone="outline">{roleWords(e.actor_roles)}</Badge> : null}
                {extra ? <span>{extra}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

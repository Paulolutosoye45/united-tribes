import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { formatDate } from "@/lib/dates";
import { LEADER_EMPTY } from "@/lib/placement/wording";
import { leadingLine, leadingTitle, peopleLine, type LeadingPerson, type MyLeading } from "@/lib/leaders/leading";
import { ReachAsk } from "@/components/leaders/ReachAsk";
import { ReachStrip } from "@/components/leaders/ReachStrip";
import type { ReachGaps } from "@/lib/contact-gaps/gaps";
import type { TribeStrip } from "@/lib/reach/series";
import { NUMBER_WORDS, type NumberGaps } from "@/lib/messaging/number-rule";

/**
 * The tribe a leader leads, in a few words and two buttons. For a leader on a page that is about something else (My tribe, or an application
 * they have started), so that their tribe is never out of reach. It says nothing about how they came to lead.
 */
export function LeadingStrip({ leading }: { leading: MyLeading }) {
  const approved = leading.tribeStatus === "approved";
  return (
    <section aria-labelledby="leading-strip-h" className="card flex flex-wrap items-center justify-between gap-4 p-5" data-testid="leading-strip">
      <div className="flex max-w-[34rem] flex-col gap-1">
        <h2 id="leading-strip-h" className="t-heading">
          {leadingTitle(leading)}
        </h2>
        <p className="t-body text-soft">{leadingLine(leading)}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/lead/tribe" className={buttonClasses({ size: "md", className: "px-6" })}>
          <span className="relative">{leading.role === "leader" ? "My Tribe Card" : "Read the Tribe Card"}</span>
        </Link>
        {approved ? (
          <Link href="/lead/week" className={buttonClasses({ variant: "quiet", size: "md", className: "px-6" })}>
            <span className="relative">This week</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** The people who have joined, on the Lead page. The list is the leader's own (the database applies its rules); the welcome work stays on the Tribe Card. */
export function LeadingPeople({ leading, people, gaps = null, reach = null, strip = null }: { leading: MyLeading; people: LeadingPerson[]; gaps?: NumberGaps | null; reach?: ReachGaps | null; strip?: TribeStrip | null }) {
  if (leading.tribeStatus !== "approved") return null;
  // Only while the church has made the phone number compulsory: how many have none yet, by first name, so the leader can ask in person
  // While Contact gaps is On its list and buttons say this and more, so the line is not said twice
  // While the contact series (or the tribe note) is On, its strip says all of this and does more, so the one-by-one list is not shown beside it
  const stripOn = Boolean(strip && (strip.on || strip.note.state !== "off"));
  const asking = Boolean(reach?.on && reach.people.length > 0) && !stripOn;
  const gapLine = gaps?.on && !reach?.on && !stripOn ? NUMBER_WORDS.leaderNote(gaps.count, gaps.names) : null;
  return (
    <section aria-labelledby="leading-people-h" className="card flex flex-col gap-4 p-6" data-testid="leading-people">
      <div className="flex flex-col gap-1">
        <h2 id="leading-people-h" className="t-heading">
          Who has joined
        </h2>
        <p className="t-body text-soft">
          {people.length === 0 ? LEADER_EMPTY : peopleLine(people.length)}
        </p>
      </div>
      {gapLine ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="number-gaps">
          {gapLine}
        </p>
      ) : null}
      {stripOn && strip ? <ReachStrip tribeId={leading.tribeId} strip={strip} /> : null}
      {asking && reach ? <ReachAsk people={reach.people} /> : null}
      {people.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {people.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="leading-person">
              <span className="min-w-0">
                <span className="font-semibold">{p.name}</span>
                {p.joinedOn ? <span className="t-small ml-2 text-soft">Joined {formatDate(p.joinedOn)}</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {p.mark ? <Badge tone="neutral">{p.mark}</Badge> : null}
                {p.called ? <Badge tone="gold">Welcomed</Badge> : <Badge tone="outline">To welcome</Badge>}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Link href="/lead/tribe" className={buttonClasses({ variant: "quiet", size: "md", className: "px-6" })}>
          <span className="relative">{leading.role === "leader" ? "Welcome them and set your first meeting" : "Open the tribe page"}</span>
        </Link>
      </div>
    </section>
  );
}

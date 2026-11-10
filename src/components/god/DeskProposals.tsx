import Link from "next/link";
import { DeskGroupCard } from "@/components/god/DeskGroupCard";
import { DeskGroupForm } from "@/components/god/DeskGroupForm";
import { Badge } from "@/components/ui/Badge";
import type { DeskChoices } from "@/lib/god/desk-server";
import { DESK_WORDS as W, kindWord, modeWord, slotWord, type Cluster, type Group, type Overview } from "@/lib/god/desk";

export type StartValues = { track: string; slot: string; mode: "online" | "in_person"; type: "mixed" | "women" | "men"; name: string };

const startHref = (c: Cluster) => `/god/leader-desk?${new URLSearchParams({ tab: "proposals", start: [c.trackId, c.slot, c.mode, c.type].join(",") }).toString()}`;

/** The Proposals tab: the groups waiting members could already fill, a form to start a draft, and the drafts themselves. Nothing here tells anyone anything. */
export function DeskProposals({
  overview,
  groups,
  clusters,
  choices,
  start,
}: {
  overview: Overview;
  groups: Group[];
  clusters: Cluster[];
  choices: DeskChoices;
  start: StartValues | null;
}) {
  return (
    <section aria-labelledby="desk-proposals-h" className="flex flex-col gap-8">
      <h2 id="desk-proposals-h" className="sr-only">
        Draft groups
      </h2>

      <div className="flex flex-col gap-3">
        <h3 className="t-heading">{W.clustersTitle}</h3>
        <p className="t-small measure text-soft">{W.clustersHelp}</p>
        {clusters.length === 0 ? (
          <p className="card t-body p-5 text-soft">{W.clustersEmpty}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" data-testid="desk-clusters">
            {clusters.map((c) => (
              <li key={`${c.trackId}-${c.slot}-${c.mode}-${c.type}`} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex flex-col gap-0.5">
                  <p className="font-semibold">
                    {c.size} could form {kindWord(c.type).toLowerCase()} {c.track}
                  </p>
                  <p className="t-small text-soft">
                    {slotWord(c.slot)}, {modeWord(c.mode).toLowerCase()}
                  </p>
                </div>
                <Link href={startHref(c)} className="t-body underline">
                  Start a draft
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="t-heading">Draft groups</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{groups.length} in draft</Badge>
          <Badge tone="outline">A tribe needs {overview.minTribe} or more</Badge>
        </div>
        {groups.length === 0 ? (
          <p className="card t-body p-5 text-soft">{W.draftsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {groups.map((g) => (
              <DeskGroupCard key={g.id} group={g} choices={choices} minTribe={overview.minTribe} />
            ))}
          </ul>
        )}
      </div>

      <details className="card p-5" open={start !== null}>
        <summary className="t-heading cursor-pointer">Start a draft group</summary>
        <div className="mt-4">
          <DeskGroupForm
            key={start ? `${start.track}-${start.slot}-${start.mode}-${start.type}` : "blank"}
            choices={choices}
            initial={start ? { name: start.name, track: start.track, slot: start.slot, mode: start.mode, type: start.type } : undefined}
          />
        </div>
      </details>
    </section>
  );
}

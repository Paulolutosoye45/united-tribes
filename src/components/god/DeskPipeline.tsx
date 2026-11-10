import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { PIPELINE_WORDS as P, days, type Pipeline } from "@/lib/god/desk-open";

/** Each draft group on its way to an open tribe: the stage it is in, how long it has been there, and a "Stuck" mark when that is longer than its limit. Stuck ones come first. */
export function DeskPipeline({ pipeline }: { pipeline: Pipeline }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="pipeline-title" data-testid="desk-pipeline">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="pipeline-title" className="t-heading">
          {P.title}
        </h2>
        <Badge tone={pipeline.stuck > 0 ? "flame" : "outline"}>
          {pipeline.stuck > 0 ? P.stuck(pipeline.stuck) : P.nothingStuck}
        </Badge>
      </div>
      <p className="t-small measure text-soft">{P.intro}</p>
      {pipeline.rows.length === 0 ? (
        <p className="card t-body p-5 text-soft">{P.none}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pipeline.rows.map((r) => (
            <li key={`${r.groupId}-${r.stage}`} className="card flex flex-col gap-1 p-4" data-testid="desk-pipeline-row" data-stuck={r.stuck ? "yes" : "no"} data-stage={r.stage}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {r.group} <span className="t-small text-soft">with</span> {r.name}
                </p>
                {r.stuck ? <Badge tone="flame">{P.stuckTag}</Badge> : null}
                {r.formed ? <Badge tone="outline">{P.formed}</Badge> : null}
              </div>
              <p className="t-small text-soft">
                {P.stages[r.stage]}. {days(r.hours)} here{r.limitHours !== null ? `, ${P.limit(r.limitHours)}` : ""}.
              </p>
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

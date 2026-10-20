import { cn } from "@/lib/cn";
import { STAGES } from "@/lib/leaders/options";
import type { StageState } from "@/lib/leaders/status";

/** The five stages as a vertical path: done, where you are, and what is still ahead. */
export function StageList({
  states,
  details,
  heading = "Where you are",
}: {
  states?: { id: string; state: StageState }[];
  /** A short extra line under a stage, such as “1 of 2 answered”. */
  details?: Partial<Record<string, string>>;
  heading?: string;
}) {
  // A stage that is not part of this process is left out of the path, and the rest are numbered again
  const shown = STAGES.filter((stage) => states?.find((s) => s.id === stage.id)?.state !== "off");
  return (
    <section aria-labelledby="stages-heading" className="flex flex-col gap-3">
      <h2 id="stages-heading" className="t-heading">
        {heading}
      </h2>
      <ol className="card flex flex-col px-5 py-4">
        {shown.map((stage, i) => {
          const state = states?.find((s) => s.id === stage.id)?.state ?? "later";
          const last = i === shown.length - 1;
          return (
            <li key={stage.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute left-[0.8rem] top-8 h-[calc(100%-1.75rem)] w-0.5 rounded-full", state === "done" ? "bg-gold" : "bg-line")}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative grid h-[1.65rem] w-[1.65rem] shrink-0 place-items-center rounded-full border-2 text-[0.75rem] font-bold",
                  state === "done" && "border-transparent bg-gold text-on-flame",
                  state === "current" && "ring-pulse border-flame bg-flame text-on-flame",
                  state === "later" && "border-line bg-raised text-soft",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 pt-px">
                <p className={cn("font-semibold leading-snug", state === "later" && "text-soft")}>
                  {stage.label}
                  <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (in progress)" : " (not started)"}</span>
                </p>
                <p className="t-small text-soft">{details?.[stage.id] ?? stage.blurb}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

import { cn } from "@/lib/cn";

export type JourneyStep = {
  title: string;
  detail: string;
  state: "done" | "current" | "later";
};

/** Where the person is on the way to a tribe, in four steps. */
export function Journey({ steps }: { steps: JourneyStep[] }) {
  return (
    <ol className="card stagger flex flex-col p-2 sm:p-3" aria-label="Your journey">
      {steps.map((step, i) => (
        <li
          key={step.title}
          style={{ ["--i" as string]: i }}
          aria-current={step.state === "current" ? "step" : undefined}
          className={cn("relative flex gap-4 rounded-[18px] p-4", step.state === "current" && "bg-gold/15")}
        >
          <span
            aria-hidden="true"
            className={cn(
              "z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[0.85rem] font-bold",
              step.state === "done" && "bg-ink text-page",
              step.state === "current" && "bg-flame text-on-flame",
              step.state === "later" && "border-[1.5px] border-line text-soft",
            )}
          >
            {step.state === "done" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <div className="min-w-0">
            <p className={cn("font-semibold leading-snug", step.state === "later" && "text-soft")}>
              {step.title}
              <span className="sr-only">
                {step.state === "done" ? " (done)" : step.state === "current" ? " (next)" : " (coming later)"}
              </span>
            </p>
            <p className="t-small text-soft">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

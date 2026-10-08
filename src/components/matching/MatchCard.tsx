import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { ShownCircle } from "@/lib/matching/types";
import { CIRCLE_TYPE_LINE, LABELS, reasonsFor, seatsLine, whenLine, whereLine } from "@/lib/matching/wording";
import { DegreeRing } from "./DegreeRing";
import { SuccessPicture } from "./SuccessPicture";

/** One of the three circles, with its own Degree of Compatibility. The closest fit is set apart on a dark panel. */
export function MatchCard({ shown, featured, index }: { shown: ShownCircle; featured: boolean; index: number }) {
  const c = shown.circle;
  const label = LABELS[shown.label];
  const reasons = reasonsFor(shown.reasons, c);
  const full = c.seats_left <= 0 || !c.open;
  const night = featured;
  const soft = night ? "text-white/75" : "text-soft";
  const ink = night ? "text-white" : "text-ink";

  return (
    <article
      style={{ ["--i" as string]: index }}
      aria-labelledby={`circle-${c.id}`}
      className={cn("flex flex-col gap-5 rounded-[var(--radius-sheet)] p-5 sm:p-6", night ? "night" : "card")}
    >
      <div className="flex items-center justify-between gap-3">
        <Badge tone={night ? "gold" : "outline"}>{label.text}</Badge>
        <span className={cn("t-small", full ? "font-semibold text-flame" : soft)}>{seatsLine(c.seats_left)}</span>
      </div>

      <div className="flex items-center gap-4">
        <DegreeRing value={shown.degree} tone={night ? "night" : "light"} className={ink} />
        <div className="min-w-0">
          <h3 id={`circle-${c.id}`} className={cn("text-[1.25rem] font-bold leading-tight tracking-tight", ink)}>
            {c.name}
          </h3>
          <p className={cn("t-small mt-1", soft)}>{[c.tribe, c.track].filter(Boolean).join(" · ")}</p>
          <p className={cn("t-small", soft)}>Season Goal: {c.goal}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <p className={cn("t-small font-semibold", ink)}>Why it fits you</p>
        <ul className="flex flex-col gap-2">
          {reasons.map((r) => (
            <li key={r} className={cn("t-small flex gap-2.5", night ? "text-white/90" : "text-ink")}>
              <svg aria-hidden="true" viewBox="0 0 20 20" className={cn("mt-0.5 h-4 w-4 shrink-0", night ? "text-gold" : "text-flame")} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 10.5l3.5 3.5 7.5-8" />
              </svg>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-3.5">
        <span aria-hidden="true" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-[1.05rem] font-bold", night ? "bg-white/15 text-white" : "bg-charcoal text-white")}>
          {c.leader_first_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className={cn("font-semibold leading-tight", ink)}>Led by {c.leader_first_name}</p>
          <p className={cn("t-small mt-0.5 line-clamp-3", night ? "text-white/80" : "text-soft")}>{c.story}</p>
        </div>
      </div>

      <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-y py-4 text-[0.92rem]", night ? "border-white/15" : "border-line")}>
        <dt className={soft}>Meets</dt>
        <dd className={cn("font-medium", ink)}>{whenLine(c)}</dd>
        <dt className={soft}>Where</dt>
        <dd className={cn("font-medium", ink)}>{whereLine(c)}</dd>
        <dt className={soft}>Who</dt>
        <dd className={cn("font-medium", ink)}>{CIRCLE_TYPE_LINE[c.circle_type]}</dd>
      </dl>

      <details className="group">
        <summary className={cn("t-small flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold", ink)}>
          <span>The Success Picture it works toward</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 transition-transform duration-300 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </summary>
        <div className="pt-1">
          <SuccessPicture god={c.god} others={c.others} life={c.life} tone={night ? "night" : "light"} />
        </div>
      </details>

      {full ? (
        <p className={cn("t-small rounded-[var(--radius-control)] px-4 py-3", night ? "bg-white/10" : "bg-surface text-soft")}>This circle has filled since you looked. Check again for others.</p>
      ) : (
        <Link href={`/circle/choose/${c.id}`} className={buttonClasses({ variant: night ? "primary" : "solid", fullWidth: true })}>
          <span className="relative">Choose this circle</span>
        </Link>
      )}
    </article>
  );
}

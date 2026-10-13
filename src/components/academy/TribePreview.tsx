import { clockLabel, dayName, ZONE_LABELS } from "@/lib/academy/options";
import { firstName, type CardValues } from "@/lib/academy/card";
import { cn } from "@/lib/cn";

const LINES = [
  { key: "god", label: "Loving God", color: "var(--crest-charcoal)" },
  { key: "others", label: "Loving Others", color: "var(--crest-flame)" },
  { key: "life", label: "Loving Life", color: "var(--crest-gold)" },
] as const;

/**
 * The card as a member will see it when choosing a tribe. The Degree of
 * Compatibility is added for each member when they are matched.
 */
export function TribePreview({
  values,
  community,
  track,
  goal,
  leader,
  className,
}: {
  values: CardValues;
  community: string | null;
  track: string | null;
  goal: string | null;
  leader: string;
  className?: string;
}) {
  const meets = values.meeting_day !== null && values.meeting_time ? `${dayName(values.meeting_day)}s, ${clockLabel(values.meeting_time)}` : null;
  const name = firstName(leader) || "Your name";
  return (
    <article className={cn("card flex flex-col gap-5 p-5 sm:p-6", className)} aria-label="Preview of your Tribe Card">
      <div className="flex flex-col gap-1">
        <p className="t-small text-soft">{[community, track].filter(Boolean).join(" · ") || "Your community · Your track"}</p>
        <h3 className="t-heading">{values.name.trim() || "Name your tribe"}</h3>
        <p className="t-small text-soft">Season Goal: {goal ?? "Not chosen yet"}</p>
      </div>

      <div className="flex gap-3.5">
        <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-charcoal text-[1.05rem] font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">Led by {name}</p>
          <p className={cn("t-small mt-0.5 line-clamp-3", values.story.trim() ? "text-ink" : "text-soft")}>
            {values.story.trim() || "Your story with this goal appears here, in two lines."}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-y border-line py-4 text-[0.92rem]">
        <dt className="text-soft">Meets</dt>
        <dd className="font-medium">{meets ?? "Not chosen yet"}</dd>
        <dt className="text-soft">Format</dt>
        <dd className="font-medium">{values.mode === "online" ? "Online" : values.mode === "in_person" ? "In person" : "Not chosen yet"}</dd>
        <dt className="text-soft">Zone</dt>
        <dd className="font-medium">{values.zone ? ZONE_LABELS[values.zone] : "Not chosen yet"}</dd>
        <dt className="text-soft">Seats</dt>
        <dd className="font-medium">{values.capacity}</dd>
      </dl>

      <div className="flex flex-col gap-3">
        <p className="t-small font-semibold">The Success Picture, by week 12</p>
        <ul className="flex flex-col gap-2.5">
          {LINES.map((l) => {
            const text = values[l.key].trim();
            return (
              <li key={l.key} className="flex gap-3">
                <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: l.color }} />
                <div className="min-w-0">
                  <p className="t-small font-semibold">{l.label}</p>
                  <p className={cn("t-small", text ? "text-ink" : "text-soft")}>{text || "Not written yet"}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

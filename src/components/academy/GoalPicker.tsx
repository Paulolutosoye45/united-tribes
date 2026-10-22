"use client";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { STARTED_LABEL, choiceLine, waitingLine, type GoalHints } from "@/lib/academy/goal-choice";

/**
 * The goals a leader may choose from, when the church has let them choose. The goal they were started on comes first and is marked; the
 * rest follow with the most people waiting first. Each says how many members are waiting for it, never who.
 */
export function GoalPicker({
  hints,
  selected,
  busy,
  disabled,
  onPick,
}: {
  hints: GoalHints;
  /** The slug of the goal the card has now. */
  selected: string;
  /** The slug being saved, if one is. */
  busy: string | null;
  disabled: boolean;
  onPick: (slug: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="goal-picker">
      <p className="t-small text-soft" data-testid="goal-picker-line">
        {choiceLine(hints.communityToo)}
      </p>
      <div role="radiogroup" aria-label="Season Goal" className="flex flex-col gap-2">
        {hints.goals.map((g) => {
          const on = g.slug === selected;
          return (
            <button
              key={g.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled || busy !== null}
              data-testid={`goal-option-${g.slug}`}
              onClick={() => onPick(g.slug)}
              className={cn(
                "press flex w-full flex-col gap-1 rounded-[var(--radius-control)] border-[1.5px] px-4 py-3 text-left transition-colors disabled:cursor-not-allowed",
                on ? "border-flame bg-flame/10" : "border-line bg-white hover:border-ink/40",
                busy !== null && !on && "opacity-60",
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold leading-snug">{g.title}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {g.started ? <Badge tone="gold">{STARTED_LABEL}</Badge> : null}
                  {on ? <Badge tone="flame">{busy === g.slug ? "Saving" : "Your goal"}</Badge> : busy === g.slug ? <Badge tone="outline">Saving</Badge> : null}
                </span>
              </span>
              {hints.communityToo && g.communityName ? <span className="t-small text-soft">{g.communityName}</span> : null}
              <span className="t-small text-soft">{waitingLine(g.waiting)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

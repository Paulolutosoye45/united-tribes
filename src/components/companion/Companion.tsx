"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import type { Companion } from "@/components/intake/useCompanion";
import { Sparkle } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import type { Pick } from "@/lib/companion";

/**
 * The small pieces the Companion is made of on screen. They are plain and quiet on purpose: a pick says why it was made
 * in the person's own words, can be questioned ("Why this?") or turned down ("Not this one") in one tap, and the answer
 * is always theirs to change.
 */

/** "Picked for you" and its quieter relatives, so a person can tell a fill-in from a suggestion at a glance. */
export function Tag({ children = "Picked for you" }: { children?: ReactNode }) {
  return (
    <span className="cmp-tag">
      <Sparkle size={12} />
      {children}
    </span>
  );
}

/** The word for how sure a pick is, for a pick the person has not been given as an answer. */
export function fitWord(pick: Pick): string {
  return pick.tier === "sure" ? "Strong fit" : pick.tier === "likely" ? "Good fit" : "A place to start";
}

/**
 * Sits under an answer the Companion filled in. The reason quotes the person where it can; "Why this?" lists
 * everything it went on; "Not this one" takes the pick back and the Companion does not offer it again.
 */
export function PickNote({ pick, name, onReject, className }: { pick: Pick; name: string; onReject?: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const why = pick.why.filter(Boolean);
  return (
    <div className={cn("rise-in mt-2 flex flex-col gap-0.5 px-1", className)}>
      <p className="t-small flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tag />
        {pick.reason ? <span>{pick.reason}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-x-4">
        {why.length > 0 ? (
          <button type="button" className="cmp-link" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            Why this?<span className="sr-only"> ({name})</span>
          </button>
        ) : null}
        {onReject ? (
          <button type="button" className="cmp-link" onClick={onReject}>
            Not this one<span className="sr-only"> ({name})</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <ul id={id} className="t-small mb-1 list-disc space-y-0.5 pl-6 text-soft">
          {why.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>It is only a suggestion. Tap any other answer to change it.</li>
        </ul>
      ) : null}
    </div>
  );
}

/** A suggestion that is never filled in for the person (where they are with God, say), offered with one tap to use it. */
export function Hint({ children, actionLabel, actionName, onUse }: { children: ReactNode; actionLabel: string; actionName: string; onUse: () => void }) {
  return (
    <div className="cmp-card rise-in mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="t-small flex min-w-0 flex-1 basis-56 items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <Sparkle size={16} />
        </span>
        <span>{children}</span>
      </p>
      <button type="button" onClick={onUse} className="press min-h-11 rounded-[var(--radius-control)] border-[1.5px] border-ink px-4 font-semibold">
        {actionLabel}
        <span className="sr-only"> ({actionName})</span>
      </button>
    </div>
  );
}

/** Starting sentences written for the person's age group and place. One tap puts one in the box to be made their own. */
export function Starters({ items, onPick, heading = "Not sure what to write? Tap one and make it yours." }: { items: readonly string[]; onPick: (text: string) => void; heading?: string }) {
  return (
    <div className="mt-6">
      <p className="t-small mb-2 text-soft">{heading}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((text) => (
          <button key={text} type="button" onClick={() => onPick(text)} className="cmp-starter press">
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the Companion has picked up so far, live, as the person writes. Each one can be taken off with a tap. */
export function Listening({ cmp }: { cmp: Companion }) {
  const { chips, profile } = cmp;
  const kinds = new Set(chips.map((c) => c.kind));
  const missing = [
    kinds.has("work") || kinds.has("field") ? null : "your work",
    kinds.has("relationship") || kinds.has("children") ? null : "your family",
    kinds.has("topic") ? null : "what you are hoping for",
  ].filter((x): x is string => x !== null);
  const list = missing.length <= 1 ? missing.join("") : `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]}`;

  return (
    <section aria-label="What your Companion has picked up" className="cmp-card rise-in mt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkle size={16} />
          {chips.length > 0 ? "Here is what I am picking up" : "I am listening"}
        </p>
        <span className="cmp-pips" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <i key={n} className={profile.depth >= n ? "on" : ""} />
          ))}
        </span>
      </div>
      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
          {chips.map((c) => (
            <span key={c.trait} className="cmp-chip pop-in">
              {c.label}
              <button type="button" onClick={() => cmp.dismiss(c.trait)} aria-label={`Not me: ${c.label}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <p className="t-small mt-3 text-soft">
        {missing.length === 0
          ? "Good. Next I will check these with you, then suggest a community. Tap ✕ on anything that is not you."
          : chips.length === 0
            ? `Keep going. Say something about ${list} and I will start picking out what matters.`
            : `Mention ${list} and my suggestions get sharper. Tap ✕ on anything that is not you.`}
      </p>
    </section>
  );
}

/** Whether suggestions are on, and the way to change that. The choice lasts on this phone. */
export function CompanionSwitch({ cmp, className }: { cmp: Companion; className?: string }) {
  return (
    <p className={cn("t-small flex flex-wrap items-center gap-x-2 text-soft", className)}>
      <Sparkle size={14} />
      {cmp.on ? "Suggestions are on." : "Suggestions are off."}
      <button type="button" className="cmp-link" onClick={() => cmp.setOn(!cmp.on)}>
        {cmp.on ? "Turn them off" : "Turn them on"}
      </button>
    </p>
  );
}

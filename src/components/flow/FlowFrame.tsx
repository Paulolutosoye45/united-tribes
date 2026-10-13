"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Crest } from "@/components/brand/Crest";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export type SaveState = "idle" | "saving" | "saved" | "error";
export type Fills = [number, number, number, number];

export const QUARTER_COLORS = ["var(--crest-charcoal)", "var(--crest-flame)", "var(--crest-gold)", "var(--crest-amber)"];

type Props = {
  /** The four quarters of the shield and the section the person is in (-1 for none). */
  fills: Fills;
  section: number;
  sections: readonly { id: string; label: string }[];
  saveState: SaveState;
  caption: string;
  /** Shown to screen readers when the screen changes. */
  announce: string;
  progressLabel: string;
  /** The first screen offers a plain close; later ones offer “Finish later”, which saves. */
  onWelcome: boolean;
  leaveHref: string;
  leaveLabel: string;
  onFinishLater: () => void;
  complete?: boolean;

  /** The key changes with each screen so the transition replays. */
  viewKey: string;
  dir: "forward" | "back";

  showBack: boolean;
  onBack: () => void;
  onContinue: () => void;
  primaryLabel: string;
  canGo: boolean;
  busy: boolean;
  skipping?: boolean;

  /** An inline message under the screen, for problems that do not belong to one field. */
  problem?: string | null;
  children: ReactNode;
};

/**
 * The shell shared by the long forms: a dark progress rail on wide screens, a
 * four-part bar on phones, one question per screen, and a thumb-height Continue.
 */
export function FlowFrame({
  fills,
  section,
  sections,
  saveState,
  caption,
  announce,
  progressLabel,
  onWelcome,
  leaveHref,
  leaveLabel,
  onFinishLater,
  complete = false,
  viewKey,
  dir,
  showBack,
  onBack,
  onContinue,
  primaryLabel,
  canGo,
  busy,
  skipping = false,
  problem,
  children,
}: Props) {
  return (
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[23rem_1fr]">
      <Rail fills={fills} section={section} sections={sections} saveState={saveState} caption={caption} complete={complete} progressLabel={progressLabel} />

      <form
        className="flex min-h-dvh flex-col"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canGo) onContinue();
        }}
      >
        <header className="glass safe-top sticky top-0 z-20 border-b border-line px-5 sm:px-8 lg:px-10">
          <div className="mx-auto flex h-16 max-w-xl items-center gap-4 lg:max-w-2xl">
            {onWelcome ? (
              <Link href={leaveHref} className="press -ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-surface" aria-label={leaveLabel}>
                <CloseIcon />
              </Link>
            ) : (
              <button
                type="button"
                onClick={onFinishLater}
                className="press -ml-2 flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2.5 hover:bg-surface"
                aria-label="Save and finish later"
              >
                <CloseIcon />
                <span className="t-small hidden font-medium sm:inline">Finish later</span>
              </button>
            )}

            <div className="min-w-0 flex-1 lg:hidden">
              <div
                className="flex gap-1.5"
                role="progressbar"
                aria-label={progressLabel}
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={Math.round(fills.reduce((a, b) => a + b, 0) * 100) / 100}
              >
                {fills.map((f, i) => (
                  <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full origin-left rounded-full transition-transform duration-700 [transition-timing-function:var(--ease-out)]"
                      style={{ background: QUARTER_COLORS[i], transform: `scaleX(${f})` }}
                    />
                  </span>
                ))}
              </div>
              <p className="t-small mt-1.5 truncate text-soft">{caption}</p>
            </div>
            <div className="hidden flex-1 lg:block" />
            <div className="shrink-0 lg:hidden">
              <ShieldProgress fills={fills} active={section} size={28} label="" />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip px-5 pb-10 pt-8 sm:px-8 lg:px-10 lg:pt-14">
          <div className="mx-auto max-w-xl lg:max-w-2xl">
            <p className="sr-only" aria-live="polite">
              {announce}
            </p>
            <div key={viewKey} className={dir === "forward" ? "step-forward" : "step-back"}>
              {children}
            </div>
            {problem ? (
              <p role="alert" className="mt-5 rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
                {problem}
              </p>
            ) : null}
          </div>
        </main>

        <div className="glass safe-bottom sticky bottom-0 z-20 border-t border-line px-5 pt-3 sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-xl items-center gap-3 lg:max-w-2xl">
            {showBack ? (
              <Button type="button" variant="quiet" size="lg" onClick={onBack} aria-label="Back" className="w-14 shrink-0 px-0 sm:w-auto sm:px-5">
                <BackIcon />
                <span className="hidden sm:inline">Back</span>
              </Button>
            ) : null}
            <Button type="submit" size="lg" fullWidth loading={busy} disabled={!canGo} variant={skipping ? "solid" : "primary"}>
              {primaryLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Rail({
  fills,
  section,
  sections,
  saveState,
  caption,
  complete,
  progressLabel,
}: {
  fills: Fills;
  section: number;
  sections: readonly { id: string; label: string }[];
  saveState: SaveState;
  caption: string;
  complete: boolean;
  progressLabel: string;
}) {
  return (
    <aside className="night hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:justify-between lg:p-10" aria-label="Your progress">
      <div
        aria-hidden="true"
        className="glow-breathe pointer-events-none absolute -right-20 top-1/3 -z-10 h-80 w-80 rounded-full bg-[radial-gradient(tribe,rgb(244_196_67/0.2),transparent_70%)] blur-2xl"
      />
      <div className="flex items-center gap-3">
        <Crest size={30} tone="light" />
        <span className="t-heading" style={{ fontStretch: "88%" }}>
          United Tribes
        </span>
      </div>

      <div className="flex flex-col items-start gap-8">
        <ShieldProgress fills={fills} active={section} size={132} tone="light" label={progressLabel} done={complete} />
        <ol className="flex flex-col gap-3.5">
          {sections.map((s, i) => {
            const done = fills[i] >= 1;
            const current = i === section;
            return (
              <li key={s.id} className={cn("flex items-center gap-3 transition-opacity duration-500", current || done ? "opacity-100" : "opacity-55")}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full border text-[0.7rem] font-bold transition-colors duration-500",
                    done ? "border-transparent text-on-flame" : current ? "border-white/70" : "border-white/30",
                  )}
                  style={done ? { background: QUARTER_COLORS[i] === "var(--crest-charcoal)" ? "#fff" : QUARTER_COLORS[i] } : undefined}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={cn("text-[1.02rem]", current && "font-semibold")}>
                  {s.label}
                  {done ? <span className="sr-only"> (done)</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-1 text-white/75">
        <p className="t-small">{caption}</p>
        <p className="t-small" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved. You can leave and come back." : saveState === "error" ? "Not saved yet. We’ll keep trying." : " "}
        </p>
      </div>
    </aside>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

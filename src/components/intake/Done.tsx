"use client";

import Link from "next/link";
import { ShieldBurst } from "@/components/flow/Celebration";
import { buttonClasses } from "@/components/ui/Button";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s} seconds` : `${m} min ${s.toString().padStart(2, "0")} sec`;
}

export function Done({
  name,
  seconds,
  isEdit,
  seasonName,
  seasonStarts,
  teen = false,
  companion,
}: {
  name: string;
  seconds: number;
  isEdit: boolean;
  seasonName: string | null;
  seasonStarts: string | null;
  /** Under 18: a parent or guardian has to say yes before tribes are shown. */
  teen?: boolean;
  /** How much the Companion filled in, and how much of that the person kept. */
  companion?: { filled: number; kept: number };
}) {
  const quick = !isEdit && seconds > 0 && seconds <= 360;
  return (
    <main className="night safe-top flex min-h-dvh flex-col items-center justify-between px-6 pb-8 [--safe-pt:4rem] text-center">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-7">
        <ShieldBurst label="Your shield is complete" />

        <div className="rise-in flex flex-col gap-3" style={{ animationDelay: "250ms" }}>
          <h1 className="t-title">{isEdit ? "Updated." : `You’re in, ${name}.`}</h1>
          <p className="t-body mx-auto max-w-[36ch] text-white/80">
            {isEdit
              ? "Your changes are saved. We’ll use them when we match you."
              : teen
                ? "Your answers are saved. Next, your parent or guardian needs to say yes, and one of our Care Team will phone them. Then we’ll show you your tribes."
                : seasonName
                ? `Your answers are saved. ${seasonStarts ? `${seasonName} starts on ${seasonStarts}. ` : ""}Before it begins, we’ll show you your three best-fit tribes, each with its own score.`
                : "Your answers are saved. We’ll show you your three best-fit tribes, each with its own score, when the season opens."}
          </p>
          {companion && companion.filled > 0 ? (
            <p className="mx-auto max-w-[36ch] text-[0.95rem] text-white/75">
              Your Companion filled in {companion.filled} {companion.filled === 1 ? "answer" : "answers"} for you.{" "}
              {companion.kept === companion.filled
                ? "You kept all of them."
                : companion.kept === 0
                  ? "You changed them to fit you, and it learned from that."
                  : `You kept ${companion.kept} and changed the rest.`}
            </p>
          ) : null}
          {quick ? (
            <p className="mx-auto mt-1 inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-1.5 text-[0.9rem] text-white/85">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gold" />
              Done in {formatDuration(seconds)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rise-in flex w-full max-w-md flex-col gap-3" style={{ animationDelay: "450ms" }}>
        <Link href={teen && !isEdit ? "/tribe" : "/home"} className={buttonClasses({ fullWidth: true })}>
          <span className="relative">{teen && !isEdit ? "Ask my parent or guardian" : "Go to home"}</span>
        </Link>
        <Link href="/join?edit=1" className={buttonClasses({ fullWidth: true, variant: "night", size: "md" })}>
          <span className="relative">Change my answers</span>
        </Link>
      </div>
    </main>
  );
}

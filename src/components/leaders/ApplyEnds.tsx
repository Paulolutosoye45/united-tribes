"use client";

import Link from "next/link";
import { useState } from "react";
import { Crest } from "@/components/brand/Crest";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ELIGIBILITY, ELIGIBILITY_ADVICE, OTHER_WAYS_TO_SERVE, type EligibilityId } from "@/lib/leaders/options";

/** Shown when a check is “not yet”. Kind and specific: what to do instead, and when to return. */
export function Ineligible({
  failed,
  onRestart,
  restarting,
  error,
}: {
  failed: string[];
  onRestart: () => void;
  restarting: boolean;
  error: string | null;
}) {
  const items = ELIGIBILITY.filter((e) => failed.includes(e.id));
  return (
    <main className="night safe-top flex min-h-dvh flex-col items-center justify-between px-6 pb-8 [--safe-pt:3rem] lg:[--safe-pt:4rem]">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 py-8">
        <div className="rise-in flex flex-col gap-3">
          <Crest size={34} tone="light" />
          <h1 className="t-title mt-3">Not yet, and that is okay.</h1>
          <p className="t-body max-w-[44ch] text-white/80">
            Leading asks a lot, so we only open it when each of these is in place. Here is what to do for the ones that are not yet.
          </p>
        </div>

        <ul className="stagger flex flex-col gap-3">
          {items.map((item, i) => (
            <li key={item.id} style={{ ["--i" as string]: i }} className="rounded-[var(--radius-card)] border border-white/15 bg-white/[0.06] p-5">
              <p className="font-semibold leading-snug">{item.label}</p>
              <p className="t-small mt-1.5 text-white/75">{ELIGIBILITY_ADVICE[item.id as EligibilityId]}</p>
            </li>
          ))}
        </ul>

        <div className="rise-in flex flex-col gap-2" style={{ animationDelay: "300ms" }}>
          <h2 className="t-heading">Other ways to serve now</h2>
          <ul className="t-body flex flex-col gap-1 text-white/80">
            {OTHER_WAYS_TO_SERVE.map((w) => (
              <li key={w} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                {w}
              </li>
            ))}
          </ul>
        </div>
        {error ? (
          <p role="alert" className="rounded-[var(--radius-control)] bg-danger/15 px-4 py-3 text-[0.95rem] text-white">
            {error}
          </p>
        ) : null}
      </div>

      <div className="rise-in flex w-full max-w-lg flex-col gap-3" style={{ animationDelay: "450ms" }}>
        <Link href="/join" className={buttonClasses({ fullWidth: true })}>
          <span className="relative">Find my circle as a member</span>
        </Link>
        <Button variant="night" size="md" fullWidth loading={restarting} onClick={onRestart}>
          I answered by mistake. Start again
        </Button>
        <Link href="/home" className={buttonClasses({ fullWidth: true, variant: "ghost", size: "md", className: "text-white/80" })}>
          <span className="relative">Back to home</span>
        </Link>
      </div>
    </main>
  );
}

export function Submitted({ name }: { name: string }) {
  const [leaving, setLeaving] = useState(false);
  return (
    <main className="night safe-top flex min-h-dvh flex-col items-center justify-between px-6 pb-8 [--safe-pt:4rem] text-center">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-7">
        <ShieldBurst label="Your application is complete" />
        <div className="rise-in flex flex-col gap-3" style={{ animationDelay: "250ms" }}>
          <h1 className="t-title">Sent, {name}.</h1>
          <p className="t-body mx-auto max-w-[38ch] text-white/80">
            Your application is with the panel, who can start reading it now. One more step: send each referee their private link. Interview invitations wait until both have answered.
          </p>
        </div>
      </div>
      <div className="rise-in flex w-full max-w-md flex-col gap-3" style={{ animationDelay: "450ms" }}>
        <Link href="/lead" onClick={() => setLeaving(true)} className={buttonClasses({ fullWidth: true })} aria-busy={leaving}>
          <span className="relative">Send my referees their links</span>
        </Link>
        <Link href="/home" className={buttonClasses({ fullWidth: true, variant: "night", size: "md" })}>
          <span className="relative">Go to home</span>
        </Link>
      </div>
    </main>
  );
}

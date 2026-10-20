import type { ReactNode } from "react";
import { sinceLabel } from "@/lib/academy/modes";

/** A short notice in place of something the office has switched off. It says when, so no one wonders if it is a fault. */
export function SwitchedOff({ title, since, children, testId = "academy-off" }: { title: string; since?: string | null; children: ReactNode; testId?: string }) {
  const date = sinceLabel(since);
  return (
    <section aria-label={title} className="card flex flex-col gap-2 p-6" data-testid={testId}>
      <h2 className="t-heading">{title}</h2>
      <p className="t-body measure text-soft">{children}</p>
      {date ? <p className="t-small text-soft">Switched off on {date}.</p> : null}
    </section>
  );
}

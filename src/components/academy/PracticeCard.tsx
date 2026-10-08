import { Badge } from "@/components/ui/Badge";
import type { MyAcademy } from "@/lib/academy/types";

export function PracticeCard({ my }: { my: MyAcademy }) {
  const p = my.practice;
  return (
    <section id="practice" aria-labelledby="practice-heading" className="card flex scroll-mt-24 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="practice-heading" className="t-heading">
          Practice session
        </h2>
        {p ? p.ready ? <Badge tone="gold">Ready</Badge> : <Badge tone="flame">Not yet</Badge> : <Badge tone="outline">Not arranged</Badge>}
      </div>
      <p className="t-body text-soft">
        You co-lead one Starter Circle session, or record a simulation, with a coach watching. It is 75 minutes, and a coach marks you ready when you can run a meeting with care.
      </p>
      {p ? (
        <div className="rounded-[var(--radius-control)] bg-surface p-4">
          <p className="t-small font-semibold">{p.ready ? "Your coach’s note" : "What to work on"}</p>
          <p className="t-body mt-1 whitespace-pre-line">{p.note || (p.ready ? "Marked ready. Well done." : "")}</p>
        </div>
      ) : (
        <p className="t-small text-soft">Your coach arranges this with you after the first workshop. There is nothing to book here.</p>
      )}
    </section>
  );
}

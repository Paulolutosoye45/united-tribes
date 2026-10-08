import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import type { LeaderStats } from "@/lib/leaders/review-types";

/** Totals for the office. No names and no answers, only counts. */
export function LeaderStatsPanel({ stats }: { stats: LeaderStats }) {
  const tiles = [
    { label: "Started", value: String(stats.started), note: `${stats.ineligible} not eligible yet` },
    { label: "Sent", value: String(stats.submitted), note: `${stats.in_review} still in review` },
    { label: "Interviews booked", value: String(stats.interviews_booked), note: `${stats.open_slots} open ${stats.open_slots === 1 ? "time" : "times"}` },
    { label: "Approved", value: String(stats.approved_leaders + stats.approved_assistants), note: `${stats.approved_leaders} leaders, ${stats.approved_assistants} assistants` },
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>
      <div>
        <Link href="/review/interviews" className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Manage interview times</span>
        </Link>
      </div>
    </div>
  );
}

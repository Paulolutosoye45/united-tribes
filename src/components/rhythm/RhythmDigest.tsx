import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatDate, plural } from "@/lib/dates";
import type { Digest } from "@/lib/rhythm/types";
import { STATUS_LABELS, percent } from "@/lib/rhythm/wording";

/** The pastorate's weekly report: every tribe's week on one screen, worst first. */
export function RhythmDigest({ digest, canOpen }: { digest: Digest; canOpen: boolean }) {
  if (digest.state === "none" || !digest.tribes || !digest.totals) {
    return (
      <p className="t-body measure text-soft">No season has started yet, so there is no weekly report. It appears the day the first season begins.</p>
    );
  }
  const t = digest.totals;
  const week = digest.week ?? 1;
  const order = { needs_attention: 0, no_log: 1, watch: 2, on_track: 3, upcoming: 4 } as const;
  const tribes = [...digest.tribes].sort((a, b) => order[a.report.status] - order[b.report.status] || a.name.localeCompare(b.name));
  const rate = t.members > 0 ? t.present / t.members : null;

  const tiles = [
    { label: "Attendance", value: percent(rate), note: t.members > 0 ? `${t.present} of ${t.members} in tribes that met` : "no meetings logged yet" },
    { label: "Logged", value: `${t.logged} of ${t.tribes}`, note: t.not_logged > 0 ? `${t.not_logged} not logged yet` : "all logged" },
    { label: "Need attention", value: `${t.needs_attention}`, note: `${t.watch} more to keep an eye on` },
    { label: "People to call", value: `${t.follow_ups}`, note: "follow-ups open" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-body text-soft">
          {digest.season_name}, week {week} of {digest.weeks}. {digest.state === "complete" ? "The season has ended." : digest.state === "running" ? `Starts ${formatDate(digest.starts_on ?? "")}.` : ""}
        </p>
        <nav aria-label="Weeks" className="flex items-center gap-1">
          {week > 1 ? (
            <Link href={`/review/rhythm?week=${week - 1}`} className="press rounded-lg px-3 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
              ← Week {week - 1}
            </Link>
          ) : null}
          {digest.current_week && week < digest.current_week ? (
            <Link href={`/review/rhythm?week=${week + 1}`} className="press rounded-lg px-3 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
              Week {week + 1} →
            </Link>
          ) : null}
        </nav>
      </div>

      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <div key={x.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{x.label}</dt>
            <dd className="t-figure !text-[clamp(1.75rem,8vw,2.75rem)]">{x.value}</dd>
            <dd className="t-small text-soft">{x.note}</dd>
          </div>
        ))}
      </dl>

      {tribes.length === 0 ? (
        <p className="t-body text-soft">No tribes with members yet this season.</p>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {tribes.map((c, i) => {
            const r = c.report;
            const s = STATUS_LABELS[r.status];
            const inner = (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{c.name}</p>
                    <p className="t-small text-soft">
                      Led by {c.leader}
                      {c.coach ? ` · coach ${c.coach}` : " · no coach yet"}
                    </p>
                  </div>
                  <Badge tone={s.tone}>{s.text}</Badge>
                </div>
                <p className="t-small text-soft">
                  {r.logged
                    ? r.held
                      ? `${r.present} of ${plural(r.members, "member")} came (${percent(r.attendance_rate)}). ${r.steps_done + r.steps_partly} finished their step.`
                      : "The tribe did not meet."
                    : r.status === "no_log"
                      ? "No log saved for this week."
                      : "Not met yet this week."}
                  {r.follow_ups_open > 0 ? ` ${plural(r.follow_ups_open, "person", "people")} to call.` : ""}
                  {r.belonging_average !== null ? ` Belonging averages ${r.belonging_average} of 5.` : ""}
                </p>
                {r.highlight ? <p className="t-small">“{r.highlight}”</p> : null}
              </div>
            );
            return (
              <li key={c.tribe_id} style={{ ["--i" as string]: Math.min(i, 8) }}>
                {canOpen ? (
                  <Link href={`/lead/week?tribe=${c.tribe_id}&week=${week}`} className="card press block p-4 transition-shadow hover:shadow-md sm:p-5">
                    {inner}
                  </Link>
                ) : (
                  <div className="card p-4 sm:p-5">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

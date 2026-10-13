import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { plural } from "@/lib/dates";
import type { TribeProgress } from "@/lib/dashboard/types";
import { VERDICTS, pct, signed } from "@/lib/dashboard/wording";
import { WeekBars } from "./WeekBars";

/** A leader's view of their own tribe's season: who came, who stepped, and how the tribe is doing as a whole. */
export function LeaderProgress({ p, weekHref }: { p: TribeProgress; weekHref: string }) {
  const s = p.season;
  const verdict = p.verdict ? VERDICTS[p.verdict] : null;
  const bars = p.weeks.map((w) => ({
    week: w.week,
    current: s.current_week === w.week,
    attendance: w.held && w.marked > 0 ? w.present / w.marked : null,
    steps: w.steps_checked > 0 ? w.steps_done / w.steps_checked : null,
  }));
  const tiles = [
    { label: "Came", value: pct(p.attendance_rate), note: p.held === 0 ? "No meetings logged yet." : `across ${plural(p.held, "meeting")} so far` },
    { label: "Steps done", value: pct(p.steps_done_rate), note: p.steps_done_rate === null ? "No check-ins yet." : `${pct(p.checkin_rate)} of steps were checked in` },
    {
      label: "Success Picture",
      value: p.picture.gain_avg === null ? "–" : signed(p.picture.gain_avg),
      note:
        p.picture.gain_avg === null
          ? p.picture.answers < p.targets.min_answers
            ? `Shown once ${p.targets.min_answers} members have answered the first check-in (${p.picture.answers} so far).`
            : "Shown after the halfway check-in."
          : `${p.picture.base_avg} to ${p.picture.latest_avg} out of 15 on average`,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="night flex flex-col gap-3 rounded-[var(--radius-card)] p-6 sm:p-8">
        <p className="t-small text-white/70">
          {p.tribe.name} · {s.name}
          {s.current_week ? ` · week ${s.current_week} of ${s.weeks}` : p.state === "complete" ? " · season ended" : " · starts soon"}
        </p>
        <h1 className="t-title">Your tribe’s season</h1>
        {verdict ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={verdict.tone}>{verdict.text}</Badge>
            <p className="t-small max-w-prose text-white/80">
              {p.thriving !== null && p.thriving_rate !== null
                ? `${p.thriving} of ${plural(p.members, "member")} thriving (${pct(p.thriving_rate)}). ${verdict.line}`
                : verdict.line}
            </p>
          </div>
        ) : (
          <p className="t-small max-w-prose text-white/80">
            {p.members < p.targets.min_cell
              ? `With ${plural(p.members, "member")}, the tribe-wide thriving figure is kept private: it could give away one person’s answer. You still see who came and who took their step.`
              : "The tribe-wide figure appears after three weeks."}
          </p>
        )}
      </header>

      <dl className="stagger grid gap-3 sm:grid-cols-3">
        {tiles.map((x, i) => (
          <div key={x.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{x.label}</dt>
            <dd className="t-figure !text-[clamp(1.9rem,8vw,2.9rem)]">{x.value}</dd>
            <dd className="t-small text-soft">{x.note}</dd>
          </div>
        ))}
      </dl>

      {p.state !== "before" ? <WeekBars weeks={s.weeks} rows={bars} pace={p.targets.attend_share} title="Week by week" /> : null}

      <section aria-labelledby="people-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="people-heading" className="t-heading">
            Your people
          </h2>
          <p className="t-small text-soft">
            {s.meetings_needed} of {s.weeks} meetings is the bar. “On pace” looks at meetings only. How someone feels about the tribe stays private: if a member says they do not belong, they appear on your call list.
          </p>
        </div>
        {p.member_rows.length === 0 ? (
          <p className="t-body text-soft">Nobody has joined yet.</p>
        ) : (
          <ul className="stagger card divide-y divide-line">
            {p.member_rows.map((m, i) => (
              <li key={m.person_id} style={{ ["--i" as string]: Math.min(i, 10) }} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{m.name}</p>
                  <p className="t-small text-soft">
                    Came to {m.attended} of {s.weeks_over} meetings so far · {m.steps_set === 0 ? "no steps chosen yet" : `finished ${m.steps_done} of ${plural(m.steps_set, "step")}`}
                  </p>
                </div>
                {m.pace ? <Badge tone={m.pace === "on_pace" ? "gold" : "flame"}>{m.pace === "on_pace" ? "On pace" : "Behind"}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Link href={weekHref} className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Back to this week</span>
        </Link>
      </div>
    </div>
  );
}

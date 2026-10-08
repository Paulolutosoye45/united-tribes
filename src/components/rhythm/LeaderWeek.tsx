import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { clockLabel } from "@/lib/academy/options";
import { formatDate, plural } from "@/lib/dates";
import type { CircleWeek, PendingTestimony } from "@/lib/rhythm/types";
import { STATUS_LABELS, meetingDay, weekRange } from "@/lib/rhythm/wording";
import { FollowUpList, type FollowUpRow } from "./FollowUpList";
import { LogForm } from "./LogForm";
import { PictureForm } from "./PictureForm";
import { PrepPack } from "./PrepPack";
import { RaiseConcern } from "./RaiseConcern";
import { TestimonyReview } from "./TestimonyReview";

/** The leader's week: who to call, the two-minute log, the Success Picture, the prep pack and testimonies to read. */
export function LeaderWeek({
  week,
  callerFirst,
  pending,
  base,
}: {
  week: CircleWeek;
  callerFirst: string;
  pending: PendingTestimony[];
  /** The path and query to keep when moving between weeks, such as `/lead/week?circle=…`. */
  base: string;
}) {
  const r = week.report;
  const status = STATUS_LABELS[r.status];
  const join = base.includes("?") ? "&" : "?";
  const href = (n: number) => `${base}${join}week=${n}`;
  const rows: FollowUpRow[] = week.follow_ups.map((f) => ({
    id: f.id,
    name: f.name,
    firstName: f.first_name,
    whatsapp: f.whatsapp,
    kind: f.kind,
    status: f.status,
    attempts: f.attempts,
    lastOutcome: f.last_outcome,
    note: f.note,
    openedAt: f.opened_at,
    circle: week.circle.name,
    caller: callerFirst,
  }));
  const running = week.state === "running";
  const stepsChosen = r.steps_set;

  return (
    <div className="flex flex-col gap-8">
      <section className="night rise-in flex flex-col gap-4 rounded-[var(--radius-sheet)] p-6 sm:p-10" aria-labelledby="lw-heading">
        <p className="t-small text-white/70">
          {week.circle.name} · {running ? (week.week === week.current_week ? "This week" : "Week") : week.state === "before" ? "Preparing" : "Season complete"} · Week {week.week} of {week.weeks} · {weekRange(week.week_starts_on)}
        </p>
        <h1 id="lw-heading" className="t-title">
          {week.state === "before" ? `Your season starts on ${formatDate(week.starts_on)}.` : week.guide.title}
        </h1>
        <p className="t-body text-white/80">
          Your circle meets on {meetingDay(week.meeting_date)} at {clockLabel(week.circle.meeting_time)}.
          {week.state === "before" ? " Read the first week now so you are ready." : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.text}</Badge>
          {week.state !== "before" ? (
            <Link href={base.replace("/lead/week", "/lead/progress")} className="btn btn-night inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium">
              The season so far
            </Link>
          ) : null}
          {week.log_open && !week.log && week.can_edit ? (
            <a href="#log" className="btn btn-night inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium">
              Log the meeting
            </a>
          ) : null}
        </div>
      </section>

      <nav aria-label="Weeks" className="flex items-center justify-between gap-3">
        {week.week > 1 ? (
          <Link href={href(week.week - 1)} className="press rounded-lg px-2 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
            ← Week {week.week - 1}
          </Link>
        ) : (
          <span />
        )}
        {week.current_week && week.week !== week.current_week ? (
          <Link href={base} className="press rounded-lg px-2 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
            This week
          </Link>
        ) : null}
        {week.week < week.weeks && (week.current_week === null || week.week < week.current_week + 1) ? (
          <Link href={href(week.week + 1)} className="press rounded-lg px-2 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
            Week {week.week + 1} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Members", value: `${r.members}`, note: `of ${week.circle.capacity} seats` },
          { label: "Steps chosen", value: `${stepsChosen}`, note: `${r.steps_done + r.steps_partly} finished` },
          { label: "To call", value: `${week.follow_ups.length}`, note: week.follow_ups.length === 0 ? "nobody right now" : "see below" },
          { label: "Testimonies", value: `${week.testimonies_waiting}`, note: "waiting for you" },
        ].map((t, i) => (
          <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>

      {rows.length > 0 || week.can_edit ? (
        <section id="calls" aria-labelledby="calls-heading" className="flex scroll-mt-24 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="calls-heading" className="t-heading">
              People to call first
            </h2>
            <p className="t-small text-soft">Nobody misses twice without a call. A short, warm message counts.</p>
          </div>
          <FollowUpList rows={rows} canAct={week.can_edit} emptyText="Nobody needs a call right now. Thank you for staying close to your circle." />
          {week.can_edit ? (
            <RaiseConcern
              circleId={week.circle.id}
              people={week.members.filter((m) => !m.open_follow_up).map((m) => ({ id: m.person_id, name: m.name }))}
            />
          ) : null}
        </section>
      ) : null}

      {week.state !== "before" ? <LogForm key={`${week.circle.id}-${week.week}`} week={week} /> : null}
      {week.picture.can_refine ? <PictureForm week={week} /> : null}
      <PrepPack week={week} />

      {week.can_edit ? (
        <section id="testimonies" aria-labelledby="t-heading" className="flex scroll-mt-24 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="t-heading" className="t-heading">
              Testimonies to read
            </h2>
            <p className="t-small text-soft">
              {plural(pending.length, "testimony", "testimonies")} waiting. Nothing is shown to the circle until you approve it.
            </p>
          </div>
          <TestimonyReview items={pending} scope="circle" emptyText="No testimonies are waiting." />
        </section>
      ) : null}
    </div>
  );
}

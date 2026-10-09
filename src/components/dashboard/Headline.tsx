import { plural } from "@/lib/dates";
import type { Headline as HeadlineData, SeasonInfo, Targets } from "@/lib/dashboard/types";
import { SUCCESS_PICTURE_NOTE, against, pct, signed, thrivingDefinition } from "@/lib/dashboard/wording";
import { RateRing } from "./RateRing";

/** The Thriving Rate against its target, then the three measures that sit beside it. */
export function Headline({ h, season, targets, scopeLabel, state }: { h: HeadlineData; season: SeasonInfo; targets: Targets; scopeLabel: string; state: "before" | "running" | "complete" }) {
  const rate = h.thriving_rate;
  const tiles = [
    {
      label: "Success Picture",
      value: h.gain_avg === null ? "–" : signed(h.gain_avg),
      note:
        h.gain_avg === null
          ? h.base_n < targets.min_answers
            ? "Appears once three members have answered the first check-in."
            : "Appears after the halfway check-in."
          : `${h.base_avg} to ${h.latest_avg} out of 15. ${pct(h.gain_share)} gained ${targets.gain_min} or more.`,
      help: SUCCESS_PICTURE_NOTE,
    },
    {
      label: "Attendance",
      value: pct(h.attendance_rate),
      note: h.attendance_rate === null ? "No meetings logged yet." : `Two thirds is the bar: ${season.meetings_needed} of ${season.weeks} meetings.`,
    },
    {
      label: "Steps done",
      value: pct(h.steps_done_rate),
      note: h.steps_done_rate === null ? "No check-ins yet." : `${pct(h.checkin_rate)} of chosen steps were checked in.`,
    },
  ];

  return (
    <section aria-labelledby="headline-heading" className="flex flex-col gap-3">
      <h2 id="headline-heading" className="sr-only">
        The numbers that matter
      </h2>
      <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <div className="night flex flex-col gap-5 rounded-[var(--radius-card)] p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-6">
            <RateRing value={rate} target={targets.thriving_rate} size={136} label="Thriving Rate" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="t-small text-white/70">Thriving Rate · {scopeLabel}</p>
              <p className="t-title">
                {rate !== null
                  ? `${h.thriving} of ${plural(h.members, "member")}`
                  : h.members === 0
                    ? "Nobody placed yet"
                    : state === "before"
                      ? `${plural(h.members, "member")} placed`
                      : "Starts in week 4"}
              </p>
              <p className="t-small text-white/80">
                {rate !== null
                  ? `Target ${pct(targets.thriving_rate)}, ${against(rate, targets.thriving_rate)}.`
                  : h.members === 0
                    ? "Members appear here once they have chosen a Tribe."
                    : `A rate shows after ${targets.min_weeks} weeks of the season${state === "running" ? `. ${plural(h.members, "member")} placed so far.` : "."}`}
              </p>
            </div>
          </div>
          <p className="t-small max-w-prose text-white/70">{thrivingDefinition(season.meetings_needed, season.weeks, targets)}</p>
          {h.members > 0 ? (
            <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-white/15 pt-4">
              <div>
                <dt className="t-small text-white/60">Came once</dt>
                <dd className="font-semibold [font-variant-numeric:tabular-nums]">
                  {h.ever_came} of {h.members}
                </dd>
              </div>
              <div>
                <dt className="t-small text-white/60">Still coming</dt>
                <dd className="font-semibold [font-variant-numeric:tabular-nums]">{season.weeks_over >= 4 && h.ever_came > 0 ? `${h.still_coming} of ${h.ever_came}` : "–"}</dd>
              </div>
              <div>
                <dt className="t-small text-white/60">{state === "complete" ? "Effective Tribes" : "On course"}</dt>
                <dd className="font-semibold [font-variant-numeric:tabular-nums]">
                  {state === "before" ? "–" : `${state === "complete" ? h.verdicts.effective : h.verdicts.on_course} of ${h.circles}`}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
        <dl className="stagger card divide-y divide-line self-start">
          {tiles.map((x, i) => (
            <div key={x.label} style={{ ["--i" as string]: i }} className="flex items-center justify-between gap-4 p-4 sm:p-5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="font-medium">{x.label}</dt>
                <dd className="t-small text-soft">{x.note}</dd>
                {"help" in x && x.help ? <dd className="sr-only">{x.help}</dd> : null}
              </div>
              <dd className="t-figure shrink-0 !text-[clamp(1.9rem,8vw,2.6rem)]">{x.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

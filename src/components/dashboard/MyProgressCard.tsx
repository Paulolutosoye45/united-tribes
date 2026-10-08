import type { MyProgress } from "@/lib/dashboard/types";
import { STANDING, signed } from "@/lib/dashboard/wording";

/** A member's own season so far: meetings, steps, and how their Success Picture has moved. Only theirs. */
export function MyProgressCard({ progress }: { progress: MyProgress }) {
  if (!progress.placed || progress.state === "before") return null;
  const st = STANDING[progress.status];
  const first = progress.pulses[0];
  const last = progress.pulses.length > 1 ? progress.pulses[progress.pulses.length - 1] : null;
  const stepsAnswered = progress.steps.done + progress.steps.partly + progress.steps.not_yet;

  return (
    <section aria-labelledby="mine-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="mine-heading" className="t-heading">
          Your season so far
        </h2>
        <p className="font-medium">{st.title}</p>
        <p className="t-small text-soft">{st.line}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Meetings</dt>
          <dd className="t-figure !text-[clamp(1.6rem,7vw,2.3rem)]">
            {progress.attended}
            <span className="t-small ml-1 font-medium text-soft">of {progress.held}</span>
          </dd>
          <dd className="t-small text-soft">{progress.season.meetings_needed} of {progress.season.weeks} is the bar</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Steps done</dt>
          <dd className="t-figure !text-[clamp(1.6rem,7vw,2.3rem)]">
            {progress.steps.done}
            <span className="t-small ml-1 font-medium text-soft">of {progress.steps.set}</span>
          </dd>
          <dd className="t-small text-soft">{stepsAnswered === 0 ? "none checked in yet" : `${progress.steps.partly} partly`}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="t-small text-soft">Success Picture</dt>
          <dd className="t-figure !text-[clamp(1.6rem,7vw,2.3rem)]">{progress.gain === null ? "–" : signed(progress.gain)}</dd>
          <dd className="t-small text-soft">{first ? (last ? `${first.total} to ${last.total} out of 15` : `${first.total} out of 15 at the start`) : "answer the first check-in"}</dd>
        </div>
      </dl>
    </section>
  );
}

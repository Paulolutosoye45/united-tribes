import { Badge } from "@/components/ui/Badge";
import { formatShortDate } from "@/lib/dates";
import { FIT_PART_KEYS, FIT_PART_LABEL, changedLine, chosenLine, firstLine, type FitPanel } from "@/lib/leaders/fit-panel";

/**
 * Tribe fit, on the review page: which tribe the applicant chose, how well their answers match it, anything a pastor should talk
 * about, and the other tribes they could have chosen. A note for the person deciding. It is never a score, and it moves nothing.
 * The database sends it to a pastor or director at once and to another reviewer only after they have scored, so it cannot steer a score.
 */
export function TribeFitPanel({ panel, scored = true }: { panel: FitPanel; scored?: boolean }) {
  if (!panel.visible) {
    // Only shown when Tribe fit is on, so the note is not noise: it says why the panel is not open yet.
    return scored ? null : (
      <section aria-labelledby="tribe-fit-heading" className="flex flex-col gap-3" data-testid="tribe-fit">
        <h2 id="tribe-fit-heading" className="t-heading">
          Tribe fit
        </h2>
        <p className="card t-body p-5 text-soft">This appears once you have scored the application yourself, so it cannot steer your score.</p>
      </section>
    );
  }
  const run = panel.run;
  if (!run) return null;
  const first = firstLine(run);
  const changed = changedLine(run);

  return (
    <section aria-labelledby="tribe-fit-heading" className="flex flex-col gap-3" data-testid="tribe-fit">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="tribe-fit-heading" className="t-heading">
            Tribe fit
          </h2>
          <p className="t-small text-soft">A note to help the conversation. It does not change a score, and you decide.</p>
        </div>
        {run.flags.length > 0 ? <Badge tone="flame">{run.flags.length === 1 ? "1 thing to talk about" : `${run.flags.length} things to talk about`}</Badge> : null}
      </div>

      <div className="card flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-1">
          <p className="t-body font-semibold">{chosenLine(run)}</p>
          {first ? <p className="t-small text-soft">{first}</p> : null}
          {changed ? <p className="t-small text-soft">{changed}</p> : null}
        </div>

        {run.flags.length > 0 ? (
          <ul className="t-body flex flex-col gap-1.5 rounded-[var(--radius-control)] bg-surface px-4 py-3" aria-label="Things to talk about">
            {run.flags.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {run.parts ? (
          <ul className="flex flex-col gap-3" aria-label="How the answers fit this tribe">
            {FIT_PART_KEYS.map((k) => (
              <li key={k} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[0.92rem]">
                  <span>{FIT_PART_LABEL[k]}</span>
                  <span className="font-semibold tabular-nums">{run.parts![k]}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-strong">
                  <div className="h-full rounded-full" style={{ width: `${run.parts![k]}%`, background: "linear-gradient(90deg, var(--crest-gold), var(--crest-flame))" }} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {run.backups.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="t-small font-semibold">Backups they named</h3>
            <p className="t-body text-soft">{run.backups.map((b) => (b.community ? `${b.title} (${b.community})` : b.title)).join(", ")}</p>
          </div>
        ) : null}

        {run.others.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="t-small font-semibold">Also suited</h3>
            <ul className="t-body flex flex-col gap-0.5 text-soft">
              {run.others.map((o) => (
                <li key={`${o.community}-${o.title}`}>
                  {o.title}
                  {o.community ? ` (${o.community})` : ""}. {o.label === "stretch" ? "Stretch" : `${o.label.charAt(0).toUpperCase()}${o.label.slice(1)} match, ${o.degree}%`}.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="t-small text-soft">
          {run.options > 0 ? `${run.options} tribes were compared.` : ""} {run.model ? `Model ${run.model}` : ""}
          {run.at ? `, ${formatShortDate(run.at)}` : ""}.
        </p>
      </div>
    </section>
  );
}

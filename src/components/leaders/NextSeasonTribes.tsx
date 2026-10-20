import { MINE_HINT, MINE_TITLE, matchText, type FitMine } from "@/lib/leaders/fit";

/**
 * For a leader we already have: the tribes their application answers suit best for next season. Words, a match and a few reasons.
 * It changes nothing, offers nothing and moves nobody; it is something to talk about with a pastor.
 */
export function NextSeasonTribes({ mine }: { mine: FitMine }) {
  return (
    <section aria-labelledby="next-tribes-heading" className="flex flex-col gap-3" data-testid="next-season-tribes">
      <div>
        <h2 id="next-tribes-heading" className="t-heading">
          {MINE_TITLE}
        </h2>
        <p className="t-small measure text-soft">{MINE_HINT}</p>
      </div>
      <ul className="stagger flex flex-col gap-3">
        {mine.options.map((o, i) => (
          <li key={o.goalId} style={{ ["--i" as string]: i }} className="card flex flex-col gap-2 p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold leading-snug">{o.title}</span>
              <span className="cmp-tag shrink-0">{matchText(o)}</span>
            </div>
            {o.community ? <p className="t-small text-soft">{o.community}</p> : null}
            {o.reasons.length > 0 ? (
              <ul className="t-small flex list-disc flex-col gap-0.5 pl-4">
                {o.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

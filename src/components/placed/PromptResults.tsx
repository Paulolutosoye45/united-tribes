import { OVERVIEW_WORDS as W, KIND_LABELS, type PromptOverview } from "@/lib/prompt/office";

/**
 * How the sign-in prompt is going, for the people who read the Placed members board: how many people saw it (or would have, in Rehearsal), and what became of each task.
 * Counts only. Nobody is named here, and nothing a person typed or tapped leaves their own screen.
 */
export function PromptResults({ overview }: { overview: PromptOverview }) {
  const shown = overview.state === "on" ? overview.peopleSeen : overview.peopleWould;
  const rows = overview.kinds.filter((k) => k.shown + k.wouldShow + k.answered + k.notNow + k.opened > 0);
  return (
    <section aria-labelledby="prompt-h" className="flex flex-col gap-3" data-testid="prompt-results">
      <div className="flex flex-col gap-1">
        <h2 id="prompt-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft" data-testid="prompt-state">{W[overview.state]}</p>
        {overview.state !== "off" ? (
          <p className="t-small text-soft">
            {W.lead(overview.days)} {overview.state === "on" ? W.seen(shown) : W.would(shown)}
          </p>
        ) : null}
        {overview.state !== "off" ? (
          <p className="t-small font-medium" data-testid="prompt-worth">{W.worth(overview.worthACall, overview.worthCallAfter)}</p>
        ) : null}
      </div>
      {overview.state === "off" ? null : rows.length === 0 ? (
        <p className="t-small text-soft">{W.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-[0.95rem]" data-testid="prompt-table">
            <thead>
              <tr className="border-b border-line text-soft">
                <th scope="col" className="py-2 pr-3 font-medium">{W.columns.task}</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">{overview.state === "on" ? W.columns.shown : W.columns.would}</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">{W.columns.answered}</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">{W.columns.notNow}</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">{W.columns.opened}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.kind} className="border-b border-line/60" data-kind={k.kind}>
                  <th scope="row" className="py-2 pr-3 font-normal">{KIND_LABELS[k.kind]}</th>
                  <td className="px-2 py-2 text-right tabular-nums">{overview.state === "on" ? k.shown : k.wouldShow}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{k.answered}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{k.notNow}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{k.opened}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

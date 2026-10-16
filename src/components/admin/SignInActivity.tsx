import { chartMax, eventLine, shortDay, whenText, type SigninOverview } from "@/lib/signin/admin";

/**
 * The last 30 days, one bar per day: how many codes were asked for, how many arrived, how many failed. The bar's height
 * is the day's asks; the green part arrived, the red part failed and the grey part is the rest (waiting, never
 * collected, or the person had no number on an account). A table below gives the same numbers for anyone who cannot see the bars.
 */
export function SignInActivity({ overview }: { overview: SigninOverview }) {
  const days = overview.daily;
  const max = chartMax(days);
  const total = days.reduce((sum, d) => ({ asked: sum.asked + d.asked, delivered: sum.delivered + d.delivered, failed: sum.failed + d.failed, declined: sum.declined + d.declined }), { asked: 0, delivered: 0, failed: 0, declined: 0 });

  return (
    <>
      <section aria-labelledby="signin-chart-heading" className="flex flex-col gap-4" data-testid="signin-chart">
        <div>
          <h2 id="signin-chart-heading" className="t-heading">
            The last 30 days
          </h2>
          <p className="t-small text-soft">
            {total.asked} asked for, {total.delivered} arrived, {total.failed} failed
            {total.declined > 0 ? `, ${total.declined} held back by a limit` : ""}. Days are Lagos days.
          </p>
        </div>
        <div className="card flex flex-col gap-4 p-5">
          <div role="img" aria-label={`Bar chart of WhatsApp codes by day. ${total.asked} asked for in 30 days, ${total.delivered} arrived, ${total.failed} failed.`} className="flex h-40 items-end gap-[3px]">
            {days.map((d) => {
              const h = (d.asked / max) * 100;
              const arrived = d.asked > 0 ? (d.delivered / d.asked) * 100 : 0;
              const failed = d.asked > 0 ? (d.failed / d.asked) * 100 : 0;
              return (
                <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" title={`${shortDay(d.day)}: ${d.asked} asked, ${d.delivered} arrived, ${d.failed} failed`}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] bg-soft/40" style={{ height: `${h}%`, minHeight: d.asked > 0 ? 3 : 0 }}>
                    <div className="bg-success" style={{ height: `${arrived}%` }} />
                    <div className="bg-danger" style={{ height: `${failed}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="t-small flex flex-wrap gap-x-5 gap-y-1 text-soft" aria-hidden="true">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-success" />Arrived</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-danger" />Failed</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-soft/40" />Other (waiting, not collected, no account)</span>
          </div>
          <details>
            <summary className="t-small cursor-pointer py-2 font-medium">See the numbers by day</summary>
            <div className="overflow-x-auto">
              <table className="t-small w-full min-w-[28rem] text-left">
                <thead className="text-soft">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-medium">Day</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Asked</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Arrived</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">Failed</th>
                    <th scope="col" className="py-2 text-right font-medium">Held back</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...days].reverse().map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <th scope="row" className="py-2 pr-4 font-medium">{shortDay(d.day)}</th>
                      <td className="py-2 pr-4 text-right">{d.asked}</td>
                      <td className="py-2 pr-4 text-right">{d.delivered}</td>
                      <td className="py-2 pr-4 text-right">{d.failed}</td>
                      <td className="py-2 text-right">{d.declined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      <section aria-labelledby="signin-log-heading" className="flex flex-col gap-4" data-testid="signin-log">
        <div>
          <h2 id="signin-log-heading" className="t-heading">
            Pauses and changes
          </h2>
          <p className="t-small text-soft">Every time WhatsApp paused itself, was restarted, switched or changed, with who did it. The last 50.</p>
        </div>
        {overview.events.length === 0 ? (
          <p className="card t-body p-5 text-soft">Nothing yet. WhatsApp has not paused, and nothing has been changed here.</p>
        ) : (
          <ol className="card flex flex-col divide-y divide-line p-0">
            {overview.events.map((e) => {
              const line = eventLine(e);
              return (
                <li key={e.id} className="flex flex-col gap-0.5 px-5 py-3">
                  <span className="font-semibold">{line.title}</span>
                  {line.body ? <span className="t-small">{line.body}</span> : null}
                  <time dateTime={e.at} className="t-small text-soft">{whenText(e.at)}</time>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

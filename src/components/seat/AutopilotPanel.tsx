import { Badge } from "@/components/ui/Badge";
import { AutopilotApprove, AutopilotPause } from "@/components/seat/AutopilotControls";
import { formatDate } from "@/lib/dates";
import { AUTOPILOT_WORDS as W, outcomeWords, slotWords, type AutopilotView } from "@/lib/seat/autopilot";
import { lagosWhen } from "@/lib/seat/seat";

const day = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDate(iso) : iso);

/**
 * Autopilot on the Seats page: today's plan with each person, their tribe and their fit; the one tap that places it; who is still waiting and why; and the small
 * tribes. Every figure comes from the plan or from the waiting list as it stood when the plan was made, so nothing on this panel can disagree with the list under it.
 * Only the admin, a director and a pastor can tap; a data lead only looks. Names, tribes and numbers only: never a phone number, a note or a reason a member gave.
 */
export function AutopilotPanel({ view }: { view: AutopilotView }) {
  const { plan, stats } = view;
  const canAct = view.role === "act";
  const off = view.mode === "off" && !view.paused;
  const waitingForTap = plan?.today === true && plan.state === "planned";
  return (
    <section aria-labelledby="autopilot-h" className="flex flex-col gap-4" data-testid="autopilot">
      <div className="flex flex-col gap-1">
        <h2 id="autopilot-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[70ch] text-soft">{W.intro}</p>
      </div>

      {off ? <p className="card t-body p-5 text-soft" role="status" data-testid="autopilot-off">{W.off}</p> : null}
      {view.mode === "rehearsal" ? <p className="card t-body p-5 text-soft" role="status" data-testid="autopilot-rehearsal">{W.rehearsal}</p> : null}
      {view.paused ? <p className="rounded-[var(--radius-control)] bg-gold/25 px-4 py-3 font-medium" role="status" data-testid="autopilot-paused">{W.paused}</p> : null}
      {view.mode === "on" && !view.paused ? (
        <p className="t-small text-soft" data-testid="autopilot-mode">
          {W.mode(view.setting)}
          {view.until ? ` ${W.until(day(view.until))}` : ""}
        </p>
      ) : null}

      {!off || plan ? (
        <div className="card flex flex-col gap-3 p-5" data-testid="autopilot-plan">
          {plan ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{plan.today ? W.planHeading : W.lastPlan(day(plan.on))}</h3>
                <Badge tone={plan.state === "planned" ? "flame" : plan.state === "applied" ? "gold" : "outline"}>{W.state[plan.state]}</Badge>
                {plan.madeAt ? <span className="t-small text-soft">{lagosWhen(plan.madeAt)}</span> : null}
              </div>
              {plan.state === "applied" ? <p className="t-small text-soft">{W.placed(plan.placed, plan.skipped)}</p> : null}
              {waitingForTap && canAct && !view.paused ? <AutopilotApprove plan={plan.id} count={plan.items} /> : null}
              {waitingForTap && !canAct ? <p className="t-body max-w-[64ch]">{W.ready(plan.items)}</p> : null}
              {plan.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-left" data-testid="autopilot-table">
                    <caption className="sr-only">{plan.today ? W.planHeading : W.lastPlan(day(plan.on))} ({plan.rows.length})</caption>
                    <thead>
                      <tr className="t-small border-b border-line text-soft">
                        {W.columns.map((c) => (
                          <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {plan.rows.map((r, i) => (
                        <tr key={`${r.person}${r.tribe}${i}`} className="align-top">
                          <td className="px-3 py-2 font-medium">{r.person}</td>
                          <td className="px-3 py-2">{r.tribe}</td>
                          <td className="px-3 py-2 tabular-nums">{r.degree}%</td>
                          <td className="t-small px-3 py-2">
                            <p>{W.kind[r.kind]}</p>
                            {r.rehearsal && !r.outcome ? <p className="text-soft">{W.rehearsalRow}</p> : null}
                            {r.outcome ? <p className="text-soft">{outcomeWords(r.outcome)}</p> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <p className="t-body text-soft">{W.noPlan}</p>
          )}
        </div>
      ) : null}

      {stats ? (
        <div className="card flex flex-col gap-3 p-5" data-testid="autopilot-stats">
          <h3 className="font-semibold">{W.bench}</h3>
          <p className="t-body">{W.benchTotal(stats.benchTotal)}</p>
          {stats.blockedByBar > 0 ? <p className="t-body">{W.blocked(stats.blockedByBar, stats.bar || view.bar)}</p> : null}
          {stats.kinds.length > 0 ? (
            <ul className="t-body flex flex-col gap-1">
              {stats.kinds.map((k) => (
                <li key={`${k.community}${k.slot}`}>{W.kinds(k.waiting, k.community, k.slot, k.seats)}</li>
              ))}
            </ul>
          ) : null}
          {stats.kinds.length > 0 ? <p className="t-small text-soft">{W.kindsHelp}</p> : null}
          {plan?.madeAt ? <p className="t-small text-soft">{W.asOf(lagosWhen(plan.madeAt))}</p> : null}

          <h3 className="mt-2 font-semibold">{W.small}</h3>
          {stats.small.length === 0 ? (
            <p className="t-body text-soft">{W.smallNone}</p>
          ) : (
            <>
              <p className="t-small text-soft">{W.smallIntro}</p>
              <ul className="flex flex-col gap-3" data-testid="autopilot-small">
                {stats.small.map((s) => (
                  <li key={s.tribeId ?? s.name} className="flex flex-col gap-0.5">
                    <p className="font-medium">
                      {s.name} <span className="t-small font-normal text-soft">· {W.members(s.members)} · {slotWords(s.slot)} · {W.openFor(s.days)}</span>
                      {s.hard ? <> <Badge tone="flame">{W.hard}</Badge></> : null}
                    </p>
                    {s.leader ? <p className="t-small text-soft">{s.leader}</p> : null}
                    {s.waitingFit > 0 ? <p className="t-small">{W.waitingFit(s.waitingFit)}</p> : null}
                    {s.hard ? <p className="t-small">{W.hardWhy(s.why)}</p> : null}
                    {s.merge ? <p className="t-small">{W.mergeTo(s.merge.to, s.merge.fits, s.merge.of, stats.bar || view.bar)}{s.merge.names.length ? ` (${s.merge.names.join(", ")})` : ""}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {canAct && view.mode !== "off" ? <AutopilotPause paused={view.paused} /> : null}
    </section>
  );
}

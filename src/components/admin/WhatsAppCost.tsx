import Link from "next/link";
import { templateName } from "@/lib/admin/wording";
import { whenText } from "@/lib/signin/admin";
import { CLASS_WORDS } from "@/lib/whatsapp/classes";
import { MODE_WORDS, monthWords, usd, usdSmall, type CostView } from "@/lib/whatsapp/mode-view";

/** What WhatsApp has cost: an estimate from the rates the church entered, by message type, with what Saver or Free would have saved. Never Meta's invoice. */
export function WhatsAppCost({ view }: { view: CostView }) {
  const s = view.sum;
  const share = s.n30 > 0 ? Math.round((s.marketing30 / s.n30) * 100) : 0;
  return (
    <div className="flex flex-col gap-8" data-testid="wa-cost">
      <section className="card flex flex-col gap-3 p-5 sm:p-6" aria-labelledby="wa-cost-month">
        <h2 id="wa-cost-month" className="t-heading">
          This month
        </h2>
        <p className="t-body" data-testid="wa-cost-month">
          {monthWords(view.month, view.ceilingUsd, whenText)}
        </p>
        <p className="t-small text-soft">
          Mode now: {MODE_WORDS[view.effective].name}. {MODE_WORDS[view.effective].costs}{" "}
          <Link href="/admin/messages/whatsapp-mode" className="underline">
            Change the mode
          </Link>
        </p>
      </section>

      <section aria-label="Totals" className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Last 7 days", `${s.n7} messages`, `about ${usd(s.usd7)}`],
            ["Last 30 days", `${s.n30} messages`, `about ${usd(s.usd30)}`],
            ["Filed as Marketing", `${s.marketing30} of ${s.n30}`, `${share}% (costs more)`],
            ["Saver would have saved", `${s.saverN30} messages`, `about ${usd(s.saver30)} in 30 days`],
          ].map(([label, big, small]) => (
            <div key={label} className="card flex flex-col gap-0.5 p-4">
              <dt className="t-small text-soft">{label}</dt>
              <dd className="text-xl font-semibold">{big}</dd>
              <dd className="t-small text-soft">{small}</dd>
            </div>
          ))}
        </dl>
        <p className="t-small text-soft" data-testid="wa-cost-free">
          Free would have saved about {usd(s.usd30)} in the last 30 days: every one of these messages would have gone by email instead.
        </p>
      </section>

      <section aria-labelledby="wa-cost-by" className="card flex flex-col gap-3 p-5 sm:p-6">
        <h2 id="wa-cost-by" className="t-heading">
          By message type, last 30 days
        </h2>
        {view.templates.length === 0 ? (
          <p className="t-small text-soft" data-testid="wa-cost-empty">
            No WhatsApp message has gone out in the last 30 days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="t-small w-full min-w-[32rem] text-left" data-testid="wa-cost-table">
              <thead>
                <tr className="text-soft">
                  <th className="py-2 pr-3 font-medium">Message</th>
                  <th className="py-2 pr-3 font-medium">Class</th>
                  <th className="py-2 pr-3 text-right font-medium">7 days</th>
                  <th className="py-2 pr-3 text-right font-medium">30 days</th>
                  <th className="py-2 text-right font-medium">About</th>
                </tr>
              </thead>
              <tbody>
                {view.templates.map((t) => (
                  <tr key={t.template} className="border-t border-line">
                    <td className="py-2 pr-3">
                      {templateName(t.template)}
                      {t.marketing ? <span className="ml-2 text-flame-deep">Marketing</span> : null}
                    </td>
                    <td className="py-2 pr-3">{CLASS_WORDS[t.class].short}</td>
                    <td className="py-2 pr-3 text-right">{t.n7}</td>
                    <td className="py-2 pr-3 text-right">{t.n30}</td>
                    <td className="py-2 text-right">{usd(t.usd30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="t-small max-w-[70ch] text-soft">
        These are estimates: the number of WhatsApp messages the site sent, times the rates entered on the WhatsApp mode page ({usdSmall(view.rates.utility)} Utility, {usdSmall(view.rates.marketing)} Marketing). Meta also has its own rules about free replies and a free window that this does not model. The true figure is on Meta&rsquo;s invoice.
      </p>
    </div>
  );
}

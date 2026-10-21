import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { RetryMessage } from "@/components/admin/RetryMessage";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DATA_ROLES, PROGRAMME_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadMessageLog, loadMessageStats } from "@/lib/admin/server";
import { MESSAGE_STATUSES } from "@/lib/admin/types";
import { MESSAGE_STATUS_TONE, templateName } from "@/lib/admin/wording";
import { formatLagosDay } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Message log" };

type SearchParams = Promise<{ status?: string; template?: string; days?: string }>;

export default async function MessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(DATA_ROLES, "/admin/messages");
  // Data leads read the log; only an admin or director can put a failed message back in the queue.
  const canRetry = hasAnyRole(session.roles, PROGRAMME_ROLES);
  const q = await searchParams;
  const status = q.status && (MESSAGE_STATUSES as readonly string[]).includes(q.status) ? q.status : null;
  const template = q.template && /^[a-z_]{2,60}$/.test(q.template) ? q.template : null;
  const days = q.days === "1" || q.days === "30" ? Number(q.days) : 7;
  const supabase = await createClient();
  const [stats, log] = await Promise.all([loadMessageStats(supabase, days), loadMessageLog(supabase, status, template, 100)]);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Message log" back={{ href: "/admin/system", label: "Sending and email" }}>
        Every WhatsApp, email and text the platform has queued, and what became of it. Names are shown here for the office only.
        {canRetry ? " A message that failed can be tried again; it goes out on the next heartbeat." : ""}
      </PageHead>

      {stats ? (
        <section aria-label="Totals" className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Waiting", stats.queued],
              ["Sent", stats.sent],
              ["Delivered", stats.delivered],
              ["Read", stats.read],
              ["Failed", stats.failed],
              ["Skipped", stats.skipped],
            ].map(([label, n]) => (
              <div key={label} className="card flex flex-col gap-0.5 p-4">
                <dt className="t-small text-soft">{label}</dt>
                <dd className="text-2xl font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="t-small text-soft">
            {days === 1 ? "Since yesterday" : `The last ${days} days`}
            {Object.keys(stats.by_channel).length > 0 ? ` · by ${Object.entries(stats.by_channel).map(([c, n]) => `${c} ${n}`).join(", ")}` : ""}.{" "}
            {[1, 7, 30].filter((n) => n !== days).map((n, i) => (
              <span key={n}>
                {i > 0 ? " · " : ""}
                <Link href={`/admin/messages?days=${n}${status ? `&status=${status}` : ""}`} className="underline">
                  {n === 1 ? "24 hours" : `${n} days`}
                </Link>
              </span>
            ))}
          </p>
        </section>
      ) : null}

      <form method="get" role="search" aria-label="Filter the log" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="days" value={days} />
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Status
          <select name="status" defaultValue={status ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">Any</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Kind
          <select name="template" defaultValue={template ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">Any</option>
            {(stats?.by_template ?? []).map((t) => (
              <option key={t.template} value={t.template}>
                {templateName(t.template)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="md" variant="quiet">
          Filter
        </Button>
      </form>

      {log === null ? (
        <p className="card t-body p-6 text-soft">We couldn’t load the log. Try again in a moment.</p>
      ) : log.length === 0 ? (
        <p className="card t-body p-6 text-soft">Nothing matches.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-left">
            <caption className="sr-only">The most recent messages</caption>
            <thead>
              <tr className="t-small border-b border-line text-soft">
                <th scope="col" className="px-4 py-3 font-medium">To</th>
                <th scope="col" className="px-4 py-3 font-medium">Kind</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Channel</th>
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                {canRetry ? (
                  <th scope="col" className="relative px-4 py-3 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {log.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="px-4 py-3">{m.to ?? "Someone who has left"}</td>
                  <td className="px-4 py-3">
                    {templateName(m.template)}
                    {m.urgency === "urgent" ? <Badge tone="flame" className="ml-2">Urgent</Badge> : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={MESSAGE_STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                    {m.error ? <p className="t-small mt-1 max-w-[16rem] text-soft">{m.error}</p> : null}
                    {m.attempts > 1 ? <p className="t-small mt-1 text-soft">{m.attempts} attempts</p> : null}
                  </td>
                  <td className="px-4 py-3">{m.channel ?? (m.tried && m.tried.length > 0 ? `tried ${m.tried.join(", ")}` : "–")}</td>
                  <td className="t-small whitespace-nowrap px-4 py-3 text-soft">{formatLagosDay(m.sent_at ?? m.scheduled_for ?? m.created_at)}</td>
                  {canRetry ? <td className="px-4 py-3">{m.status === "failed" ? <RetryMessage id={m.id} to={m.to ?? "someone who has left"} /> : null}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

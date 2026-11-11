import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { HodActions } from "@/components/leader-cards/HodActions";
import { HodStart } from "@/components/leader-cards/HodStart";
import { Badge } from "@/components/ui/Badge";
import { LEADER_CARD_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CARD_WORDS, type CardState } from "@/lib/leader-cards/cards";
import { HOD_RESULTS, HOD_WORDS, hodActions, hodCounts, hodHeadline, type HodResult } from "@/lib/leader-cards/hod";
import { loadHodList, loadHodReport } from "@/lib/leader-cards/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Check the heads-of-department list" };

type SearchParams = Promise<{ run?: string; show?: string }>;

const BACK = { href: "/admin/people/leader-cards", label: "Leader cards" };
const day = (iso: string) => iso.slice(0, 10);

export default async function HodReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(LEADER_CARD_ROLES, "/admin/people/leader-cards/reconcile");
  const q = await searchParams;
  const supabase = await createClient();
  const runId = isUuid(q.run) ? q.run : null;

  if (runId) {
    const report = await loadHodReport(supabase, runId);
    if (!report.ok) {
      return (
        <div className="flex flex-col gap-8">
          <PageHead title="Check the heads-of-department list" back={BACK}>
            That report is not here.
          </PageHead>
          <p className="card t-body p-6 text-soft" data-testid="hod-gone">
            It may have been deleted, or it belongs to another church, or the database file for this page has not been applied.{" "}
            <Link href="/admin/people/leader-cards/reconcile" className="underline">
              See the reports
            </Link>
          </p>
        </div>
      );
    }
    const act = report.role === "act";
    const counts = hodCounts(report.rows);
    const todo = hodActions(report.rows);
    const show = HOD_RESULTS.find((r) => r === q.show) ?? null;
    const shown = show ? report.rows.filter((r) => r.result === show) : report.rows;
    const href = (r: HodResult | null) => `/admin/people/leader-cards/reconcile?run=${runId}${r ? `&show=${r}` : ""}`;
    const dl = (part: "list" | "missing") => `/admin/people/leader-cards/reconcile/download?run=${runId}&part=${part}`;

    return (
      <div className="flex flex-col gap-8">
        <PageHead title="Check the heads-of-department list" back={BACK}>
          Made {day(report.run.madeAt)}
          {report.run.note ? `: ${report.run.note}` : ""}. It is read from the platform again each time you open it, so a person who has since signed up or been appointed shows as they are now.
        </PageHead>

        <section aria-labelledby="hod-counts" className="flex flex-col gap-3">
          <h2 id="hod-counts" className="t-heading" data-testid="hod-headline">
            {hodHeadline(counts, report.missing.length)}
          </h2>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="hod-results">
            {HOD_RESULTS.map((r) => {
              const on = show === r;
              return (
                <li key={r} className={`card flex flex-col gap-1 p-4 ${on ? "border-ink" : ""}`}>
                  <Link href={href(on ? null : r)} className="flex flex-col gap-0.5" aria-current={on ? "true" : undefined} data-result={r}>
                    <span className="text-2xl font-semibold" data-testid={`hod-count-${r}`}>{counts[r]}</span>
                    <span className="font-medium underline">{HOD_WORDS[r].label}</span>
                  </Link>
                  <span className="t-small text-soft">{HOD_WORDS[r].line}</span>
                </li>
              );
            })}
          </ul>
          {show ? (
            <p className="t-small text-soft">
              <Link href={href(null)} className="underline">Show every row</Link>
            </p>
          ) : null}
        </section>

        <section aria-labelledby="hod-missing" className="flex flex-col gap-3" data-testid="hod-missing">
          <h2 id="hod-missing" className="t-heading">
            {report.missing.length === 0 ? "Every leader on the platform is on your list" : `${report.missing.length} ${report.missing.length === 1 ? "leader" : "leaders"} on the platform, not on your list`}
          </h2>
          {report.missing.length > 0 ? (
            <>
              <p className="t-small text-soft">These people lead a tribe this season, or were appointed, and nobody on your list matched them by email or number. They may be on the list under another address.</p>
              <ul className="flex flex-col gap-2">
                {report.missing.map((m, i) => (
                  <li key={`${m.name}-${i}`} className="card t-body flex flex-wrap items-center gap-x-3 gap-y-1 p-4">
                    <span className="font-semibold">{m.name}</span>
                    {m.tribe ? <span className="text-soft">{m.tribe}</span> : null}
                    <Badge tone="outline">{m.department || "No department yet"}</Badge>
                    {m.state ? <span className="t-small text-soft">Card: {(CARD_WORDS[m.state as CardState] ?? m.state).toLowerCase()}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section aria-labelledby="hod-rows" className="flex flex-col gap-3">
          <h2 id="hod-rows" className="t-heading">
            {show ? `${HOD_WORDS[show].label}: ${shown.length}` : `The list, row by row (${report.rows.length})`}
          </h2>
          {shown.length === 0 ? (
            <p className="card t-body p-5 text-soft">No rows.</p>
          ) : (
            <div className="card overflow-x-auto" tabIndex={0} role="region" aria-labelledby="hod-rows">
              <table className="t-small w-full min-w-[40rem] text-left" data-testid="hod-table">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="p-3">Line</th>
                    <th scope="col" className="p-3">Name</th>
                    <th scope="col" className="p-3">Department</th>
                    <th scope="col" className="p-3">Where they stand</th>
                    {act ? <th scope="col" className="p-3">From the list</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.line} className="border-b border-line align-top last:border-b-0" data-line={r.line}>
                      <td className="p-3 text-soft">{r.line}</td>
                      <td className="p-3 font-medium">{r.name || "No name"}</td>
                      <td className="p-3">
                        {r.department || <span className="text-soft">None on the list</span>}
                        {r.leaderDept && r.leaderDept.toLowerCase() !== r.department.toLowerCase() ? <span className="block text-soft">On the platform: {r.leaderDept}</span> : null}
                      </td>
                      <td className="p-3">
                        <Badge tone={r.result === "appointed" ? "outline" : "gold"}>{HOD_WORDS[r.result].label}</Badge>
                        {r.note ? <span className="block text-soft">{r.note}</span> : null}
                      </td>
                      {act ? (
                        <td className="p-3 text-soft">
                          {r.email ? <span className="block break-all">{r.email}</span> : null}
                          {r.phone ? <span className="block">{r.phone}</span> : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-label="Lists to download" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a href={dl("list")} data-testid="hod-download-list" className="t-body font-medium underline">
            Download the list with where each person stands (spreadsheet)
          </a>
          <a href={dl("missing")} data-testid="hod-download-missing" className="t-body font-medium underline">
            Download the leaders who are not on the list (spreadsheet)
          </a>
          {act ? null : <span className="t-small text-soft">You can read the report and download it. Emails and numbers are for the office.</span>}
        </section>

        {act ? (
          <HodActions
            id={runId}
            tag={todo.tag}
            differs={todo.differs}
            invite={todo.invite}
            noEmail={todo.noEmail}
            canInvite={hasAnyRole(session.roles, ["admin", "director"])}
            taggedAt={report.run.taggedAt}
            invitedAt={report.run.invitedAt}
            invitedN={report.run.invitedN}
          />
        ) : null}
      </div>
    );
  }

  const list = await loadHodList(supabase);
  if (!list.ok) {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title="Check the heads-of-department list" back={BACK}>
          Upload the church’s list of heads of department and see who is on the platform, who is not, and which leaders the list left out.
        </PageHead>
        <p className="card t-body p-6 text-soft" data-testid="hod-unavailable">
          This page is not available yet. If you were told it should be, the database file for it has not been applied.
        </p>
      </div>
    );
  }
  const act = list.role === "act";

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Check the heads-of-department list" back={BACK}>
        Upload the church’s list of heads of department and see who is on the platform, who is not, and which leaders the list left out. Nothing is sent and nobody is changed until you choose.
      </PageHead>

      {act ? <HodStart /> : <p className="t-small text-soft">The office makes the reports. You can read them and download them.</p>}

      <section aria-labelledby="hod-past" className="flex flex-col gap-3">
        <h2 id="hod-past" className="t-heading">
          {list.runs.length === 0 ? "No report yet" : "Reports made"}
        </h2>
        {list.runs.length > 0 ? (
          <ul className="flex flex-col gap-3" data-testid="hod-runs">
            {list.runs.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link href={`/admin/people/leader-cards/reconcile?run=${r.id}`} className="font-semibold underline underline-offset-4">
                    {day(r.madeAt)}
                    {r.note ? `: ${r.note}` : ""}
                  </Link>
                  <p className="t-small text-soft">
                    {r.rows} rows
                    {HOD_RESULTS.filter((k) => (r.counts[k] ?? 0) > 0).map((k) => `, ${r.counts[k]} ${HOD_WORDS[k].label.toLowerCase()}`).join("")}
                    {r.taggedAt ? ", departments put on" : ""}
                    {r.invitedAt ? ", invitations sent" : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

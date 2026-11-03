import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { GapTrend } from "@/components/contact-gaps/GapTrend";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { CONTACT_GAP_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { CAUSES, askableCount, askedWords, causeLabel, gapCount, type GapCause } from "@/lib/contact-gaps/gaps";
import { loadGapReport } from "@/lib/contact-gaps/server";
import { loadCommunities } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contact gaps" };

const PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Promise<{ cause?: string; tribe?: string; community?: string; page?: string }>;

/** The audience a "write to them" button opens the composer with: no number, no WhatsApp yes, or both. */
function audienceCause(cause: GapCause | null): "no_number" | "no_yes" | "either" {
  return cause === "no_number" || cause === "made_up" ? "no_number" : cause === "no_yes" ? "no_yes" : "either";
}

export default async function ContactGapsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(CONTACT_GAP_ROLES, "/admin/people/contact-gaps");
  const q = await searchParams;
  const cause = CAUSES.find((c) => c.key === q.cause)?.key ?? null;
  const tribe = q.tribe && UUID.test(q.tribe) ? q.tribe : null;
  const community = q.community && UUID.test(q.community) ? q.community : null;
  const page = Math.max(1, Math.min(500, Number.parseInt(q.page ?? "1", 10) || 1));
  const supabase = await createClient();
  const [report, communities] = await Promise.all([
    loadGapReport(supabase, { cause, tribe, community, limit: PAGE, offset: (page - 1) * PAGE }),
    loadCommunities(supabase),
  ]);

  if (report.state === "off") {
    return (
      <div className="flex flex-col gap-8">
        <PageHead title="Contact gaps">The members a leader cannot reach on WhatsApp, and why.</PageHead>
        <p className="card t-body p-6 text-soft" data-testid="gaps-off">
          This is switched Off, so nothing is listed. When it is switched on, this page shows who has no number, who has not said yes to WhatsApp and who only a person can reach, and lets the office ask them by email.
        </p>
      </div>
    );
  }

  const act = report.role === "act" || hasAnyRole(session.roles, ["admin", "director", "data_lead"]);
  const live = report.state === "on";
  const canWrite = live && hasAnyRole(session.roles, ["admin", "director", "pastor"]);
  const gaps = gapCount(report.counts);
  const askable = askableCount(report.counts);
  const href = (over: Record<string, string | null>): string => {
    const p = new URLSearchParams();
    const next = { cause, tribe, community, page: null as string | null, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/people/contact-gaps${s ? `?${s}` : ""}`;
  };
  const writeHref = (() => {
    const p = new URLSearchParams({ audience: "cannot_reach", cause: audienceCause(cause) });
    if (tribe) p.set("tribe", tribe);
    if (community) p.set("community", community);
    return `/admin/announcements/new?${p.toString()}`;
  })();
  const pages = Math.max(1, Math.ceil(report.total / PAGE));
  const filtered = Boolean(cause || tribe || community);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Contact gaps">
        The members of a tribe whom a leader cannot reach on WhatsApp, and why. It lists names only: no phone number appears here, and nobody is told anything until you choose to ask.
      </PageHead>

      {!live ? (
        <p className="card t-body p-5 text-soft" role="status" data-testid="gaps-rehearsal">
          Rehearsal. This list is real, but nobody is asked, no member sees a prompt and the announcement choice stays hidden until it is switched On.
        </p>
      ) : null}

      <section aria-labelledby="gaps-counts" className="flex flex-col gap-3">
        <h2 id="gaps-counts" className="t-heading">
          {gaps === 0 ? "Every adult in a tribe can be reached" : `${gaps} of ${report.adults} adults in a tribe cannot be reached on WhatsApp`}
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="gap-causes">
          {CAUSES.map((c) => {
            const n = report.counts[c.key];
            const on = cause === c.key;
            return (
              <li key={c.key} className={`card flex flex-col gap-1 p-4 ${on ? "border-ink" : ""}`}>
                <Link href={on ? href({ cause: null }) : href({ cause: c.key })} className="flex flex-col gap-0.5" aria-current={on ? "true" : undefined} data-cause={c.key}>
                  <span className="text-2xl font-semibold" data-testid={`count-${c.key}`}>{n}</span>
                  <span className="font-medium underline">{c.label}</span>
                </Link>
                <span className="t-small text-soft">{c.line}</span>
              </li>
            );
          })}
        </ul>
        <p className="t-small text-soft">
          {askable} can be asked by email. The rest are for a person to reach, or are not to be asked at all.
        </p>
      </section>

      <section aria-label="What you can do" className="flex flex-wrap items-center gap-3">
        {canWrite && askable > 0 ? (
          <Link href={writeHref} data-testid="gaps-write" className={buttonClasses({ variant: "primary", size: "md" })}>
            Write to the people who can be asked
          </Link>
        ) : null}
        {act && report.total + gaps > 0 ? (
          <a href="/admin/people/contact-gaps/download" data-testid="gaps-download" className="t-body font-medium underline">
            Download the whole list (spreadsheet)
          </a>
        ) : null}
        {!act ? <span className="t-small text-soft">You can read this list. The office asks people and downloads it.</span> : null}
      </section>

      <form method="get" role="search" aria-label="Filter the list" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Why
          <select name="cause" defaultValue={cause ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">Any reason</option>
            {CAUSES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          Community
          <select name="community" defaultValue={community ?? ""} className="h-12 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base">
            <option value="">Every community</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        {tribe ? <input type="hidden" name="tribe" value={tribe} /> : null}
        <Button type="submit" size="md" variant="quiet">Filter</Button>
        {filtered ? (
          <Link href="/admin/people/contact-gaps" className="t-small inline-flex min-h-12 items-center underline">Clear</Link>
        ) : null}
      </form>

      {report.rows.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="gaps-empty">
          {filtered ? "Nobody matches." : "Nobody is on the list."}
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-left" data-testid="gaps-table">
            <caption className="sr-only">Members a leader cannot reach on WhatsApp</caption>
            <thead>
              <tr className="t-small border-b border-line text-soft">
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Tribe</th>
                <th scope="col" className="px-4 py-3 font-medium">Leader</th>
                <th scope="col" className="px-4 py-3 font-medium">Why</th>
                <th scope="col" className="px-4 py-3 font-medium">Asked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.map((r) => (
                <tr key={r.personId} className="align-top" data-cause={r.cause}>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3">
                    <Link href={href({ tribe: r.tribeId })} className="underline">{r.tribe}</Link>
                  </td>
                  <td className="px-4 py-3">{r.leader || "–"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.cause === "unreachable" ? "flame" : "neutral"}>{causeLabel(r.cause)}</Badge>
                  </td>
                  <td className="t-small px-4 py-3 text-soft">{askedWords(r.lastAsked, r.asks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="t-body flex items-center gap-4">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="underline">Earlier</Link> : null}
          <span className="text-soft">Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ page: String(page + 1) })} className="underline">Next</Link> : null}
        </nav>
      ) : null}

      <section aria-labelledby="gaps-trend" className="flex flex-col gap-3">
        <h2 id="gaps-trend" className="t-heading">Is it getting better?</h2>
        <GapTrend trend={report.trend} />
      </section>
    </div>
  );
}

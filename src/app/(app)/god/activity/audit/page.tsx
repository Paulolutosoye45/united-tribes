import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DataTable, Unavailable } from "@/components/activity/parts";
import { groupWords } from "@/lib/activity/csv";
import { isDay } from "@/lib/activity/format";
import { loadAudit, loadAuditAreas, markViewed } from "@/lib/activity/server";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { describeAction } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit trail" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const GROUPS = ["member", "young", "leader", "team", "pastoral", "system", "you"] as const;
const PAGE = 100;

function link(base: string, params: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return `${base}${s ? `?${s}` : ""}`;
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const q = await searchParams;
  const group = (GROUPS as readonly string[]).includes(one(q.group) ?? "") ? one(q.group)! : null;
  const area = /^[a-z_]{1,32}$/.test(one(q.area) ?? "") ? one(q.area)! : null;
  const from = isDay(one(q.from)) ? one(q.from)! : null;
  const to = isDay(one(q.to)) ? one(q.to)! : null;
  const before = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(one(q.before) ?? "") ? one(q.before)! : null;

  const supabase = await createClient();
  const [audit, areas] = await Promise.all([loadAudit(supabase, { group, area, from, to, before, limit: PAGE }), loadAuditAreas(supabase)]);
  if (!audit) return <Unavailable />;
  await markViewed(supabase, "audit");

  const filters = { group, area, from, to };
  const exportHref = link("/god/activity/audit/export", filters);

  return (
    <div className="flex flex-col gap-8">
      <p className="t-body measure text-soft">
        Who did what, and when, across the whole platform: every recorded action by every group, including yours (shown as “You”). It records the action, never what was written. A young member appears only as “Young member”, with no name and no link.
      </p>

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4 sm:p-5" aria-label="Filter the audit trail">
        <label className="t-small flex flex-col gap-1 text-soft">
          Who
          <select name="group" defaultValue={group ?? ""} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink">
            <option value="">Everyone</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {groupWords(g)}
              </option>
            ))}
          </select>
        </label>
        <label className="t-small flex flex-col gap-1 text-soft">
          Area
          <select name="area" defaultValue={area ?? ""} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink">
            <option value="">All areas</option>
            {(areas ?? []).map((a) => (
              <option key={a.prefix} value={a.prefix}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="t-small flex flex-col gap-1 text-soft">
          From
          <input type="date" name="from" defaultValue={from ?? ""} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink" />
        </label>
        <label className="t-small flex flex-col gap-1 text-soft">
          To
          <input type="date" name="to" defaultValue={to ?? ""} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink" />
        </label>
        <button type="submit" className="btn btn-quiet h-10 rounded-full px-5 text-[0.9rem] font-medium">
          Filter
        </button>
        {group || area || from || to ? (
          <Link href="/god/activity/audit" className="t-small self-center underline">
            Clear
          </Link>
        ) : null}
        <a href={exportHref} download className="btn btn-quiet ml-auto h-10 rounded-full px-5 text-[0.9rem] font-medium leading-10" data-testid="audit-export">
          Download as a spreadsheet
        </a>
      </form>

      {audit.young_hidden ? <p className="card t-body p-5 text-soft">That person is a young member, so their actions are not listed.</p> : null}

      <DataTable
        caption="The audit trail"
        head={["When", "Who", "Group", "What happened", "Area", "Item"]}
        empty="Nothing matches those filters."
        rows={audit.rows.map((r) => [
          <span key="t" className="whitespace-nowrap">
            {formatLagosDay(r.at)}, {formatLagosTime(r.at)}
          </span>,
          r.person_id ? (
            <Link key="w" href={`/god/people/${r.person_id}`} className="underline">
              {r.who}
            </Link>
          ) : (
            r.who
          ),
          groupWords(r.group),
          describeAction(r.action),
          r.area,
          r.entity ? `${r.entity}${r.ref ? ` ${r.ref}` : ""}` : "–",
        ])}
      />

      {audit.next_before ? (
        <Link href={link("/god/activity/audit", { ...filters, before: audit.next_before })} className="t-body underline">
          Older
        </Link>
      ) : null}
      {before ? (
        <Link href={link("/god/activity/audit", filters)} className="t-body underline">
          Back to the latest
        </Link>
      ) : null}
    </div>
  );
}

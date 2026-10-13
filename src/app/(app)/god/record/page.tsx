import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PassphraseForm } from "@/components/god/PassphraseForm";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import { getOverview, loadRecord } from "@/lib/god/server";
import { ago, clock, describeAction, describeKind, kindTone } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your record" };

type SearchParams = Promise<{ before?: string }>;

const TONE = { calm: "bg-soft", watch: "bg-[var(--crest-gold)]", alert: "bg-flame" } as const;

function line(kind: string, action: string | null, detail: Record<string, unknown>): string {
  if (kind === "action" && action) return `${describeKind(kind)}: ${describeAction(action)}`;
  if (kind === "probe") return `${describeKind(kind)}${typeof detail.person === "string" ? `: ${detail.person}` : ""}`;
  if (kind === "wrong") {
    const tries = typeof detail.tries === "number" ? `, try ${detail.tries}` : "";
    return `${describeKind(kind)}${tries}${detail.locked ? ", locked" : ""}`;
  }
  return describeKind(kind);
}

export default async function RecordPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { before } = await searchParams;
  const beforeId = before && /^\d{1,15}$/.test(before) ? Number(before) : null;
  const supabase = await createClient();
  const [o, entries] = await Promise.all([getOverview(), loadRecord(supabase, beforeId, 80)]);
  const now = clock();
  const list = entries ?? [];
  const last = list.length > 0 ? list[list.length - 1].id : null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Your record</h1>
        <p className="t-body measure text-soft">
          Every time you unlocked, every wrong passphrase, every stranger who tried, and everything you changed. Nobody else can read this page.
        </p>
      </header>

      <section aria-labelledby="security-heading" className="flex flex-col gap-4">
        <h2 id="security-heading" className="t-heading">
          Your passphrase
        </h2>
        <p className="t-body measure text-soft">
          {o?.phrase_changed_at ? `Last changed ${formatShortDate(o.phrase_changed_at)}. ` : ""}Five wrong tries lock the unlock for a while, and the wait grows with every wrong try after that.
        </p>
        <div className="card p-5 sm:p-7">
          <PassphraseForm />
        </div>
      </section>

      <section aria-labelledby="log-heading" className="flex flex-col gap-4">
        <h2 id="log-heading" className="t-heading">
          What happened
        </h2>
        {!entries ? (
          <p className="card t-body p-6 text-soft">Your record could not load. Try again in a moment.</p>
        ) : list.length === 0 ? (
          <p className="card t-body p-6 text-soft">Nothing yet.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden" aria-label="Your record">
            {list.map((e) => (
              <li key={e.id} data-kind={e.kind} className="flex items-start gap-3 p-4">
                <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${TONE[kindTone(e.kind)]}`} />
                <span className="min-w-0 flex-1">
                  <span className="t-body block">{line(e.kind, e.action, e.detail)}</span>
                  <span className="t-small text-soft">{ago(e.at, now) || `${formatLagosDay(e.at)}, ${formatLagosTime(e.at)}`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {list.length >= 80 && last ? (
          <Link href={`/god/record?before=${last}`} className="t-body underline">
            Older
          </Link>
        ) : null}
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { BiPanel, TokenPanel } from "@/components/admin/SystemBoard";
import { DATA_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadBiStatus, loadMessageStats, loadWorkerTokens } from "@/lib/admin/server";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sending and reporting" };

export default async function SystemPage() {
  const session = await requireRole(DATA_ROLES, "/admin/system");
  const supabase = await createClient();
  const isAdmin = hasAnyRole(session.roles, ["admin"]);
  const [bi, tokens, stats] = await Promise.all([loadBiStatus(supabase), isAdmin ? loadWorkerTokens(supabase) : Promise.resolve(null), loadMessageStats(supabase, 7)]);

  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Sending and reporting">How messages reach people, and how the numbers reach your reporting tool.</PageHead>

      <section aria-labelledby="sending-heading" className="flex flex-col gap-4">
        <h2 id="sending-heading" className="t-heading">
          Sending service
        </h2>
        <p className="t-body measure text-soft">
          Messages are sent by a small service that has no account of its own. It holds one token that opens only the few things it needs: claiming a message, reporting how it went, and running the weekly calendar.
          {stats?.last_worker_seen ? ` It was last seen ${formatShortDate(stats.last_worker_seen)}.` : ""}
        </p>
        {stats ? (
          <p className="t-body">
            {stats.queued} waiting · {stats.sent} sent in the last {stats.days} days · {stats.failed} failed.{" "}
            <Link href="/admin/messages" className="underline">
              See the message log
            </Link>
          </p>
        ) : null}
        {isAdmin ? (
          tokens ? (
            <TokenPanel tokens={tokens} />
          ) : (
            <p className="card t-body p-5 text-soft">We couldn’t load the tokens. Try again in a moment.</p>
          )
        ) : (
          <p className="t-small text-soft">Only an admin makes or revokes sending tokens.</p>
        )}
      </section>

      <section aria-labelledby="bi-heading" className="flex flex-col gap-4">
        <h2 id="bi-heading" className="t-heading">
          Reporting copy
        </h2>
        {bi ? <BiPanel status={bi} canRefresh /> : <p className="card t-body p-5 text-soft">We couldn’t load the reporting copy. Try again in a moment.</p>}
      </section>
    </div>
  );
}

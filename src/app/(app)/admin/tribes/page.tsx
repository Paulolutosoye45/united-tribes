import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageHead } from "@/components/admin/PageHead";
import { OfficeRequests } from "@/components/placement/OfficeRequests";
import { Badge } from "@/components/ui/Badge";
import { PLACE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadOfficeTribes, loadRequests } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Place or move a member" };

export default async function TribesPage() {
  await connection();
  await requireRole(PLACE_ROLES, "/admin/tribes");
  const supabase = await createClient();
  const [view, requests] = await Promise.all([loadOfficeTribes(supabase), loadRequests(supabase)]);

  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Place or move a member">Open a tribe to add a member to it, or to see who the office placed there lately. To place or move one person, you can also find them on People and roles.</PageHead>

      {view && view.mode !== "on" ? (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 p-3" data-testid="tribes-off">
          Placement is {view.mode === "rehearsal" ? "in Rehearsal" : "Off"}. The owner switches it On; until then nobody can be placed or moved from here.
        </p>
      ) : null}

      <section aria-labelledby="tribes-heading" className="flex flex-col gap-4">
        <h2 id="tribes-heading" className="t-heading">
          Open tribes this season
        </h2>
        {!view ? (
          <p className="card t-body p-6 text-soft">The tribes are not available right now. Reload the page.</p>
        ) : view.tribes.length === 0 ? (
          <p className="card t-body p-6 text-soft">No tribe is open yet.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden" data-testid="tribes-list">
            {view.tribes.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.name}</p>
                  <p className="t-small text-soft">
                    Led by {t.leader} · {t.active} of {t.capacity} seats taken
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {t.active >= t.capacity ? <Badge tone="gold">Full</Badge> : null}
                  <Link href={`/admin/tribes/${t.id}`} className="font-semibold underline underline-offset-4" data-testid={`tribe-open-${t.id}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="requests-heading" className="flex flex-col gap-4">
        <h2 id="requests-heading" className="t-heading">
          Your requests to the owner
        </h2>
        <OfficeRequests requests={requests} owner={false} />
      </section>
    </div>
  );
}

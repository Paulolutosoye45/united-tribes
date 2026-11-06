import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PageHead } from "@/components/admin/PageHead";
import { AddToTribe } from "@/components/placement/AddToTribe";
import { PlacedLately } from "@/components/placement/PlacedLately";
import { RemovedLately, TribeMembers } from "@/components/placement/RemoveMember";
import { PLACE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatShortDate } from "@/lib/dates";
import { isUuid } from "@/lib/leaders/errors";
import { loadOfficeTribe, loadTribeRoster } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A tribe" };

type Params = Promise<{ id: string }>;

export default async function TribePage({ params }: { params: Params }) {
  await connection();
  const { id } = await params;
  const session = await requireRole(PLACE_ROLES, "/admin/tribes");
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const view = await loadOfficeTribe(supabase, id);
  if (!view) notFound();
  const roster = await loadTribeRoster(supabase, id);
  const t = view.tribe;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <Link href="/admin/tribes" className="t-small text-soft hover:text-ink">
          <span aria-hidden="true">← </span>Place or move a member
        </Link>
        <PageHead title={t.name}>
          Led by {t.leader} · {t.active} of {t.capacity} seats taken
          {t.window?.started ? ` · ${t.window.name} is in week ${t.window.week ?? 1}; joining ${t.window.open ? "is open" : "closed"} until ${formatShortDate(t.window.closesOn)}` : ""}
        </PageHead>
      </div>

      <section aria-labelledby="members-heading" className="flex flex-col gap-4">
        <h2 id="members-heading" className="t-heading">
          Members
        </h2>
        <div className="card p-5">
          {roster ? (
            <TribeMembers tribe={{ id: t.id, name: t.name }} members={roster.members} empty="Nobody is in this tribe yet." />
          ) : (
            <p className="t-body text-soft" data-testid="tribe-members-unavailable">The members could not be loaded just now. Refresh the page to try again.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-4">
        <h2 id="add-heading" className="t-heading">
          Add a member
        </h2>
        {t.open ? (
          <div className="card flex flex-col gap-3 p-5 sm:p-7">
            <AddToTribe tribe={{ id: t.id, name: t.name }} mode={view.mode} role={view.role} ownerLink={session.god === "open"} />
          </div>
        ) : (
          <p className="card t-body p-5 text-soft" data-testid="tribe-closed">
            This tribe is not open (it is not approved, or its leader is not certified), so nobody can be added to it.
          </p>
        )}
      </section>

      <section aria-labelledby="lately-heading" className="flex flex-col gap-4">
        <h2 id="lately-heading" className="t-heading">
          Placed here lately
        </h2>
        <div className="card p-5">
          <PlacedLately items={view.recent} tribe={t.id} empty="Nobody has been placed or moved here from Admin in the last two weeks." />
        </div>
      </section>

      <section aria-labelledby="removed-heading" className="flex flex-col gap-4">
        <h2 id="removed-heading" className="t-heading">
          Removed here lately
        </h2>
        <div className="card p-5">
          <RemovedLately items={roster?.lately ?? []} empty="Nobody has been taken out of this tribe from Admin in the last 30 days." />
        </div>
      </section>
    </div>
  );
}

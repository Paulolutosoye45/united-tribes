import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmList } from "@/components/admin/referees/ConfirmList";
import { DirectoryBoard, type DirectoryFilter } from "@/components/admin/referees/DirectoryBoard";
import { ImportHistory } from "@/components/admin/referees/ImportHistory";
import { ListUploader } from "@/components/admin/referees/ListUploader";
import { RefereeSettingsForm } from "@/components/admin/referees/RefereeSettings";
import { PageHead } from "@/components/admin/PageHead";
import { REFEREE_MANAGER_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { formatShortDate, plural } from "@/lib/dates";
import { STANDINGS, type Standing } from "@/lib/leaders/referee/labels";
import { isDirectoryState, loadDirectory, loadImportHistory, loadRefereeOverview, loadUnverified } from "@/lib/leaders/referee/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pastors and unit heads" };

type Search = Promise<{ q?: string; who?: string; show?: string; page?: string }>;

export default async function RefereesPage({ searchParams }: { searchParams: Search }) {
  await requireRole(REFEREE_MANAGER_ROLES, "/admin/referees");
  const params = await searchParams;
  const filter: DirectoryFilter = {
    q: (params.q ?? "").trim().slice(0, 80),
    standing: (STANDINGS as readonly string[]).includes(params.who ?? "") ? (params.who as Standing) : null,
    state: isDirectoryState(params.show) ? params.show : "active",
    page: Math.max(1, Math.min(500, Math.floor(Number(params.page) || 1))),
  };

  const supabase = await createClient();
  const [overview, directory, history, unverified] = await Promise.all([
    loadRefereeOverview(supabase),
    loadDirectory(supabase, { search: filter.q, standing: filter.standing, state: filter.state, page: filter.page }),
    loadImportHistory(supabase),
    loadUnverified(supabase),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Pastors and unit heads">
        The church’s own list. When a referee proves they hold a phone number or email on it, the application knows it has the word of a pastor or unit head, and nobody has to tick a box. Applicants never see this list.
      </PageHead>

      {overview && directory ? (
        <>
          <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="referee-overview">
            {[
              { k: "on", label: "On the list", value: overview.directory.active, note: [plural(overview.directory.pastor, "pastor"), plural(overview.directory.unitHead, "unit head"), overview.directory.ministryLeader ? plural(overview.directory.ministryLeader, "ministry leader") : ""].filter(Boolean).join(", ") },
              { k: "updated", label: "Last changed", value: overview.directory.updatedAt ? formatShortDate(overview.directory.updatedAt) : "–", note: overview.directory.retired ? `${plural(overview.directory.retired, "person", "people")} taken off` : "Nobody taken off" },
              { k: "confirm", label: "Waiting for a pastor", value: overview.references.toConfirm, note: "Referees to confirm as a pastor or unit head" },
              { k: "held", label: "Held for a look", value: overview.references.held, note: `${overview.callbacksOpen} call-back${overview.callbacksOpen === 1 ? "" : "s"} to make` },
            ].map((t, i) => (
              <div key={t.k} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
                <dt className="t-small text-soft">{t.label}</dt>
                <dd className="t-figure !text-[clamp(1.6rem,7vw,2.4rem)]" data-testid={`ov-${t.k}`}>
                  {t.value}
                </dd>
                <dd className="t-small text-soft">{t.note}</dd>
              </div>
            ))}
          </dl>

          {overview.callbacksOpen > 0 ? (
            <Link href="/care/referees" className="card press flex flex-col gap-0.5 p-4 hover:bg-surface">
              <span className="font-semibold">
                {overview.callbacksOpen} call-back{overview.callbacksOpen === 1 ? "" : "s"} waiting for the care team
              </span>
              <span className="t-small text-soft">A short call to a referee who was held back or picked at random, to hear them say it was theirs.</span>
            </Link>
          ) : null}

          <ListUploader activeNow={overview.directory.active} />

          <DirectoryBoard rows={directory.rows} total={directory.total} filter={filter} />

          <ImportHistory batches={history} />

          {unverified.total > 0 ? <ConfirmList total={unverified.total} rows={unverified.rows} /> : null}

          <section aria-labelledby="settings-h" className="flex flex-col gap-4">
            <h2 id="settings-h" className="t-heading">
              Settings
            </h2>
            <div className="card p-5 sm:p-7">
              <RefereeSettingsForm settings={overview.settings} />
            </div>
          </section>
        </>
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load this screen. The referee checks’ database changes may not be applied yet. Try again in a moment.</p>
      )}
    </div>
  );
}

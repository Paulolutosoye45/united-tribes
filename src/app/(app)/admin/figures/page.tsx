import type { Metadata } from "next";
import { AcademyStatsPanel } from "@/components/admin/AcademyStats";
import { IntakeStats, type Stats } from "@/components/admin/IntakeStats";
import { LeaderStatsPanel } from "@/components/admin/LeaderStats";
import { PageHead } from "@/components/admin/PageHead";
import { MatchStatsPanel } from "@/components/matching/MatchStats";
import { loadAcademyModes } from "@/lib/academy/server";
import type { AcademyStats } from "@/lib/academy/types";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { LeaderStats } from "@/lib/leaders/review-types";
import type { MatchStats } from "@/lib/matching/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Figures" };

/**
 * The four sets of figures that used to sit at the bottom of the Admin page: the form, leader applications, the Academy, and placement.
 * They moved here so that Today can be about what needs doing; nothing in them changed.
 */
export default async function FiguresPage() {
  await requireRole(OFFICE_ROLES, "/admin/figures");
  const supabase = await createClient();
  const [stats, leaderStats, academyStats, matchStats, academyModes] = await Promise.all([
    supabase.rpc("intake_stats"),
    supabase.rpc("leader_stats"),
    supabase.rpc("academy_stats"),
    supabase.rpc("match_stats"),
    loadAcademyModes(supabase),
  ]);
  const any = Boolean(stats.data || leaderStats.data || academyStats.data || matchStats.data);

  return (
    <div className="flex flex-col gap-12">
      <PageHead title="Figures">The form so far, leader applications, the Leader Academy, and placement. For the season’s results over time, see the dashboard.</PageHead>

      {any ? null : <p className="card t-body p-6 text-soft">We couldn’t load the figures. Try again in a moment.</p>}

      {stats.data ? (
        <section aria-labelledby="form-heading" className="flex flex-col gap-4">
          <h2 id="form-heading" className="t-heading">
            The form so far
          </h2>
          <IntakeStats stats={stats.data as Stats} />
        </section>
      ) : null}
      {leaderStats.data ? (
        <section aria-labelledby="applications-heading" className="flex flex-col gap-4">
          <h2 id="applications-heading" className="t-heading">
            Leader applications
          </h2>
          <LeaderStatsPanel stats={leaderStats.data as LeaderStats} />
        </section>
      ) : null}
      {academyStats.data ? (
        <section aria-labelledby="academy-heading" className="flex flex-col gap-4">
          <h2 id="academy-heading" className="t-heading">
            Leader Academy
          </h2>
          <AcademyStatsPanel stats={academyStats.data as AcademyStats} modes={academyModes} />
        </section>
      ) : null}
      {matchStats.data ? (
        <section aria-labelledby="placement-heading" className="flex flex-col gap-4">
          <h2 id="placement-heading" className="t-heading">
            Matching and placement
          </h2>
          <MatchStatsPanel stats={matchStats.data as MatchStats} />
        </section>
      ) : null}
    </div>
  );
}

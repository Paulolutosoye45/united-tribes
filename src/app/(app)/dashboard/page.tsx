import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { ExportEntrance } from "@/components/exports/ExportEntrance";
import { DASHBOARD_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadDashboard, loadInsight } from "@/lib/dashboard/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<{ season?: string }>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(DASHBOARD_ROLES, "/dashboard");
  const { season } = await searchParams;
  const supabase = await createClient();
  const church = hasAnyRole(session.roles, ["admin", "director", "pastor", "data_lead"]);
  const seasonId = isUuid(season) ? season : null;
  const [d, insight] = await Promise.all([loadDashboard(supabase, seasonId), church ? loadInsight(supabase, seasonId) : Promise.resolve(null)]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Dashboard</h1>
        <p className="t-body measure text-soft">
          {church
            ? "How the programme is doing: how many members are thriving, how far the Success Picture has moved, where people drop away, and where seats are short."
            : "How your tribes are doing, built from your leaders’ logs and the members’ check-ins."}
        </p>
      </header>
      <ExportEntrance packs={["my_tribes_glance", "tribes_health", "supply_demand", "programme_report", "pastorate_one_pager"]} season={seasonId} />
      {d ? <DashboardView d={d} canOpen={hasAnyRole(session.roles, ["pastor", "director", "coach"])} insight={insight} /> : <p className="t-body text-soft">The dashboard could not be loaded. Try again in a moment.</p>}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { HeldList, OverviewTiles } from "@/components/admin/LeaderQualityList";
import { ModeSwitch, Thresholds } from "@/components/admin/LeaderQualityBoard";
import { PageHead } from "@/components/admin/PageHead";
import { providerFromEnv } from "@/lib/ai/suggest";
import { LEADER_QUALITY_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { workerToken } from "@/lib/messaging/worker";
import { isListFilter, readList, readOverview, type ListFilter } from "@/lib/leaders/quality/admin";
import { loadLeaderCatalogue } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Answer checks" };

type Search = Promise<{ list?: string; q?: string; page?: string }>;

export default async function LeaderQualityPage({ searchParams }: { searchParams: Search }) {
  const session = await requireRole(LEADER_QUALITY_ROLES, "/admin/leader-quality");
  const params = await searchParams;
  const filter: ListFilter = isListFilter(params.list) ? params.list : "held";
  const q = (params.q ?? "").slice(0, 80);
  const page = Math.max(1, Math.min(200, Math.floor(Number(params.page) || 1)));

  const supabase = await createClient();
  const [overview, list, catalogue] = await Promise.all([
    supabase.rpc("leader_ai_overview"),
    supabase.rpc("leader_ai_list", { p_filter: filter, p_search: q || null, p_limit: 25, p_offset: (page - 1) * 25 }),
    loadLeaderCatalogue(supabase, { includeRetired: true }),
  ]);
  const names: Record<string, string> = {};
  for (const t of catalogue.tracks) names[t.slug] = t.name;
  for (const c of catalogue.communities) names[c.slug] = c.name;
  const data = readOverview(overview.data);
  const rows = readList(list.data);

  const provider = providerFromEnv();
  const setup = { token: workerToken() !== null, provider: provider?.name ?? null };

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Answer checks">
        The first check on leader applications. It reads the written answers so pastors’ time goes to real applications. It scores, asks the applicant for more, or holds an application for a person. It never turns anyone down: a pastor decides, as always. {" "}
        <Link href="/review" className="font-semibold text-accent underline underline-offset-4">
          Review leaders
        </Link>
      </PageHead>
      {data && rows ? (
        <>
          <OverviewTiles overview={data} />
          <HeldList list={rows} filter={filter} search={q} page={page} names={names} />
          <ModeSwitch overview={data} setup={setup} />
          <Thresholds overview={data} isDirector={session.roles.includes("director")} />
        </>
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load this screen. The first check’s database changes may not be applied yet. Try again in a moment.</p>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { CommunityView } from "@/components/community/CommunityView";
import { ExportEntrance } from "@/components/exports/ExportEntrance";
import { ANNOUNCE_ROLES, COMMUNITY_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadCommunityPage } from "@/lib/dashboard/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My community" };

type SearchParams = Promise<{ community?: string; season?: string }>;

export default async function CommunityPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(COMMUNITY_ROLES, "/community");
  const { community, season } = await searchParams;
  const supabase = await createClient();
  const page = await loadCommunityPage(supabase, isUuid(community) ? community : null, isUuid(season) ? season : null);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">{page?.community ? page.community.name : "My community"}</h1>
        <p className="t-body measure text-soft">
          How your community’s tribes are doing, how many people want a tribe in it and how many seats there are, and what God has done. A rate is hidden for a group too small for it to be private.
        </p>
        {hasAnyRole(session.roles, ANNOUNCE_ROLES) ? (
          <div className="pt-2">
            <Link href="/admin/announcements/new" className={buttonClasses({ variant: "quiet", size: "md" })}>
              <span className="relative">Write to my community</span>
            </Link>
          </div>
        ) : null}
      </header>
      <ExportEntrance packs={["community_report"]} community={page?.community?.id ?? null} season={isUuid(season) ? season : null} />
      {page ? <CommunityView page={page} /> : <p className="t-body text-soft">This page could not be loaded. If you were just appointed a community champion, sign out and in again.</p>}
    </div>
  );
}

import type { Metadata } from "next";
import { CatalogueBoard } from "@/components/admin/CatalogueBoard";
import { PageHead } from "@/components/admin/PageHead";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadAdminCatalogue, loadWriteIns } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Communities and goals" };

type SearchParams = Promise<{ singles?: string }>;

export default async function CataloguePage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(OFFICE_ROLES, "/admin/catalogue");
  const { singles } = await searchParams;
  const showSingles = singles === "1";
  const supabase = await createClient();
  const [catalogue, writeIns] = await Promise.all([loadAdminCatalogue(supabase), loadWriteIns(supabase, showSingles ? 1 : 2)]);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Communities and goals">
        The shared vocabulary of the programme: the communities people belong to, the Season Goals within each, and the age tracks. Review it every season: retire goals nobody picks, and add the ones members keep writing in.
      </PageHead>
      {catalogue ? (
        <CatalogueBoard catalogue={catalogue} writeIns={writeIns ?? []} showSingles={showSingles} />
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load the catalogue. Try again in a moment.</p>
      )}
    </div>
  );
}

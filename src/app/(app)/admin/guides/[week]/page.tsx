import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideForm } from "@/components/admin/GuideForm";
import { PageHead } from "@/components/admin/PageHead";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadGuide } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Weekly guide" };

type Params = Promise<{ week: string }>;

export default async function GuidePage({ params }: { params: Params }) {
  const { week } = await params;
  if (!/^\d{1,2}$/.test(week) || Number(week) < 1 || Number(week) > 12) notFound();
  const n = Number(week);
  await requireRole(OFFICE_ROLES, `/admin/guides/${n}`);
  const supabase = await createClient();
  const guide = await loadGuide(supabase, n);
  if (!guide) notFound();

  return (
    <div className="flex flex-col gap-8">
      <PageHead title={`Week ${n}: ${guide.title}`} back={{ href: "/admin/guides", label: "Weekly guides" }}>
        Edit any part. Tribes read the guide as it stands, so a saved change reaches every tribe at once.
      </PageHead>
      <GuideForm key={n} guide={guide} />
      <nav aria-label="Other weeks" className="flex justify-between gap-4 border-t border-line pt-4">
        {n > 1 ? (
          <Link href={`/admin/guides/${n - 1}`} className="t-body text-soft hover:text-ink">
            <span aria-hidden="true">← </span>Week {n - 1}
          </Link>
        ) : (
          <span />
        )}
        {n < 12 ? (
          <Link href={`/admin/guides/${n + 1}`} className="t-body text-soft hover:text-ink">
            Week {n + 1}
            <span aria-hidden="true"> →</span>
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

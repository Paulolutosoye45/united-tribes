import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { Badge } from "@/components/ui/Badge";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadGuides } from "@/lib/admin/server";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Weekly guides" };

export default async function GuidesPage() {
  await requireRole(OFFICE_ROLES, "/admin/guides");
  const supabase = await createClient();
  const data = await loadGuides(supabase);
  const approved = data?.guides.filter((g) => g.reviewed_at).length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Weekly guides">
        Twelve guides, one for each week of a season. Each has the passage, the questions, the confession and a tip for the leader. When the sermon topic changes, edit one guide and every tribe receives the update. The wording is a draft until the pastorate has read and approved it.
      </PageHead>
      {data ? (
        <>
          <p className="t-body">
            <strong>{approved} of 12</strong> read and approved.{" "}
            <Link href="/admin/guides/layers" className="underline">
              The community and goal layer
            </Link>{" "}
            holds the skill-share prompts and step ideas.
          </p>
          <ol className="stagger flex flex-col gap-3">
            {data.guides.map((g, i) => (
              <li key={g.week} style={{ ["--i" as string]: i }}>
                <Link href={`/admin/guides/${g.week}`} className="card press flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-surface sm:p-5">
                  <span className="flex min-w-0 items-center gap-4">
                    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-strong font-bold">
                      {g.week}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold">
                        <span className="sr-only">Week {g.week}: </span>
                        {g.title}
                      </span>
                      <span className="t-small text-soft">
                        {g.passage}
                        {g.sermon_title ? ` · Sunday: ${g.sermon_title}` : ""}
                      </span>
                    </span>
                  </span>
                  {g.reviewed_at ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <Badge tone="gold">Approved</Badge>
                      <span className="t-small text-soft">
                        {g.reviewed_by ?? "The office"}, {formatShortDate(g.reviewed_at)}
                      </span>
                    </span>
                  ) : (
                    <Badge tone="outline">Draft</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load the guides. Try again in a moment.</p>
      )}
    </div>
  );
}

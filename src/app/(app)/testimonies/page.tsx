import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ForwardTestimony } from "@/components/rhythm/ForwardTestimony";
import { loadChurchSettings } from "@/lib/admin/server";
import { hasAnyRole } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";
import { formatShortDate } from "@/lib/dates";
import { testimonyFormUrl } from "@/lib/env";
import { isUuid } from "@/lib/leaders/errors";
import { loadTestimonyWall } from "@/lib/rhythm/server";
import { TESTIMONY_THEMES, type TestimonyTheme } from "@/lib/rhythm/types";
import { THEME_NAMES } from "@/lib/rhythm/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "What God is doing" };

const PAGE = 12;
type SearchParams = Promise<{ community?: string; theme?: string; page?: string }>;

export default async function TestimoniesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession("/testimonies");
  const { community, theme, page } = await searchParams;
  const communityId = isUuid(community) ? community : null;
  const themeKey = (TESTIMONY_THEMES as readonly string[]).includes(theme ?? "") ? (theme as TestimonyTheme) : null;
  const pageNo = page && /^\d{1,3}$/.test(page) ? Math.max(1, Number(page)) : 1;
  const supabase = await createClient();
  const wall = await loadTestimonyWall(supabase, { community: communityId, theme: themeKey, limit: PAGE, offset: (pageNo - 1) * PAGE });
  const pastorate = hasAnyRole(session.roles, ["pastor", "director"]);
  // The address the office saved in Settings comes first; the environment variable is the fallback for a fresh install.
  const settings = pastorate ? await loadChurchSettings(supabase) : null;
  const formUrl = settings?.testimony_form_url || testimonyFormUrl();

  const link = (next: { community?: string | null; theme?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const t = next.community === undefined ? communityId : next.community;
    const h = next.theme === undefined ? themeKey : next.theme;
    if (t) q.set("community", t);
    if (h) q.set("theme", h);
    if (next.page && next.page > 1) q.set("page", String(next.page));
    const qs = q.toString();
    return qs ? `/testimonies?${qs}` : "/testimonies";
  };

  const chip = (active: boolean) =>
    `press inline-flex min-h-10 items-center rounded-[var(--radius-chip)] border-[1.5px] px-3.5 text-[0.88rem] transition-colors ${
      active ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft"
    }`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">What God is doing</h1>
        <p className="t-body measure text-soft">
          Testimonies from across the church that members chose to share and the pastorate has read. Read one when you need your faith lifted.
        </p>
      </header>

      <section aria-label="Filter the testimonies" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="t-small text-soft">Community</p>
          <div className="flex flex-wrap gap-2">
            <Link href={link({ community: null, page: 1 })} className={chip(!communityId)} aria-current={!communityId ? "true" : undefined}>
              All communities
            </Link>
            {wall.facets.communities.map((t) => (
              <Link key={t.id} href={link({ community: t.id, page: 1 })} className={chip(communityId === t.id)} aria-current={communityId === t.id ? "true" : undefined}>
                {t.name} <span className="ml-1.5 opacity-70">{t.n}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="t-small text-soft">Theme</p>
          <div className="flex flex-wrap gap-2">
            <Link href={link({ theme: null, page: 1 })} className={chip(!themeKey)} aria-current={!themeKey ? "true" : undefined}>
              Any theme
            </Link>
            {wall.facets.themes.map((t) => (
              <Link key={t.theme} href={link({ theme: t.theme, page: 1 })} className={chip(themeKey === t.theme)} aria-current={themeKey === t.theme ? "true" : undefined}>
                {THEME_NAMES[t.theme] ?? t.theme} <span className="ml-1.5 opacity-70">{t.n}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {wall.items.length === 0 ? (
        <p className="t-body text-soft">
          {communityId || themeKey ? "Nothing matches those filters yet." : "No testimonies have been shared with the church yet. They will appear here once the pastorate has read them."}
        </p>
      ) : (
        <ul className="stagger flex flex-col gap-4">
          {wall.items.map((t, i) => (
            <li key={t.id} style={{ ["--i" as string]: Math.min(i, 8) }} className="card flex flex-col gap-3 p-5 sm:p-6">
              <p className="t-body measure whitespace-pre-line text-[1.05rem] leading-relaxed">“{t.body}”</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{t.by}</p>
                <div className="flex flex-wrap gap-1.5">
                  {t.community ? <Badge tone="outline">{t.community}</Badge> : null}
                  {t.themes.map((h) => (
                    <Badge key={h} tone="neutral">
                      {THEME_NAMES[h] ?? h}
                    </Badge>
                  ))}
                  <Badge tone="outline">{formatShortDate(t.at)}</Badge>
                </div>
              </div>
              {pastorate ? <ForwardTestimony id={t.id} forwarded={t.forwarded === true} formUrl={formUrl} /> : null}
            </li>
          ))}
        </ul>
      )}

      {pageNo > 1 || wall.has_more ? (
        <nav aria-label="More testimonies" className="flex items-center justify-between gap-3">
          {pageNo > 1 ? (
            <Link href={link({ page: pageNo - 1 })} className="press rounded-lg px-2 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="t-small text-soft">
            {wall.total} in all
          </span>
          {wall.has_more ? (
            <Link href={link({ page: pageNo + 1 })} className="press rounded-lg px-2 py-2 text-[0.95rem] font-medium text-soft hover:text-ink">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

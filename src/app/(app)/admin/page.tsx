import type { Metadata } from "next";
import Link from "next/link";
import { Checklist } from "@/components/admin/Checklist";
import { IntakeStats, type Stats } from "@/components/admin/IntakeStats";
import { AcademyStatsPanel } from "@/components/admin/AcademyStats";
import { LeaderStatsPanel } from "@/components/admin/LeaderStats";
import { MatchStatsPanel } from "@/components/matching/MatchStats";
import { loadChecklist } from "@/lib/admin/server";
import type { AcademyStats } from "@/lib/academy/types";
import { DATA_ROLES, LEADER_QUALITY_ROLES, MODEL_ROLES, MULTIPLY_ROLES, OFFICE_ROLES, PRIVACY_ROLES, PROGRAMME_ROLES, SWAP_ROLES, TEEN_ROLES, hasAnyRole, type Role } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { LeaderStats } from "@/lib/leaders/review-types";
import type { MatchStats } from "@/lib/matching/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };

type Tile = { href: string; title: string; body: string; roles: readonly Role[] };

const GROUPS: { title: string; tiles: Tile[] }[] = [
  {
    title: "Run the season",
    tiles: [
      { href: "/admin/seasons", title: "Seasons", body: "Plan the next season, open it, run it and close it.", roles: OFFICE_ROLES },
      { href: "/admin/guides", title: "Weekly guides", body: "The twelve guides: passages, questions, the sermon link and the confession.", roles: OFFICE_ROLES },
      { href: "/growth/swaps", title: "Tribe changes", body: "Members asking for a different tribe in the first weeks.", roles: SWAP_ROLES },
      { href: "/growth/multiply", title: "Multiply", body: "What happens to each tribe next season.", roles: MULTIPLY_ROLES },
    ],
  },
  {
    title: "The programme",
    tiles: [
      { href: "/admin/catalogue", title: "Communities and goals", body: "The shared list members and leaders choose from, and the goals members write in.", roles: OFFICE_ROLES },
      { href: "/admin/champions", title: "Community champions", body: "Who looks after each community.", roles: OFFICE_ROLES },
      { href: "/admin/leader-quality", title: "Leader quality", body: "The first check on leader applications: the switch, the thresholds and the applications held for a person.", roles: LEADER_QUALITY_ROLES },
      { href: "/admin/people", title: "People and roles", body: "Invite the team and see who holds each role.", roles: PROGRAMME_ROLES },
      { href: "/care/teens", title: "Young people", body: "Parent and guardian permission, and the call that confirms it.", roles: TEEN_ROLES },
      { href: "/admin/privacy", title: "Data requests", body: "Members who ask for their account and everything in it to be deleted.", roles: PRIVACY_ROLES },
    ],
  },
  {
    title: "Measure",
    tiles: [
      { href: "/admin/targets", title: "Targets", body: "The numbers every dashboard and report is measured against.", roles: OFFICE_ROLES },
      { href: "/growth/model", title: "Matching model", body: "The weights, and what the results suggest changing.", roles: MODEL_ROLES },
    ],
  },
  {
    title: "System",
    tiles: [
      { href: "/admin/settings", title: "Settings", body: "The church’s vision and mission, the testimony form, and the platform switches.", roles: OFFICE_ROLES },
      { href: "/admin/system", title: "Sending and reporting", body: "The sending service, and the copy your reporting tool reads.", roles: DATA_ROLES },
      { href: "/admin/messages", title: "Message log", body: "Every message queued, and what became of it.", roles: DATA_ROLES },
    ],
  },
];

export default async function AdminPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin");
  const supabase = await createClient();

  const [checklist, stats, leaderStats, academyStats, matchStats] = await Promise.all([
    loadChecklist(supabase),
    supabase.rpc("intake_stats"),
    supabase.rpc("leader_stats"),
    supabase.rpc("academy_stats"),
    supabase.rpc("match_stats"),
  ]);

  const groups = GROUPS.map((g) => ({ ...g, tiles: g.tiles.filter((t) => hasAnyRole(session.roles, t.roles)) })).filter((g) => g.tiles.length > 0);
  const glance = Boolean(stats.data || leaderStats.data || academyStats.data || matchStats.data);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Admin</h1>
        <p className="t-body measure text-soft">Everything the office needs to run United Tribes: the season, the guides, the catalogue, the targets and the system behind them.</p>
      </header>

      {checklist ? <Checklist checklist={checklist} roles={session.roles} /> : null}

      {groups.map((g) => {
        const id = `group-${g.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
        return (
          <section key={g.title} aria-labelledby={id} className="flex flex-col gap-4">
            <h2 id={id} className="t-heading">
              {g.title}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {g.tiles.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className="card press flex h-full flex-col gap-0.5 p-4 hover:bg-surface">
                    <span className="font-semibold">{t.title}</span>
                    <span className="t-small text-soft">{t.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {glance ? (
        <section aria-labelledby="glance-heading" className="flex flex-col gap-12">
          <h2 id="glance-heading" className="t-heading">
            At a glance
          </h2>
          {stats.data ? (
            <div className="flex flex-col gap-4">
              <h3 className="font-semibold">The form so far</h3>
              <IntakeStats stats={stats.data as Stats} />
            </div>
          ) : null}
          {leaderStats.data ? (
            <div className="flex flex-col gap-4">
              <h3 className="font-semibold">Leader applications</h3>
              <LeaderStatsPanel stats={leaderStats.data as LeaderStats} />
            </div>
          ) : null}
          {academyStats.data ? (
            <div className="flex flex-col gap-4">
              <h3 className="font-semibold">Leader Academy</h3>
              <AcademyStatsPanel stats={academyStats.data as AcademyStats} />
            </div>
          ) : null}
          {matchStats.data ? (
            <div className="flex flex-col gap-4">
              <h3 className="font-semibold">Matching and placement</h3>
              <MatchStatsPanel stats={matchStats.data as MatchStats} />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

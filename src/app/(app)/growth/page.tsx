import type { Metadata } from "next";
import Link from "next/link";
import { GROWTH_ROLES, MODEL_ROLES, MULTIPLY_ROLES, REMOVAL_ROLES, SWAP_ROLES, TEEN_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadRemovalBoard } from "@/lib/removal/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Growth" };

const TOOLS = [
  {
    href: "/growth/swaps",
    title: "Tribe changes",
    body: "Members who would like a different tribe in the first weeks of a season. Offer one that fits.",
    roles: SWAP_ROLES,
  },
  {
    href: "/growth/multiply",
    title: "Multiply",
    body: "Decide what happens to each tribe next season, and see where new tribes are most needed.",
    roles: MULTIPLY_ROLES,
  },
  {
    href: "/growth/model",
    title: "Matching model",
    body: "How much each part of a member's answers counts toward a match, and what the results suggest changing.",
    roles: MODEL_ROLES,
  },
  {
    href: "/growth/removals",
    title: "Removal requests",
    body: "A leader asking the church about a member's place in their tribe. A person with the right to decide does; silence never removes anyone.",
    roles: REMOVAL_ROLES,
  },
  {
    href: "/care/teens",
    title: "Young people",
    body: "Parent and guardian permission for members aged 13 to 17, and the call that confirms it.",
    roles: TEEN_ROLES,
  },
] as const;

export default async function GrowthPage() {
  const session = await requireRole(GROWTH_ROLES, "/growth");
  // The removal tile appears only once the church has opened leader removal requests (Rehearsal or On); until then the page is as it was
  const removalOpen = hasAnyRole(session.roles, REMOVAL_ROLES) ? (await loadRemovalBoard(await createClient())).state !== "off" : false;
  const tools = TOOLS.filter((t) => hasAnyRole(session.roles, t.roles) && (t.href !== "/growth/removals" || removalOpen));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Growth</h1>
        <p className="t-body measure text-soft">The tools that help the programme learn from each season and grow into the next.</p>
      </header>
      <ul className="stagger grid gap-4 sm:grid-cols-2">
        {tools.map((t, i) => (
          <li key={t.href} style={{ ["--i" as string]: i }}>
            <Link href={t.href} className="card press flex h-full flex-col gap-1.5 p-5 hover:bg-surface">
              <span className="t-heading">{t.title}</span>
              <span className="t-body text-soft">{t.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

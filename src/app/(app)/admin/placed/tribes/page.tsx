import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { PlacedTabs } from "@/components/placed/PlacedTabs";
import { Badge } from "@/components/ui/Badge";
import { PLACED_BOARD_ROLES, PLACED_DESK_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { BOARD_WORDS as W } from "@/lib/placement/answers";
import { loadBoardTribes } from "@/lib/placement/answers-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Placed members by tribe" };

/** Which tribes still have the most people waiting, with the leader to speak to, and which tribes are thin (fewer than five who have said yes). Names of tribes and leaders; no member and no number. */
export default async function PlacedTribesPage() {
  const session = await requireRole(PLACED_BOARD_ROLES, "/admin/placed/tribes");
  const tribes = await loadBoardTribes(await createClient());
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Placed members" back={{ href: "/admin/placed", label: "Placed members" }}>{W.tribesHelp}</PageHead>
      <PlacedTabs current="tribes" canDesk={hasAnyRole(session.roles, PLACED_DESK_ROLES)} />
      <h2 className="t-heading">{W.tribesTitle}</h2>
      {tribes.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="tribes-empty">No one has been placed yet this season.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left" data-testid="tribes-table">
            <caption className="sr-only">Placed members by tribe</caption>
            <thead>
              <tr className="t-small border-b border-line text-soft">
                <th scope="col" className="px-4 py-3 font-medium">Tribe</th>
                <th scope="col" className="px-4 py-3 font-medium">Leader</th>
                <th scope="col" className="px-4 py-3 font-medium">Placed</th>
                <th scope="col" className="px-4 py-3 font-medium">Waiting</th>
                <th scope="col" className="px-4 py-3 font-medium">Said yes</th>
                <th scope="col" className="px-4 py-3 font-medium">Not this season</th>
                <th scope="col" className="px-4 py-3 font-medium">Another tribe</th>
                <th scope="col" className="px-4 py-3 font-medium">Asked for a call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tribes.map((t) => (
                <tr key={t.tribe} className="align-top" data-thin={t.thin ? "true" : "false"}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/placed?tribe=${t.tribe}`} className="font-medium underline">{t.name}</Link>
                    {t.community ? <p className="t-small text-soft">{t.community}</p> : null}
                    {t.thin ? <Badge tone="flame" className="mt-1">{W.thin}</Badge> : null}
                  </td>
                  <td className="px-4 py-3">{t.leader ?? "–"}</td>
                  <td className="px-4 py-3 tabular-nums">{t.placed}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{t.waiting}</td>
                  <td className="px-4 py-3 tabular-nums">{t.yes}</td>
                  <td className="px-4 py-3 tabular-nums">{t.notSeason}</td>
                  <td className="px-4 py-3 tabular-nums">{t.otherTribe}</td>
                  <td className="px-4 py-3 tabular-nums">{t.asked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

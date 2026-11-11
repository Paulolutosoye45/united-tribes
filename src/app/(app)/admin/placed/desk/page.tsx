import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/admin/PageHead";
import { DeskCard } from "@/components/placed/PlacedControls";
import { PlacedTabs } from "@/components/placed/PlacedTabs";
import { buttonClasses } from "@/components/ui/Button";
import { PLACED_BOARD_ROLES, PLACED_DESK_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { DESK_WORDS as D } from "@/lib/placement/answers";
import { loadDeskList } from "@/lib/placement/answers-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Call desk" };

/**
 * The call desk: the members to phone, and nobody else. Two lists: those who asked for a call, oldest first, and those worth a call (placed, with a number, no
 * answer yet, and told by email that the office may call). A number shows only when Show number is pressed, and every press is written down without the number.
 * An admin and a director use it; a pastor sees the board only.
 */
export default async function PlacedDeskPage() {
  const session = await requireRole(PLACED_BOARD_ROLES, "/admin/placed/desk");
  const canDesk = hasAnyRole(session.roles, PLACED_DESK_ROLES);
  const desk = canDesk ? await loadDeskList(await createClient()) : null;
  return (
    <div className="flex flex-col gap-8">
      <PageHead title={D.title} back={{ href: "/admin/placed", label: "Placed members" }}>{D.intro}</PageHead>
      <PlacedTabs current="desk" canDesk={canDesk} />
      {!canDesk ? (
        <p className="card t-body p-6 text-soft" data-testid="desk-readonly">{D.pastorNote}</p>
      ) : !desk ? (
        <p className="card t-body p-6 text-soft" role="alert" data-testid="desk-unavailable">The call desk is not available right now. Reload the page.</p>
      ) : (
        <>
          <p className="t-small text-soft" data-testid="desk-hours">{D.hours}{desk.callsOk ? "" : " It is outside those hours now, so numbers are hidden."}</p>

          <section aria-labelledby="asked-h" className="flex flex-col gap-3" data-testid="desk-asked">
            <div className="flex flex-col gap-1">
              <h2 id="asked-h" className="t-heading">{D.askedTitle} ({desk.asked.length})</h2>
              <p className="t-small text-soft">{D.askedHelp}</p>
            </div>
            {desk.asked.length === 0 ? (
              <p className="card t-body p-5 text-soft">{D.emptyAsked}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {desk.asked.map((r) => (
                  <DeskCard key={r.tm} row={r} maxTries={desk.maxTries} callsOk={desk.callsOk} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="worth-h" className="flex flex-col gap-3" data-testid="desk-worth">
            <div className="flex flex-col gap-1">
              <h2 id="worth-h" className="t-heading">{D.worthTitle} ({desk.worth.length})</h2>
              <p className="t-small text-soft">{D.worthHelp}</p>
            </div>
            {desk.worth.length === 0 ? (
              <p className="card t-body p-5 text-soft">{D.emptyWorth}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {desk.worth.map((r) => (
                  <DeskCard key={r.tm} row={r} maxTries={desk.maxTries} callsOk={desk.callsOk} />
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="dl-h" className="flex flex-col gap-2" data-testid="desk-download">
            <h2 id="dl-h" className="t-heading">{D.download}</h2>
            {desk.download ? (
              <>
                <p className="t-small max-w-[64ch] text-soft">{D.downloadNote}</p>
                <div>
                  <Link href="/admin/placed/desk/download" prefetch={false} className={buttonClasses({ variant: "quiet", size: "md" })} data-testid="desk-download-link">
                    {D.download}
                  </Link>
                </div>
              </>
            ) : (
              <p className="t-small max-w-[64ch] text-soft" data-testid="desk-download-off">{D.downloadOff}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

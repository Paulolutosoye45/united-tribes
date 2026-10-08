import type { Metadata } from "next";
import { PanelTabs } from "@/components/leaders/PanelTabs";
import { FollowUpList, type FollowUpRow } from "@/components/rhythm/FollowUpList";
import { RhythmDigest } from "@/components/rhythm/RhythmDigest";
import { TestimonyReview } from "@/components/rhythm/TestimonyReview";
import { REVIEW_ROLES, RHYTHM_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { plural } from "@/lib/dates";
import { loadCareQueue, loadDigest, loadPendingTestimonies } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Weekly report" };

type SearchParams = Promise<{ week?: string }>;

export default async function RhythmPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(RHYTHM_ROLES, "/review/rhythm");
  const { week } = await searchParams;
  const supabase = await createClient();
  const wk = week && /^\d{1,2}$/.test(week) ? Number(week) : null;

  const seesCircles = hasAnyRole(session.roles, ["pastor", "director", "coach", "admin", "data_lead"]);
  const seesCare = hasAnyRole(session.roles, ["care_lead", "pastor", "director", "admin"]);
  const seesChurch = hasAnyRole(session.roles, ["pastor", "director"]);
  const canOpen = hasAnyRole(session.roles, ["pastor", "director", "coach"]);

  const [digest, care, testimonies] = await Promise.all([
    seesCircles ? loadDigest(supabase, wk) : Promise.resolve(null),
    seesCare ? loadCareQueue(supabase) : Promise.resolve(null),
    seesChurch ? loadPendingTestimonies(supabase) : Promise.resolve(null),
  ]);

  const caller = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "the care team";
  const rows: FollowUpRow[] = (care?.items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    firstName: i.name.split(" ")[0] ?? i.name,
    whatsapp: i.whatsapp,
    kind: i.kind,
    status: i.status,
    attempts: i.attempts,
    lastOutcome: i.last_outcome,
    note: i.note,
    openedAt: i.opened_at,
    circle: i.circle,
    caller,
    leader: i.leader,
  }));

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Weekly report</h1>
          <p className="t-body measure text-soft">
            How every circle’s week went, built from the leaders’ two-minute logs, the members’ steps and the three check-ins. Nothing a member writes privately appears here.
          </p>
        </div>
        {hasAnyRole(session.roles, REVIEW_ROLES) ? <PanelTabs /> : null}
      </header>

      {digest ? <RhythmDigest digest={digest} canOpen={canOpen} /> : null}

      {seesCare ? (
        <section id="care" aria-labelledby="care-heading" className="flex scroll-mt-24 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="care-heading" className="t-heading">
              Care queue
            </h2>
            <p className="t-small text-soft">
              {care ? `${plural(care.open_total, "follow-up")} open across all circles. Here are the ones a leader passed to the care team, and any that have waited more than three days.` : "Not available."}
            </p>
          </div>
          <FollowUpList rows={rows} canAct emptyText="Nothing is waiting for the care team." />
        </section>
      ) : null}

      {seesChurch ? (
        <section id="church" aria-labelledby="church-heading" className="flex scroll-mt-24 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="church-heading" className="t-heading">
              Testimonies for the church
            </h2>
            <p className="t-small text-soft">Members who asked for the whole church to read theirs. A pastor approves them after the leader has read them.</p>
          </div>
          <TestimonyReview items={testimonies?.church ?? []} scope="church" emptyText="No testimonies are waiting." />
        </section>
      ) : null}
    </div>
  );
}

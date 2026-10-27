import type { Metadata } from "next";
import { ReviewTabs } from "@/components/leaders/ReviewTabs";
import { ReviewQueue } from "@/components/leaders/ReviewQueue";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { plural } from "@/lib/dates";
import type { LeaderStats, QueueAi, QueueItem } from "@/lib/leaders/review-types";
import { loadLeaderCatalogue } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review leaders" };

export default async function ReviewPage() {
  await requireRole(REVIEW_ROLES, "/review");
  const supabase = await createClient();
  const [queue, stats, catalogue, aiQueue, aiConfig] = await Promise.all([
    supabase.rpc("review_queue"),
    supabase.rpc("leader_stats"),
    loadLeaderCatalogue(supabase, { includeRetired: true }),
    supabase.rpc("leader_ai_queue"),
    supabase.rpc("leader_ai_public_config"),
  ]);

  // The first check's state for each application. Extra information: if it cannot be read, the queue is as before.
  const firstCheckOn = (aiConfig.data as { mode?: string } | null)?.mode === "on";
  const ai: Record<string, QueueAi> = {};
  for (const row of (aiQueue.data as QueueAi[] | null) ?? []) ai[row.id] = row;

  const items = (queue.data as QueueItem[] | null) ?? [];
  const s = stats.data as LeaderStats | null;
  const names: Record<string, string> = {};
  for (const t of catalogue.tracks) names[t.slug] = t.name;
  for (const t of catalogue.communities) names[t.slug] = t.name;

  const tiles = s
    ? [
        { label: "In review", value: String(s.in_review), note: plural(s.submitted, "application") + " sent" },
        { label: "Interviews booked", value: String(s.interviews_booked), note: `${s.open_slots} open ${s.open_slots === 1 ? "time" : "times"}` },
        { label: "Approved", value: String(s.approved_leaders + s.approved_assistants), note: `${s.approved_leaders} leaders, ${s.approved_assistants} assistants` },
        { label: "Typical wait", value: s.median_days_to_decision === null ? "–" : String(s.median_days_to_decision), note: "days to a decision" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Review leaders</h1>
          <p className="t-body measure text-soft">
            Read each application, score what you read, and see your colleagues’ scores once you have submitted yours. Only a pastor makes the final decision.
          </p>
        </div>
        <ReviewTabs />
      </header>

      {tiles.length > 0 ? (
        <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t, i) => (
            <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
              <dt className="t-small text-soft">{t.label}</dt>
              <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
              <dd className="t-small text-soft">{t.note}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <ReviewQueue items={items} names={names} ai={ai} firstCheckOn={firstCheckOn} />
    </div>
  );
}

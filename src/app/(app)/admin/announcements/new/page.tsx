import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { Composer } from "@/components/outreach/Composer";
import { ANNOUNCE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadContactGapsOn } from "@/lib/contact-gaps/server";
import { loadNudgeState } from "@/lib/placement/nudge-server";
import { loadAnnounceContext } from "@/lib/outreach/server";
import type { AudienceSpec } from "@/lib/outreach/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Write an announcement" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewAnnouncementPage({ searchParams }: { searchParams: Promise<{ audience?: string; cause?: string; tribe?: string; community?: string; need?: string }> }) {
  const session = await requireRole(ANNOUNCE_ROLES, "/admin/announcements/new");
  const q = await searchParams;
  const supabase = await createClient();
  const [ctx, reach, nudge] = await Promise.all([loadAnnounceContext(supabase, session), loadContactGapsOn(supabase), loadNudgeState(supabase)]);
  // The Contact gaps page opens the composer already pointed at the people it lists. Anything else, or while the function is Off, starts as it always did.
  const start: AudienceSpec | null =
    nudge !== "off" && q.audience === "placed_waiting"
      ? {
          kind: "placed_waiting",
          need: q.need === "gap" ? "gap" : "all",
          ...(q.tribe && UUID.test(q.tribe) ? { tribe: q.tribe } : {}),
          ...(q.community && UUID.test(q.community) ? { community: q.community } : {}),
        }
      : reach && q.audience === "cannot_reach"
      ? {
          kind: "cannot_reach",
          cause: q.cause === "no_number" || q.cause === "no_yes" ? q.cause : "either",
          ...(q.tribe && UUID.test(q.tribe) ? { tribe: q.tribe } : {}),
          ...(q.community && UUID.test(q.community) ? { community: q.community } : {}),
        }
      : null;
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Write an announcement" back={{ href: "/admin/announcements", label: "Announcements" }}>
        Choose who it is for, write it, see it as they will read it, and send it. Everything is counted from live records.
      </PageHead>
      <Composer
        initial={null}
        saved={ctx.saved}
        communities={ctx.communities}
        champion={ctx.champion}
        site={ctx.site}
        church={ctx.church}
        threshold={ctx.threshold}
        perMinute={ctx.perMinute}
        hours={ctx.hours}
        reach={reach}
        nudge={nudge}
        start={start}
      />
    </div>
  );
}

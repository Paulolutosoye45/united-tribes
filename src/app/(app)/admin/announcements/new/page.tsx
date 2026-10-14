import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { Composer } from "@/components/outreach/Composer";
import { ANNOUNCE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadAnnounceContext } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Write an announcement" };

export default async function NewAnnouncementPage() {
  const session = await requireRole(ANNOUNCE_ROLES, "/admin/announcements/new");
  const supabase = await createClient();
  const ctx = await loadAnnounceContext(supabase, session);
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
      />
    </div>
  );
}

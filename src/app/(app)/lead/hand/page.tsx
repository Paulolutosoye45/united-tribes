import type { Metadata } from "next";
import Link from "next/link";
import { SendByHand } from "@/components/rhythm/SendByHand";
import { buttonClasses } from "@/components/ui/Button";
import { loadMyTribe } from "@/lib/academy/server";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { clock, dayName } from "@/lib/messaging/format";
import { siteUrl } from "@/lib/messaging/worker";
import { loadTribeWeek } from "@/lib/rhythm/server";
import { isLockedGuide } from "@/lib/rhythm/types";
import { createClient } from "@/lib/supabase/server";
import { loadHandContext } from "@/lib/whatsapp/mode-server";

export const metadata: Metadata = { title: "Send by WhatsApp" };

type SearchParams = Promise<{ tribe?: string }>;

export default async function LeadHandPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(["leader", "assistant_leader", "coach", "pastor", "director", "admin", "care_lead"], "/lead/hand");
  const { tribe } = await searchParams;
  const supabase = await createClient();
  const own = await loadMyTribe(supabase);
  const tribeId = isUuid(tribe) ? tribe : own?.id;
  const ctx = tribeId ? await loadHandContext(supabase, tribeId) : null;

  // While WhatsApp mode is Off in God Mode there is no such page, and a person who leads nothing has nothing to send to.
  if (!tribeId || !ctx || ctx.state === "off") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="t-title">Send by WhatsApp</h1>
        <p className="t-body measure text-soft" data-testid="hand-none">
          {!tribeId ? "This page opens once you lead a tribe." : "This page is not switched on yet."}
        </p>
        <div>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Back to Lead</span>
          </Link>
        </div>
      </div>
    );
  }

  const cw = await loadTribeWeek(supabase, tribeId, null);
  // The week asked for here is the current one, which is always open; a week that has not opened would have nothing to send
  const guide = cw && !isLockedGuide(cw.guide) ? cw.guide : null;
  const week = {
    week: cw?.state === "running" ? cw.week : null,
    title: guide?.title ?? "",
    passage: guide?.passage ?? "",
    bigIdea: guide?.big_idea ?? "",
    tribe: ctx.tribe.name,
    meetingDay: cw ? dayName(cw.tribe.meeting_day) : "",
    meetingTime: cw ? clock(cw.tribe.meeting_time) : "",
    leaderFirst: session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "your leader",
    site: siteUrl(process.env),
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="t-title">Send by WhatsApp</h1>
        <p className="t-body measure text-soft">
          Words for your tribe&rsquo;s group and for the members you lead, ready to send from your own WhatsApp. {ctx.tribe.name}.
        </p>
      </div>
      <SendByHand ctx={ctx} week={week} />
      <div>
        <Link href="/lead/week" className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Back to This week</span>
        </Link>
      </div>
    </div>
  );
}

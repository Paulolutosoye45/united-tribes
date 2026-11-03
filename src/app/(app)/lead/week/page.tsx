import type { Metadata } from "next";
import Link from "next/link";
import { LeaderWeek } from "@/components/rhythm/LeaderWeek";
import { buttonClasses } from "@/components/ui/Button";
import { loadMyTribe } from "@/lib/academy/server";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { loadTribeWeek, loadLogExtras, loadMyCareTasks, loadPendingTestimonies, loadWeekLayer } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";
import { loadHandContext } from "@/lib/whatsapp/mode-server";

export const metadata: Metadata = { title: "This week" };

type SearchParams = Promise<{ tribe?: string; week?: string }>;

export default async function LeadWeekPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(["leader", "assistant_leader", "coach", "pastor", "director"], "/lead/week");
  const { tribe, week } = await searchParams;
  const supabase = await createClient();

  const own = await loadMyTribe(supabase);
  const tribeId = isUuid(tribe) ? tribe : own?.id;
  const wk = week && /^\d{1,2}$/.test(week) ? Number(week) : null;

  const [cw, pending, layer, extras, care, hand] = tribeId
    ? await Promise.all([
        loadTribeWeek(supabase, tribeId, wk),
        loadPendingTestimonies(supabase),
        loadWeekLayer(supabase, tribeId, wk),
        loadLogExtras(supabase, tribeId, wk),
        loadMyCareTasks(supabase),
        loadHandContext(supabase, tribeId),
      ])
    : [null, null, null, null, null, null];

  if (!tribeId || !cw) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="t-title">This week</h1>
        <p className="t-body measure text-soft">
          {tribeId ? "We could not open that tribe. You may not have access to it." : "Your weekly page opens once your Tribe Card is approved and members have joined."}
        </p>
        <div>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Back to Lead</span>
          </Link>
        </div>
      </div>
    );
  }

  const callerFirst = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "your leader";
  const base = tribe && isUuid(tribe) ? `/lead/week?tribe=${tribe}` : "/lead/week";
  const mine = (pending?.tribe ?? []).filter((t) => t.tribe === cw.tribe.name);

  return <LeaderWeek week={cw} callerFirst={callerFirst} pending={mine} base={base} layer={layer} extras={extras} careOpen={care?.mine.length ?? 0} handOpen={Boolean(hand && hand.state !== "off")} />;
}

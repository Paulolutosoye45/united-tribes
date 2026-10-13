import type { Metadata } from "next";
import { SwapQueue } from "@/components/growth/SwapQueue";
import { SWAP_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadSwapMembers, loadSwapQueue } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tribe changes" };

export default async function SwapsPage() {
  const session = await requireRole(SWAP_ROLES, "/growth/swaps");
  const supabase = await createClient();
  // A coach starts from a short list of their own members; the office looks someone up by name.
  const office = hasAnyRole(session.roles, ["admin", "director", "care_lead"]);
  const [queue, members] = await Promise.all([loadSwapQueue(supabase), office ? Promise.resolve([]) : loadSwapMembers(supabase)]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Tribe changes</h1>
        <p className="t-body measure text-soft">
          A member who is not at home in their tribe can ask to move during the first {queue?.weeks ?? 4} weeks of a season. Their reason is seen only here, never by
          their leader. Offer a tribe that still fits, and they decide. A member moves only when they say yes.
        </p>
      </header>
      {queue ? <SwapQueue queue={queue} initialMembers={members} office={office} /> : <p className="t-body text-soft">We couldn&rsquo;t load the requests just now. Try again in a moment.</p>}
    </div>
  );
}

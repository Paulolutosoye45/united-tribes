import type { Metadata } from "next";
import { TeenDesk } from "@/components/care/TeenDesk";
import { TEEN_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadGuardianOverview } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Young people" };

export default async function TeensPage() {
  await requireRole(TEEN_ROLES, "/care/teens");
  const supabase = await createClient();
  const overview = await loadGuardianOverview(supabase);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Young people</h1>
        <p className="t-body measure text-soft">
          A young person aged 13 to 17 can be placed in a tribe only after their parent or guardian has said yes from a private link, and someone from the Care Team has
          phoned that parent or guardian to check it was really them. This is where that happens.
        </p>
      </header>
      {overview ? <TeenDesk overview={overview} /> : <p className="t-body text-soft">We couldn&rsquo;t load this just now. Try again in a moment.</p>}
    </div>
  );
}

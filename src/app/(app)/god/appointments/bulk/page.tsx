import type { Metadata } from "next";
import { connection } from "next/server";
import { AppointTabs } from "@/components/god/AppointTabs";
import { BulkLeaders } from "@/components/god/BulkLeaders";
import { loadLeadersView } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appoint leaders in bulk" };

export default async function GodBulkAppointmentsPage() {
  await connection();
  const supabase = await createClient();
  const view = await loadLeadersView(supabase);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Appointments</h1>
        <p className="t-body measure text-soft">
          Appoint many leaders at once. Each is paired with a goal that needs a leader and their Tribe Card is started. A pastor still approves every card and the Academy still certifies every leader.
        </p>
      </header>
      <AppointTabs current="bulk" />
      {view ? <BulkLeaders view={view} /> : <p className="card t-body p-5 text-soft">This page is not available right now. Reload it, or unlock the console again.</p>}
    </div>
  );
}

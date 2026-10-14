import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { ReminderBoard } from "@/components/outreach/ReminderBoard";
import { REMINDER_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadReminders } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Automatic reminders" };

export default async function RemindersPage() {
  await requireRole(REMINDER_ROLES, "/admin/reminders");
  const supabase = await createClient();
  const o = await loadReminders(supabase);
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Automatic reminders" back={{ href: "/admin/announcements", label: "Announcements" }}>
        Four journeys that gently bring people back: the form they left, the leader application they started, the tribe they have not chosen, and the first weeks in a tribe.
        Each starts in rehearsal, so you can read exactly what it would send before anyone gets anything.
      </PageHead>
      {o ? <ReminderBoard o={o} /> : <p className="card t-body p-6 text-soft">We couldn’t load this screen. The reminders database changes may not be applied yet. Try again in a moment.</p>}
    </div>
  );
}

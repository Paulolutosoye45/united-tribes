import type { Metadata } from "next";
import { connection } from "next/server";
import { AppointBoard } from "@/components/god/AppointBoard";
import { AppointTabs } from "@/components/god/AppointTabs";
import { parseAppointments } from "@/lib/god/appointments";
import { loadChooseData } from "@/lib/god/goal-unlock-server";
import { loadLeaderCatalogue } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointments" };

export default async function GodAppointmentsPage() {
  await connection();
  const supabase = await createClient();
  const [catalogue, list] = await Promise.all([loadLeaderCatalogue(supabase), supabase.rpc("god_appointment_list")]);

  const appointments = list.error ? [] : parseAppointments(list.data);
  // The state of each leader's goal lock. Null (and nothing extra shown) if the database cannot say.
  const choose = await loadChooseData(supabase, appointments.flatMap((a) => (a.active && a.tribe ? [a.tribe.id] : [])));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Appointments</h1>
        <p className="t-body measure text-soft">
          Appoint someone to lead a tribe without an application. It gives them the leader role and starts their Tribe Card. A pastor still approves the card and the Academy still certifies them, so members see nothing until both are done.
        </p>
      </header>
      <AppointTabs current="one" />
      <AppointBoard
        tracks={catalogue.tracks.map((t) => ({ slug: t.slug, name: t.name, ages: t.ages }))}
        communities={catalogue.communities.map((c) => ({ slug: c.slug, name: c.name, goals: c.goals.map((g) => ({ slug: g.slug, title: g.title })) }))}
        appointments={appointments}
        choose={choose}
      />
    </div>
  );
}

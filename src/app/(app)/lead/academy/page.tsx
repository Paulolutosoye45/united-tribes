import type { Metadata } from "next";
import Link from "next/link";
import { Checklist } from "@/components/academy/Checklist";
import { ModuleGrid } from "@/components/academy/ModuleGrid";
import { PracticeCard } from "@/components/academy/PracticeCard";
import { TrainingHero } from "@/components/academy/TrainingHero";
import { Workshops } from "@/components/academy/Workshops";
import { requireRole } from "@/lib/auth/session";
import { loadMyAcademy } from "@/lib/academy/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader Academy" };

export default async function AcademyPage() {
  await requireRole(["leader", "assistant_leader"], "/lead/academy");
  const supabase = await createClient();
  const my = await loadMyAcademy(supabase);
  if (!my) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="t-title">Leader Academy</h1>
        <p className="t-body measure text-soft">We couldn’t load your training. Check your connection and refresh.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Link href="/lead" className="press -mb-4 -ml-1 w-fit rounded-lg px-1 py-1 text-[0.95rem] font-medium text-soft hover:text-ink">
        ← Lead a circle
      </Link>
      <TrainingHero my={my} />
      <div className="grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <Checklist my={my} />
        <PracticeCard my={my} />
      </div>
      <ModuleGrid modules={my.modules} />
      <Workshops sessions={my.sessions} attended={my.attended} />
    </div>
  );
}

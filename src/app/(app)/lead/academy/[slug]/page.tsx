import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleView } from "@/components/academy/ModuleView";
import Link from "next/link";
import { SwitchedOff } from "@/components/academy/SwitchedOff";
import { loadAcademyModes } from "@/lib/academy/server";
import { REVIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { ModuleDetail } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader Academy module" };

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireRole(["leader", "assistant_leader", ...REVIEW_ROLES, "admin"], `/lead/academy/${slug}`);
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) notFound();
  const supabase = await createClient();
  // While the Academy is off the modules are closed to leaders. The panel and administrators can still read them (the database says the same).
  const modes = await loadAcademyModes(supabase);
  if (modes.academy === "off" && !hasAnyRole(session.roles, [...REVIEW_ROLES, "admin"])) {
    return (
      <div className="flex flex-col gap-8">
        <Link href="/lead/academy" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Training
        </Link>
        <SwitchedOff title="The Academy is switched off" since={modes.academySince}>
          The modules are closed for now, and certification does not need them. Anything you have already done is kept.
        </SwitchedOff>
      </div>
    );
  }
  const { data, error } = await supabase.rpc("academy_module", { p_slug: slug });
  if (error || !data) notFound();
  return <ModuleView detail={data as ModuleDetail} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleView } from "@/components/academy/ModuleView";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { ModuleDetail } from "@/lib/academy/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader Academy module" };

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireRole(["leader", "assistant_leader", ...REVIEW_ROLES, "admin"], `/lead/academy/${slug}`);
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academy_module", { p_slug: slug });
  if (error || !data) notFound();
  return <ModuleView detail={data as ModuleDetail} />;
}

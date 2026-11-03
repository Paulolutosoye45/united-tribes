import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/PageHead";
import { WhatsAppCost } from "@/components/admin/WhatsAppCost";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadWhatsappCost } from "@/lib/whatsapp/mode-server";

export const metadata: Metadata = { title: "WhatsApp cost" };

export default async function WhatsAppCostPage() {
  await requireRole(OFFICE_ROLES, "/admin/messages/whatsapp-cost");
  const supabase = await createClient();
  const view = await loadWhatsappCost(supabase);
  if (!view || view.state === "off") notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="WhatsApp cost" back={{ href: "/admin/messages/whatsapp-mode", label: "WhatsApp mode" }}>
        What WhatsApp has cost, by message, and what Saver or Free would have saved. An estimate from the rates the church entered.
      </PageHead>
      <WhatsAppCost view={view} />
    </div>
  );
}

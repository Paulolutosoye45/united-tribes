import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/PageHead";
import { WhatsAppMode } from "@/components/admin/WhatsAppMode";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadWhatsappMode } from "@/lib/whatsapp/mode-server";

export const metadata: Metadata = { title: "WhatsApp mode" };

export default async function WhatsAppModePage() {
  await requireRole(OFFICE_ROLES, "/admin/messages/whatsapp-mode");
  const supabase = await createClient();
  const view = await loadWhatsappMode(supabase);
  // While the function is Off in God Mode there is no such page.
  if (!view || view.state === "off") notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="WhatsApp mode" back={{ href: "/admin/messages", label: "Message log" }}>
        Choose how the church uses WhatsApp: Full, Saver, or Free, where nothing is sent through Meta and so nothing is paid to Meta. See what the month has cost, and what each mode would have saved.
      </PageHead>
      <WhatsAppMode view={view} />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "@/components/admin/PageHead";
import { WhatsAppHealth } from "@/components/admin/WhatsAppHealth";
import { DATA_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadWhatsappHealth } from "@/lib/whatsapp/health-server";

export const metadata: Metadata = { title: "WhatsApp health" };

export default async function WhatsAppHealthPage() {
  await requireRole(DATA_ROLES, "/admin/messages/whatsapp");
  const supabase = await createClient();
  const view = await loadWhatsappHealth(supabase);
  // While the page is Off in God Mode there is no such page.
  if (!view) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="WhatsApp health" back={{ href: "/admin/messages", label: "Message log" }}>
        Is the church’s WhatsApp working, and if not, why? This asks Meta directly, shows the last week in plain words, and lets you send yourself a test message.
      </PageHead>
      <WhatsAppHealth view={view} />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HandStaff } from "@/components/admin/HandStaff";
import { PageHead } from "@/components/admin/PageHead";
import { ASK_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadHandStaff } from "@/lib/whatsapp/mode-server";

export const metadata: Metadata = { title: "Message a leader" };

export default async function HandStaffPage() {
  await requireRole(ASK_ROLES, "/admin/messages/by-hand");
  const supabase = await createClient();
  const list = await loadHandStaff(supabase);
  if (!list || list.state === "off") notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Message a leader" back={{ href: "/admin/messages/whatsapp-mode", label: "WhatsApp mode" }}>
        Leaders and coaches who said yes to WhatsApp. WhatsApp opens on your own phone with the words ready; nothing is sent from this website, and no number is shown here.
      </PageHead>
      <HandStaff list={list} />
    </div>
  );
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  // The platform owner has no powers, and no menu, until they give the passphrase.
  if (session.god === "locked") redirect("/god/unlock");
  return <AppShell session={session}>{children}</AppShell>;
}

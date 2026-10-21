import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { menuFor } from "@/lib/admin/nav";
import { loadAttention } from "@/lib/admin/notices-server";
import { countsByHref } from "@/lib/admin/today";
import { OFFICE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireSession } from "@/lib/auth/session";

/**
 * The menu around every Admin page: one list of pages, for every role the signed-in person holds (someone who is both an admin and a pastor
 * sees the pages of both, once), with the number waiting beside the ones that have something. The pages inside are unchanged.
 * Only the office is told what is waiting; anyone else (a community champion writing an announcement) gets the menu without numbers.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("/admin");
  const attention = hasAnyRole(session.roles, OFFICE_ROLES) ? await loadAttention() : null;
  const menu = menuFor(session.roles, attention ? countsByHref(attention.rows) : {});
  return <AdminShell menu={menu}>{children}</AdminShell>;
}

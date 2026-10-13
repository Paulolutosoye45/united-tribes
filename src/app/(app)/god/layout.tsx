import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { OwnerBar } from "@/components/god/OwnerBar";
import { requireSession } from "@/lib/auth/session";
import { getOverview } from "@/lib/god/server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The owner's console. To everyone else it is a page that does not exist. To the owner before the passphrase it is the
 * unlock step. Every function behind it checks again, so this is never the only line of defence.
 */
export default async function GodLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("/god");
  if (session.god === "none") notFound();
  if (session.god === "locked") redirect("/god/unlock");
  const overview = await getOverview();
  // The window ended between the page load and now: back to the unlock step.
  if (!overview) redirect("/god/unlock");
  return (
    <div className="flex flex-col gap-8">
      <OwnerBar until={overview.open_until} />
      {children}
    </div>
  );
}

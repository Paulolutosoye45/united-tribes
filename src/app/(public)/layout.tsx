import type { ReactNode } from "react";
import { HowToPilot } from "@/components/guides/HowToPilot";
import { getSession } from "@/lib/auth/session";
import { pilotFor } from "@/lib/guides/pilot";

/**
 * The pages anyone can open (sign-in, and the pages people reach from an email). The "How to use this app" button appears only on the ones
 * that have a guide: it offers that guide, and the guides that open for anyone with the link.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <>
      {children}
      <HowToPilot data={pilotFor(session?.roles ?? null, [])} variant="public" />
    </>
  );
}

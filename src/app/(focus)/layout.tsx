import type { ReactNode } from "react";
import { ScreenBeacon } from "@/components/activity/ScreenBeacon";
import { requireSession } from "@/lib/auth/session";

/**
 * Focus screens (the member form and the leader application) have no navigation, so nothing pulls the
 * person away mid-question. The page checks sign-in itself too.
 */
export default async function FocusLayout({ children }: { children: ReactNode }) {
  await requireSession("/home");
  return (
    <>
      <ScreenBeacon />
      {children}
    </>
  );
}

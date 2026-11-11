import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ScreenBeacon } from "@/components/activity/ScreenBeacon";
import { SignInPrompt } from "@/components/prompt/SignInPrompt";
import { AppShell } from "@/components/shell/AppShell";
import { requireSession } from "@/lib/auth/session";
import { loadPromptQueue } from "@/lib/prompt/server";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  // The platform owner has no powers, and no menu, until they give the passphrase.
  if (session.god === "locked") redirect("/god/unlock");
  // What this person owes the church, asked once after the sign-in check. Off, in Rehearsal and for anyone who owes nothing it is nothing at all, and a fault in it never
  // stops a page: the database remembers the visit, so this draws the same screen on a reload and a different one at a new sign-in.
  const prompt = session.god === "open" ? null : await loadPromptQueue(await createClient());
  return (
    <AppShell session={session}>
      <ScreenBeacon />
      {children}
      {/* Kept on the page once it is On, even when nothing is owed, so the "thank you" after the last answer is not torn down by the page redrawing */}
      {prompt && prompt.state === "on" ? <SignInPrompt tasks={prompt.tasks} total={prompt.total} /> : null}
    </AppShell>
  );
}

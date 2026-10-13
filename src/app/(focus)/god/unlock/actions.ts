"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type UnlockState = { status: "idle" | "error"; message: string };

/** Only a local path: never an address on another site, and never one that sends a failed unlock somewhere odd. */
function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/god/unlock") && !next.includes("\\") ? next : "/god";
}

/**
 * Checks the owner's passphrase. The database does the checking, counts wrong tries and locks after five; it answers as
 * data, so this only turns that answer into a screen. Anyone who is not the owner gets the same "That did not work."
 */
export async function unlockAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const session = await getSession();
  if (!session || session.god === "none") return { status: "error", message: "That did not work." };
  const phrase = String(formData.get("passphrase") ?? "").slice(0, 200);
  if (!phrase) return { status: "error", message: "Type your passphrase." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("god_unlock", { p_phrase: phrase });
  if (error) return { status: "error", message: "That did not work. Try again in a moment." };
  const answer = data as { ok?: boolean; message?: string; tries_left?: number } | null;
  if (!answer?.ok) {
    const left = typeof answer?.tries_left === "number" && answer.tries_left > 0 ? ` ${answer.tries_left} ${answer.tries_left === 1 ? "try" : "tries"} left.` : "";
    return { status: "error", message: `${answer?.message ?? "That did not work."}${left}` };
  }
  redirect(safeNext(formData.get("next")));
}

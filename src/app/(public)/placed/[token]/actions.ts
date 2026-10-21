"use server";

import { redirect } from "next/navigation";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

const FUNCTIONS = { confirm: "worker_placed_confirm", withhold: "worker_placed_withhold", change: "worker_placed_change" } as const;
type Choice = keyof typeof FUNCTIONS;

/**
 * The three buttons on the page behind "Your tribe". Opening the link records nothing (a mail scanner or a link preview opens links
 * too); the member presses a button, and only then is it saved. The link is the only credential, so it is checked as 64 hex characters
 * here and again, hashed, in the database.
 */
export async function placedAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !(choice in FUNCTIONS)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);

  const args: Record<string, unknown> = { p_link: token };
  if (choice === "confirm") args.p_version = AGREEMENT_VERSION;
  const { data, error } = await workerRpc(secret)(FUNCTIONS[choice as Choice], args);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; late?: boolean };
  if (error) redirect(`/placed/${token}?problem=1`);
  if (!result.ok) {
    redirect(`/placed/${token}?${result.reason === "started" ? "started=1" : result.reason === "invalid" || result.reason === "not_active" ? "invalid=1" : "problem=1"}`);
  }
  redirect(`/placed/${token}?done=${choice}${result.late ? "&late=1" : ""}`);
}

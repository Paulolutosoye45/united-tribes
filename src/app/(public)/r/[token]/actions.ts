"use server";

import { redirect } from "next/navigation";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

const OUTCOMES = ["done", "partly", "not_yet"] as const;

/**
 * The one tap behind the Friday message. Nothing is recorded just by opening the
 * link (a mail scanner or a link preview opens links too); the person presses the
 * button, and only then is the answer saved.
 */
export async function replyAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !(OUTCOMES as readonly string[]).includes(outcome)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/r/${token}?problem=1`);

  const { data, error } = await workerRpc(secret)("worker_checkin_reply", { p_reply_token: token, p_outcome: outcome });
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (error) redirect(`/r/${token}?o=${outcome}&problem=1`);
  if (!result.ok) redirect(`/r/${token}?o=${outcome}&${result.reason === "not_now" ? "late=1" : "problem=1"}`);
  redirect(`/r/${token}?saved=${outcome}`);
}

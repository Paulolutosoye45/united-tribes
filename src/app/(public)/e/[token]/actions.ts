"use server";

import { redirect } from "next/navigation";
import { isLinkToken } from "@/lib/outreach/link";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

/**
 * Nothing is recorded just by opening a link from an email (a mail scanner or a link preview opens links too).
 * The person presses a button on the page, and only then does it count.
 */
export async function confirmAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!isLinkToken(token)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/e/${token}?problem=1`);
  const { data, error } = await workerRpc(secret)("worker_link_confirm", { p_link: token, p_reason: reason || null });
  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (error || !result.ok) redirect(`/e/${token}?problem=${result.reason === "expired" ? "expired" : "1"}`);
  redirect(`/e/${token}?done=1`);
}

export async function prefsAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!isLinkToken(token)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/e/${token}?problem=1`);
  const on = (name: string) => formData.get(name) === "on";
  const { data, error } = await workerRpc(secret)("worker_prefs_save", {
    p_link: token,
    p_reminders: on("reminders"),
    p_announcements: on("announcements"),
    p_tribe: on("tribe"),
  });
  const result = (data ?? {}) as { ok?: boolean };
  if (error || !result.ok) redirect(`/e/${token}?problem=1`);
  redirect(`/e/${token}?saved=1`);
}

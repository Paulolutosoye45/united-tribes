"use server";

import { redirect } from "next/navigation";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { isSeatLink } from "@/lib/seat/seat";

/**
 * The one button on the page behind "Your seat has been offered to someone else": take the seat back. Opening the link records nothing (a mail scanner or a link preview
 * opens links too); the member presses the button, and only then is it done. The link is the only credential, so it is checked as 64 hex characters here and again,
 * hashed, in the database, which says whether the seat is still free. Nothing else is sent: no number, no note, no reason.
 */
export async function takeSeatBackAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!isSeatLink(token)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/seat/${token}?problem=1`);
  const { data, error } = await workerRpc(secret)("worker_seat_take_back", { p_link: token });
  if (error) redirect(`/seat/${token}?problem=1`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; link?: string };
  if (result.ok) {
    // The seat is theirs again: the page they were sent the first time asks for their yes
    if (isSeatLink(result.link)) redirect(`/placed/${result.link}?a=confirm`);
    redirect(`/seat/${token}?done=1`);
  }
  redirect(`/seat/${token}?${result.reason === "gone" ? "gone=1" : result.reason === "closed" ? "closed=1" : result.reason === "invalid" ? "invalid=1" : "problem=1"}`);
}

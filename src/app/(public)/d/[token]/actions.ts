"use server";

import { redirect } from "next/navigation";
import { isDeskAnswer, isDeskSlot } from "@/lib/desk/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

/**
 * The buttons on the page behind a Leader Desk email. Opening the link records nothing (a mail scanner or a link preview opens links too); the member presses a
 * button, and only then is it saved. The link is the only credential, so it is checked as 64 hex characters here and again, hashed, in the database. The only
 * things sent on are one answer from a short list and, for "A different time", some of the four meeting times.
 */
export async function deskAnswerAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const answer = String(formData.get("answer") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !isDeskAnswer(answer)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/d/${token}?problem=1`);
  const slots = answer === "other_time" ? [...new Set(formData.getAll("slot").map(String).filter(isDeskSlot))] : [];
  if (answer === "other_time" && slots.length === 0) redirect(`/d/${token}?a=time&times=1`);

  const { data, error } = await workerRpc(secret)("worker_desk_answer", { p_link: token, p_answer: answer, p_slots: slots });
  if (error) redirect(`/d/${token}?problem=1`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; answer?: string };
  if (!result.ok) {
    redirect(`/d/${token}?${result.reason === "closed" ? "closed=1" : result.reason === "off" ? "off=1" : result.reason === "invalid" || result.reason === "not_available" ? "invalid=1" : "problem=1"}`);
  }
  redirect(`/d/${token}?done=${isDeskAnswer(result.answer) ? result.answer : answer}`);
}

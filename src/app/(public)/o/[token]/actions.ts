"use server";

import { redirect } from "next/navigation";
import { isOfferAnswer, isOfferReason } from "@/lib/desk/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

const LEAD = ["structure", "connection", "teaching", "doing"];
const RELATION = ["achieved", "pursuing"];

/**
 * The buttons on the page behind a "Would you lead this group?" email. Opening the link records nothing (a mail scanner or a link preview opens links too); the
 * member presses a button, and only then is it saved. The link is the only credential, so it is checked as 64 hex characters here and again, hashed, in the
 * database. What is sent on is one answer from a short list and, only for "Yes, I will lead", a confirmation of age and two short answers, or, only for
 * "Not this season", reasons chosen from a short list. The database checks every one of them again.
 */
export async function offerAnswerAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const answer = String(formData.get("answer") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !isOfferAnswer(answer)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/o/${token}?problem=1`);

  let age = false;
  let lead: string | null = null;
  let relation: string | null = null;
  let reasons: string[] = [];
  if (answer === "lead") {
    age = formData.get("age") === "on";
    lead = String(formData.get("lead") ?? "");
    relation = String(formData.get("relation") ?? "");
    if (!age) redirect(`/o/${token}?a=lead&need=age`);
    if (!LEAD.includes(lead)) redirect(`/o/${token}?a=lead&need=lead`);
    if (!RELATION.includes(relation)) redirect(`/o/${token}?a=lead&need=relation`);
  }
  if (answer === "not_season") reasons = [...new Set(formData.getAll("reason").map(String).filter(isOfferReason))].slice(0, 5);

  const { data, error } = await workerRpc(secret)("worker_desk_offer_answer", {
    p_link: token,
    p_answer: answer,
    p_age: age,
    p_lead: lead,
    p_relation: relation,
    p_reasons: reasons,
  });
  if (error) redirect(`/o/${token}?problem=1`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; answer?: string; review?: boolean; later?: boolean };
  if (!result.ok) {
    redirect(`/o/${token}?${result.reason === "closed" ? "closed=1" : result.reason === "off" ? "off=1" : result.reason === "invalid" || result.reason === "not_available" ? "invalid=1" : "problem=1"}`);
  }
  const done = isOfferAnswer(result.answer) ? result.answer : answer;
  const extra = done === "lead" && result.review ? "&review=1" : done === "tomorrow" && result.later === false ? "&late=1" : "";
  redirect(`/o/${token}?done=${done}${extra}`);
}

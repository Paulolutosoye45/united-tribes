"use server";

import { providerFromEnv } from "@/lib/ai/suggest";
import { getSession } from "@/lib/auth/session";
import { firstProblem, parseLeaderAnswers, refereeProblem, withNormalisedContact, type RefereeInput } from "@/lib/leaders/answers";
import { leaderConsentFor } from "@/lib/leaders/consent";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { MAX_ANSWER_LENGTH, isWrittenField } from "@/lib/leaders/quality/fields";
import { kickLeaderReading } from "@/lib/leaders/quality/kick";
import { checkAnswer } from "@/lib/leaders/quality/scorer";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; step?: string };

/** Starts the application, or picks up the draft the person already has. */
export async function startApplicationAction(): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  const supabase = await createClient();

  const existing = await supabase.from("leader_applications").select("id").eq("person_id", session.person.id).eq("status", "draft").maybeSingle();
  if (existing.data) return { ok: true, id: existing.data.id };

  // The version stored is the wording the person was shown, which depends on whether the first check is switched on.
  const config = await supabase.rpc("leader_ai_public_config");
  const consent = leaderConsentFor((config.data as { mode?: string } | null)?.mode);
  const { data, error } = await supabase
    .from("leader_applications")
    .insert({ person_id: session.person.id, step: "eligibility", answers: {}, consent_version: consent.version })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, message: "You already have an application open. Find it on the Lead page." };
    return { ok: false, message: TRY_AGAIN };
  }
  return { ok: true, id: data.id };
}

/** Scores the seven checks. Any “no” closes this application kindly, and says which. */
export async function checkEligibilityAction(appId: string): Promise<ActionResult<{ eligible: boolean; failed: string[] }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_leader_eligibility", { p_app: appId });
  if (error) return { ok: false, message: friendly(error) };
  const result = data as { ok?: boolean; failed?: string[] } | null;
  return { ok: true, eligible: result?.ok === true, failed: Array.isArray(result?.failed) ? result.failed.map(String) : [] };
}

/** Starts a fresh application after an ineligible one (the old one is removed). */
export async function restartApplicationAction(oldId: string): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(oldId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  await supabase.from("leader_applications").delete().eq("id", oldId).eq("person_id", session.person.id).eq("status", "ineligible");
  return startApplicationAction();
}

/** Saves one referee. The person can change them until they submit. */
export async function saveRefereeAction(appId: string, slot: 1 | 2, input: RefereeInput): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || (slot !== 1 && slot !== 2)) return { ok: false, message: TRY_AGAIN };
  const problem = refereeProblem(input);
  if (problem) return { ok: false, message: problem };

  // The database holds the rules (not your own contact, not the other referee, not a throwaway inbox, not another applicant's
  // referee) and says in words which one a contact breaks.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_referee", {
    p_app: appId,
    p_slot: slot,
    p_name: input.name,
    p_relationship: input.relationship,
    p_contact: input.contact,
    p_head: input.head === true,
  });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true };
}

/**
 * Sends the application. What is saved in the database is checked again here and,
 * once more, by the database itself, which also scores the scenarios.
 */
export async function submitApplicationAction(appId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();

  const [app, refs] = await Promise.all([
    supabase.from("leader_applications").select("answers, status").eq("id", appId).maybeSingle(),
    supabase.from("leader_references").select("slot, referee_name, relationship, contact, is_pastor_or_unit_head").eq("application_id", appId),
  ]);
  if (!app.data || app.data.status !== "draft") return { ok: false, message: "This application was already sent." };

  const referees: { 1?: RefereeInput; 2?: RefereeInput } = {};
  for (const r of refs.data ?? []) {
    referees[r.slot === 2 ? 2 : 1] = { name: r.referee_name, relationship: r.relationship, contact: r.contact, head: r.is_pastor_or_unit_head };
  }
  const parsed = parseLeaderAnswers(app.data.answers);
  const problem = firstProblem(parsed, referees);
  if (problem) return { ok: false, ...problem };

  // Make sure the number is stored in international form, which the database insists on.
  const tidy = withNormalisedContact(parsed);
  if (tidy.contact.whatsapp !== parsed.contact.whatsapp) {
    const stored = (app.data.answers ?? {}) as Record<string, unknown>;
    const fixed = await supabase
      .from("leader_applications")
      .update({ answers: { ...stored, contact: { ...(stored.contact as object | undefined), whatsapp: tidy.contact.whatsapp } } })
      .eq("id", appId);
    if (fixed.error) return { ok: false, message: TRY_AGAIN };
  }

  const { error } = await supabase.rpc("submit_leader_application", { p_app: appId });
  if (error) {
    const message = friendly(error);
    // A written answer that has not passed its quick check sends the person back to the written questions.
    if (/quick check|written answers/i.test(message)) return { ok: false, message, step: "goal-story" };
    if (/updated wording/i.test(message)) return { ok: false, message, step: "ai-consent" };
    return { ok: false, message };
  }
  kickLeaderReading();
  return { ok: true };
}

export type CheckResult = ActionResult<{
  /** True when the first check is not switched on: nothing was checked and nothing is asked. */
  skipped?: boolean;
  passes?: boolean;
  /** A kind note on what to add. Shown under the answer. */
  note?: string | null;
  triesLeft?: number;
}>;

/**
 * The quick check on one written answer, when the person presses Continue. For a draft the text is read from what is
 * saved, so what is checked is exactly what will be sent. After sending (adding to an answer when asked), the new text
 * comes with the call. Nothing here can pass an answer: the database records the result and decides.
 */
export async function checkAnswerAction(appId: string, field: string, newText?: string): Promise<CheckResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || !isWrittenField(field)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();

  const config = await supabase.rpc("leader_ai_public_config");
  const mode = (config.data as { mode?: string } | null)?.mode;
  if (config.error) return { ok: false, message: TRY_AGAIN };
  if (mode !== "on") return { ok: true, skipped: true };

  const app = await supabase.from("leader_applications").select("answers, status").eq("id", appId).maybeSingle();
  if (!app.data) return { ok: false, message: TRY_AGAIN };
  const saved = String(((app.data.answers ?? {}) as { calling?: Record<string, unknown> }).calling?.[field] ?? "");
  const text = (app.data.status === "draft" ? saved : String(newText ?? "")).slice(0, MAX_ANSWER_LENGTH[field]);

  const token = workerToken();
  if (!token) return { ok: false, message: "Checking is not available right now. Please try again in a little while." };
  const outcome = await checkAnswer({ rpc: workerRpc(token), provider: providerFromEnv() }, { application: appId, field, text });
  switch (outcome.kind) {
    case "skip":
      return { ok: true, skipped: true };
    case "consent":
      return { ok: false, message: "Please agree to the updated wording first." };
    case "limited":
      return { ok: false, message: "You have tried a lot of versions today. Please come back tomorrow and carry on." };
    case "error":
      return { ok: false, message: TRY_AGAIN };
    case "result":
      return { ok: true, passes: outcome.passes, note: outcome.note, triesLeft: outcome.triesLeft };
  }
}

/** The applicant agrees to the wording that says an AI service reads their written answers. */
export async function aiConsentAction(appId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_leader_ai_consent", { p_app: appId });
  if (error) return { ok: false, message: friendly(error) };
  kickLeaderReading();
  return { ok: true };
}

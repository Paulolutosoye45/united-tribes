"use server";

import { getSession } from "@/lib/auth/session";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { firstProblem, normalisedContact, parseLeaderAnswers, refereeProblem, withNormalisedContact, type RefereeInput } from "@/lib/leaders/answers";
import { LEADER_CONSENT_VERSION } from "@/lib/leaders/consent";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; step?: string };

/** Starts the application, or picks up the draft the person already has. */
export async function startApplicationAction(): Promise<ActionResult<{ id: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  const supabase = await createClient();

  const existing = await supabase.from("leader_applications").select("id").eq("person_id", session.person.id).eq("status", "draft").maybeSingle();
  if (existing.data) return { ok: true, id: existing.data.id };

  const { data, error } = await supabase
    .from("leader_applications")
    .insert({ person_id: session.person.id, step: "eligibility", answers: {}, consent_version: LEADER_CONSENT_VERSION })
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

  const supabase = await createClient();
  const contact = normalisedContact(input.contact);
  const own = [normalisedContact(session.person.email)];
  const { data: me } = await supabase.from("leader_applications").select("answers").eq("id", appId).maybeSingle();
  const whatsapp = normaliseWhatsapp(parseLeaderAnswers(me?.answers).contact.whatsapp ?? "");
  if (whatsapp) own.push(whatsapp);
  if (own.includes(contact)) return { ok: false, message: "A referee has to be someone else, not you." };

  const other = await supabase.from("leader_references").select("contact").eq("application_id", appId).eq("slot", slot === 1 ? 2 : 1).maybeSingle();
  if (other.data && normalisedContact(other.data.contact) === contact) {
    return { ok: false, message: "Your two referees must be different people." };
  }

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
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { firstProblem, normaliseWhatsapp, parseDraftAnswers, TEENS } from "@/lib/intake/answers";
import { CONSENT_VERSION } from "@/lib/intake/consent";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string; step?: string };

const TRY_AGAIN = "We couldn't save that. Check your connection and try again.";

/** Records that the person agreed to use of their answers (and, if they chose, the assistant). */
export async function recordConsentAction(input: { ai: boolean }): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const supabase = await createClient();

  const rows = [{ person_id: session.person.id, purpose: "matching", granted: true, version: CONSENT_VERSION }];
  if (input.ai === true) rows.push({ person_id: session.person.id, purpose: "ai_assist", granted: true, version: CONSENT_VERSION });

  const { error } = await supabase.from("consents").insert(rows);
  if (error) return { ok: false, message: TRY_AGAIN };
  return { ok: true };
}

export type SubmitResult = ActionResult & { durationSeconds?: number };

/**
 * Saves the finished form. The answers are checked again here, because
 * nothing from the browser is trusted, and the database has its own rules too.
 */
export async function submitIntakeAction(raw: unknown, activeSeconds: number, isEdit: boolean): Promise<SubmitResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const supabase = await createClient();
  const answers = parseDraftAnswers(raw);

  const problem = firstProblem(answers);
  if (problem) return { ok: false, ...problem };

  const { data: consented } = await supabase.rpc("has_consent", { p_purpose: "matching" });
  if (consented !== true) return { ok: false, step: "welcome", message: "We need your agreement before we can save your answers." };

  // Look up the catalogue rows the answers point to.
  const [range, tribe, goal, season, existing] = await Promise.all([
    supabase.from("age_ranges").select("id, track:tracks(active)").eq("slug", answers.ageRange!).maybeSingle(),
    answers.tribe ? supabase.from("tribes").select("id").eq("slug", answers.tribe).maybeSingle() : Promise.resolve({ data: null }),
    answers.goal ? supabase.from("season_goals").select("id, tribe_id").eq("slug", answers.goal).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("seasons").select("id").in("status", ["planning", "open"]).order("starts_on", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("member_profiles").select("duration_seconds, submitted_at").eq("person_id", session.person.id).maybeSingle(),
  ]);

  const track = Array.isArray(range.data?.track) ? range.data?.track[0] : range.data?.track;
  if (!range.data || answers.ageRange === TEENS || !track?.active) {
    return { ok: false, step: "age", message: "Circles for that age range are not open yet." };
  }
  if (answers.tribe && !tribe.data) return { ok: false, step: "tribe", message: "That tribe is no longer available. Choose again." };
  if (answers.goal && (!goal.data || goal.data.tribe_id !== tribe.data?.id)) {
    return { ok: false, step: "goal", message: "That goal isn't part of your tribe. Choose again." };
  }

  const whatsapp = answers.whatsapp?.trim() ? normaliseWhatsapp(answers.whatsapp) : null;
  if (whatsapp && answers.whatsappOk) {
    const { data: already } = await supabase.rpc("has_consent", { p_purpose: "whatsapp" });
    if (already !== true) {
      await supabase.from("consents").insert({ person_id: session.person.id, purpose: "whatsapp", granted: true, version: CONSENT_VERSION });
    }
  }

  const keepTime = isEdit && existing.data?.duration_seconds != null;
  const duration = keepTime ? Number(existing.data!.duration_seconds) : Math.max(0, Math.min(7200, Math.round(Number(activeSeconds) || 0)));

  const row = {
    person_id: session.person.id,
    season_id: season.data?.id ?? null,
    age_range_id: range.data.id,
    birthday_day: answers.birthdayDay ?? null,
    birthday_month: answers.birthdayMonth ?? null,
    gender: answers.gender,
    circle_mix: answers.circleMix,
    zone: answers.zone,
    area_note: answers.areaNote?.trim() || null,
    story: answers.story?.trim() || null,
    tribe_id: tribe.data?.id ?? null,
    tribe_other: tribe.data ? null : answers.tribeOther?.trim() || null,
    faith_journey: answers.faith,
    season_goal_id: goal.data?.id ?? null,
    goal_other: goal.data ? null : answers.goalOther?.trim() || null,
    success_statement: answers.successStatement?.trim() || null,
    goal_baseline: answers.baseline,
    meeting_mode: answers.meetingMode,
    meeting_times: answers.times,
    style_social: answers.styleSocial ?? 0,
    style_structure: answers.styleStructure ?? 0,
    style_openness: answers.styleOpenness ?? 0,
    style_directness: answers.styleDirectness ?? 0,
    style_disclosure: answers.styleDisclosure ?? 0,
    style_learning: answers.styleLearning ?? 0,
    open_to_serving: answers.openToServing ?? null,
    support_needs: answers.supportNeeds?.trim() || null,
    whatsapp: whatsapp && answers.whatsappOk ? whatsapp : null,
    ai_assist: answers.assist ?? {},
    duration_seconds: duration,
  };

  const { error } = await supabase.from("member_profiles").upsert(row, { onConflict: "person_id" });
  if (error) return { ok: false, message: TRY_AGAIN };

  // How they asked to be called lives on their person record.
  await supabase
    .from("people")
    .update({ preferred_name: answers.preferredName!.trim(), full_name: answers.fullName?.trim() || session.person.fullName })
    .eq("id", session.person.id);

  await supabase.from("intake_drafts").delete().eq("person_id", session.person.id);
  await supabase.rpc("log_event", {
    p_action: isEdit ? "intake.updated" : "intake.completed",
    p_entity: "member_profile",
    p_entity_id: session.person.id,
    p_meta: { seconds: duration, assisted: Object.keys(answers.assist ?? {}).length > 0 },
  });

  // No revalidatePath here on purpose: it would re-render /join now that a profile exists and
  // swap the celebration screen for the "already joined" view. Pages behind sign-in render per
  // request, so Home and Join show the new answers the next time the person opens them.
  return { ok: true, durationSeconds: duration };
}

/** Used by "Save and finish later" when the draft is stale or the person starts over. */
export async function discardDraftAction(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const supabase = await createClient();
  const { error } = await supabase.from("intake_drafts").delete().eq("person_id", session.person.id);
  if (error) return { ok: false, message: TRY_AGAIN };
  revalidatePath("/", "layout");
  return { ok: true };
}


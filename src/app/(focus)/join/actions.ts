"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SealUnavailable, draftContext, leaderNoteContext, seal, sealingAvailable, supportContext } from "@/lib/crypto/seal";
import { enabledChannels, firstProblem, hasWords, normaliseWhatsapp, parseDraftAnswers, supportLoad, TEENS } from "@/lib/intake/answers";
import { areaBySlug } from "@/lib/intake/areas";
import { CONSENT_VERSION } from "@/lib/intake/consent";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; message: string; step?: string };

const TRY_AGAIN = "We couldn't save that. Check your connection and try again.";
const CANNOT_SEAL = "We can't keep private notes safely right now, so we haven't saved them. Take them out to finish, or try again later.";

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
 *
 * Two notes are private: what would help care for the person, and a note for their leader. They are sealed here,
 * before they reach the database, and the only thing the matching engine learns about the first is a number
 * (0 none, 1 something a tribe can arrange, 2 a hard season).
 */
export async function submitIntakeAction(raw: unknown, activeSeconds: number, isEdit: boolean): Promise<SubmitResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const supabase = await createClient();
  const answers = parseDraftAnswers(raw);
  const personId = session.person.id;

  const { data: teensOpen } = await supabase.rpc("teen_track_open");
  const problem = firstProblem(answers, { teensOpen: teensOpen === true });
  if (problem) return { ok: false, ...problem };

  const { data: consented } = await supabase.rpc("has_consent", { p_purpose: "matching" });
  if (consented !== true) return { ok: false, step: "welcome", message: "We need your agreement before we can save your answers." };

  // Look up the catalogue rows the answers point to.
  const [range, community, secondCommunity, goal, season, existing] = await Promise.all([
    supabase.from("age_ranges").select("id, track:tracks(active)").eq("slug", answers.ageRange!).maybeSingle(),
    answers.community ? supabase.from("communities").select("id, active").eq("slug", answers.community).maybeSingle() : Promise.resolve({ data: null }),
    answers.community && answers.secondCommunity ? supabase.from("communities").select("id, active").eq("slug", answers.secondCommunity).maybeSingle() : Promise.resolve({ data: null }),
    answers.goal ? supabase.from("season_goals").select("id, community_id, active").eq("slug", answers.goal).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("seasons").select("id").in("status", ["planning", "open"]).order("starts_on", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("member_profiles").select("duration_seconds, submitted_at, community_id, second_community_id, season_goal_id").eq("person_id", personId).maybeSingle(),
  ]);

  const track = Array.isArray(range.data?.track) ? range.data?.track[0] : range.data?.track;
  if (!range.data || (answers.ageRange === TEENS && teensOpen !== true) || !track?.active) {
    return { ok: false, step: "age", message: "Tribes for that age range are not open yet." };
  }
  // A community or goal the office has retired cannot be chosen now, but a person who chose it earlier keeps it.
  const stays = (row: { id: unknown; active: unknown } | null, before: unknown) => row !== null && (row.active !== false || (typeof before === "string" && row.id === before));
  if (answers.community && !stays(community.data, existing.data?.community_id)) return { ok: false, step: "community", message: "That community is no longer available. Choose again." };
  if (answers.secondCommunity && answers.community && !stays(secondCommunity.data, existing.data?.second_community_id)) {
    return { ok: false, step: "community", message: "That second choice is no longer available. Choose again." };
  }
  if (answers.goal && goal.data && !stays(goal.data, existing.data?.season_goal_id)) {
    return { ok: false, step: "goal", message: "That goal is no longer available. Choose again." };
  }
  if (answers.goal && (!goal.data || goal.data.community_id !== community.data?.id)) {
    return { ok: false, step: "goal", message: "That goal isn't part of your community. Choose again." };
  }

  // The private notes.
  const chips = answers.supportChips ?? [];
  const note = answers.supportNote?.trim() ?? "";
  const leaderNote = answers.leaderNote?.trim() ?? "";
  const hasSupport = chips.length > 0 || hasWords(note);
  let supportEnc: string | null = null;
  let leaderNoteEnc: string | null = null;
  if (hasSupport || leaderNote) {
    if (!sealingAvailable()) return { ok: false, step: "care", message: CANNOT_SEAL };
    try {
      if (hasSupport) supportEnc = seal(JSON.stringify({ chips, note }), supportContext(personId));
      if (leaderNote) leaderNoteEnc = seal(leaderNote, leaderNoteContext(personId));
    } catch (error) {
      if (error instanceof SealUnavailable) return { ok: false, step: "care", message: CANNOT_SEAL };
      throw error;
    }
  }

  const keepTime = isEdit && existing.data?.duration_seconds != null;
  const duration = keepTime ? Number(existing.data!.duration_seconds) : Math.max(0, Math.min(7200, Math.round(Number(activeSeconds) || 0)));

  const children = answers.children?.includes("none") ? ["none"] : (answers.children ?? []);
  const area = areaBySlug(answers.areaSlug);

  // The phone number is left out of this row on purpose: save_contact below owns it, along with each channel's yes or no.
  const row = {
    person_id: personId,
    season_id: season.data?.id ?? null,
    age_range_id: range.data.id,
    birthday_day: answers.birthdayDay ?? null,
    birthday_month: answers.birthdayMonth ?? null,
    gender: answers.gender,
    tribe_mix: answers.tribeMix,
    zone: answers.zone,
    area_note: answers.areaNote?.trim() || null,
    area_slug: area?.slug ?? null,
    open_to_adjacent: answers.openToAdjacent === true,
    story: answers.story?.trim() || null,
    relationship: answers.relationship ?? null,
    children,
    work_status: answers.workStatus ?? null,
    work_field: answers.workField ?? null,
    community_id: community.data?.id ?? null,
    community_other: community.data ? null : answers.communityOther?.trim() || null,
    second_community_id: community.data ? (secondCommunity.data?.id ?? null) : null,
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
    group_roles: answers.groupRoles ?? [],
    open_to_serving: answers.openToServing ?? null,
    support_load: supportLoad(chips, note),
    support_enc: supportEnc,
    leader_note_enc: leaderNoteEnc,
    ai_assist: answers.assist ?? {},
    duration_seconds: duration,
  };

  const { error } = await supabase.from("member_profiles").upsert(row, { onConflict: "person_id" });
  if (error) {
    // The database refuses a young person's answers while tribes for them are closed: say so rather than "try again".
    if (error.code === "22023" && /teens are not open/i.test(error.message)) {
      return { ok: false, step: "age", message: "Tribes for teens are not open yet." };
    }
    return { ok: false, message: TRY_AGAIN };
  }

  // How and where to reach them: each channel is its own recorded yes or no.
  const phone = answers.phone?.trim() ? normaliseWhatsapp(answers.phone) : null;
  const { error: contactError } = await supabase.rpc("save_contact", {
    p_phone: phone,
    p_preferred: enabledChannels(answers)[0] ?? "email",
    p_whatsapp: answers.whatsappOk === true && phone !== null,
    p_sms: answers.smsOk === true && phone !== null,
    p_email: answers.emailOk !== false,
    p_version: CONSENT_VERSION,
  });
  if (contactError) return { ok: false, step: "contact", message: TRY_AGAIN };

  // How they asked to be called lives on their person record.
  await supabase
    .from("people")
    .update({ preferred_name: answers.preferredName!.trim(), full_name: answers.fullName?.trim() || session.person.fullName })
    .eq("id", personId);

  await supabase.from("intake_drafts").delete().eq("person_id", personId);
  await supabase.rpc("log_event", {
    p_action: isEdit ? "intake.updated" : "intake.completed",
    p_entity: "member_profile",
    p_entity_id: personId,
    p_meta: { seconds: duration, assisted: Object.keys(answers.assist ?? {}).length > 0 },
  });

  // No revalidatePath here on purpose: it would re-render /join now that a profile exists and
  // swap the celebration screen for the "already joined" view. Pages behind sign-in render per
  // request, so Home and Join show the new answers the next time the person opens them.
  return { ok: true, durationSeconds: duration };
}

/**
 * Keeps the private notes with the draft, sealed, so "finish later" does not lose them. The browser's own
 * draft never holds them (see draftOf in IntakeFlow); this is the only way they are saved before the end.
 */
export async function sealDraftAction(input: { supportChips?: string[]; supportNote?: string; leaderNote?: string }): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const answers = parseDraftAnswers(input);
  const body = { supportChips: answers.supportChips ?? [], supportNote: answers.supportNote ?? "", leaderNote: answers.leaderNote ?? "" };
  const empty = body.supportChips.length === 0 && !body.supportNote.trim() && !body.leaderNote.trim();
  if (!empty && !sealingAvailable()) return { ok: false, message: CANNOT_SEAL };

  const supabase = await createClient();
  const sealed = empty ? null : seal(JSON.stringify(body), draftContext(session.person.id));
  const { error } = await supabase.from("intake_drafts").update({ sealed }).eq("person_id", session.person.id);
  return error ? { ok: false, message: TRY_AGAIN } : { ok: true };
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

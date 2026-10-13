"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";
import { TESTIMONY_THEMES, type CareTaskOption, type ForwardedTestimony, type LogExtrasInput } from "@/lib/rhythm/types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

function refresh() {
  for (const path of ["/tribe", "/tribe/testimony", "/home", "/lead/week", "/lead", "/review/rhythm", "/care", "/testimonies"]) revalidatePath(path);
}

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

// ---------------------------------------------------------------- the member

export async function saveStepAction(week: number, when: string, will: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("save_week_step", { p_week: int(week), p_when: text(when, 200), p_will: text(will, 200) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function saveWordDaysAction(week: number, days: number): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("save_word_days", { p_week: int(week), p_days: int(days) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function saveCheckinAction(week: number, outcome: string, reflection: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("save_checkin", { p_week: int(week), p_outcome: text(outcome, 20), p_reflection: text(reflection, 400) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function savePulseAction(
  week: number,
  answers: { belonging: number; god: number; others: number; life: number },
  note: string,
): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!answers || typeof answers !== "object") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("save_pulse", {
    p_week: int(week),
    p_belonging: int(answers.belonging),
    p_god: int(answers.god),
    p_others: int(answers.others),
    p_life: int(answers.life),
    p_note: text(note, 400),
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function submitTestimonyAction(body: string, share: string, credit: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("submit_testimony", { p_body: text(body, 800), p_share: text(share, 20), p_credit: text(credit, 20) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function withdrawTestimonyAction(id: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("withdraw_testimony", { p_id: id });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- the leader

const CARE_LEVELS = ["none", "practical", "pastoral", "urgent"];
const CELEBRATIONS = ["anniversary", "new_baby", "promotion", "milestone", "other"];

/** Brings what the browser sent into the shape the database expects; the database checks it again. */
function cleanExtras(x: Partial<LogExtrasInput> | undefined) {
  if (!x || typeof x !== "object") return { ok: true as const, args: {} };
  const energy = x.energy === null || x.energy === undefined ? null : int(x.energy);
  if (x.energy !== null && x.energy !== undefined && energy === null) return { ok: false as const };
  const prayers = Array.isArray(x.prayers)
    ? x.prayers
        .filter((p) => p && typeof p.body === "string" && p.body.trim().length > 0)
        .slice(0, 10)
        .map((p) => ({ id: isUuid(p.id) ? p.id : undefined, body: p.body.trim().slice(0, 200) }))
    : null;
  const care = Array.isArray(x.care)
    ? x.care
        .filter((c) => c && isUuid(c.person) && typeof c.level === "string" && CARE_LEVELS.includes(c.level) && c.level !== "none")
        .slice(0, 5)
        .map((c) => ({ person: c.person, level: c.level, note: (c.note ?? "").toString().slice(0, 300) }))
    : null;
  const celebrations = Array.isArray(x.celebrations)
    ? x.celebrations
        .filter((c) => c && typeof c.kind === "string" && CELEBRATIONS.includes(c.kind))
        .slice(0, 5)
        .map((c) => ({ kind: c.kind, person: isUuid(c.person ?? "") ? c.person : null, note: (c.note ?? "").toString().slice(0, 140) }))
    : null;
  return {
    ok: true as const,
    args: {
      p_energy: energy,
      p_prayers: prayers,
      p_care: care,
      p_need_coach: x.needCoach === true,
      p_need_coach_note: text(x.needCoachNote ?? "", 300),
      p_celebrations: celebrations,
    },
  };
}

export async function saveLogAction(
  tribeId: string,
  week: number,
  held: boolean,
  highlight: string,
  attendance: { person: string; status: string }[],
  extras?: Partial<LogExtrasInput>,
): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || typeof held !== "boolean" || !Array.isArray(attendance)) return { ok: false, message: TRY_AGAIN };
  const clean = attendance
    .filter((a) => a && isUuid(a.person) && typeof a.status === "string")
    .map((a) => ({ person: a.person, status: a.status.slice(0, 10) }));
  const more = cleanExtras(extras);
  if (!more.ok) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("save_tribe_log", {
    p_tribe: tribeId,
    p_week: int(week),
    p_held: held,
    p_highlight: text(highlight, 400),
    p_attendance: held ? clean : [],
    ...more.args,
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function answerPrayerAction(id: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("answer_prayer", { p_id: id, p_note: text(note, 200) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function removePrayerAction(id: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("remove_prayer", { p_id: id });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------- care tasks

export async function completeCareTaskAction(id: string, outcome: "done" | "dismissed", note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || (outcome !== "done" && outcome !== "dismissed")) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("complete_care_task", { p_id: id, p_outcome: outcome, p_note: text(note, 300) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** The people a task can be passed to, fetched when the care team opens the choice. */
export async function careTaskOptionsAction(id: string): Promise<Result<{ options: CareTaskOption[] }>> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { data, error } = await supabase.rpc("care_task_options", { p_id: id });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, options: (data as CareTaskOption[] | null) ?? [] };
}

export async function reassignCareTaskAction(id: string, to: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || !isUuid(to)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("reassign_care_task", { p_id: id, p_to: to });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function recordCallAction(flagId: string, outcome: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(flagId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("record_call", { p_flag: flagId, p_outcome: text(outcome, 20), p_note: text(note, 400) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function raiseConcernAction(tribeId: string, personId: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || !isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("raise_concern", { p_tribe: tribeId, p_person: personId, p_note: text(note, 400) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function refinePictureAction(tribeId: string, god: string, others: string, life: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("refine_success_picture", {
    p_tribe: tribeId,
    p_god: text(god, 300),
    p_others: text(others, 300),
    p_life: text(life, 300),
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function reviewTestimonyAction(id: string, decision: "approve" | "decline", note: string, themes?: string[]): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || (decision !== "approve" && decision !== "decline")) return { ok: false, message: TRY_AGAIN };
  const tags = Array.isArray(themes) ? themes.filter((t) => (TESTIMONY_THEMES as readonly string[]).includes(t)).slice(0, 3) : null;
  const { error } = await supabase.rpc("review_testimony", {
    p_id: id,
    p_decision: decision,
    p_note: text(note, 300),
    p_themes: decision === "approve" && tags && tags.length > 0 ? tags : null,
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** Marks a church-approved testimony as passed to the TCN testimony form, and returns the words to paste. */
export async function forwardTestimonyAction(id: string): Promise<Result<{ testimony: ForwardedTestimony }>> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { data, error } = await supabase.rpc("forward_testimony", { p_id: id });
  if (error || !data) return { ok: false, message: error ? friendly(error) : TRY_AGAIN };
  refresh();
  return { ok: true, testimony: data as ForwardedTestimony };
}

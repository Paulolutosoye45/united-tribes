"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

function refresh() {
  for (const path of ["/circle", "/circle/testimony", "/home", "/lead/week", "/lead", "/review/rhythm"]) revalidatePath(path);
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

export async function saveLogAction(
  circleId: string,
  week: number,
  held: boolean,
  highlight: string,
  attendance: { person: string; status: string }[],
): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(circleId) || typeof held !== "boolean" || !Array.isArray(attendance)) return { ok: false, message: TRY_AGAIN };
  const clean = attendance
    .filter((a) => a && isUuid(a.person) && typeof a.status === "string")
    .map((a) => ({ person: a.person, status: a.status.slice(0, 10) }));
  const { error } = await supabase.rpc("save_circle_log", {
    p_circle: circleId,
    p_week: int(week),
    p_held: held,
    p_highlight: text(highlight, 400),
    p_attendance: held ? clean : [],
  });
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

export async function raiseConcernAction(circleId: string, personId: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(circleId) || !isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("raise_concern", { p_circle: circleId, p_person: personId, p_note: text(note, 400) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function refinePictureAction(circleId: string, god: string, others: string, life: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(circleId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("refine_success_picture", {
    p_circle: circleId,
    p_god: text(god, 300),
    p_others: text(others, 300),
    p_life: text(life, 300),
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function reviewTestimonyAction(id: string, decision: "approve" | "decline", note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || (decision !== "approve" && decision !== "decline")) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("review_testimony", { p_id: id, p_decision: decision, p_note: text(note, 300) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

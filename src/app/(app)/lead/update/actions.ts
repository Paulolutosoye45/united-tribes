"use server";

import { revalidatePath } from "next/cache";
import { providerFromEnv } from "@/lib/ai/suggest";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { MAX_ANSWER_LENGTH, WRITTEN_FIELDS, isWrittenField, type WrittenField } from "@/lib/leaders/quality/fields";
import { kickLeaderReading } from "@/lib/leaders/quality/kick";
import { checkAnswer } from "@/lib/leaders/quality/scorer";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type UpdateResult = Result<{
  done: boolean;
  /** For each answer that still needs something, a kind note and how many tries are left. */
  notes?: Partial<Record<WrittenField, { note: string; triesLeft: number }>>;
}>;

/**
 * The applicant adds to the answers they were asked about. Each new text gets the same quick check as on the apply
 * screens; only when every one passes does the database take the new answers and send the application for a second reading.
 */
export async function updateAnswersAction(appId: string, answers: Record<string, string>): Promise<UpdateResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || !answers || typeof answers !== "object") return { ok: false, message: TRY_AGAIN };

  const fresh: Partial<Record<WrittenField, string>> = {};
  for (const [field, value] of Object.entries(answers)) {
    if (!isWrittenField(field) || typeof value !== "string") return { ok: false, message: TRY_AGAIN };
    fresh[field] = value.trim().slice(0, MAX_ANSWER_LENGTH[field]);
  }
  const fields = WRITTEN_FIELDS.filter((f) => fresh[f] !== undefined);
  if (fields.length === 0) return { ok: false, message: "Change at least one answer first." };

  const token = workerToken();
  if (!token) return { ok: false, message: "Checking is not available right now. Please try again in a little while." };
  const deps = { rpc: workerRpc(token), provider: providerFromEnv() };

  const outcomes = await Promise.all(fields.map((field) => checkAnswer(deps, { application: appId, field, text: fresh[field] ?? "" })));
  const notes: NonNullable<Extract<UpdateResult, { ok: true }>["notes"]> = {};
  for (const [i, outcome] of outcomes.entries()) {
    const field = fields[i];
    switch (outcome.kind) {
      case "result":
        if (!outcome.passes) notes[field] = { note: outcome.note ?? "Tell us a little more here, in your own words.", triesLeft: outcome.triesLeft };
        break;
      case "limited":
        return { ok: false, message: "You have tried a lot of versions today. Please come back tomorrow and carry on." };
      case "consent":
        return { ok: false, message: "Please agree to the updated wording on your Lead page first." };
      case "skip":
        return { ok: false, message: "Updating is not open right now." };
      case "error":
        return { ok: false, message: TRY_AGAIN };
    }
  }
  if (Object.keys(notes).length > 0) return { ok: true, done: false, notes };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resubmit_leader_answers", { p_app: appId, p_answers: fresh });
  if (error) return { ok: false, message: friendly(error) };
  kickLeaderReading();
  revalidatePath("/lead");
  return { ok: true, done: true };
}

/** "I would like a person to read it as it is." Hands the application to the review panel. */
export async function askPersonAction(appId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ask_leader_person_look", { p_app: appId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

function refresh() {
  revalidatePath("/circle");
  revalidatePath("/home");
}

/** Looks again, now. Used when a member wants fresh results or circles were added. */
export async function refreshMatchesAction(): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("match_me", { p_refresh: true });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** Commits to one circle. The database re-checks the seat, the agreement and that the circle was shown. */
export async function chooseCircleAction(circleId: string, agreed: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(circleId) || typeof agreed !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("choose_circle", { p_circle: circleId, p_agree: agreed, p_version: AGREEMENT_VERSION });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function releaseSeatAction(reason: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("release_my_seat", { p_reason: typeof reason === "string" ? reason.slice(0, 300) : null });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function starterListAction(join: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("join_starter_list", { p_join: Boolean(join) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

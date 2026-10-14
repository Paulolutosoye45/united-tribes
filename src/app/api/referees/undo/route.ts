import { revalidatePath } from "next/cache";
import { guard, json, problem, refusal } from "@/lib/leaders/referee/api";
import { isUuid } from "@/lib/leaders/errors";

export const dynamic = "force-dynamic";

/** Puts the list back as it was before the latest upload. */
export async function POST(request: Request) {
  const allowed = await guard(request);
  if (allowed instanceof Response) return allowed;
  let body: { batch?: unknown };
  try {
    body = await request.json();
  } catch {
    return problem("We couldn’t read that request. Try again.", 400);
  }
  if (!isUuid(body.batch)) return problem("That upload could not be found.", 400);
  const { error } = await allowed.supabase.rpc("referee_import_undo", { p_batch: body.batch });
  if (error) return refusal(error);
  revalidatePath("/admin/referees");
  return json({ ok: true });
}

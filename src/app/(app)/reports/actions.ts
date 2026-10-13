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

const KINDS = ["programme", "pastorate", "community", "season"];

/** Makes a report now. `month` is "YYYY-MM" (any month up to this one); a season report ignores it. */
export async function makeReportAction(kind: string, month: string, community: string | null): Promise<Result<{ id: string }>> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!KINDS.includes(kind)) return { ok: false, message: "Choose the kind of report." };
  if (kind === "community" && !isUuid(community)) return { ok: false, message: "Choose a community." };
  const first = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null;
  if (kind !== "season" && !first) return { ok: false, message: "Choose the month." };

  const { data, error } = await supabase.rpc("generate_report", {
    p_kind: kind,
    p_month: kind === "season" ? null : first,
    p_community: kind === "community" ? community : null,
    p_season: null,
  });
  if (error) return { ok: false, message: friendly(error) };
  const id = (data as { id?: unknown } | null)?.id;
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  revalidatePath("/reports");
  return { ok: true, id };
}

/** Replaces the summary at the top of a report. Blank clears it (the next monthly run writes a new one). */
export async function saveSummaryAction(id: string, summary: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || typeof summary !== "string") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("set_report_summary", { p_report: id, p_summary: summary.slice(0, 2400) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/reports");
  revalidatePath(`/reports/${id}`);
  return { ok: true };
}

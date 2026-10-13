"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/system", "/admin"];

export async function refreshBiAction(): Promise<Result> {
  return plain(await run("bi_refresh", undefined, PAGES));
}

/** The secret is shown once, here, and never stored: the database keeps only its fingerprint. */
export async function createTokenAction(label: string): Promise<{ ok: true; secret: string } | { ok: false; message: string }> {
  const done = await run<string>("create_worker_token", { p_label: text(label, 100) }, PAGES);
  if (!done.ok) return done;
  return typeof done.data === "string" ? { ok: true, secret: done.data } : { ok: false, message: TRY_AGAIN };
}

export async function revokeTokenAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("revoke_worker_token", { p_id: id }, PAGES));
}

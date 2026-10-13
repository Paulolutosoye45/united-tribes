"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";

const KEY = /^[a-z_]{2,40}$/;
const PAGES = ["/admin/targets", "/dashboard", "/reports", "/admin"];

export async function setTargetAction(key: string, value: number): Promise<Result> {
  if (typeof key !== "string" || !KEY.test(key) || typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("set_kpi_target", { p_key: key, p_value: value }, PAGES));
}

export async function resetTargetAction(key: string): Promise<Result> {
  if (typeof key !== "string" || !KEY.test(key)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("reset_kpi_target", { p_key: key }, PAGES));
}

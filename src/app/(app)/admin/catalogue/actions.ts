"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/catalogue", "/admin/guides/layers", "/admin"];
const bad: Result = { ok: false, message: TRY_AGAIN };

export async function saveCommunityAction(id: string | null, name: string, description: string, active: boolean): Promise<Result> {
  if (id !== null && !isUuid(id)) return bad;
  return plain(await run("save_community", { p_id: id, p_name: text(name, 200), p_description: text(description, 600), p_active: active !== false }, PAGES));
}

export async function saveFamilyAction(id: string | null, name: string): Promise<Result> {
  if (id !== null && !isUuid(id)) return bad;
  return plain(await run("save_goal_family", { p_id: id, p_name: text(name, 200) }, PAGES));
}

export async function saveGoalAction(id: string | null, community: string, family: string, title: string): Promise<Result> {
  if ((id !== null && !isUuid(id)) || !isUuid(community) || !isUuid(family)) return bad;
  return plain(await run("save_goal", { p_id: id, p_community: community, p_family: family, p_title: text(title, 300) }, PAGES));
}

export async function setGoalActiveAction(id: string, active: boolean): Promise<Result> {
  if (!isUuid(id)) return bad;
  return plain(await run("set_goal_active", { p_id: id, p_active: active !== false }, PAGES));
}

export async function setTrackActiveAction(id: string, active: boolean): Promise<Result> {
  if (!isUuid(id)) return bad;
  return plain(await run("set_track_active", { p_id: id, p_active: active !== false }, PAGES));
}

export async function adoptWriteInAction(original: string, community: string, family: string, title: string): Promise<Result> {
  if (!isUuid(community) || !isUuid(family)) return bad;
  return plain(await run("adopt_write_in", { p_text: text(original, 400), p_community: community, p_family: family, p_title: text(title, 300) }, PAGES));
}

export async function dismissWriteInAction(original: string): Promise<Result> {
  return plain(await run("dismiss_write_in", { p_text: text(original, 400) }, PAGES));
}

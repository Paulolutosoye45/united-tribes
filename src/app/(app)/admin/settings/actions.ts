"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";

export async function saveSettingsAction(vision: string, mission: string, formUrl: string): Promise<Result> {
  return plain(await run("save_church_settings", { p_vision: text(vision, 1500), p_mission: text(mission, 1500), p_form_url: text(formUrl, 600) }, ["/admin/settings", "/admin", "/lead/academy", "/testimonies"]));
}

/** Opens a second centre. Only works once the platform switch is on (docs/MULTI-CENTRE.md). */
export async function createCentreAction(slug: string, name: string): Promise<Result> {
  return plain(await run("create_centre", { p_slug: text(slug, 100), p_name: text(name, 200) }, ["/admin/settings"]));
}

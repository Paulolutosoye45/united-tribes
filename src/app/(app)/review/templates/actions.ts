"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { communitySentence } from "@/lib/cards/templates";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/review/templates", "/review/cards", "/admin/catalogue", "/admin/leader-pipeline", "/lead/tribe", "/join"];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FIELDS = new Set([
  "title", "who_for", "loving_god", "loving_others", "loving_life", "week12_outcome", "arc_1", "arc_2", "arc_3", "guardrail", "who_leads_well",
  "track_slugs", "rhythm_slot", "rhythm_mode", "demand_structure", "demand_connection", "demand_teaching", "demand_doing", "sensitive",
]);

export type TemplateResult = { ok: true; note?: string } | { ok: false; message: string };

/** Saves the fields that changed on one card. A signed-off card goes back to waiting for sign-off; the database says so in the reply. */
export async function saveTemplateAction(slug: string, fields: Record<string, unknown>): Promise<TemplateResult> {
  if (typeof slug !== "string" || !SLUG.test(slug) || !fields || typeof fields !== "object") return { ok: false, message: TRY_AGAIN };
  for (const key of Object.keys(fields)) if (!FIELDS.has(key)) return { ok: false, message: TRY_AGAIN };
  if (Object.keys(fields).length === 0) return { ok: false, message: "Nothing has changed." };
  const done = (await run("card_template_save", { p_slug: slug, p_fields: fields }, PAGES)) as Done<{ status?: string } | null>;
  if (!done.ok) return done;
  return { ok: true, note: done.data?.status === "draft" ? "Saved. This card now waits for sign-off again." : "Saved." };
}

/** Signs one card off. This is also what makes its goal live, so the card can be chosen by members and leaders. */
export async function signOffTemplateAction(slug: string): Promise<TemplateResult> {
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("card_template_sign_off", { p_slug: slug }, PAGES)) as Done<{ already?: boolean; new_goal?: boolean } | null>;
  if (!done.ok) return done;
  if (done.data?.already) return { ok: true, note: "This card was already signed off." };
  return { ok: true, note: done.data?.new_goal ? "Signed off. A new goal now exists for it." : "Signed off." };
}

/** Signs off every card in one community that is waiting, except the sensitive ones. */
export async function signOffCommunityAction(communityId: string, name: string): Promise<TemplateResult> {
  if (!isUuid(communityId)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("card_template_sign_off_community", { p_community: communityId }, PAGES)) as Done<{ signed?: unknown; left_for_one_by_one?: unknown } | null>;
  if (!done.ok) return done;
  const signed = Array.isArray(done.data?.signed) ? done.data.signed.length : 0;
  const left = typeof done.data?.left_for_one_by_one === "number" ? done.data.left_for_one_by_one : 0;
  return { ok: true, note: communitySentence({ signed, left }, typeof name === "string" && name ? name : "this community") };
}

/** Takes a card out of use. Its goal is switched off for new tribes; tribes already running on it are not touched. */
export async function retireTemplateAction(slug: string): Promise<TemplateResult> {
  if (typeof slug !== "string" || !SLUG.test(slug)) return { ok: false, message: TRY_AGAIN };
  const done = await run("card_template_retire", { p_slug: slug }, PAGES);
  return done.ok ? { ok: true, note: "Retired." } : done;
}

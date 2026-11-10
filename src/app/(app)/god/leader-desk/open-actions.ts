"use server";

import { run } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { checkSettings, parseOpenPreview, parseOpenResult, type OpenPreview, type OpenResult } from "@/lib/god/desk-open";

const PAGES = ["/god/leader-desk"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. The database refuses them again. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/** Who in a draft group would be placed if its tribe were opened now, and why anyone could not be. It changes nothing. */
export async function previewOpenAction(group: string): Promise<{ ok: true; preview: OpenPreview } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_open_preview", { p_group: group }, []);
  if (!done.ok) return done;
  const preview = parseOpenPreview(done.data);
  return preview ? { ok: true, preview } : bad();
}

/** Places the draft's members in the group's tribe, one at a time, by the office's own function. In Rehearsal it only counts. The database checks every rule again. */
export async function openTribeAction(group: string): Promise<{ ok: true; result: OpenResult } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_open_tribe", { p_group: group }, PAGES);
  if (!done.ok) return done;
  const result = parseOpenResult(done.data);
  return result ? { ok: true, result } : bad();
}

/** Changes the offer window, the backups per group and the two pipeline limits, with the reason. Each number is checked against its range before the database is asked. */
export async function saveLimitsAction(offerHours: number, backups: number, saidYesDays: number, cardDays: number, reason: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (![offerHours, backups, saidYesDays, cardDays].every((n) => Number.isInteger(n)) || typeof reason !== "string") return bad();
  const checked = checkSettings({ offerHours: String(offerHours), backups: String(backups), saidYesDays: String(saidYesDays), cardDays: String(cardDays), reason });
  if (!checked.ok) return { ok: false, message: checked.message };
  const done = await run(
    "desk_pipeline_settings_set",
    { p_offer_hours: offerHours, p_backups: backups, p_said_yes_days: saidYesDays, p_card_days: cardDays, p_reason: checked.value.reason },
    PAGES,
  );
  return done.ok ? { ok: true } : done;
}

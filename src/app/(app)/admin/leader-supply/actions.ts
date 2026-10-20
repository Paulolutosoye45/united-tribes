"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { parseSuggestions, type Suggestions } from "@/lib/leaders/board";

const PAGES = ["/admin/leader-supply", "/admin", "/lead", "/lead/tribe"];

export type SuggestResult = { ok: true; suggestions: Suggestions } | { ok: false; message: string };
export type OfferResult = { ok: true; waiting?: number } | { ok: false; message: string };

/** Asks the database who could lead a goal that has a gap. Nothing is written: the leaders are scored fresh each time. */
export async function suggestLeadersAction(goalId: string): Promise<SuggestResult> {
  if (!isUuid(goalId)) return { ok: false, message: TRY_AGAIN };
  const done = await run("leader_suggest", { p_goal: goalId }, []);
  if (!done.ok) return done;
  const suggestions = parseSuggestions(done.data);
  return suggestions ? { ok: true, suggestions } : { ok: false, message: TRY_AGAIN };
}

/** Offers a goal to one leader. The leader is sent one message that says how many are waiting and nothing about who they are. */
export async function sendOfferAction(goalId: string, personId: string): Promise<OfferResult> {
  if (!isUuid(goalId) || !isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("leader_offer_send", { p_goal: goalId, p_person: personId }, PAGES)) as Done<{ waiting?: unknown } | null>;
  if (!done.ok) return done;
  const waiting = done.data && typeof done.data.waiting === "number" ? done.data.waiting : undefined;
  return { ok: true, waiting };
}

/** Takes back an offer that has not been answered. The leader is not told, and sees nothing on their page. */
export async function withdrawOfferAction(offerId: string): Promise<OfferResult> {
  if (!isUuid(offerId)) return { ok: false, message: TRY_AGAIN };
  const done = await run("leader_offer_withdraw", { p_offer: offerId }, PAGES);
  return done.ok ? { ok: true } : done;
}

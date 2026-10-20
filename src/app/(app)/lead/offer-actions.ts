"use server";

import { run } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

export type AnswerOfferResult = { ok: true; accepted: boolean } | { ok: false; message: string };

/**
 * A leader answers an offer. Yes starts their Tribe Card with the goal, community and life stage already chosen and the three lines
 * of the Success Picture written for them to make their own; a pastor still approves the card. No changes nothing else.
 */
export async function answerOfferAction(offerId: string, accept: boolean): Promise<AnswerOfferResult> {
  if (!isUuid(offerId) || typeof accept !== "boolean") return { ok: false, message: TRY_AGAIN };
  const done = await run("leader_offer_respond", { p_offer: offerId, p_accept: accept }, ["/lead", "/lead/tribe", "/admin/leader-supply", "/admin"]);
  return done.ok ? { ok: true, accepted: accept } : done;
}

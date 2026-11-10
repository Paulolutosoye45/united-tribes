"use server";

import { run } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { parseCandidates, type Candidates } from "@/lib/god/desk-offers";

const PAGES = ["/god/leader-desk"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. The database refuses them again. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/** The members who could be offered this group to lead, best first, each already past every rule. A group that cannot be offered a leader says why instead. */
export async function candidatesAction(group: string): Promise<{ ok: true; candidates: Candidates } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_offer_candidates", { p_group: group, p_limit: 30 }, []);
  if (!done.ok) return done;
  const candidates = parseCandidates(done.data);
  return candidates ? { ok: true, candidates } : bad();
}

/** Offers a draft group to one member to lead, and to up to two backups in order. In Rehearsal it is only written down. The database checks every rule again. */
export async function sendOfferAction(group: string, people: string[]): Promise<{ ok: true; sent: boolean } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group) || !Array.isArray(people) || people.length < 1 || people.length > 3 || !people.every(isUuid)) return bad();
  const done = await run<{ status?: string }>("desk_offer_send", { p_group: group, p_people: people }, PAGES);
  if (!done.ok) return done;
  return { ok: true, sent: done.data?.status === "open" };
}

/** Withdraws an offer that has not been answered. With "all", every offer of the same round goes with it; otherwise the next backup is asked. */
export async function cancelOfferAction(offer: string, all: boolean): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(offer) || typeof all !== "boolean") return bad();
  const done = await run("desk_offer_cancel", { p_offer: offer, p_all: all }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Stops, or restarts, the automatic asking of backups on one group. */
export async function pauseBackupsAction(group: string, paused: boolean): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group) || typeof paused !== "boolean") return bad();
  const done = await run("desk_offers_pause", { p_group: group, p_paused: paused }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** A member said yes below the usual fit: you appoint them, or decline for them. */
export async function reviewOfferAction(offer: string, approve: boolean): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(offer) || typeof approve !== "boolean") return bad();
  const done = await run("desk_offer_review", { p_offer: offer, p_approve: approve }, PAGES);
  return done.ok ? { ok: true } : done;
}

"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { parseFound } from "@/lib/features/parse";
import type { Found } from "@/lib/features/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { cleanAudience, isFactKey, parsePlan, parseSent } from "@/lib/profile/parse";
import type { Plan, Sent } from "@/lib/profile/types";

const PAGES = ["/god/details"];

/**
 * Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything, and the database refuses
 * again (every function behind them begins god_only()). Only the owner can ask people to confirm their details.
 */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

function clean(audience: unknown, facts: unknown, mode: unknown) {
  const a = cleanAudience(audience, isUuid);
  const f = Array.isArray(facts) && facts.length >= 1 && facts.length <= 3 && facts.every(isFactKey) ? ([...new Set(facts as string[])] as string[]) : null;
  const m = mode === "live" || mode === "rehearsal" ? mode : null;
  return a && f && f.length > 0 && m ? { a, f, m } : null;
}

/** How many would be asked, and how many are left out for each reason. Never who. */
export async function detailsPlanAction(audience: unknown, facts: unknown, mode: unknown): Promise<{ ok: true; plan: Plan } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const c = clean(audience, facts, mode);
  if (!c) return bad();
  const done = await run("god_details_plan", { p_audience: c.a, p_facts: c.f, p_mode: c.m });
  if (!done.ok) return done;
  const plan = parsePlan(done.data);
  return plan ? { ok: true, plan } : bad();
}

/** Asks (live), or rehearses. A rehearsal writes what would be sent and sends nothing. */
export async function detailsSendAction(audience: unknown, facts: unknown, mode: unknown): Promise<{ ok: true; sent: Sent } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const c = clean(audience, facts, mode);
  if (!c) return bad();
  const done = await run("god_details_send", { p_audience: c.a, p_facts: c.f, p_mode: c.m }, PAGES);
  if (!done.ok) return done;
  const sent = parseSent(done.data);
  return sent ? { ok: true, sent } : bad();
}

/** Stops a run: links stop opening and what has not gone out is not sent. What people answered stays. */
export async function detailsCloseAction(check: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(check)) return bad();
  const done = await run("god_details_close", { p_check: check }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Finds a tribe or a person to ask. */
export async function detailsFindAction(scope: string, query: string): Promise<{ ok: true; found: Found[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (scope !== "tribe" && scope !== "person") return bad();
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  const done = (await run("god_feature_find", { p_scope: scope, p_q: q })) as Done;
  return done.ok ? { ok: true, found: parseFound(done.data) } : done;
}

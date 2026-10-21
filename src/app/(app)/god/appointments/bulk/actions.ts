"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { loadLeaderCatalogue } from "@/lib/leaders/server";
import { MAX_BYTES, MAX_ROWS, readLeaderSheet, readLeaderText, type SheetPerson, type SheetProblem } from "@/lib/placement/sheet";
import { parseGoalOptions, type GoalOption } from "@/lib/placement/types";
import { createClient } from "@/lib/supabase/server";

const PAGES = ["/god/appointments/bulk", "/god/appointments", "/god", "/god/tribes", "/review/cards"];

async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

export type ReadResult = { ok: true; people: SheetPerson[]; problems: SheetProblem[] } | Fail;

/** Reads the list the owner uploaded or pasted. Nothing is saved: the owner sees what was understood, and what was not, first. */
export async function readSheetAction(formData: FormData): Promise<ReadResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const catalogue = await loadLeaderCatalogue(await createClient());
  const shape = {
    tracks: catalogue.tracks.map((t) => ({ slug: t.slug, name: t.name })),
    communities: catalogue.communities.map((c) => ({ slug: c.slug, name: c.name, goals: c.goals.map((g) => ({ slug: g.slug, title: g.title })) })),
  };
  const file = formData.get("file");
  const pasted = formData.get("text");
  let read;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { ok: false, message: "That file is too large. A list of up to 300 people is well under 2 MB." };
    read = readLeaderSheet(file.name, Buffer.from(await file.arrayBuffer()), shape);
  } else if (typeof pasted === "string" && pasted.trim()) {
    read = readLeaderText(pasted.slice(0, MAX_BYTES), shape);
  } else {
    return { ok: false, message: "Choose a file, or paste the list." };
  }
  return read.ok ? { ok: true, people: read.people, problems: read.problems.slice(0, 100) } : read;
}

/** Makes the plan: the approved leaders with no tribe yet, and anyone on the list, each paired with a goal that needs a leader. */
export async function planLeadersAction(people: SheetPerson[], includeApproved: boolean): Promise<{ ok: true; run: string } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!Array.isArray(people) || people.length > MAX_ROWS) return { ok: false, message: `Use up to ${MAX_ROWS} people at a time.` };
  const sheet = people.map((p) => ({
    email: String(p.email ?? "").slice(0, 200),
    track: String(p.track ?? ""),
    lead_best: String(p.lead_best ?? ""),
    ...(p.community ? { community: String(p.community) } : {}),
    ...(p.goal ? { goal: String(p.goal) } : {}),
    ...(p.goal && p.relation ? { relation: String(p.relation) } : {}),
    care_cleared: p.care_cleared === true,
  }));
  const done = (await run("placement_leaders_plan", { p_sheet: sheet, p_include_approved: includeApproved === true }, PAGES)) as Done<{ run?: string } | null>;
  if (!done.ok) return done;
  const id = done.data?.run;
  return isUuid(id) ? { ok: true, run: id } : bad();
}

export async function goalOptionsAction(runId: string, person: string): Promise<{ ok: true; options: GoalOption[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(person)) return bad();
  const done = await run("placement_leaders_options", { p_run: runId, p_person: person });
  return done.ok ? { ok: true, options: parseGoalOptions(done.data) } : done;
}

export async function adjustLeaderAction(runId: string, person: string, action: "move" | "remove", goal: string | null): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(person) || !["move", "remove"].includes(action) || (action === "move" && !isUuid(goal))) return bad();
  const done = await run("placement_leaders_adjust", { p_run: runId, p_person: person, p_action: action, p_goal: action === "move" ? goal : null }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function approveLeadersAction(runId: string, expected: number): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !Number.isInteger(expected) || expected < 0) return bad();
  const done = await run("placement_leaders_approve", { p_run: runId, p_expected: expected }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function cancelLeadersAction(runId: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = await run("placement_leaders_cancel", { p_run: runId }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Appoints the next batch. The page presses it again until nothing is left. */
export async function applyLeadersAction(runId: string): Promise<{ ok: true; status: string; done: number; failed: number; left: number } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = (await run("placement_leaders_apply", { p_run: runId }, PAGES)) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { ok: true, status: String(d.status ?? ""), done: n(d.done), failed: n(d.failed), left: n(d.left) };
}

"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { formPayload, formProblem, parseFound, parseSuggestions, SEARCH_MIN, type AppointForm, type FoundPerson, type Suggestions } from "@/lib/god/appointments";

const PAGES = ["/god/appointments", "/god", "/god/tribes", "/review/cards", "/lead/tribe", "/lead"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };

export type FindResult = { ok: true; people: FoundPerson[] } | { ok: false; message: string };
export type SuggestResult = { ok: true; suggestions: Suggestions } | { ok: false; message: string };
export type AppointResult = { ok: true; note: string } | { ok: false; message: string };

/** Looks for a person by name or email. Fewer than two letters finds nobody. */
export async function findPeopleAction(query: string): Promise<FindResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  if (q.length < SEARCH_MIN) return { ok: true, people: [] };
  const done = await run("god_appointment_find", { p_q: q });
  return done.ok ? { ok: true, people: parseFound(done.data) } : done;
}

/** Asks which tribes suit this person. Nothing is saved. */
export async function suggestAction(person: string, form: AppointForm): Promise<SuggestResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || !form || typeof form !== "object") return { ok: false, message: TRY_AGAIN };
  const problem = formProblem(form);
  if (problem) return { ok: false, message: problem };
  const done = await run("god_appointment_suggest", { p_person: person, p_form: formPayload(form) });
  if (!done.ok) return done;
  const suggestions = parseSuggestions(done.data);
  return suggestions ? { ok: true, suggestions } : { ok: false, message: TRY_AGAIN };
}

/** Appoints the person to lead the chosen tribe. */
export async function appointAction(person: string, form: AppointForm, goal: string, note: string): Promise<AppointResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || !isUuid(goal) || !form || typeof form !== "object") return { ok: false, message: TRY_AGAIN };
  const problem = formProblem(form);
  if (problem) return { ok: false, message: problem };
  const why = typeof note === "string" ? note.trim().slice(0, 500) : "";
  const done = (await run("god_appoint_leader", { p_person: person, p_form: formPayload(form), p_goal: goal, p_note: why || null }, PAGES)) as Done<{ ok?: boolean } | null>;
  if (!done.ok) return done;
  return { ok: true, note: "Appointed. Their Tribe Card is started. A pastor approves it and the Academy certifies them before members see the tribe." };
}

/** Ends an appointment. The database refuses while members have joined the tribe, and says so. */
export async function stepDownAction(appointment: string, reason: string): Promise<AppointResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(appointment)) return { ok: false, message: TRY_AGAIN };
  const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const done = (await run("god_appointment_step_down", { p_appointment: appointment, p_reason: why || null }, PAGES)) as Done<{ tribe_closed?: boolean; role_removed?: boolean } | null>;
  if (!done.ok) return done;
  const parts = ["Stepped down."];
  if (done.data?.tribe_closed) parts.push("Their empty tribe is closed.");
  if (done.data?.role_removed) parts.push("The leader role is taken back.");
  return { ok: true, note: parts.join(" ") };
}

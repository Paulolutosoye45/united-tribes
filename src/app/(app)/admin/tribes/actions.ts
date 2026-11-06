"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { PLACE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { parseFind, parseOneCheck, type FindRow, type OneCheck } from "@/lib/placement/types";

// Place or move one person from Admin. The owner (with God Mode open), an admin and a director use these; the database decides again, every time,
// who may do what, and says in words what is wrong. A page here only refuses early the people who could never succeed.

type Fail = { ok: false; message: string };
const NOT_AVAILABLE: Fail = { ok: false, message: "That page is not available." };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/** "owner" when God Mode is open, "office" for an admin or a director, null for anyone else. */
async function who(): Promise<"owner" | "office" | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.god === "open") return "owner";
  return hasAnyRole(session.roles, PLACE_ROLES) ? "office" : null;
}

const pagesFor = (person: string, tribe?: string) => [
  "/admin/people",
  `/admin/people/${person}`,
  "/admin/tribes",
  ...(tribe ? [`/admin/tribes/${tribe}`] : []),
  "/god/placement",
  `/god/people/${person}`,
];

const CODE = /^[a-z_]{2,30}$/;
const codesOk = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every((c) => typeof c === "string" && CODE.test(c));

/** Finds members by name, e-mail or number. Two letters or seven digits at least; the database returns at most 15. */
export async function findMemberAction(query: string): Promise<{ ok: true; rows: FindRow[] } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (typeof query !== "string") return bad();
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return { ok: true, rows: [] };
  const done = (await run("placement_find", { p_query: q })) as Done<unknown>;
  return done.ok ? { ok: true, rows: parseFind(done.data) } : done;
}

/** Asks the database what would stop placing (or moving) this person in this tribe, and what needs a tick and a reason. Changes nothing. */
export async function officeCheckAction(person: string, tribe: string, move: boolean): Promise<{ ok: true; check: OneCheck } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (!isUuid(person) || !isUuid(tribe)) return bad();
  const done = (await run(move ? "placement_move_check" : "placement_one_check", { p_person: person, p_tribe: tribe })) as Done<unknown>;
  if (!done.ok) return done;
  const check = parseOneCheck(done.data);
  return check ? { ok: true, check } : bad();
}

type PlaceInput = { person: string; tribe: string; accept: string[]; reason: string; agreed: boolean; move: boolean };

function placeArgs(input: PlaceInput): Fail | null {
  if (!input || !isUuid(input.person) || !isUuid(input.tribe) || !codesOk(input.accept)) return bad();
  if (typeof input.reason !== "string" || input.reason.trim().length > 200) return { ok: false, message: "Keep the reason under 200 characters." };
  return null;
}

/** Places (or moves) one person. Every warning must be ticked and explained; the database checks it all again, and who may accept which. */
export async function officePlaceAction(input: PlaceInput): Promise<{ ok: true; run: string; moved: boolean } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  const refused = placeArgs(input);
  if (refused) return refused;
  const reason = input.reason.trim();
  const done = (await run(
    input.move ? "placement_one_move" : "placement_one_place",
    { p_person: input.person, p_tribe: input.tribe, p_accept: input.accept, p_reason: reason || null, p_agreed: input.agreed === true },
    pagesFor(input.person, input.tribe),
  )) as Done<{ run?: string; moved?: boolean } | null>;
  if (!done.ok) return done;
  const id = done.data?.run;
  return isUuid(id) ? { ok: true, run: id, moved: done.data?.moved === true } : bad();
}

/** An admin or a director asks the owner to place someone past a warning only the owner may accept. */
export async function officeAskAction(input: PlaceInput & { told: boolean }): Promise<{ ok: true; request: string } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  const refused = placeArgs(input);
  if (refused) return refused;
  const done = (await run(
    "placement_office_ask",
    { p_person: input.person, p_tribe: input.tribe, p_accept: input.accept, p_reason: input.reason.trim(), p_told: input.told === true, p_move: input.move === true },
    pagesFor(input.person, input.tribe),
  )) as Done<{ request?: string } | null>;
  if (!done.ok) return done;
  const id = done.data?.request;
  return isUuid(id) ? { ok: true, request: id } : bad();
}

/** Takes back a request that has not been answered. */
export async function withdrawRequestAction(request: string, person: string): Promise<{ ok: true } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (!isUuid(request) || !isUuid(person)) return bad();
  const done = await run("placement_request_withdraw", { p_req: request }, pagesFor(person));
  return done.ok ? { ok: true } : done;
}

/** Undoes a placement made from here, until the tribe's leader has been told. A move puts the old seat back. */
export async function undoOneAction(runId: string, person: string, tribe?: string): Promise<{ ok: true; restored: boolean } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(person) || (tribe !== undefined && !isUuid(tribe))) return bad();
  const done = (await run("placement_undo", { p_run: runId }, pagesFor(person, tribe))) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  return { ok: true, restored: done.data?.restored === true };
}

// --- The owner's: look again at a request, and answer it ---

export async function requestCheckAction(request: string): Promise<{ ok: true; status: string; check: OneCheck } | Fail> {
  if ((await who()) !== "owner") return NOT_AVAILABLE;
  if (!isUuid(request)) return bad();
  const done = (await run("placement_request_check", { p_req: request })) as Done<{ status?: string; check?: unknown } | null>;
  if (!done.ok) return done;
  const check = parseOneCheck(done.data?.check);
  return check ? { ok: true, status: typeof done.data?.status === "string" ? done.data.status : "open", check } : bad();
}

export async function decideRequestAction(input: { request: string; person: string; decision: "approve" | "decline"; accept: string[]; note: string }): Promise<{ ok: true; approved: boolean } | Fail> {
  if ((await who()) !== "owner") return NOT_AVAILABLE;
  if (!input || !isUuid(input.request) || !isUuid(input.person) || !["approve", "decline"].includes(input.decision) || !codesOk(input.accept)) return bad();
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
  const done = (await run(
    "placement_request_decide",
    { p_req: input.request, p_decision: input.decision, p_accept: input.accept, p_note: note || null },
    pagesFor(input.person),
  )) as Done<{ approved?: boolean } | null>;
  return done.ok ? { ok: true, approved: done.data?.approved === true } : done;
}

// --- Remove a member from a tribe, and put them back ---

/**
 * Takes a member out of a tribe: their seat is released and they go back to the pile waiting to be placed. The reason is for the office only.
 * The database refuses a young person, an open care matter, yourself, a seat that is gone, and more than 20 a day, and says why in words.
 */
export async function removeFromTribeAction(input: { tribe: string; person: string; reason: string }): Promise<{ ok: true; name: string } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (!input || !isUuid(input.tribe) || !isUuid(input.person)) return bad();
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 10 || reason.length > 300) return { ok: false, message: "Write a reason of 10 to 300 characters. Only the church’s office will read it." };
  const done = (await run("admin_remove_member", { p_tribe: input.tribe, p_person: input.person, p_reason: reason }, [...pagesFor(input.person, input.tribe), "/lead/tribe"])) as Done<{ name?: string } | null>;
  if (!done.ok) return done;
  return { ok: true, name: typeof done.data?.name === "string" ? done.data.name : "They" };
}

/** Puts a member back in the tribe the office took them out of, within 14 days, if the tribe is open, has room and they have not joined another. */
export async function putBackAction(removal: string, person: string, tribe: string): Promise<{ ok: true; name: string } | Fail> {
  if (!(await who())) return NOT_AVAILABLE;
  if (!isUuid(removal) || !isUuid(person) || !isUuid(tribe)) return bad();
  const done = (await run("admin_put_back", { p_removal: removal }, [...pagesFor(person, tribe), "/lead/tribe"])) as Done<{ name?: string } | null>;
  if (!done.ok) return done;
  return { ok: true, name: typeof done.data?.name === "string" ? done.data.name : "They" };
}

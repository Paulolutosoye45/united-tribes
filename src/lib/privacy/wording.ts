import { ERASURE_BLOCKERS, type ErasureBlocker, type ErasureRequest } from "@/lib/admin/types";
import { plural } from "@/lib/dates";

/** What stands in the way of erasing someone, in words the office can act on. */
export const BLOCKER_TEXT: Record<ErasureBlocker, string> = {
  is_you: "This is your own account. Ask another admin to answer it.",
  leads_a_tribe: "They lead a tribe. Arrange another leader, or close the tribe, first. Then the tribe and its members stay as they are.",
  needs_an_admin: "They hold the admin, director or pastor role. Only an admin can erase them.",
  last_admin: "They are the last admin. Make someone else an admin first.",
};

export function blockerText(blocker: ErasureBlocker): string {
  return BLOCKER_TEXT[blocker];
}

/** Reads the queue the database sends, ignoring anything that is not the shape we expect. */
export function readQueue(value: unknown): ErasureRequest[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(ERASURE_BLOCKERS);
  return value.flatMap((raw): ErasureRequest[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.person !== "string" || typeof r.name !== "string" || typeof r.email !== "string" || typeof r.requested_at !== "string") return [];
    if (r.status !== "open" && r.status !== "declined") return [];
    return [
      {
        person: r.person,
        name: r.name,
        email: r.email,
        status: r.status,
        note: typeof r.note === "string" ? r.note : null,
        by_office: r.by_office === true,
        requested_at: r.requested_at,
        decided_at: typeof r.decided_at === "string" ? r.decided_at : null,
        decision_note: typeof r.decision_note === "string" ? r.decision_note : null,
        roles: Array.isArray(r.roles) ? r.roles.filter((x): x is string => typeof x === "string") : [],
        in_tribes: Number(r.in_tribes) || 0,
        care_records: Number(r.care_records) || 0,
        blockers: Array.isArray(r.blockers) ? r.blockers.filter((b): b is ErasureBlocker => typeof b === "string" && known.has(b)) : [],
      },
    ];
  });
}

/** What erasing this person would take with it, so the office is not surprised. One line each, only what applies. */
export function whatItTouches(r: Pick<ErasureRequest, "in_tribes" | "care_records" | "roles">): string[] {
  const out = ["Their account, their answers, messages, check-ins, steps, testimonies and photo."];
  if (r.in_tribes > 0) out.push(`Their place in ${plural(r.in_tribes, "tribe")}: the tribe stays, and their attendance goes from its record.`);
  if (r.care_records > 0) out.push(`${plural(r.care_records, "care record")} about them. Check that the church is not required to keep these before you go ahead.`);
  const roles = r.roles.filter((x) => x !== "member");
  if (roles.length > 0) out.push(`Their ${roles.join(", ").replaceAll("_", " ")} role${roles.length === 1 ? "" : "s"}.`);
  return out;
}

/** What a member reads under "Delete my account", for each state of their request. */
export type ErasureState =
  | { status: "none" }
  | { status: "open"; requested_at: string }
  | { status: "declined"; decided_at: string | null; decision_note: string };

export function readMyRequest(value: unknown): ErasureState {
  if (!value || typeof value !== "object") return { status: "none" };
  const r = value as Record<string, unknown>;
  if (r.status === "open" && typeof r.requested_at === "string") return { status: "open", requested_at: r.requested_at };
  if (r.status === "declined") return { status: "declined", decided_at: typeof r.decided_at === "string" ? r.decided_at : null, decision_note: typeof r.decision_note === "string" ? r.decision_note : "" };
  return { status: "none" };
}

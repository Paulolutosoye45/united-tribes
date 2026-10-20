/**
 * The Academy and the signed declaration, as the office has set them (Admin → Leader pipeline). The database decides what certification
 * needs and refuses what is switched off; this is how the screens follow it.
 *
 * Fail towards asking more. If the switches cannot be read, or arrive in a shape nobody expects, both count as Required, which is how
 * the Academy has always run. A failure to read can only make a screen stricter than the database, never more lenient.
 */

export type AcademyMode = "required" | "optional" | "off";
export type DeclarationMode = "required" | "off";

export type AcademyModes = {
  academy: AcademyMode;
  declaration: DeclarationMode;
  /** When each was last moved to where it stands now. Empty if it has never been moved. */
  academySince: string | null;
  declarationSince: string | null;
};

/** Today's process: the training and the declaration are both required. */
export const REQUIRED_MODES: AcademyModes = { academy: "required", declaration: "required", academySince: null, declarationSince: null };

const dateOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

/** Reads what the database gives (academy_switch, or the "modes" key of my_academy). Never throws. */
export function parseAcademyModes(raw: unknown): AcademyModes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return REQUIRED_MODES;
  const v = raw as Record<string, unknown>;
  return {
    academy: v.academy === "optional" || v.academy === "off" ? v.academy : "required",
    declaration: v.declaration === "off" ? "off" : "required",
    academySince: dateOrNull(v.academy_since),
    declarationSince: dateOrNull(v.declaration_since),
  };
}

/** What certification asks of a person, from the state the database gives. A key that is missing counts as needed. */
export type Needs = { modules: boolean; practice: boolean; declaration: boolean };

export function needsOf(state: { modules_needed?: boolean; practice_needed?: boolean; declaration_needed?: boolean } | null | undefined): Needs {
  return {
    modules: state?.modules_needed !== false,
    practice: state?.practice_needed !== false,
    declaration: state?.declaration_needed !== false,
  };
}

/** Whether there is any training to show a leader: the Academy, or the declaration on its own. */
export const trainingShown = (m: AcademyModes) => m.academy !== "off" || m.declaration === "required";

/** The Academy itself (modules, workshops, practice) is open to leaders. */
export const academyOpen = (m: AcademyModes) => m.academy !== "off";

/** Joins "a", "a and b", "a, b and c". */
export function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** “12 October 2026”, in Lagos time, written by hand so the server and the browser agree. */
export function sinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 60 * 60 * 1000); // Lagos is UTC+1 all year
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

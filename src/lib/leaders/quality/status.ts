import { WRITTEN_FIELDS, isWrittenField, type WrittenField } from "./fields";

/** Where an applicant's first check stands, as the database tells them. Never a score, a flag or a quote. */
export type FirstCheckState = "none" | "consent_needed" | "checking" | "strengthen" | "with_people" | "clear";

export type FirstCheckStatus = {
  mode: "off" | "shadow" | "on";
  state: FirstCheckState;
  consentOk: boolean;
  /** Kind notes on what to add, by answer. Only when state is "strengthen". */
  notes: Partial<Record<WrittenField, string>>;
  rewritesLeft: number;
  canRewriteNow: boolean;
  nextRewriteAt: string | null;
  refereesOpen: boolean;
  minWords: number;
};

const STATES: FirstCheckState[] = ["none", "consent_needed", "checking", "strengthen", "with_people", "clear"];

export function readFirstCheckStatus(value: unknown): FirstCheckStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const notes: Partial<Record<WrittenField, string>> = {};
  if (v.notes && typeof v.notes === "object") {
    for (const [k, note] of Object.entries(v.notes as Record<string, unknown>)) {
      if (isWrittenField(k) && typeof note === "string" && note.trim()) notes[k] = note;
    }
  }
  return {
    mode: v.mode === "on" || v.mode === "shadow" ? v.mode : "off",
    state: STATES.includes(v.state as FirstCheckState) ? (v.state as FirstCheckState) : "none",
    consentOk: v.consent_ok !== false,
    notes,
    rewritesLeft: typeof v.rewrites_left === "number" ? v.rewrites_left : 0,
    canRewriteNow: v.can_rewrite_now === true,
    nextRewriteAt: typeof v.next_rewrite_at === "string" ? v.next_rewrite_at : null,
    refereesOpen: v.referees_open !== false,
    minWords: typeof v.min_words === "number" ? v.min_words : 8,
  };
}

/** The answers with a note, in the order the application asks them. */
export const notedFields = (notes: Partial<Record<WrittenField, string>>): WrittenField[] => WRITTEN_FIELDS.filter((f) => notes[f]);

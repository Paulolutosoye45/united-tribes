import { SUPPORT_CHIPS } from "@/lib/intake/options";

export type OpenedNotes = { supportChips?: readonly string[]; supportNote?: string; leaderNote?: string };

const labelOf = new Map<string, string>(SUPPORT_CHIPS.map((c) => [c.id, c.label]));

/** "my-united-tribes-data-2026-10-12.json" */
export function exportFilename(now: Date = new Date()): string {
  return `my-united-tribes-data-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * The person's file: what the database holds, with the private notes added. Those are sealed with keys only the app has, so
 * the database cannot open them; they are opened here, for the person who wrote them, and go nowhere else.
 */
export function buildExport(data: Record<string, unknown>, notes: OpenedNotes, profile: unknown = null): Record<string, unknown> {
  const { about_this_file, ...rest } = data;
  return {
    about_this_file,
    ...rest,
    // What My page holds about the person (their facts and how they changed, their story, what they told the Care Team). Only what exists is named, and it
    // never overwrites what the database already put in the file.
    ...profileSection(profile, rest),
    your_private_notes: {
      what_would_help_care_for_you: {
        chosen: (notes.supportChips ?? []).map((id) => labelOf.get(id) ?? id),
        in_your_words: notes.supportNote ?? null,
      },
      note_to_your_leader: notes.leaderNote ?? null,
    },
  };
}

/** The part of the file that comes from My page: only a plain object, and only keys the file does not already have. */
function profileSection(profile: unknown, taken: Record<string, unknown>): Record<string, unknown> {
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return {};
  return Object.fromEntries(Object.entries(profile).filter(([k, v]) => v !== null && v !== undefined && !(k in taken) && k !== "about_this_file" && k !== "your_private_notes"));
}

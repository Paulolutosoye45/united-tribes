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
export function buildExport(data: Record<string, unknown>, notes: OpenedNotes): Record<string, unknown> {
  const { about_this_file, ...rest } = data;
  return {
    about_this_file,
    ...rest,
    your_private_notes: {
      what_would_help_care_for_you: {
        chosen: (notes.supportChips ?? []).map((id) => labelOf.get(id) ?? id),
        in_your_words: notes.supportNote ?? null,
      },
      note_to_your_leader: notes.leaderNote ?? null,
    },
  };
}

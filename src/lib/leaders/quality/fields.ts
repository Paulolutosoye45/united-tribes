/**
 * The five written answers on the leader application, and what each one asks. The questions are the ones the
 * apply screens show, so the checker judges an answer against the question the applicant actually saw.
 */
export const WRITTEN_FIELDS = ["goalStory", "why", "walked", "walkNote", "obstacles"] as const;
export type WrittenField = (typeof WRITTEN_FIELDS)[number];

export const isWrittenField = (value: unknown): value is WrittenField => typeof value === "string" && (WRITTEN_FIELDS as readonly string[]).includes(value);

export const FIELD_INFO: Record<WrittenField, { label: string; question: string; hint: string; step: "goal-story" | "why" | "walked" | "walk" | "obstacles" }> = {
  goalStory: {
    label: "Your story with the goal",
    question: "Tell us your story with this goal.",
    hint: "Where you started, what happened, and what you learned.",
    step: "goal-story",
  },
  why: {
    label: "Why you want to lead",
    question: "Why do you want to lead a tribe?",
    hint: "What you hope for the people in it.",
    step: "why",
  },
  walked: {
    label: "A time you walked with someone",
    question: "Tell us about a time you walked with someone through a hard season.",
    hint: "What did you do? And what did you choose not to do?",
    step: "walked",
  },
  walkNote: {
    label: "About your walk with God",
    question: "How is your walk with God right now? Say a little about why you gave that rating.",
    hint: "Honest beats high.",
    step: "walk",
  },
  obstacles: {
    label: "What could get in the way",
    question: "What could get in the way of leading well for twelve weeks?",
    hint: "Work, travel, family, your own energy, and what you would do about it.",
    step: "obstacles",
  },
};

/** The most each answer can hold. The same limits the apply screens put on the text boxes. */
export const MAX_ANSWER_LENGTH: Record<WrittenField, number> = { goalStory: 1500, why: 1000, walked: 1500, walkNote: 800, obstacles: 1000 };

/** Which application screen holds each answer, so a note can send the applicant to the right place. */
export const STEP_OF_FIELD: Record<WrittenField, string> = Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, FIELD_INFO[f].step])) as Record<WrittenField, string>;

/** Codes the first check can raise. The database accepts exactly these and drops anything else. */
export const FLAGS = [
  "instruction_attempt",
  "copied_or_templated",
  "duplicate_of_other",
  "same_in_two_answers",
  "unverified_evidence",
  "forced_through",
  "poor_fit",
  "off_topic",
  "generic_boilerplate",
  "low_effort",
  "gibberish",
] as const;
export type Flag = (typeof FLAGS)[number];

/** Plain words for the panel. Never shown to the applicant. */
export const FLAG_LABEL: Record<Flag, string> = {
  instruction_attempt: "Wrote instructions to the checker",
  copied_or_templated: "Reads as copied or templated",
  duplicate_of_other: "Same words as another application",
  same_in_two_answers: "Same words in two answers",
  unverified_evidence: "The AI quoted words that are not in the answer",
  forced_through: "Let through after several tries",
  poor_fit: "Track, community and goal do not fit",
  off_topic: "Off topic",
  generic_boilerplate: "Generic wording, nothing personal",
  low_effort: "Very little effort",
  gibberish: "Not real words",
};

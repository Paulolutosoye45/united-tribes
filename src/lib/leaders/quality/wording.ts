/** Plain words for the pastors and coaches. None of these are shown to an applicant. */
export const STATE_LABEL: Record<string, string> = {
  not_applicable: "Not part of the first check",
  consent_needed: "Waiting for the applicant to agree to the new wording",
  checking: "Being read",
  strengthen: "Asked to add to their answers",
  held: "Held for a person",
  clear: "Passed the first check",
  cleared_by_person: "Let through by a person",
};

/** Short form for a badge on the queue. */
export const STATE_SHORT: Record<string, string> = {
  consent_needed: "Waiting for agreement",
  checking: "Being read",
  strengthen: "With applicant",
  held: "Held for a person",
  clear: "First check passed",
  cleared_by_person: "Let through",
};

export const MODE_LABEL = { off: "Off", shadow: "Recording only", on: "On" } as const;

export const OUTCOME_LABEL: Record<string, string> = {
  clear: "Would pass",
  strengthen: "Would ask for more",
  held: "Would hold for a person",
  unscored: "No score",
};

export const ORIGIN_LABEL: Record<string, string> = {
  submit: "When sent",
  rewrite: "After an update",
  batch: "Taken in when switched on",
};

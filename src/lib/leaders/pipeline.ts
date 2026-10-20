/**
 * The switchboard for becoming a leader: where each switch stands, as the form, the tracker, the review screens and the Admin
 * page read it. The database holds the truth (leader_pipeline_settings) and decides every outcome; this is how the app asks.
 *
 * Fail towards asking more. If the positions cannot be read, or arrive in a shape nobody expects, the app behaves exactly as it did
 * before the switchboard existed: every question, both referees and the interview are required. So a failure to read can only ever
 * make the process stricter on screen than the database, never more lenient.
 */

export type Position = "required" | "optional" | "off";
export type DeclarationPosition = "required" | "off";
export type PresetName = "full" | "open_door" | "empty";

/** The seven eligibility questions, in the order the form asks them. The ids are the keys stored in answers.eligibility. */
export const ELIGIBILITY_KEYS = ["member6", "foundation", "serving", "age21", "time", "safeguarding", "confidentiality"] as const;
export type EligibilityKey = (typeof ELIGIBILITY_KEYS)[number];

export type Pipeline = {
  eligibility: Record<EligibilityKey, Position>;
  references: Position;
  interview: Position;
  /** The fit questions on the application, and the pastor's fit panel. Off until its weights and cards are approved. */
  tribeFit: boolean;
  /** The modules and quizzes, the two workshops and the coach's practice sign-off, together. */
  academy: Position;
  /** The signed safeguarding declaration. */
  declaration: DeclarationPosition;
  preset: PresetName;
};

/** Today's process: nothing is optional and nothing is off. */
export const DEFAULT_PIPELINE: Pipeline = {
  eligibility: { member6: "required", foundation: "required", serving: "required", age21: "required", time: "required", safeguarding: "required", confidentiality: "required" },
  references: "required",
  interview: "required",
  tribeFit: false,
  academy: "required",
  declaration: "required",
  preset: "full",
};

/** The stages of the process other than the eligibility questions, each of which has a switch. */
export const STAGE_SWITCHES = ["references", "interview"] as const;
export type StageSwitch = (typeof STAGE_SWITCHES)[number];

const POSITIONS: readonly Position[] = ["required", "optional", "off"];
const isPosition = (v: unknown): v is Position => typeof v === "string" && (POSITIONS as readonly string[]).includes(v);
const isPreset = (v: unknown): v is PresetName => v === "full" || v === "open_door" || v === "empty";

/**
 * Reads the positions the database gives (leader_pipeline_public). Never throws. Anything missing or unreadable falls back to
 * today's position for that switch, which is the strictest one.
 */
export function parsePipeline(json: unknown): Pipeline {
  if (!json || typeof json !== "object" || Array.isArray(json)) return structuredClone(DEFAULT_PIPELINE);
  const v = json as Record<string, unknown>;
  const rawElig = v.eligibility && typeof v.eligibility === "object" && !Array.isArray(v.eligibility) ? (v.eligibility as Record<string, unknown>) : {};
  const eligibility = { ...DEFAULT_PIPELINE.eligibility };
  for (const key of ELIGIBILITY_KEYS) if (isPosition(rawElig[key])) eligibility[key] = rawElig[key];
  return {
    eligibility,
    references: isPosition(v.references) ? v.references : DEFAULT_PIPELINE.references,
    interview: isPosition(v.interview) ? v.interview : DEFAULT_PIPELINE.interview,
    tribeFit: v.tribe_fit === "on",
    academy: isPosition(v.academy) ? v.academy : DEFAULT_PIPELINE.academy,
    declaration: v.declaration === "off" ? "off" : "required",
    preset: isPreset(v.preset) ? v.preset : DEFAULT_PIPELINE.preset,
  };
}

/** What each preset sets. Tribe fit is set only when it is ready; the database decides that, and says so in its reply. */
export const PRESETS: Record<"full" | "open_door", Omit<Pipeline, "preset" | "tribeFit"> & { tribeFit: "off" | "when_ready" }> = {
  full: {
    eligibility: { ...DEFAULT_PIPELINE.eligibility },
    references: "required",
    interview: "required",
    tribeFit: "off",
    academy: "required",
    declaration: "required",
  },
  open_door: {
    eligibility: { member6: "off", foundation: "off", serving: "off", age21: "required", time: "required", safeguarding: "required", confidentiality: "required" },
    references: "off",
    interview: "off",
    tribeFit: "when_ready",
    academy: "required",
    declaration: "required",
  },
};

/**
 * Which switches are connected to the process. A switch whose flag is false is shown on the Admin page but cannot be moved there,
 * because moving it would look like it did something and do nothing. Each phase flips its own flags in the change that wires it.
 */
export const WIRED = {
  eligibility: { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true } as Record<EligibilityKey, boolean>,
  references: true,
  interview: true,
  tribeFit: true,
  academy: true,
  declaration: true,
};

/** The names the database uses for each switch, so the page can send exactly what the database expects. */
export const SETTING_NAME = {
  eligibility: (key: EligibilityKey) => `elig_${key}`,
  references: "references_mode",
  interview: "interview_mode",
  tribeFit: "tribe_fit",
  academy: "academy_mode",
  declaration: "declaration_mode",
} as const;

// ---------------------------------------------------------------------------
// The switches by the name the database uses, for the Admin page
// ---------------------------------------------------------------------------

export type SwitchId = `elig_${EligibilityKey}` | "references_mode" | "interview_mode" | "tribe_fit" | "academy_mode" | "declaration_mode";

export const SWITCH_IDS: readonly SwitchId[] = [
  ...ELIGIBILITY_KEYS.map((k) => `elig_${k}` as SwitchId),
  "references_mode",
  "interview_mode",
  "tribe_fit",
  "academy_mode",
  "declaration_mode",
];

/** Where one switch stands, in the words the database stores: required, optional, off, or (Find your tribe) on or off. */
export function settingValue(p: Pipeline, id: SwitchId): string {
  if (id.startsWith("elig_")) return p.eligibility[id.slice(5) as EligibilityKey];
  switch (id) {
    case "references_mode":
      return p.references;
    case "interview_mode":
      return p.interview;
    case "tribe_fit":
      return p.tribeFit ? "on" : "off";
    case "academy_mode":
      return p.academy;
    default:
      return p.declaration;
  }
}

/** Whether a switch is connected to the process yet. */
export function isWired(id: SwitchId): boolean {
  if (id.startsWith("elig_")) return WIRED.eligibility[id.slice(5) as EligibilityKey];
  switch (id) {
    case "references_mode":
      return WIRED.references;
    case "interview_mode":
      return WIRED.interview;
    case "tribe_fit":
      return WIRED.tribeFit;
    case "academy_mode":
      return WIRED.academy;
    default:
      return WIRED.declaration;
  }
}

/** The switches in a draft that are not where they stand now. */
export function changedSwitches(p: Pipeline, draft: Partial<Record<SwitchId, string>>): Partial<Record<SwitchId, string>> {
  const out: Partial<Record<SwitchId, string>> = {};
  for (const id of SWITCH_IDS) {
    const wanted = draft[id];
    if (wanted !== undefined && wanted !== settingValue(p, id)) out[id] = wanted;
  }
  return out;
}

/** One row of the change log, as leader_pipeline_log_list gives it. */
export type PipelineLogRow = {
  at: string;
  batch: string;
  setting: string;
  label: string;
  oldValue: string;
  newValue: string;
  preset: PresetName;
  reason: string | null;
  shownAs: string;
};

/** Reads the log. Rows that are not in the expected shape are dropped; it never throws. */
export function parsePipelineLog(json: unknown): PipelineLogRow[] {
  if (!Array.isArray(json)) return [];
  const rows: PipelineLogRow[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.at !== "string" || typeof r.setting !== "string" || typeof r.old_value !== "string" || typeof r.new_value !== "string") continue;
    rows.push({
      at: r.at,
      batch: typeof r.batch === "string" ? r.batch : "",
      setting: r.setting,
      label: typeof r.label === "string" ? r.label : r.setting,
      oldValue: r.old_value,
      newValue: r.new_value,
      preset: isPreset(r.preset) ? r.preset : "empty",
      reason: typeof r.reason === "string" && r.reason.trim() ? r.reason : null,
      shownAs: typeof r.shown_as === "string" && r.shown_as.trim() ? r.shown_as : "an administrator",
    });
  }
  return rows;
}

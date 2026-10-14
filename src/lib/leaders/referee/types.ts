import type { Standing } from "./labels";

/** What the database hands the screens. Each is read defensively (see read.ts): a missing or odd field never breaks a page. */

export type PersonContact = { kind: "email" | "phone"; value: string };

export type DirectoryPerson = {
  id: string;
  name: string;
  standing: Standing;
  unit: string | null;
  note: string | null;
  active: boolean;
  updatedAt: string | null;
  contacts: PersonContact[];
};
export type DirectoryPage = { total: number; rows: DirectoryPerson[] };

export type PlanAction = "add" | "update" | "revive" | "unchanged" | "retire" | "error";
export type PlanRow = {
  line: number | null;
  action: PlanAction;
  entryId: string | null;
  name: string;
  standing: string | null;
  unit: string | null;
  contacts: string[];
  /** What would change, in words ("name", "unit", "+1 contact"). */
  changes: string[];
  warn: string[];
  /** Why a row cannot be used. */
  message: string | null;
};
export type PlanCounts = { add: number; update: number; unchanged: number; retire: number; error: number; total: number };
export type Preview = { counts: PlanCounts; activeNow: number; rows: PlanRow[] };

export type Batch = {
  id: string;
  at: string;
  by: string | null;
  filename: string | null;
  mode: "update" | "replace";
  added: number;
  updated: number;
  unchanged: number;
  retired: number;
  errors: number;
  status: "applied" | "undone";
  canUndo: boolean;
};

export type RefereeSettings = { gateStandings: Standing[]; callbackPct: number; minSeconds: number; codeMinutes: number; maxTries: number; maxChanges: number };

export type Overview = {
  settings: RefereeSettings;
  directory: { active: number; retired: number; pastor: number; unitHead: number; ministryLeader: number; updatedAt: string | null };
  references: { unverified: number; asked: number; held: number; toConfirm: number };
  callbacksOpen: number;
};

export type UnverifiedRow = {
  id: string;
  applicationId: string;
  applicant: string;
  referee: string;
  relationship: string;
  kind: "email" | "phone" | null;
  masked: string | null;
  answeredAt: string | null;
  askedAt: string | null;
  reachable: boolean;
};

export type CallbackRow = {
  id: string;
  reason: "flagged" | "sample" | "disowned";
  dueOn: string;
  overdue: boolean;
  attempts: number;
  referee: string;
  relationship: string;
  contact: string;
  kind: "email" | "phone" | null;
  applicant: string;
  applicationId: string;
};

export type ReviewFlag = { kind: string; severity: "hold" | "note"; detail: string; cleared: boolean; clearedBy: string | null; clearedNote: string | null };
export type ReviewReferee = {
  id: string;
  slot: number;
  name: string;
  stage: string;
  answered: boolean;
  verification: "unverified" | "contact" | "directory" | "pastor" | "disputed";
  standing: boolean;
  claimedHead: boolean;
  legacy: boolean;
  verifiedAt: string | null;
  verifiedKind: "email" | "phone" | null;
  reverifySent: boolean;
  reverified: boolean;
  changes: number;
  directory: { name: string; standing: string; unit: string | null } | null;
  held: boolean;
  flags: ReviewFlag[];
  callback: { status: string; outcome: string | null; reason: string; note: string | null } | null;
  confirmedBy: string | null;
  confirmedNote: string | null;
  canConfirm: boolean;
  canClear: boolean;
};

/** What the referee's own page needs to draw itself. */
export type RefereeOpen =
  | { state: "invalid" }
  | {
      state: "open" | "answered" | "closed" | "expired";
      mode: "give" | "reverify";
      applicant: string;
      referee: string;
      relationship: string;
      kind: "email" | "phone";
      masked: string | null;
      verified: boolean;
      who: { name: string; standing: string; unit: string | null } | null;
      code: { live: boolean; failed: boolean; wait: number; lockedMinutes: number; triesLeft: number; minutes: number };
    };

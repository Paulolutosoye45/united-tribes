import { ROLE_LABELS, isRole } from "@/lib/auth/roles";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import type { FeatureLogLine, FeatureRow, Position, Rule, Scope, Summary } from "./types";

// The words of the Features page. Nothing here decides anything: the database does.

export const POSITION_WORDS: Record<Position, { name: string; line: string }> = {
  off: { name: "Off", line: "Nobody sees it. The platform behaves exactly as it did before." },
  rehearsal: { name: "Rehearsal", line: "It runs and writes down what it would do. Nothing reaches a person." },
  on: { name: "On", line: "Live, for the people this rule reaches." },
  optional: { name: "Optional", line: "A pastor is told when a leader's stage is not yet confirmed, and may still approve the card." },
  required: { name: "Required", line: "A pastor cannot approve a card until the leader has confirmed their stage." },
};

export const SUMMARY_WORDS: Record<Summary, string> = {
  off: "Off",
  rehearsal: "Rehearsal",
  limited: "Limited",
  on: "On",
  optional: "Optional",
  required: "Required",
};

export const SCOPE_WORDS: Record<Scope, string> = {
  platform: "The whole church",
  centre: "One centre",
  community: "One community",
  tribe: "One tribe",
  person: "One person",
};

/** The roles a rule can be narrowed to ("On for leaders"). The same list the database accepts. */
export const ROLE_FILTERS = ["leader", "assistant_leader", "member", "coach", "community_champion", "care_lead", "data_lead", "director", "pastor", "admin"] as const;

export const roleName = (r: string): string => (isRole(r) ? ROLE_LABELS[r] : r.replace(/_/g, " "));

export const rolesPhrase = (roles: string[]): string => (roles.length === 0 ? "everyone it reaches" : `only ${roles.map((r) => roleName(r).toLowerCase()).join(", ")}`);

/** A moment in Lagos time, "Wed 28 Oct, 3:07 am". */
export const lagosWhen = (iso: string): string => `${formatLagosDay(iso)}, ${formatLagosTime(iso)}`;

export const positionName = (p: string | null): string => (p && p in POSITION_WORDS ? POSITION_WORDS[p as Position].name : p === "paused" ? "Paused" : p === "running" ? "Running" : (p ?? "Off"));

/** One line for a rule on the board: where it applies, what it says, and who it reaches. */
export function describeRule(r: Rule): string {
  const where = r.scope === "platform" ? SCOPE_WORDS.platform : `${SCOPE_WORDS[r.scope]}: ${r.label}`;
  const hold = r.holdoutUntil ? `, one tribe in ten held back until ${r.holdoutUntil}` : "";
  return `${where}: ${positionName(r.position)} for ${rolesPhrase(r.roles)}${hold}`;
}

/** One line for the log: what moved, where, and why. */
export function describeLog(l: Pick<FeatureLogLine, "name" | "label" | "from" | "to" | "roles" | "reason">): string {
  const roles = (l.roles ?? []).length > 0 ? ` (${rolesPhrase(l.roles)})` : "";
  const what = l.name ?? "Every new function";
  const where = l.label ? ` for ${l.label}` : "";
  return `${what}${where} went from ${positionName(l.from)} to ${positionName(l.to)}${roles}${l.reason ? `. “${l.reason}”` : ""}`;
}

/** What a function needs open first, in words. */
export function needs(row: FeatureRow, names: Record<string, string>): string | null {
  return row.depends.length > 0 ? `Needs ${row.depends.map((d) => names[d] ?? d).join(" and ")} to be at least as open.` : null;
}

export const STAGE_WORDS: Record<number, string> = {
  1: "Stage 1: the foundations",
  2: "Stage 2: My page for everyone",
  3: "Stage 3: faces and visibility",
  4: "Stage 4: know your tribe",
  5: "Stage 5: the weekly rhythm",
  6: "Stage 6: leaders’ week",
  7: "WhatsApp that cannot fail quietly",
  8: "Joining a tribe, and leaving one",
};

export const MASTER_LINE =
  "Turns every new function (Profiles and the Weekly Rhythm, the WhatsApp safety net and health page, the required number, and removal requests) Off at once. Nothing is deleted, and one more press puts everything back as it was. Use it the moment anything looks wrong.";

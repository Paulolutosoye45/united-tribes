import { ROLE_LABELS, isRole } from "@/lib/auth/roles";
import { formatLagosDay, formatLagosTime, formatShortDate } from "@/lib/dates";
import type { PackId, Position, PurposeKey } from "./types";

// The words of the Studio, My exports and the owner's switchboard. Nothing here decides anything: the database does.

export const POSITION_ORDER: Position[] = ["off", "rehearsal", "limited", "on"];

export const POSITION_WORDS: Record<Position, { name: string; line: string }> = {
  off: { name: "Off", line: "Nobody can make this file. It is not shown to anyone." },
  rehearsal: { name: "Rehearsal", line: "Only the named testers. Every file says REHEARSAL on every page." },
  limited: { name: "Limited", line: "Open to the roles, communities or tribes you choose, and the testers." },
  on: { name: "On", line: "Open to everyone whose role includes it." },
};

/** What the three formats are called on a switch. */
export const FORMAT_SWITCHES: { key: "xlsx" | "csv" | "pdf"; name: string; line: string }[] = [
  { key: "xlsx", name: "Excel files", line: "Spreadsheets with real numbers, dates and tables." },
  { key: "csv", name: "CSV files", line: "The Open Data Pack zip and nothing else in this release." },
  { key: "pdf", name: "Printed pages", line: "A page to print or save as a PDF from the browser." },
];

export const DELIVERY_SWITCHES: { key: "download"; name: string; line: string }[] = [
  { key: "download", name: "Download from the Studio", line: "A private link for the person who asked, for 24 hours." },
];

export const DOOR_SWITCHES: { key: "open_data_pack" | "standing_link"; name: string; line: string }[] = [
  { key: "open_data_pack", name: "Open Data Pack", line: "A zip of the seven coded tables, with a data dictionary and checksums. No names." },
  { key: "standing_link", name: "Standing links", line: "A secret web address a reporting tool reads on a schedule. One coded table, read only, 90 days." },
];

export const SETTING_WORDS: Record<string, string> = {
  "setting:paused": "Pause all exports",
  "setting:people_stopped": "Stop all People files",
  "setting:unusual_per_hour": "Unusual-use number",
  "setting:formats": "Formats switched on",
  "setting:deliveries": "Ways to receive a file",
  "setting:doors": "Open Data Pack and standing links",
  "setting:people_cleared_on": "Impact assessment signed",
};

/** A line of the switch log in words ("pack:tribe_sheet" becomes the pack's name; a person's id is never shown). */
export function describeSwitch(what: string, names: Record<string, string> = {}): string {
  if (what.startsWith("pack:")) return `${names[what.slice(5)] ?? what.slice(5).replace(/_/g, " ")} pack`;
  if (what.startsWith("tester:")) return "Tester";
  return SETTING_WORDS[what] ?? what.replace(/[:_]/g, " ");
}

export const roleName = (r: string): string => (isRole(r) ? ROLE_LABELS[r] : r.replace(/_/g, " "));

export const STATUS_WORDS: Record<string, string> = {
  prepared: "Link made, not opened",
  delivered: "Made",
  failed: "Could not be made",
  withdrawn: "Deleted by you",
};

export const purposeWord = (p: PurposeKey | null, map: Record<PurposeKey, string>): string => (p ? map[p] : "");

/** Packs whose figures can be chosen by season. The others are always the current state. */
export const SEASON_PACKS: readonly PackId[] = ["leaders_roster", "my_tribes_glance", "tribes_health", "supply_demand", "programme_report", "pastorate_one_pager", "community_report"];

export const NOT_YET = "Nothing is open to you yet. When the church opens a file to your role, it appears here.";
export const PEOPLE_PROMISES = [
  "It names people. It is for the church’s own use.",
  "Keep it private, and do not send it to another platform.",
  "Delete it when you no longer need it.",
];
export const dayCount = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** "Wed 28 Oct, 3:07 am" in Lagos time; with the year when the moment may be far from today. */
export function lagosWhen(iso: string, withYear = false): string {
  const year = withYear ? ` ${formatShortDate(iso).split(" ").pop()}` : "";
  return `${formatLagosDay(iso)}${year}, ${formatLagosTime(iso)}`;
}

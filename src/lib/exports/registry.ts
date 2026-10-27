import type { Format, Lane, PackId, Scope } from "./types";

/**
 * The fourteen packs, as the app words them. The database holds the same list (export_packs) and is the one that decides who may make
 * what and whether a pack is open; this is only how each one is described and what it is called on a screen and in a file. A test
 * compares the two lists so they cannot drift apart.
 */
export type PackInfo = {
  id: PackId;
  name: string;
  lane: Lane;
  scope: Scope;
  formats: Format[];
  /** Arrives in the second release. The database refuses to open it until then. */
  released: boolean;
  /** One line a person reads before choosing it. */
  line: string;
  /** The file's name, before the date. */
  stem: string;
};

export const PACKS: PackInfo[] = [
  { id: "tribe_sheet", name: "Tribe sheet", lane: "people", scope: "tribe", formats: ["xlsx"], released: true, stem: "tribe-sheet",
    line: "Your tribe's members as a spreadsheet: who they are, how to reach them, and where each one stands with you." },
  { id: "know_your_tribe", name: "Know your tribe", lane: "people", scope: "tribe", formats: ["pdf"], released: false, stem: "know-your-tribe",
    line: "A printed card for each member to read before you meet." },
  { id: "attendance_register", name: "Attendance register", lane: "people", scope: "tribe", formats: ["xlsx", "pdf"], released: true, stem: "attendance-register",
    line: "Your members against the season's weeks, to tick on paper or a tablet." },
  { id: "my_tribes_glance", name: "My tribes at a glance", lane: "insight", scope: "tribes", formats: ["xlsx", "pdf"], released: true, stem: "my-tribes",
    line: "Each of your tribes with attendance, the thriving rate and where it stands." },
  { id: "community_report", name: "Community report", lane: "insight", scope: "community", formats: ["pdf", "xlsx"], released: true, stem: "community-report",
    line: "One community's season: its tribes, the weeks, the places still to fill." },
  { id: "pastorate_one_pager", name: "Pastorate one-pager", lane: "insight", scope: "church", formats: ["pdf"], released: true, stem: "pastorate-one-pager",
    line: "One page: how it is going, the programme's targets, and where care is needed." },
  { id: "leaders_roster", name: "Leaders roster", lane: "people", scope: "church", formats: ["xlsx"], released: true, stem: "leaders-roster",
    line: "Each tribe with its leader, assistant and coach, and who is certified." },
  { id: "programme_report", name: "Programme report", lane: "insight", scope: "church", formats: ["pdf", "xlsx"], released: true, stem: "programme-report",
    line: "Every figure for the season: the headline, the weeks, the tribes, the targets and the care." },
  { id: "tribes_health", name: "Tribes health sheet", lane: "insight", scope: "church", formats: ["xlsx"], released: true, stem: "tribes-health",
    line: "Every tribe's numbers on one sheet, with no names." },
  { id: "supply_demand", name: "Supply and demand", lane: "insight", scope: "church", formats: ["xlsx"], released: true, stem: "supply-and-demand",
    line: "Where members want to be and where the seats are, community by track." },
  { id: "people_roles", name: "People and roles", lane: "people", scope: "church", formats: ["xlsx"], released: true, stem: "people-and-roles",
    line: "Each person who holds a role, the roles, and since when. Names only." },
  { id: "message_volumes", name: "Message volumes", lane: "insight", scope: "church", formats: ["xlsx"], released: true, stem: "message-volumes",
    line: "How many messages went out each day, by kind and outcome. Never the wording." },
  { id: "insight_feeds", name: "Insight feeds", lane: "insight", scope: "church", formats: ["csv"], released: true, stem: "open-data-pack",
    line: "The coded tables, with a data dictionary and a checksum list, for other reporting tools." },
  { id: "my_data_pack", name: "My data pack", lane: "people", scope: "self", formats: ["xlsx", "pdf"], released: false, stem: "my-data",
    line: "A member's own copy of what the church holds about them." },
];

const BY_ID = new Map(PACKS.map((p) => [p.id, p]));
export const packInfo = (id: string): PackInfo | undefined => BY_ID.get(id as PackId);

export const FORMAT_NAMES: Record<Format, string> = { xlsx: "Excel", csv: "CSV", pdf: "PDF" };

export const LANE_NAMES: Record<Lane, { name: string; line: string }> = {
  insight: { name: "Insight", line: "Counted or coded figures with no names of members. May feed other reporting tools." },
  people: { name: "People", line: "Named people. For the church's own use. Never sent to another platform." },
};

export const POSITION_NAMES = { off: "Off", rehearsal: "Rehearsal", limited: "Limited", on: "On" } as const;

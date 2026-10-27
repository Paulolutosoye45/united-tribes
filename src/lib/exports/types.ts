/** What the database says about exports (the shapes of the answers of the export_* functions). Nothing here touches the network. */

export type Lane = "insight" | "people";
export type Format = "xlsx" | "csv" | "pdf";
export type Position = "off" | "rehearsal" | "limited" | "on";
export type Scope = "tribe" | "tribes" | "community" | "church" | "self";
export type PurposeKey = "pastoral_care" | "planning" | "reporting";

export const PACK_IDS = [
  "tribe_sheet",
  "know_your_tribe",
  "attendance_register",
  "my_tribes_glance",
  "community_report",
  "pastorate_one_pager",
  "leaders_roster",
  "programme_report",
  "tribes_health",
  "supply_demand",
  "people_roles",
  "message_volumes",
  "insight_feeds",
  "my_data_pack",
] as const;
export type PackId = (typeof PACK_IDS)[number];

/** The only choices a file's log line keeps. Anything else sent in is dropped by the database. */
export type Filters = { tribe?: string; community?: string; season?: string; report?: string; success?: boolean };

export type OptionTarget = { id: string; name: string; community?: string | null };
export type OptionPack = {
  id: PackId;
  name: string;
  lane: Lane;
  scope: Scope;
  formats: Format[];
  /** True while the pack is in Rehearsal: the person is a tester and the file says so. */
  rehearsal: boolean;
  targets: OptionTarget[] | null;
};
export type Options = {
  open: boolean;
  packs: OptionPack[];
  formats: Format[];
  purposes: { key: PurposeKey; label: string }[];
  seasons: { id: string; name: string; starts_on: string }[];
};

export type Prepared = { export_id: string; token: string; expires_at: string; rehearsal: boolean };

export type Opened = {
  export_id: string;
  pack: PackId;
  pack_name: string;
  lane: Lane;
  format: Format;
  purpose: PurposeKey | null;
  filters: Filters;
  role: string;
  rehearsal: boolean;
  made_at: string;
  expires_at: string;
  who: string;
};

export type MyExport = {
  id: string;
  at: string;
  pack: PackId;
  name: string;
  lane: Lane;
  format: Format;
  purpose: PurposeKey | null;
  rows: number | null;
  status: "prepared" | "delivered" | "failed" | "withdrawn";
  rehearsal: boolean;
  active: boolean;
  expires_at: string | null;
};

export type FeedTable = "members" | "tribes" | "weekly" | "care_weekly" | "messages_daily" | "ai_fields" | "kpi_daily";
export const FEED_TABLES: FeedTable[] = ["members", "tribes", "weekly", "care_weekly", "messages_daily", "ai_fields", "kpi_daily"];

export type FeedLink = {
  id: string;
  table: FeedTable;
  label: string;
  by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_read_at: string | null;
  reads: number;
  live: boolean;
};

export type TableRows = { table: FeedTable; rows: Record<string, unknown>[]; young_not_listed: number; refreshed_at: string | null };

// ---------------------------------------------------------------------------
// The switchboard (God Mode only)
// ---------------------------------------------------------------------------

export type BoardSettings = {
  paused: boolean;
  people_stopped: boolean;
  unusual_per_hour: number;
  formats: Format[];
  deliveries: string[];
  doors: string[];
  people_cleared_on: string | null;
  updated_at: string | null;
};

export type BoardPack = {
  id: PackId;
  name: string;
  lane: Lane;
  scope: Scope;
  roles: string[];
  formats: Format[];
  released: boolean;
  position: Position;
  /** What actually applies now: Off when the whole feature is paused, or People files are stopped. */
  in_force: Position;
  limited_roles: string[];
  limited_communities: string[];
  limited_tribes: string[];
  rehearsed_at: string | null;
  changed_at: string | null;
  reason: string | null;
  made_30d: number;
  by_role: Record<string, number>;
};

export type Board = {
  settings: BoardSettings;
  packs: BoardPack[];
  testers: { person_id: string; name: string; roles: string; added_at: string }[];
  changes: { at: string; what: string; was: string | null; now: string | null; reason: string | null }[];
  unusual: { at: string; who: string; pack: PackId; role: string }[];
  feeds_live: number;
  links_live: number;
  communities: { id: string; name: string }[];
  tribes: { id: string; name: string; community: string | null }[];
};

export type LogLine = {
  id: string;
  at: string;
  who: string;
  role: string;
  pack: PackId;
  name: string;
  lane: Lane;
  format: Format;
  position: Position;
  rehearsal: boolean;
  purpose: PurposeKey | null;
  rows: number | null;
  status: string;
  flagged: string | null;
  filters: Filters;
};

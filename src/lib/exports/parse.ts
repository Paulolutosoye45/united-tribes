import { PACK_IDS, FEED_TABLES, type Board, type BoardPack, type FeedLink, type Format, type Lane, type LogLine, type MyExport, type Opened, type Options, type OptionPack, type PackId, type Position, type Prepared, type PurposeKey, type Scope } from "./types";

// What the database answers is data, not a promise: each answer is read defensively. Anything that is not the shape expected becomes
// "nothing" (null or an empty list), so a screen shows "not available" rather than breaking, and a new field never breaks an old screen.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

const FORMATS: readonly Format[] = ["xlsx", "csv", "pdf"];
const LANES: readonly Lane[] = ["insight", "people"];
const POSITIONS: readonly Position[] = ["off", "rehearsal", "limited", "on"];
const SCOPES: readonly Scope[] = ["tribe", "tribes", "community", "church", "self"];
const PURPOSE_KEYS: readonly PurposeKey[] = ["pastoral_care", "planning", "reporting"];
const STATUSES = ["prepared", "delivered", "failed", "withdrawn"] as const;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
export const isPackId = (v: unknown): v is PackId => typeof v === "string" && (PACK_IDS as readonly string[]).includes(v);
const formats = (v: unknown): Format[] => arr(v).flatMap((x) => oneOf(FORMATS, x) ?? []);

export function parseOptions(v: unknown): Options | null {
  if (!isObj(v)) return null;
  const packs: OptionPack[] = [];
  for (const raw of arr(v.packs)) {
    if (!isObj(raw) || !isPackId(raw.id)) continue;
    const lane = oneOf(LANES, raw.lane);
    const scope = oneOf(SCOPES, raw.scope);
    if (!lane || !scope) continue;
    const targets = Array.isArray(raw.targets)
      ? raw.targets.flatMap((t) => (isObj(t) && typeof t.id === "string" ? [{ id: t.id, name: str(t.name, "Unnamed"), community: strOrNull(t.community) }] : []))
      : null;
    packs.push({ id: raw.id, name: str(raw.name), lane, scope, formats: formats(raw.formats), rehearsal: raw.rehearsal === true, targets });
  }
  return {
    open: v.open === true,
    packs,
    formats: formats(v.formats),
    purposes: arr(v.purposes).flatMap((p) => {
      const key = isObj(p) ? oneOf(PURPOSE_KEYS, p.key) : null;
      return isObj(p) && key ? [{ key, label: str(p.label, key) }] : [];
    }),
    seasons: arr(v.seasons).flatMap((s) => (isObj(s) && typeof s.id === "string" ? [{ id: s.id, name: str(s.name, "Season"), starts_on: str(s.starts_on) }] : [])),
  };
}

export function parsePrepared(v: unknown): Prepared | null {
  if (!isObj(v) || typeof v.export_id !== "string" || typeof v.token !== "string" || !/^[a-f0-9]{64}$/.test(v.token)) return null;
  return { export_id: v.export_id, token: v.token, expires_at: str(v.expires_at), rehearsal: v.rehearsal === true };
}

export function parseMyExports(v: unknown): MyExport[] {
  return arr(v).flatMap((raw) => {
    if (!isObj(raw) || typeof raw.id !== "string" || !isPackId(raw.pack)) return [];
    const lane = oneOf(LANES, raw.lane);
    const format = oneOf(FORMATS, raw.format);
    const status = oneOf(STATUSES, raw.status);
    if (!lane || !format || !status) return [];
    return [{
      id: raw.id, at: str(raw.at), pack: raw.pack, name: str(raw.name), lane, format, purpose: oneOf(PURPOSE_KEYS, raw.purpose), rows: numOrNull(raw.rows),
      status, rehearsal: raw.rehearsal === true, active: raw.active === true, expires_at: strOrNull(raw.expires_at),
    }];
  });
}

export function parseFeedLinks(v: unknown): FeedLink[] {
  return arr(v).flatMap((raw) => {
    if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.table !== "string" || !(FEED_TABLES as string[]).includes(raw.table)) return [];
    return [{
      id: raw.id, table: raw.table as FeedLink["table"], label: str(raw.label), by: str(raw.by), created_at: str(raw.created_at), expires_at: str(raw.expires_at),
      revoked_at: strOrNull(raw.revoked_at), last_read_at: strOrNull(raw.last_read_at), reads: num(raw.reads), live: raw.live === true,
    }];
  });
}

const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObj(v)) for (const [k, n] of Object.entries(v)) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
};

export function parseBoard(v: unknown): Board | null {
  if (!isObj(v) || !isObj(v.settings)) return null;
  const s = v.settings;
  const packs: BoardPack[] = [];
  for (const raw of arr(v.packs)) {
    if (!isObj(raw) || !isPackId(raw.id)) continue;
    const lane = oneOf(LANES, raw.lane);
    const scope = oneOf(SCOPES, raw.scope);
    const position = oneOf(POSITIONS, raw.position);
    if (!lane || !scope || !position) continue;
    packs.push({
      id: raw.id, name: str(raw.name), lane, scope, roles: strings(raw.roles), formats: formats(raw.formats), released: raw.released === true, position,
      in_force: oneOf(POSITIONS, raw.in_force) ?? "off", limited_roles: strings(raw.limited_roles), limited_communities: strings(raw.limited_communities),
      limited_tribes: strings(raw.limited_tribes), rehearsed_at: strOrNull(raw.rehearsed_at), changed_at: strOrNull(raw.changed_at), reason: strOrNull(raw.reason),
      made_30d: num(raw.made_30d), by_role: counts(raw.by_role),
    });
  }
  const named = (x: unknown) => arr(x).flatMap((t) => (isObj(t) && typeof t.id === "string" ? [{ id: t.id, name: str(t.name, "Unnamed") }] : []));
  return {
    settings: {
      paused: s.paused === true, people_stopped: s.people_stopped === true, unusual_per_hour: num(s.unusual_per_hour, 5), formats: formats(s.formats),
      deliveries: strings(s.deliveries), doors: strings(s.doors), people_cleared_on: strOrNull(s.people_cleared_on), updated_at: strOrNull(s.updated_at),
    },
    packs,
    testers: arr(v.testers).flatMap((t) => (isObj(t) && typeof t.person_id === "string" ? [{ person_id: t.person_id, name: str(t.name, "Someone"), roles: str(t.roles), added_at: str(t.added_at) }] : [])),
    changes: arr(v.changes).flatMap((c) => (isObj(c) ? [{ at: str(c.at), what: str(c.what), was: strOrNull(c.was), now: strOrNull(c.now), reason: strOrNull(c.reason) }] : [])),
    unusual: arr(v.unusual).flatMap((u) => (isObj(u) && isPackId(u.pack) ? [{ at: str(u.at), who: str(u.who, "Someone"), pack: u.pack, role: str(u.role) }] : [])),
    feeds_live: num(v.feeds_live),
    links_live: num(v.links_live),
    communities: named(v.communities),
    tribes: arr(v.tribes).flatMap((t) => (isObj(t) && typeof t.id === "string" ? [{ id: t.id, name: str(t.name, "Unnamed"), community: strOrNull(t.community) }] : [])),
  };
}

export function parseLog(v: unknown): LogLine[] {
  return arr(v).flatMap((raw) => {
    if (!isObj(raw) || typeof raw.id !== "string" || !isPackId(raw.pack)) return [];
    const lane = oneOf(LANES, raw.lane);
    const format = oneOf(FORMATS, raw.format);
    if (!lane || !format) return [];
    const f = isObj(raw.filters) ? raw.filters : {};
    return [{
      id: raw.id, at: str(raw.at), who: str(raw.who, "Someone"), role: str(raw.role), pack: raw.pack, name: str(raw.name), lane, format,
      position: oneOf(POSITIONS, raw.position) ?? "off", rehearsal: raw.rehearsal === true, purpose: oneOf(PURPOSE_KEYS, raw.purpose), rows: numOrNull(raw.rows),
      status: str(raw.status), flagged: strOrNull(raw.flagged),
      filters: { tribe: strOrNull(f.tribe) ?? undefined, community: strOrNull(f.community) ?? undefined, season: strOrNull(f.season) ?? undefined, report: strOrNull(f.report) ?? undefined, success: f.success === true ? true : undefined },
    }];
  });
}

/** The answer of export_open: what a link was made for, as the person it belongs to. */
export function parseOpened(v: unknown): Opened | null {
  if (!isObj(v) || typeof v.export_id !== "string" || !isPackId(v.pack)) return null;
  const lane = oneOf(LANES, v.lane);
  const format = oneOf(FORMATS, v.format);
  if (!lane || !format) return null;
  const f = isObj(v.filters) ? v.filters : {};
  return {
    export_id: v.export_id, pack: v.pack, pack_name: str(v.pack_name), lane, format, purpose: oneOf(PURPOSE_KEYS, v.purpose),
    filters: { tribe: strOrNull(f.tribe) ?? undefined, community: strOrNull(f.community) ?? undefined, season: strOrNull(f.season) ?? undefined, report: strOrNull(f.report) ?? undefined, success: f.success === true ? true : undefined },
    role: str(v.role), rehearsal: v.rehearsal === true, made_at: str(v.made_at), expires_at: str(v.expires_at), who: str(v.who, "You"),
  };
}

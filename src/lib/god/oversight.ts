/**
 * What the owner's oversight functions return (supabase/migrations/20261224000100_god_oversight.sql), read defensively, and the plain
 * words for it. A figure that is not in the expected shape is left out, never guessed.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const roleList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ---------------------------------------------------------------------------------------------------------------------------------
// Desks
// ---------------------------------------------------------------------------------------------------------------------------------

export type DeskTally = { role: string; people: number; active7d: number };
export type Desks = { season: { id: string; name: string; status: string } | null; roles: DeskTally[]; counts: Record<string, number> };

export function parseDesks(json: unknown): Desks | null {
  if (!isObject(json)) return null;
  const roles: DeskTally[] = [];
  if (Array.isArray(json.roles)) {
    for (const r of json.roles) {
      if (!isObject(r)) continue;
      const role = str(r.role);
      if (role) roles.push({ role, people: nat(r.people), active7d: nat(r.active_7d) });
    }
  }
  const counts: Record<string, number> = {};
  if (isObject(json.counts)) for (const [k, v] of Object.entries(json.counts)) counts[k] = nat(v);
  const season = isObject(json.season) && isUuid(json.season.id) ? { id: json.season.id, name: str(json.season.name) ?? "This season", status: str(json.season.status) ?? "" } : null;
  return { season, roles, counts };
}

export type RolePerson = { id: string; name: string; grantedAt: string | null; lastSeen: string | null; actions7d: number; tribes: number };

export function parseRolePeople(json: unknown): { role: string; people: RolePerson[] } | null {
  if (!isObject(json) || !Array.isArray(json.people)) return null;
  const people: RolePerson[] = [];
  for (const p of json.people) {
    if (!isObject(p) || !isUuid(p.id)) continue;
    people.push({ id: p.id, name: str(p.name) ?? "Someone", grantedAt: str(p.granted_at), lastSeen: str(p.last_seen), actions7d: nat(p.actions_7d), tribes: nat(p.tribes) });
  }
  return { role: str(json.role) ?? "", people };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------------------------------------------

export const MESSAGE_STATUSES = ["queued", "sending", "sent", "delivered", "read", "failed", "skipped"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type SentMessage = {
  id: string;
  at: string;
  sentAt: string | null;
  personId: string | null;
  name: string;
  roles: string[];
  template: string;
  channel: string | null;
  status: string;
  urgent: boolean;
  error: string | null;
  /** When set, the wording is not shown, and this says why. */
  held: string | null;
  params: Record<string, unknown> | null;
};

export type Reply = { at: string; action: string; outcome: string | null; channel: string | null };
export type Messages = { messages: SentMessage[]; more: boolean; replies: Reply[] };

export function parseMessages(json: unknown): Messages | null {
  if (!isObject(json) || !Array.isArray(json.messages)) return null;
  const messages: SentMessage[] = [];
  for (const m of json.messages) {
    if (!isObject(m) || !isUuid(m.id)) continue;
    const at = str(m.at);
    const template = str(m.template);
    if (!at || !template) continue;
    const held = str(m.held);
    messages.push({
      id: m.id,
      at,
      sentAt: str(m.sent_at),
      personId: isUuid(m.person_id) ? m.person_id : null,
      name: str(m.name) ?? "Someone",
      roles: roleList(m.roles),
      template,
      channel: str(m.channel),
      status: str(m.status) ?? "queued",
      urgent: m.urgency === "urgent",
      error: str(m.error),
      held,
      // Wording is never kept for a held message, whatever came back
      params: !held && isObject(m.params) ? m.params : null,
    });
  }
  const replies: Reply[] = [];
  if (Array.isArray(json.replies)) {
    for (const r of json.replies) {
      if (!isObject(r)) continue;
      const at = str(r.at);
      const action = str(r.action);
      if (at && action) replies.push({ at, action, outcome: str(r.outcome), channel: str(r.channel) });
    }
  }
  return { messages, more: json.more === true, replies };
}

export type ChatOpen = { id: number; at: string; context: string; openedBy: string | null; openedByName: string | null; openedByRoles: string[]; personId: string | null; personName: string | null };

export function parseChatOpens(json: unknown): { total: number; opens: ChatOpen[] } | null {
  if (!isObject(json) || !Array.isArray(json.opens)) return null;
  const opens: ChatOpen[] = [];
  for (const c of json.opens) {
    if (!isObject(c) || typeof c.id !== "number") continue;
    const at = str(c.at);
    if (!at) continue;
    opens.push({
      id: c.id,
      at,
      context: str(c.context) ?? "",
      openedBy: isUuid(c.opened_by) ? c.opened_by : null,
      openedByName: str(c.opened_by_name),
      openedByRoles: roleList(c.opened_by_roles),
      personId: isUuid(c.person_id) ? c.person_id : null,
      personName: str(c.person_name),
    });
  }
  return { total: nat(json.total), opens };
}

export type Announcement = { id: string; at: string; title: string; subject: string | null; audience: string | null; status: string; reached: number; by: string | null };

export function parseAnnouncements(json: unknown): Announcement[] {
  if (!Array.isArray(json)) return [];
  const out: Announcement[] = [];
  for (const a of json) {
    if (!isObject(a) || !isUuid(a.id)) continue;
    const at = str(a.at);
    if (!at) continue;
    out.push({ id: a.id, at, title: str(a.title) ?? "An announcement", subject: str(a.subject), audience: str(a.audience_label), status: str(a.status) ?? "", reached: nat(a.recipient_count), by: str(a.created_by_name) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------------------------------------------

export const STATUS_WORDS: Record<string, string> = {
  queued: "Waiting to go",
  sending: "Being sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  skipped: "Skipped",
};

export const CHANNEL_WORDS: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", sms: "Text" };

/** "welcome_call" as "welcome call". */
export const contextWords = (context: string): string => context.replace(/_/g, " ").trim() || "a chat";

/** A reply that came back, in a line. */
export function replyLine(r: Reply): string {
  const where = r.channel ? ` on ${CHANNEL_WORDS[r.channel] ?? r.channel}` : "";
  if (r.action === "contact.opt_out") return `Replied STOP${where}. No more messages${where ? ` there` : ""}.`;
  const outcome = r.outcome === "done" ? "done" : r.outcome === "partly" ? "partly" : r.outcome === "not_yet" ? "not yet" : r.outcome;
  return `Checked in by pressing a button${where}${outcome ? `: ${outcome}` : ""}.`;
}

export const isFailed = (m: { status: string }): boolean => m.status === "failed";

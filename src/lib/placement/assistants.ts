/**
 * Assistant-leader recommendations: what the leader's card and the office's page read. The database decides who may recommend, who may
 * decide, and whether a tribe's young members mean a pastor or a director must; this only reads what it says.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export const STATUS_WORDS: Record<string, string> = {
  requested: "Waiting for the office",
  invited: "Invited to apply",
  paired: "Now the assistant",
  declined: "Not taken up",
  withdrawn: "Withdrawn",
  expired: "Lapsed",
  replaced: "Replaced",
};

export type MyAssistantState = {
  assistant: { name: string } | null;
  open: { id: string; status: string; name: string; since: string | null } | null;
  last: { status: string; name: string; at: string | null } | null;
  closed: boolean;
};

export function parseMyAssistant(json: unknown): MyAssistantState | null {
  if (!isObject(json)) return null;
  const a = isObject(json.assistant) ? json.assistant : null;
  const o = isObject(json.open) ? json.open : null;
  const l = isObject(json.last) ? json.last : null;
  const openId = o ? uuid(o.id) : null;
  return {
    assistant: a ? { name: str(a.name) || "Your assistant" } : null,
    open: o && openId ? { id: openId, status: str(o.status), name: str(o.name) || "Someone", since: strOrNull(o.since) } : null,
    last: l ? { status: str(l.status), name: str(l.name) || "Someone", at: strOrNull(l.at) } : null,
    closed: json.closed === true,
  };
}

export type AssistantRow = {
  id: string;
  status: string;
  createdAt: string | null;
  decidedAt: string | null;
  note: string | null;
  reason: string | null;
  tribe: { id: string; name: string; status: string; leader: string; assistant: string | null };
  young: boolean;
  canDecide: boolean;
  nominee: { name: string | null; email: string | null; hasAccount: boolean; isAssistant: boolean; certified: boolean; pairedElsewhere: boolean };
};

export function parseAssistantRow(v: unknown): AssistantRow | null {
  if (!isObject(v)) return null;
  const id = uuid(v.id);
  const t = isObject(v.tribe) ? v.tribe : null;
  const tid = t ? uuid(t.id) : null;
  if (!id || !t || !tid) return null;
  const n = isObject(v.nominee) ? v.nominee : {};
  return {
    id,
    status: str(v.status),
    createdAt: strOrNull(v.created_at),
    decidedAt: strOrNull(v.decided_at),
    note: strOrNull(v.note),
    reason: strOrNull(v.reason),
    tribe: { id: tid, name: str(t.name), status: str(t.status), leader: str(t.leader), assistant: strOrNull(t.assistant) },
    young: v.young === true,
    canDecide: v.can_decide === true,
    nominee: {
      name: strOrNull(n.name),
      email: strOrNull(n.email),
      hasAccount: n.has_account === true,
      isAssistant: n.is_assistant === true,
      certified: n.certified === true,
      pairedElsewhere: n.paired_elsewhere === true,
    },
  };
}

export function parseAssistantRequests(json: unknown): { open: AssistantRow[]; recent: AssistantRow[] } {
  if (!isObject(json)) return { open: [], recent: [] };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(parseAssistantRow).filter((r): r is AssistantRow => r !== null) : []);
  return { open: list(json.open), recent: list(json.recent) };
}

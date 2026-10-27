/**
 * The tribe a leader leads, as the Lead page and the My tribe page tell it. A leader may have come to lead through an application, by
 * appointment, or because the role was given to them directly, and the page must not depend on which. It asks only whether they lead a
 * tribe, and says nothing about how they came to.
 */

export type LeadingCard = "draft" | "submitted" | "changes_requested" | "approved";

export type MyLeading = {
  /** A leader writes the Tribe Card; an assistant leader reads it. */
  role: "leader" | "assistant";
  tribeId: string;
  /** The name of the tribe. Null when the card has no name yet. */
  tribeName: string | null;
  tribeStatus: LeadingCard;
  /** People who have joined, as the leader's own list shows them. Only an approved card has any. */
  members: number;
  certified: boolean;
};

export type LeadingPerson = { name: string; joinedOn: string | null; called: boolean };

const CARD_STATUSES: readonly string[] = ["draft", "submitted", "changes_requested", "approved"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads what the database gives (my_leading). Null when the person leads nothing, or the answer is not in the shape expected. Never throws. */
export function parseMyLeading(raw: unknown): MyLeading | null {
  if (!isObj(raw)) return null;
  if (typeof raw.tribe_id !== "string" || !UUID.test(raw.tribe_id)) return null;
  if (raw.role !== "leader" && raw.role !== "assistant") return null;
  if (typeof raw.tribe_status !== "string" || !CARD_STATUSES.includes(raw.tribe_status)) return null;
  const name = typeof raw.tribe_name === "string" && raw.tribe_name.trim() !== "" && raw.tribe_name.length <= 120 ? raw.tribe_name.trim() : null;
  const members = typeof raw.members === "number" && Number.isFinite(raw.members) && raw.members > 0 ? Math.floor(raw.members) : 0;
  return { role: raw.role, tribeId: raw.tribe_id, tribeName: name, tribeStatus: raw.tribe_status as LeadingCard, members, certified: raw.certified === true };
}

/** Reads the leader's own list (tribe_roster_marked) down to what the Lead page shows: a name, the day they joined, and whether they were called. */
export function parseLeadingPeople(raw: unknown): LeadingPerson[] | null {
  if (!isObj(raw) || !Array.isArray(raw.members)) return null;
  const out: LeadingPerson[] = [];
  for (const m of raw.members) {
    if (!isObj(m) || typeof m.name !== "string" || m.name.trim() === "") continue;
    out.push({
      name: m.name.trim().slice(0, 80),
      joinedOn: typeof m.joined_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(m.joined_at) ? m.joined_at.slice(0, 10) : null,
      called: m.called === true,
    });
  }
  return out;
}

/** The heading: the tribe's name when it has one. */
export function leadingTitle(l: MyLeading): string {
  if (l.role === "assistant") return l.tribeName ? `You are the assistant leader of ${l.tribeName}.` : "You are an assistant leader.";
  return l.tribeName ? `You lead ${l.tribeName}.` : "You lead a tribe.";
}

/** "No one has joined yet." / "1 person has joined." / "7 people have joined." */
export function peopleLine(members: number): string {
  if (members <= 0) return "No one has joined yet.";
  return members === 1 ? "1 person has joined." : `${members} people have joined.`;
}

/** The sentence under the heading: where the Tribe Card stands, and, once it is approved, how many people have joined. */
export function leadingLine(l: MyLeading): string {
  if (l.tribeStatus === "approved") {
    const lead = l.certified ? "The Tribe Card is approved and members can find the tribe." : "The Tribe Card is approved. Members can find the tribe once the leader is certified.";
    return `${lead} ${peopleLine(l.members)}`;
  }
  if (l.role === "assistant") {
    return l.tribeStatus === "submitted" ? "The Tribe Card is with a pastor for approval." : "The Tribe Card is still being written. You can read it here.";
  }
  switch (l.tribeStatus) {
    case "submitted":
      return "Your Tribe Card is with a pastor for approval.";
    case "changes_requested":
      return "A pastor asked for changes to your Tribe Card. Open it to see what to change.";
    default:
      return "Your Tribe Card is started. Check it, then send it to a pastor.";
  }
}

/** The four things that fill the shield: the card sent, approved, the leader certified, and someone joined. */
export function leadingFills(l: MyLeading): [number, number, number, number] {
  return [
    l.tribeStatus === "submitted" || l.tribeStatus === "approved" ? 1 : 0,
    l.tribeStatus === "approved" ? 1 : 0,
    l.certified ? 1 : 0,
    l.members > 0 ? 1 : 0,
  ];
}

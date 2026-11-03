import { LEADER_MARKS } from "./wording";

/** What a leader's list carries about a member the church placed (the database adds these only for such members). */
export type MarkInput = {
  placement?: string | null;
  contact?: string | null;
  contact_opens_at?: string | null;
  withheld?: boolean | null;
};

export type Mark = {
  /** Beside the name: where this member stands. */
  label: string;
  /** Under the name, when there is more to say about their details. Null when there is nothing to add. */
  note: string | null;
};

/**
 * The mark beside a church-placed member. A leader sees such a member by name from the moment they are placed; this says where their
 * email and WhatsApp number stand. A member who chose their own seat carries no mark.
 */
export function placementMark(m: MarkInput, firstName: string): Mark | null {
  if (!m.placement) return null;
  const who = firstName.trim() || "They";
  if (m.withheld || m.contact === "withheld") {
    return { label: `Placed by the church · ${LEADER_MARKS.withheld.toLowerCase()}`, note: `${who} asked that their email and WhatsApp number are not shared. They have your details and will reach out.` };
  }
  if (m.placement === "confirmed") return { label: "Placed by the church · said yes", note: null };
  switch (m.contact) {
    case "open":
      return { label: `Placed by the church · ${LEADER_MARKS.details.toLowerCase()}`, note: null };
    case "holding":
    case "unanswered":
      return { label: "Placed by the church · waiting for a reply", note: `${who} has not said yes yet, so their email and WhatsApp number are not open. They open when ${who} says yes.` };
    case "waiting":
    case "not_reached":
      return { label: `Placed by the church · ${LEADER_MARKS.notReached.toLowerCase()}`, note: `${who} has not been reached yet, so their email and WhatsApp number are not open. They open once ${who} has said yes.` };
    default:
      return { label: "Placed by the church · yet to answer", note: null };
  }
}

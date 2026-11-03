import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import type { PlacedState } from "./types";
import { PLACED_CONTACT_WORDS } from "./wording";

/** "Fri 12 Feb, 4:00 pm", in Lagos time. */
export const whenText = (iso: string): string => `${formatLagosDay(iso)}, ${formatLagosTime(iso)}`;

/**
 * What a placed member is told about their details. The leader sees their name from the moment they are placed; the email and the
 * WhatsApp number follow when the member says yes, and not before.
 */
export function contactLine(s: Pick<PlacedState, "contact" | "contactOpensAt" | "hasWhatsapp" | "tribe">): string {
  const who = s.tribe.leaderFirst || "Your leader";
  const what = `your email${s.hasWhatsapp ? " and your WhatsApp number" : ""}`;
  switch (s.contact) {
    case "withheld":
      return `You asked us not to share your details. ${who} can see your name, but will not be given ${what}.`;
    case "open":
      return `${who} has been given your name, ${what}.`;
    default:
      return `${who} can see your name. They are given ${what} only after you press “Yes, I’m in”, so they can say hello. You can keep them private below.`;
  }
}

/** Why there is no group link yet, said once, when there is none to show. Null when the link is shown or the member was not placed by the church. */
export function groupNote(s: Pick<PlacedState, "active" | "groupVisible"> | null): string | null {
  if (!s || !s.active || s.groupVisible) return null;
  return PLACED_CONTACT_WORDS.groupWaiting;
}

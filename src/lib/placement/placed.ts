import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import type { PlacedState } from "./types";
import { PLACED_CONTACT_WORDS } from "./wording";

/** "Fri 12 Feb, 4:00 pm", in Lagos time. */
export const whenText = (iso: string): string => `${formatLagosDay(iso)}, ${formatLagosTime(iso)}`;

/**
 * What a placed member is told about their details. The leader sees their name from the moment they are placed; the email and the
 * WhatsApp number follow when the member says yes, agreed on the form, or their own day has passed.
 */
export function contactLine(s: Pick<PlacedState, "contact" | "contactOpensAt" | "hasWhatsapp" | "tribe">): string {
  const who = s.tribe.leaderFirst || "Your leader";
  const what = `your email${s.hasWhatsapp ? " and your WhatsApp number" : ""}`;
  switch (s.contact) {
    case "withheld":
      return `You asked us not to share your details. ${who} can see your name, but will not be given ${what}.`;
    case "open":
      return `${who} has been given your name, ${what}.`;
    case "holding":
      return `${who} can see your name. ${s.contactOpensAt ? `They are given ${what} on ${whenText(s.contactOpensAt)}` : `They are given ${what} when your day has passed`}, so they can say hello. You can stop that below.`;
    default:
      return `${who} can see your name. A day after we have emailed you, they are given ${what} so they can say hello. You can stop that below.`;
  }
}

/** Why there is no group link yet, said once, when there is none to show. Null when the link is shown or the member was not placed by the church. */
export function groupNote(s: Pick<PlacedState, "active" | "groupVisible" | "groupOpensAt"> | null): string | null {
  if (!s || !s.active || s.groupVisible) return null;
  return s.groupOpensAt ? PLACED_CONTACT_WORDS.groupWhen(whenText(s.groupOpensAt)) : PLACED_CONTACT_WORDS.groupWaiting;
}

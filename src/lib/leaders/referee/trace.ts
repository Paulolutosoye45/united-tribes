import { createHmac } from "node:crypto";
import { hashSalt, hashNetwork, networkKey } from "@/lib/signin/hash";
import { isBrowserMarker } from "./marker";

export { BROWSER_COOKIE, BROWSER_COOKIE_SECONDS, isBrowserMarker, newBrowserMarker } from "./marker";

/**
 * Where a request came from, kept only as two salted hashes: the network and a random marker the browser carries.
 * They let the database notice when an applicant and their "referee" are plainly the same person on the same phone.
 * Neither can be turned back into an address or a person, and the database forgets them after 45 days.
 */
export type Trace = { net: string | null; bid: string | null };

/** `marker` is the raw cookie value. The database only ever sees hashes, and `null` when there is nothing to hash or no salt. */
export function traceOf(headers: Headers, marker: string | undefined | null, salt: string | null = hashSalt()): Trace {
  const net = hashNetwork(networkKey(headers), salt);
  const bid = salt && marker && isBrowserMarker(marker) ? createHmac("sha256", salt).update(`browser:${marker}`).digest("hex") : null;
  return { net, bid };
}

/**
 * Programs that open a link to draw a preview (WhatsApp, Telegram, Slack, Facebook, link scanners in mail systems, search
 * engines). Their visit must not count as the referee opening the page. A real person is never turned away by this: it only
 * decides what gets recorded.
 */
const ROBOTS =
  /whatsapp|telegrambot|slackbot|slack-imgproxy|facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|skypeuripreview|googlebot|google-inspectiontool|bingbot|bingpreview|yandex|duckduckbot|baiduspider|applebot|embedly|pinterest|vkshare|w3c_validator|mimecast|proofpoint|barracuda|safelinks|curl\/|wget\/|python-requests|go-http-client|okhttp|headlesschrome|lighthouse|preview|crawler|spider|bot\b/i;

export function isLinkRobot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  return ROBOTS.test(ua);
}

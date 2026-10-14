/**
 * The browser marker: a random text the browser carries so the database can tell that an applicant and their "referee" are
 * on the same browser. It is made with the web crypto API so the request proxy can use it too. It means nothing by itself:
 * only a salted hash of it is ever sent to the database (trace.ts).
 */
export const BROWSER_COOKIE = "ut_bid";
/** Forty-five days, the same as the database's memory. */
export const BROWSER_COOKIE_SECONDS = 45 * 24 * 60 * 60;

export function newBrowserMarker(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const isBrowserMarker = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);

/** The pages where the marker is handed out: the applicant's own pages and the referee's link. Nowhere else needs it. */
export const wantsMarker = (pathname: string) => pathname === "/lead" || pathname.startsWith("/lead/") || pathname.startsWith("/reference/");

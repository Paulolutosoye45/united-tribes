import type { FeedTable } from "./types";

/** A link's secret: 64 lower-case hex characters. Anything else is not a link, and nothing is asked of the database for it. */
export const TOKEN_RE = /^[a-f0-9]{64}$/;
export const isToken = (v: unknown): v is string => typeof v === "string" && TOKEN_RE.test(v);

/** Where a prepared file is fetched (a route that checks the person again) and where a printed page opens. */
export const fileHref = (token: string): string => `/exports/file/${token}`;
export const printHref = (token: string): string => `/exports/print/${token}`;

/** A standing link: one coded table as a CSV, for a tool that fetches a web address on a schedule. */
export const feedPath = (token: string, table: FeedTable): string => `/feeds/${token}/${table}`;
export const feedUrl = (origin: string, token: string, table: FeedTable): string => `${origin.replace(/\/+$/, "")}${feedPath(token, table)}`;

/** The file name the browser should use, from a Content-Disposition header the file route set. Never trusts more than a plain name. */
export function nameFromDisposition(header: string | null, fallback: string): string {
  const m = header?.match(/filename="([A-Za-z0-9._-]{1,120})"/);
  return m ? m[1] : fallback;
}

/**
 * Turns a database error into words a person can act on. The functions in the
 * Phase 2 migration raise readable messages for the cases people can fix
 * (22023, P0002, 42501); anything else is a connection or server problem.
 */
export const TRY_AGAIN = "We couldn’t save that. Check your connection and try again.";
export const SESSION_ENDED = "Your session ended. Sign in again to continue.";

export function friendly(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return TRY_AGAIN;
  if (error.code === "22023" || error.code === "P0002" || error.code === "42501") {
    const message = (error.message ?? "").trim();
    if (message && message.length <= 200) return /[.!?]$/.test(message) ? message : `${message}.`;
  }
  return TRY_AGAIN;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

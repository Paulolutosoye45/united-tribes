import "server-only";
import { cookies } from "next/headers";

/**
 * A person with no account who types the right code gets a session that lasts three hours; its secret lives in this cookie (the database
 * keeps only a hash of it). The cookie belongs to one link: it is only sent to that page, and it is not readable by scripts.
 */
const MAX_AGE = 3 * 60 * 60;
const SECRET = /^[a-f0-9]{64}$/;

export const detailsCookieName = (token: string) => `ut_dc_${token.slice(0, 12)}`;

export async function readDetailsSession(token: string): Promise<string | null> {
  const value = (await cookies()).get(detailsCookieName(token))?.value;
  return value && SECRET.test(value) ? value : null;
}

export async function keepDetailsSession(token: string, session: string) {
  (await cookies()).set(detailsCookieName(token), session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/details/${token}`,
    maxAge: MAX_AGE,
  });
}

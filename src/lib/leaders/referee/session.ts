import "server-only";
import { cookies } from "next/headers";

/**
 * The referee has no account. Typing the right code opens a session that lasts three hours; its secret lives in this cookie
 * (the database keeps only a hash of it). The cookie belongs to one link: it is only sent to that page.
 */
const MAX_AGE = 3 * 60 * 60;
const SECRET = /^[a-f0-9]{64}$/;

export const refereeCookieName = (token: string) => `ut_rs_${token.slice(0, 12)}`;

export async function readRefereeSession(token: string): Promise<string | null> {
  const value = (await cookies()).get(refereeCookieName(token))?.value;
  return value && SECRET.test(value) ? value : null;
}

export async function keepRefereeSession(token: string, session: string) {
  (await cookies()).set(refereeCookieName(token), session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/reference/${token}`,
    maxAge: MAX_AGE,
  });
}

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole, parseRoles, type Role } from "./roles";

export type Person = {
  id: string;
  email: string;
  fullName: string | null;
  preferredName: string | null;
  avatarUrl: string | null;
  centreId: string;
};

/**
 * The platform owner's state for this sign-in. Everyone else is always "none", and there is no way for them to tell
 * "none" from a page that does not exist. "locked" is the owner before the passphrase; "open" is after it.
 */
export type GodState = "none" | "locked" | "open";

export type Session = {
  person: Person;
  roles: Role[];
  god: GodState;
  /** The WhatsApp number added for signing in, as the sign-in service holds it (digits only), or null. */
  signInPhone: string | null;
};

/**
 * Set when a request carries a valid sign-in for a person who is no longer here (their account was deleted), so that
 * `requireSession` can sign them out instead of sending them round in a tribe.
 */
const accountGone = cache(() => ({ value: false }));

/**
 * The signed-in person and their roles, read once per request.
 * Identity comes from the verified token; the database then applies its own
 * rules to every query, so this is never the only line of defence.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  // Everything behind sign-in is personal, so it must render per request,
  // never be built ahead of time.
  await connection();
  if (!getSupabaseEnv()) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) return null;
  const phoneClaim = typeof data?.claims?.phone === "string" ? data.claims.phone.replace(/\D/g, "") : "";

  const [{ data: row }, { data: roles }, { data: god }] = await Promise.all([
    supabase
      .from("people")
      .select("id, email, full_name, preferred_name, avatar_url, centre_id")
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("my_roles"),
    supabase.rpc("god_state"),
  ]);
  if (!row) {
    accountGone().value = true;
    return null;
  }

  return {
    person: {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      preferredName: row.preferred_name,
      avatarUrl: row.avatar_url,
      centreId: row.centre_id,
    },
    roles: parseRoles(roles),
    god: god === "open" || god === "locked" ? god : "none",
    signInPhone: phoneClaim || null,
  };
});

/** Sends visitors to sign in, then back to where they were going. */
export async function requireSession(returnTo = "/home"): Promise<Session> {
  const session = await getSession();
  if (!session) {
    // A valid sign-in for someone who is gone: clear it. Sending them to the sign-in page would only be sent straight back.
    if (accountGone().value) redirect("/auth/ended");
    redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  }
  return session;
}

/**
 * For pages only some roles may open. A person who may not open a leaders' page is shown why (who they are signed in as, how to switch account,
 * who to tell) instead of being sent home without a word. For any other page they go back home, as before.
 */
export async function requireRole(allowed: readonly Role[], returnTo: string): Promise<Session> {
  const session = await requireSession(returnTo);
  if (!hasAnyRole(session.roles, allowed)) {
    const leaders = allowed.some((r) => r === "leader" || r === "assistant_leader");
    redirect(leaders ? `/no-access?for=leader&from=${encodeURIComponent(returnTo)}` : "/home");
  }
  return session;
}

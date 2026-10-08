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

export type Session = {
  person: Person;
  roles: Role[];
  /** The WhatsApp number added for signing in, as the sign-in service holds it (digits only), or null. */
  signInPhone: string | null;
};

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

  const [{ data: row }, { data: roles }] = await Promise.all([
    supabase
      .from("people")
      .select("id, email, full_name, preferred_name, avatar_url, centre_id")
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("my_roles"),
  ]);
  if (!row) return null;

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
    signInPhone: phoneClaim || null,
  };
});

/** Sends visitors to sign in, then back to where they were going. */
export async function requireSession(returnTo = "/home"): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return session;
}

/** For pages only some roles may open. Others go back home. */
export async function requireRole(allowed: readonly Role[], returnTo: string): Promise<Session> {
  const session = await requireSession(returnTo);
  if (!hasAnyRole(session.roles, allowed)) redirect("/home");
  return session;
}

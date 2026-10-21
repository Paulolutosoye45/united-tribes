"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminErrorMessage } from "@/lib/admin/errors";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { status: "idle" | "ok" | "error"; message: string };

const MANAGERS: Role[] = ["admin", "director"];

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(ROLES).refine((r) => r !== "member", "Everyone is already a member"),
});

/** Invite someone to a role. The database decides whether the caller may. */
export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(MANAGERS, "/admin");

  const parsed = inviteSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address and choose a role." };
  }
  const { email, role } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_person", { p_email: email, p_role: role });
  if (error) return { status: "error", message: adminErrorMessage(error) };

  revalidatePath("/admin/people");
  revalidatePath("/admin");
  const label = ROLE_LABELS[role];
  const grantedNow = Boolean((data as { granted_now?: boolean } | null)?.granted_now);
  return {
    status: "ok",
    message: grantedNow
      ? `${email} already has an account, so they are now ${label.toLowerCase()}. An email is on its way to tell them.`
      : `${email} is invited as ${label.toLowerCase()}. An email is on its way. They get the role the first time they sign in with that address.`,
  };
}

const revokeInvitationSchema = z.object({ id: z.uuid() });

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  await requireRole(MANAGERS, "/admin");
  const parsed = revokeInvitationSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  const supabase = await createClient();
  await supabase.rpc("revoke_invitation", { p_invitation: parsed.data.id });
  revalidatePath("/admin/people");
  revalidatePath("/admin");
}

const removeRoleSchema = z.object({
  person: z.uuid(),
  role: z.enum(ROLES).refine((r) => r !== "member"),
});

export async function removeRoleAction(formData: FormData): Promise<void> {
  await requireRole(MANAGERS, "/admin");
  const parsed = removeRoleSchema.safeParse({ person: formData.get("person"), role: formData.get("role") });
  if (!parsed.success) return;

  const supabase = await createClient();
  await supabase.rpc("revoke_role", { p_person: parsed.data.person, p_role: parsed.data.role });
  revalidatePath("/admin/people");
  revalidatePath("/admin");
}

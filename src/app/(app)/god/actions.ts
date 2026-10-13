"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { plain, run, type Result } from "@/lib/admin/rpc";
import { ROLES } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE: Result = { ok: false, message: "That page is not available." };

/** Locks the console now and goes back to the unlock step. */
export async function lockAction(): Promise<void> {
  if (await ownerOnly()) await run("god_lock", undefined, ["/god"]);
  redirect("/god/unlock");
}

export type PhraseState = { status: "idle" | "ok" | "error"; message: string };

/** Changes the owner's passphrase. The database checks the current one (and counts a wrong try like any other). */
export async function changePhraseAction(_prev: PhraseState, formData: FormData): Promise<PhraseState> {
  if (!(await ownerOnly())) return { status: "error", message: "That page is not available." };
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const again = String(formData.get("again") ?? "");
  if (next !== again) return { status: "error", message: "The two new passphrases are not the same." };
  const done = await run<{ ok: boolean; message?: string }>("god_set_phrase", { p_old: current, p_new: next });
  if (!done.ok) return { status: "error", message: done.message };
  if (!done.data?.ok) return { status: "error", message: done.data?.message ?? "That did not work." };
  return { status: "ok", message: "Your passphrase is changed. Use the new one the next time you unlock." };
}

const roleSchema = z.object({
  person: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(ROLES).refine((r) => r !== "member", "Everyone is already a member"),
});

/** Gives someone a role. The same office function an admin uses, so the same rules and the same record apply. */
export async function giveRoleAction(person: string, email: string, role: string): Promise<Result> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const parsed = roleSchema.safeParse({ person, email, role });
  if (!parsed.success) return { ok: false, message: "That role could not be given." };
  return plain(await run("invite_person", { p_email: parsed.data.email, p_role: parsed.data.role }, ["/god", `/god/people/${parsed.data.person}`, "/admin/people"]));
}

export async function takeRoleAction(person: string, role: string): Promise<Result> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || !(ROLES as readonly string[]).includes(role) || role === "member") return { ok: false, message: "That role could not be removed." };
  return plain(await run("revoke_role", { p_person: person, p_role: role }, ["/god", `/god/people/${person}`, "/admin/people"]));
}

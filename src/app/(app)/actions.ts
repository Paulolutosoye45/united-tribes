"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type NameState = { status: "idle" | "ok" | "error"; message: string };

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  // Letters, marks, spaces, apostrophes, hyphens and full stops cover names in any script.
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u);

/** Lets a person say what to call them. Runs as the person, so the database allows only their own row. */
export async function saveNameAction(_prev: NameState, formData: FormData): Promise<NameState> {
  const session = await requireSession("/home");
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { status: "error", message: "Use letters only, up to 40 characters." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .update({ preferred_name: parsed.data })
    .eq("id", session.person.id)
    .select("id");
  if (error || !data?.length) {
    return { status: "error", message: "We couldn't save that. Try again in a moment." };
  }

  revalidatePath("/", "layout");
  return { status: "ok", message: "Saved." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

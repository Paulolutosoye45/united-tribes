import "server-only";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, friendly } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";
import type { Result } from "./types";

export type Done<T = unknown> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Runs one database function as the signed-in person. The database checks who they are and what they may do and says,
 * in words, what is wrong; this turns a refusal into a message and refreshes the pages that show the result.
 */
export async function run<T = unknown>(fn: string, args: Record<string, unknown> | undefined, pages: string[] = []): Promise<Done<T>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: friendly(error) };
  for (const page of pages) revalidatePath(page);
  return { ok: true, data: data as T };
}

/** Text from a form field, as the person typed it (the database trims and checks length). */
export const text = (value: unknown, max = 2000): string => (typeof value === "string" ? value.slice(0, max) : "");

export type { Result };

/** The answer an action gives back to the screen: just whether it worked, and if not, why. */
export const plain = (done: Done): Result => (done.ok ? { ok: true } : done);

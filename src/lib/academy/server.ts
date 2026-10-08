import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { MyAcademy, MyCircle } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The signed-in leader’s whole training picture, or null when they are not in training. */
export async function loadMyAcademy(supabase: Supabase): Promise<MyAcademy | null> {
  const { data, error } = await supabase.rpc("my_academy");
  if (error || !data) return null;
  return data as MyAcademy;
}

export async function loadMyCircle(supabase: Supabase): Promise<MyCircle | null> {
  const { data, error } = await supabase.rpc("my_circle");
  if (error || !data) return null;
  return data as MyCircle;
}

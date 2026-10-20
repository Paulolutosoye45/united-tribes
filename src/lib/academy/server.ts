import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { parseAcademyModes, type AcademyModes } from "./modes";
import type { MyAcademy, MyTribe } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The signed-in leader’s whole training picture, or null when they are not in training. */
export async function loadMyAcademy(supabase: Supabase): Promise<MyAcademy | null> {
  const { data, error } = await supabase.rpc("my_academy");
  if (error || !data) return null;
  return data as MyAcademy;
}

export async function loadMyTribe(supabase: Supabase): Promise<MyTribe | null> {
  const { data, error } = await supabase.rpc("my_tribe");
  if (error || !data) return null;
  return data as MyTribe;
}

/** Where the Academy and the declaration stand. If they cannot be read, both count as required. */
export async function loadAcademyModes(supabase: Supabase): Promise<AcademyModes> {
  const { data, error } = await supabase.rpc("academy_switch");
  return error ? parseAcademyModes(null) : parseAcademyModes(data);
}

import "server-only";
import { cache } from "react";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type CentreChoice = { id: string; name: string; slug: string; active: boolean };
export type MyCentres = { multi: boolean; current: { id: string; name: string; slug: string } | null; centres: CentreChoice[] };

/**
 * The centres this person holds a role in. Read once per request. The switcher is shown only when the platform's
 * multi-centre switch is on AND the person has a role in more than one centre, so a single-centre church never sees it.
 */
export const getMyCentres = cache(async (): Promise<MyCentres | null> => {
  if (!getSupabaseEnv()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_centres");
  if (error || !data) return null;
  const value = data as MyCentres;
  return { multi: value.multi === true, current: value.current ?? null, centres: Array.isArray(value.centres) ? value.centres : [] };
});

export function canSwitchCentre(c: MyCentres | null): c is MyCentres {
  return Boolean(c && c.multi && c.centres.filter((x) => x.active).length > 1);
}

"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import type { PersonHit } from "@/lib/admin/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/champions", "/community", "/admin"];

export async function findPeopleAction(query: string): Promise<{ ok: true; people: PersonHit[] } | { ok: false; message: string }> {
  const done = await run<PersonHit[]>("find_people", { p_query: text(query, 80) });
  return done.ok ? { ok: true, people: Array.isArray(done.data) ? done.data : [] } : done;
}

export async function assignChampionAction(person: string, community: string): Promise<Result> {
  if (!isUuid(person) || !isUuid(community)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("assign_community_champion", { p_person: person, p_community: community }, PAGES));
}

export async function removeChampionAction(person: string, community: string): Promise<Result> {
  if (!isUuid(person) || !isUuid(community)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("remove_community_champion", { p_person: person, p_community: community }, PAGES));
}

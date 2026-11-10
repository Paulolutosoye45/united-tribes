"use server";

import { run } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { LAGOS_ZONES, SLOT_KEYS, parseGroup, parseRevealed, parseSuggestions, type Group, type Suggestion } from "@/lib/god/desk";

const PAGES = ["/god/leader-desk"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. The database refuses them again. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/**
 * Opens one full phone number. The database allows it only between 8 am and 8 pm Lagos time, at most 60 an hour, writes down who opened it (never the number),
 * and the number is returned to the screen that asked and kept nowhere.
 */
export async function revealNumberAction(person: string): Promise<{ ok: true; number: string | null } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person)) return bad();
  const done = await run("desk_phone_reveal", { p_person: person }, []);
  if (!done.ok) return done;
  const shown = parseRevealed(done.data);
  return shown ? { ok: true, number: shown.number } : bad();
}

export type GroupInput = {
  id: string | null;
  name: string;
  track: string;
  community: string | null;
  goal: string | null;
  slot: string;
  mode: "online" | "in_person";
  zone: string | null;
  type: "mixed" | "women" | "men";
  capacity: number;
  note: string;
};

/** Makes a draft group or changes one. The database checks every field again and says in words what is wrong. */
export async function saveGroupAction(input: GroupInput): Promise<{ ok: true; group: Group | null } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || typeof input !== "object") return bad();
  if (input.id !== null && !isUuid(input.id)) return bad();
  if (typeof input.name !== "string" || input.name.length > 200) return bad();
  if (!isUuid(input.track)) return { ok: false, message: "Choose the life stage the group is for." };
  if (input.community !== null && !isUuid(input.community)) return bad();
  if (input.goal !== null && !isUuid(input.goal)) return bad();
  if (!SLOT_KEYS.includes(input.slot)) return { ok: false, message: "Choose when the group meets." };
  if (input.mode !== "online" && input.mode !== "in_person") return { ok: false, message: "Choose whether the group meets online or in person." };
  if (input.mode === "in_person" && !(LAGOS_ZONES as readonly string[]).includes(input.zone ?? "")) return { ok: false, message: "A group that meets in person needs an area in Lagos." };
  if (input.type !== "mixed" && input.type !== "women" && input.type !== "men") return { ok: false, message: "Choose whether the group is mixed, women or men." };
  if (typeof input.capacity !== "number" || !Number.isInteger(input.capacity) || input.capacity < 4 || input.capacity > 12) return { ok: false, message: "A group holds 4 to 12 people." };
  if (typeof input.note !== "string" || input.note.length > 600) return bad();
  const done = await run(
    "desk_group_save",
    {
      p_id: input.id,
      p_name: input.name,
      p_track: input.track,
      p_community: input.community,
      p_goal: input.goal,
      p_slot: input.slot,
      p_mode: input.mode,
      p_zone: input.mode === "in_person" ? input.zone : null,
      p_type: input.type,
      p_capacity: input.capacity,
      p_note: input.note.trim() === "" ? null : input.note,
    },
    PAGES,
  );
  return done.ok ? { ok: true, group: parseGroup(done.data) } : done;
}

export async function archiveGroupAction(group: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_group_archive", { p_group: group }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function addMemberAction(group: string, person: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group) || !isUuid(person)) return bad();
  const done = await run("desk_group_member_add", { p_group: group, p_person: person }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function removeMemberAction(group: string, person: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group) || !isUuid(person)) return bad();
  const done = await run("desk_group_member_remove", { p_group: group, p_person: person }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** The waiting members who would suit this group best. Only reads. */
export async function suggestMembersAction(group: string): Promise<{ ok: true; people: Suggestion[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_group_suggest", { p_group: group, p_limit: 12 }, []);
  return done.ok ? { ok: true, people: parseSuggestions(done.data) } : done;
}

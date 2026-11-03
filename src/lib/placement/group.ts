// The leader's WhatsApp group list: who may be added (people who said yes), who is still to answer, and who has left and may need removing.
// What the screens read from the database (tribe_group_list) and every sentence they say. A number is here only where the database allowed it:
// the person said yes, did not keep their details private, and agreed to WhatsApp.

export type GroupAdmit = {
  person_id: string;
  name: string;
  /** Null when the person keeps their number private, gave none, or did not agree to WhatsApp. */
  whatsapp: string | null;
  private: boolean;
  admitted: boolean;
};

export type GroupRemove = { person_id: string; name: string; removed: boolean };

export type GroupList = {
  has_link: boolean;
  admit: GroupAdmit[];
  /** Names only: placed by the church and not yet answered. */
  waiting: string[];
  remove: GroupRemove[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Reads the answer of tribe_group_list. Anything that is not the right shape is left out, so a half-written answer shows less, never more. */
export function parseGroupList(v: unknown): GroupList | null {
  if (!isObj(v)) return null;
  const admit: GroupAdmit[] = [];
  for (const r of list(v.admit)) {
    if (!isObj(r)) continue;
    const id = str(r.person_id);
    if (!id) continue;
    admit.push({ person_id: id, name: str(r.name) ?? "A member", whatsapp: str(r.whatsapp), private: r.private === true, admitted: r.admitted === true });
  }
  const remove: GroupRemove[] = [];
  for (const r of list(v.remove)) {
    if (!isObj(r)) continue;
    const id = str(r.person_id);
    if (!id) continue;
    remove.push({ person_id: id, name: str(r.name) ?? "A member", removed: r.removed === true });
  }
  return {
    has_link: v.has_link === true,
    admit,
    waiting: list(v.waiting).map(str).filter((n): n is string => n !== null),
    remove,
  };
}

/** Everything the group list says. */
export const GROUP_WORDS = {
  title: "Your WhatsApp group",
  intro:
    "Add a member to the group only after they have said yes. Joining shows their number to everyone in it, which is why it waits for their yes. Tick each person once you have added them, so the assistant does not add them twice.",
  admitHeading: "Ready to add",
  admitEmpty: "Nobody has said yes yet. People you have not yet added appear here the moment they press “Yes, I’m in”.",
  admitDone: "Everyone who has said yes has been added.",
  privateNote: "Keeps their number private. Send them the group link, or ask them to join with it.",
  noNumber: "No number to add. Send them the group link.",
  addedLabel: "Added to the group",
  waitingHeading: "Placed by the church, waiting for a reply",
  waitingLine: "You can see their names. Their number opens when they say yes, and not before.",
  removeHeading: "If they joined the group, remove them",
  removeLine: "These people have left your tribe. If they were in the group, take them out of it and tick them here.",
  removedLabel: "Removed from the group",
  noLink: "You have not saved the group link yet. Add it above and members who say yes will find it on their tribe page.",
} as const;

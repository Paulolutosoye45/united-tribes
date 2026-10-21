import { NOTICE_CATALOGUE, NOTICE_GROUPS } from "@/lib/messaging/templates-notices";

/**
 * What the Notifications page and the "My notices" choice read from the database (notice_overview, notice_log, my_notice_prefs). The database
 * has already left out the hidden owner and anything the office should not see; this only reads the answer safely and words it.
 */

export const NOTICE_MODES = ["off", "rehearsal", "on"] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];

export const MODE_WORDS: Record<NoticeMode, { label: string; hint: string; saved: string }> = {
  off: { label: "Off", hint: "Nothing is queued. This is how every group starts.", saved: "Off. Nothing will be queued." },
  rehearsal: {
    label: "Rehearsal",
    hint: "Each notice is written to the log as if it were sent, and nobody is emailed. Read the log, then switch it on.",
    saved: "Rehearsal. Notices are logged and nobody is emailed.",
  },
  on: { label: "On", hint: "The team is emailed, at once or in their daily summary as each person chose.", saved: "On. The team is emailed from now." },
};

export type Delivery = "instant" | "daily" | "weekly";
export const DELIVERY_WORDS: Record<Delivery, string> = { instant: "Right away", daily: "A daily summary", weekly: "A weekly summary" };
const isDelivery = (v: unknown): v is Delivery => v === "instant" || v === "daily" || v === "weekly";
const isMode = (v: unknown): v is NoticeMode => v === "off" || v === "rehearsal" || v === "on";

export type NoticePerson = { id: string; name: string; role: string; canBeTold: boolean; delivery: Delivery };
export type NoticeGroupState = { key: string; mode: NoticeMode; updatedAt: string | null; /** null for groups of people we do not list: members, applicants, referees. */ people: NoticePerson[] | null };
export type NoticeOverview = {
  canEdit: boolean;
  groups: NoticeGroupState[];
  numbers: { key: string; value: number; note: string }[];
  faults: { at: string; source: string; message: string }[];
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const KNOWN_GROUPS = new Set<string>(NOTICE_GROUPS.map((g) => g.key));

export function parseOverview(raw: unknown): NoticeOverview | null {
  const o = obj(raw);
  if (!o) return null;
  const groups: NoticeGroupState[] = [];
  for (const g of arr(o.groups)) {
    const item = obj(g);
    const key = text(item?.key, 30);
    if (!item || !KNOWN_GROUPS.has(key)) continue;
    const people =
      item.people == null
        ? null
        : arr(item.people).flatMap((p) => {
            const x = obj(p);
            const id = text(x?.id, 60);
            return x && id
              ? [{ id, name: text(x.name, 120) || "Someone", role: text(x.role, 40), canBeTold: x.can_be_told === true, delivery: isDelivery(x.delivery) ? x.delivery : ("daily" as Delivery) }]
              : [];
          });
    groups.push({ key, mode: isMode(item.mode) ? item.mode : "off", updatedAt: text(item.updated_at, 40) || null, people });
  }
  return {
    canEdit: o.can_edit === true,
    groups,
    numbers: arr(o.numbers).flatMap((n) => {
      const x = obj(n);
      const value = Number(x?.value);
      return x && text(x.key, 40) && Number.isFinite(value) ? [{ key: text(x.key, 40), value, note: text(x.note, 400) }] : [];
    }),
    faults: arr(o.faults).flatMap((f) => {
      const x = obj(f);
      return x ? [{ at: text(x.at, 40), source: text(x.source, 60), message: text(x.message, 300) }] : [];
    }),
  };
}

export type LogRow = { id: string; template: string; group: string; status: string; error: string | null; at: string; sentAt: string | null; to: string; rehearsal: boolean };

export function parseLog(raw: unknown): LogRow[] {
  return arr(raw).flatMap((r) => {
    const x = obj(r);
    // A message's id is a uuid
    const id = typeof x?.id === "string" || typeof x?.id === "number" ? String(x.id).slice(0, 60) : "";
    const template = text(x?.template, 80);
    if (!x || !id || !template) return [];
    return [{
      id, template, group: text(x.group, 30), status: text(x.status, 20), error: text(x.error, 200) || null,
      at: text(x.at, 40), sentAt: text(x.sent_at, 40) || null, to: text(x.to, 60), rehearsal: x.rehearsal === true,
    }];
  });
}

const TITLES = new Map(NOTICE_CATALOGUE.map((n) => [n.key, n.title]));
export const noticeTitle = (template: string) => TITLES.get(template) ?? template.replace(/_/g, " ");

/** What a row of the log says happened, in words. A rehearsal row was never going to be sent. */
export function logStatus(row: Pick<LogRow, "status" | "rehearsal">): { label: string; tone: "ok" | "wait" | "bad" | "quiet" } {
  if (row.rehearsal) return { label: "Rehearsal: not sent", tone: "quiet" };
  switch (row.status) {
    case "queued": return { label: "Waiting to go", tone: "wait" };
    case "sending": return { label: "Sending", tone: "wait" };
    case "sent": return { label: "Sent", tone: "ok" };
    case "delivered": return { label: "Delivered", tone: "ok" };
    case "read": return { label: "Opened", tone: "ok" };
    case "failed": return { label: "Failed", tone: "bad" };
    case "skipped": return { label: "Not sent", tone: "quiet" };
    default: return { label: row.status || "Unknown", tone: "quiet" };
  }
}

export type NoticePref = { group: string; delivery: Delivery; mode: NoticeMode };

export function parsePrefs(raw: unknown): NoticePref[] {
  return arr(raw).flatMap((p) => {
    const x = obj(p);
    const group = text(x?.group, 30);
    return x && KNOWN_GROUPS.has(group) ? [{ group, delivery: isDelivery(x.delivery) ? x.delivery : ("daily" as Delivery), mode: isMode(x.mode) ? x.mode : ("off" as NoticeMode) }] : [];
  });
}

/** The notices a group sends, for the Notifications page. */
export const noticesOf = (group: string) => NOTICE_CATALOGUE.filter((n) => n.group === group);

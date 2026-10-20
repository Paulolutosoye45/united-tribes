import { flat, num, smsLine, str } from "@/lib/messaging/format";
import type { Context, Params, TemplateDef } from "@/lib/messaging/types";
import { adaptParagraphs, churchOf, fieldValues, fill, modesOfData, preheaderFor, progressFor, type Data } from "./compose";
import type { DesignSpec, Hero } from "./email-design";
import { ASKS, JOURNEYS } from "./labels";

/**
 * Messages & Reminders. Two of these go to members and are written by the office or by the pastorate (the wording is
 * kept in the database and written into `params.copy` the moment the email is claimed). Three go to the team.
 */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

/** The address of one of our own email pages. The token is the whole of what the link says. */
const page = (c: Context, token: unknown) => (typeof token === "string" && token.length >= 32 ? c.link(`/e/${token}`) : "");

const WHY: Record<string, string> = {
  member_form: "You are getting this because you started your United Tribes form and have not finished it.",
  leader_application: "You are getting this because you started an application to lead a tribe and have not sent it.",
  no_tribe: "You are getting this because your tribes are ready on United Tribes and you have not chosen one yet.",
  in_tribe: "You are getting this because your tribe has begun on United Tribes.",
  announcement: "You are getting this as a member of United Tribes at The Covenant Nation.",
};

const SAVED_NOTE: Record<string, string> = {
  member_form: "Your answers are saved exactly as you left them.",
  leader_application: "Your application is saved exactly as you left it.",
};

function heroFor(journey: string, step: number, data: Data, values: Record<string, string>): Hero | undefined {
  if (journey === "member_form" || journey === "leader_application") {
    const progress = progressFor(journey, data.step, modesOfData(data));
    return progress ? { kind: "progress", progress, label: journey === "member_form" ? "Your form" : "Your application" } : undefined;
  }
  if (journey === "no_tribe" && step >= 2 && str(data.tribe_1)) {
    return { kind: "tribe", name: str(data.tribe_1), leader: values.leader_first, seats: num(data.seats_left), starts: values.season_starts };
  }
  if (journey === "in_tribe" && step >= 2 && data.meeting_day != null) {
    return { kind: "gathering", name: str(data.tribe) || "your tribe", when: str(data.next_meeting) || values.meets, leader: values.leader_first };
  }
  return undefined;
}

/** One-click unsubscribe: the address a mail program calls by itself (RFC 8058), and a page for people who follow the link by hand. */
export function unsubscribeHeaders(site: string, stopToken: string): Record<string, string> {
  const url = `${site.replace(/\/+$/, "")}/api/email/unsubscribe?t=${encodeURIComponent(stopToken)}`;
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

function designed(p: Params, c: Context): ReturnType<TemplateDef["email"]> {
  const kind = str(p.kind) === "announcement" ? "announcement" : "reminder";
  const copy = obj(p.copy);
  const data = obj(p.data) as Data;
  const links = obj(p.links);
  const journey = str(copy.journey) || null;
  const step = num(copy.step, 0);
  const values = fieldValues(data, journey, c.site);
  const subject = fill(str(copy.subject), values) || "A note from United Tribes";
  const paragraphs = adaptParagraphs(strs(copy.paragraphs), journey, modesOfData(data)).map((t) => fill(t, values)).filter(Boolean);
  const go = page(c, links.go);
  const label = str(copy.button_label);
  const progress = journey ? progressFor(journey, data.step, modesOfData(data)) : null;
  const stopToken = str(links.stop);
  const spec: DesignSpec = {
    subject,
    preheader: preheaderFor(kind, paragraphs, step <= 1 || kind === "announcement" ? progress : null) || subject,
    greeting: `Hi ${values.first_name === "friend" ? c.first : values.first_name},`,
    paragraphs,
    hero: journey ? heroFor(journey, step, data, values) : undefined,
    button: go && label ? { label: fill(label, values), url: go } : undefined,
    note: go && journey ? SAVED_NOTE[journey] : undefined,
    options: strs(copy.actions).flatMap((a) => {
      const url = page(c, links[a]);
      return url && ASKS[a] ? [{ label: ASKS[a].label, url }] : [];
    }),
    church: churchOf(p),
    why: kind === "announcement" ? WHY.announcement : (journey && WHY[journey]) || WHY.announcement,
    stopLabel: kind === "announcement" ? "Stop announcements" : "Stop these reminders",
    stopUrl: page(c, links.stop) || c.link("/profile"),
    prefsUrl: page(c, links.prefs) || c.link("/profile"),
  };
  return {
    subject,
    paragraphs,
    design: spec,
    ...(stopToken.length >= 32 ? { headers: unsubscribeHeaders(c.site, stopToken) } : {}),
  };
}

const reminderEmail: TemplateDef = {
  key: "reminder_email",
  audience: "member",
  emailOnly: true,
  title: "A reminder from one of the four journeys",
  email: designed,
  sms: (_p, c) => smsLine("A note from United Tribes. Pick up where you left off:", c.link("/home")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, your United Tribes page is waiting for you whenever you are ready: {{2}}",
    example: ["Ada", "https://unitedtribes.example/home"],
    vars: [flat(c.first), flat(c.link("/home"))],
  }),
};

const officeMessage: TemplateDef = {
  key: "office_message",
  audience: "member",
  emailOnly: true,
  title: "An announcement from the church office",
  email: designed,
  sms: (_p, c) => smsLine("A note from United Tribes:", c.link("/home")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, there is a new note for you from The Covenant Nation on United Tribes: {{2}}",
    example: ["Ada", "https://unitedtribes.example/home"],
    vars: [flat(c.first), flat(c.link("/home"))],
  }),
};

const broadcastWaiting: TemplateDef = {
  key: "broadcast_waiting",
  audience: "office",
  emailOnly: true,
  title: "An announcement is waiting for your approval",
  email: (p, c) => ({
    subject: "An announcement needs your approval",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `“${str(p.title) || "An announcement"}” is ready to go to ${num(p.count).toLocaleString("en")} ${num(p.count) === 1 ? "person" : "people"}. It cannot be sent until someone other than its writer has read it and said yes.`,
      "You will see exactly what they will read, and who it is for.",
    ],
    cta: { label: "Read and decide", url: c.link("/admin/announcements/approvals") },
  }),
  sms: (_p, c) => smsLine("An announcement is waiting for your approval:", c.link("/admin/announcements/approvals")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, an announcement is waiting for your approval before it can go out. Please read it here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/announcements/approvals"],
    vars: [flat(c.first), flat(c.link("/admin/announcements/approvals"))],
  }),
};

const reminderPaused: TemplateDef = {
  key: "reminder_paused",
  audience: "office",
  emailOnly: true,
  title: "A reminder journey has paused itself",
  email: (p, c) => ({
    subject: "A reminder journey paused itself",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `“${str(p.journey) || "A reminder journey"}” stopped by itself. ${str(p.why)}`.trim(),
      "Nothing turns it back on by itself. Read the emails, change anything that felt too much, and switch it back on when you are ready.",
    ],
    cta: { label: "Open reminders", url: c.link("/admin/reminders") },
  }),
  sms: (_p, c) => smsLine("A reminder journey paused itself because people asked for fewer emails. Look into it here:", c.link("/admin/reminders")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, one of the reminder journeys paused itself because people asked for fewer emails. Please look into it here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/reminders"],
    vars: [flat(c.first), flat(c.link("/admin/reminders"))],
  }),
};

const journeyAsk: TemplateDef = {
  key: "journey_ask",
  audience: "care",
  emailOnly: true,
  title: "Someone answered a reminder and asked for a person",
  email: (p, c) => {
    const kind = str(p.kind);
    const ask = ASKS[kind];
    return {
      subject: `${str(p.who) || "Someone"} asked for a person to reach out`,
      greeting: `Hi ${c.first},`,
      paragraphs: [
        `${str(p.who) || "Someone"} answered an email (“${str(p.journey) || "a reminder"}”) with “${ask?.label ?? "please reach out"}”.`,
        "A gentle, personal message goes a long way. Please reach out within two days.",
      ],
      cta: { label: "Open the list", url: c.link("/care/asks") },
    };
  },
  sms: (_p, c) => smsLine("Someone asked for a person to reach out after a reminder email:", c.link("/care/asks")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, someone answered a reminder email and asked for a person to reach out. Please see who here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/care/asks"],
    vars: [flat(c.first), flat(c.link("/care/asks"))],
  }),
};

export const OUTREACH_TEMPLATES: TemplateDef[] = [reminderEmail, officeMessage, broadcastWaiting, reminderPaused, journeyAsk];
export { JOURNEYS };

// ---------------------------------------------------------------------------
// For the office: a reminder as one person would read it, with made-up links that go nowhere
// ---------------------------------------------------------------------------

/** A believable person for each journey, so the wording can be read with real-looking details filled in. */
export const SAMPLE_DATA: Record<string, Data> = {
  member_form: { first_name: "Adaeze", step: "community", erase_date: "9 March 2027" },
  leader_application: { first_name: "Adaeze", step: "obstacles", close_date: "28 February 2027" },
  no_tribe: { first_name: "Adaeze", tribe_1: "Builders Tribe", leader_first: "Ngozi", seats_left: 3, season_starts: "14 February 2027", joining_closes: "28 February 2027" },
  in_tribe: { first_name: "Adaeze", tribe: "Builders Tribe", leader_first: "Ngozi", meeting_day: 3, meeting_time: "20:00", mode: "online", next_meeting: "Wednesday 17 February" },
};

export type ReminderCopy = { journey: string; step: number; tone: string; subject: string; paragraphs: string[]; button_label: string | null; actions: string[] };

export function reminderPreview(copy: ReminderCopy, site: string, church: { name: string; address: string }): DesignSpec {
  const base = site.replace(/\/+$/, "");
  const fake = (n: number) => `${n}`.padStart(2, "0").repeat(32);
  const c: Context = { site: base, first: "Adaeze", link: (path) => `${base}${path}`, reply: () => null };
  const links: Record<string, string> = { go: fake(11), stop: fake(12), prefs: fake(13) };
  copy.actions.forEach((a, i) => (links[a] = fake(20 + i)));
  const content = designed({ kind: "reminder", copy, data: SAMPLE_DATA[copy.journey] ?? {}, links, church }, c);
  return content.design as DesignSpec;
}

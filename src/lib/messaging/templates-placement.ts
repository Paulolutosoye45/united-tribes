import { flat, meetsText, num, shortDay, smsLine, str } from "./format";
import type { Context, EmailContent, Params, TemplateDef } from "./types";

/**
 * The messages behind automatic placement, bulk leaders and assistant recommendations. All of them are email only: they are never put to
 * Meta for approval, and the database only ever queues them as email. They come from the church office. Nothing in them names the owner.
 *
 * Rules the wording keeps, and the tests check:
 *   - "Your tribe" never carries a member's answers, faith journey, support needs, any score or who else is in the tribe. It says in one
 *     plain sentence what the leader will be given, and it gives three links: yes, other tribes, and don't share my details
 *   - "Your team" lists every member by name. A member whose details are open comes with an email and a WhatsApp number, and nothing else
 *     about them. A member who held back says so; one still in the hold says the day it ends; one who has not been reached says so. It
 *     never carries an answer, a need, an age or how well they fit
 *   - the tribe's WhatsApp group link goes in "Your tribe" only for a member who has already answered about sharing; otherwise the email
 *     says when it will appear. Either way it says joining a group shows your number to everyone in it
 *   - the links to the private page carry a secret the database made; if there is none the email falls back to the signed-in page
 *   - one idea and one main button; a subject that fits on a phone's lock screen
 */

const clean = (v: unknown, fallback = "") => str(v).replace(/\s+/g, " ").trim() || fallback;
const firstOf = (p: Params, key: string, fallback = "your leader") => clean(p[key], fallback);

/** The secret in the private link, taken from the reply link the sender builds for the message. Null when there is none. */
function secretOf(c: Context): string | null {
  const m = /\/r\/([a-f0-9]{64})/.exec(c.reply("done") ?? "");
  return m ? m[1] : null;
}

/** A link to the private page with one answer ready (the page asks the member to press the button; opening it changes nothing). */
function placedLink(c: Context, action: "confirm" | "change" | "withhold"): string | null {
  const secret = secretOf(c);
  return secret ? `${c.site}/placed/${secret}?a=${action}` : null;
}

const SHAREABLE = (v: unknown) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "");

type Spec = {
  key: string;
  audience: TemplateDef["audience"];
  title: string;
  subject: (p: Params) => string;
  email: (p: Params, c: Context) => Omit<EmailContent, "subject" | "greeting"> & { greeting?: string | false };
  /** One line for a text message or a WhatsApp variable, and the page it points to. */
  line: (p: Params) => string;
  path: string;
};

function build(s: Spec): TemplateDef {
  return {
    key: s.key,
    audience: s.audience,
    title: s.title,
    emailOnly: true,
    email: (p, c) => {
      const { greeting, ...rest } = s.email(p, c);
      return { subject: s.subject(p), ...(greeting === false ? {} : { greeting: greeting ?? `Hi ${c.first},` }), ...rest };
    },
    sms: (p, c) => smsLine(`United Tribes: ${s.line(p)}`, c.link(s.path)),
    whatsapp: (p, c) => ({
      body: "Hi {{1}}, a note from United Tribes: {{2}} You can open it here: {{3}}",
      example: ["Ada", s.line({ tribe: "Builders Tribe" }), c.link(s.path)],
      vars: [flat(c.first), flat(s.line(p)), flat(c.link(s.path))],
    }),
  };
}

/** The group link, or the day it will appear. Joining a WhatsApp group shows your number to everyone in it, so a member who has not yet
 * answered about sharing is told when the link will come instead. */
function groupLines(p: Params): string[] {
  if (clean(p.group_url)) {
    return [`The tribe’s WhatsApp group: ${clean(p.group_url)}`, "Joining a WhatsApp group shows your number to everyone in it."];
  }
  if (p.group_held === true) {
    const hold = Math.max(0, Math.round(num(p.hold_hours, 24)));
    const when = hold > 0 ? `in ${hold} hours` : "shortly";
    return [
      `The tribe’s WhatsApp group link will be on your tribe page as soon as you press “Yes, I’m in”, or ${when}. Joining a WhatsApp group shows your number to everyone in it, so we wait until you have had the chance to say “Don’t share my details”.`,
    ];
  }
  return [];
}

const fitWord = (p: Params) => {
  const f = str(p.fit);
  return f === "excellent" || f === "strong" || f === "good" ? f : "";
};

/** What the leader will be given, in one honest sentence. */
function sharing(p: Params): string {
  const hold = Math.max(0, Math.round(num(p.hold_hours, 24)));
  const what = p.has_whatsapp === true ? "your name, your email and your WhatsApp number" : "your name and your email";
  if (p.agreed_to_share === true) {
    return `Because you agreed on the form, your leader will be given ${what} so they can say hello. If you would rather they were not, press “Don’t share my details” below first.`;
  }
  return `In ${hold} hours, ${firstOf(p, "leader_first")} will be given ${what} so they can say hello. If you would rather they were not, press “Don’t share my details” below before then.`;
}

function pictureLines(p: Params): string[] {
  const lines: [string, unknown][] = [["Loving God", p.god], ["Loving others", p.others], ["Loving life", p.life]];
  return lines.filter(([, v]) => clean(v)).map(([label, v]) => `${label}: ${clean(v)}`);
}

// ---------------------------------------------------------------------------
// The member
// ---------------------------------------------------------------------------

const yourTribe = build({
  key: "placement_your_tribe",
  audience: "member",
  title: "The church has placed you in a tribe",
  subject: (p) => `A place for you in ${clean(p.tribe, "a tribe")}`.slice(0, 78),
  path: "/tribe",
  line: (p) => `the church has placed you in ${clean(p.tribe, "a tribe")}. Please confirm it or choose another.`,
  email: (p, c) => {
    const who = clean(p.assistant_first) ? `${firstOf(p, "leader_first")} and ${clean(p.assistant_first)}` : firstOf(p, "leader_first");
    const fit = fitWord(p);
    const yes = placedLink(c, "confirm");
    const other = placedLink(c, "change");
    const hold = placedLink(c, "withhold");
    const picture = pictureLines(p);
    return {
      paragraphs: [
        `You told us about your season, and we have not wanted you to wait. The church has placed you in ${clean(p.tribe, "a tribe")}, led by ${who}${fit ? `. It is ${fit === "excellent" ? "an excellent" : `a ${fit}`} fit for what you asked for` : ""}.`,
        `It meets ${meetsText(p)}. The season begins on ${shortDay(str(p.starts_on)) || "its first day"}, and your first meeting should be by ${shortDay(str(p.first_meeting_by)) || "the first weeks"}.`,
        ...(picture.length > 0 ? ["What the tribe is for:", ...picture] : []),
        ...groupLines(p),
        sharing(p),
        "If this is not right for you, choose another tribe at any time before the season starts. Nothing is lost.",
      ],
      cta: yes ? { label: "Yes, I’m in", url: yes } : { label: "See my tribe", url: c.link("/tribe") },
      ...(yes && other && hold ? { options: [{ label: "Show me other tribes", url: other }, { label: "Don’t share my details", url: hold }] } : {}),
    };
  },
});

const reminder = build({
  key: "placement_reminder",
  audience: "member",
  title: "A gentle reminder about the tribe you were placed in",
  subject: (p) => `${clean(p.tribe, "Your tribe")} is holding your place`.slice(0, 78),
  path: "/tribe",
  line: (p) => `${clean(p.tribe, "your tribe")} is holding your place. One tap confirms it.`,
  email: (p, c) => {
    const yes = placedLink(c, "confirm");
    const other = placedLink(c, "change");
    const hold = placedLink(c, "withhold");
    return {
      paragraphs: [
        `A few days ago the church placed you in ${clean(p.tribe, "a tribe")}, led by ${firstOf(p, "leader_first")}. It meets ${meetsText(p)}.`,
        "If it suits you, one tap confirms it. If it does not, you can look at other tribes any time before the season begins.",
      ],
      cta: yes ? { label: "Yes, I’m in", url: yes } : { label: "See my tribe", url: c.link("/tribe") },
      ...(yes && other && hold ? { options: [{ label: "Show me other tribes", url: other }, { label: "Don’t share my details", url: hold }] } : {}),
    };
  },
});

const withheld = build({
  key: "placement_withheld",
  audience: "member",
  title: "Your details are kept private; here is how to reach your tribe",
  subject: () => "Your details are private. Here is how to join",
  path: "/tribe",
  line: (p) => `your details stay private. Here is how to reach ${clean(p.tribe, "your tribe")}.`,
  email: (p, c) => ({
    paragraphs: [
      `Understood. ${firstOf(p, "leader_first")} will not be given your email or your WhatsApp number.`,
      `Your tribe is ${clean(p.tribe, "your tribe")}. It meets ${meetsText(p)}, and your first meeting should be by ${shortDay(str(p.first_meeting_by)) || "the first weeks"}.`,
      ...(clean(p.group_url)
        ? [
            `You are welcome to join the tribe’s WhatsApp group: ${clean(p.group_url)}`,
            `Joining a WhatsApp group shows your number to everyone in it, so join only if you are happy with that. If you would rather not, come to the first meeting, or tell ${firstOf(p, "leader_first")} you are coming, so they can meet you.`,
          ]
        : [`Please come to the first meeting, or tell ${firstOf(p, "leader_first")} you are coming, so they can meet you.`]),
    ],
    cta: { label: "See my tribe", url: c.link("/tribe") },
  }),
});

// ---------------------------------------------------------------------------
// The leader and the assistant
// ---------------------------------------------------------------------------

type Person = { name: string; email: string; whatsapp: string; withheld: boolean; state: "open" | "withheld" | "holding" | "waiting" | "not_reached"; opensOn: string };
const STATES = ["open", "withheld", "holding", "waiting", "not_reached"] as const;
function peopleOf(v: unknown): Person[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => {
      const withheld = m.withheld === true;
      const given = STATES.find((x) => x === m.state);
      return {
        name: SHAREABLE(m.name),
        email: SHAREABLE(m.email),
        whatsapp: SHAREABLE(m.whatsapp),
        withheld,
        // an older row carries no state: a member who held back is withheld, anyone else is open
        state: withheld ? "withheld" : (given ?? "open"),
        opensOn: SHAREABLE(m.opens_on),
      } satisfies Person;
    })
    .filter((m) => m.name);
}

const yourTeam = build({
  key: "placement_your_team",
  audience: "leader",
  title: "Who is on your team",
  subject: (p) => `Your team: ${clean(p.tribe, "your tribe")}`.slice(0, 78),
  path: "/lead/tribe",
  line: (p) => `your team for ${clean(p.tribe, "your tribe")} is ready. Please call each person.`,
  email: (p, c) => {
    const people = peopleOf(p.members);
    const rehearsal = p.rehearsal === true;
    const notYet = people.some((m) => m.state === "holding" || m.state === "waiting" || m.state === "not_reached");
    return {
      paragraphs: [
        `${clean(p.tribe, "Your tribe")} has ${people.length === 1 ? "one member" : `${people.length} members`}, placed by the church. Please call or message each of them${clean(p.call_by) ? ` by ${shortDay(str(p.call_by))}` : " within three days"}. A warm first word matters.`,
        ...(clean(p.first_meeting_by) ? [`The first meeting should be by ${shortDay(str(p.first_meeting_by))}.`] : []),
        ...people.map((m) => {
          if (m.state === "withheld") return `${m.name}: contact withheld; they have your details`;
          if (rehearsal) return m.name;
          if (m.state === "holding") return `${m.name}: details open ${m.opensOn ? `on ${shortDay(m.opensOn)}` : "when their day has passed"}`;
          if (m.state === "waiting" || m.state === "not_reached") return `${m.name}: not yet reached. Their details will come once they have answered`;
          return [m.name, m.email, m.whatsapp].filter(Boolean).join(", ");
        }),
        ...(notYet && !rehearsal ? ["The others’ details will appear on your tribe page as each member answers or their day passes."] : []),
        "These details are for you to say hello and to look after the tribe. Please keep them private.",
      ],
      cta: { label: "Open my tribe", url: c.link("/lead/tribe") },
    };
  },
});

const leaderAppointed = build({
  key: "placement_leader_appointed",
  audience: "leader",
  title: "You have been appointed to lead a tribe",
  subject: () => "You have been appointed to lead a tribe",
  path: "/lead/tribe",
  line: () => "you have been appointed to lead a tribe. Your Tribe Card is started.",
  email: (p, c) => {
    const fit = fitWord(p) || clean(p.fit);
    return {
      paragraphs: [
        `The church has appointed you to lead a tribe for the goal “${clean(p.goal, "this season’s goal")}”${clean(p.community) ? ` in the ${clean(p.community)} community` : ""}${fit ? `, ${fit === "excellent" ? "an excellent" : `a ${fit}`} fit for you` : ""}.`,
        "Your Tribe Card is already started: the community and the goal are set, and the three Success Picture lines begin from the ready-made card.",
        "What is still yours to do: finish your card and send it in, complete your training in the Academy, and sign the safeguarding commitment. A pastor reviews your card before members can see the tribe.",
      ],
      cta: { label: "Open my Tribe Card", url: c.link("/lead/tribe") },
    };
  },
});

// ---------------------------------------------------------------------------
// Assistant leaders
// ---------------------------------------------------------------------------

const assistantDecided = build({
  key: "assistant_decided",
  audience: "leader",
  title: "The answer to your assistant leader recommendation",
  subject: (p) => {
    switch (str(p.outcome)) {
      case "approved": return "Your assistant leader is confirmed";
      case "invited": return "Your recommendation was accepted";
      case "expired": return "Your recommendation has lapsed";
      default: return "About your assistant leader recommendation";
    }
  },
  path: "/lead/tribe",
  line: (p) => `an answer about the assistant leader you recommended for ${clean(p.tribe, "your tribe")}.`,
  email: (p, c) => {
    const tribe = clean(p.tribe, "your tribe");
    const outcome = str(p.outcome);
    const paragraphs =
      outcome === "approved"
        ? [`${clean(p.assistant_first, "Your recommendation")} is now the assistant leader of ${tribe}. Thank you for suggesting them.`]
        : outcome === "invited"
          ? [`The church office has accepted your recommendation for ${tribe}. The person you named has been invited to apply as an assistant leader. When they are approved they will be paired with your tribe, and we will tell you.`]
          : outcome === "expired"
            ? [`The person you recommended for ${tribe} has not been approved as an assistant leader within 60 days, so the recommendation has lapsed. You are welcome to recommend someone else.`]
            : [`The church office has not been able to go ahead with your recommendation for ${tribe} this time. You are welcome to recommend someone else, and we are grateful you looked for help.`];
    return { paragraphs, cta: { label: "Open my tribe", url: c.link("/lead/tribe") } };
  },
});

const assistantInvited = build({
  key: "assistant_invited",
  audience: "leader",
  title: "You have been recommended as an assistant leader",
  subject: () => "You have been recommended as an assistant leader",
  path: "/lead",
  line: (p) => `${firstOf(p, "leader_first", "A leader")} has recommended you as an assistant leader for ${clean(p.tribe, "a tribe")}.`,
  email: (p, c) => ({
    paragraphs: [
      `${firstOf(p, "leader_first", "A leader")} has recommended you as the assistant leader of ${clean(p.tribe, "a tribe")}, and the church office has agreed.`,
      "The next step is to apply to be an assistant leader. A pastor decides every application, and your training comes first. When you are approved you will be paired with the tribe, and we will tell you both.",
    ],
    cta: { label: "Start the application", url: c.link("/lead") },
  }),
});

const assistantPaired = build({
  key: "assistant_paired",
  audience: "leader",
  title: "You are now an assistant leader",
  subject: (p) => `You are now assistant leader of ${clean(p.tribe, "a tribe")}`.slice(0, 78),
  path: "/lead/tribe",
  line: (p) => `you are now assistant leader of ${clean(p.tribe, "a tribe")}.`,
  email: (p, c) => ({
    paragraphs: [
      `You are now the assistant leader of ${clean(p.tribe, "a tribe")}, with ${firstOf(p, "leader_first", "the leader")}. Thank you for saying yes.`,
      "You will see the tribe’s page and weekly notes, and you will be told when someone joins.",
    ],
    cta: { label: "Open the tribe", url: c.link("/lead/tribe") },
  }),
});

const assistantReplaced = build({
  key: "assistant_replaced",
  audience: "leader",
  title: "Your role as an assistant leader has changed",
  subject: (p) => `Your role in ${clean(p.tribe, "a tribe")} has changed`.slice(0, 78),
  path: "/lead",
  line: (p) => `your role in ${clean(p.tribe, "a tribe")} has changed. Thank you for serving.`,
  email: (p, c) => ({
    paragraphs: [
      `Thank you for serving as an assistant leader of ${clean(p.tribe, "a tribe")}. The church has asked someone else to take that place this season.`,
      "You are still an approved assistant leader, and you can be paired with another tribe.",
    ],
    cta: { label: "Open my page", url: c.link("/lead") },
  }),
});

const officeAssistant = build({
  key: "office_assistant_recommended",
  audience: "office",
  title: "A leader recommended an assistant leader",
  subject: () => "An assistant leader was recommended",
  path: "/admin/assistants",
  line: (p) => `an assistant leader was recommended for ${clean(p.tribe, "a tribe")}.`,
  email: (p, c) => ({
    paragraphs: [
      `${firstOf(p, "leader_first", "A leader")} has recommended an assistant leader for ${clean(p.tribe, "a tribe")}.`,
      ...(p.young === true ? ["The tribe has young members, so a pastor or a director decides."] : []),
      "Nothing is decided until someone in the office does.",
    ],
    cta: { label: "Open Assistants", url: (() => { const path = str(p.path); return c.link(/^\/[A-Za-z0-9/_-]*$/.test(path) && !path.startsWith("//") ? path : "/admin/assistants"); })() },
  }),
});

/** Every message here, as a template. */
export const PLACEMENT_TEMPLATES: TemplateDef[] = [
  yourTribe, reminder, withheld, yourTeam, leaderAppointed,
  assistantDecided, assistantInvited, assistantPaired, assistantReplaced, officeAssistant,
];

/** Believable fields for each, as the database supplies them. Used by the tests and the template list. */
export const PLACEMENT_SAMPLES: Record<string, Params> = {
  placement_your_tribe: {
    tribe: "Builders Tribe", leader_first: "Ngozi", assistant_first: "Dayo", meeting_day: 3, meeting_time: "20:00", mode: "online", place_note: "",
    group_url: "https://chat.whatsapp.com/abcdef", group_held: false, first_meeting_by: "2027-03-01", starts_on: "2027-02-14", season: "Season 1", fit: "strong",
    god: "Pray daily.", others: "Call each other.", life: "Take one step a week.", has_whatsapp: true, agreed_to_share: false, hold_hours: 24,
  },
  placement_reminder: { tribe: "Builders Tribe", leader_first: "Ngozi", meeting_day: 3, meeting_time: "20:00", mode: "online", place_note: "", starts_on: "2027-02-14" },
  placement_withheld: { tribe: "Builders Tribe", leader_first: "Ngozi", meeting_day: 3, meeting_time: "20:00", mode: "online", place_note: "", group_url: "https://chat.whatsapp.com/abcdef", first_meeting_by: "2027-03-01" },
  placement_your_team: {
    tribe: "Builders Tribe", first_meeting_by: "2027-03-01", call_by: "2027-02-20",
    members: [
      { name: "Ada Okafor", email: "ada@example.org", whatsapp: "+2348031234567", withheld: false, state: "open", opens_on: null },
      { name: "Bola Ade", email: null, whatsapp: null, withheld: true, state: "withheld", opens_on: null },
      { name: "Chi Eze", email: null, whatsapp: null, withheld: false, state: "holding", opens_on: "2027-02-12" },
      { name: "Dayo Bello", email: null, whatsapp: null, withheld: false, state: "not_reached", opens_on: null },
    ],
  },
  placement_leader_appointed: { goal: "Build a steady client pipeline", community: "Business and entrepreneurship", tribe: "Ngozi’s Business tribe", fit: "strong" },
  assistant_decided: { tribe: "Builders Tribe", outcome: "approved", assistant_first: "Dayo" },
  assistant_invited: { tribe: "Builders Tribe", leader_first: "Ngozi" },
  assistant_paired: { tribe: "Builders Tribe", leader_first: "Ngozi" },
  assistant_replaced: { tribe: "Builders Tribe" },
  office_assistant_recommended: { tribe: "Builders Tribe", leader_first: "Ngozi", young: false, path: "/admin/assistants" },
};


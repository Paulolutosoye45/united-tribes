/**
 * The words the office and the people see around Messages & Reminders: what each name field means, what each answer
 * at the foot of the last email is called, and how each journey and audience is described. One place, so the
 * composer, the previews, the pages people land on and the emails themselves always agree.
 */
import { NUDGE_AUDIENCE } from "@/lib/placement/nudge";

/** The name fields a message may use. The database accepts exactly these and no others (wording_problem). */
export const NAME_FIELDS = [
  { key: "first_name", label: "First name", example: "Adaeze", for: "all" },
  { key: "tribe", label: "Their tribe", example: "Builders Tribe", for: "tribe" },
  { key: "season_starts", label: "When the season starts", example: "9 February 2027", for: "all" },
  { key: "my_page", label: "Their home page", example: "your United Tribes page", for: "all" },
] as const;

/** Fields only the automatic emails fill (they need to know where the person has got to). */
export const JOURNEY_FIELDS = [
  "tribe_1", "leader_first", "seats_left", "joining_closes", "meets", "next_meeting", "erase_date", "parts_left", "minutes_left", "close_line",
] as const;

export const ALL_FIELDS: readonly string[] = [...NAME_FIELDS.map((f) => f.key), ...JOURNEY_FIELDS, "tribe"];

/** Where a button may lead. Always inside United Tribes. */
export const BUTTON_TARGETS = [
  { value: "/join", label: "Their form, where they stopped" },
  { value: "/lead/apply", label: "Their leader application, where they stopped" },
  { value: "/tribe", label: "Their tribe, or their three tribes" },
  { value: "/rhythm", label: "This week" },
  { value: "/home", label: "Their home page" },
  { value: "/profile", label: "Their profile" },
] as const;

/** What each answer at the foot of the last email is called, in the email and on the page that confirms it. */
export const ASKS: Record<string, { label: string; title: string; body: string; confirm: string; done: string; reasons?: boolean }> = {
  help_finish: {
    label: "Help me finish",
    title: "Would you like a hand finishing?",
    body: "Someone from the team will message you to help, in your own time. Nothing changes until you tell us it is what you want.",
    confirm: "Yes, please help me",
    done: "Thank you. Someone from the team will be in touch to help you finish.",
  },
  not_season: {
    label: "Not this season",
    title: "Not this season? That is completely fine.",
    body: "We will stop these reminders and your place stays open for next season. If you tell us why, it helps us do better. It is optional.",
    confirm: "Yes, not this season",
    done: "Understood. We will not remind you again this season. The door stays open.",
    reasons: true,
  },
  talk_pastor: {
    label: "Talk to a pastor",
    title: "Would you like to talk to a pastor?",
    body: "A pastor will reach out to you personally. It does not commit you to anything.",
    confirm: "Yes, please call me",
    done: "Thank you. A pastor will reach out to you.",
  },
  none_fit: {
    label: "None of these fit",
    title: "None of the three feels right?",
    body: "Tell us and we will look again with you. Nothing is lost, and your answers stay as they are.",
    confirm: "Yes, please look again",
    done: "Thank you. We will look again and come back to you.",
  },
  in_the_way: {
    label: "Something’s in the way",
    title: "Is something in the way?",
    body: "Someone from the care team will reach out. It can be the time, the place, or something harder. You do not have to explain it here.",
    confirm: "Yes, please reach out",
    done: "Thank you. Someone from the care team will reach out to you gently.",
  },
  step_back: {
    label: "I need to step back",
    title: "Need to step back for now?",
    body: "We will stop these emails. You stay in your tribe, and nobody is told to remove you. You can return whenever you are ready.",
    confirm: "Yes, I need to step back",
    done: "Understood. We will stop these emails. Your place in your tribe stays yours.",
  },
};

export const NOT_SEASON_REASONS = [
  { value: "timing", label: "The timing doesn’t work" },
  { value: "travel", label: "I’m travelling or moving" },
  { value: "other_group", label: "I’m in another group" },
  { value: "not_sure", label: "I’m not sure it’s for me" },
  { value: "other", label: "Something else" },
] as const;

export const TONES: Record<string, { label: string; hint: string }> = {
  warm: { label: "Warm", hint: "A friendly first nudge. No pressure." },
  practical: { label: "Practical", hint: "How little is left, and how to do it." },
  encouraging: { label: "Encouraging", hint: "Why it is worth finishing." },
  honest: { label: "Honest last call", hint: "Plain about what happens next, with a way out." },
  office: { label: "Announcement", hint: "Written by the office." },
};

export const JOURNEYS: Record<string, { title: string; short: string; who: string; stops: string }> = {
  member_form: {
    title: "Started the form, not finished",
    short: "Unfinished form",
    who: "People who started the member form and went quiet.",
    stops: "They finish the form.",
  },
  leader_application: {
    title: "Started a leader application, not finished",
    short: "Leader application",
    who: "People who started applying to lead a tribe and went quiet.",
    stops: "They send the application.",
  },
  no_tribe: {
    title: "Finished the form, not in a tribe",
    short: "No tribe yet",
    who: "People whose tribes are ready but who have not chosen one.",
    stops: "They join a tribe.",
  },
  in_tribe: {
    title: "In a tribe, nothing done yet",
    short: "Quiet in a tribe",
    who: "People in a tribe who have done nothing since the season began.",
    stops: "They log a step, come to a meeting or reply.",
  },
};

export const MODES = {
  off: { label: "Off", hint: "Sends nothing and starts nothing." },
  rehearsal: { label: "Rehearsal", hint: "Writes what it would send to a log. Sends nothing." },
  on: { label: "On", hint: "Sends to real people." },
} as const;

export const AUDIENCE_KINDS = [
  { kind: "everyone", label: "Everyone", hint: "Every member who has finished or started." },
  { kind: "started", label: "Started the form, not finished", hint: "Their saved answers wait for them." },
  { kind: "finished_no_tribe", label: "Finished the form, not in a tribe", hint: "Their tribes are ready." },
  { kind: "in_tribe", label: "In a tribe", hint: "Everyone currently placed." },
  { kind: "leader_applicants", label: "Leader applicants", hint: "By how far they have got." },
  { kind: "leaders", label: "Leaders", hint: "Everyone leading a tribe." },
  { kind: "staff", label: "Team members", hint: "By role." },
  { kind: "cannot_reach", label: "Cannot be reached on WhatsApp", hint: "No number saved, or no yes to WhatsApp. Asked by email, never more than three times." },
  { kind: "leader_cards", label: "Leaders whose Tribe Card is not finished", hint: "Not started, in progress, or sent back for changes. The Leader cards board has the same list." },
  { kind: "placed_waiting", label: NUDGE_AUDIENCE.label, hint: NUDGE_AUDIENCE.help },
] as const;

/** Who “cannot be reached on WhatsApp” means. */
export const REACH_CAUSES = [
  { value: "either", label: "Both groups" },
  { value: "no_number", label: "No number saved" },
  { value: "no_yes", label: "A number, but WhatsApp not agreed" },
] as const;

export const STAFF_ROLES = [
  { value: "coach", label: "Coaches" },
  { value: "care_lead", label: "Care leads" },
  { value: "data_lead", label: "Data leads" },
  { value: "community_champion", label: "Community champions" },
  { value: "pastor", label: "Pastors" },
  { value: "director", label: "Directors" },
  { value: "admin", label: "Admins" },
] as const;

export const LEFT_OUT_REASONS: Record<string, string> = {
  under18: "Under 18 (their parents’ rules apply)",
  announcements_off: "Turned announcements off",
  reminders_off: "Turned reminders off",
  email_off: "Turned email off",
  deletion: "Asked for their data to be deleted",
  bounced: "Address does not work",
  weekly_cap: "Already had enough this week",
  cancelled: "Cancelled before sending",
  asked_recently: "Asked in the last two weeks",
  asked_enough: "Already asked three times",
  gap_closed: "Put it right since the list was made",
  answered_since: "Said yes, changed tribe or gave up the seat since the count",
  not_on: "Not switched on for them yet",
  withheld: "Pressed Don’t share my details",
  placed_recent: "Placed less than a day ago",
  nudged_enough: "Already nudged as many times as allowed",
  nudged_recently: "Nudged in the last few days",
};

export const BROADCAST_STATUS: Record<string, { label: string; tone: "grey" | "amber" | "green" | "red" | "blue" }> = {
  draft: { label: "Draft", tone: "grey" },
  awaiting_approval: { label: "Waiting for approval", tone: "amber" },
  scheduled: { label: "Scheduled", tone: "blue" },
  sending: { label: "Sending", tone: "blue" },
  paused: { label: "Paused", tone: "amber" },
  sent: { label: "Sent", tone: "green" },
  cancelled: { label: "Cancelled", tone: "grey" },
  rejected: { label: "Sent back", tone: "red" },
};

export const APPLICATION_STAGES = [
  { value: "draft", label: "Started, not sent" },
  { value: "submitted", label: "Sent in" },
  { value: "interview_invited", label: "Invited to interview" },
  { value: "interview_booked", label: "Interview booked" },
  { value: "interviewed", label: "Interviewed" },
  { value: "approved_leader", label: "Approved to lead" },
  { value: "approved_assistant", label: "Approved as assistant" },
  { value: "not_approved", label: "Not approved" },
] as const;

/** A short sentence for a rule, for lists and for the summary before sending. */
export function audienceLabel(spec: { kind: string; community?: string; idle_days?: number; no_fit?: string; stages?: string[]; roles?: string[]; cause?: string; tribe?: string; need?: string; waited_hours?: number }, communities: { id: string; name: string }[] = []): string {
  const base = AUDIENCE_KINDS.find((k) => k.kind === spec.kind)?.label ?? "Members";
  const parts: string[] = [];
  if (spec.kind === "started" && spec.idle_days) parts.push(`quiet for ${spec.idle_days}+ days`);
  if (spec.kind === "finished_no_tribe" && spec.no_fit === "exclude") parts.push("not those with no tribe that fits");
  if (spec.kind === "finished_no_tribe" && spec.no_fit === "only") parts.push("only those with no tribe that fits");
  if (spec.kind === "leader_applicants" && spec.stages?.length) parts.push(spec.stages.map((s) => APPLICATION_STAGES.find((x) => x.value === s)?.label ?? s).join(", ").toLowerCase());
  if (spec.kind === "staff" && spec.roles?.length) parts.push(spec.roles.map((r) => STAFF_ROLES.find((x) => x.value === r)?.label ?? r).join(", ").toLowerCase());
  if (spec.kind === "cannot_reach" && spec.cause === "no_number") parts.push("no number saved");
  if (spec.kind === "cannot_reach" && spec.cause === "no_yes") parts.push("number saved, WhatsApp not agreed");
  if (spec.kind === "cannot_reach" && spec.tribe) parts.push("one tribe");
  if (spec.kind === "placed_waiting" && spec.need === "gap") parts.push("no number or no WhatsApp yes");
  if (spec.kind === "placed_waiting" && spec.waited_hours && spec.waited_hours > 24) parts.push(`placed over ${spec.waited_hours % 24 === 0 ? `${spec.waited_hours / 24} days` : `${spec.waited_hours} hours`} ago`);
  if (spec.kind === "placed_waiting" && spec.tribe) parts.push("one tribe");
  if (spec.community) parts.push(`in ${communities.find((c) => c.id === spec.community)?.name ?? "one community"}`);
  return parts.length ? `${base} (${parts.join("; ")})` : base;
}

/** Starting points, each in a tone that fits who it is for. The writer changes anything. */
export const STARTERS = [
  {
    id: "saved",
    title: "We saved your place",
    for: "started",
    subject: "Your answers are waiting for you, {first_name}",
    paragraphs: ["You began telling us about your season, and everything you wrote is saved exactly as you left it.", "It takes about five minutes to finish, and then we can introduce you to your tribe."],
    button_label: "Carry on where I stopped",
    button_target: "/join",
  },
  {
    id: "tribes_ready",
    title: "Your tribes are ready",
    for: "finished_no_tribe",
    subject: "Your tribes are ready, {first_name}",
    paragraphs: ["Thank you for finishing your form. We found tribes that fit your season, with how well each one matches you and why.", "Take two minutes to look, and choose the one you would love to walk with."],
    button_label: "See my tribes",
    button_target: "/tribe",
  },
  {
    id: "season_soon",
    title: "The season is about to begin",
    for: "in_tribe",
    subject: "Your season starts on {season_starts}",
    paragraphs: ["{tribe} begins on {season_starts}. Your leader will be in touch to say hello.", "Open this week’s page to see what to expect and to choose your first small step."],
    button_label: "Open this week",
    button_target: "/rhythm",
  },
  {
    id: "thank_you",
    title: "A word of thanks",
    for: "everyone",
    subject: "Thank you, {first_name}",
    paragraphs: ["We wanted to say thank you for being part of United Tribes. Nobody at The Covenant Nation should walk through a season alone, and you are part of making that true.", "We are praying for you."],
    button_label: null,
    button_target: null,
  },
] as const;

/** Notes about how people are reached. Offered only while Contact gaps is On. Each says plainly that the choice is theirs and who can see a number. */
export const REACH_STARTERS = [
  {
    id: "how_to_reach",
    title: "How would you like to be reached?",
    for: "everyone",
    subject: "How would you like to be reached, {first_name}?",
    paragraphs: [
      "Your tribe’s leader would like to reach you in the way that suits you. You decide how, and you can change it whenever you like.",
      "On your profile you can add a phone number, say whether you are happy to be messaged on WhatsApp, and choose which emails you get. Only your tribe’s leader, their assistant and your coach can see your number, and only if you have said yes to WhatsApp. Other members never see it.",
      "If you would rather not share a number, that is fine. We will use email.",
    ],
    button_label: "Choose how I am reached",
    button_target: "/profile",
  },
  {
    id: "add_number",
    title: "Add your number",
    for: "cannot_reach",
    subject: "Your leader would like to reach you, {first_name}",
    paragraphs: [
      "We do not have a phone number for you yet, so your leader can only reach you by email.",
      "If you are happy to, add one on your profile and say whether WhatsApp is fine. Only your tribe’s leader, their assistant and your coach can see it, and only if WhatsApp is ticked. You can change or remove it whenever you like.",
      "If you would rather not, that is completely fine.",
    ],
    button_label: "Add my number",
    button_target: "/profile",
  },
  {
    id: "tick_whatsapp",
    title: "Tick WhatsApp if you are happy",
    for: "cannot_reach",
    subject: "Is WhatsApp all right for you, {first_name}?",
    paragraphs: [
      "Thank you for giving us your number. Your leader cannot see it yet, because WhatsApp is not ticked on your profile.",
      "If you are happy for your leader to message you on WhatsApp, tick it. If you would rather be reached another way, leave it as it is. Nothing changes unless you change it.",
    ],
    button_label: "Choose how I am reached",
    button_target: "/profile",
  },
] as const;
